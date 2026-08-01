import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  deadlineFrom,
  isActionOverdue,
  normalizeSeverity,
  paginateActionItems,
  sortActionItems,
  summarizeActionItems,
  type ActionCenterItem,
  type ActionSeverity,
} from "../lib/adminActionCenter.js";
import { serializeAdminWorkItem, synchronizeAdminWorkItems } from "../lib/adminSlaWorkItems.js";
import { retentionClassForActionCenter, retentionFields } from "../lib/auditRetention.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const iso = (value: Date) => value.toISOString();

function elevateWhenOverdue(severity: ActionSeverity, dueAt: Date, now: Date): ActionSeverity {
  if (dueAt.getTime() >= now.getTime()) return severity;
  if (severity === "LOW") return "MEDIUM";
  if (severity === "MEDIUM") return "HIGH";
  return "CRITICAL";
}

/** Operations queue assembled from existing business records and enriched with
 * persisted SLA workflow state. Source records remain authoritative.
 */
router.get("/", async (req, res) => {
  try {
    const now = new Date();
    const transportHorizon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const [
      invoices,
      transports,
      cancellations,
      tourCases,
      pendingProperties,
      lifecycleExceptions,
      channelAlerts,
      stopSellRequests,
    ] = await Promise.all([
      prisma.invoice.findMany({
        where: { status: { in: ["APPROVED", "PROCESSING"] } },
        orderBy: { updatedAt: "asc" },
        take: 50,
        select: {
          id: true,
          status: true,
          total: true,
          netPayable: true,
          issuedAt: true,
          updatedAt: true,
          owner: { select: { name: true, fullName: true, email: true } },
          booking: { select: { id: true, property: { select: { title: true } } } },
        },
      }),
      prisma.transportBooking.findMany({
        where: {
          driverId: null,
          paymentStatus: "PAID",
          status: { notIn: ["COMPLETED", "CANCELED", "CANCELLED"] },
          scheduledDate: { gte: now, lte: transportHorizon },
        },
        orderBy: { scheduledDate: "asc" },
        take: 50,
        select: {
          id: true,
          tripCode: true,
          status: true,
          scheduledDate: true,
          pickupTime: true,
          amount: true,
          currency: true,
          fromRegion: true,
          toRegion: true,
          createdAt: true,
          user: { select: { name: true, fullName: true, email: true } },
          property: { select: { title: true } },
        },
      }),
      prisma.cancellationRequest.findMany({
        where: { status: { in: ["SUBMITTED", "REVIEWING", "NEED_INFO", "APPROVED", "REFUND_PENDING"] } },
        orderBy: { updatedAt: "asc" },
        take: 50,
        select: {
          id: true,
          bookingCode: true,
          status: true,
          refundAmount: true,
          createdAt: true,
          updatedAt: true,
          user: { select: { name: true, fullName: true, email: true } },
          booking: { select: { property: { select: { title: true } } } },
        },
      }),
      prisma.tourCase.findMany({
        where: { type: "CANCELLATION", status: { notIn: ["CLOSED", "RESOLVED", "WITHDRAWN", "REJECTED"] } },
        orderBy: { updatedAt: "asc" },
        take: 40,
        select: {
          id: true,
          status: true,
          severity: true,
          title: true,
          resolutionAmount: true,
          createdAt: true,
          updatedAt: true,
          booking: { select: { bookingCode: true, title: true, guestName: true, guestEmail: true, currency: true } },
        },
      }),
      prisma.property.findMany({
        where: { status: "PENDING" },
        orderBy: { updatedAt: "asc" },
        take: 40,
        select: {
          id: true,
          ownerId: true,
          title: true,
          type: true,
          regionName: true,
          lastSubmittedAt: true,
          createdAt: true,
          updatedAt: true,
          owner: { select: { name: true, fullName: true, email: true } },
        },
      }),
      prisma.lifecycleException.findMany({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        orderBy: [{ severity: "desc" }, { lastSeenAt: "asc" }],
        take: 60,
      }),
      prisma.channelOperationalAlert.findMany({
        where: { status: "OPEN" },
        orderBy: [{ severity: "desc" }, { lastSeenAt: "asc" }],
        take: 40,
        include: {
          connection: {
            select: {
              id: true,
              property: { select: { title: true } },
              provider: { select: { name: true, code: true } },
            },
          },
        },
      }),
      prisma.channelStopSellRequest.findMany({
        where: { status: "PENDING_APPROVAL" },
        orderBy: { requestedAt: "asc" },
        take: 30,
        include: {
          connection: {
            select: {
              id: true,
              property: { select: { title: true } },
              provider: { select: { name: true, code: true } },
            },
          },
        },
      }),
    ]);

    const items: ActionCenterItem[] = [];

    for (const invoice of invoices) {
      const processing = upper(invoice.status) === "PROCESSING";
      const dueAt = deadlineFrom(invoice.updatedAt, processing ? 6 : 24);
      const owner = invoice.owner.fullName || invoice.owner.name || invoice.owner.email || `Owner #${invoice.id}`;
      items.push({
        id: `PAYOUT-${invoice.id}`,
        category: "PAYMENTS",
        severity: elevateWhenOverdue(processing ? "HIGH" : "MEDIUM", dueAt, now),
        title: processing ? "Payout processing is not complete" : "Approved owner payout is waiting",
        summary: `${invoice.booking.property?.title || "Property"} payout is ${text(invoice.status).toLowerCase()} and requires finance follow-through.`,
        subject: owner,
        sourceType: "INVOICE",
        sourceId: String(invoice.id),
        createdAt: iso(invoice.issuedAt),
        dueAt: iso(dueAt),
        detailHref: `/admin/payments?invoiceId=${invoice.id}`,
        actionLabel: "Review payout",
        exposure: { amount: number(invoice.netPayable ?? invoice.total), currency: "TZS" },
        metadata: { status: invoice.status, bookingId: invoice.booking.id },
      });
    }

    for (const trip of transports) {
      const scheduledAt = trip.pickupTime || trip.scheduledDate;
      const minutesUntil = (scheduledAt.getTime() - now.getTime()) / 60000;
      const severity: ActionSeverity = minutesUntil <= 120 ? "CRITICAL" : minutesUntil <= 24 * 60 ? "HIGH" : "MEDIUM";
      const customer = trip.user.fullName || trip.user.name || trip.user.email || `Customer #${trip.id}`;
      const route = [trip.fromRegion, trip.toRegion].filter(Boolean).join(" → ") || trip.property?.title || "Scheduled transport";
      items.push({
        id: `TRANSPORT-${trip.id}`,
        category: "TRANSPORT",
        severity,
        title: "Paid trip has no driver",
        summary: `${route} is scheduled soon but no driver is assigned.`,
        subject: `${customer} · ${trip.tripCode || `Trip #${trip.id}`}`,
        sourceType: "TRANSPORT_BOOKING",
        sourceId: String(trip.id),
        createdAt: iso(trip.createdAt),
        dueAt: iso(scheduledAt),
        detailHref: `/admin/drivers/trips/scheduled?bookingId=${trip.id}`,
        actionLabel: "Assign driver",
        exposure: trip.amount ? { amount: number(trip.amount), currency: trip.currency || "TZS" } : null,
        metadata: { status: trip.status, scheduledAt: iso(scheduledAt) },
      });
    }

    for (const cancellation of cancellations) {
      const refundPending = upper(cancellation.status) === "REFUND_PENDING";
      const approved = upper(cancellation.status) === "APPROVED";
      const dueAt = deadlineFrom(cancellation.updatedAt, refundPending ? 6 : approved ? 12 : 24);
      const baseSeverity: ActionSeverity = refundPending || approved ? "HIGH" : "MEDIUM";
      const customer = cancellation.user.fullName || cancellation.user.name || cancellation.user.email || `Customer #${cancellation.id}`;
      items.push({
        id: `CANCELLATION-${cancellation.id}`,
        category: "CANCELLATIONS",
        severity: elevateWhenOverdue(baseSeverity, dueAt, now),
        title: refundPending ? "Approved cancellation awaits refund" : "Cancellation requires review",
        summary: `${cancellation.booking.property?.title || "Accommodation"} request is ${text(cancellation.status).toLowerCase().replace(/_/g, " ")}.`,
        subject: `${customer} · ${cancellation.bookingCode}`,
        sourceType: "CANCELLATION_REQUEST",
        sourceId: String(cancellation.id),
        createdAt: iso(cancellation.createdAt),
        dueAt: iso(dueAt),
        detailHref: `/admin/cancellations/${cancellation.id}`,
        actionLabel: refundPending ? "Complete refund" : "Review request",
        exposure: cancellation.refundAmount ? { amount: number(cancellation.refundAmount), currency: "TZS" } : null,
        metadata: { status: cancellation.status },
      });
    }

    for (const tourCase of tourCases) {
      const dueAt = deadlineFrom(tourCase.updatedAt, upper(tourCase.status) === "REFUND_PENDING" ? 6 : 24);
      const baseSeverity = normalizeSeverity(tourCase.severity, "MEDIUM");
      const customer = tourCase.booking.guestName || tourCase.booking.guestEmail || "Tour guest";
      items.push({
        id: `TOUR-CASE-${tourCase.id}`,
        category: "CANCELLATIONS",
        severity: elevateWhenOverdue(baseSeverity, dueAt, now),
        title: tourCase.title || "Tour cancellation requires review",
        summary: `${tourCase.booking.title || "Tour booking"} case is ${text(tourCase.status).toLowerCase().replace(/_/g, " ")}.`,
        subject: `${customer} · ${tourCase.booking.bookingCode}`,
        sourceType: "TOUR_CASE",
        sourceId: String(tourCase.id),
        createdAt: iso(tourCase.createdAt),
        dueAt: iso(dueAt),
        detailHref: `/admin/cancellations/tours/${tourCase.id}`,
        actionLabel: "Review tour case",
        exposure: tourCase.resolutionAmount
          ? { amount: number(tourCase.resolutionAmount), currency: tourCase.booking.currency || "TZS" }
          : null,
        metadata: { status: tourCase.status },
      });
    }

    for (const property of pendingProperties) {
      const submittedAt = property.lastSubmittedAt || property.updatedAt || property.createdAt;
      const dueAt = deadlineFrom(submittedAt, 48);
      const owner = property.owner.fullName || property.owner.name || property.owner.email || `Owner #${property.ownerId}`;
      items.push({
        id: `PROPERTY-APPROVAL-${property.id}`,
        category: "APPROVALS",
        severity: elevateWhenOverdue("MEDIUM", dueAt, now),
        title: "Property submission awaits review",
        summary: `${property.type.replace(/_/g, " ")} in ${property.regionName || "an unconfirmed region"} is waiting for moderation.`,
        subject: `${property.title} · ${owner}`,
        sourceType: "PROPERTY",
        sourceId: String(property.id),
        createdAt: iso(submittedAt),
        dueAt: iso(dueAt),
        detailHref: `/admin/properties/previews?propertyId=${property.id}`,
        actionLabel: "Review property",
        exposure: null,
      });
    }

    for (const exception of lifecycleExceptions) {
      const dueAt = deadlineFrom(exception.firstSeenAt, upper(exception.severity) === "ERROR" ? 6 : 24);
      const service = upper(exception.serviceType);
      const detailHref = service === "PROPERTY"
        ? `/admin/bookings/${exception.bookingId}`
        : service === "GROUP_STAY"
          ? `/admin/group-stays/bookings?bookingId=${exception.bookingId}`
          : "/admin/agents/tour-bookings";
      items.push({
        id: `LIFECYCLE-${exception.id}`,
        category: "LIFECYCLE",
        severity: elevateWhenOverdue(normalizeSeverity(exception.severity, "MEDIUM"), dueAt, now),
        title: "Booking lifecycle needs attention",
        summary: exception.message,
        subject: `${service.replace(/_/g, " ")} booking #${exception.bookingId}`,
        sourceType: "LIFECYCLE_EXCEPTION",
        sourceId: String(exception.id),
        createdAt: iso(exception.firstSeenAt),
        dueAt: iso(dueAt),
        detailHref,
        actionLabel: "Inspect booking",
        exposure: null,
        metadata: { code: exception.code, status: exception.status, lastSeenAt: iso(exception.lastSeenAt) },
      });
    }

    for (const alert of channelAlerts) {
      const dueAt = deadlineFrom(alert.firstSeenAt, upper(alert.severity) === "CRITICAL" ? 1 : 6);
      const provider = alert.connection.provider.name || alert.connection.provider.code;
      items.push({
        id: `CHANNEL-${alert.id}`,
        category: "NRMS",
        severity: elevateWhenOverdue(normalizeSeverity(alert.severity, "HIGH"), dueAt, now),
        title: "OTA connection requires attention",
        summary: `${provider} reported ${text(alert.kind).toLowerCase().replace(/_/g, " ")}.`,
        subject: alert.connection.property.title,
        sourceType: "CHANNEL_ALERT",
        sourceId: String(alert.id),
        createdAt: iso(alert.firstSeenAt),
        dueAt: iso(dueAt),
        detailHref: `/admin/nrms/channels?connectionId=${alert.connection.id}`,
        actionLabel: "Open OTA control",
        exposure: null,
        metadata: { occurrences: alert.occurrenceCount, lastSeenAt: iso(alert.lastSeenAt) },
      });
    }

    for (const request of stopSellRequests) {
      const dueAt = deadlineFrom(request.requestedAt, 1);
      const provider = request.connection.provider.name || request.connection.provider.code;
      items.push({
        id: `STOP-SELL-${request.id}`,
        category: "NRMS",
        severity: elevateWhenOverdue("HIGH", dueAt, now),
        title: "Emergency inventory action awaits approval",
        summary: `${request.action.toLowerCase()} request for ${provider} inventory from ${request.fromDate.toLocaleDateString()} to ${request.toDate.toLocaleDateString()}.`,
        subject: request.connection.property.title,
        sourceType: "CHANNEL_STOP_SELL_REQUEST",
        sourceId: String(request.id),
        createdAt: iso(request.requestedAt),
        dueAt: iso(dueAt),
        detailHref: `/admin/nrms/channels?connectionId=${request.connection.id}`,
        actionLabel: "Review request",
        exposure: null,
      });
    }

    const trackedItems = await synchronizeAdminWorkItems(items, now);
    const requestedCategory = upper(req.query.category || "ALL");
    const requestedSeverity = upper(req.query.severity || "ALL");
    const requestedStatus = upper(req.query.status || "ACTIVE");
    const search = text(req.query.q).slice(0, 120).toLowerCase();
    const requestedPage = Number(req.query.page) || 1;
    const requestedPerPage = Number(req.query.perPage) || 15;

    const filtered = trackedItems.filter((item) => {
      if (requestedCategory !== "ALL" && item.category !== requestedCategory) return false;
      if (requestedStatus === "ACTIVE" && item.workflow?.status === "RESOLVED") return false;
      if (requestedStatus !== "ALL" && requestedStatus !== "ACTIVE" && item.workflow?.status !== requestedStatus) return false;
      if (requestedSeverity === "OVERDUE" && !(item.workflow?.resolutionBreached ?? isActionOverdue(item, now))) return false;
      if (requestedSeverity !== "ALL" && requestedSeverity !== "OVERDUE" && item.severity !== requestedSeverity) return false;
      if (!search) return true;
      return [item.title, item.summary, item.subject, item.sourceId, item.category]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    const sorted = sortActionItems(filtered, now);
    const paginated = paginateActionItems(sorted, requestedPage, requestedPerPage);
    return res.json({
      observationMode: false,
      workflowMode: true,
      generatedAt: now.toISOString(),
      summary: summarizeActionItems(trackedItems, now),
      filteredTotal: sorted.length,
      pagination: paginated.pagination,
      items: paginated.items,
    });
  } catch (error: any) {
    console.error("GET /api/admin/action-center error:", error);
    return res.status(500).json({ error: "Unable to load the action center", message: error?.message || "Unknown error" });
  }
});

router.patch("/work-items/:id", async (req, res) => {
  const id = Number(req.params.id);
  const action = upper(req.body?.action);
  const actorId = Number((req as any).user?.id);
  const actorRole = upper((req as any).user?.role);
  const note = text(req.body?.note).slice(0, 1000);
  const assignedTeam = text(req.body?.assignedTeam).slice(0, 80) || undefined;

  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Valid work item id is required" });
  if (!Number.isInteger(actorId) || actorId <= 0 || actorRole !== "ADMIN") return res.status(401).json({ error: "Admin session is required" });
  if (!["CLAIM", "ASSIGN", "UNASSIGN", "ACKNOWLEDGE", "RESOLVE", "REOPEN"].includes(action)) {
    return res.status(400).json({ error: "Unsupported work item action" });
  }
  if (action === "RESOLVE" && note.length < 5) {
    return res.status(400).json({ error: "Add a short resolution note before resolving the SLA" });
  }

  try {
    const current = await prisma.adminWorkItem.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ error: "SLA work item not found" });

    const now = new Date();
    const retentionClass = retentionClassForActionCenter(current.category);
    const data: Record<string, unknown> = {};
    if (action === "CLAIM") data.assignedToId = actorId;
    if (action === "UNASSIGN") data.assignedToId = null;
    if (action === "ASSIGN") {
      const assigneeId = Number(req.body?.assigneeId);
      if (!Number.isInteger(assigneeId) || assigneeId <= 0) return res.status(400).json({ error: "Valid assigneeId is required" });
      const assignee = await prisma.user.findFirst({
        where: { id: assigneeId, role: "ADMIN", OR: [{ isDisabled: null }, { isDisabled: false }] },
        select: { id: true },
      });
      if (!assignee) return res.status(400).json({ error: "The selected administrator is unavailable" });
      data.assignedToId = assignee.id;
    }
    if (assignedTeam) data.assignedTeam = assignedTeam;
    if (action === "ACKNOWLEDGE") {
      data.status = "ACKNOWLEDGED";
      data.acknowledgedAt = current.acknowledgedAt || now;
      data.acknowledgedById = current.acknowledgedById || actorId;
      if (!current.assignedToId) data.assignedToId = actorId;
    }
    if (action === "RESOLVE") {
      data.status = "RESOLVED";
      data.resolvedAt = now;
      data.resolvedById = actorId;
      data.resolutionNote = note;
      Object.assign(data, retentionFields(retentionClass, now));
      if (!current.assignedToId) data.assignedToId = actorId;
    }
    if (action === "REOPEN") {
      data.status = current.acknowledgedAt ? "ACKNOWLEDGED" : "OPEN";
      data.resolvedAt = null;
      data.resolvedById = null;
      data.resolutionNote = null;
      data.expiresAt = null;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const workItem = await tx.adminWorkItem.update({
        where: { id },
        data,
        include: { assignedTo: { select: { id: true, name: true, fullName: true, email: true } } },
      });
      const beforeJson = {
        status: current.status,
        assignedToId: current.assignedToId,
        assignedTeam: current.assignedTeam,
        acknowledgedAt: current.acknowledgedAt,
        resolvedAt: current.resolvedAt,
      };
      const afterJson = {
        action,
        status: workItem.status,
        assignedToId: workItem.assignedToId,
        assignedTeam: workItem.assignedTeam,
        acknowledgedAt: workItem.acknowledgedAt,
        resolvedAt: workItem.resolvedAt,
        note: note || null,
        sourceType: workItem.sourceType,
        sourceId: workItem.sourceId,
      };
      await tx.auditLog.create({
        data: {
          actorId,
          actorRole,
          action: `ACTION_CENTER_${action}`,
          entity: "ADMIN_WORK_ITEM",
          entityId: workItem.id,
          beforeJson,
          afterJson,
          ip: req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || null,
          ua: req.headers["user-agent"]?.toString() || null,
          createdAt: now,
          ...retentionFields(retentionClass, now),
        },
      });
      await tx.adminAudit.create({
        data: {
          adminId: actorId,
          performedBy: actorId,
          action: `ACTION_CENTER_${action}`,
          details: afterJson,
          createdAt: now,
          ...retentionFields(retentionClass, now),
        },
      });
      return workItem;
    });

    return res.json({ ok: true, workflow: serializeAdminWorkItem(updated, now) });
  } catch (error: any) {
    console.error("PATCH /api/admin/action-center/work-items/:id error:", error);
    return res.status(500).json({ error: "Unable to update the SLA work item", message: error?.message || "Unknown error" });
  }
});

export default router;
