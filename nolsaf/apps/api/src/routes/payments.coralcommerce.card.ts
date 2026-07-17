/**
 * CoralCommerce Hosted Card Checkout Routes
 *
 * UCF is a hosted checkout flow. We submit a Base64 JSON message as `json64`,
 * receive a hosted RedirectUrl, and rely on encrypted callback/postback
 * notifications to finalize the invoice.
 */

import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { computeDraftBookingAvailability, unavailableDraftPaymentResponse } from "../lib/draftBookingAvailability.js";
import {
  idemGet,
  idemSet,
} from "../lib/azampay.helpers.js";
import {
  CORAL_UCF_API_URL,
  coralPostJson64,
  makeCoralRateLimiter,
  parseCoralEncryptedJson,
  parseCoralInitiateResponse,
} from "../lib/coralcommerce.helpers.js";
import { markInvoicePaid, markGroupBookingDepositPaid, markTourBookingPaid } from "./webhooks.payments.js";
import { markNrmsPaymentFailed, reconcileNrmsPayment } from "../lib/nrmsBilling.js";

const router = Router();
const coralFormParser = multer().none();

const coralUserLimiter = makeCoralRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  keyFn: (req: any) => String(req.user?.id || req.ip || "anon"),
});

const coralTargetLimiter = makeCoralRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit: 3,
  keyFn: (req: any) => {
    const invoiceId = req.body?.invoiceId ?? "unknown";
    const user = req.user?.id || req.ip || "anon";
    return `coral-card:${user}:${invoiceId}`;
  },
});

export const coralCardInitiateSchema = z.object({
  invoiceId: z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  accessToken: z.string().min(20).max(1024).optional(),
});

type PublicInvoiceAccessPayload = {
  typ: "PUBLIC_INVOICE_ACCESS";
  invoiceId: number;
  bookingId: number;
};

function getPublicInvoiceAccessSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");
  if (!secret) throw new Error("public_invoice_access_secret_missing");
  return secret;
}

function verifyPublicInvoiceAccessToken(
  token: string | undefined,
  invoiceId: number,
  bookingId: number
): boolean {
  if (!token) return false;
  try {
    const decoded = jwt.verify(token, getPublicInvoiceAccessSecret(), {
      issuer: "nolsaf-public",
    }) as PublicInvoiceAccessPayload;
    return (
      decoded?.typ === "PUBLIC_INVOICE_ACCESS" &&
      Number(decoded.invoiceId) === invoiceId &&
      Number(decoded.bookingId) === bookingId
    );
  } catch {
    return false;
  }
}

