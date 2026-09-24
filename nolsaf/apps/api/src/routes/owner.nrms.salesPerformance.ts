// apps/api/src/routes/owner.nrms.salesPerformance.ts
//
// GET /property/:propertyId  the sales production report.
//
// This is the first and only reader of `sales.analytics.read`. The capability
// was declared for owner, manager and sales executive and guarded nothing, so
// until now it was vocabulary rather than a permission.
//
// Who sees whom is decided here rather than in the builder, because the role is
// what decides it:
//
//   A sales executive sees their own work and only their own. Not because their
//   colleagues' numbers are secret, but because a league table is a management
//   tool, and handing one to everybody changes what the report is for.
//
//   An owner or a manager sees the sales roster, because they are the people
//   answerable for it.
//
// The scope is returned in the response so the UI states which of the two it
// received instead of guessing from the row count.

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNrmsPropertyCapability } from "../lib/nrmsPropertyAccess.js";
import { buildNrmsSalesPerformance, type SalesPerformanceScope } from "../lib/nrmsSalesPerformance.js";
import { nrmsStaffRoleLabel } from "../lib/nrmsStaffRoles.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

/** Roles answerable for the whole roster rather than for their own desk. */
const ROSTER_WIDE_ROLES: readonly string[] = ["OWNER", "MANAGER"];

/**
 * Who counts as the sales roster.
 *
 * Front desk and outlet staff create reservations and rings up orders, and
 * none of that is sales production: a walk-in checked in at reception was not
 * sold by anybody. Counting them would turn a sales report into a second, worse
 * occupancy report.
 */
const SALES_ROSTER_ROLES: readonly string[] = ["MANAGER", "SALES_EXECUTIVE"];

const MAX_RANGE_DAYS = 366;

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function parseDay(value: string | undefined, fallback: Date): Date | null {
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const propertyId = Number(req.params.propertyId);
    const access = await requireNrmsPropertyCapability(req, res, propertyId, "sales.analytics.read");
    if (!access) return;

    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: "Invalid reporting period" });

    const defaultTo = new Date();
    const defaultFrom = new Date(defaultTo.getTime() - 29 * 86_400_000);
    const to = parseDay(parsed.data.to, defaultTo);
    const from = parseDay(parsed.data.from, defaultFrom);
    if (!from || !to) return res.status(400).json({ error: "Invalid reporting period" });
    if (from.getTime() > to.getTime()) return res.status(400).json({ error: "The period starts after it ends" });
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_RANGE_DAYS) {
      return res.status(400).json({ error: `Report on at most ${MAX_RANGE_DAYS} days at a time` });
    }

    const rosterWide = ROSTER_WIDE_ROLES.includes(access.role);
    const scope: SalesPerformanceScope = rosterWide ? "PROPERTY" : "OWN";

    // The roster, and what each person is called. Read here rather than in the
    // builder so the builder never needs to know what a membership is.
    const memberships = rosterWide
      ? await prisma.nrmsStaffMembership.findMany({
        where: { propertyId, status: "ACTIVE", role: { in: SALES_ROSTER_ROLES as string[] } },
        select: { userId: true, role: true },
        orderBy: { id: "asc" },
      })
      : [];

    const roleByUserId = new Map<number, string>(
      memberships.map((membership: any) => [membership.userId, membership.role]),
    );
    if (rosterWide) roleByUserId.set(access.ownerId, "OWNER");
    else roleByUserId.set(access.actorId, access.role);

    const report = await buildNrmsSalesPerformance({
      propertyId,
      scope,
      from,
      to,
      staffIds: [...roleByUserId.keys()],
      fallbackCurrency: access.property.currency ?? "TZS",
    });

    res.json({
      ...report,
      property: { id: access.property.id, title: access.property.title },
      viewer: { userId: access.actorId, role: access.role },
      people: report.people.map((person) => {
        const role = roleByUserId.get(person.userId) ?? "";
        return { ...person, role, roleLabel: role === "OWNER" ? "Owner" : role ? nrmsStaffRoleLabel(role) : "" };
      }),
    });
  } catch (err) {
    console.error("[owner.nrms.salesPerformance] report failed", err);
    res.status(500).json({ error: "Failed to build the sales performance report" });
  }
}) as RequestHandler);

export default router;
