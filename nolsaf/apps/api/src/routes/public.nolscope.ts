/**
 * NoLScope – Public Cost Estimation API
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes:
 *   GET  /api/public/nolscope/destinations          list all active destinations
 *   GET  /api/public/nolscope/visa-fee/:nationality visa fee for one nationality
 *   GET  /api/public/nolscope/activities?dest=CODE  activities for a destination
 *   POST /api/public/nolscope/estimate              compute + persist breakdown
 *   GET  /api/public/nolscope/estimate/:id          retrieve a saved estimate
 *
 * All monetary values are in USD unless noted.
 * No authentication required — this is a public planning tool.
 * Estimates are saved to the trip_estimates table for analytics + retrieval.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import { prisma } from '@nolsaf/prisma';
import { asyncHandler } from '../middleware/errorHandler.js';
import { z } from 'zod';
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { getAnonymizedClientIp, truncateSessionId } from '../lib/privacy.js';

const router = Router();

// ─── rate limiters ────────────────────────────────────────────────────────────

// Strict limiter for compute-heavy estimate creation
const limitNolScopeEstimate = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 5, // 5 estimates per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    error: 'rate_limited',
    message: 'Too many estimate requests. Please wait 15 minutes before creating another.' 
  },
  keyGenerator: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return `nolscope-estimate:${ip}`;
  }
});

// Moderate limiter for public read endpoints
const limitNolScopeList = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 60, // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return `nolscope-read:${ip}`;
  }
});

// ─── validation schemas ───────────────────────────────────────────────────────

const TransportPreferenceSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;

  if (normalized === 'private') return 'private-car';
  if (normalized === 'shared') return 'shared-taxi';

  return normalized;
}, z.enum([
  'flight', 'bus', 'private-car', 'ferry', 'shared-taxi', 'any'
], { message: 'Invalid transport preference' }));

const EstimateRequestSchema = z.object({
  nationality: z.string()
    .length(2, 'Nationality must be 2-letter country code')
    .regex(/^[A-Z]{2}$/, 'Nationality must be uppercase ISO 3166-1 alpha-2 code')
    .transform(v => v.toUpperCase()),
  
  destinations: z.array(
    z.object({
      code: z.string()
        .min(2, 'Destination code too short')
        .max(30, 'Destination code too long')
        .regex(/^[A-Z0-9_-]+$/i, 'Invalid destination code format')
        .transform(v => v.toUpperCase()),
      days: z.number()
        .int('Days must be an integer')
        .min(1, 'Minimum 1 day required')
        .max(30, 'Maximum 30 days per destination')
    })
  )
  .min(1, 'At least one destination required')
  .max(10, 'Maximum 10 destinations allowed'),
  
  startDate: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional()
    .transform(v => v ? new Date(v) : undefined),
  
  travelers: z.object({
    adults: z.number()
      .int('Adults must be an integer')
      .min(1, 'At least 1 adult required')
      .max(20, 'Maximum 20 adults allowed'),
    children: z.number()
      .int('Children must be an integer')
      .min(0, 'Children cannot be negative')
      .max(10, 'Maximum 10 children allowed')
      .optional()
      .default(0)
  }),
  
  transportPreference: TransportPreferenceSchema
    .optional()
    .default('any'),
  
  activities: z.array(
    z.string()
      .max(100, 'Activity code too long')
      .regex(/^[A-Z0-9_-]+$/i, 'Invalid activity code format')
  )
  .max(50, 'Maximum 50 activities allowed')
  .optional()
  .default([]),
  
  tier: z.enum(['budget', 'standard', 'luxury'], {
    message: 'Tier must be: budget, standard, or luxury'
  })
    .optional()
    .default('standard')
}).strict(); // Reject unknown fields

// ─── types ────────────────────────────────────────────────────────────────────

interface DestinationInput {
  code: string;
  days: number;
}

interface EstimateRequestBody {
  nationality: string;
  /** Array of destinations IN VISIT ORDER with how many nights to spend at each */
  destinations: DestinationInput[];
  /** ISO date string — used to determine season/pricing multiplier */
  startDate?: string;
  travelers: { adults: number; children?: number };
  /** Preferred transport mode between destinations */
  transportPreference?: 'flight' | 'bus' | 'private-car' | 'ferry' | 'shared-taxi' | 'any';
  /** Activity codes from the activity_costs table to include in estimate */
  activities?: string[];
  /** Accommodation quality tier — drives nightly rate base */
  tier?: 'budget' | 'standard' | 'luxury';
}

// ─── constants ────────────────────────────────────────────────────────────────

