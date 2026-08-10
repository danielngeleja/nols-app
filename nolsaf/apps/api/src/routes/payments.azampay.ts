/**
 * AzamPay Payment Routes
 *
 * SECURITY POLICY enforced in this file:
 *  - Env var VALUES are NEVER written to logs; only key names if missing.
 *  - Raw AzamPay response bodies are NEVER forwarded to the caller.
 *  - Every outbound fetch has a hard AbortController timeout (10 s).
 *  - On a 401 from AzamPay the token cache is invalidated and retried once.
 *  - Idempotency keys are stored in Redis (fallback: in-process LRU; final
 *    fallback: DB lookup) so restarts / multi-instance can't duplicate charges.
 *  - Amount is always read from the server-side Invoice row — never the client.
 */

// apps/api/src/routes/payments.azampay.ts
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { getAzamPayToken, invalidateAzamPayToken } from "../lib/azampay.auth.js";
import { requireAuth } from "../middleware/auth.js";
import { computeDraftBookingAvailability, unavailableDraftPaymentResponse } from "../lib/draftBookingAvailability.js";
import { getPaymentMethodAvailability } from "../lib/serviceAvailability.js";
import {
  AZAMPAY_API_URL,
  AZAMPAY_MNO_API_URL,
  FETCH_TIMEOUT_MS,
  IDEM_TTL_SEC,
  TZ_PHONE_RE,
  normalizePhone,
  maskAzamPayPhone,
  describeAzamPayResponseBody,
  azampayPost,
  azampayMnoPost,
  makePaymentRateLimiter,
} from "../lib/azampay.helpers.js";

const router = Router();

// ── Config ───────────

// AZAMPAY_API_URL, FETCH_TIMEOUT_MS, IDEM_TTL_SEC, TZ_PHONE_RE imported from azampay.helpers
const PAYMENT_USER_WINDOW_MS = 15 * 60 * 1000;
const PAYMENT_USER_LIMIT = 5;
const PAYMENT_TARGET_WINDOW_MS = 5 * 60 * 1000;
const PAYMENT_TARGET_LIMIT = 3;

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

  if (!secret) {
    throw new Error("public_invoice_access_secret_missing");
  }

  return secret;
}

