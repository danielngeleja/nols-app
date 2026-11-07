/**
 * Team invites: a team lead invites one person to join their team.
 *
 * Not a public gate. The link only tags a normal partner application:
 *   1. the lead creates an invite for a named person and phone (max 5 open,
 *      team of at most 10, 14-day link, stored as a hash);
 *   2. the recruit signs in to their own NoLSAF account and accepts; the
 *      system checks them against the lead and records any warning signs;
 *   3. an administrator approves by promoting them (the usual agreement flow)
 *      or rejects, optionally pausing the lead's withdrawals;
 *   4. the recruit joins the team when their agreement is activated.
 *
 * A lead never approves anyone and earns nothing for recruiting.
 */
import { createHash, randomBytes } from "node:crypto";
import { phoneKey, payoutAccountKey } from "./salesSelfDealing.js";

export const INVITE_TTL_DAYS = 14;
export const MAX_OPEN_INVITES = 5;
export const MAX_TEAM_SIZE = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN = ["SENT", "ACCEPTED", "APPROVED"];

export type InviteFlag = { code: string; severity: "SUSPICIOUS" | "REVIEW"; message: string };

export class InviteError extends Error {
  constructor(message: string, readonly status = 409, readonly code = "INVITE_REFUSED") {
    super(message);
    this.name = "InviteError";
  }
}

export const hashInviteToken = (token: string) => createHash("sha256").update(String(token), "utf8").digest("hex");

function webOrigin(): string {
  const candidate = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || process.env.APP_URL || "https://www.nolsaf.com";
  try {
    return new URL(candidate).origin;
  } catch {
    return "https://www.nolsaf.com";
  }
}

/** Outside /sales on purpose: the recruit may not be signed in yet. */
export const inviteLink = (token: string) => `${webOrigin()}/join-team?t=${encodeURIComponent(token)}`;

function freshToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

/** What the people involved see: an unaccepted invite past its date reads as expired. */
export function inviteStatus(invite: { status: string; expiresAt: Date }, now = new Date()): string {
  return invite.status === "SENT" && invite.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : invite.status;
}

/** 0754 123 456 and +255 754 123 456 both become 255754123456. */
export function normalizeTzPhone(raw: string): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  const local = digits.startsWith("255") ? digits.slice(3) : digits.startsWith("0") ? digits.slice(1) : digits;
  return /^[67]\d{8}$/.test(local) ? `255${local}` : null;
}

export function maskPhone(phone: string): string {
  const d = String(phone || "").replace(/\D/g, "");
  return d.length >= 4 ? `+${d.slice(0, 3)} ••• ••${d.slice(-3)}` : "•••";
}

/** Team members plus open invites: the team may not grow past MAX_TEAM_SIZE. */
async function seatsUsed(db: any, teamId: number, now: Date) {
  const [members, open] = await Promise.all([
    db.salesTeamMember.count({ where: { teamId, activeKey: { not: null } } }),
    db.salesTeamInvite.findMany({ where: { teamId, status: { in: OPEN } }, select: { status: true, expiresAt: true } }),
  ]);
  const live = open.filter((i: any) => inviteStatus(i, now) !== "EXPIRED").length;
  return { members, open: live };
}

/** The lead creates an invite. Returns the link once; only its hash is kept. */
export async function createTeamInvite(db: any, input: {
  team: { id: number; leadPartnerId: number };
  name: string;
  phone: string;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const phone = normalizeTzPhone(input.phone);
  if (!phone) throw new InviteError("Enter a Tanzanian mobile number, for example 0754 123 456.", 400);
  const lead = await db.salesPartnerProfile.findUnique({
    where: { id: input.team.leadPartnerId },
    select: { status: true, payoutHoldAt: true, phone: true, user: { select: { phone: true } } },
  });
  if (!lead || lead.status !== "ACTIVE") throw new InviteError("Only an active team lead can invite.", 403);
  if (lead.payoutHoldAt) throw new InviteError("Invites are paused while NoLSAF reviews your account.");
  const key = phoneKey(phone);
  if (key && [lead.phone, lead.user?.phone].some((p) => phoneKey(p) === key)) {
    throw new InviteError("That is your own number. Invite the person who will join your team.", 400);
  }

  const seats = await seatsUsed(db, input.team.id, now);
  if (seats.open >= MAX_OPEN_INVITES) {
    throw new InviteError(`You can have ${MAX_OPEN_INVITES} open invites at a time. Withdraw one or wait for a decision.`);
  }
  if (seats.members + seats.open >= MAX_TEAM_SIZE) {
    throw new InviteError(`A team can have up to ${MAX_TEAM_SIZE} members, counting open invites.`);
  }
  const duplicate = await db.salesTeamInvite.findFirst({
    where: { teamId: input.team.id, inviteePhone: phone, status: { in: OPEN }, expiresAt: { gt: now } },
    select: { id: true },
  });
  if (duplicate) throw new InviteError("This number already has an open invite. Send a new link from that invite instead.");

  const { token, tokenHash } = freshToken();
  const invite = await db.salesTeamInvite.create({
    data: {
      reference: `ti_${randomBytes(12).toString("base64url")}`,
      teamId: input.team.id,
      leadPartnerId: input.team.leadPartnerId,
      tokenHash,
      inviteeName: input.name,
      inviteePhone: phone,
      status: "SENT",
      expiresAt: new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS),
    },
    select: { reference: true, inviteeName: true, inviteePhone: true, expiresAt: true },
  });
  return { ...invite, link: inviteLink(token) };
}

