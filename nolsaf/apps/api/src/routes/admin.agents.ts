// apps/api/src/routes/admin.agents.ts
import { Router, Response } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { sanitizeUserDocument } from "../lib/userDocumentSecurity.js";
import { buildOperatorProfileSeed, mergeOperatorProfileSeed } from "../lib/operatorProfileSeed.js";
import { computeAgentLevel, resolveTierLadder } from "../lib/agentLevel.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { Prisma } from "@prisma/client";
import { sendMail } from "../lib/mailer.js";
import { getAgentSuspensionEmail, getAgentRestorationEmail, getOperatorProfileApprovedEmail, getOperatorProfileRejectedEmail } from "../lib/authEmailTemplates.js";
import { signUserJwt } from "../lib/sessionManager.js";
import crypto from "crypto";
import { revokeUserAuthorization } from "../lib/authorizationInvalidation.js";
import { bridgeApprovedOperatorToAccommodation } from "../lib/nrmsPartnerCapability.js";

// ============================================================
// Constants
// ============================================================
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_MAX_ACTIVE_REQUESTS = 10;
const DEFAULT_AGENT_STATUS = "ACTIVE";
const DEFAULT_AGENT_LEVEL = "BRONZE";
const DEFAULT_PROMOTION_MIN_TRIPS = 30;
const DEFAULT_PROMOTION_MAX_TRIPS = 50;
const DEFAULT_PROMOTION_MIN_REVENUE = 20000000;
const DEFAULT_COMMISSION_PERCENT = 15.0;
const RATING_DECIMAL_PLACES = 1;

// Agent Status Enum
const AGENT_STATUS = {
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
} as const;

// Education Level Enum
const EDUCATION_LEVEL = {
  HIGH_SCHOOL: "HIGH_SCHOOL",
  DIPLOMA: "DIPLOMA",
  BACHELORS: "BACHELORS",
  MASTERS: "MASTERS",
  PHD: "PHD",
  OTHER: "OTHER",
} as const;

// Agent Level Enum
const AGENT_LEVEL = {
  BRONZE: "BRONZE",
  SILVER: "SILVER",
  GOLD: "GOLD",
  PLATINUM: "PLATINUM",
} as const;

// ============================================================
// TypeScript Interfaces
// ============================================================
interface AgentResponse {
  id: number;
  userId: number;
  status: string;
  educationLevel: string | null;
  areasOfOperation: string[];
  certifications: any[];
  languages: string[];
  yearsOfExperience: number | null;
  specializations: string[];
  bio: string | null;
  isAvailable: boolean;
  maxActiveRequests: number;
  currentActiveRequests: number;
  performanceMetrics?: any;
  level?: string;
  totalCompletedTrips?: number;
  totalRevenueGenerated?: number | string;
  // Live operator-tier metrics (list view): completed tours, NoLSAF commission (USD),
  // average rating, and review count — the signals behind the BRONZE→PLATINUM tier.
  completedTours?: number;
  noLSAFRevenue?: number;
  overallRating?: number | null;
  totalReviews?: number;
  promotionProgress?: any;
  operatorProfile?: Prisma.JsonValue | null;
  financialSummary?: {
    paidCount: number;
    grossSum: number;
    commissionSum: number;
    netSum: number;
    commissionPercent: number;
    currency: string;
  };
  accommodationCapability?: {
    workspace: "ACCOMMODATION";
    status: string | null;
    grantedAt: Date | null;
    expiresAt: Date | null;
    statusReason: string | null;
    identity: {
      id: number;
      status: string;
      verificationStatus: string;
    } | null;
    approvedEvidenceCount: number;
  };
  createdAt: Date;
  updatedAt: Date;
  user: {
    id: number;
    name: string | null;
    email: string | null;
    phone: string | null;
    createdAt?: Date;
  };
  assignedPlanRequests?: any[];
  reviews?: any[];
}

interface PaginatedResponse<T> {
  page: number;
  pageSize: number;
  total: number;
  items: T[];
}

// ============================================================
// Rate Limiters
// ============================================================
const limitAgentOperations = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 100, // 100 operations per admin per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait before trying again." },
  keyGenerator: (req) => {
    const adminId = (req as AuthedRequest).user?.id;
    return adminId ? `admin-agents:${adminId}` : req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Tighter limiter specifically for destructive suspend/restore actions:
// max 10 per admin per hour to prevent bulk-misuse via compromised token.
const limitAgentSuspendRestore = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many suspend/restore actions. Please wait before trying again." },
  keyGenerator: (req) => {
    const adminId = (req as AuthedRequest).user?.id;
    return adminId ? `admin-agents-suspend:${adminId}` : req.ip || req.socket.remoteAddress || "unknown";
  },
});

// ============================================================
// Zod Validation Schemas
// ============================================================
const certificationSchema = z.object({
  name: z.string().min(1).max(200),
  issuer: z.string().min(1).max(200).optional(),
  year: z.number().int().min(1900).max(2100).optional(),
  expiryDate: z.string().optional(),
}).strict();

const listAgentsQuerySchema = z.object({
  status: z.enum([AGENT_STATUS.ACTIVE, AGENT_STATUS.INACTIVE, AGENT_STATUS.SUSPENDED]).optional(),
  educationLevel: z.enum([
    EDUCATION_LEVEL.HIGH_SCHOOL,
    EDUCATION_LEVEL.DIPLOMA,
    EDUCATION_LEVEL.BACHELORS,
    EDUCATION_LEVEL.MASTERS,
    EDUCATION_LEVEL.PHD,
    EDUCATION_LEVEL.OTHER,
  ]).optional(),
  // NOTE: Apply `optional()` AFTER `transform()` so missing `available` stays `undefined`
  // (otherwise Zod would transform `undefined` into `false`, unintentionally filtering results).
  available: z.enum(["true", "false"]).transform((val) => val === "true").optional(),
  // Operator tier (BRONZE→PLATINUM), computed live from tour-company activity.
  level: z.enum(["BRONZE", "SILVER", "GOLD", "PLATINUM"]).optional(),
  areasOfOperation: z.string().optional(),
  specializations: z.string().optional(),
  languages: z.string().optional(),
  page: z.string().regex(/^\d+$/).optional().default("1").transform((val) => Number(val) || 1),
  pageSize: z.string().regex(/^\d+$/).optional().default(String(DEFAULT_PAGE_SIZE)).transform((val) => Number(val) || DEFAULT_PAGE_SIZE),
  q: z.string().min(1).max(200).optional(),
}).strict();

const getAgentParamsSchema = z.object({
  id: z.string().regex(/^\d+$/).transform(Number),
}).strict();

const createAgentSchema = z.object({
  userId: z.number().int().positive(),
  status: z.enum([AGENT_STATUS.ACTIVE, AGENT_STATUS.INACTIVE, AGENT_STATUS.SUSPENDED]).optional().default(AGENT_STATUS.ACTIVE),
  educationLevel: z.enum([
    EDUCATION_LEVEL.HIGH_SCHOOL,
    EDUCATION_LEVEL.DIPLOMA,
    EDUCATION_LEVEL.BACHELORS,
    EDUCATION_LEVEL.MASTERS,
    EDUCATION_LEVEL.PHD,
    EDUCATION_LEVEL.OTHER,
  ]).optional(),
  areasOfOperation: z.array(z.string().min(1).max(100)).max(50).optional(),
  certifications: z.array(certificationSchema).max(20).optional(),
  languages: z.array(z.string().min(1).max(50)).max(20).optional(),
  yearsOfExperience: z.number().int().min(0).max(100).optional(),
  specializations: z.array(z.string().min(1).max(100)).max(30).optional(),
  bio: z.string().max(5000).optional(),
  maxActiveRequests: z.number().int().min(1).max(100).optional().default(DEFAULT_MAX_ACTIVE_REQUESTS),
  isAvailable: z.boolean().optional().default(true),
}).strict();

const updateAgentSchema = z.object({
  status: z.enum([AGENT_STATUS.ACTIVE, AGENT_STATUS.INACTIVE, AGENT_STATUS.SUSPENDED]).optional(),
  educationLevel: z.enum([
    EDUCATION_LEVEL.HIGH_SCHOOL,
    EDUCATION_LEVEL.DIPLOMA,
    EDUCATION_LEVEL.BACHELORS,
    EDUCATION_LEVEL.MASTERS,
    EDUCATION_LEVEL.PHD,
    EDUCATION_LEVEL.OTHER,
  ]).optional(),
  areasOfOperation: z.array(z.string().min(1).max(100)).max(50).optional(),
  certifications: z.array(certificationSchema).max(20).optional(),
  languages: z.array(z.string().min(1).max(50)).max(20).optional(),
  yearsOfExperience: z.number().int().min(0).max(100).optional().nullable(),
  specializations: z.array(z.string().min(1).max(100)).max(30).optional(),
  bio: z.string().max(5000).optional().nullable(),
  isAvailable: z.boolean().optional(),
  maxActiveRequests: z.number().int().min(1).max(100).optional(),
}).strict();

const assignAgentSchema = z.object({
  planRequestId: z.number().int().positive(),
}).strict();

const agentDocParamsSchema = z
  .object({
    id: z.string().regex(/^\d+$/).transform(Number),
    docId: z.string().regex(/^\d+$/).transform(Number),
  })
  .strict();

const updateDocStatusSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().max(2000).optional().nullable(),
  })
  .strict();

const createAgentNoteSchema = z
  .object({
    text: z.string().min(1).max(4000),
  })
  .strict();

const updateProfileReviewSchema = z
  .object({
    status: z.enum(["APPROVED", "REJECTED"]),
    reason: z.string().max(2000).optional().nullable(),
  })
  .strict();

const accommodationCapabilitySchema = z.object({
  reason: z.string().trim().min(3).max(300).optional(),
});

const syncTourRevenueSchema = z
  .object({
    dryRun: z.boolean().optional().default(false),
  })
  .strict();

// ============================================================
// Helper Functions
// ============================================================
function sendError(res: Response, status: number, message: string, details?: any): void {
  res.status(status).json({
    error: message,
    ...(details && { details }),
  });
}

function sendSuccess<T>(res: Response, data?: T, message?: string, status: number = 200): void {
  res.status(status).json({
    ok: true,
    ...(message && { message }),
    ...(data && { data }),
  });
}

function getAdminId(req: AuthedRequest): number {
  return req.user!.id;
}