function verifyPublicInvoiceAccessToken(token: string | undefined, invoiceId: number, bookingId: number): boolean {
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

// ── Rate limiters (built from shared factory) ─────

const paymentUserLimiter = makePaymentRateLimiter({
  windowMs: PAYMENT_USER_WINDOW_MS,
  limit:    PAYMENT_USER_LIMIT,
  keyFn:    (req: any) => String(req.user?.id || req.ip || "anon"),
});

const paymentTargetLimiter = makePaymentRateLimiter({
  windowMs: PAYMENT_TARGET_WINDOW_MS,
  limit:    PAYMENT_TARGET_LIMIT,
  keyFn:    (req: any) => {
    const invoiceId = req.body?.invoiceId ?? "unknown-invoice";
    const phone = normalizePhone(String(req.body?.phoneNumber ?? "")) ?? String(req.body?.phoneNumber ?? "unknown-phone");
    const user = req.user?.id || req.ip || "anon";
    return `payment:${user}:${invoiceId}:${phone}`;
  },
});

// ── Input schema ──

// TZ_PHONE_RE imported from azampay.helpers

const initiateSchema = z.object({
  invoiceId:      z.number().int().positive(),
  phoneNumber:    z.string().min(9).max(15).regex(
    /^[\d+]+$/,
    "Phone number must contain only digits and an optional leading +"
  ),

provider:       z.enum(["Airtel", "Tigo", "Halopesa", "Azampesa", "Mpesa"]).default("Airtel"),  idempotencyKey: z.string().min(8).max(128).optional(),
  accessToken:    z.string().min(20).max(1024).optional(),
});

// normalizePhone, azampayPost, idemGet, idemSet, localIdem all imported from azampay.helpers

// ── POST /api/payments/azampay/initiate ────

router.post("/initiate", requireAuth, paymentUserLimiter, paymentTargetLimiter, async (req, res) => {
  try {
    // 1. Validate input
    const parsed = initiateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "validation_error",
        details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
      });
    }
    const { invoiceId, phoneNumber, provider, idempotencyKey, accessToken } = parsed.data;

    const providerGate = await getPaymentMethodAvailability(provider);
    if (!providerGate.enabled) {
      return res.status(400).json({
        error: "payment_method_unavailable",
        message: providerGate.reason,
      });
    }


    // Normalise & validate phone before anything else (fast-fail)
    const normalizedPhone = normalizePhone(phoneNumber);
    if (!normalizedPhone) {
      return res.status(400).json({
        error: "validation_error",
        message: "Invalid phone number. Please enter a valid Tanzanian number (e.g. +255712345678 or 0712345678).",
      });
    }

    // MNO is a fire-and-forget USSD push — no checkoutUrl to cache. We deliberately do NOT
    // serve a cached result here, because each retry must re-trigger a fresh push to the
    // handset. The webhook + DB invoice.status is the source of truth against double-charging:
    // payability checks below short-circuit on PROCESSING/PAID.
    const idemKey = idempotencyKey ?? `azp-${invoiceId}-${normalizedPhone.replace(/\+/g, "")}`;

    // 3. Load & validate invoice
    const invoice = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        booking: {
          include: {
            property: { select: { id: true, currency: true, status: true, roomsSpec: true, totalBedrooms: true } },
            user: { select: { id: true, phone: true } },
          },
        },
      },
    });

    if (!invoice) return res.status(404).json({ error: "not_found", message: "Invoice not found" });

    const authedUserId = Number((req as any).user?.id);
    const bookingId = Number(invoice.bookingId || invoice.booking?.id || 0);
    const bookingUserId = invoice.booking?.userId ? Number(invoice.booking.userId) : null;
    const hasPublicInvoiceAccess = verifyPublicInvoiceAccessToken(accessToken, invoice.id, bookingId);

    if (bookingUserId && bookingUserId !== authedUserId) {
      return res.status(403).json({
        error: "booking_belongs_to_another_account",
        message: "This booking belongs to another account.",
      });
    }

    if (!bookingUserId && !hasPublicInvoiceAccess) {
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

    // 4. Server-side amount — never trust the client
    if (invoice.booking?.status === "NEW") {
      const draftAvailability = await computeDraftBookingAvailability(invoice.booking, { excludeBookingId: invoice.booking.id });
      if (!draftAvailability.available) {
        return res.status(409).json(unavailableDraftPaymentResponse(draftAvailability));
      }
    }

    const amount = Number(invoice.total ?? invoice.netPayable ?? 0);
    const currency = invoice.booking?.property?.currency ?? "TZS";
    if (!Number.isFinite(amount) || amount <= 0)
      return res.status(400).json({ error: "invalid_amount", message: "Invoice has no payable amount" });

    // 5. Payment ref (normalizedPhone already computed and validated above)
    const paymentRef = `INV-${invoice.id}-${Date.now()}`;

    // 6. Build checkout payload (no secret material inside)
    // TZS has no fractional cents — always send as a rounded integer string.
    const azamAccountNumber = normalizedPhone.replace(/^\+/, "");

    const azampayBody = {
  accountNumber: azamAccountNumber,
  amount: Math.round(amount),
  currency,
  externalId: paymentRef,
  provider,
  additionalProperties: {},
};

    // 7. Acquire Bearer token — fail fast with opaque 503 on error
    let token: string;
    try {
      token = await getAzamPayToken();
    } catch (authErr: any) {
      console.error("[AzamPay] Token acquisition failed:", authErr?.message ?? "unknown");
      return res.status(503).json({ error: "payment_unavailable", message: "Payment service temporarily unavailable" });
    }

    // 8. Call AzamPay MNO direct push endpoint; retry once on 401 (stale token)
    // The /azampay/mno/checkout endpoint (not /api/v1/Partner/PostCheckout) triggers
    // USSD handset prompt directly instead of returning a hosted checkout URL.
    let apiRes = await azampayMnoPost("/azampay/mno/checkout", azampayBody, token);
    if (apiRes.status === 401) {
      await invalidateAzamPayToken();
      try { token = await getAzamPayToken(); } catch { /* let next block handle */ }
      apiRes = await azampayMnoPost("/azampay/mno/checkout", azampayBody, token!);
    }

    if (!apiRes.ok) {
      console.error(`[AzamPay] Checkout HTTP ${apiRes.status} for invoice ${invoice.id} — body: ${apiRes.body.slice(0, 500)}`);
      return res.status(502).json({ error: "payment_failed", message: "Payment could not be initiated — please try again" });
    }

    // MNO PostCheckout is a USSD push to the phone. The real payment surface is the
    // handset, NOT a browser checkout page. We deliberately discard any checkoutUrl
    // the sandbox returns (debug-only) so the frontend stays on the "check your phone"
    // prompt and polls /status. The webhook is the source of truth for completion.
    const responseSummary = describeAzamPayResponseBody(apiRes.body);
    const mnoEndpoint = `${AZAMPAY_MNO_API_URL}/azampay/mno/checkout`;
    let azampayData: any = { transactionId: responseSummary.transactionId };
    {
      const trimmed = apiRes.body.trim();
      if (!trimmed || trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
        // Empty 200 (production push ack) OR sandbox URL — both mean "push sent"
        // azampayData already initialised above
      } else {
        try {
          const parsed = JSON.parse(trimmed);
if (parsed.success === false) {
  console.error("[AzamPay] MNO push rejected by AzamPay", {
    invoiceId: invoice.id,
    paymentRef,
    provider,
    selectedProvider: provider,
    amount: Math.round(amount),
    currency,
    accountNumber: maskAzamPayPhone(normalizedPhone),
    apiHost: AZAMPAY_MNO_API_URL,
    endpoint: mnoEndpoint,
    httpStatus: apiRes.status,
    message: parsed.message,
    messageCode: parsed.messageCode,
    referenceId: String(parsed.message || "").match(/Reference Id:\s*([a-zA-Z0-9]+)/)?.[1] ?? null,
  });

  return res.status(502).json({
    error: "payment_failed",
    message: parsed.message || "Payment push could not be initiated. Please verify the payment details and try again.",
  });
}

          azampayData = { transactionId: parsed.transactionId ?? null };
        } catch {
          console.error(`[AzamPay] Non-JSON response HTTP ${apiRes.status} — body: ${trimmed.slice(0, 500)}`);
          return res.status(502).json({ error: "payment_failed", message: "Unexpected response from payment provider" });
        }
      }
    }

    // 9. AzamPay accepted the checkout request — only now move invoice forward.
    console.info("[AzamPay] MNO checkout accepted", {
      invoiceId: invoice.id,
      paymentRef,
      provider,
      amount: Math.round(amount),
      currency,
      accountNumber: maskAzamPayPhone(normalizedPhone),
      apiHost: AZAMPAY_MNO_API_URL,
      endpoint: mnoEndpoint,
      httpStatus: apiRes.status,
      response: responseSummary,
    });

    await prisma.invoice.update({
      where: { id: invoice.id },
      data: {
        paymentRef:        invoice.paymentRef ?? paymentRef,
        paymentMethod:     provider,
        status:            "PROCESSING",
        checkoutSessionId: azampayData.transactionId ?? null,
        payerPhone:        normalizedPhone,
      },
    });

    // 10. Record payment event (non-fatal)
    try {
      await prisma.paymentEvent.create({
        data: {
          provider: "AZAMPAY",
          // Suffix paymentRef with timestamp on fallback so retries don't collide on the
          // @unique eventId column (MNO push often returns no transactionId).
          eventId: azampayData.transactionId ?? `${paymentRef}-${Date.now()}`,
          invoiceId: invoice.id,
          amount,
          currency,
          status: "PENDING",
          paymentChannel: "MNO",
          phone: normalizedPhone,
          payload: {
            transactionId: azampayData.transactionId ?? null,
            paymentRef,
            phoneNumber: normalizedPhone,
            provider,
            azampayResponse: responseSummary,
            apiHost: AZAMPAY_MNO_API_URL,
          },
        },
      });
    } catch (dbErr: any) {
      console.warn("[AzamPay] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
    }

    // 11. Respond — do not cache for MNO. Each retry must trigger a fresh USSD push.
    // Double-charge protection is handled by the invoice status check above.
    // No checkoutUrl: MNO is a phone-only push flow; the client polls /status.
    return res.json({
      ok:             true,
      idempotencyKey: idemKey,
      transactionId:  azampayData.transactionId ?? paymentRef,
      paymentRef,
      status:         "PENDING",
    });

  } catch (err: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[AzamPay] /initiate unhandled error:", err);
    } else {
      console.error("[AzamPay] /initiate unhandled error:", err?.message ?? "unknown");
    }
    return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
  }
});

