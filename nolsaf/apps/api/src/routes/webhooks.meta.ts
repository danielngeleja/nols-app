import crypto from "node:crypto";
import { Router, type RequestHandler, type Request, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { buildInquiryAcknowledgement } from "../lib/nrmsInquiryAcknowledgement.js";
import { parseMetaWebhook, sendMetaText, verifyMetaWebhookSignature, type MetaInboundMessage } from "../lib/nrmsMetaMessaging.js";
import { publicNrmsGuestContact } from "../lib/nrmsGuestContact.js";

export const router = Router();

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function prismaCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : null;
}
function datesFromMessage(body: string): { checkIn: string | null; checkOut: string | null } {
  const dates = body.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  return { checkIn: dates[0] ?? null, checkOut: dates[1] ?? null };
}

router.get("/", ((req: Request, res: Response) => {
  const expected = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "");
  const mode = String(req.query["hub.mode"] || "");
  const supplied = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  if (!expected || mode !== "subscribe" || !secureEqual(supplied, expected)) return res.sendStatus(403);
  return res.status(200).send(challenge);
}) as RequestHandler);

async function findConnection(event: { provider: string; accountId: string }) {
  return prisma.nrmsMessagingConnection.findFirst({
    where: event.provider === "WHATSAPP"
      ? { provider: "WHATSAPP", phoneNumberId: event.accountId, status: "CONNECTED" }
      : { provider: "INSTAGRAM", externalAccountId: event.accountId, status: "CONNECTED" },
    include: { property: { select: { id: true, ownerId: true, title: true, nrmsGuestContactSettings: true } } },
  });
}

