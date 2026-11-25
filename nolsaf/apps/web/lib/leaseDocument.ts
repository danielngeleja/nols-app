import { escapeAttr, escapeHtml } from "@/utils/html";

/**
 * The long-stay lease as a printable A4 document for the shared DocumentViewer
 * (print, save as PDF). The words are the server's lease text exactly as the
 * Parties accept it (apps/api/src/lib/longStay/lease.ts); this file only lays
 * them out, using the line layout described there. The brand reads "NoLSAF";
 * no label containing it is uppercased.
 *
 * A sample (preview while listing) carries a SAMPLE watermark and no
 * fingerprint, so it cannot pass as a signed lease.
 */

export type LeaseDocumentInput = {
  text: string;
  version: string;
  /** The tenancy reference, or "SAMPLE". */
  reference: string;
  /** SHA-256 of the exact text; absent on a sample. */
  fingerprint?: string | null;
  sample?: boolean;
  landlordAcceptedAt?: string | null;
  tenantAcceptedAt?: string | null;
};

/** PDF settings for DocumentViewer: page margins and the blocks a page break must not cut. */
export const LEASE_PDF_FLOW = {
  margin: [12, 0, 14, 0] as [number, number, number, number],
  avoid: ["p", "tr", ".clause", ".part", ".title", ".signatures", ".seal"],
};

const STYLES = `
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #e5e7eb; font-family: "Trebuchet MS", Arial, sans-serif; color: #1f2937; }
  .sheet { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto 24px; padding: 16mm 18mm 20mm; background: #fff; }
  .wm-sample { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-30deg); font-size: 120px; font-weight: 800; letter-spacing: 0.2em; color: rgba(180, 83, 9, 0.07); pointer-events: none; z-index: 0; white-space: nowrap; }
  .sheet > * { position: relative; z-index: 1; }

  .letterhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 2px solid #02665e; }
  .brand { display: flex; align-items: center; gap: 9px; }
  .brand img { width: 34px; height: 34px; object-fit: contain; }
  .brand strong { display: block; font-size: 16px; color: #02665e; }
  .brand span { display: block; font-size: 9.5px; color: #64748b; }
  .ref { text-align: right; font-size: 9.5px; line-height: 1.5; color: #475569; }
  .ref b { color: #0f172a; font-family: Consolas, "Courier New", monospace; font-weight: 700; }
  .sample-tag { display: inline-block; margin-bottom: 3px; padding: 1px 7px; border-radius: 3px; background: #fef3c7; color: #92400e; font-size: 9px; font-weight: 700; letter-spacing: 0.08em; }

  .title { text-align: center; margin: 16px 0 14px; }
  .title .state { font-size: 10.5px; font-weight: 700; letter-spacing: 0.24em; color: #475569; }
  .title h1 { margin: 6px 0 2px; font-size: 19px; letter-spacing: 0.06em; color: #0f172a; }
  .title .sub { font-size: 11.5px; color: #02665e; font-weight: 700; }
  .title .meta { margin-top: 4px; font-size: 9.5px; color: #64748b; }

  p { margin: 0 0 6px; font-size: 10.6px; line-height: 1.6; text-align: justify; break-inside: avoid; }
  .lead { margin: 4px 0 8px; }
  .part { margin: 16px 0 8px; text-align: center; font-size: 10.5px; font-weight: 800; letter-spacing: 0.2em; color: #0f172a; break-after: avoid; }
  .part::before, .part::after { content: ""; display: inline-block; width: 22mm; height: 1px; margin: 0 8px; vertical-align: middle; background: #cbd5e1; }
  .clause { margin: 12px 0 5px; font-size: 11.5px; font-weight: 700; color: #02665e; break-after: avoid; }
  .num { display: grid; grid-template-columns: 9mm 1fr; }
  .num > span:first-child { font-weight: 700; color: #334155; }
  .item { display: grid; grid-template-columns: 7mm 1fr; margin-left: 9mm; }
  .recital, .party { display: grid; grid-template-columns: 8mm 1fr; }

  table.particulars { width: 100%; border-collapse: collapse; margin: 2px 0 8px; font-size: 10.4px; }
  .particulars th, .particulars td { padding: 5px 8px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; line-height: 1.45; }
  .particulars th { width: 34%; background: #f1f5f4; color: #334155; font-weight: 700; }
  .particulars tr { break-inside: avoid; }

  .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; margin-top: 12px; break-inside: avoid; }
  .sig { border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
  .sig .role { font-size: 9px; font-weight: 700; letter-spacing: 0.16em; color: #64748b; }
  .sig .line { margin: 18px 0 5px; border-bottom: 1px solid #94a3b8; font-size: 10.5px; font-weight: 700; color: #02665e; padding-bottom: 3px; }
  .sig .when { font-size: 9.5px; color: #475569; }

  .seal { margin-top: 12px; padding: 8px 10px; border-left: 3px solid #02665e; background: #f8fafc; font-size: 9.5px; line-height: 1.55; color: #475569; break-inside: avoid; }
  .seal b { font-family: Consolas, "Courier New", monospace; color: #0f172a; word-break: break-all; }
  .foot { margin-top: 14px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; justify-content: space-between; gap: 8px; font-size: 8.5px; color: #94a3b8; }

  @page { size: A4 portrait; margin: 14mm 0 16mm; @bottom-center { content: "Page " counter(page) " of " counter(pages); font: 8.5px "Trebuchet MS", Arial, sans-serif; color: #94a3b8; } }
  @media print {
    html, body { background: #fff; }
    .sheet { width: auto; min-height: 0; margin: 0; padding: 0 18mm; }
  }
`;

