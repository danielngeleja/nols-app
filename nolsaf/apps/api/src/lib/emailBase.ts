/**
 * emailBase.ts
 * ─────────────────────────────────────────────────────────────
 * Single source of truth for ALL NoLSAF transactional emails (the pro shell).
 * Every template file imports from here — change once, updates everywhere.
 */

// ─── Brand tokens ─────────────────────────────────────────────────────────────
export const BRAND_TEAL   = "#02665e";
export const BRAND_DARK   = "#014d47";
export const BODY_BG      = "#f0f4f3";
export const CARD_BG      = "#ffffff";
export const TEXT_MAIN    = "#1a2e2c";
export const TEXT_MUTED   = "#6b7280";
export const BORDER       = "#e2e8e7";

// Standard font stack for the "pro" email family. Trebuchet renders on
// Windows/macOS mail clients; the fallbacks cover Android/Linux/Gmail app.
export const FONT_STACK   = "'Trebuchet MS','Segoe UI',Tahoma,sans-serif";

// ─── Shared "pro" footer (deep teal band — common to all pro emails) ──────────
/**
 * The single shared footer for the modern email family. Deep teal band with the
 * wordmark, a generic support contact, a why-you-got-this note, and copyright.
 * Action-specific contacts (e.g. bookings@) belong in the email body, not here.
 */
function buildProFooter(): string {
  const year = new Date().getFullYear();
  return `
    <tr>
      <td style="padding:28px 32px;text-align:center;background:${BRAND_DARK};font-family:${FONT_STACK};">
        <div style="font-size:17px;font-weight:bold;letter-spacing:1.5px;color:#ffffff;">NoLSAF</div>
        <div style="margin-top:12px;font-size:12px;line-height:1.8;">
          <a href="mailto:support@nolsaf.com" style="color:#b8e0d6;text-decoration:none;">support@nolsaf.com</a>
          &nbsp;&nbsp;&nbsp;
          <a href="https://nolsaf.com" style="color:#b8e0d6;text-decoration:none;">nolsaf.com</a>
        </div>
        <div style="margin-top:16px;font-size:11px;color:rgba(255,255,255,0.62);line-height:1.7;max-width:320px;margin-left:auto;margin-right:auto;">
          You are receiving this email because you have an account or a booking with NoLSAF.
        </div>
        <div style="margin-top:14px;font-size:11px;color:rgba(255,255,255,0.45);">&copy; ${year} NoLSAF. All rights reserved.</div>
      </td>
    </tr>`;
}

// ─── Pro email wrapper (logo-only header + bold headline + teal footer) ───────
/**
 * The modern NoLSAF email shell: a quiet logo-only header, a large bold
 * left-aligned headline, the body, and the shared deep-teal footer. Use with
 * the pro* building blocks below for booking/transactional emails.
 *
 * @param headline - the big bold headline (plain text; <br> allowed)
 * @param body     - inner HTML for the email body
 */
