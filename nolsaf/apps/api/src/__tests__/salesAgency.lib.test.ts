// Agency Desk core: the gate, link tokens, booking attribution and the
// commission, tested against the abuse cases the feature has to survive.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSecrets: () => ["test-secret"] }));

import {
  AGENCY_SETTLE_MS,
  accrueAgencySalesCommission,
  agencyAddendumText,
  agencyGateFailure,
  agencyLinkToken,
  agencyTermsHash,
  hashAgencyToken,
  isWellFormedAgencyToken,
  propertyKeyFromInput,
  recordAgencyAttribution,
} from "../lib/salesAgency.js";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-11-11T10:00:00Z");
const liveContract = { id: 5, status: "ACTIVE", startsAt: new Date(NOW.getTime() - 30 * DAY), expiresAt: new Date(NOW.getTime() + 300 * DAY) };
const okGate = { enabled: true, partner: { status: "ACTIVE", payoutHoldAt: null }, contract: liveContract, capability: { status: "ACTIVE" } };

describe("agencyGateFailure", () => {
  it("passes only when every condition holds", () => {
    expect(agencyGateFailure(okGate, { at: NOW })).toBeNull();
    expect(agencyGateFailure({ ...okGate, enabled: false }, { at: NOW })).toBe("DISABLED");
    expect(agencyGateFailure({ ...okGate, partner: null }, { at: NOW })).toBe("NO_PARTNER");
    expect(agencyGateFailure({ ...okGate, partner: { status: "SUSPENDED", payoutHoldAt: null } }, { at: NOW })).toBe("PARTNER_NOT_ACTIVE");
    expect(agencyGateFailure({ ...okGate, partner: { status: "ACTIVE", payoutHoldAt: NOW } }, { at: NOW })).toBe("PAYOUT_HOLD");
    expect(agencyGateFailure({ ...okGate, contract: { ...liveContract, expiresAt: new Date(NOW.getTime() - 1) } }, { at: NOW })).toBe("CONTRACT_NOT_ACTIVE");
    expect(agencyGateFailure({ ...okGate, capability: null }, { at: NOW })).toBe("NO_CAPABILITY");
    for (const status of ["SUSPENDED", "REVOKED", "PENDING_ACCEPTANCE", "active "]) {
      expect(agencyGateFailure({ ...okGate, capability: { status } }, { at: NOW })).toBe("NO_CAPABILITY");
    }
  });

  it("admits a pending partner only where explicitly allowed", () => {
    const pending = { ...okGate, capability: { status: "PENDING_ACCEPTANCE" } };
    expect(agencyGateFailure(pending, { at: NOW, allowPending: true })).toBeNull();
    expect(agencyGateFailure({ ...pending, capability: { status: "SUSPENDED" } }, { at: NOW, allowPending: true })).toBe("NO_CAPABILITY");
  });
});

