// Agency Desk tour referrals: who gets credited, when they earn, and on what.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSecrets: () => ["test-secret"] }));

import { agencyLinkToken, recordAgencyAttribution } from "../lib/salesAgency.js";
import { accrueAgencyTourCommission, parseTourKey, recordAgencyTourAttribution, tourKey, tourLinkUrl } from "../lib/salesAgencyTours.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-12T10:00:00Z");
const TOKEN = agencyLinkToken({ id: 9, salt: "d".repeat(32) });
const liveContract = { id: 5, status: "ACTIVE", startsAt: new Date(NOW.getTime() - 100 * DAY), expiresAt: new Date(NOW.getTime() + 200 * DAY) };

function makeDb() {
  const fn = () => vi.fn();
  const db: any = {
    salesAgencyLink: { findUnique: fn(), updateMany: fn() },
    salesPartnerProfile: { findUnique: fn() },
    tourBooking: { findUnique: fn() },
    booking: { findUnique: fn() },
    agent: { findUnique: fn() },
    payoutAccount: { findMany: fn() },
    tourBookingAttribution: { create: fn(), findUnique: fn() },
    bookingChannelAttribution: { create: fn() },
    auditLog: { create: fn() },
    salesCommission: { findUnique: fn(), create: fn() },
    systemSetting: { findUnique: fn() },
  };
  db.$transaction = vi.fn(async (op: any) => op(db));
  return db;
}

const partnerRow = (overrides: any = {}) => ({
  status: "ACTIVE", payoutHoldAt: null, contracts: [liveContract],
  capabilities: [{ id: 3, status: "ACTIVE", stayRate: "25", acceptedAt: new Date(NOW.getTime() - 50 * DAY) }],
  userId: 501, phone: "0712000111", payoutAccount: null, user: { email: "partner@example.com", phone: "0712000111" },
  ...overrides,
});
const tourLink = (overrides: any = {}) => ({ id: 9, reference: "al_x", salesPartnerId: 77, expiresAt: new Date(NOW.getTime() + DAY), revokedAt: null, maxUses: null, useCount: 0, propertyId: null, operatorAgentId: 30, tourPackageId: "pkg-1", ...overrides });
const freshTour = (overrides: any = {}) => ({ id: 700, operatorAgentId: 30, packageId: "pkg-1", customerId: 900, guestPhone: "0755999888", guestEmail: "guest@example.com", payerPhone: null, createdAt: new Date(NOW.getTime() - 1000), ...overrides });

describe("tour keys and links", () => {
  it("round-trips a tour key and builds the operator's checkout link", () => {
    const key = tourKey("cm1operatorkey000000000", "pkg-1");
    expect(parseTourKey(key)).toEqual({ operatorPublicKey: "cm1operatorkey000000000", packageId: "pkg-1" });
    expect(parseTourKey("not a key")).toBeNull();
    expect(parseTourKey("short:pkg")).toBeNull();
    const url = tourLinkUrl("https://www.nolsaf.com", TOKEN, "cm1operatorkey000000000", "pkg-1", 40);
    expect(url).toContain("/public/booking/tour-confirm?agentKey=cm1operatorkey000000000&packageId=pkg-1&travelers=40&ag=");
  });
});

describe("recordAgencyTourAttribution", () => {
  let db: any;
  beforeEach(() => {
    process.env.SALES_AGENCY_ENABLED = "true";
    db = makeDb();
    db.salesAgencyLink.findUnique.mockResolvedValue(tourLink());
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow());
    db.tourBooking.findUnique.mockResolvedValue(freshTour());
    db.agent.findUnique.mockResolvedValue({ userId: 300, user: { email: "operator@example.com", phone: "0766000000" } });
    db.payoutAccount.findMany.mockResolvedValue([]);
    db.salesAgencyLink.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    delete process.env.SALES_AGENCY_ENABLED;
  });

  it("credits the tour the link was made for", async () => {
    expect(await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).toEqual({ recorded: true, status: "ACTIVE" });
    expect(db.tourBookingAttribution.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tourBookingId: 700, salesPartnerId: 77, status: "ACTIVE" }) });
  });

  it("refuses a link made for another tour, and a property link", async () => {
    db.tourBooking.findUnique.mockResolvedValue(freshTour({ packageId: "pkg-2" }));
    expect(await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "WRONG_TOUR" });
    db.salesAgencyLink.findUnique.mockResolvedValue(tourLink({ operatorAgentId: null, tourPackageId: null, propertyId: 40 }));
    expect(await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "PROPERTY_LINK" });
    expect(db.tourBookingAttribution.create).not.toHaveBeenCalled();
  });

  it("lets a general link credit any tour", async () => {
    db.salesAgencyLink.findUnique.mockResolvedValue(tourLink({ operatorAgentId: null, tourPackageId: null }));
    db.tourBooking.findUnique.mockResolvedValue(freshTour({ operatorAgentId: 31, packageId: "other" }));
    db.agent.findUnique.mockResolvedValue({ userId: 301, user: { email: "other@example.com", phone: "0766111111" } });
    expect((await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).recorded).toBe(true);
  });

  it("records the partner as traveller or as operator BLOCKED, without spending a use", async () => {
    db.tourBooking.findUnique.mockResolvedValue(freshTour({ guestPhone: "+255 712 000 111" }));
    expect(await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).toMatchObject({ recorded: true, status: "BLOCKED" });
    db.tourBooking.findUnique.mockResolvedValue(freshTour());
    db.agent.findUnique.mockResolvedValue({ userId: 501, user: { email: "partner@example.com", phone: "0712000111" } });
    expect(await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).toMatchObject({ recorded: true, status: "BLOCKED", blockedReason: expect.stringContaining("tour operator") });
    expect(db.salesAgencyLink.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an older tour booking and a partner who lost the desk", async () => {
    db.tourBooking.findUnique.mockResolvedValue(freshTour({ createdAt: new Date(NOW.getTime() - 60 * 60 * 1000) }));
    expect(await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "BOOKING_TOO_OLD" });
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow({ capabilities: [{ id: 3, status: "SUSPENDED", stayRate: "25" }] }));
    expect((await recordAgencyTourAttribution(db, { tourBookingId: 700, token: TOKEN, now: NOW })).recorded).toBe(false);
  });

  it("never lets a tour link credit a stay", async () => {
    expect(await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "TOUR_LINK" });
    expect(db.bookingChannelAttribution.create).not.toHaveBeenCalled();
  });
});

