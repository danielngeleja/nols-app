import { proEmail, proNoteCard, proReferenceCard } from "./emailBase.js";

type FinanceOtpEmailInput = {
  code: string;
  expiryMinutes: number;
};

const SECURITY_TEAL = "#02665e";
const CODE_BACKGROUND = "#eaf7f4";
const WARNING_BACKGROUND = "#fffbeb";

/**
 * Short security email for the finance re-authentication challenge. It uses
 * the same NoLSAF pro shell/footer as other transactional emails while keeping
 * the one-time code as the only prominent content.
 */
export function getFinanceOtpEmail(input: FinanceOtpEmailInput): { subject: string; html: string } {
  const code = String(input.code || "").replace(/[^0-9]/g, "").slice(0, 6);
  const expiryMinutes = Math.max(1, Math.floor(input.expiryMinutes));
  const body = `
    <p style="margin:0 0 16px;color:#374151;line-height:1.7;">
      Use this one-time code to continue to protected NoLSAF finance controls.
    </p>
    ${proReferenceCard(
      "Finance verification code",
      code,
      `This code expires in ${expiryMinutes} minutes.`,
      SECURITY_TEAL,
      CODE_BACKGROUND,
    )}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard(
      "#92400e",
      "Keep your account secure",
      "Do not share this code with anyone. NoLSAF staff will never ask you for it.",
      WARNING_BACKGROUND,
    )}
  `;

  return {
    subject: "NoLSAF finance verification code",
    html: proEmail("Finance verification code", body),
  };
}

