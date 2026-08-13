import { describe, expect, it } from "vitest";
import {
  findSalesLeadDuplicateMatches,
  normalizeSalesLeadIdentity,
  normalizeSalesLeadPhone,
  scoreSalesLeadDuplicate,
} from "../lib/salesLeadMatching.js";

const identity = normalizeSalesLeadIdentity({
  propertyName: "The Mlimani Hotel & Spa",
  contactPhone: "+255 712 345 678",
  contactEmail: "OWNER@MLIMANI.EXAMPLE",
  location: "Sinza, Dar es Salaam",
  registrationNumber: "BRELA-2026-42",
  taxNumber: "TIN 123-456-789",
});

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    salesPartnerId: 3,
    propertyNameNormalized: "different property",
    contactPhoneNormalized: null,
    contactEmailNormalized: null,
    locationNormalized: null,
    registrationNumberNormalized: null,
    taxNumberNormalized: null,
    ...overrides,
  } as any;
}

describe("sales lead duplicate matching", () => {
  it("normalizes Tanzanian phone variants to one indexed value", () => {
    expect(normalizeSalesLeadPhone("0712 345 678")).toBe("255712345678");
    expect(normalizeSalesLeadPhone("+255-712-345-678")).toBe("255712345678");
    expect(normalizeSalesLeadPhone("712345678")).toBe("255712345678");
  });

  it("normalizes names, emails, locations and identifiers without changing display input", () => {
    expect(identity).toEqual({
      propertyNameNormalized: "the mlimani hotel and spa",
      contactPhoneNormalized: "255712345678",
      contactEmailNormalized: "owner@mlimani.example",
      locationNormalized: "sinza dar es salaam",
      registrationNumberNormalized: "BRELA202642",
      taxNumberNormalized: "TIN123456789",
    });
  });

  it("treats a strong identifier as a possible duplicate", () => {
    const match = scoreSalesLeadDuplicate(
      identity,
      candidate({ registrationNumberNormalized: "BRELA202642" }),
    );
    expect(match).toMatchObject({
      leadId: 8,
      score: 6,
      matchedFields: ["registrationNumber"],
    });
  });

  it("does not warn on a generic property-name match alone", () => {
    expect(
      scoreSalesLeadDuplicate(
        identity,
        candidate({ propertyNameNormalized: identity.propertyNameNormalized }),
      ),
    ).toBeNull();
  });

  it("warns on name plus location and sorts strongest candidates first", () => {
    const matches = findSalesLeadDuplicateMatches(identity, [
      candidate({
        id: 9,
        propertyNameNormalized: identity.propertyNameNormalized,
        locationNormalized: identity.locationNormalized,
      }),
      candidate({
        id: 10,
        contactPhoneNormalized: identity.contactPhoneNormalized,
        contactEmailNormalized: identity.contactEmailNormalized,
      }),
    ]);
    expect(matches.map((match) => match.leadId)).toEqual([10, 9]);
    expect(matches[1].matchedFields).toEqual(["propertyName", "location"]);
  });
});