/** Nightly accommodation base rates per ADULT (USD) — multiplied by destination's accommodationMultiplier */
const ACCOMMODATION_RATES = {
  budget:   { min: 25,  avg: 40,  max: 65  },
  standard: { min: 70,  avg: 110, max: 165 },
  luxury:   { min: 200, avg: 320, max: 560 },
} as const;

/** Destination code → park fee table code, for cases where they differ */
const PARK_CODE_ALIASES: Record<string, string> = {
  SELOUS: 'NYERERE', // destination is SELOUS, park fee row uses NYERERE
};

/** Service charge percentage applied by NoLScope on top of the trip subtotal */
const SERVICE_CHARGE_PCT = 5;

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Coerce Prisma Decimal → plain JS number */
const n = (val: unknown): number =>
  val !== null && typeof val === 'object' && 'toNumber' in (val as object)
    ? (val as any).toNumber()
    : Number(val ?? 0);

const r2 = (val: number) => Math.round(val * 100) / 100;

/**
 * Returns true when `month` (1–12) falls within the range [start, end].
 * Handles year-wrap correctly e.g. Dec–Feb: start=12, end=2.
 */
function monthInRange(month: number, start: number | null | undefined, end: number | null | undefined): boolean {
  if (!start || !end) return false;
  if (start <= end) return month >= start && month <= end;
  return month >= start || month <= end;
}

// ─── GET /api/public/nolscope/destinations ────────────────────────────────────

const listDestinations = async (_req: any, res: any) => {
  const destinations = await (prisma as any).tripDestination.findMany({
    where: { isActive: true },
    orderBy: { popularity: 'desc' },
    select: {
      destinationCode: true,
      destinationName: true,
      displayName: true,
      destinationType: true,
      region: true,
      nearestCity: true,
      mainAirport: true,
      accessDifficulty: true,
      bestMonths: true,
      peakMonths: true,
      offPeakMonths: true,
      avgStayDays: true,
      description: true,
      imageUrl: true,
      popularity: true,
    },
  });
  return res.json({ destinations });
};

// ─── GET /api/public/nolscope/visa-fee/:nationality ───────────────────────────

const getVisaFee = async (req: any, res: any) => {
  const nat = String(req.params.nationality ?? '').toUpperCase().trim().slice(0, 5);
  if (!nat) return res.status(400).json({ error: 'nationality is required' });

  let row: any = await (prisma as any).visaFee.findFirst({
    where: { nationality: nat, visaType: 'tourist', isActive: true },
    orderBy: { entries: 'asc' },
  });

  const isFallback = !row;
  if (!row) {
    // Fall back to XX (default rate)
    row = await (prisma as any).visaFee.findFirst({
      where: { nationality: 'XX', visaType: 'tourist', isActive: true },
    });
  }

  if (!row) {
    return res.json({ nationality: nat, amount: 50, currency: 'USD', entries: 'single', durationDays: 90, fallback: true });
  }

  return res.json({
    nationality: nat,
    amount: n(row.amount),
    currency: row.currency ?? 'USD',
    entries: row.entries,
    durationDays: row.durationDays,
    visaType: row.visaType,
    processingTime: row.processingTime,
    description: row.description,
    fallback: isFallback,
  });
};

// ─── GET /api/public/nolscope/activities ─────────────────────────────────────

const listActivities = async (req: any, res: any) => {
  const dest = String((req.query as any)?.dest ?? '').trim();
  const cat  = String((req.query as any)?.category ?? '').trim();

  const where: any = { isActive: true };
  if (dest) {
    // Match against destination name (case-insensitive)
    where.destination = { contains: dest };
  }
  if (cat) where.category = cat;

  const activities = await (prisma as any).activityCost.findMany({
    where,
    orderBy: { popularity: 'desc' },
    select: {
      activityCode: true,
      activityName: true,
      category: true,
      destination: true,
      averageCost: true,
      minCost: true,
      maxCost: true,
      priceUnit: true,
      duration: true,
      durationHours: true,
      difficulty: true,
      includes: true,
      excludes: true,
      requirements: true,
      description: true,
      popularity: true,
    },
  });

  return res.json({ activities });
};

// ─── POST /api/public/nolscope/estimate ──────────────────────────────────────

