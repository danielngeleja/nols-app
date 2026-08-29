import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { loadNrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { NRMS_BILLING_BLOCKING_STATUSES, nrmsBillingBlockPayload } from "../lib/nrms.js";
import { createInquiryRoomHold } from "../lib/nrmsInquiryConversion.js";
import { buildInquiryConversionReport } from "../lib/nrmsInquiryReporting.js";
import { isWhatsAppCustomerWindowOpen, replayMetaMessagingFailures } from "../lib/nrmsMetaWebhookJobs.js";
import { downloadMetaAttachment } from "../lib/nrmsMetaMessaging.js";
import { sanitizeText } from "../lib/sanitize.js";
import { closesActiveConversation } from "../lib/nrmsMetaConversation.js";
import { emitNrmsInboxUpdate } from "../sockets/index.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const CHANNELS = ["WEB", "INSTAGRAM", "WHATSAPP", "PHONE", "EMAIL"] as const;
const STATUSES = ["NEW", "OPEN", "WAITING_GUEST", "RESOLVED", "CONVERTED", "CLOSED"] as const;
const updateSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(STATUSES).optional(),
  assignedToId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
}).refine((value) => value.status !== undefined || value.assignedToId !== undefined || Boolean(value.note), { message: "Nothing to update" });
const messageSchema = z.object({ version: z.number().int().positive(), body: z.string().trim().min(1).max(4000), direction: z.enum(["OUTBOUND", "INTERNAL"]).default("OUTBOUND"), deliveryMode: z.enum(["SEND", "RECORD"]).default("RECORD") });
const convertToHoldSchema = z.object({
  version: z.number().int().positive(),
  guestName: z.string().trim().min(2).max(160),
  guestPhone: z.string().trim().min(7).max(40),
  guestEmail: z.string().trim().email().max(160).nullable().optional(),
  checkIn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkOut: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roomTypeId: z.number().int().positive(),
  adults: z.number().int().min(1).max(50).default(1),
  children: z.number().int().min(0).max(50).default(0),
});

const includeInquiry = {
  roomType: { select: { id: true, name: true, baseRate: true, currency: true } },
  reservation: { select: { id: true, status: true, receiptNumber: true } },
  assignedTo: { select: { id: true, name: true, fullName: true, email: true } },
  messages: { orderBy: { createdAt: "asc" as const }, take: 200 },
};

function serializeInquiry(inquiry: any) {
  return {
    ...inquiry,
    roomType: inquiry.roomType ? { ...inquiry.roomType, baseRate: inquiry.roomType.baseRate == null ? null : Number(inquiry.roomType.baseRate) } : null,
  };
}

async function access(req: AuthedRequest, res: Response, propertyId: number) {
  return loadNrmsPropertyAccess(req, res, propertyId, ["OWNER", "MANAGER", "FRONT_DESK"]);
}

async function loadInquiry(req: AuthedRequest, res: Response, propertyId: number, inquiryId: number) {
  const allowed = await access(req, res, propertyId); if (!allowed) return null;
  const inquiry = await prisma.nrmsGuestInquiry.findFirst({ where: { id: inquiryId, propertyId, ownerId: allowed.ownerId }, include: includeInquiry });
  if (!inquiry) { res.status(404).json({ error: "Inquiry not found" }); return null; }
  return { allowed, inquiry };
}

