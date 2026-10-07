// apps/api/src/routes/owner.properties.layout.ts
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { Layout } from "../lib/layoutTypes.js";
import { regenerateAndSaveLayout } from "../lib/autoLayout.js";
import { getNrmsMarketplaceHolds } from "../lib/nrmsAvailability.js";

export const router = Router();
router.use(requireAuth, requireRole("OWNER"));

router.get("/:id/layout", async (req, res) => {
  const ownerId = (req as AuthedRequest).user!.id;
  const id = Number((req as any).params.id);
  const prop = await prisma.property.findFirst({
    where: { id, ownerId },
    select: { id: true, layout: true, totalFloors: true }
  });
  if (!prop) return res.status(404).json({ error: "Not found" });

  // If this is a multi-storey property but a legacy 1-floor layout was saved,
  // auto-upgrade it so owners can switch floors immediately.
  const desiredFloors = typeof prop.totalFloors === "number" && prop.totalFloors >= 2 ? prop.totalFloors : 1;
  if (desiredFloors > 1 && prop.layout) {
    try {
      const parsed = Layout.parse(prop.layout as any);
      if ((parsed.floors?.length ?? 0) < desiredFloors) {
        const layout = await regenerateAndSaveLayout(id);
        return res.json(layout);
      }
    } catch {
      // If parsing fails, leave as-is; owner can still force regenerate via POST.
    }
  }

  res.json(prop.layout ?? null);
});

router.post("/:id/layout/generate", async (req, res) => {
  const ownerId = (req as AuthedRequest).user!.id;
  const id = Number((req as any).params.id);
  const prop = await prisma.property.findFirst({
    where: { id, ownerId },
    select: { id: true }
  });
  if (!prop) return res.status(404).json({ error: "Not found" });

  const layout = await regenerateAndSaveLayout(id);
  res.json(layout);
});

