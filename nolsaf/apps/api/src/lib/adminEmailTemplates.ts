/**
 * adminEmailTemplates.ts
 * Admin-specific transactional email templates (pro email shell).
 */
import { proButton, proDetailRows, proDivider, proEmail, proNoteCard, proReferenceCard } from "./emailBase.js";
import { AMBER, RED, bullets, eatDate, esc, gap, mailLink, mutedPara, para, sectionTitle, signOff, textLink } from "./proEmailParts.js";

/**
 * Admin welcome email - sent when user is promoted to or created as ADMIN
 */
export function getAdminWelcomeEmail(data: {
  name: string;
  email: string;
  isNewlyCreated: boolean;
}): { subject: string; html: string } {
  const action = data.isNewlyCreated ? "created as" : "promoted to";
  const greetingName = esc(data.name || "Admin");
  const appUrl = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "https://www.nolsaf.com";
  const adminDashboardUrl = `${appUrl}/admin`;

  const body = `
    ${para(`Jambo ${greetingName},`)}
    ${para(`You have been <strong>${action} an administrator</strong> of NoLSAF. This is a position of trust: you will see and act on people's data, money and listings.`)}
    ${proNoteCard(AMBER, "Do this first", "Sign in within 24 hours and turn on two-factor authentication in your account security settings.", "#fffaf3")}
    ${gap(22)}
    ${proButton(adminDashboardUrl, "Open the admin dashboard")}
    ${proDivider()}
    ${sectionTitle("What you are responsible for")}
    ${bullets([
      "<strong>Listings:</strong> review properties, photos and owner documents.",
      "<strong>Partners:</strong> identity checks for drivers, operators and sales partners.",
      "<strong>Safety:</strong> watch for fraud, investigate reports, manage suspensions.",
      "<strong>Support:</strong> resolve escalated booking disputes and customer issues.",
      "<strong>Money:</strong> review transactions, refunds and payouts.",
    ])}
    ${sectionTitle("Rules that always apply")}
    ${bullets([
      "Never share your login with anyone.",
      "Every admin action is logged and audited.",
      "Follow the Tanzania Personal Data Protection Act when handling personal data.",
      "Never approve your own properties, payouts or transactions.",
      "Sign out when you finish.",
    ])}
    ${proDetailRows("Your access", [
      ["Sign in", textLink(adminDashboardUrl)],
      ["Your email", esc(data.email)],
      ["Support", mailLink("support@nolsaf.com")],
    ])}
    ${signOff("NoLSAF Admin Team", "Karibu sana")}
  `;

  return {
    subject: "Welcome to the NoLSAF admin team: action needed",
    html: proEmail("You now have admin access", body),
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
 * Admin revocation email: sent when admin privileges are removed. A formal
 * notice with the effect, possible grounds, the appeal path, the reference
 * and a wrong-recipient note.
 */
export function getAdminRevocationEmail(data: {
  name: string;
  email: string;
  referenceCode: string;
}): { subject: string; html: string } {
  const greetingName = esc(data.name || "User");
  const effectiveDate = eatDate(new Date());
  const ref = esc(data.referenceCode);

  const body = `
    ${para(`Dear ${greetingName},`)}
    ${para(`Your administrator access to NoLSAF has been <strong style="color:${RED};">revoked</strong> from <strong>${esc(effectiveDate)}</strong>, by decision of NoLSAF management under the platform's governance policies.`)}
    ${proReferenceCard("Reference number", ref, "Quote this reference in every message or appeal about this decision.", RED, "#fff6f5")}
    ${gap()}
    ${proNoteCard(RED, "What stops now", `
      Signing in to the admin dashboard.<br>
      Reviewing listings, identity checks, accounts and settings.<br>
      Financial reports, transaction logs, payout controls and audit logs.<br>
      Acting in any official capacity as a NoLSAF administrator.<br><br>
      Your ordinary NoLSAF account stays active and your personal data is kept.`, "#fff6f5")}
    ${proDivider()}
    ${sectionTitle("Why access can be revoked")}
    ${para("Management will tell you the specific grounds for your case. In general, access is revoked for:", "font-size:14px;")}
    ${bullets([
      "A breach of the administrator code of conduct or acceptable use policy.",
      "Misconduct, negligence, or misuse of platform data or systems.",
      "A precaution while an internal investigation runs.",
      "A change of role, restructuring, or the end of employment or contract.",
      "A security or compliance requirement.",
    ])}
    ${sectionTitle("Your right to appeal")}
    ${para(`If you believe this is a mistake, or you were told it is a precaution, you can ask management for a formal review, send a written appeal, or ask for the specific grounds. Always include the reference <strong>${ref}</strong>.`, "font-size:14px;")}
    ${proDetailRows("", [
      ["Reference", ref],
      ["Effective", esc(effectiveDate)],
      ["Contact", "Your line manager or HR, or " + mailLink("support@nolsaf.com")],
    ])}
    ${proDivider()}
    ${mutedPara(`Received this by mistake? Do not act on it, and tell us at ${mailLink("support@nolsaf.com")} so we can correct it.`)}
    ${signOff("NoLSAF Platform Team, on behalf of management", "Yours sincerely")}
  `;

  return {
    subject: `Notice: your NoLSAF admin access is revoked (Ref: ${data.referenceCode})`,
    html: proEmail("Your admin access is revoked", body),
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
