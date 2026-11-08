/**
 * The sales partner's own ID card.
 *
 * GET  /api/sales/id-card  current card (with its verify link and code) or what is missing
 * POST /api/sales/id-card  issue a card, or replace the current one (lost phone, new photo)
 *
 * Issuing needs an active partner, a current contract and a profile photo.
 * The photo is copied onto the card at that moment.
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
import {
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

/** Issue a new card (replacing any active one). Caller has checked the requirements. */
async function issueCard(partnerId: number, partner: any, contract: any, now: Date) {
  return db.$transaction(async (tx: any) => {
    const replaced = await tx.salesPartnerCard.updateMany({
      where: { salesPartnerId: partnerId, status: "ACTIVE" },
      data: { status: "REPLACED", activeKey: null, revokedAt: now, revokeReason: "Replaced by a new card" },
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
        status: "ACTIVE",
        activeKey: partnerId,
        issuedAt: now,
        expiresAt: cardExpiry(contract.expiresAt, now),
      },
    });
    const final = await tx.salesPartnerCard.update({
      where: { id: created.id },
      data: { tokenHash: hashCardToken(cardToken(created)) },
    });
    return { card: final, replaced: replaced.count };
  });
}

/** GET /api/sales/id-card */
router.get("/id-card", limitSalesLeadRead as any, asyncHandler(async (req: SalesAuthedRequest, res: Response) => {
  const partnerId = partnerIdFor(req);
  if (!partnerId) return res.status(403).json({ error: "Sales partner context required" });
  const partner = await db.salesPartnerProfile.findUnique({ where: { id: partnerId }, select: partnerSelect });
  if (!partner) return res.status(404).json({ error: "Sales partner not found" });
  let card = await db.salesPartnerCard.findFirst({ where: { salesPartnerId: partnerId, status: "ACTIVE" } });
  // First card only: a partner who meets every requirement gets it the moment
  // they open the page, instead of hunting for a button. Never during an admin
  // support session, and never again once any card exists (replacing stays a
  // deliberate tap, because it cancels the old code).
  if (!card && !(req as any).user?.imp && partner.status === "ACTIVE" && partner.user?.avatarUrl) {
    const now = new Date();
    const contract = activeContractFor(partner, now);
    const everIssued = contract ? await db.salesPartnerCard.count({ where: { salesPartnerId: partnerId } }) : 1;
    if (contract && everIssued === 0) {
      try {
        const issued = await issueCard(partnerId, partner, contract, now);
        card = issued.card;
        await audit(req as any, "SALES_PARTNER_CARD_ISSUE", "SALES_PARTNER_CARD", null, { cardNumber: card.cardNumber, automatic: true }, card.id);
      } catch (error: any) {
        // Two tabs at once: the unique active key lets one win; read the winner.
        if (error?.code !== "P2002") throw error;
        card = await db.salesPartnerCard.findFirst({ where: { salesPartnerId: partnerId, status: "ACTIVE" } });
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

    const card = await issueCard(partnerId, partner, contract, now);

    await audit(req as any, "SALES_PARTNER_CARD_ISSUE", "SALES_PARTNER_CARD", null, {
      cardNumber: card.card.cardNumber,
      replacedCards: card.replaced,
    }, card.card.id);
    return res.status(201).json({ card: serializeCard(card.card, partner) });
  }),
);

export default router;
