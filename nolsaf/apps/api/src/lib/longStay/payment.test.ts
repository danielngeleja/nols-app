import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkTenancyPayable, expireUnpaidTenancies, isTenancyPaymentRef, newTenancyPaymentRef, openMoveInDay, settleTenancyPayment } from "./payment.js";

const NOW = new Date("2026-11-21T10:00:00Z");
const awaiting = {
  id: 1, publicRef: "tn_abcdefghijklmnopqrstuv", tenantId: 20, landlordId: 3, propertyId: 9,
  status: "AWAITING_PAYMENT", version: 6, paymentDueAt: new Date("2026-11-23T10:00:00Z"),
  tenantLeaseAcceptedAt: NOW, landlordLeaseAcceptedAt: NOW, bookingAmount: 5580, currency: "USD", paidAt: null, paymentRef: "LST-0123456789abcdef",
};

function fakeDb(over: Record<string, any> = {}) {
  return {
    longStayTenantProfile: { findUnique: vi.fn(async () => ({ status: "APPROVED", barredAt: null })) },
    longStayLandlordGrant: { findUnique: vi.fn(async () => ({ enabledAt: NOW, pausedAt: null })) },
    tenancy: { findFirst: vi.fn(async () => awaiting), findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })) },
    tenancyEvent: { create: vi.fn() },
    ...over,
  } as any;
}

beforeEach(() => { process.env.LONG_STAY_OPEN = "1"; });
afterEach(() => { delete process.env.LONG_STAY_OPEN; });

describe("payment references", () => {
  it("are random and carry no row id", () => {
    const ref = newTenancyPaymentRef();
    expect(isTenancyPaymentRef(ref)).toBe(true);
    expect(ref).not.toBe(newTenancyPaymentRef());
    expect(isTenancyPaymentRef("GBDEP-CARD-1-2")).toBe(false);
  });
});

describe("checkTenancyPayable", () => {
  it("charges the frozen booking amount", async () => {
    expect(await checkTenancyPayable(fakeDb(), awaiting, 20, NOW)).toEqual({ amount: 5580, currency: "USD" });
  });

  it("refuses another account, a closed window, an unsigned lease, an unverified tenant or a paused landlord", async () => {
    await expect(checkTenancyPayable(fakeDb(), awaiting, 21, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(checkTenancyPayable(fakeDb(), { ...awaiting, paymentDueAt: new Date("2026-11-21T09:00:00Z") }, 20, NOW)).rejects.toThrow(/48-hour/);
    await expect(checkTenancyPayable(fakeDb(), { ...awaiting, status: "RESERVED", paidAt: NOW }, 20, NOW)).rejects.toThrow(/already paid/);
    await expect(checkTenancyPayable(fakeDb(), { ...awaiting, landlordLeaseAcceptedAt: null }, 20, NOW)).rejects.toThrow(/Both sides/);
    await expect(checkTenancyPayable(fakeDb({ longStayTenantProfile: { findUnique: vi.fn(async () => ({ status: "APPROVED", barredAt: NOW })) } }), awaiting, 20, NOW)).rejects.toThrow(/cannot book/);
    await expect(checkTenancyPayable(fakeDb({ longStayLandlordGrant: { findUnique: vi.fn(async () => ({ enabledAt: NOW, pausedAt: NOW })) } }), awaiting, 20, NOW)).rejects.toThrow(/landlord/);
  });

  it("is closed while long stays are switched off", async () => {
    delete process.env.LONG_STAY_OPEN;
    await expect(checkTenancyPayable(fakeDb(), awaiting, 20, NOW)).rejects.toMatchObject({ status: 403 });
  });
});

describe("settleTenancyPayment", () => {
  const input = { paymentRef: awaiting.paymentRef, amount: 5580, currency: "USD", providerRef: "CORAL-1" };

  it("reserves the home once, with a compare-and-set move", async () => {
    const db = fakeDb();
    const alert = vi.fn(async () => undefined);
    expect(await settleTenancyPayment(db, input, alert, NOW)).toEqual({ ok: true, outcome: "RESERVED" });
    expect(db.tenancy.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1, status: "AWAITING_PAYMENT", version: 6 },
      data: expect.objectContaining({ status: "RESERVED", paidAmount: 5580, payoutStatus: "HELD" }),
    }));
    expect(alert).not.toHaveBeenCalled();
  });

  it("treats a repeated notice as already done", async () => {
    const db = fakeDb({ tenancy: { findFirst: vi.fn(async () => ({ ...awaiting, status: "RESERVED", paidAt: NOW })), updateMany: vi.fn() } });
    expect(await settleTenancyPayment(db, input, vi.fn(), NOW)).toEqual({ ok: true, outcome: "ALREADY_RESERVED" });
    expect(db.tenancy.updateMany).not.toHaveBeenCalled();
  });

  it("never reserves on a different amount or currency, and alerts", async () => {
    const alert = vi.fn(async () => undefined);
    const db = fakeDb();
    expect(await settleTenancyPayment(db, { ...input, amount: 5579.99 }, alert, NOW)).toMatchObject({ ok: false, outcome: "AMOUNT_MISMATCH" });
    expect(await settleTenancyPayment(db, { ...input, currency: "TZS" }, alert, NOW)).toMatchObject({ ok: false, outcome: "AMOUNT_MISMATCH" });
    expect(db.tenancy.updateMany).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledTimes(2);
  });

  it("records money that arrives for a closed lease and asks for a refund", async () => {
    const alert = vi.fn(async () => undefined);
    const db = fakeDb({ tenancy: { findFirst: vi.fn(async () => ({ ...awaiting, status: "CANCELLED" })), updateMany: vi.fn(async () => ({ count: 1 })) } });
    expect(await settleTenancyPayment(db, input, alert, NOW)).toMatchObject({ ok: false, outcome: "NOT_AWAITING" });
    expect(db.tenancy.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payoutStatus: "REFUND_DUE" }) }));
    expect(alert).toHaveBeenCalledWith("long_stay_payment_review", expect.objectContaining({ reason: "closed" }));
  });
});

