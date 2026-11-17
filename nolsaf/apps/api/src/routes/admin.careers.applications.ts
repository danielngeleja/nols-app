// apps/api/src/routes/admin.careers.applications.ts
import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { audit } from "../lib/audit.js";
import crypto from "crypto";
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { sendMail } from "../lib/mailer.js";
import { generateApplicationStatusEmail, getApplicationEmailSubject } from "../lib/careersEmailTemplates.js";
import { buildOperatorProfileSeed, mergeOperatorProfileSeed } from "../lib/operatorProfileSeed.js";
import {
  buildContractWorkflowSeed,
  readContractWorkflow,
  toYmd,
  withContractWorkflow,
  type AgentContractWorkflow,
} from "../lib/agentContractWorkflow.js";
import { effectiveOperatorContractVersion } from "../lib/operatorContract.js";
import { notifyUser } from "../lib/notifications.js";
import { ONBOARDING_SETUP_HOURS, issuePasswordSetupToken, passwordSetupLink } from "../lib/passwordSetupLink.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireAdmin as RequestHandler);

function buildWorkflowForApplication(agentId: number, application: Record<string, any>): AgentContractWorkflow {
  const hiredDate =
    toYmd(application?.reviewedAt || application?.submittedAt || application?.updatedAt || new Date()) ||
    toYmd(new Date());
  return buildContractWorkflowSeed({ agentId, hiredDate });
}

async function persistAgentWorkflow(agentId: number, operatorProfile: unknown, workflow: AgentContractWorkflow) {
  const nextProfile = withContractWorkflow(operatorProfile, workflow);
  await prisma.agent.update({
    where: { id: agentId },
    data: { operatorProfile: nextProfile as any },
    select: { id: true },
  });
  return nextProfile;
}

function parseAuditJson(value: unknown): Record<string, any> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function extractApplicationIdFromAuditRow(row: any): number | null {
  const direct = Number((row as any)?.entityId);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const before = parseAuditJson((row as any)?.beforeJson);
  const after = parseAuditJson((row as any)?.afterJson);

  const candidates = [
    Number(before?.id),
    Number(after?.id),
    Number(before?.applicationId),
    Number(after?.applicationId),
  ];

  for (const candidate of candidates) {
    if (Number.isFinite(candidate) && candidate > 0) return candidate;
  }

  return null;
}

function hasPartnershipProfile(application: any): boolean {
  const agentData = application?.agentApplicationData;
  if (!agentData || typeof agentData !== "object" || Array.isArray(agentData)) return false;

  const profile = (agentData as any).partnershipProfile;
  return Boolean(profile && typeof profile === "object" && !Array.isArray(profile));
}

function isPartnershipApplication(application: any): boolean {
  return Boolean(
    application?.job?.isTravelAgentPosition ||
    application?.agentId ||
    application?.agent?.id ||
    hasPartnershipProfile(application)
  );
}

/**
 * GET /admin/careers/applications
 * Get all job applications with optional filtering
 */
