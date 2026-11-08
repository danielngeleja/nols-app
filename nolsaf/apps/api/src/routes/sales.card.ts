/**
 * The sales partner's own ID card.
 *
 * GET  /api/sales/id-card  current card (with its verify link and code) or what is missing
 * POST /api/sales/id-card  request a card, or a replacement (lost phone, new photo)
 *
 * Requesting needs an active partner, a current contract and a profile photo.
 * The photo is copied onto the card at that moment, and the card only starts
 * verifying once an admin approves that photo (see admin.sales.partners).
 */
import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import {
  partnerIdFor,
  requireActivePartnerContract,
  requireWorkspaceAccess,
  type SalesAuthedRequest,
} from "../middleware/salesWorkspace.js";
import { limitSalesLeadRead, limitSalesLeadWrite } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins } from "../lib/notifications.js";
import {
  CARD_PENDING_REVIEW,
  CARD_PHOTO_REJECTED,
  CARD_VALIDITY_TEXT,
  cardCode,
  cardExpiry,
  cardToken,
  cardValidity,
  cardVerifyUrl,
  hashCardToken,
  newCardSalt,
} from "../lib/salesPartnerCard.js";

const router = Router();
const db = prisma as any;

router.use(requireAuth as RequestHandler, requireWorkspaceAccess("SALES"));

const partnerSelect = {
  id: true,
  agentCode: true,
  status: true,
  level: true,
  region: true,
  territory: true,
  user: { select: { name: true, fullName: true, avatarUrl: true } },
  contracts: { select: { status: true, startsAt: true, expiresAt: true }, orderBy: { expiresAt: "desc" as const }, take: 5 },
  ledTeam: { select: { status: true } },
};

function serializeCard(card: any, partner: any) {
  const token = cardToken(card);
  const validity = cardValidity({ card, partnerStatus: partner.status, contracts: partner.contracts });
  return {
    cardNumber: card.cardNumber,
    code: cardCode(card),
    verifyUrl: cardVerifyUrl(token),
    status: card.status,
    validity,
    validityText: CARD_VALIDITY_TEXT[validity],
    photoUrl: card.photoUrl,
    issuedAt: card.issuedAt,
    expiresAt: card.expiresAt,
    verifyCount: card.verifyCount,
    lastVerifiedAt: card.lastVerifiedAt,
    holder: {
      name: partner.user?.fullName || partner.user?.name || "Sales partner",
      agentCode: partner.agentCode,
      level: partner.level,
      region: partner.region,
      territory: partner.territory,
      // Live: removing someone as team lead takes it off their card at once.
      teamLead: partner.ledTeam?.status === "ACTIVE",
    },
  };
}

function requirements(partner: any, contractActive: boolean) {
  return {
    activePartner: partner.status === "ACTIVE",
    activeContract: contractActive,
    profilePhoto: Boolean(partner.user?.avatarUrl),
  };
}

function activeContractFor(partner: any, now: Date) {
  return partner.contracts.find((c: any) => ["ACTIVE", "EXPIRING"].includes(c.status) && c.startsAt <= now && c.expiresAt > now) ?? null;
}

/**
 * Request a new card. It starts in photo review and does not verify until an
 * admin approves the photo; the current active card (if any) keeps working
 * until then. An older request still in review is withdrawn.
 */
