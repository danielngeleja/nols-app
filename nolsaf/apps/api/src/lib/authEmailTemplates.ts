/**
 * authEmailTemplates.ts
 * ─────────────────────────────────────────────────────────────
 * Auth-related transactional email templates:
 *   - Email address verification
 *   - Password reset
 *   - Welcome (new account)
 */
import { BRAND_TEAL, TEXT_MAIN, TEXT_MUTED, proEmail, proDivider, proButton, proReferenceCard, proDetailRows, proNoteCard } from "./emailBase.js";

// ─── 1. Email verification ────────────────────────────────────────────────────
export function getEmailVerificationEmail(
  name: string,
  verificationUrl: string,
  expiryMinutes = 30
): { subject: string; html: string } {
  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${name}, please confirm your email address to finish securing your NoLSAF account. Tap the button below.</p>
    ${proDivider()}
    ${proButton(verificationUrl, "Verify email", BRAND_TEAL)}
    <p style="margin:14px 0 0;font-size:13px;color:#6b7280;">This link is valid for ${expiryMinutes} minutes. If the button does not work, copy and paste this link into your browser:<br><a href="${verificationUrl}" style="color:${BRAND_TEAL};word-break:break-all;text-decoration:none;">${verificationUrl}</a></p>
    ${proDivider()}
    ${proNoteCard(BRAND_TEAL, "Did not request this", "If you did not create a NoLSAF account, you can safely ignore this email. No changes will be made.")}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Need help? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: "Verify your email address for NoLSAF",
    html: proEmail("Verify your email", body),
  };
}

// ─── 1b. Verification code (OTP) — purpose-aware ──────────────────────────────
/**
 * The same code panel is reused for several flows, but the wording must reflect
 * exactly what the code is for, so the recipient is never confused:
 *   - signup  : confirming a brand-new account
 *   - login   : passwordless sign-in to an existing account
 *   - reset   : password reset by code
 *   - contact : confirming a new email address on an existing account
 */
export type VerificationPurpose = "signup" | "login" | "reset" | "contact" | "data";

const VERIFICATION_COPY: Record<VerificationPurpose, { headline: string; subject: string; intro: string; ignore: string }> = {
  signup: {
    headline: "Confirm your email to get started",
    subject: "Your NoLSAF account verification code",
    intro: "Use the code below to finish creating your NoLSAF account.",
    ignore: "If you did not try to create a NoLSAF account, you can safely ignore this email.",
  },
  login: {
    headline: "Your sign-in code",
    subject: "Your NoLSAF sign-in code",
    intro: "Use the code below to sign in to your NoLSAF account.",
    ignore: "If you did not try to sign in, you can safely ignore this email. Your account stays secure.",
  },
  reset: {
    headline: "Your password reset code",
    subject: "Your NoLSAF password reset code",
    intro: "Use the code below to reset the password on your NoLSAF account.",
    ignore: "If you did not request a password reset, you can safely ignore this email. Your password stays the same.",
  },
  data: {
    headline: "Confirm it is you",
    subject: "Your NoLSAF code to download your data",
    intro: "Someone asked for a copy of the personal data on your NoLSAF account. Use the code below to confirm it was you.",
    ignore: "If you did not ask for a copy of your data, do not share this code and change your password. Nothing is sent without it.",
  },
  contact: {
    headline: "Confirm your email",
    subject: "Confirm your new NoLSAF email",
    intro: "Use the code below to confirm this email address for your NoLSAF account.",
    ignore: "If you did not request this change, you can safely ignore this email. No changes will be made.",
  },
};

