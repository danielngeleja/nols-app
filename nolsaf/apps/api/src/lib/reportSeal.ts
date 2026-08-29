// apps/api/src/lib/reportSeal.ts
//
// Tamper evident "seal" for printed admin reports.
//
// At print time an authenticated admin asks the server to seal a report. The
// server signs a compact payload (report type, range, generated time, who
// generated it, and the headline figures) with a server only secret and returns
// a JWT. The printed QR encodes a public URL that carries this token.
//
// Anyone (no login) can later submit the token to the public verify endpoint.
// The server checks the signature and returns the sealed snapshot, so an outside
// party such as a tax authority can confirm the document is genuine and that the
// printed figures match what NoLSAF recorded. Any edit to the printed copy makes
// the figures disagree with the sealed snapshot, so tampering is detectable.
//
// The secret never leaves the server. Sealing is admin only; verifying is public.

import jwt, { type Algorithm } from "jsonwebtoken";
import { publicLinkSigningSecret, verifyWithAnyPublicLinkSecret } from "./publicLinkSecrets.js";

export type ReportFigure = { label: string; value: string };

export type ReportSealInput = {
  kind: string; // e.g. "BOOKINGS" | "REVENUE" | "OWNER" | "OPERATOR"
  title: string; // human readable report title
  ref: string; // short human readable reference
  from: string; // range start (YYYY-MM-DD)
  to: string; // range end (YYYY-MM-DD)
  generatedAt: string; // ISO timestamp
  generatedBy: string; // name of the user who generated it
  role: string; // role of the generator (ADMIN, OWNER, AGENT, ...)
  figures: ReportFigure[]; // pre formatted headline figures (display only)
};

export type ReportSealPayload = ReportSealInput & {
  typ: "REPORT_VERIFICATION";
};

const ISSUER = "nolsaf-public";
// Pin the algorithm. Without this, a crafted token header (for example alg:none
// or an HS/RS confusion) could trick verification. We only ever issue HS256.
const ALGS: Algorithm[] = ["HS256"];
// Hard cap on token length we will even attempt to verify, to avoid spending
// CPU on absurdly large inputs.
const MAX_TOKEN_LENGTH = 4096;

function getReportSealSecret(): string {
  return publicLinkSigningSecret("report_seal_secret_missing");
}

export function signReportSeal(input: ReportSealInput): string {
  const payload: ReportSealPayload = { typ: "REPORT_VERIFICATION", ...input };
  // No expiry: a report must stay verifiable long after it is printed.
  return jwt.sign(payload, getReportSealSecret(), { issuer: ISSUER, algorithm: "HS256" });
}

export function verifyReportSeal(token: string): ReportSealPayload | null {
  try {
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = verifyWithAnyPublicLinkSecret<ReportSealPayload>(token, {
      issuer: ISSUER,
      algorithms: ALGS,
    });
    if (!decoded) return null;
    if (decoded?.typ !== "REPORT_VERIFICATION") return null;
    return decoded;
  } catch {
    return null;
  }
}
