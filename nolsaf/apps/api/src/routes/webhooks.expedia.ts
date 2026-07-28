import crypto from "node:crypto";
import { Router, type RequestHandler } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { parseExpediaReservationNotification } from "../lib/channels/expediaReservations.js";
import { verifyExpediaWebhook } from "../lib/channels/expediaWebhook.js";

const router = Router();
const db = prisma;

// Expedia issues a one-time GET immediately after callback registration.
router.get("/reservations", ((_req, res) => res.status(204).end()) as RequestHandler);

router.post("/reservations", (async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const valid = verifyExpediaWebhook({
    rawBody,
    apiKeyHeader: String(req.get("api-key") || ""),
    timestampHeader: String(req.get("x-eg-notification-timestamp") || ""),
    signatureHeader: String(req.get("x-eg-notification-signature-v2") || ""),
    expectedApiKey: String(process.env.EXPEDIA_NOTIFICATION_API_KEY || ""),
    secrets: [String(process.env.EXPEDIA_NOTIFICATION_SECRET || ""), String(process.env.EXPEDIA_NOTIFICATION_PREVIOUS_SECRET || "")],
  });
  if (!valid) return res.status(401).json({ error: "Invalid Expedia notification signature" });
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid Expedia notification payload" });
  }
  const notification = parseExpediaReservationNotification(parsedBody);
  if (!notification) return res.status(400).json({ error: "Unsupported Expedia reservation notification" });
  const connection = await db.channelConnection.findFirst({
    where: { externalPropertyId: notification.propertyId, provider: { code: "EXPEDIA" }, status: { in: ["ACTIVE", "PILOT", "ERROR"] } },
    select: { id: true },
  });
  if (!connection) return res.status(404).json({ error: "Expedia property connection was not found" });
  const payload = {
    propertyId: notification.propertyId,
    reservationId: notification.reservationId,
    actionType: notification.actionType,
    confirmationToken: notification.confirmationToken,
    transactionId: String(req.get("transactionid") || req.get("transaction-id") || "") || null,
  };
  try {
    await db.channelInboundEvent.create({
      data: {
        connectionId: connection.id,
        providerEventId: notification.notificationId,
        idempotencyKey: `${connection.id}:expedia-notification:${notification.notificationId}`,
        eventType: notification.eventName.slice(0, 80),
        payloadHash: crypto.createHash("sha256").update(rawBody).digest("hex"),
        payload,
        status: "RECEIVED",
      },
    });
    return res.status(202).json({ accepted: true });
  } catch (error: any) {
    if (error?.code === "P2002") return res.status(202).json({ accepted: true, duplicate: true });
    throw error;
  }
}) as RequestHandler);

export default router;
