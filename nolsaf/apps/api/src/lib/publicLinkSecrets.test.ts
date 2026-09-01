import { describe, it, expect, afterEach } from "vitest";
import jwt from "jsonwebtoken";
import { publicLinkSecrets, publicLinkSigningSecret, verifyWithAnyPublicLinkSecret } from "./publicLinkSecrets.js";

const original = process.env.PUBLIC_LINK_TOKEN_SECRET;
afterEach(() => {
  process.env.PUBLIC_LINK_TOKEN_SECRET = original;
});

describe("public link secrets", () => {
  it("treats a single secret exactly as before", () => {
    process.env.PUBLIC_LINK_TOKEN_SECRET = "only-secret";
    expect(publicLinkSecrets()).toEqual(["only-secret"]);
    expect(publicLinkSigningSecret("nope")).toBe("only-secret");
  });

  it("signs with the first secret and verifies against all of them", () => {
    process.env.PUBLIC_LINK_TOKEN_SECRET = "old-secret";
    const printedLastYear = jwt.sign({ typ: "T" }, "old-secret", { issuer: "iss", algorithm: "HS256" });

    // Rotate: new secret in front, old one retained for the overlap window.
    process.env.PUBLIC_LINK_TOKEN_SECRET = "new-secret, old-secret";
    expect(publicLinkSigningSecret("nope")).toBe("new-secret");

    const stillValid = verifyWithAnyPublicLinkSecret<{ typ: string }>(printedLastYear, {
      issuer: "iss",
      algorithms: ["HS256"],
    });
    expect(stillValid?.typ).toBe("T");
  });

  it("stops accepting a secret once it is dropped from the list", () => {
    process.env.PUBLIC_LINK_TOKEN_SECRET = "retired-secret";
    const token = jwt.sign({ typ: "T" }, "retired-secret", { issuer: "iss", algorithm: "HS256" });

    process.env.PUBLIC_LINK_TOKEN_SECRET = "new-secret";
    expect(verifyWithAnyPublicLinkSecret(token, { issuer: "iss", algorithms: ["HS256"] })).toBeNull();
  });

  it("does not accept a token signed with an unlisted secret", () => {
    process.env.PUBLIC_LINK_TOKEN_SECRET = "a,b";
    const forged = jwt.sign({ typ: "T" }, "c", { issuer: "iss", algorithm: "HS256" });
    expect(verifyWithAnyPublicLinkSecret(forged, { issuer: "iss", algorithms: ["HS256"] })).toBeNull();
  });
});
