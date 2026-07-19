// apps/api/src/routes/owner.nrms.rooms.ts
// NRMS normalized room inventory: room types + room units (doc 7.1, 9.2)
// and roomsSpec reconciliation/import (doc 10.4). NRMS-only APIs guarded by
// requireNrms; Property.roomsSpec stays untouched until all reads migrate.
import { Router, type Response } from "express";
import type { RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { requireNrms, loadOwnedProperty } from "../lib/nrms.js";
import { sanitizeText } from "../lib/sanitize.js";
import { checkNrmsQuota } from "../lib/nrmsQuotas.js";

export const router = Router();

router.use(requireAuth as RequestHandler, requireRole("OWNER") as RequestHandler, requireNrms as RequestHandler);

const ROOM_UNIT_STATUSES = ["ACTIVE", "INACTIVE", "MAINTENANCE", "OUT_OF_SERVICE"] as const;

const roomTypeCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(2000).optional().nullable(),
  capacityAdults: z.number().int().min(1).max(50).optional(),
  capacityChildren: z.number().int().min(0).max(50).optional(),
  bedSetup: z.string().max(200).optional().nullable(),
  baseRate: z.number().nonnegative().optional().nullable(),
  currency: z.string().trim().length(3).optional(),
  images: z.array(z.string().url().max(500)).max(30).optional(),
  amenities: z.array(z.string().max(120)).max(60).optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
});

const roomTypeUpdateSchema = roomTypeCreateSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
});

const roomUnitCreateSchema = z.object({
  roomTypeId: z.number().int().positive(),
  code: z.string().trim().min(1).max(30),
  floor: z.number().int().min(-5).max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  bedCount: z.number().int().min(1).max(20).default(1),
});

const roomUnitUpdateSchema = z.object({
  roomTypeId: z.number().int().positive().optional(),
  code: z.string().trim().min(1).max(30).optional(),
  floor: z.number().int().min(-5).max(200).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
  status: z.enum(ROOM_UNIT_STATUSES).optional(),
  statusReason: z.string().max(300).optional().nullable(),
  bedCount: z.number().int().min(1).max(20).optional(),
});

type SpecEntry = { key: string; name: string; expectedUnits: number; baseRate: number | null; bedSetup: string | null; description: string | null; images: string[]; amenities: string[]; unitFloors: Array<number | null> };

/** Parse Property.roomsSpec into normalized candidate room types (doc 10.4). */
function parseRoomsSpec(roomsSpec: unknown): SpecEntry[] {
  if (!roomsSpec) return [];
  let spec: unknown = roomsSpec;
  if (typeof spec === "string") {
    try {
      spec = JSON.parse(spec);
    } catch {
      return [];
    }
  }
  const rooms = Array.isArray(spec)
    ? spec
    : spec && typeof spec === "object" && Array.isArray((spec as { rooms?: unknown[] }).rooms)
      ? (spec as { rooms: unknown[] }).rooms
      : [];
  const entries: SpecEntry[] = [];
  for (const raw of rooms) {
    if (!raw || typeof raw !== "object") continue;
    const room = raw as Record<string, unknown>;
    const name = String(room.roomType ?? room.type ?? "").trim();
    if (!name) continue;
    const count = Number(room.roomsCount ?? room.count ?? 1);
    const price = Number(room.pricePerNight ?? room.price ?? NaN);
    const bedMap = room.beds && typeof room.beds === "object" ? room.beds as Record<string, unknown> : null;
    const beds = bedMap
      ? Object.entries(bedMap).filter(([, value]) => Number(value) > 0).map(([name, value]) => `${Number(value)} ${name}`).join(", ")
      : room.bedsPerRoom != null ? `${String(room.bedsPerRoom)} bed(s) per room` : null;
    const floorDistribution = room.floorDistribution && typeof room.floorDistribution === "object" ? room.floorDistribution as Record<string, unknown> : {};
    const unitFloors: Array<number | null> = [];
    for (const [floor, units] of Object.entries(floorDistribution)) {
      for (let i = 0; i < Math.max(0, Math.floor(Number(units) || 0)); i++) unitFloors.push(Number(floor));
    }
    while (unitFloors.length < (Number.isFinite(count) && count > 0 ? Math.floor(count) : 1)) unitFloors.push(null);
    entries.push({
      key: name,
      name,
      expectedUnits: Number.isFinite(count) && count > 0 ? Math.floor(count) : 1,
      baseRate: Number.isFinite(price) && price >= 0 ? price : null,
      bedSetup: beds || null,
      description: room.roomDescription ? String(room.roomDescription) : null,
      images: Array.isArray(room.roomImages) ? room.roomImages.map(String).filter(Boolean) : [],
      amenities: [
        ...(Array.isArray(room.otherAmenities) ? room.otherAmenities.map(String) : []),
        ...(room.bathPrivate === "yes" ? ["Private bathroom"] : []),
        ...(room.smoking === "yes" ? ["Smoking allowed"] : []),
      ],
      unitFloors,
    });
  }
  return entries;
}