async function requestCard(partnerId: number, partner: any, contract: any, now: Date) {
  return db.$transaction(async (tx: any) => {
    const withdrawn = await tx.salesPartnerCard.updateMany({
      where: { salesPartnerId: partnerId, status: CARD_PENDING_REVIEW },
      data: { status: "REPLACED", revokedAt: now, revokeReason: "Withdrawn by a newer request" },
    });
    const issuedBefore = await tx.salesPartnerCard.count({ where: { salesPartnerId: partnerId } });
    const salt = newCardSalt();
    // tokenHash is unique and computed from the id, so insert a placeholder first.
    const created = await tx.salesPartnerCard.create({
      data: {
        salesPartnerId: partnerId,
        cardNumber: `${partner.agentCode}-C${issuedBefore + 1}`,
        salt,
        tokenHash: hashCardToken(`pending:${salt}`),
        photoUrl: partner.user.avatarUrl,
        status: CARD_PENDING_REVIEW,
        activeKey: null,
        issuedAt: now,
        expiresAt: cardExpiry(contract.expiresAt, now),
      },
    });
    const final = await tx.salesPartnerCard.update({
      where: { id: created.id },
      data: { tokenHash: hashCardToken(cardToken(created)) },
    });
    return { card: final, withdrawn: withdrawn.count };
  });
}

/**
 * The partner's latest card was cancelled by an admin and nothing has replaced
 * it. Only an admin can issue the next card in that state.
 */
async function cancelledByNoLsaf(partnerId: number) {
  const latest = await db.salesPartnerCard.findFirst({
    where: { salesPartnerId: partnerId },
    orderBy: { id: "desc" },
    select: { status: true, cardNumber: true, revokedAt: true },
  });
  return latest?.status === "REVOKED" ? latest : null;
}

/** Tell admins a card photo is waiting, with a link that opens the partner. */
async function alertPhotoReview(partner: any, card: any, replacing: boolean) {
  await notifyAdmins("sales_partner_card_photo_review", {
    agentCode: partner.agentCode,
    partnerName: partner.user?.fullName || partner.user?.name || null,
    cardNumber: card.cardNumber,
    replacing,
    href: `/admin/sales/partners?q=${encodeURIComponent(partner.agentCode)}&open=card`,
  }).catch(() => undefined);
}

/** The card waiting for review, or the latest rejected one if nothing newer replaced it. */
function reviewView(card: any) {
  if (!card) return null;
  return {
    status: card.status === CARD_PENDING_REVIEW ? "PENDING" : "REJECTED",
    cardNumber: card.cardNumber,
    photoUrl: card.photoUrl,
    requestedAt: card.issuedAt,
    decidedAt: card.revokedAt ?? null,
    reason: card.status === CARD_PHOTO_REJECTED ? card.revokeReason ?? null : null,
  };
}