/** A new link for an invite nobody has accepted yet. The old link stops working. */
export async function renewTeamInviteLink(db: any, input: { teamId: number; reference: string; now?: Date }) {
  const now = input.now ?? new Date();
  const invite = await db.salesTeamInvite.findFirst({ where: { reference: input.reference, teamId: input.teamId }, select: { id: true, status: true } });
  if (!invite) throw new InviteError("Invite not found.", 404);
  if (invite.status !== "SENT") throw new InviteError("Only an invite nobody has accepted yet can get a new link.");
  const { token, tokenHash } = freshToken();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY_MS);
  const changed = await db.salesTeamInvite.updateMany({ where: { id: invite.id, status: "SENT" }, data: { tokenHash, expiresAt, openedAt: null } });
  if (changed.count !== 1) throw new InviteError("This invite changed. Reload and try again.");
  return { link: inviteLink(token), expiresAt };
}

export async function withdrawTeamInvite(db: any, input: { teamId: number; reference: string; now?: Date }) {
  const now = input.now ?? new Date();
  const changed = await db.salesTeamInvite.updateMany({
    where: { reference: input.reference, teamId: input.teamId, status: { in: ["SENT", "ACCEPTED"] } },
    data: { status: "WITHDRAWN", withdrawnAt: now },
  });
  if (changed.count !== 1) throw new InviteError("Only an invite that is not yet approved can be withdrawn.");
}

async function teamAndLead(db: any, teamId: number) {
  return db.salesTeam.findUnique({
    where: { id: teamId },
    select: { id: true, name: true, region: true, status: true, lead: { select: { id: true, userId: true, user: { select: { name: true, fullName: true } } } } },
  });
}

const firstName = (user: any) => String(user?.fullName || user?.name || "A NoLSAF team lead").trim().split(/\s+/)[0];

/**
 * What the invite page shows before signing in: only who invited and to which
 * team. The same answer for every bad, used or expired link.
 */
export async function previewTeamInvite(db: any, token: string, now = new Date()) {
  if (!token || token.length > 100) return null;
  const invite = await db.salesTeamInvite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: { id: true, status: true, expiresAt: true, inviteeName: true, teamId: true, openedAt: true },
  });
  if (!invite || inviteStatus(invite, now) !== "SENT") return null;
  // First open only, so the lead can tell whether to follow up.
  if (!invite.openedAt) await db.salesTeamInvite.updateMany({ where: { id: invite.id, openedAt: null }, data: { openedAt: now } });
  const team = await teamAndLead(db, invite.teamId);
  if (!team || team.status !== "ACTIVE") return null;
  return {
    inviteeFirstName: String(invite.inviteeName).trim().split(/\s+/)[0],
    leadFirstName: firstName(team.lead.user),
    teamName: team.name,
    region: team.region,
    expiresAt: invite.expiresAt,
  };
}

/** What is still missing before NoLSAF can send an agreement (same rules as promotion). */
export function profileGaps(user: any): string[] {
  return [
    user.fullName || user.name ? null : "Legal name",
    user.email && user.emailVerifiedAt ? null : "Verified email address",
    user.phone && user.phoneVerifiedAt ? null : "Verified phone number",
    user.address ? null : "Address",
    user.nin ? null : "National ID number",
  ].filter(Boolean) as string[];
}

