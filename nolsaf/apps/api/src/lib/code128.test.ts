import { describe, expect, it } from "vitest";
import { code128BValues, code128Svg } from "./code128.js";

describe("code 128", () => {
  it("encodes start B, data, checksum and stop", () => {
    // "AB": start 104, A=33, B=34, checksum (104 + 33*1 + 34*2) % 103 = 102, stop 106.
    expect(code128BValues("ab")).toEqual([104, 33, 34, 102, 106]);
  });

  it("renders bars in whole modules with quiet zones", () => {
    const svg = code128Svg("AB");
    // Start, A, B and checksum are 11 modules each, stop is 13, plus two 10-module quiet zones = 77.
    expect(svg).toContain('viewBox="0 0 77 40"');
    expect(svg).toContain('<rect x="10" y="0" width="2" height="40"/>');
  });

  it("refuses characters outside printable ASCII", () => {
    expect(() => code128Svg("ÄB")).toThrow();
  });
});