/** GET /api/sales/id-card */
router.get("/id-card", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: partnerSelect });
  if (!partner) return res.status(404).json({ error: "Sales partner not found" });
  const card = await db.salesPartnerCard.findFirst({ where: { salesPartnerId: partnerId, status: "ACTIVE" } });
  const cancelled = card ? null : await cancelledByNoLsaf(partnerId);
  // Latest card request in review, or rejected and not yet followed by another.
  let review = await db.salesPartnerCard.findFirst({
    where: { salesPartnerId: partnerId, status: { in: [CARD_PENDING_REVIEW, CARD_PHOTO_REJECTED] }, ...(card ? { id: { gt: card.id } } : {}) },
    orderBy: { id: "desc" },
  });
  // First card only: a partner who meets every requirement gets their card
  // request sent for photo review the moment they open the page. Never during
  // an admin support session, and never again once any card exists.
  if (!card && !review && !cancelled && !(req as any).user?.imp && partner.status === "ACTIVE" && partner.user?.avatarUrl) {
    const now = new Date();
    const contract = activeContractFor(partner, now);
    const everIssued = contract ? await db.salesPartnerCard.count({ where: { salesPartnerId: partnerId } }) : 1;
    if (contract && everIssued === 0) {
      try {
        const requested = await requestCard(partnerId, partner, contract, now);
        review = requested.card;
        await audit(req as any, "SALES_PARTNER_CARD_REQUEST", "SALES_PARTNER_CARD", null, { cardNumber: review.cardNumber, automatic: true }, review.id);
        await alertPhotoReview(partner, review, false);
      } catch (error: any) {
        // Two tabs at once: the card number is unique, so one wins; read it.
        if (error?.code !== "P2002") throw error;
        review = await db.salesPartnerCard.findFirst({ where: { salesPartnerId: partnerId, status: CARD_PENDING_REVIEW }, orderBy: { id: "desc" } });
      }
    }
  }
  const contractActive = cardValidity({ card: { status: "ACTIVE", expiresAt: new Date(8.64e15) }, partnerStatus: "ACTIVE", contracts: partner.contracts }) === "VALID";
  // Before the first card: what it will say, so the page can show a preview.
  // Carries no code and no verify link, so a screenshot of it proves nothing.
  let preview: Record<string, unknown> | null = null;
  if (!card) {
    const now = new Date();
    const contract = partner.contracts.find((c: any) => ["ACTIVE", "EXPIRING"].includes(c.status) && c.startsAt <= now && c.expiresAt > now);
    preview = {
      name: partner.user?.fullName || partner.user?.name || "Sales partner",
      agentCode: partner.agentCode,
      region: partner.region,
      territory: partner.territory,
      photoUrl: partner.user?.avatarUrl || null,
      teamLead: partner.ledTeam?.status === "ACTIVE",
      expiresAt: contract ? cardExpiry(contract.expiresAt, now).toISOString() : null,
    };
  }
  res.setHeader("Cache-Control", "no-store");
  return res.json({
    card: card ? serializeCard(card, partner) : null,
    review: cancelled ? null : reviewView(review),
    // NoLSAF's reason stays on the admin record; the partner only learns when.
    cancelled: cancelled ? { cardNumber: cancelled.cardNumber, at: cancelled.revokedAt } : null,
    requirements: requirements(partner, contractActive),
    preview,
  });
}));

/** POST /api/sales/id-card: issue, or replace the current card. */
router.post(
  "/id-card",
  blockImpersonated as RequestHandler,
  requireActivePartnerContract,
  limitSalesLeadWrite as any,
  asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
    const partnerId = partnerIdFor(req);
    if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
    const now = new Date();
    const partner = await db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: partnerSelect });
    if (!partner) return res.status(404).json({ error: "Sales partner not found" });
    if (partner.status !== "ACTIVE") return res.status(409).json({ error: "Your partner account must be active to get an ID card." });
    if (!partner.user?.avatarUrl) return res.status(409).json({ error: "Add a clear profile photo of your face first. It is printed on your card." });
    const contract = activeContractFor(partner, now);
    if (!contract) return res.status(409).json({ error: "An active agreement is required for an ID card." });

    // A card NoLSAF cancelled is NoLSAF's to replace, never the partner's.
    if (await cancelledByNoLsaf(partnerId)) {
      return res.status(409).json({ error: "Your card was cancelled by NoLSAF. Contact NoLSAF support about a new card." });
    }
    // The same photo already waiting: nothing new for an admin to check.
    const waiting = await db.salesPartnerCard.findFirst({ where: { salesPartnerId: partnerId, status: CARD_PENDING_REVIEW }, orderBy: { id: "desc" } });
    if (waiting && waiting.photoUrl === partner.user.avatarUrl) {
      return res.status(409).json({ error: "Your card is already waiting for NoLSAF to check the photo." });
    }
    const hadActive = (await db.salesPartnerCard.count({ where: { salesPartnerId: partnerId, status: "ACTIVE" } })) > 0;

    const requested = await requestCard(partnerId, partner, contract, now);

    await audit(req as any, "SALES_PARTNER_CARD_REQUEST", "SALES_PARTNER_CARD", null, {
      cardNumber: requested.card.cardNumber,
      withdrawnRequests: requested.withdrawn,
      replacing: hadActive,
    }, requested.card.id);
    await alertPhotoReview(partner, requested.card, hadActive);
    return res.status(201).json({ review: reviewView(requested.card), replacing: hadActive });
  }),
);

export default router;
