import crypto from "node:crypto";
import { normalizeFeeRates, channelOf } from "./gatewayFees.js";
import { reserveMenuStock } from "./nrmsStock.js";
import { consumeOrderStock } from "./nrmsInventory.js";
import { drinkConflict, isMissingTable, shapeKaribuPreferences, staffPreferenceNote } from "./karibuPreferences.js";

export type KaribuSettings = {
  enabled: boolean;
  budgetPercent: number;
  contributionFloor: number;
  perStayCap: number;
  monthlyCap: number;
  propertyMonthlyCap: number;
  holdoutPercent: number;
};

export const DEFAULT_KARIBU_SETTINGS: KaribuSettings = {
  enabled: false,
  budgetPercent: 20,
  contributionFloor: 4_000,
  perStayCap: 3_000,
  monthlyCap: 300_000,
  propertyMonthlyCap: 60_000,
  holdoutPercent: 10,
};

export function normalizeKaribuSettings(raw: unknown): KaribuSettings {
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const bounded = (key: keyof Omit<KaribuSettings, "enabled">, min: number, max: number) => {
    const number = Number(value[key]);
    return Number.isFinite(number) && number >= min && number <= max ? number : DEFAULT_KARIBU_SETTINGS[key];
  };
  return {
    enabled: value.enabled === true,
    budgetPercent: bounded("budgetPercent", 1, 35),
    contributionFloor: bounded("contributionFloor", 0, 1_000_000),
    perStayCap: bounded("perStayCap", 0, 100_000),
    monthlyCap: bounded("monthlyCap", 0, 100_000_000),
    propertyMonthlyCap: bounded("propertyMonthlyCap", 0, 100_000_000),
    holdoutPercent: bounded("holdoutPercent", 0, 50),
  };
}

export function isKaribuHoldout(bookingId: number, userId: number, percent: number): boolean {
  const value = crypto.createHash("sha256").update(`karibu-v1:${bookingId}:${userId}`).digest().readUInt32BE(0) % 10_000;
  return value < Math.round(percent * 100);
}

export function menuItemMayContainAlcohol(item: { name: string; category?: string | null }): boolean {
  return /\b(beer|wine|cider|whisky|whiskey|gin|vodka|rum|tequila|brandy|liqueur|cocktail|spirit|champagne|prosecco|lager|stout)s?\b/i
    .test(`${item.category || ""} ${item.name}`.replace(/\bmocktail\b/gi, ""));
}

const PILOT_DRINK_CATEGORIES = new Set(["tea and coffee", "fresh juices", "soft drinks", "soft drinks and mixers", "water", "mocktails"]);

export function isKaribuPilotDrink(item: { name: string; category?: string | null }): boolean {
  return PILOT_DRINK_CATEGORIES.has(String(item.category || "").trim().toLowerCase()) && !menuItemMayContainAlcohol(item);
}

/** Menu categories Karibu accepts, as the owner sees them in the NRMS menu. */
export const KARIBU_DRINK_CATEGORY_LABELS = ["Tea and coffee", "Fresh juices", "Soft drinks", "Soft drinks and mixers", "Water", "Mocktails"];

/**
 * Why a menu item cannot be a Karibu drink, in words an admin can pass to the
 * property, or null when it can. Mirrors isKaribuPilotDrink.
 */
export function karibuDrinkSkipReason(item: { name: string; category?: string | null }): string | null {
  if (menuItemMayContainAlcohol(item)) return "Contains alcohol";
  const category = String(item.category || "").trim();
  if (!category) return "No menu category set";
  if (!PILOT_DRINK_CATEGORIES.has(category.toLowerCase())) return `Category "${category}" is not a drink category Karibu accepts`;
  return null;
}

/** True when a skipped item looks like a drink, so the fix is a category change rather than "not a drink". */
export function looksLikeDrink(item: { name: string; category?: string | null }): boolean {
  return /\b(drink|drinks|beverage|beverages|juice|soda|coffee|tea|water|mocktail|smoothie|milkshake|shake|latte|cappuccino|espresso|cola|lemonade|refresher)s?\b/i
    .test(`${item.category || ""} ${item.name}`);
}

const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;

export function karibuMonthStart(now: Date): Date {
  const local = new Date(now.getTime() + TZ_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - TZ_OFFSET_MS);
}