function formatRoomType(type: any) {
  return {
    id: type.id,
    propertyId: type.propertyId,
    name: type.name,
    description: type.description,
    capacityAdults: type.capacityAdults,
    capacityChildren: type.capacityChildren,
    bedSetup: type.bedSetup,
    baseRate: type.baseRate != null ? Number(type.baseRate) : null,
    currency: type.currency,
    images: type.images ?? [],
    amenities: type.amenities ?? [],
    status: type.status,
    sortOrder: type.sortOrder,
    sourceSpecKey: type.sourceSpecKey,
    units: Array.isArray(type.units) ? type.units.map(formatRoomUnit) : undefined,
    createdAt: type.createdAt,
    updatedAt: type.updatedAt,
  };
}

function formatRoomUnit(unit: any) {
  return {
    id: unit.id,
    propertyId: unit.propertyId,
    roomTypeId: unit.roomTypeId,
    code: unit.code,
    floor: unit.floor,
    status: unit.status,
    notes: unit.notes,
    bedCount: unit.bedCount,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  };
}

/** Load a room type and verify tenancy through its property. */
async function loadOwnedRoomType(res: Response, ownerId: number, roomTypeId: number) {
  if (!Number.isInteger(roomTypeId) || roomTypeId <= 0) {
    res.status(400).json({ error: "Invalid room type id" });
    return null;
  }
  const type = await prisma.roomType.findFirst({
    where: { id: roomTypeId, property: { ownerId } },
    include: { _count: { select: { units: true, allocations: true } } },
  });
  if (!type) {
    res.status(404).json({ error: "Room type not found" });
    return null;
  }
  return type;
}

async function loadOwnedRoomUnit(res: Response, ownerId: number, roomUnitId: number) {
  if (!Number.isInteger(roomUnitId) || roomUnitId <= 0) {
    res.status(400).json({ error: "Invalid room unit id" });
    return null;
  }
  const unit = await prisma.roomUnit.findFirst({
    where: { id: roomUnitId, property: { ownerId } },
  });
  if (!unit) {
    res.status(404).json({ error: "Room unit not found" });
    return null;
  }
  return unit;
}

/**
 * GET /api/owner/nrms/rooms/:propertyId
 * Room types with their units for one owned property.
 */
router.get("/:propertyId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const property = await loadOwnedProperty(res, ownerId, Number(req.params.propertyId), {
      id: true,
      title: true,
      nrmsActivatedAt: true,
    });
    if (!property) return;

    const types = await prisma.roomType.findMany({
      where: { propertyId: property.id as number },
      include: { units: { orderBy: { code: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    });
    const unitCount = types.reduce((sum, t) => sum + t.units.length, 0);
    res.json({
      property,
      roomTypes: types.map(formatRoomType),
      totals: {
        roomTypes: types.length,
        roomUnits: unitCount,
        sellableUnits: types
          .filter((t) => t.status === "ACTIVE")
          .reduce((sum, t) => sum + t.units.filter((u) => u.status === "ACTIVE").length, 0),
      },
    });
  } catch (err) {
    console.error("[owner.nrms.rooms] list failed", err);
    res.status(500).json({ error: "Failed to load rooms" });
  }
}) as RequestHandler);

/**
 * GET /api/owner/nrms/rooms/:propertyId/reconciliation
 * Compares Property.roomsSpec against normalized inventory (doc 10.4).
 * Read-only report; activation UIs use this to show mismatch warnings.
 */