function formatAgentResponse(agent: any): AgentResponse {
  return {
    id: agent.id,
    userId: agent.userId,
    status: agent.status,
    educationLevel: agent.educationLevel,
    areasOfOperation: Array.isArray(agent.areasOfOperation) ? agent.areasOfOperation : [],
    certifications: Array.isArray(agent.certifications) ? agent.certifications : [],
    languages: Array.isArray(agent.languages) ? agent.languages : [],
    yearsOfExperience: agent.yearsOfExperience,
    specializations: Array.isArray(agent.specializations) ? agent.specializations : [],
    bio: agent.bio,
    isAvailable: agent.isAvailable,
    maxActiveRequests: agent.maxActiveRequests,
    currentActiveRequests: agent.currentActiveRequests,
    performanceMetrics: agent.performanceMetrics || {},
    level: agent.level || DEFAULT_AGENT_LEVEL,
    totalCompletedTrips: agent.totalCompletedTrips || 0,
    totalRevenueGenerated: agent.totalRevenueGenerated || 0,
    operatorProfile: agent.operatorProfile ?? null,
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
    user: agent.user,
    ...(agent.assignedPlanRequests && { assignedPlanRequests: agent.assignedPlanRequests }),
    ...(agent.reviews && { reviews: agent.reviews }),
  };
}

function normalizeEmail(email: unknown): string | null {
  const normalized = String(email ?? "").trim().toLowerCase();
  return normalized ? normalized : null;
}

function normalizePhone(phone: unknown): string | null {
  const normalized = String(phone ?? "").trim();
  return normalized ? normalized : null;
}

// The hired-application backfill below is a best-effort safety net — agents are
// provisioned at hire time (admin.careers.applications.ts). Running it on every
// admin list load multiplied DB write traffic (each write replaces the whole
// operatorProfile JSON column, risking lost updates against concurrent operator
// edits) and added seconds of latency on remote DBs. Throttle per instance.
let lastEnsureAgentsRunAt = 0;
const ENSURE_AGENTS_MIN_INTERVAL_MS = 5 * 60 * 1000;

