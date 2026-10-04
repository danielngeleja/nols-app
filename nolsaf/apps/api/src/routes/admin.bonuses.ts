import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";
import { 
  BonusReasonType, 
  generateBonusReasonText, 
  isValidBonusReasonType,
  BONUS_REASON_TYPES 
} from "../lib/bonus-reasons.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import type { Server as SocketIOServer } from "socket.io";

export const router = Router();
router.use(
  requireAuth as unknown as RequestHandler,
  requireRole("ADMIN") as unknown as RequestHandler
);

// Constants
const DEFAULT_DATE_RANGE_DAYS = 30;
const DEFAULT_DATE_RANGE_MS = DEFAULT_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;
const SYSTEM_SETTING_ID = 1;
const MAX_BONUS_PERCENT = 100;
const MIN_BONUS_PERCENT = 0;
const MIN_BONUS_AMOUNT = 0;
const MAX_BONUS_AMOUNT = 100_000_000; // 100 million TZS
const BONUS_PAYMENT_REF_PREFIX = "BONUS";
const BONUS_PAYMENT_REF_DRIVER_PREFIX = "BONUS-DRIVER";

// Rate limiters
const limitBonusOperations = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 10, // 10 bonus operations per user per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many bonus operations. Please wait 15 minutes before trying again." },
  keyGenerator: (req) => {
    const userId = (req as AuthedRequest).user?.id;
    return userId ? `bonus:${userId}` : req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Helper: Standardized error response
function sendError(res: Response, status: number, message: string, details?: any) {
  res.status(status).json({ 
    error: message, 
    ...(details && { details }) 
  });
}

// Helper: Standardized success response
function sendSuccess(res: Response, data?: any, message?: string) {
  res.json({ 
    ok: true, 
    ...(message && { message }),
    ...(data && { data })
  });
}

// Helper: Get authenticated user ID
function getUserId(req: AuthedRequest): number {
  if (!req.user?.id) {
    throw new Error("User not authenticated");
  }
  return req.user.id;
}

// Helper: Get Socket.IO instance from request
function getSocketIO(req: AuthedRequest): SocketIOServer | null {
  try {
    const io = req.app?.get?.('io') as SocketIOServer | undefined;
    return io || null;
  } catch {
    return null;
  }
}

// Helper: Generate bonus payment reference
function generateBonusPaymentRef(userId: number, isDriver = false): string {
  const prefix = isDriver ? BONUS_PAYMENT_REF_DRIVER_PREFIX : BONUS_PAYMENT_REF_PREFIX;
  return `${prefix}-${userId}-${Date.now()}`;
}

// Helper: Mark referral earnings as paid as bonus
async function markReferralEarningsAsBonus(
  driverId: number,
  bonusPaymentRef: string,
  bonusAmount: number,
  adminId: number,
  io: SocketIOServer | null
): Promise<{ count: number; earningIds: number[] }> {
  try {
    const earnings = await prisma.referralEarning.findMany({
      where: {
        driverId,
        status: { in: ['PENDING', 'AVAILABLE_FOR_WITHDRAWAL'] },
      },
      select: { id: true },
    });

    if (earnings.length === 0) {
      return { count: 0, earningIds: [] };
    }

    const earningIds = earnings.map(e => e.id);

    await prisma.referralEarning.updateMany({
      where: {
        id: { in: earningIds },
      },
      data: {
        status: 'PAID_AS_BONUS',
        bonusPaymentRef,
        paidAsBonusAt: new Date(),
        adminNotes: `Included in bonus payment: ${bonusPaymentRef}`,
      },
    });

    // Notify admins via Socket.IO
    if (io) {
      try {
        io.emit('admin:referral-earnings-paid-as-bonus', {
          earningIds,
          bonusPaymentRef,
          driverId,
          bonusAmount,
          count: earnings.length,
          processedBy: adminId,
        });
      } catch (e) {
        console.warn('[BONUS] Failed to emit referral earnings notification:', e);
      }
    }

    return { count: earnings.length, earningIds };
  } catch (e) {
    console.warn('[BONUS] Failed to mark referral earnings as bonus:', e);
    return { count: 0, earningIds: [] };
  }
}

// Helper: Notify driver via Socket.IO
function notifyDriverBonus(
  io: SocketIOServer | null,
  driverId: number,
  bonusAmount: number,
  bonusReasonType: BonusReasonType,
  reason: string,
  period: string,
  bonusPaymentRef: string,
  grantedBy: { id: number; name?: string | null }
): void {
  if (!io) return;

  try {
    io.to(`driver:${driverId}`).emit('bonus-granted', {
      bonusAmount,
      bonusReasonType,
      reason,
      period,
      bonusPaymentRef,
      grantedAt: new Date().toISOString(),
      grantedBy: {
        id: grantedBy.id,
        name: grantedBy.name || 'Admin',
      },
    });
  } catch (e) {
    console.warn('[BONUS] Failed to emit bonus notification to driver:', e);
  }
}

// Helper: Get SystemSetting commission percent
async function getCommissionPercent(): Promise<number> {
  const setting = await prisma.systemSetting.findUnique({ 
    where: { id: SYSTEM_SETTING_ID },
    select: { commissionPercent: true }
  });
  return setting?.commissionPercent ? Number(setting.commissionPercent) : 0;
}

// Helper: Calculate total revenue for owner in date range
async function calculateOwnerRevenue(ownerId: number, fromDate: Date, toDate: Date): Promise<number> {
  const result = await prisma.invoice.aggregate({
    where: {
      ownerId,
      issuedAt: {
        gte: fromDate,
        lte: toDate,
      },
      status: 'PAID',
    },
    _sum: {
      total: true,
    },
  });

  return result._sum.total ? Number(result._sum.total) : 0;
}

// Zod Validation Schemas
const grantBonusSchema = z.object({
  ownerId: z.union([z.string(), z.number()]).transform(val => Number(val)),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  bonusPercent: z.number()
    .min(MIN_BONUS_PERCENT, `Bonus percent must be at least ${MIN_BONUS_PERCENT}%`)
    .max(MAX_BONUS_PERCENT, `Bonus percent must be at most ${MAX_BONUS_PERCENT}%`)
    .optional(),
  reason: z.string().max(500, "Reason must be less than 500 characters").optional(),
}).strict();

const grantDriverBonusSchema = z.object({
  driverId: z.union([z.string(), z.number()]).transform(val => Number(val)),
  amount: z.number()
    .min(MIN_BONUS_AMOUNT, `Amount must be at least ${MIN_BONUS_AMOUNT}`)
    .max(MAX_BONUS_AMOUNT, `Amount must be at most ${MAX_BONUS_AMOUNT}`),
  bonusReasonType: z.enum(['PERFORMANCE_EXCELLENCE', 'VOLUME_ACHIEVEMENT', 'LOYALTY_RETENTION', 'CUSTOM']).optional(),
  reason: z.string().max(500, "Reason must be less than 500 characters").optional(),
  period: z.string().max(50, "Period must be less than 50 characters").optional(),
  metrics: z.object({
    rating: z.number().min(0).max(5).optional(),
    completionRate: z.number().min(0).max(100).optional(),
    tripsCount: z.number().int().min(0).optional(),
    activeDays: z.number().int().min(0).optional(),
    monthsOfService: z.number().int().min(0).optional(),
    cancellations: z.number().int().min(0).optional(),
    customText: z.string().max(500).optional(),
  }).optional(),
}).strict();

/** POST /admin/bonuses/grant
 * Grant bonus to owner based on revenue in date range
 * body: { ownerId, from?: string (ISO), to?: string (ISO), bonusPercent?: number (0-100), reason?: string }
 * returns: { ownerId, totalRevenue, commissionPercent, commissionAmount, bonusPercent, bonusAmount, bonusPaymentRef }
 */
router.post('/grant', limitBonusOperations, (async (req, res) => {
  try {
    // Validate request body
    const validationResult = grantBonusSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid request", {
        errors: validationResult.error.issues,
      });
    }

    const { ownerId, from, to, bonusPercent, reason } = validationResult.data;
    const adminId = getUserId(req as AuthedRequest);

    // Find owner
    const owner = await prisma.user.findUnique({ 
      where: { id: ownerId },
      select: { id: true, role: true, name: true, email: true }
    });

    if (!owner) {
      return sendError(res, 404, "Owner not found");
    }

    if (owner.role !== 'OWNER') {
      return sendError(res, 400, "User is not an owner");
    }

    // Parse date range with validation
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(Date.now() - DEFAULT_DATE_RANGE_MS);

    // Validate date range
    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      return sendError(res, 400, "Invalid date format. Use ISO 8601 format (e.g., 2025-01-01T00:00:00Z)");
    }

    if (fromDate > toDate) {
      return sendError(res, 400, "Start date must be before end date");
    }

    // Calculate total revenue using Prisma (replacing raw SQL)
    const totalRevenue = await calculateOwnerRevenue(ownerId, fromDate, toDate);

    // Get commission percent from SystemSetting
    const commissionPercent = await getCommissionPercent();
    const commissionAmount = (totalRevenue * commissionPercent) / 100;

    // Calculate bonus
    const bp = bonusPercent ?? 0;
    if (bp < MIN_BONUS_PERCENT || bp > MAX_BONUS_PERCENT) {
      return sendError(res, 400, `Bonus percent must be between ${MIN_BONUS_PERCENT}% and ${MAX_BONUS_PERCENT}%`);
    }

    const bonusAmount = (commissionAmount * bp) / 100;

    // Generate bonus payment reference
    const bonusPaymentRef = generateBonusPaymentRef(ownerId, false);

    // Sanitize reason
    const sanitizedReason = reason ? sanitizeText(reason) : null;

    // Record audit log using transaction
    await prisma.$transaction(async (tx) => {
      const details = {
        ownerId,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        totalRevenue,
        commissionPercent,
        commissionAmount,
        bonusPercent: bp,
        bonusAmount,
        reason: sanitizedReason,
        bonusPaymentRef,
      };

      await tx.adminAudit.create({
        data: {
          adminId,
          targetUserId: ownerId,
          action: 'GRANT_BONUS',
          details: JSON.stringify(details),
        },
      });

      // A granted bonus is a NoLSAF cost: record it in the expense ledger in
      // the same transaction, keyed by its payment reference so a retry can
      // never count it twice (see lib/platformMargin.ts).
      if (Number(bonusAmount) > 0) {
        await tx.platformExpense.create({
          data: {
            category: 'PARTNER_BONUS',
            description: 'Bonus granted to an owner',
            amount: Number(bonusAmount).toFixed(2) as any,
            currency: 'TZS',
            incurredAt: new Date(),
            origin: 'SYSTEM',
            sourceKey: `BONUS:${bonusPaymentRef}`,
            recordedById: adminId,
            note: `Ref ${bonusPaymentRef}`,
          },
        });
      }

      // Audit using audit function
      await audit(req as AuthedRequest, "ADMIN_BONUS_GRANTED", `owner:${ownerId}`, null, details);
    });

    sendSuccess(res, {
      ownerId,
      totalRevenue,
      commissionPercent,
      commissionAmount,
      bonusPercent: bp,
      bonusAmount,
      bonusPaymentRef,
    });
  } catch (error: any) {
    console.error('[BONUS_GRANT] Error:', error);
    sendError(res, 500, "Failed to grant bonus. Please try again later.");
  }
}) as RequestHandler);

