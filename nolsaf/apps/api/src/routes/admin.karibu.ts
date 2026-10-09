import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, requireAuth, requireRole, blockImpersonated } from "../middleware/auth.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { adminBookingReference, resolveAdminBookingReference } from "../lib/adminBookingReference.js";
import { birthdayInStay, drinkConflict, drinkLikeOfCategory, isMissingTable, preferenceStore, shapeKaribuPreferences } from "../lib/karibuPreferences.js";
import { DEFAULT_KARIBU_SETTINGS, issueKaribu, KaribuError, isKaribuPilotDrink, KARIBU_DRINK_CATEGORY_LABELS, karibuDrinkSkipReason, looksLikeDrink, karibuMonthStart, normalizeKaribuSettings, previewKaribu } from "../lib/karibu.js";

const router = Router();
const db = prisma as any;
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);

const settingsSchema = z.object({
  enabled: z.boolean(),
  budgetPercent: z.number().min(1).max(35),
  contributionFloor: z.number().min(0).max(1_000_000),
  perStayCap: z.number().min(0).max(100_000),
  monthlyCap: z.number().min(0).max(100_000_000),
  propertyMonthlyCap: z.number().min(0).max(100_000_000),
  holdoutPercent: z.number().min(0).max(50),
  reason: z.string().trim().min(5).max(300),
});

const NRMS_PROPERTY = { nrmsActivatedAt: { not: null }, status: "APPROVED" };
const pageOf = (req: any, fallback = 20) => {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const pageSize = Math.min(50, Math.max(5, Math.floor(Number(req.query.pageSize) || fallback)));
  return { page, pageSize, skip: (page - 1) * pageSize };
};
const queryText = (req: any) => String(req.query.q ?? "").trim().slice(0, 80);

/** Enrolled properties split into ready (approved drinks) and needing drinks. Small by design: only enrolled rows. */
async function enrolment() {
  const enabled = await db.karibuPropertyConfig.findMany({ where: { enabled: true }, select: { propertyId: true } });
  const enabledIds: number[] = enabled.map((row: any) => row.propertyId);
  const counts = enabledIds.length ? await db.karibuMenuOption.groupBy({ by: ["propertyId"], where: { propertyId: { in: enabledIds }, enabled: true, alcoholic: false }, _count: { _all: true } }) : [];
  const readyIds: number[] = counts.filter((entry: any) => entry._count._all > 0).map((entry: any) => entry.propertyId);
  return { enabledIds, readyIds, needsDrinkIds: enabledIds.filter((id) => !readyIds.includes(id)) };
}

/** Gift rows with the names an admin needs: guest, property, drink and the booking's opaque reference. */
async function describeGestures(gestures: any[]) {
  if (!gestures.length) return [];
  const [bookings, properties, items] = await Promise.all([
    db.booking.findMany({ where: { id: { in: gestures.map((g) => g.bookingId) } }, select: { id: true, guestName: true, checkIn: true, checkOut: true, status: true } }),
    db.property.findMany({ where: { id: { in: [...new Set(gestures.map((g) => g.propertyId))] } }, select: { id: true, title: true, city: true } }),
    db.nrmsMenuItem.findMany({ where: { id: { in: [...new Set(gestures.map((g) => g.menuItemId))] } }, select: { id: true, name: true } }),
  ]);
  const booking = new Map<number, any>(bookings.map((row: any) => [row.id, row]));
  const property = new Map<number, any>(properties.map((row: any) => [row.id, row]));
  const item = new Map<number, any>(items.map((row: any) => [row.id, row]));
  return gestures.map((g) => ({
    id: g.id, status: g.status, payableStatus: g.payableStatus, partnerPrice: Number(g.partnerPrice),
    issuedAt: g.issuedAt, servedAt: g.servedAt, paidAt: g.paidAt, paymentReference: g.paymentReference,
    guestFeedback: g.guestFeedbackAt ? { received: g.guestConfirmedReceived, rating: g.guestFeedbackRating,
      note: g.guestFeedbackNote, at: g.guestFeedbackAt } : null,
    bookingReference: adminBookingReference(g.bookingId),
    guestName: booking.get(g.bookingId)?.guestName ?? null,
    bookingStatus: booking.get(g.bookingId)?.status ?? null,
    stay: booking.get(g.bookingId) ? { checkIn: booking.get(g.bookingId).checkIn, checkOut: booking.get(g.bookingId).checkOut } : null,
    property: property.get(g.propertyId) ?? { id: g.propertyId, title: "Property", city: null },
    drink: item.get(g.menuItemId)?.name ?? "Approved drink",
  }));
}

