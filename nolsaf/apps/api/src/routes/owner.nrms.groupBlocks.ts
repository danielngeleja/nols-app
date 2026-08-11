// apps/api/src/routes/owner.nrms.groupBlocks.ts
//
// Group blocks (allotments): rooms held for a party before any guest names
// exist. This is the first half of the standard group flow used by every PMS.
// The rooming list (an agency fills the names through a shared link, or a CSV
// upload) and pickup (those names materialise into reservations) follow.
//
// Why the block exists at all: a 20-room tour cannot be entered as 20 named
// reservations at agreement time, because nobody knows the names yet. Without a
// block the rooms stay sellable and the desk oversells a party it has already
// promised.
//
// Inventory: an un-picked-up block room consumes capacity exactly like a
// reservation (see nrmsAvailability). Cut-off is evaluated lazily, so rooms
// return to sale the moment cutOffAt passes with no worker involved.
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { loadOwnedActiveNrmsProperty } from "../lib/nrms.js";
import { sanitizeText } from "../lib/sanitize.js";
import { encrypt } from "../lib/crypto.js";
import { generateNrmsRandomCode } from "../lib/pdfDocuments.js";
import { getRoomTypesAvailability, lockPropertyInventory } from "../lib/nrmsAvailability.js";
import {
  BLOCK_LIVE_STATUSES,
  PICKUP_RACE,
  nightsBetween,
  pickupErrorBody,
  pickupStatus,
  resolveGroupGuestProfile,
  runBlockPickup,
} from "../lib/nrmsGroupPickup.js";
import {
  billingUsesMasterFolio,
  buildMasterPaymentReceiptNumber,
  ensureMasterFolioForBlock,
  getMasterFolioTotals,
  refreshMasterFolioStatus,
} from "../lib/nrmsMasterFolio.js";
import {
  createMasterProForma,
  emailMasterProForma,
  NRMS_MANUAL_BANK_POLICY_VERSION,
  renderMasterProFormaPdf,
  serializeProForma,
} from "../lib/nrmsProForma.js";

export const router = Router();

router.use(requireAuth as RequestHandler);

const EXTENDED_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

const BILLING_MODES = ["INDIVIDUAL", "SPLIT", "MASTER"] as const;
const PAYMENT_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD", "OTHER"] as const;
/** A block still holding rooms. Terminal states stop consuming inventory. */
const LIVE_STATUSES = BLOCK_LIVE_STATUSES;

const dayString = z.string().min(1).refine((v) => !Number.isNaN(new Date(v).getTime()), { message: "Invalid date" });

const blockRoomSchema = z.object({
  roomTypeId: z.number().int().positive(),
  ratePlanId: z.number().int().positive().optional().nullable(),
  quantity: z.number().int().min(1).max(200),
  nightlyRate: z.number().min(0).max(100_000_000).optional(),
  mealPlan: z.string().trim().max(20).optional().nullable(),
});

const createBlockSchema = z.object({
  name: z.string().trim().min(2).max(160),
  agencyName: z.string().trim().max(160).optional().nullable(),
  contactName: z.string().trim().min(2).max(160),
  contactPhone: z.string().trim().max(40).optional().nullable(),
  contactEmail: z.string().trim().email().max(160),
  checkIn: dayString,
  checkOut: dayString,
  cutOffAt: dayString,
  billingMode: z.enum(BILLING_MODES).default("INDIVIDUAL"),
  notes: z.string().trim().max(2000).optional().nullable(),
  rooms: z.array(blockRoomSchema).min(1).max(40),
});

const editBlockSchema = createBlockSchema.partial().omit({ rooms: true });

const pickupSchema = z.object({
  blockRoomId: z.number().int().positive(),
  roomUnitId: z.number().int().positive().optional().nullable(),
  adults: z.number().int().min(1).max(20).default(1),
  children: z.number().int().min(0).max(20).default(0),
  notes: z.string().trim().max(2000).optional().nullable(),
  guest: z.object({
    guestProfileId: z.number().int().positive().optional(),
    fullName: z.string().trim().min(1, "Guest name is required").max(160),
    phone: z.string().trim().min(7, "Guest phone number is required").max(40),
    email: z.string().trim().email().max(160).optional().nullable(),
    nationality: z.string().trim().max(80).optional().nullable(),
  }),
});

const masterPaymentSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional().nullable(),
  note: z.string().trim().max(300).optional().nullable(),
});

const paymentVoidSchema = z.object({ reason: z.string().trim().min(2).max(300) });
const proFormaCreateSchema = z.object({
  dueAt: dayString.optional(),
  validUntil: dayString.optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});
const proFormaSendSchema = z.object({ email: z.string().trim().email().max(160).optional() });
const manualProFormaBankSchema = z.object({
  bankName: z.string().trim().min(2).max(120),
  accountName: z.string().trim().min(2).max(160),
  accountNumber: z.string().trim().min(4).max(80).regex(/^[A-Za-z0-9 .\-/]+$/, "Account number contains unsupported characters"),
  accountCurrency: z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  branchName: z.string().trim().max(120).optional().nullable(),
  bankAddress: z.string().trim().max(240).optional().nullable(),
  swiftCode: z.string().trim().max(32).regex(/^[A-Za-z0-9-]*$/).optional().nullable(),
  iban: z.string().trim().max(64).regex(/^[A-Za-z0-9 ]*$/).optional().nullable(),
  routingCode: z.string().trim().max(64).regex(/^[A-Za-z0-9 .\-/]*$/).optional().nullable(),
  instructions: z.string().trim().max(500).optional().nullable(),
  policyAccepted: z.literal(true),
});

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

