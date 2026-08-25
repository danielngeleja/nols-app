import { afterEach, describe, expect, it, vi } from "vitest";
import { signNrmsMetaOAuthState, verifyNrmsMetaOAuthState } from "./nrmsMetaOAuth.js";

describe("property-scoped Meta OAuth state", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a signed property and actor scope without exposing credentials", () => {
    vi.stubEnv("META_OAUTH_STATE_SECRET", "test-only-state-secret-with-enough-entropy");
    const signed = signNrmsMetaOAuthState({ propertyId: 19, ownerId: 4, actorId: 8, provider: "INSTAGRAM" });
    expect(signed).not.toContain("test-only-state-secret");
    expect(verifyNrmsMetaOAuthState(signed)).toMatchObject({ propertyId: 19, ownerId: 4, actorId: 8, provider: "INSTAGRAM" });
  });

  it("rejects a state that was altered after the property connection started", () => {
    vi.stubEnv("META_OAUTH_STATE_SECRET", "test-only-state-secret-with-enough-entropy");
    const signed = signNrmsMetaOAuthState({ propertyId: 19, ownerId: 4, actorId: 8, provider: "INSTAGRAM" });
    expect(verifyNrmsMetaOAuthState(`${signed.slice(0, -1)}x`)).toBeNull();
  });
});
