import {
  BRAND_TEAL,
  proButton,
  proDetailRows,
  proDivider,
  proEmail,
  proNoteCard,
} from "./emailBase.js";

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function salesAgreementInvitationEmail(input: {
  recipientName: string;
  agentCode: string;
  contractNumber: string;
  invitationUrl: string;
  invitationExpiresAt: Date;
}): { subject: string; html: string } {
  const recipientName = escapeHtml(input.recipientName || "Partner");
  const agentCode = escapeHtml(input.agentCode);
  const contractNumber = escapeHtml(input.contractNumber);
  const invitationUrl = escapeHtml(input.invitationUrl);
  const expiry = escapeHtml(
    input.invitationExpiresAt.toLocaleString("en-TZ", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Dar_es_Salaam",
    }),
  );
  const body = `
    <p style="margin:0 0 16px;">Hello <strong>${recipientName}</strong>,</p>
    <p style="margin:0 0 20px;">
      NoLSAF has prepared a Sales Partner agreement for your review.
      Sign in with the account that received this email to continue.
    </p>

    ${proDetailRows("Agreement details", [
      ["Agreement", contractNumber],
      ["Sales partner code", agentCode],
      ["Status", "Awaiting your review"],
      ["Invitation expires", expiry],
    ])}

    <div style="height:20px;font-size:0;line-height:0;">&nbsp;</div>

    <div style="text-align:center;">
      ${proButton(invitationUrl, "Review agreement", BRAND_TEAL)}
    </div>

    <div style="height:8px;font-size:0;line-height:0;">&nbsp;</div>

    ${proNoteCard(
      BRAND_TEAL,
      "Secure account access",
      "This invitation opens the agreement review page only. Your normal NoLSAF authentication is still required, and the agreement can only be reviewed from the account to which it was assigned.",
    )}

    ${proDivider()}

    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">
      This link can be used once and expires on ${expiry}. If the button does
      not work, copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 14px;font-size:12px;word-break:break-all;">
      <a href="${invitationUrl}" style="color:${BRAND_TEAL};text-decoration:none;">${invitationUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">
      If you were not expecting this agreement, do not use the link. Contact
      <a href="mailto:support@nolsaf.com" style="color:${BRAND_TEAL};text-decoration:none;">support@nolsaf.com</a>.
    </p>`;

  return {
    subject: `Review your NoLSAF agreement ${input.contractNumber}`,
    html: proEmail("Your agreement is ready", body),
  };
}
