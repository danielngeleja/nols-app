import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accrueInspectionFee, assignInspection, CHECKLIST, checkReport, endInspectionAfterDispute, evaluatePosition, inspectionCurrent,
  inspectionRefusal, isInspectionRef, newInspectionRef, partnerConflict, publicInspectionView, requestInspection, reviewInspection, submitInspection,
} from "./inspection.js";
import { checkVisitSlot, createEnquiry } from "./enquiry.js";

const NOW = new Date("2026-11-21T08:00:00Z");
const TODAY = "2026-11-21";
const allPass = Object.fromEntries(CHECKLIST.map((c) => [c.key, "PASS"])) as Record<string, "PASS" | "FAIL" | "NA">;
const report = { latitude: -6.7924, longitude: 39.2083, accuracyMeters: 12, capturedAt: "2026-11-21T07:30:00Z", checklist: allPass, recommendation: "PASS" as const, note: "Home matches the listing, all rooms seen." };
const photos = [1, 2, 3, 4].map((n) => ({ publicId: `sales-visits/7/p${n}`, hash: `h${n}`, bytes: 1000 }));

function fakeDb(over: Record<string, any> = {}) {
  return {
    property: { findUnique: vi.fn(async () => ({ ownerId: 3, latitude: -6.7925, longitude: 39.2084 })), findFirst: vi.fn() },
    propertySalesAttribution: { findFirst: vi.fn(async () => null) },
    longStayInspection: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    systemSetting: { findUnique: vi.fn(async () => ({ longStayInspectionFee: 25000 })) },
    salesPartnerContract: { findMany: vi.fn(async () => [{ id: 4, status: "ACTIVE", startsAt: new Date("2026-01-01"), expiresAt: new Date("2027-12-31") }]) },
    salesCommission: { create: vi.fn() },
    longStayEnquiry: { count: vi.fn(async () => 0), create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })) },
    ...over,
  } as any;
}

beforeEach(() => { process.env.LONG_STAY_OPEN = "1"; });
afterEach(() => { delete process.env.LONG_STAY_OPEN; });

describe("references and validity", () => {
  it("uses random li_ references", () => {
    expect(isInspectionRef(newInspectionRef())).toBe(true);
    expect(isInspectionRef("li_1")).toBe(false);
  });

  it("counts only a passed inspection that has not run out", async () => {
    expect(inspectionCurrent({ status: "PASSED", validUntil: new Date("2027-11-21T00:00:00Z") }, TODAY)).toBe(true);
    expect(inspectionCurrent({ status: "PASSED", validUntil: new Date("2026-11-20T00:00:00Z") }, TODAY)).toBe(false);
    expect(inspectionCurrent({ status: "FAILED", validUntil: null }, TODAY)).toBe(false);
    expect(await inspectionRefusal(fakeDb(), 9, TODAY)).toMatch(/must inspect/);
    const expired = fakeDb({ longStayInspection: { findFirst: vi.fn(async () => ({ status: "PASSED", validUntil: new Date("2026-01-01T00:00:00Z") })) } });
    expect(await inspectionRefusal(expired, 9, TODAY)).toMatch(/run out/);
    expect(publicInspectionView({ status: "PASSED", validUntil: new Date("2027-11-21T00:00:00Z"), reviewedAt: new Date("2026-11-21T10:00:00Z") }, TODAY)).toEqual({ inspectedOn: "2026-11-21", validUntil: "2027-11-21" });
  });

  it("opens one request per home at a time", async () => {
    const db = fakeDb();
    expect((await requestInspection(db, 9, "FIRST")).created).toBe(true);
    db.longStayInspection.findFirst = vi.fn(async () => ({ id: 1, status: "ASSIGNED" }));
    expect((await requestInspection(db, 9, "YEARLY")).created).toBe(false);
  });
});