/** POST /admin/bonuses/grant-driver
 * Grant bonus to a driver with standardized reason types
 * body: { 
 *   driverId: number, 
 *   amount: number, 
 *   bonusReasonType?: 'PERFORMANCE_EXCELLENCE' | 'VOLUME_ACHIEVEMENT' | 'LOYALTY_RETENTION' | 'CUSTOM',
 *   reason?: string (optional custom text),
 *   period?: string (e.g., "Jan 2025"),
 *   metrics?: { rating?, completionRate?, tripsCount?, activeDays?, monthsOfService?, cancellations? }
 * }
 * returns: { driverId, bonusAmount, bonusReasonType, reason, period, bonusPaymentRef }
 */
router.post('/grant-driver', limitBonusOperations, (async (req, res) => {
  try {
    // Validate request body
    const validationResult = grantDriverBonusSchema.safeParse(req.body);
    if (!validationResult.success) {
      return sendError(res, 400, "Invalid request", {
        errors: validationResult.error.issues,
      });
    }

    const { driverId, amount, bonusReasonType, reason, period, metrics } = validationResult.data;
    const adminId = getUserId(req as AuthedRequest);

    // Validate reason type
    const reasonType: BonusReasonType = isValidBonusReasonType(bonusReasonType || '') 
      ? (bonusReasonType as BonusReasonType)
      : 'CUSTOM';

    // Verify driver exists
    const driver = await prisma.user.findUnique({ 
      where: { id: driverId },
      select: { id: true, name: true, email: true, role: true }
    });

    if (!driver) {
      return sendError(res, 404, "Driver not found");
    }

    if (driver.role !== 'DRIVER') {
      return sendError(res, 400, "User is not a driver");
    }

    const bonusAmount = Number(amount);
    const bonusPaymentRef = generateBonusPaymentRef(driverId, true);

    // Generate reason text if not provided
    const reasonText = reason 
      ? sanitizeText(reason) 
      : generateBonusReasonText(reasonType, metrics);

    // Determine period if not provided
    const bonusPeriod = period 
      ? sanitizeText(period) 
      : new Date().toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

    // Sanitize metrics
    const sanitizedMetrics = metrics ? {
      ...(metrics.rating !== undefined && { rating: metrics.rating }),
      ...(metrics.completionRate !== undefined && { completionRate: metrics.completionRate }),
      ...(metrics.tripsCount !== undefined && { tripsCount: metrics.tripsCount }),
      ...(metrics.activeDays !== undefined && { activeDays: metrics.activeDays }),
      ...(metrics.monthsOfService !== undefined && { monthsOfService: metrics.monthsOfService }),
      ...(metrics.cancellations !== undefined && { cancellations: metrics.cancellations }),
      ...(metrics.customText !== undefined && { customText: sanitizeText(metrics.customText) }),
    } : {};

    // Record in AdminAudit using transaction
    await prisma.$transaction(async (tx) => {
      const details = {
        driverId,
        bonusAmount,
        bonusReasonType: reasonType,
        reason: reasonText,
        period: bonusPeriod,
        metrics: sanitizedMetrics,
        bonusPaymentRef,
        grantedAt: new Date().toISOString(),
      };

      await tx.adminAudit.create({
        data: {
          adminId,
          targetUserId: driverId,
          action: 'GRANT_BONUS',
          details: JSON.stringify(details),
        },
      });

      // A granted bonus is a NoLSAF cost (see the owner grant above).
      if (Number(bonusAmount) > 0) {
        await tx.platformExpense.create({
          data: {
            category: 'PARTNER_BONUS',
            description: 'Bonus granted to a driver',
            amount: Number(bonusAmount).toFixed(2) as any,
            currency: 'TZS',
            incurredAt: new Date(),
            origin: 'SYSTEM',
            sourceKey: `BONUS:${bonusPaymentRef}`,
            recordedById: adminId,
            note: `Ref ${bonusPaymentRef}`,
          },
        });
      }

      // Audit using audit function
      await audit(req as AuthedRequest, "ADMIN_BONUS_GRANTED", `driver:${driverId}`, null, details);
    });

    // Get Socket.IO instance
    const io = getSocketIO(req as AuthedRequest);

    // Mark referral earnings as paid as bonus
    await markReferralEarningsAsBonus(driverId, bonusPaymentRef, bonusAmount, adminId, io);

    // Notify driver via Socket.IO
    notifyDriverBonus(
      io,
      driverId,
      bonusAmount,
      reasonType,
      reasonText,
      bonusPeriod,
      bonusPaymentRef,
      {
        id: adminId,
        name: null, // AuthedUser doesn't include name, fallback to 'Admin' in notifyDriverBonus
      }
    );

    sendSuccess(res, {
      driverId,
      bonusAmount,
      bonusReasonType: reasonType,
      reason: reasonText,
      period: bonusPeriod,
      bonusPaymentRef,
    });
  } catch (error: any) {
    console.error('[BONUS_GRANT_DRIVER] Error:', error);
    sendError(res, 500, "Failed to grant driver bonus. Please try again later.");
  }
}) as RequestHandler);

/** GET /admin/bonuses/reason-types
 * Get available bonus reason types and their configurations
 */
router.get('/reason-types', (async (req, res) => {
  try {
    const reasonTypes = Object.values(BONUS_REASON_TYPES).map(config => ({
      type: config.type,
      label: config.label,
      description: config.description,
      defaultAmount: config.defaultAmount,
      icon: config.icon,
    }));

    sendSuccess(res, { reasonTypes });
  } catch (error: any) {
    console.error('[BONUS_REASON_TYPES] Error:', error);
    sendError(res, 500, "Failed to fetch reason types. Please try again later.");
  }
}) as RequestHandler);

export default router;
