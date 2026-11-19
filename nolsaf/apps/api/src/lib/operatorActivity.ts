/**
 * Tour operator behaviour: the detailed account trail an administrator reads
 * before trusting, ranking, paying or suspending an operator. The operator
 * counterpart of the traveller Behaviour tab (GET /admin/users/:id/behaviour),
 * built from records the platform already writes. No browsing telemetry.
 *
 * Three parts:
 *  - engagement: sign-ins, last seen, devices, support sessions;
 *  - signals: graded CLEAN / WATCH / ACTION, each with the threshold that
 *    produced its grade, rolled up into one band;
 *  - timeline: every dated event (sign-ins, security changes, payout
 *    destination added, verified or changed, agreement, packages, trips,
 *    payout claims, admin actions), newest first.
 *
 * Payout destination numbers are masked. Audit details are reduced to a short
 * whitelist so no secret or full account number ever reaches the page.
 */
import { prisma } from "@nolsaf/prisma";
import { describeDevice } from "./loginDevice.js";
import { isAdvanceRow } from "./tourPayouts.js";
import { offsetAppliedOf } from "./tourRecoveryOffset.js";

export type Severity = "CLEAN" | "WATCH" | "ACTION";
export type ActivityCategory =
  | "SIGN_IN" | "SECURITY" | "PAYOUT_DETAILS" | "PAYOUTS" | "TRIPS" | "PROFILE" | "ADMIN" | "OTHER";

export type ActivityEvent = {
  at: string;
  category: ActivityCategory;
  label: string;
  detail: string | null;
  tone: "good" | "warn" | "bad" | "neutral";
  actor: "OPERATOR" | "ADMIN" | "SYSTEM" | "TRAVELLER";
  actorName: string | null;
  device: string | null;
  ip: string | null;
};

export type Signal = {
  key: string;
  label: string;
  value: string;
  detail: string;
  threshold: string;
  severity: Severity;
};

const DAY_MS = 86_400_000;
const PAID = new Set(["DISBURSED", "PAID"]);
/** A payout claimed this soon after its destination appeared or changed is the classic takeover pattern. */
const CHANGE_BEFORE_CLAIM_HOURS = 72;

const rank = (s: Severity) => (s === "ACTION" ? 2 : s === "WATCH" ? 1 : 0);
export const worst = (list: Severity[]): Severity => list.reduce<Severity>((w, s) => (rank(s) > rank(w) ? s : w), "CLEAN");

/** Higher is worse. */
export function gradeUp(value: number, watchAt: number, actionAt: number): Severity {
  if (value >= actionAt) return "ACTION";
  if (value >= watchAt) return "WATCH";
  return "CLEAN";
}

/** Lower is worse (for rates where good behaviour is high). */
export function gradeDown(value: number, watchBelow: number, actionBelow: number): Severity {
  if (value < actionBelow) return "ACTION";
  if (value < watchBelow) return "WATCH";
  return "CLEAN";
}

const upper = (v: unknown) => String(v ?? "").trim().toUpperCase();
const iso = (d: Date | string) => new Date(d).toISOString();

export function maskAccount(value: string | null | undefined): string {
  const text = String(value ?? "").replace(/\s+/g, "");
  if (!text) return "";
  return `****${text.slice(-4)}`;
}

