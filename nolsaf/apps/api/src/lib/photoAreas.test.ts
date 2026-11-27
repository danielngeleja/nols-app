import { describe, expect, it } from "vitest";
import { longStayPhotoAreaRefusal, sanitizePhotoAreas } from "./photoAreas.js";
import { publicPhotoAreas } from "./publicPropertyDto.js";

const A = "https://res.cloudinary.com/demo/image/upload/v1/properties/a.jpg";
const B = "https://res.cloudinary.com/demo/image/upload/v1/properties/b.jpg";
const C = "https://res.cloudinary.com/demo/image/upload/v1/properties/c.jpg";

describe("sanitizePhotoAreas", () => {
  it("keeps known areas for photos on the listing only", () => {
    expect(sanitizePhotoAreas({ [A]: "KITCHEN", [B]: "SPACESHIP", "https://evil.example/x.jpg": "BEDROOM" }, [A, B])).toEqual({ [A]: "KITCHEN" });
  });

  it("returns null for nothing usable or the wrong shape", () => {
    expect(sanitizePhotoAreas(null, [A])).toBeNull();
    expect(sanitizePhotoAreas(["KITCHEN"], [A])).toBeNull();
    expect(sanitizePhotoAreas({ [A]: "NOPE" }, [A])).toBeNull();
  });
});

describe("longStayPhotoAreaRefusal", () => {
  it("passes when every photo has an area and the essentials are shown", () => {
    expect(longStayPhotoAreaRefusal([A, B, C], { [A]: "KITCHEN", [B]: "BEDROOM", [C]: "BATHROOM" })).toBeNull();
  });

  it("asks for an area on every photo first", () => {
    expect(longStayPhotoAreaRefusal([A, B, C], { [A]: "KITCHEN", [B]: "BEDROOM" })).toMatch(/One photo has no area/);
    expect(longStayPhotoAreaRefusal([A, B, C], {})).toMatch(/^3 photos have no area/);
  });

  it("names the missing essentials", () => {
    expect(longStayPhotoAreaRefusal([A, B, C], { [A]: "OUTSIDE", [B]: "LIVING", [C]: "KITCHEN" })).toBe(
      "Tenants need to see the bedroom and bathroom. Add a photo of each before submitting a long stay."
    );
    expect(longStayPhotoAreaRefusal([A, B, C], { [A]: "KITCHEN", [B]: "BEDROOM", [C]: "LIVING" })).toMatch(/see the bathroom\. Add a photo of it/);
  });

  it("reads a JSON string as stored by MariaDB", () => {
    expect(longStayPhotoAreaRefusal([A], JSON.stringify({ [A]: "KITCHEN" }))).toMatch(/bedroom and bathroom/);
  });
});

describe("publicPhotoAreas", () => {
  it("keys areas by the public URL the page receives, and drops unknown areas", () => {
    const out = publicPhotoAreas({ photoAreas: { [A]: "KITCHEN", [B]: "HACKED" }, images: [] }) || {};
    const keys = Object.keys(out);
    expect(keys.length).toBeGreaterThan(0);
    expect(Object.values(out).every((v) => v === "KITCHEN")).toBe(true);
  });

  it("is null when nothing is labelled", () => {
    expect(publicPhotoAreas({ photoAreas: null })).toBeNull();
  });
});