router.get("/:propertyId/reconciliation", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const property = await loadOwnedProperty(res, ownerId, Number(req.params.propertyId));
    if (!property) return;

    const specEntries = parseRoomsSpec((property as { roomsSpec?: unknown }).roomsSpec);
    const types = await prisma.roomType.findMany({
      where: { propertyId: property.id as number },
      include: { _count: { select: { units: true } } },
    });

    const byKey = new Map<string, (typeof types)[number]>(
      types.filter((t) => t.sourceSpecKey).map((t) => [t.sourceSpecKey as string, t]),
    );
    const byName = new Map<string, (typeof types)[number]>(types.map((t) => [t.name.toLowerCase(), t]));

    const rows = specEntries.map((entry) => {
      const matched = byKey.get(entry.key) ?? byName.get(entry.name.toLowerCase()) ?? null;
      const configuredUnits = matched?._count.units ?? 0;
      return {
        specKey: entry.key,
        name: entry.name,
        expectedUnits: entry.expectedUnits,
        roomTypeId: matched?.id ?? null,
        configuredUnits,
        delta: configuredUnits - entry.expectedUnits,
        state: !matched ? "MISSING_TYPE" : configuredUnits === entry.expectedUnits ? "MATCHED" : "UNIT_MISMATCH",
      };
    });

    const specKeys = new Set(specEntries.map((e) => e.key.toLowerCase()));
    const extras = types
      .filter((t) => !t.sourceSpecKey || !specKeys.has(t.sourceSpecKey.toLowerCase()))
      .filter((t) => !specKeys.has(t.name.toLowerCase()))
      .map((t) => ({ roomTypeId: t.id, name: t.name, configuredUnits: t._count.units, state: "NOT_IN_SPEC" }));

    res.json({
      property: { id: property.id, title: (property as { title?: string }).title },
      spec: rows,
      extras,
      reconciled: rows.every((r) => r.state === "MATCHED") && rows.length > 0,
      specTotalUnits: specEntries.reduce((sum, e) => sum + e.expectedUnits, 0),
      configuredTotalUnits: types.reduce((sum, t) => sum + t._count.units, 0),
    });
  } catch (err) {
    console.error("[owner.nrms.rooms] reconciliation failed", err);
    res.status(500).json({ error: "Failed to build reconciliation report" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/rooms/:propertyId/import
 * Idempotent import: creates missing room types from roomsSpec and generates
 * room units up to the expected count. Never deletes or renames anything the
 * owner already configured (doc 10.4: no destructive migration).
 */
router.post("/:propertyId/import", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const property = await loadOwnedProperty(res, ownerId, Number(req.params.propertyId), { id: true, roomsSpec: true, currency: true });
    if (!property) return;
    const propertyId = property.id as number;
    const propertyCurrency = (property as { currency?: string | null }).currency?.toUpperCase();
    if (!propertyCurrency) return res.status(409).json({ error: "Set the property currency before importing room inventory" });

    const specEntries = parseRoomsSpec((property as { roomsSpec?: unknown }).roomsSpec);
    if (specEntries.length === 0) {
      return res.status(422).json({ error: "This property has no readable room setup to import", code: "EMPTY_ROOMS_SPEC" });
    }

    let createdTypes = 0;
    let createdUnits = 0;

    for (const entry of specEntries) {
      let type = await prisma.roomType.findFirst({
        where: {
          propertyId,
          OR: [{ sourceSpecKey: entry.key }, { name: entry.name }],
        },
        include: { units: { select: { code: true } } },
      });
      if (!type) {
        type = await prisma.roomType.create({
          data: {
            propertyId,
            name: entry.name,
            description: entry.description,
            bedSetup: entry.bedSetup,
            baseRate: entry.baseRate,
            currency: propertyCurrency,
            images: entry.images,
            amenities: entry.amenities,
            sourceSpecKey: entry.key,
          },
          include: { units: { select: { code: true } } },
        });
        createdTypes += 1;
      }

      const existingCodes = new Set(
        (await prisma.roomUnit.findMany({ where: { propertyId }, select: { code: true } })).map((u) => u.code),
      );
      const currentCount = type.units.length;
      const prefix = entry.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 12) || "ROOM";
      let seq = 1;
      for (let i = currentCount; i < entry.expectedUnits; i++) {
        let code = `${prefix}-${seq}`;
        while (existingCodes.has(code)) {
          seq += 1;
          code = `${prefix}-${seq}`;
        }
        existingCodes.add(code);
        const roomQuota = await checkNrmsQuota(prisma as any, propertyId, "rooms");
        if (!roomQuota.allowed) return res.status(409).json({ error: "NRMS room quota reached", quota: roomQuota });
        await prisma.roomUnit.create({ data: { propertyId, roomTypeId: type.id, code, floor: entry.unitFloors[i] ?? null } });
        createdUnits += 1;
      }
    }

    res.status(201).json({ createdTypes, createdUnits, importedFromSpec: specEntries.length });
  } catch (err) {
    console.error("[owner.nrms.rooms] import failed", err);
    res.status(500).json({ error: "Failed to import rooms from property setup" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/rooms/:propertyId/types
 */
router.post("/:propertyId/types", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const property = await loadOwnedProperty(res, ownerId, Number(req.params.propertyId), { id: true, currency: true });
    if (!property) return;
    const parsed = roomTypeCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room type", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const currency = data.currency?.toUpperCase() || property.currency?.toUpperCase();
    if (!currency) return res.status(409).json({ error: "Set the property currency before creating a room type" });
    const created = await prisma.roomType.create({
      data: {
        propertyId: property.id as number,
        name: sanitizeText(data.name),
        description: data.description ? sanitizeText(data.description) : null,
        capacityAdults: data.capacityAdults ?? 2,
        capacityChildren: data.capacityChildren ?? 0,
        bedSetup: data.bedSetup ? sanitizeText(data.bedSetup) : null,
        baseRate: data.baseRate ?? null,
        currency,
        images: data.images ?? undefined,
        amenities: data.amenities ?? undefined,
        sortOrder: data.sortOrder ?? 0,
      },
    });
    res.status(201).json({ roomType: formatRoomType(created) });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A room type with this name already exists for this property" });
    }
    console.error("[owner.nrms.rooms] create type failed", err);
    res.status(500).json({ error: "Failed to create room type" });
  }
}) as RequestHandler);

/**
 * PATCH /api/owner/nrms/rooms/types/:roomTypeId
 */
router.patch("/types/:roomTypeId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const type = await loadOwnedRoomType(res, ownerId, Number(req.params.roomTypeId));
    if (!type) return;
    const parsed = roomTypeUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room type update", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const updated = await prisma.roomType.update({
      where: { id: type.id },
      data: {
        ...(data.name !== undefined ? { name: sanitizeText(data.name) } : {}),
        ...(data.description !== undefined ? { description: data.description ? sanitizeText(data.description) : null } : {}),
        ...(data.capacityAdults !== undefined ? { capacityAdults: data.capacityAdults } : {}),
        ...(data.capacityChildren !== undefined ? { capacityChildren: data.capacityChildren } : {}),
        ...(data.bedSetup !== undefined ? { bedSetup: data.bedSetup ? sanitizeText(data.bedSetup) : null } : {}),
        ...(data.baseRate !== undefined ? { baseRate: data.baseRate } : {}),
        ...(data.currency !== undefined ? { currency: data.currency?.toUpperCase() } : {}),
        ...(data.images !== undefined ? { images: data.images } : {}),
        ...(data.amenities !== undefined ? { amenities: data.amenities } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
    res.json({ roomType: formatRoomType(updated) });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A room type with this name already exists for this property" });
    }
    console.error("[owner.nrms.rooms] update type failed", err);
    res.status(500).json({ error: "Failed to update room type" });
  }
}) as RequestHandler);

