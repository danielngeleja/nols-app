/**
 * AzamPay Bank Checkout Routes
 *
 * Handles bank-based payment initiation for Invoices and TourBookings.
 * Calls AzamPay POST /api/v1/Partner/BankCheckout.
 *
 * SECURITY POLICY (mirrors MNO route):
 *  - Env var VALUES are NEVER written to logs.
 *  - Raw AzamPay response bodies are NEVER forwarded to the caller.
 *  - Every outbound fetch has a hard 10-second AbortController timeout.
 *  - 401 from AzamPay → token cache invalidated and retried once.
 *  - Idempotency keys stored in Redis (fallback: in-process LRU).
 *  - Amount always read from server-side Invoice/TourBooking row — never the client.
 *  - bankCode validated against SUPPORTED_BANK_CODES whitelist.
 *  - accountNumber (optional) validated with strict regex — no injection.
 */

import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { getAzamPayToken, invalidateAzamPayToken } from "../lib/azampay.auth.js";
import { computeDraftBookingAvailability, unavailableDraftPaymentResponse } from "../lib/draftBookingAvailability.js";
import {
  AZAMPAY_MNO_API_URL,
  idemGet,
  idemSet,
  azampayMnoPost,
  makePaymentRateLimiter,
  normalizePhone,
  maskAzamPayPhone,
  SUPPORTED_BANK_CODES,
} from "../lib/azampay.helpers.js";

const router = Router();

// ── Rate limiters ─────

const bankUserLimiter = makePaymentRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit:    5,
  keyFn:    (req: any) => String(req.user?.id || req.ip || "anon"),
});

const bankTargetLimiter = makePaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit:    3,
  keyFn:    (req: any) => {
    const invoiceId = req.body?.invoiceId ?? "unknown";
    const bankCode  = String(req.body?.bankCode ?? "unknown").toUpperCase().slice(0, 10);
    const user      = req.user?.id || req.ip || "anon";
    return `bankpay:${user}:${invoiceId}:${bankCode}`;
  },
});

// ── Input schemas ──

export const bankInitiateSchema = z.object({
  invoiceId: z.number().int().positive(),
  bankCode: z.enum(SUPPORTED_BANK_CODES),
  accountNumber: z.string().min(1).max(30).regex(/^[\w\-]+$/),
  merchantMobileNumber: z.string().min(9).max(15).regex(
    /^[\d+]+$/,
    "Mobile number must contain only digits and an optional leading +"
  ),
  otp: z.string().min(1).max(50),
  idempotencyKey: z.string().min(8).max(128).optional(),
  accessToken: z.string().min(20).max(1024).optional(),
});
// ── Public invoice access JWT (same logic as MNO route) ───

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

// ── POST /api/payments/azampay/bank/initiate ──