/** Admin calls carry the opaque bk_ reference, never the booking row id. */
async function bookingIdFrom(reference: string) {
  return resolveAdminBookingReference(String(reference || "").trim());
}

router.get("/overview", (async (_req, res) => {
  const monthStart = karibuMonthStart(new Date());
  const [row, totalProperties, recent, due, statuses, monthly, enrolled, servedRecent] = await Promise.all([
    db.systemSetting.findUnique({ where: { id: 1 }, select: { karibuSettings: true } }),
    db.property.count({ where: NRMS_PROPERTY }),
    db.karibuGesture.findMany({ orderBy: { issuedAt: "desc" }, take: 6 }),
    db.karibuGesture.aggregate({ where: { payableStatus: "DUE" }, _sum: { partnerPrice: true }, _count: true }),
    db.karibuGesture.groupBy({ by: ["status"], _count: { _all: true } }),
    db.karibuGesture.aggregate({ where: { issuedAt: { gte: monthStart }, status: { not: "VOIDED" } }, _sum: { partnerPrice: true }, _count: true }),
    enrolment(),
    db.karibuGesture.findMany({ where: { status: "SERVED" }, orderBy: { servedAt: "desc" }, take: 200, select: { bookingId: true, partnerPrice: true } }),
  ]);
  const servedBookingIds = servedRecent.map((gesture: any) => gesture.bookingId);
  const [cancelled, refunded] = await Promise.all([
    servedBookingIds.length ? db.booking.findMany({ where: { id: { in: servedBookingIds }, status: "CANCELED" }, select: { id: true } }) : [],
    servedBookingIds.length ? db.cancellationRequest.findMany({ where: { bookingId: { in: servedBookingIds }, status: "REFUNDED" }, select: { bookingId: true } }) : [],
  ]);
  const riskIds = new Set<number>([...cancelled.map((r: any) => r.id), ...refunded.map((r: any) => r.bookingId)]);
  const refundRisk = servedRecent.filter((gesture: any) => riskIds.has(gesture.bookingId));
  const count = (status: string) => statuses.find((entry: any) => entry.status === status)?._count._all ?? 0;
  res.json({ settings: normalizeKaribuSettings(row?.karibuSettings), defaults: DEFAULT_KARIBU_SETTINGS,
    recent: await describeGestures(recent),
    payable: { amount: Number(due._sum.partnerPrice ?? 0), count: due._count },
    metrics: { totalProperties, ordered: count("ORDERED"), served: count("SERVED"),
      participating: enrolled.enabledIds.length, ready: enrolled.readyIds.length,
      monthCommitted: Number(monthly._sum.partnerPrice ?? 0), monthGifts: monthly._count },
    refundRisk: { count: refundRisk.length, amount: refundRisk.reduce((sum: number, gesture: any) => sum + Number(gesture.partnerPrice), 0) } });
}) as RequestHandler);

/** Paged NRMS property directory with a participation filter, so the list holds at any size. */
router.get("/properties", (async (req, res) => {
  const { page, pageSize, skip } = pageOf(req);
  const q = queryText(req);
  const filter = String(req.query.filter || "all");
  const { enabledIds, readyIds, needsDrinkIds } = await enrolment();
  const search = q ? { OR: [{ title: { contains: q } }, { city: { contains: q } }] } : {};
  const scoped = (ids?: { in?: number[]; notIn?: number[] }) => ({ ...NRMS_PROPERTY, ...search, ...(ids ? { id: ids } : {}) });
  const where = filter === "ready" ? scoped({ in: readyIds }) : filter === "needs_drinks" ? scoped({ in: needsDrinkIds }) : filter === "off" ? scoped({ notIn: enabledIds }) : scoped();
  const [rows, total, all, ready, needsDrinks, off] = await Promise.all([
    db.property.findMany({ where, select: { id: true, title: true, city: true }, orderBy: { title: "asc" }, skip, take: pageSize }),
    db.property.count({ where }),
    db.property.count({ where: scoped() }),
    db.property.count({ where: scoped({ in: readyIds }) }),
    db.property.count({ where: scoped({ in: needsDrinkIds }) }),
    db.property.count({ where: scoped({ notIn: enabledIds }) }),
  ]);
  const ids = rows.map((p: any) => p.id);
  const [configs, optionCounts] = ids.length ? await Promise.all([
    db.karibuPropertyConfig.findMany({ where: { propertyId: { in: ids } }, select: { propertyId: true, enabled: true, agreedAt: true } }),
    db.karibuMenuOption.groupBy({ by: ["propertyId"], where: { propertyId: { in: ids }, enabled: true, alcoholic: false }, _count: { _all: true } }),
  ]) : [[], []];
  const config = new Map<number, any>(configs.map((c: any) => [c.propertyId, c]));
  const options = new Map<number, number>(optionCounts.map((o: any) => [o.propertyId, o._count._all]));
  res.json({ page, pageSize, total, counts: { all, ready, needs_drinks: needsDrinks, off },
    properties: rows.map((p: any) => ({ ...p, enabled: config.get(p.id)?.enabled === true, agreedAt: config.get(p.id)?.agreedAt ?? null, optionCount: options.get(p.id) ?? 0 })) });
}) as RequestHandler);

