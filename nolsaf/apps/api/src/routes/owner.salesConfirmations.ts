/**
 * Owner answers to "Did this sales partner bring you to NoLSAF?".
 *
 * Signed-in owners only, never during an admin support session, rate limited
 * per owner. Every lookup is scoped to the session user, and a request that
 * does not belong to them is indistinguishable from one that does not exist.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitOwnerSalesConfirmation } from "../middleware/rateLimit.js";
import { notifyUser } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import {
  OWNER_ANSWERS,
  OwnerConfirmationError,
  answerOwnerConfirmation,
  hashConfirmationReference,
  hashResponseIp,
} from "../lib/salesOwnerConfirmation.js";

const db = prisma as any;

export const router = Router();
router.use(
  requireAuth as RequestHandler,
  requireRole("OWNER") as RequestHandler,
  blockImpersonated as RequestHandler,
);
// Reads are scoped to the owner; the limit guards resolving and answering.
const limitWrites = limitOwnerSalesConfirmation as unknown as RequestHandler;

const idParams = z.object({ id: z.coerce.number().int().positive() });
const answerSchema = z.object({
  answer: z.enum(OWNER_ANSWERS),
  note: z.string().trim().max(300).transform(sanitizeText).optional(),
});
const resolveSchema = z.object({ reference: z.string().trim().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/) });

function publicConfirmation(row: any) {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    property: { title: row.property?.title ?? "" },
    // Who the partner is, never what they earn.
    partner: {
      name: row.salesPartner?.user?.name || "NoLSAF sales partner",
      agentCode: row.salesPartner?.agentCode || "",
      region: row.salesPartner?.region || null,
    },
  };
}

const confirmationSelect = {
  id: true,
  status: true,
  requestedAt: true,
  expiresAt: true,
  respondedAt: true,
  propertyId: true,
  salesPartnerId: true,
  property: { select: { title: true } },
  salesPartner: { select: { agentCode: true, region: true, user: { select: { name: true } } } },
};

/** One entry per partner and property: several products answer together. */
function dedupe(rows: any[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.propertyId}:${row.salesPartnerId}:${row.status}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** GET /api/owner/sales-confirmations/count: for the sidebar badge. */
router.get("/count", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  const ownerScope = { ownerUserId: userId, property: { ownerId: userId } };
  const [pending, answered] = await Promise.all([
    db.salesOwnerConfirmation.count({ where: { ...ownerScope, status: "PENDING", expiresAt: { gt: new Date() } } }),
    db.salesOwnerConfirmation.count({ where: { ...ownerScope, status: { in: [...OWNER_ANSWERS] } } }),
  ]);
  res.json({ pending, answered });
}));

/** GET /api/owner/sales-confirmations: open requests and the last answers. */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  const now = new Date();
  const ownerScope = { ownerUserId: userId, property: { ownerId: userId } };
  const [pending, answered] = await Promise.all([
    db.salesOwnerConfirmation.findMany({
      where: { ...ownerScope, status: "PENDING", expiresAt: { gt: now } },
      orderBy: { requestedAt: "desc" },
      take: 50,
      select: confirmationSelect,
    }),
    db.salesOwnerConfirmation.findMany({
      where: { ...ownerScope, status: { in: [...OWNER_ANSWERS] } },
      orderBy: { respondedAt: "desc" },
      take: 30,
      select: confirmationSelect,
    }),
  ]);
  res.json({ pending: dedupe(pending).map(publicConfirmation), answered: dedupe(answered).map(publicConfirmation) });
}));

/** POST /api/owner/sales-confirmations/resolve: map a link reference to the owner's own request. */
router.post("/resolve", limitWrites, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) return res.status(404).json({ error: "Request not found" });
  const row = await db.salesOwnerConfirmation.findFirst({
    where: {
      referenceHash: hashConfirmationReference(parsed.data.reference),
      ownerUserId: req.user!.id,
      property: { ownerId: req.user!.id },
    },
    select: { id: true, status: true },
  });
  if (!row) return res.status(404).json({ error: "Request not found" });
  res.json({ id: row.id, status: row.status });
}));

/** POST /api/owner/sales-confirmations/:id/answer */
router.post("/:id/answer", limitWrites, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  const parsed = answerSchema.safeParse(req.body);
  if (!params.success) return res.status(404).json({ error: "Request not found" });
  if (!parsed.success) return res.status(400).json({ error: "Choose an answer" });
  try {
    const result = await db.$transaction((tx: any) => answerOwnerConfirmation(tx, {
      confirmationId: params.data.id,
      userId: req.user!.id,
      answer: parsed.data.answer,
      note: parsed.data.note ?? null,
      ipHash: hashResponseIp(req.ip),
      userAgent: req.get("user-agent") || null,
      sessionId: req.sessionId || null,
    }));
    if (result.partnerUserId) {
      await notifyUser(
        result.partnerUserId,
        result.answer === "CONFIRMED" ? "sales_partner_owner_confirmed" : "sales_partner_owner_disputed",
        { propertyName: result.propertyTitle },
      ).catch(() => undefined);
    }
    res.json({ ok: true, status: result.answer });
  } catch (error) {
    if (error instanceof OwnerConfirmationError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}));

export default router;
