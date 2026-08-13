import { describe, expect, it, vi } from "vitest";
import {
  auditRetentionFields,
  classifyAuditRetention,
  legalHoldReleaseExpiresAt,
  retentionClassForActionCenter,
  retentionExpiresAt,
} from "../lib/auditRetention";
import { runAuditRetention } from "../workers/auditRetention";

describe("audit retention policy", () => {
  it("classifies evidence into the required retention tiers", () => {
    expect(classifyAuditRetention("OTP_SENT", "OTP:PHONE")).toBe("OTP");
    expect(classifyAuditRetention("PAYOUT_APPROVED", "PAYOUT")).toBe("FINANCIAL");
    expect(classifyAuditRetention("KYC_APPROVED", "DRIVER_KYC")).toBe("COMPLIANCE");
    expect(classifyAuditRetention("CLIENT_ERROR", "OBSERVABILITY")).toBe("TECHNICAL");
    expect(classifyAuditRetention("USER_LOGIN", "AUTH")).toBe("SECURITY");
    expect(classifyAuditRetention("BOOKING_DRAFT_EXPIRED_PURGED", "BOOKING")).toBe("OPERATIONAL");
  });

  it("calculates calendar based retention deadlines", () => {
    const createdAt = new Date("2024-02-29T10:00:00.000Z");
    expect(retentionExpiresAt("OTP", createdAt).toISOString()).toBe("2024-03-30T10:00:00.000Z");
    expect(retentionExpiresAt("TECHNICAL", createdAt).toISOString()).toBe("2024-05-29T10:00:00.000Z");
    expect(retentionExpiresAt("OPERATIONAL", createdAt).toISOString()).toBe("2026-03-01T10:00:00.000Z");
    expect(retentionExpiresAt("FINANCIAL", createdAt).toISOString()).toBe("2031-03-01T10:00:00.000Z");
  });

  it("keeps financial Action Center evidence for seven years", () => {
    const createdAt = new Date("2026-08-01T12:00:00.000Z");
    expect(retentionClassForActionCenter("PAYMENTS")).toBe("FINANCIAL");
    expect(retentionClassForActionCenter("NRMS")).toBe("OPERATIONAL");
    expect(auditRetentionFields("INVOICE_REFUND", "INVOICE", createdAt)).toEqual({
      retentionClass: "FINANCIAL",
      expiresAt: new Date("2033-08-01T12:00:00.000Z"),
    });
  });

  it("gives released legal holds at least a thirty day review window", () => {
    const releasedAt = new Date("2026-08-01T12:00:00.000Z");
    expect(legalHoldReleaseExpiresAt("2025-01-01T00:00:00.000Z", releasedAt)).toEqual(
      new Date("2026-08-31T12:00:00.000Z")
    );
    expect(legalHoldReleaseExpiresAt("2030-01-01T00:00:00.000Z", releasedAt)).toEqual(
      new Date("2030-01-01T00:00:00.000Z")
    );
  });

  it("purges sequential bounded batches without an interactive transaction", async () => {
    const now = new Date("2026-08-01T12:00:00.000Z");
    const client = {
      auditLog: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 1n }, { id: 2n }])
          .mockResolvedValueOnce([{ id: 3n }]),
        deleteMany: vi.fn()
          .mockResolvedValueOnce({ count: 2 })
          .mockResolvedValueOnce({ count: 1 }),
        create: vi.fn().mockResolvedValue({ id: 99n }),
      },
      adminAudit: {
        findMany: vi.fn().mockResolvedValueOnce([{ id: 4 }]),
        deleteMany: vi.fn().mockResolvedValueOnce({ count: 1 }),
      },
      adminWorkItem: {
        findMany: vi.fn().mockResolvedValueOnce([]),
        deleteMany: vi.fn(),
      },
    };

    await expect(runAuditRetention(now, client, { batchSize: 2, maxBatchesPerModel: 5 })).resolves.toEqual({
      auditLogs: 3,
      adminAudits: 1,
      workItems: 0,
      batches: { auditLogs: 2, adminAudits: 1, workItems: 0 },
      limitReached: false,
    });
    expect(client.auditLog.deleteMany).toHaveBeenCalledTimes(2);
    expect(client.adminAudit.findMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      client.auditLog.deleteMany.mock.invocationCallOrder[1]
    );
    expect(client.adminWorkItem.deleteMany).not.toHaveBeenCalled();
    expect(client.auditLog.create).toHaveBeenCalledOnce();
  });
});
