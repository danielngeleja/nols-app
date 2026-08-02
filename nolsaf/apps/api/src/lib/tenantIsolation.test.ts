import { describe, expect, it, vi } from "vitest";
import { adminCacheKey, publicCacheKey, tenantCacheKey, withCache } from "./performance.js";
import { makeKey } from "./cache.js";
import { requireTenantId, tenantWhere } from "./tenantIsolation.js";

describe("tenant isolation primitives", () => {
  it("assigns the authoritative tenant last so caller filters cannot override it", () => {
    for (let ownerId = 1; ownerId <= 20_000; ownerId += 1) {
      const where = tenantWhere("ownerId", ownerId, {
        id: ownerId + 900_000,
        ownerId: ownerId + 1,
        status: "APPROVED",
      });
      expect(where.ownerId).toBe(ownerId);
    }
  });

  it.each([0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe tenant id %s",
    (id) => expect(() => requireTenantId(id)).toThrow(/Invalid tenantId/),
  );

  it("keeps private cache keys unique across tenants, scopes, resources and parameters", () => {
    const keys = new Set<string>();
    const scopes = ["owner", "property", "user", "driver", "agent"] as const;

    for (let attempt = 1; attempt <= 20_000; attempt += 1) {
      const scope = scopes[attempt % scopes.length];
      const tenantId = Math.floor((attempt - 1) / scopes.length) + 1;
      const key = tenantCacheKey(scope, tenantId, "dashboard", { page: attempt, view: attempt % 7 });
      expect(key).toContain(`tenant:${scope}:${tenantId}:`);
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }
    expect(keys.size).toBe(20_000);
  });

  it("separates owner report entries even when all route parameters match", () => {
    expect(makeKey(41, "overview", { from: "2026-01-01" }))
      .not.toBe(makeKey(42, "overview", { from: "2026-01-01" }));
  });

  it("creates explicit public and admin namespaces", () => {
    expect(publicCacheKey("properties", { page: 1 })).toMatch(/^public:/);
    expect(adminCacheKey("summary")).toMatch(/^admin:/);
  });

  it("rejects an unscoped private cache key and executes the authoritative producer", async () => {
    const producer = vi.fn().mockResolvedValue({ ownerId: 22 });
    const value = await withCache("dashboard:overview" as any, producer);
    expect(value).toEqual({ ownerId: 22 });
    expect(producer).toHaveBeenCalledOnce();
  });
});
