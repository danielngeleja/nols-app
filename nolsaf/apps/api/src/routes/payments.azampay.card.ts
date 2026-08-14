/**
 * AzamPay Card Checkout Routes
 *
 * Handles Visa/Mastercard payment initiation (redirect flow) for Invoices and TourBookings.
 * Calls AzamPay POST /api/v1/Partner/CardCheckout — returns a hosted checkoutUrl.
 * The browser is then redirected to that URL; AzamPay redirects back to /card/callback.
 *
 * SECURITY POLICY:
 *  - returnUrl is NEVER accepted from the client — constructed server-side only.
 *  - The card callback handler NEVER writes to the database (webhook is the only write path).
 *  - Raw AzamPay responses are NEVER forwarded to the caller.
 *  - Every outbound fetch has a hard 10-second AbortController timeout.
 *  - 401 from AzamPay → token cache invalidated and retried once.
 *  - Idempotency keys in Redis (fallback: in-process LRU).
 *  - Amount always read from server-side row — never the client.
 *  - Redirect targets are validated to be within the configured WEB_ORIGIN.
 */

import { Router } from "express";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { requireAuth } from "../middleware/auth.js";
import { getAzamPayToken, invalidateAzamPayToken } from "../lib/azampay.auth.js";
import { computeDraftBookingAvailability, unavailableDraftPaymentResponse } from "../lib/draftBookingAvailability.js";
import {
  idemGet,
  idemSet,
  azampayCardPost,
  makePaymentRateLimiter,
} from "../lib/azampay.helpers.js";

const router = Router();

// ── Rate limiters ─────

const cardUserLimiter = makePaymentRateLimiter({
  windowMs: 15 * 60 * 1000,
  limit:    5,
  keyFn:    (req: any) => String(req.user?.id || req.ip || "anon"),
});

const cardTargetLimiter = makePaymentRateLimiter({
  windowMs: 5 * 60 * 1000,
  limit:    3,
  keyFn:    (req: any) => {
    const invoiceId = req.body?.invoiceId ?? "unknown";
    const user      = req.user?.id || req.ip || "anon";
    return `cardpay:${user}:${invoiceId}`;
  },
});

// ── Input schemas ──

export const cardInitiateSchema = z.object({
  invoiceId:      z.number().int().positive(),
  idempotencyKey: z.string().min(8).max(128).optional(),
  accessToken:    z.string().min(20).max(1024).optional(),
});

// ── Public invoice access JWT ───

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

// ── Helpers ────

/** Build the return URL AzamPay will redirect to after card payment. */
function buildCardReturnUrl(paymentRef: string, invoiceId: number, accessToken?: string): string | null {
  const base = process.env.AZAMPAY_CARD_RETURN_URL;
  if (!base) return null;
  const params = new URLSearchParams({
    ref:       paymentRef,
    invoiceId: String(invoiceId),
  });
  if (accessToken) params.set("at", accessToken);
  return `${base}?${params.toString()}`;
}

/** Safely redirect only to configured WEB_ORIGIN — prevents open redirect. */
function safeWebRedirect(res: any, path: string): void {
  const webOrigin = (process.env.WEB_ORIGIN || "").replace(/\/$/, "");
  if (!webOrigin) {
    // Dev fallback
    return res.json({ ok: true, redirect: path });
  }
  return res.redirect(`${webOrigin}${path}`);
}

// ── POST /api/payments/azampay/card/initiate ──────

