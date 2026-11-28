import { Router, type RequestHandler, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { requireWorkspaceAccess, partnerIdFor } from "../middleware/salesWorkspace.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { rateLimitWithRedis } from "../lib/redisRateLimitStore.js";
import { agencyGateFailure, loadAgencyGateInput } from "../lib/salesAgency.js";
import { EventHireError, sanitizeEventTerms } from "../lib/eventHire.js";
import { isPubliclyHireable } from "../lib/eventHirePublic.js";
import { buildPropertySlug } from "../lib/publicPropertyDto.js";
import { createEventRequest, decideEventRequest, createEventBlock, eventActorScope, eventRequestView, validEventReference, type EventActor } from "../lib/eventHireRequests.js";

const db = prisma as any;
const missing = { error: "Not found" };
const feature: RequestHandler = (_req, res, next) => {
  // No routes become accessible merely because the code was deployed.
  if (process.env.EVENT_HIRE_REQUESTS_ENABLED !== "true") return res.status(404).json(missing);
  res.setHeader("Cache-Control", "private, no-store");
  next();
};
const ipLimit = rateLimitWithRedis({ redisPrefix: "event-requests-ip", windowMs: 15 * 60_000, limit: 200,
  standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests. Please try again later." } });
const accountLimit = rateLimitWithRedis({ windowMs: 15 * 60_000, limit: 100, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => `event-request:${req.user.id}`, message: { error: "Too many requests. Please try again later." } });
const writeLimit = rateLimitWithRedis({ windowMs: 15 * 60_000, limit: 15, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req: any) => `event-request-write:${req.user.id}`, message: { error: "Too many changes. Please try again later." } });
function run(fn: (req: any, res: Response) => Promise<any>): RequestHandler {
  return asyncHandler(async (req, res) => {
    try { return await fn(req, res); }
    catch (error: any) {
      if (error instanceof EventHireError) return res.status(error.status).json({ error: error.message, code: error.code });
      if (["P2021", "P2022"].includes(error?.code)) console.warn("[event-hire] database is behind the schema", { code: error.code, table: error.meta?.table ?? error.meta?.modelName ?? null, column: error.meta?.column ?? null, path: req.path });
      if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({ error: "Event requests are not ready yet." });
      if (["P2034", "P2028"].includes(error?.code)) return res.status(409).json({ error: "Availability changed. Refresh and try again." });
      throw error;
    }
  }) as RequestHandler;
}

// Actor middleware uses Express next explicitly; handlers below share the same
// actor scope for list, detail and mutation. References are not authorisation.
function actorRouter(kind: EventActor["kind"]) {
  const router = Router();
  router.use(ipLimit, requireAuth as RequestHandler, feature);
  if (kind === "CLIENT") router.use(requireRole("USER") as RequestHandler);
  if (kind === "OWNER") router.use(requireRole("OWNER") as RequestHandler);
  if (kind === "ADMIN") router.use(requireAdmin as RequestHandler);
  if (kind === "PARTNER") router.use(requireWorkspaceAccess("SALES"));
  router.use(accountLimit, asyncHandler(async (req: any, res: Response, next: any) => {
    const actor: EventActor = { userId: req.user.id, kind };
    if (kind === "PARTNER") {
      actor.partnerId = partnerIdFor(req) ?? undefined;
      if (!actor.partnerId || agencyGateFailure(await loadAgencyGateInput(db, actor.partnerId))) return res.status(404).json(missing);
    }
    req.eventActor = actor;
    next();
  }) as RequestHandler);
  router.get("/", run(async (req, res) => {
    const propertyId = req.query.propertyId === undefined ? undefined : Number(req.query.propertyId);
    if (propertyId !== undefined && (!Number.isSafeInteger(propertyId) || propertyId <= 0)) return res.status(400).json({ error: "Invalid property" });
    const rows = await db.eventHireRequest.findMany({ where: { ...eventActorScope(req.eventActor), ...(propertyId ? { propertyId } : {}) },
      include: { property: { select: { title: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
    return res.json({ requests: rows.map((row: any) => ({ ...eventRequestView(row), ...(kind === "ADMIN" ? { assignedPartnerId: row.salesPartnerId } : {}) })) });
  }));
  router.get("/:ref", run(async (req, res) => {
    if (!validEventReference(req.params.ref)) return res.status(404).json(missing);
    const row = await db.eventHireRequest.findFirst({ where: { reference: req.params.ref, ...eventActorScope(req.eventActor) },
      include: { property: { select: { title: true, owner: { select: { name: true, phone: true } } } },client:{select:{name:true,fullName:true,phone:true,email:true}}, events: { orderBy: { createdAt: "desc" }, take: 50 } } });
    if (!row) return res.status(404).json(missing);
    return res.json({ ...eventRequestView(row), ...(["ADMIN", "PARTNER"].includes(kind) ? { ownerContact: row.property.owner,clientContact:row.client } : {}), events: row.events.map((e: any) => ({ action: e.action, createdAt: e.createdAt,
      ...(["ADMIN", "PARTNER"].includes(kind) ? { details: e.details } : {}) })) });
  }));
  router.post("/:ref/decide", blockImpersonated as RequestHandler, writeLimit, run(async (req, res) => {
    return res.json(eventRequestView(await decideEventRequest(db, req.eventActor, req.params.ref, req.body)));
  }));
  return router;
}

export const customerEventRequestsRouter = actorRouter("CLIENT");
customerEventRequestsRouter.post("/", blockImpersonated as RequestHandler, writeLimit, run(async (req, res) => {
  const row = await createEventRequest(db, req.eventActor, req.body);
  return res.status(201).json(eventRequestView(row));
}));
export const ownerEventRequestsRouter = actorRouter("OWNER");
export const salesEventRequestsRouter = actorRouter("PARTNER");
export const adminEventRequestsRouter = actorRouter("ADMIN");
adminEventRequestsRouter.get("/assignment/partners", run(async (_req, res) => {
  const candidates = await db.salesPartnerProfile.findMany({ where: { status: "ACTIVE" }, select: { id: true, agentCode: true, user: { select: { name: true } } }, take: 100, orderBy: { id: "asc" } });
  const eligible = await Promise.all(candidates.map(async (p: any) => agencyGateFailure(await loadAgencyGateInput(db, p.id)) ? null : { id: p.id, name: p.user.name, agentCode: p.agentCode }));
  return res.json({ partners: eligible.filter(Boolean) });
}));
customerEventRequestsRouter.get("/venues/approved", run(async (req, res) => {
  const rows = await db.propertyEventHire.findMany({ where: { status: "APPROVED", property: { status: "APPROVED", rentalMode: "NIGHTLY", ownerId: { not: req.user.id } } },
    include: { property: { select: { id: true, title: true, nrmsBookingKey: true } } }, orderBy: { propertyId: "desc" }, take: 100 });
  // Same rule as the public property page (lib/eventHirePublic.ts). The slug lets a
  // "Request this venue" link from that page preselect the venue without an id in the URL.
  return res.json({ venues: rows.filter(isPubliclyHireable).map((r: any) => ({
    propertyId: r.property.id, title: r.property.title, slug: buildPropertySlug(String(r.property.title || ""), String(r.property.nrmsBookingKey || "")), terms: sanitizeEventTerms(r.terms),
  })) });
}));

// Separate router avoids /:ref swallowing property availability routes.
export const ownerEventAvailabilityRouter = Router();
ownerEventAvailabilityRouter.use(ipLimit, requireAuth as RequestHandler, feature, requireRole("OWNER") as RequestHandler, accountLimit);
ownerEventAvailabilityRouter.get("/:id/event-availability", run(async (req, res) => {
  const propertyId = Number(req.params.id);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return res.status(404).json(missing);
  const owned = await db.property.findFirst({ where: { id: propertyId, ownerId: req.user.id }, select: { id: true } });
  if (!owned) return res.status(404).json(missing);
  const now = new Date();
  const blocks = await db.eventHireBlock.findMany({ where: { propertyId, cancelledAt: null, endsAt: { gt: now } }, orderBy: { startsAt: "asc" }, take: 200 });
  return res.json({ blocks: blocks.map((b: any) => ({ reference: b.reference, startsAt: b.startsAt, endsAt: b.endsAt, reason: b.reason })) });
}));
ownerEventAvailabilityRouter.post("/:id/event-availability", blockImpersonated as RequestHandler, writeLimit, run(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(404).json(missing);
  const block = await createEventBlock(db, { kind: "OWNER", userId: req.user.id }, id, req.body);
  return res.status(201).json({ reference: block.reference, startsAt: block.startsAt, endsAt: block.endsAt, reason: block.reason });
}));
ownerEventAvailabilityRouter.delete("/:id/event-availability/:ref", blockImpersonated as RequestHandler, writeLimit, run(async (req, res) => {
  const propertyId = Number(req.params.id);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0 || !/^eb_[A-Za-z0-9_-]{32}$/.test(req.params.ref)) return res.status(404).json(missing);
  const result = await db.eventHireBlock.updateMany({ where: { reference: req.params.ref, propertyId, cancelledAt: null, property: { ownerId: req.user.id } }, data: { cancelledAt: new Date(), cancelledById: req.user.id } });
  if (!result.count) return res.status(404).json(missing);
  return res.status(204).end();
}));
