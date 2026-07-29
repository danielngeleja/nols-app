import { afterEach, describe, expect, it, vi } from "vitest";

describe("Redis production configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("fails closed without attempting localhost when REDIS_URL is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("REDIS_URL", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { getRedis } = await import("./redis");

    expect(getRedis()).toBeNull();
    expect(getRedis()).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("REDIS_URL is not configured in production"),
    );
  });
});
