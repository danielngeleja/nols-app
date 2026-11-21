/**
 * Long-stay tenant identity check (docs/LONG_STAY_RENTALS.md, decision 10).
 *
 * A tenant proves who they are once, before the first booking payment, with
 * one of three documents, checked to international rules:
 *  - PASSPORT from any state: ICAO Doc 9303 document number (up to 9 letters
 *    and digits), issuing state as ISO 3166-1 alpha-2;
 *  - NATIONAL_ID: Tanzania NIDA, or a Kenya, Uganda, Rwanda or Burundi card,
 *    each with its own number format; front and back;
 *  - RES_PERMIT: a Tanzania residence permit, for foreigners living here.
 * Every document needs its expiry date, the holder's name and date of birth
 * as printed, the nationality, and a selfie holding the document. The holder
 * must be 18 or older (a lease is a contract) and the document must not
 * expire within 30 days.
 *
 * An admin compares the photos with the account and approves; the approval
 * is reused for later long stays until the document nears expiry.
 *
 * The full ID number is never stored. We keep:
 *  - a keyed hash, so the same ID on two accounts is spotted (fraud, bans);
 *  - the last 4 characters, so the reviewer can match the photo.
 * The photos are private (authenticated) Cloudinary uploads under
 * traveller-documents/long-stay-id/, opened only through a 5-minute signed URL.
 */
import { createHmac } from "node:crypto";
import { z } from "zod";
import { publicLinkSigningSecret } from "../publicLinkSecrets.js";
import { isTravellerDocumentPublicId } from "../travellerDocuments.js";

export const TENANT_ID_FOLDER = "traveller-documents/long-stay-id";
export const TENANT_ROLES = ["CUSTOMER", "USER", "TRAVELLER", "TRAVELER"] as const;
export const ID_TYPES = ["PASSPORT", "NATIONAL_ID", "RES_PERMIT"] as const;
export type IdType = (typeof ID_TYPES)[number];
export type TenantIdStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

/** The document must stay valid at least this long after it is sent. */
export const MIN_VALID_DAYS = 30;
/** An approved ID this close to expiry may be replaced, and shows as Expiring. */
export const RENEW_WINDOW_DAYS = 60;
export const MIN_AGE = 18;

export class TenantIdentityError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "TenantIdentityError";
  }
}

export function isTenantRole(role: unknown): boolean {
  return (TENANT_ROLES as readonly string[]).includes(String(role || "").toUpperCase());
}

// ---------- Countries (ISO 3166-1 alpha-2) ----------

/**
 * The 249 assigned ISO 3166-1 alpha-2 codes, plus XK (Kosovo issues
 * passports). Fixed, not read from the runtime's region names, which also
 * know retired codes (FQ, ZR, CS). Same list as apps/web/lib/isoCountries.ts.
 */
const ISO_COUNTRIES = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" "));

export function isIsoCountry(code: unknown): code is string {
  return typeof code === "string" && ISO_COUNTRIES.has(code);
}

/** National ID cards whose number format we can check. Anyone else uses a passport. */
export const NATIONAL_ID_RULES: Record<string, { name: string; pattern: RegExp; message: string }> = {
  TZ: { name: "NIDA", pattern: /^\d{20}$/, message: "A NIDA number has 20 digits." },
  KE: { name: "Kenya national ID", pattern: /^\d{7,9}$/, message: "A Kenyan ID number has 7 to 9 digits." },
  UG: { name: "Uganda national ID", pattern: /^C[MF][A-Z0-9]{12}$/, message: "A Ugandan NIN has 14 characters and starts with CM or CF." },
  RW: { name: "Rwanda national ID", pattern: /^\d{16}$/, message: "A Rwandan ID number has 16 digits." },
  BI: { name: "Burundi national ID", pattern: /^[A-Z0-9]{6,20}$/, message: "Enter the Burundi ID number as printed, 6 to 20 letters and digits." },
};

/**
 * Checks the number against the document's rules and returns it compact
 * (upper case, no spaces or dashes).
 */
export function normalizeIdNumber(idType: IdType, country: string, raw: string): string {
  const compact = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
  if (idType === "PASSPORT") {
    // ICAO 9303: the document number field holds up to 9 characters, A-Z and 0-9.
    if (!/^[A-Z0-9]{6,9}$/.test(compact) || !/\d/.test(compact)) {
      throw new TenantIdentityError("Enter the passport number as printed, 6 to 9 letters and digits.");
    }
    return compact;
  }
  if (idType === "NATIONAL_ID") {
    const rule = NATIONAL_ID_RULES[country];
    if (!rule) throw new TenantIdentityError("Use a passport for ID cards from this country.");
    if (!rule.pattern.test(compact)) throw new TenantIdentityError(rule.message);
    return compact;
  }
  if (!/^[A-Z0-9]{6,20}$/.test(compact) || !/\d/.test(compact)) {
    throw new TenantIdentityError("Enter the residence permit number as printed, 6 to 20 letters and digits.");
  }
  return compact;
}

