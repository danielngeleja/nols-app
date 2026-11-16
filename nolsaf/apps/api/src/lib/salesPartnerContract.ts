import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import PDFDocument from "pdfkit";
import { contractTemplateFieldDictionarySchema } from "../schemas/contractTemplateSchemas.js";
import {
  LEAD_PROTECTION_DAYS,
  MIN_PAYOUT_AMOUNT,
} from "./salesPartner.js";

const TEMPLATE_PATH = "docs/NoLSAF_Sales_Partner_Agreement.md";
const DICTIONARY_PATH = "docs/NoLSAF_Sales_Partner_Agreement.fields.json";
const DAY_MS = 24 * 60 * 60 * 1000;

type ContractRecord = {
  id: number;
  contractNumber: string;
  contractVersion?: string | null;
  startsAt: Date | string;
  expiresAt: Date | string;
  nrmsCommissionRate: unknown;
  marketplaceRevenueRate: unknown;
  territory?: string | null;
  signedAt?: Date | string | null;
  acceptanceHash?: string | null;
  activatedAt?: Date | string | null;
};

type PartnerRecord = {
  id: number;
  agentCode: string;
  region?: string | null;
  territory?: string | null;
  user?: {
    id: number;
    name?: string | null;
    fullName?: string | null;
    address?: string | null;
    nin?: string | null;
  } | null;
};

export type SalesContractRenderInput = {
  contract: ContractRecord;
  partner: PartnerRecord;
  trialDays: number;
  signedAt?: Date | string | null;
  acceptanceHash?: string | null;
  activatedAt?: Date | string | null;
  nolsafSignatoryName?: string | null;
  nolsafSignatoryTitle?: string | null;
};

export type AcceptanceMetadata = {
  contractId: number;
  contractNumber: string;
  partnerId: number;
  userId: number;
  acceptedName: string;
  signedAt: string;
  ipAddress: string;
  userAgent: string;
};

let templateCache: string | null = null;
let dictionaryCache: ReturnType<typeof contractTemplateFieldDictionarySchema.parse> | null = null;

function locate(relativePath: string): string {
  const candidates = [
    resolve(process.cwd(), relativePath),
    resolve(process.cwd(), "..", relativePath),
    resolve(process.cwd(), "..", "..", relativePath),
  ];
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error(`Sales contract artifact not found: ${relativePath}`);
  return match;
}

export function loadSalesContractTemplate(): string {
  if (!templateCache) templateCache = readFileSync(locate(TEMPLATE_PATH), "utf8").replace(/\r\n/g, "\n");
  return templateCache;
}

export function loadSalesContractDictionary() {
  if (!dictionaryCache) {
    const raw = JSON.parse(readFileSync(locate(DICTIONARY_PATH), "utf8"));
    dictionaryCache = contractTemplateFieldDictionarySchema.parse(raw);
  }
  return dictionaryCache;
}

function ymd(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid contract date");
  return date.toISOString().slice(0, 10);
}

function isoOrPending(value: Date | string | null | undefined, pending: string): string {
  if (!value) return pending;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return pending;
  return date.toISOString();
}

function decimal(value: unknown): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Invalid contract rate");
  return parsed.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function requiredText(value: unknown, label: string): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`Missing required contract field: ${label}`);
  return text;
}

function formatTzs(value: number): string {
  return `TSh ${Math.round(value).toLocaleString("en-US")}`;
}