/**
 * DELETE /api/owner/nrms/rooms/types/:roomTypeId
 * Only when the type has no units and no reservation history; otherwise
 * deactivate to preserve history (doc 4: preserve history).
 */
router.delete("/types/:roomTypeId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const type = await loadOwnedRoomType(res, ownerId, Number(req.params.roomTypeId));
    if (!type) return;
    if (type._count.units > 0 || type._count.allocations > 0) {
      return res.status(409).json({
        error: "This room type has rooms or reservation history. Set it inactive instead.",
        code: "ROOM_TYPE_IN_USE",
      });
    }
    await prisma.roomType.delete({ where: { id: type.id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error("[owner.nrms.rooms] delete type failed", err);
    res.status(500).json({ error: "Failed to delete room type" });
  }
}) as RequestHandler);

/**
 * POST /api/owner/nrms/rooms/:propertyId/units
 */
router.post("/:propertyId/units", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const property = await loadOwnedProperty(res, ownerId, Number(req.params.propertyId), { id: true });
    if (!property) return;
    const parsed = roomUnitCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room", details: parsed.error.flatten() });
    }
    const data = parsed.data;
    const type = await prisma.roomType.findFirst({
      where: { id: data.roomTypeId, propertyId: property.id as number },
      select: { id: true },
    });
    if (!type) {
      return res.status(400).json({ error: "Room type does not belong to this property" });
    }
    const roomQuota = await checkNrmsQuota(prisma as any, property.id as number, "rooms");
    if (!roomQuota.allowed) return res.status(409).json({ error: "NRMS room quota reached", quota: roomQuota });
    const created = await prisma.roomUnit.create({
      data: {
        propertyId: property.id as number,
        roomTypeId: type.id,
        code: sanitizeText(data.code),
        floor: data.floor ?? null,
        notes: data.notes ? sanitizeText(data.notes) : null,
        bedCount: data.bedCount,
      },
    });
    res.status(201).json({ roomUnit: formatRoomUnit(created) });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A room with this code already exists for this property" });
    }
    console.error("[owner.nrms.rooms] create unit failed", err);
    res.status(500).json({ error: "Failed to create room" });
  }
}) as RequestHandler);