const createEstimate = async (req: any, res: any) => {
  // ── input validation with Zod ──────────────────────────────────────────────
  const validation = EstimateRequestSchema.safeParse(req.body);
  
  if (!validation.success) {
    const errors = validation.error.format();
    return res.status(400).json({ 
      error: 'Invalid request data',
      details: errors,
      message: 'Please check your input and try again.'
    });
  }
  
  const body = validation.data;

  // ── extract validated data ──────────────────────────────────────────────────
  const nationality = body.nationality;
  const destInputs = body.destinations;
  const startDate = body.startDate || new Date();
  const adults = body.travelers.adults;
  const children = body.travelers.children || 0;
  const totalPax = adults + children;
  const totalDays = destInputs.reduce((s, d) => s + d.days, 0);
  const travelMonth = startDate.getMonth() + 1; // JS months are 0-based
  const transportPref = body.transportPreference || 'any';
  const tier = body.tier || 'standard';
  const requestedActivityCodes = body.activities || [];

  const destCodes = destInputs.map((d) => d.code.toUpperCase());

  // ── fetch all reference data in parallel ────────────────────────────────────
  const [destinations, visaRows, parkFees, allTransport, activityRows, pricingRules] = await Promise.all([
    (prisma as any).tripDestination.findMany({ where: { destinationCode: { in: destCodes }, isActive: true } }),
    (prisma as any).visaFee.findMany({ where: { nationality: { in: [nationality, 'XX'] }, visaType: 'tourist', isActive: true } }),
    (prisma as any).parkFee.findMany({ where: { isActive: true } }),
    (prisma as any).transportCostAverage.findMany({ where: { isActive: true } }),
    requestedActivityCodes.length > 0
      ? (prisma as any).activityCost.findMany({ where: { activityCode: { in: requestedActivityCodes }, isActive: true } })
      : Promise.resolve([]),
    (prisma as any).pricingRule.findMany({ where: { isActive: true }, orderBy: { priority: 'desc' } }),
  ]);

  // ── build lookup maps ────────────────────────────────────────────────────────
  const destMap    = new Map<string, any>(destinations.map((d: any) => [d.destinationCode, d]));
  const parkFeeMap = new Map<string, any>(parkFees.map((p: any) => [p.parkCode, p]));

  const missing = destCodes.filter((c) => !destMap.has(c));
  if (missing.length > 0)
    return res.status(400).json({ error: `Unknown destination codes: ${missing.join(', ')}. Use GET /api/public/nolscope/destinations for valid codes.` });

  // ── visa ──────────────────────────────────────────────────────────────────────
  const visaRow = visaRows.find((v: any) => v.nationality === nationality)
    ?? visaRows.find((v: any) => v.nationality === 'XX');

  const visaAmountPerAdult = visaRow ? n(visaRow.amount) : 50;
  const visaTotal = r2(visaAmountPerAdult * adults); // children typically free / different rate

  // ── pricing rules — seasonal multiplier ────────────────────────────────────
  const seasonalRules = pricingRules.filter((r: any) =>
    r.startMonth && r.endMonth && monthInRange(travelMonth, r.startMonth, r.endMonth)
  );

  // Global seasonal rule (no destination restriction), highest priority wins
  const globalRule = seasonalRules.find((r: any) => !r.destination) ?? null;
  const globalMultiplier = globalRule ? n(globalRule.priceMultiplier) : 1.0;
  const seasonName: string = globalRule?.seasonName ?? 'standard';

  // ── park fees ─────────────────────────────────────────────────────────────────
  let pfMin = 0, pfAvg = 0, pfMax = 0;
  const parkFeeDetail: any[] = [];

  // EAC citizens get resident rates (TANAPA policy)
  const isResident = ['TZ', 'KE', 'UG', 'RW', 'BI'].includes(nationality.toUpperCase());
  
  // Vehicle entry fees only apply if using private car (foreign-registered vehicles)
  // Safari operators include vehicle costs in their packages; flights bypass this
  const includeVehicleFees = transportPref === 'private-car';

  for (const di of destInputs) {
    const code    = di.code.toUpperCase();
    const dest    = destMap.get(code)!;
    const lookupCode = PARK_CODE_ALIASES[code] ?? code;
    const pf      = parkFeeMap.get(lookupCode);

    if (!pf) continue; // city or island destination — no park entry fee

    const adultFee   = isResident ? n(pf.adultResidentFee) : n(pf.adultForeignerFee);
    const childFee   = isResident ? n(pf.childResidentFee ?? 0) : n(pf.childForeignerFee ?? 0);
    const vehicleFee = includeVehicleFees ? n(pf.vehicleFee ?? 0) : 0;
    const guideFee   = n(pf.guideFee ?? 0);
    const effectiveDays = pf.minimumDays ? Math.max(di.days, pf.minimumDays) : di.days;

    const personTotal  = (adultFee * adults + childFee * children) * effectiveDays;
    const vehicleTotal = vehicleFee * effectiveDays;            // 1 vehicle per group
    const guideTotal   = pf.requiresGuide ? guideFee * effectiveDays : 0;
    const subtotal     = personTotal + vehicleTotal + guideTotal;

    pfMin += subtotal * 0.95;
    pfAvg += subtotal;
    pfMax += subtotal * 1.10;

    parkFeeDetail.push({
      destination:  code,
      parkName:     pf.parkName,
      days:         effectiveDays,
      adultFeePerDay: adultFee,
      rateCategory: isResident ? 'resident' : 'foreigner',
      personFees:   r2(personTotal),
      vehicleFee:   vehicleTotal > 0 ? r2(vehicleTotal) : undefined,
      guideFee:     guideTotal  > 0 ? r2(guideTotal)   : undefined,
      subtotal:     r2(subtotal),
      ...(pf.minimumDays && di.days < pf.minimumDays
        ? { note: `Minimum ${pf.minimumDays} park days required; ${di.days} nights provided` }
        : {}),
    });
  }

  // ── transport between consecutive destinations ──────────────────────────────
  let trMin = 0, trAvg = 0, trMax = 0;
  const transportDetail: any[] = [];

  for (let i = 0; i < destInputs.length - 1; i++) {
    const from = destMap.get(destInputs[i].code.toUpperCase())!;
    const to   = destMap.get(destInputs[i + 1].code.toUpperCase())!;

    // Possible name strings to match the transport_cost_averages table
    const fromNames = Array.from(new Set([from.destinationName, from.nearestCity].filter(Boolean)));
    const toNames   = Array.from(new Set([to.destinationName,   to.nearestCity  ].filter(Boolean)));

    const matchesRoute = (t: any) => {
      const fwd = fromNames.includes(t.fromLocation) && toNames.includes(t.toLocation);
      const rev = toNames.includes(t.fromLocation) && fromNames.includes(t.toLocation);
      return fwd || rev;
    };

    // Filter by preferred transport type; fall back to any if no match
    let candidates: any[] = allTransport.filter((t: any) =>
      matchesRoute(t) && (transportPref === 'any' || t.transportType === transportPref)
    );
    if (candidates.length === 0) {
      candidates = allTransport.filter(matchesRoute);
    }

    if (candidates.length === 0) {
      transportDetail.push({
        from: from.destinationCode,
        to:   to.destinationCode,
        status: 'no-data',
        note: `No transport route found between ${from.destinationName} and ${to.destinationName}. Verify fares directly with operators.`,
      });
      continue;
    }

    // Pick cheapest average among candidates matching preferred type; tiebreak by confidence desc
    candidates.sort((a, b) => n(a.averageCost) - n(b.averageCost) || n(b.confidence) - n(a.confidence));
    const chosen = candidates[0];

    const isPeakMonth = monthInRange(travelMonth, globalRule?.startMonth, globalRule?.endMonth);
    const multiplier  = isPeakMonth ? n(chosen.peakMultiplier) : n(chosen.offPeakMultiplier);
    const isPerVehicle = chosen.transportType === 'private-car';

    const unitMin = n(chosen.minCost)     * multiplier;
    const unitAvg = n(chosen.averageCost) * multiplier;
    const unitMax = n(chosen.maxCost)     * multiplier;

    // Per-vehicle fares: flat per group. All others: per person.
    const legMin = isPerVehicle ? unitMin : unitMin * totalPax;
    const legAvg = isPerVehicle ? unitAvg : unitAvg * totalPax;
    const legMax = isPerVehicle ? unitMax : unitMax * totalPax;

    trMin += legMin;
    trAvg += legAvg;
    trMax += legMax;

    transportDetail.push({
      from:          from.destinationCode,
      to:            to.destinationCode,
      type:          chosen.transportType,
      provider:      chosen.provider ?? undefined,
      durationHours: chosen.durationHours ? n(chosen.durationHours) : undefined,
      priceUnit:     isPerVehicle ? 'per-vehicle' : 'per-person',
      unitCostAvg:   r2(unitAvg),
      legCostAvg:    r2(legAvg),
      requiresBooking: chosen.requiresBooking,
      bookingLeadDays: chosen.bookingLeadDays ?? undefined,
      note:          chosen.description ?? undefined,
    });
  }

  // ── gateway transport for single-destination trips ──────────────────────────
  // If only one destination, add base transport from main gateway
  if (destInputs.length === 1) {
    const dest = destMap.get(destInputs[0].code.toUpperCase())!;
    const gateway = dest.mainAirport?.includes('Zanzibar') || dest.region === 'Zanzibar'
      ? 'Dar es Salaam'
      : dest.mainAirport?.includes('Kilimanjaro')
      ? 'Kilimanjaro Airport'
      : 'Dar es Salaam';

    const destNames = Array.from(new Set([dest.destinationName, dest.displayName, dest.nearestCity].filter(Boolean)));
    const gatewayRoutes = allTransport.filter((t: any) =>
      (t.fromLocation === gateway && destNames.includes(t.toLocation)) ||
      (t.toLocation === gateway && destNames.includes(t.fromLocation))
    );

    if (gatewayRoutes.length > 0) {
      let candidates = gatewayRoutes.filter((t: any) =>
        transportPref === 'any' || t.transportType === transportPref
      );
      if (candidates.length === 0) candidates = gatewayRoutes;

      candidates.sort((a, b) => n(a.averageCost) - n(b.averageCost) || n(b.confidence) - n(a.confidence));
      const chosen = candidates[0];

      const isPeakMonth = monthInRange(travelMonth, globalRule?.startMonth, globalRule?.endMonth);
      const multiplier = isPeakMonth ? n(chosen.peakMultiplier) : n(chosen.offPeakMultiplier);
      const isPerVehicle = chosen.transportType === 'private-car';

      const unitMin = n(chosen.minCost) * multiplier;
      const unitAvg = n(chosen.averageCost) * multiplier;
      const unitMax = n(chosen.maxCost) * multiplier;

      // Round-trip (to destination + return)
      const legMin = isPerVehicle ? unitMin * 2 : unitMin * totalPax * 2;
      const legAvg = isPerVehicle ? unitAvg * 2 : unitAvg * totalPax * 2;
      const legMax = isPerVehicle ? unitMax * 2 : unitMax * totalPax * 2;

      trMin += legMin;
      trAvg += legAvg;
      trMax += legMax;

      transportDetail.push({
        from: gateway,
        to: dest.destinationCode,
        type: chosen.transportType,
        provider: chosen.provider ?? undefined,
        durationHours: chosen.durationHours ? n(chosen.durationHours) : undefined,
        priceUnit: isPerVehicle ? 'per-vehicle' : 'per-person',
        unitCostAvg: r2(unitAvg),
        legCostAvg: r2(legAvg),
        requiresBooking: chosen.requiresBooking,
        bookingLeadDays: chosen.bookingLeadDays ?? undefined,
        note: `Round-trip gateway transport: ${gateway} ↔ ${dest.destinationName}`,
      });
    }
  }

  // ── activities ────────────────────────────────────────────────────────────────
  let acMin = 0, acAvg = 0, acMax = 0;
  const activityDetail: any[] = [];
  const unrecognised: string[] = [];

  if (requestedActivityCodes.length > 0) {
    const foundCodes = new Set(activityRows.map((a: any) => a.activityCode));
    unrecognised.push(...requestedActivityCodes.filter((c) => !foundCodes.has(c)));

    for (const act of activityRows) {
      const isPeakMonth = monthInRange(travelMonth, globalRule?.startMonth, globalRule?.endMonth);
      const multiplier  = isPeakMonth ? n(act.peakMultiplier) : n(act.offPeakMultiplier);
      const isPerPerson = act.priceUnit !== 'per-vehicle' && act.priceUnit !== 'per-group';

      const unitMin = n(act.minCost)     * multiplier;
      const unitAvg = n(act.averageCost) * multiplier;
      const unitMax = n(act.maxCost)     * multiplier;

      const totalMin = isPerPerson ? unitMin * adults : unitMin;
      const totalAvg = isPerPerson ? unitAvg * adults : unitAvg;
      const totalMax = isPerPerson ? unitMax * adults : unitMax;

      acMin += totalMin;
      acAvg += totalAvg;
      acMax += totalMax;

      activityDetail.push({
        activityCode:  act.activityCode,
        activityName:  act.activityName,
        destination:   act.destination,
        category:      act.category,
        priceUnit:     act.priceUnit,
        unitCostAvg:   r2(unitAvg),
        totalCostAvg:  r2(totalAvg),
        includes:      act.includes,
        requirements:  act.requirements ?? undefined,
      });
    }
  }

  // ── accommodation estimate ────────────────────────────────────────────────────
  let accMin = 0, accAvg = 0, accMax = 0;
  const accommodationDetail: any[] = [];
  const base = ACCOMMODATION_RATES[tier];

  for (const di of destInputs) {
    const dest = destMap.get(di.code.toUpperCase())!;
    const accMult = n(dest.accommodationMultiplier);

    // Apply both the destination multiplier and the global seasonal multiplier
    const nightMin = base.min * accMult * globalMultiplier;
    const nightAvg = base.avg * accMult * globalMultiplier;
    const nightMax = base.max * accMult * globalMultiplier;

    const stayMin = nightMin * di.days * adults;
    const stayAvg = nightAvg * di.days * adults;
    const stayMax = nightMax * di.days * adults;

    accMin += stayMin;
    accAvg += stayAvg;
    accMax += stayMax;

    accommodationDetail.push({
      destination:          di.code.toUpperCase(),
      nights:               di.days,
      tier,
      perNightPerAdultAvg:  r2(nightAvg),
      subtotalAvg:          r2(stayAvg),
    });
  }

  // ── tips & gratuities ─────────────────────────────────────────────────────────
  // Culturally expected in Tanzania: safari guides, drivers, hotel/lodge staff
  // Safari parks: $15-20/day (guide + driver), Accommodation: $3-5/night, Activities: $5 each
  const safariDestCount = destInputs.filter((d) => {
    const dest = destMap.get(d.code.toUpperCase());
    return dest && ['national-park', 'conservation-area'].includes(dest.destinationType ?? '');
  }).length;
  
  const safariDays = destInputs.filter((d) => {
    const dest = destMap.get(d.code.toUpperCase());
    return dest && ['national-park', 'conservation-area'].includes(dest.destinationType ?? '');
  }).reduce((sum, d) => sum + d.days, 0);

  const guideTipsMin = safariDays * 12;  // $12/day minimum for guide+driver
  const guideTipsAvg = safariDays * 17;  // $17/day average
  const guideTipsMax = safariDays * 22;  // $22/day maximum

  const accommodationTipsMin = totalDays * 2;  // $2/night for staff
  const accommodationTipsAvg = totalDays * 4;  // $4/night average
  const accommodationTipsMax = totalDays * 6;  // $6/night maximum

  const activityTips = activityDetail.length * 5;  // $5 per activity guide

  const tipsMin = r2(guideTipsMin + accommodationTipsMin + activityTips);
  const tipsAvg = r2(guideTipsAvg + accommodationTipsAvg + activityTips);
  const tipsMax = r2(guideTipsMax + accommodationTipsMax + activityTips);

  // ── travel insurance (recommended) ────────────────────────────────────────────
  // Typically 5-7% of trip cost, covers medical, cancellation, luggage, safari incidents
  const baseSubtotal = visaTotal + pfAvg + trAvg + acAvg + accAvg;
  const insuranceMin = r2(baseSubtotal * 0.05);  // 5%
  const insuranceAvg = r2(baseSubtotal * 0.06);  // 6%
  const insuranceMax = r2(baseSubtotal * 0.07);  // 7%

  // ── service charge ────────────────────────────────────────────────────────────
  const subtotalAvgRaw = visaTotal + pfAvg + trAvg + acAvg + accAvg + tipsAvg + insuranceAvg;
  const scAvg = subtotalAvgRaw * (SERVICE_CHARGE_PCT / 100);
  const scMin = (visaTotal + pfMin + trMin + acMin + accMin + tipsMin + insuranceMin) * (SERVICE_CHARGE_PCT / 100);
  const scMax = (visaTotal + pfMax + trMax + acMax + accMax + tipsMax + insuranceMax) * (SERVICE_CHARGE_PCT / 100);

  // ── totals ────────────────────────────────────────────────────────────────────
  const totalMin = r2(visaTotal + pfMin + trMin + acMin + accMin + tipsMin + insuranceMin + scMin);
  const totalAvg = r2(visaTotal + pfAvg + trAvg + acAvg + accAvg + tipsAvg + insuranceAvg + scAvg);
  const totalMax = r2(visaTotal + pfMax + trMax + acMax + accMax + tipsMax + insuranceMax + scMax);
  const perAdultAvg = r2(totalAvg / adults);

  // Confidence: lower if some transport legs have no data
  const noDataLegs = transportDetail.filter((t) => t.status === 'no-data').length;
  const confidence  = r2(Math.max(0.45, 0.90 - noDataLegs * 0.15));

  // ── data freshness ────────────────────────────────────────────────────────────
  // Derive the latest admin-verified timestamps from already-fetched reference data
  const _maxTs = (rows: any[], ...fields: string[]): string | null => {
    let max = 0;
    for (const row of rows) {
      for (const f of fields) {
        const v = row[f] ? new Date(row[f]).getTime() : 0;
        if (v > max) max = v;
      }
    }
    return max > 0 ? new Date(max).toISOString() : null;
  };
  const fvisa      = _maxTs(visaRows,     'lastVerified', 'updatedAt');
  const fpark      = _maxTs(parkFees,     'lastVerified', 'updatedAt');
  const ftransport = _maxTs(allTransport, 'lastUpdated',  'updatedAt');
  const factivity  = activityRows.length > 0 ? _maxTs(activityRows, 'updatedAt') : null;
  const fpricing   = _maxTs(pricingRules, 'updatedAt');
  const allFreshTs = [fvisa, fpark, ftransport, fpricing].filter(Boolean).map(s => new Date(s!).getTime());
  const dataFreshness = {
    lastUpdatedAt: allFreshTs.length > 0 ? new Date(Math.max(...allFreshTs)).toISOString() : null,
    updatedBy: 'NoLSAF Research Team',
    categories: { visaFees: fvisa, parkFees: fpark, transport: ftransport, activities: factivity, pricingRules: fpricing },
  };

  const responsePayload: any = {
    currency: 'USD',
    travelers: { adults, children, total: totalPax },
    totalDays,
    destinations: destCodes,
    startDate: startDate.toISOString().slice(0, 10),
    travelMonth,
    season: seasonName,
    tier,
    transportPreference: transportPref,

    breakdown: {
      visa: {
        perAdult:       visaAmountPerAdult,
        total:          visaTotal,
        entries:        visaRow?.entries       ?? 'single',
        durationDays:   visaRow?.durationDays  ?? 90,
        processingTime: visaRow?.processingTime ?? 'on-arrival',
        note:           visaRow?.description   ?? undefined,
      },

      parkFees: {
        total:  r2(pfAvg),
        range:  { min: r2(pfMin), max: r2(pfMax) },
        detail: parkFeeDetail,
        note:   isResident
          ? `EAC/Resident rates applied (${nationality.toUpperCase()})${includeVehicleFees ? ' · Vehicle entry fees included' : ''}`
          : `International visitor rates applied${includeVehicleFees ? ' · Vehicle entry fees included' : ''}`,
      },

      transport: {
        total:  r2(trAvg),
        range:  { min: r2(trMin), max: r2(trMax) },
        detail: transportDetail,
      },

      activities: {
        total:  r2(acAvg),
        range:  { min: r2(acMin), max: r2(acMax) },
        detail: activityDetail,
        ...(unrecognised.length > 0 ? { unrecognisedCodes: unrecognised } : {}),
        ...(requestedActivityCodes.length === 0
          ? { note: 'No activities requested. Add activity codes from GET /api/public/nolscope/activities to include them.' }
          : {}),
      },

      accommodation: {
        total:  r2(accAvg),
        range:  { min: r2(accMin), max: r2(accMax) },
        detail: accommodationDetail,
        note:   'Estimate only. Safari lodges/camps often include meals. Prices vary by property, season, and availability.',
      },

      tips: {
        total:  tipsAvg,
        range:  { min: tipsMin, max: tipsMax },
        detail: {
          safariGuidesDrivers: safariDays > 0 ? r2(guideTipsAvg) : undefined,
          accommodationStaff: r2(accommodationTipsAvg),
          activityGuides: activityTips > 0 ? activityTips : undefined,
        },
        note:   'Culturally expected in Tanzania. Tips for safari guides, drivers, hotel/lodge staff, and activity guides.',
      },

      travelInsurance: {
        total:  insuranceAvg,
        range:  { min: insuranceMin, max: insuranceMax },
        percent: 6,
        note:   'Highly recommended. Covers medical emergencies, trip cancellation, lost luggage, and safari-related incidents.',
      },

      serviceCharge: {
        percent: SERVICE_CHARGE_PCT,
        total:   r2(scAvg),
        range:   { min: r2(scMin), max: r2(scMax) },
        note:    'NoLScope planning fee applied to total trip cost',
      },
    },

    totalMin,
    totalAvg,
    totalMax,
    perAdultAvg,
    confidence,

    appliedRules: seasonalRules.map((r: any) => ({
      ruleName:    r.ruleName,
      seasonName:  r.seasonName,
      multiplier:  n(r.priceMultiplier),
      description: r.description,
    })),

    dataFreshness,
    generatedAt: new Date().toISOString(),
  };

  // ── persist to trip_estimates ─────────────────────────────────────────────
  // Best-effort — never fail the response if the DB write fails
  let savedId: number | null = null;
  try {
    const validUntil = new Date(startDate);
    validUntil.setDate(validUntil.getDate() + 30); // estimate valid for 30 days

    // endDate = startDate + totalDays
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + totalDays);

    // Extract user identity from request (optional — anonymous is fine)
    // GDPR compliance: IP addresses are anonymized, session IDs are truncated
    const userId    = (req as any).user?.id   ?? null;
    const sessionId = truncateSessionId(req.headers['x-session-id'] as string | undefined);
    const ipAddress = getAnonymizedClientIp(req);

    const saved = await (prisma as any).tripEstimate.create({
      data: {
        destination:         destCodes.join(', '),
        destinationType:     destCodes.length > 1 ? 'multi' : (destMap.get(destCodes[0])?.destinationType ?? 'unknown'),
        startDate:           startDate,
        endDate:             endDate,
        travelers:           totalPax,
        accommodationLevel:  tier,
        transportPreference: transportPref === 'any' ? null : transportPref,
        nationality:         nationality,
        currency:            'USD',
        requestedActivities: requestedActivityCodes.length > 0 ? requestedActivityCodes : null,

        totalCost:  totalAvg,
        confidence: confidence,
        breakdown:  responsePayload.breakdown,
        minCost:    totalMin,
        maxCost:    totalMax,

        currentSeason:  seasonName,
        offPeakCost:    null,
        offPeakSavings: null,

        validUntil,
        dataSourcesUsed: ['nolscope-seed-data', 'pricing-rules'],

        userId,
        sessionId,
        ipAddress,
      },
      select: { id: true },
    });
    savedId = saved.id;
  } catch (_err) {
    // Non-fatal — estimate is still returned even if save fails
  }

  return res.status(201).json({
    ...responsePayload,
    estimateId: savedId,
  });
};

