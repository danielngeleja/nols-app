/**
 * On-site inspection of long-stay homes by NoLSAF Sales Partners
 * (docs/LONG_STAY_RENTALS.md section 13).
 *
 *  - A current pass is required for reservations. The API can also require it
 *    for listing approval. A pass lasts a year and ends at once
 *    when NoLSAF upholds a dispute about the home (AFTER_DISPUTE).
 *  - An admin assigns a partner. The partner may not be the owner, nor the
 *    partner who brought the home in (no marking your own homework).
 *  - The partner reports from the home: a fixed checklist, exactly three photos
 *    (private, hashed), the phone's GPS position and a recommendation. The
 *    server works out the distance from the listing's pin and the warning
 *    signs; the phone is never trusted for them.
 *  - An admin decides: PASS, FAIL (the home falls short) or REDO (the report
 *    is not good enough; back to the partner, no fee). PASS is refused while
 *    the report carries a serious warning sign.
 *  - The partner earns a flat fee for every report NoLSAF accepts (PASS or
 *    FAIL), never more for a pass, so passing a bad home pays nothing extra.
 */
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { haversineMeters } from "../salesLeadVisits.js";
import { isContractEarning } from "../salesPartner.js";
import { sanitizeText } from "../sanitize.js";
import { todayInEat } from "./listing.js";

export class InspectionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "InspectionError";
  }
}

export const INSPECTION_REF = /^li_[A-Za-z0-9_-]{22}$/;
export const newInspectionRef = () => `li_${randomBytes(16).toString("base64url")}`;
export const isInspectionRef = (v: unknown): v is string => typeof v === "string" && INSPECTION_REF.test(v);

export const INSPECTION_VALID_MONTHS = 12;
/** A partner gets this long to visit after being assigned. */
export const INSPECTION_DUE_DAYS = 5;
export const INSPECTION_PHOTO_SLOTS = [
  { label: "Property entrance", hint: "Show the gate, building entrance or unit door." },
  { label: "Inside the home", hint: "Take a wide photo of the main living area." },
  { label: "Key finding", hint: "Show the most serious issue. If none is visible, show the kitchen or bathroom." },
] as const;
export const INSPECTION_PHOTO_COUNT = INSPECTION_PHOTO_SLOTS.length;
/** Further than this from the listing's pin and the report cannot pass. */
export const FAR_FROM_PIN_METERS = 300;
export const LOW_ACCURACY_METERS = 100;
/** A report captured offline may be sent up to 48 hours later. */
export const MAX_CAPTURE_DELAY_MS = 48 * 3_600_000;

export const OPEN_INSPECTION_STATUSES = ["REQUESTED", "ASSIGNED", "SUBMITTED"] as const;

export function longStayInspectionRequiredForApproval(): boolean {
  return process.env.LONG_STAY_REQUIRE_INSPECTION === "1";
}

/** The standards a long-stay home must meet. `required` items must PASS for a home to pass. */
export const CHECKLIST: Array<{ key: string; label: string; required: boolean }> = [
  { key: "MATCHES_LISTING", label: "The home matches the listing's photos, rooms and description", required: true },
  { key: "LOCATION", label: "The home is at the listed location", required: true },
  { key: "RIGHT_TO_LET", label: "Met the owner or their agent and saw proof they may let it", required: true },
  { key: "WATER", label: "Running water works", required: true },
  { key: "POWER", label: "Electricity works, with its own meter or a clear sharing rule", required: true },
  { key: "SANITATION", label: "Toilet and bathroom work and are clean", required: true },
  { key: "SECURITY", label: "Doors and windows lock; the compound is secure", required: true },
  { key: "STRUCTURE", label: "No serious damage, leaks or damp", required: true },
  { key: "SAFETY", label: "No exposed wiring or obvious fire or health risk", required: true },
  { key: "ACCESS", label: "The home can be reached by road in the rainy season", required: false },
  { key: "FURNISHING", label: "Furniture and appliances are as listed", required: false },
  { key: "UTILITIES_AS_LISTED", label: "Utilities included or excluded as listed", required: false },
];
const CHECK_KEYS = CHECKLIST.map((c) => c.key);
const REQUIRED = CHECKLIST.filter((c) => c.required).map((c) => c.key);

