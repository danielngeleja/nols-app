/**
 * Small text parts shared by pro-shell emails (see proEmail in emailBase.ts),
 * so every message reads the same: paragraphs, muted notes, spacing, links
 * and the sign-off. All values that came from a person are escaped with esc().
 */
import { BRAND_TEAL } from "./emailBase.js";

export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escaped multi-line text with line breaks kept. */
export function escLines(value: unknown): string {
  return esc(value).replace(/\r?\n/g, "<br>");
}

export const AMBER = "#b54708";
export const RED = "#b42318";

export function para(html: string, extra = ""): string {
  return `<p style="margin:0 0 16px;${extra}">${html}</p>`;
}

export function mutedPara(html: string): string {
  return para(html, "color:#5f6b69;font-size:14px;");
}

export function gap(px = 18): string {
  return `<div style="height:${px}px;font-size:0;line-height:0;">&nbsp;</div>`;
}

export function sectionTitle(text: string): string {
  return `<div style="font-size:14px;font-weight:bold;color:#1a1a1a;margin:0 0 10px;">${text}</div>`;
}

export function textLink(url: string, label?: string): string {
  return `<a href="${esc(url)}" style="color:${BRAND_TEAL};text-decoration:none;font-weight:bold;">${esc(label ?? url)}</a>`;
}

export function mailLink(email: string): string {
  return textLink(`mailto:${email}`, email);
}

export function signOff(team = "The NoLSAF Team", closing = "Warm regards"): string {
  return `<p style="margin:22px 0 0;color:#1a1a1a;">${closing},<br><strong>${esc(team)}</strong></p>`;
}

/** Simple bulleted list (items are trusted HTML). */
export function bullets(items: string[]): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 16px;">
      ${items.map((item) => `
      <tr>
        <td style="width:18px;vertical-align:top;padding:3px 0;color:${BRAND_TEAL};font-weight:bold;">&#8226;</td>
        <td style="padding:3px 0;font-size:14px;color:#374151;line-height:1.65;">${item}</td>
      </tr>`).join("")}
    </table>`;
}

/** Dates in emails are Tanzania time and say so. */
export function eatDate(value: Date | string | number, withTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const text = date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "Africa/Dar_es_Salaam",
  });
  return withTime ? `${text} EAT` : text;
}
