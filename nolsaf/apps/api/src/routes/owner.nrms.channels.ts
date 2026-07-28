// NRMS channel connections and provider-specific onboarding.
// Provider credentials are verified before persistence, encrypted at rest,
// and never returned to the owner or written to logs.
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { decrypt, encrypt } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { BookingComApiError, bookingComClient, type BookingComCredentials } from "../lib/channels/bookingComClient.js";
import { runBookingComReservationSync } from "../lib/channels/bookingComReservationSync.js";
import { queueBookingComFullAriUpdates, queueBookingComPropertyAriUpdates, runBookingComOutboundDelivery } from "../lib/channels/bookingComDelivery.js";
import { parseBookingResponseHasErrors } from "../lib/channels/bookingComReservations.js";
import { ExpediaApiError, expediaClient, type ExpediaCredentials } from "../lib/channels/expediaClient.js";
import { activeExpediaCredentials, runExpediaReservationSync } from "../lib/channels/expediaReservationSync.js";
import { queueExpediaFullAriUpdates, queueExpediaPropertyAriUpdates, runExpediaOutboundDelivery } from "../lib/channels/expediaDelivery.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler);

const bookingComOnboardingPaused = process.env.BOOKING_COM_ONBOARDING_PAUSED !== "false";

const connectBookingSchema = z.object({
  clientId: z.string().trim().min(1).max(200),
  clientSecret: z.string().min(1).max(500),
  hotelId: z.number().int().positive(),
});

const connectExpediaSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(16).max(500),
  expediaPropertyId: z.string().trim().min(1).max(160),
});

const roomMappingsSchema = z.object({
  mappings: z.array(z.object({
    roomTypeId: z.number().int().positive(),
    externalId: z.string().trim().min(1).max(160),
    externalName: z.string().trim().max(200).optional().nullable(),
  })).min(1).max(500),
});

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format");
const expediaDateOverrideSchema = z.object({
  from: isoDateSchema,
  to: isoDateSchema,
  price: z.number().finite().nonnegative().max(1_000_000_000).optional().nullable(),
  closed: z.boolean().optional().nullable(),
  minimumStay: z.number().int().min(1).max(365).optional().nullable(),
  maximumStay: z.number().int().min(1).max(365).optional().nullable(),
  closedOnArrival: z.boolean().optional().nullable(),
  closedOnDeparture: z.boolean().optional().nullable(),
}).superRefine((value, context) => {
  if (value.to < value.from) context.addIssue({ code: z.ZodIssueCode.custom, path: ["to"], message: "End date must be on or after start date" });
  if (value.minimumStay != null && value.maximumStay != null && value.maximumStay < value.minimumStay) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumStay"], message: "Maximum stay cannot be shorter than minimum stay" });
  }
});

const ariPolicySchema = z.object({
  minAdvanceRes: z.string().trim().max(20).optional().nullable(),
  maxAdvanceRes: z.string().trim().max(20).optional().nullable(),
  minimumStay: z.number().int().min(0).max(365).optional().nullable(),
  minimumStayArrival: z.number().int().min(0).max(365).optional().nullable(),
  maximumStay: z.number().int().min(0).max(365).optional().nullable(),
  maximumStayArrival: z.number().int().min(0).max(365).optional().nullable(),
  exactStayArrival: z.number().int().min(0).max(365).optional().nullable(),
  closedOnArrival: z.boolean().optional().nullable(),
  closedOnDeparture: z.boolean().optional().nullable(),
  pricingMode: z.enum(["BASE", "FIXED", "OFFSET", "MULTIPLIER"]).optional().nullable(),
  pricingValue: z.number().finite().min(-1_000_000_000).max(1_000_000_000).optional().nullable(),
  dateOverrides: z.array(expediaDateOverrideSchema).max(100).optional().nullable(),
}).superRefine((value, context) => {
  if (value.pricingMode && value.pricingMode !== "BASE" && value.pricingValue == null) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pricingValue"], message: "A pricing value is required for the selected pricing mode" });
  }
  if ((value.pricingMode === "FIXED" || value.pricingMode === "MULTIPLIER") && (value.pricingValue ?? 0) < 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["pricingValue"], message: "Fixed prices and multipliers cannot be negative" });
  }
  if (value.minimumStay != null && value.maximumStay != null && value.maximumStay > 0 && value.maximumStay < value.minimumStay) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["maximumStay"], message: "Maximum stay cannot be shorter than minimum stay" });
  }
  const ranges = [...(value.dateOverrides ?? [])].sort((a, b) => a.from.localeCompare(b.from));
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].from <= ranges[index - 1].to) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateOverrides"], message: "Date override ranges must not overlap" });
      break;
    }
  }
});

const rateMappingsSchema = z.object({
  mappings: z.array(z.object({
    roomTypeId: z.number().int().positive(),
    externalId: z.string().trim().min(1).max(160),
    externalName: z.string().trim().max(200).optional().nullable(),
    currency: z.string().trim().length(3).optional().nullable(),
    ariPolicy: ariPolicySchema.optional().nullable(),
  })).min(1).max(1_000),
});

