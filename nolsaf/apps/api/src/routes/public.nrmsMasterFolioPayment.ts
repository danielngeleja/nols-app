import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { CHECKOUT_BANK_CODES } from "../lib/azampay.helpers.js";
import { getMasterFolioPayableBalance } from "../lib/nrmsMasterFolio.js";
import {
  currentAgencyProFormaToken,
  MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES,
  masterFolioPaymentOptions,
} from "../lib/nrmsMasterFolioPaymentLink.js";
import { proFormaVerificationUrl } from "../lib/nrmsProForma.js";
import { limitPublicNrmsGuestCapability } from "../middleware/rateLimit.js";
import { createPaymentIntent } from "../services/payments/intents.js";
import { AzamPayOwnerCollectionAdapter } from "../services/payments/providers/azampayOwner.js";
import { startPaymentAttempt } from "../services/payments/attempts.js";

const router = Router();

const checkoutSchema = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("MNO"), clientRequestId: z.string().uuid(), phoneNumber: z.string().trim().min(9).max(20), mnoProvider: z.enum(["Airtel", "Tigo", "Halopesa", "Azampesa", "Mpesa"]) }),
  z.object({ channel: z.literal("BANK"), clientRequestId: z.string().uuid(), phoneNumber: z.string().trim().min(9).max(20), bankCode: z.enum(CHECKOUT_BANK_CODES), accountNumber: z.string().trim().min(1).max(30).regex(/^[\w-]+$/), otp: z.string().trim().min(1).max(50) }),
]);

const capabilityHeaders: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "private, no-store, max-age=0");
  res.set("Pragma", "no-cache");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  next();
};
router.use("/:token", capabilityHeaders);

const linkInclude = {
  masterFolio: {
    include: {
      property: { select: { id: true, title: true } },
      block: { select: { name: true, reference: true } },
    },
  },
};

async function loadLink(token: string) {
  return prisma.nrmsMasterFolioPaymentLink.findUnique({ where: { publicToken: token }, include: linkInclude });
}

const paymentOptions = (link: any) =>
  masterFolioPaymentOptions(prisma, { propertyId: link.masterFolio.propertyId, currency: link.currency });

// A dead checkout link says why it stopped, and, when the agency still holds
// a Pro Forma in force, where to start a fresh payment without calling anyone.
const DEAD_LINK_REASONS: Record<string, { status: number; error: string }> = {
  MISSING: { status: 404, error: "This payment link is not valid." },
  REVOKED: { status: 404, error: "A newer payment link replaced this one." },
  STALE: { status: 409, error: "The amount due changed after this link was made." },
  BALANCE_CHANGED: { status: 409, error: "The amount due changed after this link was made." },
  EXPIRED: { status: 410, error: "This payment link has expired. Links work for three hours." },
};

async function sendDeadLink(res: Response, code: keyof typeof DEAD_LINK_REASONS, masterFolioId: number | null) {
  const reason = DEAD_LINK_REASONS[code];
  const proFormaToken = masterFolioId ? await currentAgencyProFormaToken(prisma, masterFolioId) : null;
  res.status(reason.status).json({
    error: reason.error,
    code,
    proFormaUrl: proFormaToken ? proFormaVerificationUrl(proFormaToken) : null,
  });
}

async function validateLiveLink(link: any, res: Response) {
  if (!link) {
    await sendDeadLink(res, "MISSING", null);
    return null;
  }
  if (link.status === "REVOKED" || link.status === "STALE") {
    await sendDeadLink(res, link.status, link.masterFolioId);
    return null;
  }
  if (link.status === "PAID") return { link, balance: 0, settled: true };
  if (!MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES.includes(link.status)) {
    await sendDeadLink(res, "EXPIRED", link.masterFolioId);
    return null;
  }
  if (new Date(link.expiresAt).getTime() <= Date.now()) {
    await prisma.nrmsMasterFolioPaymentLink.updateMany({ where: { id: link.id, status: { in: MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES } }, data: { status: "EXPIRED" } });
    await sendDeadLink(res, "EXPIRED", link.masterFolioId);
    return null;
  }
  const { payableBalance } = await getMasterFolioPayableBalance(prisma, link.masterFolioId);
  if (payableBalance <= 0.005) return { link, balance: 0, settled: true };
  if (Math.abs(payableBalance - Number(link.amount)) > 0.005) {
    await prisma.nrmsMasterFolioPaymentLink.updateMany({ where: { id: link.id, status: { in: MASTER_FOLIO_PAYMENT_LINK_LIVE_STATUSES } }, data: { status: "STALE", revokedAt: new Date() } });
    await sendDeadLink(res, "BALANCE_CHANGED", link.masterFolioId);
    return null;
  }
  return { link, balance: payableBalance, settled: false };
}