async function ensureAgentsFromHiredApplications(req: AuthedRequest): Promise<void> {
  const now = Date.now();
  if (now - lastEnsureAgentsRunAt < ENSURE_AGENTS_MIN_INTERVAL_MS) return;
  lastEnsureAgentsRunAt = now;

  const normalizeLanguageStrings = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (typeof item === "string") {
        const trimmed = item.trim();
        if (trimmed) out.push(trimmed);
        continue;
      }
      if (item && typeof item === "object") {
        const maybeLanguage = (item as any).language;
        if (typeof maybeLanguage === "string") {
          const trimmed = maybeLanguage.trim();
          if (trimmed) out.push(trimmed);
        }
      }
    }
    return Array.from(new Set(out));
  };

  const normalizeAreas = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((v) => typeof v === "string")
          .map((v) => v.trim())
          .filter(Boolean)
      )
    );
  };

  // Source of truth for recruiting: Job applications.
  // When an application is marked HIRED, ensure it has an Agent profile linked.
  const hiredWithoutAgent = await prisma.jobApplication.findMany({
    where: {
      status: "HIRED",
      agentId: null,
      // Business rule: only jobs flagged as Travel Agent recruitment create Agents.
      job: { isTravelAgentPosition: true } as any,
    },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      region: true,
      district: true,
      nationality: true,
      educationLevel: true,
      yearsOfExperience: true,
      languages: true,
      agentApplicationData: true,
      job: {
        select: {
          locationDetail: true,
        },
      },
    },
    orderBy: { id: "asc" },
    take: 50,
  });

  // Also best-effort backfill: for already-linked HIRED applications, populate missing
  // User/Agent profile fields from the application payload.
  const hiredWithAgent = await prisma.jobApplication.findMany({
    where: {
      status: "HIRED",
      agentId: { not: null },
      job: { isTravelAgentPosition: true } as any,
    },
    select: {
      id: true,
      fullName: true,
      region: true,
      district: true,
      nationality: true,
      educationLevel: true,
      yearsOfExperience: true,
      languages: true,
      agentApplicationData: true,
      job: {
        select: {
          locationDetail: true,
        },
      },
      agent: {
        select: {
          id: true,
          userId: true,
          areasOfOperation: true,
          specializations: true,
          educationLevel: true,
          yearsOfExperience: true,
          languages: true,
          // operatorProfile MUST be loaded here: the backfill loop below merges the
          // seed into it and writes the result back. Without it, the merge sees
          // `undefined` and overwrites the operator's full profile with seed-only data
          // on every admin agents list load.
          operatorProfile: true,
          user: {
            select: {
              id: true,
              name: true,
              fullName: true,
              nationality: true,
              region: true,
              district: true,
            },
          },
        },
      },
    },
    orderBy: { id: "asc" },
    take: 50,
  });

  if (hiredWithoutAgent.length === 0 && hiredWithAgent.length === 0) return;

  const createdAgentIds: number[] = [];
  const linkedApplicationIds: number[] = [];
  const backfilledAgentIds: number[] = [];
  const backfilledUserIds: number[] = [];

  for (const app of hiredWithoutAgent) {
    const email = normalizeEmail(app.email);
    const phone = normalizePhone(app.phone);

    if (!email && !phone) continue;

    const userOr: Prisma.UserWhereInput[] = [];
    if (email) userOr.push({ email });
    if (phone) userOr.push({ phone });

    let user = await prisma.user.findFirst({
      where: userOr.length > 0 ? { OR: userOr } : undefined,
      select: { id: true, role: true, nationality: true, region: true, district: true, timezone: true, name: true, fullName: true },
    });

    if (!user) {
      try {
        user = await prisma.user.create({
          data: {
            email,
            phone,
            name: app.fullName,
            fullName: app.fullName,
            role: "AGENT",
          } as any,
          select: { id: true, role: true, nationality: true, region: true, district: true, timezone: true, name: true, fullName: true },
        });
      } catch (e: any) {
        // Raced with another request, re-read by unique fields.
        if (e?.code === "P2002") {
          user = await prisma.user.findFirst({
            where: { OR: userOr },
            select: { id: true, role: true, nationality: true, region: true, district: true, timezone: true, name: true, fullName: true },
          });
        } else {
          console.warn("[ensureAgentsFromHiredApplications] Failed to create user", {
            applicationId: app.id,
            message: e?.message,
          });
          continue;
        }
      }
    }

    if (!user) continue;

    // Best-effort: populate user profile location fields from application data.
    // Only fill missing values to avoid overwriting any later user updates.
    const d = (app.agentApplicationData ?? {}) as any;
    try {
      const userUpdate: any = {};
      const nationality = typeof (app as any).nationality === "string" && String((app as any).nationality).trim()
        ? String((app as any).nationality).trim()
        : (typeof d.nationality === "string" ? d.nationality.trim() : "");
      const region = typeof (app as any).region === "string" && String((app as any).region).trim()
        ? String((app as any).region).trim()
        : typeof d.region === "string"
          ? d.region.trim()
          : "";
      const district = typeof (app as any).district === "string" && String((app as any).district).trim()
        ? String((app as any).district).trim()
        : typeof d.district === "string"
          ? d.district.trim()
          : "";
      const timezone = typeof d.timezone === "string" ? d.timezone.trim() : "";

      if (!user.fullName && app.fullName) userUpdate.fullName = app.fullName;
      if (!user.name && app.fullName) userUpdate.name = app.fullName;
      if (!user.nationality && nationality) userUpdate.nationality = nationality;
      if (!user.region && region) userUpdate.region = region;
      if (!user.district && district) userUpdate.district = district;
      if (!user.timezone && timezone) userUpdate.timezone = timezone;

      if (Object.keys(userUpdate).length > 0) {
        const updated = await prisma.user.update({
          where: { id: user.id },
          data: userUpdate,
          select: { id: true, role: true, nationality: true, region: true, district: true, timezone: true, name: true, fullName: true },
        });
        user = updated as any;
      }
    } catch {
      // ignore
    }

    if (user.role !== "AGENT") {
      try {
        await prisma.user.update({
          where: { id: user.id },
          data: { role: "AGENT" },
          select: { id: true },
        });
      } catch {
        // do not block provisioning
      }
    }

    let agent = await prisma.agent.findUnique({
      where: { userId: user.id },
      select: { id: true, areasOfOperation: true, specializations: true, educationLevel: true, yearsOfExperience: true, languages: true, operatorProfile: true },
    });

    if (!agent) {
      // d already normalized above
      try {
        const jobAreaOfOperationRaw = typeof (app as any)?.job?.locationDetail === "string"
          ? String((app as any).job.locationDetail).trim()
          : "";

        const inferredAreasFromJob = Array.from(
          new Set(
            jobAreaOfOperationRaw
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          )
        );

        const applicationEducationLevel = (app as any).educationLevel ? String((app as any).educationLevel) : null;
        const applicationYearsOfExperience = (app as any).yearsOfExperience != null ? Number((app as any).yearsOfExperience) : null;
        const applicationLanguages = normalizeLanguageStrings((app as any).languages);
        const agentDataLanguages = normalizeLanguageStrings(d.languages);
        const operatorProfileSeed = buildOperatorProfileSeed(app.agentApplicationData, {
          fullName: app.fullName,
          email: app.email,
          phone: app.phone,
          region: app.region,
          district: app.district,
        });

        agent = await prisma.agent.create({
          data: {
            user: { connect: { id: user.id } },
            status: d.status || DEFAULT_AGENT_STATUS,
            educationLevel: applicationEducationLevel || d.educationLevel || null,
            yearsOfExperience: applicationYearsOfExperience != null
              ? applicationYearsOfExperience
              : (d.yearsOfExperience != null ? Number(d.yearsOfExperience) : null),
            bio: d.bio || null,
            maxActiveRequests: d.maxActiveRequests != null ? Number(d.maxActiveRequests) : DEFAULT_MAX_ACTIVE_REQUESTS,
            isAvailable: d.isAvailable !== undefined ? Boolean(d.isAvailable) : true,
            currentActiveRequests: 0,
            areasOfOperation:
              inferredAreasFromJob.length > 0
                ? inferredAreasFromJob
                : (Array.isArray(d.areasOfOperation) && d.areasOfOperation.length > 0 ? d.areasOfOperation : null),
            certifications: Array.isArray(d.certifications) && d.certifications.length > 0 ? d.certifications : null,
            languages: applicationLanguages.length > 0 ? applicationLanguages : (agentDataLanguages.length > 0 ? agentDataLanguages : null),
            specializations: Array.isArray(d.specializations) && d.specializations.length > 0 ? d.specializations : null,
          } as any,
          select: { id: true },
        });
        createdAgentIds.push(agent.id);
      } catch (e: any) {
        if (e?.code === "P2002") {
          agent = await prisma.agent.findUnique({
            where: { userId: user.id },
            // operatorProfile must be selected: the backfill below merges into it
            // and writes the result back — without it the merge wipes the profile.
            select: { id: true, areasOfOperation: true, specializations: true, educationLevel: true, yearsOfExperience: true, languages: true, operatorProfile: true },
          });
        } else {
          console.warn("[ensureAgentsFromHiredApplications] Failed to create agent", {
            applicationId: app.id,
            userId: user.id,
            message: e?.message,
          });
          continue;
        }
      }
    }

    if (agent) {
      // Best-effort: fill empty agent profile arrays from application data
      try {
        const jobAreaOfOperationRaw = typeof (app as any)?.job?.locationDetail === "string"
          ? String((app as any).job.locationDetail).trim()
          : "";

        const inferredAreasFromJob = Array.from(
          new Set(
            jobAreaOfOperationRaw
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          )
        );

        const applicationEducationLevel = (app as any).educationLevel ? String((app as any).educationLevel) : null;
        const applicationYearsOfExperience = (app as any).yearsOfExperience != null ? Number((app as any).yearsOfExperience) : null;
        const applicationLanguages = normalizeLanguageStrings((app as any).languages);
        const agentDataLanguages = normalizeLanguageStrings(d.languages);
        const operatorProfileSeed = buildOperatorProfileSeed(app.agentApplicationData, {
          fullName: app.fullName,
          email: app.email,
          phone: app.phone,
          region: app.region,
          district: app.district,
        });

        const incomingAreas = Array.isArray(d.areasOfOperation) ? d.areasOfOperation : [];
        const incomingSpecs = Array.isArray(d.specializations) ? d.specializations : [];
        const existingAreas = Array.isArray((agent as any).areasOfOperation) ? (agent as any).areasOfOperation : null;
        const existingSpecs = Array.isArray((agent as any).specializations) ? (agent as any).specializations : null;
        const existingLanguages = Array.isArray((agent as any).languages) ? (agent as any).languages : null;
        const existingEducation = (agent as any).educationLevel ? String((agent as any).educationLevel) : null;
        const existingYears = (agent as any).yearsOfExperience != null ? Number((agent as any).yearsOfExperience) : null;

        const agentUpdate: any = {};
        // Areas of Operation must match the job advert when set.
        if (inferredAreasFromJob.length > 0) {
          const currentAreas = normalizeAreas(existingAreas);
          const advertAreas = inferredAreasFromJob;
          const same = currentAreas.length === advertAreas.length && currentAreas.every((v, idx) => v === advertAreas[idx]);
          if (!same) agentUpdate.areasOfOperation = advertAreas;
        } else if ((!existingAreas || existingAreas.length === 0) && incomingAreas.length > 0) {
          agentUpdate.areasOfOperation = incomingAreas;
        }
        if ((!existingSpecs || existingSpecs.length === 0) && incomingSpecs.length > 0) agentUpdate.specializations = incomingSpecs;

        if (!existingEducation && (applicationEducationLevel || d.educationLevel)) {
          agentUpdate.educationLevel = applicationEducationLevel || d.educationLevel;
        }

        if (existingYears == null) {
          const incomingYears = applicationYearsOfExperience != null
            ? applicationYearsOfExperience
            : (d.yearsOfExperience != null ? Number(d.yearsOfExperience) : null);
          if (incomingYears != null) agentUpdate.yearsOfExperience = incomingYears;
        }

        if ((!existingLanguages || existingLanguages.length === 0)) {
          const incomingLanguages = applicationLanguages.length > 0
            ? applicationLanguages
            : (agentDataLanguages.length > 0 ? agentDataLanguages : []);
          if (incomingLanguages.length > 0) agentUpdate.languages = incomingLanguages;
        }

        if (Object.keys(operatorProfileSeed).length > 0 && (agent as any).operatorProfile !== undefined) {
          const mergedProfile = mergeOperatorProfileSeed((agent as any).operatorProfile, operatorProfileSeed) as any;
          // Only write when the merge actually fills a previously-blank field —
          // unconditional writes replace the whole JSON column and can destroy
          // concurrent operator edits/submissions.
          if (JSON.stringify(mergedProfile) !== JSON.stringify((agent as any).operatorProfile ?? {})) {
            agentUpdate.operatorProfile = mergedProfile;
          }
        }

        if (Object.keys(agentUpdate).length > 0) {
          await prisma.agent.update({
            where: { id: agent.id },
            data: agentUpdate as any,
            select: { id: true },
          });
        }
      } catch {
        // ignore
      }
    }

    if (!agent) continue;

    try {
      await prisma.jobApplication.update({
        where: { id: app.id },
        data: { agentId: agent.id },
        select: { id: true },
      });
      linkedApplicationIds.push(app.id);
    } catch (e: any) {
      console.warn("[ensureAgentsFromHiredApplications] Failed to link application to agent", {
        applicationId: app.id,
        agentId: agent.id,
        message: e?.message,
      });
    }
  }

  for (const app of hiredWithAgent) {
    const d = (app.agentApplicationData ?? {}) as any;
    const agent = (app as any).agent as any;
    const user = agent?.user as any;
    if (!agent || !user) continue;

    try {
      const nationality = typeof (app as any).nationality === "string" && String((app as any).nationality).trim()
        ? String((app as any).nationality).trim()
        : (typeof d.nationality === "string" ? d.nationality.trim() : "");
      const region = typeof (app as any).region === "string" && String((app as any).region).trim() ? String((app as any).region).trim() : "";
      const district = typeof (app as any).district === "string" && String((app as any).district).trim() ? String((app as any).district).trim() : "";

      const userUpdate: any = {};
      if (!user.fullName && app.fullName) userUpdate.fullName = app.fullName;
      if (!user.name && app.fullName) userUpdate.name = app.fullName;
      if (!user.nationality && nationality) userUpdate.nationality = nationality;
      if (!user.region && region) userUpdate.region = region;
      if (!user.district && district) userUpdate.district = district;

      if (Object.keys(userUpdate).length > 0) {
        await prisma.user.update({ where: { id: user.id }, data: userUpdate });
        backfilledUserIds.push(user.id);
      }
    } catch {
      // ignore
    }

    try {
      const jobAreaOfOperationRaw = typeof (app as any)?.job?.locationDetail === "string"
        ? String((app as any).job.locationDetail).trim()
        : "";

      const inferredAreasFromJob = Array.from(
        new Set(
          jobAreaOfOperationRaw
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean)
        )
      );

      const applicationEducationLevel = (app as any).educationLevel ? String((app as any).educationLevel) : null;
      const applicationYearsOfExperience = (app as any).yearsOfExperience != null ? Number((app as any).yearsOfExperience) : null;
      const applicationLanguages = normalizeLanguageStrings((app as any).languages);
      const agentDataLanguages = normalizeLanguageStrings(d.languages);
      const operatorProfileSeed = buildOperatorProfileSeed(app.agentApplicationData, {
        fullName: app.fullName,
        email: app.email,
        phone: app.phone,
        region: app.region,
        district: app.district,
      });

      const incomingAreas = Array.isArray(d.areasOfOperation) ? d.areasOfOperation : [];
      const incomingSpecs = Array.isArray(d.specializations) ? d.specializations : [];
      const existingAreas = Array.isArray(agent.areasOfOperation) ? agent.areasOfOperation : null;
      const existingSpecs = Array.isArray(agent.specializations) ? agent.specializations : null;
      const existingLanguages = Array.isArray(agent.languages) ? agent.languages : null;
      const existingEducation = agent.educationLevel ? String(agent.educationLevel) : null;
      const existingYears = agent.yearsOfExperience != null ? Number(agent.yearsOfExperience) : null;

      const agentUpdate: any = {};
      // Areas of Operation must match the job advert when set.
      if (inferredAreasFromJob.length > 0) {
        const currentAreas = normalizeAreas(existingAreas);
        const advertAreas = inferredAreasFromJob;
        const same = currentAreas.length === advertAreas.length && currentAreas.every((v, idx) => v === advertAreas[idx]);
        if (!same) agentUpdate.areasOfOperation = advertAreas;
      } else if ((!existingAreas || existingAreas.length === 0) && incomingAreas.length > 0) {
        agentUpdate.areasOfOperation = incomingAreas;
      }
      if ((!existingSpecs || existingSpecs.length === 0) && incomingSpecs.length > 0) agentUpdate.specializations = incomingSpecs;

      if (!existingEducation && (applicationEducationLevel || d.educationLevel)) {
        agentUpdate.educationLevel = applicationEducationLevel || d.educationLevel;
      }

      if (existingYears == null) {
        const incomingYears = applicationYearsOfExperience != null
          ? applicationYearsOfExperience
          : (d.yearsOfExperience != null ? Number(d.yearsOfExperience) : null);
        if (incomingYears != null) agentUpdate.yearsOfExperience = incomingYears;
      }

      if ((!existingLanguages || existingLanguages.length === 0)) {
        const incomingLanguages = applicationLanguages.length > 0
          ? applicationLanguages
          : (agentDataLanguages.length > 0 ? agentDataLanguages : []);
        if (incomingLanguages.length > 0) agentUpdate.languages = incomingLanguages;
      }

      if (Object.keys(operatorProfileSeed).length > 0 && agent.operatorProfile !== undefined) {
        const mergedProfile = mergeOperatorProfileSeed(agent.operatorProfile, operatorProfileSeed) as any;
        // Only write when the merge actually fills a previously-blank field.
        // Writing unconditionally replaces the whole JSON column on every admin
        // list load, which destroys concurrent operator edits/submissions.
        if (JSON.stringify(mergedProfile) !== JSON.stringify(agent.operatorProfile ?? {})) {
          agentUpdate.operatorProfile = mergedProfile;
        }
      }

      if (Object.keys(agentUpdate).length > 0) {
        await prisma.agent.update({ where: { id: agent.id }, data: agentUpdate });
        backfilledAgentIds.push(agent.id);
      }
    } catch {
      // ignore
    }
  }

  if (createdAgentIds.length > 0 || linkedApplicationIds.length > 0 || backfilledAgentIds.length > 0 || backfilledUserIds.length > 0) {
    try {
      await audit(req as any, "AGENT_PROVISIONED_FROM_HIRED_APPLICATION", "agents", null, {
        createdAgentIds,
        linkedApplicationIds,
        backfilledAgentIds,
        backfilledUserIds,
      });
    } catch {
      // ignore
    }
  }
}