export const INSPECTION_FLAGS = ["NO_PIN", "FAR_FROM_PIN", "LOW_ACCURACY", "DUPLICATE_PHOTO", "LATE_UPLOAD"] as const;
export type InspectionFlag = (typeof INSPECTION_FLAGS)[number];
/** Signs that make a report unsafe to pass. */
export const BLOCKING_FLAGS: InspectionFlag[] = ["FAR_FROM_PIN", "DUPLICATE_PHOTO"];

const checkAnswer = z.enum(["PASS", "FAIL", "NA"]);
const findingSchema = z.object({
  note: z.string().transform((text) => sanitizeText(text).trim()).pipe(z.string().min(3).max(300)),
  photoIndex: z.number().int().min(0).max(INSPECTION_PHOTO_COUNT - 1).optional(),
}).strict();

export function inspectionEvidence(savedChecklist: unknown, photos: unknown) {
  const saved = savedChecklist && typeof savedChecklist === "object" ? savedChecklist as Record<string, unknown> : {};
  const checklist: Record<string, z.infer<typeof checkAnswer>> = {};
  const findings: Record<string, z.infer<typeof findingSchema>> = {};
  const savedFindings = saved.findings && typeof saved.findings === "object" ? saved.findings as Record<string, unknown> : {};
  for (const key of CHECK_KEYS) {
    const answer = checkAnswer.safeParse(saved[key]);
    if (!answer.success) continue;
    checklist[key] = answer.data;
    if (answer.data === "FAIL") {
      const finding = findingSchema.safeParse(savedFindings[key]);
      if (finding.success) findings[key] = finding.data;
    }
  }
  const photoCount = Array.isArray(photos) ? photos.length : 0;
  return {
    checklist, findings, photoCount,
    photoLabels: photoCount === INSPECTION_PHOTO_COUNT ? INSPECTION_PHOTO_SLOTS.map(({ label }) => label) : [],
  };
}

export const reportSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().int().min(0).max(5000),
  capturedAt: z.string().datetime({ offset: true }),
  checklist: z.record(z.string(), checkAnswer),
  findings: z.record(z.string(), findingSchema).default({}),
  recommendation: z.enum(["PASS", "FAIL"]),
  note: z.string().trim().min(10).max(1000),
}).strict();
export type InspectionReport = z.infer<typeof reportSchema>;

export const reviewSchema = z.object({
  decision: z.enum(["PASS", "FAIL", "REDO"]),
  note: z.string().trim().min(5).max(500),
}).strict();

function addMonthsDay(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
}
const dayOf = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);

/** Checks the checklist is complete and consistent with the recommendation. */
export function checkReport(report: InspectionReport, now = new Date()) {
  const keys = Object.keys(report.checklist);
  if (keys.some((k) => !CHECK_KEYS.includes(k)) || CHECK_KEYS.some((k) => !keys.includes(k))) {
    throw new InspectionError("Answer every item on the checklist.");
  }
  const failed = REQUIRED.filter((k) => report.checklist[k] !== "PASS");
  if (REQUIRED.some((k) => report.checklist[k] === "NA")) {
    throw new InspectionError("Required items must be answered Yes or No.");
  }
  if (report.recommendation === "PASS" && failed.length) {
    throw new InspectionError("A home cannot pass while a required item is not met. Recommend FAIL, or check again.");
  }
  if (Object.keys(report.findings).some((key) => !CHECK_KEYS.includes(key) || report.checklist[key] !== "FAIL")) {
    throw new InspectionError("Findings can only be recorded for items answered No.");
  }
  if (CHECK_KEYS.some((key) => report.checklist[key] === "FAIL" && !report.findings[key])) {
    throw new InspectionError("Add a short finding for every item answered No.");
  }
  const captured = new Date(report.capturedAt);
  if (captured.getTime() > now.getTime() + 2 * 60_000) throw new InspectionError("The capture time is in the future. Check the phone's clock.");
  if (now.getTime() - captured.getTime() > MAX_CAPTURE_DELAY_MS) throw new InspectionError("This report was captured more than 48 hours ago. Visit again.");
  return { failedRequired: failed };
}

