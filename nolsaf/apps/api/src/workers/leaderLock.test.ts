import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  eval: vi.fn(),
}));

vi.mock("../lib/redis.js", () => ({
  getRedis: () => mocks,
}));

import { hasLeaderLease, releaseLeaderLock, startLeaderElection } from "./leaderLock.js";

describe("worker leader election", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.eval.mockResolvedValue(1);
  });

  afterEach(async () => {
    await releaseLeaderLock();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("retries after another process owns the lease and eventually becomes leader", async () => {
    mocks.set.mockResolvedValueOnce(null).mockResolvedValueOnce("OK");
    const onAcquired = vi.fn();
    const onWaiting = vi.fn();

    startLeaderElection(onAcquired, { retryIntervalMs: 1_000, onWaiting });
    await vi.advanceTimersByTimeAsync(0);

    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(onWaiting).toHaveBeenCalledWith(1_000);
    expect(onAcquired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);

    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(hasLeaderLease()).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.set).toHaveBeenCalledTimes(2);
    expect(onAcquired).toHaveBeenCalledTimes(1);
  });

  it("retries after a temporary Redis acquisition error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.set.mockRejectedValueOnce(new Error("temporary outage")).mockResolvedValueOnce("OK");
    const onAcquired = vi.fn();

    startLeaderElection(onAcquired, { retryIntervalMs: 500 });
    await vi.advanceTimersByTimeAsync(0);
    expect(onAcquired).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(onAcquired).toHaveBeenCalledTimes(1);
    expect(hasLeaderLease()).toBe(true);
    errorSpy.mockRestore();
  });

  it("does not create duplicate acquisition loops when started twice", async () => {
    mocks.set.mockResolvedValue(null);
    const first = vi.fn();
    const second = vi.fn();

    startLeaderElection(first, { retryIntervalMs: 1_000 });
    startLeaderElection(second, { retryIntervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(3_000);

    expect(mocks.set).toHaveBeenCalledTimes(4);
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
  });

  it("stops follower retries when the election is released", async () => {
    mocks.set.mockResolvedValue(null);

    startLeaderElection(vi.fn(), { retryIntervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.set).toHaveBeenCalledTimes(1);

    await releaseLeaderLock();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(mocks.set).toHaveBeenCalledTimes(1);
    expect(hasLeaderLease()).toBe(false);
  });
});
