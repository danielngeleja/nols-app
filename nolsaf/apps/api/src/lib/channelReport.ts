/**
 * Channels report (docs/CHANNEL_ATTRIBUTION.md): stays, tours and long stays
 * created in a window, grouped by the channel that brought them, with how many
 * were paid, the money collected and NoLSAF's own take, in TZS.
 *
 * Channel of each record, strongest first:
 *  1. PARTNER_LINK when an Agency Desk attribution is ACTIVE (server-verified).
 *  2. The first-visit source recorded at creation (consented cookie).
 *  3. NOT_RECORDED: no consent, an app booking, or older than the feature.
 *
 * Cost is what NoLSAF owes partners for partner-link sales (Agency Desk
 * commissions). Paid advertising is not in NoLSAF yet, so other channels show
 * no cost rather than a guess.
 */
export const REPORT_CHANNELS = ["SEARCH", "SOCIAL", "CAMPAIGN", "QR", "PARTNER_LINK", "REFERRAL", "DIRECT", "NOT_RECORDED"] as const;
export type ReportChannel = (typeof REPORT_CHANNELS)[number];
type Stream = "stays" | "tours" | "longStays";

export type ChannelRow = {
  channel: ReportChannel;
  created: number;
  paid: number;
  collectedTzs: number;
  nolsafTakeTzs: number;
  partnerCostTzs: number;
  byStream: Record<Stream, { created: number; paid: number }>;
  topSources: Array<{ source: string; paid: number }>;
};

const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};
const LIMIT = 20_000;
const CLOSED_COMMISSION = ["REVERSED", "CANCELLED"];

function emptyRow(channel: ReportChannel): ChannelRow & { sources: Map<string, number> } {
  return {
    channel, created: 0, paid: 0, collectedTzs: 0, nolsafTakeTzs: 0, partnerCostTzs: 0,
    byStream: { stays: { created: 0, paid: 0 }, tours: { created: 0, paid: 0 }, longStays: { created: 0, paid: 0 } },
    topSources: [], sources: new Map(),
  };
}

