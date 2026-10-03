import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isNolscopeEstimateReference, nolscopeEstimateReference, resolveNolscopeEstimateReference } from "./nolscopeEstimateReference.js";

describe("NoLScope estimate references", () => {
  const original = process.env.PUBLIC_LINK_TOKEN_SECRET;
  beforeEach(() => {
    process.env.PUBLIC_LINK_TOKEN_SECRET = "current-secret";
  });
  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_LINK_TOKEN_SECRET;
    else process.env.PUBLIC_LINK_TOKEN_SECRET = original;
  });

  it("is opaque and never contains the row id", () => {
    const ref = nolscopeEstimateReference(55);
    expect(ref).toMatch(/^es_[A-Za-z0-9_-]{22}$/);
    expect(ref).not.toContain("55");
    expect(isNolscopeEstimateReference(ref)).toBe(true);
    expect(nolscopeEstimateReference(56)).not.toBe(ref);
  });

  it("resolves back to its estimate id", () => {
    for (const id of [1, 42, 123_456, 9_007_199_254_740_991]) {
      expect(resolveNolscopeEstimateReference(nolscopeEstimateReference(id))).toBe(id);
    }
  });

  it("rejects ids, malformed values, and tampered references", () => {
    const ref = nolscopeEstimateReference(77);
    const last = ref.at(-2) === "A" ? "B" : "A";
    expect(resolveNolscopeEstimateReference("77")).toBeNull();
    expect(resolveNolscopeEstimateReference("es_short")).toBeNull();
    expect(resolveNolscopeEstimateReference(`${ref.slice(0, -2)}${last}${ref.at(-1)}`)).toBeNull();
  });

  it("keeps working across a secret rotation and stops after retirement", () => {
    const ref = nolscopeEstimateReference(900);
    process.env.PUBLIC_LINK_TOKEN_SECRET = "next-secret,current-secret";
    expect(resolveNolscopeEstimateReference(ref)).toBe(900);
    expect(nolscopeEstimateReference(900)).not.toBe(ref);
    process.env.PUBLIC_LINK_TOKEN_SECRET = "next-secret";
    expect(resolveNolscopeEstimateReference(ref)).toBeNull();
  });
});
