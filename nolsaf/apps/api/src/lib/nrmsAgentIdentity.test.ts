import { describe, expect, it, vi } from "vitest";
import { createAgentAccount, decideAgentVerification, findAgencyMatches, normalizeAgentDocuments } from "./nrmsAgentIdentity.js";

function makeDb(overrides: Record<string, any> = {}) {
  return {
    nrmsAgentAccount: {
      create: vi.fn(async (_a: any) => ({ id: 1 })),
      findMany: vi.fn(async (_a: any) => [] as any[]),
      findUnique: vi.fn(async (_a: any) => null),
      updateMany: vi.fn(async (_a: any) => ({ count: 1 })),
    },
    auditLog: { create: vi.fn(async (_a: any) => ({})) },
    ...overrides,
  };
}

describe("normalizeAgentDocuments", () => {
  it("drops entries with no url and normalises unknown types to OTHER", () => {
    const out = normalizeAgentDocuments([
      { type: "tourism_license", url: " https://x/1 " },
      { type: "weird", url: "https://x/2" },
      { type: "ID", url: "" },
      "nope",
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ type: "TOURISM_LICENSE", url: "https://x/1" });
    expect(out[1]!.type).toBe("OTHER");
    expect(typeof out[0]!.uploadedAt).toBe("string");
  });

  it("returns [] for non-array input", () => {
    expect(normalizeAgentDocuments(null)).toEqual([]);
    expect(normalizeAgentDocuments({ url: "x" })).toEqual([]);
  });
});

describe("createAgentAccount", () => {
  it("creates a PENDING identity with cleaned fields", async () => {
    const db = makeDb();
    const res = await createAgentAccount(db, {
      primaryUserId: 9,
      legalName: "  Kilimanjaro Travel  ",
      contactEmail: "Info@KTravel.CO.TZ",
      countryCode: "tzz",
      documents: [{ type: "TIN_CERTIFICATE", url: "https://d/1" }],
    });
    expect(res).toEqual({ id: 1 });
    const data = db.nrmsAgentAccount.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ primaryUserId: 9, legalName: "Kilimanjaro Travel", contactEmail: "info@ktravel.co.tz", countryCode: "TZ", verificationStatus: "PENDING", status: "ACTIVE" });
    expect(data.documents).toHaveLength(1);
  });
});

describe("findAgencyMatches", () => {
  it("returns [] when nothing distinctive is provided", async () => {
    const db = makeDb();
    expect(await findAgencyMatches(db, {})).toEqual([]);
    expect(db.nrmsAgentAccount.findMany).not.toHaveBeenCalled();
  });

  it("reports which fields matched an existing agency", async () => {
    const db = makeDb({
      nrmsAgentAccount: {
        create: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(),
        findMany: vi.fn(async (_a: any) => [{ id: 5, legalName: "Kili Travel", tradingName: null, registrationNo: "REG123", tin: "TIN999", contactEmail: "a@b.co", verificationStatus: "VERIFIED", status: "ACTIVE" }]),
      },
    });
    const matches = await findAgencyMatches(db, { registrationNo: "REG123", tin: "TINxxx", contactEmail: "A@B.CO" });
    expect(matches).toHaveLength(1);
    expect(matches[0]!.matchedOn.sort()).toEqual(["contactEmail", "registrationNo"]);
    expect(matches[0]!.verificationStatus).toBe("VERIFIED");
  });
});

describe("decideAgentVerification", () => {
  it("verifies a pending agency and writes an audit row", async () => {
    const db = makeDb({
      nrmsAgentAccount: {
        create: vi.fn(), findMany: vi.fn(),
        findUnique: vi.fn(async () => ({ id: 1, verificationStatus: "PENDING" })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    });
    const res = await decideAgentVerification(db, { accountId: 1, adminId: 42, decision: "VERIFIED", note: "docs ok" });
    expect(res).toEqual({ ok: true, status: "VERIFIED" });
    expect(db.nrmsAgentAccount.updateMany.mock.calls[0]![0].data).toMatchObject({ verificationStatus: "VERIFIED", verifiedByAdminId: 42 });
    expect(db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(db.auditLog.create.mock.calls[0]![0].data).toMatchObject({ action: "NRMS_AGENT_VERIFY", entity: "NRMS_AGENT_ACCOUNT", entityId: 1 });
  });

  it("is a NO_CHANGE when the decision already holds", async () => {
    const db = makeDb({
      nrmsAgentAccount: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(async () => ({ id: 1, verificationStatus: "VERIFIED" })) },
    });
    expect(await decideAgentVerification(db, { accountId: 1, adminId: 42, decision: "VERIFIED" })).toMatchObject({ ok: false, reason: "NO_CHANGE" });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for a missing agency", async () => {
    const db = makeDb({ nrmsAgentAccount: { create: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(async () => null) } });
    expect(await decideAgentVerification(db, { accountId: 99, adminId: 42, decision: "REJECTED" })).toMatchObject({ ok: false, reason: "NOT_FOUND" });
  });
});