/** The recruit accepts, signed in. Records every warning sign for the admin. */
export async function acceptTeamInvite(db: any, input: { token: string; userId: number; now?: Date }) {
  const now = input.now ?? new Date();
  const invite = await db.salesTeamInvite.findUnique({ where: { tokenHash: hashInviteToken(input.token) } });
  if (!invite || inviteStatus(invite, now) !== "SENT") {
    throw new InviteError("This invite link is not valid any more. Ask your team lead for a new one.", 404, "INVITE_INVALID");
  }
  const team = await teamAndLead(db, invite.teamId);
  if (!team || team.status !== "ACTIVE") throw new InviteError("This team is no longer active.", 404, "INVITE_INVALID");
  if (team.lead.userId === input.userId) throw new InviteError("You cannot accept your own invite.", 400);

  const [user, existingPartner, otherOpen, lead] = await Promise.all([
    db.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true, name: true, fullName: true, email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true,
        address: true, nin: true, suspendedAt: true, isDisabled: true,
      },
    }),
    db.salesPartnerProfile.findUnique({ where: { userId: input.userId }, select: { id: true } }),
    db.salesTeamInvite.findFirst({ where: { acceptedUserId: input.userId, status: { in: ["ACCEPTED", "APPROVED"] } }, select: { id: true } }),
    db.user.findUnique({ where: { id: team.lead.userId }, select: { email: true, phone: true, nin: true } }),
  ]);
  if (!user || user.suspendedAt || user.isDisabled === true) throw new InviteError("This account cannot accept invites.", 403);
  if (existingPartner) {
    throw new InviteError("You are already a NoLSAF sales partner. Ask NoLSAF support to move you to this team.");
  }
  if (otherOpen) throw new InviteError("You already accepted another team invite that is waiting for NoLSAF.");

  const flags: InviteFlag[] = [];
  const add = (code: string, severity: InviteFlag["severity"], message: string) => flags.push({ code, severity, message });

  // Fraud signals: the recruit looks like the lead.
  const leadPartner = await db.salesPartnerProfile.findUnique({ where: { id: team.lead.id }, select: { phone: true } });
  const leadPhones = new Set([lead?.phone, leadPartner?.phone].map(phoneKey).filter(Boolean));
  if (phoneKey(user.phone) && leadPhones.has(phoneKey(user.phone))) add("SAME_PHONE_AS_LEAD", "SUSPICIOUS", "The recruit uses the team lead's phone number.");
  if (user.email && lead?.email && user.email.trim().toLowerCase() === lead.email.trim().toLowerCase()) {
    add("SAME_EMAIL_AS_LEAD", "SUSPICIOUS", "The recruit uses the team lead's email address.");
  }
  if (user.nin && lead?.nin && String(user.nin).replace(/\W/g, "").toUpperCase() === String(lead.nin).replace(/\W/g, "").toUpperCase()) {
    add("SAME_ID_AS_LEAD", "SUSPICIOUS", "The recruit's national ID number is the team lead's.");
  }
  const [recruitAccounts, leadAccounts] = await Promise.all([
    db.payoutAccount.findMany({ where: { userId: input.userId }, select: { accountNumber: true } }),
    db.payoutAccount.findMany({ where: { userId: team.lead.userId }, select: { accountNumber: true } }),
  ]);
  const leadKeys = new Set(leadAccounts.map((a: any) => payoutAccountKey(a.accountNumber)).filter(Boolean));
  if (recruitAccounts.some((a: any) => leadKeys.has(payoutAccountKey(a.accountNumber)))) {
    add("SAME_PAYOUT_ACCOUNT_AS_LEAD", "SUSPICIOUS", "The recruit has a payout account the team lead also uses.");
  }

  // Checks: worth a look, not a fraud signal on their own.
  if (!(user.phoneVerifiedAt && phoneKey(user.phone) === phoneKey(invite.inviteePhone))) {
    add("PHONE_NOT_INVITED_NUMBER", "REVIEW", `Signed in with a different or unverified phone than the one invited (${maskPhone(invite.inviteePhone)}).`);
  }
  const rejected = await db.salesTeamInvite.count({
    where: { leadPartnerId: invite.leadPartnerId, status: "REJECTED", decidedAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } },
  });
  if (rejected >= 2) add("LEAD_RECENT_REJECTIONS", "REVIEW", `${rejected} of this lead's invites were rejected in the last 30 days.`);
  const gaps = profileGaps(user);
  if (gaps.length) add("PROFILE_INCOMPLETE", "REVIEW", `Still missing: ${gaps.join(", ")}.`);

  const changed = await db.salesTeamInvite.updateMany({
    where: { id: invite.id, status: "SENT", expiresAt: { gt: now } },
    data: { status: "ACCEPTED", acceptedUserId: input.userId, acceptedAt: now, flags },
  });
  if (changed.count !== 1) throw new InviteError("This invite changed. Ask your team lead for a new link.", 409, "INVITE_INVALID");

  return {
    reference: invite.reference,
    teamName: team.name,
    leadFirstName: firstName(team.lead.user),
    leadUserId: team.lead.userId,
    inviteeName: invite.inviteeName,
    flags,
    missing: gaps,
  };
}

