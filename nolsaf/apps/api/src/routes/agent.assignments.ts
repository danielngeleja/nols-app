import { Router } from "express";
import type { RequestHandler } from "express";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { audit } from "../lib/audit.js";
import { notifyAdmins, notifyUser } from "../lib/notifications.js";
import {
  limitAgentNotifyAdmin,
  limitAgentPortalRead,
  limitAgentProfileWrite,
  limitAgentRevenueClaim,
} from "../middleware/rateLimit.js";
import { buildOperatorProfileSeed, mergeOperatorProfileSeed } from "../lib/operatorProfileSeed.js";
import { extractPlannedActivities } from "../lib/agentPlannedActivities.js";
import { computeAgentLevel, resolveTierLadder } from "../lib/agentLevel.js";
import { canClaimFinalTourPayout, disputeWindowEndsAt } from "../lib/tourLifecycle.js";
import { syncOperatorTourPackages } from "../lib/tourPackageSync.js";
import {
  buildContractWorkflowSeed,
  readContractWorkflow,
  toYmd,
  withContractWorkflow,
  type AgentContractWorkflow,
} from "../lib/agentContractWorkflow.js";

const router = Router();

const RATING_DECIMAL_PLACES = 1;

const CONTRACT_TEMPLATE_FILE = "docs/NoLSAF_Operator_Mutual_NDA.md";
let contractTemplateCache: string | null = null;

function loadContractTemplate(): string {
  if (contractTemplateCache) return contractTemplateCache;

  const candidates = [
    resolve(process.cwd(), CONTRACT_TEMPLATE_FILE),
    resolve(process.cwd(), "..", CONTRACT_TEMPLATE_FILE),
    resolve(process.cwd(), "..", "..", CONTRACT_TEMPLATE_FILE),
  ];

  for (const file of candidates) {
    if (existsSync(file)) {
      contractTemplateCache = readFileSync(file, "utf8");
      return contractTemplateCache;
    }
  }

  contractTemplateCache = [
    "# Partnership Contract",
    "",
    "The contract template file could not be loaded from disk.",
    "Please contact NoLSAF support.",
  ].join("\n");

  return contractTemplateCache;
}

function formatAddress(parts: Array<unknown>): string {
  const filtered = parts.map((v) => String(v || "").trim()).filter(Boolean);
  return filtered.length > 0 ? filtered.join(", ") : "Address not provided";
}

function fillContractTemplate(template: string, placeholders: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (_m, key: string) => {
    const value = placeholders[key];
    return typeof value === "string" && value.length > 0 ? value : `{{${key}}}`;
  });
}

function isAgentHired(agent: any): boolean {
  const appStatus = String(agent?.applications?.[0]?.status || "").toUpperCase();
  return appStatus === "HIRED" || (Boolean(agent?.createdAt) && appStatus.length === 0);
}

async function ensureAgentContractWorkflow(agent: any): Promise<AgentContractWorkflow> {
  const existing = readContractWorkflow(agent?.operatorProfile);
  if (existing) return existing;

  const app = (agent?.applications?.[0] ?? {}) as Record<string, any>;
  const hiredDateRaw = app.reviewedAt || app.submittedAt || agent.createdAt || new Date();
  const hiredDate = toYmd(hiredDateRaw) || toYmd(new Date());
  const seeded = buildContractWorkflowSeed({
    agentId: Number(agent.id),
    hiredDate,
  });

  const nextProfile = withContractWorkflow(agent?.operatorProfile, seeded);
  await prisma.agent.update({
    where: { id: agent.id },
    data: { operatorProfile: nextProfile as any },
    select: { id: true },
  });
  agent.operatorProfile = nextProfile;
  return seeded;
}

function buildAgentContractPlaceholders(agent: any, workflow: AgentContractWorkflow): Record<string, string> {
  const user = (agent?.user ?? {}) as Record<string, any>;
  const app = (agent?.applications?.[0] ?? {}) as Record<string, any>;
  const profile = (agent?.operatorProfile && typeof agent.operatorProfile === "object" && !Array.isArray(agent.operatorProfile))
    ? (agent.operatorProfile as Record<string, any>)
    : {};

  const hiredDate = workflow.hiredDate || toYmd(app.reviewedAt || app.submittedAt || agent.createdAt || new Date());

  const operatorName = String(
    profile.companyName ||
      profile.businessName ||
      profile.operatorName ||
      app.fullName ||
      user.fullName ||
      user.name ||
      `Operator ${agent.id}`
  ).trim();

  const operatorAddress = formatAddress([
    profile.companyAddress,
    user.address,
    user.district,
    user.region,
  ]);

  const repName = String(user.fullName || user.name || app.fullName || "Authorized Representative").trim();
  const repTitle = String(profile.position || profile.roleTitle || "Authorized Representative").trim();
  const adminSignatureDate = workflow.nolsafSignedAt ? toYmd(workflow.nolsafSignedAt) : "Pending NoLSAF signature";
  const agentSignatureDate = workflow.agentSignedAt ? toYmd(workflow.agentSignedAt) : "Pending operator signature";
  const nolsafSignatoryName = String(workflow.nolsafSignatoryName || process.env.CONTRACT_NOLSAF_SIGNATORY_NAME || "DANIEL MUSSA NGELEJA").trim();
  const nolsafSignatoryTitle = String(workflow.nolsafSignatoryTitle || process.env.CONTRACT_NOLSAF_SIGNATORY_TITLE || "CHIEF EXECUTIVE OFFICER").trim();
  const contractVersion = String(workflow.version || "1.0.0").trim() || "1.0.0";

  return {
    CONTRACT_ID: workflow.contractId,
    CONTRACT_VERSION: contractVersion,
    HIRED_DATE: hiredDate,
    EFFECTIVE_DATE: workflow.effectiveDate || hiredDate,
    NOLSAF_JURISDICTION: "United Republic of Tanzania",
    NOLSAF_ADDRESS: "Dar es Salaam-Tanzania",
    OPERATOR_COMPANY_NAME: operatorName,
    OPERATOR_JURISDICTION: "United Republic of Tanzania",
    OPERATOR_ADDRESS: operatorAddress,
    NON_SOLICIT_MONTHS: "24",
    GOVERNING_LAW: "Laws of the United Republic of Tanzania",
    ARBITRATION_LOCATION: "Dar es Salaam, Tanzania",
    NOLSAF_NOTICE_ADDRESS: "Dar es Salaam-Tanzania",
    NOLSAF_NOTICE_EMAIL: "support@nolsaf.com",
    OPERATOR_NOTICE_ADDRESS: operatorAddress,
    OPERATOR_NOTICE_EMAIL: String(user.email || "support@nolsaf.com"),
    COMMISSION_SCHEDULE_REFERENCE: "ANNEX-COMM-2026-01",
    COMMISSION_CHANGE_NOTICE_DAYS: "30",
    SUBSCRIPTION_GRACE_DAYS: "90",
    SETTLEMENT_MIN_HOURS: "24",
    SETTLEMENT_MAX_DAYS: "3",
    PAYOUT_CURRENCY_RULE: "TZS/USD",
    COMMERCIAL_CHANGE_NOTICE_DAYS: "30",
    NOLSAF_SIGNATORY_NAME: nolsafSignatoryName,
    NOLSAF_SIGNATORY_TITLE: nolsafSignatoryTitle,
    NOLSAF_SIGNED_AT: adminSignatureDate,
    OPERATOR_REP_NAME: repName,
    OPERATOR_REP_TITLE: repTitle,
    OPERATOR_SIGNED_AT: agentSignatureDate,
  };
}

function roundRating(value: number) {
  const f = Math.pow(10, RATING_DECIMAL_PLACES);
  return Math.round(value * f) / f;
}

function paidTourBookingWhere() {
  return {
    OR: [
      { paymentStatus: "PAID" },
      { paidAt: { not: null } },
    ],
  };
}

const listQuerySchema = z
  .object({
    page: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default("1")
      .transform((v) => Number(v) || 1),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default("20")
      .transform((v) => Math.min(Math.max(Number(v) || 20, 1), 100)),
    status: z.string().min(1).max(50).optional(),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: z.string().min(1).max(64),
  })
  .strict();

const notifyAdminSchema = z
  .object({
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(5000),
    meta: z.any().optional(),
  })
  .strict();

const pickupValidateSchema = z
  .object({
    codeSuffix: z.string().min(4).max(12),
    note: z.string().max(500).optional(),
  })
  .strict();

const activityCheckToggleSchema = z
  .object({
    activityId: z.string().min(1).max(240),
    checked: z.boolean(),
    totalActivities: z.number().int().min(1).max(500).optional(),
  })
  .strict();

const completionRatingSchema = z
  .object({
    taskQuality: z.number().min(1).max(5),
    punctuality: z.number().min(1).max(5),
    attentionToDetail: z.number().min(1).max(5),
    communication: z.number().min(1).max(5),
    professionalism: z.number().min(1).max(5),
    comment: z.string().max(1000).optional(),
  })
  .strict();

const vehicleAssetSchema = z
  .object({
    id: z.string().max(80).optional().default(""),
    type: z.string().max(120).optional().default(""),
    quantity: z.string().max(40).optional().default(""),
    seatsPerVehicle: z.string().max(40).optional().default(""),
    registrationNumber: z.string().max(80).optional().default(""),
    ownedBy: z.string().max(80).optional().default(""),
    serviceMode: z.string().max(80).optional().default(""),
    notes: z.string().max(1000).optional().default(""),
  });

function hasTimeToken(value: string): boolean {
  const v = String(value || "").trim();
  if (!v) return false;
  return /(\b([01]?\d|2[0-3]):[0-5]\d\b)|(\b(1[0-2]|0?[1-9])\s?(am|pm)\b)/i.test(v);
}

function countFromActivityShape(value: unknown): number {
  if (typeof value === "string") {
    const lines = value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !/^day\s*\d+\s*:?.*$/i.test(line));
    return lines.length;
  }

  if (Array.isArray(value)) {
    return value.reduce((sum, item) => sum + countFromActivityShape(item), 0);
  }

  if (!value || typeof value !== "object") return 0;

  const obj = value as Record<string, unknown>;

  if (Array.isArray(obj.itinerary)) {
    return countFromActivityShape(obj.itinerary);
  }

  const nestedCount =
    countFromActivityShape(obj.timeline)
    + countFromActivityShape(obj.events)
    + countFromActivityShape(obj.activities);
  if (nestedCount > 0) return nestedCount;

  const label = String(obj.label || obj.activity || obj.name || obj.title || "").trim();
  const description = String(obj.description || obj.notes || "").trim();
  const time = String(obj.time || obj.startTime || "").trim();

  if (label || (time && description)) return 1;
  return 0;
}

function estimatePlannedActivityCount(metadata: unknown, packageSnapshot: unknown): number {
  const md = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : ({} as Record<string, unknown>);
  const pkg = packageSnapshot && typeof packageSnapshot === "object" && !Array.isArray(packageSnapshot)
    ? (packageSnapshot as Record<string, unknown>)
    : ({} as Record<string, unknown>);

  const candidates: unknown[] = [
    (md.servicePlan as any)?.activities,
    (md.agentPlan as any)?.activities,
    (md.plan as any)?.activities,
    (md.agreedPlan as any)?.activities,
    (md.confirmedPlan as any)?.activities,
    md.itinerary,
    md.activities,
    md.servicePlan,
    md.agentPlan,
    md.plan,
    md.agreedPlan,
    md.confirmedPlan,
    pkg.itinerary,
    (pkg.package as any)?.itinerary,
    (pkg.selectedPackage as any)?.itinerary,
    (pkg.details as any)?.itinerary,
    (pkg.dayByDay as any)?.itinerary,
    pkg.timeline,
    pkg,
  ];

  for (const candidate of candidates) {
    const count = countFromActivityShape(candidate);
    if (count > 0) return count;
  }

  const fallbackText = extractPlannedActivities(metadata, packageSnapshot);
  return countFromActivityShape(fallbackText);
}

