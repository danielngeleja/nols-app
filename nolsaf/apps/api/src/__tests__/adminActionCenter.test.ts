import { describe, expect, it } from "vitest";
import {
  deadlineFrom,
  isActionOverdue,
  normalizeSeverity,
  paginateActionItems,
  slaTargetFor,
  sortActionItems,
  summarizeActionItems,
  type ActionCenterItem,
} from "../lib/adminActionCenter";
import { retryAdminWorkItemWrite } from "../lib/adminSlaWorkItems";

const now = new Date("2026-08-01T12:00:00.000Z");

function item(overrides: Partial<ActionCenterItem>): ActionCenterItem {
  return {
    id: "one",
    category: "PAYMENTS",
    severity: "MEDIUM",
    title: "Review",
    summary: "Review item",
    subject: "Subject",
    sourceType: "TEST",
    sourceId: "1",
    createdAt: "2026-08-01T08:00:00.000Z",
    dueAt: null,
    detailHref: "/admin",
    actionLabel: "Review",
    exposure: null,
    ...overrides,
  };
}

function workflow(overrides: Partial<NonNullable<ActionCenterItem["workflow"]>> = {}): NonNullable<ActionCenterItem["workflow"]> {
  return {
    id: 1,
    status: "OPEN",
    assignedTeam: "Admin Operations",
    assignedTo: null,
    openedAt: "2026-08-01T08:00:00.000Z",
    responseDueAt: "2026-08-01T09:00:00.000Z",
    resolutionDueAt: "2026-08-01T10:00:00.000Z",
    acknowledgedAt: null,
    resolvedAt: null,
    resolutionNote: null,
    responseBreached: true,
    resolutionBreached: true,
    responseTargetMinutes: 60,
    resolutionTargetMinutes: 120,
    policyVersion: "2026-08",
    ...overrides,
  };
}

describe("admin action center helpers", () => {
  it("detects deadlines and overdue work deterministically", () => {
    const dueAt = deadlineFrom(new Date("2026-08-01T08:00:00.000Z"), 2);
    expect(dueAt.toISOString()).toBe("2026-08-01T10:00:00.000Z");
    expect(isActionOverdue(item({ dueAt: dueAt.toISOString() }), now)).toBe(true);
  });

  it("orders severity before deadline", () => {
    const sorted = sortActionItems([
      item({ id: "medium-overdue", dueAt: "2026-08-01T10:00:00.000Z" }),
      item({ id: "critical", severity: "CRITICAL", dueAt: "2026-08-02T10:00:00.000Z" }),
      item({ id: "high", severity: "HIGH" }),
    ], now);
    expect(sorted.map((entry) => entry.id)).toEqual(["critical", "high", "medium-overdue"]);
  });

  it("summarizes categories, deadlines, and exposure by currency", () => {
    const summary = summarizeActionItems([
      item({ id: "a", severity: "CRITICAL", dueAt: "2026-08-01T10:00:00.000Z", exposure: { amount: 50_000, currency: "TZS" } }),
      item({ id: "b", category: "TRANSPORT", severity: "HIGH", exposure: { amount: 25_000, currency: "TZS" } }),
    ], now);
    expect(summary).toMatchObject({
      total: 2,
      critical: 1,
      high: 1,
      overdue: 1,
      exposureByCurrency: { TZS: 75_000 },
      byCategory: { PAYMENTS: 1, TRANSPORT: 1 },
    });
  });

  it("normalizes external severity labels", () => {
    expect(normalizeSeverity("ERROR")).toBe("CRITICAL");
    expect(normalizeSeverity("warning")).toBe("MEDIUM");
    expect(normalizeSeverity("unknown", "LOW")).toBe("LOW");
  });

  it("uses progressively tighter SLA targets for higher severity", () => {
    expect(slaTargetFor("CRITICAL")).toEqual({ responseMinutes: 15, resolutionMinutes: 60 });
    expect(slaTargetFor("HIGH")).toEqual({ responseMinutes: 60, resolutionMinutes: 240 });
    expect(slaTargetFor("MEDIUM")).toEqual({ responseMinutes: 240, resolutionMinutes: 1440 });
    expect(slaTargetFor("LOW")).toEqual({ responseMinutes: 1440, resolutionMinutes: 4320 });
  });

  it("summarizes durable SLA ownership and breach state", () => {
    const summary = summarizeActionItems([
      item({ id: "breached", workflow: workflow() }),
      item({ id: "owned", workflow: workflow({ id: 2, status: "ACKNOWLEDGED", assignedTo: { id: 8, name: "Admin", email: null }, responseBreached: false }) }),
      item({ id: "resolved", workflow: workflow({ id: 3, status: "RESOLVED", resolvedAt: "2026-08-01T11:00:00.000Z", responseBreached: false, resolutionBreached: false }) }),
    ], now);

    expect(summary).toMatchObject({
      total: 2,
      responseBreached: 1,
      resolutionBreached: 2,
      unassigned: 1,
      acknowledged: 1,
      resolved: 1,
    });
  });

  it("retries Prisma write conflicts and then succeeds", async () => {
    let attempts = 0;
    const result = await retryAdminWorkItemWrite(async () => {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error("write conflict"), { code: "P2034" });
      return "created";
    }, { maxAttempts: 4, baseDelayMs: 0 });

    expect(result).toBe("created");
    expect(attempts).toBe(3);
  });

  it("does not retry non-conflict database errors", async () => {
    let attempts = 0;
    await expect(retryAdminWorkItemWrite(async () => {
      attempts += 1;
      throw Object.assign(new Error("invalid query"), { code: "P2009" });
    }, { maxAttempts: 4, baseDelayMs: 0 })).rejects.toThrow("invalid query");
    expect(attempts).toBe(1);
  });

  it("paginates a sorted queue with bounded page sizes", () => {
    const values = Array.from({ length: 27 }, (_, index) => index + 1);
    const result = paginateActionItems(values, 2, 10);
    expect(result.items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(result.pagination).toEqual({ page: 2, perPage: 10, total: 27, totalPages: 3 });
  });
});