router.post(
  "/initiate",
  requireAuth,
  cardUserLimiter,
  cardTargetLimiter,
  async (req, res) => {
    try {
      // 1. Validate input
      const parsed = cardInitiateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error:   "validation_error",
          details: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
        });
      }
      const { invoiceId, idempotencyKey, accessToken } = parsed.data;

      // 2. Idempotency
      const idemKey = idempotencyKey ?? `azp-card-${invoiceId}`;
      const cachedCheckout = await idemGet(idemKey);

      // 3. Require all card env vars (fail fast before hitting AzamPay)
      //    AzamPay's CardCheckout silently returns empty 200 when merchantAccountNumber
      //    or merchantMobileNumber are blank — these identify *who* receives the funds
      //    and are mandatory in their API even though the docs list them as optional.
      const cardReturnUrl  = process.env.AZAMPAY_CARD_RETURN_URL;
      const merchantAccNo  = process.env.AZAMPAY_MERCHANT_ACCOUNT_NUMBER;
      const merchantMobile = process.env.AZAMPAY_MERCHANT_MOBILE_NUMBER;
      const missingCard = [
        !cardReturnUrl  && "AZAMPAY_CARD_RETURN_URL",
        !merchantAccNo  && "AZAMPAY_MERCHANT_ACCOUNT_NUMBER",
        !merchantMobile && "AZAMPAY_MERCHANT_MOBILE_NUMBER",
      ].filter(Boolean);
      if (missingCard.length) {
        console.error(`[AzamPay/Card] Card payments not configured — missing env var(s): ${missingCard.join(", ")}`);
        return res.status(503).json({ error: "payment_unavailable", message: "Card payments are not configured" });
      }

      // 4. Load invoice
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

      // 5. Authorisation
      const authedUserId    = Number((req as any).user?.id);
      const bookingId       = Number(invoice.bookingId || invoice.booking?.id || 0);
      const bookingUserId   = invoice.booking?.userId ? Number(invoice.booking.userId) : null;
      const hasPublicAccess = verifyPublicInvoiceAccessToken(accessToken, invoice.id, bookingId);

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

      // 6. Payability checks
      if (String(invoice.invoiceNumber ?? "").startsWith("OINV-"))
        return res.status(400).json({ error: "invalid_invoice", message: "This invoice cannot be paid via this method" });
      if (invoice.status === "DRAFT" || invoice.status === "REJECTED")
        return res.status(400).json({ error: "invalid_status", message: "Invoice is not payable" });
      if (invoice.status === "PAID")
        return res.status(400).json({ error: "already_paid", message: "Invoice already paid" });

      // 7. Server-side amount
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

      // 8. Payment ref + server-side return URL
      const paymentRef = invoice.paymentRef ?? `CARD-${invoice.id}-${Date.now()}`;
      const returnUrl  = buildCardReturnUrl(paymentRef, invoice.id, accessToken)!;

      // 9. AzamPay card checkout payload
      //    merchantAccountNumber / merchantMobileNumber identify *your* merchant account
      //    on AzamPay's side; they must be populated with the real merchant config or
      //    AzamPay silently rejects the request and returns empty 200.
      const azampayBody = {
        amount:                Math.round(amount).toString(),
        currencyCode:          currency,
        merchantAccountNumber: merchantAccNo,
        merchantMobileNumber:  merchantMobile,
        merchantName:          process.env.AZAMPAY_APP_NAME || "NoLSAF",
        otp:                   "",
        provider:              "CARD",
        referenceId:           paymentRef,
        returnURL:             returnUrl,
        additionalProperties:  {
          invoiceId: invoice.id.toString(),
          bookingId: invoice.bookingId?.toString() ?? "",
        },
      };

      // 10. Acquire Bearer token
      let token: string;
      try {
        token = await getAzamPayToken();
      } catch (authErr: any) {
        console.error("[AzamPay/Card] Token acquisition failed:", authErr?.message ?? "unknown");
        return res.status(503).json({ error: "payment_unavailable", message: "Payment service temporarily unavailable" });
      }

      // 11. Call AzamPay; retry once on 401
      let apiRes = await azampayCardPost("/api/v1/Partner/CardCheckout", azampayBody, token);
      if (apiRes.status === 401) {
        await invalidateAzamPayToken();
        try { token = await getAzamPayToken(); } catch { /* handled below */ }
        apiRes = await azampayCardPost("/api/v1/Partner/CardCheckout", azampayBody, token!);
      }

      // Structured diagnostic helper — same fields every failure path emits so
      // you can grep `[AzamPay/Card] fail` and have everything AzamPay support needs.
      const diag = () => ({
        invoiceId:   invoice.id,
        paymentRef,
        httpStatus:  apiRes.status,
        bodyLen:     apiRes.body.length,
        bodyPreview: apiRes.body.slice(0, 300),
        // Merchant identity fields — confirm AzamPay sees the right merchant
        merchantAccNo,
        merchantMobile,
        // The base URL is non-secret and important for support tickets
        cardApiBase: process.env.AZAMPAY_CARD_API_URL || process.env.AZAMPAY_API_URL || "(default)",
      });

      if (!apiRes.ok) {
        console.error("[AzamPay/Card] fail (non-2xx):", JSON.stringify(diag()));
        return res.status(502).json({ error: "payment_failed", message: "Card payment could not be initiated — please try again" });
      }

      // Empty 200 is the canonical "your card request was silently rejected" signal.
      // For MNO this means push-sent; for card it means failure (no URL to redirect to).
      if (!apiRes.body.trim()) {
        console.error("[AzamPay/Card] fail (empty 200 — likely card not enabled on AzamPay merchant or required field invalid):", JSON.stringify(diag()));
        return res.status(503).json({
          error:   "card_not_available",
          message: "Card payments are not yet enabled for this merchant. Please use mobile money or bank transfer.",
        });
      }

      let azampayData: any;
      try { azampayData = JSON.parse(apiRes.body); }
      catch {
        console.error("[AzamPay/Card] fail (non-JSON 200):", JSON.stringify(diag()));
        return res.status(502).json({ error: "payment_failed", message: "Unexpected response from payment provider" });
      }

      const checkoutUrl: string | null = azampayData.checkoutUrl ?? azampayData.CheckoutUrl ?? null;
      if (!checkoutUrl) {
        console.error("[AzamPay/Card] fail (no checkoutUrl in JSON):", JSON.stringify({ ...diag(), parsedKeys: Object.keys(azampayData) }));
        return res.status(502).json({ error: "payment_failed", message: "No checkout URL returned — please try again" });
      }

      // 12. Update invoice
      await prisma.invoice.updateMany({
        where: { id: invoice.id, status: { not: "PAID" } },
        data:  {
          paymentRef:        invoice.paymentRef ?? paymentRef,
          paymentMethod:     "CARD",
          status:            "PROCESSING",
          checkoutSessionId: azampayData.transactionId ?? null,
        },
      });

      // 13. Record PaymentEvent (non-fatal)
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
            paymentChannel: "CARD",
            checkoutUrl:    checkoutUrl.slice(0, 2048),
            rawStatus:      null,
            payload: {
              transactionId: azampayData.transactionId ?? null,
              paymentRef,
              returnUrl,
            },
          },
        });
      } catch (dbErr: any) {
        console.warn("[AzamPay/Card] Failed to create PaymentEvent:", dbErr?.message ?? dbErr);
      }

      // 14. Cache and respond — client redirects browser to checkoutUrl
      const result = {
        transactionId: azampayData.transactionId ?? paymentRef,
        paymentRef,
        checkoutUrl,
        status: "PENDING",
      };
      await idemSet(idemKey, result);
      return res.json({ ok: true, idempotencyKey: idemKey, ...result });

    } catch (err: any) {
      if (process.env.NODE_ENV !== "production") {
        console.error("[AzamPay/Card] /initiate unhandled error:", err);
      } else {
        console.error("[AzamPay/Card] /initiate unhandled error:", err?.message ?? "unknown");
      }
      return res.status(500).json({ error: "internal_error", message: "An unexpected error occurred" });
    }
  }
);

