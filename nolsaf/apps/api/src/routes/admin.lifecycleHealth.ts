import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  mapGroupStayLifecycle,
  mapPropertyLifecycle,
  mapTourLifecycle,
  type ServiceLifecycle,
  type ServiceType,
} from "../lib/serviceLifecycle.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

type LifecycleRow = {
  id: string;
  serviceType: ServiceType;
  bookingId: number;
  bookingCode: string;
  title: string;
  customer: string | null;
  createdAt: Date;
  detailHref: string;
  lifecycle: ServiceLifecycle;
  source: Record<string, unknown>;
};

const text = (value: unknown) => String(value ?? "").trim();
const upper = (value: unknown) => text(value).toUpperCase();

function tourReceiptStatus(events: Array<{ type: string }>): string {
  const types = new Set(events.map((event) => upper(event.type)));
  if (["OPERATOR_RECEIVED", "ACKNOWLEDGE", "ESCALATE", "OPERATOR_COST_EVIDENCE"].some((type) => types.has(type))) return "RECEIVED";
  if (types.has("OPERATOR_NOTIFIED")) return "AWAITING_RECEIPT";
  return "UNDELIVERED";
}

/**
 * Read-only lifecycle observation endpoint.
 * It interprets existing records and never changes booking, payment, receipt, or case state.
 */