type ProviderConnection = Prisma.ChannelConnectionGetPayload<{
  include: {
    provider: true;
    propertyMapping: true;
    roomMappings: { include: { roomType: { select: { name: true } } } };
    rateMappings: { include: { roomType: { select: { name: true } } } };
  };
}>;

function jsonRecord(value: Prisma.JsonValue): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : {};
}

function connectionPayload(connection: ProviderConnection) {
  return {
    id: connection.id,
    propertyId: connection.propertyId,
    provider: connection.provider ? { code: connection.provider.code, name: connection.provider.name } : null,
    connectionType: connection.connectionType,
    status: connection.status,
    trustTier: connection.trustTier,
    externalPropertyId: connection.externalPropertyId,
    lastInboundAt: connection.lastInboundAt,
    lastOutboundAt: connection.lastOutboundAt,
    lastSuccessAt: connection.lastSuccessAt,
    lastFailureAt: connection.lastFailureAt,
    lastErrorCode: connection.lastErrorCode,
    lastErrorMessage: connection.lastErrorMessage,
    ariEndpointConfigured: connection.provider?.code === "EXPEDIA" ? expediaClient.isAriConfigured() : true,
    propertyMapping: connection.propertyMapping
      ? {
          id: connection.propertyMapping.id,
          externalId: connection.propertyMapping.externalId,
          externalName: connection.propertyMapping.externalName,
          status: connection.propertyMapping.status,
          mappingVersion: connection.propertyMapping.mappingVersion,
          metadata: connection.propertyMapping.metadata,
        }
      : null,
    roomMappings: Array.isArray(connection.roomMappings)
      ? connection.roomMappings.map((mapping) => ({
          id: mapping.id,
          roomTypeId: mapping.roomTypeId,
          roomTypeName: mapping.roomType?.name ?? null,
          externalId: mapping.externalId,
          externalName: mapping.externalName,
          status: mapping.status,
          mappingVersion: mapping.mappingVersion,
        }))
      : [],
      rateMappings: Array.isArray(connection.rateMappings)
      ? connection.rateMappings.map((mapping) => ({
          id: mapping.id,
          roomTypeId: mapping.roomTypeId,
          roomTypeName: mapping.roomType?.name ?? null,
          externalId: mapping.externalId,
          externalName: mapping.externalName,
          currency: mapping.currency,
          ariPolicy: jsonRecord(mapping.metadata).ariPolicy ?? null,
          status: mapping.status,
          mappingVersion: mapping.mappingVersion,
        }))
      : [],
  };
}

async function loadBookingConnection(propertyId: number) {
  return loadProviderConnection(propertyId, "BOOKING_COM");
}

async function loadProviderConnection(propertyId: number, providerCode: string) {
  return prisma.channelConnection.findFirst({
    where: { propertyId, provider: { code: providerCode } },
    include: {
      provider: true,
      propertyMapping: true,
      roomMappings: { include: { roomType: { select: { name: true } } }, orderBy: { id: "asc" } },
      rateMappings: { include: { roomType: { select: { name: true } } }, orderBy: { id: "asc" } },
    },
  });
}

