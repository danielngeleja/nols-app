import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildStayOrderingToken, isStayOrderingTokenShape, readStayOrderingToken } from "./nrmsStayToken.js";

describe("NRMS per-stay ordering token", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "test_stay_token_secret");
  });

  it("round-trips the reservation it was issued for", () => {
    const token = buildStayOrderingToken(41);
    expect(readStayOrderingToken(token)).toBe(41);
  });

  it("is deterministic so a retried welcome SMS does not create a second live link", () => {
    expect(buildStayOrderingToken(41)).toBe(buildStayOrderingToken(41));
  });

  it("fits the public token pattern the menu route already enforces", () => {
    for (const reservationId of [1, 41, 999999]) {
      expect(buildStayOrderingToken(reservationId)).toMatch(/^[A-Za-z0-9_-]{16,48}$/);
    }
  });

  it("rejects a token whose reservation id was swapped for another guest's", () => {
    const token = buildStayOrderingToken(41);
    const forged = token.replace(/^s41_/, "s42_");
    expect(forged).not.toBe(token);
    expect(readStayOrderingToken(forged)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = buildStayOrderingToken(41);
    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect(readStayOrderingToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", () => {
    const token = buildStayOrderingToken(41);
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "a_different_secret");
    expect(readStayOrderingToken(token)).toBeNull();
  });

  it("returns null for an order-point token so the caller falls through", () => {
    expect(readStayOrderingToken("aGVsbG8td29ybGQtdG9rZW4")).toBeNull();
    expect(isStayOrderingTokenShape("aGVsbG8td29ybGQtdG9rZW4")).toBe(false);
  });

  it("recognises the stay shape even when the signature does not verify", () => {
    // Lets the route answer "this stay is closed" instead of "invalid QR".
    expect(isStayOrderingTokenShape("s41_not_a_real_signature")).toBe(true);
  });
});
