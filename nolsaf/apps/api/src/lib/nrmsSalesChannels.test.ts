import { describe, expect, it } from "vitest";
import {
  buildSalesChannelReport,
  resolveSalesChannel,
  stayCommercials,
  type SalesChannelReservation,
} from "./nrmsSalesChannels.js";

const rangeStart = new Date("2026-08-01T00:00:00.000Z");
const rangeEnd = new Date("2026-09-01T00:00:00.000Z");

function reservation(overrides: Partial<SalesChannelReservation> & { id: number }): SalesChannelReservation {
  return {
    source: "DIRECT",
    status: "CONFIRMED",
    currency: "TZS",
    createdAt: new Date("2026-08-05T09:00:00.000Z"),
    checkIn: new Date("2026-08-10T00:00:00.000Z"),
    checkOut: new Date("2026-08-12T00:00:00.000Z"),
    totalAmount: 200_000,
    chargesTotal: 0,
    amountPaid: 200_000,
    roomCount: 1,
    ...overrides,
  };
}

describe("resolveSalesChannel", () => {
  it("reads the agent link before the stored source", () => {
    expect(resolveSalesChannel({ source: "DIRECT", agentPropertyLinkId: 9 })).toBe("AGENT_PORTAL");
  });

  it("treats a linked marketplace booking as the marketplace channel", () => {
    expect(resolveSalesChannel({ source: "WALK_IN", bookingId: 12 })).toBe("NOLSAF_MARKETPLACE");
    expect(resolveSalesChannel({ source: "NOLSAF" })).toBe("NOLSAF_MARKETPLACE");
  });

  it("credits the originating chat when a generic source was keyed by reception", () => {
    expect(resolveSalesChannel({ source: "PHONE", inquiryChannel: "WHATSAPP" })).toBe("WHATSAPP");
    expect(resolveSalesChannel({ source: "DIRECT", inquiryChannel: "INSTAGRAM" })).toBe("INSTAGRAM");
  });

  it("keeps OTA sources ahead of any inquiry attribution", () => {
    expect(resolveSalesChannel({ source: "EXPEDIA", inquiryChannel: "WHATSAPP" })).toBe("EXPEDIA");
  });

  it("falls back to OTHER for anything unrecognised", () => {
    expect(resolveSalesChannel({ source: "TRIVAGO" })).toBe("OTHER");
    expect(resolveSalesChannel({})).toBe("OTHER");
  });
});

describe("stayCommercials", () => {
  it("reads marketplace money from the booking snapshot, not the reservation", () => {
    const result = stayCommercials(reservation({
      id: 1,
      source: "NOLSAF",
      totalAmount: 0,
      amountPaid: 0,
      chargesTotal: 30_000,
      marketplace: { totalAmount: 500_000, commissionAmount: 50_000, netPayable: 450_000 },
    }));
    expect(result).toEqual({ roomRevenue: 500_000, extrasRevenue: 30_000, commission: 50_000, settled: 500_000, routed: 0 });
  });

  it("uses the reservation snapshot for every non-marketplace stay", () => {
    const result = stayCommercials(reservation({ id: 2, totalAmount: 120_000, chargesTotal: 15_000, amountPaid: 90_000 }));
    expect(result).toEqual({ roomRevenue: 120_000, extrasRevenue: 15_000, commission: 0, settled: 90_000, routed: 0 });
  });

  it("separates money routed to an agency bill from cash received", () => {
    const result = stayCommercials(reservation({
      id: 3, totalAmount: 400_000, amountPaid: 0, chargesTotal: 0,
      masterFolioItems: [{ amount: 300_000 }, { amount: 100_000 }],
    }));
    expect(result.settled).toBe(0);
    expect(result.routed).toBe(400_000);
  });
});