async function readActiveBookingCredentials(connectionId: number): Promise<BookingComCredentials | null> {
  const row = await prisma.channelCredentialVersion.findFirst({
    where: { connectionId, status: "ACTIVE" },
    orderBy: { version: "desc" },
    select: { encryptedData: true },
  });
  if (!row) return null;
  try {
    const parsed = JSON.parse(decrypt(row.encryptedData, { log: false })) as Partial<BookingComCredentials>;
    if (typeof parsed.clientId !== "string" || typeof parsed.clientSecret !== "string") return null;
    return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch {
    return null;
  }
}

function providerFailure(error: unknown) {
  if (error instanceof BookingComApiError) {
    return {
      status: error.status >= 400 && error.status < 500 ? 422 : 502,
      body: {
        error: "Booking.com connection verification failed",
        code: "BOOKING_CONNECTION_FAILED",
        providerCode: error.providerCode ?? null,
      },
    };
  }
  return {
    status: 502,
    body: { error: "Booking.com connection verification failed", code: "BOOKING_CONNECTION_FAILED" },
  };
}

function expediaFailure(error: unknown) {
  return {
    status: error instanceof ExpediaApiError && error.status >= 400 && error.status < 500 ? 422 : 502,
    body: {
      error: "Expedia Group connection verification failed",
      code: "EXPEDIA_CONNECTION_FAILED",
      providerCode: error instanceof ExpediaApiError ? error.providerCode ?? null : null,
      transactionId: error instanceof ExpediaApiError ? error.transactionId ?? null : null,
    },
  };
}

/** GET /api/owner/nrms/channels/:propertyId */
router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connections = await prisma.channelConnection.findMany({
      where: { propertyId: active.property.id as number },
      include: {
        provider: true,
        propertyMapping: true,
        roomMappings: { include: { roomType: { select: { name: true } } }, orderBy: { id: "asc" } },
        rateMappings: { include: { roomType: { select: { name: true } } }, orderBy: { id: "asc" } },
      },
      orderBy: { id: "asc" },
    });
    res.json({ property: active.property, bookingCom: { onboardingPaused: bookingComOnboardingPaused }, expedia: { apiScope: "LODGING_SUPPLY" }, channels: connections.map(connectionPayload) });
  } catch (error) {
    console.error("[owner.nrms.channels] list failed", error);
    res.status(500).json({ error: "Failed to load channel connections" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/channels/:propertyId/booking-com
 * Verifies a token-based Booking.com machine account, then stores it encrypted.
 */
router.post("/:propertyId/booking-com", (async (req: AuthedRequest, res: Response) => {
  const parsed = connectBookingSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Booking.com connection details", details: parsed.error.flatten() });
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    if (bookingComOnboardingPaused) return res.status(503).json({ error: "Booking.com is currently pausing new connectivity-provider integrations", code: "BOOKING_ONBOARDING_PAUSED" });
    const credentials = parsed.data;
    let token;
    try {
      token = await bookingComClient.exchangeToken({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
      const propertyCheck = await bookingComClient.getReservationsSummary(token.jwt, credentials.hotelId);
      if (parseBookingResponseHasErrors(propertyCheck.body)) {
        throw new BookingComApiError("Booking.com credentials do not have access to this hotel", { status: 422 });
      }
    } catch (error) {
      const failure = providerFailure(error);
      return res.status(failure.status).json(failure.body);
    }
    if (!token.jwt) return res.status(502).json({ error: "Booking.com returned no access token", code: "BOOKING_CONNECTION_FAILED" });

    const provider = await prisma.channelProvider.findUnique({ where: { code: "BOOKING_COM" } });
    if (!provider) return res.status(500).json({ error: "Booking.com provider is not configured", code: "CHANNEL_PROVIDER_MISSING" });

    const connection = await prisma.$transaction(async (tx) => {
      const existing = await tx.channelConnection.findUnique({
        where: { propertyId_providerId: { propertyId: active.property.id as number, providerId: provider.id } },
      });
      const saved = existing
        ? await tx.channelConnection.update({
            where: { id: existing.id },
            data: {
              connectionType: "API",
              status: "ACTIVE",
              trustTier: "PILOT",
              externalPropertyId: String(credentials.hotelId),
              lastSuccessAt: new Date(),
              lastFailureAt: null,
              lastErrorCode: null,
              lastErrorMessage: null,
            },
          })
        : await tx.channelConnection.create({
            data: {
              propertyId: active.property.id as number,
              providerId: provider.id,
              connectionType: "API",
              status: "ACTIVE",
              trustTier: "PILOT",
              externalPropertyId: String(credentials.hotelId),
              lastSuccessAt: new Date(),
            },
          });
      const latest = await tx.channelCredentialVersion.findFirst({
        where: { connectionId: saved.id },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      await tx.channelCredentialVersion.updateMany({ where: { connectionId: saved.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
      await tx.channelCredentialVersion.create({
        data: {
          connectionId: saved.id,
          version: (latest?.version ?? 0) + 1,
          status: "ACTIVE",
          encryptedData: encrypt(JSON.stringify({ clientId: credentials.clientId, clientSecret: credentials.clientSecret })),
          validationStatus: "VALIDATED",
          validatedAt: new Date(),
          activatedAt: new Date(),
          createdById: req.user!.id,
        },
      });
      await tx.channelPropertyMapping.upsert({
        where: { connectionId: saved.id },
        create: {
          connectionId: saved.id,
          externalId: String(credentials.hotelId),
          status: "MAPPED",
          createdById: req.user!.id,
        },
        update: {
          externalId: String(credentials.hotelId),
          status: "MAPPED",
          mappingVersion: { increment: 1 },
          createdById: req.user!.id,
        },
      });
      return saved;
    });
    await audit(req, "NRMS_BOOKING_COM_CONNECTED", "PROPERTY", undefined, { propertyId: active.property.id, channelConnectionId: connection.id });
    const fresh = await loadBookingConnection(active.property.id as number);
    res.status(201).json({ connection: fresh ? connectionPayload(fresh) : { id: connection.id } });
  } catch (error) {
    console.error("[owner.nrms.channels] Booking.com connect failed", error);
    res.status(500).json({ error: "Failed to save Booking.com connection" });
  }
}) as RequestHandler);

/** POST /api/owner/nrms/channels/:propertyId/booking-com/test */
router.post("/:propertyId/booking-com/test", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected", code: "BOOKING_CONNECTION_MISSING" });
    const credentials = await readActiveBookingCredentials(connection.id);
    if (!credentials) return res.status(409).json({ error: "Booking.com credentials are unavailable", code: "BOOKING_CREDENTIALS_UNAVAILABLE" });
    try {
      const token = await bookingComClient.exchangeToken(credentials);
      const hotelId = Number(connection.externalPropertyId);
      if (!Number.isInteger(hotelId) || hotelId <= 0) return res.status(409).json({ error: "Booking.com hotel ID is unavailable", code: "BOOKING_HOTEL_ID_UNAVAILABLE" });
      const propertyCheck = await bookingComClient.getReservationsSummary(token.jwt, hotelId);
      if (parseBookingResponseHasErrors(propertyCheck.body)) throw new BookingComApiError("Booking.com hotel access verification failed", { status: 422 });
      await prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE", lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } });
      res.json({ ok: true, status: "ACTIVE", trustTier: connection.trustTier });
    } catch (error) {
      const failure = providerFailure(error);
      await prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastFailureAt: new Date(), lastErrorCode: error instanceof BookingComApiError ? error.providerCode ?? "PROVIDER_ERROR" : "PROVIDER_ERROR", lastErrorMessage: "Booking.com verification failed" } });
      res.status(failure.status).json(failure.body);
    }
  } catch (error) {
    console.error("[owner.nrms.channels] Booking.com test failed", error);
    res.status(500).json({ error: "Failed to test Booking.com connection" });
  }
}) as RequestHandler);

/** POST /api/owner/nrms/channels/:propertyId/booking-com/sync/reservations */
router.post("/:propertyId/booking-com/sync/reservations", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected", code: "BOOKING_CONNECTION_MISSING" });
    const result = await runBookingComReservationSync(connection.id);
    res.json({ ok: result.failed === 0, result });
  } catch (error) {
    console.error("[owner.nrms.channels] reservation sync failed", error);
    res.status(500).json({ error: "Failed to synchronize Booking.com reservations" });
  }
}) as RequestHandler);