const itineraryTimelineSchema = z
  .object({
    id: z.string().max(80).optional().default(""),
    time: z.string().max(40).optional().default(""),
    label: z.string().max(200).optional().default(""),
    description: z.string().max(800).optional().default(""),
    experienceVibe: z.string().max(80).optional().default(""),
  });

const itineraryDaySchema = z
  .object({
    id: z.string().max(80).optional().default(""),
    day: z.number().int().min(1).max(365).optional().default(1),
    title: z.string().max(160).optional().default(""),
    description: z.string().max(1500).optional().default(""),
    timeline: z.array(itineraryTimelineSchema).max(80).optional().default([]),
  });

const packageItemSchemaBase = z
  .object({
    id: z.string().max(80).optional().default(""),
    name: z.string().max(180).optional().default(""),
    description: z.string().max(2000).optional().default(""),
    destination: z.string().max(180).optional().default(""),
    category: z.string().max(120).optional().default(""),
    duration: z.string().max(80).optional().default(""),
    minPax: z.string().max(40).optional().default(""),
    maxPax: z.string().max(40).optional().default(""),
    pricePerPerson: z.string().max(80).optional().default(""),
    currency: z.string().max(10).optional().default(""),
    discountFactor: z.string().max(120).optional().default(""),
    discountType: z.string().max(40).optional().default(""),
    discountValue: z.string().max(80).optional().default(""),
    discountCondition: z.string().max(240).optional().default(""),
    discountUnit: z.string().max(120).optional().default(""),
    mode: z.string().max(80).optional().default(""),
    accommodation: z.string().max(160).optional().default(""),
    mealPlan: z.string().max(160).optional().default(""),
    difficulty: z.string().max(80).optional().default(""),
    meetingPoint: z.string().max(240).optional().default(""),
    included: z.array(z.string().max(240)).max(80).optional().default([]),
    excluded: z.array(z.string().max(240)).max(80).optional().default([]),
    itinerary: z.array(itineraryDaySchema).max(60).optional().default([]),
    notes: z.string().max(1500).optional().default(""),
  });

const packageItemSchema = packageItemSchemaBase.superRefine((pkg, ctx) => {
    const included = (pkg.included || []).map((v) => String(v || "").trim()).filter(Boolean);
    if (included.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["included"],
        message: "At least one offered service/inclusion is required for every package.",
      });
    }

    const itinerary = pkg.itinerary || [];
    if (itinerary.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["itinerary"],
        message: "Day-by-day itinerary is required (from day 1 to the last day).",
      });
      return;
    }

    for (let i = 0; i < itinerary.length; i += 1) {
      const day = itinerary[i];
      const dayTitle = String(day?.title || "").trim();
      if (!dayTitle) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["itinerary", i, "title"],
          message: "Each itinerary day needs a clear title (e.g. Pickup, Breakfast, Game Drive).",
        });
      }

      const timeline = Array.isArray(day?.timeline) ? day.timeline : [];
      const dayDescription = String(day?.description || "").trim();
      const hasTimedDescription = hasTimeToken(dayDescription);

      if (timeline.length === 0 && !hasTimedDescription) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["itinerary", i, "timeline"],
          message: "Provide a timeline for this day (with time entries) or include times in description.",
        });
      }

      for (let j = 0; j < timeline.length; j += 1) {
        const t = timeline[j];
        const time = String(t?.time || "").trim();
        const label = String(t?.label || "").trim();
        const desc = String(t?.description || "").trim();

        if (!time) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["itinerary", i, "timeline", j, "time"],
            message: "Timeline entries must include time (e.g. 07:30 or 7:30 AM).",
          });
        }

        if (!label && !desc) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["itinerary", i, "timeline", j, "label"],
            message: "Timeline entries must include an activity label or description.",
          });
        }
      }
    }
  });

const seasonalPriceSchema = z
  .object({
    id: z.string().max(80).optional().default(""),
    seasonName: z.string().max(120).optional().default(""),
    startMonth: z.string().max(40).optional().default(""),
    endMonth: z.string().max(40).optional().default(""),
    pricePerPerson: z.string().max(80).optional().default(""),
    currency: z.string().max(10).optional().default(""),
    notes: z.string().max(1000).optional().default(""),
  });

const operatorProfileSchema = z
  .object({
    contactPersonName: z.string().max(160).optional().default(""),
    contactPersonEmail: z.string().max(160).optional().default(""),
    contactPersonPhone: z.string().max(80).optional().default(""),
    contactPersonNationality: z.string().max(120).optional().default(""),
    companyName: z.string().max(160).optional().default(""),
    companyEmail: z.string().max(160).optional().default(""),
    companyPhone: z.string().max(80).optional().default(""),
    companyLogoUrl: z.string().max(1000).optional().default(""),
    businessAddress: z.string().max(500).optional().default(""),
    companyWebsite: z.string().max(300).optional().default(""),
    businessRegistrationNumber: z.string().max(120).optional().default(""),
    tinNumber: z.string().max(120).optional().default(""),
    businessLicenseNumber: z.string().max(120).optional().default(""),
    tourismPermitNumber: z.string().max(120).optional().default(""),
    vehiclePermitNumber: z.string().max(120).optional().default(""),
    yearsInOperation: z.number().int().min(0).max(200).optional(),
    teamSize: z.number().int().min(0).max(100000).optional(),
    languages: z.string().max(500).optional().default(""),
    physicalLocation: z.string().max(500).optional().default(""),
    operatingRegions: z.array(z.string().max(160)).max(80).optional().default([]),
    registeredParks: z.array(z.string().max(160)).max(120).optional().default([]),
    contactPhone: z.string().max(80).optional().default(""),
    contactEmail: z.string().max(160).optional().default(""),
    whatsapp: z.string().max(80).optional().default(""),
    description: z.string().max(1200).optional().default(""),
    tourismTypes: z.array(z.string().max(120)).max(40).optional().default([]),
    tools: z.array(z.string().max(120)).max(100).optional().default([]),
    vehicles: z.array(vehicleAssetSchema).max(80).optional().default([]),
    services: z.array(z.string().max(160)).max(100).optional().default([]),
    serviceClassification: z.record(z.string(), z.array(z.string().max(160)).max(120)).optional().default({}),
    hasVehicles: z.boolean().optional(),
    specializations: z.array(z.string().max(160)).max(60).optional().default([]),
    addOns: z.array(z.string().max(160)).max(100).optional().default([]),
    seasonalPricing: z.string().max(2000).optional().default(""),
    packages: z.string().max(2000).optional().default(""),
    // Draft save should accept in-progress package edits; strict package completeness is enforced separately.
    packageItems: z.array(packageItemSchemaBase).max(80).optional().default([]),
    seasonalPrices: z.array(seasonalPriceSchema).max(60).optional().default([]),
    capacityNotes: z.string().max(1200).optional().default(""),
    maxTripsPerDay: z.string().max(40).optional().default(""),
    minimumBookingNotice: z.string().max(120).optional().default(""),
    guidesAvailable: z.string().max(40).optional().default(""),
    peakSeasonAvailability: z.string().max(240).optional().default(""),
    blockedPeriods: z.string().max(800).optional().default(""),
    gallery: z.array(z.string().max(1000)).max(160).optional().default([]),
    classifiedPhotos: z.record(z.string(), z.array(z.string().max(1000)).max(60)).optional().default({}),
  });

const SERVER_OWNED_OPERATOR_PROFILE_KEYS = [
  "review",
  "reviewStatus",
  "reviewReason",
  "reviewedAt",
  "reviewedByAdminId",
  "submittedAt",
  "approvedAt",
  "approvedSnapshot",
];

function preserveServerOwnedProfileFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  return SERVER_OWNED_OPERATOR_PROFILE_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) acc[key] = source[key];
    return acc;
  }, {});
}

function buildDiffSnapshot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  for (const key of Object.keys(source)) {
    if (SERVER_OWNED_OPERATOR_PROFILE_KEYS.includes(key)) continue;
    snapshot[key] = source[key];
  }
  return snapshot;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function itemExample(item: unknown): string {
  if (typeof item === "object" && item && "name" in (item as Record<string, unknown>)) {
    return String((item as Record<string, unknown>).name || "item");
  }
  if (typeof item === "object" && item && "title" in (item as Record<string, unknown>)) {
    return String((item as Record<string, unknown>).title || "item");
  }
  if (typeof item === "string") return item;
  return "item";
}

/**
 * Detect changes between two profiles and return a summary.
 * Compares new profile with last approved snapshot or original to detect:
 * - Field modifications (text, numbers, booleans)
 * - Array additions (new packages, vehicles, photos, etc.)
 * - Array removals
 */
function detectProfileChanges(currentProfile: Record<string, any>, approvedSnapshot?: Record<string, any>) {
  const baselineProfile = approvedSnapshot || {};
  const changes: any = {
    fieldsModified: [] as Array<{ field: string; oldValue: any; newValue: any }>,
    itemsAdded: [] as Array<{ category: string; count: number; examples: string[] }>,
    itemsRemoved: [] as Array<{ category: string; count: number; examples: string[] }>,
  };

  // Exclude server-owned fields from comparison
  const fieldsToCheck = Object.keys(currentProfile).filter(
    (k) => !SERVER_OWNED_OPERATOR_PROFILE_KEYS.includes(k)
  );

  for (const field of fieldsToCheck) {
    const oldVal = baselineProfile[field];
    const newVal = currentProfile[field];

    // Handle arrays separately
    if (Array.isArray(newVal)) {
      const oldArray = Array.isArray(oldVal) ? oldVal : [];

      const oldCounts = new Map<string, number>();
      const newCounts = new Map<string, number>();

      for (const item of oldArray) {
        const key = stableStringify(item);
        oldCounts.set(key, (oldCounts.get(key) || 0) + 1);
      }
      for (const item of newVal) {
        const key = stableStringify(item);
        newCounts.set(key, (newCounts.get(key) || 0) + 1);
      }

      const added: unknown[] = [];
      const removed: unknown[] = [];

      for (const item of newVal) {
        const key = stableStringify(item);
        const oldCount = oldCounts.get(key) || 0;
        const newCount = newCounts.get(key) || 0;
        if (newCount > oldCount && added.filter((x) => stableStringify(x) === key).length < newCount - oldCount) {
          added.push(item);
        }
      }

      for (const item of oldArray) {
        const key = stableStringify(item);
        const oldCount = oldCounts.get(key) || 0;
        const newCount = newCounts.get(key) || 0;
        if (oldCount > newCount && removed.filter((x) => stableStringify(x) === key).length < oldCount - newCount) {
          removed.push(item);
        }
      }

      if (added.length > 0) {
        changes.itemsAdded.push({
          category: field,
          count: added.length,
          examples: added.slice(0, 2).map(itemExample),
        });
      }

      if (removed.length > 0) {
        changes.itemsRemoved.push({
          category: field,
          count: removed.length,
          examples: removed.slice(0, 2).map(itemExample),
        });
      }
    } else if (typeof newVal !== "object" || newVal === null) {
      // Normalize empty-ish values so null/undefined/""/0 on both sides
      // don't appear as a change
      const normalize = (v: any) => (v === undefined || v === "" || v === 0 ? null : v);
      const oldNorm = normalize(oldVal);
      const newNorm = normalize(newVal);
      if (JSON.stringify(oldNorm) !== JSON.stringify(newNorm)) {
        // Skip entries where both sides are null (no real change)
        if (oldNorm !== null || newNorm !== null) {
          changes.fieldsModified.push({
            field,
            oldValue: oldNorm,
            newValue: newNorm,
          });
        }
      }
    } else {
      // Object field modification (e.g. serviceClassification, classifiedPhotos)
      if (stableStringify(oldVal) !== stableStringify(newVal)) {
        changes.fieldsModified.push({
          field,
          oldValue: oldVal ?? null,
          newValue: newVal ?? null,
        });
      }
    }
  }

  return changes;
}

/**
 * Generate a human-readable summary of profile changes
 */