export function getVerificationCodeEmail(
  otp: string,
  opts: { purpose?: VerificationPurpose; expiryMinutes?: number } = {}
): { subject: string; html: string } {
  const purpose = opts.purpose ?? "login";
  const expiryMinutes = opts.expiryMinutes ?? 5;
  const c = VERIFICATION_COPY[purpose];

  const body = `
    <p style="margin:0;color:#4b5563;">${c.intro}</p>
    ${proDivider()}
    ${proReferenceCard(
      "Verification code",
      otp,
      `This code expires in ${expiryMinutes} minutes. Never share it with anyone. NoLSAF staff will never ask you for it.`
    )}
    ${proDivider()}
    ${proNoteCard(BRAND_TEAL, "Did not request this", c.ignore)}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Need help? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: c.subject,
    html: proEmail(c.headline, body),
  };
}

// ─── 2. Email change confirmation ────────────────────────────────────────────
export function getEmailChangeConfirmationEmail(
  name: string,
  newEmail: string,
  confirmUrl: string,
  expiryMinutes = 30
): { subject: string; html: string } {
  const AMBER = "#b54708";
  const AMBER_BG = "#fdf6ec";

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${name}, we received a request to change your NoLSAF email address to <strong style="color:#1a1a1a;">${newEmail}</strong>. Confirm it below to make the change.</p>
    ${proDivider()}
    ${proButton(confirmUrl, "Confirm new email", BRAND_TEAL)}
    <p style="margin:14px 0 0;font-size:13px;color:#6b7280;">This link expires in ${expiryMinutes} minutes. If the button does not work, copy and paste this link into your browser:<br><a href="${confirmUrl}" style="color:${BRAND_TEAL};word-break:break-all;text-decoration:none;">${confirmUrl}</a></p>
    ${proDivider()}
    ${proNoteCard(AMBER, "Did not request this", `If you did not ask to change your email, do not confirm. Contact <a href="mailto:support@nolsaf.com" style="color:${AMBER};font-weight:bold;text-decoration:none;">support@nolsaf.com</a> right away.`, AMBER_BG)}
    ${proDivider()}
    <p style="margin:0;color:#1a1a1a;">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: "Confirm your new email address for NoLSAF",
    html: proEmail("Confirm your new email", body),
  };
}

// ─── 3. Password reset ────────────────────────────────────────────────────────
export function getPasswordResetEmail(
  name: string,
  resetUrl: string,
  expiryMinutes = 60
): { subject: string; html: string } {
  const AMBER = "#b54708";
  const AMBER_BG = "#fdf6ec";

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${name}, we received a request to reset the password for your NoLSAF account. If this was you, set a new password below.</p>
    ${proDivider()}
    ${proButton(resetUrl, "Reset password", BRAND_TEAL)}
    <p style="margin:14px 0 0;font-size:13px;color:#6b7280;">This link is valid for ${expiryMinutes} minutes and can be used once. If the button does not work, copy and paste this link into your browser:<br><a href="${resetUrl}" style="color:${BRAND_TEAL};word-break:break-all;text-decoration:none;">${resetUrl}</a></p>
    ${proDivider()}
    ${proNoteCard(AMBER, "Did not request this", "If you did not ask to reset your password, you can safely ignore this email. Your password stays the same.", AMBER_BG)}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">Need help? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: "Reset your NoLSAF password",
    html: proEmail("Reset your password", body),
  };
}

// ─── 3b. Password changed confirmation ───────────────────────────────────────
export interface PasswordChangedEmailData {
  name: string;
  email: string;
  changedAt: Date;
  ipAddress?: string;
  device?: string;
  securityUrl: string;
}

export function getPasswordChangedConfirmationEmail(
  data: PasswordChangedEmailData
): { subject: string; html: string } {
  const RED = "#b42318";
  const RED_BG = "#fdf3f2";
  const fmtDateTime = (d: Date) =>
    d.toUTCString().replace(" GMT", " UTC");

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.name}, the password for your NoLSAF account was just changed. Here are the details of that change.</p>
    ${proDivider()}
    ${proDetailRows(
      "Change details",
      [
        ["Account",    data.email],
        ["Changed at", fmtDateTime(data.changedAt)],
        ["Device",     data.device    || "Unknown"],
        ["IP address", data.ipAddress || "Unknown"],
      ]
    )}
    ${proDivider()}
    ${proNoteCard(
      RED,
      "If this wasn't you",
      `Your account may be at risk. Reset your password immediately using the button below and contact <a href="mailto:support@nolsaf.com" style="color:${RED};font-weight:bold;text-decoration:none;">support@nolsaf.com</a>.`,
      RED_BG
    )}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proButton(data.securityUrl, "Reset password now", RED)}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">If this was you, no action is needed.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Kind regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: "Your NoLSAF password was changed",
    html: proEmail("Your password was changed", body),
  };
}

const escWelcome = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// ─── 4. Welcome — new account ─────────────────────────────────────────────────
export function getWelcomeEmail(
  name: string,
  portalUrl: string,
  role: "CUSTOMER" | "OWNER" | "AGENT" | "DRIVER" = "CUSTOMER"
): { subject: string; html: string } {
  // One brand colour for every role; the role only changes the words and the button.
  const roleConfig: Record<typeof role, { url: string; label: string; message: string }> = {
    CUSTOMER: { url: portalUrl, label: "Start exploring", message: "You can now find stays, tours and transport across Tanzania, and book them in one place." },
    OWNER:    { url: portalUrl, label: "Open your owner dashboard", message: "Your owner account is ready. List your property, manage bookings and follow your earnings from your dashboard." },
    AGENT:    { url: portalUrl, label: "Open your operator portal", message: "Your operator account is active. Publish tour packages, receive bookings and run your trips from the portal." },
    DRIVER:   { url: portalUrl, label: "Open your driver portal", message: "Your driver account is live. Accept transport requests and manage your schedule from the portal." },
  };
  const { url, label, message } = roleConfig[role];
  const safeName = escWelcome(name);

  const body = `
    <p style="margin:0 0 16px;">Hello ${safeName},</p>
    <p style="margin:0 0 16px;">Your NoLSAF account is created and ready to use. ${message}</p>
    <div style="height:6px;font-size:0;line-height:0;">&nbsp;</div>
    ${/^https?:\/\//.test(url) ? proButton(url, label) : ""}
    ${proDivider()}
    <p style="margin:0 0 16px;color:#5f6b69;font-size:14px;">Need help getting started? Write to <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:22px 0 0;color:#1a1a1a;">Karibu,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Welcome to NoLSAF, ${name}`,
    html: proEmail("Welcome to NoLSAF", body),
  };
}

