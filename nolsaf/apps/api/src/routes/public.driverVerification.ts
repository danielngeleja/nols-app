import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { buildDriverVerificationCode, resolveDriverVerificationCode } from "../lib/driverVerificationCode.js";

/**
 * Public, no-login driver ID check.
 *
 * A passenger matches the person and vehicle in front of them against the card
 * the driver is holding. The response therefore carries real personal data
 * (name, photo, plate), and the only thing standing between an anonymous caller
 * and that data is the code they submit.
 *
 * So the code must be unguessable and the endpoint must not behave like a
 * directory:
 *
 * - Codes carry an HMAC check segment; the bare user id is not accepted.
 * - Every failure returns the same 404 body. A caller cannot tell "no such
 *   code" from "that account is not a driver", which is what made counting
 *   upwards profitable before.
 * - A tight per-IP limit caps how fast the remaining guess space can be walked.
 */
const router = Router();

const LICENSE_TYPES = new Set(["DRIVER_LICENSE", "DRIVING_LICENSE", "DRIVER_LICENCE", "DRIVING_LICENCE", "LICENSE"]);

/**
 * Deliberately tighter than the other public verify limiters. Those are gated
 * by a full signature; this one is a short printed code, so the rate limit is
 * carrying part of the security budget rather than just protecting the DB.
 */
const lookupLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many verification attempts. Please wait a moment and try again." },
});

/** One response for every failure mode, so the endpoint answers no questions. */
const NOT_VERIFIED = { ok: false as const, error: "This driver ID could not be verified." };

function getExpiry(metadata: any) {
  const raw =
    metadata?.expiresAt ??
    metadata?.expiresOn ??
    metadata?.expiryDate ??
    metadata?.expiry ??
    metadata?.licenseExpiresOn ??
    metadata?.licenseExpiryDate;
  if (!raw) return null;
  const date = new Date(String(raw).includes("T") ? String(raw) : `${String(raw)}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

router.get("/:driverId", lookupLimiter, async (req, res) => {
  const submitted = String(req.params.driverId || "").trim();
  const userId = resolveDriverVerificationCode(submitted);
  if (!userId) return res.status(404).json(NOT_VERIFIED);

  try {
    const driver = await prisma.user.findFirst({
      where: { id: userId, role: "DRIVER" } as any,
      select: {
        id: true,
        fullName: true,
        name: true,
        avatarUrl: true,
        region: true,
        district: true,
        operationArea: true,
        vehicleType: true,
        vehicleMake: true,
        vehiclePlate: true,
        plateNumber: true,
        isVipDriver: true,
        kycStatus: true,
        suspendedAt: true,
        isDisabled: true
      } as any
    });

    if (!driver) return res.status(404).json(NOT_VERIFIED);

    const documents = await (prisma as any).userDocument?.findMany?.({
      where: { userId },
      orderBy: { id: "desc" },
      select: { type: true, url: true, status: true, metadata: true, createdAt: true }
    });
    const licenseDoc = Array.isArray(documents)
      ? documents.find((doc: any) => LICENSE_TYPES.has(String(doc?.type ?? "").toUpperCase()) && doc?.url)
      : null;
    const licenseExpiry = getExpiry(licenseDoc?.metadata);
    const now = Date.now();
    const active =
      !(driver as any).suspendedAt &&
      !(driver as any).isDisabled &&
      (driver as any).kycStatus !== "REJECTED_KYC" &&
      Boolean(licenseExpiry && licenseExpiry.getTime() >= now);

    // Never cached: the whole point of the check is that the status is live at
    // the moment the passenger looks at it.
    res.setHeader("Cache-Control", "no-store");

    res.json({
      ok: true,
      driver: {
        // Rebuilt from the resolved id, never echoed from the path, so the page
        // cannot be made to display attacker-chosen text.
        id: buildDriverVerificationCode(userId),
        name: (driver as any).fullName || (driver as any).name || "NoLSAF driver",
        avatarUrl: (driver as any).avatarUrl || null,
        certification: (driver as any).isVipDriver ? "Premium Driver" : "Certified Driver",
        status: active ? "ACTIVE" : "NOT_ACTIVE",
        vehiclePlate: (driver as any).plateNumber || (driver as any).vehiclePlate || null,
        vehicleType: (driver as any).vehicleType || null,
        vehicleMake: (driver as any).vehicleMake || null,
        operatingArea: (driver as any).operationArea || (driver as any).region || (driver as any).district || "Tanzania",
        validUntil: licenseExpiry ? licenseExpiry.toISOString() : null,
        verifiedAt: new Date().toISOString()
      }
    });
  } catch (err) {
    console.error("[public driver verification] failed", err);
    res.status(500).json({ ok: false, error: "Could not verify this driver." });
  }
});

export default router;
