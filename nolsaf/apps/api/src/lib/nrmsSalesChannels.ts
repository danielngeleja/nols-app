/**
 * Sales channel performance: every route a room can be sold through, scored
 * side by side so an owner can see which part of the sales force is actually
 * producing.
 *
 * Two things make this different from the existing reports source breakdown:
 *
 * 1. Marketplace stays are included. Reservation money fields are NULL/0 when
 *    source is NOLSAF because Booking stays commercially authoritative, so the
 *    caller passes the linked Booking/Invoice snapshot and this module reads
 *    accommodation value from there. The revenue analytics endpoint filters
 *    `bookingId: null`, which makes marketplace production invisible; here it
 *    is the first channel in the list.
 * 2. Channel is resolved past `source`. An agent-portal booking and a WhatsApp
 *    conversion both land as generic sources, so the agent link and the
 *    originating inquiry channel take precedence over the stored string.
 *
 * Everything here is pure so the windowing, attribution and ranking are
 * unit-testable without a database.
 */

export type SalesChannelKey =
  | "NOLSAF_MARKETPLACE"
  | "DIRECT_BOOKING"
  | "WHATSAPP"
  | "INSTAGRAM"
  | "AGENT_PORTAL"
  | "BOOKING_COM"
  | "EXPEDIA"
  | "AIRBNB"
  | "WALK_IN"
  | "PHONE"
  | "OTHER";

export type SalesChannelFamily = "MARKETPLACE" | "DIRECT" | "SOCIAL" | "B2B" | "OTA" | "ON_SITE";

/** How a channel is switched on, which decides what "not connected" means. */
export type SalesChannelActivation = "ALWAYS_ON" | "LISTING" | "MESSAGING" | "AGENTS" | "CHANNEL_MANAGER";

export type SalesChannelDefinition = {
  key: SalesChannelKey;
  label: string;
  family: SalesChannelFamily;
  activation: SalesChannelActivation;
  /** Provider code on ChannelConnection / messaging provider, when applicable. */
  providerCode: string | null;
  /** One line an owner can act on, shown under the channel name. */
  summary: string;
};

export const SALES_CHANNEL_CATALOGUE: SalesChannelDefinition[] = [
  { key: "NOLSAF_MARKETPLACE", label: "NoLSAF marketplace", family: "MARKETPLACE", activation: "LISTING", providerCode: null, summary: "Travellers booking your approved listing on nolsaf.com." },
  { key: "DIRECT_BOOKING", label: "Direct booking link", family: "DIRECT", activation: "ALWAYS_ON", providerCode: null, summary: "Your own booking page and QR codes. No commission is charged." },
  { key: "WHATSAPP", label: "WhatsApp", family: "SOCIAL", activation: "MESSAGING", providerCode: "WHATSAPP", summary: "Inbound chats converted into priced, held reservations." },
  { key: "INSTAGRAM", label: "Instagram", family: "SOCIAL", activation: "MESSAGING", providerCode: "INSTAGRAM", summary: "Direct messages converted into priced, held reservations." },
  { key: "AGENT_PORTAL", label: "Travel agents", family: "B2B", activation: "AGENTS", providerCode: null, summary: "Approved agencies selling your rooms at negotiated rates." },
  { key: "BOOKING_COM", label: "Booking.com", family: "OTA", activation: "CHANNEL_MANAGER", providerCode: "BOOKING_COM", summary: "Rates and availability pushed through the channel manager." },
  { key: "EXPEDIA", label: "Expedia Group", family: "OTA", activation: "CHANNEL_MANAGER", providerCode: "EXPEDIA", summary: "Rates and availability pushed through the channel manager." },
  { key: "AIRBNB", label: "Airbnb", family: "OTA", activation: "CHANNEL_MANAGER", providerCode: "AIRBNB", summary: "Calendar synchronised through an iCal feed." },
  { key: "WALK_IN", label: "Walk-in", family: "ON_SITE", activation: "ALWAYS_ON", providerCode: null, summary: "Guests booked at the front desk on arrival." },
  { key: "PHONE", label: "Phone and reception", family: "ON_SITE", activation: "ALWAYS_ON", providerCode: null, summary: "Reservations taken by phone or email at reception." },
  { key: "OTHER", label: "Other recorded", family: "ON_SITE", activation: "ALWAYS_ON", providerCode: null, summary: "Stays recorded without a specific selling channel." },
];