const nights = nightsBetween;

function formatBlock(block: any) {
  const rooms = block.rooms ?? [];
  const roomsHeld = rooms.reduce((sum: number, room: any) => sum + Math.max(0, room.quantity - room.pickedUp), 0);
  const roomsTotal = rooms.reduce((sum: number, room: any) => sum + room.quantity, 0);
  const roomsPickedUp = rooms.reduce((sum: number, room: any) => sum + room.pickedUp, 0);
  const stayNights = nights(block.checkIn, block.checkOut);
  // Value of the whole block at the agreed rates, the number the desk quotes.
  const blockValue = rooms.reduce((sum: number, room: any) => sum + Number(room.nightlyRate) * room.quantity * stayNights, 0);
  const masterFolio = block.masterFolio
    ? (() => {
        const activeItems = (block.masterFolio.items ?? []).filter((item: any) => !item.voidedAt);
        const activePayments = (block.masterFolio.payments ?? []).filter((payment: any) => !payment.voidedAt);
        const billed = activeItems.reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0);
        const paid = activePayments.reduce((sum: number, payment: any) => sum + Number(payment.amount ?? 0), 0);
        const proFormas = (block.masterFolio.proFormas ?? []).map((record: any) => serializeProForma({ ...record, masterFolio: block.masterFolio }));
        const latestProForma = proFormas.find((record: any) => !record.supersededAt) ?? proFormas[0] ?? null;
        const quoted = Number(latestProForma?.quotedTotal ?? 0);
        return {
          id: block.masterFolio.id,
          reference: block.masterFolio.reference,
          billingMode: block.masterFolio.billingMode,
          settlementPolicy: block.masterFolio.settlementPolicy,
          billToName: block.masterFolio.billToName,
          status: block.masterFolio.status,
          currency: block.masterFolio.currency,
          billed: Number(billed.toFixed(2)),
          paid: Number(paid.toFixed(2)),
          balance: Number((billed - paid).toFixed(2)),
          quoted: Number(quoted.toFixed(2)),
          paymentDue: Number(Math.max(0, Math.max(billed, quoted) - paid).toFixed(2)),
          settledAt: block.masterFolio.settledAt,
          items: (block.masterFolio.items ?? []).map((item: any) => ({
            id: item.id,
            reservationId: item.reservationId,
            kind: item.kind,
            description: item.description,
            amount: Number(item.amount),
            voidedAt: item.voidedAt,
          })),
          payments: (block.masterFolio.payments ?? []).map((payment: any) => ({
            id: payment.id,
            amount: Number(payment.amount),
            method: payment.method,
            reference: payment.reference,
            receiptNumber: payment.receiptNumber,
            note: payment.note,
            createdAt: payment.createdAt,
            voidedAt: payment.voidedAt,
            voidReason: payment.voidReason,
          })),
          proFormas,
        };
      })()
    : null;
  return {
    id: block.id,
    reference: block.reference,
    name: block.name,
    agencyName: block.agencyName,
    contactName: block.contactName,
    contactPhone: block.contactPhone,
    contactEmail: block.contactEmail,
    checkIn: block.checkIn,
    checkOut: block.checkOut,
    cutOffAt: block.cutOffAt,
    cutOffPassed: new Date(block.cutOffAt).getTime() <= Date.now(),
    status: block.status,
    currency: block.currency,
    billingMode: block.billingMode,
    notes: block.notes,
    groupId: block.groupId,
    releasedAt: block.releasedAt,
    createdAt: block.createdAt,
    nights: stayNights,
    roomsTotal,
    roomsHeld,
    roomsPickedUp,
    blockValue,
    masterFolio,
    rooms: rooms.map((room: any) => ({
      id: room.id,
      roomTypeId: room.roomTypeId,
      roomTypeName: room.roomType?.name ?? null,
      ratePlanId: room.ratePlanId,
      ratePlanName: room.ratePlan?.name ?? null,
      quantity: room.quantity,
      pickedUp: room.pickedUp,
      held: Math.max(0, room.quantity - room.pickedUp),
      nightlyRate: Number(room.nightlyRate),
      mealPlan: room.mealPlan,
    })),
  };
}

const blockInclude = {
  rooms: {
    include: { roomType: { select: { name: true } }, ratePlan: { select: { name: true } } },
    orderBy: { id: "asc" as const },
  },
  masterFolio: {
    include: {
      items: { orderBy: { createdAt: "asc" as const } },
      payments: { orderBy: { createdAt: "asc" as const } },
      proFormas: { orderBy: { revision: "desc" as const } },
    },
  },
};

const proFormaRecordInclude = {
  masterFolio: {
    include: {
      payments: { orderBy: { createdAt: "asc" as const } },
      block: true,
    },
  },
};

async function loadOwnedBlock(res: Response, ownerId: number, blockId: number) {
  if (!Number.isInteger(blockId) || blockId <= 0) {
    res.status(400).json({ error: "Invalid group block id" });
    return null;
  }
  const block = await prisma.nrmsGroupBlock.findFirst({ where: { id: blockId, ownerId }, include: blockInclude });
  if (!block) {
    res.status(404).json({ error: "Group block not found" });
    return null;
  }
  const active = await loadOwnedActiveNrmsProperty(res, ownerId, block.propertyId);
  if (!active) return null;
  return block;
}

