// Sales partner property portfolio.
//
// Property access is derived from an attribution owned by the authenticated
// partner. A property id from the URL is never sufficient authorization.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitSalesPropertyRead } from "../middleware/rateLimit.js";
import {
  partnerIdFor,
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import { ATTRIBUTION_STATUSES, COMMISSION_STATUSES, PRODUCT_TYPES } from "../lib/salesPartner.js";

const router = Router();
const db = prisma as any;

router.use(
  requireAuth as RequestHandler,
  requireWorkspaceAccess("SALES"),
  requireActivePartnerContract,
  limitSalesPropertyRead,
);

const idSchema = z.object({ propertyId: z.coerce.number().int().positive() });
const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(120).optional(),
  product: z.enum(PRODUCT_TYPES).optional(),
  status: z.enum(ATTRIBUTION_STATUSES).optional(),
});
const earningsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z.enum(COMMISSION_STATUSES).optional(),
});

function invalid(res: Response, parsed: { success: boolean; error?: any }) {
  if (parsed.success) return false;
  res.status(400).json({ error: parsed.error?.issues?.[0]?.message || "Invalid request" });
  return true;
}

function scopedPartnerId(req: SalesAuthedRequest, res: Response): number | null {
  const id = partnerIdFor(req);
  if (!id) res.status(403).json({ error: "Sales partner context required" });
  return id;
}

async function attributedProperty(partnerId: number, propertyId: number) {
  return db.property.findFirst({
    where: {
      id: propertyId,
      salesAttributions: { some: { salesPartnerId: partnerId } },
    },
    select: {
      id: true,
      title: true,
      status: true,
      type: true,
      city: true,
      district: true,
      regionName: true,
      country: true,
      totalBedrooms: true,
      nrmsActivatedAt: true,
      createdAt: true,
      salesAttributions: {
        where: { salesPartnerId: partnerId },
        orderBy: { productType: "asc" },
        select: {
          id: true,
          productType: true,
          status: true,
          attributedAt: true,
          verifiedAt: true,
          commissionStartsAt: true,
          commissionEndsAt: true,
          reassignedAt: true,
          revokedAt: true,
          lead: {
            select: {
              id: true,
              propertyName: true,
              contactPerson: true,
              contactPhone: true,
              contactEmail: true,
              conversionRequestedAt: true,
              convertedAt: true,
            },
          },
          contract: {
            select: {
              id: true,
              contractNumber: true,
              status: true,
              startsAt: true,
              expiresAt: true,
            },
          },
        },
      },
    },
  });
}

/** GET /api/sales/properties */
router.get("/properties", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = listSchema.safeParse(req.query);
  if (invalid(res, parsed)) return;
  const partnerId = scopedPartnerId(req, res);
  if (!partnerId) return;
  const { page, pageSize, q, product, status } = parsed.data!;
  const attributionWhere: any = {
    salesPartnerId: partnerId,
    ...(product ? { productType: product } : {}),
    ...(status ? { status } : {}),
  };
  const where: any = { salesAttributions: { some: attributionWhere } };
  if (q) {
    where.OR = [
      { title: { contains: q } },
      { city: { contains: q } },
      { district: { contains: q } },
      { regionName: { contains: q } },
    ];
  }

  const [total, properties] = await Promise.all([
    db.property.count({ where }),
    db.property.findMany({
      where,
      orderBy: { id: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        title: true,
        status: true,
        type: true,
        city: true,
        district: true,
        regionName: true,
        totalBedrooms: true,
        nrmsActivatedAt: true,
        salesAttributions: {
          where: { salesPartnerId: partnerId },
          select: {
            id: true,
            productType: true,
            status: true,
            attributedAt: true,
            commissionStartsAt: true,
            commissionEndsAt: true,
          },
        },
      },
    }),
  ]);
  const propertyIds = properties.map((property: any) => property.id);
  const earnings = propertyIds.length
    ? await db.salesCommission.groupBy({
        by: ["propertyId"],
        where: { salesPartnerId: partnerId, propertyId: { in: propertyIds }, status: { notIn: ["CANCELLED", "REVERSED"] } },
        _sum: { commissionAmount: true },
      })
    : [];
  const earningsByProperty = new Map(
    earnings.map((row: any) => [row.propertyId, Number(row._sum.commissionAmount || 0)]),
  );

  res.json({
    total,
    page,
    pageSize,
    properties: properties.map((property: any) => ({
      ...property,
      totalEarnings: earningsByProperty.get(property.id) || 0,
      currency: "TZS",
    })),
  });
}));

