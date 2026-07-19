import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { signNrmsStaffInviteToken, verifyNrmsStaffInviteToken } from "./nrmsStaffInviteToken.js";

const TEST_SECRET = "nrms-staff-invite-test-secret-with-enough-entropy";
const ISSUER = "nolsaf-nrms-staff-invite";
let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (previousSecret == null) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previousSecret;
});

describe("NRMS staff invitation tokens", () => {
  it("binds the membership, user, and current invitation version", () => {
    const token = signNrmsStaffInviteToken(41, 72, 3);

    expect(verifyNrmsStaffInviteToken(token)).toEqual({
      typ: "NRMS_STAFF_INVITE",
      membershipId: 41,
      userId: 72,
      inviteVersion: 3,
    });
  });

  it("treats pre-versioning tokens as revision zero", () => {
    const token = jwt.sign(
      { typ: "NRMS_STAFF_INVITE", membershipId: 9, userId: 12 },
      TEST_SECRET,
      { issuer: ISSUER, algorithm: "HS256", expiresIn: "7d" },
    );

    expect(verifyNrmsStaffInviteToken(token)?.inviteVersion).toBe(0);
  });

  it("rejects invalid invitation versions", () => {
    const token = jwt.sign(
      { typ: "NRMS_STAFF_INVITE", membershipId: 9, userId: 12, inviteVersion: -1 },
      TEST_SECRET,
      { issuer: ISSUER, algorithm: "HS256", expiresIn: "7d" },
    );

    expect(verifyNrmsStaffInviteToken(token)).toBeNull();
  });

  it("rejects expired and incorrectly signed links", () => {
    const expired = jwt.sign(
      { typ: "NRMS_STAFF_INVITE", membershipId: 9, userId: 12, inviteVersion: 1 },
      TEST_SECRET,
      { issuer: ISSUER, algorithm: "HS256", expiresIn: -1 },
    );
    const incorrectlySigned = jwt.sign(
      { typ: "NRMS_STAFF_INVITE", membershipId: 9, userId: 12, inviteVersion: 1 },
      "another-secret",
      { issuer: ISSUER, algorithm: "HS256", expiresIn: "7d" },
    );

    expect(verifyNrmsStaffInviteToken(expired)).toBeNull();
    expect(verifyNrmsStaffInviteToken(incorrectlySigned)).toBeNull();
  });
});
