import { describe, expect, it } from "vitest";
import {
  buildAcceptanceHash,
  buildAcceptanceHashFromTermsHash,
  buildSalesContractFields,
  finalizeAcceptedSalesContractFields,
  generateSalesContractPdf,
  normalizeLegalName,
  renderSalesContract,
  sha256,
} from "../lib/salesPartnerContract.js";

function fixture(rate = 20) {
  return {
    contract: {
      id: 42,
      contractNumber: "NSC-2026-00042",
      contractVersion: "1.0.0",
      startsAt: new Date("2026-08-01T00:00:00.000Z"),
      expiresAt: new Date("2027-08-01T00:00:00.000Z"),
      nrmsCommissionRate: 14,
      marketplaceRevenueRate: rate,
      territory: "Dar es Salaam and Coast",
    },
    partner: {
      id: 7,
      agentCode: "NSA-DAR-0042",
      region: "Dar es Salaam",
      territory: "Dar es Salaam and Coast",
      user: {
        id: 99,
        name: "Amon Mwakalinga",
        fullName: "Amon Francis Mwakalinga",
        address: "Kinondoni, Dar es Salaam",
        nin: "19900101-12345-00001-01",
      },
    },
    trialDays: 15,
  };
}

describe("sales partner contract evidence", () => {
  it("renders every declared placeholder and preserves the worked example", () => {
    const fields = buildSalesContractFields(fixture());
    const rendered = renderSalesContract(fields);

    expect(rendered).not.toMatch(/\{\{[A-Z0-9_]+\}\}/);
    expect(rendered).toContain("Partner earning:              TSh    17,600");
    expect(rendered).toContain("20% of the eligible net commission");
    expect(rendered).toContain("NSC-2026-00042");
    expect(rendered).not.toMatch(/(^|\n)#{1,6}\s/);
    expect(rendered).not.toContain("**");
    expect(rendered).not.toContain("```");
  });

  it("changes the terms hash when a commercial term changes", () => {
    const first = renderSalesContract(buildSalesContractFields(fixture(20)));
    const second = renderSalesContract(buildSalesContractFields(fixture(21)));
    expect(sha256(first)).not.toBe(sha256(second));
  });

  it("binds acceptance to contract, signer, time, IP and user agent", () => {
    const terms = renderSalesContract(buildSalesContractFields(fixture()));
    const metadata = {
      contractId: 42,
      contractNumber: "NSC-2026-00042",
      partnerId: 7,
      userId: 99,
      acceptedName: "Amon Francis Mwakalinga",
      signedAt: "2026-07-28T09:14:00.000Z",
      ipAddress: "203.0.113.10",
      userAgent: "NoLSAF test",
    };
    const first = buildAcceptanceHash(terms, metadata);
    const second = buildAcceptanceHash(terms, { ...metadata, ipAddress: "203.0.113.11" });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(buildAcceptanceHashFromTermsHash(sha256(terms), metadata)).toBe(first);
  });

  it("normalizes harmless legal-name spacing and case only", () => {
    expect(normalizeLegalName("  AMON   Francis Mwakalinga ")).toBe(
      normalizeLegalName("Amon Francis Mwakalinga"),
    );
    expect(normalizeLegalName("Amon Francis Mwakalinga")).not.toBe(
      normalizeLegalName("Amon Frank Mwakalinga"),
    );
  });

  it("finalizes only countersignature fields from the accepted snapshot", () => {
    const accepted = {
      ...buildSalesContractFields(fixture()),
      termsHash: "terms-before-activation",
    };
    const final = finalizeAcceptedSalesContractFields(accepted, {
      activatedAt: "2026-08-01T10:00:00.000Z",
      signatoryName: "NoLSAF Director",
      signatoryTitle: "Director",
    });

    expect(final.MARKETPLACE_REVENUE_RATE).toBe("20");
    expect(final.PARTNER_ID_NUMBER).toBe("19900101-12345-00001-01");
    expect(final.ACTIVATED_AT).toBe("2026-08-01T10:00:00.000Z");
    expect(final.NOLSAF_SIGNATORY_NAME).toBe("NoLSAF Director");
    expect(final).not.toHaveProperty("termsHash");
  });

  it("generates a real PDF whose bytes can be independently hashed", async () => {
    const body = renderSalesContract(buildSalesContractFields(fixture()));
    const pdf = await generateSalesContractPdf(body);
    const regenerated = await generateSalesContractPdf(body);

    expect(pdf.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(5_000);
    expect(sha256(pdf)).toMatch(/^[a-f0-9]{64}$/);
    expect(regenerated.equals(pdf)).toBe(true);
  });
});
