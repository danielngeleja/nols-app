import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => { process.env.LONG_STAY_ID_HASH_SECRET = "test-secret"; });

import {
  ageOn, canReplaceApprovedId, hashIdNumber, isIsoCountry, nameAgreement, normalizeIdNumber, prepareIdentity,
  requiredPhotoSides, TenantIdentityError, tenantIdentityView, tenantPaymentRefusal,
} from "./tenantIdentity.js";

const NOW = new Date("2026-11-21T09:00:00Z");
const photo = (name: string) => ({
  publicId: `traveller-documents/long-stay-id/${name}`,
  resourceType: "image",
  url: `https://res.cloudinary.com/demo/image/authenticated/v1/traveller-documents/long-stay-id/${name}.jpg`,
});
const nida = {
  idType: "NATIONAL_ID",
  idCountry: "TZ",
  idNumber: "19900101-12345-00001-12",
  holderName: "Joseph Kimaro",
  dateOfBirth: "1990-01-01",
  expiresOn: "2030-01-01",
  front: photo("front"),
  back: photo("back"),
  selfie: photo("selfie"),
};
const passport = {
  idType: "PASSPORT",
  idCountry: "GB",
  nationality: "GB",
  idNumber: "123456789",
  holderName: "Amina Mushi",
  dateOfBirth: "1994-05-10",
  expiresOn: "2031-08-14",
  front: photo("page"),
  selfie: photo("me"),
};

describe("countries", () => {
  it("accepts ISO 3166-1 alpha-2 codes only", () => {
    for (const code of ["TZ", "KE", "GB", "US", "CN", "XK"]) expect(isIsoCountry(code), code).toBe(true);
    for (const code of ["EU", "UN", "ZZ", "QO", "FQ", "ZR", "CS", "AN", "tz", "TZA", "AA", ""]) expect(isIsoCountry(code), code).toBe(false);
  });
});

describe("normalizeIdNumber", () => {
  it("checks each document's own format", () => {
    expect(normalizeIdNumber("NATIONAL_ID", "TZ", "19900101-12345-00001-12")).toBe("19900101123450000112");
    expect(normalizeIdNumber("NATIONAL_ID", "KE", "12345678")).toBe("12345678");
    expect(normalizeIdNumber("NATIONAL_ID", "UG", "cm 1234567890ab")).toBe("CM1234567890AB");
    expect(normalizeIdNumber("NATIONAL_ID", "RW", "1199080012345678")).toBe("1199080012345678");
    expect(normalizeIdNumber("PASSPORT", "TZ", "ab 123 4567")).toBe("AB1234567");
    expect(normalizeIdNumber("RES_PERMIT", "TZ", "RP-0012345")).toBe("RP0012345");
  });

  it("refuses anything else", () => {
    const bad: Array<[any, string, string]> = [
      ["NATIONAL_ID", "TZ", "1234"], ["NATIONAL_ID", "TZ", "1990010112345000011A"], ["NATIONAL_ID", "KE", "12345"],
      ["NATIONAL_ID", "UG", "AB1234567890AB"], ["NATIONAL_ID", "GB", "123456789"],
      ["PASSPORT", "GB", "AB12"], ["PASSPORT", "GB", "AB-123-4567-99"], ["PASSPORT", "GB", "AB12345<>"], ["PASSPORT", "GB", "ABCDEFGH"],
      ["RES_PERMIT", "TZ", "12"],
    ];
    for (const [type, country, raw] of bad) expect(() => normalizeIdNumber(type, country, raw), `${country} ${raw}`).toThrow(TenantIdentityError);
  });
});

