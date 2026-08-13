/**
 * adminEmailTemplates.ts
 * Admin-specific transactional email templates
 */
import { BRAND_TEAL, BRAND_DARK, TEXT_MUTED, TEXT_MAIN, baseEmail, infoCard, calloutBox, ctaButton } from "./emailBase.js";

const ADMIN_BLUE = "#1e40af";
const ADMIN_GRADIENT = "#1e3a8a";

/**
 * Admin welcome email - sent when user is promoted to or created as ADMIN
 */
export function getAdminWelcomeEmail(data: {
  name: string;
  email: string;
  isNewlyCreated: boolean;
}): { subject: string; html: string } {
  const action = data.isNewlyCreated ? "created as" : "promoted to";
  const greetingName = data.name || "Admin";
  const appUrl = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "https://www.nolsaf.com";
  const adminDashboardUrl = `${appUrl}/admin`;

  const body = `
    <p style="margin:0 0 18px;font-size:17px;font-weight:600;color:${ADMIN_BLUE};">
      Jambo ${greetingName}! 👋
    </p>
    
    <p style="margin:0 0 16px;font-size:15px;color:${TEXT_MAIN};line-height:1.6;">
      You have been <strong>${action} Administrator</strong> for NoLSAF, East Africa's leading accommodation and tourism access platform. This is a position of trust and responsibility.
    </p>

    ${calloutBox(
      BRAND_TEAL,
      "🛡️",
      "Your Core Responsibilities",
      `
        <ul style="margin:8px 0 0;padding-left:20px;line-height:1.8;">
          <li><strong>Property Verification:</strong> Review and approve listings, photos, and owner documentation</li>
          <li><strong>Driver & Agent Management:</strong> Conduct KYC reviews and background checks</li>
          <li><strong>Platform Safety:</strong> Monitor integrity, investigate fraud reports, manage suspensions</li>
          <li><strong>Support Escalation:</strong> Resolve complex booking disputes and customer issues</li>
          <li><strong>Financial Oversight:</strong> Review transactions, process refunds, manage payouts</li>
          <li><strong>Data Protection:</strong> Handle sensitive information with strict confidentiality</li>
        </ul>
      `
    )}

    ${calloutBox(
      "#dc2626",
      "⚠️",
      "Critical Security & Compliance Policies",
      `
        <ul style="margin:8px 0 0;padding-left:20px;line-height:1.8;">
          <li><strong>Enable 2FA Immediately:</strong> Two-Factor Authentication is required for all admin accounts</li>
          <li><strong>Credential Security:</strong> Never share your login details with anyone</li>
          <li><strong>Audit Trail:</strong> Every admin action is logged and audited</li>
          <li><strong>Data Privacy:</strong> Comply with GDPR and Tanzania Data Protection Act</li>
          <li><strong>Conflict of Interest:</strong> Do not approve your own properties or transactions</li>
          <li><strong>Session Management:</strong> Always log out when finished</li>
        </ul>
      `
    )}

    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0;">
      <tr>
        <td style="background:linear-gradient(135deg, ${ADMIN_BLUE} 0%, #1e3a8a 100%);border-radius:12px;padding:24px;text-align:center;">
          <p style="margin:0 0 12px;font-size:16px;font-weight:700;color:#ffffff;">
            📊 Access Your Admin Dashboard
          </p>
          <p style="margin:0 0 18px;font-size:14px;color:rgba(255,255,255,0.9);">
            Manage users, properties, bookings, and system settings
          </p>
          ${ctaButton(adminDashboardUrl, "Go to Admin Dashboard →", "#ffffff")}
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellspacing="0" cellpadding="16" border="0"
      style="background:#fef3c7;border-left:4px solid #f59e0b;border-radius:8px;margin:24px 0;">
      <tr><td>
        <p style="margin:0;font-size:14px;color:#92400e;">
          <strong>⚡ Action Required:</strong> Log in within 24 hours and enable Two-Factor Authentication (2FA) in your account security settings.
        </p>
      </td></tr>
    </table>

    ${infoCard(ADMIN_BLUE, [
      ["Login URL", `<a href="${adminDashboardUrl}" style="color:${BRAND_TEAL};text-decoration:none;">${adminDashboardUrl}</a>`],
      ["Your Email", data.email],
      ["Support", `<a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;">support@nolsaf.com</a>`]
    ])}

    <p style="margin:24px 0 0;font-size:14px;color:${TEXT_MUTED};line-height:1.7;">
      Welcome to the team! Together, we're making Africa more accessible to travelers worldwide. 🌍
    </p>

    <p style="margin:20px 0 0;font-size:14px;color:${TEXT_MAIN};">
      Karibu sana!<br>
      <strong style="color:${BRAND_DARK};">NoLSAF Admin Team</strong>
    </p>
  `;

  return {
    subject: "🎉 Welcome to NoLSAF Admin Team – Action Required",
    html: baseEmail(ADMIN_BLUE, ADMIN_GRADIENT, "Admin Access Granted", "🔐", body),
  };
}

/**
 * Get SMS message for admin welcome
 */
export function getAdminWelcomeSms(data: {
  name: string;
  isNewlyCreated: boolean;
}): string {
  const action = data.isNewlyCreated ? "created as" : "promoted to";
  const greetingName = data.name || "Admin";

  return `Jambo ${greetingName}! You have been ${action} ADMIN at NoLSAF 🎉

