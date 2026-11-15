/**
 * Public property verification certificate: what may be printed on it.
 *
 * - The reference is a keyed hash of the verification record, never a row id,
 *   so certificates cannot be counted or guessed. A check character catches a
 *   mistyped reference.
 * - The verifier is shown as the team plus a short reviewer code, never a
 *   staff member's name.
 * - Private homes show only district and region (the same rule as the public
 *   listing before booking); businesses keep their full address.
 * - There is no expiry date: a certificate is valid for as long as the
 *   property stays approved and its verification stands. The live QR check is
 *   what proves that, not a printed date.
 * - The fingerprint is a hash of everything printed, so a printout can be
 *   compared with the live page: a changed field changes the fingerprint.
 */
import { createHash, createHmac } from "node:crypto";
import { hasPublicExactLocation } from "./propertyLocationPrivacy.js";
import { publicLinkSigningSecret } from "./publicLinkSecrets.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function keyed(label: string, value: string): Buffer {
  return createHmac("sha256", publicLinkSigningSecret("property_certificate_secret_missing")).update(`${label}:${value}`).digest();
}

function base32(bytes: Buffer, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += CROCKFORD[bytes[i] % 32];
  return out;
}

/** Weighted mod-32 check character over the reference body. */
export function referenceCheckChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) sum += (CROCKFORD.indexOf(body[i]) + 1) * (i + 1);
  return CROCKFORD[sum % 32];
}

/** "NLS-7K3Q-9XMD-F": stable for one verification record, unguessable. */
export function certificateReference(propertyId: number, verificationId: number): string {
  const body = base32(keyed("property-certificate", `${propertyId}:${verificationId}`), 8);
  return `NLS-${body.slice(0, 4)}-${body.slice(4)}-${referenceCheckChar(body)}`;
}

/** True when the reference is well formed and its check character matches. */
export function isValidCertificateReference(ref: string): boolean {
  const m = /^NLS-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z])$/.exec(String(ref || "").toUpperCase());
  return !!m && referenceCheckChar(m[1] + m[2]) === m[3];
}

/** "R-4QK9": identifies the reviewer to NoLSAF staff without naming them. */
export function reviewerCode(userId: number | null | undefined): string | null {
  if (!Number.isInteger(userId)) return null;
  return `R-${base32(keyed("property-reviewer", String(userId)), 4)}`;
}

/** Location safe to print. Repeated names (ward equal to street) appear once. */
export function certificateLocation(p: { type?: unknown; street?: string | null; ward?: string | null; district?: string | null; regionName?: string | null; country?: string | null }): string {
  const exact = hasPublicExactLocation(p.type);
  const parts = (exact ? [p.street, p.ward, p.district, p.regionName] : [p.district, p.regionName])
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter(Boolean);
  const seen = new Set<string>();
  const unique = parts.filter((v) => {
    const k = v.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const country = typeof p.country === "string" && p.country.trim() ? p.country.trim() : "Tanzania";
  return [...unique, country].join(", ");
}

/** "3F9A 0C21 7B44 E1D0": a hash of every printed field, in a fixed order. */
export function certificateFingerprint(fields: Record<string, unknown>): string {
  const canonical = Object.keys(fields).sort().map((k) => `${k}=${JSON.stringify(fields[k] ?? null)}`).join("\n");
  const hex = createHash("sha256").update(canonical).digest("hex").slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g)!.join(" ");
}

/** The checklist as printed; a site visit stated in the method is always listed. */
export function certificateChecklist(checklist: string[], method: string | null | undefined): string[] {
  const items = checklist.length
    ? checklist
    : ["Property details reviewed", "Location and listing information checked", "Photos and stay information reviewed", "Host listing approved"];
  const claimsVisit = /site\s*visit/i.test(String(method || ""));
  const listsVisit = items.some((i) => /site|visit|on\s*site|physical/i.test(i));
  return claimsVisit && !listsVisit ? ["Site visited by NoLSAF", ...items] : items;
}