// ─── 5. New sign-in alert ─────────────────────────────────────────────────────

export interface LoginAlertEmailData {
  /** Account display name or email */
  name: string;
  /** Date/time of the sign-in (UTC) */
  loginAt: Date;
  /** IP address of the request */
  ipAddress?: string;
  /** Parsed device/browser string */
  device?: string;
  /** Country name or ISO code derived from request headers */
  country?: string;
  /** URL for the password reset page ("wasn't me" action) */
  resetPasswordUrl: string;
}

export function getLoginAlertEmail(data: LoginAlertEmailData): { subject: string; html: string } {
  const RED = "#b42318";
  const RED_BG = "#fdf3f2";
  const fmtDateTime = (d: Date) =>
    d.toUTCString().replace(" GMT", " UTC");

  const body = `
    <p style="margin:0;color:#4b5563;">Hi ${data.name}, we detected a new sign-in to your NoLSAF account from a device we have not seen before. Please review the details below.</p>
    ${proDivider()}
    ${proDetailRows(
      "Sign-in details",
      [
        ["Date",       fmtDateTime(data.loginAt)],
        ["Device",     data.device    || "Unknown"],
        ["Country",    data.country   || "Unknown"],
        ["IP address", data.ipAddress || "Unknown"],
      ]
    )}
    ${proDivider()}
    ${proNoteCard(
      RED,
      "If this wasn't you",
      `Your account may be at risk. Reset your password immediately using the button below and contact <a href="mailto:support@nolsaf.com" style="color:${RED};font-weight:bold;text-decoration:none;">support@nolsaf.com</a>.`,
      RED_BG
    )}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proButton(data.resetPasswordUrl, "Reset password now", RED)}
    ${proDivider()}
    <p style="margin:0;color:#4b5563;font-size:14px;">If this was you, no action is needed. We will not alert you again for this device.</p>
    <p style="margin:18px 0 0;color:#1a1a1a;">Kind regards,<br><strong>The NoLSAF Team</strong></p>
  `;

  return {
    subject: "New sign-in to your NoLSAF account",
    html: proEmail("New sign-in to your account", body),
  };
}