describe("expireUnpaidTenancies", () => {
  it("closes unpaid leases after 48 hours, with 30 minutes' grace for an open checkout", async () => {
    const due = new Date("2026-11-21T09:50:00Z");
    const db = fakeDb({ tenancy: {
      findMany: vi.fn(async () => [
        { ...awaiting, id: 1, paymentDueAt: due, checkoutSessionId: null },
        { ...awaiting, id: 2, paymentDueAt: due, checkoutSessionId: "LST-x" },
      ]),
      updateMany: vi.fn(async () => ({ count: 1 })),
    } });
    const notify = vi.fn(async () => undefined);
    expect(await expireUnpaidTenancies(db, NOW, notify)).toEqual({ closed: 1 });
    expect(db.tenancy.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 1 }), data: expect.objectContaining({ status: "CANCELLED", cancelledBy: "SYSTEM" }) }));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("leaves a lease alone if a payment moved it first", async () => {
    const db = fakeDb({ tenancy: { findMany: vi.fn(async () => [{ ...awaiting, paymentDueAt: new Date("2026-11-20T00:00:00Z"), checkoutSessionId: null }]), updateMany: vi.fn(async () => ({ count: 0 })) } });
    expect(await expireUnpaidTenancies(db, NOW)).toEqual({ closed: 0 });
  });
});

describe("openMoveInDay", () => {
  it("moves reserved tenancies to MOVE_IN on the day", async () => {
    const db = fakeDb({ tenancy: { findMany: vi.fn(async () => [{ id: 5, status: "RESERVED", version: 7 }]), updateMany: vi.fn(async () => ({ count: 1 })) } });
    expect(await openMoveInDay(db, "2027-01-01")).toEqual({ opened: 1 });
    expect(db.tenancy.findMany.mock.calls[0][0].where).toEqual({ status: "RESERVED", moveInDate: { lte: new Date("2027-01-01T00:00:00Z") } });
  });
});