describe("prepareIdentity", () => {
  it("keeps only a hash and the last 4 of the number, plus the printed details", () => {
    const prepared = prepareIdentity(nida, NOW);
    expect(prepared).toMatchObject({ idType: "NATIONAL_ID", idCountry: "TZ", nationality: "TZ", idNumberLast4: "0112", holderName: "Joseph Kimaro" });
    expect(prepared.idNumberHash).toBe(hashIdNumber("NATIONAL_ID", "TZ", "19900101123450000112"));
    expect(JSON.stringify(prepared)).not.toContain("19900101123450000112");
    expect(prepared.idExpiresOn.toISOString().slice(0, 10)).toBe("2030-01-01");
  });

  it("gives the same hash however the number is typed", () => {
    expect(prepareIdentity({ ...nida, idNumber: "19900101123450000112" }, NOW).idNumberHash).toBe(prepareIdentity(nida, NOW).idNumberHash);
  });

  it("takes a passport from any country, with no back photo", () => {
    const prepared = prepareIdentity(passport, NOW);
    expect(prepared).toMatchObject({ idType: "PASSPORT", idCountry: "GB", nationality: "GB", back: null });
    expect(() => prepareIdentity({ ...passport, idCountry: null }, NOW)).toThrow(/country/);
    expect(() => prepareIdentity({ ...passport, idCountry: "EU" }, NOW)).toThrow(/country/);
  });

  it("needs the back of a card and three different photos", () => {
    expect(() => prepareIdentity({ ...nida, back: null }, NOW)).toThrow(/back/);
    expect(() => prepareIdentity({ ...nida, selfie: photo("front") }, NOW)).toThrow(/different/);
    expect(() => prepareIdentity({ ...nida, selfie: undefined }, NOW)).toThrow(/selfie/);
  });

  it("refuses an expired or nearly expired document", () => {
    expect(() => prepareIdentity({ ...nida, expiresOn: "2026-11-21" }, NOW)).toThrow(/expired/);
    expect(() => prepareIdentity({ ...nida, expiresOn: "2026-12-10" }, NOW)).toThrow(/within 30 days/);
    expect(prepareIdentity({ ...nida, expiresOn: "2026-12-31" }, NOW).idType).toBe("NATIONAL_ID");
  });

  it("needs an adult with a believable date of birth", () => {
    expect(() => prepareIdentity({ ...nida, dateOfBirth: "2009-01-01" }, NOW)).toThrow(/18 or older/);
    expect(prepareIdentity({ ...nida, dateOfBirth: "2008-11-21" }, NOW).idType).toBe("NATIONAL_ID");
    expect(() => prepareIdentity({ ...nida, dateOfBirth: "2008-11-22" }, NOW)).toThrow(/18 or older/);
    expect(() => prepareIdentity({ ...nida, dateOfBirth: "1890-01-01" }, NOW)).toThrow(/date of birth/);
    expect(() => prepareIdentity({ ...nida, dateOfBirth: "1990-02-30" }, NOW)).toThrow(/date of birth/);
  });

  it("keeps national IDs to their own citizens and permits to foreigners", () => {
    expect(() => prepareIdentity({ ...nida, nationality: "KE" }, NOW)).toThrow(/citizen/);
    expect(() => prepareIdentity({ ...nida, idCountry: "GB", idNumber: "123456789" }, NOW)).toThrow(/passport/);
    const permit = { ...nida, idType: "RES_PERMIT", idCountry: null, nationality: "IN", idNumber: "RP0012345" };
    expect(prepareIdentity(permit, NOW)).toMatchObject({ idCountry: "TZ", nationality: "IN" });
    expect(() => prepareIdentity({ ...permit, nationality: "TZ" }, NOW)).toThrow(/NIDA/);
    expect(() => prepareIdentity({ ...permit, nationality: null }, NOW)).toThrow(/nationality/);
  });

  it("refuses a name that is not letters", () => {
    expect(prepareIdentity({ ...nida, holderName: "  O'Neil   Mary-Ann  " }, NOW).holderName).toBe("O'Neil Mary-Ann");
    expect(prepareIdentity({ ...nida, holderName: "Zoë Müller" }, NOW).holderName).toBe("Zoë Müller");
    expect(() => prepareIdentity({ ...nida, holderName: "<script>" }, NOW)).toThrow(/letters/);
    expect(() => prepareIdentity({ ...nida, holderName: "1234" }, NOW)).toThrow(/letters/);
  });

  it("refuses a public or foreign upload and unknown fields", () => {
    for (const publicId of ["uploads/abc", "traveller-documents/other/abc", "traveller-documents/long-stay-id/../x"]) {
      expect(() => prepareIdentity({ ...nida, front: { ...nida.front, publicId } }, NOW), publicId).toThrow(TenantIdentityError);
    }
    expect(() => prepareIdentity({ ...nida, extra: true }, NOW)).toThrow(TenantIdentityError);
  });
});