// ─── GET /api/public/nolscope/estimate/:id ───────────────────────────────────

const getEstimate = async (req: any, res: any) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id) || id < 1) return res.status(400).json({ error: 'invalid estimate id' });

  const row = await (prisma as any).tripEstimate.findUnique({
    where: { id },
    select: {
      id: true,
      destination: true,
      startDate: true,
      endDate: true,
      travelers: true,
      accommodationLevel: true,
      transportPreference: true,
      nationality: true,
      currency: true,
      requestedActivities: true,
      totalCost: true,
      confidence: true,
      breakdown: true,
      minCost: true,
      maxCost: true,
      currentSeason: true,
      validUntil: true,
      convertedToBooking: true,
      createdAt: true,
    },
  });

  if (!row) return res.status(404).json({ error: 'Estimate not found' });

  // Increment view count in background — don't await
  (prisma as any).tripEstimate.update({
    where: { id },
    data: { viewCount: { increment: 1 }, lastViewedAt: new Date() },
  }).catch(() => {});

  return res.json({
    estimateId:   row.id,
    destination:  row.destination,
    startDate:    row.startDate,
    endDate:      row.endDate,
    travelers:    row.travelers,
    tier:         row.accommodationLevel,
    nationality:  row.nationality,
    currency:     row.currency,
    totalAvg:     n(row.totalCost),
    totalMin:     row.minCost ? n(row.minCost) : null,
    totalMax:     row.maxCost ? n(row.maxCost) : null,
    confidence:   n(row.confidence),
    season:       row.currentSeason,
    breakdown:    row.breakdown,
    validUntil:   row.validUntil,
    convertedToBooking: row.convertedToBooking,
    createdAt:    row.createdAt,
  });
};

