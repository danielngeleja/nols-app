import jwt, { type Algorithm } from "jsonwebtoken";
import { publicLinkSigningSecret, verifyWithAnyPublicLinkSecret } from "./publicLinkSecrets.js";

export type PropertyVerificationTokenPayload = {
  typ: "PROPERTY_VERIFICATION";
  propertyId: number;
  verificationId: number;
};

const ISSUER = "nolsaf-property-verification";
const ALGS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 2048;

function getSecret(): string {
  return publicLinkSigningSecret("property_verification_secret_missing");
}

export function signPropertyVerificationToken(propertyId: number, verificationId: number): string {
  return jwt.sign(
    {
      typ: "PROPERTY_VERIFICATION",
      propertyId,
      verificationId,
    } satisfies PropertyVerificationTokenPayload,
    getSecret(),
    { issuer: ISSUER, algorithm: "HS256" }
  );
}

export function verifyPropertyVerificationToken(token: string): PropertyVerificationTokenPayload | null {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = verifyWithAnyPublicLinkSecret<PropertyVerificationTokenPayload>(token, {
      issuer: ISSUER,
      algorithms: ALGS,
    });
    if (!decoded) return null;
    if (decoded?.typ !== "PROPERTY_VERIFICATION") return null;
    if (!Number.isFinite(Number(decoded.propertyId)) || !Number.isFinite(Number(decoded.verificationId))) return null;
    return {
      typ: "PROPERTY_VERIFICATION",
      propertyId: Number(decoded.propertyId),
      verificationId: Number(decoded.verificationId),
    };
  } catch {
    return null;
  }
}
