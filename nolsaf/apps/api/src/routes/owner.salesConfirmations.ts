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
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import {
  OWNER_ANSWERS,
  OWNER_CONTACT_CHANNELS,
  OwnerConfirmationError,
  answerOwnerConfirmation,
  hashConfirmationReference,
  hashResponseIp,
} from "../lib/salesOwnerConfirmation.js";
import { CARD_VALIDITY_TEXT, cardToken, cardValidity, cardVerifyUrl } from "../lib/salesPartnerCard.js";

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
  contactChannel: z.enum(OWNER_CONTACT_CHANNELS).optional(),
});
const resolveSchema = z.object({ reference: z.string().trim().min(20).max(80).regex(/^[A-Za-z0-9_-]+$/) });

/**
 * The partner's ID card as the owner may see it: the same facts the public
 * card check shows (photo, card number, region, live validity) plus the link
 * to that check, so the owner can verify the person behind the name. Never
 * contact details, never earnings. The newest card that was ever issued wins;
 * a partner with no card yet gets null.
 */
function partnerCard(partner: any, now: Date) {
  const card = partner?.idCards?.[0];
  if (!card) return null;
  const accountBlocked = Boolean(partner.user?.suspendedAt || partner.user?.isDisabled);
  const validity = cardValidity({ card, partnerStatus: accountBlocked ? "SUSPENDED" : partner.status, contracts: partner.contracts ?? [], now });
  return {
    valid: validity === "VALID",
    validity,
    message: CARD_VALIDITY_TEXT[validity],
    cardNumber: card.cardNumber,
    // A photo NoLSAF has not approved is never shown as the partner's face.
    photoUrl: validity === "PHOTO_REVIEW" || validity === "PHOTO_REJECTED" ? null : card.photoUrl,
    expiresAt: card.expiresAt,
    verifyUrl: cardVerifyUrl(cardToken(card)),
  };
}

function publicConfirmation(row: any, now = new Date()) {
  const partner = row.salesPartner;
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requestedAt,
    expiresAt: row.expiresAt,
    respondedAt: row.respondedAt,
    contactChannel: row.contactChannel ?? null,
    note: row.responseNote ?? null,
    property: { title: row.property?.title ?? "" },
    // Who the partner is, never what they earn or how to reach them privately.
    partner: {
      name: partner?.user?.fullName || partner?.user?.name || "NoLSAF sales partner",
      agentCode: partner?.agentCode || "",
      region: partner?.region || null,
      territory: partner?.territory || null,
      partnerSince: partner?.createdAt ?? null,
      teamLead: partner?.ledTeam?.status === "ACTIVE",
      card: partnerCard(partner, now),
    },
  };
}

const confirmationSelect = {
  id: true,
  status: true,
  requestedAt: true,
  expiresAt: true,
  respondedAt: true,
  responseNote: true,
  contactChannel: true,
  propertyId: true,
  salesPartnerId: true,
  property: { select: { title: true } },
  salesPartner: {
    select: {
      agentCode: true,
      region: true,
      territory: true,
      status: true,
      createdAt: true,
      user: { select: { name: true, fullName: true, suspendedAt: true, isDisabled: true } },
      contracts: { select: { status: true, startsAt: true, expiresAt: true }, orderBy: { expiresAt: "desc" as const }, take: 5 },
      idCards: {
        where: { status: { in: ["ACTIVE", "PENDING_REVIEW", "REVOKED", "PHOTO_REJECTED"] } },
        select: { id: true, salt: true, cardNumber: true, photoUrl: true, status: true, expiresAt: true },
        orderBy: { issuedAt: "desc" as const },
        take: 1,
      },
      ledTeam: { select: { status: true } },
    },
  },
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
  res.json({ pending: dedupe(pending).map((row) => publicConfirmation(row, now)), answered: dedupe(answered).map((row) => publicConfirmation(row, now)) });
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
  if (!parsed.success) return res.status(400).json({ error: "Choose an answer, and for a yes, how the partner reached you" });
  try {
    const result = await db.$transaction((tx: any) => answerOwnerConfirmation(tx, {
      confirmationId: params.data.id,
      userId: req.user!.id,
      answer: parsed.data.answer,
      note: parsed.data.note ?? null,
      contactChannel: parsed.data.contactChannel ?? null,
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
    // A "no" freezes the claim; someone at NoLSAF has to review, revoke or reassign it.
    if (result.answer !== "CONFIRMED") {
      const row = await db.salesOwnerConfirmation.findUnique({
        where: { id: params.data.id },
        select: { salesPartner: { select: { agentCode: true } } },
      }).catch(() => null);
      void notifyAdmins("sales_partner_owner_disputed", {
        propertyTitle: result.propertyTitle,
        agentCode: row?.salesPartner?.agentCode ?? null,
        answer: result.answer,
        attributionIds: result.attributionIds,
        href: "/admin/sales",
      }).catch(() => undefined);
    }
    res.json({ ok: true, status: result.answer });
  } catch (error) {
    if (error instanceof OwnerConfirmationError) return res.status(error.status).json({ error: error.message });
    throw error;
  }
}));

export default router;
