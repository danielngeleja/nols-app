// Sales channel performance for one NRMS property: what every selling route
// produced over a window, ranked side by side, plus which routes are connected
// at all. Aggregation lives in lib/nrmsSalesChannels.ts so it stays testable.
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { loadOwnedActiveNrmsProperty, requireNrms } from "../lib/nrms.js";
import { buildInquiryConversionReport } from "../lib/nrmsInquiryReporting.js";
import { buildSalesChannelReport, type SalesChannelBasis, type SalesChannelReservation } from "../lib/nrmsSalesChannels.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const NRMS_TIME_ZONE = "Africa/Dar_es_Salaam";
const DAY_MS = 86_400_000;
const MAX_WINDOW_DAYS = 366;
const MAX_RESERVATION_ROWS = 5_000;

function dateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: NRMS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function parseDay(value: unknown): Date | null {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00+03:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

const RESERVATION_SELECT = {
  id: true,
  source: true,
  status: true,
  currency: true,
  createdAt: true,
  checkIn: true,
  checkOut: true,
  cancelledAt: true,
  noShowAt: true,
  totalAmount: true,
  chargesTotal: true,
  amountPaid: true,
  agentPropertyLinkId: true,
  bookingId: true,
  allocations: { where: { status: "ACTIVE" }, select: { id: true } },
  // Agency money never lands on Reservation.amountPaid: it is routed onto a
  // master folio. Without these rows a travel-agent channel reads 0% collected.
  masterFolioItems: { where: { voidedAt: null }, select: { amount: true } },
  agentPropertyLink: { select: { agentAccount: { select: { id: true, legalName: true, tradingName: true } } } },
  guestInquiry: { select: { channel: true } },
  // Marketplace stays keep their money on Booking, and the payout invoice is
  // the only place the commission the owner gives up is recorded.
  booking: { select: { totalAmount: true, invoices: { select: { commissionAmount: true, netPayable: true, status: true }, orderBy: { id: "desc" as const }, take: 1 } } },
} as const;

function toChannelReservation(row: any): SalesChannelReservation {
  const invoice = row.booking?.invoices?.[0] ?? null;
  const agentAccount = row.agentPropertyLink?.agentAccount ?? null;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    currency: row.currency,
    createdAt: row.createdAt,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    cancelledAt: row.cancelledAt,
    noShowAt: row.noShowAt,
    totalAmount: row.totalAmount,
    chargesTotal: row.chargesTotal,
    amountPaid: row.amountPaid,
    agentPropertyLinkId: row.agentPropertyLinkId,
    bookingId: row.bookingId,
    roomCount: Array.isArray(row.allocations) ? row.allocations.length : 1,
    masterFolioItems: row.masterFolioItems ?? null,
    agentAccount: agentAccount ? { id: agentAccount.id, name: agentAccount.tradingName || agentAccount.legalName } : null,
    inquiryChannel: row.guestInquiry?.channel ?? null,
    marketplace: row.booking
      ? { totalAmount: row.booking.totalAmount, commissionAmount: invoice?.commissionAmount ?? 0, netPayable: invoice?.netPayable ?? null }
      : null,
  };
}

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;

    const today = dateKey(new Date());
    const defaultFrom = `${today.slice(0, 8)}01`;
    const rangeStart = parseDay(req.query.from ?? defaultFrom);
    const inclusiveTo = parseDay(req.query.to ?? today);
    if (!rangeStart || !inclusiveTo || inclusiveTo < rangeStart) {
      return res.status(400).json({ error: "Choose a valid date range" });
    }
    const rangeEnd = new Date(inclusiveTo.getTime() + DAY_MS);
    const days = Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS);
    if (days > MAX_WINDOW_DAYS) return res.status(400).json({ error: "Sales channel ranges cannot exceed 366 days" });

    const basis: SalesChannelBasis = String(req.query.basis ?? "BOOKED").toUpperCase() === "STAY" ? "STAY" : "BOOKED";
    const previousStart = new Date(rangeStart.getTime() - days * DAY_MS);

    const propertyId = active.property.id as number;
    const db = prisma as any;
    // One window filter per basis: BOOKED measures selling activity, STAY
    // measures the business that actually arrived.
    const windowFilter = (start: Date, end: Date) => (basis === "BOOKED" ? { createdAt: { gte: start, lt: end } } : { checkIn: { gte: start, lt: end } });

    // NrmsPublicMetric.metricDate is a DATE column stored at UTC midnight, so
    // the +03:00 window boundary has to be normalised before it is compared.
    const metricFrom = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate()));
    const metricTo = new Date(Date.UTC(rangeEnd.getUTCFullYear(), rangeEnd.getUTCMonth(), rangeEnd.getUTCDate()));

    const [profile, currentRows, previousRows, connections, messagingConnections, agentLinks, directMetrics, reportInquiries] = await Promise.all([
      // loadOwnedActiveNrmsProperty only selects the activation fields, and the
      // listing status decides whether the marketplace channel is even open.
      db.property.findUnique({ where: { id: propertyId }, select: { status: true, currency: true } }),
      db.reservation.findMany({ where: { propertyId, ...windowFilter(rangeStart, rangeEnd) }, select: RESERVATION_SELECT, take: MAX_RESERVATION_ROWS, orderBy: { id: "desc" } }),
      db.reservation.findMany({ where: { propertyId, ...windowFilter(previousStart, rangeStart) }, select: RESERVATION_SELECT, take: MAX_RESERVATION_ROWS, orderBy: { id: "desc" } }),
      db.channelConnection.findMany({ where: { propertyId }, select: { status: true, lastSuccessAt: true, provider: { select: { code: true } } } }),
      db.nrmsMessagingConnection.findMany({ where: { propertyId }, select: { provider: true, status: true } }),
      db.nrmsAgentPropertyLink.findMany({ where: { propertyId }, select: { status: true, hotelConsentStatus: true, agentConsentStatus: true } }),
      db.nrmsPublicMetric.findMany({ where: { propertyId, metricDate: { gte: metricFrom, lt: metricTo }, kind: { startsWith: "DIRECT:PAGE_OPEN:" } }, select: { kind: true, count: true } }),
      db.nrmsGuestInquiry.findMany({
        where: { propertyId, createdAt: { gte: rangeStart, lt: rangeEnd } },
        select: { source: true, createdAt: true, firstResponseAt: true, reservationId: true, reservation: { select: { status: true } } },
        take: MAX_RESERVATION_ROWS,
      }),
    ]);

    const activeAgentLinks = agentLinks.filter((link: any) => String(link.status || "").toUpperCase() === "ACTIVE").length;
    const pendingAgentLinks = agentLinks.filter((link: any) => {
      const status = String(link.status || "").toUpperCase();
      return status === "REQUESTED" || status === "INVITED" || status === "AGENT_ACCEPTED";
    }).length;

    const report = buildSalesChannelReport({
      rangeStart,
      rangeEnd,
      basis,
      reservations: currentRows.map(toChannelReservation),
      previousReservations: previousRows.map(toChannelReservation),
      connections: connections.map((connection: any) => ({ providerCode: connection.provider?.code ?? "", status: connection.status, lastSuccessAt: connection.lastSuccessAt })),
      messagingConnections: messagingConnections.map((connection: any) => ({ provider: connection.provider, status: connection.status })),
      activeAgentLinks,
      pendingAgentLinks,
      propertyStatus: profile?.status ?? null,
      defaultCurrency: profile?.currency || "TZS",
    });

    res.json({
      property: { id: propertyId, title: active.property.title, currency: profile?.currency || "TZS", status: profile?.status ?? null },
      ...report,
      // The chat and direct-page funnel is the only place a channel's losses
      // before a reservation exists are visible, so it is returned alongside.
      funnel: buildInquiryConversionReport(directMetrics, reportInquiries as any, days),
      agentPipeline: { active: activeAgentLinks, pending: pendingAgentLinks, total: agentLinks.length },
    });
  } catch (error) {
    console.error("[owner.nrms.salesChannels] report failed", error);
    res.status(500).json({ error: "Unable to load sales channel performance" });
  }
}) as RequestHandler);

export default router;
