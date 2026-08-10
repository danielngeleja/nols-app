import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { requireNrms, loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { getAzamPayToken, invalidateAzamPayToken } from "../lib/azampay.auth.js";
import {
  azampayMnoPost,
  describeAzamPayResponseBody,
  idemGet,
  idemSet,
  makePaymentRateLimiter,
  normalizePhone,
  CHECKOUT_BANK_CODES,
} from "../lib/azampay.helpers.js";
import { coralPostJson64, parseCoralInitiateResponse } from "../lib/coralcommerce.helpers.js";
import { getPaymentMethodAvailability } from "../lib/serviceAvailability.js";
import crypto from "crypto";

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const nrmsPaymentLimiter = makePaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  keyFn: (req: any) => `nrms-payment:${req.user?.id || req.ip}:${String(req.params?.token || "unknown").slice(-16)}`,
});

const initiatePaymentSchema = z.discriminatedUnion("channel", [
  z.object({
    channel: z.literal("MNO"),
    phoneNumber: z.string().min(9).max(15),
    provider: z.enum(["Airtel", "Mixx", "M-Pesa", "HaloPesa"]),
    idempotencyKey: z.string().min(8).max(128).optional(),
  }),
  z.object({
    channel: z.literal("BANK"),
    bankCode: z.enum(CHECKOUT_BANK_CODES),
    accountNumber: z.string().min(1).max(30).regex(/^[\w-]+$/),
    merchantMobileNumber: z.string().min(9).max(15),
    otp: z.string().min(1).max(50),
    idempotencyKey: z.string().min(8).max(128).optional(),
  }),
  z.object({
    channel: z.literal("CARD"),
    idempotencyKey: z.string().min(8).max(128).optional(),
  }),
]);

function appendParams(url: string, params: Record<string, string>): string {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) parsed.searchParams.set(key, value);
  return parsed.toString();
}

function requiredNrmsCoralConfig() {
  const username = process.env.CORAL_UCF_USERNAME;
  const password = process.env.CORAL_UCF_PASSWORD;
  const alias = process.env.CORAL_UCF_ALIAS;
  const callbackUrl = process.env.CORAL_UCF_CALLBACK_URL;
  const successUrl = process.env.CORAL_UCF_POSTBACK_SUCCESS_URL;
  const failureUrl = process.env.CORAL_UCF_POSTBACK_FAILURE_URL || successUrl;
  if (!username || !password || !alias || !callbackUrl || !successUrl || !failureUrl) return null;
  return { username, password, alias, callbackUrl, successUrl, failureUrl };
}

async function markNrmsTokenProcessing(row: any, method: string, checkoutSessionId?: string) {
  await prisma.$transaction([
    (prisma as any).nrmsServicePaymentToken.update({
      where: { id: row.id },
      data: { method, status: "PROCESSING", ...(checkoutSessionId ? { checkoutSessionId } : {}) },
    }),
    (prisma as any).ownerPaygAccount.update({ where: { id: row.statement.accountId }, data: { status: "PAYMENT_PENDING" } }),
  ]);
}

async function recordNrmsInitiation(input: { row: any; eventId: string; channel: string; provider: string; phone?: string; checkoutUrl?: string }) {
  try {
    await (prisma as any).paymentEvent.upsert({
      where: { eventId: input.eventId },
      update: { status: "PENDING", checkoutUrl: input.checkoutUrl ?? undefined },
      create: {
        provider: input.provider,
        eventId: input.eventId,
        amount: Number(input.row.amount),
        currency: input.row.currency,
        status: "PENDING",
        paymentChannel: input.channel,
        phone: input.phone,
        checkoutUrl: input.checkoutUrl,
        payload: { nrmsToken: input.row.token, statementId: input.row.statementId, paymentRef: input.row.token },
      },
    });
  } catch (error: any) {
    console.warn("[NRMS payment] Could not record initiation event:", error?.message ?? error);
  }
}

router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  const ownerId = req.user!.id;
  const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
  if (!active) return;
  const account = await (prisma as any).ownerPaygAccount.findUnique({
    where: { propertyId: active.property.id }, include: {
      policy: true,
      events: { orderBy: [{ serviceDate: "desc" }, { id: "desc" }], take: 500, include: { reservation: { select: { source: true, guestProfile: { select: { fullName: true } } } }, allocation: { include: { roomUnit: { select: { code: true } }, roomType: { select: { name: true } } } } } },
      statements: { orderBy: { id: "desc" }, include: { tokens: { orderBy: { id: "desc" } }, _count: { select: { items: true } } } },
    },
  });
  res.json({ account });
}) as RequestHandler);