// ─── Operator and agent lifecycle (pro shell) ─────────────────────────────────
const escOperatorText = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const OP_AMBER = "#b54708";
const OP_RED = "#b42318";
const opP = (html: string, extra = "") => `<p style="margin:0 0 16px;${extra}">${html}</p>`;
const opMuted = (html: string) => opP(html, "color:#5f6b69;font-size:14px;");
const opMail = (email: string) =>
  `<a href="mailto:${escOperatorText(email)}" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">${escOperatorText(email)}</a>`;
const opSignOff = (team: string, closing = "Warm regards") =>
  `<p style="margin:22px 0 0;color:#1a1a1a;">${closing},<br><strong>${team}</strong></p>`;
const opGap = `<div style="height:18px;font-size:0;line-height:0;">&nbsp;</div>`;

/** The one access action on an operator mail: set a password, or open the portal. */
function operatorAccess(data: { setupLink?: string; setupLinkExpiresHours?: number; portalUrl: string; loginUrl: string }, accent: string): string {
  if (data.setupLink) {
    const expiry = data.setupLinkExpiresHours
      ? `<p style="margin:10px 0 0;font-size:13px;color:#5f6b69;">For security, this link expires in ${data.setupLinkExpiresHours} hours.</p>`
      : "";
    return `${proButton(data.setupLink, "Set your password", accent)}${expiry}`;
  }
  return `${proButton(data.portalUrl, "Open your operator portal", accent)}
    <p style="margin:10px 0 0;font-size:13px;color:#5f6b69;">Or sign in at <a href="${escOperatorText(data.loginUrl)}" style="color:${BRAND_TEAL};text-decoration:none;">${escOperatorText(data.loginUrl)}</a></p>`;
}

// ─── 6. Agent account suspension ──────
export function getAgentSuspensionEmail(data: {
  name: string;
  reason: string;
  caseRef: string;
  suspendedAt: string;
  contactEmail?: string;
}): { subject: string; html: string } {
  const contact = data.contactEmail || "hr@nolsaf.com";
  const body = `
    ${opP(`Dear ${escOperatorText(data.name)},`)}
    ${opP(`Your NoLSAF operator account has been <strong style="color:${OP_RED};">temporarily suspended</strong> while we carry out an internal review. During this time you cannot sign in to the operator portal.`)}
    ${proReferenceCard("Case reference", escOperatorText(data.caseRef), "Quote this reference in every message about this review.", OP_AMBER, "#fffaf3")}
    ${opGap}
    ${proDetailRows("", [
      ["Account", escOperatorText(data.name)],
      ["Suspended on", escOperatorText(data.suspendedAt)],
      ["Contact", opMail(contact)],
    ])}
    ${proDivider()}
    ${proNoteCard(OP_AMBER, "What happens next", `
      NoLSAF will review the matter fairly and may contact you for your account of events.<br>
      If no policy was broken, your access is restored and we will email you.<br>
      If a breach is confirmed, further steps may follow under your partner agreement.`, "#fffaf3")}
    ${opGap}
    ${opMuted(`To ask a question or send a written response, write to ${opMail(contact)}.`)}
    ${opSignOff("NoLSAF Compliance", "Regards")}`;

  return {
    subject: `Your NoLSAF operator account is temporarily suspended (Ref: ${data.caseRef})`,
    html: proEmail("Your account is temporarily suspended", body),
  };
}

// ─── 7. Agent account restoration ────
export function getAgentRestorationEmail(data: {
  name: string;
  caseRef: string;
  restoredAt: string;
  notes?: string;
  contactEmail?: string;
}): { subject: string; html: string } {
  const contact = data.contactEmail || "hr@nolsaf.com";
  const notes = data.notes && data.notes.trim()
    ? `${opGap}${proNoteCard(BRAND_TEAL, "Note from NoLSAF", escOperatorText(data.notes).replace(/\n/g, "<br>"))}`
    : "";
  const body = `
    ${opP(`Dear ${escOperatorText(data.name)},`)}
    ${opP(`Our review is complete and your NoLSAF operator account has been <strong style="color:${BRAND_TEAL};">fully restored</strong>. No violation was established, and you can sign in to the operator portal as normal.`)}
    ${proDetailRows("", [
      ["Case reference", escOperatorText(data.caseRef)],
      ["Restored on", escOperatorText(data.restoredAt)],
      ["Contact", opMail(contact)],
    ])}
    ${notes}
    ${opGap}
    ${opMuted(`Thank you for your patience. For any question, write to ${opMail(contact)}.`)}
    ${opSignOff("NoLSAF Compliance", "Welcome back")}`;

  return {
    subject: `Your NoLSAF operator account is restored (Ref: ${data.caseRef})`,
    html: proEmail("Your account is restored", body),
  };
}

