// apps/api/src/routes/admin.groupStays.assignments.ts
import { Router, type Request, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import type { RequestHandler } from "express";

const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

function toSingleString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return typeof value[0] === "string" ? value[0] : undefined;
  return undefined;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Number(toSingleString(value));
  if (!Number.isFinite(n)) return fallback;
  const asInt = Math.floor(n);
  return asInt > 0 ? asInt : fallback;
}

function parseJsonish(value: unknown): any {
  if (!value) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function computeClaimsDeadline(openedForClaimsAt: Date | null, openedAuditMetadata: unknown): Date | null {
  const metadata = parseJsonish(openedAuditMetadata);
  const rawDeadline = metadata?.deadline;
  if (rawDeadline) {
    const d = new Date(rawDeadline);
    if (!Number.isNaN(d.getTime())) return d;
  }
  if (openedForClaimsAt) {
    const fallback = new Date(openedForClaimsAt);
    fallback.setDate(fallback.getDate() + 7);
    return fallback;
  }
  return null;
}

async function autoCloseExpiredClaims(adminId: number) {
  const openClaims = await (prisma as any).groupBooking.findMany({
    where: { isOpenForClaims: true },
    select: {
      id: true,
      openedForClaimsAt: true,
      auditLogs: {
        where: { action: { in: ["OPENED_FOR_CLAIMS", "UPDATED_CLAIMS_SETTINGS"] } },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { metadata: true, createdAt: true },
      },
    },
  });

  const now = new Date();
  const expiredIds = openClaims
    .filter((gb: any) => {
      const meta = gb.auditLogs?.[0]?.metadata;
      const deadline = computeClaimsDeadline(gb.openedForClaimsAt ?? null, meta);
      return Boolean(deadline && now > deadline);
    })
    .map((gb: any) => gb.id);

  if (expiredIds.length === 0) return 0;

  await (prisma as any).groupBooking.updateMany({
    where: { id: { in: expiredIds }, isOpenForClaims: true },
    data: { isOpenForClaims: false, openedForClaimsAt: null },
  });

  // Attribute the auto-close to the current admin for audit visibility.
  await (prisma as any).groupBookingAudit.createMany({
    data: expiredIds.map((groupBookingId: number) => ({
      groupBookingId,
      adminId,
      action: "CLOSED_FOR_CLAIMS",
      description: "Competitive claims were closed automatically because the submission deadline was reached.",
      metadata: {
        isOpenForClaims: false,
        closeReasonCode: "DEADLINE_REACHED",
        closeReasonDetails: "Auto-close (deadline passed)",
      },
    })),
  });

  return expiredIds.length;
}

/**
 * POST /admin/group-stays/assignments/:id/owner
 * Assign an owner to a group stay
 */
router.post("/:id/owner", async (req: Request, res: Response) => {
  try {
    const r = req as AuthedRequest;
    const adminId = r.user!.id;
    const groupBookingId = Number(req.params.id);
    const { ownerId } = req.body as { ownerId: number };

    if (!ownerId || isNaN(ownerId)) {
      return res.status(400).json({ error: "ownerId is required and must be a valid number" });
    }

    // Verify group booking exists
    const groupBooking = await (prisma as any).groupBooking.findUnique({
      where: { id: groupBookingId },
    });

    if (!groupBooking) {
      return res.status(404).json({ error: "Group booking not found" });
    }

    // Verify owner exists and has OWNER role
    const owner = await prisma.user.findUnique({
      where: { id: ownerId },
      select: { id: true, role: true },
    });

    if (!owner || owner.role !== "OWNER") {
      return res.status(400).json({ error: "Invalid owner ID or user is not an owner" });
    }

    // Update group booking with assigned owner
    const updated = await (prisma as any).groupBooking.update({
      where: { id: groupBookingId },
      data: {
        assignedOwnerId: ownerId,
        ownerAssignedAt: new Date(),
      },
      include: {
        assignedOwner: {
          select: { id: true, name: true, email: true, phone: true },
        },
      },
    });

    // Create audit log
    try {
      const ownerData = await prisma.user.findUnique({
        where: { id: ownerId },
        select: { name: true, email: true },
      });
      await (prisma as any).groupBookingAudit.create({
        data: {
          groupBookingId,
          adminId,
          action: "OWNER_ASSIGNED",
          description: `Owner ${ownerData?.name || ownerData?.email || `#${ownerId}`} assigned to group stay`,
          metadata: { ownerId, ownerName: ownerData?.name || ownerData?.email || null },
        },
      });
    } catch (auditError) {
      console.warn("Failed to create audit log:", auditError);
    }

    res.json({ success: true, groupBooking: updated });
  } catch (err: any) {
    console.error("Error assigning owner to group stay:", err);
    res.status(500).json({ error: "Failed to assign owner" });
  }
});

/**
 * POST /admin/group-stays/assignments/:id/properties
 * Link/recommend properties to a group stay
 */
router.post("/:id/properties", async (req: Request, res: Response) => {
  try {
    const r = req as AuthedRequest;
    const adminId = r.user!.id;
    const groupBookingId = Number(req.params.id);
    const { propertyIds } = req.body as { propertyIds: number[] };

    if (!Array.isArray(propertyIds) || propertyIds.length === 0) {
      return res.status(400).json({ error: "propertyIds must be a non-empty array" });
    }

    // Verify group booking exists
    const groupBooking = await (prisma as any).groupBooking.findUnique({
      where: { id: groupBookingId },
    });

    if (!groupBooking) {
      return res.status(404).json({ error: "Group booking not found" });
    }

    // Verify all properties exist
    const properties = await prisma.property.findMany({
      where: { id: { in: propertyIds } },
      select: { id: true, title: true, status: true },
    });

    if (properties.length !== propertyIds.length) {
      return res.status(400).json({ error: "One or more properties not found" });
    }

    // Update group booking with recommended properties
    const updated = await (prisma as any).groupBooking.update({
      where: { id: groupBookingId },
      data: {
        recommendedPropertyIds: propertyIds,
      },
      include: {
        assignedOwner: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Create audit log
    try {
      await (prisma as any).groupBookingAudit.create({
        data: {
          groupBookingId,
          adminId,
          action: "PROPERTIES_RECOMMENDED",
          description: `Recommended ${propertyIds.length} propert${propertyIds.length === 1 ? 'y' : 'ies'}: ${properties.map((p: { title: string }) => p.title).join(', ')}`,
          metadata: { propertyIds, propertyTitles: properties.map((p: { title: string }) => p.title) },
        },
      });
    } catch (auditError) {
      console.warn("Failed to create audit log:", auditError);
    }

    res.json({ success: true, groupBooking: updated });
  } catch (err: any) {
    console.error("Error linking properties to group stay:", err);
    res.status(500).json({ error: "Failed to link properties" });
  }
});

/**
 * PATCH /admin/group-stays/assignments/:id/open-for-claims
 * Open a group stay for competitive claims (owners can submit offers)
 *
 * Body: { open: true }
 */
router.patch("/:id/open-for-claims", async (req: Request, res: Response) => {
  try {
    const r = req as AuthedRequest;
    const adminId = r.user!.id;
    const bookingId = Number(req.params.id);
    const { open, deadline, notes, minDiscountPercent, minHotelStar, reason, reAdvertise } = req.body as {
      open: boolean;
      deadline?: string;
      notes?: string | null;
      minDiscountPercent?: number | null;
      minHotelStar?: number | null;
      reason?: string;
      reAdvertise?: boolean;
    };
    const { reasonCode, reasonDetails } = req.body as {
      reasonCode?: string;
      reasonDetails?: string;
    };

    const allowedCloseReasonCodes = new Set([
      "OWNER_CONFIRMED",
      "DEADLINE_REACHED",
      "NO_VALID_OFFERS",
      "POLICY_DECISION",
    ]);
    const normalizedReasonCode = typeof reasonCode === "string" ? reasonCode.trim().toUpperCase() : "";
    const normalizedReasonDetails = typeof reasonDetails === "string" ? reasonDetails.trim() : "";

    if (!bookingId || isNaN(bookingId)) {
      return res.status(400).json({ error: "Invalid booking ID" });
    }

    if (typeof open !== "boolean") {
      return res.status(400).json({ error: "Invalid 'open' parameter (must be boolean)" });
    }

    if (open === true && typeof minHotelStar !== "undefined" && minHotelStar !== null) {
      const n = Number(minHotelStar);
      if (!Number.isFinite(n) || n < 1 || n > 5) {
        return res.status(400).json({ error: "minHotelStar must be a number between 1 and 5" });
      }
    }

    if (open === false) {
      const fallbackReason = typeof reason === "string" ? reason.trim() : "";

      // Preferred: structured reasonCode; fallback: legacy free-text reason.
      if (normalizedReasonCode) {
        if (!allowedCloseReasonCodes.has(normalizedReasonCode)) {
          return res.status(400).json({ error: "Invalid reasonCode for closing competitive claims" });
        }

        if (normalizedReasonCode === "POLICY_DECISION" && !normalizedReasonDetails) {
          return res.status(400).json({ error: "reasonDetails is required when reasonCode is POLICY_DECISION" });
        }
      } else if (!fallbackReason) {
        return res.status(400).json({ error: "A reason is required to close competitive claims" });
      }
    }

    const existing = await (prisma as any).groupBooking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        status: true,
        isOpenForClaims: true,
        openedForClaimsAt: true,
        assignedOwnerId: true,
        ownerAssignedAt: true,
        recommendedPropertyIds: true,
        confirmedPropertyId: true,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Group booking not found" });
    }

    const openingFromClosed = open === true && !existing.isOpenForClaims;
    const updatingSettings = open === true && existing.isOpenForClaims;

    if (open === true && openingFromClosed) {
      // If a property is already confirmed, auctioning makes no sense.
      if (existing.confirmedPropertyId) {
        return res.status(400).json({ error: "Cannot open for competitive claims after a property has been confirmed" });
      }

      const recommendedIds = Array.isArray(existing.recommendedPropertyIds)
        ? (existing.recommendedPropertyIds as any[])
            .map((v: any) => Number(v))
            .filter((v: any) => Number.isFinite(v))
        : [];

      const isAdminHandled = Boolean(existing.assignedOwnerId) || recommendedIds.length > 0;
      const wantsReadvertise = reAdvertise === true;

      // Prevent switching an already-admin-handled booking into claims unless explicitly re-advertising.
      if (isAdminHandled && !wantsReadvertise) {
        return res.status(400).json({
          error:
            "This booking is already being handled directly (owner/properties assigned). To open competitive claims you must re-advertise (which clears manual handling).",
        });
      }
    }

    const shouldClearAdminHandling =
      open === true && openingFromClosed && reAdvertise === true;

    const updated = await (prisma as any).groupBooking.update({
      where: { id: bookingId },
      data: {
        isOpenForClaims: open,
        openedForClaimsAt: open
          ? (existing.openedForClaimsAt ?? new Date())
          : null,
        ...(shouldClearAdminHandling
          ? {
              assignedOwnerId: null,
              ownerAssignedAt: null,
              recommendedPropertyIds: null,
            }
          : {}),
      },
    });

    // Create audit log entry
    if (adminId) {
      let description = open 
        ? `Admin opened group booking for competitive claims` 
        : `Admin closed group booking for competitive claims`;

      if (open && openingFromClosed && reAdvertise === true) {
        description = `Admin re-advertised group booking for competitive claims`;
      }

      if (!open) {
        const codeForAudit = normalizedReasonCode;
        const legacyReason = typeof reason === "string" ? reason.trim() : "";

        const reasonLabelByCode: Record<string, string> = {
          OWNER_CONFIRMED: "Owner confirmed",
          DEADLINE_REACHED: "Deadline reached",
          NO_VALID_OFFERS: "No valid offers",
          POLICY_DECISION: "Policy decision",
        };

        const label = codeForAudit ? (reasonLabelByCode[codeForAudit] || codeForAudit) : legacyReason;
        const details = normalizedReasonDetails;
        if (label) {
          description += details ? ` (Reason: ${label} — ${details})` : ` (Reason: ${label})`;
        }
      }
      
      if (open && deadline) {
        description += ` (Deadline: ${new Date(deadline).toLocaleDateString()})`;
        if (minDiscountPercent) {
          description += `, Min Discount: ${minDiscountPercent}%`;
        }
        if (minHotelStar) {
          description += `, Min Star: ${minHotelStar}`;
        }
      }

      if (updatingSettings) {
        description = `Admin updated competitive claims settings`;
        if (deadline) {
          description += ` (Deadline: ${new Date(deadline).toLocaleDateString()})`;
          if (minDiscountPercent) {
            description += `, Min Discount: ${minDiscountPercent}%`;
          }
          if (minHotelStar) {
            description += `, Min Star: ${minHotelStar}`;
          }
        }
      }

      await (prisma as any).groupBookingAudit.create({
        data: {
          groupBookingId: bookingId,
          adminId,
          action: open ? (openingFromClosed ? "OPENED_FOR_CLAIMS" : "UPDATED_CLAIMS_SETTINGS") : "CLOSED_FOR_CLAIMS",
          description,
          metadata: { 
            isOpenForClaims: open,
            deadline: open ? deadline : null,
            notes: open ? notes : null,
            minDiscountPercent: open ? minDiscountPercent : null,
            minHotelStar: open ? (typeof minHotelStar === "undefined" ? null : minHotelStar) : null,
            reAdvertise: open ? Boolean(reAdvertise) : null,
            clearedAdminHandling: open ? Boolean(shouldClearAdminHandling) : null,
            closeReason: open ? null : (typeof reason === "string" ? reason.trim() : null),
            closeReasonCode: open ? null : (normalizedReasonCode || null),
            closeReasonDetails: open ? null : (normalizedReasonDetails || null),
          },
        },
      });
    }

    return res.json({ success: true, booking: updated });
  } catch (err: any) {
    console.error("Error in PATCH /admin/group-stays/assignments/:id/open-for-claims:", err);
    return res.status(500).json({ error: "Failed to update claim status" });
  }
});

/**
 * GET /admin/group-stays/assignments/:id/audits
 * Get audit history for a specific group stay
 */
router.get("/:id/audits", async (req: Request, res: Response) => {
  try {
    const groupBookingId = Number(req.params.id);

    if (!groupBookingId || isNaN(groupBookingId)) {
      return res.status(400).json({ error: "Invalid group booking ID" });
    }

    const audits = await (prisma as any).groupBookingAudit.findMany({
      where: { groupBookingId },
      include: {
        admin: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.json({ items: audits || [] });
  } catch (err: any) {
    console.error("Error fetching audit history:", err);
    res.status(500).json({ error: "Failed to fetch audit history" });
  }
});

/**
 * GET /admin/group-stays/assignments
 * Get all group stays with their assignments
 */
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const r = req as AuthedRequest;
    const adminId = r.user!.id;
    await autoCloseExpiredClaims(adminId);

    const status = toSingleString((req.query as any).status);
    const assignedOwnerIdRaw = toSingleString((req.query as any).assignedOwnerId);

    const statusCountWhere: any = {};
    if (assignedOwnerIdRaw) {
      const ownerId = Number(assignedOwnerIdRaw);
      if (Number.isFinite(ownerId) && ownerId > 0) statusCountWhere.assignedOwnerId = ownerId;
    }
    const baseWhere: any = { ...statusCountWhere };
    if (status) baseWhere.status = status;

    const [total, claims, admin, groupedStatuses] = await Promise.all([
      (prisma as any).groupBooking.count({ where: baseWhere }),
      (prisma as any).groupBooking.count({ where: { ...baseWhere, isOpenForClaims: true } }),
      (prisma as any).groupBooking.count({ where: { ...baseWhere, isOpenForClaims: false } }),
      (prisma as any).groupBooking.groupBy({ by: ["status"], where: statusCountWhere, _count: { _all: true } }),
    ]);

    const statuses = Object.fromEntries(
      (groupedStatuses || []).map((row: any) => [String(row.status || "UNKNOWN").toUpperCase(), Number(row._count?._all || 0)])
    );
    return res.json({ total, claims, admin, statuses });
  } catch (err: any) {
    console.error("Error fetching group stay assignment stats:", err);
    return res.status(500).json({ error: "Failed to fetch assignment stats" });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const r = req as AuthedRequest;
    const adminId = r.user!.id;
    await autoCloseExpiredClaims(adminId);

    const view = (toSingleString((req.query as any).view) ?? "all").toLowerCase();
    const status = toSingleString((req.query as any).status);
    const assignedOwnerIdRaw = toSingleString((req.query as any).assignedOwnerId);
    const page = toPositiveInt((req.query as any).page, 1);
    const pageSizeRequested = toPositiveInt((req.query as any).pageSize, 50);

    const where: any = {};
    if (status) where.status = status;
    if (assignedOwnerIdRaw) {
      const ownerId = Number(assignedOwnerIdRaw);
      if (Number.isFinite(ownerId) && ownerId > 0) where.assignedOwnerId = ownerId;
    }

    // Categorization / navigation filter
    // - claims: opened for owner competitive claims
    // - admin: not open for claims (admin can assign/link directly)
    if (view === "claims") {
      where.isOpenForClaims = true;
    } else if (view === "admin") {
      where.isOpenForClaims = false;
    }

    const skip = (page - 1) * pageSizeRequested;
    const take = Math.min(pageSizeRequested, 100);

    const [items, total] = await Promise.all([
      (prisma as any).groupBooking.findMany({
        where,
        select: {
          id: true,
          groupType: true,
          accommodationType: true,
          headcount: true,
          roomsNeeded: true,
          toRegion: true,
          toDistrict: true,
          toLocation: true,
          checkIn: true,
          checkOut: true,
          status: true,
          isOpenForClaims: true,
          openedForClaimsAt: true,
          // Deposit and payout snapshot, shown once the customer has paid.
          totalAmount: true,
          currency: true,
          depositAmount: true,
          depositPaid: true,
          depositPaidAt: true,
          depositDueAt: true,
          ownerAmount: true,
          commissionPercent: true,
          paymentRef: true,
          payerPhone: true,
          paymentProvider: true,
          confirmedAt: true,
          checkedInAt: true,
          ownerPayoutAmount: true,
          ownerPayoutStatus: true,
          ownerPayoutPaidAt: true,
          ownerPayoutRef: true,
          paymentEvents: {
            orderBy: { createdAt: "desc" },
            take: 10,
            select: { id: true, provider: true, amount: true, currency: true, status: true, paymentChannel: true, phone: true, createdAt: true },
          },
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
          assignedOwner: {
            select: { id: true, name: true, email: true, phone: true },
          },
          confirmedProperty: {
            select: { id: true, title: true, type: true, status: true },
          },
          recommendedPropertyIds: true,
          _count: {
            select: { claims: true },
          },
          claims: {
            select: {
              id: true,
              status: true,
              discountPercent: true,
              offeredPricePerNight: true,
              totalAmount: true,
              currency: true,
              createdAt: true,
              owner: { select: { id: true, name: true, email: true, phone: true } },
              property: { select: { id: true, title: true, type: true, regionName: true, district: true } },
            },
            orderBy: { totalAmount: "asc" },
            take: 3,
          },
          auditLogs: {
            where: { action: { in: ["OPENED_FOR_CLAIMS", "UPDATED_CLAIMS_SETTINGS"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: { metadata: true, createdAt: true, action: true },
          },
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        skip,
        take,
      }),
      (prisma as any).groupBooking.count({ where }),
    ]);

    const hydrated = (items || []).map((gb: any) => {
      const latestAudit = gb.auditLogs?.[0];
      const meta = latestAudit?.metadata;
      const deadline = computeClaimsDeadline(gb.openedForClaimsAt ?? null, meta);
      const parsedMeta = parseJsonish(meta) || {};
      return {
        ...gb,
        claimsCount: Number(gb?._count?.claims ?? 0),
        claimsPreview: gb.claims || [],
        claimsConfig: {
          deadline: deadline ? deadline.toISOString() : null,
          notes: typeof parsedMeta?.notes === "string" ? parsedMeta.notes : null,
          minDiscountPercent:
            parsedMeta?.minDiscountPercent !== undefined && parsedMeta?.minDiscountPercent !== null
              ? Number(parsedMeta.minDiscountPercent)
              : null,
          updatedAt: latestAudit?.createdAt ? new Date(latestAudit.createdAt).toISOString() : null,
        },
      };
    });

    res.json({
      items: hydrated,
      total,
      page,
      pageSize: take,
    });
  } catch (err: any) {
    console.error("Error fetching group stay assignments:", err);
    res.status(500).json({ error: "Failed to fetch assignments" });
  }
});

export default router;

