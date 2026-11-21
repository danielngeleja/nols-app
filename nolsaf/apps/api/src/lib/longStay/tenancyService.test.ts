import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contactsShared, isTenancyRef, loadOwnTenancy, maskContacts, newTenancyRef, postMessage, tenancyView } from "./tenancyService.js";
import { publicLongStayView, termsToRow } from "./listing.js";

const NOW = new Date("2026-11-21T08:00:00Z");
const listing = termsToRow({
  monthlyRent: 1_500_000, currency: "TZS", minTermMonths: 6, upfrontMonths: 6, furnished: "FURNISHED",
  utilities: { water: "INCLUDED", electricity: "TENANT", internet: "TENANT", security: "INCLUDED", serviceCharge: "INCLUDED" },
  securityDepositMonths: 1, noticePeriodDays: 30, balanceMethods: ["BANK"], residencyRules: { petsAllowed: false, maxOccupants: 4 }, availableFrom: "2027-01-01",
} as any);

function fakeDb(over: Partial<Record<string, any>> = {}) {
  return {
    property: { findFirst: vi.fn(async () => ({ id: 9, ownerId: 3, type: "APARTMENT", title: "Sea View Flats", longStayListing: listing })), findUnique: vi.fn() },
    longStayLandlordGrant: { findUnique: vi.fn(async () => ({ enabledAt: NOW, pausedAt: null, pauseReason: null })) },
    tenancy: {
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })),
    },
    tenancyEvent: { create: vi.fn(), findMany: vi.fn(async () => []) },
    user: { findUnique: vi.fn() },
    ...over,
  };
}

beforeEach(() => { process.env.LONG_STAY_OPEN = "1"; });
afterEach(() => { delete process.env.LONG_STAY_OPEN; });

describe("references", () => {
  it("are random and well formed", () => {
    const a = newTenancyRef();
    expect(isTenancyRef(a)).toBe(true);
    expect(a).not.toBe(newTenancyRef());
    expect(isTenancyRef("tn_1")).toBe(false);
    expect(isTenancyRef("bk_aaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
  });
});

describe("maskContacts", () => {
  it("hides phone numbers, emails and links", () => {
    const out = maskContacts("Call me on +255 712 345 678 or 0712345678, mail a.b@example.com, or wa.me/255712345678");
    expect(out.masked).toBe(true);
    expect(out.text).not.toMatch(/712|example\.com|wa\.me/);
  });

  it("leaves ordinary numbers alone", () => {
    const out = maskContacts("We are 2 adults, moving on 1 Jan 2027, budget 1,500,000");
    expect(out.masked).toBe(false);
    expect(out.text).toContain("1,500,000");
  });

  it("shares contacts only once the booking is paid", () => {
    for (const s of ["OFFERED", "ACCEPTED", "AWAITING_PAYMENT", "CANCELLED", "REQUESTED"]) expect(contactsShared(s), s).toBe(false);
    for (const s of ["RESERVED", "MOVE_IN", "ACTIVE", "ENDING", "ENDED", "DISPUTED"]) expect(contactsShared(s), s).toBe(true);
  });
});

describe("loading and messaging", () => {
  it("finds a tenancy only on the caller's own side", async () => {
    const db = { tenancy: { findFirst: vi.fn(async () => null) } };
    await expect(loadOwnTenancy(db, newTenancyRef(), "TENANT", 20)).rejects.toMatchObject({ status: 404 });
    expect((db.tenancy.findFirst as any).mock.calls[0][0].where).toMatchObject({ tenantId: 20 });
    await expect(loadOwnTenancy(db, "1", "LANDLORD", 3)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses direct messages before payment and on closed tenancies", async () => {
    const db = fakeDb();
    await expect(postMessage(db, { id: 1, status: "OFFERED" }, "TENANT", 20, "my number 0712345678")).rejects.toThrow(/ask NoLSAF/);
    await expect(postMessage(db, { id: 1, status: "AWAITING_PAYMENT" }, "LANDLORD", 3, "hello")).rejects.toMatchObject({ status: 409 });
    expect((await postMessage(db, { id: 1, status: "RESERVED" }, "TENANT", 20, "my number 0712345678")).masked).toBe(false);
    await expect(postMessage(db, { id: 1, status: "CANCELLED" }, "TENANT", 20, "hi")).rejects.toMatchObject({ status: 409 });
  });

  it("shows the other side's name and phone only after payment", async () => {
    const db = fakeDb();
    db.property.findUnique = vi.fn(async () => ({ title: "Sea View Flats", nrmsBookingKey: "k", regionName: "Dar", district: "Kinondoni", longStayListing: listing })) as any;
    db.user.findUnique = vi.fn(async ({ where }: any) => ({ name: where.id === 3 ? "Juma" : "Sarah", fullName: null, phone: where.id === 3 ? "+255700000003" : "+255700000020" })) as any;
    const base = { id: 1, publicRef: newTenancyRef(), propertyId: 9, tenantId: 20, landlordId: 3, offeredAt: NOW };
    const before = await tenancyView(db, { ...base, status: "OFFERED" }, "TENANT");
    expect(before.otherParty).toEqual({ name: "The landlord", phone: null });
    expect(before.confirmBy).toEqual(new Date("2026-11-22T08:00:00Z"));
    expect(JSON.stringify(before)).not.toContain("+255700000003");
    expect(JSON.stringify(before)).not.toContain("Juma");
    expect(JSON.stringify(before)).not.toMatch(/"id":/);
    const after = await tenancyView(db, { ...base, status: "RESERVED" }, "TENANT");
    expect(after.otherParty).toEqual({ name: "Juma", phone: "+255700000003" });
  });
});

describe("publicLongStayView", () => {
  it("shows the later of the listing date, today, and the end of a current tenancy", () => {
    expect(publicLongStayView(listing, [], "2026-11-21")!.availableFrom).toBe("2027-01-01");
    expect(publicLongStayView({ ...listing, availableFrom: new Date("2026-10-01T00:00:00Z") }, [], "2026-11-21")).toMatchObject({ availableFrom: "2026-11-21", availableNow: true });
    expect(publicLongStayView(listing, [{ status: "ACTIVE", endDate: new Date("2027-06-30T00:00:00Z") }], "2026-11-21")!.availableFrom).toBe("2027-06-30");
    expect(publicLongStayView(listing, [{ status: "CANCELLED", endDate: new Date("2027-06-30T00:00:00Z") }], "2026-11-21")!.availableFrom).toBe("2027-01-01");
    expect(JSON.stringify(publicLongStayView(listing, []))).not.toContain("balanceMethods");
  });
});
