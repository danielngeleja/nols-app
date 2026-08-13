import { beforeEach, describe, expect, it, vi } from "vitest";

const { settingsFindUnique } = vi.hoisted(() => ({ settingsFindUnique: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    systemSetting: { findUnique: settingsFindUnique },
  },
}));

const policy = {
  sessionIdleMinutes: 720,
  maxSessionDurationHours: 24,
  sessionMaxMinutesAdmin: 30,
  sessionMaxMinutesOwner: 90,
  sessionMaxMinutesDriver: 120,
  sessionMaxMinutesCustomer: 180,
  sessionMaxMinutesAgent: 240,
};

describe("role session TTL policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsFindUnique.mockResolvedValue(policy);
  });

  it.each([
    ["ADMIN", 30],
    ["OWNER", 90],
    ["DRIVER", 120],
    ["AGENT", 240],
    ["CUSTOMER", 180],
    ["USER", 180],
    ["TRAVELLER", 180],
    ["TRAVELER", 180],
  ])("maps %s to the correct role override", async (role, expected) => {
    const { getRoleSessionMaxMinutes } = await import("./securitySettings.js");
    await expect(getRoleSessionMaxMinutes(role)).resolves.toBe(expected);
  });

  it("uses Default only for an unknown or missing role", async () => {
    const { getRoleSessionMaxMinutes } = await import("./securitySettings.js");
    await expect(getRoleSessionMaxMinutes("UNKNOWN")).resolves.toBe(720);
    await expect(getRoleSessionMaxMinutes(null)).resolves.toBe(720);
  });

  it("reloads the policy on the next lookup by default", async () => {
    const { getRoleSessionMaxMinutes, invalidateSessionPolicyCache } = await import("./securitySettings.js");
    await expect(getRoleSessionMaxMinutes("ADMIN")).resolves.toBe(30);
    settingsFindUnique.mockResolvedValue({ ...policy, sessionMaxMinutesAdmin: 10 });
    invalidateSessionPolicyCache();
    await expect(getRoleSessionMaxMinutes("ADMIN")).resolves.toBe(10);
    expect(settingsFindUnique).toHaveBeenCalledTimes(2);
  });
});