const methodSchema = z.object({ method: z.enum(["MOBILE_MONEY", "CARD", "BANK"]) });
router.post("/tokens/:token/declare", (async (req: AuthedRequest, res: Response) => {
  const parsed = methodSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Select a supported payment method" });
  const row = await (prisma as any).nrmsServicePaymentToken.findFirst({
    where: { token: req.params.token, statement: { account: { ownerId: req.user!.id } } }, include: { statement: true, payment: true },
  });
  if (!row) return res.status(404).json({ error: "Payment token not found" });
  if (row.status === "PAID" || row.payment) return res.status(409).json({ error: "Payment token is already paid" });
  if (String(row.statement.status).toUpperCase() !== "PAYABLE") return res.status(409).json({ error: "This statement is no longer payable" });
  if (!["PENDING", "PROCESSING", "FAILED"].includes(String(row.status).toUpperCase())) {
    return res.status(409).json({ error: "This payment token is no longer usable. Generate a new token." });
  }
  if (row.expiresAt <= new Date()) {
    await (prisma as any).nrmsServicePaymentToken.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    return res.status(409).json({ error: "Payment token has expired. Generate a new token." });
  }
  const current = await (prisma as any).nrmsServicePaymentToken.findFirst({
    where: { statementId: row.statementId, status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { gt: new Date() } },
    orderBy: { id: "desc" },
  });
  if (current && current.id !== row.id) return res.status(409).json({ error: "A newer payment token is active for this statement" });
  const token = await (prisma as any).nrmsServicePaymentToken.update({ where: { id: row.id }, data: { method: parsed.data.method, status: "PROCESSING" } });
  await (prisma as any).ownerPaygAccount.update({ where: { id: row.statement.accountId }, data: { status: "PAYMENT_PENDING" } });
  res.json({ token });
}) as RequestHandler);

