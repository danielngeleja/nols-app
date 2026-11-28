import { beforeEach, describe, expect, it, vi } from "vitest";

const { settingFindUnique, raiseSecurityAlert } = vi.hoisted(() => ({
  settingFindUnique: vi.fn(),
  raiseSecurityAlert: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: { systemSetting: { findUnique: settingFindUnique } },
}));
vi.mock("../lib/securityAlerts.js", () => ({ raiseSecurityAlert }));

// The allowlist is cached at module level, so each case loads a fresh copy.
async function run(ipAllowlist: string, ip: string) {
  vi.resetModules();
  settingFindUnique.mockResolvedValue({ id: 1, enableIpAllowlist: true, ipAllowlist });
  const { adminAllowlist } = await import("./adminAllowlist");
  const res = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  await adminAllowlist({ ip, socket: {}, originalUrl: "/api/admin/x" } as any, res as any, next);
  return { res, next };
}

describe("adminAllowlist", () => {
  beforeEach(() => {
    settingFindUnique.mockReset();
    raiseSecurityAlert.mockReset();
  });

  it("accepts every entry of a one-per-line list (as the settings page saves it)", async () => {
    const list = "10.0.0.0/8\n192.168.1.0/24\r\n203.0.113.7/32";
    expect((await run(list, "10.1.2.3")).next).toHaveBeenCalled();
    expect((await run(list, "192.168.1.50")).next).toHaveBeenCalled();
    expect((await run(list, "203.0.113.7")).next).toHaveBeenCalled();
  });

  it("accepts comma and space separated entries", async () => {
    const list = "10.0.0.0/8, 192.168.1.0/24  203.0.113.7/32";
    expect((await run(list, "203.0.113.7")).next).toHaveBeenCalled();
  });

  it("accepts a bare single address (saved without /32)", async () => {
    expect((await run("203.0.113.7\n10.0.0.0/8", "203.0.113.7")).next).toHaveBeenCalled();
    expect((await run("203.0.113.7", "203.0.113.8")).next).not.toHaveBeenCalled();
  });

  it("matches an IPv4-mapped IPv6 client address", async () => {
    expect((await run("203.0.113.7", "::ffff:203.0.113.7")).next).toHaveBeenCalled();
  });

  it("blocks an address outside the list", async () => {
    const { res, next } = await run("10.0.0.0/8\n192.168.1.0/24", "198.51.100.9");
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
