/**
 * NRMS Agent B2B - agent onboarding by one-time invite link.
 *
 * Agents are REAL users (role NRMS_AGENT), not bearer keys. Onboarding:
 *   1. invite: create a password-less NRMS_AGENT user + PENDING agency identity,
 *      email a single-use expiring invite token (the only "key").
 *   2. activate: the agent opens the link, sets their own password (we never see
 *      it), and gets a normal session. Thereafter they log in like any user.
 *
 * The invite is single-use by construction: activation sets passwordHash, and a
 * user that already has a password cannot be activated again.
 */
import jwt, { type Algorithm } from "jsonwebtoken";
import { hashPassword } from "./crypto.js";
import { createAgentAccount, type CreateAgentAccountInput } from "./nrmsAgentIdentity.js";

const ISSUER = "nolsaf-agent-invite";
const ALGS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 2048;
const INVITE_TTL = "7d";

export type AgentInvitePayload = { typ: "AGENT_INVITE"; userId: number; accountId: number };

function getSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? process.env.DEV_JWT_SECRET || "dev_jwt_secret" : "");
  if (!secret) throw new Error("agent_invite_secret_missing");
  return secret;
}

export function signAgentInviteToken(userId: number, accountId: number): string {
  return jwt.sign({ typ: "AGENT_INVITE", userId, accountId } satisfies AgentInvitePayload, getSecret(), {
    issuer: ISSUER,
    algorithm: "HS256",
    expiresIn: INVITE_TTL,
  });
}

export function verifyAgentInviteToken(token: string): AgentInvitePayload | null {
  try {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const d = jwt.verify(token, getSecret(), { issuer: ISSUER, algorithms: ALGS }) as AgentInvitePayload;
    if (d?.typ !== "AGENT_INVITE") return null;
    if (!Number.isInteger(Number(d.userId)) || Number(d.userId) <= 0) return null;
    if (!Number.isInteger(Number(d.accountId)) || Number(d.accountId) <= 0) return null;
    return { typ: "AGENT_INVITE", userId: Number(d.userId), accountId: Number(d.accountId) };
  } catch {
    return null;
  }
}

type Db = {
  user: { findUnique: (a: any) => Promise<any | null>; create: (a: any) => Promise<any>; updateMany: (a: any) => Promise<{ count: number }> };
  nrmsAgentAccount: { create: (a: any) => Promise<any>; findFirst: (a: any) => Promise<any | null> };
  $transaction: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};
type InviteTx = Omit<Db, "$transaction">;

export type InviteAgentInput = Omit<CreateAgentAccountInput, "primaryUserId"> & { email: string };
export type InviteAgentResult =
  | { ok: true; userId: number; accountId: number; token: string }
  | { ok: false; reason: "EMAIL_IN_USE"; message: string };

/**
 * Create the lightweight NRMS_AGENT user + PENDING agency identity, atomically,
 * and mint the invite token. The user has no password until activation.
 */
/** Create invite records on a caller-owned transaction. This lets hotel
 * onboarding keep the user, agency identity, property link and seat cap in one
 * atomic unit instead of committing a password-less orphan first. */
export async function inviteAgentUserInTransaction(db: InviteTx, input: InviteAgentInput): Promise<InviteAgentResult> {
  const email = input.email.trim().toLowerCase();
  const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { ok: false, reason: "EMAIL_IN_USE", message: "That email already has a NoLSAF account." };

  let user: { id: number };
  try {
    user = await db.user.create({
      data: { role: "NRMS_AGENT", email, fullName: input.contactName?.trim() || input.legalName.trim(), passwordHash: null },
      select: { id: true },
    });
  } catch (error: any) {
    if (error?.code === "P2002") return { ok: false, reason: "EMAIL_IN_USE", message: "That email already has a NoLSAF account." };
    throw error;
  }
  const account = await createAgentAccount(db as any, { ...input, primaryUserId: user.id });
  return { ok: true, userId: user.id, accountId: account.id, token: signAgentInviteToken(user.id, account.id) };
}

export async function inviteAgentUser(db: Db, input: InviteAgentInput): Promise<InviteAgentResult> {
  return db.$transaction((tx: any) => inviteAgentUserInTransaction(tx, input));
}

export type ActivateAgentResult =
  | { ok: true; userId: number; role: string; email: string | null }
  | { ok: false; reason: "INVALID_TOKEN" | "ALREADY_ACTIVE" | "NOT_FOUND"; message: string };

/**
 * Redeem an invite: set the agent's own password and mark the email verified.
 * Single-use - a user that already has a password cannot be re-activated.
 */
export async function activateAgentFromInvite(db: Db, params: { token: string; password: string }): Promise<ActivateAgentResult> {
  const payload = verifyAgentInviteToken(params.token);
  if (!payload) return { ok: false, reason: "INVALID_TOKEN", message: "This invite link is invalid or has expired." };

  const account = await db.nrmsAgentAccount.findFirst({
    where: { id: payload.accountId, primaryUserId: payload.userId },
    select: { id: true },
  });
  if (!account) return { ok: false, reason: "NOT_FOUND", message: "Invite is no longer valid." };

  const user = await db.user.findUnique({ where: { id: payload.userId }, select: { id: true, role: true, email: true, passwordHash: true } });
  if (!user || user.role !== "NRMS_AGENT") return { ok: false, reason: "NOT_FOUND", message: "Invite is no longer valid." };
  if (user.passwordHash) return { ok: false, reason: "ALREADY_ACTIVE", message: "This account is already set up. Please sign in." };

  const passwordHash = await hashPassword(params.password);
  const redeemed = await db.user.updateMany({
    where: { id: user.id, role: "NRMS_AGENT", passwordHash: null },
    // Record the activation password atomically with account redemption so it
    // is included in the same five-password reuse history as every other flow.
    data: { passwordHash, previousPasswordHashes: [passwordHash], emailVerifiedAt: new Date() },
  });
  if (redeemed.count !== 1) {
    return { ok: false, reason: "ALREADY_ACTIVE", message: "This account is already set up. Please sign in." };
  }
  return { ok: true, userId: user.id, role: user.role, email: user.email };
}