router.get("/property/:propertyId/live-count", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const overdueBefore = new Date(Date.now() - 10 * 60_000);
  const [newCount, open, overdue] = await Promise.all([
    prisma.nrmsGuestInquiry.count({ where: { propertyId, status: "NEW" } }),
    prisma.nrmsGuestInquiry.count({ where: { propertyId, status: "OPEN" } }),
    prisma.nrmsGuestInquiry.count({ where: { propertyId, status: { in: ["NEW", "OPEN"] }, firstResponseAt: null, createdAt: { lt: overdueBefore } } }),
  ]);
  res.json({ new: newCount, open, overdue, total: newCount + open });
}) as RequestHandler);

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const parsed = z.object({
    status: z.enum(STATUSES).optional(), channel: z.enum(CHANNELS).optional(), q: z.string().trim().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
  }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid inquiry filters" });
  const { status, channel, q, page, pageSize } = parsed.data;
  const where = {
    propertyId,
    ...(status ? { status } : {}),
    ...(channel ? { channel } : {}),
    ...(q ? { OR: [{ reference: { contains: q } }, { guestName: { contains: q } }, { guestHandle: { contains: q } }, { guestPhone: { contains: q } }, { guestEmail: { contains: q } }] } : {}),
  };
  const since = new Date(Date.now() - 30 * 86_400_000);
  const metricSince = new Date(Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()));
  const [total, inquiries, owner, memberships, roomTypes, directMetrics, reportInquiries, messagingConnections] = await Promise.all([
    prisma.nrmsGuestInquiry.count({ where }),
    prisma.nrmsGuestInquiry.findMany({ where, include: includeInquiry, orderBy: [{ status: "asc" }, { lastMessageAt: "desc" }, { createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.user.findUnique({ where: { id: allowed.ownerId }, select: { id: true, name: true, fullName: true, email: true } }),
    prisma.nrmsStaffMembership.findMany({ where: { propertyId, status: "ACTIVE", role: { in: ["MANAGER", "FRONT_DESK"] } }, select: { user: { select: { id: true, name: true, fullName: true, email: true } }, role: true }, orderBy: { id: "asc" } }),
    prisma.roomType.findMany({ where: { propertyId, status: "ACTIVE", baseRate: { not: null } }, select: { id: true, name: true, baseRate: true, currency: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.nrmsPublicMetric.findMany({ where: { propertyId, metricDate: { gte: metricSince }, kind: { startsWith: "DIRECT:PAGE_OPEN:" } }, select: { kind: true, count: true } }),
    prisma.nrmsGuestInquiry.findMany({ where: { propertyId, createdAt: { gte: since } }, select: { source: true, createdAt: true, firstResponseAt: true, reservationId: true, reservation: { select: { status: true } } } }),
    prisma.nrmsMessagingConnection.findMany({ where: { propertyId }, select: { provider: true, status: true, displayName: true, tokenExpiresAt: true, lastWebhookAt: true, lastOutboundAt: true, lastError: true, metadata: true } }),
  ]);
  const [webhookPending, webhookDead, outboundRetrying, outboundFailed, templateRequired] = await Promise.all([
    prisma.nrmsMetaWebhookJob.count({ where: { propertyId, status: { in: ["PENDING", "PROCESSING", "RETRY"] } } }),
    prisma.nrmsMetaWebhookJob.count({ where: { propertyId, status: "DEAD" } }),
    prisma.nrmsGuestMessage.count({ where: { inquiry: { propertyId }, direction: "OUTBOUND", deliveryStatus: { in: ["QUEUED", "SENDING", "RETRY"] } } }),
    prisma.nrmsGuestMessage.count({ where: { inquiry: { propertyId }, direction: "OUTBOUND", deliveryStatus: "FAILED", NOT: { errorMessage: { startsWith: "WHATSAPP_CUSTOMER_WINDOW_CLOSED" } } } }),
    prisma.nrmsGuestMessage.count({ where: { inquiry: { propertyId }, direction: "OUTBOUND", deliveryStatus: "FAILED", errorMessage: { startsWith: "WHATSAPP_CUSTOMER_WINDOW_CLOSED" } } }),
  ]);
  res.json({ total, page, pageSize, pageCount: Math.ceil(total / pageSize), inquiries: inquiries.map(serializeInquiry), assignees: [owner ? { ...owner, role: "OWNER" } : null, ...memberships.map((item) => ({ ...item.user, role: item.role }))].filter(Boolean), roomTypes: roomTypes.map((room) => ({ ...room, baseRate: Number(room.baseRate) })), reporting: buildInquiryConversionReport(directMetrics, reportInquiries), messagingConnections: messagingConnections.map(({ metadata, ...connection }) => ({ ...connection, status: connection.provider === "WHATSAPP" && connection.status === "CONNECTED" && !(metadata as any)?.phoneRegisteredAt ? "PENDING" : connection.status })), messagingOperations: { webhookPending, webhookDead, outboundRetrying, outboundFailed, templateRequired }, metaReadiness: { appConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET), webhookConfigured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN), graphVersion: process.env.META_GRAPH_API_VERSION || null } });
}) as RequestHandler);

router.get("/property/:propertyId/:inquiryId", (async (req: AuthedRequest, res: Response) => {
  const loaded = await loadInquiry(req, res, Number(req.params.propertyId), Number(req.params.inquiryId)); if (!loaded) return;
  res.json({ inquiry: serializeInquiry(loaded.inquiry) });
}) as RequestHandler);

router.patch("/property/:propertyId/:inquiryId", (async (req: AuthedRequest, res: Response) => {
  const parsed = updateSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid inquiry update" });
  const propertyId = Number(req.params.propertyId); const inquiryId = Number(req.params.inquiryId);
  const loaded = await loadInquiry(req, res, propertyId, inquiryId); if (!loaded) return;
  if (["RESOLVED", "CONVERTED", "CLOSED"].includes(loaded.inquiry.status)) return res.status(409).json({ error: "This inquiry is already closed" });
  if (parsed.data.assignedToId) {
    const isOwner = parsed.data.assignedToId === loaded.allowed.ownerId;
    const isStaff = isOwner ? true : Boolean(await prisma.nrmsStaffMembership.findFirst({ where: { propertyId, userId: parsed.data.assignedToId, status: "ACTIVE", role: { in: ["MANAGER", "FRONT_DESK"] } }, select: { id: true } }));
    if (!isStaff) return res.status(400).json({ error: "Choose an active manager or front-desk team member" });
  }
  const now = new Date();
  const changed = await prisma.$transaction(async (tx) => {
    const result = await tx.nrmsGuestInquiry.updateMany({
      where: { id: inquiryId, propertyId, version: parsed.data.version },
      data: {
        ...(parsed.data.status ? {
          status: parsed.data.status,
          closedAt: ["RESOLVED", "CLOSED"].includes(parsed.data.status) ? now : null,
          ...(closesActiveConversation(parsed.data.status) ? { activeConversationKey: null } : {}),
        } : {}),
        ...(parsed.data.assignedToId !== undefined ? { assignedToId: parsed.data.assignedToId } : {}),
        version: { increment: 1 },
      },
    });
    if (!result.count) return false;
    if (parsed.data.note) await tx.nrmsGuestMessage.create({ data: { inquiryId, channel: loaded.inquiry.channel, direction: "INTERNAL", body: sanitizeText(parsed.data.note), senderName: req.user!.name ?? req.user!.email ?? "Team member", sentById: req.user!.id } });
    return true;
  });
  if (!changed) return res.status(409).json({ error: "This inquiry changed on another device. Refresh and try again.", code: "VERSION_CONFLICT" });
  const inquiry = await prisma.nrmsGuestInquiry.findUnique({ where: { id: inquiryId }, include: includeInquiry });
  await emitNrmsInboxUpdate(propertyId, { reason: "inquiry-updated", inquiryId });
  res.json({ inquiry: serializeInquiry(inquiry) });
}) as RequestHandler);

router.post("/property/:propertyId/:inquiryId/messages", (async (req: AuthedRequest, res: Response) => {
  const parsed = messageSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: "Write a valid response or note" });
  const propertyId = Number(req.params.propertyId); const inquiryId = Number(req.params.inquiryId);
  const loaded = await loadInquiry(req, res, propertyId, inquiryId); if (!loaded) return;
  if (["RESOLVED", "CONVERTED", "CLOSED"].includes(loaded.inquiry.status)) return res.status(409).json({ error: "This inquiry is already closed" });
  const now = new Date();
  const sendLive = parsed.data.direction === "OUTBOUND" && parsed.data.deliveryMode === "SEND";
  if (sendLive) {
    if (!["INSTAGRAM", "WHATSAPP"].includes(loaded.inquiry.channel) || !loaded.inquiry.externalConversationId) return res.status(409).json({ error: "This inquiry is not connected to a live social conversation", code: "META_CONVERSATION_NOT_CONNECTED" });
    const connection = await prisma.nrmsMessagingConnection.findFirst({ where: { propertyId, provider: loaded.inquiry.channel, status: "CONNECTED" } });
    if (!connection) return res.status(409).json({ error: `${loaded.inquiry.channel === "WHATSAPP" ? "WhatsApp" : "Instagram"} is not connected for this property`, code: "META_CHANNEL_NOT_CONNECTED" });
    if (loaded.inquiry.channel === "WHATSAPP" && !(await isWhatsAppCustomerWindowOpen(inquiryId, now))) {
      return res.status(409).json({ error: "WhatsApp's 24-hour customer-service window is closed. Send an approved template before a free-form reply.", code: "WHATSAPP_TEMPLATE_REQUIRED" });
    }
  }
  const result = await prisma.$transaction(async (tx) => {
    const changed = await tx.nrmsGuestInquiry.updateMany({
      where: { id: inquiryId, propertyId, version: parsed.data.version },
      data: { status: parsed.data.direction === "OUTBOUND" ? "WAITING_GUEST" : loaded.inquiry.status === "NEW" ? "OPEN" : loaded.inquiry.status, lastMessageAt: now, version: { increment: 1 } },
    });
    if (!changed.count) return null;
    return tx.nrmsGuestMessage.create({
      data: {
        inquiryId,
        channel: loaded.inquiry.channel,
        direction: parsed.data.direction,
        body: sanitizeText(parsed.data.body),
        senderName: req.user!.name ?? req.user!.email ?? "Reception",
        sentById: req.user!.id,
        deliveryStatus: sendLive ? "QUEUED" : "RECORDED",
        nextAttemptAt: sendLive ? now : null,
      },
    });
  });
  if (!result) return res.status(409).json({ error: "This inquiry changed while you were replying. Review the latest message before sending.", code: "VERSION_CONFLICT" });
  await emitNrmsInboxUpdate(propertyId, { reason: sendLive ? "outbound-queued" : "note-added", inquiryId });
  res.status(sendLive ? 202 : 201).json({ message: result, queued: sendLive });
}) as RequestHandler);

