import { afterEach, describe, expect, it, vi } from "vitest";

import { signTourDocumentToken, verifyTourDocumentToken } from "./tourDocumentToken";

describe("tour document tokens", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips a booking, customer, and document scope", () => {
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "test-tour-document-secret-with-enough-entropy");

    const token = signTourDocumentToken(42, 17, "voucher");

    expect(verifyTourDocumentToken(token)).toMatchObject({
      typ: "TOUR_DOCUMENT",
      bookingId: 42,
      userId: 17,
      kind: "voucher",
    });
  });

  it("rejects a tampered token", () => {
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "test-tour-document-secret-with-enough-entropy");
    const token = signTourDocumentToken(42, 17, "receipt");
    const last = token.at(-1);
    const tampered = `${token.slice(0, -1)}${last === "a" ? "b" : "a"}`;

    expect(verifyTourDocumentToken(tampered)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "first-tour-document-secret-with-enough-entropy");
    const token = signTourDocumentToken(42, 17, "receipt");
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "second-tour-document-secret-with-enough-entropy");

    expect(verifyTourDocumentToken(token)).toBeNull();
  });
});
