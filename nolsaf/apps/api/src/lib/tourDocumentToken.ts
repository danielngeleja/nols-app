import jwt, { type Algorithm } from "jsonwebtoken";

export type TourDocumentKind = "voucher" | "receipt";

export type TourDocumentTokenPayload = {
  typ: "TOUR_DOCUMENT";
  bookingId: number;
  userId: number;
  kind: TourDocumentKind;
};

const ISSUER = "nolsaf-tour-document";
const ALGORITHMS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 2048;

function getSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");

  if (!secret) throw new Error("tour_document_secret_missing");
  return secret;
}

export function signTourDocumentToken(bookingId: number, userId: number, kind: TourDocumentKind): string {
  const payload: TourDocumentTokenPayload = { typ: "TOUR_DOCUMENT", bookingId, userId, kind };
  return jwt.sign(payload, getSecret(), {
    issuer: ISSUER,
    subject: String(bookingId),
    algorithm: "HS256",
    expiresIn: "10m",
  });
}

export function verifyTourDocumentToken(token: string): TourDocumentTokenPayload | null {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = jwt.verify(token, getSecret(), { issuer: ISSUER, algorithms: ALGORITHMS }) as TourDocumentTokenPayload;
    if (decoded?.typ !== "TOUR_DOCUMENT") return null;
    if (decoded.kind !== "voucher" && decoded.kind !== "receipt") return null;
    if (!Number.isInteger(Number(decoded.bookingId)) || !Number.isInteger(Number(decoded.userId))) return null;
    return decoded;
  } catch {
    return null;
  }
}