/** Distance from the listing's pin and warning signs, worked out on the server. */
export function evaluatePosition(
  report: { latitude: number; longitude: number; accuracyMeters: number; capturedAt: string },
  pin: { latitude: unknown; longitude: unknown } | null,
  now = new Date(),
): { distanceMeters: number | null; flags: InspectionFlag[] } {
  const flags: InspectionFlag[] = [];
  const lat = Number(pin?.latitude);
  const lng = Number(pin?.longitude);
  let distanceMeters: number | null = null;
  if (!pin || pin.latitude == null || pin.longitude == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    flags.push("NO_PIN");
  } else {
    distanceMeters = haversineMeters({ lat, lng }, { lat: report.latitude, lng: report.longitude });
    if (distanceMeters > FAR_FROM_PIN_METERS) flags.push("FAR_FROM_PIN");
  }
  if (report.accuracyMeters > LOW_ACCURACY_METERS) flags.push("LOW_ACCURACY");
  if (now.getTime() - new Date(report.capturedAt).getTime() > 6 * 3_600_000) flags.push("LATE_UPLOAD");
  return { distanceMeters, flags };
}

/** Whether a home is inspected and the inspection still runs today. */
export function inspectionCurrent(row: { status: string; validUntil: Date | string | null } | null | undefined, today: string): boolean {
  const until = dayOf(row?.validUntil);
  return Boolean(row && row.status === "PASSED" && until && until >= today);
}

/** The latest passed inspection of a home, or null. */
export async function latestPassedInspection(db: any, propertyId: number, includePublicReport = false) {
  return db.longStayInspection.findFirst({
    where: { propertyId, status: "PASSED" },
    orderBy: { reviewedAt: "desc" },
    select: {
      status: true, validUntil: true, reviewedAt: true,
      ...(includePublicReport ? { capturedAt: true, checklist: true } : {}),
    },
  });
}

/** Why a home lacks a current inspection, or null. */
export async function inspectionRefusal(db: any, propertyId: number, today: string): Promise<string | null> {
  const passed = await latestPassedInspection(db, propertyId);
  if (inspectionCurrent(passed, today)) return null;
  return passed ? "This home's NoLSAF inspection has run out. A Sales Partner must inspect it again." : "A NoLSAF Sales Partner must inspect this home first.";
}

/** Keep the visit in the queue while applying the server's approval policy. */
export async function prepareInspectionForApproval(db: any, propertyId: number, today: string) {
  const required = longStayInspectionRequiredForApproval();
  const refusal = await inspectionRefusal(db, propertyId, today).catch((error) => {
    if (required) throw error;
    return null;
  });
  if (!refusal) return { refusal: null, opened: false };

  const request = await requestInspection(db, propertyId, "FIRST").catch(() => null);
  return { refusal: required ? refusal : null, opened: request?.created === true };
}

/**
 * Opens an inspection request for a home unless one is already open.
 * Returns the open or new row.
 */
export async function requestInspection(db: any, propertyId: number, reason: "FIRST" | "YEARLY" | "AFTER_DISPUTE" | "RELISTED") {
  const open = await db.longStayInspection.findFirst({ where: { propertyId, status: { in: [...OPEN_INSPECTION_STATUSES] } } });
  if (open) return { inspection: open, created: false };
  const inspection = await db.longStayInspection.create({ data: { publicRef: newInspectionRef(), propertyId, reason, status: "REQUESTED" } });
  return { inspection, created: true };
}

/** Why this partner may not inspect this home, or null. */
export async function partnerConflict(db: any, partner: { id: number; userId: number }, propertyId: number): Promise<string | null> {
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { ownerId: true, salesAssistedListing: { select: { salesPartnerId: true } } } });
  if (!property) return "Home not found.";
  if (property.ownerId === partner.userId) return "A partner cannot inspect their own home.";
  const brought = await db.propertySalesAttribution.findFirst({ where: { propertyId, salesPartnerId: partner.id }, select: { id: true } });
  if (brought || property.salesAssistedListing?.salesPartnerId === partner.id) return "This partner brought the home to NoLSAF, so another partner must inspect it.";
  return null;
}

export async function assignInspection(db: any, inspection: any, partner: { id: number; userId: number }, adminId: number, now = new Date()) {
  if (!["REQUESTED", "ASSIGNED"].includes(inspection.status)) throw new InspectionError("This inspection is no longer waiting for a partner.", 409);
  if (inspection.salesPartnerId === partner.id) throw new InspectionError("This partner already has the inspection in their queue.", 409);
  const conflict = await partnerConflict(db, partner, inspection.propertyId);
  if (conflict) throw new InspectionError(conflict, 409);
  const result = await db.longStayInspection.updateMany({
    where: { id: inspection.id, status: inspection.status, updatedAt: inspection.updatedAt },
    data: { status: "ASSIGNED", salesPartnerId: partner.id, assignedById: adminId, assignedAt: now, dueBy: new Date(now.getTime() + INSPECTION_DUE_DAYS * 86_400_000) },
  });
  if (result.count !== 1) throw new InspectionError("This inspection changed a moment ago. Refresh.", 409);
}