/** Plain-language name for an audit action the operator performed. */
const ACTION_MAP: Record<string, { category: ActivityCategory; label: string; tone?: ActivityEvent["tone"] }> = {
  USER_LOGIN: { category: "SIGN_IN", label: "Signed in" },
  USER_LOGOUT: { category: "SIGN_IN", label: "Signed out" },
  NO4P_OTP_VERIFY_FAILED: { category: "SIGN_IN", label: "Wrong verification code", tone: "warn" },
  NO4P_OTP_SENT: { category: "SIGN_IN", label: "Verification code sent" },
  SIGN_IN_ALERT_SESSION_REVOKED: { category: "SECURITY", label: "Signed out a device from the new sign-in email", tone: "warn" },
  LOGIN_DEVICE_FORGOTTEN: { category: "SECURITY", label: "Removed a recognised device" },
  USER_SESSION_REVOKE: { category: "SECURITY", label: "Signed out one session" },
  USER_SESSION_REVOKE_OTHERS: { category: "SECURITY", label: "Signed out all other sessions" },
  USER_PASSWORD_CHANGE: { category: "SECURITY", label: "Changed password", tone: "warn" },
  USER_2FA_ENABLED: { category: "SECURITY", label: "Turned on two-step verification", tone: "good" },
  USER_2FA_DISABLED: { category: "SECURITY", label: "Turned off two-step verification", tone: "bad" },
  USER_2FA_CODES_REGEN: { category: "SECURITY", label: "Made new backup codes" },
  CONTACT_CHANGE_REQUESTED: { category: "SECURITY", label: "Asked to change email or phone" },
  CONTACT_CHANGE_AUTHORIZED: { category: "SECURITY", label: "Approved an email or phone change" },
  CONTACT_CHANGED: { category: "SECURITY", label: "Changed email or phone", tone: "warn" },
  USER_PAYOUT_DESTINATION_LOOKED_UP: { category: "PAYOUT_DETAILS", label: "Checked a payout number with the provider" },
  USER_PAYOUT_LOOKUP_MISMATCH: { category: "PAYOUT_DETAILS", label: "Payout number belongs to someone else", tone: "bad" },
  USER_PAYOUT_DESTINATION_VERIFIED: { category: "PAYOUT_DETAILS", label: "Saved a verified payout destination", tone: "warn" },
  USER_PROFILE_UPDATE: { category: "PROFILE", label: "Edited account profile" },
  USER_DOCUMENT_UPSERT: { category: "PROFILE", label: "Uploaded a document" },
  SUBMIT_OPERATOR_PROFILE: { category: "PROFILE", label: "Submitted the company profile for review" },
  AGENT_CONTRACT_SIGNED: { category: "PROFILE", label: "Signed the partnership agreement", tone: "good" },
  AGENT_TOUR_PACKAGE_REMOVED: { category: "PROFILE", label: "Removed a tour package" },
  AGENT_TOUR_PACKAGE_RESTORED: { category: "PROFILE", label: "Restored a tour package" },
  AGENT_TOUR_ADVANCE_CLAIMED: { category: "PAYOUTS", label: "Claimed a trip advance" },
  USER_DATA_EXPORT: { category: "SECURITY", label: "Downloaded a copy of account data" },
  USER_ACCOUNT_DELETE: { category: "SECURITY", label: "Asked to delete the account", tone: "bad" },
};

const prettyCode = (code: string) => code.replace(/_/g, " ").toLowerCase().replace(/^\S/, (c) => c.toUpperCase());

