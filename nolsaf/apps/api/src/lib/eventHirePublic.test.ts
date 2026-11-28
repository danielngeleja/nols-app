import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));

import { isPubliclyHireable, publicEventHireView, publicEventMultiDayEstimates } from "./eventHirePublic.js";

const terms = {
  spaceType: "GARDEN", eventTypes: ["WEDDING", "BIRTHDAY"], description: "Lawn by the lake", capacitySeated: 60, capacityStanding: 100,
  earliestStart: "14:00", latestEnd: "23:00", noiseCutoff: "22:00", halfDayPrice: 500000, fullDayPrice: 800000, eveningPrice: null,
  depositMode: "PERCENT", depositPercent: 25, cleaningFee: 50000, permitNote: "Owner holds the council permit",
  multiDay: { enabled: true, maxDays: 3, off2: 5, off3: 10, off5: 0 },
  allowed: { music: true, alcohol: false }, provided: { chairs: 60, powerBackup: true },
};
const approved = { status: "APPROVED", terms, termsFingerprint: "f1", approvedFingerprint: "f1", extraPhotos: null };
const listing = { photos: ["https://cdn/a.jpg", "https://cdn/b.jpg"], photoAreas: { "https://cdn/a.jpg": "EVENT_SPACE", "https://cdn/b.jpg": "KITCHEN" } };

afterEach(() => { delete process.env.EVENT_HIRE_REQUESTS_ENABLED; });

describe("public event hire", () => {
  it("is hireable only when approved on the terms that were approved", () => {
    expect(isPubliclyHireable(approved)).toBe(true);
    expect(isPubliclyHireable({ ...approved, status: "PAUSED" })).toBe(false);
    expect(isPubliclyHireable({ ...approved, status: "PENDING" })).toBe(false);
    expect(isPubliclyHireable({ ...approved, termsFingerprint: "f2" })).toBe(false);
    expect(isPubliclyHireable({ ...approved, approvedFingerprint: null })).toBe(false);
    expect(isPubliclyHireable(null)).toBe(false);
  });

  it("never offers the whole house", () => {
    expect(isPubliclyHireable({ ...approved, terms: { ...terms, spaceType: "WHOLE_HOUSE" } })).toBe(false);
    expect(publicEventHireView({ ...approved, terms: { ...terms, spaceType: "WHOLE_HOUSE" } }, listing)).toBeNull();
  });

  it("shows client prices and only the event-space photos", () => {
    const v = publicEventHireView(approved, listing)!;
    // Owner price plus the 6% client service fee.
    expect(v.packages).toEqual([
      { key: "HALF_DAY", clientPrice: 530000, deposit: 125000 },
      { key: "FULL_DAY", clientPrice: 848000, deposit: 200000 },
    ]);
    expect(v.fromPrice).toBe(530000);
    expect(v.photos).toEqual(["https://cdn/a.jpg"]);
    expect(v.requestsOpen).toBe(false);
  });

  it("leaves out private and unsold details", () => {
    const v = publicEventHireView(approved, listing) as Record<string, unknown>;
    expect(v).not.toHaveProperty("permitNote");
    expect(v).not.toHaveProperty("multiDay");
    expect(v).not.toHaveProperty("terms");
    expect(JSON.stringify(v)).not.toContain("council permit");
  });

  it("uses approved discounts and the deposit rule for multi-day planning figures", () => {
    expect(publicEventMultiDayEstimates(approved)).toEqual([
      { days: 2, clientPrice: 1611200, undiscountedClientPrice: 1696000, deposit: 380000, discountPercent: 5 },
      { days: 3, clientPrice: 2289600, undiscountedClientPrice: 2544000, deposit: 540000, discountPercent: 10 },
    ]);
    expect(publicEventMultiDayEstimates({ ...approved, termsFingerprint: "changed" })).toEqual([]);
    expect(publicEventMultiDayEstimates({ ...approved, terms: { ...terms, multiDay: { enabled: false } } })).toEqual([]);
  });

  it("applies the five-or-more-day tier to a six-day venue estimate", () => {
    const row = { ...approved, terms: {
      ...terms,
      fullDayPrice: 5000000,
      multiDay: { enabled: true, maxDays: 7, off2: 5, off3: 10, off5: 20 },
    } };
    expect(publicEventMultiDayEstimates(row).find(({ days }) => days === 6)).toEqual({
      days: 6, clientPrice: 25440000, undiscountedClientPrice: 31800000, deposit: 6000000, discountPercent: 20,
    });
  });

  it("says whether requests are open", () => {
    process.env.EVENT_HIRE_REQUESTS_ENABLED = "true";
    expect(publicEventHireView(approved, listing)!.requestsOpen).toBe(true);
  });
});
