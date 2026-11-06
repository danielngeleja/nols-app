import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  query: vi.fn(),
  invoices: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: { $queryRaw: database.query, invoice: { findMany: database.invoices } } }));
vi.mock("../lib/invoiceMoneyStageIndex.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/invoiceMoneyStageIndex.js")>()),
  loadOwnerInvoiceDisbursements: vi.fn(async () => new Map()),
}));

/** A booking invoice row as earnedCommissionRows selects it. */
const invoiceRow = (id: number, status: string, commission: number, paidAt: string | null, issuedAt: string, property = { id: 1, title: "Mixed hotel" }) => ({
  id, status, invoiceNumber: `INV-${id}`, commissionAmount: commission,
  paidAt: paidAt ? new Date(paidAt) : null, issuedAt: new Date(issuedAt), booking: { property },
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/fx.js", () => ({
  BASE_CURRENCY: "TZS",
  getFxRates: vi.fn(async () => ({ tzsPerUnit: { TZS: 1, USD: 2500 } })),
}));

let app: express.Express;

beforeAll(async () => {
  const { default: router } = await import("../routes/admin.revenue.js");
  app = express();
  app.use("/api/admin/revenue", router);
});

beforeEach(() => {
  database.query.mockReset();
  database.invoices.mockReset();
});

describe("admin home revenue classification", () => {
  it("shows verified NRMS billing as subscription without changing invoice commission, including NRMS-only properties", async () => {
    database.invoices.mockResolvedValue([
      invoiceRow(1, "PAID", 3000, "2026-09-29T08:00:00Z", "2026-09-28T08:00:00Z"),
      // Guest paid, owner is now claiming it: the commission is still earned.
      invoiceRow(2, "REQUESTED", 1000, "2026-09-29T09:00:00Z", "2026-09-28T09:00:00Z"),
      // Guest has not paid yet: nothing earned.
      invoiceRow(3, "PENDING", 9000, null, "2026-09-29T10:00:00Z"),
    ]);
    database.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM nrms_service_payment pay")) return [
        { id: 1, name: "Mixed hotel", currency: "TZS", subscription_total: 10000 },
        { id: 2, name: "NRMS-only hotel", currency: "USD", subscription_total: 2 },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(app).get("/api/admin/revenue/properties?top=2").expect(200);
    expect(response.body).toEqual([
      { id: 1, name: "Mixed hotel", total: 14000, commission: 4000, subscription: 10000 },
      { id: 2, name: "NRMS-only hotel", total: 5000, commission: 0, subscription: 5000 },
    ]);

    const subscriptionSql = database.query.mock.calls.map((call) => call[0].join("?")).find((sql) => sql.includes("FROM nrms_service_payment pay"));
    expect(subscriptionSql).toContain("pay.status IN ('VERIFIED', 'MANUALLY_VERIFIED')");
    expect(subscriptionSql).toContain("statement.id = token.statementId");
    expect(subscriptionSql).toContain("account.id = statement.accountId");
  });

  it("places NRMS-only verified payments in the subscription time series by verification date", async () => {
    database.invoices.mockResolvedValue([
      // Issued the day before, paid on the 29th in EAT: dated by payment.
      invoiceRow(1, "PAID", 3000, "2026-09-29T08:00:00Z", "2026-09-28T08:00:00Z"),
      invoiceRow(2, "VERIFIED", 1000, "2026-09-29T09:00:00Z", "2026-09-28T09:00:00Z"),
      invoiceRow(3, "PENDING", 9000, null, "2026-09-29T10:00:00Z"),
    ]);
    database.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM nrms_service_payment pay")) return [
        { label: "2026-09-29", currency: "TZS", subscription_total: 10000 },
        { label: "2026-09-30", currency: "TZS", subscription_total: 2000 },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(app).get("/api/admin/revenue/series?from=2026-09-29&to=2026-10-01&interval=day").expect(200);
    expect(response.body).toEqual([
      { label: "2026-09-29", commission: 4000, subscription: 10000 },
      { label: "2026-09-30", commission: 0, subscription: 2000 },
    ]);

    const subscriptionSql = database.query.mock.calls.map((call) => call[0].join("?")).find((sql) => sql.includes("FROM nrms_service_payment pay"));
    expect(subscriptionSql).toContain("pay.verifiedAt BETWEEN");
    // Owner claims (OINV-) restate a booking invoice, so they are never read as commission.
    expect(JSON.stringify(database.invoices.mock.calls[0][0].where)).toContain("OINV-");
    expect(subscriptionSql).toContain("pay.status IN ('VERIFIED', 'MANUALLY_VERIFIED')");
  });

  it("includes verified NRMS billing in the today/yesterday platform revenue total", async () => {
    database.query.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      if (sql.includes("FROM invoice i")) return [{ today_total: 4000, yesterday_total: 1000 }];
      if (sql.includes("FROM nrms_service_payment pay")) return [
        { currency: "TZS", today_total: 10000, yesterday_total: 0 },
      ];
      throw new Error(`Unexpected query: ${sql}`);
    });

    const response = await request(app).get("/api/admin/revenue/summary").expect(200);
    expect(response.body).toMatchObject({ today: 14000, yesterday: 1000 });
  });
});