function requiredCoralConfig(): { username: string; password: string; alias: string; callbackUrl: string; successUrl: string; failureUrl: string } | null {
  const username = process.env.CORAL_UCF_USERNAME;
  const password = process.env.CORAL_UCF_PASSWORD;
  const alias = process.env.CORAL_UCF_ALIAS;
  const callbackUrl = process.env.CORAL_UCF_CALLBACK_URL;
  const successUrl = process.env.CORAL_UCF_POSTBACK_SUCCESS_URL;
  const failureUrl = process.env.CORAL_UCF_POSTBACK_FAILURE_URL || successUrl;

  const missing = [
    !username && "CORAL_UCF_USERNAME",
    !password && "CORAL_UCF_PASSWORD",
    !alias && "CORAL_UCF_ALIAS",
    !callbackUrl && "CORAL_UCF_CALLBACK_URL",
    !successUrl && "CORAL_UCF_POSTBACK_SUCCESS_URL",
  ].filter(Boolean);

  if (missing.length) {
    console.error(`[CoralCommerce/Card] Missing env var(s): ${missing.join(", ")}`);
    return null;
  }

  return { username: username!, password: password!, alias: alias!, callbackUrl: callbackUrl!, successUrl: successUrl!, failureUrl: failureUrl! };
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function appendQueryParams(url: string, params: Record<string, string | undefined>): string {
  const cleanParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) cleanParams.set(key, value);
  }
  const query = cleanParams.toString();
  if (!query) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function buildCoralOrder(params: {
  invoice: any;
  amount: number;
  currency: string;
  paymentRef: string;
  config: NonNullable<ReturnType<typeof requiredCoralConfig>>;
}) {
  const { invoice, amount, currency, paymentRef, config } = params;
  const booking = invoice.booking;
  const title = booking?.property?.title || `NoLSAF booking invoice ${invoice.id}`;
  const guestName = booking?.guestName || booking?.user?.name || "NoLSAF Guest";
  const guestEmail = booking?.guestEmail || booking?.user?.email || "";
  const guestPhone = booking?.guestPhone || booking?.user?.phone || "";

  return {
    Transaction: {
      Version: "3.16",
      Username: config.username,
      Password: config.password,
      Destination: "ucfurl",
      Submission: {
        Number: 1,
        Stamp: truncate(paymentRef, 40),
      },
      Identifier: paymentRef,
      Alias: config.alias,
      Currency: currency,
      Order: {
        Products: [
          {
            ID: 1,
            Code: "BOOKING",
            Description: truncate(title, 100),
            Price: Math.round(amount),
            Quantity: 1,
            VAT: 0,
            SubTotal: Math.round(amount),
          },
        ],
        Delivery: {
          Auto: true,
        },
        ProductTotal: Math.round(amount),
      },
      UCF: {
        CustomerFullName: truncate(String(guestName || ""), 100),
        CustomerEmail: truncate(String(guestEmail || ""), 255),
        CustomerMobile: truncate(String(guestPhone || ""), 40),
        CallbackUrl: config.callbackUrl,
        CallbackFormat: "json",
        CallbackMethod: "post",
        CallbackVar: "UCFCallback",
        TransactionType: "03",
        PostBackSuccessUrl: config.successUrl,
        PostBackFailureUrl: config.failureUrl,
        DisplayOrderSummary: "true",
      },
    },
  };
}

function resolveCoralCurrency(invoiceCurrency?: string | null): "TZS" | "USD" {
  const currency = String(invoiceCurrency || "").trim().toUpperCase();
  if (currency === "TZS" || currency === "USD") return currency;

  const fallback = String(process.env.CORAL_UCF_CURRENCY || "").trim().toUpperCase();
  if (fallback === "TZS" || fallback === "USD") return fallback;

  return "TZS";
}

