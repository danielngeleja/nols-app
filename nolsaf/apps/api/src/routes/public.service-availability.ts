import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { getTransportAvailability, listPaymentMethodAvailability } from "../lib/serviceAvailability.js";

export const router = Router();

/** GET /transport?propertyId=123 — is the transport add-on open for this property's area? */
router.get("/transport", async (req, res) => {
  const propertyId = Number(req.query.propertyId);
  if (!Number.isInteger(propertyId)) {
    return res.status(400).json({ error: "invalid_property_id" });
  }

  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { regionName: true, district: true, ward: true },
  });
  if (!property) return res.status(404).json({ error: "not_found" });

  const gate = await getTransportAvailability(property);
  res.json(gate);
});

/** GET /payment-methods — every provider with its current enabled/disabled state + reason. */
router.get("/payment-methods", async (_req, res) => {
  res.json(await listPaymentMethodAvailability());
});

export default router;