/** Values are assembled server-side only; callers cannot override legal or commercial terms. */
export function buildSalesContractFields(input: SalesContractRenderInput): Record<string, string> {
  const { contract, partner } = input;
  const user = partner.user;
  const startsAt = new Date(contract.startsAt);
  const expiresAt = new Date(contract.expiresAt);
  const termDays = Math.round((expiresAt.getTime() - startsAt.getTime()) / DAY_MS);

  const legalName = requiredText(user?.fullName || user?.name, "PARTNER_LEGAL_NAME");
  const address = requiredText(user?.address || partner.territory, "PARTNER_ADDRESS");
  const identityNumber = requiredText(user?.nin, "PARTNER_ID_NUMBER");
  const territory = requiredText(contract.territory || partner.territory || partner.region, "TERRITORY");

  return {
    CONTRACT_ID: requiredText(contract.contractNumber, "CONTRACT_ID"),
    CONTRACT_VERSION: requiredText(contract.contractVersion || "1.0.0", "CONTRACT_VERSION"),
    AGENT_CODE: requiredText(partner.agentCode, "AGENT_CODE"),
    PARTNER_LEGAL_NAME: legalName,
    PARTNER_ADDRESS: address,
    PARTNER_ID_NUMBER: identityNumber,
    NOLSAF_JURISDICTION: "the United Republic of Tanzania",
    NOLSAF_ADDRESS: "Dar es Salaam, Tanzania",
    STARTS_AT: ymd(startsAt),
    EXPIRES_AT: ymd(expiresAt),
    TERM_DAYS: String(termDays),
    TERRITORY: territory,
    EXCLUSIVITY_TERMS: "None. This territory is non-exclusive.",
    NRMS_COMMISSION_RATE: decimal(contract.nrmsCommissionRate),
    MARKETPLACE_REVENUE_RATE: decimal(contract.marketplaceRevenueRate),
    TRIAL_DAYS: String(input.trialDays),
    LEAD_PROTECTION_DAYS: String(LEAD_PROTECTION_DAYS),
    MIN_PAYOUT_AMOUNT: formatTzs(MIN_PAYOUT_AMOUNT),
    TERMINATION_PENDING_TREATMENT:
      "is paid once that period has run, provided the underlying revenue is not reversed",
    NOTICE_DAYS: "30",
    GOVERNING_LAW: "the United Republic of Tanzania",
    ARBITRATION_LOCATION: "Dar es Salaam, Tanzania",
    SIGNED_AT: isoOrPending(input.signedAt ?? contract.signedAt, "Pending partner acceptance"),
    ACCEPTANCE_HASH: input.acceptanceHash ?? contract.acceptanceHash ?? "Pending partner acceptance",
    ACTIVATED_AT: isoOrPending(input.activatedAt ?? contract.activatedAt, "Pending NoLSAF activation"),
    NOLSAF_SIGNATORY_NAME:
      String(input.nolsafSignatoryName || process.env.CONTRACT_NOLSAF_SIGNATORY_NAME || "NoLSAF authorised signatory").trim(),
    NOLSAF_SIGNATORY_TITLE:
      String(input.nolsafSignatoryTitle || process.env.CONTRACT_NOLSAF_SIGNATORY_TITLE || "Director").trim(),
  };
}

export function renderSalesContract(fields: Record<string, string>): string {
  const dictionary = loadSalesContractDictionary();
  const required = new Set(dictionary.fields.filter((field) => field.required).map((field) => field.placeholder));
  const unresolved: string[] = [];
  const rendered = loadSalesContractTemplate().replace(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    const value = fields[key];
    if ((!value || value.startsWith("Pending ")) && required.has(key)) unresolved.push(key);
    return value || `{{${key}}}`;
  });
  if (unresolved.length) {
    throw new Error(`Unresolved required contract fields: ${[...new Set(unresolved)].join(", ")}`);
  }
  const remaining = rendered.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (remaining?.length) throw new Error(`Unknown contract placeholders: ${remaining.join(", ")}`);
  return rendered.replace(/[ \t]+$/gm, "").trimEnd() + "\n";
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalAcceptanceMetadata(metadata: AcceptanceMetadata): string {
  return JSON.stringify({
    acceptedName: metadata.acceptedName,
    contractId: metadata.contractId,
    contractNumber: metadata.contractNumber,
    ipAddress: metadata.ipAddress,
    partnerId: metadata.partnerId,
    signedAt: metadata.signedAt,
    userAgent: metadata.userAgent,
    userId: metadata.userId,
  });
}

export function buildAcceptanceHash(termsBody: string, metadata: AcceptanceMetadata): string {
  return buildAcceptanceHashFromTermsHash(sha256(termsBody), metadata);
}

export function buildAcceptanceHashFromTermsHash(
  termsHash: string,
  metadata: AcceptanceMetadata,
): string {
  if (!/^[a-f0-9]{64}$/.test(termsHash)) throw new Error("Invalid accepted terms hash");
  return sha256(`${termsHash}\n--NOLSAF-SALES-ACCEPTANCE--\n${canonicalAcceptanceMetadata(metadata)}`);
}

export function finalizeAcceptedSalesContractFields(
  snapshot: unknown,
  countersignature: {
    activatedAt: Date | string;
    signatoryName: string;
    signatoryTitle: string;
  },
): Record<string, string> {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("The immutable partner-signed field snapshot is missing");
  }
  const fields = Object.fromEntries(
    Object.entries(snapshot as Record<string, unknown>)
      .filter(([key, value]) => key !== "termsHash" && typeof value === "string")
      .map(([key, value]) => [key, String(value)]),
  );
  fields.ACTIVATED_AT = isoOrPending(countersignature.activatedAt, "Pending NoLSAF activation");
  fields.NOLSAF_SIGNATORY_NAME = requiredText(countersignature.signatoryName, "NOLSAF_SIGNATORY_NAME");
  fields.NOLSAF_SIGNATORY_TITLE = requiredText(countersignature.signatoryTitle, "NOLSAF_SIGNATORY_TITLE");
  return fields;
}