type GroupDocumentAccess = { role: "OWNER" | "MANAGER" | "FRONT_DESK"; property: { id: number; ownerId: number } };

async function loadGroupDocumentAccess(req: AuthedRequest, res: Response, propertyId: number): Promise<GroupDocumentAccess | null> {
  if (!Number.isInteger(propertyId) || propertyId <= 0) {
    res.status(400).json({ error: "Invalid property id" });
    return null;
  }
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, ownerId: true, status: true, nrmsActivatedAt: true },
  });
  if (!property || property.status !== "APPROVED" || !property.nrmsActivatedAt) {
    res.status(404).json({ error: "Active NRMS property not found" });
    return null;
  }
  if (property.ownerId === req.user!.id) {
    const active = await loadOwnedActiveNrmsProperty(res, req.user!.id, property.id);
    return active ? { role: "OWNER", property } : null;
  }
  const membership = await prisma.nrmsStaffMembership.findFirst({
    where: { propertyId, userId: req.user!.id, status: "ACTIVE", role: { in: ["MANAGER", "FRONT_DESK"] } },
    select: { role: true },
  });
  if (!membership) {
    res.status(403).json({ error: "Only the property owner, manager, or front desk can access group billing", code: "NRMS_GROUP_BILLING_FORBIDDEN" });
    return null;
  }
  return { role: membership.role as "MANAGER" | "FRONT_DESK", property };
}

async function loadDocumentAccessibleBlock(req: AuthedRequest, res: Response, blockId: number) {
  if (!Number.isInteger(blockId) || blockId <= 0) {
    res.status(400).json({ error: "Invalid group block id" });
    return null;
  }
  const block = await prisma.nrmsGroupBlock.findUnique({ where: { id: blockId }, include: blockInclude });
  if (!block) {
    res.status(404).json({ error: "Group block not found" });
    return null;
  }
  const access = await loadGroupDocumentAccess(req, res, block.propertyId);
  return access ? { block, access } : null;
}

async function loadAccessibleProForma(req: AuthedRequest, res: Response, blockId: number, proFormaId: number) {
  if (!Number.isInteger(proFormaId) || proFormaId <= 0) {
    res.status(400).json({ error: "Invalid Pro Forma id" });
    return null;
  }
  const accessible = await loadDocumentAccessibleBlock(req, res, blockId);
  if (!accessible) return null;
  const record = await prisma.nrmsMasterFolioProForma.findFirst({
    where: { id: proFormaId, masterFolio: { blockId } },
    include: proFormaRecordInclude,
  });
  if (!record) {
    res.status(404).json({ error: "Pro Forma not found" });
    return null;
  }
  return { record, access: accessible.access };
}

/** Dates parsed and validated once, shared by create and edit. */
function readDates(input: { checkIn: string; checkOut: string; cutOffAt: string }) {
  const checkIn = utcDay(new Date(input.checkIn));
  const checkOut = utcDay(new Date(input.checkOut));
  const cutOffAt = new Date(input.cutOffAt);
  if (checkOut.getTime() <= checkIn.getTime()) return { error: "checkOut must be after checkIn" } as const;
  // The deadline is allowed anywhere up to departure, not just up to arrival.
  // A late deadline is poor practice, not invalid: a party can still be sending
  // names on the day, and a same-day block would otherwise have no legal date
  // at all. The UI warns; only a deadline past the stay itself is refused,
  // because rooms cannot be held past the night they were held for.
  if (cutOffAt.getTime() > checkOut.getTime()) {
    return { error: "The deadline for names cannot be after the party has departed" } as const;
  }
  return { checkIn, checkOut, cutOffAt } as const;
}

/** GET /property/:propertyId/blocks */
router.get("/property/:propertyId/blocks", (async (req: AuthedRequest, res: Response) => {
  try {
    const access = await loadGroupDocumentAccess(req, res, Number(req.params.propertyId));
    if (!access) return;
    const blocks = await prisma.nrmsGroupBlock.findMany({
      where: { propertyId: access.property.id, ownerId: access.property.ownerId },
      include: blockInclude,
      orderBy: [{ checkIn: "asc" }, { id: "desc" }],
      take: 200,
    });
    res.json({ blocks: blocks.map(formatBlock) });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] list failed", err);
    res.status(500).json({ error: "Failed to load group blocks" });
  }
}) as RequestHandler);

/**
 * POST /property/:propertyId/blocks
 *
 * Holding rooms is a real inventory commitment, so this takes the property
 * inventory lock and re-checks availability inside the transaction. Otherwise
 * two clerks agreeing two blocks at once could each promise the last rooms.
 */