/** Paged gift ledger. Views: serving (ordered, not served yet), due, paid, all. */
router.get("/gestures", (async (req, res) => {
  const { page, pageSize, skip } = pageOf(req);
  const view = String(req.query.view || "all");
  const views: Record<string, any> = { all: {}, serving: { status: "ORDERED" }, due: { status: "SERVED", payableStatus: "DUE" }, paid: { payableStatus: "PAID" } };
  const where = views[view] ?? views.all;
  const [rows, total, ...counts] = await Promise.all([
    db.karibuGesture.findMany({ where, orderBy: { issuedAt: "desc" }, skip, take: pageSize }),
    db.karibuGesture.count({ where }),
    ...Object.values(views).map((w) => db.karibuGesture.count({ where: w })),
  ]);
  res.json({ page, pageSize, total, counts: Object.fromEntries(Object.keys(views).map((key, i) => [key, counts[i]])), gestures: await describeGestures(rows) });
}) as RequestHandler);

/**
 * Guests checked in right now at enrolled properties: the list staff welcome from.
 * Eligibility (first stay, budget, holdout) is checked per guest on preview, not here.
 */
router.get("/arrivals", (async (req, res) => {
  const { page, pageSize, skip } = pageOf(req, 10);
  const q = queryText(req);
  const { enabledIds } = await enrolment();
  if (!enabledIds.length) return res.json({ page, pageSize, total: 0, arrivals: [] });
  const where = { status: "CHECKED_IN", propertyId: { in: enabledIds }, userId: { not: null }, roomsQty: 1,
    ...(q ? { OR: [{ guestName: { contains: q } }, { property: { title: { contains: q } } }] } : {}) };
  const [rows, total] = await Promise.all([
    db.booking.findMany({ where, orderBy: { checkIn: "desc" }, skip, take: pageSize,
      select: { id: true, guestName: true, checkIn: true, checkOut: true, property: { select: { title: true, city: true } } } }),
    db.booking.count({ where }),
  ]);
  const gestures = rows.length ? await db.karibuGesture.findMany({ where: { bookingId: { in: rows.map((r: any) => r.id) }, status: { not: "VOIDED" } }, select: { bookingId: true, status: true } }) : [];
  const welcomed = new Map<number, string>(gestures.map((g: any) => [g.bookingId, g.status]));
  res.json({ page, pageSize, total, arrivals: rows.map((r: any) => ({ reference: adminBookingReference(r.id), guestName: r.guestName, checkIn: r.checkIn, checkOut: r.checkOut,
    property: r.property, gift: welcomed.get(r.id) ?? null })) });
}) as RequestHandler);

router.put("/settings", requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || "Invalid settings" });
  const { reason, ...settings } = parsed.data;
  await db.$transaction(async (tx: any) => {
    await tx.systemSetting.upsert({ where: { id: 1 }, update: { karibuSettings: settings }, create: { id: 1, karibuSettings: settings } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, action: "KARIBU_SETTINGS_CHANGED", details: { settings, reason } } });
  });
  res.json({ settings });
}) as RequestHandler);

router.get("/properties/:propertyId", (async (req, res) => {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0) return res.status(400).json({ error: "Invalid property" });
  const [property, config, options, outlets] = await Promise.all([
    db.property.findUnique({ where: { id: propertyId }, select: { id: true, title: true, nrmsActivatedAt: true, status: true } }),
    db.karibuPropertyConfig.findUnique({ where: { propertyId } }),
    db.karibuMenuOption.findMany({ where: { propertyId }, orderBy: { id: "asc" } }),
    db.nrmsOutlet.findMany({ where: { propertyId, status: "ACTIVE", currency: "TZS" }, select: { id: true, name: true, menuItems: { where: { status: "ACTIVE" }, select: { id: true, name: true, category: true, price: true, inStock: true } } } }),
  ]);
  if (!property) return res.status(404).json({ error: "Property not found" });
  res.json({ property, config: config ?? { enabled: false, agreedAt: null }, options,
    acceptedCategories: KARIBU_DRINK_CATEGORY_LABELS,
    outlets: outlets.map((outlet: any) => ({ ...outlet, menuItems: outlet.menuItems.map((item: any) => ({ ...item,
      pilotEligible: isKaribuPilotDrink(item), skipReason: karibuDrinkSkipReason(item), looksLikeDrink: looksLikeDrink(item) })) })) });
}) as RequestHandler);

