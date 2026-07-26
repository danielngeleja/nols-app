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

export function generateSalesContractPdf(body: string): Promise<Buffer> {
  return new Promise((resolveBuffer, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 48, bottom: 54, left: 52, right: 52 },
      compress: true,
      bufferPages: true,
      // Fixed document metadata keeps byte generation deterministic. The
      // legally relevant timestamps are printed in the agreement itself.
      info: {
        Title: "NoLSAF Sales Partner Agreement",
        Author: "NoLSAF",
        CreationDate: new Date(0),
        ModDate: new Date(0),
      },
    });
    const chunks: Buffer[] = [];
    let inCode = false;

    doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolveBuffer(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.on("pageAdded", () => {
      doc.font("Helvetica").fontSize(8).fillColor("#667085");
      doc.text("NoLSAF Sales Partner Agreement", 52, 24, { align: "right" });
      doc.fillColor("#111827");
    });

    for (const rawLine of body.split("\n")) {
      const line = safePdfText(rawLine);
      if (line.trim() === "```") {
        inCode = !inCode;
        continue;
      }
      if (inCode) {
        doc.font("Courier").fontSize(8.5).fillColor("#111827").text(line || " ", { lineGap: 1 });
        continue;
      }
      if (line.startsWith("# ")) {
        doc.moveDown(0.2).font("Helvetica-Bold").fontSize(17).fillColor("#02665e").text(line.slice(2), { align: "center" });
        doc.moveDown(0.5);
      } else if (line.startsWith("## ")) {
        doc.moveDown(0.55).font("Helvetica-Bold").fontSize(12).fillColor("#02665e").text(line.slice(3));
        doc.moveDown(0.15);
      } else if (!line.trim()) {
        doc.moveDown(0.35);
      } else {
        doc.font("Helvetica").fontSize(9.5).fillColor("#111827").text(line, { lineGap: 2, align: "justify" });
      }
    }

    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      doc.switchToPage(index);
      doc.font("Helvetica").fontSize(7.5).fillColor("#667085");
      doc.text(
        `Generated by NoLSAF - page ${index - pages.start + 1} of ${pages.count}. Verify the acceptance reference against the platform record.`,
        52,
        812,
        { width: 491, align: "center", lineBreak: false },
      );
    }
    doc.end();
  });
}

export function resetSalesContractArtifactCacheForTests(): void {
  templateCache = null;
  dictionaryCache = null;
}