router.get("/:token", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  try {
    const checked = await validateLiveLink(await loadLink(req.params.token), res);
    if (!checked) return;
    const latestIntent = await prisma.paymentIntent.findFirst({
      where: { sourceType: "NRMS_MASTER_FOLIO", sourceId: checked.link.masterFolioId, createdAt: { gte: checked.link.createdAt } },
      orderBy: { createdAt: "desc" },
      include: { attempts: { orderBy: { startedAt: "desc" }, take: 1, select: { channel: true, normalizedStatus: true } } },
    });
    const liveCheckout = checked.settled ? { available: false, channels: [] as Array<"MNO" | "BANK">, provider: null, message: null } : await paymentOptions(checked.link);
    const testMode = req.query.preview === "1" && !checked.settled && !liveCheckout.available;
    const checkout = testMode
      ? { available: true, channels: ["MNO", "BANK"], provider: "TEST", message: "Checkout preview only. No money will be requested or recorded.", testMode: true }
      : { ...liveCheckout, testMode: false };
    res.json({
      paymentLink: {
        amount: Number(checked.link.amount),
        currency: checked.link.currency,
        status: checked.settled ? "PAID" : checked.link.status,
        expiresAt: checked.link.expiresAt,
        property: checked.link.masterFolio.property.title,
        group: checked.link.masterFolio.block?.name ?? checked.link.masterFolio.billToName,
        folioReference: checked.link.masterFolio.reference,
        // Lets the page offer a restart when this link runs out mid-visit.
        proFormaUrl: await currentAgencyProFormaToken(prisma, checked.link.masterFolioId).then((pfToken) => (pfToken ? proFormaVerificationUrl(pfToken) : null)),
        checkout,
        payment: latestIntent ? {
          reference: latestIntent.reference,
          status: latestIntent.status,
          channel: latestIntent.attempts[0]?.channel ?? null,
          attemptStatus: latestIntent.attempts[0]?.normalizedStatus ?? null,
        } : null,
      },
    });
  } catch (error) {
    console.error("[public.nrmsMasterFolioPayment] load failed", error);
    res.status(500).json({ error: "The payment link could not be loaded" });
  }
}) as RequestHandler);