function formatChangesSummary(changes: any): string {
  const parts: string[] = [];

  if (changes.fieldsModified.length > 0) {
    parts.push(`${changes.fieldsModified.length} field(s) modified`);
  }

  for (const item of changes.itemsAdded) {
    parts.push(`${item.count} ${item.category} added`);
  }

  for (const item of changes.itemsRemoved) {
    parts.push(`${item.count} ${item.category} removed`);
  }

  return parts.length > 0 ? parts.join("; ") : "No changes detected";
}

type AgentGateResult =
  | { ok: true; agent: any }
  | { ok: false; status: number; error: string; message: string };

async function getActiveAgent(req: AuthedRequest): Promise<AgentGateResult> {
  const userId = req.user!.id;

  const agent = await prisma.agent.findUnique({
    where: { userId },
    select: {
      id: true,
      status: true,
      level: true,
      educationLevel: true,
      areasOfOperation: true,
      certifications: true,
      languages: true,
      yearsOfExperience: true,
      specializations: true,
      bio: true,
      isAvailable: true,
      maxActiveRequests: true,
      currentActiveRequests: true,
      operatorProfile: true,
      createdAt: true,
      updatedAt: true,
      applications: {
        take: 1,
        orderBy: { submittedAt: 'desc' },
        select: {
          id: true,
          status: true,
          submittedAt: true,
          reviewedAt: true,
          fullName: true,
          nationality: true,
          region: true,
          district: true,
          job: {
            select: {
              id: true,
              title: true,
              type: true,
              category: true,
              department: true,
            },
          },
        },
      },
      user: { select: { id: true, name: true, fullName: true, email: true, phone: true, role: true, nationality: true, region: true, district: true, address: true } },
    },
  });

  if (!agent) {
    return {
      ok: false,
      status: 404,
      error: "AGENT_PROFILE_MISSING",
      message: "Agent profile not found",
    };
  }

  const status = String(agent.status || "").toUpperCase();
  if (status === "SUSPENDED") {
    return {
      ok: false,
      status: 403,
      error: "AGENT_SUSPENDED",
      message: "Account suspended pending investigation",
    };
  }
  if (status !== "ACTIVE") {
    return {
      ok: false,
      status: 403,
      error: "AGENT_INACTIVE",
      message: "Agent account inactive",
    };
  }

  return { ok: true, agent };
}

// GET /api/agent/contract
router.get(
  "/contract",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });

    if (!isAgentHired(gate.agent)) {
      return res.status(403).json({
        ok: false,
        error: "CONTRACT_NOT_AVAILABLE",
        message: "Contract will be available once hiring is completed.",
      });
    }

    const workflow = await ensureAgentContractWorkflow(gate.agent);
    const template = loadContractTemplate();
    const rendered = fillContractTemplate(template, buildAgentContractPlaceholders(gate.agent, workflow));

    return res.json({
      ok: true,
      contract: {
        title: "Partnership Contract",
        format: "markdown",
        content: rendered,
        generatedAt: new Date().toISOString(),
      },
      workflow,
    });
  })
);

// Operator-wide case inbox. This avoids requiring operators to open each
// booking individually to discover a traveller cancellation or issue.
router.get(
  "/tour-cases",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
    const status = String(req.query?.status || "").trim().toUpperCase();
    const cases = await prisma.tourCase.findMany({
      where: {
        booking: { operatorAgentId: gate.agent.id },
        ...(status ? { status } : {}),
      },
      include: {
        booking: {
          select: {
            id: true, bookingCode: true, title: true, destination: true,
            startDate: true, status: true, payoutStatus: true, currency: true,
            grossAmount: true, operatorPayoutAmount: true, guestName: true,
          },
        },
        events: { orderBy: { createdAt: "desc" }, take: 8 },
      },
      orderBy: { createdAt: "desc" },
      take: 250,
    });
    const requiresReconciliation = (item: typeof cases[number]) => item.status === "REJECTED" && (
      ["CANCELED", "REFUNDED"].includes(String(item.booking.status).toUpperCase()) || item.booking.payoutStatus === "HELD"
    );
    const reconciliationCases = cases.filter(requiresReconciliation);
    const submittedCases = cases.filter((item) => !requiresReconciliation(item) && ["OPEN", "ELIGIBLE"].includes(item.status));
    const reviewCases = cases.filter((item) => !requiresReconciliation(item) && ["ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW"].includes(item.status));
    const refundQueueCases = cases.filter((item) => !requiresReconciliation(item) && item.status === "APPROVED");
    const closedCases = cases.filter((item) => !requiresReconciliation(item) && ["RESOLVED", "REJECTED", "CLOSED", "WITHDRAWN"].includes(item.status));
    return res.json({
      ok: true,
      cases,
      summary: {
        total: cases.length,
        submitted: submittedCases.length,
        inReview: reviewCases.length,
        refundQueue: refundQueueCases.length,
        reconciliation: reconciliationCases.length,
        closed: closedCases.length,
        // Retained for older clients; new UI uses the exclusive buckets above.
        actionRequired: submittedCases.length + reconciliationCases.length,
        cancellations: cases.filter((item) => item.type === "CANCELLATION").length,
        payoutHeld: cases.filter((item) => item.booking.payoutStatus === "HELD").length,
        resolved: closedCases.length,
      },
    });
  })
);

// POST /api/agent/contract/sign
router.get(
  "/tour-bookings/:id/cases",
  requireRole("AGENT") as RequestHandler,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
    const bookingId = Number(req.params.id);
    const booking = await prisma.tourBooking.findFirst({ where: { id: bookingId, operatorAgentId: gate.agent.id }, select: { id: true } });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });
    const cases = await prisma.tourCase.findMany({ where: { tourBookingId: booking.id }, include: { events: { orderBy: { createdAt: "asc" } } }, orderBy: { createdAt: "desc" } });
    return res.json({ ok: true, cases });
  })
);

router.post(
  "/tour-bookings/:id/cases/:caseId/action",
  requireRole("AGENT") as RequestHandler,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
    const bookingId = Number(req.params.id);
    const caseId = Number(req.params.caseId);
    const action = String(req.body?.action || "").toUpperCase();
    const message = String(req.body?.message || "").trim().slice(0, 4000);
    if (!["ACKNOWLEDGE", "ESCALATE", "RESOLVE", "REJECT"].includes(action) || !message) return res.status(400).json({ error: "Invalid action or message" });
    const item = await prisma.tourCase.findFirst({ where: { id: caseId, tourBookingId: bookingId, booking: { operatorAgentId: gate.agent.id } }, include: { booking: { select: { customerId: true, bookingCode: true } } } });
    if (!item) return res.status(404).json({ error: "Case not found" });
    if (["CLOSED", "WITHDRAWN", "RESOLVED"].includes(item.status)) return res.status(409).json({ error: "Case is closed" });
    if (["CANCELLATION", "REFUND"].includes(item.type) && ["RESOLVE", "REJECT"].includes(action)) return res.status(403).json({ error: "Cancellation and refund decisions require NoLSAF review" });
    const status = action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : action === "ESCALATE" ? "ESCALATED" : action === "RESOLVE" ? "RESOLVED" : "REJECTED";
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: item.id }, data: { status, assignedToUserId: req.user.id, resolution: ["RESOLVED", "REJECTED"].includes(status) ? message : undefined, closedAt: ["RESOLVED", "REJECTED"].includes(status) ? new Date() : undefined } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: item.id, actorUserId: req.user.id, type: action, message } });
      return value;
    });
    const customerId = item.requestedByUserId || item.booking.customerId;
    if (customerId) await notifyUser(customerId, "tour_case_operator_message", { caseId: item.id, bookingCode: item.booking.bookingCode, action, message });
    return res.json({ ok: true, case: updated });
  })
);

router.post(
  "/tour-bookings/:id/cases/:caseId/cost-evidence",
  requireRole("AGENT") as RequestHandler,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
    const bookingId = Number(req.params.id);
    const caseId = Number(req.params.caseId);
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : [];
    const items = rawItems.slice(0, 50).map((item: any) => ({
      kind: String(item?.kind || "NON_REFUNDABLE_COMPONENT").toUpperCase(),
      description: String(item?.description || "").trim().slice(0, 300),
      amount: Number(item?.amount || 0),
      evidenceUrl: String(item?.evidenceUrl || "").trim().slice(0, 1200),
      disclosedBeforePayment: item?.disclosedBeforePayment === true,
    }));
    if (!items.length || items.some((item: any) => {
      let trustedUpload = false;
      try {
        const url = new URL(item.evidenceUrl);
        trustedUpload = url.protocol === "https:" && url.hostname === "res.cloudinary.com";
      } catch { trustedUpload = false; }
      return !["NON_REFUNDABLE_COMPONENT", "CONSUMED_SERVICE", "RECOVERY_COST"].includes(item.kind) || !item.description || !(item.amount > 0) || !trustedUpload;
    })) {
      return res.status(400).json({ error: "Every cost requires a valid kind, description, positive amount, and evidence URL" });
    }
    const item = await prisma.tourCase.findFirst({ where: { id: caseId, tourBookingId: bookingId, booking: { operatorAgentId: gate.agent.id } }, include: { booking: { select: { bookingCode: true } } } });
    if (!item) return res.status(404).json({ error: "Case not found" });
    if (["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(item.status)) return res.status(409).json({ error: "Case is closed" });
    const updated = await prisma.$transaction(async (tx) => {
      const value = await tx.tourCase.update({ where: { id: item.id }, data: { status: "UNDER_REVIEW" } });
      await tx.tourCaseEvent.create({ data: { tourCaseId: item.id, actorUserId: req.user.id, type: "OPERATOR_COST_EVIDENCE", message: String(req.body?.message || "Operator submitted documented tour costs").slice(0, 1000), data: { items } } });
      return value;
    });
    await notifyAdmins("tour_cancellation_evidence_submitted", { actor: "The tour operator", caseId: item.id, bookingCode: item.booking.bookingCode, tourBookingId: bookingId });
    return res.json({ ok: true, case: updated, submittedItems: items.length });
  })
);

router.post(
  "/contract/sign",
  requireRole("AGENT") as RequestHandler,
  limitAgentProfileWrite as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });

    if (!isAgentHired(gate.agent)) {
      return res.status(403).json({
        ok: false,
        error: "CONTRACT_NOT_AVAILABLE",
        message: "Contract will be available once hiring is completed.",
      });
    }

    const workflow = await ensureAgentContractWorkflow(gate.agent);

    if (workflow.status === "EXECUTED") {
      return res.json({ ok: true, workflow, message: "Contract already executed." });
    }

    if (workflow.status !== "PENDING_AGENT_SIGNATURE") {
      return res.status(409).json({
        ok: false,
        error: "CONTRACT_NOT_READY_FOR_AGENT_SIGNATURE",
        message: "NoLSAF must sign the contract before agent countersignature.",
        workflow,
      });
    }

    const signerName = String(
      gate.agent?.user?.fullName || gate.agent?.user?.name || gate.agent?.applications?.[0]?.fullName || `Agent ${gate.agent.id}`
    ).trim();
    const nowIso = new Date().toISOString();

    const nextWorkflow: AgentContractWorkflow = {
      ...workflow,
      status: "EXECUTED",
      agentSignedAt: nowIso,
      agentSignerName: signerName,
      agentSignedByUserId: Number(req.user!.id),
    };

    const nextProfile = withContractWorkflow(gate.agent?.operatorProfile, nextWorkflow);
    await prisma.agent.update({
      where: { id: gate.agent.id },
      data: { operatorProfile: nextProfile as any },
      select: { id: true },
    });

    await audit(req, "AGENT_CONTRACT_SIGNED", "AGENT", null, { workflow: nextWorkflow });

    return res.json({ ok: true, workflow: nextWorkflow });
  })
);