router.post("/initiate", requireAuth, coralUserLimiter, coralTargetLimiter, async (req, res) => {
  try {
    const parsed = coralCardInitiateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }

    const { invoiceId, idempotencyKey, accessToken } = parsed.data;
    const config = requiredCoralConfig();
    if (!config) {
      return res.status(503).json({ error: "payment_unavailable", message: "Card payments are not configured" });
    }

    const idemKey = idempotencyKey ?? `coral-card-${invoiceId}`;
    const cachedCheckout = await idemGet(idemKey);

    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        booking: {
          include: {
            property: { select: { id: true, title: true, currency: true, status: true, roomsSpec: true, totalBedrooms: true } },
            user: { select: { id: true, name: true, email: true, phone: true } },
          },
        },
      },
    });
    if (!invoice) return res.status(404).json({ error: "not_found", message: "Invoice not found" });

    const authedUserId = Number((req as any).user?.id);
    const bookingId = Number(invoice.bookingId || invoice.booking?.id || 0);
    const bookingUserId = invoice.booking?.userId ? Number(invoice.booking.userId) : null;
    const hasPublicAccess = verifyPublicInvoiceAccessToken(accessToken, invoice.id, bookingId);

    if (bookingUserId && bookingUserId !== authedUserId) {
      return res.status(403).json({
        error: "booking_belongs_to_another_account",
        message: "This booking belongs to another account.",
      });
    }
    if (!bookingUserId && !hasPublicAccess) {
      return res.status(403).json({
        error: "invoice_access_required",
        message: "Please continue from your secure payment link.",
      });
    }
    if (!bookingUserId && bookingId) {
      await prisma.booking.update({
        where: { id: bookingId },
        data: { userId: authedUserId },
      });
    }

    if (String(invoice.invoiceNumber ?? "").startsWith("OINV-"))
      return res.status(400).json({ error: "invalid_invoice", message: "This invoice cannot be paid via this method" });
    if (invoice.status === "DRAFT" || invoice.status === "REJECTED")
      return res.status(400).json({ error: "invalid_status", message: "Invoice is not payable" });
    if (invoice.status === "PAID")
      return res.status(400).json({ error: "already_paid", message: "Invoice already paid" });

    if (invoice.booking?.status === "NEW") {
      const draftAvailability = await computeDraftBookingAvailability(invoice.booking, { excludeBookingId: invoice.booking.id });
      if (!draftAvailability.available) {
        return res.status(409).json(unavailableDraftPaymentResponse(draftAvailability));
      }
    }

    const amount = Number(invoice.total ?? invoice.netPayable ?? 0);
    const currency = resolveCoralCurrency(invoice.booking?.property?.currency);
    if (!Number.isFinite(amount) || amount <= 0)
      return res.status(400).json({ error: "invalid_amount", message: "Invoice has no payable amount" });

    if (cachedCheckout) {
      return res.json({ ok: true, cached: true, idempotencyKey: idemKey, ...cachedCheckout });
    }

    const paymentRef = invoice.paymentRef ?? `CORAL-${invoice.id}-${Date.now()}`;
    const postbackConfig = {
      ...config,
      successUrl: appendQueryParams(config.successUrl, { invoiceId: String(invoice.id), accessToken }),
      failureUrl: appendQueryParams(config.failureUrl, { invoiceId: String(invoice.id), accessToken }),
    };
    const coralPayload = buildCoralOrder({ invoice, amount, currency, paymentRef, config: postbackConfig });

    let apiRes;
    try {
      apiRes = await coralPostJson64(coralPayload);
    } catch (err: any) {
      console.error("[CoralCommerce/Card] request failed:", err?.message ?? "unknown");
      return res.status(503).json({ error: "payment_unavailable", message: "Payment service temporarily unavailable" });
    }

    if (!apiRes.ok) {
      console.error("[CoralCommerce/Card] non-2xx response", JSON.stringify({
        invoiceId: invoice.id,
        paymentRef,
        httpStatus: apiRes.status,
        bodyPreview: apiRes.body.slice(0, 300),
        apiUrl: CORAL_UCF_API_URL,
      }));
      return res.status(502).json({ error: "payment_failed", message: "Card payment could not be initiated" });
    }

    let coralResult;
    try {
      coralResult = parseCoralInitiateResponse(apiRes.body);
    } catch {
      console.error("[CoralCommerce/Card] non-JSON initiation response", JSON.stringify({
        invoiceId: invoice.id,
        paymentRef,
        bodyPreview: apiRes.body.slice(0, 300),
      }));
      return res.status(502).json({ error: "payment_failed", message: "Unexpected response from payment provider" });
    }

    if (coralResult.code !== "000" || !coralResult.redirectUrl) {
      console.error("[CoralCommerce/Card] initiation rejected", JSON.stringify({
        invoiceId: invoice.id,
        paymentRef,
        code: coralResult.code,
        message: coralResult.message,
        zone: coralResult.zone,
      }));
      return res.status(502).json({
        error: "payment_failed",
        message: coralResult.message || "Card payment could not be initiated",
      });
    }

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentRef: invoice.paymentRef ?? paymentRef,
        paymentMethod: "CARD",
        status: "PROCESSING",
        checkoutSessionId: truncate(paymentRef, 120),
      },
    });

    try {
      await prisma.paymentEvent.upsert({
        where: { eventId: `${paymentRef}-INIT` },
        update: {
          status: "PENDING",
          checkoutUrl: coralResult.redirectUrl.slice(0, 2048),
          rawStatus: coralResult.code,
          payload: {
            paymentRef,
            code: coralResult.code,
            message: coralResult.message,
            apiUrl: CORAL_UCF_API_URL,
          },
        },
        create: {
          provider: "CORALCOMMERCE",
          eventId: `${paymentRef}-INIT`,
          invoiceId: invoice.id,
          amount,
          currency,
          status: "PENDING",
          paymentChannel: "CARD",
          checkoutUrl: coralResult.redirectUrl.slice(0, 2048),
          rawStatus: coralResult.code,
          payload: {
            paymentRef,
            code: coralResult.code,
            message: coralResult.message,
            apiUrl: CORAL_UCF_API_URL,
          },
        },
      });
    } catch (dbErr: any) {
      console.warn("[CoralCommerce/Card] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
    }

    const result = {
      transactionId: paymentRef,
      paymentRef,
      checkoutUrl: coralResult.redirectUrl,
      status: "PENDING",
    };
    await idemSet(idemKey, result);
    return res.json({ ok: true, idempotencyKey: idemKey, ...result });
  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[CoralCommerce/Card] /initiate unhandled error:", err);
    } else {
      console.error("[CoralCommerce/Card] /initiate unhandled error:", err?.message ?? "unknown");
    }
    return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
  }
});