// Validation middleware helper
function validate<T extends z.ZodTypeAny>(schema: T, source: "body" | "query" | "params" = "body") {
  return (req: any, res: Response, next: any) => {
    const data = source === "body" ? req.body : source === "query" ? req.query : req.params;
    const result = schema.safeParse(data);
    if (!result.success) {
      return sendError(res, 400, "Invalid request", { errors: result.error.issues });
    }
    if (source === "params") {
      req.validatedParams = result.data;
    } else if (source === "query") {
      req.validatedQuery = result.data;
    } else {
      req.validatedData = result.data;
    }
    next();
  };
}

// ============================================================
// Router Setup
// ============================================================
export const router = Router();
router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);
router.use(limitAgentOperations);

// ============================================================
// GET /api/admin/agents
// ============================================================
router.get("/", validate(listAgentsQuerySchema, "query"), async (req: any, res) => {
  try {
    const {
      status,
      educationLevel,
      available,
      level,
      areasOfOperation,
      specializations,
      languages,
      page,
      pageSize,
      q,
    } = req.validatedQuery;

    const pageNum = Math.max(1, page);
    const pageSizeNum = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
    const skip = (pageNum - 1) * pageSizeNum;
    const take = pageSizeNum;

    // Auto-provision agents strictly from HIRED job applications.
    await ensureAgentsFromHiredApplications(req as AuthedRequest);

    // Build where clause with proper Prisma types
    // Note: do NOT filter by user.role here. The Agent table is the source of truth;
    // legacy/hired agents might have a user role not set to "AGENT" yet.
    const where: Prisma.AgentWhereInput = {};

    if (status) {
      where.status = status;
    }

    if (available !== undefined) {
      where.isAvailable = available;
    }

    if (educationLevel) {
      where.educationLevel = educationLevel;
    }

    // Text search
    if (q) {
      const sanitizedQ = sanitizeText(q);
      where.user = {
        OR: [
          { name: { contains: sanitizedQ } },
          { email: { contains: sanitizedQ } },
          { phone: { contains: sanitizedQ } },
        ],
      };
    }

    // Fetch agents with user info
    const [total, agents] = await Promise.all([
      prisma.agent.count({ where }),
      prisma.agent.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              fullName: true,
              email: true,
              phone: true,
              nationality: true,
              region: true,
              district: true,
              timezone: true,
              avatarUrl: true,
              createdAt: true,
            },
          },
        },
        skip,
        take,
        orderBy: { createdAt: "desc" },
      }),
    ]);

    // Filter by JSON fields if provided (in memory - Prisma JSON filtering is limited in MySQL)
    let filteredAgents = agents;

    if (areasOfOperation) {
      const areaFilter = sanitizeText(areasOfOperation).toLowerCase();
      filteredAgents = filteredAgents.filter((agent) => {
        const areas = agent.areasOfOperation;
        if (!Array.isArray(areas)) return false;
        return areas.some((area) => {
          if (typeof area !== "string") return false;
          return String(area).toLowerCase().includes(areaFilter);
        });
      });
    }

    if (specializations) {
      const specFilter = sanitizeText(specializations).toLowerCase();
      filteredAgents = filteredAgents.filter((agent) => {
        const specs = agent.specializations;
        if (!Array.isArray(specs)) return false;
        return specs.some((spec) => {
          if (typeof spec !== "string") return false;
          return String(spec).toLowerCase().includes(specFilter);
        });
      });
    }

    if (languages) {
      const langFilter = sanitizeText(languages).toLowerCase();
      filteredAgents = filteredAgents.filter((agent) => {
        const langs = agent.languages;
        if (!Array.isArray(langs)) return false;
        return langs.some((lang) => {
          if (typeof lang !== "string") return false;
          return String(lang).toLowerCase().includes(langFilter);
        });
      });
    }

    // ---- Operator tier (BRONZE→PLATINUM), computed LIVE from tour-company activity ----
    // The same signals the detail view and operator dashboard use: completed tours,
    // NoLSAF commission (USD), and average review rating. Batched per page so the
    // table stays accurate against the admin-configurable ladder without N+1 queries.
    const agentIds = filteredAgents.map((a) => a.id);
    const tiers = resolveTierLadder((await prisma.systemSetting.findUnique({ where: { id: 1 } }) as any)?.agentTierLadder);

    const toursByAgent = new Map<number, number>();
    const revenueByAgent = new Map<number, number>();
    const ratingByAgent = new Map<number, { sum: number; count: number }>();

    if (agentIds.length) {
      const [completedGroups, revenueGroups, reviewGroups] = await Promise.all([
        prisma.tourBooking.groupBy({
          by: ["operatorAgentId"],
          where: { operatorAgentId: { in: agentIds }, status: "COMPLETED" },
          _count: { _all: true },
        }),
        prisma.tourBooking.groupBy({
          by: ["operatorAgentId"],
          where: { operatorAgentId: { in: agentIds } },
          _sum: { commissionAmount: true },
        }),
        prisma.agentReview.groupBy({
          by: ["agentId"],
          where: { agentId: { in: agentIds } },
          _avg: { punctualityRating: true, customerCareRating: true, communicationRating: true },
          _count: { _all: true },
        }),
      ]);
      for (const g of completedGroups) if (g.operatorAgentId != null) toursByAgent.set(g.operatorAgentId, g._count._all);
      for (const g of revenueGroups) if (g.operatorAgentId != null) revenueByAgent.set(g.operatorAgentId, Math.round(Number(g._sum.commissionAmount ?? 0)));
      for (const g of reviewGroups) {
        const avg = ((g._avg.punctualityRating ?? 0) + (g._avg.customerCareRating ?? 0) + (g._avg.communicationRating ?? 0)) / 3;
        ratingByAgent.set(g.agentId, { sum: avg, count: g._count._all });
      }
    }

    // Map to response format, overriding `level` with the live computed tier + metrics.
    let items = filteredAgents.map((agent) => {
      const completedTours = toursByAgent.get(agent.id) ?? 0;
      const noLSAFRevenue = revenueByAgent.get(agent.id) ?? 0;
      const r = ratingByAgent.get(agent.id);
      const totalReviews = r?.count ?? 0;
      const overallRating = totalReviews > 0 ? Math.round((r!.sum) * 10) / 10 : null;
      const levelInfo = computeAgentLevel({ completedTours, noLSAFRevenue, overallRating, totalReviews }, tiers);
      return {
        ...formatAgentResponse(agent),
        level: levelInfo.level,
        completedTours,
        noLSAFRevenue,
        overallRating,
        totalReviews,
      };
    });

    // Tier filter (applied after the live computation, like the JSON filters above).
    if (level) {
      items = items.filter((it) => it.level === level);
    }

    // Adjust total count after in-memory filtering
    const filteredTotal = areasOfOperation || specializations || languages || level
      ? items.length
      : total;

    const response: PaginatedResponse<AgentResponse> = {
      page: pageNum,
      pageSize: pageSizeNum,
      total: filteredTotal,
      items,
    };

    sendSuccess(res, response);
  } catch (err: any) {
    console.error("[GET /admin/agents] Error:", err);
    sendError(res, 500, "Failed to fetch agents");
  }
});

// ============================================================
// POST /api/admin/agents/sync-tour-revenue
// Recalculate denormalized agent counters from TourBooking source-of-truth.
// ============================================================
router.post("/sync-tour-revenue", validate(syncTourRevenueSchema, "body"), async (req: any, res) => {
  try {
    const { dryRun } = req.validatedData;

    const [agents, grouped] = await Promise.all([
      prisma.agent.findMany({
        select: {
          id: true,
          totalCompletedTrips: true,
          totalRevenueGenerated: true,
        },
      }),
      prisma.tourBooking.groupBy({
        by: ["operatorAgentId"],
        where: {
          paymentStatus: {
            in: ["PAID", "APPROVED", "DISBURSED"],
          },
        },
        _count: {
          _all: true,
        },
        _sum: {
          grossAmount: true,
        },
      }),
    ]);

    const aggregateByAgentId = new Map<number, { trips: number; revenue: number }>();
    for (const row of grouped) {
      const agentId = Number((row as any).operatorAgentId);
      if (!Number.isFinite(agentId) || agentId <= 0) continue;
      aggregateByAgentId.set(agentId, {
        trips: Number((row as any)?._count?._all ?? 0),
        revenue: Number((row as any)?._sum?.grossAmount ?? 0),
      });
    }

    const changes: Array<{
      agentId: number;
      fromTrips: number;
      toTrips: number;
      fromRevenue: number;
      toRevenue: number;
    }> = [];

    for (const agent of agents) {
      const aggregate = aggregateByAgentId.get(agent.id) || { trips: 0, revenue: 0 };
      const fromTrips = Number(agent.totalCompletedTrips ?? 0);
      const fromRevenue = Number(agent.totalRevenueGenerated ?? 0);
      const toTrips = Number(aggregate.trips || 0);
      const toRevenue = Math.round(Number(aggregate.revenue || 0) * 100) / 100;

      if (fromTrips !== toTrips || Math.round(fromRevenue * 100) / 100 !== toRevenue) {
        changes.push({
          agentId: agent.id,
          fromTrips,
          toTrips,
          fromRevenue,
          toRevenue,
        });
      }
    }

    if (!dryRun) {
      for (const change of changes) {
        await prisma.agent.update({
          where: { id: change.agentId },
          data: {
            totalCompletedTrips: change.toTrips,
            totalRevenueGenerated: change.toRevenue as any,
          },
          select: { id: true },
        });
      }
    }

    try {
      await audit(
        req as AuthedRequest,
        "AGENT_TOUR_REVENUE_SYNC",
        "agents",
        null,
        {
          dryRun: Boolean(dryRun),
          scannedAgents: agents.length,
          changedAgents: changes.length,
          sampleChanges: changes.slice(0, 20),
        }
      );
    } catch {
      // best effort
    }

    return sendSuccess(
      res,
      {
        dryRun: Boolean(dryRun),
        scannedAgents: agents.length,
        changedAgents: changes.length,
        changes,
      },
      dryRun ? "Dry-run completed" : "Agent revenue metrics synchronized"
    );
  } catch (err: any) {
    console.error("[POST /admin/agents/sync-tour-revenue] Error:", err);
    return sendError(res, 500, "Failed to sync agent tour revenue metrics");
  }
});

