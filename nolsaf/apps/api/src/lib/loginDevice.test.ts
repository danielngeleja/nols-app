import { beforeEach, describe, expect, it, vi } from "vitest";

const { auditFindMany } = vi.hoisted(() => ({ auditFindMany: vi.fn() }));
vi.mock("@nolsaf/prisma", () => ({ prisma: { auditLog: { findMany: auditFindMany } } }));

import {
  LOGIN_DEVICE_COOKIE,
  LOGIN_DEVICE_FORGOTTEN,
  describeDevice,
  ensureLoginDeviceCookie,
  listRecognisedDevices,
  loginDeviceTag,
  readLoginDeviceId,
  shouldSendNewSignInAlert,
  signSignOutDeviceToken,
  verifySignOutDeviceToken,
} from "./loginDevice.js";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148";
const now = new Date("2026-11-18T10:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

describe("login device cookie", () => {
  it("mints a signed id, reuses it, and rejects a forged one", () => {
    const res: any = { cookie: vi.fn() };
    const id = ensureLoginDeviceCookie({ headers: {} }, res);
    const value = res.cookie.mock.calls[0][1] as string;
    expect(res.cookie.mock.calls[0][0]).toBe(LOGIN_DEVICE_COOKIE);
    expect(readLoginDeviceId(`${LOGIN_DEVICE_COOKIE}=${value}`)).toBe(id);
    expect(ensureLoginDeviceCookie({ headers: { cookie: `${LOGIN_DEVICE_COOKIE}=${value}` } }, res)).toBe(id);
    expect(readLoginDeviceId(`${LOGIN_DEVICE_COOKIE}=${id}.forgedsignature000000`)).toBeNull();
  });
});

describe("sign out that device link", () => {
  it("round-trips, rejects tampering, and expires", () => {
    const nowSec = Math.floor(now.getTime() / 1000);
    const token = signSignOutDeviceToken({ userId: 7, sessionId: "sess-1", deviceTag: "t1", nowSec });
    expect(verifySignOutDeviceToken(token, nowSec)).toEqual({ userId: 7, sessionId: "sess-1", deviceTag: "t1" });
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ u: 8, s: "sess-1", d: "t1", e: nowSec + 999 })).toString("base64url");
    expect(verifySignOutDeviceToken(`${forged}.${sig}`, nowSec)).toBeNull();
    expect(verifySignOutDeviceToken(`${body}.${sig}x`, nowSec)).toBeNull();
    expect(verifySignOutDeviceToken(token, nowSec + 15 * 86_400)).toBeNull();
  });

  it("names devices in plain language", () => {
    expect(describeDevice(UA)).toBe("iPhone"); // in-app web view: no browser token
    expect(describeDevice(`${UA} Safari/604.1`)).toBe("Safari on iPhone");
    expect(describeDevice("okhttp/4.12.0")).toBe("NoLSAF app");
    expect(describeDevice("")).toBe("Unknown device");
  });
});

describe("new sign-in alert policy", () => {
  beforeEach(() => { auditFindMany.mockReset(); });

  it("stays quiet on the account's first recorded sign-in", async () => {
    auditFindMany.mockResolvedValue([]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: "t1", userAgent: UA, now })).toBe(false);
  });

  it("stays quiet for a device that signed in before, even from a new IP or browser version", async () => {
    auditFindMany.mockResolvedValue([{ ua: "older browser", afterJson: { deviceTag: "t1" }, createdAt: daysAgo(200) }]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: "t1", userAgent: UA, now })).toBe(false);
  });

  it("stays quiet for the same app user agent within 90 days (clients without cookies)", async () => {
    auditFindMany.mockResolvedValue([{ ua: UA, afterJson: {}, createdAt: daysAgo(10) }]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: null, userAgent: UA, now })).toBe(false);
  });

  it("alerts for a device and user agent this account has not used", async () => {
    auditFindMany.mockResolvedValue([
      { ua: "Windows Chrome", afterJson: { deviceTag: "other" }, createdAt: daysAgo(3) },
      { ua: UA, afterJson: {}, createdAt: daysAgo(120) },
    ]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: loginDeviceTag("new-device"), userAgent: UA, now })).toBe(true);
  });

  it("does not trust a device that only ever failed the password", async () => {
    auditFindMany.mockResolvedValue([
      { ua: "Windows Chrome", afterJson: { success: true }, createdAt: daysAgo(30) },
      { ua: UA, afterJson: { success: false, deviceTag: "attacker" }, createdAt: daysAgo(1) },
    ]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: "attacker", userAgent: UA, now })).toBe(true);
  });

  it("treats a removed device as new again, but trusts it after a later sign-in", async () => {
    auditFindMany.mockResolvedValue([
      { action: LOGIN_DEVICE_FORGOTTEN, ua: null, afterJson: { deviceTag: "t1", userAgents: [UA] }, createdAt: daysAgo(2) },
      { action: "USER_LOGIN", ua: UA, afterJson: { success: true, deviceTag: "t1" }, createdAt: daysAgo(5) },
    ]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: "t1", userAgent: UA, now })).toBe(true);

    auditFindMany.mockResolvedValue([
      { action: "USER_LOGIN", ua: UA, afterJson: { success: true, deviceTag: "t1" }, createdAt: daysAgo(1) },
      { action: LOGIN_DEVICE_FORGOTTEN, ua: null, afterJson: { deviceTag: "t1", userAgents: [UA] }, createdAt: daysAgo(2) },
    ]);
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: "t1", userAgent: UA, now })).toBe(false);
  });

  it("lists recognised devices once each, newest first, and hides removed ones", async () => {
    auditFindMany.mockResolvedValue([
      { action: "USER_LOGIN", ua: UA, afterJson: { success: true, deviceTag: "phone" }, createdAt: daysAgo(1) },
      { action: "USER_LOGIN", ua: "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0", afterJson: { success: true, deviceTag: "pc" }, createdAt: daysAgo(3) },
      { action: "USER_LOGIN", ua: UA, afterJson: { success: true, deviceTag: "phone" }, createdAt: daysAgo(9) },
      { action: "USER_LOGIN", ua: UA, afterJson: { success: false, deviceTag: "attacker" }, createdAt: daysAgo(1) },
      { action: LOGIN_DEVICE_FORGOTTEN, ua: null, afterJson: { deviceTag: "old" }, createdAt: daysAgo(4) },
      { action: "USER_LOGIN", ua: UA, afterJson: { success: true, deviceTag: "old" }, createdAt: daysAgo(30) },
    ]);
    const devices = await listRecognisedDevices(1, "pc", now);
    expect(devices.map((d) => [d.id, d.signIns, d.current])).toEqual([["phone", 2, false], ["pc", 1, true]]);
    expect(devices[1].name).toBe("Chrome on Windows");
  });

  it("never floods inboxes when history cannot be read", async () => {
    auditFindMany.mockRejectedValue(new Error("db down"));
    expect(await shouldSendNewSignInAlert({ userId: 1, deviceTag: "t1", userAgent: UA, now })).toBe(false);
  });
});