router.get("/", async (req, res) => {
  try {
    const { 
      jobId, 
      status, 
      email,
      page = "1", 
      pageSize = "50" 
    } = req.query;
    
    const pageNum = parseInt(page as string, 10) || 1;
    const size = parseInt(pageSize as string, 10) || 50;
    const skip = (pageNum - 1) * size;

    const where: any = {};
    
    if (jobId) {
      const parsedJobId = parseInt(jobId as string, 10);
      if (!isNaN(parsedJobId)) {
        where.jobId = parsedJobId;
      }
    }
    if (status) where.status = status;
    if (email) {
      // MySQL doesn't support case-insensitive mode, use contains for case-sensitive search
      where.email = { contains: email as string };
    }
    
    // Search by applicant name
    const { search } = req.query;
    if (search) {
      where.OR = [
        { fullName: { contains: search as string } },
        { email: { contains: search as string } },
        { phone: { contains: search as string } }
      ];
    }

    const [applications, total] = await Promise.all([
      prisma.jobApplication.findMany({
        where,
        orderBy: { submittedAt: "desc" },
        skip,
        take: size,
        include: {
          job: {
            select: {
              id: true,
              title: true,
              department: true,
              status: true
            }
          },
          reviewedByUser: {
            select: { id: true, name: true, email: true }
          },
          agent: {
            select: {
              id: true,
              userId: true,
              status: true
            }
          }
        }
      }),
      prisma.jobApplication.count({ where })
    ]);

    return res.json({
      applications,
      total,
      page: pageNum,
      pageSize: size,
      totalPages: Math.ceil(total / size)
    });
  } catch (error: any) {
    console.error("Error fetching applications:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      name: error.name,
      stack: error.stack
    });
    
    // Check if it's a Prisma schema mismatch error
    if (error.message?.includes('jobApplication') || error.message?.includes('JobApplication') || error.code === 'P2021' || error.code === 'P2022') {
      return res.status(500).json({ 
        error: "Database schema not updated. Please restart the server after running 'npx prisma generate'.",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    return res.status(500).json({ 
      error: "Failed to fetch applications",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /admin/careers/applications/:id/resume
 * Get presigned URL for viewing/downloading resume
 * This route must come before /:id to avoid route conflicts
 */
router.get("/:id/resume", async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    
    const application = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        resumeStorageKey: true,
        resumeUrl: true,
        resumeFileName: true
      }
    });

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    if (!application.resumeStorageKey && !application.resumeUrl) {
      return res.status(404).json({ error: "Resume not available" });
    }

    // If resumeUrl is already a public HTTP/HTTPS URL, return it directly
    if (application.resumeUrl && (application.resumeUrl.startsWith('http://') || application.resumeUrl.startsWith('https://'))) {
      return res.json({ url: application.resumeUrl });
    }

    // Generate presigned URL from S3 storage key
    // Priority: use resumeStorageKey if available, otherwise try to extract from resumeUrl (s3:// format)
    const storageKey = application.resumeStorageKey || (application.resumeUrl?.startsWith('s3://') 
      ? application.resumeUrl.replace(/^s3:\/\/[^/]+\//, '') 
      : null);

    if (storageKey) {
      const s3BucketName = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET;
      if (s3BucketName && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
        try {
          const s3Client = new S3Client({
            region: process.env.AWS_REGION || 'us-east-1',
            credentials: {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            },
          });

          const command = new GetObjectCommand({
            Bucket: s3BucketName,
            Key: storageKey,
          });

          // Work around occasional AWS SDK v3 type mismatches caused by duplicate Smithy client types.
          // This does not affect runtime behavior.
          const presignedUrl = await getSignedUrl(s3Client as any, command as any, { expiresIn: 3600 }); // 1 hour expiry
          return res.json({ url: presignedUrl });
        } catch (s3Error: any) {
          console.error("Error generating presigned URL:", s3Error);
          console.error("S3 Error details:", {
            message: s3Error.message,
            code: s3Error.code,
            name: s3Error.name,
            storageKey,
            bucket: s3BucketName
          });
          return res.status(500).json({ 
            error: "Failed to generate resume URL. Please check S3 configuration.",
            details: process.env.NODE_ENV === 'development' ? s3Error.message : undefined
          });
        }
      } else {
        // S3 credentials not configured
        console.warn("S3 credentials not configured for resume access");
        return res.status(500).json({ 
          error: "S3 storage not configured. Cannot generate resume URL.",
          details: process.env.NODE_ENV === 'development' ? "AWS credentials missing" : undefined
        });
      }
    }

    // Final fallback: return the stored URL if available (even if it's s3:// format, let frontend handle it)
    if (application.resumeUrl) {
      return res.json({ url: application.resumeUrl });
    }

    return res.status(404).json({ error: "Resume URL not available" });
  } catch (error: any) {
    console.error("Error fetching resume URL:", error);
    return res.status(500).json({ 
      error: "Failed to fetch resume URL",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /admin/careers/applications/:id/audit-timeline
 * Return recent legal-traceability events for a specific application.
 */
router.get("/:id/audit-timeline", async (req, res) => {
  try {
    const parsedId = parseInt(req.params.id, 10);
    if (isNaN(parsedId)) return res.status(400).json({ error: "Invalid application ID" });

    const application = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      select: { id: true },
    });
    if (!application) return res.status(404).json({ error: "Application not found" });

    const focused = await prisma.auditLog.findMany({
      where: {
        entity: "JOB_APPLICATION",
        entityId: parsedId,
      } as any,
      orderBy: { id: "desc" },
      take: 50,
      select: {
        id: true,
        action: true,
        createdAt: true,
        actorId: true,
        actorRole: true,
        beforeJson: true,
        afterJson: true,
        actor: {
          select: {
            id: true,
            name: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    let rows = focused;
    if (rows.length === 0) {
      const fallback = await prisma.auditLog.findMany({
        where: {
          entity: "JOB_APPLICATION",
        } as any,
        orderBy: { id: "desc" },
        take: 300,
        select: {
          id: true,
          action: true,
          createdAt: true,
          actorId: true,
          actorRole: true,
          beforeJson: true,
          afterJson: true,
          actor: {
            select: {
              id: true,
              name: true,
              fullName: true,
              email: true,
            },
          },
        },
      });
      rows = fallback.filter((row: any) => extractApplicationIdFromAuditRow(row) === parsedId).slice(0, 50);
    }

    const items = rows.map((row: any) => {
      const before = parseAuditJson(row.beforeJson);
      const after = parseAuditJson(row.afterJson);
      const actorName = row.actor?.fullName || row.actor?.name || row.actor?.email || (row.actorId ? `User #${row.actorId}` : "System");
      return {
        id: Number(row.id),
        action: String(row.action || ""),
        createdAt: row.createdAt,
        actorId: row.actorId ?? null,
        actorRole: row.actorRole ?? null,
        actorName,
        before,
        after,
      };
    });

    return res.json({
      ok: true,
      applicationId: parsedId,
      items,
    });
  } catch (error: any) {
    console.error("Error fetching application audit timeline:", error);
    return res.status(500).json({ error: "Failed to fetch application audit timeline" });
  }
});

/**
 * GET /admin/careers/applications/:id/contract/workflow
 * Return contract workflow state for hired agent applications.
 */
router.get("/:id/contract/workflow", async (req, res) => {
  try {
    const parsedId = parseInt(req.params.id, 10);
    if (isNaN(parsedId)) return res.status(400).json({ error: "Invalid application ID" });

    const application = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        status: true,
        reviewedAt: true,
        submittedAt: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            operatorProfile: true,
          },
        },
      },
    });

    if (!application) return res.status(404).json({ error: "Application not found" });
    if (!application.agent) return res.status(404).json({ error: "Agent profile not linked yet" });

    const workflow = readContractWorkflow(application.agent.operatorProfile);
    return res.json({
      ok: true,
      applicationId: application.id,
      status: application.status,
      workflow,
    });
  } catch (error: any) {
    console.error("Error fetching contract workflow:", error);
    return res.status(500).json({ error: "Failed to fetch contract workflow" });
  }
});

/**
 * POST /admin/careers/applications/:id/contract/prepare
 * Ensure a contract workflow exists once an application is HIRED.
 */
router.post("/:id/contract/prepare", async (req: any, res) => {
  try {
    const parsedId = parseInt(req.params.id, 10);
    if (isNaN(parsedId)) return res.status(400).json({ error: "Invalid application ID" });

    const application = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        status: true,
        reviewedAt: true,
        submittedAt: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            operatorProfile: true,
          },
        },
      },
    });

    if (!application) return res.status(404).json({ error: "Application not found" });
    if (String(application.status || "").toUpperCase() !== "HIRED") {
      return res.status(409).json({
        error: "CONTRACT_REQUIRES_HIRED_STATUS",
        message: "Contract workflow can only be prepared after the application is approved.",
      });
    }
    if (!application.agent) return res.status(404).json({ error: "Agent profile not linked yet" });

    const existing = readContractWorkflow(application.agent.operatorProfile);
    if (existing) {
      return res.json({ ok: true, workflow: existing, message: "Contract workflow already prepared." });
    }

    const seeded = buildWorkflowForApplication(application.agent.id, application as any);
    await persistAgentWorkflow(application.agent.id, application.agent.operatorProfile, seeded);

    await audit(req, "ADMIN_AGENT_CONTRACT_PREPARED", "JOB_APPLICATION", null, {
      applicationId: application.id,
      workflow: seeded,
    });

    return res.json({ ok: true, workflow: seeded });
  } catch (error: any) {
    console.error("Error preparing contract workflow:", error);
    return res.status(500).json({ error: "Failed to prepare contract workflow" });
  }
});

/**
 * POST /admin/careers/applications/:id/contract/sign
 * Admin signature step prior to agent countersignature.
 */
router.post("/:id/contract/sign", async (req: any, res) => {
  try {
    const parsedId = parseInt(req.params.id, 10);
    if (isNaN(parsedId)) return res.status(400).json({ error: "Invalid application ID" });

    const application = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      select: {
        id: true,
        status: true,
        reviewedAt: true,
        submittedAt: true,
        updatedAt: true,
        agent: {
          select: {
            id: true,
            userId: true,
            operatorProfile: true,
          },
        },
      },
    });

    if (!application) return res.status(404).json({ error: "Application not found" });
    if (String(application.status || "").toUpperCase() !== "HIRED") {
      return res.status(409).json({
        error: "CONTRACT_REQUIRES_HIRED_STATUS",
        message: "Contract can only be signed once the application is approved.",
      });
    }
    if (!application.agent) return res.status(404).json({ error: "Agent profile not linked yet" });

    const existing =
      readContractWorkflow(application.agent.operatorProfile) ||
      buildWorkflowForApplication(application.agent.id, application as any);

    if (existing.status === "EXECUTED") {
      return res.json({ ok: true, workflow: existing, message: "Contract already executed." });
    }

    const adminUser = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, fullName: true, name: true },
    });

    const nowIso = new Date().toISOString();
    const nextWorkflow: AgentContractWorkflow = {
      ...existing,
      // NoLSAF signs the current text; from here the version is fixed for both parties.
      version: effectiveOperatorContractVersion(existing),
      status: "PENDING_AGENT_SIGNATURE",
      nolsafSignedAt: nowIso,
      sentAt: nowIso,
      nolsafSignedByUserId: Number(req.user!.id),
      nolsafSignatoryName: String(
        process.env.CONTRACT_NOLSAF_SIGNATORY_NAME || adminUser?.fullName || adminUser?.name || "NoLSAF Admin"
      ).trim(),
      nolsafSignatoryTitle: String(process.env.CONTRACT_NOLSAF_SIGNATORY_TITLE || "NoLSAF Representative").trim(),
    };

    await persistAgentWorkflow(application.agent.id, application.agent.operatorProfile, nextWorkflow);

    await audit(req, "ADMIN_AGENT_CONTRACT_SIGNED", "JOB_APPLICATION", null, {
      applicationId: application.id,
      workflow: nextWorkflow,
    });

    // The operator's turn: their inbox links straight to the agreement to sign.
    if ((application.agent as any).userId) {
      await notifyUser((application.agent as any).userId, "agent_contract_ready", { version: nextWorkflow.version }).catch(() => undefined);
    }

    return res.json({ ok: true, workflow: nextWorkflow });
  } catch (error: any) {
    console.error("Error signing contract workflow:", error);
    return res.status(500).json({ error: "Failed to sign contract workflow" });
  }
});