export function normalizeLegalName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en");
}

function safePdfText(value: string): string {
  return value
    .replace(/\*\*/g, "")
    .replace(/^>\s?/gm, "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/—/g, "-");
}

type SalesContractFonts = { regular: string; bold: string };

const SALES_CONTRACT_SECTION_TITLES = new Set([
  "Nature of the relationship",
  "Term",
  "Territory",
  "Attribution",
  "What the Partner earns",
  "When the Partner earns",
  "Reversal",
  "Payment",
  "Conduct",
  "Termination",
  "Governing law and disputes",
  "Entire agreement",
  "Notices",
  "Confidentiality and records",
  "Responsibility and claims",
  "Events outside reasonable control",
  "Assignment and transfer",
  "Electronic records",
  "Acceptance",
]);

const SALES_CONTRACT_METADATA_LABELS = new Set([
  "Contract ID",
  "Contract Version",
  "Agent Code",
  "Commencement Date",
  "Expiry Date",
]);

const SALES_CONTRACT_EXAMPLE_LABELS = new Set([
  "Booking value",
  "NoLSAF commission (10%)",
  "Tax and processing",
  "Eligible net NoLSAF revenue",
  "Partner rate",
  "Partner earning",
]);

function registerSalesContractFonts(doc: PDFKit.PDFDocument): SalesContractFonts {
  const regularPath = [
    process.env.TREBUCHET_MS_REGULAR_PATH,
    "C:\\Windows\\Fonts\\trebuc.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebuc.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebuc.ttf",
  ].filter((value): value is string => Boolean(value)).find(existsSync);
  const boldPath = [
    process.env.TREBUCHET_MS_BOLD_PATH,
    "C:\\Windows\\Fonts\\trebucbd.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebucbd.ttf",
    "/usr/share/fonts/truetype/msttcorefonts/trebucbd.ttf",
  ].filter((value): value is string => Boolean(value)).find(existsSync);

  if (!regularPath || !boldPath) return { regular: "Helvetica", bold: "Helvetica-Bold" };
  doc.registerFont("Sales-Trebuchet", regularPath);
  doc.registerFont("Sales-Trebuchet-Bold", boldPath);
  return { regular: "Sales-Trebuchet", bold: "Sales-Trebuchet-Bold" };
}

export function generateSalesContractPdf(body: string): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 52, bottom: 62, left: 52, right: 52 },
      compress: true,
      bufferPages: true,
      info: {
        Title: "NoLSAF Sales Partner Agreement",
        Author: "NoLSAF",
        CreationDate: new Date(0),
        ModDate: new Date(0),
      },
    });
    const chunks: Buffer[] = [];
    const fonts = registerSalesContractFonts(doc);
    const contentWidth = 491.28;
    const teal = "#02665e";
    const emerald = "#087f68";
    const ink = "#172033";
    const muted = "#667085";
    const border = "#d9e2e1";
    const pale = "#eef8f5";
    let inCode = false;
    let codeRows: Array<{ label: string; value: string }> = [];
    const metadata: Array<{ label: string; value: string }> = [];
    let metadataDone = false;

    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Later pages: brand left, document right, one hairline.
    const drawRunningHeader = () => {
      doc.font(fonts.bold).fontSize(8).fillColor(teal)
        .text("NoLSAF", 52, 24, { lineBreak: false });
      doc.font(fonts.regular).fontSize(7.5).fillColor(muted)
        .text("Sales partner agreement", 52, 24.5, { width: contentWidth, align: "right", lineBreak: false });
      doc.moveTo(52, 40).lineTo(543.28, 40).lineWidth(0.5).strokeColor(border).stroke();
      doc.y = 56;
      doc.x = 52;
      doc.fillColor(ink);
    };

    doc.on("pageAdded", drawRunningHeader);

    // First page: a document title block, not a coloured banner.
    doc.font(fonts.bold).fontSize(9).fillColor(teal)
      .text("NoLSAF", 52, 46, { lineBreak: false });
    doc.font(fonts.regular).fontSize(8).fillColor(muted)
      .text("NoLS Africa Co Ltd", 52, 46.5, { width: contentWidth, align: "right", lineBreak: false });
    doc.font(fonts.bold).fontSize(21).fillColor(ink)
      .text("Sales partner agreement", 52, 66, { width: contentWidth, lineBreak: false });
    doc.font(fonts.regular).fontSize(9).fillColor(muted)
      .text("Controlled partner agreement record. The platform copy is the reference.", 52, 94, { width: contentWidth, lineBreak: false });
    doc.moveTo(52, 114).lineTo(543.28, 114).lineWidth(1.2).strokeColor(teal).stroke();
    doc.y = 128;

    const ensureSpace = (height: number) => {
      if (doc.y + height > 775) doc.addPage();
    };

    // Contract facts: a grid of label-over-value cells, drawn once.
    const sentence = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
    const drawMetadata = () => {
      if (metadataDone || !metadata.length) return;
      metadataDone = true;
      const cols = 3;
      const cellW = contentWidth / cols;
      const cellH = 40;
      const rows = Math.ceil(metadata.length / cols);
      ensureSpace(rows * cellH + 16);
      const top = doc.y;
      doc.rect(52, top, contentWidth, rows * cellH).fill("#f8faf9");
      metadata.forEach((item, i) => {
        const x = 52 + (i % cols) * cellW;
        const y = top + Math.floor(i / cols) * cellH;
        doc.font(fonts.regular).fontSize(7.5).fillColor(muted)
          .text(sentence(item.label), x + 12, y + 9, { width: cellW - 24, lineBreak: false });
        doc.font(fonts.bold).fontSize(10).fillColor(ink)
          .text(item.value, x + 12, y + 21, { width: cellW - 24, lineBreak: false, ellipsis: true });
      });
      doc.lineWidth(0.5).strokeColor(border);
      doc.rect(52, top, contentWidth, rows * cellH).stroke();
      for (let c = 1; c < cols; c += 1) doc.moveTo(52 + c * cellW, top).lineTo(52 + c * cellW, top + rows * cellH).stroke();
      for (let r = 1; r < rows; r += 1) doc.moveTo(52, top + r * cellH).lineTo(543.28, top + r * cellH).stroke();
      doc.y = top + rows * cellH + 18;
      doc.x = 52;
    };

    // Worked example as a sum: operator, label, amount; subtotal ruled, result highlighted.
    const exampleStep = (label: string): { op: string; kind: "start" | "apply" | "subtotal" | "result" } => {
      const l = label.toLowerCase();
      if (/partner earning/.test(l)) return { op: "=", kind: "result" };
      if (/eligible|net /.test(l)) return { op: "=", kind: "subtotal" };
      if (/tax|processing|fee/.test(l)) return { op: "-", kind: "apply" };
      if (/rate|commission/.test(l)) return { op: "x", kind: "apply" };
      return { op: "", kind: "start" };
    };
    const drawWorkedExample = () => {
      if (!codeRows.length) return;
      const width = 330;
      const rowH = 22;
      ensureSpace(34 + codeRows.length * rowH);
      let y = doc.y + 4;
      const boxTop = y;
      doc.rect(52, y, width, 24).fill("#f3f6f5");
      doc.font(fonts.bold).fontSize(8.5).fillColor(ink)
        .text("Worked marketplace example", 62, y + 8, { width: 200, lineBreak: false });
      doc.font(fonts.regular).fontSize(7.5).fillColor(muted)
        .text("Illustration only", 52, y + 8.5, { width: width - 10, align: "right", lineBreak: false });
      y += 24;
      for (const row of codeRows) {
        const step = exampleStep(row.label);
        const strong = step.kind === "subtotal" || step.kind === "result";
        const result = step.kind === "result";
        if (result) doc.rect(52, y, width, rowH).fill(pale);
        doc.moveTo(52, y).lineTo(52 + width, y).lineWidth(strong ? 0.8 : 0.4).strokeColor(strong ? "#b8c4c2" : border).stroke();
        const color = result ? emerald : ink;
        doc.font(fonts.bold).fontSize(9).fillColor(result ? emerald : muted)
          .text(step.op, 58, y + 6.5, { width: 14, align: "center", lineBreak: false });
        doc.font(strong ? fonts.bold : fonts.regular).fontSize(8.6).fillColor(color)
          .text(row.label, 78, y + 7, { width: 170, lineBreak: false });
        doc.font(fonts.bold).fontSize(result ? 10 : 8.6).fillColor(color)
          .text(row.value, 52, y + (result ? 6 : 7), { width: width - 12, align: "right", lineBreak: false });
        y += rowH;
      }
      doc.rect(52, boxTop, width, y - boxTop).lineWidth(0.5).strokeColor(border).stroke();
      doc.y = y + 10;
      doc.x = 52;
      codeRows = [];
    };

    for (const rawLine of body.split("\n")) {
      const line = safePdfText(rawLine);
      if (line.trim() === "```") {
        if (inCode) drawWorkedExample();
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        const match = line.trim().match(/^(.+?):\s{2,}(.+)$/);
        if (match) {
          codeRows.push({
            label: match[1].trim(),
            value: match[2].replace(/\s+/g, " ").trim(),
          });
        }
        continue;
      }
      const workedExample = line.trim().match(/^(.+?):\s{2,}(.+)$/);
      if (workedExample && SALES_CONTRACT_EXAMPLE_LABELS.has(workedExample[1].trim())) {
        codeRows.push({
          label: workedExample[1].trim(),
          value: workedExample[2].replace(/\s+/g, " ").trim(),
        });
        continue;
      }
      if (codeRows.length) drawWorkedExample();

      if (line.startsWith("# ") || line.trim() === "NoLSAF SALES PARTNER AGREEMENT") {
        continue;
      }
      const meta =
        rawLine.match(/^\*\*(.+?):\*\*\s*(.+)$/) ||
        rawLine.match(/^([^:]+):\s*(.+)$/);
      if (meta && !metadataDone && SALES_CONTRACT_METADATA_LABELS.has(meta[1].trim())) {
        metadata.push({ label: meta[1].trim(), value: safePdfText(meta[2]) });
      } else {
        if (line.trim()) drawMetadata();
        const plainSection = line.match(/^(\d+)\.\s+(.+)$/);
        const isPlainSection = Boolean(
          plainSection && SALES_CONTRACT_SECTION_TITLES.has(plainSection[2].trim()),
        );
        if (line.startsWith("## ") || isPlainSection) {
        // Section: number in brand colour, title in ink, a hairline under it.
        ensureSpace(46);
        doc.moveDown(0.6);
        const y = doc.y;
        const heading = (line.startsWith("## ") ? line.slice(3) : line).trim();
        const num = heading.match(/^(\d+)\.?\s*/);
        const titleText = num ? heading.slice(num[0].length) : heading;
        if (num) {
          doc.font(fonts.bold).fontSize(11).fillColor(emerald).text(num[1], 52, y, { width: 24, lineBreak: false });
        }
        doc.font(fonts.bold).fontSize(11).fillColor(ink).text(titleText, num ? 76 : 52, y, {
          width: contentWidth - (num ? 24 : 0),
          lineBreak: false,
        });
        doc.moveTo(52, y + 17).lineTo(543.28, y + 17).lineWidth(0.5).strokeColor(border).stroke();
        doc.y = y + 25;
        doc.x = 52;
        } else if (line.trim() === "Partner" || line.trim() === "For NoLSAF") {
          ensureSpace(30);
          doc.moveDown(0.5);
          doc.font(fonts.bold).fontSize(10).fillColor(ink).text(line.trim(), 52, doc.y, {
            width: contentWidth,
            underline: false,
          });
          doc.moveTo(52, doc.y + 2).lineTo(543.28, doc.y + 2).lineWidth(0.5).strokeColor(border).stroke();
          doc.moveDown(0.35);
        } else if (!line.trim()) {
        doc.moveDown(0.15);
        } else {
        const clause = line.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
        if (clause) {
          ensureSpace(24);
          const y = doc.y;
          doc.font(fonts.bold).fontSize(8.5).fillColor(emerald)
            .text(clause[1], 52, y, { width: 36, lineBreak: false });
          doc.font(fonts.regular).fontSize(9).fillColor(ink)
            .text(clause[2], 94, y, { width: 449, lineGap: 2, align: "left" });
          doc.moveDown(0.25);
          doc.x = 52;
        } else {
          doc.x = 52;
          doc.font(fonts.regular).fontSize(9).fillColor(ink)
            .text(line, { width: contentWidth, lineGap: 2, align: "left" });
          doc.moveDown(0.2);
        }
        }
      }
    }
    if (codeRows.length) drawWorkedExample();
    drawMetadata();

    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      doc.switchToPage(index);
      const originalBottomMargin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      doc.moveTo(52, 804).lineTo(543.28, 804).lineWidth(0.5).strokeColor(border).stroke();
      doc.font(fonts.regular).fontSize(7.2).fillColor(muted);
      doc.text(
        `Page ${index - pages.start + 1} of ${pages.count}  ·  NoLSAF sales partner agreement  ·  Check the acceptance reference against the platform record`,
        52,
        814,
        { width: 491, align: "center", lineBreak: false },
      );
      doc.page.margins.bottom = originalBottomMargin;
    }
    doc.end();
  });
}

export function resetSalesContractArtifactCacheForTests(): void {
  templateCache = null;
  dictionaryCache = null;
}