const CHANNEL_BY_KEY = new Map(SALES_CHANNEL_CATALOGUE.map((channel) => [channel.key, channel]));
const CHANNEL_ORDER = SALES_CHANNEL_CATALOGUE.map((channel) => channel.key);

export function salesChannelDefinition(key: SalesChannelKey): SalesChannelDefinition {
  return CHANNEL_BY_KEY.get(key) ?? CHANNEL_BY_KEY.get("OTHER")!;
}

export type ChannelAttributionInput = {
  source?: string | null;
  agentPropertyLinkId?: number | null;
  bookingId?: number | null;
  inquiryChannel?: string | null;
};

/**
 * Resolve one reservation to the channel that actually sold it.
 *
 * Order matters. A B2B booking is still stored with a generic source, and a
 * WhatsApp conversion is stored as DIRECT or PHONE depending on who keyed it,
 * so the structural links are read before the free-text source column.
 */
export function resolveSalesChannel(input: ChannelAttributionInput): SalesChannelKey {
  if (input.agentPropertyLinkId) return "AGENT_PORTAL";

  const source = String(input.source ?? "").trim().toUpperCase();
  if (source === "NOLSAF" || input.bookingId) return "NOLSAF_MARKETPLACE";
  if (source === "BOOKING_COM") return "BOOKING_COM";
  if (source === "EXPEDIA") return "EXPEDIA";
  if (source === "AIRBNB") return "AIRBNB";

  const inquiry = String(input.inquiryChannel ?? "").trim().toUpperCase();
  if (inquiry === "WHATSAPP") return "WHATSAPP";
  if (inquiry === "INSTAGRAM") return "INSTAGRAM";

  if (source === "DIRECT") return "DIRECT_BOOKING";
  if (source === "WALK_IN") return "WALK_IN";
  if (source === "PHONE") return "PHONE";
  return "OTHER";
}

export type SalesChannelBasis = "BOOKED" | "STAY";

export type SalesChannelReservation = {
  id: number;
  source?: string | null;
  status: string;
  currency?: string | null;
  createdAt: Date;
  checkIn: Date;
  checkOut: Date;
  cancelledAt?: Date | null;
  noShowAt?: Date | null;
  totalAmount?: unknown;
  chargesTotal?: unknown;
  amountPaid?: unknown;
  agentPropertyLinkId?: number | null;
  bookingId?: number | null;
  /** Active room allocations, used to weight room nights for multi-room stays. */
  roomCount?: number | null;
  agentAccount?: { id: number; name: string } | null;
  inquiryChannel?: string | null;
  /**
   * Non-voided master folio items. A routed charge leaves the guest folio and
   * lands on an agency bill, so it is neither cash in hand nor guest debt.
   * Without it an agent channel reads as 0% collected while being the single
   * biggest earner, because agency money never touches Reservation.amountPaid.
   */
  masterFolioItems?: Array<{ amount: unknown }> | null;
  /** Commercial snapshot for marketplace stays, where Booking owns the money. */
  marketplace?: { totalAmount: unknown; commissionAmount?: unknown; netPayable?: unknown } | null;
};

export type SalesChannelConnection = { providerCode: string; status: string; lastSuccessAt?: Date | null };
export type SalesChannelMessagingConnection = { provider: string; status: string };

export type SalesChannelReportInput = {
  rangeStart: Date;
  rangeEnd: Date;
  basis: SalesChannelBasis;
  reservations: SalesChannelReservation[];
  /** Same length window immediately before rangeStart, for the trend arrows. */
  previousReservations?: SalesChannelReservation[];
  connections?: SalesChannelConnection[];
  messagingConnections?: SalesChannelMessagingConnection[];
  activeAgentLinks?: number;
  pendingAgentLinks?: number;
  propertyStatus?: string | null;
  defaultCurrency?: string;
};

export type SalesChannelRow = {
  key: SalesChannelKey;
  label: string;
  family: SalesChannelFamily;
  currency: string;
  rank: number;
  reservations: number;
  roomNights: number;
  roomRevenue: number;
  extrasRevenue: number;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
  revenueShare: number;
  bookingShare: number;
  adr: number;
  averageStayValue: number;
  averageLengthOfStay: number;
  averageLeadTimeDays: number | null;
  /** Cash received. Guest folio payments plus marketplace payouts. */
  settled: number;
  /** Sitting on an agency master folio: billed, owed by the agency, not the guest. */
  routed: number;
  outstanding: number;
  /** Cash in hand over gross. Low is not automatically bad when `routed` is high. */
  collectionRate: number | null;
  /** Cash plus routed over gross: everything that is no longer an open guest balance. */
  settlementRate: number | null;
  cancellations: number;
  noShows: number;
  cancellationRate: number | null;
  previousNetRevenue: number;
  changePct: number | null;
  /** False for OTAs, where their commission is invoiced outside NRMS. */
  commissionKnown: boolean;
};