router.put("/properties/:propertyId", requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const propertyId = Number(req.params.propertyId);
  const parsed = z.object({ enabled: z.boolean(), agreementConfirmed: z.boolean(), reason: z.string().trim().min(5).max(300) }).safeParse(req.body);
  if (!Number.isSafeInteger(propertyId) || propertyId <= 0 || !parsed.success) return res.status(400).json({ error: "Valid property, agreement confirmation and reason are required" });
  const property = await db.property.findUnique({ where: { id: propertyId }, select: { nrmsActivatedAt: true, status: true } });
  if (!property?.nrmsActivatedAt || property.status !== "APPROVED") return res.status(409).json({ error: "Only approved NRMS properties can join Karibu" });
  if (parsed.data.enabled && !parsed.data.agreementConfirmed) return res.status(400).json({ error: "Confirm the property agreed to participate before enabling gifts" });
  const config = await db.$transaction(async (tx: any) => {
    const row = await tx.karibuPropertyConfig.upsert({ where: { propertyId },
      update: { enabled: parsed.data.enabled, ...(parsed.data.agreementConfirmed ? { agreedAt: new Date() } : {}), updatedById: req.user!.id },
      create: { propertyId, enabled: parsed.data.enabled, agreedAt: parsed.data.agreementConfirmed ? new Date() : null, updatedById: req.user!.id } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, action: "KARIBU_PROPERTY_CHANGED", details: { propertyId, enabled: row.enabled, reason: parsed.data.reason } } });
    return row;
  });
  res.json({ config });
}) as RequestHandler);

router.put("/properties/:propertyId/options/:menuItemId", requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const propertyId = Number(req.params.propertyId);
  const menuItemId = Number(req.params.menuItemId);
  const parsed = z.object({ enabled: z.boolean(), partnerPrice: z.number().positive().max(100_000), reason: z.string().trim().min(5).max(300) }).safeParse(req.body);
  if (![propertyId, menuItemId].every((n) => Number.isSafeInteger(n) && n > 0) || !parsed.success) return res.status(400).json({ error: "Valid item, partner price and reason are required" });
  const [item, config] = await Promise.all([
    db.nrmsMenuItem.findUnique({ where: { id: menuItemId }, include: { outlet: true } }),
    db.karibuPropertyConfig.findUnique({ where: { propertyId } }),
  ]);
  if (!config?.agreedAt || !item || item.outlet.propertyId !== propertyId || item.outlet.currency !== "TZS" || Number(item.price) < parsed.data.partnerPrice) {
    return res.status(409).json({ error: "The property must agree and the price must not exceed its TZS menu price" });
  }
  if (parsed.data.enabled && (item.status !== "ACTIVE" || item.outlet.status !== "ACTIVE" || !isKaribuPilotDrink(item))) {
    return res.status(409).json({ error: "Select an active nonalcoholic drink from an approved NRMS menu category" });
  }
  const option = await db.$transaction(async (tx: any) => {
    const row = await tx.karibuMenuOption.upsert({ where: { propertyId_menuItemId: { propertyId, menuItemId } },
      update: { enabled: parsed.data.enabled, partnerPrice: parsed.data.partnerPrice, alcoholic: false },
      create: { propertyId, menuItemId, partnerPrice: parsed.data.partnerPrice, alcoholic: false, enabled: parsed.data.enabled } });
    await tx.adminAudit.create({ data: { adminId: req.user!.id, action: "KARIBU_MENU_OPTION_CHANGED", details: { propertyId, menuItemId, price: parsed.data.partnerPrice, enabled: parsed.data.enabled, reason: parsed.data.reason } } });
    return row;
  });
  res.json({ option });
}) as RequestHandler);