router.post("/tokens/:token/initiate", nrmsPaymentLimiter, (async (req: AuthedRequest, res: Response) => {
  const parsed = initiatePaymentSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payment details", details: parsed.error.flatten() });

  const row = await (prisma as any).nrmsServicePaymentToken.findFirst({
    where: { token: req.params.token, statement: { account: { ownerId: req.user!.id } } },
    include: {
      statement: {
        include: {
          account: {
            include: {
              owner: { select: { name: true, fullName: true, email: true, phone: true } },
              property: { select: { id: true, title: true } },
            },
          },
        },
      },
      payment: true,
    },
  });
  if (!row) return res.status(404).json({ error: "Payment token not found" });
  if (row.payment || row.status === "PAID") return res.status(409).json({ error: "This statement is already paid" });
  if (String(row.statement.status).toUpperCase() !== "PAYABLE") return res.status(409).json({ error: "This statement is no longer payable" });
  if (!["PENDING", "PROCESSING", "FAILED"].includes(String(row.status).toUpperCase())) {
    return res.status(409).json({ error: "This payment token is no longer usable. Generate a new token." });
  }
  if (row.expiresAt <= new Date()) {
    await (prisma as any).nrmsServicePaymentToken.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
    return res.status(409).json({ error: "Payment token has expired. Generate a new token." });
  }
  const current = await (prisma as any).nrmsServicePaymentToken.findFirst({
    where: { statementId: row.statementId, status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { gt: new Date() } },
    orderBy: { id: "desc" },
  });
  if (current && current.id !== row.id) return res.status(409).json({ error: "A newer payment token is active for this statement" });

  const amount = Math.round(Number(row.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(409).json({ error: "This statement has no payable amount" });
  const input = parsed.data;
  const idemKey = input.idempotencyKey ? `nrms:${req.user!.id}:${row.id}:${input.idempotencyKey}` : null;
  if (idemKey) {
    const cached = await idemGet(idemKey);
    if (cached) return res.json({ ok: true, cached: true, ...cached });
  }

  try {
    if (input.channel === "MNO") {
      const normalizedPhone = normalizePhone(input.phoneNumber);
      if (!normalizedPhone) return res.status(400).json({ error: "Enter a valid Tanzanian mobile number" });
      const provider = ({ Mixx: "Tigo", "M-Pesa": "Mpesa", HaloPesa: "Halopesa", Airtel: "Airtel" } as const)[input.provider];
      const gate = await getPaymentMethodAvailability(provider);
      if (!gate.enabled) return res.status(400).json({ error: "payment_method_unavailable", message: gate.reason });
      const payload = {
        accountNumber: normalizedPhone.replace(/^\+/, ""),
        amount,
        currency: row.currency,
        externalId: row.token,
        provider,
        additionalProperties: { nrmsToken: row.token, nrmsStatementId: row.statementId },
      };
      let authToken = await getAzamPayToken();
      let providerResponse = await azampayMnoPost("/azampay/mno/checkout", payload, authToken);
      if (providerResponse.status === 401) {
        await invalidateAzamPayToken();
        authToken = await getAzamPayToken();
        providerResponse = await azampayMnoPost("/azampay/mno/checkout", payload, authToken);
      }
      if (!providerResponse.ok) return res.status(502).json({ error: "Mobile Money prompt could not be initiated" });
      const summary = describeAzamPayResponseBody(providerResponse.body);
      let transactionId = summary.transactionId;
      const body = providerResponse.body.trim();
      if (body && !/^https?:\/\//i.test(body)) {
        try {
          const providerData = JSON.parse(body);
          if (providerData.success === false) return res.status(502).json({ error: providerData.message || "Mobile Money prompt was rejected" });
          transactionId = providerData.transactionId ?? transactionId;
        } catch {
          return res.status(502).json({ error: "Unexpected response from Mobile Money provider" });
        }
      }
      const eventId = String(transactionId || `${row.token}-${Date.now()}`);
      await recordNrmsInitiation({ row, eventId, channel: "MNO", provider: "AZAMPAY", phone: normalizedPhone });
      await markNrmsTokenProcessing(row, "MOBILE_MONEY", eventId);
      const result = { status: "PENDING", transactionId: eventId, paymentRef: row.token, message: "Payment prompt sent to your phone" };
      if (idemKey) await idemSet(idemKey, result);
      return res.json({ ok: true, ...result });
    }

    if (input.channel === "BANK") {
      const gate = await getPaymentMethodAvailability(`BANK_${input.bankCode}`);
      if (!gate.enabled) return res.status(400).json({ error: "payment_method_unavailable", message: gate.reason });
      const normalizedPhone = normalizePhone(input.merchantMobileNumber);
      if (!normalizedPhone) return res.status(400).json({ error: "Enter a valid Tanzanian mobile number" });
      const payload = {
        amount,
        currencyCode: row.currency,
        merchantAccountNumber: input.accountNumber,
        merchantMobileNumber: normalizedPhone.replace(/^\+/, ""),
        merchantName: process.env.AZAMPAY_APP_NAME || "NoLSAF",
        otp: input.otp,
        provider: input.bankCode,
        referenceId: row.token,
        additionalProperties: { nrmsToken: row.token, nrmsStatementId: row.statementId },
      };
      let authToken = await getAzamPayToken();
      let providerResponse = await azampayMnoPost("/azampay/bank/checkout", payload, authToken);
      if (providerResponse.status === 401) {
        await invalidateAzamPayToken();
        authToken = await getAzamPayToken();
        providerResponse = await azampayMnoPost("/azampay/bank/checkout", payload, authToken);
      }
      if (!providerResponse.ok) return res.status(502).json({ error: "Bank payment could not be initiated" });
      let providerData: any;
      try { providerData = JSON.parse(providerResponse.body); }
      catch { return res.status(502).json({ error: "Unexpected response from bank provider" }); }
      if (providerData.success === false) return res.status(502).json({ error: providerData.message || "Bank payment was rejected" });
      const eventId = String(providerData.transactionId || `${row.token}-${Date.now()}`);
      await recordNrmsInitiation({ row, eventId, channel: "BANK", provider: "AZAMPAY", phone: normalizedPhone });
      await markNrmsTokenProcessing(row, "BANK", eventId);
      const result = { status: "PENDING", transactionId: eventId, paymentRef: row.token, message: "Bank payment request submitted" };
      if (idemKey) await idemSet(idemKey, result);
      return res.json({ ok: true, ...result });
    }

    const cardGate = await getPaymentMethodAvailability("CARD");
    if (!cardGate.enabled) return res.status(400).json({ error: "payment_method_unavailable", message: cardGate.reason });
    const config = requiredNrmsCoralConfig();
    if (!config) return res.status(503).json({ error: "Card payments are not configured" });
    const postbackParams = { kind: "nrms", propertyId: String(row.statement.account.propertyId) };
    const paymentRef = row.token;
    const owner = row.statement.account.owner;
    const description = `NRMS statement #${row.statementId} · ${row.statement.account.property.title}`.slice(0, 100);
    const coralPayload = {
      Transaction: {
        Version: "3.16",
        Username: config.username,
        Password: config.password,
        Destination: "ucfurl",
        Submission: { Number: 1, Stamp: paymentRef.slice(0, 40) },
        Identifier: paymentRef,
        Alias: config.alias,
        Currency: row.currency,
        Order: {
          Products: [{ ID: 1, Code: "NRMS", Description: description, Price: amount, Quantity: 1, VAT: 0, SubTotal: amount }],
          Delivery: { Auto: true },
          ProductTotal: amount,
        },
        UCF: {
          CustomerFullName: String(owner.fullName || owner.name || "NoLSAF Owner").slice(0, 100),
          CustomerEmail: String(owner.email || "").slice(0, 255),
          CustomerMobile: String(owner.phone || "").slice(0, 40),
          CallbackUrl: config.callbackUrl,
          CallbackFormat: "json",
          CallbackMethod: "post",
          CallbackVar: "UCFCallback",
          TransactionType: "03",
          PostBackSuccessUrl: appendParams(config.successUrl, postbackParams),
          PostBackFailureUrl: appendParams(config.failureUrl, postbackParams),
          DisplayOrderSummary: "true",
        },
      },
    };
    const providerResponse = await coralPostJson64(coralPayload);
    if (!providerResponse.ok) return res.status(502).json({ error: "Card checkout could not be initiated" });
    const providerData = parseCoralInitiateResponse(providerResponse.body);
    if (providerData.code !== "000" || !providerData.redirectUrl) return res.status(502).json({ error: providerData.message || "Card checkout was rejected" });
    await recordNrmsInitiation({ row, eventId: `${paymentRef}-INIT`, channel: "CARD", provider: "CORALCOMMERCE", checkoutUrl: providerData.redirectUrl.slice(0, 2048) });
    await markNrmsTokenProcessing(row, "CARD");
    const result = { status: "PENDING", transactionId: paymentRef, paymentRef, checkoutUrl: providerData.redirectUrl };
    if (idemKey) await idemSet(idemKey, result);
    return res.json({ ok: true, ...result });
  } catch (error: any) {
    console.error("[NRMS payment] initiation failed:", error?.message ?? error);
    return res.status(503).json({ error: "Payment service is temporarily unavailable" });
  }
}) as RequestHandler);

router.post("/:propertyId/token", (async (req: AuthedRequest, res: Response) => {
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
  if (!active) return;
  if (Number(active.account.unpaidBalance) <= 0) return res.status(409).json({ error: "There is no outstanding NRMS usage to settle" });
  const token = await prisma.$transaction(async (tx: any) => {
    await tx.nrmsServicePaymentToken.updateMany({
      where: {
        statement: { accountId: active.account.id, status: "PAYABLE" },
        status: { in: ["PENDING", "PROCESSING"] },
        expiresAt: { lte: new Date() },
      },
      data: { status: "EXPIRED" },
    });
    const existing = await tx.nrmsServicePaymentToken.findFirst({ where: { statement: { accountId: active.account.id, status: "PAYABLE" }, status: { in: ["PENDING", "PROCESSING"] }, expiresAt: { gt: new Date() } }, orderBy: { id: "desc" } });
    if (existing) return existing;
    const payableStatement = await tx.nrmsBillingStatement.findFirst({
      where: { accountId: active.account.id, status: "PAYABLE" },
      orderBy: { id: "desc" },
    });
    if (payableStatement) {
      await tx.nrmsServicePaymentToken.updateMany({
        where: { statementId: payableStatement.id, status: { in: ["FAILED", "EXPIRED"] } },
        data: { status: "VOID" },
      });
      return tx.nrmsServicePaymentToken.create({
        data: {
          statementId: payableStatement.id,
          token: `NRMS-${crypto.randomBytes(18).toString("hex").toUpperCase()}`,
          amount: payableStatement.amount,
          currency: payableStatement.currency,
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
      });
    }
    const [events, policy] = await Promise.all([
      tx.nrmsUsageEvent.findMany({ where: { accountId: active.account.id, amount: { gt: 0 }, statementItem: null }, select: { id: true, amount: true } }),
      tx.nrmsUsageChargePolicy.findUnique({ where: { id: active.account.policyId }, select: { currency: true } }),
    ]);
    if (!events.length) return null;
    if (!policy?.currency) throw new Error("NRMS_BILLING_CURRENCY_NOT_CONFIGURED");
    const amount = events.reduce((sum: number, row: any) => sum + Number(row.amount), 0);
    const currency = policy.currency.toUpperCase();
    const statement = await tx.nrmsBillingStatement.create({ data: { accountId: active.account.id, amount, currency } });
    await tx.nrmsBillingStatementItem.createMany({ data: events.map((row: any) => ({ statementId: statement.id, usageEventId: row.id, amount: row.amount })) });
    return tx.nrmsServicePaymentToken.create({ data: { statementId: statement.id, token: `NRMS-${crypto.randomBytes(18).toString("hex").toUpperCase()}`, amount, currency, expiresAt: new Date(Date.now() + 7 * 86400000) } });
  });
  if (!token) return res.status(409).json({ error: "No unbilled usage is available" });
  res.status(201).json({ token });
}) as RequestHandler);

export default router;