// ── GET /api/payments/azampay/card/callback ──
// AzamPay redirects the user's browser here after card payment completes/fails.
// This handler is READ-ONLY — it never writes to the database.
// The HMAC-verified webhook is the authoritative write path.

router.get("/callback", async (req, res) => {
  try {
    const ref           = String(req.query.ref           ?? "");
    const invoiceId     = String(req.query.invoiceId     ?? "");
    const tourBookingId = String(req.query.tourBookingId ?? "");
    const at            = String(req.query.at            ?? "");

    // Basic validation — reject malformed refs to prevent log injection
    if (!ref || !/^[\w\-]+$/.test(ref) || ref.length > 100) {
      return res.status(400).send("Invalid callback reference");
    }

    // Determine success/failure from query params (informational only — not trusted for DB writes)
    const rawStatus = String(req.query.status ?? req.query.transactionStatus ?? "").toLowerCase();
    const isSuccess = /success|completed|paid|approved/i.test(rawStatus);

    // Check if already paid (fast path — no webhook needed)
    let alreadyPaid = false;
    if (ref) {
      try {
        if (tourBookingId) {
          // Tour booking path
          const tb = await prisma.tourBooking.findFirst({
            where:  { paymentRef: ref },
            select: { paymentStatus: true, paidAt: true },
          });
          if (tb?.paymentStatus === "PAID" || tb?.paidAt) alreadyPaid = true;
        } else {
          // Invoice path
          const inv = await prisma.invoice.findFirst({
            where:  { paymentRef: ref },
            select: { status: true },
          });
          if (inv?.status === "PAID") alreadyPaid = true;
        }
      } catch { /* non-fatal */ }
    }

    const cardReturn = alreadyPaid || isSuccess ? "success" : "pending";

    // Route to the correct payment page based on context
    const path = tourBookingId
      ? `/public/booking/tour-payment?tourBookingId=${encodeURIComponent(tourBookingId)}&accessToken=${encodeURIComponent(at)}&cardReturn=${cardReturn}&ref=${encodeURIComponent(ref)}`
      : `/public/booking/payment?invoiceId=${encodeURIComponent(invoiceId)}&accessToken=${encodeURIComponent(at)}&cardReturn=${cardReturn}&ref=${encodeURIComponent(ref)}`;

    return safeWebRedirect(res, path);

  } catch (err: any) {
    console.error("[AzamPay/Card] /callback error:", err?.message ?? err);
    return res.status(500).send("An error occurred processing the payment callback");
  }
});

export default router;
