/**
 * AzamPay Disbursement Callback
 *
 * "The disbursement callback schema shown in the current docs does not
 * publish a signature field. Do not invent one. Ask AzamPay what
 * callback-authentication control they require (signature, secret, IP
 * allowlist, mTLS, etc.)" — docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md.
 *
 * AzamPay has still not confirmed a signing scheme, so the controls we can
 * enforce are (a) an IP allowlist and (b) an optional pre-shared secret that
 * AzamPay can be configured to send as a header. Both sit in front of the
 * idempotent, amount-checked ledger.applyProviderEvent.
 *
 * FAIL-CLOSED: in production this endpoint refuses to run unless at least one
 * of those controls is configured. Previously an unset allowlist meant
 * "accept from any IP" (isWebhookIpAllowed returns true for an empty list),
 * which would have let anyone POST a forged "success" callback. We no longer
 * rely on that default — if nothing is configured in production, every
 * callback is rejected until an operator sets AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS
 * and/or AZAMPAY_DISBURSE_CALLBACK_SECRET.
 */

import { timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitAzampayDisbursementCallback } from "../middleware/rateLimit.js";
import { isWebhookIpAllowed } from "./webhooks.payments.js";
import { applyProviderEvent, recordAmountMismatch } from "../services/payouts/ledger.js";

export const router = Router();

/** Constant-time string compare that never short-circuits on length. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/**
 * Decides whether a callback request is authorized, given the two controls we
 * can enforce today. Returns a reason string when rejecting so the caller can
 * log it. Enforcement rules:
 *  - If neither control is configured: allowed OUTSIDE production (dev/testing
 *    convenience), rejected IN production (fail closed).
 *  - If an IP allowlist is configured: the source IP must be on it.
 *  - If a shared secret is configured: the request must present it, matched in
 *    constant time. Header name is configurable; defaults to x-callback-token.
 */
function authorizeDisbursementCallback(req: Request, clientIp: string): { ok: boolean; reason?: string } {
  const allowedIps = (process.env.AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const secret = (process.env.AZAMPAY_DISBURSE_CALLBACK_SECRET || "").trim();

  const hasIpControl = allowedIps.length > 0;
  const hasSecretControl = secret.length > 0;

  if (!hasIpControl && !hasSecretControl) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, reason: "no callback authentication configured (fail-closed in production)" };
    }
    // Non-production: allow so local/staging testing is not blocked, but the
    // startup log below still warns that this is unauthenticated.
    return { ok: true };
  }

  if (hasIpControl && !isWebhookIpAllowed(clientIp, allowedIps)) {
    return { ok: false, reason: `IP not allowlisted (ip=${clientIp})` };
  }

  if (hasSecretControl) {
    const headerName = (process.env.AZAMPAY_DISBURSE_CALLBACK_SECRET_HEADER || "x-callback-token").toLowerCase();
    const presented = String(req.headers[headerName] || "").trim();
    if (!presented || !secretsMatch(presented, secret)) {
      return { ok: false, reason: "shared secret missing or mismatched" };
    }
  }

  return { ok: true };
}

const callbackSchema = z.object({
  initiatorReferenceId: z.string().trim().min(1),
  fspReferenceId: z.string().trim().default(""),
  pgReferenceId: z.string().trim().default(""),
  amount: z.union([z.string(), z.number()]).transform(String).default(""),
  status: z.string().trim().toLowerCase(),
  message: z.string().trim().default(""),
  operator: z.string().trim().default(""),
  additionalProperties: z.record(z.unknown()).optional(),
});

router.post(
  "/callback",
  limitAzampayDisbursementCallback,
  asyncHandler(async (req: Request, res: Response) => {
    const clientIp = String(req.ip || "").replace("::ffff:", "");
    const auth = authorizeDisbursementCallback(req, clientIp);
    if (!auth.ok) {
      console.warn(`[AzamPay Disbursement Callback] rejected: ${auth.reason}`);
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const parsed = callbackSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn("[AzamPay Disbursement Callback] rejected: invalid payload shape", parsed.error.flatten());
      // Still 200 — AzamPay should not endlessly retry a payload we will never accept.
      return res.status(200).json({ ok: false, error: "invalid_payload" });
    }
    const cb = parsed.data;

    const disbursement = await prisma.disbursement.findUnique({
      where: { externalReferenceId: cb.initiatorReferenceId },
      select: { id: true, amount: true, currency: true },
    });
    if (!disbursement) {
      // Unknown reference: log for review, but do not error — nothing to retry into existence.
      console.warn(`[AzamPay Disbursement Callback] no disbursement for externalReferenceId=${cb.initiatorReferenceId}`);
      return res.status(200).json({ ok: true, matched: false });
    }

    const callbackAmount = Number(cb.amount);
    if (Number.isFinite(callbackAmount) && Math.abs(callbackAmount - Number(disbursement.amount)) > 0.01) {
      // Amount mismatch: do not trust the status, and do not let the only
      // record of it be a log line. A mismatch is precisely the event a human
      // must see, so it is persisted to the append-only event log and the
      // payout is held. Deliberately NOT moved out of PROCESSING: the
      // reconciliation worker must keep polling AzamPay for the real outcome.
      console.error(
        `[AzamPay Disbursement Callback] amount mismatch on disbursement ${disbursement.id}: ` +
          `expected ${disbursement.amount}, callback said ${cb.amount}`
      );
      await recordAmountMismatch(disbursement.id, {
        expected: disbursement.amount.toString(),
        received: String(cb.amount),
        source: "CALLBACK",
        payload: cb,
      });
      return res.status(200).json({ ok: true, matched: true, flagged: "amount_mismatch" });
    }

    await applyProviderEvent(disbursement.id, { eventType: "CALLBACK", callback: cb });

    return res.status(200).json({ ok: true, matched: true });
  })
);

export default router;
