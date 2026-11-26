import { describe, expect, it, vi } from "vitest";
import { parseFirstTouch, readCookie, recordAcquisitionSource } from "./acquisitionSource.js";
import { computeChannelReport } from "./channelReport.js";

const NOW = new Date("2026-11-26T09:00:00Z");
const cookie = (touch: Record<string, unknown>) => `nolsaf_token=abc; nolsaf_src=${encodeURIComponent(JSON.stringify(touch))}; other=1`;
const touch = { c: "SEARCH", s: "google", p: "/public/properties", t: NOW.getTime() - 86_400_000 };

describe("parseFirstTouch (visitor-controlled cookie)", () => {
  it("reads a valid first visit", () => {
    expect(parseFirstTouch(cookie(touch), NOW)).toMatchObject({ channel: "SEARCH", source: "google", landingPath: "/public/properties" });
  });

  it("rejects unknown channels, stale or future visits and broken values", () => {
    expect(parseFirstTouch(cookie({ ...touch, c: "PAID_BY_ADMIN" }), NOW)).toBeNull();
    expect(parseFirstTouch(cookie({ ...touch, t: NOW.getTime() - 31 * 86_400_000 }), NOW)).toBeNull();
    expect(parseFirstTouch(cookie({ ...touch, t: NOW.getTime() + 86_400_000 }), NOW)).toBeNull();
    expect(parseFirstTouch("nolsaf_src=%7Bnot-json", NOW)).toBeNull();
    expect(parseFirstTouch(undefined, NOW)).toBeNull();
  });

  it("drops any field that could carry markup, personal data or a token", () => {
    const parsed = parseFirstTouch(cookie({ ...touch, s: "<script>alert(1)</script>", n: "x".repeat(200), p: "/verify/property?token=secret", d: "0712345678@mail" }), NOW);
    expect(parsed).toMatchObject({ channel: "SEARCH", source: null, campaign: null, landingPath: null, detail: null });
  });

  it("finds the cookie among others and ignores lookalikes", () => {
    expect(readCookie("a=1; xnolsaf_src=bad; nolsaf_src=good", "nolsaf_src")).toBe("good");
  });
});

describe("recordAcquisitionSource", () => {
  it("records once and never throws, even before the migration", async () => {
    const create = vi.fn(async () => ({}));
    expect(await recordAcquisitionSource({ acquisitionSource: { create } }, { type: "BOOKING", id: 7 }, cookie(touch), NOW)).toBe(true);
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ targetType: "BOOKING", targetId: 7, channel: "SEARCH" }) });
    const missing = vi.fn(async () => { throw Object.assign(new Error("table"), { code: "P2021" }); });
    expect(await recordAcquisitionSource({ acquisitionSource: { create: missing } }, { type: "TOUR_BOOKING", id: 8 }, cookie(touch), NOW)).toBe(false);
    expect(await recordAcquisitionSource({ acquisitionSource: { create } }, { type: "TENANCY", id: 9 }, undefined, NOW)).toBe(false);
  });
});

describe("computeChannelReport", () => {
  const db: any = {
    booking: { findMany: async () => [
      { id: 1, property: { currency: "TZS" }, invoices: [{ total: 100_000, commissionAmount: 15_000, paidAt: NOW, invoiceNumber: "INV-1" }] },
      { id: 2, property: { currency: "TZS" }, invoices: [{ total: 50_000, commissionAmount: 7_500, paidAt: NOW, invoiceNumber: "INV-2" }] },
      // An owner's payout claim is not a guest payment.
      { id: 3, property: { currency: "TZS" }, invoices: [{ total: 90_000, commissionAmount: 0, paidAt: NOW, invoiceNumber: "OINV-3" }] },
    ] },
    tourBooking: { findMany: async () => [{ id: 10, paymentStatus: "PAID", grossAmount: 100, commissionAmount: 10, currency: "USD" }] },
    tenancy: { findMany: async () => [{ id: 20, paidAt: NOW, bookingAmount: 625_000, tenantFee: 125_000, landlordCommission: 250_000, currency: "TZS", payoutStatus: "REFUNDED" }] },
    acquisitionSource: { findMany: async () => [
      { targetType: "BOOKING", targetId: 1, channel: "SEARCH", source: "google", campaign: null },
      { targetType: "BOOKING", targetId: 2, channel: "SOCIAL", source: "instagram", campaign: null },
      { targetType: "TOUR_BOOKING", targetId: 10, channel: "CAMPAIGN", source: "newsletter", campaign: "dec-safari" },
    ] },
    // Booking 2 also came from a partner link: the verified partner record wins.
    bookingChannelAttribution: { findMany: async () => [{ bookingId: 2 }] },
    tourBookingAttribution: { findMany: async () => [] },
    salesCommission: { findMany: async () => [{ commissionAmount: 1_000, currency: "TZS" }] },
  };

  it("groups by channel, partner links first, in TZS", async () => {
    const report = await computeChannelReport(db, { from: new Date("2026-11-01"), to: NOW, tzsPerUnit: { TZS: 1, USD: 2600 } });
    const by = Object.fromEntries(report.channels.map((r) => [r.channel, r]));
    expect(by.SEARCH).toMatchObject({ created: 1, paid: 1, collectedTzs: 100_000, nolsafTakeTzs: 15_000, topSources: [{ source: "google", paid: 1 }] });
    expect(by.PARTNER_LINK).toMatchObject({ created: 1, paid: 1, nolsafTakeTzs: 7_500, partnerCostTzs: 1_000 });
    expect(by.SOCIAL.created).toBe(0);
    expect(by.CAMPAIGN).toMatchObject({ paid: 1, collectedTzs: 260_000, nolsafTakeTzs: 26_000, topSources: [{ source: "dec-safari", paid: 1 }] });
    // Owner claim unpaid for the guest; refunded tenancy is not paid.
    expect(by.NOT_RECORDED).toMatchObject({ created: 2, paid: 0 });
    expect(report.total).toMatchObject({ created: 5, paid: 3 });
    expect(report.migrationNeeded).toBe(false);
  });

  it("says when the source table is missing instead of failing", async () => {
    const report = await computeChannelReport({ ...db, acquisitionSource: { findMany: async () => { throw Object.assign(new Error("t"), { code: "P2021" }); } } }, { from: new Date("2026-11-01"), to: NOW, tzsPerUnit: { TZS: 1, USD: 2600 } });
    expect(report.migrationNeeded).toBe(true);
  });
});
