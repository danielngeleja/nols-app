import { describeDevice } from "./loginDevice.js";
import type { Prisma } from "@prisma/client";
import { gradeUp, worst, type Severity } from "./operatorActivity.js";

const actions = {
  USER_LOGIN: ["sign-in", "Signed in"],
  USER_LOGOUT: ["sign-in", "Signed out"],
  NO4P_OTP_VERIFY_FAILED: ["sign-in", "Verification code rejected"],
  USER_PASSWORD_CHANGE: ["security", "Password changed"],
  USER_PASSWORD_CHANGE_FAILED: ["security", "Password change rejected"],
  ACCOUNT_PASSWORD_RESET: ["security", "Password reset"],
  ACCOUNT_PASSWORD_CREATED: ["security", "Password set"],
  USER_2FA_ENABLED: ["security", "Two-step verification enabled"],
  USER_2FA_DISABLED: ["security", "Two-step verification disabled"],
  USER_2FA_CODES_REGEN: ["security", "Backup codes replaced"],
  CONTACT_CHANGE_REQUESTED: ["security", "Contact change requested"],
  CONTACT_CHANGE_AUTHORIZED: ["security", "Contact change authorized"],
  CONTACT_CHANGED: ["security", "Security contact changed"],
  LOGIN_DEVICE_FORGOTTEN: ["security", "Recognised device removed"],
  USER_SESSION_REVOKE: ["security", "Session signed out"],
  USER_SESSION_REVOKE_OTHERS: ["security", "Other sessions signed out"],
  SIGN_IN_ALERT_SESSION_REVOKED: ["security", "Session revoked from sign-in alert"],
  USER_DATA_EXPORT: ["security", "Account data exported"],
  USER_PAYOUT_UPDATE: ["payout", "Payout details updated"],
  USER_PAYOUT_DESTINATION_LOOKED_UP: ["payout", "Payout destination checked"],
  USER_PAYOUT_LOOKUP_MISMATCH: ["payout", "Payout verification rejected"],
  USER_PAYOUT_DESTINATION_VERIFIED: ["payout", "Verified payout destination saved"],
  USER_PROFILE_UPDATE: ["profile", "Account profile updated"],
  USER_DOCUMENT_UPSERT: ["profile", "Account document updated"],
} as const;

type ActivityAction = keyof typeof actions;
export const ownerActivityCategories = ["all", "payout", "security", "sign-in", "profile"] as const;
export type OwnerActivityCategory = typeof ownerActivityCategories[number];

export function ownerActivityActions(category: OwnerActivityCategory) {
  return (Object.keys(actions) as ActivityAction[]).filter((action) => category === "all" || actions[action][0] === category);
}

export function ownerActivityScope(id: number): Prisma.AuditLogWhereInput {
  return { OR: [
    { entity: `user:${id}` },
    { entity: "USER", entityId: id },
    { actorId: id, action: { in: ["USER_SESSION_REVOKE", "SIGN_IN_ALERT_SESSION_REVOKED", "NO4P_OTP_VERIFY_FAILED"] } },
  ] };
}

export const ownerBehaviourDays = 30;
const credentialActions = ["USER_PASSWORD_CHANGE", "ACCOUNT_PASSWORD_RESET", "USER_2FA_DISABLED"];
export const ownerBehaviourEventFilter: Prisma.AuditLogWhereInput = { OR: [
  { action: { in: [...credentialActions, "USER_PAYOUT_LOOKUP_MISMATCH", "NO4P_OTP_VERIFY_FAILED"] } },
  { action: "USER_PAYOUT_DESTINATION_VERIFIED", afterJson: { path: "$.change", equals: "changed" } },
  { action: "USER_LOGIN", afterJson: { path: "$.success", equals: false } },
  { action: "CONTACT_CHANGED", afterJson: { path: "$.actualChange", equals: true } },
] };

