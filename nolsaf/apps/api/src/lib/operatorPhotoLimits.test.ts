import { describe, expect, it } from "vitest";
import { operatorPhotoLimit, photoLimitBreaches } from "./operatorPhotoLimits.js";

const many = (n: number, prefix = "u") => Array.from({ length: n }, (_, i) => `https://img/${prefix}${i}.jpg`);

describe("operator photo limits", () => {
  it("allows 1 logo, 8 proof items and 3 everywhere else", () => {
    expect(operatorPhotoLimit("logo")).toBe(1);
    expect(operatorPhotoLimit("proof")).toBe(8);
    expect(operatorPhotoLimit("vehicles")).toBe(3);
    expect(operatorPhotoLimit("anything-new")).toBe(3);
  });

  it("accepts groups at or under the limit", () => {
    expect(photoLimitBreaches({ logo: many(1), vehicles: many(3), team: many(2) }, {})).toEqual([]);
  });

  it("refuses a fourth photo and a second logo", () => {
    const breaches = photoLimitBreaches({ logo: many(2), attractions: many(4) }, {});
    expect(breaches.map((b) => b.category).sort()).toEqual(["attractions", "logo"]);
  });

  it("stops a flood of 100 photos", () => {
    expect(photoLimitBreaches({ vehicles: many(100) }, {})).toEqual([{ category: "vehicles", limit: 3, count: 100 }]);
  });

  it("lets an older over-limit group be saved unchanged or trimmed, but not grow", () => {
    const old = many(6);
    expect(photoLimitBreaches({ team: old }, { team: old })).toEqual([]);
    expect(photoLimitBreaches({ team: old.slice(0, 5) }, { team: old })).toEqual([]);
    expect(photoLimitBreaches({ team: [...old.slice(0, 5), "https://img/new.jpg"] }, { team: old })).toHaveLength(1);
  });

  it("counts a duplicated URL once", () => {
    expect(photoLimitBreaches({ vehicles: ["a", "a", "b", "c"] }, {})).toEqual([]);
  });
});