router.post("/property/:propertyId/blocks", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = createBlockSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid group block", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const active = await loadOwnedActiveNrmsProperty(res, ownerId, Number(req.params.propertyId));
    if (!active) return;
    const propertyId = active.property.id as number;
    const data = parsed.data;
    if (billingUsesMasterFolio(data.billingMode) && !String(data.agencyName || "").trim()) {
      return res.status(400).json({ error: "Agency or company name is required for agency billing", code: "AGENCY_NAME_REQUIRED" });
    }

    const dates = readDates({ checkIn: data.checkIn, checkOut: data.checkOut, cutOffAt: data.cutOffAt });
    if ("error" in dates) return res.status(400).json({ error: dates.error });

    // One line per room type: two lines of the same type would race each other
    // on pickup accounting for no benefit.
    const byType = new Set<number>();
    for (const room of data.rooms) {
      if (byType.has(room.roomTypeId)) return res.status(400).json({ error: "Combine each room type into a single line" });
      byType.add(room.roomTypeId);
    }

    const reference = `BLK-${Date.now().toString(36).toUpperCase()}-${generateNrmsRandomCode()}`.slice(0, 32);
    const result = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, propertyId);
      const availability = await getRoomTypesAvailability(tx, propertyId, data.rooms.map((room) => room.roomTypeId), dates.checkIn, dates.checkOut);
      for (const room of data.rooms) {
        const capacity = availability.get(room.roomTypeId);
        if (!capacity) return { unknownRoomType: room.roomTypeId };
        if (capacity.available < room.quantity) {
          return { capacityConflict: { roomTypeId: room.roomTypeId, requested: room.quantity, ...capacity } };
        }
      }
      const block = await tx.nrmsGroupBlock.create({
        data: {
          propertyId,
          ownerId,
          reference,
          name: sanitizeText(data.name),
          agencyName: data.agencyName ? sanitizeText(data.agencyName) : null,
          contactName: data.contactName ? sanitizeText(data.contactName) : null,
          contactPhone: data.contactPhone ? sanitizeText(data.contactPhone) : null,
          contactEmail: data.contactEmail ? sanitizeText(data.contactEmail) : null,
          checkIn: dates.checkIn,
          checkOut: dates.checkOut,
          cutOffAt: dates.cutOffAt,
          status: "HELD",
          currency: active.property.currency ?? "TZS",
          billingMode: data.billingMode,
          notes: data.notes ? sanitizeText(data.notes) : null,
          createdById: ownerId,
        },
      });
      await tx.nrmsGroupBlockRoom.createMany({
        data: data.rooms.map((room) => ({
          blockId: block.id,
          roomTypeId: room.roomTypeId,
          ratePlanId: room.ratePlanId ?? null,
          quantity: room.quantity,
          nightlyRate: room.nightlyRate ?? 0,
          mealPlan: room.mealPlan ? sanitizeText(room.mealPlan) : null,
        })),
      });
      await ensureMasterFolioForBlock(tx, block);
      return { blockId: block.id };
    }, EXTENDED_TX_OPTIONS);

    if ("unknownRoomType" in result) {
      return res.status(400).json({ error: "One of the selected room types does not belong to this property" });
    }
    if ("capacityConflict" in result && result.capacityConflict) {
      return res.status(409).json({
        error: "There are not enough rooms of that type free for these dates",
        code: "ROOM_TYPE_CAPACITY_CONFLICT",
        conflict: result.capacityConflict,
      });
    }
    const block = await prisma.nrmsGroupBlock.findUnique({ where: { id: (result as any).blockId }, include: blockInclude });
    res.status(201).json({ block: formatBlock(block) });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] create failed", err);
    res.status(500).json({ error: "Failed to create the group block" });
  }
}) as RequestHandler);

/** GET /blocks/:blockId */
router.get("/blocks/:blockId", (async (req: AuthedRequest, res: Response) => {
  try {
    const accessible = await loadDocumentAccessibleBlock(req, res, Number(req.params.blockId));
    if (!accessible) return;
    res.json({ block: formatBlock(accessible.block), accessRole: accessible.access.role });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] detail failed", err);
    res.status(500).json({ error: "Failed to load the group block" });
  }
}) as RequestHandler);

/** Generate and persist the next immutable Pro Forma revision. */
router.post("/blocks/:blockId/pro-formas", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = proFormaCreateSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid Pro Forma details", details: parsed.error.flatten() });
    const actorId = req.user!.id;
    const accessible = await loadDocumentAccessibleBlock(req, res, Number(req.params.blockId));
    if (!accessible) return;
    const { block } = accessible;
    const ownerId = block.ownerId;
    if (["CANCELLED", "RELEASED"].includes(block.status)) {
      return res.status(409).json({ error: "A cancelled or released group cannot receive a new Pro Forma", code: "GROUP_BLOCK_CLOSED" });
    }
    if (!billingUsesMasterFolio(block.billingMode) || !block.masterFolio) {
      return res.status(409).json({ error: "Pro Forma invoices are available only for SPLIT or MASTER agency billing", code: "MASTER_FOLIO_REQUIRED" });
    }
    const record = await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, block.propertyId);
      const fresh = await tx.nrmsGroupBlock.findFirst({
        where: { id: block.id, ownerId },
        include: {
          ...blockInclude,
          property: { select: { title: true, street: true, ward: true, city: true, district: true, regionName: true, country: true } },
        },
      });
      if (!fresh) throw new Error("NRMS_PRO_FORMA_BLOCK_MISSING");
      return createMasterProForma(tx, fresh, {
        createdById: actorId,
        dueAt: parsed.data.dueAt || null,
        validUntil: parsed.data.validUntil || null,
        notes: parsed.data.notes ? sanitizeText(parsed.data.notes) : null,
      });
    }, EXTENDED_TX_OPTIONS);
    const complete = await prisma.nrmsMasterFolioProForma.findUnique({ where: { id: record.id }, include: proFormaRecordInclude });
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.status(201).json({ proForma: serializeProForma(complete), block: formatBlock(updated) });
  } catch (err) {
    const code = err instanceof Error ? err.message : "";
    if (code === "NRMS_PRO_FORMA_CONTACT_REQUIRED") return res.status(409).json({ error: "Add the group leader name and billing email before generating the Pro Forma", code: "BILLING_CONTACT_REQUIRED" });
    if (code === "NRMS_PRO_FORMA_BANK_REQUIRED") return res.status(409).json({ error: "Add bank instructions for this Pro Forma or use a verified payout bank account", code: "VERIFIED_BANK_REQUIRED" });
    if (code === "NRMS_PRO_FORMA_EMPTY") return res.status(409).json({ error: "This group has no billable amount yet", code: "PRO_FORMA_EMPTY" });
    if (code === "NRMS_PRO_FORMA_ALREADY_PAID") return res.status(409).json({ error: "This agency bill is already paid. Send a receipt or account statement instead.", code: "MASTER_ALREADY_PAID" });
    if (code === "NRMS_PRO_FORMA_INVALID_VALIDITY") return res.status(400).json({ error: "The validity date cannot be in the past", code: "INVALID_VALIDITY" });
    console.error("[owner.nrms.groupBlocks] Pro Forma generation failed", err);
    res.status(500).json({ error: "Failed to generate the Pro Forma invoice" });
  }
}) as RequestHandler);