router.get("/property/:propertyId/:inquiryId/messages/:messageId/media", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const inquiryId = Number(req.params.inquiryId); const messageId = Number(req.params.messageId);
  const loaded = await loadInquiry(req, res, propertyId, inquiryId); if (!loaded) return;
  const message = await prisma.nrmsGuestMessage.findFirst({ where: { id: messageId, inquiryId, direction: "INBOUND" }, select: { channel: true, metadata: true } });
  const attachment = (message?.metadata as any)?.attachment;
  if (!message || !attachment) return res.status(404).json({ error: "Message attachment not found" });
  const connection = await prisma.nrmsMessagingConnection.findFirst({ where: { propertyId, provider: message.channel, status: "CONNECTED" } });
  if (!connection) return res.status(409).json({ error: "The messaging channel must be connected to retrieve this attachment" });
  try {
    const media = await downloadMetaAttachment(connection, attachment);
    res.setHeader("Content-Type", media.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${media.fileName}"`);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(media.bytes);
  } catch (error) {
    console.error("[owner.nrms.inquiries] media retrieval failed", error);
    return res.status(502).json({ error: "This attachment could not be retrieved from Meta. Try again shortly." });
  }
}) as RequestHandler);

router.post("/property/:propertyId/messaging-failures/replay", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const allowed = await access(req, res, propertyId); if (!allowed) return;
  if (allowed.role !== "OWNER" && allowed.role !== "MANAGER") return res.status(403).json({ error: "Only an owner or manager can replay failed messages" });
  const replayed = await replayMetaMessagingFailures(propertyId);
  await emitNrmsInboxUpdate(propertyId, { reason: "failures-replayed" });
  res.json({ replayed });
}) as RequestHandler);

