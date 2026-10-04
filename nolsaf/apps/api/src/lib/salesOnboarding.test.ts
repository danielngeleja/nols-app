import { describe, expect, it } from "vitest";
import { buildOnboarding, type OnboardingInput } from "./salesOnboarding.js";

const d = (s: string) => new Date(s);

function input(overrides: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    propertyStatus: "APPROVED",
    nrmsActivatedAt: null,
    attributions: [{ productType: "NRMS", status: "VERIFIED", verifiedAt: d("2026-09-01T10:00:00Z"), commissionStartsAt: null }],
    siteVerified: false,
    siteVerifiedAt: null,
    firstNrmsBillPaidAt: null,
    firstBookingAt: null,
    firstCommissionAt: null,
    ...overrides,
  };
}

describe("sales onboarding tracker", () => {
  it("follows the NRMS path and points at the first unfinished stage with advice", () => {
    const result = buildOnboarding(input());
    expect(result.stages.map((s) => s.key)).toEqual([
      "CONVERTED",
      "LISTING_APPROVED",
      "SITE_VERIFIED",
      "EARNING_ACTIVE",
      "NRMS_ACTIVATED",
      "FIRST_NRMS_BILL_PAID",
      "FIRST_COMMISSION",
    ]);
    expect(result.completed).toBe(2);
    expect(result.current).toBe("SITE_VERIFIED");
    const current = result.stages.find((s) => s.key === "SITE_VERIFIED")!;
    expect(current.state).toBe("CURRENT");
    expect(current.hint).toMatch(/site visit/i);
    expect(result.stages.find((s) => s.key === "EARNING_ACTIVE")!.state).toBe("UPCOMING");
    expect(result.stages[0].at).toBe("2026-09-01T10:00:00.000Z");
  });

  it("shows a first booking stage for marketplace and both paths for a combined deal", () => {
    const marketplace = buildOnboarding(input({ attributions: [{ productType: "MARKETPLACE", status: "VERIFIED", verifiedAt: d("2026-09-01"), commissionStartsAt: null }] }));
    expect(marketplace.stages.map((s) => s.key)).toContain("FIRST_BOOKING");
    expect(marketplace.stages.map((s) => s.key)).not.toContain("NRMS_ACTIVATED");

    const both = buildOnboarding(input({
      attributions: [
        { productType: "NRMS", status: "VERIFIED", verifiedAt: d("2026-09-01"), commissionStartsAt: null },
        { productType: "MARKETPLACE", status: "VERIFIED", verifiedAt: d("2026-09-02"), commissionStartsAt: null },
      ],
    }));
    expect(both.stages.map((s) => s.key)).toEqual(expect.arrayContaining(["NRMS_ACTIVATED", "FIRST_NRMS_BILL_PAID", "FIRST_BOOKING"]));
    expect(both.stages[0].at).toBe(d("2026-09-01").toISOString());
  });

  it("marks a rejected or suspended listing as blocked with what to do", () => {
    const rejected = buildOnboarding(input({ propertyStatus: "REJECTED" }));
    const listing = rejected.stages.find((s) => s.key === "LISTING_APPROVED")!;
    expect(listing.state).toBe("BLOCKED");
    expect(listing.hint).toMatch(/rejected/i);
    expect(rejected.blocked).toBe(true);

    const suspended = buildOnboarding(input({ propertyStatus: "SUSPENDED" }));
    expect(suspended.stages.find((s) => s.key === "LISTING_APPROVED")!.hint).toMatch(/suspended/i);
  });

  it("counts a site verification without a date as done", () => {
    const result = buildOnboarding(input({ siteVerified: true, siteVerifiedAt: null }));
    const stage = result.stages.find((s) => s.key === "SITE_VERIFIED")!;
    expect(stage.state).toBe("DONE");
    expect(stage.at).toBeNull();
  });

  it("is complete once the first commission lands", () => {
    const result = buildOnboarding(input({
      attributions: [{ productType: "NRMS", status: "ACTIVE", verifiedAt: d("2026-08-01"), commissionStartsAt: d("2026-08-02") }],
      siteVerified: true,
      siteVerifiedAt: d("2026-08-05"),
      nrmsActivatedAt: d("2026-08-06"),
      firstNrmsBillPaidAt: d("2026-09-01"),
      firstCommissionAt: d("2026-09-01"),
    }));
    expect(result.current).toBeNull();
    expect(result.completed).toBe(result.total);
    expect(result.stages.every((s) => s.hint === null)).toBe(true);
  });
});