export async function computeChannelReport(db: any, input: { from: Date; to: Date; tzsPerUnit: Record<string, number> }) {
  const window = { gte: input.from, lt: input.to };
  const toTzs = (amount: number, currency: string | null | undefined) =>
    amount * (input.tzsPerUnit[String(currency || "TZS").toUpperCase()] ?? 0);

  const [bookings, tours, tenancies] = await Promise.all([
    db.booking.findMany({
      where: { createdAt: window },
      select: { id: true, invoices: { select: { total: true, commissionAmount: true, paidAt: true, invoiceNumber: true } }, property: { select: { currency: true } } },
      take: LIMIT,
    }),
    db.tourBooking.findMany({
      where: { createdAt: window },
      select: { id: true, paymentStatus: true, grossAmount: true, commissionAmount: true, currency: true },
      take: LIMIT,
    }),
    db.tenancy.findMany({
      where: { createdAt: window },
      select: { id: true, paidAt: true, bookingAmount: true, tenantFee: true, landlordCommission: true, currency: true, payoutStatus: true },
      take: LIMIT,
    }).catch(() => [] as any[]),
  ]);

  const ids = { BOOKING: bookings.map((b: any) => b.id), TOUR_BOOKING: tours.map((t: any) => t.id), TENANCY: tenancies.map((t: any) => t.id) };
  let migrationNeeded = false;
  const lookups = Object.entries(ids).filter(([, list]) => list.length).map(([targetType, list]) => ({ targetType, targetId: { in: list } }));
  const sources: any[] = await db.acquisitionSource.findMany({
    // Probe the table even when the window is empty, so a missing migration shows.
    where: lookups.length ? { OR: lookups } : { id: -1 },
    select: { targetType: true, targetId: true, channel: true, source: true, campaign: true },
  }).catch((error: any) => {
    if (error?.code !== "P2021") throw error;
    migrationNeeded = true;
    return [];
  });
  const sourceOf = new Map(sources.map((s) => [`${s.targetType}:${s.targetId}`, s]));

  const [stayLinks, tourLinks] = await Promise.all([
    ids.BOOKING.length ? db.bookingChannelAttribution.findMany({ where: { bookingId: { in: ids.BOOKING }, status: "ACTIVE" }, select: { bookingId: true } }).catch(() => []) : [],
    ids.TOUR_BOOKING.length ? db.tourBookingAttribution.findMany({ where: { tourBookingId: { in: ids.TOUR_BOOKING }, status: "ACTIVE" }, select: { tourBookingId: true } }).catch(() => []) : [],
  ]);
  const partnerStays = new Set<number>(stayLinks.map((r: any) => r.bookingId));
  const partnerTours = new Set<number>(tourLinks.map((r: any) => r.tourBookingId));

  const rows = new Map<ReportChannel, ReturnType<typeof emptyRow>>(REPORT_CHANNELS.map((c) => [c, emptyRow(c)]));
  const channelFor = (key: string, partner: boolean): { channel: ReportChannel; label: string | null } => {
    if (partner) return { channel: "PARTNER_LINK", label: "agency desk" };
    const s = sourceOf.get(key);
    if (!s) return { channel: "NOT_RECORDED", label: null };
    const channel = (REPORT_CHANNELS as readonly string[]).includes(s.channel) ? (s.channel as ReportChannel) : "NOT_RECORDED";
    return { channel, label: s.campaign || s.source || null };
  };
  const add = (stream: Stream, key: string, partner: boolean, paid: boolean, collected: number, take: number) => {
    const { channel, label } = channelFor(key, partner);
    const row = rows.get(channel)!;
    row.created += 1;
    row.byStream[stream].created += 1;
    if (!paid) return;
    row.paid += 1;
    row.byStream[stream].paid += 1;
    row.collectedTzs += collected;
    row.nolsafTakeTzs += take;
    if (label) row.sources.set(label, (row.sources.get(label) ?? 0) + 1);
  };

  for (const b of bookings) {
    // The guest's own payment, not an owner's payout claim (OINV-).
    const paid = (b.invoices ?? []).filter((i: any) => i.paidAt && !String(i.invoiceNumber ?? "").startsWith("OINV-"));
    const currency = b.property?.currency || "TZS";
    add("stays", `BOOKING:${b.id}`, partnerStays.has(b.id), paid.length > 0,
      paid.reduce((t: number, i: any) => t + toTzs(n(i.total), currency), 0),
      paid.reduce((t: number, i: any) => t + toTzs(n(i.commissionAmount), currency), 0));
  }
  for (const t of tours) {
    add("tours", `TOUR_BOOKING:${t.id}`, partnerTours.has(t.id), String(t.paymentStatus).toUpperCase() === "PAID",
      toTzs(n(t.grossAmount), t.currency), toTzs(n(t.commissionAmount), t.currency));
  }
  for (const t of tenancies) {
    const refunded = ["REFUND_DUE", "REFUNDED"].includes(String(t.payoutStatus));
    add("longStays", `TENANCY:${t.id}`, false, Boolean(t.paidAt) && !refunded,
      toTzs(n(t.bookingAmount), t.currency), toTzs(n(t.tenantFee) + n(t.landlordCommission), t.currency));
  }

  // Partner cost: Agency Desk commissions on the partner-link sales in this window.
  if (partnerStays.size || partnerTours.size) {
    const commissions = await db.salesCommission.findMany({
      where: {
        status: { notIn: CLOSED_COMMISSION },
        OR: [
          ...(partnerStays.size ? [{ type: "AGENCY_STAY", sourceBookingId: { in: [...partnerStays] } }] : []),
          ...(partnerTours.size ? [{ type: "AGENCY_TOUR", sourceKey: { in: [...partnerTours].map((id) => `AGENCY_TOUR:${id}`) } }] : []),
        ],
      },
      select: { commissionAmount: true, currency: true },
    }).catch(() => []);
    rows.get("PARTNER_LINK")!.partnerCostTzs = commissions.reduce((t: number, c: any) => t + toTzs(n(c.commissionAmount), c.currency), 0);
  }

  const result: ChannelRow[] = [...rows.values()].map(({ sources: map, ...row }) => ({
    ...row,
    collectedTzs: Math.round(row.collectedTzs),
    nolsafTakeTzs: Math.round(row.nolsafTakeTzs),
    partnerCostTzs: Math.round(row.partnerCostTzs),
    topSources: [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([source, paid]) => ({ source, paid })),
  }));
  const total = result.reduce((t, r) => ({ created: t.created + r.created, paid: t.paid + r.paid, collectedTzs: t.collectedTzs + r.collectedTzs, nolsafTakeTzs: t.nolsafTakeTzs + r.nolsafTakeTzs }), { created: 0, paid: 0, collectedTzs: 0, nolsafTakeTzs: 0 });
  const truncated = bookings.length >= LIMIT || tours.length >= LIMIT || tenancies.length >= LIMIT;
  return { channels: result, total, migrationNeeded, truncated };
}