// GET /api/agent/me
router.get(
  "/me",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    // Best-effort sync: populate nationality/region/district/fullName on the User record
    // from the linked JobApplication if they are missing. This covers agents who were
    // provisioned before these fields were copied during the HIRED flow.
    try {
      const linkedApp = (agent as any).applications?.[0];
      const u = agent.user as any;
      if (linkedApp && (!u?.nationality || !u?.region || !u?.district || !u?.fullName)) {
        const appNationality = typeof linkedApp.nationality === "string" ? linkedApp.nationality.trim() : "";
        const appRegion     = typeof linkedApp.region      === "string" ? linkedApp.region.trim()      : "";
        const appDistrict   = typeof linkedApp.district    === "string" ? linkedApp.district.trim()    : "";
        const appFullName   = typeof linkedApp.fullName    === "string" ? linkedApp.fullName.trim()    : "";
        const syncUpdate: Record<string, string> = {};
        if (!u?.nationality && appNationality) syncUpdate.nationality = appNationality;
        if (!u?.region      && appRegion)      syncUpdate.region      = appRegion;
        if (!u?.district    && appDistrict)    syncUpdate.district    = appDistrict;
        if (!u?.fullName    && appFullName)    syncUpdate.fullName    = appFullName;
        if (Object.keys(syncUpdate).length > 0) {
          await prisma.user.update({ where: { id: u.id }, data: syncUpdate as any });
          Object.assign(agent.user, syncUpdate); // reflect in current response
        }
      }
    } catch {
      // non-blocking — ignore sync failures
    }

    try {
      // Only hydrate operatorProfile from the original application ONCE, when it has
      // never been initialized. GET /me is polled/refreshed constantly, and this read
      // of `agent.operatorProfile` can be seconds stale by the time we write it back
      // (Aiven write latency observed at 4s+) — re-running this merge on every request
      // risks racing with a concurrent PATCH/submit and clobbering it back to seed-only
      // data, wiping out the operator's saved/submitted profile.
      const existingProfile = (agent as any).operatorProfile;
      const hasExistingProfile = existingProfile && typeof existingProfile === "object" && Object.keys(existingProfile).length > 0;
      if (!hasExistingProfile) {
        const linkedApp = (agent as any).applications?.[0];
        const operatorProfileSeed = buildOperatorProfileSeed(linkedApp?.agentApplicationData, {
          fullName: linkedApp?.fullName,
          email: linkedApp?.email,
          phone: linkedApp?.phone,
          region: linkedApp?.region,
          district: linkedApp?.district,
        });
        if (Object.keys(operatorProfileSeed).length > 0) {
          const mergedProfile = mergeOperatorProfileSeed(existingProfile, operatorProfileSeed);
          await prisma.agent.update({
            where: { id: agent.id },
            data: { operatorProfile: mergedProfile as any },
            select: { id: true },
          });
          (agent as any).operatorProfile = mergedProfile;
        }
      }
    } catch {
      // non-blocking — ignore profile seed failures
    }

    const reviewsAgg = await prisma.agentReview.aggregate({
      where: { agentId: agent.id },
      _avg: {
        punctualityRating: true,
        customerCareRating: true,
        communicationRating: true,
      },
      _count: { _all: true },
    });

    const avgPunctuality = typeof (reviewsAgg as any)?._avg?.punctualityRating === "number" ? (reviewsAgg as any)._avg.punctualityRating : null;
    const avgCustomerCare = typeof (reviewsAgg as any)?._avg?.customerCareRating === "number" ? (reviewsAgg as any)._avg.customerCareRating : null;
    const avgCommunication = typeof (reviewsAgg as any)?._avg?.communicationRating === "number" ? (reviewsAgg as any)._avg.communicationRating : null;
    const totalReviews = Number((reviewsAgg as any)?._count?._all ?? 0) || 0;

    const overallRatingRaw =
      avgPunctuality != null && avgCustomerCare != null && avgCommunication != null
        ? (avgPunctuality + avgCustomerCare + avgCommunication) / 3
        : null;

    const overallRating = overallRatingRaw != null ? roundRating(overallRatingRaw) : null;

    const performanceMetrics = {
      totalReviews,
      punctualityRating: avgPunctuality != null ? roundRating(avgPunctuality) : null,
      customerCareRating: avgCustomerCare != null ? roundRating(avgCustomerCare) : null,
      communicationRating: avgCommunication != null ? roundRating(avgCommunication) : null,
      overallRating,
    };

    // Live rank from tour-company activity: completed tours + NoLSAF commission
    // revenue + customer rating. Single source of truth shared with the admin panel.
    const [completedTours, revenueAgg, tierSetting] = await Promise.all([
      prisma.tourBooking.count({
        where: { operatorAgentId: agent.id, status: "COMPLETED" },
      }),
      prisma.tourBooking.aggregate({
        where: { operatorAgentId: agent.id, ...paidTourBookingWhere() },
        _sum: { commissionAmount: true },
      }),
      // Admin-configurable tier ladder; defensive so the hot /me path never
      // breaks if the column isn't migrated yet (falls back to defaults).
      prisma.systemSetting
        .findUnique({ where: { id: 1 }, select: { agentTierLadder: true } as any })
        .catch(() => null),
    ]);
    // Tour bookings are quoted in USD end-to-end (invoice → payout), so the
    // commission is already USD — sum it directly, no conversion.
    const noLSAFRevenue = Math.round(Number(revenueAgg._sum.commissionAmount ?? 0));
    const tiers = resolveTierLadder((tierSetting as any)?.agentTierLadder);
    const levelInfo = computeAgentLevel({ completedTours, noLSAFRevenue, overallRating, totalReviews }, tiers);

    // Sync checklist-facing document proof fields from canonical UserDocument records.
    // The web checklist writes to /api/account/documents, so /api/agent/me should expose
    // those uploads under operatorProfile.documentProofs for consistent UI hydration.
    const operatorProfile = ((agent as any).operatorProfile ?? {}) as Record<string, any>;
    try {
      if ((prisma as any).userDocument && agent.user?.id) {
        const docs = await prisma.userDocument.findMany({
          where: { userId: agent.user.id },
          orderBy: { id: "desc" },
          take: 80,
          select: {
            id: true,
            type: true,
            url: true,
            status: true,
            metadata: true,
            createdAt: true,
            updatedAt: true,
          } as any,
        });

        const latestByType = new Map<string, any>();
        for (const d of docs) {
          const t = String((d as any).type ?? "").toUpperCase();
          if (!t) continue;
          if (!latestByType.has(t)) latestByType.set(t, d);
        }

        const pick = (...types: string[]) => {
          for (const t of types) {
            const hit = latestByType.get(String(t).toUpperCase());
            if (hit) return hit;
          }
          return null;
        };

        const brelaDoc = pick("BRELA_CERTIFICATE", "BUSINESS_REGISTRATION");
        const tinDoc = pick("TIN_NUMBER", "TIN_CERTIFICATE");
        const tourismDoc = pick("TOURISM_LICENSE", "TOURISM_LICENCE", "LICENSE");
        const businessDoc = pick("BUSINESS_LICENCE", "BUSINESS_LICENSE", "BUSINESS_LISENCE");

        const toProof = (doc: any) => {
          if (!doc?.url) return null;
          const md = doc?.metadata && typeof doc.metadata === "object" && !Array.isArray(doc.metadata)
            ? (doc.metadata as Record<string, any>)
            : {};
          return {
            url: String(doc.url),
            status: String(doc.status || "PENDING").toUpperCase(),
            uploadedAt: String(md.uploadedAt || doc.createdAt?.toISOString?.() || ""),
            approvedAt: md.approvedAt ? String(md.approvedAt) : null,
            expiresOn: md.expiresOn ? String(md.expiresOn) : undefined,
            expiresAt: md.expiresAt ? String(md.expiresAt) : undefined,
          };
        };

        const mergedDocumentProofs = {
          ...(operatorProfile.documentProofs && typeof operatorProfile.documentProofs === "object" ? operatorProfile.documentProofs : {}),
          ...(toProof(brelaDoc) ? { brela: toProof(brelaDoc) } : null),
          ...(toProof(tinDoc) ? { tin: toProof(tinDoc) } : null),
          ...(toProof(tourismDoc) ? { license: toProof(tourismDoc) } : null),
          ...(toProof(businessDoc) ? { business: toProof(businessDoc) } : null),
        };

        const existingClassified = operatorProfile.classifiedPhotos && typeof operatorProfile.classifiedPhotos === "object"
          ? operatorProfile.classifiedPhotos
          : {};
        const existingProofList = Array.isArray((existingClassified as any).proof)
          ? (existingClassified as any).proof.filter((v: unknown) => typeof v === "string")
          : [];
        const canonicalProofUrls = [brelaDoc?.url, tinDoc?.url, tourismDoc?.url, businessDoc?.url]
          .filter((v): v is string => typeof v === "string" && v.length > 0);
        const mergedProofList = Array.from(new Set([...existingProofList, ...canonicalProofUrls]));

        (operatorProfile as any).documentProofs = mergedDocumentProofs;
        (operatorProfile as any).classifiedPhotos = {
          ...existingClassified,
          proof: mergedProofList,
        };
      }
    } catch {
      // Non-blocking fallback: keep existing operator profile response.
    }

    return res.json({
      ok: true,
      agent: {
        id: agent.id,
        status: agent.status,
        level: levelInfo.level,
        levelBenefits: levelInfo.benefits,
        levelProgress: levelInfo.next,
        completedTrips: levelInfo.completedTours,
        noLSAFRevenue: levelInfo.noLSAFRevenue,
        educationLevel: (agent as any).educationLevel ?? null,
        areasOfOperation: (agent as any).areasOfOperation ?? null,
        certifications: (agent as any).certifications ?? null,
        languages: (agent as any).languages ?? null,
        yearsOfExperience: (agent as any).yearsOfExperience ?? null,
        specializations: (agent as any).specializations ?? null,
        bio: (agent as any).bio ?? null,
        isAvailable: (agent as any).isAvailable ?? null,
        maxActiveRequests: (agent as any).maxActiveRequests ?? null,
        currentActiveRequests: (agent as any).currentActiveRequests ?? null,
        operatorProfile,
        employmentCommencedAt: (agent as any).createdAt ?? null,
        employmentType: (agent as any)?.applications?.[0]?.job?.type ?? null,
        employmentTitle: (agent as any)?.applications?.[0]?.job?.title ?? null,
        application: (agent as any).applications?.[0] ?? null,
        performanceMetrics,
        user: agent.user,
      },
    });
  })
);

// PATCH /api/agent/operator-profile
router.patch(
  "/operator-profile",
  requireRole("AGENT") as RequestHandler,
  limitAgentProfileWrite as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });

    const parsed = operatorProfileSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        ok: false,
        error: "invalid_operator_profile",
        details: parsed.error.flatten(),
        issues: parsed.error.issues,
      });
    }

    const serverOwnedFields = preserveServerOwnedProfileFields(gate.agent.operatorProfile);
    const updated = await prisma.agent.update({
      where: { id: gate.agent.id },
      data: { operatorProfile: { ...parsed.data, ...serverOwnedFields } as any },
      select: { id: true, operatorProfile: true, updatedAt: true },
    });

    await syncOperatorTourPackages(gate.agent.id, parsed.data.packageItems, "DRAFT");

    return res.json({ ok: true, agent: updated });
  })
);