Your responsibilities:
✓ Verify properties & drivers
✓ Monitor platform security
✓ Handle support escalations
✓ Protect user data

CRITICAL:
• Enable 2FA immediately
• Never share credentials
• All actions are audited
• Follow data protection laws

Login: www.nolsaf.com/admin

Karibu! 🌍
- NoLSAF Admin Team`;
}

/**
 * Admin revocation email — sent when admin privileges are removed.
 * Formatted as a formal letter with: effects, possible reasons,
 * appeal/referral path, reference number, and wrong-recipient notice.
 */
export function getAdminRevocationEmail(data: {
  name: string;
  email: string;
  referenceCode: string;
}): { subject: string; html: string } {
  const greetingName = data.name || "User";
  const effectiveDate = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const body = `
    <!-- Reference block (top of letter) -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 28px;">
      <tr>
        <td style="border-left:4px solid #dc2626;padding:10px 16px;background:#fef2f2;border-radius:0 8px 8px 0;">
          <p style="margin:0;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#991b1b;font-weight:600;">Reference Number</p>
          <p style="margin:4px 0 0;font-size:20px;font-weight:800;color:#7f1d1d;letter-spacing:2px;font-family:monospace;">${data.referenceCode}</p>
          <p style="margin:4px 0 0;font-size:11px;color:#b91c1c;">Please quote this reference in all correspondence and appeals.</p>
        </td>
      </tr>
    </table>

    <!-- Salutation -->
    <p style="margin:0 0 6px;font-size:13px;color:${TEXT_MUTED};">${effectiveDate}</p>
    <p style="margin:0 0 20px;font-size:16px;color:${TEXT_MAIN};line-height:1.7;">
      Dear <strong>${greetingName}</strong>,
    </p>

    <!-- Subject line -->
    <p style="margin:0 0 20px;font-size:14px;font-weight:700;color:#7f1d1d;text-transform:uppercase;letter-spacing:0.5px;">
      Re: Revocation of Administrative Access — NoLSAF Platform
    </p>

    <!-- Opening -->
    <p style="margin:0 0 16px;font-size:15px;color:${TEXT_MAIN};line-height:1.8;">
      We are writing to formally notify you that your administrative access to the
      <strong>NoLSAF Platform</strong> has been <strong style="color:#dc2626;">revoked</strong> effective
      <strong>${effectiveDate}</strong>. This action has been taken by the NoLSAF Management Team in
      accordance with the platform's governance policies.
    </p>

    <!-- What you can no longer do -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="20" border="0"
      style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;margin:24px 0;">
      <tr><td>
        <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#991b1b;">
          Immediate Effects of This Action
        </p>
        <p style="margin:0 0 10px;font-size:14px;color:#7f1d1d;line-height:1.8;">
          As of the effective date above, the following access and privileges have been permanently disabled:
        </p>
        <ul style="margin:0;padding-left:20px;font-size:14px;color:#7f1d1d;line-height:2.0;">
          <li>Login to the NoLSAF Admin Dashboard</li>
          <li>Reviewing, approving, or rejecting property listings and driver KYC requests</li>
          <li>Managing user accounts, suspensions, or platform configurations</li>
          <li>Accessing financial reports, transaction logs, or payout controls</li>
          <li>Viewing confidential platform data or audit logs</li>
          <li>Acting in any official capacity as a NoLSAF Administrator</li>
        </ul>
        <p style="margin:12px 0 0;font-size:14px;color:#7f1d1d;line-height:1.8;">
          Your standard NoLSAF customer account remains active and all personal data is preserved.
        </p>
      </td></tr>
    </table>

    <!-- Possible reasons -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="20" border="0"
      style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;margin:24px 0;">
      <tr><td>
        <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#92400e;">
          Possible Grounds for This Decision
        </p>
        <p style="margin:0 0 10px;font-size:14px;color:#78350f;line-height:1.8;">
          Administrative access may be revoked for one or more of the following reasons.
          Specific grounds applicable to your case will be communicated by HR or Management:
        </p>
        <ul style="margin:0;padding-left:20px;font-size:14px;color:#78350f;line-height:2.0;">
          <li>Violation of the NoLSAF Administrator Code of Conduct or Acceptable Use Policy</li>
          <li>Misconduct, negligence, or breach of professional standards</li>
          <li>Unauthorised access to, or misuse of, platform data or systems</li>
          <li>Ongoing internal investigation requiring precautionary access suspension</li>
          <li>Performance concerns or failure to meet role responsibilities</li>
          <li>Organisational restructuring or role discontinuation</li>
          <li>Voluntary resignation or termination of employment/contract</li>
          <li>A security or compliance requirement by the platform or a regulatory body</li>
        </ul>
      </td></tr>
    </table>

    <!-- Next steps / hope -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="20" border="0"
      style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;margin:24px 0;">
      <tr><td>
        <p style="margin:0 0 12px;font-size:14px;font-weight:700;color:#166534;">
          Next Steps &amp; Your Right to Appeal
        </p>
        <p style="margin:0 0 10px;font-size:14px;color:#14532d;line-height:1.8;">
          If you believe this decision was made in error, or if you have been informed that this
          is a precautionary measure pending an investigation, you have the right to:
        </p>
        <ul style="margin:0 0 12px;padding-left:20px;font-size:14px;color:#14532d;line-height:2.0;">
          <li>Request a formal review by contacting the NoLSAF Human Resources or Management team</li>
          <li>Submit a written appeal or referral outlining your position</li>
          <li>Request clarification on the specific grounds applicable to your case</li>
        </ul>
        <p style="margin:0;font-size:14px;color:#14532d;line-height:1.8;">
          <strong>When submitting any appeal or referral, you must cite your reference number
          <span style="font-family:monospace;background:#dcfce7;padding:2px 6px;border-radius:4px;">${data.referenceCode}</span>
          in all written communications</strong> so that your case can be correctly identified and processed.
        </p>
      </td></tr>
    </table>

    <!-- Contact info card -->
    ${infoCard("#dc2626", [
      ["HR / Management", "Contact your direct line manager or HR representative"],
      ["Platform Support", `<a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;">support@nolsaf.com</a>`],
      ["Reference Number", `<span style="font-family:monospace;font-weight:700;color:#7f1d1d;">${data.referenceCode}</span>`],
      ["Effective Date", effectiveDate],
    ])}

    <!-- Wrong recipient notice -->
    <table role="presentation" width="100%" cellspacing="0" cellpadding="16" border="0"
      style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;margin:28px 0 24px;">
      <tr><td>
        <p style="margin:0;font-size:13px;color:#64748b;line-height:1.8;">
          <strong>Received this email by mistake?</strong> If you are not the intended recipient,
          or if you believe this was sent due to a technical error, please disregard this message and
          notify us immediately at
          <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;">support@nolsaf.com</a>
          so we can investigate and correct the issue. Do not act on the contents of this email.
        </p>
      </td></tr>
    </table>

    <!-- Closing -->
    <p style="margin:0 0 6px;font-size:15px;color:${TEXT_MAIN};line-height:1.7;">
      Yours sincerely,
    </p>
    <p style="margin:0 0 4px;font-size:15px;font-weight:700;color:${BRAND_DARK};">NoLSAF Platform Team</p>
    <p style="margin:0;font-size:13px;color:${TEXT_MUTED};">On behalf of NoLSAF Management</p>
    <p style="margin:16px 0 0;font-size:12px;color:#9ca3af;font-style:italic;line-height:1.7;">
      This is a system-generated official notification. Please do not reply directly to this email.
      All enquiries must be submitted in writing with your reference number to the contact above.
    </p>
  `;

  return {
    subject: `Notice of Admin Access Revocation (Ref: ${data.referenceCode})`,
    html: baseEmail("#dc2626", "#991b1b", "Admin Access Revoked", "🔒", body),
  };
}

/**
 * SMS for admin revocation
 */
export function getAdminRevocationSms(data: {
  name: string;
  referenceCode: string;
}): string {
  const greetingName = data.name || "User";
  return `Dear ${greetingName}, your NoLSAF Admin access has been revoked effective today. Ref: ${data.referenceCode}. Your standard account remains active. To appeal or for more information, contact HR/Management quoting this reference. support@nolsaf.com`;
}