export function calculateKaribuBudget(input: {
  commission: number;
  gatewayFee: number;
  attributedCost: number;
  settings: KaribuSettings;
}) {
  const contribution = money(Math.max(0, input.commission - input.gatewayFee - input.attributedCost));
  const budget = contribution < input.settings.contributionFloor
    ? 0
    : money(Math.min(input.settings.perStayCap, contribution * input.settings.budgetPercent / 100));
  return { contribution, budget };
}

export class KaribuError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Preview is recomputed inside the issue transaction; it never authorises spend. */
export async function previewKaribu(db: any, bookingId: number, additionalCost = 0) {
  const [booking, settingsRow] = await Promise.all([
    db.booking.findUnique({
      where: { id: bookingId },
      include: {
        property: { select: { id: true, title: true, status: true, nrmsActivatedAt: true, currency: true } },
        nrmsReservation: { select: { id: true, status: true } },
        invoices: { where: { status: "PAID" }, orderBy: { paidAt: "desc" }, take: 1,
          select: { id: true, commissionAmount: true, paymentMethod: true, paymentEvents: { where: { status: "SUCCESS" }, orderBy: { createdAt: "desc" }, take: 1, select: { paymentChannel: true } } } },
      },
    }),
    db.systemSetting.findUnique({ where: { id: 1 }, select: { karibuSettings: true, gatewayFeeRates: true } }),
  ]);
  const settings = normalizeKaribuSettings(settingsRow?.karibuSettings);
  const fail = (reason: string) => ({ eligible: false as const, reason, booking, settings, contribution: 0, budget: 0, options: [] as any[] });
  if (!booking) return fail("BOOKING_NOT_FOUND");
  if (!settings.enabled) return fail("PROGRAM_DISABLED");
  if (!booking.userId || booking.roomsQty !== 1) return fail("ACCOUNT_LINKED_INDIVIDUAL_ONLY");
  if (booking.status !== "CHECKED_IN" || booking.nrmsReservation?.status !== "CHECKED_IN") return fail("CHECK_IN_REQUIRED");
  if (booking.property.status !== "APPROVED" || !booking.property.nrmsActivatedAt) return fail("NRMS_PROPERTY_REQUIRED");
  if ((booking.property.currency || "TZS") !== "TZS") return fail("TZS_ONLY");
  const propertyConfig = await db.karibuPropertyConfig.findUnique({ where: { propertyId: booking.propertyId } });
  if (!propertyConfig?.enabled || !propertyConfig.agreedAt) return fail("PROPERTY_NOT_ENROLLED");
  const invoice = booking.invoices[0];
  if (!invoice || invoice.commissionAmount == null || money(invoice.commissionAmount) <= 0) return fail("PAID_COMMISSION_REQUIRED");
  const [previous, welcomed] = await Promise.all([
    db.booking.findFirst({ where: { userId: booking.userId, id: { not: booking.id }, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } }, select: { id: true } }),
    db.karibuGesture.findFirst({ where: { userId: booking.userId, status: "SERVED" }, select: { id: true } }),
  ]);
  if (previous || welcomed) return fail("NOT_FIRST_STAY");
  if (isKaribuHoldout(booking.id, booking.userId, settings.holdoutPercent)) return fail("PILOT_HOLDOUT");
  const existing = await db.karibuGesture.findUnique({ where: { bookingId } });
  if (existing && existing.status !== "VOIDED") return fail("ALREADY_ISSUED");
  const rates = normalizeFeeRates(settingsRow?.gatewayFeeRates);
  const channel = invoice.paymentEvents[0]?.paymentChannel || channelOf(invoice.paymentMethod);
  const feeRate = rates[channel as keyof typeof rates];
  const feeEstimate = money(Math.max(0, Number(booking.totalAmount)) * (typeof feeRate === "number" ? feeRate : rates.MNO) / 100);
  const [referrals, sales, options] = await Promise.all([
    db.referralEarning.aggregate({ where: { bookingId }, _sum: { amount: true } }),
    db.salesCommission.aggregate({ where: { sourceBookingId: bookingId, status: { not: "REVERSED" }, reversalOfId: null }, _sum: { commissionAmount: true } }),
    db.karibuMenuOption.findMany({ where: { propertyId: booking.propertyId, enabled: true, alcoholic: false }, orderBy: { id: "asc" } }),
  ]);
  const attributedCost = money(Math.max(0, Number(referrals._sum.amount ?? 0)) + Math.max(0, Number(sales._sum.commissionAmount ?? 0)) + additionalCost);
  const commission = money(invoice.commissionAmount);
  const { contribution, budget } = calculateKaribuBudget({ commission, gatewayFee: feeEstimate, attributedCost, settings });
  if (budget <= 0) return { ...fail("BUDGET_TOO_LOW"), contribution, budget, commission, feeEstimate, attributedCost };
  if (!options.length) return { ...fail("NO_APPROVED_DRINKS"), contribution, budget, commission, feeEstimate, attributedCost };
  const menuItems = options.length ? await db.nrmsMenuItem.findMany({
    where: { id: { in: options.map((option: any) => option.menuItemId) }, status: "ACTIVE", inStock: true },
    include: { outlet: true },
  }) : [];
  const available = new Map(menuItems
    .filter((item: any) => item.outlet.propertyId === booking.propertyId && item.outlet.status === "ACTIVE" && item.outlet.currency === "TZS" && isKaribuPilotDrink(item))
    .map((item: any) => [item.id, item]));
  const affordable = options.filter((option: any) => {
    const item = available.get(option.menuItemId) as any;
    return item && money(option.partnerPrice) > 0 && money(option.partnerPrice) <= budget && money(option.partnerPrice) <= money(item.price);
  }).map((option: any) => {
    const item = available.get(option.menuItemId) as any;
    return { ...option, name: item.name, category: item.category ?? null, outletName: item.outlet.name, menuPrice: item.price };
  });
  if (!available.size) return { ...fail("NO_AVAILABLE_DRINKS"), contribution, budget, commission, feeEstimate, attributedCost };
  if (!affordable.length) return { ...fail("NO_AFFORDABLE_OPTION"), contribution, budget, commission, feeEstimate, attributedCost };
  const now = new Date();
  const monthStart = karibuMonthStart(now);
  const [globalSpent, propertySpent] = await Promise.all([
    db.karibuGesture.aggregate({ where: { issuedAt: { gte: monthStart }, status: { not: "VOIDED" } }, _sum: { partnerPrice: true } }),
    db.karibuGesture.aggregate({ where: { propertyId: booking.propertyId, issuedAt: { gte: monthStart }, status: { not: "VOIDED" } }, _sum: { partnerPrice: true } }),
  ]);
  const remaining = Math.min(settings.monthlyCap - money(globalSpent._sum.partnerPrice), settings.propertyMonthlyCap - money(propertySpent._sum.partnerPrice));
  const usable = affordable.filter((option: any) => money(option.partnerPrice) <= remaining);
  if (!usable.length) return { ...fail("MONTHLY_CAP_REACHED"), contribution, budget, commission, feeEstimate, attributedCost, monthRemaining: Math.max(0, remaining) };
  return { eligible: true as const, reason: null, booking, settings, contribution, budget, commission, feeEstimate, attributedCost, monthRemaining: Math.max(0, remaining), options: usable };
}