// ─── 8. Operator profile review approved ────
export function getOperatorProfileApprovedEmail(data: {
  name: string;
  companyName?: string;
  portalUrl: string;
  loginUrl: string;
  setupLink?: string;
  setupLinkExpiresHours?: number;
  contactEmail?: string;
}): { subject: string; html: string } {
  const who = escOperatorText(data.name);
  const company = data.companyName ? escOperatorText(data.companyName) : "";
  const body = `
    ${opP(`Congratulations, ${who}.`)}
    ${opP(`${company ? `<strong>${company}</strong> is` : "Your operator profile is"} approved. Your tour packages and operator details are now live and bookable on the NoLSAF marketplace.`)}
    ${opP(data.setupLink
      ? "To start, create your password for the operator portal."
      : "Manage your packages and bookings any time from your operator portal.")}
    ${operatorAccess(data, BRAND_TEAL)}
    ${proDivider()}
    ${opMuted(`Questions? Write to ${opMail(data.contactEmail || "partners@nolsaf.com")}.`)}
    ${opSignOff("The NoLSAF Partnerships Team")}`;

  return {
    subject: "Your operator profile is approved on NoLSAF",
    html: proEmail("Your operator profile is approved", body),
  };
}

// ─── 9. Operator profile review rejected ────
export function getOperatorProfileRejectedEmail(data: {
  name: string;
  companyName?: string;
  reason?: string;
  portalUrl: string;
  loginUrl: string;
  setupLink?: string;
  setupLinkExpiresHours?: number;
  contactEmail?: string;
}): { subject: string; html: string } {
  const who = escOperatorText(data.name);
  const reason = data.reason && data.reason.trim()
    ? `${proNoteCard(OP_AMBER, "What to change", escOperatorText(data.reason).replace(/\n/g, "<br>"), "#fffaf3")}${opGap}`
    : "";
  const body = `
    ${opP(`Hello ${who},`)}
    ${opP(`Thank you for submitting your operator profile${data.companyName ? ` for <strong>${escOperatorText(data.companyName)}</strong>` : ""}. It needs a few changes before it can go live on the NoLSAF marketplace.`)}
    ${reason}
    ${opP("Sign in, update your profile using the feedback above, and send it for review again.")}
    ${operatorAccess(data, OP_AMBER)}
    ${proDivider()}
    ${opMuted(`Need help with a change? Write to ${opMail(data.contactEmail || "partners@nolsaf.com")}.`)}
    ${opSignOff("The NoLSAF Partnerships Team")}`;

  return {
    subject: "Action needed: your operator profile needs updates",
    html: proEmail("Your operator profile needs updates", body),
  };
}

