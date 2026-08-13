import { Router } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { auditOrThrow } from "../lib/audit.js";
import { KNOWN_PAYMENT_PROVIDERS, listPaymentMethodAvailability, listTransportAvailability } from "../lib/serviceAvailability.js";

export const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

/** GET / — everything the toggle page needs in one call. */
router.get("/", async (_req, res) => {
  const [transport, paymentMethods] = await Promise.all([
    listTransportAvailability(),
    listPaymentMethodAvailability(),
  ]);
  res.json({ transport, paymentMethods });
});

const transportUpsertSchema = z.object({
  regionName: z.string().trim().min(2).max(120),
  regionId: z.string().trim().max(50).optional().nullable(),
  district: z.string().trim().max(120).optional().nullable(),
  ward: z.string().trim().max(120).optional().nullable(),
  isEnabled: z.boolean(),
  reason: z.string().trim().max(300).optional().nullable(),
});

/** PUT /transport — create or update one region/district/ward gate row. */
router.put("/transport", async (req, res) => {
  const parsed = transportUpsertSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.issues });
  }
  const { regionName, regionId, isEnabled, reason } = parsed.data;
  // "" is the stored sentinel for "applies to the whole parent scope". Null and
  // empty both normalize to it so the compound unique key matches consistently
  // (MySQL would treat NULLs as distinct and permit duplicate rows).
  const district = parsed.data.district || "";
  const ward = parsed.data.ward || "";
  // A ward without a district can't be resolved by the lookup, which walks
  // ward -> district -> region, so reject it rather than storing a dead row.
  if (ward && !district) {
    return res.status(400).json({ error: "ward_requires_district", message: "Select a district before choosing a ward." });
  }
  const regionNameUpper = regionName.toUpperCase();

  const where = { regionName_district_ward: { regionName: regionNameUpper, district, ward } } as const;
  try {
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.transportAvailability.findUnique({ where });
      const updated = await tx.transportAvailability.upsert({
        where,
        create: {
          regionName: regionNameUpper,
          regionId: regionId || null,
          district,
          ward,
          isEnabled,
          reason: reason || null,
          updatedById: (req as any).user?.id ?? null,
        },
        update: {
          isEnabled,
          reason: reason || null,
          regionId: regionId || undefined,
          updatedById: (req as any).user?.id ?? null,
        },
      });
      await auditOrThrow(tx, req, "ADMIN_TRANSPORT_AVAILABILITY_SET", "transport_availability", before, updated, updated.id);
      return updated;
    });
    return res.json(row);
  } catch (error) {
    console.error("[service-availability] audited transport update failed", error);
    return res.status(500).json({ error: "service_availability_update_failed" });
  }
});

/** DELETE /transport/:id — remove an override, reverting that scope to locked-by-default. */
router.delete("/transport/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "invalid_id" });

  const before = await prisma.transportAvailability.findUnique({ where: { id } });
  if (!before) return res.status(404).json({ error: "not_found" });

  try {
    await prisma.$transaction(async (tx) => {
      const deleted = await tx.transportAvailability.delete({ where: { id } });
      await auditOrThrow(tx, req, "ADMIN_TRANSPORT_AVAILABILITY_DELETE", "transport_availability", deleted, null, id);
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("[service-availability] audited transport delete failed", error);
    return res.status(500).json({ error: "service_availability_delete_failed" });
  }
});

const paymentMethodSchema = z.object({
  isEnabled: z.boolean(),
  reason: z.string().trim().max(300).optional().nullable(),
});

/** PUT /payment-methods/:provider — flip a payment rail on/off globally. */
router.put("/payment-methods/:provider", async (req, res) => {
  const provider = req.params.provider;
  const known = KNOWN_PAYMENT_PROVIDERS.find((p) => p.provider === provider);
  if (!known) return res.status(400).json({ error: "unknown_provider" });

  const parsed = paymentMethodSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "validation_error", details: parsed.error.issues });
  }
  const { isEnabled, reason } = parsed.data;

  try {
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.paymentMethodAvailability.findUnique({ where: { provider } });
      const updated = await tx.paymentMethodAvailability.upsert({
        where: { provider },
        create: { provider, label: known.label, isEnabled, reason: reason || null, updatedById: (req as any).user?.id ?? null },
        update: { isEnabled, reason: reason || null, updatedById: (req as any).user?.id ?? null },
      });
      await auditOrThrow(tx, req, "ADMIN_PAYMENT_METHOD_AVAILABILITY_SET", "payment_method_availability", before, updated, updated.id);
      return updated;
    });
    return res.json(row);
  } catch (error) {
    console.error("[service-availability] audited payment update failed", error);
    return res.status(500).json({ error: "service_availability_update_failed" });
  }
});

export default router;
