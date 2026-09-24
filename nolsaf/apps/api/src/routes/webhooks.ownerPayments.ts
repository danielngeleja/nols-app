import { Router, type RequestHandler } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";

import { ingestProviderEvent } from "../services/payments/inbox.js";
import { AzamPayOwnerCollectionAdapter } from "../services/payments/providers/azampayOwner.js";

const router = Router();

async function projectSettledGuestPayment(intentId: number) {
  const intent = await prisma.paymentIntent.findUnique({
    where: { id: intentId },
    select: { id: true, sourceType: true, sourceId: true, amount: true, reference: true, settledAt: true },
  });
  if (!intent || intent.sourceType !== "NRMS_GUEST_PAYMENT_REQUEST") return;

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
  if (result.state === "PROCESSED" && result.changed && result.intentStatus === "SUCCEEDED") await projectSettledGuestPayment(result.intentId);
  // Valid events are acknowledged even when parked for review, preventing a
  // provider retry storm while preserving the operator evidence.
  res.status(202).json({ received: true });
}) as RequestHandler);

export default router;