function hashSecret(): string {
  // A dedicated secret keeps the hash stable when public link secrets rotate.
  return process.env.LONG_STAY_ID_HASH_SECRET || publicLinkSigningSecret("long_stay_id_hash_secret_missing");
}

export function hashIdNumber(idType: IdType, country: string, normalized: string): string {
  return createHmac("sha256", hashSecret()).update(`long-stay-id:${idType}:${country}:${normalized}`).digest("hex");
}

// ---------- Dates ----------

function todayInEat(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

function dayOf(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
}

function addDays(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Whole years between a date of birth and a day (both YYYY-MM-DD). */
export function ageOn(dateOfBirth: string, day: string): number {
  const [by, bm, bd] = dateOfBirth.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

const isRealDay = (value: string) => {
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

// ---------- Submission ----------

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDay);
const country = z.string().trim().toUpperCase().refine(isIsoCountry);
const upload = z.object({
  publicId: z.string().trim().max(300),
  resourceType: z.enum(["image", "raw"]).default("image"),
  url: z.string().trim().url().max(2048),
}).strict();
export type IdUpload = z.infer<typeof upload>;

export const submitIdentitySchema = z.object({
  idType: z.enum(ID_TYPES),
  idNumber: z.string().trim().min(5).max(40),
  /** Issuing state. A residence permit is always TZ. */
  idCountry: country.optional().nullable(),
  nationality: country.optional().nullable(),
  holderName: z.string().trim().min(2).max(120),
  dateOfBirth: day,
  expiresOn: day,
  front: upload,
  back: upload.optional().nullable(),
  selfie: upload,
}).strict();

export type PreparedIdentity = {
  idType: IdType;
  idCountry: string;
  nationality: string;
  idNumberHash: string;
  idNumberLast4: string;
  holderName: string;
  dateOfBirth: Date;
  idExpiresOn: Date;
  front: IdUpload;
  back: IdUpload | null;
  selfie: IdUpload;
};

const NAME = /^[\p{L}][\p{L}\p{M} .,'-]{1,119}$/u;

function ownUpload(value: IdUpload, what: string): IdUpload {
  if (!isTravellerDocumentPublicId(value.publicId) || !value.publicId.startsWith(`${TENANT_ID_FOLDER}/`)) {
    throw new TenantIdentityError(`Upload the ${what} again.`);
  }
  return value;
}

/** Validates a submission; throws TenantIdentityError with a message for the tenant. */
export function prepareIdentity(input: unknown, now = new Date()): PreparedIdentity {
  const parsed = submitIdentitySchema.safeParse(input);
  if (!parsed.success) {
    const field = String(parsed.error.issues[0]?.path?.[0] ?? "");
    const message: Record<string, string> = {
      idCountry: "Choose the country that issued the document.",
      nationality: "Choose your nationality.",
      holderName: "Enter your name exactly as printed on the document.",
      dateOfBirth: "Enter your date of birth.",
      expiresOn: "Enter the expiry date printed on the document.",
      front: "Add a photo of the document.",
      selfie: "Add a selfie holding the document.",
    };
    throw new TenantIdentityError(message[field] || "Choose the document, enter its details and add the photos.");
  }
  const data = parsed.data;
  const today = todayInEat(now);

  const idCountry = data.idType === "RES_PERMIT" ? "TZ" : data.idCountry || "";
  if (!idCountry) throw new TenantIdentityError("Choose the country that issued the document.");
  const nationality = data.nationality || (data.idType === "NATIONAL_ID" ? idCountry : "");
  if (!nationality) throw new TenantIdentityError("Choose your nationality.");
  if (data.idType === "RES_PERMIT" && nationality === "TZ") throw new TenantIdentityError("Tanzanian citizens use their NIDA card or passport.");
  if (data.idType === "NATIONAL_ID" && nationality !== idCountry) throw new TenantIdentityError("A national ID card belongs to a citizen of the country that issued it. Use your passport.");

  const holderName = data.holderName.replace(/\s+/g, " ");
  if (!NAME.test(holderName)) throw new TenantIdentityError("Enter your name exactly as printed on the document, in letters only.");

  if (data.dateOfBirth >= today) throw new TenantIdentityError("Check your date of birth.");
  const age = ageOn(data.dateOfBirth, today);
  if (age > 120) throw new TenantIdentityError("Check your date of birth.");
  if (age < MIN_AGE) throw new TenantIdentityError("Long-stay tenants must be 18 or older to sign a lease.");

  if (data.expiresOn <= today) throw new TenantIdentityError("This document has expired. Use a valid one.");
  if (data.expiresOn < addDays(today, MIN_VALID_DAYS)) throw new TenantIdentityError(`This document expires within ${MIN_VALID_DAYS} days. Renew it first or use another one.`);
  if (data.expiresOn > addDays(today, 365 * 20)) throw new TenantIdentityError("Check the expiry date.");

  const normalized = normalizeIdNumber(data.idType, idCountry, data.idNumber);

  const front = ownUpload(data.front, data.idType === "PASSPORT" ? "photo page" : "front of the card");
  const selfie = ownUpload(data.selfie, "selfie");
  let back: IdUpload | null = null;
  if (data.idType !== "PASSPORT") {
    if (!data.back) throw new TenantIdentityError("Add a photo of the back of the card.");
    back = ownUpload(data.back, "back of the card");
  }
  const ids = [front.publicId, selfie.publicId, back?.publicId].filter(Boolean);
  if (new Set(ids).size !== ids.length) throw new TenantIdentityError("Each photo must be a different picture.");

  return {
    idType: data.idType,
    idCountry,
    nationality,
    idNumberHash: hashIdNumber(data.idType, idCountry, normalized),
    idNumberLast4: normalized.slice(-4),
    holderName,
    dateOfBirth: new Date(`${data.dateOfBirth}T00:00:00Z`),
    idExpiresOn: new Date(`${data.expiresOn}T00:00:00Z`),
    front,
    back,
    selfie,
  };
}

// ---------- Views and gates ----------

/** Whether the document expires within the renew window (or already has). */
export function idExpiring(profile: any, now = new Date()): boolean {
  const expires = dayOf(profile?.idExpiresOn);
  return Boolean(expires && expires <= addDays(todayInEat(now), RENEW_WINDOW_DAYS));
}

/** An approved ID may be replaced by the tenant only when it nears expiry. */
export function canReplaceApprovedId(profile: any, now = new Date()): boolean {
  return profile?.status === "APPROVED" && idExpiring(profile, now);
}

/** What the tenant may see about their own check. */
export function tenantIdentityView(profile: any, phoneVerified: boolean, now = new Date()) {
  return {
    status: (profile?.status ?? "NONE") as TenantIdStatus,
    idType: profile?.idType ?? null,
    idNumberLast4: profile?.idNumberLast4 ?? null,
    idCountry: profile?.idCountry ?? null,
    idExpiresOn: dayOf(profile?.idExpiresOn),
    expiring: profile?.status === "APPROVED" ? idExpiring(profile, now) : false,
    submittedAt: profile?.submittedAt ?? null,
    reviewedAt: profile?.reviewedAt ?? null,
    rejectReason: profile?.status === "REJECTED" ? profile?.rejectReason ?? null : null,
    barred: Boolean(profile?.barredAt),
    phoneVerified,
  };
}

/**
 * Why this tenant cannot sign or pay for a long stay yet, or null. When
 * `validThrough` (the lease end) is given, the document must last that long.
 */
export function tenantPaymentRefusal(profile: any, validThrough?: Date | string | null, now = new Date()): string | null {
  if (!profile || profile.status === "NONE") return "Verify your ID before booking a long stay.";
  if (profile.barredAt) return "Your account cannot book long stays. Contact NoLSAF support.";
  if (profile.status === "PENDING") return "NoLSAF is still checking your ID.";
  if (profile.status !== "APPROVED") return "Your ID check was not approved. Submit it again.";
  const expires = dayOf(profile.idExpiresOn);
  if (expires && expires <= todayInEat(now)) return "Your ID has expired. Send a valid one in Long-stay ID.";
  const leaseEnd = dayOf(validThrough);
  if (expires && leaseEnd && expires < leaseEnd) return "Your ID expires before this lease ends. Send a newer one in Long-stay ID.";
  return null;
}

// ---------- Reviewer helpers ----------

function nameTokens(value: unknown): string[] {
  return String(value || "")
    .normalize("NFD").replace(/\p{M}/gu, "")
    .toUpperCase().split(/[^A-Z]+/).filter((t) => t.length > 1);
}

/**
 * How the name printed on the document compares with the account name:
 * MATCH (every account name word is on the document), PARTIAL (some), or
 * DIFFERENT. A hint for the reviewer, who still confirms it by eye.
 */
export function nameAgreement(holderName: unknown, accountName: unknown): "MATCH" | "PARTIAL" | "DIFFERENT" | "UNKNOWN" {
  const doc = new Set(nameTokens(holderName));
  const account = nameTokens(accountName);
  if (!doc.size || !account.length) return "UNKNOWN";
  const hits = account.filter((t) => doc.has(t)).length;
  if (hits === account.length) return "MATCH";
  return hits > 0 ? "PARTIAL" : "DIFFERENT";
}

/** The photos a reviewer must open before approving. */
export function requiredPhotoSides(profile: any): Array<"front" | "back" | "selfie"> {
  const sides: Array<"front" | "back" | "selfie"> = [];
  if (profile?.documentId) sides.push("front");
  if (profile?.documentBackId) sides.push("back");
  if (profile?.selfieDocumentId) sides.push("selfie");
  return sides;
}

export function idTypeLabel(idType: unknown, idCountry?: unknown): string {
  if (idType === "PASSPORT") return "passport";
  if (idType === "RES_PERMIT") return "residence permit";
  return idCountry === "TZ" || !idCountry ? "NIDA card" : "national ID card";
}

export { addDays as addDaysToDay, dayOf, todayInEat as eatToday };
