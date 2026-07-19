import {
  proButton,
  proDetailRows,
  proDivider,
  proEmail,
  proNoteCard,
  proReferenceCard,
} from "./emailBase.js";

export type RestrictionEmailScope =
  | "MARKETPLACE_PROPERTY"
  | "NRMS_ENROLLMENT"
  | "NRMS_PROPERTY"
  | "NRMS_QR_ORDERING";

type RestrictionNoticeData = {
  ownerName: string;
  referenceCode: string;
  scope: RestrictionEmailScope;
  targetName?: string | null;
  reason: string;
  effectiveAt: Date;
  appealEmail?: string;
};

type RestrictionResolvedData = RestrictionNoticeData & {
  resolutionNote: string;
  resolvedAt: Date;
};

const RED = "#b42318";
const RED_BG = "#fef3f2";
const GREEN = "#047857";

const scopeCopy: Record<RestrictionEmailScope, { title: string; impact: string; targetLabel: string }> = {
  MARKETPLACE_PROPERTY: {
    title: "Marketplace property temporarily suspended",
    impact: "The property has been removed from public marketplace results and cannot receive new marketplace bookings while the review is open.",
    targetLabel: "Property",
  },
  NRMS_ENROLLMENT: {
    title: "NRMS workspace access temporarily suspended",
    impact: "NRMS access is paused across this owner account, including its properties and assigned staff. Marketplace access is not changed by this NRMS action.",
    targetLabel: "Affected service",
  },
  NRMS_PROPERTY: {
    title: "NRMS property operations temporarily frozen",
    impact: "NRMS operations are paused for this property only. Other NRMS properties and the marketplace listing are not changed by this action.",
    targetLabel: "Property",
  },
  NRMS_QR_ORDERING: {
    title: "Guest QR ordering temporarily paused",
    impact: "Public guest QR ordering is paused for this property. Staff operations and the marketplace listing remain available.",
    targetLabel: "Property",
  },
};

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDateTime(value: Date): string {
  return new Intl.DateTimeFormat("en-TZ", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(value);
}

export function getRestrictionNoticeEmail(data: RestrictionNoticeData): { subject: string; html: string } {
  const copy = scopeCopy[data.scope];
  const appealEmail = data.appealEmail || "partnerships@nolsaf.com";
  const target = data.targetName || (data.scope === "NRMS_ENROLLMENT" ? "NRMS workspace" : "Selected property");
  const appealUrl = `mailto:${appealEmail}?subject=${encodeURIComponent(`Appeal ${data.referenceCode}`)}`;
  const body = `
    <p style="margin:0 0 14px;color:#374151;">Dear <strong>${escapeHtml(data.ownerName)}</strong>,</p>
    <p style="margin:0 0 16px;color:#374151;line-height:1.75;">
      NoLSAF has placed a temporary administrative restriction on the service shown below while it is reviewed.
      This is not a permanent closure.
    </p>
    ${proReferenceCard(
      "Appeal and support reference",
      escapeHtml(data.referenceCode),
      "Keep this code and quote it in every appeal, email, or support conversation about this action.",
      RED,
      RED_BG,
    )}
    ${proDivider()}
    ${proDetailRows("Restriction details", [
      [copy.targetLabel, escapeHtml(target)],
      ["Restriction", escapeHtml(copy.title)],
      ["Effective", escapeHtml(formatDateTime(data.effectiveAt))],
      ["Reference", escapeHtml(data.referenceCode)],
    ])}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard(RED, "Reason provided", escapeHtml(data.reason), RED_BG)}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard("#7c5c12", "What this affects", escapeHtml(copy.impact), "#fffbeb")}
    ${proDivider()}
    <p style="margin:0 0 14px;color:#374151;line-height:1.75;">
      If you believe this action is incorrect, submit a written appeal to
      <a href="mailto:${appealEmail}" style="color:#02665e;font-weight:bold;">${appealEmail}</a>
      and include the reference <strong>${escapeHtml(data.referenceCode)}</strong>.
    </p>
    ${proButton(appealUrl, "Email partnerships", "#073c35")}
    <p style="margin:20px 0 0;color:#374151;">Regards,<br><strong>NoLSAF Partnerships &amp; Compliance</strong></p>
  `;

  return {
    subject: `${copy.title} — Ref: ${data.referenceCode}`,
    html: proEmail("Temporary restriction notice", body),
  };
}

export function getRestrictionResolvedEmail(data: RestrictionResolvedData): { subject: string; html: string } {
  const copy = scopeCopy[data.scope];
  const target = data.targetName || (data.scope === "NRMS_ENROLLMENT" ? "NRMS workspace" : "Selected property");
  const body = `
    <p style="margin:0 0 14px;color:#374151;">Dear <strong>${escapeHtml(data.ownerName)}</strong>,</p>
    <p style="margin:0 0 16px;color:#374151;line-height:1.75;">
      The temporary restriction associated with reference <strong>${escapeHtml(data.referenceCode)}</strong>
      has been resolved and the affected access has been restored.
    </p>
    ${proReferenceCard(
      "Resolved case reference",
      escapeHtml(data.referenceCode),
      "Retain this reference if you need to discuss the completed review with NoLSAF.",
      GREEN,
      "#ecfdf5",
    )}
    ${proDivider()}
    ${proDetailRows("Resolution details", [
      [copy.targetLabel, escapeHtml(target)],
      ["Original restriction", escapeHtml(copy.title)],
      ["Resolved", escapeHtml(formatDateTime(data.resolvedAt))],
      ["Reference", escapeHtml(data.referenceCode)],
    ])}
    <div style="height:16px;font-size:0;line-height:0;">&nbsp;</div>
    ${proNoteCard(GREEN, "Resolution note", escapeHtml(data.resolutionNote), "#ecfdf5")}
    <p style="margin:20px 0 0;color:#374151;">Regards,<br><strong>NoLSAF Partnerships &amp; Compliance</strong></p>
  `;

  return {
    subject: `Restriction resolved — Ref: ${data.referenceCode}`,
    html: proEmail("Access restored", body),
  };
}