/**
 * Save owner-supplied bank instructions for property-issued Pro Formas only.
 * This never creates or updates PayoutAccount and never calls AzamPay.
 */
router.post("/blocks/:blockId/pro-forma-bank-account", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = manualProFormaBankSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Check the bank details and accept the verification policy", details: parsed.error.flatten() });
    const accessible = await loadDocumentAccessibleBlock(req, res, Number(req.params.blockId));
    if (!accessible) return;
    if (accessible.access.role !== "OWNER") {
      return res.status(403).json({ error: "Only the property owner can add unverified bank instructions", code: "MANUAL_BANK_OWNER_REQUIRED" });
    }
    const data = parsed.data;
    const acceptedAt = new Date();
    const clean = (value: string | null | undefined, upper = false) => {
      const result = value ? sanitizeText(value).trim() : null;
      return result ? (upper ? result.toUpperCase() : result) : null;
    };
    const saved = await prisma.nrmsProFormaBankAccount.upsert({
      where: { propertyId: accessible.block.propertyId },
      create: {
        propertyId: accessible.block.propertyId,
        ownerId: accessible.block.ownerId,
        bankName: sanitizeText(data.bankName),
        accountName: sanitizeText(data.accountName),
        accountNumberEnc: encrypt(data.accountNumber),
        accountCurrency: data.accountCurrency,
        branchName: clean(data.branchName),
        bankAddress: clean(data.bankAddress),
        swiftCode: clean(data.swiftCode, true),
        iban: clean(data.iban, true)?.replace(/\s+/g, "") || null,
        routingCode: clean(data.routingCode, true),
        instructions: clean(data.instructions),
        active: true,
        policyVersion: NRMS_MANUAL_BANK_POLICY_VERSION,
        policyAcceptedAt: acceptedAt,
        policyAcceptedById: req.user!.id,
      },
      update: {
        ownerId: accessible.block.ownerId,
        bankName: sanitizeText(data.bankName),
        accountName: sanitizeText(data.accountName),
        accountNumberEnc: encrypt(data.accountNumber),
        accountCurrency: data.accountCurrency,
        branchName: clean(data.branchName),
        bankAddress: clean(data.bankAddress),
        swiftCode: clean(data.swiftCode, true),
        iban: clean(data.iban, true)?.replace(/\s+/g, "") || null,
        routingCode: clean(data.routingCode, true),
        instructions: clean(data.instructions),
        active: true,
        policyVersion: NRMS_MANUAL_BANK_POLICY_VERSION,
        policyAcceptedAt: acceptedAt,
        policyAcceptedById: req.user!.id,
      },
      select: { id: true, bankName: true, accountName: true, accountCurrency: true, swiftCode: true, policyAcceptedAt: true },
    });
    res.status(201).json({
      bankAccount: { ...saved, accountNumberLast4: data.accountNumber.replace(/\s+/g, "").slice(-4), verificationStatus: "MANUAL_UNVERIFIED" },
      message: "Manual bank instructions saved for property-issued Pro Formas only",
    });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] manual Pro Forma bank save failed", err);
    res.status(500).json({ error: "Failed to save the Pro Forma bank instructions" });
  }
}) as RequestHandler);

/** Download the exact snapshot represented by one Pro Forma revision. */
router.get("/blocks/:blockId/pro-formas/:proFormaId/pdf", (async (req: AuthedRequest, res: Response) => {
  try {
    const blockId = Number(req.params.blockId);
    const accessible = await loadAccessibleProForma(req, res, blockId, Number(req.params.proFormaId));
    if (!accessible) return;
    const { record } = accessible;
    const pdf = await renderMasterProFormaPdf(record);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${record.number}.pdf"`);
    res.send(pdf);
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] Pro Forma PDF failed", err);
    res.status(500).json({ error: "Failed to render the Pro Forma invoice" });
  }
}) as RequestHandler);