router.post("/property/:propertyId/:inquiryId/hold", (async (req: AuthedRequest, res: Response) => {
  const parsed = convertToHoldSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Complete the room hold details", details: parsed.error.flatten() });
  const propertyId = Number(req.params.propertyId);
  const inquiryId = Number(req.params.inquiryId);
  const loaded = await loadInquiry(req, res, propertyId, inquiryId); if (!loaded) return;

  const account = await prisma.ownerPaygAccount.findUnique({ where: { propertyId } });
  if (!account) return res.status(403).json({ error: "NRMS operations are not active for this property", code: "NRMS_NOT_ACTIVE" });
  if (NRMS_BILLING_BLOCKING_STATUSES.includes(account.status as typeof NRMS_BILLING_BLOCKING_STATUSES[number])) {
    return res.status(402).json(await nrmsBillingBlockPayload(account));
  }

  try {
    const result = await createInquiryRoomHold({
      propertyId,
      ownerId: loaded.allowed.ownerId,
      actorId: loaded.allowed.actorId,
      actorName: req.user!.name ?? req.user!.email ?? "Reception",
      inquiryId,
      ...parsed.data,
    });
    if (!result.ok) {
      const status = ["INVALID_DATES", "ROOM_TYPE_NOT_FOUND", "ROOM_TYPE_MISMATCH"].includes(result.code) ? 400 : 409;
      return res.status(status).json({ error: result.message, code: result.code });
    }
    await emitNrmsInboxUpdate(propertyId, { reason: "inquiry-converted", inquiryId });
    return res.status(201).json({ hold: result });
  } catch (error) {
    console.error("[owner.nrms.inquiries] conversion failed", error);
    return res.status(500).json({ error: "The room hold could not be created" });
  }
}) as RequestHandler);

export default router;
