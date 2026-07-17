import crypto from "crypto";
import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { reconcileNrmsPayment } from "../lib/nrmsBilling.js";

export const router = Router();
const callbackSchema = z.object({ token: z.string().min(10), provider: z.string().min(2).max(30), providerRef: z.string().min(2).max(120), idempotencyKey: z.string().min(8).max(120), amount: z.number().positive() });

router.post("/callback", (async (req, res) => {
  const configured = process.env.NRMS_PAYMENT_CALLBACK_SECRET || "";
  const supplied = String(req.header("x-nrms-callback-secret") || "");
  if (!configured || supplied.length !== configured.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(configured))) {
    return res.status(401).json({ error: "Invalid callback authentication" });
  }
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payment callback", details: parsed.error.flatten() });
  try {
    const payment = await prisma.$transaction((tx: any) => reconcileNrmsPayment(tx, parsed.data));
    res.json({ accepted: true, paymentId: payment.id, status: payment.status });
  } catch (error: any) {
    if (error?.code === "P2002") return res.json({ accepted: true, duplicate: true });
    const message = String(error?.message || "");
    if (message.includes("NOT_FOUND")) return res.status(404).json({ error: "Payment token not found" });
    if (message.includes("AMOUNT_MISMATCH")) return res.status(409).json({ error: "Payment amount does not match the token" });
    if (message.includes("TOKEN_EXPIRED")) return res.status(409).json({ error: "Payment token has expired" });
    if (message.includes("TOKEN_INVALID_STATUS")) return res.status(409).json({ error: "Payment token is no longer usable" });
    if (message.includes("STATEMENT_NOT_PAYABLE")) return res.status(409).json({ error: "Statement is already settled or no longer payable" });
    console.error("[nrms.payment.callback] failed", error);
    res.status(500).json({ error: "Failed to reconcile NRMS payment" });
  }
}) as RequestHandler);

export default router;
