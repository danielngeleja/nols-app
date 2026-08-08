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
 * idempotent, reference/amount/operator-checked ledger.applyProviderEvent.
 *
 * FAIL-CLOSED: this endpoint refuses to run unless at least one of those
 * controls is configured. Previously an unset allowlist meant
 * "accept from any IP" (isWebhookIpAllowed returns true for an empty list),
 * which would have let anyone POST a forged "success" callback. We no longer
 * rely on that default — if nothing is configured in production, every
 * callback is rejected until an operator sets AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS
 * and/or AZAMPAY_DISBURSE_CALLBACK_SECRET.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitAzampayDisbursementCallback } from "../middleware/rateLimit.js";
import { isWebhookIpAllowed } from "./webhooks.payments.js";
import { validateDisbursementCallbackCorrelation } from "../services/azampay/disbursement/contract.js";
import {
  applyProviderEvent,
  recordAmountMismatch,
  recordProviderCorrelationMismatch,
} from "../services/payouts/ledger.js";

export const router = Router();

/** Constant-time string compare that never short-circuits on length. */
function secretsMatch(a: string, b: string): boolean {
  // Hash both inputs to a fixed length before comparing. Returning early on
  // unequal raw lengths leaks secret-length information through timing.
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Decides whether a callback request is authorized, given the two controls we
 * can enforce today. Returns a reason string when rejecting so the caller can
 * log it. Enforcement rules:
 *  - If neither control is configured: rejected in every environment.
 *  - If an IP allowlist is configured: the source IP must be on it.
 *  - If a shared secret is configured: the request must present it, matched in
 *    constant time. Header name is configurable; defaults to x-callback-token.
 */
export function authorizeDisbursementCallback(req: Request, clientIp: string): { ok: boolean; reason?: string } {
  const allowedIps = (process.env.AZAMPAY_DISBURSE_CALLBACK_ALLOWED_IPS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const secret = (process.env.AZAMPAY_DISBURSE_CALLBACK_SECRET || "").trim();

  const hasIpControl = allowedIps.length > 0;
  const hasSecretControl = secret.length > 0;

  if (!hasIpControl && !hasSecretControl) {
    return { ok: false, reason: "no callback authentication configured (fail-closed)" };
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

export const azamPayDisbursementCallbackSchema = z.object({
  initiatorReferenceId: z.string().trim().min(1),
  fspReferenceId: z.string().trim().default(""),
  pgReferenceId: z.string().trim().min(1),
  amount: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((value) => value.trim().length > 0 && Number.isFinite(Number(value)), "amount must be numeric"),
  status: z
    .string()
    .trim()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(["success", "failure"])),
  message: z.string().trim().default(""),
  operator: z.string().trim().min(1),
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

    const parsed = azamPayDisbursementCallbackSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn("[AzamPay Disbursement Callback] rejected: invalid payload shape", parsed.error.flatten());
      // Still 200 — AzamPay should not endlessly retry a payload we will never accept.
      return res.status(200).json({ ok: false, error: "invalid_payload" });
    }
    const cb = parsed.data;

    const disbursement = await prisma.disbursement.findUnique({
      where: { externalReferenceId: cb.initiatorReferenceId },
      select: {
        id: true,
        externalReferenceId: true,
        pgReferenceId: true,
        amount: true,
        bankName: true,
      },
    });
    if (!disbursement) {
      // Unknown reference: log for review, but do not error — nothing to retry into existence.
      console.warn(`[AzamPay Disbursement Callback] no disbursement for externalReferenceId=${cb.initiatorReferenceId}`);
      return res.status(200).json({ ok: true, matched: false });
    }

    const mismatch = validateDisbursementCallbackCorrelation(disbursement, cb);
    if (mismatch) {
      console.error(
        `[AzamPay Disbursement Callback] ${mismatch.code} on disbursement ${disbursement.id}: ` +
          `expected ${mismatch.expected}, received ${mismatch.received}`
      );
      if (mismatch.code === "amount_mismatch") {
        await recordAmountMismatch(disbursement.id, {
          expected: mismatch.expected,
          received: mismatch.received,
          source: "CALLBACK",
          payload: cb,
        });
      } else {
        await recordProviderCorrelationMismatch(disbursement.id, {
          code: mismatch.code,
          expected: mismatch.expected,
          received: mismatch.received,
          payload: cb,
        });
      }
      return res.status(200).json({ ok: true, matched: true, flagged: mismatch.code });
    }

    await applyProviderEvent(disbursement.id, { eventType: "CALLBACK", callback: cb });

    return res.status(200).json({ ok: true, matched: true });
  })
);

export default router;