router.get("/", async (req, res) => {
  try {
    const requestedService = upper(req.query.service || "ALL");
    const service = ["ALL", "PROPERTY", "GROUP_STAY", "TOUR"].includes(requestedService) ? requestedService : "ALL";
    const search = text(req.query.q).slice(0, 120);
    const page = Math.min(20, Math.max(1, Number(req.query.page) || 1));
    const pageSize = Math.min(50, Math.max(10, Number(req.query.pageSize) || 25));
    const skip = (page - 1) * pageSize;
    // For a merged newest-first page, no service can contribute more than skip + pageSize rows.
    const candidateTake = Math.min(500, skip + pageSize);

    const propertyWhere: any = search
      ? {
          OR: [
            { guestName: { contains: search } },
            { property: { is: { title: { contains: search } } } },
            { user: { is: { email: { contains: search } } } },
            { code: { is: { codeVisible: { contains: search } } } },
          ],
        }
      : {};
    const groupWhere: any = search
      ? {
          OR: [
            { user: { is: { name: { contains: search } } } },
            { user: { is: { email: { contains: search } } } },
            { toRegion: { contains: search } },
            { toLocation: { contains: search } },
          ],
        }
      : {};
    const tourWhere: any = search
      ? {
          OR: [
            { bookingCode: { contains: search } },
            { title: { contains: search } },
            { guestName: { contains: search } },
            { guestEmail: { contains: search } },
          ],
        }
      : {};

    const loadProperty = service === "ALL" || service === "PROPERTY";
    const loadGroup = service === "ALL" || service === "GROUP_STAY";
    const loadTour = service === "ALL" || service === "TOUR";

    const [properties, groups, tours, propertyTotal, groupTotal, tourTotal] = await Promise.all([
      loadProperty
        ? prisma.booking.findMany({
            where: propertyWhere,
            orderBy: { createdAt: "desc" },
            take: candidateTake,
            select: {
              id: true,
              status: true,
              guestName: true,
              createdAt: true,
              property: { select: { title: true } },
              user: { select: { name: true, email: true } },
              code: { select: { codeVisible: true, status: true } },
              invoices: {
                orderBy: { issuedAt: "desc" },
                take: 1,
                select: { id: true, status: true, receiptNumber: true },
              },
              cancellationRequests: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true, status: true },
              },
            },
          })
        : Promise.resolve([]),
      loadGroup
        ? (prisma as any).groupBooking.findMany({
            where: groupWhere,
            orderBy: { createdAt: "desc" },
            take: candidateTake,
            select: {
              id: true,
              status: true,
              groupType: true,
              toRegion: true,
              createdAt: true,
              depositPaid: true,
              depositPaidAt: true,
              depositAmount: true,
              depositDueAt: true,
              confirmedPropertyId: true,
              user: { select: { name: true, email: true } },
            },
          })
        : Promise.resolve([]),
      loadTour
        ? prisma.tourBooking.findMany({
            where: tourWhere,
            orderBy: { createdAt: "desc" },
            take: candidateTake,
            select: {
              id: true,
              bookingCode: true,
              title: true,
              guestName: true,
              guestEmail: true,
              status: true,
              paymentStatus: true,
              paidAt: true,
              operatorAgentId: true,
              createdAt: true,
              cases: {
                where: { type: "CANCELLATION" },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                  id: true,
                  status: true,
                  events: { orderBy: { createdAt: "desc" }, take: 50, select: { type: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
      loadProperty ? prisma.booking.count({ where: propertyWhere }) : Promise.resolve(0),
      loadGroup ? (prisma as any).groupBooking.count({ where: groupWhere }) : Promise.resolve(0),
      loadTour ? prisma.tourBooking.count({ where: tourWhere }) : Promise.resolve(0),
    ]);

    const now = Date.now();
    const rows: LifecycleRow[] = [];

    for (const booking of properties as any[]) {
      const invoice = booking.invoices?.[0] ?? null;
      const cancellation = booking.cancellationRequests?.[0] ?? null;
      const lifecycle = mapPropertyLifecycle({
        bookingStatus: booking.status,
        invoiceStatus: invoice?.status,
        hasInvoice: Boolean(invoice),
        receiptNumber: invoice?.receiptNumber,
        checkInCodeStatus: booking.code?.status,
        cancellationStatus: cancellation?.status,
        cancellationLoaded: true,
      });
      rows.push({
        id: `PROPERTY-${booking.id}`,
        serviceType: "PROPERTY",
        bookingId: booking.id,
        bookingCode: booking.code?.codeVisible || `PROPERTY-${String(booking.id).padStart(6, "0")}`,
        title: booking.property?.title || "Accommodation booking",
        customer: booking.user?.name || booking.guestName || booking.user?.email || null,
        createdAt: booking.createdAt,
        detailHref: cancellation ? `/admin/cancellations/${cancellation.id}` : `/admin/bookings/${booking.id}`,
        lifecycle,
        source: {
          bookingStatus: booking.status,
          invoiceStatus: invoice?.status ?? null,
          receiptNumber: invoice?.receiptNumber ?? null,
          checkInCodeStatus: booking.code?.status ?? null,
          cancellationStatus: cancellation?.status ?? null,
        },
      });
    }

    for (const booking of groups as any[]) {
      const depositExpired = booking.status === "AWAITING_DEPOSIT" && !booking.depositPaid && booking.depositDueAt && new Date(booking.depositDueAt).getTime() < now;
      const lifecycle = mapGroupStayLifecycle({
        bookingStatus: booking.status,
        depositPaid: booking.depositPaid,
        depositPaidAt: booking.depositPaidAt,
        depositAmount: booking.depositAmount,
        depositExpired: Boolean(depositExpired),
        confirmedPropertyId: booking.confirmedPropertyId,
        cancellationLoaded: true,
      });
      rows.push({
        id: `GROUP_STAY-${booking.id}`,
        serviceType: "GROUP_STAY",
        bookingId: booking.id,
        bookingCode: `GROUP-${String(booking.id).padStart(6, "0")}`,
        title: `${text(booking.groupType) || "Group"} stay${booking.toRegion ? ` · ${booking.toRegion}` : ""}`,
        customer: booking.user?.name || booking.user?.email || null,
        createdAt: booking.createdAt,
        detailHref: `/admin/group-stays/bookings?bookingId=${booking.id}`,
        lifecycle,
        source: {
          bookingStatus: booking.status,
          depositPaid: Boolean(booking.depositPaid),
          depositPaidAt: booking.depositPaidAt ?? null,
          depositDueAt: booking.depositDueAt ?? null,
          confirmedPropertyId: booking.confirmedPropertyId ?? null,
          cancellationStatus: null,
        },
      });
    }

    for (const booking of tours as any[]) {
      const cancellation = booking.cases?.[0] ?? null;
      const operatorReceiptStatus = cancellation ? tourReceiptStatus(cancellation.events || []) : "UNDELIVERED";
      const lifecycle = mapTourLifecycle({
        bookingStatus: booking.status,
        paymentStatus: booking.paymentStatus,
        paidAt: booking.paidAt,
        operatorAssigned: Boolean(booking.operatorAgentId),
        operatorReceiptStatus,
        cancellationStatus: cancellation?.status,
        cancellationLoaded: true,
      });
      rows.push({
        id: `TOUR-${booking.id}`,
        serviceType: "TOUR",
        bookingId: booking.id,
        bookingCode: booking.bookingCode,
        title: booking.title || "Tour booking",
        customer: booking.guestName || booking.guestEmail || null,
        createdAt: booking.createdAt,
        detailHref: cancellation ? `/admin/cancellations/tours/${cancellation.id}` : "/admin/agents/tour-bookings",
        lifecycle,
        source: {
          bookingStatus: booking.status,
          paymentStatus: booking.paymentStatus,
          paidAt: booking.paidAt ?? null,
          operatorAgentId: booking.operatorAgentId,
          operatorReceiptStatus,
          cancellationStatus: cancellation?.status ?? null,
        },
      });
    }

    rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const items = rows.slice(skip, skip + pageSize);
    const reviewRequired = items.filter((item) => item.lifecycle.consistency.status === "REVIEW_REQUIRED").length;
    const total = Number(propertyTotal) + Number(groupTotal) + Number(tourTotal);

    return res.json({
      observationMode: true,
      generatedAt: new Date().toISOString(),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.min(20, Math.ceil(total / pageSize))),
      summary: {
        observedOnPage: items.length,
        consistentOnPage: items.length - reviewRequired,
        reviewRequiredOnPage: reviewRequired,
        byService: { property: Number(propertyTotal), groupStay: Number(groupTotal), tour: Number(tourTotal) },
      },
      items,
    });
  } catch (error: any) {
    console.error("GET /api/admin/lifecycle-health error:", error);
    return res.status(500).json({ error: "Unable to load lifecycle health", message: error?.message || "Unknown error" });
  }
});

export default router;