/** Queue a twelve-month, monthly-batched Booking.com availability/rates/restrictions resync. */
router.post("/:propertyId/booking-com/sync/ari", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected", code: "BOOKING_CONNECTION_MISSING" });
    const queued = await queueBookingComFullAriUpdates(connection.id);
    const delivery = await runBookingComOutboundDelivery(new Date(), connection.id);
    res.json({ ok: delivery.failed === 0, queued, delivery });
  } catch (error) {
    console.error("[owner.nrms.channels] ARI sync failed", error);
    res.status(500).json({ error: "Failed to synchronize Booking.com availability and rates" });
  }
}) as RequestHandler);

/** GET the owner-facing channel sync command center snapshot. */
router.get("/:propertyId/booking-com/command-center", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.json({ connection: null, summary: null, runs: [], deliveries: [], issues: [] });
    const [inbound, outbound, issues, runs, deliveries] = await Promise.all([
      prisma.channelInboundEvent.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
      prisma.channelOutboundDelivery.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
      prisma.channelReconciliationIssue.findMany({ where: { connectionId: connection.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 50 }),
      prisma.channelSyncRun.findMany({ where: { connectionId: connection.id }, orderBy: { startedAt: "desc" }, take: 20 }),
      prisma.channelOutboundDelivery.findMany({ where: { connectionId: connection.id }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, eventType: true, status: true, attemptCount: true, nextAttemptAt: true, lastAttemptAt: true, acknowledgedAt: true, lastError: true, createdAt: true, updatedAt: true } }),
    ]);
    const counts = (rows: Array<{ status: string; _count: { _all: number } }>) => Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    res.json({
      connection: connectionPayload(connection),
      summary: {
        inbound: counts(inbound),
        outbound: counts(outbound),
        openIssues: issues.length,
        criticalIssues: issues.filter((issue) => issue.severity === "CRITICAL").length,
      },
      runs,
      deliveries,
      issues,
    });
  } catch (error) {
    console.error("[owner.nrms.channels] command center failed", error);
    res.status(500).json({ error: "Failed to load channel synchronization status" });
  }
}) as RequestHandler);

router.post("/:propertyId/booking-com/command-center/deliveries/:deliveryId/retry", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected" });
    const delivery = await prisma.channelOutboundDelivery.findFirst({ where: { id: Number(req.params.deliveryId), connectionId: connection.id } });
    if (!delivery) return res.status(404).json({ error: "Delivery was not found" });
    await prisma.channelOutboundDelivery.update({ where: { id: delivery.id }, data: { status: "PENDING", nextAttemptAt: new Date(), lastError: null } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[owner.nrms.channels] delivery retry failed", error);
    res.status(500).json({ error: "Failed to retry channel delivery" });
  }
}) as RequestHandler);

router.post("/:propertyId/booking-com/command-center/issues/:issueId/resolve", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected" });
    const issue = await prisma.channelReconciliationIssue.findFirst({ where: { id: Number(req.params.issueId), connectionId: connection.id } });
    if (!issue) return res.status(404).json({ error: "Reconciliation issue was not found" });
    await prisma.channelReconciliationIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: req.user!.id } });
    res.json({ ok: true });
  } catch (error) {
    console.error("[owner.nrms.channels] issue resolve failed", error);
    res.status(500).json({ error: "Failed to resolve reconciliation issue" });
  }
}) as RequestHandler);