/**
 * The partner's report. Photo hashes seen on any other inspection are flagged
 * (the same picture cannot prove two visits).
 */
export async function submitInspection(
  db: any,
  inspection: any,
  partnerId: number,
  report: InspectionReport,
  photos: Array<{ publicId: string; hash: string; bytes: number }>,
  now = new Date(),
) {
  if (inspection.status !== "ASSIGNED" || inspection.salesPartnerId !== partnerId) throw new InspectionError("Not found", 404);
  if (photos.length !== INSPECTION_PHOTO_COUNT) throw new InspectionError(`Add exactly ${INSPECTION_PHOTO_COUNT} photos taken at the home.`);
  if (new Set(photos.map((p) => p.hash)).size !== photos.length) throw new InspectionError("Each photo must be a different picture.");
  checkReport(report, now);

  const property = await db.property.findUnique({ where: { id: inspection.propertyId }, select: { latitude: true, longitude: true } });
  const { distanceMeters, flags } = evaluatePosition(report, property, now);
  const others = await db.longStayInspection.findMany({ where: { id: { not: inspection.id }, photos: { not: Prisma.DbNull } }, select: { photos: true }, take: 2000, orderBy: { id: "desc" } });
  const seen = new Set<string>(others.flatMap((o: any) => (Array.isArray(o.photos) ? o.photos.map((p: any) => String(p?.hash)) : [])));
  if (photos.some((p) => seen.has(p.hash))) flags.push("DUPLICATE_PHOTO");

  const result = await db.longStayInspection.updateMany({
    where: { id: inspection.id, status: "ASSIGNED", salesPartnerId: partnerId, updatedAt: inspection.updatedAt },
    data: {
      status: "SUBMITTED",
      checklist: { ...report.checklist, findings: report.findings },
      photos,
      recommendation: report.recommendation,
      note: report.note,
      latitude: report.latitude,
      longitude: report.longitude,
      accuracyMeters: report.accuracyMeters,
      distanceMeters,
      flags,
      capturedAt: new Date(report.capturedAt),
      submittedAt: now,
    },
  });
  if (result.count !== 1) throw new InspectionError("This inspection changed a moment ago. Refresh.", 409);
  return { distanceMeters, flags };
}

/**
 * NoLSAF decides. PASS and FAIL accept the report (the partner earns the
 * flat fee); REDO sends it back to the partner with no fee.
 */
export async function reviewInspection(db: any, inspection: any, adminId: number, decision: "PASS" | "FAIL" | "REDO", note: string, today: string, now = new Date()) {
  if (inspection.status !== "SUBMITTED") throw new InspectionError("There is no report to review.", 409);
  const flags: string[] = Array.isArray(inspection.flags) ? inspection.flags : [];
  if (decision === "PASS") {
    if (inspection.recommendation !== "PASS") throw new InspectionError("The partner recommended FAIL. Fail it, or send it back to redo.", 409);
    const blocking = flags.filter((f) => (BLOCKING_FLAGS as string[]).includes(f));
    if (blocking.length) throw new InspectionError(`This report cannot pass with ${blocking.join(", ")}. Send it back to redo.`, 409);
  }

  let feeAmount: number | null = null;
  if (decision !== "REDO") {
    const settings = await db.systemSetting.findUnique({ where: { id: 1 }, select: { longStayInspectionFee: true } }).catch(() => null);
    feeAmount = Math.max(0, Math.round(Number(settings?.longStayInspectionFee ?? 25000)));
  }
  const data = decision === "REDO"
    ? { status: "ASSIGNED", reviewNote: note, reviewedAt: now, reviewedById: adminId, submittedAt: null, dueBy: new Date(now.getTime() + INSPECTION_DUE_DAYS * 86_400_000) }
    : { status: decision === "PASS" ? "PASSED" : "FAILED", reviewNote: note, reviewedAt: now, reviewedById: adminId, feeAmount, validUntil: decision === "PASS" ? new Date(`${addMonthsDay(today, INSPECTION_VALID_MONTHS)}T00:00:00Z`) : null };
  const result = await db.longStayInspection.updateMany({ where: { id: inspection.id, status: "SUBMITTED", updatedAt: inspection.updatedAt }, data });
  if (result.count !== 1) throw new InspectionError("This inspection was already decided.", 409);

  const fee = decision !== "REDO" && feeAmount && inspection.salesPartnerId
    ? await accrueInspectionFee(db, inspection, feeAmount, now)
    : null;
  return { status: (data as any).status as string, feeAmount, fee };
}