// POST /api/agent/operator-profile/submit
// Agent submits their operator profile for admin review
router.post(
  "/operator-profile/submit",
  requireRole("AGENT") as RequestHandler,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });

    const agent = gate.agent;
    const profile = (agent?.operatorProfile ?? {}) as Record<string, any>;

    // Validate required fields for submission
    const requiredFields = ["companyName", "contactEmail", "contactPhone", "description", "tourismTypes"];
    const missing = requiredFields.filter((field) => {
      const val = profile[field];
      if (field === "tourismTypes") {
        return !Array.isArray(val) || val.length === 0;
      }
      return !val || String(val).trim() === "";
    });

    if (missing.length > 0) {
      return res.status(400).json({
        ok: false,
        error: "incomplete_profile",
        missing,
        message: `Profile incomplete. Missing: ${missing.join(", ")}`,
      });
    }

    // Detect only new changes since the most recent submission.
    // Fallback to last approved snapshot if no prior submission snapshot exists.
    const previousSubmittedSnapshot = profile?.review?.submittedSnapshot;
    const approvedSnapshot = profile?.approvedSnapshot;
    const baselineSnapshot = previousSubmittedSnapshot || approvedSnapshot;
    const changes = detectProfileChanges(profile, baselineSnapshot);
    const changeSummary = formatChangesSummary(changes);

    // Update profile with submission metadata
    const nowIso = new Date().toISOString();
    const updatedProfile = {
      ...profile,
      // Reset top-level review fields left over from a prior admin decision
      // (e.g. reviewStatus: "APPROVED"/"REJECTED") so they don't shadow the
      // fresh `review.status: "PENDING"` below in admin UIs that read
      // `reviewStatus || review.status`.
      reviewStatus: "PENDING",
      reviewReason: null,
      reviewedAt: null,
      reviewedByAdminId: null,
      review: {
        status: "PENDING",
        submittedAt: nowIso,
        changes, // Store detailed change data for admin review
        submittedSnapshot: buildDiffSnapshot(profile),
      },
    };

    const updated = await prisma.agent.update({
      where: { id: agent.id },
      data: { operatorProfile: updatedProfile as any },
      select: { id: true, operatorProfile: true, updatedAt: true },
    });

    // Create audit entry for agent submission
    await audit(req as AuthedRequest, "SUBMIT_OPERATOR_PROFILE", `agent:${agent.id}`, null, {
      submittedAt: nowIso,
      changes: changeSummary,
      detailedChanges: changes,
    });

    return res.json({
      ok: true,
      message: "Profile submitted successfully for admin review",
      changeSummary,
      agent: updated,
    });
  })
);

// POST /api/agent/notify-admin
// Allows an agent to send an inbox notification/message to admins.
router.post(
  "/notify-admin",
  requireRole("AGENT") as RequestHandler,
  limitAgentNotifyAdmin as any,
  asyncHandler(async (req: any, res) => {
    const authed = req?.user;
    const authedId = authed?.id;
    const authedRole = String(authed?.role ?? "").toUpperCase();
    if (typeof authedId !== "number" || !Number.isFinite(authedId) || authedId <= 0 || authedRole !== "AGENT") {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const parsed = notifyAdminSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_body" });
    }

    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;
    if (agent?.user?.id && agent.user.id !== authedId) {
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    const meta = {
      ...(parsed.data.meta && typeof parsed.data.meta === "object" ? parsed.data.meta : {}),
      source: "agent",
      agentId: agent.id,
      agentUserId: agent.user?.id,
      agentName: agent.user?.name ?? null,
      agentEmail: agent.user?.email ?? null,
    };

    const created = await prisma.notification.create({
      data: {
        userId: null,
        ownerId: null,
        title: parsed.data.title,
        body: parsed.data.body,
        unread: true,
        meta,
        type: "agent",
      },
      select: { id: true },
    });

    return res.json({ ok: true, id: created.id });
  })
);

// GET /api/agent/assignments
// Currently backed by PlanRequest assignments (AssignedAgent relation).
router.get(
  "/assignments",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const parsed = listQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { page, pageSize, status } = parsed.data;
    const skip = (page - 1) * pageSize;

    const where: any = { assignedAgentId: agent.id };
    if (status) where.status = String(status);

    // Stats (across all statuses for this agent, ignoring `status` filter)
    const grouped = await prisma.planRequest.groupBy({
      by: ["status"],
      where: { assignedAgentId: agent.id },
      _count: { _all: true },
    });

    const total = grouped.reduce((acc, g) => acc + (g._count?._all || 0), 0);
    const completed = grouped
      .filter((g) => String(g.status).toUpperCase() === "COMPLETED")
      .reduce((acc, g) => acc + (g._count?._all || 0), 0);
    const inProgress = grouped
      .filter((g) => String(g.status).toUpperCase() === "IN_PROGRESS")
      .reduce((acc, g) => acc + (g._count?._all || 0), 0);

    const [items, filteredTotal] = await Promise.all([
      prisma.planRequest.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          tripType: true,
          role: true,
          status: true,
          fullName: true,
          email: true,
          phone: true,
          destinations: true,
          dateFrom: true,
          dateTo: true,
          budget: true,
          notes: true,
          suggestedItineraries: true,
          estimatedTimeline: true,
          createdAt: true,
          respondedAt: true,
          user: {
            select: {
              nationality: true,
            },
          },
        },
      }),
      prisma.planRequest.count({ where }),
    ]);

    return res.json({
      ok: true,
      page,
      pageSize,
      total: status ? filteredTotal : total,
      completed,
      inProgress,
      items: items.map((p) => ({
        id: p.id,
        title: p.destinations
          ? `${p.tripType} • ${p.destinations}`
          : `${p.tripType} • ${p.fullName}`,
        description: p.notes || null,
        plannedActivities: p.suggestedItineraries || p.estimatedTimeline || p.notes || null,
        status: p.status,
        createdAt: p.createdAt,
        tripDate: p.dateFrom,
        amountPaid: p.budget != null ? Number(p.budget) : null,
        tripType: p.tripType,
        completedAt: p.respondedAt || null,
        // Staff context is not yet modeled; keep null for now.
        assignedBy: null,
        // Useful context for the agent UI (safe to show the agent)
        requester: {
          fullName: p.fullName,
          email: p.email,
          phone: p.phone,
          role: p.role,
          nationality: p.user?.nationality ?? null,
        },
      })),
    });
  })
);

// GET /api/agent/assignments/:id
router.get(
  "/assignments/:id",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const p = await prisma.planRequest.findFirst({
      where: { id: idNum, assignedAgentId: agent.id },
      select: {
        id: true,
        tripType: true,
        role: true,
        status: true,
        fullName: true,
        email: true,
        phone: true,
        destinations: true,
        notes: true,
        createdAt: true,
        respondedAt: true,
        adminResponse: true,
        suggestedItineraries: true,
        requiredPermits: true,
        estimatedTimeline: true,
      },
    });

    if (!p) return res.status(404).json({ error: "Not found" });

    return res.json({
      ok: true,
      item: {
        id: p.id,
        title: p.destinations ? `${p.tripType} • ${p.destinations}` : `${p.tripType} • ${p.fullName}`,
        description: p.notes || null,
        status: p.status,
        createdAt: p.createdAt,
        completedAt: p.respondedAt || null,
        assignedBy: null,
        reviewedBy: null,
        requester: {
          fullName: p.fullName,
          email: p.email,
          phone: p.phone,
          role: p.role,
        },
        outputs: {
          adminResponse: p.adminResponse || null,
          suggestedItineraries: p.suggestedItineraries || null,
          requiredPermits: p.requiredPermits || null,
          estimatedTimeline: p.estimatedTimeline || null,
        },
      },
    });
  })
);

