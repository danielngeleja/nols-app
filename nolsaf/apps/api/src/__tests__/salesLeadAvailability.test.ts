import { describe, expect, it } from "vitest";
import {
  availabilityRefusal,
  classifyLeadAvailability,
  coreName,
  sameArea,
  type AvailabilityLeadCandidate,
} from "../lib/salesLeadAvailability.js";

const now = new Date("2026-11-16T12:00:00Z");
const later = new Date("2026-12-30T00:00:00Z");
const earlier = new Date("2026-10-01T00:00:00Z");

function lead(over: Partial<AvailabilityLeadCandidate>): AvailabilityLeadCandidate {
  return {
    id: 10,
    salesPartnerId: 2,
    status: "NEW",
    protectionExpiresAt: later,
    propertyNameNormalized: "kaje classic hotel",
    contactPhoneNormalized: null,
    contactEmailNormalized: null,
    registrationNumberNormalized: null,
    taxNumberNormalized: null,
    region: "Dar es Salaam",
    district: "Kinondoni",
    ...over,
  };
}

const typed = { propertyName: "Kaje Classic", region: "DAR ES SALAAM", district: "KINONDONI" };

describe("coreName and sameArea", () => {
  it("ignores the kind of place", () => {
    expect(coreName("Kaje Classic Hotel")).toBe("kaje classic");
    expect(coreName("The Olive Guest House")).toBe("olive");
    expect(coreName("Hotel")).toBe("hotel");
  });
  it("compares districts, else regions, and never a missing area", () => {
    expect(sameArea({ district: "KINONDONI" }, { district: "Kinondoni" })).toBe(true);
    expect(sameArea({ district: "Ilala" }, { district: "Kinondoni", region: "Dar" })).toBe(false);
    expect(sameArea({ region: "Arusha" }, { region: "ARUSHA", district: "Meru" })).toBe(true);
    expect(sameArea({}, { region: "Arusha" })).toBe(false);
  });
});

describe("classifyLeadAvailability", () => {
  const base = { partnerId: 1, identity: typed, properties: [], now };

  it("is clear when nothing matches", () => {
    expect(classifyLeadAvailability({ ...base, leads: [lead({ district: "Ilala" })] }).lead).toBe("CLEAR");
  });
  it("reports another partner's protected lead as taken, without saying whose", () => {
    const result = classifyLeadAvailability({ ...base, leads: [lead({})] });
    expect(result).toEqual({ lead: "TAKEN", ownLeadId: null, listed: false });
  });
  it("frees a property once another partner's protection has expired", () => {
    expect(classifyLeadAvailability({ ...base, leads: [lead({ protectionExpiresAt: earlier })] }).lead).toBe("CLEAR");
  });
  it("keeps a converted lead taken even after protection ends", () => {
    expect(classifyLeadAvailability({ ...base, leads: [lead({ status: "CONVERTED", protectionExpiresAt: earlier })] }).lead).toBe("TAKEN");
  });
  it("ignores lost and cancelled leads", () => {
    expect(classifyLeadAvailability({ ...base, leads: [lead({ status: "LOST" })] }).lead).toBe("CLEAR");
  });
  it("tells a partner about their own lead first", () => {
    const result = classifyLeadAvailability({ ...base, leads: [lead({}), lead({ id: 11, salesPartnerId: 1 })] });
    expect(result.lead).toBe("OWN");
    expect(result.ownLeadId).toBe(11);
  });
  it("matches on phone even with a different name and area", () => {
    const result = classifyLeadAvailability({
      ...base,
      identity: { propertyName: "Something Else", contactPhone: "0624 531 379" },
      leads: [lead({ contactPhoneNormalized: "255624531379", district: "Ilala" })],
    });
    expect(result.lead).toBe("TAKEN");
  });
  it("flags an approved listing with the same name in the same district", () => {
    const listed = classifyLeadAvailability({
      ...base,
      leads: [],
      properties: [{ title: "Kaje Classic Hotel", status: "APPROVED", regionName: "Dar es Salaam", district: "Kinondoni" }],
    });
    expect(listed.listed).toBe(true);
    const pending = classifyLeadAvailability({
      ...base,
      leads: [],
      properties: [{ title: "Kaje Classic Hotel", status: "PENDING", regionName: "Dar es Salaam", district: "Kinondoni" }],
    });
    expect(pending.listed).toBe(false);
  });
});

describe("availabilityRefusal", () => {
  it("refuses Marketplace on a listed property but allows NRMS", () => {
    const listed = { lead: "CLEAR" as const, ownLeadId: null, listed: true };
    expect(availabilityRefusal(listed, "MARKETPLACE")?.code).toBe("ALREADY_LISTED");
    expect(availabilityRefusal(listed, "NRMS_AND_MARKETPLACE")?.code).toBe("ALREADY_LISTED");
    expect(availabilityRefusal(listed, "NRMS")).toBeNull();
  });
  it("never names the other partner", () => {
    const refusal = availabilityRefusal({ lead: "TAKEN", ownLeadId: null, listed: false }, "NRMS");
    expect(refusal?.code).toBe("LEAD_TAKEN");
    expect(refusal?.error).not.toMatch(/\d/);
  });
});