/**
 * MANUAL is the one that earns its place. A property can take real Booking.com
 * or WhatsApp business and key it in by hand, which used to render as "not
 * connected" beside several million shillings of revenue. That is the exact
 * moment to offer the integration, so it gets its own state and its own
 * call to action rather than being flattened into NOT_CONNECTED.
 */
export type SalesChannelState = "LIVE" | "MANUAL" | "ATTENTION" | "CONNECTED_IDLE" | "NOT_CONNECTED";

/** Where the owner goes to act on a channel. The web app owns the routes. */
export type SalesChannelAction =
  | "CONNECT_CHANNEL_MANAGER"
  | "FIX_CHANNEL"
  | "CONNECT_MESSAGING"
  | "FIX_MESSAGING"
  | "INVITE_AGENTS"
  | "REVIEW_AGENT_REQUESTS"
  | "COMPLETE_LISTING"
  | "SHARE_BOOKING_LINK";

export type SalesChannelReadiness = {
  key: SalesChannelKey;
  label: string;
  family: SalesChannelFamily;
  summary: string;
  state: SalesChannelState;
  detail: string;
  action: SalesChannelAction | null;
  /** Booking count across every currency. Money is read per currency from `channels`. */
  reservations: number;
};

export type SalesChannelGranularity = "day" | "week" | "month";

export type SalesChannelSeriesPoint = { key: string; label: string } & Record<string, number | string>;

export type SalesChannelCurrencyReport = {
  currency: string;
  summary: {
    reservations: number;
    roomNights: number;
    grossRevenue: number;
    commission: number;
    netRevenue: number;
    settled: number;
    routed: number;
    outstanding: number;
    adr: number;
    activeChannels: number;
    cancellations: number;
    noShows: number;
    previousNetRevenue: number;
    changePct: number | null;
  };
  channels: SalesChannelRow[];
  highlights: {
    topRevenue: SalesChannelKey | null;
    bestAdr: SalesChannelKey | null;
    bestCollection: SalesChannelKey | null;
    mostReliable: SalesChannelKey | null;
    fastestGrowing: SalesChannelKey | null;
    commissionFreeShare: number;
  };
};

export type SalesChannelReport = {
  basis: SalesChannelBasis;
  range: { from: string; to: string; days: number };
  granularity: SalesChannelGranularity;
  currencies: SalesChannelCurrencyReport[];
  readiness: SalesChannelReadiness[];
  series: SalesChannelSeriesPoint[];
  agents: Array<{ id: number; name: string; reservations: number; netRevenue: number; currency: string }>;
};

const REVENUE_STATUSES = new Set(["CONFIRMED", "CHECKED_IN", "CHECKED_OUT"]);
const DAY_MS = 86_400_000;

/**
 * Bookings a channel needs before it can win a "best at X" badge. One stay at
 * one rate is not evidence that a channel books the best rate, and a badge on
 * that basis is worse than no badge: it sends the owner chasing noise.
 */
const MIN_BADGE_SAMPLE = 3;

function decimal(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function pct(value: number, denominator: number): number | null {
  return denominator > 0 ? round((value / denominator) * 100) : null;
}

function nights(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / DAY_MS));
}

function inWindow(value: Date | null | undefined, start: Date, end: Date): boolean {
  if (!value) return false;
  const time = new Date(value).getTime();
  return time >= start.getTime() && time < end.getTime();
}

/** The date a reservation counts against, given the reporting lens. */
function basisDate(reservation: SalesChannelReservation, basis: SalesChannelBasis): Date {
  return basis === "BOOKED" ? new Date(reservation.createdAt) : new Date(reservation.checkIn);
}

function isInBasisWindow(reservation: SalesChannelReservation, input: Pick<SalesChannelReportInput, "basis" | "rangeStart" | "rangeEnd">): boolean {
  return inWindow(basisDate(reservation, input.basis), input.rangeStart, input.rangeEnd);
}