describe("assigning a partner", () => {
  it("refuses the owner and the partner who brought the home in", async () => {
    expect(await partnerConflict(fakeDb(), { id: 7, userId: 3 }, 9)).toMatch(/own home/);
    expect(await partnerConflict(fakeDb({ propertySalesAttribution: { findFirst: vi.fn(async () => ({ id: 1 })) } }), { id: 7, userId: 50 }, 9)).toMatch(/brought the home/);
    expect(await partnerConflict(fakeDb(), { id: 7, userId: 50 }, 9)).toBeNull();
  });

  it("gives the partner 5 days, and only while waiting", async () => {
    const db = fakeDb();
    await assignInspection(db, { id: 1, propertyId: 9, status: "REQUESTED" }, { id: 7, userId: 50 }, 1, NOW);
    expect(db.longStayInspection.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ASSIGNED", salesPartnerId: 7, dueBy: new Date("2026-11-26T08:00:00Z") });
    await expect(assignInspection(db, { id: 1, propertyId: 9, status: "SUBMITTED" }, { id: 7, userId: 50 }, 1, NOW)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the partner's report", () => {
  it("needs every checklist item, and cannot pass with a required item missed", () => {
    expect(() => checkReport({ ...report, checklist: { WATER: "PASS" } }, NOW)).toThrow(/every item/);
    expect(() => checkReport({ ...report, checklist: { ...allPass, WATER: "FAIL" } }, NOW)).toThrow(/required item/);
    expect(checkReport({ ...report, checklist: { ...allPass, WATER: "FAIL" }, recommendation: "FAIL" }, NOW).failedRequired).toEqual(["WATER"]);
    expect(checkReport({ ...report, checklist: { ...allPass, ACCESS: "FAIL" } }, NOW).failedRequired).toEqual([]);
    expect(() => checkReport({ ...report, capturedAt: "2026-11-18T07:00:00Z" }, NOW)).toThrow(/48 hours/);
    expect(() => checkReport({ ...report, capturedAt: "2026-11-21T09:00:00Z" }, NOW)).toThrow(/future/);
  });

  it("works out the distance from the pin and the warning signs on the server", () => {
    expect(evaluatePosition(report, { latitude: -6.7925, longitude: 39.2084 }, NOW)).toEqual({ distanceMeters: 16, flags: [] });
    expect(evaluatePosition(report, { latitude: -6.8, longitude: 39.2083 }, NOW).flags).toContain("FAR_FROM_PIN");
    expect(evaluatePosition({ ...report, accuracyMeters: 400 }, null, NOW).flags).toEqual(["NO_PIN", "LOW_ACCURACY"]);
  });

  it("is sent only by the assigned partner, with 4 to 12 different photos, and flags reused ones", async () => {
    const db = fakeDb();
    const assigned = { id: 1, propertyId: 9, status: "ASSIGNED", salesPartnerId: 7 };
    await expect(submitInspection(db, { ...assigned, salesPartnerId: 8 }, 7, report, photos, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(submitInspection(db, assigned, 7, report, photos.slice(0, 3), NOW)).rejects.toThrow(/4 to 12/);
    await expect(submitInspection(db, assigned, 7, report, [...photos.slice(0, 3), { ...photos[0] }], NOW)).rejects.toThrow(/different/);
    db.longStayInspection.findMany = vi.fn(async () => [{ photos: [{ hash: "h2" }] }]);
    const out = await submitInspection(db, assigned, 7, report, photos, NOW);
    expect(out.flags).toContain("DUPLICATE_PHOTO");
    expect(db.longStayInspection.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 1, status: "ASSIGNED", salesPartnerId: 7 }, data: { status: "SUBMITTED", distanceMeters: 16 } });
  });
});

describe("NoLSAF's decision", () => {
  const submitted = { id: 1, propertyId: 9, status: "SUBMITTED", salesPartnerId: 7, recommendation: "PASS", flags: [] };

  it("passes for a year and pays the partner the flat fee once", async () => {
    const db = fakeDb();
    const result = await reviewInspection(db, submitted, 1, "PASS", "Report checked", TODAY, NOW);
    expect(result).toMatchObject({ status: "PASSED", feeAmount: 25000 });
    expect(db.longStayInspection.updateMany.mock.calls[0][0].data).toMatchObject({ status: "PASSED", validUntil: new Date("2027-11-21T00:00:00Z"), feeAmount: 25000 });
    expect(db.salesCommission.create.mock.calls[0][0].data).toMatchObject({ type: "LONG_STAY_INSPECTION", sourceKey: "LONG_STAY_INSPECTION:1", commissionAmount: 25000, status: "ELIGIBLE", contractId: 4 });
  });

  it("pays for a fail too, but not for a redo, so passing a bad home earns nothing extra", async () => {
    const fail = fakeDb();
    expect((await reviewInspection(fail, { ...submitted, recommendation: "FAIL" }, 1, "FAIL", "Water not working", TODAY, NOW)).status).toBe("FAILED");
    expect(fail.salesCommission.create).toHaveBeenCalled();
    const redo = fakeDb();
    expect((await reviewInspection(redo, submitted, 1, "REDO", "Photos too dark", TODAY, NOW)).status).toBe("ASSIGNED");
    expect(redo.salesCommission.create).not.toHaveBeenCalled();
  });

  it("will not pass a report far from the pin, with reused photos, or recommended FAIL", async () => {
    await expect(reviewInspection(fakeDb(), { ...submitted, flags: ["FAR_FROM_PIN"] }, 1, "PASS", "ok then", TODAY, NOW)).rejects.toThrow(/FAR_FROM_PIN/);
    await expect(reviewInspection(fakeDb(), { ...submitted, flags: ["DUPLICATE_PHOTO"] }, 1, "PASS", "ok then", TODAY, NOW)).rejects.toThrow(/DUPLICATE_PHOTO/);
    await expect(reviewInspection(fakeDb(), { ...submitted, recommendation: "FAIL" }, 1, "PASS", "ok then", TODAY, NOW)).rejects.toThrow(/recommended FAIL/);
    await expect(reviewInspection(fakeDb(), { ...submitted, status: "PASSED" }, 1, "PASS", "ok then", TODAY, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("pays nothing without an earning contract, and never twice", async () => {
    const none = fakeDb({ salesPartnerContract: { findMany: vi.fn(async () => []) } });
    expect(await accrueInspectionFee(none, submitted, 25000, NOW)).toEqual({ created: false, reason: "NO_EARNING_CONTRACT" });
    const twice = fakeDb({ salesCommission: { create: vi.fn(async () => { throw Object.assign(new Error("dup"), { code: "P2002" }); }) } });
    expect(await accrueInspectionFee(twice, submitted, 25000, NOW)).toEqual({ created: false, reason: "ALREADY_ACCRUED" });
  });

  it("an upheld dispute ends the inspection at once and opens a new one", async () => {
    const db = fakeDb();
    await endInspectionAfterDispute(db, 9, TODAY);
    expect(db.longStayInspection.updateMany.mock.calls[0][0].data).toEqual({ validUntil: new Date("2026-11-20T00:00:00Z") });
    expect(db.longStayInspection.create.mock.calls[0][0].data).toMatchObject({ reason: "AFTER_DISPUTE", status: "REQUESTED" });
  });
});

describe("Ask NoLSAF", () => {
  const home = { id: 9, ownerId: 3, type: "APARTMENT", title: "Sea View Flats" };
  const input = { userId: 20, propertyKey: "abcdefghijklmnopqrstu", kind: "QUESTION" as const, text: "Is parking included? Call me 0712 345 678" };

  it("goes to NoLSAF with contacts hidden", async () => {
    const db = fakeDb({ property: { findFirst: vi.fn(async () => home) } });
    const { enquiry } = await createEnquiry(db, input, NOW);
    expect(enquiry.publicRef).toMatch(/^le_/);
    expect(enquiry.text).not.toContain("0712");
  });

  it("needs visit times for a visit, and refuses the owner and too many open questions", async () => {
    const db = fakeDb({ property: { findFirst: vi.fn(async () => home) } });
    await expect(createEnquiry(db, { ...input, kind: "VISIT" }, NOW)).rejects.toThrow(/times/);
    expect(() => checkVisitSlot("2026-11-21T09:00:00Z", NOW)).toThrow(/4 hours/);
    await expect(createEnquiry(db, { ...input, userId: 3 }, NOW)).rejects.toMatchObject({ status: 403 });
    db.longStayEnquiry.count = vi.fn(async () => 5);
    await expect(createEnquiry(db, input, NOW)).rejects.toMatchObject({ status: 429 });
  });
});
