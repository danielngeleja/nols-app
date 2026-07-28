import jwt, { type Algorithm } from "jsonwebtoken";

export type NrmsStaffInviteTokenPayload = {
  typ: "NRMS_STAFF_INVITE";
  membershipId: number;
  userId: number;
  inviteVersion: number;
};

const ISSUER = "nolsaf-nrms-staff-invite";
const ALGS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 2048;
export const NRMS_STAFF_INVITE_TTL = "7d";

function getSecret(): string {
  const secret =
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");
  if (!secret) throw new Error("nrms_staff_invite_secret_missing");
  return secret;
}

export function signNrmsStaffInviteToken(membershipId: number, userId: number, inviteVersion: number): string {
  return jwt.sign(
    { typ: "NRMS_STAFF_INVITE", membershipId, userId, inviteVersion } satisfies NrmsStaffInviteTokenPayload,
    getSecret(),
    { issuer: ISSUER, algorithm: "HS256", expiresIn: NRMS_STAFF_INVITE_TTL },
  );
}

export function verifyNrmsStaffInviteToken(token: string): NrmsStaffInviteTokenPayload | null {
  try {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = jwt.verify(token, getSecret(), { issuer: ISSUER, algorithms: ALGS }) as NrmsStaffInviteTokenPayload;
    if (decoded?.typ !== "NRMS_STAFF_INVITE") return null;
    const membershipId = Number(decoded.membershipId);
    const userId = Number(decoded.userId);
    // Tokens issued before invitation versioning are revision 0. They remain
    // valid only until the assignment is resent, changed, or revoked.
    const inviteVersion = decoded.inviteVersion == null ? 0 : Number(decoded.inviteVersion);
    if (!Number.isInteger(membershipId) || membershipId <= 0) return null;
    if (!Number.isInteger(userId) || userId <= 0) return null;
    if (!Number.isInteger(inviteVersion) || inviteVersion < 0) return null;
    return { typ: "NRMS_STAFF_INVITE", membershipId, userId, inviteVersion };
  } catch {
    return null;
  }
}
