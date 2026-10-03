// Public, read-only verification for a property-issued NRMS Pro Forma.
// The opaque token is a bearer capability embedded in the PDF QR code. It
// exposes only this document and the direct property payment instructions.
import { Router, type RequestHandler, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { limitPublicNrmsGuestCapability } from "../middleware/rateLimit.js";
import { publicProFormaView, renderMasterProFormaPdf, renderProFormaReceiptPdf } from "../lib/nrmsProForma.js";
import { getMasterFolioPayableBalance } from "../lib/nrmsMasterFolio.js";
import {
  AGENCY_SELF_SERVE_DAILY_LIMIT,
  agencyProFormaPayBlocker,
  issueMasterFolioPaymentLink,
  MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES,
  masterFolioPaymentOptions,
  serializeMasterFolioPaymentLink,
} from "../lib/nrmsMasterFolioPaymentLink.js";

export const router = Router();

const capabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};

router.use("/:token", capabilityHeaders, limitPublicNrmsGuestCapability as RequestHandler);

const include = {
  masterFolio: {
    include: {
      payments: { orderBy: { createdAt: "asc" as const } },
      refunds: { orderBy: { createdAt: "asc" as const } },
      block: true,
      agentBookingRequest: { include: { link: { include: { agentAccount: true } } } },
    },
  },
};

async function byToken(token: string) {
  if (!/^[A-Za-z0-9_-]{32,96}$/.test(token)) return null;
  return prisma.nrmsMasterFolioProForma.findUnique({ where: { publicToken: token }, include });
}

function unavailable(res: Response) {
  return res.status(404).json({ error: "This Pro Forma link is not available. Ask the property for a new copy." });
}

/**
 * Whether the agency can start an online payment from this Pro Forma. The
 * amount is never shown here as payable; it is computed when the checkout is
 * created, from the live account.
 */
async function onlinePaymentState(record: any) {
  const blocker = agencyProFormaPayBlocker(record);
  if (blocker) return { available: false, reason: blocker.code, message: blocker.message };
  if (record.masterFolio?.block?.status === "CANCELLED") return { available: false, reason: "CANCELLED", message: "This group booking was cancelled." };
  const { payableBalance } = await getMasterFolioPayableBalance(prisma, record.masterFolioId);
  if (payableBalance <= 0.005) return { available: false, reason: "SETTLED", message: "Nothing is due on this account." };
  const options = await masterFolioPaymentOptions(prisma, { propertyId: record.masterFolio.propertyId, currency: record.currency });
  if (!options.available) return { available: false, reason: "UNAVAILABLE", message: options.message ?? "Online payment is not available for this property." };
  return { available: true, reason: null, message: null, channels: options.channels, amount: payableBalance };
}

router.get("/:token", (async (req, res: Response) => {
  try {
    const record = await byToken(req.params.token);
    if (!record) return unavailable(res);
    await prisma.nrmsMasterFolioProForma.update({
      where: { id: record.id },
      data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
    });
    res.json({ proForma: publicProFormaView(record), onlinePayment: await onlinePaymentState(record) });
  } catch (err) {
    console.error("[public.nrmsProForma] view failed", err);
    res.status(500).json({ error: "The Pro Forma could not be opened" });
  }
}) as RequestHandler);

/**
 * POST /:token/pay-online
 *
 * The agency starts its own three-hour checkout from the Pro Forma it holds,
 * instead of asking the property for a new link. Safe to expose because the
 * amount is always the server's live payable balance, a still-valid link is
 * reused rather than revoked (so repeated clicks never kill each other), an
 * in-flight payment blocks a second one, and each Pro Forma may mint only a
 * few checkouts a day. Links minted here carry createdById = null, which is
 * how the property tells an agency-started payment from its own.
 */
router.post("/:token/pay-online", (async (req, res: Response) => {
  try {
    const record = await byToken(req.params.token);
    if (!record) return unavailable(res);
    const state = await onlinePaymentState(record);
    // An agent may explicitly request a no-money checkout preview while the
    // property's provider setup is incomplete. Business blockers (cancelled,
    // superseded, settled, expired) still apply exactly as they do in live use.
    const preview = req.query.preview === "true" && state.reason === "UNAVAILABLE";
    if (!state.available && !preview) return res.status(409).json({ error: state.message, code: state.reason });
    const amount = state.available ? state.amount! : (await getMasterFolioPayableBalance(prisma, record.masterFolioId)).payableBalance;

    const now = new Date();
    // A live link for the current amount is handed back as is: reuse is free
    // and never counts against the allowance.
    const reusable = await prisma.nrmsMasterFolioPaymentLink.findFirst({
      where: {
        masterFolioId: record.masterFolioId,
        status: { in: MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES },
        expiresAt: { gt: now },
        amount,
        currency: record.currency,
      },
      orderBy: { createdAt: "desc" },
    });
    if (reusable) {
      const paymentLink = serializeMasterFolioPaymentLink(reusable)!;
      return res.status(200).json({ paymentLink: preview ? { ...paymentLink, url: `${paymentLink.url}?preview=1`, testMode: true } : paymentLink });
    }

    const minted = await prisma.nrmsMasterFolioPaymentLink.count({
      where: { masterFolioId: record.masterFolioId, createdById: null, createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
    });
    if (minted >= AGENCY_SELF_SERVE_DAILY_LIMIT) {
      return res.status(429).json({ error: "Too many payment attempts today. Ask the property to send you a payment link.", code: "DAILY_LIMIT" });
    }
    const link = await prisma.$transaction((tx: any) =>
      issueMasterFolioPaymentLink(tx, record.masterFolioId, null, { reuseMatching: true, now }),
    );
    const paymentLink = serializeMasterFolioPaymentLink(link)!;
    res.status(201).json({ paymentLink: preview ? { ...paymentLink, url: `${paymentLink.url}?preview=1`, testMode: true } : paymentLink });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_IN_FLIGHT") {
      return res.status(409).json({ error: "A payment is already awaiting confirmation. Check your phone or wait a few minutes.", code: "PAYMENT_IN_FLIGHT" });
    }
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_COMPLETE") {
      return res.status(409).json({ error: "Nothing is due on this account.", code: "SETTLED" });
    }
    console.error("[public.nrmsProForma] pay online failed", err);
    res.status(500).json({ error: "The payment could not be started. No charge was made." });
  }
}) as RequestHandler);

router.get("/:token/receipt.pdf", (async (req, res: Response) => {
  try {
    const record = await byToken(req.params.token);
    if (!record) return unavailable(res);
    const rendered = await renderProFormaReceiptPdf(record);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${rendered.number}.pdf"`);
    res.send(rendered.pdf);
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_PRO_FORMA_NOT_PAID") {
      return res.status(409).json({ error: "No payment has been received on this Pro Forma yet.", code: "NOT_PAID" });
    }
    console.error("[public.nrmsProForma] receipt PDF failed", err);
    res.status(500).json({ error: "The receipt could not be opened" });
  }
}) as RequestHandler);

router.get("/:token/pdf", (async (req, res: Response) => {
  try {
    const record = await byToken(req.params.token);
    if (!record) return unavailable(res);
    const pdf = await renderMasterProFormaPdf(record);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${record.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[public.nrmsProForma] PDF failed", err);
    res.status(500).json({ error: "The Pro Forma PDF could not be opened" });
  }
}) as RequestHandler);

export default router;
