import { describe, expect, it } from "vitest";

import { classifyCardCheckoutResult } from "./cardCheckout";

describe("classifyCardCheckoutResult", () => {
  it.each(["cancel", "dismiss", "locked"])("treats %s as a closed checkout", (type) => {
    expect(classifyCardCheckoutResult({ type })).toEqual({ kind: "closed" });
  });

  it("recognizes a provider-confirmed return", () => {
    expect(
      classifyCardCheckoutResult({
        type: "success",
        url: "nolsaf://card-return?cardReturn=success&ref=INV-1"
      })
    ).toEqual({ kind: "returned", status: "success" });
  });

  it("recognizes a provider failure return", () => {
    expect(
      classifyCardCheckoutResult({
        type: "success",
        url: "nolsaf://card-return?cardReturn=failed&ref=INV-1"
      })
    ).toEqual({ kind: "returned", status: "failed" });
  });

  it("keeps an ambiguous redirect pending for authoritative server verification", () => {
    expect(classifyCardCheckoutResult({ type: "success", url: "nolsaf://card-return" })).toEqual({
      kind: "returned",
      status: "pending"
    });
  });
});