describe("accrueAgencyTourCommission", () => {
  let db: any;
  const completed = {
    id: 700, bookingCode: "TOUR-20261101-AB12", title: "Serengeti day trip", status: "COMPLETED", paymentStatus: "PAID",
    paidAt: new Date(NOW.getTime() - 20 * DAY), completedAt: new Date(NOW.getTime() - DAY), currency: "TZS",
    commissionAmount: "720000", fxTzsPerUnit: null, operatorAgentId: 30, customerId: 900, guestPhone: "0755999888", guestEmail: "g@example.com", payerPhone: null,
  };
  beforeEach(() => {
    db = makeDb();
    db.salesCommission.findUnique.mockResolvedValue(null);
    db.tourBookingAttribution.findUnique.mockResolvedValue({ tourBookingId: 700, salesPartnerId: 77, status: "ACTIVE" });
    db.tourBooking.findUnique.mockResolvedValue(completed);
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow());
    db.agent.findUnique.mockResolvedValue({ userId: 300, user: { email: "operator@example.com", phone: "0766000000" } });
    db.payoutAccount.findMany.mockResolvedValue([]);
    db.systemSetting.findUnique.mockResolvedValue({ taxPercent: 0 });
    db.salesCommission.create.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  });

  it("earns the rate on NoLSAF's tour commission once the tour is completed", async () => {
    const out = await accrueAgencyTourCommission(db, 700, NOW);
    expect(out.created).toBe(true);
    const data = db.salesCommission.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: "AGENCY_TOUR", sourceKey: "AGENCY_TOUR:700", status: "VALIDATING", commissionAmount: 180000, currency: "TZS" });
    expect(data.eligibleAt.getTime()).toBeGreaterThan(completed.completedAt.getTime());
  });

  it("waits until the tour is completed", async () => {
    db.tourBooking.findUnique.mockResolvedValue({ ...completed, status: "OPERATOR_COMPLETED", completedAt: null });
    expect(await accrueAgencyTourCommission(db, 700, NOW)).toMatchObject({ created: false, skippedReason: "NOT_COMPLETED" });
  });

  it("converts a foreign-currency tour at the rate frozen on the booking, and skips without one", async () => {
    db.tourBooking.findUnique.mockResolvedValue({ ...completed, currency: "USD", commissionAmount: "300", fxTzsPerUnit: "2600" });
    await accrueAgencyTourCommission(db, 700, NOW);
    expect(db.salesCommission.create.mock.calls[0][0].data.commissionAmount).toBe(195000);
    db.salesCommission.create.mockClear();
    db.tourBooking.findUnique.mockResolvedValue({ ...completed, currency: "USD", commissionAmount: "300", fxTzsPerUnit: null });
    expect(await accrueAgencyTourCommission(db, 700, NOW)).toMatchObject({ created: false, skippedReason: "NO_FX_RATE" });
  });

  it("records the partner's own operator business as reversed", async () => {
    db.agent.findUnique.mockResolvedValue({ userId: 501, user: { email: "partner@example.com", phone: null } });
    await accrueAgencyTourCommission(db, 700, NOW);
    expect(db.salesCommission.create.mock.calls[0][0].data.status).toBe("REVERSED");
  });

  it("is idempotent", async () => {
    db.salesCommission.findUnique.mockResolvedValueOnce({ id: 1 });
    expect((await accrueAgencyTourCommission(db, 700, NOW)).created).toBe(false);
    expect(db.salesCommission.create).not.toHaveBeenCalled();
  });
});