describe("addendum and tokens", () => {
  it("binds the rate into the signed text and never uses an em dash", () => {
    expect(agencyAddendumText(25)).toContain("25%");
    expect(agencyTermsHash(25)).not.toBe(agencyTermsHash(26));
    expect(agencyAddendumText(25)).not.toContain("—");
  });

  it("derives unguessable, well-formed tokens that change with the salt", () => {
    const a = agencyLinkToken({ id: 1, salt: "a".repeat(32) });
    const b = agencyLinkToken({ id: 1, salt: "b".repeat(32) });
    expect(isWellFormedAgencyToken(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(a).not.toContain("1:");
    for (const bad of ["", "short", "x".repeat(44), `${"a".repeat(42)}!`, 12345, null, { $gt: "" }]) {
      expect(isWellFormedAgencyToken(bad)).toBe(false);
    }
  });

  it("reads a property key from a pasted URL or slug", () => {
    expect(propertyKeyFromInput("https://www.nolsaf.com/public/properties/sea-view-lodge-cm1abc23xyz")).toBe("cm1abc23xyz");
    expect(propertyKeyFromInput("sea-view-lodge-cm1abc23xyz")).toBe("cm1abc23xyz");
    expect(propertyKeyFromInput("../../etc/passwd")).toBeNull();
    expect(propertyKeyFromInput("")).toBeNull();
  });
});

function makeDb() {
  const fn = () => vi.fn();
  const db: any = {
    salesAgencyLink: { findUnique: fn(), updateMany: fn() },
    salesPartnerProfile: { findUnique: fn() },
    booking: { findUnique: fn() },
    property: { findUnique: fn() },
    payoutAccount: { findMany: fn() },
    bookingChannelAttribution: { create: fn(), findUnique: fn() },
    auditLog: { create: fn() },
    invoice: { findUnique: fn() },
    salesCommission: { findUnique: fn(), create: fn() },
    referralEarning: { findFirst: fn() },
  };
  db.$transaction = vi.fn(async (op: any) => op(db));
  return db;
}

const TOKEN = agencyLinkToken({ id: 9, salt: "c".repeat(32) });

function partnerRow(overrides: any = {}) {
  return {
    status: "ACTIVE",
    payoutHoldAt: null,
    contracts: [liveContract],
    capabilities: [{ id: 3, status: "ACTIVE", stayRate: "25", acceptedAt: new Date(NOW.getTime() - 10 * DAY) }],
    // loadPartnerIdentity reads these from the same model
    userId: 501,
    phone: "0712000111",
    payoutAccount: null,
    user: { email: "partner@example.com", phone: "0712000111" },
    ...overrides,
  };
}

describe("recordAgencyAttribution", () => {
  let db: any;
  beforeEach(() => {
    process.env.SALES_AGENCY_ENABLED = "true";
    db = makeDb();
    db.salesAgencyLink.findUnique.mockResolvedValue({ id: 9, reference: "al_x", salesPartnerId: 77, expiresAt: new Date(NOW.getTime() + DAY), revokedAt: null, maxUses: null, useCount: 0, propertyId: null });
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow());
    db.booking.findUnique.mockResolvedValue({ id: 1000, propertyId: 40, userId: 900, guestPhone: "0755999888", createdAt: new Date(NOW.getTime() - 1000), user: { email: "guest@example.com", phone: "0755999888" } });
    db.property.findUnique.mockResolvedValue({ owner: { id: 300, email: "owner@example.com", phone: "0766000000" } });
    db.payoutAccount.findMany.mockResolvedValue([]);
    db.salesAgencyLink.updateMany.mockResolvedValue({ count: 1 });
  });
  afterEach(() => {
    delete process.env.SALES_AGENCY_ENABLED;
  });

  it("does nothing while the kill switch is off", async () => {
    delete process.env.SALES_AGENCY_ENABLED;
    expect(await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "DISABLED" });
    expect(db.salesAgencyLink.findUnique).not.toHaveBeenCalled();
  });

  it("never queries with a malformed token", async () => {
    expect((await recordAgencyAttribution(db, { bookingId: 1000, token: { $ne: null }, now: NOW })).recorded).toBe(false);
    expect(db.salesAgencyLink.findUnique).not.toHaveBeenCalled();
  });

  it("looks the link up by token hash only", async () => {
    await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW });
    expect(db.salesAgencyLink.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashAgencyToken(TOKEN) } });
  });

  it("credits a fresh booking and counts the use", async () => {
    const out = await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW });
    expect(out).toEqual({ recorded: true, status: "ACTIVE" });
    expect(db.bookingChannelAttribution.create).toHaveBeenCalledWith({ data: expect.objectContaining({ bookingId: 1000, salesPartnerId: 77, status: "ACTIVE", channel: "AGENCY_LINK" }) });
    expect(db.salesAgencyLink.updateMany).toHaveBeenCalled();
  });

  it.each([
    ["revoked link", { revokedAt: NOW }, "LINK_REVOKED"],
    ["expired link", { expiresAt: new Date(NOW.getTime() - 1) }, "LINK_EXPIRED"],
    ["used-up link", { maxUses: 2, useCount: 2 }, "LINK_USED_UP"],
  ])("ignores a %s", async (_name, patch, reason) => {
    db.salesAgencyLink.findUnique.mockResolvedValue({ id: 9, reference: "al_x", salesPartnerId: 77, expiresAt: new Date(NOW.getTime() + DAY), revokedAt: null, maxUses: null, useCount: 0, propertyId: null, ...patch });
    expect(await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason });
    expect(db.bookingChannelAttribution.create).not.toHaveBeenCalled();
  });

  it("ignores links of a partner who lost the desk", async () => {
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow({ capabilities: [{ id: 3, status: "SUSPENDED", stayRate: "25" }] }));
    expect((await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).recorded).toBe(false);
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow({ payoutHoldAt: NOW }));
    expect((await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).recorded).toBe(false);
    expect(db.bookingChannelAttribution.create).not.toHaveBeenCalled();
  });

  it("refuses to attach a token to an older booking", async () => {
    db.booking.findUnique.mockResolvedValue({ id: 5, propertyId: 40, userId: 900, guestPhone: "0755", createdAt: new Date(NOW.getTime() - 60 * 60 * 1000), user: null });
    expect(await recordAgencyAttribution(db, { bookingId: 5, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "BOOKING_TOO_OLD" });
  });

  it("refuses a property-pinned link on another property", async () => {
    db.salesAgencyLink.findUnique.mockResolvedValue({ id: 9, reference: "al_x", salesPartnerId: 77, expiresAt: new Date(NOW.getTime() + DAY), revokedAt: null, maxUses: null, useCount: 0, propertyId: 41 });
    expect(await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "WRONG_PROPERTY" });
  });

  it("records a self-booking as BLOCKED without spending a use", async () => {
    db.booking.findUnique.mockResolvedValue({ id: 1000, propertyId: 40, userId: 900, guestPhone: "+255 712 000 111", createdAt: new Date(NOW.getTime() - 1000), user: null });
    const out = await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW });
    expect(out).toMatchObject({ recorded: true, status: "BLOCKED" });
    expect(db.salesAgencyLink.updateMany).not.toHaveBeenCalled();
    expect(db.bookingChannelAttribution.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "BLOCKED" }) });
  });

  it("does not double-credit a booking", async () => {
    db.bookingChannelAttribution.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect(await recordAgencyAttribution(db, { bookingId: 1000, token: TOKEN, now: NOW })).toEqual({ recorded: false, reason: "ALREADY_ATTRIBUTED" });
  });
});

