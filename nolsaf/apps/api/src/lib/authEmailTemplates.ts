/**
 * authEmailTemplates.ts
 * ─────────────────────────────────────────────────────────────
 * Auth-related transactional email templates:
 *   - Email address verification
 *   - Password reset
 *   - Welcome (new account)
 */
import { BRAND_TEAL, BRAND_DARK, TEXT_MAIN, TEXT_MUTED, baseEmail, calloutBox, ctaButton, careersEmail, infoCard, proEmail, proDivider, proButton, proReferenceCard, proDetailRows, proNoteCard } from "./emailBase.js";

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
export type VerificationPurpose = "signup" | "login" | "reset" | "contact";

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

// ─── 4. Welcome — new account ─────────────────────────────────────────────────
export function getWelcomeEmail(
  name: string,
  portalUrl: string,
  role: "CUSTOMER" | "OWNER" | "AGENT" | "DRIVER" = "CUSTOMER"
): { subject: string; html: string } {
  const roleConfig = {
    CUSTOMER: { accent: BRAND_TEAL,  to: BRAND_DARK, cta: "Explore NoLSAF",     ctaLabel: "Explore the Platform" },
    OWNER:    { accent: "#0369a1",   to: "#075985",  cta: portalUrl,             ctaLabel: "Go to Owner Dashboard" },
    AGENT:    { accent: "#7c3aed",   to: "#6d28d9",  cta: portalUrl,             ctaLabel: "Open Agent Portal" },
    DRIVER:   { accent: "#ea580c",   to: "#c2410c",  cta: portalUrl,             ctaLabel: "Open Driver Portal" },
  };
  const { accent, to, cta, ctaLabel } = roleConfig[role];

  const roleMessage: Record<typeof role, string> = {
    CUSTOMER: "You can now browse properties, plan events, and book experiences — all in one place.",
    OWNER:    "Your property owner account is ready. You can now list properties, manage bookings, and track performance from your dashboard.",
    AGENT:    "Your agent account has been activated. You can now receive assignments, communicate with clients, and manage travel plans.",
    DRIVER:   "Your driver account is live. You can accept transport requests and manage your schedule from the portal.",
  };

  const body = `
    <p style="margin:0 0 16px;font-size:16px;font-weight:600;color:${accent};">Welcome to NoLSAF, ${name}! 🌍</p>
    <p style="margin:0 0 16px;">Your account has been created successfully. ${roleMessage[role]}</p>
    ${calloutBox(accent, "✅", "You're all set:", `Your account is active and ready to use. Click the button below to get started.`)}
    ${ctaButton(cta, ctaLabel, accent)}
    <p style="margin:24px 0 0;font-size:13px;color:${TEXT_MUTED};">Need help getting started? Contact us at <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;">support@nolsaf.com</a>.</p>
    <p style="margin:20px 0 0;">Warm regards,<br><strong style="color:${BRAND_DARK};">The NoLSAF Team</strong></p>
  `;

  return {
    subject: `Welcome to NoLSAF, ${name}! 🌍`,
    html: baseEmail(accent, to, "Welcome to NoLSAF", "🎉", body),
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

// ─── 6. Agent account suspension ──────
export function getAgentSuspensionEmail(data: {
  name: string;
  reason: string;
  caseRef: string;
  suspendedAt: string;
  contactEmail?: string;
}): { subject: string; html: string } {
  const AMBER  = "#b45309";
  const AMBER_BG = "#fffbeb";

  const detailRows: Array<[string, string]> = [
    ["Agent name",   data.name],
    ["Case ref",     data.caseRef],
    ["Suspended on", data.suspendedAt],
    ["Contact",      data.contactEmail || "hr@nolsaf.com"],
  ];

  const body = `
    <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#7c2d12;">Dear ${data.name},</p>

    <p style="margin:0 0 14px;color:#374151;line-height:1.75;">
      We are writing to inform you that your NoLSAF Agent account has been
      <strong style="color:#b91c1c;">temporarily suspended</strong> pending an internal review.
      During this period you will not be able to access the Agent Portal.
    </p>

    <p style="margin:0 0 14px;color:#374151;line-height:1.75;">
      This suspension has been applied in accordance with NoLSAF&apos;s agent conduct and compliance
      policy. Our team will conduct a fair and thorough review of the matter. You will be notified
      by email once a decision has been reached.
    </p>

    ${infoCard("#b45309", detailRows)}

    <!-- What to expect -->
    <table width="100%" cellpadding="0" cellspacing="0"
      style="margin:16px 0;background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;">
      <tr>
        <td style="padding:16px 18px;">
          <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#111827;">What happens next</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#374151;line-height:1.85;">
            <li>NoLSAF will conduct a thorough and fair investigation.</li>
            <li>You may be contacted for your account of events — please cooperate fully.</li>
            <li>If the investigation concludes that no policy was violated, your access will be reinstated and you will be notified by email.</li>
            <li>If a violation is confirmed, further disciplinary measures may follow in accordance with your employment terms.</li>
          </ul>
        </td>
      </tr>
    </table>

    <p style="margin:14px 0;font-size:13px;color:#374151;line-height:1.75;">
      If you have questions or wish to submit a written response, please contact our HR team:
      <a href="mailto:${data.contactEmail || "hr@nolsaf.com"}" style="color:${BRAND_TEAL};font-weight:600;">${data.contactEmail || "hr@nolsaf.com"}</a>.
      Please quote your case reference <strong>${data.caseRef}</strong> in all correspondence.
    </p>

    <p style="margin:20px 0 0;font-size:13px;color:#374151;">
      Regards,<br>
      <strong style="color:#7c2d12;">NoLSAF Human Resources &amp; Compliance</strong>
    </p>
  `;

  return {
    subject: `[Important] Your NoLSAF Agent account has been temporarily suspended (Ref: ${data.caseRef})`,
    html: careersEmail("⚠️", "Account Suspended", "Temporary Suspension Notice", body, data.contactEmail || "hr@nolsaf.com"),
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
  const GREEN    = "#059669";
  const GREEN_BG = "#ecfdf5";

  const detailRows: Array<[string, string]> = [
    ["Agent name",  data.name],
    ["Case ref",    data.caseRef],
    ["Restored on", data.restoredAt],
    ["Contact",     data.contactEmail || "hr@nolsaf.com"],
  ];

  const notesBlock = data.notes
    ? `
    <table width="100%" cellpadding="0" cellspacing="0"
      style="margin:16px 0;background:#f0fdf4;border-left:4px solid ${GREEN};border-radius:4px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${GREEN};">Note from NoLSAF</p>
        <p style="margin:0;font-size:13px;color:#064e3b;line-height:1.7;">${data.notes}</p>
      </td></tr>
    </table>`
    : "";

  const body = `
    <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:#064e3b;">Dear ${data.name},</p>

    <p style="margin:0 0 14px;color:#374151;line-height:1.75;">
      We are pleased to inform you that following the conclusion of our investigation
      (case reference <strong>${data.caseRef}</strong>),
      your NoLSAF Agent account has been <strong style="color:${GREEN};">fully reinstated</strong>.
      You may now log in to the Agent Portal as normal.
    </p>

    <!-- Green success highlight -->
    <table width="100%" cellpadding="0" cellspacing="0"
      style="margin:16px 0;background:${GREEN_BG};border-left:4px solid ${GREEN};border-radius:4px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:${GREEN};">
          ✔ Access fully restored — no violations were established
        </p>
      </td></tr>
    </table>

    ${notesBlock}
    ${infoCard(GREEN, detailRows)}

    <p style="margin:14px 0;font-size:13px;color:#374151;line-height:1.75;">
      We appreciate your patience during this process. Should you need any
      support or have further questions, please reach out to
      <a href="mailto:${data.contactEmail || "hr@nolsaf.com"}" style="color:${BRAND_TEAL};font-weight:600;">${data.contactEmail || "hr@nolsaf.com"}</a>.
    </p>

    <p style="margin:20px 0 0;font-size:13px;color:#374151;">
      Welcome back,<br>
      <strong style="color:#064e3b;">NoLSAF Human Resources &amp; Compliance</strong>
    </p>
  `;

  return {
    subject: `[Update] Your NoLSAF Agent account has been reinstated (Ref: ${data.caseRef})`,
    html: careersEmail("✅", "Access Reinstated", "Account Restoration Notice", body, data.contactEmail || "hr@nolsaf.com"),
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
  const GREEN = "#059669";
  const greeting = data.companyName ? `${data.name} (${data.companyName})` : data.name;

  const cta = data.setupLink
    ? ctaButton(data.setupLink, "Set your password", GREEN)
    : ctaButton(data.portalUrl, "Open Agent Portal", GREEN);

  const setupNote = data.setupLink && data.setupLinkExpiresHours
    ? `<p style="margin:10px 0 18px;font-size:13px;color:${TEXT_MUTED};text-align:center;">This password setup link expires in ${data.setupLinkExpiresHours} hours.</p>`
    : "";

  const loginLine = !data.setupLink
    ? `<p style="margin:0 0 10px;font-size:14px;color:${TEXT_MAIN};">Sign in at: <a href="${data.loginUrl}" style="color:${GREEN};text-decoration:none;font-weight:600;">${data.loginUrl}</a></p>`
    : "";

  const body = `
    <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:${GREEN};">Congratulations, ${greeting}!</p>

    <table width="100%" cellpadding="0" cellspacing="0"
      style="margin:0 0 16px;background:#ecfdf5;border-left:4px solid ${GREEN};border-radius:4px;">
      <tr><td style="padding:14px 18px;">
        <p style="margin:0;font-size:13px;font-weight:700;color:${GREEN};">
          ✔ Your operator profile has been approved
        </p>
      </td></tr>
    </table>

    <p style="margin:0 0 14px;color:${TEXT_MAIN};line-height:1.75;">
      Your tour packages and operator details are now live and bookable on the NoLSAF marketplace.
    </p>

    ${data.setupLink
      ? `<p style="margin:0 0 14px;color:${TEXT_MAIN};line-height:1.75;">Before you continue, finish setting up your Agent Portal access by creating a password using the button below.</p>`
      : `<p style="margin:0 0 14px;color:${TEXT_MAIN};line-height:1.75;">You can manage your packages and bookings anytime from your Agent Portal.</p>`}

    ${cta}
    ${setupNote}
    ${loginLine}

    <p style="margin:24px 0 0;">Warm regards,<br><strong style="color:${BRAND_DARK};">The NoLSAF Team</strong></p>
  `;

  return {
    subject: "Your operator profile has been approved — NoLSAF",
    html: careersEmail("✅", "Profile Approved", "Operator Profile Review", body, data.contactEmail || "partners@nolsaf.com"),
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
  const AMBER = "#b45309";
  const greeting = data.companyName ? `${data.name} (${data.companyName})` : data.name;

  const reasonBlock = data.reason
    ? `<table width="100%" cellpadding="0" cellspacing="0"
        style="margin:16px 0;background:#fffbeb;border-left:4px solid ${AMBER};border-radius:4px;">
        <tr><td style="padding:14px 18px;">
          <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:${AMBER};">Feedback from our review team</p>
          <p style="margin:0;font-size:13px;color:#78350f;line-height:1.7;">${data.reason}</p>
        </td></tr>
      </table>`
    : "";

  const cta = data.setupLink
    ? ctaButton(data.setupLink, "Set your password", AMBER)
    : ctaButton(data.portalUrl, "Open Agent Portal", AMBER);

  const setupNote = data.setupLink && data.setupLinkExpiresHours
    ? `<p style="margin:10px 0 18px;font-size:13px;color:${TEXT_MUTED};text-align:center;">This password setup link expires in ${data.setupLinkExpiresHours} hours.</p>`
    : "";

  const loginLine = !data.setupLink
    ? `<p style="margin:0 0 10px;font-size:14px;color:${TEXT_MAIN};">Sign in at: <a href="${data.loginUrl}" style="color:${AMBER};text-decoration:none;font-weight:600;">${data.loginUrl}</a></p>`
    : "";

  const body = `
    <p style="margin:0 0 14px;font-size:16px;font-weight:700;color:${AMBER};">Hello ${greeting},</p>

    <p style="margin:0 0 14px;color:${TEXT_MAIN};line-height:1.75;">
      Thanks for submitting your operator profile for review. It needs a few changes before it can go
      live on the NoLSAF marketplace.
    </p>

    ${reasonBlock}

    <p style="margin:0 0 14px;color:${TEXT_MAIN};line-height:1.75;">
      Please log in to your Agent Portal, update your profile based on the feedback above, and submit it
      again for review.
    </p>

    ${cta}
    ${setupNote}
    ${loginLine}

    <p style="margin:24px 0 0;">Warm regards,<br><strong style="color:${BRAND_DARK};">The NoLSAF Team</strong></p>
  `;

  return {
    subject: "Action needed: updates required for your operator profile — NoLSAF",
    html: careersEmail("📝", "Profile Needs Updates", "Operator Profile Review", body, data.contactEmail || "partners@nolsaf.com"),
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