export function proEmail(headline: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:${BODY_BG};font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:${BODY_BG};">
    <tr><td align="center" style="padding:28px 12px;">

      <!-- Card -->
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
        style="max-width:600px;background:${CARD_BG};border:1px solid #e8eaea;border-radius:14px;overflow:hidden;font-family:${FONT_STACK};">

        <!-- Logo-only header -->
        <tr>
          <td style="padding:26px 32px 0;">
            <div style="font-size:21px;font-weight:bold;letter-spacing:2px;color:${BRAND_TEAL};line-height:1;">NoLSAF</div>
          </td>
        </tr>

        <!-- Headline -->
        <tr>
          <td style="padding:26px 32px 0;">
            <div style="font-size:25px;font-weight:bold;color:#1a1a1a;line-height:1.25;">${headline}</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:18px 32px 28px;color:#374151;font-size:15px;line-height:1.7;font-family:${FONT_STACK};">
            ${body}
          </td>
        </tr>

        ${buildProFooter()}

      </table>
      <!-- /Card -->

    </td></tr>
  </table>
</body>
</html>`;
}

// ─── Pro building blocks (used inside proEmail bodies) ────────────────────────

/** Quiet full-width hairline used to separate sections in a pro email. */
export function proDivider(): string {
  return `<div style="height:1px;background:#eef0f0;margin:24px 0;font-size:0;line-height:0;">&nbsp;</div>`;
}

/**
 * Tinted reference panel: an uppercase label, a large spaced code, and a note
 * explaining who to show it to and why. The accent colours the code.
 */
export function proReferenceCard(
  label: string,
  code: string,
  note: string,
  accent: string = BRAND_TEAL,
  bg: string = "#f6f8f8"
): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${bg};border:1px solid ${accent}22;border-radius:12px;">
      <tr>
        <td style="padding:20px 22px;">
          <div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#8a9290;margin-bottom:9px;">${label}</div>
          <div style="font-size:26px;font-weight:bold;letter-spacing:5px;color:${accent};font-family:${FONT_STACK};">${code}</div>
          <div style="font-size:13px;color:#5f6b69;margin-top:12px;line-height:1.6;">${note}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * Prominent value panel (e.g. an amount). Like proReferenceCard but without the
 * wide letter-spacing, so currency reads naturally.
 */
export function proHighlight(
  label: string,
  value: string,
  note: string,
  accent: string = BRAND_TEAL,
  bg: string = "#f6f8f8"
): string {
  const noteHtml = note
    ? `<div style="font-size:13px;color:#5f6b69;margin-top:10px;line-height:1.6;">${note}</div>`
    : "";
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${bg};border:1px solid ${accent}22;border-radius:12px;">
      <tr>
        <td style="padding:20px 22px;">
          <div style="font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase;color:#8a9290;margin-bottom:8px;">${label}</div>
          <div style="font-size:28px;font-weight:bold;color:${accent};font-family:${FONT_STACK};">${value}</div>
          ${noteHtml}
        </td>
      </tr>
    </table>`;
}

/**
 * Soft note block for a reason, refund detail, or "what happens next". The
 * accent colours the small title; the body stays neutral and readable.
 */
export function proNoteCard(
  accent: string,
  title: string,
  content: string,
  bg: string = "#f6f8f8"
): string {
  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${bg};border:1px solid ${accent}22;border-radius:12px;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:12px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase;color:${accent};margin-bottom:7px;">${title}</div>
          <div style="font-size:14px;color:#374151;line-height:1.7;">${content}</div>
        </td>
      </tr>
    </table>`;
}

/**
 * Solid action button for the pro email family. Use only where the email
 * genuinely requires an action (verify, reset, block) — not on info-only mail.
 */
export function proButton(url: string, label: string, accent: string = BRAND_TEAL): string {
  return `
    <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:4px 0;">
      <tr>
        <td style="border-radius:10px;background:${accent};">
          <a href="${url}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none;border-radius:10px;font-family:${FONT_STACK};">${label}</a>
        </td>
      </tr>
    </table>`;
}

/**
 * Clean ruled details list (label left / value right) with an optional
 * emphasized total row at the bottom. The accent colours the total value.
 */
export function proDetailRows(
  title: string,
  rows: Array<[string, string]>,
  total?: [string, string],
  accent: string = BRAND_TEAL
): string {
  const lastIdx = rows.length - 1;
  const rowsHtml = rows.map(([label, value], i) => {
    const divider = (i === lastIdx && !total) ? "" : "border-bottom:1px solid #eef1f1;";
    return `
    <tr>
      <td style="padding:12px 16px;font-size:13px;color:#6b7280;background:#f7f9f9;${divider}vertical-align:top;width:40%;">${label}</td>
      <td style="padding:12px 16px;font-size:14px;color:#1a1a1a;font-weight:bold;${divider}vertical-align:top;">${value}</td>
    </tr>`;
  }).join("");
  const totalHtml = total ? `
    <tr>
      <td style="padding:13px 16px;font-size:14px;color:#1a1a1a;font-weight:bold;background:#f7f9f9;">${total[0]}</td>
      <td style="padding:13px 16px;font-size:15px;color:${accent};font-weight:bold;">${total[1]}</td>
    </tr>` : "";
  const heading = title
    ? `<div style="font-size:13px;font-weight:bold;letter-spacing:0.3px;color:#1a1a1a;margin:0 0 10px;">${title}</div>`
    : "";
  return `
    ${heading}
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #e6eae9;border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;">
      ${rowsHtml}
      ${totalHtml}
    </table>`;
}