router.post(
  "/initiate",
  requireAuth,
  bankUserLimiter,
  bankTargetLimiter,
  async (req, res) => {
    try {
      // 1. Validate input
      const parsed = bankInitiateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:   "validation_error",
          details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }

      const {
  invoiceId,
  bankCode,
  accountNumber,
  merchantMobileNumber,
  otp,
  idempotencyKey,
  accessToken,
} = parsed.data;

const normalizedBankMobile = normalizePhone(merchantMobileNumber);
if (!normalizedBankMobile) {
  return res.status(400).json({
    error: "validation_error",
    message: "Invalid mobile number. Please enter a valid Tanzanian number.",
  });
}

const azamBankMobileNumber = normalizedBankMobile.replace(/^\+/, "");
      // 2. Idempotency key
      const idemKey = idempotencyKey ?? `azp-bank-${invoiceId}-${bankCode}`;
      const cachedCheckout = await idemGet(idemKey);

      // 3. Load invoice
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          booking: {
            include: {
              property: { select: { id: true, currency: true, status: true, roomsSpec: true, totalBedrooms: true } },
              user:     { select: { id: true, phone: true } },
            },
          },
        },
      });

      if (!invoice)
        return res.status(404).json({ error: "not_found", message: "Invoice not found" });

      // 4. Authorisation
      const authedUserId     = Number((req as any).user?.id);
      const bookingId        = Number(invoice.bookingId || invoice.booking?.id || 0);
      const bookingUserId    = invoice.booking?.userId ? Number(invoice.booking.userId) : null;
      const hasPublicAccess  = verifyPublicInvoiceAccessToken(accessToken, invoice.id, bookingId);

      if (bookingUserId && bookingUserId !== authedUserId) {
        return res.status(403).json({
          error:   "booking_belongs_to_another_account",
          message: "This booking belongs to another account.",
        });
      }
      if (!bookingUserId && !hasPublicAccess) {
        return res.status(403).json({
          error:   "invoice_access_required",
          message: "Please continue from your secure payment link.",
        });
      }
      if (!bookingUserId && bookingId) {
        await prisma.booking.update({
          where: { id: bookingId },
          data:  { userId: authedUserId },
        });
      }

      // 5. Payability checks
      if (String(invoice.invoiceNumber ?? "").startsWith("OINV-"))
        return res.status(400).json({ error: "invalid_invoice", message: "This invoice cannot be paid via this method" });
      if (invoice.status === "DRAFT" || invoice.status === "REJECTED")
        return res.status(400).json({ error: "invalid_status", message: "Invoice is not payable" });
      if (invoice.status === "PAID")
        return res.status(400).json({ error: "already_paid", message: "Invoice already paid" });

      // 6. Server-side amount — never trust the client
      if (invoice.booking?.status === "NEW") {
        const draftAvailability = await computeDraftBookingAvailability(invoice.booking, { excludeBookingId: invoice.booking.id });
        if (!draftAvailability.available) {
          return res.status(409).json(unavailableDraftPaymentResponse(draftAvailability));
        }
      }

      const amount   = Number(invoice.total ?? invoice.netPayable ?? 0);
      const currency = invoice.booking?.property?.currency ?? "TZS";
      if (!Number.isFinite(amount) || amount <= 0)
        return res.status(400).json({ error: "invalid_amount", message: "Invoice has no payable amount" });

      if (cachedCheckout) {
        return res.json({ ok: true, cached: true, idempotencyKey: idemKey, ...cachedCheckout });
      }

      // 7. Payment ref
      const paymentRef = invoice.paymentRef ?? `BANK-${invoice.id}-${Date.now()}`;

      // 8. AzamPay bank checkout payload
      const azampayBody = {
      amount: Math.round(amount),
      currencyCode: currency,
      merchantAccountNumber: accountNumber,
      merchantMobileNumber: azamBankMobileNumber,
      merchantName: process.env.AZAMPAY_APP_NAME || "NoLSAF",
      otp,
      provider: bankCode,
      referenceId: paymentRef,
      additionalProperties: {},
    };

      // 9. Acquire Bearer token
      let token: string;
      try {
        token = await getAzamPayToken();
      } catch (authErr: any) {
        console.error("[AzamPay/Bank] Token acquisition failed:", authErr?.message ?? "unknown");
        return res.status(503).json({ error: "payment_unavailable", message: "Payment service temporarily unavailable" });
      }

      // 10. Call AzamPay; retry once on 401
      let apiRes = await azampayMnoPost("/azampay/bank/checkout", azampayBody, token);
      if (apiRes.status === 401) {
        await invalidateAzamPayToken();
        try { token = await getAzamPayToken(); } catch { /* let next block handle */ }
        apiRes = await azampayMnoPost("/azampay/bank/checkout", azampayBody, token!);
      }

      if (!apiRes.ok) {
        console.error(`[AzamPay/Bank] Checkout HTTP ${apiRes.status} for invoice ${invoice.id} — body: ${apiRes.body.slice(0, 500)}`);
        return res.status(502).json({ error: "payment_failed", message: "Bank payment could not be initiated — please try again" });
      }

      let azampayData: any;
        try {
          azampayData = JSON.parse(apiRes.body);
          console.info("[AzamPay/Bank] Raw Bank Response", azampayData);

          if (azampayData.success === false) {
            console.error("[AzamPay/Bank] Bank checkout rejected by AzamPay", {
              invoiceId: invoice.id,
              paymentRef,
              bankCode,
              amount: Math.round(amount),
              currency,
              accountNumber,
              merchantMobileNumber: maskAzamPayPhone(normalizedBankMobile),
              apiHost: AZAMPAY_MNO_API_URL,
              endpoint: `${AZAMPAY_MNO_API_URL}/azampay/bank/checkout`,
              httpStatus: apiRes.status,
              message: azampayData.message,
              messageCode: azampayData.messageCode,
              transactionId: azampayData.transactionId ?? null,
            });

            return res.status(502).json({
              error: "payment_failed",
              message: azampayData.message || "Bank payment could not be initiated. Please verify the bank details and try again.",
            });
          }
        } catch {
          console.error(`[AzamPay/Bank] Non-JSON response HTTP ${apiRes.status} — body: ${apiRes.body.slice(0, 500) || "(empty)"}`);
          return res.status(502).json({ error: "payment_failed", message: "Unexpected response from payment provider" });
        }

      // 11. Update invoice
      await prisma.invoice.update({
        where: { id: invoice.id },
        data:  {
          paymentRef:        invoice.paymentRef ?? paymentRef,
          paymentMethod:     bankCode,
          status:            "PROCESSING",
          checkoutSessionId: azampayData.transactionId ?? null,
        },
      });

      // 12. Record PaymentEvent (non-fatal)
      try {
        await prisma.paymentEvent.create({
          data: {
            provider:       "AZAMPAY",
            // Suffix paymentRef with timestamp on fallback so retries don't collide on the
            // @unique eventId column.
            eventId:        azampayData.transactionId ?? `${paymentRef}-${Date.now()}`,
            invoiceId:      invoice.id,
            amount,
            currency,
            status:         "PENDING",
            paymentChannel: "BANK",
            rawStatus:      null,
            payload: {
              transactionId: azampayData.transactionId ?? null,
              paymentRef,
              bankCode,
              accountNumber: accountNumber ?? null,
            },
          },
        });
      } catch (dbErr: any) {
        console.warn("[AzamPay/Bank] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
      }

      // 13. Cache and respond
      const result = {
        transactionId: azampayData.transactionId ?? paymentRef,
        paymentRef,
        status: "PENDING",
      };
      await idemSet(idemKey, result);
      return res.json({ ok: true, idempotencyKey: idemKey, ...result });

    } catch (err: any) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[AzamPay/Bank] /initiate unhandled error:", err);
      } else {
        console.error("[AzamPay/Bank] /initiate unhandled error:", err?.message ?? "unknown");
      }
      return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
    }
  }
);

export default router;