// ============================================================
// GET /api/admin/agents/:id
// ============================================================
router.get("/:id", validate(getAgentParamsSchema, "params"), async (req: any, res) => {
  try {
    const { id } = req.validatedParams;

    const agent = await prisma.agent.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            fullName: true,
            email: true,
            phone: true,
            nationality: true,
            region: true,
            district: true,
            timezone: true,
            avatarUrl: true,
            createdAt: true,
          },
        },
        assignedPlanRequests: {
          select: {
            id: true,
            role: true,
            tripType: true,
            status: true,
            fullName: true,
            email: true,
            phone: true,
            dateFrom: true,
            dateTo: true,
            groupSize: true,
            budget: true,
            destinations: true,
            notes: true,
            adminResponse: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "desc" },
        },
        reviews: {
          select: {
            id: true,
            userId: true,
            planRequestId: true,
            punctualityRating: true,
            customerCareRating: true,
            communicationRating: true,
            comment: true,
            createdAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!agent) {
      return sendError(res, 404, "Agent not found");
    }

    // Calculate average ratings from all reviews
    const reviews = agent.reviews || [];
    let avgPunctualityRating = 0;
    let avgCustomerCareRating = 0;
    let avgCommunicationRating = 0;
    const totalReviews = reviews.length;

    if (totalReviews > 0) {
      const sumPunctuality = reviews.reduce((sum, review) => sum + (review.punctualityRating || 0), 0);
      const sumCustomerCare = reviews.reduce((sum, review) => sum + (review.customerCareRating || 0), 0);
      const sumCommunication = reviews.reduce((sum, review) => sum + (review.communicationRating || 0), 0);
      avgPunctualityRating = Math.round((sumPunctuality / totalReviews) * Math.pow(10, RATING_DECIMAL_PLACES)) / Math.pow(10, RATING_DECIMAL_PLACES);
      avgCustomerCareRating = Math.round((sumCustomerCare / totalReviews) * Math.pow(10, RATING_DECIMAL_PLACES)) / Math.pow(10, RATING_DECIMAL_PLACES);
      avgCommunicationRating = Math.round((sumCommunication / totalReviews) * Math.pow(10, RATING_DECIMAL_PLACES)) / Math.pow(10, RATING_DECIMAL_PLACES);
    }

    // Update performanceMetrics with calculated averages
    const performanceMetrics = (agent.performanceMetrics as any) || {};
    performanceMetrics.punctualityRating = avgPunctualityRating;
    performanceMetrics.customerCareRating = avgCustomerCareRating;
    performanceMetrics.communicationRating = avgCommunicationRating;
    performanceMetrics.totalReviews = totalReviews;

    // Get promotion thresholds and commission settings
    const systemSettings = await prisma.systemSetting.findUnique({ where: { id: 1 } });
    const maxTrips = systemSettings?.agentPromotionMaxTrips || DEFAULT_PROMOTION_MAX_TRIPS;
    const commissionPercent = systemSettings?.agentCommissionPercent || DEFAULT_COMMISSION_PERCENT;

    // Financial summary split:
    // - Gross/commission/net: from bookings as soon as bookings are made.
    // - Paid invoices: only invoices that are actually paid/disbursed.
    const paidInvoiceStatuses = ["PAID", "DISBURSED"];
    const [bookingRevenue, paidInvoicesCount, accommodationAccess, accommodationIdentity, approvedEvidenceCount] = await Promise.all([
      prisma.tourBooking.aggregate({
        where: { operatorAgentId: agent.id },
        _sum: {
          grossAmount: true,
          commissionAmount: true,
          operatorPayoutAmount: true,
        },
      }),
      prisma.invoice.count({
        where: {
          ownerId: agent.userId,
          status: { in: paidInvoiceStatuses },
        },
      }),
      prisma.userWorkspaceAccess.findUnique({
        where: { userId_workspace: { userId: agent.userId, workspace: "ACCOMMODATION" } },
        select: { status: true, grantedAt: true, expiresAt: true, statusReason: true },
      }),
      prisma.nrmsAgentAccount.findUnique({
        where: { primaryUserId: agent.userId },
        select: { id: true, status: true, verificationStatus: true },
      }),
      prisma.userDocument.count({
        where: { userId: agent.userId, status: "APPROVED", url: { not: null } },
      }),
    ]);

    const grossFromBookings = Number(bookingRevenue._sum.grossAmount ?? 0);
    const commissionFromBookings = Number(bookingRevenue._sum.commissionAmount ?? 0);
    const netFromBookingsRaw = Number(bookingRevenue._sum.operatorPayoutAmount ?? 0);
    const netFromBookings =
      netFromBookingsRaw > 0 ? netFromBookingsRaw : Math.max(0, grossFromBookings - commissionFromBookings);

    // Promotion progress — computed LIVE from tour-company activity (the same
    // source the operator dashboard uses), not the retired Plan-With-Us counters.
    const completedTours = await prisma.tourBooking.count({
      where: { operatorAgentId: agent.id, status: "COMPLETED" },
    });
    const currentTrips = completedTours;
    // Tour bookings are quoted in USD end-to-end, so commission is already USD.
    const currentRevenue = Math.round(Number(bookingRevenue._sum.commissionAmount ?? 0));
    const overallRating =
      totalReviews > 0
        ? Math.round(((avgPunctualityRating + avgCustomerCareRating + avgCommunicationRating) / 3) * Math.pow(10, RATING_DECIMAL_PLACES)) /
          Math.pow(10, RATING_DECIMAL_PLACES)
        : null;

    const tiers = resolveTierLadder((systemSettings as any)?.agentTierLadder);
    const levelInfo = computeAgentLevel({ completedTours, noLSAFRevenue: currentRevenue, overallRating, totalReviews }, tiers);
    performanceMetrics.overallRating = overallRating;

    const next = levelInfo.next;
    const tripsProgress = next ? next.progress.tours : 100;
    const revenueProgress = next ? next.progress.revenue : 100;
    const overallProgress = next ? next.progress.overall : 100;
    const eligibleForPromotion = !!next && next.met.tours && next.met.revenue && next.met.rating && next.met.reviews;

    const response: AgentResponse = {
      ...formatAgentResponse(agent),
      level: levelInfo.level,
      performanceMetrics,
      promotionProgress: {
        currentLevel: levelInfo.level,
        nextLevel: next?.level ?? null,
        benefits: levelInfo.benefits,
        currentTrips,
        minTrips: next?.requirements.tours ?? currentTrips,
        maxTrips,
        currentRevenue,
        minRevenue: next?.requirements.revenue ?? currentRevenue,
        // Tier revenue is NoLSAF commission, quoted in the configured commission
        // currency (USD by default) — see lib/agentLevel.ts. Surfaced so the UI
        // labels it correctly instead of assuming TZS.
        revenueCurrency: String(systemSettings?.agentCommissionCurrency || "USD"),
        currentRating: overallRating,
        minRating: next?.requirements.rating ?? null,
        currentReviews: totalReviews,
        minReviews: next?.requirements.reviews ?? null,
        ratingProgress: next ? next.progress.rating : 100,
        reviewsProgress: next ? next.progress.reviews : 100,
        tripsProgress,
        revenueProgress,
        overallProgress,
        eligibleForPromotion,
        criteriaMet: next?.met ?? null,
      },
      assignedPlanRequests: agent.assignedPlanRequests || [],
      reviews: reviews,
      financialSummary: {
        paidCount: paidInvoicesCount,
        grossSum: Math.round(grossFromBookings * 100) / 100,
        commissionSum: Math.round(commissionFromBookings * 100) / 100,
        netSum: Math.round(netFromBookings * 100) / 100,
        commissionPercent,
        currency: String(systemSettings?.agentCommissionCurrency || "USD"),
      },
      accommodationCapability: {
        workspace: "ACCOMMODATION",
        status: accommodationAccess?.status ?? null,
        grantedAt: accommodationAccess?.grantedAt ?? null,
        expiresAt: accommodationAccess?.expiresAt ?? null,
        statusReason: accommodationAccess?.statusReason ?? null,
        identity: accommodationIdentity,
        approvedEvidenceCount,
      },
    };

    sendSuccess(res, response);
  } catch (err: any) {
    console.error("[GET /admin/agents/:id] Error:", err);
    sendError(res, 500, "Failed to fetch agent");
  }
});

// ============================================================
// GET /api/admin/agents/:id/documents
// ============================================================
router.get("/:id/documents", validate(getAgentParamsSchema, "params"), async (req: any, res) => {
  try {
    const { id } = req.validatedParams;

    const agent = await prisma.agent.findUnique({
      where: { id: Number(id) },
      select: { id: true, userId: true },
    });

    if (!agent) return sendError(res, 404, "Agent not found");

    if (!(prisma as any).userDocument) {
      return sendSuccess(res, { documents: [] });
    }

    const documents = await prisma.userDocument.findMany({
      where: { userId: agent.userId },
      orderBy: { id: "desc" },
      take: 100,
      select: {
        id: true,
        userId: true,
        type: true,
        status: true,
        reason: true,
        url: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
      } as any,
    });

    return sendSuccess(res, { documents: documents.map((doc: any) => sanitizeUserDocument(doc, "AGENT")) });
  } catch (err: any) {
    console.error("[GET /admin/agents/:id/documents] Error:", err);
    return sendError(res, 500, "Failed to fetch agent documents");
  }
});

// ============================================================
// PATCH /api/admin/agents/:id/documents/:docId
// ============================================================
router.patch(
  "/:id/documents/:docId",
  validate(agentDocParamsSchema, "params"),
  validate(updateDocStatusSchema, "body"),
  async (req: any, res) => {
    try {
      const { id, docId } = req.validatedParams;
      const { status, reason } = req.validatedData;

      const agent = await prisma.agent.findUnique({
        where: { id: Number(id) },
        select: { id: true, userId: true },
      });
      if (!agent) return sendError(res, 404, "Agent not found");

      if (!(prisma as any).userDocument) {
        return sendError(res, 404, "Documents feature not enabled in this environment");
      }

      const existing = await prisma.userDocument.findUnique({ where: { id: Number(docId) } as any });
      if (!existing || (existing as any).userId !== agent.userId) {
        return sendError(res, 404, "Document not found");
      }

      const sanitizedReason =
        status === "REJECTED" ? sanitizeText(String(reason ?? "").trim()).slice(0, 2000) : null;

      const doc = await prisma.userDocument.update({
        where: { id: Number(docId) } as any,
        data: { status, reason: sanitizedReason || null } as any,
        select: {
          id: true,
          userId: true,
          type: true,
          status: true,
          reason: true,
          url: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        } as any,
      });

      try {
        await audit(req as AuthedRequest, "USER_DOCUMENT_STATUS_UPDATED", `user:${agent.userId}`, existing, {
          agentId: agent.id,
          docId,
          status,
          reason: sanitizedReason || null,
          type: (existing as any).type,
        });
      } catch {
        // ignore
      }

      return sendSuccess(res, { doc }, "Document updated");
    } catch (err: any) {
      console.error("[PATCH /admin/agents/:id/documents/:docId] Error:", err);
      return sendError(res, 500, "Failed to update document");
    }
  },
);

