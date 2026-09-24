import { describe, expect, it } from "vitest";
import { buildPropertySlug, toPublicCard } from "./publicPropertyDto.js";

const publicKey = "cmg7t4q9v0001abcd2efghijk";

describe("public property slugs", () => {
  it("uses the stable opaque key instead of the numeric database id", () => {
    expect(buildPropertySlug("Diary Hotel", publicKey)).toBe(`diary-hotel-${publicKey}`);
    expect(buildPropertySlug("Diary Hotel", publicKey)).not.toMatch(/-10$/);
  });

  it("builds public card links from the opaque property key", () => {
    const card = toPublicCard({ id: 10, nrmsBookingKey: publicKey, title: "Diary Hotel", type: "HOTEL" });
    expect(card.slug).toBe(`diary-hotel-${publicKey}`);
  });
});
