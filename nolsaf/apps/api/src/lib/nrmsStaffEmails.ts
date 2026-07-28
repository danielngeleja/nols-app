import { proEmail, proDetailRows, proButton, proNoteCard, proDivider, BRAND_TEAL } from "./emailBase.js";

export const NRMS_STAFF_ROLE_LABELS: Record<string, string> = {
  MANAGER: "NRMS manager",
  FRONT_DESK: "Front desk",
  RESTAURANT: "Restaurant staff",
  BAR: "Bar staff",
  OUTLET_SUPERVISOR: "Outlet supervisor",
};

export function nrmsStaffInviteEmail(params: {
  staffName: string;
  propertyTitle: string;
  role: string;
  outletName: string | null;
  assignedByName: string;
  confirmUrl: string;
}): { subject: string; html: string } {
  const roleLabel = NRMS_STAFF_ROLE_LABELS[params.role] ?? params.role;
  const scope = params.outletName ?? "All property";
  const subject = `You have been assigned to the team at ${params.propertyTitle}`;

  const body = `
    <p style="margin:0 0 16px;">Hello <strong>${params.staffName}</strong>,</p>
    <p style="margin:0 0 20px;">
      <strong>${params.assignedByName}</strong> has assigned you a staff role at
      <strong>${params.propertyTitle}</strong> on NoLSAF. Review the assignment below and
      confirm it to activate your access.
    </p>

    ${proDetailRows("Assignment details", [
      ["Property", params.propertyTitle],
      ["Role", roleLabel],
      ["Work area", scope],
      ["Assigned by", params.assignedByName],
      ["Status", "Awaiting your confirmation"],
    ])}

    <div style="height:20px;font-size:0;line-height:0;">&nbsp;</div>

    <div style="text-align:center;">
      ${proButton(params.confirmUrl, "Confirm assignment", BRAND_TEAL)}
    </div>

    <div style="height:8px;font-size:0;line-height:0;">&nbsp;</div>

    ${proNoteCard(
      BRAND_TEAL,
      "What happens next",
      `Select <strong>Confirm assignment</strong> above. If NoLSAF asks you to sign in, use
       this email address and you will return to the confirmation automatically. Once the
       assignment is confirmed, select <strong>Open my workspace</strong> to continue. You
       will only see the areas that match your role, and this assignment does not give
       access to the owner marketplace account.`,
    )}

    ${proDivider()}

    <p style="margin:0 0 6px;font-size:13px;color:#6b7280;">
      This confirmation link expires in 7 days. If the button does not work, copy and paste
      this link into your browser:
    </p>
    <p style="margin:0 0 14px;font-size:12px;word-break:break-all;">
      <a href="${params.confirmUrl}" style="color:${BRAND_TEAL};text-decoration:none;">${params.confirmUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;color:#6b7280;">
      If you were not expecting this assignment, you can safely ignore this email and no
      access will be granted.
    </p>`;

  return { subject, html: proEmail("Property team assignment", body) };
}
