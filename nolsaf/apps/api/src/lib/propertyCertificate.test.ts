import { describe, expect, it, vi } from "vitest";

vi.mock("./publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-certificate-secret" }));

import {
  certificateChecklist,
  certificateFingerprint,
  certificateLocation,
  certificateReference,
  isValidCertificateReference,
  reviewerCode,
} from "./propertyCertificate.js";

describe("property certificate", () => {
  it("never prints the row id and cannot be walked forward", () => {
    const a = certificateReference(33, 7);
    const b = certificateReference(34, 7);
    expect(a).toMatch(/^NLS-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]$/);
    expect(a).not.toContain("33");
    expect(a).not.toBe(b);
    expect(certificateReference(33, 7)).toBe(a);
  });

  it("catches a mistyped reference with the check character", () => {
    const ref = certificateReference(33, 7);
    expect(isValidCertificateReference(ref)).toBe(true);
    const body = ref.slice(4, 8);
    const swapped = body[1] + body[0] + body.slice(2);
    if (swapped !== body) expect(isValidCertificateReference(ref.replace(body, swapped))).toBe(false);
  });

  it("names the team, never the staff member", () => {
    expect(reviewerCode(12)).toMatch(/^R-[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(reviewerCode(null)).toBeNull();
  });

  it("hides the street of a private home but keeps a hotel's address", () => {
    const home = certificateLocation({ type: "BUNGALOW", street: "Kivukoni", ward: "Kivukoni", district: "Ilala CBD", regionName: "Dar es Salaam" });
    expect(home).toBe("Ilala CBD, Dar es Salaam, Tanzania");
    const hotel = certificateLocation({ type: "HOTEL", street: "Kivukoni", ward: "Kivukoni", district: "Ilala CBD", regionName: "Dar es Salaam" });
    expect(hotel).toBe("Kivukoni, Ilala CBD, Dar es Salaam, Tanzania");
  });

  it("lists the site visit the method claims", () => {
    expect(certificateChecklist(["Host listing approved"], "Site visit and listing review")[0]).toBe("Site visited by NoLSAF");
    expect(certificateChecklist(["Site visited"], "Site visit and listing review")).toEqual(["Site visited"]);
  });

  it("changes the fingerprint when any printed field changes", () => {
    const base = { reference: "NLS-AAAA-BBBB-C", title: "NoLSAF Villa", verifiedAt: "2026-10-23" };
    expect(certificateFingerprint(base)).toMatch(/^[0-9A-F]{4}( [0-9A-F]{4}){3}$/);
    expect(certificateFingerprint({ ...base, title: "Other Villa" })).not.toBe(certificateFingerprint(base));
    expect(certificateFingerprint({ verifiedAt: "2026-10-23", reference: "NLS-AAAA-BBBB-C", title: "NoLSAF Villa" })).toBe(certificateFingerprint(base));
  });
});