/**
 * PATCH /api/owner/nrms/rooms/units/:roomUnitId
 * Status changes are written to RoomUnitStatusHistory (doc 9.2, 14).
 */
router.patch("/units/:roomUnitId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const unit = await loadOwnedRoomUnit(res, ownerId, Number(req.params.roomUnitId));
    if (!unit) return;
    const parsed = roomUnitUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid room update", details: parsed.error.flatten() });
    }
    const data = parsed.data;

    if (data.roomTypeId !== undefined && data.roomTypeId !== unit.roomTypeId) {
      const type = await prisma.roomType.findFirst({
        where: { id: data.roomTypeId, propertyId: unit.propertyId },
        select: { id: true },
      });
      if (!type) {
        return res.status(400).json({ error: "Room type does not belong to this property" });
      }
    }

    const statusChanged = data.status !== undefined && data.status !== unit.status;
    const updated = await prisma.$transaction(async (tx) => {
      const next = await tx.roomUnit.update({
        where: { id: unit.id },
        data: {
          ...(data.roomTypeId !== undefined ? { roomTypeId: data.roomTypeId } : {}),
          ...(data.code !== undefined ? { code: sanitizeText(data.code) } : {}),
          ...(data.floor !== undefined ? { floor: data.floor } : {}),
          ...(data.notes !== undefined ? { notes: data.notes ? sanitizeText(data.notes) : null } : {}),
          ...(data.bedCount !== undefined ? { bedCount: data.bedCount } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });
      if (statusChanged) {
        await tx.roomUnitStatusHistory.create({
          data: {
            roomUnitId: unit.id,
            fromStatus: unit.status,
            toStatus: data.status!,
            reason: data.statusReason ? sanitizeText(data.statusReason) : null,
            changedById: ownerId,
          },
        });
      }
      return next;
    });
    res.json({ roomUnit: formatRoomUnit(updated) });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return res.status(409).json({ error: "A room with this code already exists for this property" });
    }
    console.error("[owner.nrms.rooms] update unit failed", err);
    res.status(500).json({ error: "Failed to update room" });
  }
}) as RequestHandler);

/**
 * DELETE /api/owner/nrms/rooms/units/:roomUnitId
 * Blocked when the room has any allocation history; deactivate instead.
 */
router.delete("/units/:roomUnitId", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const unit = await loadOwnedRoomUnit(res, ownerId, Number(req.params.roomUnitId));
    if (!unit) return;
    const allocationCount = await prisma.reservationRoomAllocation.count({ where: { roomUnitId: unit.id } });
    if (allocationCount > 0) {
      return res.status(409).json({
        error: "This room has reservation history. Set it inactive instead.",
        code: "ROOM_UNIT_IN_USE",
      });
    }
    await prisma.roomUnit.delete({ where: { id: unit.id } });
    res.json({ deleted: true });
  } catch (err) {
    console.error("[owner.nrms.rooms] delete unit failed", err);
    res.status(500).json({ error: "Failed to delete room" });
  }
}) as RequestHandler);

export default router;
