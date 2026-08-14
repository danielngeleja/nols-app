import { describe, expect, it } from "vitest";
import { summarizeAnalyticsGuestFolio, summarizeAnalyticsMasterFolio } from "./nrmsRevenueAnalytics.js";

describe("NRMS revenue analytics settlement", () => {
  it("moves agency liability off the guest without counting the transfer as cash", () => {
    const guest = summarizeAnalyticsGuestFolio({
      roomAmount: 500_000,
      extraAmount: 50_000,
      directPaid: 50_000,
      masterItems: [{ amount: 500_000 }],
    });
    const agency = summarizeAnalyticsMasterFolio({
      items: [{ amount: 500_000 }],
      payments: [],
    });

    expect(guest).toEqual({ confirmed: 550_000, directPaid: 50_000, transferred: 500_000, due: 0, status: "FULL" });
    expect(agency).toMatchObject({ billed: 500_000, paid: 0, due: 500_000, active: true });
    expect(guest.directPaid + agency.paid).toBe(50_000);
    expect(guest.due + agency.due).toBe(500_000);
  });

  it("counts one partial agency payment once and leaves only its master balance due", () => {
    const guest = summarizeAnalyticsGuestFolio({
      roomAmount: 500_000,
      extraAmount: 50_000,
      directPaid: 50_000,
      masterItems: [{ amount: 500_000 }],
    });
    const agency = summarizeAnalyticsMasterFolio({
      items: [{ amount: 500_000 }],
      payments: [{ amount: 300_000 }],
    });

    expect(guest.confirmed).toBe(550_000);
    expect(guest.directPaid + agency.paid).toBe(350_000);
    expect(guest.due + agency.due).toBe(200_000);
    expect(agency).toMatchObject({ paid: 300_000, due: 200_000, credit: 0 });
  });

  it("keeps individual stays unchanged and reports agency credits separately", () => {
    expect(summarizeAnalyticsGuestFolio({ roomAmount: 200_000, extraAmount: 20_000, directPaid: 100_000 })).toMatchObject({
      confirmed: 220_000,
      transferred: 0,
      due: 120_000,
      status: "PARTIAL",
    });
    expect(summarizeAnalyticsMasterFolio({ items: [{ amount: 100_000 }], payments: [{ amount: 120_000 }] })).toMatchObject({
      due: 0,
      credit: 20_000,
      active: true,
    });
  });

  it("reports collections net of agency refunds", () => {
    expect(summarizeAnalyticsMasterFolio({
      items: [{ amount: 450_000 }],
      payments: [{ amount: 600_000 }],
      refunds: [{ amount: 150_000 }],
    })).toMatchObject({
      billed: 450_000,
      paymentsReceived: 600_000,
      refunded: 150_000,
      paid: 450_000,
      balance: 0,
      due: 0,
      credit: 0,
    });
  });
});