/**
 * Accommodation value for one stay. Marketplace stays carry zero on the
 * reservation by design, so the Booking snapshot is authoritative there and
 * the payout invoice supplies the commission the owner actually gives up.
 */
export function stayCommercials(reservation: SalesChannelReservation): {
  roomRevenue: number;
  extrasRevenue: number;
  commission: number;
  /** Cash actually received: guest folio payments, plus marketplace payouts. */
  settled: number;
  /** Moved onto an agency master folio. Owed by the agency, not by the guest. */
  routed: number;
} {
  const extrasRevenue = decimal(reservation.chargesTotal);
  const routed = (reservation.masterFolioItems ?? []).reduce((sum, item) => sum + decimal(item.amount), 0);
  if (reservation.marketplace) {
    const roomRevenue = decimal(reservation.marketplace.totalAmount);
    const commission = decimal(reservation.marketplace.commissionAmount);
    // NoLSAF collects the room from the guest and pays the owner out, so the
    // room side is settled even though nothing was posted to the guest folio.
    return { roomRevenue, extrasRevenue, commission, settled: roomRevenue + decimal(reservation.amountPaid), routed };
  }
  return {
    roomRevenue: decimal(reservation.totalAmount),
    extrasRevenue,
    commission: 0,
    settled: decimal(reservation.amountPaid),
    routed,
  };
}

type Accumulator = {
  reservations: number;
  roomNights: number;
  roomRevenue: number;
  extrasRevenue: number;
  commission: number;
  settled: number;
  routed: number;
  leadTimeDays: number;
  leadTimeSamples: number;
  stayNights: number;
  cancellations: number;
  noShows: number;
};

function emptyAccumulator(): Accumulator {
  return {
    reservations: 0, roomNights: 0, roomRevenue: 0, extrasRevenue: 0, commission: 0, settled: 0, routed: 0,
    leadTimeDays: 0, leadTimeSamples: 0, stayNights: 0, cancellations: 0, noShows: 0,
  };
}

function accumulate(bucket: Accumulator, reservation: SalesChannelReservation): void {
  const status = String(reservation.status || "").toUpperCase();
  if (status === "CANCELLED" || status === "CANCELED") { bucket.cancellations += 1; return; }
  if (status === "NO_SHOW") { bucket.noShows += 1; return; }
  if (!REVENUE_STATUSES.has(status)) return;

  const stayNights = nights(new Date(reservation.checkIn), new Date(reservation.checkOut));
  const rooms = Math.max(1, Number(reservation.roomCount ?? 1) || 1);
  const commercials = stayCommercials(reservation);

  bucket.reservations += 1;
  bucket.roomNights += stayNights * rooms;
  bucket.stayNights += stayNights;
  bucket.roomRevenue += commercials.roomRevenue;
  bucket.extrasRevenue += commercials.extrasRevenue;
  bucket.commission += commercials.commission;
  bucket.settled += commercials.settled;
  bucket.routed += commercials.routed;

  const leadDays = (new Date(reservation.checkIn).getTime() - new Date(reservation.createdAt).getTime()) / DAY_MS;
  if (Number.isFinite(leadDays) && leadDays >= 0) { bucket.leadTimeDays += leadDays; bucket.leadTimeSamples += 1; }
}

function currencyOf(reservation: SalesChannelReservation, fallback: string): string {
  return String(reservation.currency || fallback || "TZS").toUpperCase();
}

/** OTA commission is invoiced outside NRMS, so it is never claimed as known. */
function commissionIsKnown(key: SalesChannelKey): boolean {
  return salesChannelDefinition(key).family !== "OTA";
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Monday of the week containing `date`, in UTC. */
function startOfWeek(date: Date): Date {
  const at = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return new Date(at.getTime() - ((at.getUTCDay() + 6) % 7) * DAY_MS);
}

/** The bucket a date belongs to. Shared so gap-filling and totals never drift. */
export function seriesBucketKey(date: Date, granularity: SalesChannelGranularity): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "week") return startOfWeek(date).toISOString().slice(0, 10);
  return date.toISOString().slice(0, 7);
}

/**
 * Bucket size by window length. A quarter used to fall into monthly buckets,
 * which drew three slabs and read as a block rather than a trend, so anything
 * up to roughly six months is weekly.
 */
