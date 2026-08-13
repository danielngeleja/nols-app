import { describe, expect, it } from "vitest";
import { classifyAdminChannelHealth, type AdminChannelHealthInput } from "./adminChannelHealth.js";

const baseline: AdminChannelHealthInput = {
  status: "ACTIVE",
  connectionType: "API",
  hasActiveCredential: true,
  lastSuccessAt: "2026-07-22T10:55:00.000Z",
  pendingDeliveries: 0,
  sendingDeliveries: 0,
  failedDeliveries: 0,
  deadLetterDeliveries: 0,
  failedInboundEvents: 0,
  openIssues: 0,
  criticalIssues: 0,
  stuckDeliveries: 0,
};

describe("admin channel health", () => {
  const now = new Date("2026-07-22T11:00:00.000Z");

  it("marks a current clean connection healthy", () => {
    expect(classifyAdminChannelHealth(baseline, now)).toMatchObject({ state: "HEALTHY", lagMinutes: 5 });
  });

  it("raises critical health for missing credentials or dead letters", () => {
    expect(classifyAdminChannelHealth({ ...baseline, hasActiveCredential: false, deadLetterDeliveries: 2 }, now)).toMatchObject({ state: "CRITICAL" });
  });

  it("distinguishes paused operations from provider failures", () => {
    expect(classifyAdminChannelHealth({ ...baseline, status: "PAUSED" }, now).state).toBe("PAUSED");
    expect(classifyAdminChannelHealth({ ...baseline, failedInboundEvents: 1 }, now).state).toBe("ATTENTION");
  });
});