// ─── GET /api/public/nolscope/data-freshness ────────────────────────────────

const getDataFreshness = async (_req: any, res: any) => {
  const [visaRow, parkRow, transportRow, activityRow, pricingRow] = await Promise.all([
    (prisma as any).visaFee.findFirst({ where: { isActive: true }, orderBy: { lastVerified: 'desc' }, select: { lastVerified: true, updatedAt: true } }),
    (prisma as any).parkFee.findFirst({ where: { isActive: true }, orderBy: { lastVerified: 'desc' }, select: { lastVerified: true, updatedAt: true } }),
    (prisma as any).transportCostAverage.findFirst({ where: { isActive: true }, orderBy: { lastUpdated: 'desc' }, select: { lastUpdated: true, updatedAt: true } }),
    (prisma as any).activityCost.findFirst({ where: { isActive: true }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
    (prisma as any).pricingRule.findFirst({ where: { isActive: true }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
  ]);
  const categories = {
    visaFees:    visaRow      ? ((visaRow.lastVerified      ?? visaRow.updatedAt)      as Date | null)?.toISOString() ?? null : null,
    parkFees:    parkRow      ? ((parkRow.lastVerified      ?? parkRow.updatedAt)      as Date | null)?.toISOString() ?? null : null,
    transport:   transportRow ? ((transportRow.lastUpdated  ?? transportRow.updatedAt) as Date | null)?.toISOString() ?? null : null,
    activities:  activityRow  ? (activityRow.updatedAt  as Date | null)?.toISOString()  ?? null : null,
    pricingRules: pricingRow  ? (pricingRow.updatedAt   as Date | null)?.toISOString()  ?? null : null,
  };
  const allTs = Object.values(categories).filter(Boolean).map(s => new Date(s!).getTime());
  return res.json({
    lastUpdatedAt: allTs.length > 0 ? new Date(Math.max(...allTs)).toISOString() : null,
    updatedBy: 'NoLSAF Research Team',
    categories,
  });
};

// ─── register routes ──────────────────────────────────────────────────────────

router.get('/destinations',          limitNolScopeList, asyncHandler(listDestinations));
router.get('/visa-fee/:nationality', limitNolScopeList, asyncHandler(getVisaFee));
router.get('/activities',            limitNolScopeList, asyncHandler(listActivities));
router.get('/data-freshness',        limitNolScopeList, asyncHandler(getDataFreshness));
router.post('/estimate',             limitNolScopeEstimate, asyncHandler(createEstimate));
router.get('/estimate/:id',          limitNolScopeList, asyncHandler(getEstimate));

export default router;