/** Only these audit fields are shown, and account-like values are masked. */
function safeDetail(after: unknown, action: string): string | null {
  if (!after || typeof after !== "object") return null;
  const a = after as Record<string, any>;
  const parts: string[] = [];
  if (action === "USER_LOGIN") {
    if (a.success === false) parts.push(`Failed: ${String(a.error || "wrong details").replace(/_/g, " ")}`);
    if (a.loginMethod) parts.push(`by ${String(a.loginMethod).replace(/_/g, " ").toLowerCase()}`);
    if (a.mfa) parts.push("with two-step code");
    return parts.join(", ") || null;
  }
  for (const key of ["provider", "type", "method", "reason", "via", "version"]) {
    if (typeof a[key] === "string" && a[key].trim()) parts.push(`${key}: ${a[key].trim().slice(0, 60)}`);
  }
  for (const key of ["accountNumber", "msisdn", "phone"]) {
    if (typeof a[key] === "string" && a[key].trim()) parts.push(`${key === "accountNumber" ? "account" : key}: ${maskAccount(a[key])}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function windowFor(query: { from?: string; to?: string; days?: string }, joinedAt: Date) {
  const now = new Date();
  const parse = (raw?: string) => {
    if (!raw) return null;
    const d = new Date(String(raw));
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const days = Number(query.days);
  let from = parse(query.from);
  let to = parse(query.to);
  if (!from && Number.isFinite(days) && days > 0) from = new Date(now.getTime() - Math.min(days, 3650) * DAY_MS);
  if (!from) from = new Date(Math.max(joinedAt.getTime(), now.getTime() - 365 * DAY_MS));
  if (!to) to = now;
  to = new Date(to);
  if (query.to) to.setHours(23, 59, 59, 999);
  return { from, to };
}

export class OperatorNotFound extends Error {}

export async function buildOperatorActivity(agentId: number, query: { from?: string; to?: string; days?: string }) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, userId: true, status: true, suspendedAt: true, createdAt: true, user: { select: { isDisabled: true, twoFactorEnabled: true, twoFactorMethod: true } } },
  });
  if (!agent) throw new OperatorNotFound("Operator not found");
  const { from, to } = windowFor(query, agent.createdAt);
  if (from > to) throw new RangeError("from must be before to");
  const between = { gte: from, lte: to };
  const userId = agent.userId;

  // Package go-live is the admin profile approval and removals are the
  // operator's own audit rows, both already in the trail below. The
  // TourPackage reporting copy is not a source of events.
  const [ownAudits, adminAudits, adminLogs, sessions, payoutAccounts, passkeys, bookings, payoutRows, recoveries, cases] = await Promise.all([
    prisma.auditLog.findMany({
      where: { actorId: userId, createdAt: between },
      select: { action: true, afterJson: true, ip: true, ua: true, actorRole: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 1500,
    }),
    prisma.adminAudit.findMany({
      where: { targetUserId: userId, createdAt: between },
      select: { action: true, details: true, createdAt: true, admin: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.auditLog.findMany({
      where: { entity: `agent:${agentId}`, actorRole: "ADMIN", createdAt: between },
      select: { action: true, createdAt: true, actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.session.findMany({
      where: { userId },
      select: { createdAt: true, lastSeenAt: true, revokedAt: true },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.payoutAccount.findMany({
      where: { userId },
      select: {
        id: true, type: true, provider: true, accountName: true, accountNumber: true, isVerified: true, verifiedAt: true,
        destinationChangedAt: true, isDefault: true, isActive: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.passkey.findMany({ where: { userId }, select: { createdAt: true } }).catch(() => [] as { createdAt: Date }[]),
    prisma.tourBooking.findMany({
      where: { operatorAgentId: agentId, OR: [{ createdAt: between }, { confirmedAt: between }, { operatorCompletedAt: between }, { canceledAt: between }] },
      select: {
        bookingCode: true, status: true, paymentStatus: true, paidAt: true, confirmedAt: true, operatorCompletedAt: true,
        customerConfirmedAt: true, canceledAt: true, createdAt: true, metadata: true,
      },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.tourFinancialTransaction.findMany({
      where: { kind: "PAYOUT", booking: { operatorAgentId: agentId }, createdAt: between },
      select: { status: true, amount: true, currency: true, metadata: true, createdAt: true, booking: { select: { bookingCode: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tourFinancialTransaction.findMany({
      where: { kind: "PAYOUT_RECOVERY", status: "PENDING", booking: { operatorAgentId: agentId } },
      select: { amount: true, metadata: true, createdAt: true },
    }),
    prisma.tourCase.findMany({
      where: { booking: { operatorAgentId: agentId }, createdAt: between },
      select: { type: true, status: true, severity: true, title: true, createdAt: true, booking: { select: { bookingCode: true } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const timeline: ActivityEvent[] = [];
  const push = (e: Omit<ActivityEvent, "device" | "ip"> & { device?: string | null; ip?: string | null }) =>
    timeline.push({ device: null, ip: null, ...e });
  const inWindow = (d: Date | null | undefined) => Boolean(d) && d!.getTime() >= from.getTime() && d!.getTime() <= to.getTime();

  // Operator's own recorded actions. Support sessions write as OWNER:IMP / AGENT:IMP, which the operator did not do.
  for (const row of ownAudits) {
    const action = upper(row.action);
    const mapped = ACTION_MAP[action];
    const after = row.afterJson && typeof row.afterJson === "object" ? (row.afterJson as Record<string, any>) : null;
    const failedLogin = action === "USER_LOGIN" && after?.success === false;
    const viaSupport = String(row.actorRole || "").endsWith(":IMP");
    push({
      at: iso(row.createdAt),
      category: mapped?.category ?? "OTHER",
      label: failedLogin ? "Failed sign-in" : mapped?.label ?? prettyCode(action),
      detail: [viaSupport ? "During an admin support session" : null, safeDetail(row.afterJson, action)].filter(Boolean).join(" · ") || null,
      tone: failedLogin ? "bad" : mapped?.tone ?? "neutral",
      actor: viaSupport ? "ADMIN" : "OPERATOR",
      actorName: null,
      device: row.ua ? describeDevice(row.ua) : null,
      ip: row.ip ? String(row.ip).replace(/^::ffff:/i, "") : null,
    });
  }

  for (const row of adminAudits) {
    const action = upper(row.action);
    push({
      at: iso(row.createdAt),
      category: "ADMIN",
      label: /IMPERSONATE_ISSUE/.test(action) ? "Admin opened a read-only support session"
        : /IMPERSONATE_END/.test(action) ? "Admin ended the support session"
        : action === "APPROVE_OPERATOR_PROFILE" ? "Admin approved the profile; its packages went live"
        : action === "REJECT_OPERATOR_PROFILE" ? "Admin asked for profile changes"
        : prettyCode(action),
      detail: typeof row.details === "string" ? row.details.slice(0, 200) : null,
      tone: /SUSPEND|REJECT/.test(action) ? "bad" : /RESTORE|APPROVE/.test(action) ? "good" : "neutral",
      actor: "ADMIN",
      actorName: row.admin?.name ?? row.admin?.email ?? null,
    });
  }
  for (const row of adminLogs) {
    // AGENT_IMPERSONATE_ISSUE is written to both logs; keep one.
    if (/IMPERSONATE/.test(upper(row.action))) continue;
    push({
      at: iso(row.createdAt), category: "ADMIN", label: prettyCode(upper(row.action)), detail: null,
      tone: /SUSPEND|REJECT/.test(upper(row.action)) ? "bad" : /RESTORE|APPROVE/.test(upper(row.action)) ? "good" : "neutral",
      actor: "ADMIN", actorName: row.actor?.name ?? row.actor?.email ?? null,
    });
  }

  // Payout destinations: when each was added, name-verified, changed or switched off.
  const destinationMoments: Date[] = [];
  for (const acc of payoutAccounts) {
    const where = `${acc.provider} ${maskAccount(acc.accountNumber)} (${acc.accountName})`;
    destinationMoments.push(acc.createdAt);
    if (inWindow(acc.createdAt)) push({ at: iso(acc.createdAt), category: "PAYOUT_DETAILS", label: "Added a payout destination", detail: where, tone: "warn", actor: "OPERATOR", actorName: null });
    if (acc.verifiedAt && inWindow(acc.verifiedAt)) push({ at: iso(acc.verifiedAt), category: "PAYOUT_DETAILS", label: "Payout destination name-verified", detail: where, tone: "good", actor: "SYSTEM", actorName: null });
    if (acc.destinationChangedAt && acc.destinationChangedAt.getTime() - acc.createdAt.getTime() > 60_000) {
      destinationMoments.push(acc.destinationChangedAt);
      if (inWindow(acc.destinationChangedAt)) push({ at: iso(acc.destinationChangedAt), category: "PAYOUT_DETAILS", label: "Changed a payout destination", detail: where, tone: "bad", actor: "OPERATOR", actorName: null });
    }
    if (!acc.isActive && inWindow(acc.updatedAt)) push({ at: iso(acc.updatedAt), category: "PAYOUT_DETAILS", label: "Payout destination switched off", detail: where, tone: "neutral", actor: "OPERATOR", actorName: null });
  }
  for (const pk of passkeys) {
    if (inWindow(pk.createdAt)) push({ at: iso(pk.createdAt), category: "SECURITY", label: "Added a passkey", detail: null, tone: "good", actor: "OPERATOR", actorName: null });
  }

  for (const b of bookings) {
    const code = b.bookingCode;
    if (inWindow(b.createdAt)) push({ at: iso(b.createdAt), category: "TRIPS", label: "Received a booking", detail: code, tone: "neutral", actor: "TRAVELLER", actorName: null });
    if (b.confirmedAt && inWindow(b.confirmedAt)) push({ at: iso(b.confirmedAt), category: "TRIPS", label: "Confirmed a booking", detail: code, tone: "neutral", actor: "OPERATOR", actorName: null });
    const pickup = (b.metadata as any)?.pickupValidation;
    if (pickup?.validated && pickup?.validatedAt && inWindow(new Date(pickup.validatedAt))) {
      push({ at: iso(pickup.validatedAt), category: "TRIPS", label: "Checked pickup with the traveller's code", detail: code, tone: "good", actor: "OPERATOR", actorName: null });
    }
    if (b.operatorCompletedAt && inWindow(b.operatorCompletedAt)) push({ at: iso(b.operatorCompletedAt), category: "TRIPS", label: "Marked a trip finished", detail: code, tone: "neutral", actor: "OPERATOR", actorName: null });
    if (b.customerConfirmedAt && inWindow(b.customerConfirmedAt)) push({ at: iso(b.customerConfirmedAt), category: "TRIPS", label: "Traveller confirmed the trip", detail: code, tone: "good", actor: "TRAVELLER", actorName: null });
    if (b.canceledAt && inWindow(b.canceledAt)) push({ at: iso(b.canceledAt), category: "TRIPS", label: "Booking cancelled", detail: code, tone: "warn", actor: "SYSTEM", actorName: null });
  }
  for (const c of cases) {
    push({ at: iso(c.createdAt), category: "TRIPS", label: `Case opened: ${prettyCode(upper(c.type))}`, detail: [c.booking?.bookingCode, c.title].filter(Boolean).join(" · "), tone: upper(c.severity) === "HIGH" || upper(c.severity) === "CRITICAL" ? "bad" : "warn", actor: "SYSTEM", actorName: null });
  }

  // Payout claims, flagged when the destination appeared or changed just before.
  let claimsSoonAfterChange = 0;
  for (const p of payoutRows) {
    const tranche = isAdvanceRow(p.metadata) ? "advance" : "balance";
    const recentChange = destinationMoments.some((d) => {
      const gap = p.createdAt.getTime() - d.getTime();
      return gap >= 0 && gap <= CHANGE_BEFORE_CLAIM_HOURS * 3_600_000;
    });
    if (recentChange) claimsSoonAfterChange += 1;
    push({
      at: iso(p.createdAt),
      category: "PAYOUTS",
      label: `Claimed a ${tranche} payout`,
      detail: [p.booking?.bookingCode, `${p.currency} ${Number(p.amount).toLocaleString("en-US")}`, prettyCode(upper(p.status)),
        recentChange ? `payout destination added or changed within ${CHANGE_BEFORE_CLAIM_HOURS} hours before` : null].filter(Boolean).join(" · "),
      tone: recentChange || upper(p.status) === "REJECTED" ? "bad" : PAID.has(upper(p.status)) ? "good" : "neutral",
      actor: "OPERATOR",
      actorName: null,
    });
  }

  timeline.sort((a, b) => b.at.localeCompare(a.at));

  // ── Engagement ──
  const logins = ownAudits.filter((r) => upper(r.action) === "USER_LOGIN" && !String(r.actorRole || "").endsWith(":IMP"));
  const okLogins = logins.filter((r) => (r.afterJson as any)?.success !== false);
  const failedLogins = logins.length - okLogins.length + ownAudits.filter((r) => upper(r.action) === "NO4P_OTP_VERIFY_FAILED").length;
  const devices = new Set(okLogins.map((r) => String(r.ua || "").trim()).filter(Boolean));
  const ips = new Set(okLogins.map((r) => String(r.ip || "").trim()).filter(Boolean));
  const supportSessions = adminAudits.filter((r) => /IMPERSONATE_ISSUE/.test(upper(r.action))).length;
  const lastSeen = (sessions as Array<{ lastSeenAt: Date }>).reduce((m: Date | null, s) => (!m || s.lastSeenAt > m ? s.lastSeenAt : m), null as Date | null);

  // ── Signals ──
  const destinationChanges = payoutAccounts.filter((a) => inWindow(a.createdAt)).length
    + payoutAccounts.filter((a) => a.destinationChangedAt && a.destinationChangedAt.getTime() - a.createdAt.getTime() > 60_000 && inWindow(a.destinationChangedAt)).length;
  const mismatches = ownAudits.filter((r) => upper(r.action) === "USER_PAYOUT_LOOKUP_MISMATCH").length;
  const credentialChanges = ownAudits.filter((r) => /USER_PASSWORD_CHANGE|^CONTACT_CHANGED$|USER_2FA_DISABLED/.test(upper(r.action))).length;
  const paid = bookings.filter((b) => upper(b.paymentStatus) === "PAID" || b.paidAt);
  const cancelledAfterPay = paid.filter((b) => /CANCEL|REFUND/.test(upper(b.status))).length;
  const started = bookings.filter((b) => ["IN_PROGRESS", "OPERATOR_COMPLETED", "COMPLETED"].includes(upper(b.status)));
  const pickupChecked = started.filter((b) => (b.metadata as any)?.pickupValidation?.validated === true).length;
  const openCases = cases.filter((c) => ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW"].includes(upper(c.status))).length;
  const rejectedClaims = payoutRows.filter((p) => upper(p.status) === "REJECTED").length;
  const recoveryOwed = recoveries.reduce((s, r) => s + Math.max(0, Number(r.amount) - offsetAppliedOf(r.metadata)), 0);
  const oldestRecovery = (recoveries as Array<{ createdAt: Date }>).reduce((m: Date | null, r) => (!m || r.createdAt < m ? r.createdAt : m), null as Date | null);
  const strongSecondFactor = passkeys.length > 0 || (agent.user?.twoFactorEnabled && upper(agent.user?.twoFactorMethod) === "TOTP");

  const pctText = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "No data");
  const signals: Signal[] = [
    {
      key: "claimAfterChange", label: "Payout claimed right after a destination change",
      value: String(claimsSoonAfterChange), detail: `Claims made within ${CHANGE_BEFORE_CLAIM_HOURS} hours of a payout destination being added or changed`,
      threshold: "Watch at 1, action at 2", severity: gradeUp(claimsSoonAfterChange, 1, 2),
    },
    {
      key: "destinationChanges", label: "Payout destination changes",
      value: String(destinationChanges), detail: `${payoutAccounts.length} destination(s) on record, ${payoutAccounts.filter((a) => a.isActive).length} active`,
      threshold: "Watch at 2, action at 4", severity: gradeUp(destinationChanges, 2, 4),
    },
    {
      key: "nameMismatch", label: "Payout number belongs to someone else",
      value: String(mismatches), detail: "Provider name checks that did not match the account holder",
      threshold: "Watch at 1, action at 3", severity: gradeUp(mismatches, 1, 3),
    },
    {
      key: "failedSignIns", label: "Failed sign-ins",
      value: String(failedLogins), detail: "Wrong passwords and wrong verification codes",
      threshold: "Watch at 5, action at 15", severity: gradeUp(failedLogins, 5, 15),
    },
    {
      key: "devices", label: "Devices used",
      value: String(devices.size), detail: `${ips.size} distinct network address(es) across ${okLogins.length} sign-in(s)`,
      threshold: "Watch at 4, action at 8", severity: gradeUp(devices.size, 4, 8),
    },
    {
      key: "credentialChanges", label: "Credential changes",
      value: String(credentialChanges), detail: "Password, email or phone changes, or two-step turned off",
      threshold: "Watch at 2, action at 4", severity: gradeUp(credentialChanges, 2, 4),
    },
    {
      key: "secondFactor", label: "Passkey or authenticator",
      value: strongSecondFactor ? "Yes" : "No", detail: strongSecondFactor ? "Protected against SIM-swap sign-ins" : "Only SMS code or password protects this account",
      threshold: "Watch when missing", severity: strongSecondFactor ? "CLEAN" : "WATCH",
    },
    {
      key: "cancellations", label: "Cancelled after payment",
      value: pctText(cancelledAfterPay, paid.length), detail: `${cancelledAfterPay} of ${paid.length} paid booking(s)`,
      threshold: "Watch at 15%, action at 30%, once there are 5 paid bookings",
      severity: paid.length >= 5 ? gradeUp(cancelledAfterPay / paid.length, 0.15, 0.3) : "CLEAN",
    },
    {
      key: "pickup", label: "Pickup checked with the traveller",
      value: pctText(pickupChecked, started.length), detail: `${pickupChecked} of ${started.length} trip(s) that started`,
      threshold: "Watch below 70%, action below 40%, once 5 trips have started",
      severity: started.length >= 5 ? gradeDown(pickupChecked / started.length, 0.7, 0.4) : "CLEAN",
    },
    {
      key: "openCases", label: "Open cases",
      value: String(openCases), detail: `${cases.length} case(s) raised in this window`,
      threshold: "Watch at 1, action at 3", severity: gradeUp(openCases, 1, 3),
    },
    {
      key: "rejectedClaims", label: "Payout claims rejected",
      value: String(rejectedClaims), detail: `${payoutRows.length} claim(s) in this window`,
      threshold: "Watch at 2, action at 4", severity: gradeUp(rejectedClaims, 2, 4),
    },
    {
      key: "recovery", label: "Money owed to NoLSAF",
      value: `TZS ${Math.round(recoveryOwed).toLocaleString("en-US")}`,
      detail: oldestRecovery ? `Oldest open recovery since ${oldestRecovery.toISOString().slice(0, 10)}` : "Nothing owed",
      threshold: "Watch when anything is owed, action when owed for over 60 days",
      severity: recoveryOwed <= 0 ? "CLEAN" : oldestRecovery && Date.now() - oldestRecovery.getTime() > 60 * DAY_MS ? "ACTION" : "WATCH",
    },
  ];

  const restricted = upper(agent.status) === "SUSPENDED" || Boolean(agent.user?.isDisabled);
  const band: Severity = restricted ? "ACTION" : worst(signals.map((s) => s.severity));

  return {
    window: { from: from.toISOString(), to: to.toISOString() },
    band,
    restricted,
    engagement: {
      joinedAt: agent.createdAt.toISOString(),
      lastSignInAt: okLogins[0]?.createdAt ? iso(okLogins[0].createdAt) : null,
      lastSeenAt: lastSeen ? iso(lastSeen) : null,
      signIns: okLogins.length,
      failedSignIns: failedLogins,
      devices: devices.size,
      networks: ips.size,
      activeSessions: sessions.filter((s) => !s.revokedAt).length,
      supportSessions,
    },
    signals,
    payoutDestinations: payoutAccounts.map((a) => ({
      id: a.id, type: a.type, provider: a.provider, accountName: a.accountName, accountNumberMasked: maskAccount(a.accountNumber),
      isVerified: a.isVerified, isDefault: a.isDefault, isActive: a.isActive,
      addedAt: iso(a.createdAt), verifiedAt: a.verifiedAt ? iso(a.verifiedAt) : null,
      changedAt: a.destinationChangedAt && a.destinationChangedAt.getTime() - a.createdAt.getTime() > 60_000 ? iso(a.destinationChangedAt) : null,
      updatedAt: iso(a.updatedAt),
    })),
    timeline: timeline.slice(0, 1500),
    timelineTruncated: timeline.length > 1500,
  };
}

export type OperatorActivity = Awaited<ReturnType<typeof buildOperatorActivity>>;