function getCallbackValue(req: any, name: string): string | null {
  const body = req.body || {};
  const query = req.query || {};
  const value = body[name] ?? query[name];
  if (Array.isArray(value)) return value[0] == null ? null : String(value[0]);
  return value == null ? null : String(value);
}

function normalizeCoralNotification(kind: "callback" | "postback", payload: any) {
  const result = kind === "postback" ? (payload?.Result ?? payload?.result ?? {}) : payload;
  return {
    code: String(result.Code ?? result.code ?? ""),
    message: String(result.Message ?? result.message ?? ""),
    transactionId: result.TransactionID == null ? null : String(result.TransactionID),
    stamp: result.Stamp == null ? null : String(result.Stamp),
    identifier: result.Identifier == null ? null : String(result.Identifier),
    status: result.Status == null ? null : String(result.Status),
    isoCode: result.ISOCode == null ? null : String(result.ISOCode),
    isoMessage: result.ISOMessage == null ? null : String(result.ISOMessage),
    gatewayId: result.GatewayID == null ? null : String(result.GatewayID),
    raw: payload,
  };
}

async function handleCoralNotification(kind: "callback" | "postback", encryptedValue: string) {
  const secret = process.env.CORAL_UCF_SHARED_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("coral_encryption_key_missing");
  }

  const parsed = parseCoralEncryptedJson(secret, encryptedValue);
  const notice = normalizeCoralNotification(kind, parsed);
  const paymentRef = notice.identifier || notice.stamp;
  if (!paymentRef) {
    throw new Error("coral_missing_payment_ref");
  }

  const invoice = await prisma.invoice.findFirst({
    where: { paymentRef },
    select: {
      id: true,
      status: true,
      total: true,
      netPayable: true,
      booking: { select: { property: { select: { currency: true } } } },
    },
  });

  const tourBooking = invoice ? null : await prisma.tourBooking.findFirst({
    where: { paymentRef },
    select: {
      id: true,
      status: true,
      paymentStatus: true,
      grossAmount: true,
      currency: true,
    },
  });

  const groupBooking = (invoice || tourBooking) ? null : await prisma.groupBooking.findFirst({
    where: { paymentRef },
    select: {
      id: true,
      userId: true,
      depositAmount: true,
      depositPaid: true,
      currency: true,
      assignedOwnerId: true,
      confirmedPropertyId: true,
      checkIn: true,
      checkOut: true,
      roomsNeeded: true,
      toRegion: true,
      toDistrict: true,
    },
  });

  const nrmsPaymentToken = (invoice || tourBooking || groupBooking || !/^NRMS-/i.test(paymentRef))
    ? null
    : await (prisma as any).nrmsServicePaymentToken.findUnique({
        where: { token: paymentRef },
        include: { statement: { include: { account: true } }, payment: true },
      });

  if (!invoice && !tourBooking && !groupBooking && !nrmsPaymentToken) {
    throw new Error("coral_payment_target_not_found");
  }

  const isSuccess =
    (notice.status ? /^success$/i.test(notice.status) : true) &&
    notice.code === "000";
  const isFailure = notice.status ? /^failure$/i.test(notice.status) : notice.code && notice.code !== "000";
  const eventStatus: "SUCCESS" | "FAILED" | "PENDING" = isSuccess ? "SUCCESS" : isFailure ? "FAILED" : "PENDING";
  const eventId = notice.transactionId || notice.gatewayId || `${paymentRef}-${kind}-${eventStatus}`;
  const amount = invoice
    ? Number(invoice.total ?? invoice.netPayable ?? 0)
    : tourBooking
    ? Number(tourBooking?.grossAmount ?? 0)
    : groupBooking
    ? Math.round(Number(groupBooking?.depositAmount ?? 0))
    : Math.round(Number(nrmsPaymentToken?.amount ?? 0));

  const existing = await prisma.paymentEvent.findUnique({
    where: { eventId },
    select: { id: true, status: true },
  }).catch(() => null);

  if (existing) {
    if (existing.status !== eventStatus) {
      await prisma.paymentEvent.update({
        where: { id: existing.id },
        data: { status: eventStatus, rawStatus: notice.status || notice.code || undefined, payload: notice.raw },
      });
    }
  } else {
    await prisma.paymentEvent.create({
      data: {
        provider: "CORALCOMMERCE",
        eventId,
        invoiceId: invoice?.id ?? null,
        tourBookingId: tourBooking?.id ?? null,
        groupBookingId: groupBooking?.id ?? null,
        amount,
        currency: invoice
          ? resolveCoralCurrency(invoice.booking?.property?.currency)
          : tourBooking
          ? resolveCoralCurrency(tourBooking?.currency)
          : resolveCoralCurrency(groupBooking?.currency),
        status: eventStatus,
        paymentChannel: "CARD",
        rawStatus: notice.status || notice.code || null,
        payload: notice.raw,
      },
    });
  }

  if (isSuccess && invoice && invoice.status !== "PAID") {
    await markInvoicePaid(
      invoice.id,
      "CARD",
      paymentRef,
      undefined,
      "CORALCOMMERCE",
      notice.transactionId || notice.gatewayId || paymentRef,
      amount
    );
  }

  if (isSuccess && nrmsPaymentToken) {
    await prisma.$transaction((tx: any) => reconcileNrmsPayment(tx, {
      token: nrmsPaymentToken.token,
      provider: "CORALCOMMERCE",
      providerRef: eventId,
      idempotencyKey: `CORAL:${eventId}`.slice(0, 120),
      amount,
    }));
  }
  if (isFailure && nrmsPaymentToken) {
    await prisma.$transaction((tx: any) => markNrmsPaymentFailed(tx, nrmsPaymentToken.token));
  }

  if (isSuccess && tourBooking && tourBooking.paymentStatus !== "PAID") {
    // Shared helper marks paid AND sends the guest SMS + confirmation email and
    // notifies the operator — same as the AzamPay webhook path.
    try {
      const result = await markTourBookingPaid(tourBooking.id, amount, "CORALCOMMERCE");
      if (!result.ok && result.reason === "amount_mismatch") {
        console.warn(
          `[CoralCommerce/Card] Amount mismatch on tour booking ${tourBooking.id}: received ${amount}.`
        );
      }
    } catch (err: any) {
      console.error(`[CoralCommerce/Card] Failed to confirm tour booking ${tourBooking.id}:`, err?.message ?? err);
    }
  } else if (isFailure && tourBooking && tourBooking.paymentStatus !== "PAID") {
    await prisma.tourBooking.update({
      where: { id: tourBooking.id },
      data: {
        paymentStatus: "FAILED",
        paymentProvider: "CORALCOMMERCE",
      },
    });
  }

  if (isSuccess && groupBooking && !groupBooking.depositPaid) {
    try {
      const result = await markGroupBookingDepositPaid(groupBooking, amount, "CORALCOMMERCE");
      if (!result.ok && result.reason === "amount_mismatch") {
        console.warn(
          `[CoralCommerce/Card] Amount mismatch on group booking deposit ${groupBooking.id}: ` +
          `expected ${Math.round(Number(groupBooking.depositAmount || 0))}, received ${amount}.`
        );
      }
    } catch (err: any) {
      console.error(`[CoralCommerce/Card] Failed to mark group booking ${groupBooking.id} deposit as paid:`, err?.message ?? err);
    }
  }

  return {
    ok: true,
    invoiceId: invoice?.id ?? null,
    tourBookingId: tourBooking?.id ?? null,
    groupBookingId: groupBooking?.id ?? null,
    nrmsToken: nrmsPaymentToken?.token ?? null,
    status: eventStatus,
    paymentRef,
    message: notice.message || null,
  };
}

