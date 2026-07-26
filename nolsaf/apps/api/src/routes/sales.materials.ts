import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesAdminRead, limitSalesAdminWrite, limitSalesPropertyRead } from "../middleware/rateLimit.js";
import {
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import { SALES_MATERIAL_CATEGORIES } from "../lib/salesPartner.js";
import { sanitizeText } from "../lib/sanitize.js";

const db = prisma as any;
const secureUrl = z.string().url().max(500).refine((value) => value.startsWith("https://"), "URL must use HTTPS");
const optionalText = (max: number) =>
  z.union([z.string().trim().max(max), z.null()]).optional().transform((value) => {
    if (value == null) return value;
    const clean = sanitizeText(value);
    return clean || null;
  });
const optionalUrl = z.union([secureUrl, z.literal(""), z.null()]).optional().transform((value) => value || null);
const materialFields = z.object({
  title: z.string().trim().min(2).max(200).transform(sanitizeText),
  description: optionalText(5_000),
  category: z.enum(SALES_MATERIAL_CATEGORIES),
  fileUrl: optionalUrl,
  externalUrl: optionalUrl,
  isPublished: z.boolean().default(false),
  sortOrder: z.coerce.number().int().min(-10_000).max(10_000).default(0),
}).strict();
const materialInput = materialFields.refine((value) => Boolean(value.fileUrl || value.externalUrl), {
  message: "A secure file or external URL is required",
});
const materialPatch = materialFields.partial().refine((value) => Object.keys(value).length > 0, {
  message: "No changes supplied",
});
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  category: z.enum(SALES_MATERIAL_CATEGORIES).optional(),
  q: z.string().trim().max(120).optional(),
});
const adminListSchema = listSchema.extend({
  published: z.enum(["ALL", "PUBLISHED", "DRAFT"]).default("ALL"),
});
const idSchema = z.object({ id: z.coerce.number().int().positive() });

function invalid(res: Response, parsed: { success: boolean; error?: any }) {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
}

function auditData(req: AuthedRequest, action: string, entityId: number, beforeJson: any, afterJson: any) {
  return {
    actorId: req.user!.id,
    actorRole: req.user!.role || "ADMIN",
    action,
    entity: "SALES_MATERIAL",
    entityId,
    ip: req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() || req.socket.remoteAddress || null,
    ua: String(req.headers["user-agent"] || "") || null,
    beforeJson,
    afterJson,
  };
}

function listWhere(input: { category?: string; q?: string }, publishedOnly: boolean) {
  return {
    ...(publishedOnly ? { isPublished: true } : {}),
    ...(input.category ? { category: input.category } : {}),
    ...(input.q
      ? { OR: [{ title: { contains: input.q } }, { description: { contains: input.q } }] }
      : {}),
  };
}

export const salesMaterialsRouter = Router();
salesMaterialsRouter.use(
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  requireActivePartnerContract,
  limitSalesPropertyRead,
);

salesMaterialsRouter.get("/materials", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const { page, pageSize, category, q } = parsed.data!;
  const where = listWhere({ category, q }, true);
  const [total, materials] = await Promise.all([
    db.salesMaterial.count({ where }),
    db.salesMaterial.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        fileUrl: true,
        externalUrl: true,
        updatedAt: true,
      },
    }),
  ]);
  res.json({ total, page, pageSize, materials });
}));

salesMaterialsRouter.get("/materials/:id", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const material = await db.salesMaterial.findFirst({
    where: { id: parsed.data!.id, isPublished: true },
    select: {
      id: true,
      title: true,
      description: true,
      category: true,
      fileUrl: true,
      externalUrl: true,
      updatedAt: true,
    },
  });
  if (!material) return res.status(404).json({ error: "Material not found" });
  res.json({ material });
}));

export const adminSalesMaterialsRouter = Router();
adminSalesMaterialsRouter.use(
  requireAuth as RequestHandler,
  requireRole("ADMIN") as RequestHandler,
  blockImpersonated as RequestHandler,
);

adminSalesMaterialsRouter.get("/materials", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = adminListSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const { page, pageSize, category, q, published } = parsed.data!;
  const where: any = listWhere({ category, q }, false);
  if (published === "PUBLISHED") where.isPublished = true;
  if (published === "DRAFT") where.isPublished = false;
  const [total, materials] = await Promise.all([
    db.salesMaterial.count({ where }),
    db.salesMaterial.findMany({
      where,
      orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        fileUrl: true,
        externalUrl: true,
        isPublished: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
        createdBy: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);
  res.json({ total, page, pageSize, materials });
}));

adminSalesMaterialsRouter.post("/materials", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = materialInput.safeParse(req.body);
  if (invalid(res, parsed)) return;
  const material = await db.$transaction(async (tx: any) => {
    const created = await tx.salesMaterial.create({
      data: { ...parsed.data!, createdById: req.user!.id },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        fileUrl: true,
        externalUrl: true,
        isPublished: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await tx.auditLog.create({
      data: auditData(req, "SALES_MATERIAL_CREATE", created.id, null, {
        title: created.title,
        category: created.category,
        isPublished: created.isPublished,
      }),
    });
    return created;
  });
  res.status(201).json({ material });
}));

adminSalesMaterialsRouter.patch("/materials/:id", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = materialPatch.safeParse(req.body);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const id = params.data!.id;
  const material = await db.$transaction(async (tx: any) => {
    const current = await tx.salesMaterial.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        fileUrl: true,
        externalUrl: true,
        isPublished: true,
        sortOrder: true,
      },
    });
    if (!current) return null;
    const next = { ...current, ...parsed.data! };
    if (!next.fileUrl && !next.externalUrl) throw new Error("MATERIAL_URL_REQUIRED");
    const updated = await tx.salesMaterial.update({
      where: { id },
      data: parsed.data!,
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        fileUrl: true,
        externalUrl: true,
        isPublished: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await tx.auditLog.create({
      data: auditData(req, "SALES_MATERIAL_UPDATE", id, current, updated),
    });
    return updated;
  }).catch((error: any) => {
    if (error?.message === "MATERIAL_URL_REQUIRED") return "URL_REQUIRED";
    throw error;
  });
  if (material === "URL_REQUIRED") return res.status(400).json({ error: "A secure file or external URL is required" });
  if (!material) return res.status(404).json({ error: "Material not found" });
  res.json({ material });
}));
