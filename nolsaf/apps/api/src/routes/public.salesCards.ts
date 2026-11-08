/**
 * Public, no-login check of a sales partner ID card.
 *
 * GET /api/public/sales-cards/:token        from the QR code
 * GET /api/public/sales-cards/code/:code    typed card code
 *
 * A property owner uses this to confirm the person in front of them. Unknown
 * tokens and codes all get the same 404, so the endpoint cannot be used as a
 * directory; a tight per-IP limit caps guessing. A known card that is no longer
 * valid still shows who it belonged to, so the owner knows not to deal with
 * them. Partner contact details are never returned.
 */
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import {
  CARD_VALIDITY_TEXT,
  cardValidity,
  checkSegmentMatches,
  hashCardToken,
  parseCardCode,
} from "../lib/salesPartnerCard.js";

const router = Router();
const db = prisma as any;

const lookupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many checks. Please wait a moment and try again." },
});

const NOT_FOUND = { ok: false as const, error: "This card could not be found. It may be fake: do not share information with this person." };

const cardSelect = {
  id: true,
  salt: true,
  cardNumber: true,
  photoUrl: true,
  status: true,
  issuedAt: true,
  expiresAt: true,
  salesPartner: {
    select: {
      agentCode: true,
      status: true,
      region: true,
      territory: true,
      user: { select: { name: true, fullName: true, suspendedAt: true, isDisabled: true } },
      contracts: { select: { status: true, startsAt: true, expiresAt: true }, orderBy: { expiresAt: "desc" as const }, take: 5 },
      ledTeam: { select: { status: true } },
    },
  },
};

async function respond(card: any, res: any) {
  const partner = card.salesPartner;
  // A suspended or disabled NoLSAF account cannot represent NoLSAF, whatever
  // the sales profile says.
  const accountBlocked = Boolean(partner.user?.suspendedAt || partner.user?.isDisabled);
  const validity = cardValidity({ card, partnerStatus: accountBlocked ? "SUSPENDED" : partner.status, contracts: partner.contracts });
  if (validity === "VALID") {
    await db.salesPartnerCard.update({
      where: { id: card.id },
      data: { verifyCount: { increment: 1 }, lastVerifiedAt: new Date() },
    }).catch(() => undefined);
  }
  // Never cached: the answer must be live at the moment the owner looks.
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  return res.json({
    ok: true,
    card: {
      valid: validity === "VALID",
      validity,
      message: CARD_VALIDITY_TEXT[validity],
      name: partner.user?.fullName || partner.user?.name || "NoLSAF representative",
      photoUrl: card.photoUrl,
      agentCode: partner.agentCode,
      cardNumber: card.cardNumber,
      region: partner.region || null,
      territory: partner.territory || null,
      // Shown only on a valid card, so a lapsed card never claims a role.
      teamLead: validity === "VALID" && partner.ledTeam?.status === "ACTIVE",
      issuedAt: card.issuedAt,
      expiresAt: card.expiresAt,
      checkedAt: new Date().toISOString(),
    },
  });
}

router.get("/code/:code", lookupLimiter, async (req, res) => {
  const parsed = parseCardCode(String(req.params.code || ""));
  if (!parsed) return res.status(404).json(NOT_FOUND);
  try {
    const card = await db.salesPartnerCard.findUnique({ where: { cardNumber: parsed.cardNumber }, select: cardSelect });
    if (!card || !checkSegmentMatches(card, parsed.check)) return res.status(404).json(NOT_FOUND);
    return await respond(card, res);
  } catch {
    return res.status(404).json(NOT_FOUND);
  }
});

router.get("/:token", lookupLimiter, async (req, res) => {
  const token = String(req.params.token || "").trim();
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(404).json(NOT_FOUND);
  try {
    const card = await db.salesPartnerCard.findUnique({ where: { tokenHash: hashCardToken(token) }, select: cardSelect });
    if (!card) return res.status(404).json(NOT_FOUND);
    return await respond(card, res);
  } catch {
    return res.status(404).json(NOT_FOUND);
  }
});

export default router;
