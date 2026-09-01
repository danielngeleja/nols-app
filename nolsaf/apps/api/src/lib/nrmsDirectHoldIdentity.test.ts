import { describe, expect, it } from "vitest";
import { directHoldExternalRef } from "./nrmsDirectHoldIdentity.js";

describe("public direct hold idempotency", () => {
  it("returns one property-scoped reservation identity for every retry", () => {
    const requestId = "71cff681-6fca-4384-b683-b12f487d560d";
    const first = directHoldExternalRef(19, requestId);
    expect(directHoldExternalRef(19, requestId)).toBe(first);
    expect(directHoldExternalRef(20, requestId)).not.toBe(first);
    expect(first).toMatch(/^DIRECT-[A-F0-9]{24}$/);
  });
});
