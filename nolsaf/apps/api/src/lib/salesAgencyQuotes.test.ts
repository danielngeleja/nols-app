import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
const gate = { enabled: true, failure: null as string | null };
vi.mock("./salesAgency.js", () => ({
  isAgencyDeskEnabled: () => gate.enabled,
  loadAgencyGateInput: async () => ({}),
  agencyGateFailure: () => gate.failure,
}));

import {
  QuoteError, checkQuoteForBooking, dayOf, effectiveQuoteStatus, hasFeature, hashQuoteToken, isQuoteToken, isoDay, newQuoteRef, newQuoteToken, searchByNeed,
} from "./salesAgencyQuotes.js";

describe("quote dates", () => {
  it("parses YYYY-MM-DD as local midnight and reads it back the same way", () => {
    const d = dayOf("2026-12-24");
    expect(d.getHours()).toBe(0);
    expect(isoDay(d)).toBe("2026-12-24");
  });
  it("refuses bad or impossible dates", () => {
    expect(() => dayOf("24/12/2026")).toThrow(QuoteError);
    expect(() => dayOf("2026-02-30")).toThrow(QuoteError);
  });
});

describe("listing features", () => {
  it("reads the owner's answers", () => {
    expect(hasFeature({ parking: "free" }, "parking")).toBe(true);
    expect(hasFeature({ parking: "no" }, "parking")).toBe(false);
    expect(hasFeature(JSON.stringify({ socialHall: true }), "eventSpace")).toBe(true);
    expect(hasFeature({ amenities: ["Swimming pool"] }, "pool")).toBe(true);
    expect(hasFeature({}, "wifi")).toBe(false);
  });
});

describe("quote tokens", () => {
  it("issues 32-char url-safe tokens and stores only the hash", () => {
    const t = newQuoteToken();
    expect(isQuoteToken(t.raw)).toBe(true);
    expect(t.hash).toBe(hashQuoteToken(t.raw));
    expect(t.hash).not.toContain(t.raw);
    expect(isQuoteToken("short")).toBe(false);
    expect(isQuoteToken(`${t.raw.slice(0, 31)}!`)).toBe(false);
  });
  it("makes opaque references", () => {
    expect(newQuoteRef()).toMatch(/^qt_[a-z0-9]{10}$/);
  });
});

describe("quote status", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  const open = { status: "SENT", expiresAt: new Date("2026-12-02T10:00:00Z") };
  it("is paid when the booking is paid, even after expiry", () => {
    expect(effectiveQuoteStatus({ ...open, expiresAt: new Date("2026-11-30T00:00:00Z") }, "CONFIRMED", now)).toBe("PAID");
  });
  it("expires and cancels without a worker", () => {
    expect(effectiveQuoteStatus({ ...open, expiresAt: new Date("2026-12-01T09:59:00Z") }, null, now)).toBe("EXPIRED");
    expect(effectiveQuoteStatus({ ...open, status: "CANCELLED" }, null, now)).toBe("CANCELLED");
  });
  it("is paying while the booking is unpaid, and back to opened if that booking dies", () => {
    expect(effectiveQuoteStatus({ ...open, status: "PAYING" }, "NEW", now)).toBe("PAYING");
    expect(effectiveQuoteStatus({ ...open, status: "PAYING" }, "CANCELED", now)).toBe("VIEWED");
  });
});

describe("day use", () => {
  it("records demand only and returns no listings", async () => {
    const create = vi.fn().mockResolvedValue({});
    const db = { salesPartnerProfile: { findUnique: vi.fn().mockResolvedValue({ regionId: 4 }) }, salesDemandSignal: { create }, property: { findMany: vi.fn() } };
    const result = await searchByNeed(db, 7, { people: 60, dayUse: true, area: "Mbezi", features: ["eventSpace"] });
    expect(result).toMatchObject({ dayUse: true, ready: [], close: [], leads: [], demandRecorded: true });
    expect(db.property.findMany).not.toHaveBeenCalled();
    expect(create.mock.calls[0][0].data).toMatchObject({ salesPartnerId: 7, regionId: 4, people: 60, dayUse: true, area: "Mbezi" });
    // No client contact details in a demand signal.
    expect(JSON.stringify(create.mock.calls[0][0].data)).not.toMatch(/phone|name/i);
  });
  it("refuses a nightly search without dates", async () => {
    await expect(searchByNeed({}, 7, { people: 4 })).rejects.toThrow("Choose the check-in and check-out dates.");
  });
});

describe("paying a quote through the booking route", () => {
  const token = "A".repeat(32);
  const option = { id: 11, position: 1, propertyId: 5, roomCode: "Suite", rooms: 2, checkIn: dayOf("2026-12-24"), checkOut: dayOf("2026-12-26"), adults: 4, children: 0 };
  const quote = (over: Record<string, unknown> = {}) => ({ id: 3, salesPartnerId: 7, status: "SENT", expiresAt: new Date(Date.now() + 3_600_000), bookingId: null, options: [option], ...over });
  const dbWith = (q: any, bookingStatus: string | null = null) => ({
    salesQuote: { findUnique: vi.fn().mockResolvedValue(q) },
    booking: { findUnique: vi.fn().mockResolvedValue(bookingStatus ? { status: bookingStatus } : null) },
  });
  const booking = { propertyId: 5, roomCode: "Suite", rooms: 2, checkIn: "2026-12-24", checkOut: "2026-12-26", adults: 4, children: 0 };

  beforeEach(() => { gate.enabled = true; gate.failure = null; });

  it("accepts exactly the quoted option", async () => {
    const db = dbWith(quote());
    expect(await checkQuoteForBooking(db, token, 1, booking)).toEqual({ ok: true, check: { quoteId: 3, optionId: 11, salesPartnerId: 7 } });
    expect(db.salesQuote.findUnique.mock.calls[0][0].where.tokenHash).toBe(hashQuoteToken(token));
  });
  it("refuses any change to the option", async () => {
    for (const change of [{ rooms: 1 }, { roomCode: "Standard" }, { checkOut: "2026-12-27" }, { adults: 5 }, { propertyId: 6 }]) {
      const verdict = await checkQuoteForBooking(dbWith(quote()), token, 1, { ...booking, ...change });
      expect(verdict.ok).toBe(false);
    }
  });
  it("refuses paid, expired, unknown and gated quotes", async () => {
    expect((await checkQuoteForBooking(dbWith(quote({ bookingId: 9 }), "CONFIRMED"), token, 1, booking)).ok).toBe(false);
    expect((await checkQuoteForBooking(dbWith(quote({ expiresAt: new Date(Date.now() - 1000) })), token, 1, booking)).ok).toBe(false);
    expect((await checkQuoteForBooking(dbWith(null), token, 1, booking)).ok).toBe(false);
    expect((await checkQuoteForBooking(dbWith(quote()), "bad", 1, booking)).ok).toBe(false);
    expect((await checkQuoteForBooking(dbWith(quote()), token, 2, booking)).ok).toBe(false);
    gate.failure = "SUSPENDED";
    expect((await checkQuoteForBooking(dbWith(quote()), token, 1, booking)).ok).toBe(false);
    gate.failure = null;
    gate.enabled = false;
    expect((await checkQuoteForBooking(dbWith(quote()), token, 1, booking)).ok).toBe(false);
  });
});