// GET /api/agent/revenues
// Returns per-trip revenue breakdown + summary totals for the authenticated agent.
router.get(
  "/revenues",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    // Fetch commission settings (fallback to 15% / USD).
    const settings = await prisma.systemSetting.findFirst({
      select: {
        agentCommissionPercent: true,
        agentCommissionCurrency: true,
      },
    });
    const commissionPct = Number(settings?.agentCommissionPercent ?? 15);
    const agentCurrency = String(settings?.agentCommissionCurrency || "USD").trim() || "USD";
    const tourReportCurrency = "USD";

    // Fetch legacy PlanRequest trips plus TourBooking source data.
    const [trips, tourTrips] = await Promise.all([
      prisma.planRequest.findMany({
        where: { assignedAgentId: agent.id },
        select: {
          id: true,
          tripType: true,
          destinations: true,
          fullName: true,
          status: true,
          budget: true,
          dateFrom: true,
          dateTo: true,
          createdAt: true,
          respondedAt: true,
          user: { select: { nationality: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
      prisma.tourBooking.findMany({
        where: { operatorAgentId: agent.id, ...paidTourBookingWhere() },
        select: {
          id: true,
          bookingCode: true,
          title: true,
          destination: true,
          category: true,
          status: true,
          paymentStatus: true,
          payoutStatus: true,
          paymentRef: true,
          payoutRequestedAt: true,
          payoutApprovedAt: true,
          payoutPaidAt: true,
          grossAmount: true,
          commissionPercent: true,
          commissionAmount: true,
          operatorPayoutAmount: true,
          currency: true,
          startDate: true,
          endDate: true,
          completedAt: true,
          createdAt: true,
          guestName: true,
          nationality: true,
          metadata: true,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const agentUserId = Number(agent.user?.id || 0);
    const planRequestIds = trips.map((t) => t.id);
    const planInvoices =
      agentUserId > 0 && planRequestIds.length > 0
        ? await prisma.invoice.findMany({
            where: {
              ownerId: agentUserId,
              bookingId: { in: planRequestIds },
              invoiceNumber: { startsWith: "AINV-" },
            },
            select: {
              bookingId: true,
              invoiceNumber: true,
              status: true,
              issuedAt: true,
              verifiedAt: true,
              approvedAt: true,
              paidAt: true,
              updatedAt: true,
            },
            orderBy: { updatedAt: "desc" },
          })
        : [];

    const invoiceByBookingId = new Map<number, (typeof planInvoices)[number]>();
    for (const inv of planInvoices) {
      if (!invoiceByBookingId.has(inv.bookingId)) {
        invoiceByBookingId.set(inv.bookingId, inv);
      }
    }

    // Build per-trip revenue items (legacy PlanRequest source).
    const planRequestItems = trips.map((t) => {
      const inv = invoiceByBookingId.get(t.id);
      const budgetNum = t.budget ? Number(t.budget) : 0;
      const commissionAmount = budgetNum > 0 ? Math.round((budgetNum * commissionPct) / 100) : 0;
      const agentEarning = budgetNum > 0 ? Math.round(budgetNum - commissionAmount) : 0;
      const isCompleted = ["COMPLETED", "DONE", "CLOSED"].includes(String(t.status).toUpperCase());
      return {
        source: "PLAN_REQUEST" as const,
        id: t.id,
        bookingCode: null,
        invoiceNumber: inv?.invoiceNumber || null,
        invoiceStatus: inv?.status || null,
        tripType: t.tripType,
        title: t.destinations ? `${t.tripType} • ${t.destinations}` : `${t.tripType} • ${t.fullName}`,
        status: t.status,
        paymentStatus: null,
        payoutStatus: null,
        isCompleted,
        budget: budgetNum,
        commissionPercent: commissionPct,
        commissionAmount,
        agentEarning,
        currency: agentCurrency,
        dateFrom: t.dateFrom,
        dateTo: t.dateTo,
        createdAt: t.createdAt,
        completedAt: t.respondedAt ?? null,
        payoutRequestedAt: inv?.issuedAt ? inv.issuedAt.toISOString() : null,
        payoutApprovedAt: inv?.approvedAt ? inv.approvedAt.toISOString() : null,
        payoutPaidAt: inv?.paidAt ? inv.paidAt.toISOString() : null,
        client: t.fullName,
        nationality: t.user?.nationality ?? null,
      };
    });

    const isCompletedTour = (status: unknown, metadata: unknown): boolean => {
      const s = String(status || "").toUpperCase();
      if (s.includes("COMPLETE") || s.includes("DONE") || s.includes("FINISHED") || s.includes("CHECKED_OUT")) return true;
      const md = metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? (metadata as Record<string, any>)
        : ({} as Record<string, any>);
      return Boolean(md?.activityProgress?.lockedAt);
    };

    const isPaidTour = (paymentStatus: unknown): boolean => {
      const s = String(paymentStatus || "").toUpperCase();
      return s === "PAID" || s === "APPROVED" || s === "DISBURSED";
    };

    const isPayoutSettledTour = (payoutStatus: unknown, payoutPaidAt: unknown): boolean => {
      if (payoutPaidAt) return true;
      const s = String(payoutStatus || "").toUpperCase();
      return s === "PAID" || s === "DISBURSED";
    };

    const tourDerived = tourTrips.map((t) => {
      const budgetNum = t.grossAmount != null ? Number(t.grossAmount) : 0;
      const commissionAmount = t.commissionAmount != null
        ? Number(t.commissionAmount)
        : (budgetNum > 0 ? Math.round((budgetNum * commissionPct) / 100) : 0);
      const operatorPayout = t.operatorPayoutAmount != null
        ? Number(t.operatorPayoutAmount)
        : (budgetNum > 0 ? Math.max(0, budgetNum - commissionAmount) : 0);
      const storedCommissionPercent = t.commissionPercent != null ? Number(t.commissionPercent) : null;
      const derivedCommissionPercent =
        storedCommissionPercent != null && Number.isFinite(storedCommissionPercent)
          ? storedCommissionPercent
          : operatorPayout > 0
            ? (commissionAmount / operatorPayout) * 100
            : commissionPct;
      const completed = isCompletedTour(t.status, t.metadata);
      const paid = isPaidTour(t.paymentStatus);
      const payoutSettled = isPayoutSettledTour(t.payoutStatus, t.payoutPaidAt);
      return {
        source: "TOUR_BOOKING" as const,
        id: `tb-${t.id}`,
        title: t.destination ? `${t.title} • ${t.destination}` : t.title,
        tripType: t.category || "Tour",
        status: t.status,
        isCompleted: completed,
        budgetNum,
        commissionAmount,
        operatorPayout,
        paid,
        payoutSettled,
        commissionPercent: Number.isFinite(derivedCommissionPercent)
          ? Math.round(derivedCommissionPercent * 100) / 100
          : commissionPct,
        // Agent tour report currency is standardized to USD.
        currency: tourReportCurrency,
        dateFrom: t.startDate ? t.startDate.toISOString() : null,
        dateTo: t.endDate ? t.endDate.toISOString() : null,
        createdAt: t.createdAt,
        completedAt: t.completedAt ? t.completedAt.toISOString() : null,
        client: t.guestName || "Guest",
        nationality: t.nationality || null,
      };
    });

    const tourByReportId = new Map<string, (typeof tourTrips)[number]>();
    for (const trip of tourTrips) {
      tourByReportId.set(`tb-${trip.id}`, trip);
    }

    const tourItems = tourDerived.map((t) => {
      const rawTour = (tourByReportId.get(t.id) || null) as any;
      return {
      source: t.source,
      id: t.id,
      bookingCode: rawTour?.bookingCode || null,
      invoiceNumber: null,
      invoiceStatus: null,
      tripType: t.tripType,
      title: t.title,
      status: t.status,
      paymentStatus: rawTour?.paymentStatus ?? null,
      payoutStatus: rawTour?.payoutStatus ?? null,
      paymentRef: rawTour?.paymentRef ?? null,
      isCompleted: t.isCompleted,
      budget: Math.round(t.budgetNum),
      commissionPercent: t.commissionPercent,
      commissionAmount: Math.round(t.commissionAmount),
      agentEarning: Math.round(t.operatorPayout),
      currency: t.currency,
      dateFrom: t.dateFrom,
      dateTo: t.dateTo,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
      payoutRequestedAt: rawTour?.payoutRequestedAt ? new Date(rawTour.payoutRequestedAt).toISOString() : null,
      payoutApprovedAt: rawTour?.payoutApprovedAt ? new Date(rawTour.payoutApprovedAt).toISOString() : null,
      payoutPaidAt: rawTour?.payoutPaidAt ? new Date(rawTour.payoutPaidAt).toISOString() : null,
      client: t.client,
      nationality: t.nationality,
    }});

    const items = [...planRequestItems, ...tourItems].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });

    // Summary totals (combined legacy + TourBooking source).
    const completedItems = planRequestItems.filter((i) => i.isCompleted);
    const completedTripsLegacy = completedItems.length;
    const totalTripsLegacy = planRequestItems.length;
    const totalRevenueLegacy = completedItems.reduce((s, i) => s + i.agentEarning, 0);
    const totalCommissionLegacy = completedItems.reduce((s, i) => s + i.commissionAmount, 0);

    const totalTripsTour = tourDerived.length;
    const completedTripsTour = tourDerived.filter((t) => t.isCompleted).length;
    const paidRevenueTour = tourDerived.filter((t) => t.paid).reduce((s, t) => s + t.operatorPayout, 0);
    // Disbursement Policy 1.1: paid bookings are claimable before the tour
    // runs, so pending revenue covers every paid booking not yet disbursed.
    const pendingPayoutTour = tourDerived
      .filter((t) => t.paid && !t.payoutSettled)
      .reduce((s, t) => s + t.operatorPayout, 0);
    const totalCommissionTour = tourDerived.filter((t) => t.paid).reduce((s, t) => s + t.commissionAmount, 0);

    const totalTrips = totalTripsLegacy + totalTripsTour;
    const completedTrips = completedTripsLegacy + completedTripsTour;
    const totalRevenue = totalRevenueLegacy + paidRevenueTour;
    const pendingRevenue = pendingPayoutTour;
    const totalCommissionPaid = totalCommissionLegacy + totalCommissionTour;
    const lifetimeRevenue = Math.max(Number(agent.totalRevenueGenerated ?? 0), totalRevenue);
    const summaryCurrency = totalTripsTour > 0 ? tourReportCurrency : agentCurrency;

    return res.json({
      ok: true,
      summary: {
        totalTrips,
        completedTrips,
        totalRevenue,
        pendingRevenue,
        totalCommissionPaid,
        commissionPercent: commissionPct,
        currency: summaryCurrency,
        lifetimeRevenue,
      },
      items,
    });
  })
);

const claimPayoutSchema = z
  .object({
    planRequestId: z.number().int().positive(),
  })
  .strict();

const claimByTourCodeSchema = z
  .object({
    tourCode: z.string().trim().min(2).max(80),
  })
  .strict();

// POST /api/agent/revenues/claim
// Allows an agent to request a payout for a completed trip
router.post(
  "/revenues/claim",
  requireRole("AGENT") as RequestHandler,
  limitAgentRevenueClaim as any,
  asyncHandler(async (req: any, res) => {
    const authed = req?.user;
    const authedId = authed?.id;
    const authedRole = String(authed?.role ?? "").toUpperCase();
    if (typeof authedId !== "number" || !Number.isFinite(authedId) || authedId <= 0 || authedRole !== "AGENT") {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const parsed = claimPayoutSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_body", issues: parsed.error.issues });
    }

    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    // Verify the trip belongs to this agent
    const trip = await prisma.planRequest.findUnique({
      where: { id: parsed.data.planRequestId },
      select: { id: true, assignedAgentId: true, userId: true, budget: true, status: true },
    });

    if (!trip) {
      return res.status(404).json({ ok: false, error: "trip_not_found" });
    }

    if (trip.assignedAgentId !== agent.id) {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Trip does not belong to this agent" });
    }

    // Check if trip is completed
    if (trip.status !== "COMPLETED") {
      return res.status(400).json({ ok: false, error: "invalid_status", message: "Only completed trips can be claimed" });
    }

    // Check if an invoice already exists for this trip
    const existingInvoice = await prisma.invoice.findFirst({
      where: {
        bookingId: trip.id,
        invoiceNumber: { startsWith: "AINV-" }, // Agent invoice prefix
      },
    });

    if (existingInvoice) {
      return res.status(409).json({ ok: false, error: "already_claimed", message: "Payout already requested for this trip" });
    }

    // Get agent user for invoice owner reference
    const agentUser = agent.user;
    if (!agentUser) {
      return res.status(500).json({ ok: false, error: "agent_user_not_found" });
    }

    // Create invoice record (status DRAFT, then agent can submit)
    const invoiceNumber = `AINV-${Date.now()}-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
    const invoice = await prisma.invoice.create({
      data: {
        ownerId: agentUser.id, // Use agent user ID as owner for invoice record
        bookingId: trip.id,
        invoiceNumber,
        status: "DRAFT",
      },
    });

    return res.json({
      ok: true,
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      invoiceStatus: invoice.status,
      claimedAt: invoice.issuedAt,
      message: "Payout request created. You can now submit it for review.",
    });
  })
);

// POST /api/agent/revenues/claim-by-tour-code
// Allows an agent to request payout using the booking/tour code shown in their trips list.
router.post(
  "/revenues/claim-by-tour-code",
  requireRole("AGENT") as RequestHandler,
  limitAgentRevenueClaim as any,
  asyncHandler(async (req: any, res) => {
    const authed = req?.user;
    const authedId = authed?.id;
    const authedRole = String(authed?.role ?? "").toUpperCase();
    if (typeof authedId !== "number" || !Number.isFinite(authedId) || authedId <= 0 || authedRole !== "AGENT") {
      return res.status(401).json({ ok: false, error: "unauthorized" });
    }

    const parsed = claimByTourCodeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ ok: false, error: "invalid_body", issues: parsed.error.issues });
    }

    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const requestedCode = String(parsed.data.tourCode || "").trim();
    const requestedCodeUpper = requestedCode.toUpperCase();

    const bookings = await prisma.tourBooking.findMany({
      where: {
        operatorAgentId: agent.id,
        ...paidTourBookingWhere(),
      },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        completedAt: true,
        payoutStatus: true,
        payoutRequestedAt: true,
        payoutApprovedAt: true,
        payoutPaidAt: true,
        metadata: true,
        paymentStatus: true,
        paidAt: true,
        customerConfirmedAt: true,
        disputeWindowEndsAt: true,
        _count: { select: { cases: { where: { status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW"] } } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 300,
    });

    const booking = bookings.find((b) => String(b.bookingCode || "").trim().toUpperCase() === requestedCodeUpper);
    if (!booking) {
      return res.status(404).json({ ok: false, error: "tour_code_not_found", message: "Tour code was not found for your account" });
    }

    const eligibility = canClaimFinalTourPayout({
      ...booking,
      openCaseCount: booking._count.cases,
    });

    if (!eligibility.ok) {
      const message = eligibility.reason === "open_case"
        ? "Payout is held while a tour issue, change, cancellation, or refund case is open."
        : eligibility.reason === "tour_not_completed" || eligibility.reason === "dispute_window_open"
          ? "Final payout is available after verified tour completion and the customer dispute window."
          : "This tour is not eligible for payout.";
      return res.status(409).json({ ok: false, error: eligibility.reason, message });
    }
    const payoutStatusUpper = String(booking.payoutStatus || "").toUpperCase();
    const alreadyClaimed = Boolean(
      booking.payoutRequestedAt ||
      booking.payoutApprovedAt ||
      booking.payoutPaidAt ||
      ["REQUESTED", "CLAIMED", "VERIFIED", "APPROVED", "PAID", "DISBURSED", "REJECTED"].includes(payoutStatusUpper)
    );

    if (alreadyClaimed) {
      return res.status(409).json({ ok: false, error: "already_claimed", message: "Payout already requested for this tour code" });
    }

    const now = new Date();

    const updated = await prisma.tourBooking.update({
      where: { id: booking.id },
      data: {
        payoutRequestedAt: now,
        payoutStatus: "CLAIMED",
      } as any,
      select: {
        id: true,
        bookingCode: true,
        payoutStatus: true,
        payoutRequestedAt: true,
      },
    });

    try {
      await audit(
        req as AuthedRequest,
        "AGENT_TOUR_PAYOUT_CLAIMED",
        "TOUR_BOOKING",
        null,
        {
          tourBookingId: updated.id,
          bookingCode: updated.bookingCode,
          payoutStatus: updated.payoutStatus,
          payoutRequestedAt: updated.payoutRequestedAt,
        }
      );
    } catch {
      // ignore audit failures for claim response path
    }

    try {
      await notifyAdmins("payout_claim_submitted", {
        tourBookingId: updated.id,
        bookingCode: updated.bookingCode,
        operatorName: (agent.operatorProfile as any)?.companyName || null,
      });
    } catch {
      // non-fatal
    }

    return res.json({
      ok: true,
      bookingId: updated.id,
      bookingCode: updated.bookingCode,
      payoutStatus: updated.payoutStatus || "CLAIMED",
      claimedAt: updated.payoutRequestedAt,
      message: "Claim submitted successfully. NoLSAF is now processing your request.",
    });
  })
);

// GET /api/agent/tour-bookings
// Returns TourBooking records where the logged-in agent is the operator (operatorAgentId).
router.get(
  "/tour-bookings",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const parsed = listQuerySchema.safeParse(req.query || {});
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    }

    const { page, pageSize, status } = parsed.data;
    const skip = (page - 1) * pageSize;

    const where: any = { operatorAgentId: agent.id, ...paidTourBookingWhere() };
    if (status) where.status = String(status);

    const grouped = await prisma.tourBooking.groupBy({
      by: ["status"],
      where: { operatorAgentId: agent.id, ...paidTourBookingWhere() },
      _count: { _all: true },
    });

    const normalizeStatus = (value: unknown) => String(value || "").trim().replace(/[\s-]+/g, "_").toUpperCase();
    const isCompleted = (s: string) => s === "COMPLETED" || s === "CHECKED_OUT" || s === "DONE" || s === "FINISHED";
    const isInProgress = (s: string) => s === "IN_PROGRESS" || s === "CHECKED_IN" || s === "PENDING_CHECKIN" || s === "CONFIRMED" || s === "ACTIVE" || s === "ONGOING";

    const allTotal = grouped.reduce((acc, g) => acc + (g._count?._all || 0), 0);
    const completed = grouped.reduce((acc, g) => {
      const s = normalizeStatus((g as any).status);
      return acc + (isCompleted(s) ? (g._count?._all || 0) : 0);
    }, 0);
    const inProgress = grouped.reduce((acc, g) => {
      const s = normalizeStatus((g as any).status);
      return acc + (isInProgress(s) ? (g._count?._all || 0) : 0);
    }, 0);

    const [items, total] = await Promise.all([
      prisma.tourBooking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
        select: {
          id: true,
          bookingCode: true,
          packageSnapshot: true,
          title: true,
          destination: true,
          category: true,
          startDate: true,
          status: true,
          paymentStatus: true,
          grossAmount: true,
          currency: true,
          travelerCount: true,
          guestName: true,
          nationality: true,
          metadata: true,
          paidAt: true,
          confirmedAt: true,
          payoutStatus: true,
          payoutRequestedAt: true,
          payoutApprovedAt: true,
          payoutPaidAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.tourBooking.count({ where }),
    ]);

    return res.json({
      ok: true,
      page,
      pageSize,
      total: status ? total : allTotal,
      completed,
      inProgress,
      items: items.map((t) => {
        const md = (t.metadata as any) || null;
        const dep = md?.departureAirport || null;
        const airportDeparture = dep
          ? String(dep.shortLabel || dep.label || dep.iataCode || dep.city || "").trim() || null
          : null;
        const pickupValidatedAt = md?.pickupValidation?.validatedAt
          ? String(md.pickupValidation.validatedAt)
          : null;
        const plannedActivities = extractPlannedActivities(t.metadata, t.packageSnapshot);
        const checksRaw = md?.activityProgress?.checks && typeof md.activityProgress.checks === "object"
          ? md.activityProgress.checks
          : (md?.activityChecks && typeof md.activityChecks === "object" ? md.activityChecks : {});
        const activityChecks = Object.fromEntries(
          Object.entries(checksRaw as Record<string, any>)
            .map(([id, val]) => {
              if (typeof val === "string") {
                const iso = val.trim();
                return iso ? [id, iso] : null;
              }
              if (val && typeof val === "object") {
                const iso = String((val as any).checkedAt || "").trim();
                return iso ? [id, iso] : null;
              }
              return null;
            })
            .filter((entry): entry is [string, string] => !!entry)
        );
        const checklistLockedAt = md?.activityProgress?.lockedAt
          ? String(md.activityProgress.lockedAt)
          : null;
        const resolvedStatus = checklistLockedAt ? "COMPLETED" : t.status;
        const resolvedCompletedAt = t.completedAt
          ? t.completedAt.toISOString()
          : (checklistLockedAt || null);

        return {
          id: t.id,
          bookingCode: t.bookingCode,
          airportDeparture,
          title: t.destination ? `${t.title} • ${t.destination}` : t.title,
          description: null,
          plannedActivities,
          packageSnapshot: t.packageSnapshot || null,
          metadata: t.metadata || null,
          activityChecks,
          checklistLocked: Boolean(checklistLockedAt),
          checklistLockedAt,
          status: resolvedStatus,
          paymentStatus: t.paymentStatus,
          paidAt: t.paidAt ? t.paidAt.toISOString() : null,
          confirmedAt: t.confirmedAt ? t.confirmedAt.toISOString() : null,
          payoutStatus: t.payoutStatus || null,
          payoutRequestedAt: t.payoutRequestedAt ? t.payoutRequestedAt.toISOString() : null,
          payoutApprovedAt: t.payoutApprovedAt ? t.payoutApprovedAt.toISOString() : null,
          payoutPaidAt: t.payoutPaidAt ? t.payoutPaidAt.toISOString() : null,
          pickupValidatedAt,
          createdAt: t.createdAt,
          tripDate: t.startDate ? t.startDate.toISOString() : null,
          amountPaid: t.grossAmount != null ? Number(t.grossAmount) : null,
          currency: t.currency,
          tripType: t.category || null,
          completedAt: resolvedCompletedAt,
          source: "TOUR_BOOKING" as const,
          requester: {
            fullName: t.guestName || null,
            nationality: t.nationality || null,
            travelerCount: t.travelerCount,
          },
        };
      }),
    });
  })
);

// POST /api/agent/tour-bookings/:id/activity-checks
// Persists checklist completion state for a specific activity item with audit metadata.
router.post(
  "/tour-bookings/:id/activity-checks",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });

    const bodyParsed = activityCheckToggleSchema.safeParse(req.body || {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: bodyParsed.error.flatten() });
    }

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: { id: true, metadata: true, packageSnapshot: true, status: true },
    });
    if (!booking) return res.status(404).json({ error: "Not found" });

    const statusUpper = String(booking.status || "").toUpperCase();
    if (statusUpper.includes("CANCEL") || statusUpper.includes("COMPLETE")) {
      return res.status(400).json({ error: "Cannot update checklist for cancelled/completed booking" });
    }

    const { activityId, checked, totalActivities } = bodyParsed.data;
    const nowIso = new Date().toISOString();
    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? ({ ...(booking.metadata as any) } as Record<string, any>)
      : ({} as Record<string, any>);

    const progress = md.activityProgress && typeof md.activityProgress === "object" && !Array.isArray(md.activityProgress)
      ? ({ ...(md.activityProgress as any) } as Record<string, any>)
      : ({} as Record<string, any>);

    if (progress.lockedAt) {
      if (!["OPERATOR_COMPLETED", "COMPLETED"].includes(String(booking.status || "").toUpperCase())) {
        const operatorCompletedAt = new Date(String(progress.lockedAt));
        await prisma.tourBooking.update({
          where: { id: booking.id },
          data: {
            status: "OPERATOR_COMPLETED",
            operatorCompletedAt,
            disputeWindowEndsAt: disputeWindowEndsAt(operatorCompletedAt),
          },
          select: { id: true },
        });
      }
      return res.status(409).json({
        error: "Checklist is locked after full completion",
        locked: true,
        lockedAt: String(progress.lockedAt),
        status: "OPERATOR_COMPLETED",
        completedAt: null,
      });
    }

    const checks = progress.checks && typeof progress.checks === "object" && !Array.isArray(progress.checks)
      ? ({ ...(progress.checks as any) } as Record<string, any>)
      : ({} as Record<string, any>);

    if (checked) {
      checks[activityId] = {
        checkedAt: nowIso,
        checkedByAgentId: agent.id,
        checkedByUserId: req.user?.id ?? null,
      };
    } else {
      delete checks[activityId];
    }

    const prevHistory = Array.isArray(progress.history) ? progress.history : [];
    const historyEntry = {
      activityId,
      checked,
      at: nowIso,
      byAgentId: agent.id,
      byUserId: req.user?.id ?? null,
    };

    progress.checks = checks;
    progress.history = [...prevHistory, historyEntry].slice(-300);
    progress.updatedAt = nowIso;
    progress.updatedByAgentId = agent.id;

    const expectedCount = Math.max(
      estimatePlannedActivityCount(booking.metadata, booking.packageSnapshot),
      Number.isFinite(Number(totalActivities)) ? Number(totalActivities) : 0,
    );
    const checkedCount = Object.keys(checks).length;
    if (expectedCount > 0 && checkedCount >= expectedCount) {
      progress.lockedAt = nowIso;
      progress.lockedByAgentId = agent.id;
      progress.lockReason = "FULLY_COMPLETED";
    }

    md.activityProgress = progress;

    const shouldMarkOperatorCompleted = Boolean(progress.lockedAt)
      && !["OPERATOR_COMPLETED", "COMPLETED"].includes(String(booking.status || "").toUpperCase());
    const operatorCompletedAt = new Date(nowIso);

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: {
        metadata: md as any,
        ...(shouldMarkOperatorCompleted ? {
          status: "OPERATOR_COMPLETED",
          operatorCompletedAt,
          disputeWindowEndsAt: disputeWindowEndsAt(operatorCompletedAt),
        } : {}),
      },
      select: { id: true },
    });

    const flatChecks = Object.fromEntries(
      Object.entries(checks)
        .map(([id, val]) => {
          const iso = String((val as any)?.checkedAt || "").trim();
          return iso ? [id, iso] : null;
        })
        .filter((entry): entry is [string, string] => !!entry)
    );

    return res.json({
      ok: true,
      activityChecks: flatChecks,
      updatedAt: nowIso,
      locked: Boolean(progress.lockedAt),
      lockedAt: progress.lockedAt ? String(progress.lockedAt) : null,
      status: shouldMarkOperatorCompleted ? "OPERATOR_COMPLETED" : booking.status,
      completedAt: null,
    });
  })
);

// GET /api/agent/tour-bookings/:id
// Returns a single TourBooking where the logged-in agent is the operator.
router.get(
  "/tour-bookings/:id",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const t = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: {
        id: true,
        bookingCode: true,
        packageId: true,
        packageSnapshot: true,
        operatorSnapshot: true,
        title: true,
        destination: true,
        category: true,
        status: true,
        paymentStatus: true,
        startDate: true,
        endDate: true,
        grossAmount: true,
        currency: true,
        travelerCount: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        nationality: true,
        notes: true,
        metadata: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!t) return res.status(404).json({ error: "Not found" });

    const md = t.metadata && typeof t.metadata === "object" && !Array.isArray(t.metadata)
      ? (t.metadata as Record<string, any>)
      : ({} as Record<string, any>);
    const checklistLockedAt = md?.activityProgress?.lockedAt
      ? String(md.activityProgress.lockedAt)
      : null;
    const resolvedStatus = checklistLockedAt ? "COMPLETED" : t.status;
    const resolvedCompletedAt = t.completedAt
      ? t.completedAt.toISOString()
      : (checklistLockedAt || null);

    return res.json({
      ok: true,
      item: {
        id: t.id,
        bookingCode: t.bookingCode,
        packageId: t.packageId || null,
        packageSnapshot: t.packageSnapshot || null,
        operatorSnapshot: t.operatorSnapshot || null,
        title: t.destination ? `${t.title} • ${t.destination}` : t.title,
        description: t.notes || null,
        metadata: t.metadata || null,
        status: resolvedStatus,
        paymentStatus: t.paymentStatus,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        tripDate: t.startDate ? t.startDate.toISOString() : null,
        endDate: t.endDate ? t.endDate.toISOString() : null,
        completedAt: resolvedCompletedAt,
        amountPaid: t.grossAmount != null ? Number(t.grossAmount) : null,
        currency: t.currency,
        tripType: t.category || null,
        source: "TOUR_BOOKING" as const,
        requester: {
          fullName: t.guestName || null,
          email: t.guestEmail || null,
          phone: t.guestPhone || null,
          nationality: t.nationality || null,
          travelerCount: t.travelerCount,
        },
      },
    });
  })
);

// POST /api/agent/tour-bookings/:id/validate-pickup
// Agent validates first client pickup/meet by entering booking code suffix.
router.post(
  "/tour-bookings/:id/validate-pickup",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const bodyParsed = pickupValidateSchema.safeParse(req.body || {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: bodyParsed.error.flatten() });
    }

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: { id: true, bookingCode: true, metadata: true, status: true },
    });

    if (!booking) return res.status(404).json({ error: "Not found" });

    const expectedSuffix = String(booking.bookingCode || "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .slice(-6)
      .toUpperCase();
    const providedSuffix = String(bodyParsed.data.codeSuffix || "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase();

    if (!expectedSuffix || providedSuffix !== expectedSuffix) {
      return res.status(400).json({
        ok: false,
        error: "invalid_code_suffix",
        message: "Code suffix does not match this tour booking.",
      });
    }

    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? ({ ...(booking.metadata as any) } as Record<string, any>)
      : ({} as Record<string, any>);

    const nowIso = new Date().toISOString();
    const event = {
      at: nowIso,
      byAgentId: agent.id,
      byUserId: req.user?.id ?? null,
      method: "SUFFIX_MATCH",
      expectedSuffix,
      providedSuffix,
      note: bodyParsed.data.note ? String(bodyParsed.data.note).trim() : null,
    };

    const prevHistory = Array.isArray(md.pickupValidationHistory) ? md.pickupValidationHistory : [];
    const prevValidation = md.pickupValidation && typeof md.pickupValidation === "object" ? md.pickupValidation : {};
    const prevOperatorValidation = md.pickupValidationOperator && typeof md.pickupValidationOperator === "object" ? md.pickupValidationOperator : {};
    const prevCustomerValidation = md.pickupValidationCustomer && typeof md.pickupValidationCustomer === "object" ? md.pickupValidationCustomer : {};
    const operatorDisplayName = String((agent as any)?.fullName || (agent as any)?.displayName || (agent as any)?.name || "").trim();

    md.pickupValidationOperator = {
      ...prevOperatorValidation,
      validated: true,
      validatedAt: nowIso,
      validatedByAgentId: agent.id,
      validatedByAgentName: operatorDisplayName || undefined,
      expectedSuffix,
      providedSuffix,
      source: "OPERATOR",
    };
    // Operator confirmation should unlock customer side automatically.
    md.pickupValidationCustomer = {
      ...prevCustomerValidation,
      validated: true,
      validatedAt: prevCustomerValidation?.validatedAt || nowIso,
      autoValidatedFromOperator: true,
      syncedFromAgentId: agent.id,
      source: prevCustomerValidation?.source || "OPERATOR_SYNC",
    };
    md.pickupValidation = {
      ...prevValidation,
      validated: true,
      validatedAt: nowIso,
      validatedBy: "OPERATOR",
      validatedByAgentId: agent.id,
      validatedByAgentName: operatorDisplayName || undefined,
      expectedSuffix,
      providedSuffix,
      firstMeetValidated: true,
      note: event.note,
    };
    md.pickupValidationHistory = [...prevHistory, event].slice(-20);
    md.inProgressAt = nowIso;

    const currentStatus = String(booking.status || "").toUpperCase();
    const shouldAdvance = !currentStatus.includes("COMPLETE") && !currentStatus.includes("CANCEL") && !currentStatus.includes("PROGRESS");

    const prevClientTimeline = Array.isArray(md.clientTimelineEvents) ? md.clientTimelineEvents : [];
    md.clientTimelineEvents = [
      ...prevClientTimeline,
      {
        type: "PICKUP_VALIDATED",
        label: "Pickup validated by operator",
        at: nowIso,
        meta: { byAgentId: agent.id },
      },
      ...(shouldAdvance
        ? [
            {
              type: "IN_PROGRESS",
              label: "Package moved to In Progress",
              at: nowIso,
              meta: { byAgentId: agent.id },
            },
          ]
        : []),
    ].slice(-100);

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: {
        metadata: md as any,
        ...(shouldAdvance ? { status: "IN_PROGRESS" } : {}),
      },
      select: { id: true },
    });

    return res.json({
      ok: true,
      pickupValidation: md.pickupValidation,
      status: shouldAdvance ? "IN_PROGRESS" : booking.status,
    });
  })
);

// POST /api/agent/tour-bookings/:id/completion-rating
// Saves agent quality rating for a completed tour booking.
router.post(
  "/tour-bookings/:id/completion-rating",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });

    const bodyParsed = completionRatingSchema.safeParse(req.body || {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: bodyParsed.error.flatten() });
    }

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: { id: true, status: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Not found" });

    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? ({ ...(booking.metadata as any) } as Record<string, any>)
      : ({} as Record<string, any>);

    const statusUpper = String(booking.status || "").toUpperCase();
    const completedByStatus = statusUpper.includes("COMPLETE") || statusUpper.includes("DONE") || statusUpper.includes("FINISHED");
    const checklistLockedAt = md?.activityProgress?.lockedAt ? String(md.activityProgress.lockedAt) : null;
    const completedByChecklist = Boolean(checklistLockedAt);
    if (!completedByStatus && !completedByChecklist) {
      return res.status(409).json({ error: "Rating is allowed only for completed bookings" });
    }

    const nowIso = new Date().toISOString();
    const rating = bodyParsed.data;
    const overallRaw = (
      rating.taskQuality
      + rating.punctuality
      + rating.attentionToDetail
      + rating.communication
      + rating.professionalism
    ) / 5;

    const completionRating = {
      taskQuality: roundRating(rating.taskQuality),
      punctuality: roundRating(rating.punctuality),
      attentionToDetail: roundRating(rating.attentionToDetail),
      communication: roundRating(rating.communication),
      professionalism: roundRating(rating.professionalism),
      overallRating: roundRating(overallRaw),
      comment: rating.comment ? String(rating.comment).trim() : null,
      ratedAt: nowIso,
      ratedByAgentId: agent.id,
      ratedByUserId: req.user?.id ?? null,
    };

    md.agentCompletionRating = completionRating;

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: {
        metadata: md as any,
        ...(!completedByStatus && completedByChecklist
          ? { status: "COMPLETED", completedAt: new Date(checklistLockedAt as string) }
          : {}),
      },
      select: { id: true },
    });

    return res.json({ ok: true, completionRating });
  })
);

// ============================================================
// GET /api/agent/tour-bookings/:id/travellers
// Returns the traveller roster and their documents for a booking.
// ============================================================
router.get(
  "/tour-bookings/:id/travellers",
  requireRole("AGENT") as RequestHandler,
  limitAgentPortalRead as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: {
        id: true,
        bookingCode: true,
        title: true,
        destination: true,
        travelerCount: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        nationality: true,
        startDate: true,
        status: true,
        metadata: true,
      },
    });
    if (!booking) return res.status(404).json({ error: "Not found" });

    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? (booking.metadata as Record<string, any>)
      : ({} as Record<string, any>);
    const members = Array.isArray(md.groupMembers) ? md.groupMembers : [];

    return res.json({
      ok: true,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      title: booking.title,
      destination: booking.destination || null,
      startDate: booking.startDate ? booking.startDate.toISOString() : null,
      status: booking.status,
      travelerCount: booking.travelerCount,
      leadGuest: {
        fullName: booking.guestName || null,
        email: booking.guestEmail || null,
        phone: booking.guestPhone || null,
        nationality: booking.nationality || null,
      },
      members: members.map((m: any) => {
        let docs: Array<Record<string, unknown>> = [];
        if (Array.isArray(m.documents) && m.documents.length > 0) {
          docs = m.documents.map((d: any) => ({
            id: d.id || null,
            type: d.type || null,
            label: d.label || null,
            number: d.number || null,
            url: d.url || null,
            fileName: d.fileName || null,
            uploadedAt: d.uploadedAt || null,
          }));
        } else if (m.documentUrl) {
          docs = [{
            id: "legacy-doc",
            type: m.documentType || null,
            label: null,
            number: m.documentNumber || null,
            url: m.documentUrl,
            fileName: m.documentFileName || null,
            uploadedAt: m.createdAt || null,
          }];
        }
        return {
          id: m.id || null,
          fullName: m.fullName || null,
          nationality: m.nationality || null,
          phone: m.phone || null,
          relation: m.relation || null,
          photoUrl: m.photoUrl || null,
          documents: docs,
          permitStatus: m.permitStatus || "NOT_STARTED",
          permitNote: m.permitNote || null,
          permitUpdatedAt: m.permitUpdatedAt || null,
          createdAt: m.createdAt || null,
        };
      }),
    });
  })
);

const permitStatusSchema = z.object({
  permitStatus: z.enum(["NOT_STARTED", "PROCESSING", "APPROVED", "REJECTED"]),
  permitNote: z.string().max(500).optional().default(""),
});

// ============================================================
// PATCH /api/agent/tour-bookings/:id/travellers/:memberId/permit-status
// Operator updates the permit processing status for a traveller.
// ============================================================
router.patch(
  "/tour-bookings/:id/travellers/:memberId/permit-status",
  requireRole("AGENT") as RequestHandler,
  limitAgentProfileWrite as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid id" });

    const memberId = String(req.params?.memberId || "").trim();
    if (!memberId) return res.status(400).json({ error: "Missing member id" });

    const bodyParsed = permitStatusSchema.safeParse(req.body || {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: bodyParsed.error.flatten() });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Not found" });

    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? ({ ...(booking.metadata as any) } as Record<string, any>)
      : ({} as Record<string, any>);
    const members = Array.isArray(md.groupMembers) ? [...md.groupMembers] : [];

    const memberIndex = members.findIndex((m: any) => String(m.id) === memberId);
    if (memberIndex < 0) return res.status(404).json({ error: "Traveller not found" });

    const nowIso = new Date().toISOString();
    members[memberIndex] = {
      ...members[memberIndex],
      permitStatus: bodyParsed.data.permitStatus,
      permitNote: bodyParsed.data.permitNote?.trim() || null,
      permitUpdatedAt: nowIso,
      permitUpdatedByAgentId: agent.id,
    };
    md.groupMembers = members;

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({
      ok: true,
      member: {
        id: members[memberIndex].id,
        fullName: members[memberIndex].fullName || null,
        permitStatus: members[memberIndex].permitStatus,
        permitNote: members[memberIndex].permitNote,
        permitUpdatedAt: nowIso,
      },
    });
  })
);

// ============================================================
// POST /api/agent/tour-bookings/:id/travellers/:memberId/document-concern
// Operator raises a document concern and notifies the customer.
// ============================================================
const documentConcernSchema = z.object({
  message: z.string().min(5).max(500),
  concernType: z.enum(["MISSING_DOCUMENT", "MISMATCH", "EXPIRED", "UNREADABLE", "OTHER"]).default("OTHER"),
});

router.post(
  "/tour-bookings/:id/travellers/:memberId/document-concern",
  requireRole("AGENT") as RequestHandler,
  limitAgentProfileWrite as any,
  asyncHandler(async (req: any, res) => {
    const gate = await getActiveAgent(req as AuthedRequest);
    if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error, message: gate.message });
    const agent = gate.agent;

    const paramsParsed = idParamsSchema.safeParse(req.params || {});
    if (!paramsParsed.success) return res.status(400).json({ error: "Invalid id" });

    const idNum = Number(paramsParsed.data.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid id" });

    const memberId = String(req.params?.memberId || "").trim();
    if (!memberId) return res.status(400).json({ error: "Missing member id" });

    const bodyParsed = documentConcernSchema.safeParse(req.body || {});
    if (!bodyParsed.success) {
      return res.status(400).json({ error: "Invalid payload", details: bodyParsed.error.flatten() });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, operatorAgentId: agent.id, ...paidTourBookingWhere() },
      select: { id: true, bookingCode: true, customerId: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Not found" });
    if (!booking.customerId) return res.status(400).json({ error: "No customer linked to this booking" });

    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? (booking.metadata as Record<string, any>)
      : ({} as Record<string, any>);
    const members = Array.isArray(md.groupMembers) ? md.groupMembers : [];
    const member = members.find((m: any) => String(m.id) === memberId);
    if (!member) return res.status(404).json({ error: "Traveller not found" });

    await notifyUser(booking.customerId, "document_concern", {
      bookingCode: booking.bookingCode || "",
      bookingId: booking.id,
      memberName: member.fullName || "a traveller",
      memberId,
      concernType: bodyParsed.data.concernType,
      message: bodyParsed.data.message.trim(),
      operatorAgentId: agent.id,
    });

    return res.json({ ok: true, sent: true });
  })
);

export default router;

