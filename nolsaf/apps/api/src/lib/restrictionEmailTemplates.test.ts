import { describe, expect, it } from "vitest";
import {
  getRestrictionNoticeEmail,
  getRestrictionResolvedEmail,
  type RestrictionEmailScope,
} from "./restrictionEmailTemplates.js";

const scopes: RestrictionEmailScope[] = [
  "MARKETPLACE_PROPERTY",
  "NRMS_ENROLLMENT",
  "NRMS_PROPERTY",
  "NRMS_QR_ORDERING",
];

describe("restriction email templates", () => {
  it.each(scopes)("renders the branded appeal notice for %s", (scope) => {
    const referenceCode = `NLS-TEST-${scope}`;
    const email = getRestrictionNoticeEmail({
      ownerName: "Amina & Daniel",
      referenceCode,
      scope,
      targetName: "Namibia <Villa>",
      reason: "Safety review & verification",
      effectiveAt: new Date("2026-07-19T08:30:00.000Z"),
    });

    expect(email.subject).toContain(referenceCode);
    expect(email.html).toContain("NoLSAF");
    expect(email.html).toContain("Appeal and support reference");
    expect(email.html).toContain(referenceCode);
    expect(email.html).toContain("partners@nolsaf.com");
    expect(email.html).toContain("Amina &amp; Daniel");
    expect(email.html).toContain("Namibia &lt;Villa&gt;");
    expect(email.html).not.toContain("Namibia <Villa>");
  });

  it("renders a resolution notice with the same case reference", () => {
    const referenceCode = "NLS-NRP-42-20260719-A1B2C3";
    const email = getRestrictionResolvedEmail({
      ownerName: "Daniel Ngeleja",
      referenceCode,
      scope: "NRMS_PROPERTY",
      targetName: "Namibia Villa",
      reason: "Original review reason",
      effectiveAt: new Date("2026-07-19T08:30:00.000Z"),
      resolutionNote: "Review completed and access restored.",
      resolvedAt: new Date("2026-07-20T09:00:00.000Z"),
    });

    expect(email.subject).toContain(referenceCode);
    expect(email.html).toContain("Resolved case reference");
    expect(email.html).toContain(referenceCode);
    expect(email.html).toContain("Review completed and access restored.");
  });
});
