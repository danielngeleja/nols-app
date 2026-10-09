import { describe, expect, it, vi } from "vitest";

vi.mock("./redis.js", () => ({ getRedis: () => null }));
vi.mock("./otp.js", async () => {
  const crypto = await import("node:crypto");
  return { generate6: () => "123456", hashCode: (code: string) => crypto.createHash("sha256").update(code).digest("hex") };
});

import { dataExportLockState, dataExportRequestInput, maskDestination, readDataExportGrant, startDataExportChallenge, verifyDataExportCode } from "./dataExportVerification.js";

const answers = dataExportRequestInput.parse({ country: "Tanzania", reason: "KNOW_WHAT_WE_HOLD" });

describe("data export verification", () => {
  it("requires a country and accepts only known reasons", () => {
    expect(dataExportRequestInput.safeParse({ country: "" }).success).toBe(false);
    expect(dataExportRequestInput.safeParse({ country: "Kenya", reason: "CURIOUS" }).success).toBe(false);
    expect(dataExportRequestInput.parse({ country: "Kenya" })).toEqual(expect.objectContaining({ reason: null, format: "pdf" }));
  });

  it("releases a grant only for the right code, once, and only to the same account", async () => {
    await startDataExportChallenge(41, answers, "email", "a@example.com");
    expect(await verifyDataExportCode(41, "000000")).toEqual({ result: "INVALID", attemptsLeft: 2 });
    const ok = await verifyDataExportCode(41, "123456");
    expect(ok.result).toBe("VALID");
    if (ok.result !== "VALID") return;
    expect(await verifyDataExportCode(41, "123456")).toEqual({ result: "MISSING" });
    expect(await readDataExportGrant(41, ok.grant)).toEqual(expect.objectContaining({ country: "Tanzania", reason: "KNOW_WHAT_WE_HOLD", sentVia: "email" }));
    expect(await readDataExportGrant(42, ok.grant)).toBeNull();
    expect(await readDataExportGrant(41, "not-a-real-grant-token-value")).toBeNull();
  });

  it("locks after three wrong codes", async () => {
    await startDataExportChallenge(43, answers, "phone", "+255700000000");
    for (let i = 0; i < 2; i++) expect((await verifyDataExportCode(43, "999999")).result).toBe("INVALID");
    expect(await verifyDataExportCode(43, "999999")).toEqual({ result: "LOCKED", request: expect.objectContaining({ country: "Tanzania", sentVia: "phone" }) });
    expect(await verifyDataExportCode(43, "123456")).toEqual({ result: "MISSING" });
  });

  it("masks where the code went", () => {
    expect(maskDestination("email", "daniel@example.com")).toBe("da***@example.com");
    expect(maskDestination("phone", "+255765012370")).toBe("*********2370");
  });
});

describe("data export lock", () => {
  const db = (row: any) => ({ auditLog: { findFirst: async () => row } });
  it("is open when nothing was ever locked", async () => {
    expect((await dataExportLockState(db(null), 7)).locked).toBe(false);
  });
  it("is locked by the latest lock, by the customer", async () => {
    expect(await dataExportLockState(db({ action: "USER_DATA_EXPORT_LOCKED", createdAt: new Date("2026-10-09"), actorId: 7, afterJson: { reason: "3 wrong codes" } }), 7))
      .toEqual(expect.objectContaining({ locked: true, lastChangeBy: "customer", note: "3 wrong codes" }));
  });
  it("is open again after an admin unlock", async () => {
    expect(await dataExportLockState(db({ action: "USER_DATA_EXPORT_UNLOCKED", createdAt: new Date(), actorId: 1, afterJson: { reason: "Called the guest" } }), 7))
      .toEqual(expect.objectContaining({ locked: false, lastChangeBy: "admin" }));
  });
});