describe("buildSalesChannelReport", () => {
  const reservations: SalesChannelReservation[] = [
    // Marketplace: 500k gross, 50k commission, settled by NoLSAF.
    reservation({
      id: 1, source: "NOLSAF", totalAmount: 0, amountPaid: 0,
      marketplace: { totalAmount: 500_000, commissionAmount: 50_000, netPayable: 450_000 },
    }),
    // Direct: 300k gross, fully collected on the folio.
    reservation({ id: 2, source: "DIRECT", totalAmount: 300_000, amountPaid: 300_000 }),
    // WhatsApp conversion keyed as PHONE, 200k, half collected.
    reservation({ id: 3, source: "PHONE", inquiryChannel: "WHATSAPP", totalAmount: 200_000, amountPaid: 100_000 }),
    // Agent portal, two rooms.
    reservation({
      id: 4, source: "DIRECT", agentPropertyLinkId: 7, roomCount: 2, totalAmount: 400_000, amountPaid: 400_000,
      agentAccount: { id: 3, name: "Serengeti Travel" },
    }),
    // Cancelled direct booking, must not add revenue.
    reservation({ id: 5, source: "DIRECT", status: "CANCELLED", cancelledAt: new Date("2026-08-08T00:00:00.000Z"), totalAmount: 999_000, amountPaid: 0 }),
    // Outside the window on the booked basis.
    reservation({ id: 6, source: "DIRECT", createdAt: new Date("2026-06-01T00:00:00.000Z"), checkIn: new Date("2026-06-02T00:00:00.000Z"), checkOut: new Date("2026-06-03T00:00:00.000Z"), totalAmount: 700_000 }),
  ];

  const report = buildSalesChannelReport({
    rangeStart,
    rangeEnd,
    basis: "BOOKED",
    reservations,
    previousReservations: [
      reservation({ id: 20, source: "DIRECT", createdAt: new Date("2026-07-10T00:00:00.000Z"), totalAmount: 150_000, amountPaid: 150_000 }),
    ],
    connections: [{ providerCode: "EXPEDIA", status: "ACTIVE" }],
    messagingConnections: [{ provider: "WHATSAPP", status: "CONNECTED" }],
    activeAgentLinks: 1,
    pendingAgentLinks: 2,
    propertyStatus: "APPROVED",
    defaultCurrency: "TZS",
  });

  const tzs = report.currencies.find((entry) => entry.currency === "TZS")!;
  const channel = (key: string) => tzs.channels.find((row) => row.key === key)!;

  it("excludes reservations outside the basis window", () => {
    expect(tzs.summary.reservations).toBe(4);
    expect(tzs.channels.some((row) => row.grossRevenue === 700_000)).toBe(false);
  });

  it("ranks channels by net revenue after commission", () => {
    expect(tzs.channels.map((row) => row.key).slice(0, 4)).toEqual([
      "NOLSAF_MARKETPLACE", // 500k gross less 50k commission = 450k
      "AGENT_PORTAL", // 400k
      "DIRECT_BOOKING", // 300k
      "WHATSAPP", // 200k
    ]);
    expect(channel("NOLSAF_MARKETPLACE").rank).toBe(1);
    expect(channel("NOLSAF_MARKETPLACE").netRevenue).toBe(450_000);
    expect(channel("NOLSAF_MARKETPLACE").commission).toBe(50_000);
  });

  it("weights room nights by rooms held, so ADR reflects the real rate", () => {
    // 2 nights x 2 rooms = 4 room nights against 400,000.
    expect(channel("AGENT_PORTAL").roomNights).toBe(4);
    expect(channel("AGENT_PORTAL").adr).toBe(100_000);
    expect(channel("DIRECT_BOOKING").roomNights).toBe(2);
    expect(channel("DIRECT_BOOKING").adr).toBe(150_000);
  });

  it("counts marketplace room revenue as settled and folio shortfalls as outstanding", () => {
    expect(channel("NOLSAF_MARKETPLACE").outstanding).toBe(0);
    expect(channel("NOLSAF_MARKETPLACE").collectionRate).toBe(100);
    expect(channel("WHATSAPP").outstanding).toBe(100_000);
    expect(channel("WHATSAPP").collectionRate).toBe(50);
  });

  it("keeps cancellations out of revenue but inside the reliability rate", () => {
    expect(channel("DIRECT_BOOKING").grossRevenue).toBe(300_000);
    expect(channel("DIRECT_BOOKING").cancellations).toBe(1);
    expect(channel("DIRECT_BOOKING").cancellationRate).toBe(50);
  });

  it("computes lead time from booking to arrival", () => {
    expect(channel("DIRECT_BOOKING").averageLeadTimeDays).toBe(4.63);
  });

  it("names the top earner and the commission-free share", () => {
    expect(tzs.highlights.topRevenue).toBe("NOLSAF_MARKETPLACE");
    expect(channel("NOLSAF_MARKETPLACE").adr).toBe(250_000);
    // 500k direct + whatsapp + walk-in style revenue over 1,400k gross.
    expect(tzs.highlights.commissionFreeShare).toBe(35.71);
  });

  it("withholds behaviour badges until a channel has enough bookings", () => {
    // Every channel in this fixture has exactly one stay, so nothing has
    // earned the right to be called best at anything.
    expect(tzs.highlights.bestAdr).toBeNull();
    expect(tzs.highlights.bestCollection).toBeNull();
    expect(tzs.highlights.mostReliable).toBeNull();
    expect(tzs.highlights.fastestGrowing).toBeNull();
    // The top earner is a fact about the period, so it still stands.
    expect(tzs.highlights.topRevenue).not.toBeNull();
  });

  it("awards behaviour badges once the sample is credible", () => {
    const busy = buildSalesChannelReport({
      rangeStart, rangeEnd, basis: "BOOKED",
      reservations: [
        // Walk-in: 3 stays at a strong rate, all paid on the spot.
        ...[1, 2, 3].map((n) => reservation({ id: 100 + n, source: "WALK_IN", totalAmount: 300_000, amountPaid: 300_000 })),
        // Direct: 3 stays at a weaker rate, half collected.
        ...[1, 2, 3].map((n) => reservation({ id: 200 + n, source: "DIRECT", totalAmount: 100_000, amountPaid: 50_000 })),
        // Airbnb: one lucky high-rate night. Best ADR in the whole period, and
        // fully paid, but a single stay must not win a behaviour badge.
        reservation({ id: 300, source: "AIRBNB", totalAmount: 800_000, amountPaid: 800_000, checkOut: new Date("2026-08-11T00:00:00.000Z") }),
      ],
    });
    const currency = busy.currencies[0]!;
    const airbnb = currency.channels.find((entry) => entry.key === "AIRBNB")!;
    expect(airbnb.adr).toBe(800_000);
    expect(airbnb.collectionRate).toBe(100);
    // Highest rate and perfect collection, yet no badge on one stay.
    expect(currency.highlights.bestAdr).toBe("WALK_IN");
    expect(currency.highlights.bestCollection).toBe("WALK_IN");
    expect(currency.highlights.topRevenue).toBe("WALK_IN");
  });

  it("counts money routed to an agency bill as settled, not as guest debt", () => {
    const agency = buildSalesChannelReport({
      rangeStart, rangeEnd, basis: "BOOKED",
      reservations: [
        reservation({
          id: 400, source: "DIRECT", agentPropertyLinkId: 7, totalAmount: 45_762_500, amountPaid: 0,
          masterFolioItems: [{ amount: 45_762_500 }],
        }),
      ],
    });
    const row = agency.currencies[0]!.channels.find((entry) => entry.key === "AGENT_PORTAL")!;
    expect(row.routed).toBe(45_762_500);
    // No cash has arrived yet, so the cash rate is honestly zero...
    expect(row.collectionRate).toBe(0);
    // ...but nothing is outstanding on the guest folio, which is the point.
    expect(row.settlementRate).toBe(100);
    expect(row.outstanding).toBe(0);
  });

  it("compares against the preceding window of the same length", () => {
    expect(channel("DIRECT_BOOKING").previousNetRevenue).toBe(150_000);
    expect(channel("DIRECT_BOOKING").changePct).toBe(100);
  });

  it("reports what is connected versus dormant, separately from revenue", () => {
    const state = (key: string) => report.readiness.find((row) => row.key === key)!;
    expect(state("WHATSAPP").state).toBe("LIVE");
    expect(state("INSTAGRAM").state).toBe("NOT_CONNECTED");
    expect(state("EXPEDIA").state).toBe("CONNECTED_IDLE");
    expect(state("BOOKING_COM").state).toBe("NOT_CONNECTED");
    expect(state("AGENT_PORTAL").state).toBe("LIVE");
    expect(report.readiness.some((row) => row.key === "OTHER")).toBe(false);
  });

  it("keeps readiness currency free, so money is read per currency instead", () => {
    expect(report.readiness.every((row) => !("netRevenue" in row))).toBe(true);
    expect(report.readiness.find((row) => row.key === "AGENT_PORTAL")!.reservations).toBe(1);
  });

  it("calls an OTA that is producing without a connection manual, not unconnected", () => {
    const manual = buildSalesChannelReport({
      rangeStart, rangeEnd, basis: "BOOKED",
      // Front desk keying Booking.com stays in by hand, no channel connection.
      reservations: [
        reservation({ id: 40, source: "BOOKING_COM", totalAmount: 4_436_000 }),
        reservation({ id: 41, source: "BOOKING_COM", totalAmount: 500_000 }),
      ],
    });
    const bookingCom = manual.readiness.find((row) => row.key === "BOOKING_COM")!;
    expect(bookingCom.state).toBe("MANUAL");
    expect(bookingCom.detail).toContain("2 stays keyed in by hand");
    expect(bookingCom.action).toBe("CONNECT_CHANNEL_MANAGER");
    // The revenue is still attributed to the channel, not hidden.
    expect(manual.currencies[0]!.channels.find((row) => row.key === "BOOKING_COM")!.grossRevenue).toBe(4_936_000);
  });

  it("calls an unlinked chat channel that is producing manual too", () => {
    const manual = buildSalesChannelReport({
      rangeStart, rangeEnd, basis: "BOOKED",
      reservations: [reservation({ id: 42, source: "PHONE", inquiryChannel: "WHATSAPP", totalAmount: 200_000 })],
      messagingConnections: [],
    });
    const whatsapp = manual.readiness.find((row) => row.key === "WHATSAPP")!;
    expect(whatsapp.state).toBe("MANUAL");
    expect(whatsapp.action).toBe("CONNECT_MESSAGING");
  });

  it("offers the next step on every channel that is not already producing", () => {
    const cold = buildSalesChannelReport({ rangeStart, rangeEnd, basis: "BOOKED", reservations: [], propertyStatus: "PENDING" });
    const action = (key: string) => cold.readiness.find((row) => row.key === key)!.action;
    expect(action("NOLSAF_MARKETPLACE")).toBe("COMPLETE_LISTING");
    expect(action("DIRECT_BOOKING")).toBe("SHARE_BOOKING_LINK");
    expect(action("INSTAGRAM")).toBe("CONNECT_MESSAGING");
    expect(action("AIRBNB")).toBe("CONNECT_CHANNEL_MANAGER");
    expect(action("AGENT_PORTAL")).toBe("INVITE_AGENTS");
    // A channel that is already working needs no call to action.
    expect(action("WALK_IN")).toBeNull();
  });

  it("routes a broken connection to the repair screen, not the setup screen", () => {
    const broken = buildSalesChannelReport({
      rangeStart, rangeEnd, basis: "BOOKED", reservations: [],
      connections: [{ providerCode: "EXPEDIA", status: "ERROR" }],
      messagingConnections: [{ provider: "WHATSAPP", status: "REAUTH_REQUIRED" }],
    });
    const expedia = broken.readiness.find((row) => row.key === "EXPEDIA")!;
    expect(expedia.state).toBe("ATTENTION");
    expect(expedia.action).toBe("FIX_CHANNEL");
    expect(broken.readiness.find((row) => row.key === "WHATSAPP")!.action).toBe("FIX_MESSAGING");
  });

  it("flags a marketplace listing that is not approved yet", () => {
    const pending = buildSalesChannelReport({ rangeStart, rangeEnd, basis: "BOOKED", reservations: [], propertyStatus: "PENDING" });
    expect(pending.readiness.find((row) => row.key === "NOLSAF_MARKETPLACE")!.state).toBe("NOT_CONNECTED");
  });

  it("flags agencies waiting on a decision", () => {
    const waiting = buildSalesChannelReport({ rangeStart, rangeEnd, basis: "BOOKED", reservations: [], activeAgentLinks: 0, pendingAgentLinks: 3 });
    const agents = waiting.readiness.find((row) => row.key === "AGENT_PORTAL")!;
    expect(agents.state).toBe("ATTENTION");
    expect(agents.detail).toContain("3 partnership requests");
    expect(agents.action).toBe("REVIEW_AGENT_REQUESTS");
  });

  it("builds a gap-free daily series for a one month window", () => {
    expect(report.granularity).toBe("day");
    expect(report.series).toHaveLength(31);
    const bookedDay = report.series.find((point) => point.key === "2026-08-05")!;
    expect(bookedDay.DIRECT_BOOKING).toBe(300_000);
    expect(bookedDay.NOLSAF_MARKETPLACE).toBe(450_000);
    expect(report.series.find((point) => point.key === "2026-08-20")!.DIRECT_BOOKING).toBe(0);
    expect(report.series[0]!.label).toBe("1 Aug");
  });

  it("uses weekly buckets for a quarter, so a trend is visible", () => {
    // Monthly buckets over 90 days drew three slabs and read as a block.
    const quarter = buildSalesChannelReport({
      rangeStart: new Date("2026-05-27T00:00:00.000Z"),
      rangeEnd: new Date("2026-08-25T00:00:00.000Z"),
      basis: "BOOKED",
      reservations,
    });
    expect(quarter.granularity).toBe("week");
    expect(quarter.series.length).toBeGreaterThanOrEqual(13);
    // Buckets start on the Monday on or before the range start.
    expect(quarter.series[0]!.key).toBe("2026-05-25");
    expect(quarter.series[0]!.label).toBe("25 May");
    // 5 Aug 2026 is a Wednesday, so its revenue lands in the 3 Aug week.
    const week = quarter.series.find((point) => point.key === "2026-08-03")!;
    expect(week.DIRECT_BOOKING).toBe(300_000);
    expect(week.NOLSAF_MARKETPLACE).toBe(450_000);
  });

  it("switches to monthly buckets on a long window", () => {
    const yearly = buildSalesChannelReport({
      rangeStart: new Date("2026-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2027-01-01T00:00:00.000Z"),
      basis: "BOOKED",
      reservations,
    });
    expect(yearly.granularity).toBe("month");
    expect(yearly.series).toHaveLength(12);
    expect(yearly.series[0]!.label).toBe("Jan 26");
  });

  it("ranks the agencies actually producing business", () => {
    expect(report.agents).toEqual([{ id: 3, name: "Serengeti Travel", currency: "TZS", reservations: 1, netRevenue: 400_000 }]);
  });

  it("reports each currency separately instead of summing across them", () => {
    const mixed = buildSalesChannelReport({
      rangeStart, rangeEnd, basis: "BOOKED",
      reservations: [
        reservation({ id: 30, currency: "TZS", totalAmount: 100_000 }),
        reservation({ id: 31, currency: "USD", totalAmount: 400 }),
      ],
    });
    expect(mixed.currencies.map((entry) => entry.currency)).toEqual(["TZS", "USD"]);
    expect(mixed.currencies[1]!.summary.grossRevenue).toBe(400);
  });

  it("uses arrivals when the stay basis is selected", () => {
    const stayBasis = buildSalesChannelReport({
      rangeStart: new Date("2026-06-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-07-01T00:00:00.000Z"),
      basis: "STAY",
      reservations,
    });
    expect(stayBasis.currencies[0]!.summary.reservations).toBe(1);
    expect(stayBasis.currencies[0]!.summary.grossRevenue).toBe(700_000);
  });
});