router.post("/:token/checkout", limitPublicNrmsGuestCapability as RequestHandler, (async (req, res: Response) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Choose a valid payment method" });
  try {
    const checked = await validateLiveLink(await loadLink(req.params.token), res);
    if (!checked) return;
    if (checked.settled) return res.status(409).json({ error: "This account is already settled", code: "PAYMENT_SETTLED" });
    const checkout = await paymentOptions(checked.link);
    const testMode = req.query.preview === "1" && !checkout.available;
    if (testMode) {
      return res.status(202).json({
        payment: { reference: `TEST-${checked.link.id}`, status: "PROCESSING", attemptStatus: "PROCESSING", channel: parsed.data.channel, checkoutUrl: null, testMode: true },
        message: "Test submitted. Simulating provider confirmation; no payment request was sent.",
      });
    }
    if (!checkout.available || !checkout.channels.includes(parsed.data.channel)) return res.status(503).json({ error: checkout.message || "This payment method is not available", code: "ONLINE_PAYMENT_UNAVAILABLE" });

    const inFlight = await prisma.paymentIntent.findFirst({
      where: {
        sourceType: "NRMS_MASTER_FOLIO",
        sourceId: checked.link.masterFolioId,
        createdAt: { gte: checked.link.createdAt },
        status: { in: ["INITIATION_PENDING", "PROCESSING", "STATUS_UNKNOWN", "SUCCEEDED"] },
      },
      select: { status: true, reference: true },
    });
    if (inFlight) return res.status(409).json({ error: inFlight.status === "SUCCEEDED" ? "This payment is already complete" : "A payment is already awaiting confirmation", code: "PAYMENT_IN_FLIGHT" });
    const claimed = await prisma.nrmsMasterFolioPaymentLink.updateMany({
      where: { id: checked.link.id, status: "ACTIVE", expiresAt: { gt: new Date() } },
      data: { status: "PROCESSING" },
    });
    if (claimed.count !== 1) return res.status(409).json({ error: "A payment is already awaiting confirmation", code: "PAYMENT_IN_FLIGHT" });

    const created = await createPaymentIntent(prisma, {
      propertyId: checked.link.masterFolio.propertyId,
      purpose: "MASTER_FOLIO",
      sourceType: "NRMS_MASTER_FOLIO",
      sourceId: checked.link.masterFolioId,
      channel: parsed.data.channel,
      amount: String(checked.link.amount),
      currency: checked.link.currency,
      idempotencyKey: `nrms-master-link:${checked.link.id}:${parsed.data.clientRequestId}`,
      expiresAt: checked.link.expiresAt,
    });
    if (!created.ok) {
      await prisma.nrmsMasterFolioPaymentLink.updateMany({ where: { id: checked.link.id, status: "PROCESSING" }, data: { status: "ACTIVE" } });
      return res.status(503).json({ error: created.message, code: created.code });
    }

    const connection = await prisma.providerConnection.findUnique({ where: { id: created.connectionId }, select: { provider: true, environment: true, capabilities: true } });
    if (!connection || connection.provider !== "AZAMPAY" || !["SANDBOX", "STAGING", "PRODUCTION"].includes(connection.environment)) {
      await prisma.nrmsMasterFolioPaymentLink.updateMany({ where: { id: checked.link.id, status: "PROCESSING" }, data: { status: "ACTIVE" } });
      return res.status(503).json({ error: "The selected payment connection is unavailable", code: "PROVIDER_UNAVAILABLE" });
    }
    const adapter = new AzamPayOwnerCollectionAdapter({ environment: connection.environment as "SANDBOX" | "STAGING" | "PRODUCTION", capabilities: connection.capabilities });
    const attempt = await startPaymentAttempt(prisma, adapter, {
      intentId: created.intentId,
      channel: parsed.data.channel,
      payerReference: parsed.data.phoneNumber,
      metadata: parsed.data.channel === "MNO"
        ? { mnoProvider: parsed.data.mnoProvider, masterFolioId: String(checked.link.masterFolioId), paymentLinkId: String(checked.link.id) }
        : { bankCode: parsed.data.bankCode, bankAccountNumber: parsed.data.accountNumber, otp: parsed.data.otp, merchantName: checked.link.masterFolio.property.title, masterFolioId: String(checked.link.masterFolioId), paymentLinkId: String(checked.link.id) },
    });
    if (!attempt.ok) {
      if (attempt.code !== "attempt_in_flight") await prisma.nrmsMasterFolioPaymentLink.updateMany({ where: { id: checked.link.id, status: "PROCESSING" }, data: { status: "ACTIVE" } });
      return res.status(attempt.code === "attempt_in_flight" ? 409 : 502).json({ error: attempt.message, code: attempt.code });
    }
    if (attempt.status === "FAILED") {
      await prisma.nrmsMasterFolioPaymentLink.updateMany({ where: { id: checked.link.id, status: "PROCESSING" }, data: { status: "ACTIVE" } });
      return res.status(502).json({ error: "The provider did not accept this payment. No charge has been confirmed.", code: "PAYMENT_NOT_ACCEPTED" });
    }
    res.status(202).json({
      payment: { reference: created.reference, status: attempt.intentStatus, attemptStatus: attempt.status, channel: parsed.data.channel, checkoutUrl: attempt.checkoutUrl ?? null },
      message: parsed.data.channel === "MNO" ? "Approve the payment prompt on your phone." : "Your bank payment was submitted for confirmation.",
    });
  } catch (error) {
    console.error("[public.nrmsMasterFolioPayment] checkout failed", error instanceof Error ? error.message : error);
    res.status(502).json({ error: "The payment could not be started. No charge has been confirmed." });
  }
}) as RequestHandler);

export default router;