const eat = (iso?: string | null) =>
  iso
    ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`
    : null;

function body(text: string): string {
  const lines = text.split("\n");
  // The title block is the opening lines up to the first blank line.
  const firstBlank = lines.findIndex((l) => !l.trim());
  const title = lines.slice(0, firstBlank < 0 ? 0 : firstBlank);
  const rest = lines.slice(firstBlank < 0 ? 0 : firstBlank + 1);

  const out: string[] = [];
  if (title.length) {
    const [state, heading, sub, ...meta] = title;
    out.push(`<div class="title"><div class="state">${escapeHtml(state)}</div><h1>${escapeHtml(heading || "")}</h1>${sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ""}${meta.map((m) => `<div class="meta">${escapeHtml(m)}</div>`).join("")}</div>`);
  }

  let rows: string[] = [];
  const flushRows = () => {
    if (rows.length) out.push(`<table class="particulars"><tbody>${rows.join("")}</tbody></table>`);
    rows = [];
  };

  for (const raw of rest) {
    const line = raw.trimEnd();
    if (line.includes("\t")) {
      const [label, ...value] = line.split("\t");
      rows.push(`<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value.join(" "))}</td></tr>`);
      continue;
    }
    flushRows();
    if (!line.trim()) continue;
    let match: RegExpMatchArray | null;
    if (/^[A-Z][A-Z ,'()-]+$/.test(line)) out.push(`<div class="part">${escapeHtml(line)}</div>`);
    else if ((match = line.match(/^(\d+)\.\s+(.*)$/))) out.push(`<div class="clause">${escapeHtml(`${match[1]}. ${match[2]}`)}</div>`);
    else if ((match = line.match(/^(\d+\.\d+)\s+(.*)$/))) out.push(`<p class="num"><span>${escapeHtml(match[1])}</span><span>${escapeHtml(match[2])}</span></p>`);
    else if ((match = line.match(/^\(([a-z]{1,3})\)\s+(.*)$/))) out.push(`<p class="item"><span>(${escapeHtml(match[1])})</span><span>${escapeHtml(match[2])}</span></p>`);
    else if ((match = line.match(/^\(([A-Z])\)\s+(.*)$/))) out.push(`<p class="recital"><span>(${escapeHtml(match[1])})</span><span>${escapeHtml(match[2])}</span></p>`);
    else if ((match = line.match(/^\((\d)\)\s+(.*)$/))) out.push(`<p class="party"><span>(${escapeHtml(match[1])})</span><span>${escapeHtml(match[2])}</span></p>`);
    else if (line.startsWith("THIS AGREEMENT")) out.push(`<p class="lead"><strong>THIS AGREEMENT</strong>${escapeHtml(line.slice("THIS AGREEMENT".length))}</p>`);
    else out.push(`<p>${escapeHtml(line)}</p>`);
  }
  flushRows();
  return out.join("");
}

export function leaseDocumentHtml(input: LeaseDocumentInput): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "https://nolsaf.com";
  const logoUrl = new URL("/assets/NoLS2025-04.png", origin).toString();
  const sample = Boolean(input.sample);
  const landlordAt = eat(input.landlordAcceptedAt);
  const tenantAt = eat(input.tenantAcceptedAt);
  const short = input.fingerprint ? input.fingerprint.slice(0, 16) : null;

  const signature = (role: string, at: string | null) => `
    <div class="sig">
      <div class="role">${escapeHtml(role)}</div>
      <div class="line">${sample ? "Accepted in the NoLSAF App" : at ? "Accepted electronically" : "Not yet accepted"}</div>
      <div class="when">${sample ? "Date and time recorded on acceptance" : escapeHtml(at || "Waiting for this Party")}</div>
    </div>`;

  return `<!doctype html><html><head><meta charset="utf-8" /><title>${escapeHtml(`NoLSAF lease ${input.reference}`)}</title><style>${STYLES}</style></head><body>
  <div class="sheet">
    ${sample ? `<div class="wm-sample" aria-hidden="true">SAMPLE</div>` : ""}
    <div class="letterhead">
      <div class="brand"><img src="${escapeAttr(logoUrl)}" alt="NoLSAF" /><div><strong>NoLSAF</strong><span>NoLS Africa Company Limited · Dar es Salaam, Tanzania</span></div></div>
      <div class="ref">
        ${sample ? `<span class="sample-tag">SAMPLE</span><br />` : ""}
        Reference <b>${escapeHtml(input.reference)}</b><br />
        Version <b>${escapeHtml(input.version)}</b>
        ${short ? `<br />Fingerprint <b>${escapeHtml(short)}</b>` : ""}
      </div>
    </div>
    ${body(input.text)}
    <div class="signatures">${signature("LANDLORD", landlordAt)}${signature("TENANT", tenantAt)}</div>
    <div class="seal">
      ${sample
        ? "This is a sample built from the listing's terms. The tenant's name, the dates and the reference are filled in when a tenant reserves, and both Parties accept the final text in the NoLSAF App."
        : `Electronic record kept by NoLSAF. SHA-256 fingerprint of the accepted text: <b>${escapeHtml(input.fingerprint || "")}</b>. A copy whose fingerprint does not match is not this Agreement.`}
    </div>
    <div class="foot"><span>NoLSAF Standard Lease · ${escapeHtml(input.version)}</span><span>${escapeHtml(input.reference)}</span></div>
  </div>
</body></html>`;
}