/** POST /api/owner/nrms/channels/:propertyId/booking-com/mappings/rooms */
router.post("/:propertyId/booking-com/mappings/rooms", (async (req: AuthedRequest, res: Response) => {
  const parsed = roomMappingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Booking.com room mappings", details: parsed.error.flatten() });
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected", code: "BOOKING_CONNECTION_MISSING" });
    const roomTypeIds = parsed.data.mappings.map((mapping) => mapping.roomTypeId);
    const roomTypes = await prisma.roomType.findMany({ where: { propertyId: active.property.id as number, id: { in: roomTypeIds } }, select: { id: true } });
    if (roomTypes.length !== new Set(roomTypeIds).size) return res.status(400).json({ error: "Every room type must belong to this property" });
    await prisma.$transaction(async (tx) => {
      const retainedIds: number[] = [];
      for (const mapping of parsed.data.mappings) {
        const saved = await tx.channelRoomMapping.upsert({
          where: { connectionId_roomTypeId: { connectionId: connection.id, roomTypeId: mapping.roomTypeId } },
          create: { connectionId: connection.id, roomTypeId: mapping.roomTypeId, externalId: mapping.externalId, externalName: mapping.externalName ?? null, status: "MAPPED" },
          update: { externalId: mapping.externalId, externalName: mapping.externalName ?? null, status: "MAPPED", mappingVersion: { increment: 1 } },
        });
        retainedIds.push(saved.id);
      }
      await tx.channelRoomMapping.updateMany({ where: { connectionId: connection.id, id: { notIn: retainedIds } }, data: { status: "INVALID" } });
      await queueBookingComPropertyAriUpdates(tx, active.property.id as number, "room-mapping-change");
    });
    const fresh = await loadBookingConnection(active.property.id as number);
    res.json({ connection: fresh ? connectionPayload(fresh) : null });
  } catch (error) {
    console.error("[owner.nrms.channels] room mapping failed", error);
    res.status(500).json({ error: "Failed to save Booking.com room mappings" });
  }
}) as RequestHandler);

/** POST /api/owner/nrms/channels/:propertyId/booking-com/mappings/rates */
router.post("/:propertyId/booking-com/mappings/rates", (async (req: AuthedRequest, res: Response) => {
  const parsed = rateMappingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Booking.com rate mappings", details: parsed.error.flatten() });
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected", code: "BOOKING_CONNECTION_MISSING" });
    const roomTypeIds = parsed.data.mappings.map((mapping) => mapping.roomTypeId);
    const roomTypes = await prisma.roomType.findMany({ where: { propertyId: active.property.id as number, id: { in: roomTypeIds } }, select: { id: true } });
    if (roomTypes.length !== new Set(roomTypeIds).size) return res.status(400).json({ error: "Every mapped rate room type must belong to this property" });
    await prisma.$transaction(async (tx) => {
      const retainedIds: number[] = [];
      for (const mapping of parsed.data.mappings) {
        const saved = await tx.channelRateMapping.upsert({
          where: { connectionId_externalId: { connectionId: connection.id, externalId: mapping.externalId } },
          create: { connectionId: connection.id, roomTypeId: mapping.roomTypeId, externalId: mapping.externalId, externalName: mapping.externalName ?? null, currency: mapping.currency?.toUpperCase() ?? null, metadata: mapping.ariPolicy ? { ariPolicy: mapping.ariPolicy } : undefined, status: "MAPPED" },
          update: { roomTypeId: mapping.roomTypeId, externalName: mapping.externalName ?? null, currency: mapping.currency?.toUpperCase() ?? null, metadata: mapping.ariPolicy ? { ariPolicy: mapping.ariPolicy } : undefined, status: "MAPPED", mappingVersion: { increment: 1 } },
        });
        retainedIds.push(saved.id);
      }
      await tx.channelRateMapping.updateMany({ where: { connectionId: connection.id, id: { notIn: retainedIds } }, data: { status: "INVALID" } });
      await queueBookingComPropertyAriUpdates(tx, active.property.id as number, "rate-mapping-change");
    });
    const fresh = await loadBookingConnection(active.property.id as number);
    res.json({ connection: fresh ? connectionPayload(fresh) : null });
  } catch (error) {
    console.error("[owner.nrms.channels] rate mapping failed", error);
    res.status(500).json({ error: "Failed to save Booking.com rate mappings" });
  }
}) as RequestHandler);