async function receiveMessage(event: MetaInboundMessage) {
  const connection = await findConnection(event);
  if (!connection) return false;
  const existingMessage = await prisma.nrmsGuestMessage.findUnique({ where: { providerMessageId: event.providerMessageId }, select: { id: true } });
  if (existingMessage) return true;

  const channel = event.provider;
  const recentClick = event.provider === "WHATSAPP"
    ? await prisma.nrmsGuestInquiry.findFirst({
        where: {
          propertyId: connection.propertyId,
          channel,
          externalConversationId: null,
          guestPhone: { contains: event.senderId.slice(-9) },
          status: { notIn: ["CONVERTED", "CLOSED"] },
          createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const existingInquiry = recentClick ?? await prisma.nrmsGuestInquiry.findFirst({
    where: { propertyId: connection.propertyId, channel, externalConversationId: event.senderId, status: { notIn: ["CONVERTED", "CLOSED"] } },
    orderBy: { createdAt: "desc" },
  });
  const parsedDates = datesFromMessage(event.body);
  const now = new Date();
  let inquiryId: number;
  let newConversation = false;

  if (existingInquiry) {
    inquiryId = existingInquiry.id;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.nrmsGuestMessage.create({ data: { inquiryId, direction: "INBOUND", channel, providerMessageId: event.providerMessageId, senderName: event.senderName, body: event.body, deliveryStatus: "DELIVERED", createdAt: event.occurredAt, metadata: { externalSenderId: event.senderId } } });
        await tx.nrmsGuestInquiry.update({ where: { id: inquiryId }, data: { externalConversationId: event.senderId, guestName: existingInquiry.guestName || event.senderName, guestPhone: existingInquiry.guestPhone || (event.provider === "WHATSAPP" ? event.senderId : null), checkIn: existingInquiry.checkIn || (parsedDates.checkIn ? new Date(`${parsedDates.checkIn}T00:00:00.000Z`) : null), checkOut: existingInquiry.checkOut || (parsedDates.checkOut ? new Date(`${parsedDates.checkOut}T00:00:00.000Z`) : null), status: existingInquiry.status === "WAITING_GUEST" ? "OPEN" : existingInquiry.status, lastMessageAt: event.occurredAt, version: { increment: 1 } } });
      });
    } catch (error) { if (prismaCode(error) !== "P2002") throw error; }
  } else {
    newConversation = true;
    const inquiry = await prisma.nrmsGuestInquiry.create({
      data: {
        propertyId: connection.propertyId,
        ownerId: connection.ownerId,
        reference: `INQ-${connection.propertyId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        channel,
        source: channel,
        externalConversationId: event.senderId,
        guestName: event.senderName,
        guestPhone: event.provider === "WHATSAPP" ? event.senderId : null,
        checkIn: parsedDates.checkIn ? new Date(`${parsedDates.checkIn}T00:00:00.000Z`) : null,
        checkOut: parsedDates.checkOut ? new Date(`${parsedDates.checkOut}T00:00:00.000Z`) : null,
        lastMessageAt: event.occurredAt,
        messages: { create: { direction: "INBOUND", channel, providerMessageId: event.providerMessageId, senderName: event.senderName, body: event.body, deliveryStatus: "DELIVERED", createdAt: event.occurredAt, metadata: { externalSenderId: event.senderId } } },
      },
      select: { id: true },
    });
    inquiryId = inquiry.id;
  }

  await prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastWebhookAt: now, lastError: null, version: { increment: 1 } } });
  if (!newConversation) return true;

  const contact = publicNrmsGuestContact(connection.property.nrmsGuestContactSettings);
  const acknowledgement = buildInquiryAcknowledgement({
    propertyTitle: connection.property.title,
    guestName: event.senderName,
    checkIn: parsedDates.checkIn,
    checkOut: parsedDates.checkOut,
    channels: { whatsapp: Boolean(contact?.whatsappPhone), instagram: Boolean(contact?.instagramUsername), phone: Boolean(contact?.receptionPhone) },
  });
  try {
    const providerMessageId = await sendMetaText(connection, event.senderId, acknowledgement);
    await prisma.$transaction([
      prisma.nrmsGuestMessage.create({ data: { inquiryId, direction: "OUTBOUND", channel, providerMessageId, senderName: `${connection.property.title} reception`, body: acknowledgement, deliveryStatus: "SENT", metadata: { automated: true, kind: "INQUIRY_ACKNOWLEDGEMENT" } } }),
      prisma.nrmsGuestInquiry.update({ where: { id: inquiryId }, data: { autoAcknowledgedAt: now, lastMessageAt: now, version: { increment: 1 } } }),
      prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastOutboundAt: now, lastError: null, version: { increment: 1 } } }),
    ]);
  } catch (error) {
    await prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastError: String(error instanceof Error ? error.message : error).slice(0, 1000), version: { increment: 1 } } });
  }
  return true;
}

router.post("/", (async (req: Request, res: Response) => {
  const appSecret = String(process.env.META_APP_SECRET || "");
  if (!appSecret) return res.status(503).json({ error: "Meta webhook is not configured" });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  if (!verifyMetaWebhookSignature(rawBody, req.header("x-hub-signature-256"), appSecret)) return res.sendStatus(401);
  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { return res.status(400).json({ error: "Invalid Meta webhook payload" }); }
  try {
    const events = parseMetaWebhook(payload);
    let processed = 0;
    for (const event of events) {
      if (event.kind === "DELIVERY") {
        const connection = await findConnection(event); if (!connection) continue;
        await prisma.nrmsGuestMessage.updateMany({ where: { providerMessageId: event.providerMessageId }, data: { deliveryStatus: event.status } });
        await prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastWebhookAt: new Date(), ...(event.error ? { lastError: event.error } : {}), version: { increment: 1 } } });
        processed += 1;
      } else if (await receiveMessage(event)) processed += 1;
    }
    return res.status(200).json({ received: true, processed });
  } catch (error) {
    console.error("[webhooks.meta] processing failed", error);
    return res.status(500).json({ error: "Meta webhook could not be processed" });
  }
}) as RequestHandler);

export default router;
