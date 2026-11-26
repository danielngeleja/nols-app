import { describe, expect, it } from "vitest";
import { rentTermsFingerprint, rentTermsLines, rentTermsSummary } from "./ownerRentTerms.js";
import { rentConfirmSmsText } from "../salesAssistedListing.js";

const base = {
  monthlyRent: "500000.00",
  currency: "TZS",
  minTermMonths: 6,
  maxTermMonths: 12,
  upfrontMonths: 2,
  securityDepositMonths: 1,
  noticePeriodDays: 30,
  furnished: "FURNISHED",
  utilities: { water: "TENANT", electricity: "TENANT" },
  discounts: { m6: 0, m12: 5 },
};

describe("owner rent terms", () => {
  it("summarises the money terms in plain words", () => {
    expect(rentTermsSummary(base)).toBe("TSh 500,000 a month, 6 to 12 months, 2 months upfront");
    expect(rentTermsSummary({ ...base, currency: "USD", monthlyRent: 1200, maxTermMonths: null, minTermMonths: 12, upfrontMonths: 1 }))
      .toBe("USD 1,200 a month, 12 months or more, 1 month upfront");
  });

  it("lists each term for the owner's page", () => {
    const lines = rentTermsLines(base);
    expect(lines[0]).toEqual({ label: "Monthly rent", value: "TSh 500,000" });
    expect(lines.find((l) => l.label === "Security deposit")?.value).toBe("1 month, kept by you");
    expect(lines.find((l) => l.label === "Discounts")?.value).toBe("5% off for 12 months");
  });

  it("changes the fingerprint when any money term changes, not when JSON key order does", () => {
    const fp = rentTermsFingerprint(base);
    expect(rentTermsFingerprint({ ...base, utilities: { electricity: "TENANT", water: "TENANT" } })).toBe(fp);
    expect(rentTermsFingerprint({ ...base, monthlyRent: "500000" })).toBe(fp);
    expect(rentTermsFingerprint({ ...base, monthlyRent: "450000" })).not.toBe(fp);
    expect(rentTermsFingerprint({ ...base, upfrontMonths: 3 })).not.toBe(fp);
    expect(rentTermsFingerprint({ ...base, securityDepositMonths: 2 })).not.toBe(fp);
    expect(rentTermsFingerprint({ ...base, discounts: JSON.stringify({ m6: 0, m12: 10 }) })).not.toBe(fp);
    expect(rentTermsFingerprint({ ...base, discounts: JSON.stringify({ m6: 0, m12: 5 }) })).toBe(fp);
  });

  it("puts the rent and the link in the owner SMS", () => {
    const text = rentConfirmSmsText({ ownerName: "Juma Ali", partnerName: "Neema", propertyName: "Jameson Apartment", summary: rentTermsSummary(base), link: "https://www.nolsaf.com/listing-notice/x" });
    expect(text).toContain("Habari Juma.");
    expect(text).toContain("TSh 500,000 a month");
    expect(text).toContain("https://www.nolsaf.com/listing-notice/x");
    expect(text).not.toContain("—");
  });
});