// ============================================================
// GET /api/admin/agents/:id/notes
// ============================================================
router.get("/:id/notes", validate(getAgentParamsSchema, "params"), async (req: any, res) => {
  try {
    const { id } = req.validatedParams;
    const agent = await prisma.agent.findUnique({ where: { id: Number(id) }, select: { id: true, userId: true } });
    if (!agent) return sendError(res, 404, "Agent not found");

    const notes = await prisma.adminNote.findMany({
      where: { ownerId: agent.userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        admin: { select: { id: true, name: true, fullName: true, email: true } },
      },
    } as any);

    return sendSuccess(res, { notes });
  } catch (err: any) {
    console.error("[GET /admin/agents/:id/notes] Error:", err);
    return sendError(res, 500, "Failed to fetch agent notes");
  }
});

// ============================================================
// POST /api/admin/agents/:id/notes
// ============================================================
router.post(
  "/:id/notes",
  validate(getAgentParamsSchema, "params"),
  validate(createAgentNoteSchema, "body"),
  async (req: any, res) => {
    try {
      const { id } = req.validatedParams;
      const { text } = req.validatedData;
      const adminId = getAdminId(req as AuthedRequest);

      const agent = await prisma.agent.findUnique({ where: { id: Number(id) }, select: { id: true, userId: true } });
      if (!agent) return sendError(res, 404, "Agent not found");

      const cleanText = sanitizeText(String(text || "")).trim();
      if (!cleanText) return sendError(res, 400, "Note required");

      const note = await prisma.adminNote.create({
        data: {
          ownerId: agent.userId,
          adminId,
          text: cleanText,
        },
      } as any);

      await prisma.adminAudit.create({
        data: {
          adminId,
          targetUserId: agent.userId,
          action: "ADD_NOTE",
          details: `Agent note added: ${cleanText.substring(0, 100)}${cleanText.length > 100 ? "..." : ""}`,
        },
      });
      await audit(req as AuthedRequest, "AGENT_NOTE_ADDED", `agent:${agent.id}`, null, {
        text: cleanText.substring(0, 300),
      });

      return sendSuccess(res, { note }, "Note added successfully");
    } catch (err: any) {
      console.error("[POST /admin/agents/:id/notes] Error:", err);
      return sendError(res, 500, "Failed to add agent note");
    }
  },
);

// ============================================================
// POST /api/admin/agents/:id/accommodation-capability
// Additive Phase-0 bridge: keep the AGENT role/dashboard, reuse approved KYC,
// and grant access to the established accommodation partner surface.
// ============================================================
router.post(
  "/:id/accommodation-capability",
  blockImpersonated as RequestHandler,
  validate(getAgentParamsSchema, "params"),
  validate(accommodationCapabilitySchema, "body"),
  async (req: any, res) => {
    try {
      const result = await prisma.$transaction((tx: any) => bridgeApprovedOperatorToAccommodation(tx, {
        agentId: Number(req.validatedParams.id),
        adminId: getAdminId(req as AuthedRequest),
        reason: req.validatedData.reason,
      }));
      if (!result.ok) {
        return sendError(res, result.reason === "NOT_FOUND" ? 404 : 409, result.message, { code: result.reason });
      }
      return sendSuccess(res, result, result.createdIdentity ? "Accommodation capability activated using approved operator KYC." : "Accommodation capability activated.", result.createdIdentity ? 201 : 200);
    } catch (err: any) {
      console.error("[POST /admin/agents/:id/accommodation-capability] Error:", err);
      return sendError(res, 500, "Accommodation capability could not be activated");
    }
  },
);

// ============================================================
// PATCH /api/admin/agents/:id/profile-review
// Approve or reject submitted operator profile.
// ============================================================
router.patch(
  "/:id/profile-review",
  validate(getAgentParamsSchema, "params"),
  validate(updateProfileReviewSchema, "body"),
  async (req: any, res) => {
    try {
      const { id } = req.validatedParams;
      const { status, reason } = req.validatedData;
      const adminId = getAdminId(req as AuthedRequest);

      const agent = await prisma.agent.findUnique({
        where: { id: Number(id) },
        select: {
          id: true,
          userId: true,
          operatorProfile: true,
          user: { select: { id: true, email: true, name: true, fullName: true, passwordHash: true } },
        },
      });
      if (!agent) return sendError(res, 404, "Agent not found");

      const cleanReason = sanitizeText(String(reason || "")).trim();
      const nowIso = new Date().toISOString();
      const currentProfile = agent.operatorProfile && typeof agent.operatorProfile === "object"
        ? { ...(agent.operatorProfile as Record<string, any>) }
        : {};

      currentProfile.review = {
        status,
        reason: cleanReason || null,
        reviewedAt: nowIso,
        reviewedByAdminId: adminId,
      };
      currentProfile.reviewStatus = status;
      currentProfile.reviewReason = cleanReason || null;
      currentProfile.reviewedAt = nowIso;
      currentProfile.reviewedByAdminId = adminId;

      // If approving, save a snapshot for future change detection
      if (status === "APPROVED") {
        // Remove review metadata from snapshot so we compare data cleanly
        const snapshot = { ...currentProfile };
        delete snapshot.review;
        delete snapshot.reviewStatus;
        delete snapshot.reviewReason;
        delete snapshot.reviewedAt;
        delete snapshot.reviewedByAdminId;
        currentProfile.approvedSnapshot = snapshot;
        currentProfile.approvedAt = nowIso;
      }

      const updated = await prisma.agent.update({
        where: { id: agent.id },
        data: { operatorProfile: currentProfile as any },
        select: { id: true, operatorProfile: true },
      });

      await prisma.adminAudit.create({
        data: {
          adminId,
          targetUserId: agent.userId,
          action: status === "APPROVED" ? "APPROVE_OPERATOR_PROFILE" : "REJECT_OPERATOR_PROFILE",
          details:
            status === "APPROVED"
              ? "Submitted operator profile approved"
              : `Submitted operator profile rejected${cleanReason ? `: ${cleanReason.substring(0, 300)}` : ""}`,
        },
      });

      await audit(
        req as AuthedRequest,
        status === "APPROVED" ? "OPERATOR_PROFILE_APPROVED" : "OPERATOR_PROFILE_REJECTED",
        `agent:${agent.id}`,
        null,
        {
          status,
          reason: cleanReason || null,
        },
      );

      // Notify the operator by email — this is their only signal that the
      // review happened, and (if they never finished onboarding) the only
      // way they can get a working password-setup link.
      const recipientEmail = agent.user?.email;
      if (recipientEmail) {
        try {
          const recipientName = agent.user?.fullName || agent.user?.name || "Operator";
          const companyName = typeof currentProfile.companyName === "string" ? currentProfile.companyName : undefined;
          const origin = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "http://localhost:3000";
          const portalUrl = `${origin}/account/agent`;
          const loginUrl = `${origin}/account/login`;

          let setupLink: string | undefined;
          let setupLinkExpiresHours: number | undefined;

          if (!agent.user?.passwordHash) {
            const raw = crypto.randomBytes(24).toString("hex");
            const hashed = crypto.createHash("sha256").update(raw).digest("hex");
            const expiresAt = Date.now() + 1000 * 60 * 60 * 72; // 72 hours

            await prisma.user.update({
              where: { id: agent.userId },
              data: {
                resetPasswordToken: hashed as any,
                resetPasswordExpires: new Date(expiresAt) as any,
              } as any,
            });

            const next = encodeURIComponent("/account/agent");
            const usernameParam = recipientEmail ? `&username=${encodeURIComponent(recipientEmail)}` : "";
            setupLink = `${origin}/account/reset-password?token=${raw}&id=${agent.userId}&next=${next}&reason=onboarding${usernameParam}`;
            setupLinkExpiresHours = 72;
          }

          const { subject, html } = status === "APPROVED"
            ? getOperatorProfileApprovedEmail({
                name: recipientName,
                companyName,
                portalUrl,
                loginUrl,
                setupLink,
                setupLinkExpiresHours,
                contactEmail: "partners@nolsaf.com",
              })
            : getOperatorProfileRejectedEmail({
                name: recipientName,
                companyName,
                reason: cleanReason || undefined,
                portalUrl,
                loginUrl,
                setupLink,
                setupLinkExpiresHours,
                contactEmail: "partners@nolsaf.com",
              });

          sendMail(recipientEmail, subject, html, undefined, { replyTo: "partners@nolsaf.com" }).catch((err: any) =>
            console.warn("[PROFILE_REVIEW] Notification email failed:", err?.message)
          );
        } catch (notifyErr: any) {
          console.warn("[PROFILE_REVIEW] Failed to prepare notification email:", notifyErr?.message);
        }
      } else {
        console.warn("[PROFILE_REVIEW] Skipping notification: agent has no email on file", { agentId: agent.id });
      }

      return sendSuccess(res, {
        review: (updated.operatorProfile as any)?.review || null,
      }, "Profile review updated");
    } catch (err: any) {
      console.error("[PATCH /admin/agents/:id/profile-review] Error:", err);
      return sendError(res, 500, "Failed to update profile review");
    }
  },
);

