import { describe, expect, it } from "vitest";
import { summarizeChannelSnapshots, type ChannelSnapshotRow } from "./channelOperations.js";

function snapshot(overrides: Partial<ChannelSnapshotRow>): ChannelSnapshotRow {
  return {
    connectionId: 1,
    capturedAt: "2026-07-22T10:05:00.000Z",
    healthState: "HEALTHY",
    lagMinutes: 5,
    pendingDeliveries: 1,
    sendingDeliveries: 0,
    failedDeliveries: 0,
    deadLetters: 0,
    openIssues: 0,
    criticalIssues: 0,
    deliverySuccessBps: 10_000,
    ...overrides,
  };
}

describe("channel operations history", () => {
  it("buckets samples and calculates availability, p95 lag and queue depth", () => {
    const result = summarizeChannelSnapshots([
      snapshot({ capturedAt: "2026-07-22T10:05:00.000Z", lagMinutes: 5 }),
      snapshot({ capturedAt: "2026-07-22T10:25:00.000Z", healthState: "ATTENTION", lagMinutes: 20, pendingDeliveries: 4, sendingDeliveries: 1, deliverySuccessBps: 8_000 }),
      snapshot({ capturedAt: "2026-07-22T10:45:00.000Z", healthState: "CRITICAL", lagMinutes: 60, pendingDeliveries: 2 }),
    ], 60);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ samples: 3, availabilityBps: 3333, averageLagMinutes: 28, p95LagMinutes: 60, deliverySuccessBps: 9333, attentionSamples: 1, criticalSamples: 1, maxQueueDepth: 5 });
  });

  it("keeps empty SLO measures null instead of reporting false success", () => {
    const result = summarizeChannelSnapshots([snapshot({ lagMinutes: null, deliverySuccessBps: null })], 60);
    expect(result[0]?.averageLagMinutes).toBeNull();
    expect(result[0]?.deliverySuccessBps).toBeNull();
  });

  it("excludes intentionally paused and disconnected channels from availability SLO", () => {
    const result = summarizeChannelSnapshots([
      snapshot({ healthState: "HEALTHY" }),
      snapshot({ healthState: "PAUSED", capturedAt: "2026-07-22T10:15:00.000Z" }),
      snapshot({ healthState: "DISCONNECTED", capturedAt: "2026-07-22T10:25:00.000Z" }),
    ], 60);
    expect(result[0]?.availabilityBps).toBe(10_000);
  });
});