/** POST /api/owner/nrms/channels/:propertyId/booking-com/disconnect */
router.post("/:propertyId/booking-com/disconnect", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadBookingConnection(active.property.id as number);
    if (!connection) return res.status(404).json({ error: "Booking.com is not connected", code: "BOOKING_CONNECTION_MISSING" });
    await prisma.$transaction([
      prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", trustTier: "UNTRUSTED", lastErrorCode: null, lastErrorMessage: null } }),
      prisma.channelCredentialVersion.updateMany({ where: { connectionId: connection.id, status: { in: ["ACTIVE", "STAGED"] } }, data: { status: "REVOKED", revokedAt: new Date() } }),
    ]);
    await audit(req, "NRMS_BOOKING_COM_DISCONNECTED", "PROPERTY", undefined, { propertyId: active.property.id, channelConnectionId: connection.id });
    res.json({ ok: true, status: "DISCONNECTED" });
  } catch (error) {
    console.error("[owner.nrms.channels] disconnect failed", error);
    res.status(500).json({ error: "Failed to disconnect Booking.com" });
  }
}) as RequestHandler);

/** Verify Expedia lodging-supply credentials and persist one encrypted version. */
router.post("/:propertyId/expedia", (async (req: AuthedRequest, res: Response) => {
  const parsed = connectExpediaSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Expedia connection details", details: parsed.error.flatten() });
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const credentials: ExpediaCredentials = { username: parsed.data.username, password: parsed.data.password };
    try {
      const token = await expediaClient.exchangeToken(credentials);
      await expediaClient.verifyProperty(token.accessToken, parsed.data.expediaPropertyId);
    } catch (error) {
      const failure = expediaFailure(error);
      return res.status(failure.status).json(failure.body);
    }
    const provider = await prisma.channelProvider.findUnique({ where: { code: "EXPEDIA" } });
    if (!provider) return res.status(500).json({ error: "Expedia provider is not configured", code: "CHANNEL_PROVIDER_MISSING" });
    const connection = await prisma.$transaction(async (tx) => {
      const existing = await tx.channelConnection.findUnique({ where: { propertyId_providerId: { propertyId: active.property.id as number, providerId: provider.id } } });
      const saved = existing
        ? await tx.channelConnection.update({ where: { id: existing.id }, data: { connectionType: "API", status: "ACTIVE", trustTier: "PILOT", externalPropertyId: parsed.data.expediaPropertyId, lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } })
        : await tx.channelConnection.create({ data: { propertyId: active.property.id as number, providerId: provider.id, connectionType: "API", status: "ACTIVE", trustTier: "PILOT", externalPropertyId: parsed.data.expediaPropertyId, lastSuccessAt: new Date() } });
      const latest = await tx.channelCredentialVersion.findFirst({ where: { connectionId: saved.id }, orderBy: { version: "desc" }, select: { version: true } });
      await tx.channelCredentialVersion.updateMany({ where: { connectionId: saved.id, status: "ACTIVE" }, data: { status: "REVOKED", revokedAt: new Date() } });
      await tx.channelCredentialVersion.create({ data: { connectionId: saved.id, version: (latest?.version ?? 0) + 1, status: "ACTIVE", encryptedData: encrypt(JSON.stringify(credentials)), validationStatus: "VALIDATED", validatedAt: new Date(), activatedAt: new Date(), createdById: req.user!.id } });
      await tx.channelPropertyMapping.upsert({ where: { connectionId: saved.id }, create: { connectionId: saved.id, externalId: parsed.data.expediaPropertyId, status: "MAPPED", createdById: req.user!.id }, update: { externalId: parsed.data.expediaPropertyId, status: "MAPPED", mappingVersion: { increment: 1 }, createdById: req.user!.id } });
      return saved;
    });
    await audit(req, "NRMS_EXPEDIA_CONNECTED", "PROPERTY", undefined, { propertyId: active.property.id, channelConnectionId: connection.id });
    const fresh = await loadProviderConnection(active.property.id as number, "EXPEDIA");
    res.status(201).json({ connection: fresh ? connectionPayload(fresh) : { id: connection.id }, ariEndpointConfigured: Boolean(process.env.EXPEDIA_ARI_URL) });
  } catch (error) {
    console.error("[owner.nrms.channels] Expedia connect failed", error);
    res.status(500).json({ error: "Failed to save Expedia connection" });
  }
}) as RequestHandler);

router.post("/:propertyId/expedia/test", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
    if (!connection) return res.status(404).json({ error: "Expedia is not connected", code: "EXPEDIA_CONNECTION_MISSING" });
    const credentials = await activeExpediaCredentials(connection.id);
    if (!credentials) return res.status(409).json({ error: "Expedia credentials are unavailable", code: "EXPEDIA_CREDENTIALS_UNAVAILABLE" });
    try {
      const token = await expediaClient.exchangeToken(credentials);
      await expediaClient.verifyProperty(token.accessToken, String(connection.externalPropertyId));
      await prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "ACTIVE", lastSuccessAt: new Date(), lastFailureAt: null, lastErrorCode: null, lastErrorMessage: null } });
      res.json({ ok: true, status: "ACTIVE", trustTier: connection.trustTier, graphql: "VERIFIED", ari: process.env.EXPEDIA_ARI_URL ? "CONFIGURED" : "AWAITING_ENROLLMENT_ENDPOINT" });
    } catch (error) {
      const failure = expediaFailure(error);
      await prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "ERROR", lastFailureAt: new Date(), lastErrorCode: error instanceof ExpediaApiError ? error.providerCode ?? "PROVIDER_ERROR" : "PROVIDER_ERROR", lastErrorMessage: "Expedia verification failed" } });
      res.status(failure.status).json(failure.body);
    }
  } catch (error) {
    console.error("[owner.nrms.channels] Expedia test failed", error);
    res.status(500).json({ error: "Failed to test Expedia connection" });
  }
}) as RequestHandler);