router.get("/bookings/:reference/preview", (async (req, res) => {
  const bookingId = await bookingIdFrom(req.params.reference);
  if (!bookingId) return res.status(404).json({ error: "No booking matches this reference" });
  const cost = z.coerce.number().min(0).max(1_000_000).safeParse(req.query.additionalCost ?? 0);
  if (!cost.success) return res.status(400).json({ error: "Additional booking cost must be between 0 and 1,000,000 TZS" });
  const preview = await previewKaribu(db, bookingId, cost.data);
  // The guest's own preferences: liked drinks first, clashing drinks marked and blocked.
  // Admin sees whether a birthday falls in this stay, never the date itself.
  let prefs = shapeKaribuPreferences(null);
  let preferencesAvailable = true;
  if (preview.booking?.userId) {
    try { prefs = shapeKaribuPreferences(await preferenceStore(db).findUnique({ where: { userId: preview.booking.userId } })); }
    catch (error) { if (!isMissingTable(error)) throw error; preferencesAvailable = false; }
  }
  const options = (preview.options as any[]).map((option) => {
    const like = drinkLikeOfCategory(option.category);
    return { ...option, liked: !!like && prefs.drinkLikes.includes(like), conflict: drinkConflict({ name: option.name ?? "", category: option.category }, prefs.dietaryTags) };
  }).sort((a, b) => Number(!!a.conflict) - Number(!!b.conflict) || Number(b.liked) - Number(a.liked));
  res.json({ eligible: preview.eligible, reason: preview.reason, booking: preview.booking && { reference: adminBookingReference(preview.booking.id), property: preview.booking.property.title, guestName: preview.booking.guestName, checkIn: preview.booking.checkIn, checkOut: preview.booking.checkOut },
    contribution: preview.contribution, budget: preview.budget, commission: "commission" in preview ? preview.commission : null,
    feeEstimate: "feeEstimate" in preview ? preview.feeEstimate : null,
    attributedCost: "attributedCost" in preview ? preview.attributedCost : null,
    monthRemaining: "monthRemaining" in preview ? preview.monthRemaining : null,
    guest: preferencesAvailable ? { drinkLikes: prefs.drinkLikes, dietaryTags: prefs.dietaryTags, dietaryNote: prefs.dietaryNote,
      birthdayInStay: preview.booking ? birthdayInStay(prefs, preview.booking.checkIn, preview.booking.checkOut) : false, hasPreferences: !!prefs.updatedAt } : null,
    options });
}) as RequestHandler);

router.post("/bookings/:reference/issue", requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const bookingId = await bookingIdFrom(req.params.reference);
  const parsed = z.object({ optionId: z.number().int().positive(), additionalCost: z.number().min(0).max(1_000_000), costsReviewed: z.literal(true) }).safeParse(req.body);
  if (!bookingId) return res.status(404).json({ error: "No booking matches this reference" });
  if (!parsed.success) return res.status(400).json({ error: "Choose a valid approved drink" });
  try {
    await db.systemSetting.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
    const gesture = await db.$transaction(async (tx: any) => {
      const created = await issueKaribu(tx, { bookingId, optionId: parsed.data.optionId,
        additionalCost: parsed.data.additionalCost, actorId: req.user!.id });
      await tx.adminAudit.create({ data: { adminId: req.user!.id, action: "KARIBU_GESTURE_ISSUED", details: { bookingId, gestureId: created.id, orderId: created.orderId, partnerPrice: Number(created.partnerPrice), additionalCost: parsed.data.additionalCost, costsReviewed: true } } });
      return created;
    }, { timeout: 30_000 });
    res.status(201).json({ gesture });
  } catch (error) {
    if (error instanceof KaribuError) return res.status(409).json({ error: error.message, code: error.code });
    if ((error as any)?.code === "P2002") return res.status(409).json({ error: "A Karibu gift has already been issued for this booking" });
    throw error;
  }
}) as RequestHandler);

router.post("/gestures/:id/record-payment", requireAdminFinanceGrant as RequestHandler, (async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const parsed = z.object({ reference: z.string().trim().min(5).max(120) }).safeParse(req.body);
  if (!Number.isSafeInteger(id) || id <= 0 || !parsed.success) return res.status(400).json({ error: "A payment reference is required" });
  const result = await db.$transaction(async (tx: any) => {
    const claimed = await tx.karibuGesture.updateMany({ where: { id, status: "SERVED", payableStatus: "DUE" }, data: {
      payableStatus: "PAID", paidAt: new Date(), paymentReference: parsed.data.reference, paidById: req.user!.id,
    } });
    if (claimed.count !== 1) return null;
    await tx.adminAudit.create({ data: { adminId: req.user!.id, action: "KARIBU_PROPERTY_PAYMENT_RECORDED", details: { gestureId: id, reference: parsed.data.reference } } });
    return tx.karibuGesture.findUnique({ where: { id } });
  });
  if (!result) return res.status(409).json({ error: "Only a served, unpaid Karibu gift can be recorded as paid" });
  res.json({ gesture: result });
}) as RequestHandler);

export default router;