/** Email the PDF and secure verification link directly to the agency. */
router.post("/blocks/:blockId/pro-formas/:proFormaId/send", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = proFormaSendSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Enter a valid agency email address" });
    const blockId = Number(req.params.blockId);
    const accessible = await loadAccessibleProForma(req, res, blockId, Number(req.params.proFormaId));
    if (!accessible) return;
    const { record } = accessible;
    if (record.status === "SUPERSEDED") return res.status(409).json({ error: "This revision was replaced. Send the latest Pro Forma instead.", code: "PRO_FORMA_SUPERSEDED" });
    const recipient = String(parsed.data.email || record.contactEmail).trim().toLowerCase();
    const { delivery } = await emailMasterProForma(record, recipient);
    const sent = await prisma.nrmsMasterFolioProForma.update({
      where: { id: record.id },
      data: {
        status: "SENT",
        sentById: req.user!.id,
        sentAt: new Date(),
        sentToEmail: recipient,
        deliveryProvider: String((delivery as any)?.provider || "unknown").slice(0, 30),
        deliveryMessageId: (delivery as any)?.messageId ? String((delivery as any).messageId).slice(0, 160) : null,
      },
      include: proFormaRecordInclude,
    });
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: blockId }, include: blockInclude });
    res.json({ proForma: serializeProForma(sent), block: formatBlock(updated) });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] Pro Forma send failed", err);
    res.status(502).json({ error: err instanceof Error ? err.message : "Failed to send the Pro Forma invoice" });
  }
}) as RequestHandler);

/**
 * PATCH /blocks/:blockId
 *
 * Contact details, notes, billing mode and the cut-off can always be corrected.
 * Dates are frozen once any room has been picked up, because the reservations
 * that came out of the block already carry those dates and moving the block
 * would silently disagree with them.
 */
router.patch("/blocks/:blockId", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = editBlockSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid update", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const block = await loadOwnedBlock(res, ownerId, Number(req.params.blockId));
    if (!block) return;
    if (!LIVE_STATUSES.includes(block.status)) {
      return res.status(409).json({ error: `A ${block.status.toLowerCase().replace(/_/g, " ")} block cannot be edited`, code: "INVALID_STATUS" });
    }
    const data = parsed.data;
    const nextBillingMode = data.billingMode ?? block.billingMode;
    const nextAgencyName = data.agencyName !== undefined ? data.agencyName : block.agencyName;
    const nextContactName = data.contactName !== undefined ? data.contactName : block.contactName;
    const nextContactEmail = data.contactEmail !== undefined ? data.contactEmail : block.contactEmail;
    if (!String(nextContactName || "").trim() || !String(nextContactEmail || "").trim()) {
      return res.status(400).json({ error: "Group leader name and billing email are required", code: "BILLING_CONTACT_REQUIRED" });
    }
    if (billingUsesMasterFolio(nextBillingMode) && !String(nextAgencyName || "").trim()) {
      return res.status(400).json({ error: "Agency or company name is required for agency billing", code: "AGENCY_NAME_REQUIRED" });
    }
    const pickedUp = block.rooms.reduce((sum: number, room: any) => sum + room.pickedUp, 0);
    const datesTouched = data.checkIn !== undefined || data.checkOut !== undefined;
    if (datesTouched && pickedUp > 0) {
      return res.status(409).json({
        error: "Rooms have already been picked up from this block, so its dates are fixed. Edit the reservations instead.",
        code: "BLOCK_ALREADY_PICKED_UP",
      });
    }
    if (data.billingMode !== undefined && data.billingMode !== block.billingMode && pickedUp > 0) {
      return res.status(409).json({
        error: "The billing mode is fixed after the first room is picked up because agency liabilities already exist.",
        code: "BILLING_MODE_LOCKED",
      });
    }
    if (
      data.billingMode !== undefined
      && data.billingMode !== block.billingMode
      && ((block.masterFolio?.payments ?? []).some((payment: any) => !payment.voidedAt) || (block.masterFolio?.proFormas ?? []).length > 0)
    ) {
      return res.status(409).json({
        error: "Billing responsibility is fixed after a Pro Forma or agency payment has been recorded.",
        code: "BILLING_MODE_HAS_FINANCIAL_HISTORY",
      });
    }

    const dates = readDates({
      checkIn: data.checkIn ?? block.checkIn.toISOString(),
      checkOut: data.checkOut ?? block.checkOut.toISOString(),
      cutOffAt: data.cutOffAt ?? block.cutOffAt.toISOString(),
    });
    if ("error" in dates) return res.status(400).json({ error: dates.error });

    await prisma.$transaction(async (tx: any) => {
      const changed = await tx.nrmsGroupBlock.update({
        where: { id: block.id },
        data: {
          ...(data.name !== undefined ? { name: sanitizeText(data.name) } : {}),
          ...(data.agencyName !== undefined ? { agencyName: data.agencyName ? sanitizeText(data.agencyName) : null } : {}),
          ...(data.contactName !== undefined ? { contactName: sanitizeText(data.contactName) } : {}),
          ...(data.contactPhone !== undefined ? { contactPhone: data.contactPhone ? sanitizeText(data.contactPhone) : null } : {}),
          ...(data.contactEmail !== undefined ? { contactEmail: sanitizeText(data.contactEmail).toLowerCase() } : {}),
          ...(data.billingMode !== undefined ? { billingMode: data.billingMode } : {}),
          ...(data.notes !== undefined ? { notes: data.notes ? sanitizeText(data.notes) : null } : {}),
          ...(datesTouched ? { checkIn: dates.checkIn, checkOut: dates.checkOut } : {}),
          ...(data.cutOffAt !== undefined ? { cutOffAt: dates.cutOffAt } : {}),
        },
      });
      await ensureMasterFolioForBlock(tx, changed);
    });
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.json({ block: formatBlock(updated) });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] edit failed", err);
    res.status(500).json({ error: "Failed to update the group block" });
  }
}) as RequestHandler);

