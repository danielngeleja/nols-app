import crypto from "node:crypto";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { buildInquiryAcknowledgement } from "./nrmsInquiryAcknowledgement.js";
import { publicNrmsGuestContact } from "./nrmsGuestContact.js";
import { nrmsMetaConversationKey } from "./nrmsMetaConversation.js";
import { sendMetaText, type MetaInboundMessage, type MetaWebhookEvent } from "./nrmsMetaMessaging.js";
import { emitNrmsInboxUpdate } from "../sockets/index.js";

const WEBHOOK_BATCH_SIZE = 25;
const OUTBOUND_BATCH_SIZE = 20;
const MAX_ATTEMPTS = 8;
const CLAIM_TIMEOUT_MS = 5 * 60_000;
const WHATSAPP_CUSTOMER_WINDOW_MS = 24 * 60 * 60_000;

function prismaCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code || "") : null;
}

function errorText(error: unknown): string {
  return String(error instanceof Error ? error.message : error).slice(0, 1000);
}

function nextAttemptAt(now: Date, attempt: number): Date {
  const seconds = Math.min(6 * 60 * 60, 15 * 2 ** Math.max(0, attempt - 1));
  return new Date(now.getTime() + seconds * 1000);
}

function datesFromMessage(body: string): { checkIn: string | null; checkOut: string | null } {
  const dates = body.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
  return { checkIn: dates[0] ?? null, checkOut: dates[1] ?? null };
}

function normalizedEvent(event: MetaWebhookEvent): Record<string, unknown> {
  return { ...event, occurredAt: event.occurredAt.toISOString() };
}

function webhookDedupeKey(event: MetaWebhookEvent): string {
  const discriminator = event.kind === "DELIVERY" ? event.status : "INBOUND";
  return crypto.createHash("sha256").update(`${event.provider}:${event.kind}:${event.providerMessageId}:${discriminator}`).digest("hex");
}

export async function enqueueMetaWebhookEvents(events: MetaWebhookEvent[]): Promise<{ accepted: number }> {
  if (!events.length) return { accepted: 0 };
  const result = await prisma.nrmsMetaWebhookJob.createMany({
    data: events.map((event) => ({
      dedupeKey: webhookDedupeKey(event),
      provider: event.provider,
      accountId: event.accountId,
      eventKind: event.kind,
      payload: normalizedEvent(event) as any,
    })),
    skipDuplicates: true,
  });
  return { accepted: result.count };
}

function deserializeEvent(payload: unknown): MetaWebhookEvent {
  const value = payload as Record<string, unknown>;
  return { ...value, occurredAt: new Date(String(value.occurredAt)) } as MetaWebhookEvent;
}

async function findConnection(event: { provider: string; accountId: string }) {
  return prisma.nrmsMessagingConnection.findFirst({
    where: event.provider === "WHATSAPP"
      ? { provider: "WHATSAPP", phoneNumberId: event.accountId, status: "CONNECTED" }
      : { provider: "INSTAGRAM", externalAccountId: event.accountId, status: "CONNECTED" },
    include: { property: { select: { id: true, ownerId: true, title: true, nrmsGuestContactSettings: true } } },
  });
}

