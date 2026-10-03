import { beforeEach, describe, expect, it, vi } from "vitest";

const notifyAdmins = vi.fn();
const shouldAlert = vi.fn();

vi.mock("./notifications.js", () => ({ notifyAdmins: (...args: unknown[]) => notifyAdmins(...args) }));
vi.mock("./securitySettings.js", () => ({ shouldAlertOnSuspiciousActivity: () => shouldAlert() }));
vi.mock("./redis.js", () => ({ getRedis: () => null }));

// vi.mock calls are hoisted above imports, so this import sees the mocks.
import { raiseSecurityAlert } from "./securityAlerts.js";


describe("raiseSecurityAlert", () => {
  beforeEach(() => {
    notifyAdmins.mockReset();
    shouldAlert.mockReset();
  });

  it("stays silent while the setting is off", async () => {
    shouldAlert.mockResolvedValue(false);
    await raiseSecurityAlert("security_account_locked", "off@example.com", { identifier: "off@example.com" });
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it("notifies admins once per subject inside the window", async () => {
    shouldAlert.mockResolvedValue(true);
    await raiseSecurityAlert("security_account_locked", "a@example.com", { identifier: "a@example.com" });
    await raiseSecurityAlert("security_account_locked", "A@example.com", { identifier: "A@example.com" });
    await raiseSecurityAlert("security_account_locked", "b@example.com", { identifier: "b@example.com" });
    expect(notifyAdmins).toHaveBeenCalledTimes(2);
    expect(notifyAdmins).toHaveBeenCalledWith("security_account_locked", { identifier: "a@example.com" });
  });

  it("never throws when notifying fails", async () => {
    shouldAlert.mockResolvedValue(true);
    notifyAdmins.mockRejectedValue(new Error("db down"));
    await expect(raiseSecurityAlert("security_ip_burst", "10.0.0.9", { ip: "10.0.0.9" })).resolves.toBeUndefined();
  });
});