router.post("/callback", coralFormParser, async (req, res) => {
  try {
    const encrypted = getCallbackValue(req, "UCFCallback");
    if (!encrypted) return res.status(400).json({ ok: false, error: "missing_ucf_callback" });
    const result = await handleCoralNotification("callback", encrypted);
    return res.json(result);
  } catch (err: any) {
    console.error("[CoralCommerce/Card] callback error:", err?.message ?? err);
    return res.status(400).json({ ok: false, error: "callback_failed" });
  }
});

router.all("/postback", coralFormParser, async (req, res) => {
  try {
    const encrypted = getCallbackValue(req, "UCFResponse");
    if (!encrypted) return res.status(400).json({ ok: false, error: "missing_ucf_response" });
    const result = await handleCoralNotification("postback", encrypted);
    const cardReturn = result.status === "SUCCESS" ? "success" : result.status === "FAILED" ? "failed" : "pending";

    const kind = getCallbackValue(req, "kind");
    const groupBookingId = getCallbackValue(req, "groupBookingId");
    if (kind === "group_stay_deposit" && groupBookingId) {
      const params = new URLSearchParams({ cardReturn, ref: result.paymentRef, groupBookingId });
      if (result.message) params.set("message", truncate(result.message, 160));
      return res.redirect(`nolsaf://group-stay-card-return?${params.toString()}`);
    }

    const webOrigin = (process.env.WEB_ORIGIN || "").replace(/\/$/, "");
    if (webOrigin) {
      if (kind === "nrms" && result.nrmsToken) {
        const params = new URLSearchParams({ cardReturn, ref: result.paymentRef });
        if (result.message) params.set("message", truncate(result.message, 160));
        return res.redirect(`${webOrigin}/owner/nrms/billing?${params.toString()}`);
      }
      const tourBookingId = getCallbackValue(req, "tourBookingId");
      const accessToken = getCallbackValue(req, "accessToken");
      const params = new URLSearchParams({ cardReturn, ref: result.paymentRef });
      if (result.message) params.set("message", truncate(result.message, 160));
      if (tourBookingId && accessToken) {
        params.set("tourBookingId", tourBookingId);
        params.set("accessToken", accessToken);
        return res.redirect(`${webOrigin}/public/booking/tour-payment?${params.toString()}`);
      }
      if (result.invoiceId) params.set("invoiceId", String(result.invoiceId));
      if (accessToken) params.set("accessToken", accessToken);
      return res.redirect(`${webOrigin}/public/booking/payment?${params.toString()}`);
    }
    return res.json(result);
  } catch (err: any) {
    console.error("[CoralCommerce/Card] postback error:", err?.message ?? err);
    return res.status(400).json({ ok: false, error: "postback_failed" });
  }
});

export default router;