/** The recruit's own view of an invite they accepted. */
export async function myTeamInvite(db: any, userId: number, now = new Date()) {
  const invite = await db.salesTeamInvite.findFirst({
    where: { acceptedUserId: userId, status: { in: ["ACCEPTED", "APPROVED", "JOINED", "REJECTED"] } },
    orderBy: { acceptedAt: "desc" },
    select: { status: true, acceptedAt: true, decidedAt: true, teamId: true, expiresAt: true },
  });
  if (!invite) return null;
  const [team, user] = await Promise.all([
    teamAndLead(db, invite.teamId),
    db.user.findUnique({ where: { id: userId }, select: { name: true, fullName: true, email: true, emailVerifiedAt: true, phone: true, phoneVerifiedAt: true, address: true, nin: true } }),
  ]);
  return {
    status: inviteStatus(invite, now),
    teamName: team?.name ?? "Team",
    leadFirstName: firstName(team?.lead?.user),
    acceptedAt: invite.acceptedAt,
    decidedAt: invite.decidedAt,
    missing: user ? profileGaps(user) : [],
  };
}

/**
 * Inside the admin promotion transaction: tie the new partner to the invite.
 * Refuses unless this exact account accepted this invite and it still waits.
 */
export async function approveInviteInPromotion(tx: any, input: { reference: string; userId: number; partnerId: number; adminId: number; now: Date }) {
  const invite = await tx.salesTeamInvite.findUnique({
    where: { reference: input.reference },
    select: { id: true, status: true, acceptedUserId: true, teamId: true, team: { select: { status: true } } },
  });
  if (!invite || invite.status !== "ACCEPTED" || invite.acceptedUserId !== input.userId) {
    throw new InviteError("This team invite is no longer waiting for approval for this person.");
  }
  if (invite.team?.status !== "ACTIVE") throw new InviteError("The inviting team is no longer active.");
  const changed = await tx.salesTeamInvite.updateMany({
    where: { id: invite.id, status: "ACCEPTED" },
    data: { status: "APPROVED", partnerId: input.partnerId, decidedAt: input.now, decidedById: input.adminId },
  });
  if (changed.count !== 1) throw new InviteError("This team invite was changed by another request.");
  return invite;
}

/**
 * Inside contract activation: an approved recruit joins the inviting team.
 * Returns what to notify, or null when there is nothing to join (or the team
 * can no longer take them; the invite then records why).
 */
export async function joinTeamOnActivation(tx: any, input: { partnerId: number; adminId: number; now: Date }) {
  const invite = await tx.salesTeamInvite.findFirst({
    where: { partnerId: input.partnerId, status: "APPROVED" },
    select: { id: true, teamId: true, team: { select: { name: true, status: true, lead: { select: { userId: true } } } } },
  });
  if (!invite) return null;
  const refuse = async (note: string) => {
    await tx.salesTeamInvite.update({ where: { id: invite.id }, data: { status: "REJECTED", decisionNote: note, decidedAt: input.now } });
    return null;
  };
  if (invite.team?.status !== "ACTIVE") return refuse("The team was disbanded before the agreement was activated.");
  const [inTeam, leads, members] = await Promise.all([
    tx.salesTeamMember.findUnique({ where: { activeKey: input.partnerId }, select: { id: true } }),
    tx.salesTeam.findUnique({ where: { leadPartnerId: input.partnerId }, select: { status: true } }),
    tx.salesTeamMember.count({ where: { teamId: invite.teamId, activeKey: { not: null } } }),
  ]);
  if (inTeam || leads?.status === "ACTIVE") return refuse("The partner was already in a team when the agreement was activated.");
  if (members >= MAX_TEAM_SIZE) return refuse(`The team already had ${MAX_TEAM_SIZE} members.`);
  await tx.salesTeamMember.create({
    data: { teamId: invite.teamId, salesPartnerId: input.partnerId, activeKey: input.partnerId, addedById: input.adminId, joinedAt: input.now },
  });
  await tx.salesTeamInvite.update({ where: { id: invite.id }, data: { status: "JOINED", joinedAt: input.now } });
  return { teamName: invite.team.name, leadUserId: invite.team.lead.userId };
}
