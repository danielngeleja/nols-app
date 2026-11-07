import { Router, type Request, type Response } from "express";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { verifyOwnerPayoutReceipt } from "../lib/ownerPayoutReceiptSeal.js";
import { verifySalesPayoutReceipt } from "../lib/salesPayoutReceiptSeal.js";

const router = Router();

const verifyLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

router.get("/verify", verifyLimiter, (req: Request, res: Response) => {
  const token = String(req.query.token || req.query.t || "").trim();
  if (!token) return res.status(400).json({ ok: false, error: "Missing token" });

  const receipt = verifyOwnerPayoutReceipt(token);
  if (!receipt) {
    // Sales partner payout receipts share this verification page.
    const sales = verifySalesPayoutReceipt(token);
    if (!sales) return res.json({ ok: true, valid: false });
    return res.json({
      ok: true,
      valid: true,
      receipt: {
        kind: "SALES",
        issuer: sales.issuer,
        documentType: "NoLSAF sales partner payout confirmation",
        receiptNumber: sales.receiptNumber,
        invoiceNumber: sales.withdrawalReference,
        amount: sales.amount,
        currency: sales.currency,
        provider: sales.paymentMethod,
        providerReference: sales.providerReference,
        nolsafReference: sales.nolsafReference,
        maskedDestination: sales.maskedDestination,
        propertyName: sales.partnerName,
        settledAt: sales.settledAt,
        issuedAt: sales.issuedAt,
        timeZone: sales.timeZone,
        verificationId: sales.snapshotHash.slice(0, 16).toUpperCase(),
        disclaimer: sales.disclaimer,
      },
    });
  }

  return res.json({
    ok: true,
    valid: true,
    receipt: {
      kind: "OWNER",
      issuer: receipt.issuer,
      documentType: "NoLSAF owner payout confirmation",
      receiptNumber: receipt.receiptNumber,
      invoiceNumber: receipt.invoiceNumber,
      amount: receipt.amount,
      currency: receipt.currency,
      provider: receipt.provider,
      providerReference: receipt.providerReference,
      nolsafReference: receipt.nolsafReference,
      maskedDestination: receipt.maskedDestination,
      propertyName: receipt.propertyName,
      settledAt: receipt.settledAt,
      issuedAt: receipt.issuedAt,
      timeZone: receipt.timeZone,
      verificationId: receipt.snapshotHash.slice(0, 16).toUpperCase(),
      disclaimer: receipt.disclaimer,
    },
  });
});

export default router;
