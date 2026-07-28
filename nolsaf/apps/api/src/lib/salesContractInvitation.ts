import { createHash, randomBytes } from "node:crypto";

export const SALES_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashSalesInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createSalesContractInvitation(
  contractExpiresAt: Date,
  now = new Date(),
): { token: string; tokenHash: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(
    Math.min(contractExpiresAt.getTime(), now.getTime() + SALES_INVITATION_TTL_MS),
  );
  return {
    token,
    tokenHash: hashSalesInvitationToken(token),
    expiresAt,
  };
}