/**
 * GET /admin/careers/applications/:id
 * Get a single application by ID
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    
    const application = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            department: true,
            category: true,
            type: true,
            location: true,
            status: true
          }
        },
        reviewedByUser: {
          select: { id: true, name: true, email: true }
        },
        agent: {
          select: {
            id: true,
            userId: true,
            status: true,
            isAvailable: true
          }
        }
      }
    });

    if (!application) {
      return res.status(404).json({ error: "Application not found" });
    }

    return res.json(application);
  } catch (error: any) {
    console.error("Error fetching application:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      name: error.name
    });
    
    if (error.message?.includes('jobApplication') || error.message?.includes('JobApplication') || error.code === 'P2021' || error.code === 'P2022') {
      return res.status(500).json({ 
        error: "Database schema not updated. Please restart the server after running 'npx prisma generate'.",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    return res.status(500).json({ 
      error: "Failed to fetch application",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * PATCH /admin/careers/applications/:id
 * Update application status and notes
 */
router.patch("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    
    const { status, adminNotes } = req.body;

    const existingApplication = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      include: {
        job: true,
        agent: { select: { id: true, userId: true } },
      },
    });

    if (!existingApplication) {
      return res.status(404).json({ error: "Application not found" });
    }

    const updateData: any = {};
    let statusChanged = false;
    let newStatus: string | null = null;
    
    if (status) {
      const validStatuses = ["PENDING", "REVIEWING", "SHORTLISTED", "REJECTED", "HIRED"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const isFinalized = existingApplication.status === "HIRED" || existingApplication.status === "REJECTED";
      if (isFinalized && existingApplication.status !== status) {
        return res.status(409).json({ error: "Application is finalized and cannot be changed" });
      }
      
      // Check if status is actually changing
      statusChanged = existingApplication.status !== status;
      newStatus = status;

      if (statusChanged) {
        updateData.status = status;

        // Track used statuses to prevent duplicate status changes
        const usedStatuses: string[] = Array.isArray(existingApplication.usedStatuses)
          ? [...(existingApplication.usedStatuses as string[])]
          : [];

        // Add current status to used statuses if not already there
        if (existingApplication.status && !usedStatuses.includes(existingApplication.status)) {
          usedStatuses.push(existingApplication.status);
        }

        // Add new status to used statuses if not already there
        if (status && !usedStatuses.includes(status)) {
          usedStatuses.push(status);
        }

        updateData.usedStatuses = usedStatuses;

        // If status is being changed from PENDING, mark as reviewed
        if (status !== "PENDING" && !existingApplication.reviewedAt) {
          updateData.reviewedAt = new Date();
          updateData.reviewedBy = (req as any).user?.id;
        }
      }
    }
    
    if (adminNotes !== undefined) {
      updateData.adminNotes = adminNotes;
    }

    // A hire attaches the applicant to a user account and emails that account a
    // password link. The applicant typed their email and phone, and neither was
    // verified, so (a) only the email may pick an existing account, never the
    // phone, and (b) an account that already works as an owner, driver or admin
    // is never turned into an operator here. Refuse before anything is saved.
    if (statusChanged && newStatus === "HIRED" && isPartnershipApplication(existingApplication) && !(existingApplication as any).agent?.userId) {
      const hireEmail = String(existingApplication.email || "").trim().toLowerCase();
      const hirePhone = String(existingApplication.phone || "").trim();
      if (!hireEmail) {
        return res.status(409).json({
          error: "HIRE_NEEDS_EMAIL",
          message: "This applicant has no email address. The operator account and its password link go to an email, so add one before hiring.",
        });
      }
      const byEmail = await prisma.user.findFirst({ where: { email: hireEmail }, select: { id: true, role: true } });
      const blockedRole = byEmail && !["CUSTOMER", "USER", "AGENT"].includes(String(byEmail.role || "").toUpperCase());
      if (blockedRole) {
        return res.status(409).json({
          error: "HIRE_EMAIL_BELONGS_TO_OTHER_ROLE",
          message: `${hireEmail} already belongs to a NoLSAF ${String(byEmail!.role).toLowerCase()} account. Operators need their own account: ask the applicant for a different email.`,
        });
      }
      if (hirePhone && !byEmail) {
        const byPhone = await prisma.user.findFirst({ where: { phone: hirePhone }, select: { id: true } });
        if (byPhone) {
          return res.status(409).json({
            error: "HIRE_PHONE_BELONGS_TO_OTHER_ACCOUNT",
            message: "The applicant's phone number is already used by another NoLSAF account with a different email. Confirm the applicant's details before hiring.",
          });
        }
      }
    }

    if (Object.keys(updateData).length === 0) {
      const currentApplication = await prisma.jobApplication.findUnique({
        where: { id: parsedId },
        include: {
          job: {
            select: {
              id: true,
              title: true,
              department: true
            }
          },
          reviewedByUser: {
            select: { id: true, name: true, email: true }
          }
        }
      });
      return res.json(currentApplication);
    }

    const updatedApplication = await prisma.jobApplication.update({
      where: { id: parsedId },
      data: updateData,
      include: {
        job: {
          select: {
            id: true,
            title: true,
            department: true,
            isTravelAgentPosition: true
          }
        },
        reviewedByUser: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    // If status changed to HIRED, provision/link Agent profile from the job application.
    // This is the only supported recruitment method for agents.
    if (statusChanged && newStatus === "HIRED") {
      try {
        if (existingApplication.agentId && (existingApplication as any).agent?.userId) {
          // Already correctly linked — populate _hiredUserId so Path 2 token generation
          // works without needing fallback DB lookups.
          const linkedAgent = (existingApplication as any).agent;
          (req as any)._hiredUserId   = linkedAgent.userId;
          (req as any)._hiredUsername = String(existingApplication.email || (existingApplication as any).phone || "").trim().toLowerCase();
          console.log(`[CAREERS_HIRED] Application ${parsedId} already linked to Agent ${linkedAgent.id} (User ${linkedAgent.userId}) — skipping re-provision`);

          // Best-effort: sync nationality/region/district from the application to the user
          // in case they were missing at the time of initial provisioning.
          try {
            const agentDataForSync = (existingApplication.agentApplicationData ?? {}) as any;
            const appNationality = typeof (existingApplication as any).nationality === "string" && String((existingApplication as any).nationality).trim()
              ? String((existingApplication as any).nationality).trim()
              : (typeof agentDataForSync.nationality === "string" ? String(agentDataForSync.nationality).trim() : "");
            const appRegion   = typeof (existingApplication as any).region    === "string" ? String((existingApplication as any).region).trim()    : "";
            const appDistrict = typeof (existingApplication as any).district  === "string" ? String((existingApplication as any).district).trim()  : "";
            const appFullName = typeof (existingApplication as any).fullName  === "string" ? String((existingApplication as any).fullName).trim()  : "";

            if (appNationality || appRegion || appDistrict || appFullName) {
              const existingUser = await prisma.user.findUnique({
                where: { id: linkedAgent.userId },
                select: { nationality: true, region: true, district: true, fullName: true } as any,
              });
              const syncUpdate: Record<string, string> = {};
              if (!(existingUser as any)?.nationality && appNationality) syncUpdate.nationality = appNationality;
              if (!(existingUser as any)?.region      && appRegion)      syncUpdate.region      = appRegion;
              if (!(existingUser as any)?.district    && appDistrict)    syncUpdate.district    = appDistrict;
              if (!(existingUser as any)?.fullName    && appFullName)    syncUpdate.fullName    = appFullName;
              if (Object.keys(syncUpdate).length > 0) {
                await prisma.user.update({ where: { id: linkedAgent.userId }, data: syncUpdate as any });
                console.log(`[CAREERS_HIRED] Synced profile fields ${Object.keys(syncUpdate).join(', ')} to User ${linkedAgent.userId}`);
              }
            }
          } catch (syncErr: any) {
            console.warn("[CAREERS_HIRED] Failed to sync profile fields for already-linked agent:", syncErr?.message);
          }
        } else {
          const agentData = (existingApplication.agentApplicationData ?? {}) as any;
          const appRegion = typeof (existingApplication as any).region === "string" ? String((existingApplication as any).region).trim() : "";
          const appDistrict = typeof (existingApplication as any).district === "string" ? String((existingApplication as any).district).trim() : "";
          const appNationality = typeof (existingApplication as any).nationality === "string" && String((existingApplication as any).nationality).trim()
            ? String((existingApplication as any).nationality).trim()
            : (typeof agentData.nationality === "string" ? String(agentData.nationality).trim() : "");

          // Business rule: only applicants who applied as an agent should be provisioned as Agents
          // and receive the Agent Portal onboarding email.
          // Source of truth signal: the Job flag (set by admin when announcing the job).
          const shouldProvisionAgent = isPartnershipApplication(existingApplication);
          if (shouldProvisionAgent) {
            const email = String(existingApplication.email || "").trim().toLowerCase();
            const phone = String(existingApplication.phone || "").trim();

            // Email only: the phone was typed by the applicant and never verified,
            // so it must never select someone else's account (checked above too).
            const userOr: any[] = [];
            if (email) userOr.push({ email });

            const txResult = await prisma.$transaction(
              async (tx) => {
                // Find or create user account
                let user = await tx.user.findFirst({
                  where: userOr.length > 0 ? { OR: userOr } : undefined,
                });

                if (!user) {
                  const phoneTaken = phone ? await tx.user.findFirst({ where: { phone }, select: { id: true } }) : null;
                  user = await tx.user.create({
                    data: {
                      email: email || undefined,
                      phone: phone && !phoneTaken ? phone : undefined,
                      name: existingApplication.fullName,
                      fullName: existingApplication.fullName,
                      role: "AGENT",
                      nationality: appNationality || undefined,
                      region: appRegion || undefined,
                      district: appDistrict || undefined,
                    } as any,
                  });
                } else {
                  const userUpdate: any = {};
                  const currentRole = String((user as any).role || "").toUpperCase();
                  if (!["CUSTOMER", "USER", "AGENT"].includes(currentRole)) {
                    throw new Error(`Refusing to turn a ${currentRole} account into an operator`);
                  }
                  if (currentRole !== "AGENT") userUpdate.role = "AGENT";
                  if (!(user as any).fullName && existingApplication.fullName) userUpdate.fullName = existingApplication.fullName;
                  if (!(user as any).name && existingApplication.fullName) userUpdate.name = existingApplication.fullName;
                  if (!(user as any).nationality && appNationality) userUpdate.nationality = appNationality;
                  if (!(user as any).region && appRegion) userUpdate.region = appRegion;
                  if (!(user as any).district && appDistrict) userUpdate.district = appDistrict;

                  if (Object.keys(userUpdate).length > 0) {
                    user = await tx.user.update({
                      where: { id: user.id },
                      data: userUpdate as any,
                    });
                  }
                }

                (req as any)._hiredUserId = user.id;
                (req as any)._hiredUsername = email || phone || "";

                // Ensure agent profile exists (minimal info only)
                let agentProfile = await tx.agent.findUnique({
                  where: { userId: user.id },
                  select: { id: true, operatorProfile: true, areasOfOperation: true, specializations: true, languages: true, yearsOfExperience: true },
                });

                if (!agentProfile) {
                  // Create agent with minimal required fields (core linkage only)
                  agentProfile = await tx.agent.create({
                    data: {
                      user: { connect: { id: user.id } },
                      status: agentData.status || "ACTIVE",
                      bio: agentData.bio || null,
                      maxActiveRequests: agentData.maxActiveRequests != null ? Number(agentData.maxActiveRequests) : 10,
                      isAvailable: agentData.isAvailable !== undefined ? Boolean(agentData.isAvailable) : true,
                      currentActiveRequests: 0,
                    } as any,
                  });
                }

                // Link application to agent
                await tx.jobApplication.updateMany({
                  where: { agentId: agentProfile.id, id: { not: parsedId } },
                  data: { agentId: null },
                });
                await tx.jobApplication.update({
                  where: { id: parsedId },
                  data: { agentId: agentProfile.id },
                });

                console.log(`Provisioned Agent profile (ID: ${agentProfile.id}) for HIRED application ${parsedId} (User ID: ${user.id})`);
                return { agentId: agentProfile.id, userId: user.id };
              },
              { timeout: 15000 } // Increased from default 5s to 15s for agent provisioning
            );

            // Apply optional profile fields OUTSIDE transaction after commit
            // This reduces transaction time and allows independent retry on failure
            if (txResult?.agentId) {
              try {
                const normalizeLanguageStrings = (value: unknown): string[] => {
                  if (!Array.isArray(value)) return [];
                  const out: string[] = [];
                  for (const item of value) {
                    if (typeof item === "string") {
                      const trimmed = item.trim();
                      if (trimmed) out.push(trimmed);
                    } else if (item && typeof item === "object") {
                      const maybeLanguage = (item as any).language;
                      if (typeof maybeLanguage === "string") {
                        const trimmed = maybeLanguage.trim();
                        if (trimmed) out.push(trimmed);
                      }
                    }
                  }
                  return Array.from(new Set(out));
                };

                const applicationYearsOfExperience = (existingApplication as any).yearsOfExperience != null
                  ? Number((existingApplication as any).yearsOfExperience)
                  : null;

                const applicationLanguages = normalizeLanguageStrings((existingApplication as any).languages);
                const agentDataLanguages = normalizeLanguageStrings((agentData as any).languages);
                const jobAreaOfOperationRaw = typeof (existingApplication.job as any)?.locationDetail === "string"
                  ? String((existingApplication.job as any).locationDetail).trim()
                  : "";
                const inferredAreasFromJob = Array.from(
                  new Set(
                    jobAreaOfOperationRaw.split(",").map((v) => v.trim()).filter(Boolean)
                  )
                );

                const agentProfile = await prisma.agent.findUnique({
                  where: { id: txResult.agentId },
                  select: { areasOfOperation: true, specializations: true, languages: true, yearsOfExperience: true, operatorProfile: true },
                });

                if (agentProfile) {
                  const normalizeAreas = (value: unknown): string[] => {
                    if (!Array.isArray(value)) return [];
                    return Array.from(
                      new Set(value.filter((v) => typeof v === "string").map((v) => v.trim()).filter(Boolean))
                    );
                  };

                  const agentUpdate: any = {};
                  const incomingAreas = Array.isArray(agentData.areasOfOperation) ? agentData.areasOfOperation : [];
                  const incomingSpecs = Array.isArray(agentData.specializations) ? agentData.specializations : [];
                  const existingAreas = Array.isArray((agentProfile as any).areasOfOperation) ? (agentProfile as any).areasOfOperation : null;
                  const existingSpecs = Array.isArray((agentProfile as any).specializations) ? (agentProfile as any).specializations : null;
                  const existingLanguages = Array.isArray((agentProfile as any).languages) ? (agentProfile as any).languages : null;
                  const existingYears = (agentProfile as any).yearsOfExperience != null ? Number((agentProfile as any).yearsOfExperience) : null;

                  if (inferredAreasFromJob.length > 0) {
                    const currentAreas = normalizeAreas(existingAreas);
                    const advertAreas = inferredAreasFromJob;
                    const same = currentAreas.length === advertAreas.length && currentAreas.every((v, idx) => v === advertAreas[idx]);
                    if (!same) agentUpdate.areasOfOperation = advertAreas;
                  } else if ((!existingAreas || existingAreas.length === 0) && incomingAreas.length > 0) {
                    agentUpdate.areasOfOperation = incomingAreas;
                  }
                  if ((!existingSpecs || existingSpecs.length === 0) && incomingSpecs.length > 0) agentUpdate.specializations = incomingSpecs;

                  if (existingYears == null) {
                    const incomingYears = applicationYearsOfExperience != null
                      ? applicationYearsOfExperience
                      : (agentData.yearsOfExperience != null ? Number(agentData.yearsOfExperience) : null);
                    if (incomingYears != null) agentUpdate.yearsOfExperience = incomingYears;
                  }

                  if ((!existingLanguages || existingLanguages.length === 0)) {
                    const incomingLanguages = applicationLanguages.length > 0 ? applicationLanguages : (agentDataLanguages.length > 0 ? agentDataLanguages : []);
                    if (incomingLanguages.length > 0) agentUpdate.languages = incomingLanguages;
                  }

                  const operatorProfileSeed = buildOperatorProfileSeed(existingApplication.agentApplicationData, {
                    fullName: existingApplication.fullName,
                    email,
                    phone,
                    region: existingApplication.region,
                    district: existingApplication.district,
                  });
                  if (Object.keys(operatorProfileSeed).length > 0) {
                    agentUpdate.operatorProfile = mergeOperatorProfileSeed((agentProfile as any).operatorProfile, operatorProfileSeed) as any;
                  }

                  if (Object.keys(agentUpdate).length > 0) {
                    await prisma.agent.update({
                      where: { id: txResult.agentId },
                      data: agentUpdate as any,
                    });
                  }
                }
              } catch (profileErr: any) {
                console.warn("[CAREERS_HIRED] Non-critical: Failed to populate optional profile fields:", profileErr?.message);
                // Don't fail the request - agent profile was already created and linked
              }
            }
          }
        }
      } catch (agentError: any) {
        // Log error but don't fail the request - status update was successful
        console.error("Error provisioning Agent profile from HIRED application:", agentError);
        console.error("Agent provisioning error details:", {
          message: agentError.message,
          code: agentError.code,
          applicationId: parsedId,
          email: existingApplication.email,
        });
      }
    }

    // Re-fetch updated application with all relations (including agent if created)
    const finalApplication = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            department: true,
            isTravelAgentPosition: true
          }
        },
        reviewedByUser: {
          select: {
            id: true,
            name: true,
            email: true
          }
        },
        agent: {
          select: {
            id: true,
            userId: true,
            status: true,
            operatorProfile: true,
          }
        }
      }
    });

    if (!finalApplication) {
      return res.status(404).json({ error: "Application not found after update" });
    }

    if (String(finalApplication.status || "").toUpperCase() === "HIRED" && finalApplication.agent?.id) {
      const workflow = readContractWorkflow((finalApplication.agent as any).operatorProfile);
      if (!workflow) {
        try {
          const seeded = buildWorkflowForApplication(finalApplication.agent.id, finalApplication as any);
          const nextProfile = await persistAgentWorkflow(
            finalApplication.agent.id,
            (finalApplication.agent as any).operatorProfile,
            seeded
          );
          (finalApplication.agent as any).operatorProfile = nextProfile as any;
        } catch (workflowError: any) {
          console.warn("[CAREERS_CONTRACT] Failed to auto-seed contract workflow:", workflowError?.message);
        }
      }
    }

    // Audit log
    await audit(req as any, "JOB_APPLICATION_UPDATE", "JOB_APPLICATION", existingApplication, finalApplication);

    // Send email notification if status changed to a notifiable status
    let emailSent = false;
    let emailWarning: string | undefined;

    if (statusChanged && newStatus && ["REVIEWING", "SHORTLISTED", "REJECTED", "HIRED"].includes(newStatus)) {
      const recipientEmail = String(finalApplication.email || "").trim();
      if (!recipientEmail) {
        emailWarning = "No email address on file for this applicant — notification not sent";
        console.warn("[CAREERS_EMAIL] Skipping notification: no email address", { applicationId: parsedId, status: newStatus });
      } else {
      try {
        const onboarding = (req as any)._agentOnboarding as
          | { username?: string; setupLink?: string; expiresHours?: number }
          | undefined;

        const origin = process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "http://localhost:3000";

        const isAgentHire = isPartnershipApplication(finalApplication);

        // For agent hires, guarantee HIRED emails include a one-time setup link (even if the agent profile already existed)
        let hiredSetupLink: string | undefined = onboarding?.setupLink;
        let hiredUsername: string | undefined = onboarding?.username;
        let hiredSetupExpiresHours: number | undefined = onboarding?.expiresHours;

        if (isAgentHire && newStatus === "HIRED" && !hiredSetupLink) {
          // Token generation always happens HERE (outside any transaction) so it
          // cannot be rolled back. _hiredUserId is set by the transaction above;
          // if the transaction failed (agentError catch) we fall back to a DB lookup.
          try {
            const email = String(finalApplication.email || "").trim().toLowerCase();
            const phone = String(finalApplication.phone || "").trim();

            hiredUsername = hiredUsername
              || (req as any)._hiredUsername
              || email || phone;

            let userId: number | null = (req as any)._hiredUserId ?? null;

            if (!userId && (finalApplication as any).agent?.userId) {
              userId = Number((finalApplication as any).agent.userId);
            }

            if (!userId && (finalApplication as any).agent?.id) {
              const a = await prisma.agent.findUnique({
                where: { id: Number((finalApplication as any).agent.id) },
                select: { userId: true },
              });
              if (a?.userId) userId = a.userId;
            }

            if (!userId && email) {
              const u = await prisma.user.findFirst({ where: { email }, select: { id: true } });
              if (u?.id) userId = u.id;
            }

            if (userId) {
              const { raw } = await issuePasswordSetupToken(userId, ONBOARDING_SETUP_HOURS);
              hiredSetupExpiresHours = ONBOARDING_SETUP_HOURS;
              // Token only: no row id and no email in the address.
              hiredSetupLink = passwordSetupLink(origin, raw, { onboarding: true, next: "/account/agent" });
            }
          } catch (tokenErr: any) {
            console.error("[CAREERS_HIRED] Failed to generate setup token:", tokenErr?.message);
          }
        }

        if (newStatus === "HIRED" && isAgentHire && !hiredSetupLink) {
          throw new Error("Partner approval email requires a first-password setup link, but no setup token could be generated.");
        }

        const emailData = {
          applicantName: finalApplication.fullName,
          jobTitle: finalApplication.job.title,
          jobDepartment: finalApplication.job.department || undefined,
          status: newStatus as "REVIEWING" | "SHORTLISTED" | "REJECTED" | "HIRED",
          adminNotes: finalApplication.adminNotes || undefined,
          companyName: process.env.COMPANY_NAME || "NoLSAF Inc Limited",
          supportEmail: process.env.SUPPORT_EMAIL || process.env.CAREERS_EMAIL || "careers@nolsaf.com",
          isPartnership: isAgentHire,
          ...(newStatus === "HIRED" && isAgentHire
            ? {
                portalUrl: `${origin}/account/agent`,
                loginUrl: `${origin}/account/login`,
                username: hiredUsername || String(finalApplication.email || "").trim().toLowerCase() || String(finalApplication.phone || "").trim(),
                setupLink: hiredSetupLink,
                setupLinkExpiresHours: hiredSetupExpiresHours,
              }
            : null),
        };

        const subject = getApplicationEmailSubject(emailData.status, emailData.jobTitle, emailData.isPartnership);
        const html = generateApplicationStatusEmail(emailData);

        if (newStatus === "HIRED" && isAgentHire && !hiredSetupLink) {
          console.warn("careers.hired-email.missing-setup-link", {
            applicationId: parsedId,
            applicantEmail: finalApplication.email,
            agentUserId: finalApplication.agent?.userId ?? null,
            origin,
            hasWebOrigin: Boolean(process.env.WEB_ORIGIN),
            hasAppOrigin: Boolean(process.env.APP_ORIGIN),
          });
        }

        await sendMail(recipientEmail, subject, html);
        emailSent = true;
        console.log(`[CAREERS_EMAIL] Notification sent to ${recipientEmail} for status: ${newStatus}`);
      } catch (emailError: any) {
        // Log email error but don't fail the status update
        emailWarning = emailError.message || "Email delivery failed";
        console.error("[CAREERS_EMAIL] Failed to send notification:", emailError);
        console.error("Email error details:", {
          message: emailError.message,
          applicationId: parsedId,
          applicantEmail: recipientEmail,
          status: newStatus
        });
      }
      } // end: recipientEmail guard
    }

    return res.json({ ...finalApplication, emailSent, emailWarning });
  } catch (error: any) {
    console.error("Error updating application:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      name: error.name
    });
    
    if (error.message?.includes('jobApplication') || error.message?.includes('JobApplication') || error.code === 'P2021' || error.code === 'P2022') {
      return res.status(500).json({ 
        error: "Database schema not updated. Please restart the server after running 'npx prisma generate'.",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    return res.status(500).json({ 
      error: "Failed to update application",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * DELETE /admin/careers/applications/:id
 * Delete an application (soft delete by setting status to DELETED or hard delete)
 */
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const parsedId = parseInt(id, 10);
    
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: "Invalid application ID" });
    }
    
    const existingApplication = await prisma.jobApplication.findUnique({
      where: { id: parsedId },
      include: { job: true }
    });

    if (!existingApplication) {
      return res.status(404).json({ error: "Application not found" });
    }

    await prisma.jobApplication.delete({
      where: { id: parsedId }
    });

    // Audit log
    await audit(req as any, "JOB_APPLICATION_DELETE", "JOB_APPLICATION", existingApplication, undefined);

    return res.json({ message: "Application deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting application:", error);
    console.error("Error details:", {
      message: error.message,
      code: error.code,
      name: error.name
    });
    
    if (error.message?.includes('jobApplication') || error.message?.includes('JobApplication') || error.code === 'P2021' || error.code === 'P2022') {
      return res.status(500).json({ 
        error: "Database schema not updated. Please restart the server after running 'npx prisma generate'.",
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
    
    return res.status(500).json({ 
      error: "Failed to delete application",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * GET /admin/careers/applications/export
 * Export applications to CSV
 */
router.get("/export", async (req, res) => {
  try {
    const { 
      jobId, 
      status, 
      email,
      search,
      format = "csv"
    } = req.query;

    const where: any = {};
    
    if (jobId) {
      const parsedJobId = parseInt(jobId as string, 10);
      if (!isNaN(parsedJobId)) {
        where.jobId = parsedJobId;
      }
    }
    if (status) where.status = status;
    if (email) {
      where.email = { contains: email as string };
    }
    if (search) {
      where.OR = [
        { fullName: { contains: search as string } },
        { email: { contains: search as string } },
        { phone: { contains: search as string } }
      ];
    }

    const applications = await prisma.jobApplication.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            department: true
          }
        },
        reviewedByUser: {
          select: { id: true, name: true, email: true }
        }
      }
    });

    if (format === "csv") {
      // Generate CSV
      const headers = [
        "ID",
        "Full Name",
        "Email",
        "Phone",
        "Job Title",
        "Department",
        "Status",
        "Submitted At",
        "Reviewed At",
        "Reviewed By",
        "Portfolio",
        "LinkedIn",
        "Referred By",
        "Resume File Name"
      ];

      const rows = applications.map(app => [
        app.id,
        app.fullName,
        app.email,
        app.phone,
        app.job?.title || "N/A",
        app.job?.department || "N/A",
        app.status,
        app.submittedAt.toISOString(),
        app.reviewedAt ? app.reviewedAt.toISOString() : "",
        app.reviewedByUser?.name || app.reviewedByUser?.email || "",
        app.portfolio || "",
        app.linkedIn || "",
        app.referredBy || "",
        app.resumeFileName || ""
      ]);

      const csvContent = [
        headers.join(","),
        ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      ].join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="applications-${new Date().toISOString().split('T')[0]}.csv"`);
      return res.send(csvContent);
    }

    return res.status(400).json({ error: "Unsupported format. Use 'csv'" });
  } catch (error: any) {
    console.error("Error exporting applications:", error);
    return res.status(500).json({ 
      error: "Failed to export applications",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * PATCH /admin/careers/applications/bulk
 * Bulk update application statuses
 */
router.patch("/bulk", async (req, res) => {
  try {
    const { applicationIds, status, adminNotes } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({ error: "applicationIds must be a non-empty array" });
    }

    if (!status) {
      return res.status(400).json({ error: "status is required" });
    }

    const validStatuses = ["PENDING", "REVIEWING", "SHORTLISTED", "REJECTED", "HIRED"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const parsedIds = applicationIds.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));

    if (parsedIds.length === 0) {
      return res.status(400).json({ error: "No valid application IDs provided" });
    }

    // Get existing applications to check status changes
    const existingApplications = await prisma.jobApplication.findMany({
      where: { id: { in: parsedIds } },
      include: { job: true }
    });

    const finalized = existingApplications.filter(
      (app) => (app.status === "HIRED" || app.status === "REJECTED") && app.status !== status
    );
    if (finalized.length > 0) {
      return res.status(409).json({
        error: "Some applications are finalized (HIRED/REJECTED) and cannot be changed",
        finalizedIds: finalized.map((a) => a.id),
      });
    }

    // Safety: Agent hires require provisioning + a one-time Agent Portal setup link.
    // Bulk HIRED does not provision agents, so block it for agent applications.
    if (status === "HIRED") {
      const agentJobApps = existingApplications.filter((app) => isPartnershipApplication(app));
      if (agentJobApps.length > 0) {
        return res.status(409).json({
          error: "Some selected applications belong to Travel Agent recruitment jobs and cannot be bulk-marked HIRED. Hire them individually to trigger agent provisioning and onboarding email.",
          agentApplicationIds: agentJobApps.map((a) => a.id),
        });
      }
    }

    const applicationsToUpdate = existingApplications.filter((app) => app.status !== status || adminNotes !== undefined);
    if (applicationsToUpdate.length === 0) {
      return res.json({
        success: true,
        updated: 0,
        applications: [],
      });
    }

    // Update applications
    const updateData: any = {
      status,
      reviewedAt: new Date(),
      reviewedBy: (req as any).user?.id
    };

    if (adminNotes !== undefined) {
      updateData.adminNotes = adminNotes;
    }

    // Track used statuses
    const updatePromises = applicationsToUpdate.map(async (app) => {
      const usedStatuses: string[] = Array.isArray(app.usedStatuses) 
        ? [...(app.usedStatuses as string[])] 
        : [];
      
      if (app.status && !usedStatuses.includes(app.status)) {
        usedStatuses.push(app.status);
      }
      if (status && !usedStatuses.includes(status)) {
        usedStatuses.push(status);
      }

      return prisma.jobApplication.update({
        where: { id: app.id },
        data: { ...updateData, usedStatuses }
      });
    });

    const updatedApplications = await Promise.all(updatePromises);

    // Send email notifications for status changes
    const emailPromises = existingApplications
      .filter(app => app.status !== status && ["REVIEWING", "SHORTLISTED", "REJECTED", "HIRED"].includes(status))
      .map(async (app) => {
        try {
          const emailData = {
            applicantName: app.fullName,
            jobTitle: app.job?.title || "Position",
            jobDepartment: app.job?.department || undefined,
            status: status as "REVIEWING" | "SHORTLISTED" | "REJECTED" | "HIRED",
            adminNotes: adminNotes || undefined,
            companyName: process.env.COMPANY_NAME || "NoLSAF Inc Limited",
            supportEmail: process.env.SUPPORT_EMAIL || process.env.CAREERS_EMAIL || "careers@nolsaf.com",
            isPartnership: isPartnershipApplication(app),
          };

          const subject = getApplicationEmailSubject(emailData.status, emailData.jobTitle, emailData.isPartnership);
          const html = generateApplicationStatusEmail(emailData);

          await sendMail(app.email, subject, html);
        } catch (emailError: any) {
          console.error(`Error sending email to ${app.email}:`, emailError);
          // Continue with other emails even if one fails
        }
      });

    await Promise.all(emailPromises);

    // Audit log
    await audit(req as any, "JOB_APPLICATION_BULK_UPDATE", "JOB_APPLICATION", 
      { count: existingApplications.length, ids: parsedIds },
      { count: updatedApplications.length, status }
    );

    return res.json({
      success: true,
      updated: updatedApplications.length,
      applications: updatedApplications
    });
  } catch (error: any) {
    console.error("Error bulk updating applications:", error);
    return res.status(500).json({ 
      error: "Failed to bulk update applications",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * DELETE /admin/careers/applications/bulk
 * Bulk delete applications
 */
router.delete("/bulk", async (req, res) => {
  try {
    const { applicationIds } = req.body;

    if (!Array.isArray(applicationIds) || applicationIds.length === 0) {
      return res.status(400).json({ error: "applicationIds must be a non-empty array" });
    }

    const parsedIds = applicationIds.map((id: any) => parseInt(id, 10)).filter((id: number) => !isNaN(id));

    if (parsedIds.length === 0) {
      return res.status(400).json({ error: "No valid application IDs provided" });
    }

    const existingApplications = await prisma.jobApplication.findMany({
      where: { id: { in: parsedIds } },
      include: { job: true }
    });

    await prisma.jobApplication.deleteMany({
      where: { id: { in: parsedIds } }
    });

    // Audit log
    await audit(req as any, "JOB_APPLICATION_BULK_DELETE", "JOB_APPLICATION", 
      { count: existingApplications.length, ids: parsedIds },
      undefined
    );

    return res.json({
      success: true,
      deleted: parsedIds.length
    });
  } catch (error: any) {
    console.error("Error bulk deleting applications:", error);
    return res.status(500).json({ 
      error: "Failed to bulk delete applications",
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