/** Only a staff/admin choice of an approved nonalcoholic item creates an order. */
export async function issueKaribu(db: any, input: { bookingId: number; optionId: number; actorId: number; additionalCost?: number }) {
  await db.$queryRaw`SELECT id FROM systemsetting WHERE id = 1 FOR UPDATE`;
  const preview = await previewKaribu(db, input.bookingId, input.additionalCost ?? 0);
  if (!preview.eligible) throw new KaribuError(preview.reason || "INELIGIBLE", `Karibu is unavailable: ${preview.reason}`);
  const booking = preview.booking;
  const option = preview.options.find((candidate: any) => candidate.id === input.optionId);
  if (!option) throw new KaribuError("OPTION_UNAVAILABLE", "Choose an affordable approved nonalcoholic drink");
  const now = new Date();
  const monthStart = karibuMonthStart(now);
  const spent = await db.karibuGesture.aggregate({ where: { issuedAt: { gte: monthStart }, status: { not: "VOIDED" } }, _sum: { partnerPrice: true } });
  if (money(spent._sum.partnerPrice) + money(option.partnerPrice) > preview.settings.monthlyCap) {
    throw new KaribuError("MONTHLY_CAP_REACHED", "Karibu's monthly pilot budget has been reached");
  }
  const propertySpent = await db.karibuGesture.aggregate({ where: { propertyId: booking.propertyId, issuedAt: { gte: monthStart }, status: { not: "VOIDED" } }, _sum: { partnerPrice: true } });
  if (money(propertySpent._sum.partnerPrice) + money(option.partnerPrice) > preview.settings.propertyMonthlyCap) {
    throw new KaribuError("PROPERTY_MONTHLY_CAP_REACHED", "This property's monthly Karibu budget has been reached");
  }
  const item = await db.nrmsMenuItem.findUnique({ where: { id: option.menuItemId }, include: { outlet: true } });
  if (!item || item.outlet.propertyId !== booking.propertyId || item.outlet.status !== "ACTIVE" || item.status !== "ACTIVE" || !item.inStock || item.outlet.currency !== "TZS" || !isKaribuPilotDrink(item) || money(option.partnerPrice) > money(item.price)) {
    throw new KaribuError("MENU_ITEM_UNAVAILABLE", "The agreed drink is unavailable at the property");
  }
  // A drink that clashes with the guest's own dietary needs is never sent, whatever the admin picked.
  const prefs = shapeKaribuPreferences(db.karibuGuestPreference
    ? await db.karibuGuestPreference.findUnique({ where: { userId: booking.userId } }).catch((error: unknown) => {
      if (isMissingTable(error)) return null;
      throw error;
    })
    : null);
  const conflict = drinkConflict(item, prefs.dietaryTags);
  if (conflict) throw new KaribuError("DIETARY_CONFLICT", `This drink does not suit the guest (${conflict}). Choose another.`);
  const requested = new Map([[item.id, 1]]);
  await reserveMenuStock(db, [item], requested);
  const price = money(option.partnerPrice);
  const order = await db.nrmsOutletOrder.create({
    data: {
      propertyId: booking.propertyId, outletId: item.outletId, reservationId: booking.nrmsReservation.id,
      orderNumber: `KRB-${now.toISOString().slice(2, 10).replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`,
      status: "CONFIRMED", settlementMode: "NOLSAF_KARIBU", currency: "TZS", subtotal: price, total: price,
      // Shared preferences ride on the ticket only when the guest chose to share them with the property.
      note: ["Karibu welcome from NoLSAF. Do not charge the guest.", staffPreferenceNote(prefs) ? `Guest: ${staffPreferenceNote(prefs)}.` : ""].filter(Boolean).join(" "),
      createdById: input.actorId, confirmedById: input.actorId, confirmedAt: now,
      items: { create: [{ menuItemId: item.id, nameSnapshot: item.name, quantity: 1, unitPrice: price, lineTotal: price }] },
    },
  });
  await consumeOrderStock(db, { propertyId: booking.propertyId, outlet: item.outlet, orderId: order.id,
    items: [{ menuItemId: item.id, quantity: 1, nameSnapshot: item.name }], actorId: input.actorId });
  const snapshot = {
    bookingId: booking.id, propertyId: booking.propertyId, userId: booking.userId,
    reservationId: booking.nrmsReservation.id, menuItemId: item.id, orderId: order.id,
    contributionEstimate: preview.contribution, commissionSnapshot: preview.commission,
    feeEstimate: preview.feeEstimate, attributedCost: preview.attributedCost,
    budgetSnapshot: preview.budget, partnerPrice: price, issuedById: input.actorId, issuedAt: now,
  };
  const previous = await db.karibuGesture.findUnique({ where: { bookingId: booking.id }, select: { id: true, status: true } });
  if (previous?.status === "VOIDED") return db.karibuGesture.update({ where: { id: previous.id }, data: {
    ...snapshot, status: "ORDERED", servedAt: null, payableStatus: "NOT_DUE", paidAt: null, paymentReference: null, paidById: null,
    guestConfirmedReceived: null, guestFeedbackRating: null, guestFeedbackNote: null, guestFeedbackAt: null,
  } });
  return db.karibuGesture.create({ data: snapshot });
}