export function ownerBehaviourScore(counts: ReadonlyMap<string, number>, strongSecondFactor: boolean, hasRecentActivity: boolean) {
  const count = (action: string) => counts.get(action) ?? 0;
  function signal(key: string, label: string, value: number, watchAt: number, reviewAt: number, points: [number, number], reason: string) {
    const severity = gradeUp(value, watchAt, reviewAt);
    return {
      key, label, value: String(value), severity, reason,
      rule: `Watch at ${watchAt} · Review at ${reviewAt}`,
      deduction: severity === "ACTION" ? points[1] : severity === "WATCH" ? points[0] : 0,
    };
  }
  const signals = [
    signal("destination", "Payout destination replacements", count("USER_PAYOUT_DESTINATION_VERIFIED"), 2, 4, [10, 25],
      "Replacing an existing destination counts. Adding the first account or reverifying the same one does not."),
    signal("mismatch", "Payout verification mismatches", count("USER_PAYOUT_LOOKUP_MISMATCH"), 1, 3, [12, 30],
      "Provider checks that returned mismatched account details."),
    signal("signIn", "Failed sign-ins", count("USER_LOGIN") + count("NO4P_OTP_VERIFY_FAILED"), 5, 15, [8, 18],
      "Recorded password and verification-code failures tied to the account."),
    signal("credentials", "Security changes", [...credentialActions, "CONTACT_CHANGED"].reduce((total, action) => total + count(action), 0), 2, 4, [8, 15],
      "Password changes or resets, email or phone changes, and disabling two-step verification."),
    {
      key: "secondFactor", label: "Passkey or authenticator", value: strongSecondFactor ? "On" : "Missing",
      severity: (strongSecondFactor ? "CLEAN" : "WATCH") as Severity,
      reason: "Uses the account’s current sign-in settings.", rule: "Watch when missing",
      deduction: strongSecondFactor ? 0 : 12,
    },
  ];
  return {
    days: ownerBehaviourDays,
    score: hasRecentActivity ? 100 - signals.reduce((total, item) => total + item.deduction, 0) : null,
    band: hasRecentActivity ? worst(signals.map((item) => item.severity)) : "NO_DATA" as const,
    signals,
  };
}

export function payoutAccountEnding(value: unknown) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^(?:\d{5,}|[*•]+\s*\d{4})$/.test(text) ? text.slice(-4) : null;
}

function providerName(value: unknown) {
  return typeof value === "string" && /^[A-Z][A-Z _-]{1,29}$/i.test(value.trim()) ? value.trim() : null;
}

export function ownerActivityEvent(row: {
  id: bigint; actorId: number | null; actorRole: string | null; action: string;
  afterJson: unknown; ip: string | null; ua: string | null; createdAt: Date;
}, ownerId: number) {
  if (!Object.prototype.hasOwnProperty.call(actions, row.action)) return null;
  const description = actions[row.action as ActivityAction];
  const [category, defaultLabel] = description;
  const data = row.afterJson && typeof row.afterJson === "object" ? row.afterJson as Record<string, unknown> : {};
  let label: string = defaultLabel;
  let detail: string | null = null;
  const failed = (row.action === "USER_LOGIN" && data.success === false) ||
    ["USER_PASSWORD_CHANGE_FAILED", "USER_PAYOUT_LOOKUP_MISMATCH", "NO4P_OTP_VERIFY_FAILED"].includes(row.action);
  if (row.action === "USER_LOGIN" && failed) label = "Sign-in failed";
  if (row.action === "CONTACT_CHANGED") {
    const field = data.field === "email" ? "Email address" : data.field === "phone" ? "Phone number" : "Security contact";
    label = data.actualChange === false ? `${field} verified` : `${field} changed`;
  }
  if (row.action === "USER_PAYOUT_DESTINATION_VERIFIED") {
    if (data.change === "added") label = "Payout destination added";
    if (data.change === "changed") label = "Payout destination changed";
    if (data.change === "reverified") label = "Payout destination reverified";
  }
  if (category === "payout") {
    const ending = payoutAccountEnding(data.accountNumber);
    const previous = payoutAccountEnding(data.previousAccountNumber);
    detail = [providerName(data.provider), ending ? `Ending in ${ending}` : null,
      data.change === "changed" && previous ? `Previously ending in ${previous}` : null].filter(Boolean).join(" · ") || null;
  }
  const actor = row.actorRole?.endsWith(":IMP") ? "Support session"
    : row.actorRole === "ADMIN" ? "Admin"
    : row.actorId === ownerId ? "Owner"
    : row.action === "ACCOUNT_PASSWORD_RESET" || row.action === "ACCOUNT_PASSWORD_CREATED" ? "Email recovery"
    : "System";
  return {
    id: row.id.toString(), category, label, detail, actor,
    tone: failed ? "failed" : category === "security" || row.action === "USER_PAYOUT_DESTINATION_VERIFIED" ? "change" : "neutral",
    createdAt: row.createdAt.toISOString(), ip: row.ip || null,
    device: row.ua ? describeDevice(row.ua) : null,
  };
}