function bucketKeys(rangeStart: Date, rangeEnd: Date): { granularity: SalesChannelGranularity; buckets: Array<{ key: string; label: string }> } {
  const days = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS));
  const buckets: Array<{ key: string; label: string }> = [];

  if (days <= 62) {
    for (let at = new Date(rangeStart); at < rangeEnd; at = new Date(at.getTime() + DAY_MS)) {
      buckets.push({ key: seriesBucketKey(at, "day"), label: `${at.getUTCDate()} ${MONTH_NAMES[at.getUTCMonth()]}` });
    }
    return { granularity: "day", buckets };
  }

  if (days <= 186) {
    for (let at = startOfWeek(rangeStart); at < rangeEnd; at = new Date(at.getTime() + 7 * DAY_MS)) {
      buckets.push({ key: seriesBucketKey(at, "week"), label: `${at.getUTCDate()} ${MONTH_NAMES[at.getUTCMonth()]}` });
    }
    return { granularity: "week", buckets };
  }

  const cursor = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), 1));
  while (cursor < rangeEnd) {
    buckets.push({
      key: seriesBucketKey(cursor, "month"),
      label: `${MONTH_NAMES[cursor.getUTCMonth()]} ${String(cursor.getUTCFullYear()).slice(2)}`,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return { granularity: "month", buckets };
}

type ReadinessVerdict = { state: SalesChannelState; detail: string; action: SalesChannelAction | null };

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

function readinessState(definition: SalesChannelDefinition, input: SalesChannelReportInput, reservations: number): ReadinessVerdict {
  const connected = (code: string) => (input.connections ?? []).find((connection) => connection.providerCode.toUpperCase() === code);
  const messaging = (code: string) => (input.messagingConnections ?? []).find((connection) => connection.provider.toUpperCase() === code);

  if (definition.activation === "ALWAYS_ON") {
    if (reservations > 0) return { state: "LIVE", detail: `${plural(reservations, "reservation")} in this period`, action: null };
    return definition.key === "DIRECT_BOOKING"
      ? { state: "CONNECTED_IDLE", detail: "Ready to take bookings. Nobody used the link in this period.", action: "SHARE_BOOKING_LINK" }
      : { state: "CONNECTED_IDLE", detail: "Available, nothing was sold through it in this period", action: null };
  }

  if (definition.activation === "LISTING") {
    if (String(input.propertyStatus || "").toUpperCase() !== "APPROVED") {
      return { state: "NOT_CONNECTED", detail: "Your listing is not approved for the marketplace yet", action: "COMPLETE_LISTING" };
    }
    return reservations > 0
      ? { state: "LIVE", detail: `${plural(reservations, "marketplace stay")} in this period`, action: null }
      : { state: "CONNECTED_IDLE", detail: "Listing is live, no marketplace bookings in this period", action: null };
  }

  if (definition.activation === "MESSAGING") {
    const connection = messaging(definition.providerCode ?? "");
    if (!connection) {
      // Reception can log a chat enquiry by hand long before the account is
      // linked, so revenue here proves the channel works and is worth wiring.
      return reservations > 0
        ? { state: "MANUAL", detail: `${plural(reservations, "booking")} logged by hand. Link the account so replies and holds happen in one place.`, action: "CONNECT_MESSAGING" }
        : { state: "NOT_CONNECTED", detail: "Not linked. Connect the account in Reception inquiries.", action: "CONNECT_MESSAGING" };
    }
    const status = String(connection.status || "").toUpperCase();
    if (status === "REAUTH_REQUIRED" || status === "ERROR") return { state: "ATTENTION", detail: "Connection needs to be re-authorised. New messages are not arriving.", action: "FIX_MESSAGING" };
    if (status !== "CONNECTED") return { state: "ATTENTION", detail: "Connection is still pending activation", action: "FIX_MESSAGING" };
    return reservations > 0
      ? { state: "LIVE", detail: `${plural(reservations, "reservation")} converted from chat`, action: null }
      : { state: "CONNECTED_IDLE", detail: "Connected, no chat has converted into a reservation yet", action: null };
  }

  if (definition.activation === "AGENTS") {
    const active = Number(input.activeAgentLinks ?? 0);
    const pending = Number(input.pendingAgentLinks ?? 0);
    if (pending > 0 && !active) return { state: "ATTENTION", detail: `${plural(pending, "partnership request")} waiting for your decision`, action: "REVIEW_AGENT_REQUESTS" };
    if (!active) return { state: "NOT_CONNECTED", detail: "No approved agency is selling your rooms yet", action: "INVITE_AGENTS" };
    const agencies = `${active} active ${active === 1 ? "agency" : "agencies"}`;
    if (reservations > 0) return { state: "LIVE", detail: `${agencies}, ${plural(reservations, "booking")}`, action: pending > 0 ? "REVIEW_AGENT_REQUESTS" : null };
    return { state: "CONNECTED_IDLE", detail: `${agencies}, none of them booked in this period`, action: "INVITE_AGENTS" };
  }

  const connection = connected(definition.providerCode ?? "");
  if (!connection) {
    // The front desk is already recording this OTA's stays by hand. Saying
    // "not connected" beside that revenue reads as a contradiction, so the
    // manual effort is named and the channel manager is offered instead.
    return reservations > 0
      ? { state: "MANUAL", detail: `${plural(reservations, "stay")} keyed in by hand. Connect the channel manager to stop the double entry.`, action: "CONNECT_CHANNEL_MANAGER" }
      : { state: "NOT_CONNECTED", detail: "Not connected in OTA channels", action: "CONNECT_CHANNEL_MANAGER" };
  }
  const status = String(connection.status || "").toUpperCase();
  if (status !== "ACTIVE") return { state: "ATTENTION", detail: `Channel connection is ${status.toLowerCase()}`, action: "FIX_CHANNEL" };
  return reservations > 0
    ? { state: "LIVE", detail: `${plural(reservations, "reservation")} received automatically`, action: null }
    : { state: "CONNECTED_IDLE", detail: "Connected, no reservations received in this period", action: null };
}

export function buildSalesChannelReport(input: SalesChannelReportInput): SalesChannelReport {
  const fallbackCurrency = String(input.defaultCurrency || "TZS").toUpperCase();
  const windowed = input.reservations.filter((reservation) => isInBasisWindow(reservation, input));
  const previousWindowed = (input.previousReservations ?? []).filter((reservation) => {
    const days = Math.max(1, Math.round((input.rangeEnd.getTime() - input.rangeStart.getTime()) / DAY_MS));
    const previousStart = new Date(input.rangeStart.getTime() - days * DAY_MS);
    return inWindow(basisDate(reservation, input.basis), previousStart, input.rangeStart);
  });

  // currency -> channel -> totals
  const current = new Map<string, Map<SalesChannelKey, Accumulator>>();
  const previous = new Map<string, Map<SalesChannelKey, Accumulator>>();

  const collect = (target: Map<string, Map<SalesChannelKey, Accumulator>>, rows: SalesChannelReservation[]) => {
    for (const reservation of rows) {
      const currency = currencyOf(reservation, fallbackCurrency);
      const key = resolveSalesChannel(reservation);
      let byChannel = target.get(currency);
      if (!byChannel) { byChannel = new Map(); target.set(currency, byChannel); }
      let bucket = byChannel.get(key);
      if (!bucket) { bucket = emptyAccumulator(); byChannel.set(key, bucket); }
      accumulate(bucket, reservation);
    }
  };
  collect(current, windowed);
  collect(previous, previousWindowed);

  // Booking counts only. Readiness must stay currency-free, so the money shown
  // on a channel card is read from the currency report the page is displaying.
  const bookingsByChannel = new Map<SalesChannelKey, number>();

  const currencies: SalesChannelCurrencyReport[] = [...current.keys()].sort().map((currency) => {
    const byChannel = current.get(currency)!;
    const previousByChannel = previous.get(currency) ?? new Map<SalesChannelKey, Accumulator>();

    const totals = { gross: 0, bookings: 0 };
    for (const bucket of byChannel.values()) {
      totals.gross += bucket.roomRevenue + bucket.extrasRevenue;
      totals.bookings += bucket.reservations;
    }

    const rows: SalesChannelRow[] = [...byChannel.entries()].map(([key, bucket]) => {
      const definition = salesChannelDefinition(key);
      const grossRevenue = bucket.roomRevenue + bucket.extrasRevenue;
      const commissionKnown = commissionIsKnown(key);
      const netRevenue = grossRevenue - bucket.commission;
      const previousBucket = previousByChannel.get(key);
      const previousNet = previousBucket ? previousBucket.roomRevenue + previousBucket.extrasRevenue - previousBucket.commission : 0;
      const decided = bucket.reservations + bucket.cancellations + bucket.noShows;

      bookingsByChannel.set(key, (bookingsByChannel.get(key) ?? 0) + bucket.reservations);

      return {
        key,
        label: definition.label,
        family: definition.family,
        currency,
        rank: 0,
        reservations: bucket.reservations,
        roomNights: bucket.roomNights,
        roomRevenue: round(bucket.roomRevenue),
        extrasRevenue: round(bucket.extrasRevenue),
        grossRevenue: round(grossRevenue),
        commission: round(bucket.commission),
        netRevenue: round(netRevenue),
        revenueShare: pct(grossRevenue, totals.gross) ?? 0,
        bookingShare: pct(bucket.reservations, totals.bookings) ?? 0,
        adr: bucket.roomNights > 0 ? round(bucket.roomRevenue / bucket.roomNights) : 0,
        averageStayValue: bucket.reservations > 0 ? round(grossRevenue / bucket.reservations) : 0,
        averageLengthOfStay: bucket.reservations > 0 ? round(bucket.stayNights / bucket.reservations) : 0,
        averageLeadTimeDays: bucket.leadTimeSamples > 0 ? round(bucket.leadTimeDays / bucket.leadTimeSamples) : null,
        settled: round(bucket.settled),
        routed: round(bucket.routed),
        outstanding: round(Math.max(0, grossRevenue - bucket.settled - bucket.routed)),
        collectionRate: pct(Math.min(bucket.settled, grossRevenue), grossRevenue),
        settlementRate: pct(Math.min(bucket.settled + bucket.routed, grossRevenue), grossRevenue),
        cancellations: bucket.cancellations,
        noShows: bucket.noShows,
        cancellationRate: pct(bucket.cancellations + bucket.noShows, decided),
        previousNetRevenue: round(previousNet),
        changePct: previousNet > 0 ? round(((netRevenue - previousNet) / previousNet) * 100) : null,
        commissionKnown,
      };
    });

    rows.sort((left, right) => right.netRevenue - left.netRevenue || CHANNEL_ORDER.indexOf(left.key) - CHANNEL_ORDER.indexOf(right.key));
    rows.forEach((row, index) => { row.rank = index + 1; });

    const producing = rows.filter((row) => row.reservations > 0);
    const credible = producing.filter((row) => row.reservations >= MIN_BADGE_SAMPLE);
    const best = <T>(candidates: SalesChannelRow[], score: (row: SalesChannelRow) => T | null, better: (a: T, b: T) => boolean): SalesChannelKey | null => {
      let winner: { key: SalesChannelKey; value: T } | null = null;
      for (const row of candidates) {
        const value = score(row);
        if (value === null) continue;
        if (!winner || better(value, winner.value)) winner = { key: row.key, value };
      }
      return winner?.key ?? null;
    };

    const summaryTotals = rows.reduce(
      (sum, row) => ({
        reservations: sum.reservations + row.reservations,
        roomNights: sum.roomNights + row.roomNights,
        grossRevenue: sum.grossRevenue + row.grossRevenue,
        roomRevenue: sum.roomRevenue + row.roomRevenue,
        commission: sum.commission + row.commission,
        netRevenue: sum.netRevenue + row.netRevenue,
        settled: sum.settled + row.settled,
        routed: sum.routed + row.routed,
        outstanding: sum.outstanding + row.outstanding,
        cancellations: sum.cancellations + row.cancellations,
        noShows: sum.noShows + row.noShows,
        previousNetRevenue: sum.previousNetRevenue + row.previousNetRevenue,
      }),
      { reservations: 0, roomNights: 0, grossRevenue: 0, roomRevenue: 0, commission: 0, netRevenue: 0, settled: 0, routed: 0, outstanding: 0, cancellations: 0, noShows: 0, previousNetRevenue: 0 },
    );

    const commissionFree = rows
      .filter((row) => row.family === "DIRECT" || row.family === "SOCIAL" || row.family === "ON_SITE")
      .reduce((sum, row) => sum + row.grossRevenue, 0);

    return {
      currency,
      summary: {
        reservations: summaryTotals.reservations,
        roomNights: summaryTotals.roomNights,
        grossRevenue: round(summaryTotals.grossRevenue),
        commission: round(summaryTotals.commission),
        netRevenue: round(summaryTotals.netRevenue),
        settled: round(summaryTotals.settled),
        routed: round(summaryTotals.routed),
        outstanding: round(summaryTotals.outstanding),
        adr: summaryTotals.roomNights > 0 ? round(summaryTotals.roomRevenue / summaryTotals.roomNights) : 0,
        activeChannels: producing.length,
        cancellations: summaryTotals.cancellations,
        noShows: summaryTotals.noShows,
        previousNetRevenue: round(summaryTotals.previousNetRevenue),
        changePct: summaryTotals.previousNetRevenue > 0
          ? round(((summaryTotals.netRevenue - summaryTotals.previousNetRevenue) / summaryTotals.previousNetRevenue) * 100)
          : null,
      },
      channels: rows,
      highlights: {
        // Top earner is a fact about this period, so it needs no sample size.
        // Every other badge is a claim about how a channel behaves, and one
        // stay is not evidence of that, so those are drawn from `credible`.
        topRevenue: producing[0]?.key ?? null,
        bestAdr: best(credible, (row) => (row.adr > 0 ? row.adr : null), (a, b) => a > b),
        bestCollection: best(credible, (row) => row.settlementRate, (a, b) => a > b),
        mostReliable: best(
          credible.filter((row) => row.reservations + row.cancellations + row.noShows >= MIN_BADGE_SAMPLE),
          (row) => row.cancellationRate,
          (a, b) => a < b,
        ),
        fastestGrowing: best(credible, (row) => row.changePct, (a, b) => a > b),
        commissionFreeShare: pct(commissionFree, summaryTotals.grossRevenue) ?? 0,
      },
    };
  });

  const { granularity, buckets } = bucketKeys(input.rangeStart, input.rangeEnd);
  const seriesIndex = new Map<string, Record<string, number>>();
  for (const reservation of windowed) {
    const status = String(reservation.status || "").toUpperCase();
    if (!REVENUE_STATUSES.has(status)) continue;
    const key = seriesBucketKey(basisDate(reservation, input.basis), granularity);
    const channel = resolveSalesChannel(reservation);
    const commercials = stayCommercials(reservation);
    const row = seriesIndex.get(key) ?? {};
    row[channel] = round((row[channel] ?? 0) + commercials.roomRevenue + commercials.extrasRevenue - commercials.commission);
    seriesIndex.set(key, row);
  }
  const series: SalesChannelSeriesPoint[] = buckets.map((bucket) => {
    const values = seriesIndex.get(bucket.key) ?? {};
    const point: SalesChannelSeriesPoint = { key: bucket.key, label: bucket.label };
    for (const channel of CHANNEL_ORDER) point[channel] = values[channel] ?? 0;
    return point;
  });

  const readiness: SalesChannelReadiness[] = SALES_CHANNEL_CATALOGUE
    // "Other recorded" is a residual bucket, never something an owner connects.
    .filter((definition) => definition.key !== "OTHER")
    .map((definition) => {
      const reservations = bookingsByChannel.get(definition.key) ?? 0;
      const verdict = readinessState(definition, input, reservations);
      return {
        key: definition.key,
        label: definition.label,
        family: definition.family,
        summary: definition.summary,
        state: verdict.state,
        detail: verdict.detail,
        action: verdict.action,
        reservations,
      };
    });

  const agentTotals = new Map<string, { id: number; name: string; currency: string; reservations: number; netRevenue: number }>();
  for (const reservation of windowed) {
    if (!reservation.agentAccount) continue;
    if (!REVENUE_STATUSES.has(String(reservation.status || "").toUpperCase())) continue;
    const currency = currencyOf(reservation, fallbackCurrency);
    const mapKey = `${reservation.agentAccount.id}:${currency}`;
    const commercials = stayCommercials(reservation);
    const row = agentTotals.get(mapKey) ?? { id: reservation.agentAccount.id, name: reservation.agentAccount.name, currency, reservations: 0, netRevenue: 0 };
    row.reservations += 1;
    row.netRevenue += commercials.roomRevenue + commercials.extrasRevenue - commercials.commission;
    agentTotals.set(mapKey, row);
  }

  const days = Math.max(1, Math.round((input.rangeEnd.getTime() - input.rangeStart.getTime()) / DAY_MS));
  return {
    basis: input.basis,
    range: { from: input.rangeStart.toISOString().slice(0, 10), to: new Date(input.rangeEnd.getTime() - DAY_MS).toISOString().slice(0, 10), days },
    granularity,
    currencies,
    readiness,
    series,
    agents: [...agentTotals.values()]
      .map((row) => ({ ...row, netRevenue: round(row.netRevenue) }))
      .sort((left, right) => right.netRevenue - left.netRevenue || left.name.localeCompare(right.name))
      .slice(0, 10),
  };
}