router.post("/:propertyId/expedia/sync/reservations", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
    if (!connection) return res.status(404).json({ error: "Expedia is not connected", code: "EXPEDIA_CONNECTION_MISSING" });
    const result = await runExpediaReservationSync(connection.id);
    res.json({ ok: result.failed === 0, result });
  } catch (error) {
    console.error("[owner.nrms.channels] Expedia reservation sync failed", error);
    res.status(500).json({ error: "Failed to synchronize Expedia reservations" });
  }
}) as RequestHandler);

router.post("/:propertyId/expedia/sync/ari", (async (req: AuthedRequest, res: Response) => {
  try {
    if (!expediaClient.isAriConfigured()) return res.status(409).json({ error: "Expedia has not assigned an Availability and Rates endpoint to this environment", code: "ARI_ENDPOINT_MISSING" });
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
    if (!connection) return res.status(404).json({ error: "Expedia is not connected", code: "EXPEDIA_CONNECTION_MISSING" });
    const queued = await queueExpediaFullAriUpdates(connection.id);
    const delivery = await runExpediaOutboundDelivery(new Date(), connection.id);
    res.json({ ok: delivery.failed === 0, queued, delivery });
  } catch (error) {
    console.error("[owner.nrms.channels] Expedia ARI sync failed", error);
    res.status(500).json({ error: "Failed to synchronize Expedia availability and rates" });
  }
}) as RequestHandler);

router.get("/:propertyId/expedia/command-center", (async (req: AuthedRequest, res: Response) => {
  try {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
    if (!active) return;
    const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
    if (!connection) return res.json({ connection: null, summary: null, runs: [], deliveries: [], issues: [] });
    const [inbound, outbound, issues, runs, deliveries] = await Promise.all([
      prisma.channelInboundEvent.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
      prisma.channelOutboundDelivery.groupBy({ by: ["status"], where: { connectionId: connection.id }, _count: { _all: true } }),
      prisma.channelReconciliationIssue.findMany({ where: { connectionId: connection.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } }, orderBy: [{ severity: "desc" }, { lastSeenAt: "desc" }], take: 50 }),
      prisma.channelSyncRun.findMany({ where: { connectionId: connection.id }, orderBy: { startedAt: "desc" }, take: 20 }),
      prisma.channelOutboundDelivery.findMany({ where: { connectionId: connection.id }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, eventType: true, status: true, attemptCount: true, nextAttemptAt: true, lastAttemptAt: true, acknowledgedAt: true, lastError: true, createdAt: true, updatedAt: true } }),
    ]);
    const counts = (rows: Array<{ status: string; _count: { _all: number } }>) => Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
    res.json({ connection: connectionPayload(connection), summary: { inbound: counts(inbound), outbound: counts(outbound), openIssues: issues.length, criticalIssues: issues.filter((row) => row.severity === "CRITICAL").length }, runs, deliveries, issues });
  } catch (error) {
    console.error("[owner.nrms.channels] Expedia command center failed", error);
    res.status(500).json({ error: "Failed to load Expedia synchronization status" });
  }
}) as RequestHandler);

router.post("/:propertyId/expedia/command-center/deliveries/:deliveryId/retry", (async (req: AuthedRequest, res: Response) => {
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
  if (!active) return;
  const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  if (!connection) return res.status(404).json({ error: "Expedia is not connected" });
  const delivery = await prisma.channelOutboundDelivery.findFirst({ where: { id: Number(req.params.deliveryId), connectionId: connection.id } });
  if (!delivery) return res.status(404).json({ error: "Delivery was not found" });
  await prisma.channelOutboundDelivery.update({ where: { id: delivery.id }, data: { status: "PENDING", nextAttemptAt: new Date(), lastError: null } });
  res.json({ ok: true });
}) as RequestHandler);

router.post("/:propertyId/expedia/command-center/issues/:issueId/resolve", (async (req: AuthedRequest, res: Response) => {
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
  if (!active) return;
  const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  if (!connection) return res.status(404).json({ error: "Expedia is not connected" });
  const issue = await prisma.channelReconciliationIssue.findFirst({ where: { id: Number(req.params.issueId), connectionId: connection.id } });
  if (!issue) return res.status(404).json({ error: "Reconciliation issue was not found" });
  await prisma.channelReconciliationIssue.update({ where: { id: issue.id }, data: { status: "RESOLVED", resolvedAt: new Date(), resolvedById: req.user!.id } });
  res.json({ ok: true });
}) as RequestHandler);