/**
 * The partner's flat fee as a sales earning. Idempotent on the inspection, so
 * a retried review never pays twice. Needs a contract that is earning now.
 */
export async function accrueInspectionFee(db: any, inspection: any, amount: number, now = new Date()) {
  const contracts = await db.salesPartnerContract.findMany({ where: { salesPartnerId: inspection.salesPartnerId }, orderBy: { startsAt: "desc" }, take: 5 });
  const contract = contracts.find((c: any) => isContractEarning(c, now));
  if (!contract) return { created: false, reason: "NO_EARNING_CONTRACT" as const };
  const sourceKey = `LONG_STAY_INSPECTION:${inspection.id}`;
  try {
    await db.salesCommission.create({
      data: {
        salesPartnerId: inspection.salesPartnerId,
        propertyId: inspection.propertyId,
        contractId: contract.id,
        type: "LONG_STAY_INSPECTION",
        status: "ELIGIBLE",
        sourceKey,
        grossAmount: amount,
        eligibleNetRevenue: amount,
        commissionRate: 100,
        commissionAmount: amount,
        currency: "TZS",
        description: "Long-stay home inspection",
        earnedAt: now,
        eligibleAt: now,
      },
    });
    return { created: true, reason: null };
  } catch (error: any) {
    if (error?.code === "P2002") return { created: false, reason: "ALREADY_ACCRUED" as const };
    throw error;
  }
}

/**
 * An upheld dispute about the home itself ends its inspection today and opens a new one.
 */
export async function endInspectionAfterDispute(db: any, propertyId: number, today: string) {
  // validUntil is inclusive, so yesterday stops it at once.
  const yesterday = new Date(`${today}T00:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  await db.longStayInspection.updateMany({ where: { propertyId, status: "PASSED", validUntil: { gte: new Date(`${today}T00:00:00Z`) } }, data: { validUntil: yesterday } });
  return requestInspection(db, propertyId, "AFTER_DISPUTE");
}

/** The verification dates used by the reservation card. */
export function publicInspectionView(row: { status: string; validUntil: Date | string | null; reviewedAt: Date | string | null } | null, today: string) {
  if (!inspectionCurrent(row as any, today)) return null;
  return { inspectedOn: dayOf(row!.reviewedAt), validUntil: dayOf(row!.validUntil) };
}

/** Publish the approved checklist. Keep evidence and unreviewed findings in the admin portal. */
export async function publicInspectionReport(db: any, propertyId: number, today: string) {
  const passed = await latestPassedInspection(db, propertyId, true);
  const inspected = publicInspectionView(passed, today);
  if (inspected) {
    const checklist = passed.checklist;
    const visitDate = passed.capturedAt ? todayInEat(new Date(passed.capturedAt)) : null;
    return {
      inspected: { ...inspected, inspectedOn: visitDate ?? inspected.inspectedOn },
      report: {
        status: "PASSED" as const,
        visitedOn: visitDate,
        reviewedOn: passed.reviewedAt ? todayInEat(new Date(passed.reviewedAt)) : null,
        validUntil: inspected.validUntil,
        checks: CHECKLIST.map(({ key, label, required }) => {
          const recorded = checklist?.[key];
          const result = recorded === "PASS" || recorded === "FAIL" || recorded === "NA" ? recorded : null;
          return { key, label, required, result };
        }),
      },
    };
  }

  const latest = await db.longStayInspection.findFirst({
    where: { propertyId, status: { not: "CANCELLED" } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { status: true },
  });
  const status = latest?.status === "SUBMITTED" ? "IN_REVIEW"
    : latest?.status === "FAILED" ? "FOLLOW_UP"
    : latest?.status === "PASSED" ? "EXPIRED" : "PENDING";
  return { inspected: null, report: { status, visitedOn: null, reviewedOn: null, validUntil: null, checks: [] } };
}

export { addMonthsDay };