async function receiveMessage(event: MetaInboundMessage, connection: Awaited<ReturnType<typeof findConnection>>): Promise<number> {
  if (!connection) throw new Error("META_CONNECTION_NOT_FOUND");
  const existingMessage = await prisma.nrmsGuestMessage.findUnique({ where: { providerMessageId: event.providerMessageId }, select: { id: true, inquiryId: true } });
  if (existingMessage) return existingMessage.inquiryId;

  const channel = event.provider;
  const activeConversationKey = nrmsMetaConversationKey(connection.propertyId, channel, event.senderId);
  const activeInquiry = await prisma.nrmsGuestInquiry.findUnique({ where: { activeConversationKey } });
  const recentClick = !activeInquiry && event.provider === "WHATSAPP"
    ? await prisma.nrmsGuestInquiry.findFirst({
        where: {
          propertyId: connection.propertyId,
          channel,
          externalConversationId: null,
          guestPhone: { contains: event.senderId.slice(-9) },
          status: { notIn: ["RESOLVED", "CONVERTED", "CLOSED"] },
          createdAt: { gte: new Date(Date.now() - 30 * 60_000) },
        },
        orderBy: { createdAt: "desc" },
      })
    : null;
  const parsedDates = datesFromMessage(event.body);
  let inquiry = activeInquiry ?? recentClick;
  let newConversation = false;

  if (recentClick) {
    try {
      inquiry = await prisma.nrmsGuestInquiry.update({ where: { id: recentClick.id }, data: { activeConversationKey, externalConversationId: event.senderId } });
    } catch (error) {
      if (prismaCode(error) !== "P2002") throw error;
      inquiry = await prisma.nrmsGuestInquiry.findUnique({ where: { activeConversationKey } });
    }
  }

  if (!inquiry) {
    try {
      inquiry = await prisma.nrmsGuestInquiry.create({
        data: {
          propertyId: connection.propertyId,
          ownerId: connection.ownerId,
          reference: `INQ-${connection.propertyId}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
          channel,
          source: channel,
          externalConversationId: event.senderId,
          activeConversationKey,
          guestName: event.senderName,
          guestPhone: event.provider === "WHATSAPP" ? event.senderId : null,
          checkIn: parsedDates.checkIn ? new Date(`${parsedDates.checkIn}T00:00:00.000Z`) : null,
          checkOut: parsedDates.checkOut ? new Date(`${parsedDates.checkOut}T00:00:00.000Z`) : null,
          lastMessageAt: event.occurredAt,
        },
      });
      newConversation = true;
    } catch (error) {
      if (prismaCode(error) !== "P2002") throw error;
      inquiry = await prisma.nrmsGuestInquiry.findUnique({ where: { activeConversationKey } });
    }
  }

  if (!inquiry) throw new Error("ACTIVE_META_INQUIRY_NOT_FOUND");
  const inquiryId = inquiry.id;
  const now = new Date();
  const contact = publicNrmsGuestContact(connection.property.nrmsGuestContactSettings);
  const acknowledgement = newConversation ? buildInquiryAcknowledgement({
    propertyTitle: connection.property.title,
    guestName: event.senderName,
    checkIn: parsedDates.checkIn,
    checkOut: parsedDates.checkOut,
    channels: { whatsapp: Boolean(contact?.whatsappPhone), instagram: Boolean(contact?.instagramUsername), phone: Boolean(contact?.receptionPhone) },
  }) : null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.nrmsGuestMessage.create({
        data: {
          inquiryId,
          direction: "INBOUND",
          channel,
          providerMessageId: event.providerMessageId,
          senderName: event.senderName,
          body: event.body,
          deliveryStatus: "DELIVERED",
          createdAt: event.occurredAt,
          metadata: { externalSenderId: event.senderId, ...(event.attachment ? { attachment: event.attachment } : {}) },
        },
      });
      if (acknowledgement) {
        await tx.nrmsGuestMessage.create({
          data: {
            inquiryId,
            direction: "OUTBOUND",
            channel,
            senderName: `${connection.property.title} reception`,
            body: acknowledgement,
            deliveryStatus: "QUEUED",
            nextAttemptAt: now,
            metadata: { automated: true, kind: "INQUIRY_ACKNOWLEDGEMENT", recipientId: event.senderId },
          },
        });
      }
      await tx.nrmsGuestInquiry.update({
        where: { id: inquiryId },
        data: {
          activeConversationKey,
          externalConversationId: event.senderId,
          guestName: inquiry.guestName || event.senderName,
          guestPhone: inquiry.guestPhone || (event.provider === "WHATSAPP" ? event.senderId : null),
          checkIn: inquiry.checkIn || (parsedDates.checkIn ? new Date(`${parsedDates.checkIn}T00:00:00.000Z`) : null),
          checkOut: inquiry.checkOut || (parsedDates.checkOut ? new Date(`${parsedDates.checkOut}T00:00:00.000Z`) : null),
          status: inquiry.status === "WAITING_GUEST" ? "OPEN" : inquiry.status,
          lastMessageAt: event.occurredAt,
          version: { increment: 1 },
        },
      });
    });
  } catch (error) {
    if (prismaCode(error) !== "P2002") throw error;
  }

  await prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastWebhookAt: now, lastError: null, version: { increment: 1 } } });
  return inquiryId;
}

async function processWebhookEvent(event: MetaWebhookEvent, knownConnection?: Awaited<ReturnType<typeof findConnection>>): Promise<{ propertyId: number; inquiryId: number | null }> {
  const connection = knownConnection ?? await findConnection(event);
  if (!connection) throw new Error("META_CONNECTION_NOT_FOUND");
  if (event.kind === "DELIVERY") {
    await prisma.$transaction([
      prisma.nrmsGuestMessage.updateMany({ where: { providerMessageId: event.providerMessageId }, data: { deliveryStatus: event.status, ...(event.error ? { errorMessage: event.error } : {}) } }),
      prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastWebhookAt: new Date(), ...(event.error ? { lastError: event.error } : {}), version: { increment: 1 } } }),
    ]);
    const message = await prisma.nrmsGuestMessage.findUnique({ where: { providerMessageId: event.providerMessageId }, select: { inquiryId: true } });
    return { propertyId: connection.propertyId, inquiryId: message?.inquiryId ?? null };
  }
  return { propertyId: connection.propertyId, inquiryId: await receiveMessage(event, connection) };
}

async function processWebhookJobs(now: Date): Promise<{ completed: number; retried: number; dead: number }> {
  await prisma.nrmsMetaWebhookJob.updateMany({
    where: { status: "PROCESSING", lockedAt: { lte: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } },
    data: { status: "RETRY", availableAt: now, lockedAt: null, lastError: "Recovered an expired worker claim" },
  });
  const jobs = await prisma.nrmsMetaWebhookJob.findMany({
    where: { status: { in: ["PENDING", "RETRY"] }, availableAt: { lte: now } },
    orderBy: [{ availableAt: "asc" }, { id: "asc" }],
    take: WEBHOOK_BATCH_SIZE,
  });
  let completed = 0; let retried = 0; let dead = 0;
  for (const job of jobs) {
    const claimed = await prisma.nrmsMetaWebhookJob.updateMany({
      where: { id: job.id, status: { in: ["PENDING", "RETRY"] }, availableAt: { lte: now } },
      data: { status: "PROCESSING", lockedAt: now, attemptCount: { increment: 1 } },
    });
    if (!claimed.count) continue;
    const attempt = job.attemptCount + 1;
    try {
      const event = deserializeEvent(job.payload);
      const connection = await findConnection(event);
      if (!connection) throw new Error("META_CONNECTION_NOT_FOUND");
      if (job.propertyId !== connection.propertyId) await prisma.nrmsMetaWebhookJob.update({ where: { id: job.id }, data: { propertyId: connection.propertyId } });
      const result = await processWebhookEvent(event, connection);
      await prisma.nrmsMetaWebhookJob.update({ where: { id: job.id }, data: { status: "COMPLETED", propertyId: result.propertyId, completedAt: new Date(), lockedAt: null, lastError: null } });
      await emitNrmsInboxUpdate(result.propertyId, { reason: "webhook", inquiryId: result.inquiryId });
      completed += 1;
    } catch (error) {
      const isDead = attempt >= MAX_ATTEMPTS;
      await prisma.nrmsMetaWebhookJob.update({
        where: { id: job.id },
        data: { status: isDead ? "DEAD" : "RETRY", availableAt: nextAttemptAt(now, attempt), lockedAt: null, lastError: errorText(error) },
      });
      if (isDead) dead += 1; else retried += 1;
    }
  }
  return { completed, retried, dead };
}

export async function isWhatsAppCustomerWindowOpen(inquiryId: number, now = new Date()): Promise<boolean> {
  const latestInbound = await prisma.nrmsGuestMessage.findFirst({
    where: { inquiryId, direction: "INBOUND", channel: "WHATSAPP" },
    select: { createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  return Boolean(latestInbound && now.getTime() - latestInbound.createdAt.getTime() <= WHATSAPP_CUSTOMER_WINDOW_MS);
}

async function processOutboundMessages(now: Date): Promise<{ sent: number; retried: number; failed: number }> {
  await prisma.nrmsGuestMessage.updateMany({
    where: { direction: "OUTBOUND", deliveryStatus: "SENDING", lastAttemptAt: { lte: new Date(now.getTime() - CLAIM_TIMEOUT_MS) } },
    data: { deliveryStatus: "RETRY", nextAttemptAt: now, errorMessage: "Recovered an expired outbound worker claim" },
  });
  const messages = await prisma.nrmsGuestMessage.findMany({
    where: { direction: "OUTBOUND", deliveryStatus: { in: ["QUEUED", "RETRY"] }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
    include: { inquiry: { select: { id: true, propertyId: true, channel: true, externalConversationId: true, firstResponseAt: true } } },
    orderBy: [{ nextAttemptAt: "asc" }, { id: "asc" }],
    take: OUTBOUND_BATCH_SIZE,
  });
  let sent = 0; let retried = 0; let failed = 0;
  for (const message of messages) {
    const claimed = await prisma.nrmsGuestMessage.updateMany({
      where: { id: message.id, deliveryStatus: { in: ["QUEUED", "RETRY"] } },
      data: { deliveryStatus: "SENDING", attemptCount: { increment: 1 }, lastAttemptAt: now, errorMessage: null },
    });
    if (!claimed.count) continue;
    const attempt = message.attemptCount + 1;
    const metadata = (message.metadata ?? {}) as Record<string, unknown>;
    const recipientId = String(metadata.recipientId || message.inquiry.externalConversationId || "");
    try {
      if (!recipientId) throw new Error("META_CONVERSATION_NOT_CONNECTED");
      if (message.inquiry.channel === "WHATSAPP" && !(await isWhatsAppCustomerWindowOpen(message.inquiryId, now))) {
        throw new Error("WHATSAPP_CUSTOMER_WINDOW_CLOSED");
      }
      const connection = await prisma.nrmsMessagingConnection.findFirst({ where: { propertyId: message.inquiry.propertyId, provider: message.inquiry.channel, status: "CONNECTED" } });
      if (!connection) throw new Error("META_CHANNEL_NOT_CONNECTED");
      const providerMessageId = await sendMetaText(connection, recipientId, message.body);
      await prisma.$transaction([
        prisma.nrmsGuestMessage.update({ where: { id: message.id }, data: { providerMessageId, deliveryStatus: "SENT", nextAttemptAt: null, errorMessage: null } }),
        prisma.nrmsGuestInquiry.update({
          where: { id: message.inquiryId },
          data: {
            lastMessageAt: new Date(),
            ...(metadata.automated ? { autoAcknowledgedAt: new Date() } : !message.inquiry.firstResponseAt ? { firstResponseAt: new Date() } : {}),
            version: { increment: 1 },
          },
        }),
        prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { lastOutboundAt: new Date(), lastError: null, version: { increment: 1 } } }),
      ]);
      await emitNrmsInboxUpdate(message.inquiry.propertyId, { reason: "outbound-sent", inquiryId: message.inquiryId });
      sent += 1;
    } catch (error) {
      const detail = errorText(error);
      const permanent = detail.includes("WHATSAPP_CUSTOMER_WINDOW_CLOSED") || attempt >= MAX_ATTEMPTS;
      await prisma.nrmsGuestMessage.update({
        where: { id: message.id },
        data: { deliveryStatus: permanent ? "FAILED" : "RETRY", nextAttemptAt: permanent ? null : nextAttemptAt(now, attempt), errorMessage: detail },
      });
      await emitNrmsInboxUpdate(message.inquiry.propertyId, { reason: permanent ? "outbound-failed" : "outbound-retry", inquiryId: message.inquiryId });
      if (permanent) failed += 1; else retried += 1;
    }
  }
  return { sent, retried, failed };
}

export async function processMetaMessagingJobs(now = new Date()) {
  await prisma.nrmsMetaWebhookJob.deleteMany({ where: { status: "COMPLETED", completedAt: { lte: new Date(now.getTime() - 30 * 86_400_000) } } });
  const inbound = await processWebhookJobs(now);
  const outbound = await processOutboundMessages(now);
  return { inbound, outbound };
}

export async function replayMetaMessagingFailures(propertyId?: number): Promise<{ webhookJobs: number; outboundMessages: number }> {
  const now = new Date();
  const propertyWhere = propertyId ? { propertyId } : {};
  const [webhookJobs, outboundMessages] = await prisma.$transaction([
    prisma.nrmsMetaWebhookJob.updateMany({ where: { ...propertyWhere, status: "DEAD" }, data: { status: "RETRY", attemptCount: 0, availableAt: now, lockedAt: null, completedAt: null, lastError: null } }),
    prisma.nrmsGuestMessage.updateMany({ where: { ...(propertyId ? { inquiry: { propertyId } } : {}), direction: "OUTBOUND", channel: { in: ["INSTAGRAM", "WHATSAPP"] }, deliveryStatus: "FAILED", NOT: { errorMessage: { startsWith: "WHATSAPP_CUSTOMER_WINDOW_CLOSED" } } }, data: { deliveryStatus: "RETRY", attemptCount: 0, nextAttemptAt: now, errorMessage: null } }),
  ]);
  return { webhookJobs: webhookJobs.count, outboundMessages: outboundMessages.count };
}