// ============================================================
// GET /api/admin/agents/:id/bookings
// Fetch assigned tour requests with monetized financial details.
// ============================================================
router.get(
  "/:id/bookings",
  validate(getAgentParamsSchema, "params"),
  async (req: any, res) => {
    try {
      const { id } = req.validatedParams;
      
      const agent = await prisma.agent.findUnique({ where: { id: Number(id) }, select: { id: true, userId: true } });
      if (!agent) return sendError(res, 404, "Agent not found");

      const page = Math.max(1, Number(req.query?.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query?.pageSize) || 25));
      const status = String(req.query?.status || "").trim();
      const search = sanitizeText(String(req.query?.search || "").trim());

      const planWhere: any = { assignedAgentId: agent.id };
      const tourWhere: any = { operatorAgentId: agent.id };
      if (search) {
        const maybeId = Number(search);
        planWhere.OR = [
          { fullName: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
          { destinations: { contains: search } },
          { tripType: { contains: search } },
          ...(Number.isInteger(maybeId) && maybeId > 0 ? [{ id: maybeId }] : []),
        ];
        tourWhere.OR = [
          { bookingCode: { contains: search } },
          { guestName: { contains: search } },
          { guestEmail: { contains: search } },
          { guestPhone: { contains: search } },
          { destination: { contains: search } },
          { title: { contains: search } },
          ...(Number.isInteger(maybeId) && maybeId > 0 ? [{ id: maybeId }] : []),
        ];
      }

      const settings = await prisma.systemSetting.findFirst({ select: { agentCommissionPercent: true } });
      const commissionPercent = Number(settings?.agentCommissionPercent ?? 15);

      const [planItems, tourItems] = await Promise.all([
        prisma.planRequest.findMany({
          where: planWhere,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            fullName: true,
            tripType: true,
            destinations: true,
            dateFrom: true,
            dateTo: true,
            budget: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.tourBooking.findMany({
          where: tourWhere,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            bookingCode: true,
            title: true,
            destination: true,
            startDate: true,
            endDate: true,
            guestName: true,
            grossAmount: true,
            commissionAmount: true,
            operatorPayoutAmount: true,
            metadata: true,
            status: true,
            createdAt: true,
          },
        }),
      ]);

      const normalizePlanStatus = (rawStatus: string) => {
        const s = String(rawStatus || "").toUpperCase();
        if (s === "COMPLETED" || s === "DONE" || s === "FINISHED") return "COMPLETED";
        if (s === "CANCELED" || s === "CANCELLED" || s === "REFUNDED" || s === "REJECTED") return "CANCELLED";
        if (s === "IN_PROGRESS" || s === "CONFIRMED" || s === "ACTIVE" || s === "ONGOING") return "IN_PROGRESS";
        if (s === "PENDING" || s === "REQUESTED" || s === "APPROVED" || s === "VERIFIED") return "PENDING";
        return "NEW";
      };

      const planBookings = planItems.map((item) => {
        const amount = item.budget != null ? Number(item.budget) : 0;
        const platformFee = amount > 0 ? Math.round((amount * commissionPercent) / 100) : 0;
        return {
          id: item.id,
          guestName: item.fullName,
          property: item.destinations || item.tripType || "Assigned tour request",
          checkIn: item.dateFrom,
          checkOut: item.dateTo,
          amount,
          platformFee,
          operatorPayout: Math.max(0, amount - platformFee),
          status: normalizePlanStatus(item.status),
          createdAt: item.createdAt,
        };
      });

      const normalizeTourStatus = (rawStatus: string, metadata: unknown) => {
        const s = String(rawStatus || "").toUpperCase();
        const md = metadata && typeof metadata === "object" ? (metadata as any) : null;
        const pickupValidated = Boolean(md?.pickupValidation?.validated);
        if (pickupValidated) return "IN_PROGRESS";
        if (s === "COMPLETED") return "COMPLETED";
        if (s === "CANCELED" || s === "CANCELLED" || s === "REFUNDED") return "CANCELLED";
        if (s === "CONFIRMED" || s === "IN_PROGRESS") return "IN_PROGRESS";
        if (s === "PENDING") return "PENDING";
        if (s === "PAID" || s === "PENDING_PAYMENT" || s === "UNPAID" || s === "NEW") return "NEW";
        return "NEW";
      };

      const tourBookings = tourItems.map((item) => ({
        id: item.id,
        guestName: item.guestName || "-",
        property: item.destination || item.title || item.bookingCode || "Tour booking",
        checkIn: item.startDate,
        checkOut: item.endDate,
        amount: Number(item.grossAmount || 0),
        platformFee: Number(item.commissionAmount || 0),
        operatorPayout: Number(item.operatorPayoutAmount || 0),
        status: normalizeTourStatus(item.status, item.metadata),
        createdAt: item.createdAt,
      }));

      const requestedStatus = String(status || "").trim().toUpperCase();
      const normalizedRequestedStatus = requestedStatus === "CANCELED" ? "CANCELLED" : requestedStatus;
      const combined = [...planBookings, ...tourBookings]
        .filter((row) => !normalizedRequestedStatus || normalizedRequestedStatus === "ALL" || row.status === normalizedRequestedStatus)
        .sort((a, b) => {
          const at = new Date(a.createdAt as any).getTime();
          const bt = new Date(b.createdAt as any).getTime();
          return bt - at;
        });

      const total = combined.length;
      const skip = (page - 1) * pageSize;
      const bookings = combined.slice(skip, skip + pageSize);

      return sendSuccess(res, { bookings, total, page, pageSize });
    } catch (err: any) {
      console.error("[GET /admin/agents/:id/bookings] Error:", err);
      return sendError(res, 500, "Failed to fetch agent bookings");
    }
  },
);

// ============================================================
// POST /api/admin/agents
// ============================================================
router.post("/", validate(createAgentSchema), async (req: any, res) => {
  const allowManual = String(process.env.ALLOW_MANUAL_AGENT_CREATION || "").toLowerCase() === "true";
  if (!allowManual) {
    return sendError(res, 410, "Manual agent creation is disabled. Hire agents via Careers job applications (set application status to HIRED).", {
      hint: "Use /api/admin/careers/applications/:id status=HIRED",
    });
  }

  try {
    const validatedData = req.validatedData;
    const adminId = getAdminId(req as AuthedRequest);

    // Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: validatedData.userId },
    });

    if (!user) {
      return sendError(res, 404, "User not found");
    }

    // Check if agent profile already exists
    const existingAgent = await prisma.agent.findUnique({
      where: { userId: validatedData.userId },
    });

    if (existingAgent) {
      return sendError(res, 400, "Agent profile already exists for this user");
    }

    // Prepare data for agent creation with sanitization
    const agentData: Prisma.AgentCreateInput = {
      user: { connect: { id: validatedData.userId } },
      status: validatedData.status || DEFAULT_AGENT_STATUS,
      educationLevel: validatedData.educationLevel || null,
      yearsOfExperience: validatedData.yearsOfExperience || null,
      bio: validatedData.bio ? sanitizeText(validatedData.bio) : null,
      maxActiveRequests: validatedData.maxActiveRequests || DEFAULT_MAX_ACTIVE_REQUESTS,
      isAvailable: validatedData.isAvailable !== undefined ? validatedData.isAvailable : true,
      currentActiveRequests: 0,
      areasOfOperation: validatedData.areasOfOperation && validatedData.areasOfOperation.length > 0
        ? validatedData.areasOfOperation.map((area: string) => sanitizeText(area))
        : null,
      certifications: validatedData.certifications && validatedData.certifications.length > 0
        ? validatedData.certifications.map((cert: any) => ({
            name: sanitizeText(cert.name),
            issuer: cert.issuer ? sanitizeText(cert.issuer) : undefined,
            year: cert.year,
            expiryDate: cert.expiryDate ? sanitizeText(cert.expiryDate) : undefined,
          }))
        : null,
      languages: validatedData.languages && validatedData.languages.length > 0
        ? validatedData.languages.map((lang: string) => sanitizeText(lang))
        : null,
      specializations: validatedData.specializations && validatedData.specializations.length > 0
        ? validatedData.specializations.map((spec: string) => sanitizeText(spec))
        : null,
    };

    // Use transaction to create agent and update user role
    const result = await prisma.$transaction(async (tx) => {
      // Update user role to AGENT if not already
      if (user.role !== "AGENT") {
        await tx.user.update({
          where: { id: validatedData.userId },
          data: { role: "AGENT" },
        });
      }

      // Create agent profile
      const agent = await tx.agent.create({
        data: agentData,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      return agent;
    });

    // Audit log
    await audit(req as AuthedRequest, "AGENT_CREATED", `agent:${result.id}`, null, {
      userId: validatedData.userId,
      status: result.status,
    });

    sendSuccess(res, formatAgentResponse(result), "Agent created successfully", 201);
  } catch (err: any) {
    console.error("[POST /admin/agents] Error:", err);
    if (err.code === "P2002") {
      return sendError(res, 400, "Agent profile already exists for this user");
    }
    sendError(res, 500, "Failed to create agent", { message: err.message });
  }
});

// ============================================================
// PATCH /api/admin/agents/:id
// ============================================================
router.patch("/:id", validate(getAgentParamsSchema, "params"), validate(updateAgentSchema, "body"), async (req: any, res) => {
  try {
    const { id } = req.validatedParams;
    const validatedData = req.validatedData;
    const adminId = getAdminId(req as AuthedRequest);

    // Get existing agent for audit
    const existingAgent = await prisma.agent.findUnique({
      where: { id: Number(id) },
    });

    if (!existingAgent) {
      return sendError(res, 404, "Agent not found");
    }

    // Prepare update data with sanitization
    const updateData: Prisma.AgentUpdateInput = {};

    if (validatedData.status !== undefined) updateData.status = validatedData.status;
    if (validatedData.educationLevel !== undefined) updateData.educationLevel = validatedData.educationLevel;
    if (validatedData.yearsOfExperience !== undefined) updateData.yearsOfExperience = validatedData.yearsOfExperience;
    if (validatedData.bio !== undefined) updateData.bio = validatedData.bio ? sanitizeText(validatedData.bio) : null;
    if (validatedData.isAvailable !== undefined) updateData.isAvailable = validatedData.isAvailable;
    if (validatedData.maxActiveRequests !== undefined) updateData.maxActiveRequests = validatedData.maxActiveRequests;

    // Handle JSON array fields
    if (validatedData.areasOfOperation !== undefined) {
      updateData.areasOfOperation = validatedData.areasOfOperation.length > 0
        ? validatedData.areasOfOperation.map((area: string) => sanitizeText(area))
        : null;
    }

    if (validatedData.certifications !== undefined) {
      updateData.certifications = validatedData.certifications.length > 0
        ? validatedData.certifications.map((cert: any) => ({
            name: sanitizeText(cert.name),
            issuer: cert.issuer ? sanitizeText(cert.issuer) : undefined,
            year: cert.year,
            expiryDate: cert.expiryDate ? sanitizeText(cert.expiryDate) : undefined,
          }))
        : null;
    }

    if (validatedData.languages !== undefined) {
      updateData.languages = validatedData.languages.length > 0
        ? validatedData.languages.map((lang: string) => sanitizeText(lang))
        : null;
    }

    if (validatedData.specializations !== undefined) {
      updateData.specializations = validatedData.specializations.length > 0
        ? validatedData.specializations.map((spec: string) => sanitizeText(spec))
        : null;
    }

    const agent = await prisma.agent.update({
      where: { id: Number(id) },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
    });

    // Audit log
    await audit(req as AuthedRequest, "AGENT_UPDATED", `agent:${agent.id}`, existingAgent, agent);

    sendSuccess(res, formatAgentResponse(agent), "Agent updated successfully");
  } catch (err: any) {
    console.error("[PATCH /admin/agents/:id] Error:", err);
    if (err.code === "P2025") {
      return sendError(res, 404, "Agent not found");
    }
    sendError(res, 500, "Failed to update agent");
  }
});

// ============================================================
// POST /api/admin/agents/:id/suspend
// Temporarily suspend an agent and send a notification email.
// ============================================================
router.post(
  "/:id/suspend",
  limitAgentSuspendRestore,
  validate(getAgentParamsSchema, "params"),
  async (req: any, res) => {
    try {
      const { id } = req.validatedParams;
      const agentId = Number(id);
      const adminId = getAdminId(req as AuthedRequest);

      const rawReason = String(req.body?.reason ?? "").trim();
      if (!rawReason || rawReason.length < 10)
        return sendError(res, 400, "Suspension reason must be at least 10 characters.");
      if (rawReason.length > 1000)
        return sendError(res, 400, "Suspension reason must not exceed 1000 characters.");
      const reason = sanitizeText(rawReason);

      const existing = await prisma.agent.findUnique({
        where: { id: agentId },
        include: { user: { select: { id: true, name: true, fullName: true, email: true } } },
      });
      if (!existing) return sendError(res, 404, "Agent not found");
      if (existing.status === "SUSPENDED") return sendError(res, 400, "Agent is already suspended.");

      const caseRef = `NOLS-AGT-${String(agentId).padStart(5, "0")}-${Date.now().toString(36).toUpperCase()}`;
      const now = new Date();

      const updated = await prisma.agent.update({
        where: { id: agentId },
        data: {
          status: "SUSPENDED",
          suspendedAt: now,
          suspensionReason: reason,
          suspendedBy: adminId,
        } as any,
        include: { user: { select: { id: true, name: true, fullName: true, email: true } } },
      });

      await audit(req as AuthedRequest, "AGENT_SUSPENDED", `agent:${agentId}`, existing, updated);
      await prisma.adminAudit.create({
        data: {
          adminId,
          targetUserId: existing.userId,
          action: "AGENT_SUSPEND",
          details: { reason, caseRef },
        },
      });
      await revokeUserAuthorization(existing.userId);

      // Non-blocking notification email
      const recipientEmail = (updated as any).user?.email;
      if (recipientEmail) {
        const recipientName = (updated as any).user?.fullName || (updated as any).user?.name || "Agent";
        const { subject, html } = getAgentSuspensionEmail({
          name: recipientName,
          reason,
          caseRef,
          suspendedAt: now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }),
          contactEmail: "hr@nolsaf.com",
        });
        sendMail(recipientEmail, subject, html, undefined, { replyTo: "hr@nolsaf.com" }).catch((err: any) =>
          console.warn("[SUSPEND] Suspension email failed:", err?.message)
        );
      }

      return sendSuccess(res, { agentId, caseRef, status: "SUSPENDED" }, "Agent suspended successfully.");
    } catch (err: any) {
      console.error("[POST /admin/agents/:id/suspend] Error:", err);
      sendError(res, 500, "Failed to suspend agent.");
    }
  }
);

