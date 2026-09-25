import { Router, type RequestHandler } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";

import { ingestProviderEvent } from "../services/payments/inbox.js";
import { AzamPayOwnerCollectionAdapter } from "../services/payments/providers/azampayOwner.js";
import { buildMasterPaymentReceiptNumber, refreshMasterFolioStatus } from "../lib/nrmsMasterFolio.js";
import { fiscaliseSettlement } from "../lib/nrmsFiscal.js";

const router = Router();

async function projectSettledPayment(intentId: number) {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true, sourceType: true, sourceId: true, amount: true, currency: true,
      reference: true, settledAt: true, createdAt: true, propertyId: true,
      attempts: { orderBy: { startedAt: "desc" }, take: 1, select: { channel: true, providerRef: true } },
    },
  });
  if (!intent) return;

  if (intent.sourceType === "NRMS_GUEST_PAYMENT_REQUEST") {
    await prisma.$transaction(async (tx) => {
      const request = await tx.nrmsGuestPaymentRequest.findUnique({ where: { id: intent.sourceId }, select: { id: true, reservationId: true, status: true } });
      if (!request || request.status === "SETTLED") return;
      const changed = await tx.nrmsGuestPaymentRequest.updateMany({ where: { id: request.id, status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "SETTLED", settledAt: intent.settledAt ?? new Date() } });
      if (!changed.count) return;
      await tx.reservation.update({ where: { id: request.reservationId }, data: { amountPaid: { increment: intent.amount } } });
      // Never resurrect a reservation that was cancelled/expired while the
      // provider outcome was unresolved. That money remains settled evidence
      // for staff reconciliation, but only a still-held room is confirmed.
      await tx.reservation.updateMany({ where: { id: request.reservationId, status: "HELD" }, data: { status: "CONFIRMED", holdExpiresAt: null } });
      await tx.reservationEvent.create({ data: { reservationId: request.reservationId, type: "PAYMENT_RECEIVED", data: { paymentIntentId: intent.id, paymentReference: intent.reference, source: "PROVIDER_WEBHOOK" } } });
    });
    return;
  }

  if (intent.sourceType !== "NRMS_MASTER_FOLIO") return;
  await prisma.$transaction(async (tx) => {
    const folio = await tx.nrmsMasterFolio.findUnique({
      where: { id: intent.sourceId },
      select: { id: true, propertyId: true, currency: true },
    });
    if (!folio || folio.propertyId !== intent.propertyId || folio.currency !== intent.currency) return;
    const idempotencyKey = `payment-intent:${intent.id}`;
    const duplicate = await tx.nrmsMasterFolioPayment.findUnique({
      where: { masterFolioId_idempotencyKey: { masterFolioId: folio.id, idempotencyKey } },
    });
    if (duplicate) return;
    const attempt = intent.attempts[0];
    const payment = await tx.nrmsMasterFolioPayment.create({
      data: {
        masterFolioId: folio.id,
        amount: intent.amount,
        currency: intent.currency,
        method: attempt?.channel === "MNO" ? "MOBILE_MONEY" : attempt?.channel === "BANK" ? "BANK" : "CARD",
        reference: attempt?.providerRef ?? intent.reference,
        idempotencyKey,
        receiptNumber: buildMasterPaymentReceiptNumber(folio.id),
        note: `AzamPay payment ${intent.reference}`,
        recordedById: null,
      },
    });
    await fiscaliseSettlement(tx, {
      propertyId: folio.propertyId,
      sourceType: "MASTER_FOLIO_PAYMENT",
      sourceId: payment.id,
      saleOccurredAt: intent.settledAt ?? new Date(),
      currency: intent.currency,
      grossAmount: Number(intent.amount),
    });
    await refreshMasterFolioStatus(tx, folio.id);
    await tx.nrmsMasterFolioPaymentLink.updateMany({
      where: {
        masterFolioId: folio.id,
        status: { in: ["ACTIVE", "PROCESSING", "EXPIRED", "STALE"] },
        createdAt: { lte: intent.createdAt },
        expiresAt: { gte: intent.createdAt },
      },
      data: { status: "PAID", paidAt: intent.settledAt ?? new Date() },
    });
  });
}

router.post("/:connectionId", (async (req, res) => {
  const connectionId = Number(req.params.connectionId);
  if (!Number.isInteger(connectionId) || connectionId <= 0) return res.status(404).json({ received: false });
  const connection = await prisma.providerConnection.findUnique({ where: { id: connectionId }, select: { provider: true, environment: true, capabilities: true } });
  if (!connection || connection.provider !== "AZAMPAY" || !["SANDBOX", "STAGING", "PRODUCTION"].includes(connection.environment)) return res.status(404).json({ received: false });
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : typeof req.body === "string" ? req.body : "";
  const headers = Object.fromEntries(Object.entries(req.headers).map(([key, value]) => [key.toLowerCase(), Array.isArray(value) ? value[0] : value]));
  const adapter = new AzamPayOwnerCollectionAdapter({ environment: connection.environment as "SANDBOX" | "STAGING" | "PRODUCTION", capabilities: connection.capabilities });
  const verified = await adapter.verifyAndNormalizeWebhook({ rawBody, headers, sourceIp: req.ip });
  if (!verified.ok) return res.status(401).json({ received: false });
  const result = await ingestProviderEvent(prisma, connectionId, verified.event);
  if (!result.ok) return res.status(401).json({ received: false });
  // Projection is idempotent, so replaying an already-processed success also
  // repairs a prior write-back failure instead of leaving paid money stranded.
  if (result.state === "PROCESSED" && result.intentStatus === "SUCCEEDED") await projectSettledPayment(result.intentId);
  // Valid events are acknowledged even when parked for review, preventing a
  // provider retry storm while preserving the operator evidence.
  res.status(202).json({ received: true });
}) as RequestHandler);

export default router;