/** One agency transfer lands here once, against the master folio. */
router.post("/blocks/:blockId/master-folio/payments", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = masterPaymentSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid agency payment", details: parsed.error.flatten() });
    const actorId = req.user!.id;
    const accessible = await loadDocumentAccessibleBlock(req, res, Number(req.params.blockId));
    if (!accessible) return;
    const { block } = accessible;
    if (!billingUsesMasterFolio(block.billingMode) || !block.masterFolio) {
      return res.status(409).json({ error: "This block does not have an agency master folio", code: "MASTER_FOLIO_MISSING" });
    }
    const masterFolioId = block.masterFolio.id;
    const data = parsed.data;
    await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, block.propertyId);
      const folio = await tx.nrmsMasterFolio.findFirst({ where: { id: masterFolioId, ownerId: block.ownerId, blockId: block.id } });
      if (!folio) throw new Error("NRMS_MASTER_FOLIO_MISSING");
      const totals = await getMasterFolioTotals(tx, folio.id);
      const latestProForma = await tx.nrmsMasterFolioProForma.findFirst({
        where: { masterFolioId: folio.id, status: { in: ["DRAFT", "SENT"] } },
        orderBy: { revision: "desc" },
        select: { quotedTotal: true },
      });
      // Before pickup, the ledger can legitimately have no room items yet.
      // The current Pro Forma is the approved ceiling for an advance payment;
      // after pickup, actual routed charges remain authoritative if higher.
      const payableTotal = Math.max(totals.billed, Number(latestProForma?.quotedTotal ?? 0));
      const payableBalance = Number((payableTotal - totals.paid).toFixed(2));
      if (payableBalance <= 0.005) throw new Error("NRMS_MASTER_PAYMENT_COMPLETE");
      if (data.amount > payableBalance + 0.005) throw new Error(`NRMS_MASTER_PAYMENT_EXCEEDS_BALANCE:${payableBalance}`);
      await tx.nrmsMasterFolioPayment.create({
        data: {
          masterFolioId: folio.id,
          amount: data.amount,
          currency: folio.currency,
          method: data.method,
          reference: data.reference ? sanitizeText(data.reference) : null,
          receiptNumber: buildMasterPaymentReceiptNumber(folio.id),
          note: data.note ? sanitizeText(data.note) : null,
          recordedById: actorId,
        },
      });
      await refreshMasterFolioStatus(tx, folio.id);
    }, EXTENDED_TX_OPTIONS);
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.status(201).json({ block: formatBlock(updated), masterFolio: formatBlock(updated).masterFolio });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_COMPLETE") return res.status(409).json({ error: "The agency master folio is already settled", code: "PAYMENT_COMPLETE" });
    if (err instanceof Error && err.message.startsWith("NRMS_MASTER_PAYMENT_EXCEEDS_BALANCE:")) {
      const balance = Number(err.message.split(":")[1] ?? 0);
      return res.status(400).json({ error: `Payment cannot exceed the agency balance of ${balance.toLocaleString()}`, code: "PAYMENT_EXCEEDS_BALANCE", balance });
    }
    if (err instanceof Error && err.message === "NRMS_MASTER_FOLIO_MISSING") return res.status(409).json({ error: "The agency master folio is missing", code: "MASTER_FOLIO_MISSING" });
    console.error("[owner.nrms.groupBlocks] master payment failed", err);
    res.status(500).json({ error: "Failed to record the agency payment" });
  }
}) as RequestHandler);