// ─── NRMS Agent B2B — one-time invite to set a password ───────────────────────
const escapeNrmsAgentEmailText = (value: unknown) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function getNrmsAgentInviteEmail(inviteUrl: string, agencyName: string) {
  const safeAgencyName = escapeNrmsAgentEmailText(agencyName);
  const safeInviteUrl = escapeNrmsAgentEmailText(inviteUrl);
  const body = `
    <p style="margin:0 0 14px;color:${TEXT_MAIN};font-size:15px;">Hello ${safeAgencyName},</p>
    <p style="margin:0 0 14px;color:${TEXT_MAIN};font-size:15px;">You have been invited to book rooms on NoLSAF as an approved travel agent. Set your password to activate your agent account and start searching live availability at your negotiated rates.</p>
    ${proDivider()}
    ${proButton(safeInviteUrl, "Set your password", BRAND_TEAL)}
    <p style="margin:14px 0 0;font-size:13px;color:${TEXT_MUTED};">This invite link is valid for 7 days and can be used once. If the button does not work, copy and paste this link into your browser:<br><a href="${safeInviteUrl}" style="color:${BRAND_TEAL};word-break:break-all;text-decoration:none;">${safeInviteUrl}</a></p>
    ${proDivider()}
    ${proNoteCard(BRAND_TEAL, "Did not expect this", "If you were not expecting to become a NoLSAF travel agent, you can safely ignore this email. No account is activated until you set a password.")}
    ${proDivider()}
    <p style="margin:0;color:${TEXT_MUTED};font-size:14px;">Need help? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:${TEXT_MAIN};">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;
  return { subject: "Your NoLSAF travel-agent invitation", html: proEmail("Activate your agent account", body) };
}

// ─── NRMS Agent B2B — request-to-book declined ────────────────────────────────
export function getNrmsAgentRequestDeclinedEmail(agencyName: string, propertyTitle: string, checkIn: string, checkOut: string, reason: string | null, portalUrl: string) {
  const safeAgencyName = escapeNrmsAgentEmailText(agencyName);
  const safePropertyTitle = escapeNrmsAgentEmailText(propertyTitle);
  const safeCheckIn = escapeNrmsAgentEmailText(checkIn);
  const safeCheckOut = escapeNrmsAgentEmailText(checkOut);
  const safeReason = reason ? escapeNrmsAgentEmailText(reason) : null;
  const safePortalUrl = escapeNrmsAgentEmailText(portalUrl);
  const body = `
    <p style="margin:0 0 14px;color:${TEXT_MAIN};font-size:15px;">Hello ${safeAgencyName},</p>
    <p style="margin:0 0 14px;color:${TEXT_MAIN};font-size:15px;">Unfortunately <strong>${safePropertyTitle}</strong> could not confirm your request to book for ${safeCheckIn} to ${safeCheckOut}. The rooms have been released, and you have not been charged.</p>
    ${safeReason ? `${proNoteCard(BRAND_TEAL, "Reason from the hotel", safeReason)}` : ""}
    ${proDivider()}
    ${proButton(safePortalUrl, "Search other dates", BRAND_TEAL)}
    <p style="margin:14px 0 0;color:${TEXT_MUTED};font-size:14px;">You can try different dates or another approved hotel from your portal. Need help? Contact <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">support@nolsaf.com</a>.</p>
    <p style="margin:18px 0 0;color:${TEXT_MAIN};">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;
  const subjectProperty = String(propertyTitle ?? "the hotel").replace(/[\r\n]+/g, " ").slice(0, 160);
  return { subject: `Your booking request for ${subjectProperty} was declined`, html: proEmail("Booking request declined", body) };
}

/**
 * Sent after every download of a personal data copy, to the verified email.
 * It never contains the data itself: only when, how, and what to do if it was
 * not the account owner.
 */
export function getDataExportAlertEmail(opts: { when: string; format: string; device: string; ip: string | null; securityUrl: string }): { subject: string; html: string } {
  const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);
  const body = `
    <p style="margin:0;color:#4b5563;">A copy of the personal data on your NoLSAF account was just downloaded. It was confirmed with a code sent to you.</p>
    ${proDivider()}
    ${proDetailRows("Download details", [
      ["When", esc(opts.when)],
      ["Format", esc(opts.format)],
      ["Device", esc(opts.device)],
      ["IP address", esc(opts.ip || "Not recorded")],
    ])}
    ${proDivider()}
    ${proNoteCard("#b91c1c", "Not you?", `Change your password now, sign out of other devices, and write to <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};font-weight:bold;text-decoration:none;">support@nolsaf.com</a>. This email does not contain your data, and we never send it by email.`, "#fef2f2")}
    ${proDivider()}
    ${proButton(opts.securityUrl, "Review account security")}
    <p style="margin:18px 0 0;color:#1a1a1a;">Warm regards,<br><strong>The NoLSAF Team</strong></p>
  `;
  return { subject: "A copy of your NoLSAF data was downloaded", html: proEmail("Your data was downloaded", body) };
}
