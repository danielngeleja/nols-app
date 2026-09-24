import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { requireNrmsPropertyCapability } from "../lib/nrmsPropertyAccess.js";
import { audit } from "../lib/audit.js";
import { sanitizeText } from "../lib/sanitize.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

const proposalSchema = z.object({
  roomTypeId: z.number().int().positive(),
  stayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  proposedRate: z.number().positive().max(1_000_000_000),
  reason: z.string().trim().min(5).max(500),
});

router.get("/:propertyId/live-count", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const access = await requireNrmsPropertyCapability(req, res, propertyId, "rates.read");
  if (!access) return;
  const pending = await prisma.nrmsPricingRecommendation.count({
    where: { propertyId, status: "PENDING", factors: { path: "$.source", equals: "SALES_EXECUTIVE" } },
  });
  res.json({ pending, total: pending });
}) as RequestHandler);

router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId);
  const access = await requireNrmsPropertyCapability(req, res, propertyId, "rates.read");
  if (!access) return;
  const [roomTypes, requests] = await Promise.all([
    prisma.roomType.findMany({ where: { propertyId, status: "ACTIVE", baseRate: { not: null } }, select: { id: true, name: true, baseRate: true, currency: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.nrmsPricingRecommendation.findMany({ where: { propertyId, factors: { path: "$.source", equals: "SALES_EXECUTIVE" } }, include: { roomType: { select: { id: true, name: true } } }, orderBy: [{ status: "asc" }, { stayDate: "asc" }], take: 100 }),
  ]);
  const requesterIds = [...new Set(requests.map((request) => Number((request.factors as any)?.requestedById)).filter(Number.isInteger))];
  const requesters = requesterIds.length ? await prisma.user.findMany({ where: { id: { in: requesterIds } }, select: { id: true, name: true, fullName: true, email: true } }) : [];
  const requesterById = new Map(requesters.map((user) => [user.id, user]));
  res.json({
    roomTypes: roomTypes.map((room) => ({ ...room, baseRate: Number(room.baseRate) })),
    requests: requests.map((request) => {
      const factors = request.factors as any;
      return { ...request, currentRate: Number(request.currentRate), proposedRate: Number(request.recommendedRate), requestedBy: requesterById.get(Number(factors?.requestedById)) ?? null, decision: factors?.decision ?? null, factors: undefined };
    }),
  });
}) as RequestHandler);

router.post("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  const parsed = proposalSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Complete the rate proposal", details: parsed.error.flatten() });
  const propertyId = Number(req.params.propertyId);
  const access = await requireNrmsPropertyCapability(req, res, propertyId, "rates.change_request");
  if (!access) return;
  const room = await prisma.roomType.findFirst({ where: { id: parsed.data.roomTypeId, propertyId, status: "ACTIVE", baseRate: { not: null } }, select: { id: true, baseRate: true, currency: true } });
  if (!room) return res.status(404).json({ error: "Active priced room type not found" });
  const stayDate = new Date(`${parsed.data.stayDate}T00:00:00.000Z`);
  if (stayDate < new Date(new Date().toISOString().slice(0, 10))) return res.status(400).json({ error: "Choose today or a future stay date" });
  try {
    // Forecasting and sales proposals share one canonical recommendation slot
    // per room/date. A machine-generated row may therefore already exist even
    // though the sales history is empty. Upsert turns that slot into the human
    // proposal instead of leaking the database uniqueness rule to the user.
    const proposal = {
      propertyId,
      roomTypeId: room.id,
      stayDate,
      currency: room.currency,
      currentRate: room.baseRate!,
      recommendedRate: parsed.data.proposedRate,
      reason: sanitizeText(parsed.data.reason),
      factors: { source: "SALES_EXECUTIVE", requestedById: access.actorId, requestedByRole: access.role },
    };
    const request = await prisma.nrmsPricingRecommendation.upsert({
      where: { roomTypeId_stayDate: { roomTypeId: room.id, stayDate } },
      create: proposal,
      update: {
        propertyId,
        currency: room.currency,
        currentRate: room.baseRate!,
        recommendedRate: parsed.data.proposedRate,
        reason: sanitizeText(parsed.data.reason),
        factors: { source: "SALES_EXECUTIVE", requestedById: access.actorId, requestedByRole: access.role },
        status: "PENDING",
        appliedAt: null,
        dismissedAt: null,
      },
      include: { roomType: { select: { id: true, name: true } } },
    });
    await audit(req, "NRMS_RATE_CHANGE_REQUEST", "NRMS_PRICING_RECOMMENDATION", null, { propertyId, roomTypeId: room.id, stayDate: parsed.data.stayDate, proposedRate: parsed.data.proposedRate }, request.id);
    res.status(201).json({ request: { ...request, currentRate: Number(request.currentRate), proposedRate: Number(request.recommendedRate), factors: undefined } });
  } catch (error: any) {
    console.error("[owner.nrms.rate-requests] create failed", error);
    res.status(500).json({ error: "The rate proposal could not be submitted" });
  }
}) as RequestHandler);

export default router;