describe("accrueAgencySalesCommission", () => {
  let db: any;
  const paidAt = new Date(NOW.getTime() - 2 * 60 * 60 * 1000);
  const invoice = {
    id: 70,
    status: "PAID",
    commissionPercent: "10",
    commissionAmount: "100000",
    taxPercent: "0",
    paidAt,
    bookingId: 1000,
    booking: { propertyId: 40, status: "CONFIRMED", checkOut: new Date(NOW.getTime() + 2 * DAY), userId: 900, guestPhone: "0755999888", user: { email: "g@example.com", phone: "0755999888" }, cancellationRequests: [], property: { title: "Lodge", currency: "TZS" } },
  };
  beforeEach(() => {
    db = makeDb();
    db.invoice.findUnique.mockResolvedValue(invoice);
    db.bookingChannelAttribution.findUnique.mockResolvedValue({ bookingId: 1000, salesPartnerId: 77, status: "ACTIVE" });
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow());
    db.property.findUnique.mockResolvedValue({ owner: { id: 300, email: "owner@example.com", phone: "0766000000" } });
    db.payoutAccount.findMany.mockResolvedValue([]);
    db.referralEarning.findFirst.mockResolvedValue(null);
    db.salesCommission.findUnique.mockResolvedValue(null);
    db.salesCommission.create.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  });

  it("earns the rate on NoLSAF's commission, not on the booking value", async () => {
    const out = await accrueAgencySalesCommission(db, 70, NOW);
    expect(out.created).toBe(true);
    const data = db.salesCommission.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ type: "AGENCY_STAY", status: "VALIDATING", sourceKey: "AGENCY_INVOICE:70", contractId: 5, commissionAmount: 25000 });
  });

  it("waits for the payment to settle", async () => {
    db.invoice.findUnique.mockResolvedValue({ ...invoice, paidAt: new Date(NOW.getTime() - AGENCY_SETTLE_MS + 1000) });
    expect(await accrueAgencySalesCommission(db, 70, NOW)).toMatchObject({ created: false, skippedReason: "SETTLING" });
  });

  it("is idempotent", async () => {
    db.salesCommission.findUnique.mockResolvedValueOnce({ id: 1, sourceKey: "AGENCY_INVOICE:70" });
    expect(await accrueAgencySalesCommission(db, 70, NOW)).toMatchObject({ created: false });
    expect(db.salesCommission.create).not.toHaveBeenCalled();
  });

  it("pays nothing without an active attribution or an unpaid invoice", async () => {
    db.bookingChannelAttribution.findUnique.mockResolvedValue({ bookingId: 1000, salesPartnerId: 77, status: "BLOCKED" });
    expect((await accrueAgencySalesCommission(db, 70, NOW)).created).toBe(false);
    db.invoice.findUnique.mockResolvedValue({ ...invoice, status: "APPROVED", paidAt: null });
    expect((await accrueAgencySalesCommission(db, 70, NOW)).created).toBe(false);
    expect(db.salesCommission.create).not.toHaveBeenCalled();
  });

  it("pays nothing when the desk was not accepted at payment time", async () => {
    db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow({ capabilities: [{ id: 3, status: "ACTIVE", stayRate: "25", acceptedAt: new Date(NOW.getTime() - 60 * 1000) }] }));
    expect((await accrueAgencySalesCommission(db, 70, NOW)).created).toBe(false);
  });

  it("caps the combined partner share with a supply-side commission", async () => {
    db.salesCommission.findUnique.mockImplementation(async ({ where }: any) =>
      where.sourceKey === "INVOICE:70" ? { status: "VALIDATING", commissionAmount: "20000" } : null,
    );
    await accrueAgencySalesCommission(db, 70, NOW);
    // 40% of 100,000 = 40,000 cap, minus 20,000 supply = 20,000 (instead of 25,000)
    expect(db.salesCommission.create.mock.calls[0][0].data.commissionAmount).toBe(20000);
  });

  it("records a driver-referred booking as reversed", async () => {
    db.referralEarning.findFirst.mockResolvedValue({ id: 4 });
    await accrueAgencySalesCommission(db, 70, NOW);
    expect(db.salesCommission.create.mock.calls[0][0].data).toMatchObject({ status: "REVERSED", reversalReason: expect.stringContaining("driver referral") });
  });

  it("records the partner's own stay as reversed", async () => {
    db.invoice.findUnique.mockResolvedValue({ ...invoice, booking: { ...invoice.booking, guestPhone: "0712000111", user: null } });
    await accrueAgencySalesCommission(db, 70, NOW);
    expect(db.salesCommission.create.mock.calls[0][0].data.status).toBe("REVERSED");
  });
});