// ============================================================
// POST /api/admin/agents/:id/restore
// Reinstate a suspended agent and send a notification email.
// ============================================================
router.post(
  "/:id/restore",
  limitAgentSuspendRestore,
  validate(getAgentParamsSchema, "params"),
  async (req: any, res) => {
    try {
      const { id } = req.validatedParams;
      const agentId = Number(id);
      const adminId = getAdminId(req as AuthedRequest);

      const rawNotes = String(req.body?.notes ?? "").trim();
      const notes = rawNotes ? sanitizeText(rawNotes) : undefined;

      const existing = await prisma.agent.findUnique({
        where: { id: agentId },
        include: { user: { select: { id: true, name: true, fullName: true, email: true } } },
      });
      if (!existing) return sendError(res, 404, "Agent not found");
      if (existing.status !== "SUSPENDED") return sendError(res, 400, "Agent is not currently suspended.");

      // Reconstruct the case reference from the stored suspension timestamp for continuity
      const storedAt = (existing as any).suspendedAt as Date | null;
      const caseRef = storedAt
        ? `NOLS-AGT-${String(agentId).padStart(5, "0")}-${storedAt.getTime().toString(36).toUpperCase()}`
        : `NOLS-AGT-${String(agentId).padStart(5, "0")}-RESTORED`;

      const now = new Date();

      const updated = await prisma.agent.update({
        where: { id: agentId },
        data: {
          status: "ACTIVE",
          suspendedAt: null,
          suspensionReason: null,
          suspendedBy: null,
          restoredAt: now,
          restoredBy: adminId,
        } as any,
        include: { user: { select: { id: true, name: true, fullName: true, email: true } } },
      });

      await audit(req as AuthedRequest, "AGENT_RESTORED", `agent:${agentId}`, existing, updated);
      await prisma.adminAudit.create({
        data: {
          adminId,
          targetUserId: existing.userId,
          action: "AGENT_RESTORE",
          details: { notes: notes || null, caseRef },
        },
      });

      // Non-blocking notification email
      const recipientEmail = (updated as any).user?.email;
      if (recipientEmail) {
        const recipientName = (updated as any).user?.fullName || (updated as any).user?.name || "Agent";
        const { subject, html } = getAgentRestorationEmail({
          name: recipientName,
          caseRef,
          restoredAt: now.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" }),
          notes,
          contactEmail: "hr@nolsaf.com",
        });
        sendMail(recipientEmail, subject, html, undefined, { replyTo: "hr@nolsaf.com" }).catch((err: any) =>
          console.warn("[RESTORE] Restoration email failed:", err?.message)
        );
      }

      return sendSuccess(res, { agentId, caseRef, status: "ACTIVE" }, "Agent access reinstated successfully.");
    } catch (err: any) {
      console.error("[POST /admin/agents/:id/restore] Error:", err);
      sendError(res, 500, "Failed to restore agent.");
    }
  }
);

// ============================================================
// POST /api/admin/agents/:id/impersonate
// Issue a short-lived AGENT JWT for support troubleshooting.
// ============================================================
router.post(
  "/:id/impersonate",
  limitAgentSuspendRestore,
  validate(getAgentParamsSchema, "params"),
  async (req: any, res) => {
    try {
      const { id } = req.validatedParams;
      const agentId = Number(id);

      const rawReason = String(req.body?.reason ?? "").trim();
      if (!rawReason || rawReason.length < 10) {
        return sendError(res, 400, "Impersonation reason must be at least 10 characters.");
      }
      if (rawReason.length > 1000) {
        return sendError(res, 400, "Impersonation reason must not exceed 1000 characters.");
      }
      const reason = sanitizeText(rawReason);

      const agent = await prisma.agent.findUnique({ where: { id: agentId }, select: { id: true, userId: true } });
      if (!agent) return sendError(res, 404, "Agent not found");

      const ttlSec = 10 * 60;
      const token = await signUserJwt(
        { id: agent.userId, role: "AGENT" },
        { impersonated: true, expiresInSeconds: ttlSec },
      );

      await audit(req as AuthedRequest, "AGENT_IMPERSONATE_ISSUE", `agent:${agentId}`, { reason }, { ttlSec });
      await prisma.adminAudit.create({
        data: {
          adminId: getAdminId(req as AuthedRequest),
          targetUserId: agent.userId,
          action: "AGENT_IMPERSONATE_ISSUE",
          details: reason,
        },
      });

      return sendSuccess(res, { token, expiresIn: ttlSec }, "Impersonation token issued.");
    } catch (err: any) {
      console.error("[POST /admin/agents/:id/impersonate] Error:", err);
      sendError(res, 500, "Failed to issue impersonation token.");
    }
  }
);

// ============================================================
// POST /api/admin/agents/:id/assign-to-request
// ============================================================
router.post("/:id/assign-to-request", validate(getAgentParamsSchema, "params"), validate(assignAgentSchema, "body"), async (req: any, res) => {
  try {
    const { id } = req.validatedParams;
    const { planRequestId } = req.validatedData;
    const adminId = getAdminId(req as AuthedRequest);

    const agentId = Number(id);

    // Use transaction for atomic assignment
    const result = await prisma.$transaction(async (tx) => {
      // Check if agent exists and is available
      const agent = await tx.agent.findUnique({
        where: { id: agentId },
        include: {
          user: {
            select: {
              name: true,
            },
          },
        },
      });

      if (!agent) {
        throw new Error("Agent not found");
      }

      if (!agent.isAvailable) {
        throw new Error("Agent is not available");
      }

      if (agent.currentActiveRequests >= agent.maxActiveRequests) {
        throw new Error("Agent has reached maximum active requests");
      }

      // Check if plan request exists
      const planRequest = await tx.planRequest.findUnique({
        where: { id: planRequestId },
      });

      if (!planRequest) {
        throw new Error("Plan request not found");
      }

      // Update plan request with agent assignment
      await tx.planRequest.update({
        where: { id: planRequestId },
        data: {
          assignedAgentId: agentId,
          assignedAgent: agent.user?.name || null, // Keep legacy field updated
        },
      });

      // Update agent's current active requests count
      const updatedAgent = await tx.agent.update({
        where: { id: agentId },
        data: {
          currentActiveRequests: agent.currentActiveRequests + 1,
        },
      });

      return { agentId, planRequestId, agentName: agent.user?.name };
    });

    // Audit log
    await audit(req as AuthedRequest, "AGENT_ASSIGNED", `agent:${result.agentId}`, null, {
      planRequestId: result.planRequestId,
      agentName: result.agentName,
    });

    sendSuccess(res, {
      success: true,
      message: "Agent assigned successfully",
      agentId: result.agentId,
      planRequestId: result.planRequestId,
    });
  } catch (err: any) {
    console.error("[POST /admin/agents/:id/assign-to-request] Error:", err);
    if (err.message === "Agent not found") {
      return sendError(res, 404, "Agent not found");
    }
    if (err.message === "Plan request not found") {
      return sendError(res, 404, "Plan request not found");
    }
    if (err.message === "Agent is not available") {
      return sendError(res, 400, "Agent is not available");
    }
    if (err.message === "Agent has reached maximum active requests") {
      return sendError(res, 400, "Agent has reached maximum active requests");
    }
    sendError(res, 500, "Failed to assign agent");
  }
});

export default router;