/** GET /api/sales/properties/:propertyId */
router.get("/properties/:propertyId", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const partnerId = scopedPartnerId(req, res);
  if (!partnerId) return;
  const property = await attributedProperty(partnerId, parsed.data!.propertyId);
  if (!property) return res.status(404).json({ error: "Attributed property not found" });

  const totals = await db.salesCommission.aggregate({
    where: { salesPartnerId: partnerId, propertyId: property.id, status: { notIn: ["CANCELLED", "REVERSED"] } },
    _sum: { commissionAmount: true, eligibleNetRevenue: true },
    _count: { id: true },
  });
  res.json({
    property,
    totals: {
      commissionAmount: Number(totals._sum.commissionAmount || 0),
      eligibleNetRevenue: Number(totals._sum.eligibleNetRevenue || 0),
      commissionCount: totals._count.id,
      currency: "TZS",
    },
  });
}));

/** GET /api/sales/properties/:propertyId/earnings */
router.get("/properties/:propertyId/earnings", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const params = idSchema.safeParse(req.params);
  const parsed = earningsSchema.safeParse(req.query);
  if (invalid(res, params) || invalid(res, parsed)) return;
  const partnerId = scopedPartnerId(req, res);
  if (!partnerId) return;
  const property = await attributedProperty(partnerId, params.data!.propertyId);
  if (!property) return res.status(404).json({ error: "Attributed property not found" });
  const { page, pageSize, status } = parsed.data!;
  const where: any = {
    salesPartnerId: partnerId,
    propertyId: property.id,
    ...(status ? { status } : {}),
  };
  const [total, earnings] = await Promise.all([
    db.salesCommission.count({ where }),
    db.salesCommission.findMany({
      where,
      orderBy: { earnedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        type: true,
        status: true,
        sourceKey: true,
        grossAmount: true,
        taxAmount: true,
        processingFeeAmount: true,
        refundAmount: true,
        discountAmount: true,
        eligibleNetRevenue: true,
        commissionRate: true,
        commissionAmount: true,
        currency: true,
        description: true,
        earnedAt: true,
        eligibleAt: true,
        availableAt: true,
        paidAt: true,
      },
    }),
  ]);
  res.json({ total, page, pageSize, property: { id: property.id, title: property.title }, earnings });
}));

/** GET /api/sales/properties/:propertyId/activity */
router.get("/properties/:propertyId/activity", asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const parsed = idSchema.safeParse(req.params);
  if (invalid(res, parsed)) return;
  const partnerId = scopedPartnerId(req, res);
  if (!partnerId) return;
  const property = await attributedProperty(partnerId, parsed.data!.propertyId);
  if (!property) return res.status(404).json({ error: "Attributed property not found" });
  const attributionIds = property.salesAttributions.map((item: any) => item.id);
  const leadIds = property.salesAttributions
    .map((item: any) => item.lead?.id)
    .filter((id: unknown): id is number => Number.isInteger(id));
  const [audits, leadActivities] = await Promise.all([
    attributionIds.length
      ? db.auditLog.findMany({
          where: { entity: "PROPERTY_SALES_ATTRIBUTION", entityId: { in: attributionIds } },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { id: true, action: true, entityId: true, beforeJson: true, afterJson: true, createdAt: true },
        })
      : [],
    leadIds.length
      ? db.salesLeadActivity.findMany({
          where: { leadId: { in: leadIds } },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { id: true, leadId: true, type: true, description: true, createdAt: true },
        })
      : [],
  ]);
  const activity = [
    ...audits.map((item: any) => ({ ...item, id: String(item.id), source: "ATTRIBUTION" })),
    ...leadActivities.map((item: any) => ({ ...item, source: "LEAD" })),
  ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json({ property: { id: property.id, title: property.title }, activity: activity.slice(0, 100) });
}));

export default router;