router.post("/blocks/:blockId/master-folio/payments/:paymentId/void", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = paymentVoidSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "A void reason is required" });
    const accessible = await loadDocumentAccessibleBlock(req, res, Number(req.params.blockId));
    if (!accessible) return;
    if (accessible.access.role === "FRONT_DESK") return res.status(403).json({ error: "Only the property owner or manager can void an agency payment", code: "AGENCY_PAYMENT_VOID_FORBIDDEN" });
    const { block } = accessible;
    if (!block.masterFolio) return res.status(404).json({ error: "Agency master folio not found" });
    const masterFolioId = block.masterFolio.id;
    const paymentId = Number(req.params.paymentId);
    if (!Number.isInteger(paymentId) || paymentId <= 0) return res.status(400).json({ error: "Invalid agency payment id" });
    await prisma.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, block.propertyId);
      const payment = await tx.nrmsMasterFolioPayment.findFirst({ where: { id: paymentId, masterFolioId } });
      if (!payment) throw new Error("NRMS_MASTER_PAYMENT_NOT_FOUND");
      if (payment.voidedAt) throw new Error("NRMS_MASTER_PAYMENT_ALREADY_VOID");
      await tx.nrmsMasterFolioPayment.update({
        where: { id: payment.id },
        data: { voidedAt: new Date(), voidReason: sanitizeText(parsed.data.reason) },
      });
      await refreshMasterFolioStatus(tx, masterFolioId);
    }, EXTENDED_TX_OPTIONS);
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.json({ block: formatBlock(updated), masterFolio: formatBlock(updated).masterFolio });
  } catch (err) {
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_NOT_FOUND") return res.status(404).json({ error: "Agency payment not found" });
    if (err instanceof Error && err.message === "NRMS_MASTER_PAYMENT_ALREADY_VOID") return res.status(409).json({ error: "Agency payment is already voided" });
    console.error("[owner.nrms.groupBlocks] master payment void failed", err);
    res.status(500).json({ error: "Failed to void the agency payment" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/pickup
 *
 * Names one held room: the second half of the group flow. A held room becomes a
 * real CONFIRMED reservation, the block's held count drops by one, and the
 * reservation joins the operational group so the desk can work the party as a
 * unit later.
 *
 * The work itself lives in lib/nrmsGroupPickup so confirming a rooming list row
 * takes exactly this path rather than a second copy of it.
 */
router.post("/blocks/:blockId/pickup", (async (req: AuthedRequest, res: Response) => {
  try {
    const parsed = pickupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid pickup", details: parsed.error.flatten() });
    const ownerId = req.user!.id;
    const block = await loadOwnedBlock(res, ownerId, Number(req.params.blockId));
    if (!block) return;
    if (!LIVE_STATUSES.includes(block.status)) {
      return res.status(409).json({ error: "This block is no longer holding rooms", code: "INVALID_STATUS" });
    }
    const data = parsed.data;

    // Guest profile is resolved outside the transaction: it touches no
    // inventory and keeps the locked section short.
    const guest = await resolveGroupGuestProfile(block.propertyId, ownerId, data.guest);
    if ("error" in guest) return res.status(400).json({ error: "Guest profile not found for this property" });

    const outcome = await runBlockPickup({
      blockId: block.id,
      ownerId,
      blockRoomId: data.blockRoomId,
      guestProfileId: guest.guestProfileId,
      adults: data.adults,
      children: data.children,
      roomUnitId: data.roomUnitId ?? null,
      notes: data.notes ?? null,
      actorId: ownerId,
    });

    if ("error" in outcome) return res.status(pickupStatus(outcome.error)).json(pickupErrorBody(outcome));

    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.status(201).json({ block: formatBlock(updated), reservationId: outcome.reservationId, groupId: outcome.groupId });
  } catch (err) {
    if (err instanceof Error && err.message === PICKUP_RACE) {
      return res.status(409).json({ error: "Another room from this block was named at the same time. Try again.", code: "PICKUP_RACE" });
    }
    console.error("[owner.nrms.groupBlocks] pickup failed", err);
    res.status(500).json({ error: "Failed to name this room" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/release
 *
 * Hands the still-unnamed rooms back to sale. Reservations already picked up
 * from the block are untouched: they are real stays now and belong to their
 * guests, not to the agreement that produced them.
 */
router.post("/blocks/:blockId/release", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const block = await loadOwnedBlock(res, ownerId, Number(req.params.blockId));
    if (!block) return;
    if (!LIVE_STATUSES.includes(block.status)) {
      return res.status(409).json({ error: "This block is no longer holding any rooms", code: "INVALID_STATUS" });
    }
    const pickedUp = block.rooms.reduce((sum: number, room: any) => sum + room.pickedUp, 0);
    const released = await prisma.nrmsGroupBlock.updateMany({
      where: { id: block.id, ownerId, status: { in: LIVE_STATUSES } },
      // A block that gave up some rooms is finished, not cancelled: PICKED_UP
      // records that it produced business, RELEASED that it produced none.
      data: { status: pickedUp > 0 ? "PICKED_UP" : "RELEASED", releasedAt: new Date() },
    });
    if (released.count !== 1) return res.status(409).json({ error: "The block changed before it could be released", code: "INVALID_STATUS" });
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.json({ block: formatBlock(updated), roomsReturned: block.rooms.reduce((sum: number, room: any) => sum + Math.max(0, room.quantity - room.pickedUp), 0) });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] release failed", err);
    res.status(500).json({ error: "Failed to release the group block" });
  }
}) as RequestHandler);

/**
 * POST /blocks/:blockId/cancel
 *
 * The agreement itself fell through. Only available while nothing has been
 * picked up: once real guests exist the block produced business, and the honest
 * record of that is a release, not a cancellation.
 */
router.post("/blocks/:blockId/cancel", (async (req: AuthedRequest, res: Response) => {
  try {
    const ownerId = req.user!.id;
    const block = await loadOwnedBlock(res, ownerId, Number(req.params.blockId));
    if (!block) return;
    if (!LIVE_STATUSES.includes(block.status)) {
      return res.status(409).json({ error: "This block is already closed", code: "INVALID_STATUS" });
    }
    const pickedUp = block.rooms.reduce((sum: number, room: any) => sum + room.pickedUp, 0);
    if (pickedUp > 0) {
      return res.status(409).json({
        error: `${pickedUp} ${pickedUp === 1 ? "guest has" : "guests have"} already been named from this block, so it cannot be cancelled. Release the rooms still held instead.`,
        code: "BLOCK_ALREADY_PICKED_UP",
      });
    }
    const cancelled = await prisma.nrmsGroupBlock.updateMany({
      where: { id: block.id, ownerId, status: { in: LIVE_STATUSES } },
      data: { status: "CANCELLED", releasedAt: new Date() },
    });
    if (cancelled.count !== 1) return res.status(409).json({ error: "The block changed before it could be cancelled", code: "INVALID_STATUS" });
    const updated = await prisma.nrmsGroupBlock.findUnique({ where: { id: block.id }, include: blockInclude });
    res.json({ block: formatBlock(updated) });
  } catch (err) {
    console.error("[owner.nrms.groupBlocks] cancel failed", err);
    res.status(500).json({ error: "Failed to cancel the group block" });
  }
}) as RequestHandler);

export default router;