router.post("/:propertyId/expedia/mappings/rooms", (async (req: AuthedRequest, res: Response) => {
  const parsed = roomMappingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Expedia room mappings", details: parsed.error.flatten() });
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
  if (!active) return;
  const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  if (!connection) return res.status(404).json({ error: "Expedia is not connected", code: "EXPEDIA_CONNECTION_MISSING" });
  const roomTypeIds = parsed.data.mappings.map((row) => row.roomTypeId);
  const rooms = await prisma.roomType.findMany({ where: { propertyId: active.property.id as number, id: { in: roomTypeIds } }, select: { id: true } });
  if (rooms.length !== new Set(roomTypeIds).size) return res.status(400).json({ error: "Every room type must belong to this property" });
  await prisma.$transaction(async (tx) => {
    const retained: number[] = [];
    for (const mapping of parsed.data.mappings) {
      const saved = await tx.channelRoomMapping.upsert({ where: { connectionId_roomTypeId: { connectionId: connection.id, roomTypeId: mapping.roomTypeId } }, create: { connectionId: connection.id, roomTypeId: mapping.roomTypeId, externalId: mapping.externalId, externalName: mapping.externalName ?? null, status: "MAPPED" }, update: { externalId: mapping.externalId, externalName: mapping.externalName ?? null, status: "MAPPED", mappingVersion: { increment: 1 } } });
      retained.push(saved.id);
    }
    await tx.channelRoomMapping.updateMany({ where: { connectionId: connection.id, id: { notIn: retained } }, data: { status: "INVALID" } });
    await queueExpediaPropertyAriUpdates(tx, active.property.id as number, "room-mapping-change");
  });
  const fresh = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  res.json({ connection: fresh ? connectionPayload(fresh) : null });
}) as RequestHandler);

router.post("/:propertyId/expedia/mappings/rates", (async (req: AuthedRequest, res: Response) => {
  const parsed = rateMappingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid Expedia rate mappings", details: parsed.error.flatten() });
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
  if (!active) return;
  const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  if (!connection) return res.status(404).json({ error: "Expedia is not connected", code: "EXPEDIA_CONNECTION_MISSING" });
  const roomTypeIds = parsed.data.mappings.map((row) => row.roomTypeId);
  const rooms = await prisma.roomType.findMany({ where: { propertyId: active.property.id as number, id: { in: roomTypeIds } }, select: { id: true } });
  if (rooms.length !== new Set(roomTypeIds).size) return res.status(400).json({ error: "Every mapped rate room type must belong to this property" });
  await prisma.$transaction(async (tx) => {
    const retained: number[] = [];
    for (const mapping of parsed.data.mappings) {
      const saved = await tx.channelRateMapping.upsert({ where: { connectionId_externalId: { connectionId: connection.id, externalId: mapping.externalId } }, create: { connectionId: connection.id, roomTypeId: mapping.roomTypeId, externalId: mapping.externalId, externalName: mapping.externalName ?? null, currency: mapping.currency?.toUpperCase() ?? null, metadata: mapping.ariPolicy ? { ariPolicy: mapping.ariPolicy } : undefined, status: "MAPPED" }, update: { roomTypeId: mapping.roomTypeId, externalName: mapping.externalName ?? null, currency: mapping.currency?.toUpperCase() ?? null, metadata: mapping.ariPolicy ? { ariPolicy: mapping.ariPolicy } : undefined, status: "MAPPED", mappingVersion: { increment: 1 } } });
      retained.push(saved.id);
    }
    await tx.channelRateMapping.updateMany({ where: { connectionId: connection.id, id: { notIn: retained } }, data: { status: "INVALID" } });
    await queueExpediaPropertyAriUpdates(tx, active.property.id as number, "rate-mapping-change");
  });
  const fresh = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  res.json({ connection: fresh ? connectionPayload(fresh) : null });
}) as RequestHandler);

router.post("/:propertyId/expedia/disconnect", (async (req: AuthedRequest, res: Response) => {
  const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, Number(req.params.propertyId));
  if (!active) return;
  const connection = await loadProviderConnection(active.property.id as number, "EXPEDIA");
  if (!connection) return res.status(404).json({ error: "Expedia is not connected", code: "EXPEDIA_CONNECTION_MISSING" });
  await prisma.$transaction([
    prisma.channelConnection.update({ where: { id: connection.id }, data: { status: "DISCONNECTED", trustTier: "UNTRUSTED", lastErrorCode: null, lastErrorMessage: null } }),
    prisma.channelCredentialVersion.updateMany({ where: { connectionId: connection.id, status: { in: ["ACTIVE", "STAGED"] } }, data: { status: "REVOKED", revokedAt: new Date() } }),
  ]);
  await audit(req, "NRMS_EXPEDIA_DISCONNECTED", "PROPERTY", undefined, { propertyId: active.property.id, channelConnectionId: connection.id });
  res.json({ ok: true, status: "DISCONNECTED" });
}) as RequestHandler);

export default router;
