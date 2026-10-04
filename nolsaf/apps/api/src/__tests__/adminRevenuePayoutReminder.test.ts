import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  invoice: { id: 42, ownerId: 7, invoiceNumber: "OINV-202609-0000042", status: "VERIFIED" } as any,
  owner: { id: 7, email: "owner@example.test", phone: "+255700000001", payout: {} } as any,
  recent: null as any,
  sendMail: vi.fn(),
  sendSms: vi.fn(),
  auditCreate: vi.fn(),
  auditFindFirst: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    invoice: { findUnique: vi.fn(async () => state.invoice) },
    user: { findUnique: vi.fn(async () => state.owner) },
    adminAudit: {
      findFirst: state.auditFindFirst,
      create: state.auditCreate,
    },
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 3 }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/mailer.js", () => ({ sendMail: state.sendMail }));
vi.mock("../lib/sms.js", () => ({ sendSms: state.sendSms }));

let app: express.Express;

beforeAll(async () => {
  const { default: router } = await import("../routes/admin.revenue.js");
  app = express();
  app.use(express.json());
  app.use("/api/admin/revenue", router);
});

beforeEach(() => {
  state.invoice = { id: 42, ownerId: 7, invoiceNumber: "OINV-202609-0000042", status: "VERIFIED" };
  state.owner = { id: 7, email: "owner@example.test", phone: "+255700000001", payout: {} };
  state.recent = null;
  state.sendMail.mockReset().mockResolvedValue({ success: true, provider: "resend", messageId: "email-1" });
  state.sendSms.mockReset().mockResolvedValue({ success: true, provider: "africastalking", messageId: "sms-1" });
  state.auditCreate.mockReset().mockResolvedValue({ id: 1 });
  state.auditFindFirst.mockReset().mockImplementation(async () => state.recent);
});

const endpoint = "/api/admin/revenue/invoices/42/remind-payout";

describe("admin owner payout reminder", () => {
  it("sends email to the invoice owner and records the successful channel", async () => {
    const response = await request(app).post(endpoint).send({ channel: "EMAIL" }).expect(200);
    expect(response.body).toMatchObject({ ok: true, channel: "EMAIL" });
    expect(state.sendMail).toHaveBeenCalledWith(
      "owner@example.test",
      expect.stringContaining("payout details"),
      expect.stringContaining("Owner Profile"),
    );
    expect(state.auditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        adminId: 3,
        targetUserId: 7,
        action: "OWNER_PAYOUT_REMINDER",
        details: expect.objectContaining({ invoiceId: 42, channel: "EMAIL" }),
      }),
    }));
  });

  it("sends SMS to the invoice owner", async () => {
    await request(app).post(endpoint).send({ channel: "SMS" }).expect(200);
    expect(state.sendSms).toHaveBeenCalledWith("+255700000001", expect.stringContaining("preferred payout method"));
    expect(state.sendMail).not.toHaveBeenCalled();
  });

  it("refuses unrelated invoices and completed owner payouts", async () => {
    state.invoice.invoiceNumber = "INV-202609-0000042";
    await request(app).post(endpoint).send({ channel: "EMAIL" }).expect(409);
    state.invoice.invoiceNumber = "OINV-202609-0000042";
    state.owner.payout = { payoutPreferred: "BANK", bankName: "Test Bank", bankAccountNumber: "12345" };
    await request(app).post(endpoint).send({ channel: "EMAIL" }).expect(409);
    expect(state.sendMail).not.toHaveBeenCalled();
  });

  it("prevents rapid repeat sends and does not claim suppressed delivery succeeded", async () => {
    state.recent = { id: 10 };
    await request(app).post(endpoint).send({ channel: "EMAIL" }).expect(429);
    expect(state.sendMail).not.toHaveBeenCalled();

    state.recent = null;
    state.sendSms.mockResolvedValue({ success: true, provider: "suppressed" });
    await request(app).post(endpoint).send({ channel: "SMS" }).expect(502);
    expect(state.auditCreate).not.toHaveBeenCalled();
  });
});