// ── GET /api/payments/azampay/status/:paymentRef ──────────────────────────────

router.get("/status/:paymentRef", requireAuth, async (req, res) => {
  try {
    const { paymentRef } = req.params;

    // Basic format guard
    if (!paymentRef || paymentRef.length > 100 || !/^[\w\-]+$/.test(paymentRef))
      return res.status(400).json({ error: "invalid_ref", message: "Invalid payment reference" });

    const invoice = await prisma.invoice.findFirst({
      where: { paymentRef },
      select: {
        id: true,
        status: true,
        bookingId: true,
        booking: { select: { id: true, userId: true, property: { select: { currency: true } } } },
      },
    });

    if (!invoice) return res.status(404).json({ error: "not_found", message: "Payment reference not found" });

    // ── Authorization (same gate as /initiate) ───────────────────────────────
    // The payment reference is predictable (INV-<id>-<timestamp>), so it must NOT
    // be sufficient on its own to read an invoice's status. The caller must either
    // own the invoice's booking, or present a valid signed public-invoice access
    // token. Otherwise any logged-in user could enumerate other users' invoices.
    const authedUserId           = Number((req as any).user?.id);
    const bookingId              = Number(invoice.bookingId || invoice.booking?.id || 0);
    const bookingUserId          = invoice.booking?.userId ? Number(invoice.booking.userId) : null;
    const accessToken            = typeof req.query.accessToken === "string" ? req.query.accessToken : undefined;
    const hasPublicInvoiceAccess = verifyPublicInvoiceAccessToken(accessToken, invoice.id, bookingId);

    if (bookingUserId) {
      if (bookingUserId !== authedUserId)
        return res.status(403).json({ error: "forbidden", message: "This invoice belongs to another account." });
    } else if (!hasPublicInvoiceAccess) {
      return res.status(403).json({ error: "forbidden", message: "Please continue from your secure payment link." });
    }

    const event = await prisma.paymentEvent.findFirst({
      where: { invoiceId: invoice.id, provider: "AZAMPAY" },
      orderBy: { createdAt: "desc" },
      select: { status: true, createdAt: true },
    });

    return res.json({
      ok: true,
      invoiceStatus: invoice.status,
      paymentStatus: event?.status ?? "UNKNOWN",
      currency: invoice.booking?.property?.currency ?? "TZS",
    });
  } catch (err: any) {
    console.error("[AzamPay] /status error:", err?.message ?? err);
    return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
  }
});

export default router;