router.get("/:id/availability", async (req, res) => {
  const ownerId = (req as AuthedRequest).user!.id;
  const id = Number((req as any).params.id);
  const prop = await prisma.property.findFirst({
    where: { id, ownerId },
    select: { id: true, layout: true, roomsSpec: true }
  });
  if (!prop) return res.status(404).json({ error: "Not found" });
  if (!prop.layout) return res.status(400).json({ error: "No layout yet" });

  // parse window
  const from = (req as any).query.from ? new Date(String((req as any).query.from)) : new Date();
  const to   = (req as any).query.to   ? new Date(String((req as any).query.to))   : new Date(Date.now() + 86400000);
  if (!(from instanceof Date) || isNaN(+from) || !(to instanceof Date) || isNaN(+to) || +to <= +from) {
    return res.status(400).json({ error: "Invalid date range" });
  }

  // normalize to midnight to count nights cleanly
  const clipStart = startOfDay(from);
  const clipEnd   = startOfDay(to); // checkout-style; nights = days between
  const nightsTotal = Math.max(1, diffNights(clipStart, clipEnd)); // avoid zero

  // Which room codes exist in the layout?
  let layout: any;
  try { layout = Layout.parse(prop.layout as any); } catch { layout = prop.layout as any; }
  const roomCodes: string[] = (layout?.floors ?? [])
    .flatMap((f:any)=> (f.rooms ?? []).map((r:any)=> r.code))
    .filter(Boolean);

  // Fetch bookings that overlap the window for this property
  const [bookings, blocks, nrmsHolds] = await Promise.all([
    prisma.booking.findMany({
      where: {
        propertyId: id,
        checkIn:  { lt: clipEnd },
        checkOut: { gt: clipStart },
        status: { in: ["CONFIRMED", "CHECKED_IN"] },
      },
      select: { id: true, checkIn: true, checkOut: true, status: true, roomCode: true, guestName: true, totalAmount: true }
    }),
    prisma.propertyAvailabilityBlock.findMany({
      where: {
        propertyId: id,
        migratedReservationId: null,
        startDate: { lt: clipEnd },
        endDate:   { gt: clipStart },
      },
      select: { id: true, startDate: true, endDate: true, roomCode: true, source: true, bedsBlocked: true }
    }),
    // NRMS reservations and group blocks: the front desk's own stays.
    getNrmsMarketplaceHolds(prisma, id, clipStart, clipEnd),
  ]);

  // Bookings and external blocks are usually recorded against a room TYPE
  // ("Single", or a roomsSpec code), not a physical room ("Single-8"). Place
  // each type-level stay on a free room of that type so the floor plan shows
  // the real occupancy instead of every room as free.
  const unitsByType = new Map<string, string[]>();
  for (const f of layout?.floors ?? []) {
    for (const r of f.rooms ?? []) {
      if (!r?.code) continue;
      const typeKey = String(r.name ?? r.code).replace(/\s+\d+$/, "").trim().toLowerCase();
      if (!unitsByType.has(typeKey)) unitsByType.set(typeKey, []);
      unitsByType.get(typeKey)!.push(r.code);
    }
  }
  const typeAlias = new Map<string, string>();
  for (const spec of Array.isArray(prop.roomsSpec) ? (prop.roomsSpec as any[]) : []) {
    const typeName = String(spec?.roomType ?? "").trim().toLowerCase();
    const code = String(spec?.roomCode ?? spec?.code ?? "").trim().toLowerCase();
    if (typeName && code) typeAlias.set(code, typeName);
  }
  const roomCodeSet = new Set(roomCodes);
  const unitsFor = (raw: string): string[] => {
    const key = raw.trim().toLowerCase();
    const candidates = [key, typeAlias.get(key), key.replace(/-\d+$/, ""), typeAlias.get(key.replace(/-\d+$/, ""))];
    for (const c of candidates) if (c && unitsByType.has(c)) return unitsByType.get(c)!;
    return [];
  };
  const taken = new Map<string, Array<[number, number]>>();
  const isFree = (code: string, s: Date, e: Date) =>
    !(taken.get(code) ?? []).some(([a, b]) => +s < b && +e > a);
  const occupy = (code: string, s: Date, e: Date) => {
    if (!taken.has(code)) taken.set(code, []);
    taken.get(code)!.push([+s, +e]);
  };
  /** Exact room if the code names one; otherwise up to `count` free rooms of the type. */
  const place = (raw: string | null, s: Date, e: Date, count: number): string[] => {
    if (!raw) return [];
    if (roomCodeSet.has(raw)) { occupy(raw, s, e); return [raw]; }
    const units = unitsFor(raw);
    const chosen: string[] = [];
    for (const u of units) {
      if (chosen.length >= count) break;
      if (isFree(u, s, e)) { chosen.push(u); occupy(u, s, e); }
    }
    return chosen;
  };

  // Exact-room records first so type-level ones fill around them.
  const exactFirst = <T extends { roomCode: string | null }>(xs: T[]) =>
    [...xs].sort((a, b) => Number(!roomCodeSet.has(a.roomCode ?? "")) - Number(!roomCodeSet.has(b.roomCode ?? "")));

  // Index bookings by room + compute overlapped nights
  const byCode: Record<string, { id:number; checkIn:Date; checkOut:Date; status:string; nights:number; guestName?: string | null; totalAmount?: any }[]> = {};
  for (const b of exactFirst(bookings as any[])) {
    const n = overlapNights(clipStart, clipEnd, b.checkIn, b.checkOut);
    if (n <= 0) continue;
    for (const code of place(b.roomCode ?? null, startOfDay(b.checkIn), startOfDay(b.checkOut), 1)) {
      if (!byCode[code]) byCode[code] = [];
      byCode[code].push({ id: b.id, checkIn: b.checkIn, checkOut: b.checkOut, status: b.status, nights: n, guestName: b.guestName, totalAmount: b.totalAmount });
    }
  }

  const blocksByCode: Record<string, { id:number; startDate:Date; endDate:Date; source:string|null; nights:number }[]> = {};

  // NRMS reservations are guests in rooms, so they count as bookings; group
  // blocks still waiting for names count as blocks. An assigned NRMS room whose
  // unit code matches a floor-plan room goes there; otherwise by room type.
  for (const h of exactFirst(nrmsHolds.map((x) => ({ ...x, roomCode: x.roomUnitCode && roomCodeSet.has(x.roomUnitCode) ? x.roomUnitCode : x.roomTypeName })))) {
    const n = overlapNights(clipStart, clipEnd, h.startDate, h.endDate);
    if (n <= 0) continue;
    const codes = place(h.roomCode, startOfDay(h.startDate), startOfDay(h.endDate), Math.max(1, h.bedsBlocked || 1));
    for (const code of codes) {
      if (h.nrmsKind === "RESERVATION") {
        if (!byCode[code]) byCode[code] = [];
        byCode[code].push({ id: h.id, checkIn: h.startDate, checkOut: h.endDate, status: "NRMS", nights: n, guestName: h.label, totalAmount: null });
      } else {
        if (!blocksByCode[code]) blocksByCode[code] = [];
        blocksByCode[code].push({ id: h.id, startDate: h.startDate, endDate: h.endDate, source: "NRMS_GROUP", nights: n });
      }
    }
  }

  // Index blocks by room (null roomCode = all rooms; a type code = that many rooms of the type)
  for (const bl of exactFirst(blocks as any[])) {
    const n = overlapNights(clipStart, clipEnd, bl.startDate, bl.endDate);
    if (n <= 0) continue;
    const codes = bl.roomCode
      ? place(bl.roomCode, startOfDay(bl.startDate), startOfDay(bl.endDate), Math.max(1, Number(bl.bedsBlocked) || 1))
      : roomCodes;
    for (const code of codes) {
      if (!blocksByCode[code]) blocksByCode[code] = [];
      blocksByCode[code].push({ id: bl.id, startDate: bl.startDate, endDate: bl.endDate, source: bl.source, nights: n });
    }
  }

  // Build response: bookings + blocks both contribute to occupancy
  const rooms = roomCodes.map(code => {
    const bs  = byCode[code]      ?? [];
    const bls = blocksByCode[code] ?? [];
    const nightsBooked  = bs.reduce((s, x) => s + x.nights, 0);
    const nightsBlocked = bls.reduce((s, x) => s + x.nights, 0);
    const nightsOccupied = Math.min(nightsTotal, nightsBooked + nightsBlocked);
    const pct = (nightsOccupied / nightsTotal) * 100;
    return {
      code,
      busy: pct > 0,
      occupancyPct:   Math.round(pct),
      nightsBooked,
      nightsBlocked,
      nightsOccupied,
      nightsTotal,
      bookings: bs.map(b => ({
        id: b.id,
        checkIn:  b.checkIn  instanceof Date ? b.checkIn.toISOString()  : b.checkIn,
        checkOut: b.checkOut instanceof Date ? b.checkOut.toISOString() : b.checkOut,
        status: b.status,
        guestName: b.guestName,
        totalAmount: b.totalAmount,
      })),
      blocks: bls.map(bl => ({
        id: bl.id,
        startDate: bl.startDate instanceof Date ? bl.startDate.toISOString() : bl.startDate,
        endDate:   bl.endDate   instanceof Date ? bl.endDate.toISOString()   : bl.endDate,
        source: bl.source,
        nights: bl.nights,
      })),
    };
  });

  // Convert Date objects to ISO strings for JSON serialization
  res.json({ 
    window: { 
      from: clipStart instanceof Date ? clipStart.toISOString() : clipStart, 
      to: clipEnd instanceof Date ? clipEnd.toISOString() : clipEnd 
    }, 
    rooms, 
    nightsTotal 
  });
});

/* ----- local helpers (put at bottom of this file) ----- */
function startOfDay(d: Date) {
  const x = new Date(d);
  x.setHours(0,0,0,0);
  return x;
}
function diffNights(a: Date, b: Date) {
  const MS = 24 * 60 * 60 * 1000;
  return Math.round((+b - +a) / MS);
}
function overlapNights(winStart: Date, winEnd: Date, bIn: Date, bOut: Date) {
  // Treat [checkIn, checkOut) like hotel nights
  const s = Math.max(+startOfDay(bIn), +winStart);
  const e = Math.min(+startOfDay(bOut), +winEnd);
  if (e <= s) return 0;
  return diffNights(new Date(s), new Date(e));
}
