import { describe, expect, it } from "vitest";
import { prisma } from "@nolsaf/prisma";

const describeDatabase = process.env.RUN_DB_INTEGRATION === "true" ? describe : describe.skip;

describeDatabase("audit retention database triggers", () => {
  it("uses consistent priority and expires work items inserted as resolved", async () => {
    const rollback = new Error("ROLLBACK_AUDIT_RETENTION_TRIGGER_TEST");
    const createdAt = new Date("2026-08-01T12:00:00.000Z");

    try {
      await prisma.$transaction(async (tx) => {
        const audit = await tx.auditLog.create({
          data: {
            actorId: null,
            actorRole: "SYSTEM",
            action: "PAYMENT_API_ERROR",
            entity: "OBSERVABILITY",
            entityId: null,
            createdAt,
          },
        });
        const storedAudit = await tx.auditLog.findUniqueOrThrow({ where: { id: audit.id } });
        expect(storedAudit.retentionClass).toBe("FINANCIAL");
        expect(storedAudit.expiresAt).toEqual(new Date("2033-08-01T12:00:00.000Z"));

        const adminAudit = await tx.adminAudit.create({
          data: {
            adminId: null,
            action: "PAYMENT_API_ERROR",
            createdAt,
          },
        });
        const storedAdminAudit = await tx.adminAudit.findUniqueOrThrow({ where: { id: adminAudit.id } });
        expect(storedAdminAudit.retentionClass).toBe("FINANCIAL");
        expect(storedAdminAudit.expiresAt).toEqual(new Date("2033-08-01T12:00:00.000Z"));

        const workItem = await tx.adminWorkItem.create({
          data: {
            sourceType: "RETENTION_TRIGGER_TEST",
            sourceId: `resolved-${Date.now()}`,
            category: "NRMS",
            title: "Resolved trigger test",
            summary: "Verify resolved insert retention",
            subject: "Test",
            detailHref: "/admin",
            actionLabel: "Review",
            severity: "LOW",
            status: "RESOLVED",
            responseTargetMinutes: 60,
            resolutionTargetMinutes: 120,
            openedAt: createdAt,
            responseDueAt: createdAt,
            resolutionDueAt: createdAt,
            resolvedAt: createdAt,
            lastObservedAt: createdAt,
            createdAt,
          },
        });
        const storedWorkItem = await tx.adminWorkItem.findUniqueOrThrow({ where: { id: workItem.id } });
        expect(storedWorkItem.retentionClass).toBe("OPERATIONAL");
        expect(storedWorkItem.expiresAt).toEqual(new Date("2028-08-01T12:00:00.000Z"));

        throw rollback;
      }, { timeout: 15_000 });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  });
});