describe("ages, names and photos", () => {
  it("counts whole years", () => {
    expect(ageOn("2000-02-29", "2018-02-28")).toBe(17);
    expect(ageOn("2000-02-29", "2018-03-01")).toBe(18);
  });

  it("compares the printed name with the account", () => {
    expect(nameAgreement("MUSHI, AMINA", "Amina Mushi")).toBe("MATCH");
    expect(nameAgreement("Amina Rehema Mushi", "Amina Mushi")).toBe("MATCH");
    expect(nameAgreement("Amina Juma", "Amina Mushi")).toBe("PARTIAL");
    expect(nameAgreement("Peter Otieno", "Amina Mushi")).toBe("DIFFERENT");
    expect(nameAgreement("José Núñez", "Jose Nunez")).toBe("MATCH");
    expect(nameAgreement(null, "Amina")).toBe("UNKNOWN");
  });

  it("lists the photos a reviewer must open", () => {
    expect(requiredPhotoSides({ documentId: 1, documentBackId: 2, selfieDocumentId: 3 })).toEqual(["front", "back", "selfie"]);
    expect(requiredPhotoSides({ documentId: 1, documentBackId: null, selfieDocumentId: 3 })).toEqual(["front", "selfie"]);
  });
});

describe("tenantIdentityView", () => {
  it("never exposes the hash and shows the reject reason only when rejected", () => {
    const view = tenantIdentityView({ status: "PENDING", idType: "NATIONAL_ID", idNumberLast4: "0112", idNumberHash: "secret", rejectReason: "old" }, true, NOW);
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(view.rejectReason).toBeNull();
    expect(tenantIdentityView({ status: "REJECTED", rejectReason: "Blurry photo" }, true, NOW).rejectReason).toBe("Blurry photo");
  });

  it("flags an approved ID near expiry, which may then be replaced", () => {
    const soon = { status: "APPROVED", idExpiresOn: new Date("2027-01-10T00:00:00Z") };
    const later = { status: "APPROVED", idExpiresOn: new Date("2028-01-10T00:00:00Z") };
    expect(tenantIdentityView(soon, true, NOW).expiring).toBe(true);
    expect(tenantIdentityView(later, true, NOW).expiring).toBe(false);
    expect(canReplaceApprovedId(soon, NOW)).toBe(true);
    expect(canReplaceApprovedId(later, NOW)).toBe(false);
  });
});

describe("tenantPaymentRefusal", () => {
  it("lets only an approved, unbarred tenant with a valid ID pay", () => {
    expect(tenantPaymentRefusal(null)).toMatch(/Verify your ID/);
    expect(tenantPaymentRefusal({ status: "PENDING" })).toMatch(/still checking/);
    expect(tenantPaymentRefusal({ status: "REJECTED" })).toMatch(/not approved/);
    expect(tenantPaymentRefusal({ status: "APPROVED", barredAt: new Date() })).toMatch(/cannot book/);
    expect(tenantPaymentRefusal({ status: "APPROVED", barredAt: null })).toBeNull();
  });

  it("needs the ID to last until the lease ends", () => {
    const profile = { status: "APPROVED", barredAt: null, idExpiresOn: new Date("2027-06-30T00:00:00Z") };
    expect(tenantPaymentRefusal(profile, new Date("2027-05-31T00:00:00Z"), NOW)).toBeNull();
    expect(tenantPaymentRefusal(profile, new Date("2027-12-31T00:00:00Z"), NOW)).toMatch(/before this lease ends/);
    expect(tenantPaymentRefusal(profile, null, new Date("2027-07-01T09:00:00Z"))).toMatch(/expired/);
  });
});
