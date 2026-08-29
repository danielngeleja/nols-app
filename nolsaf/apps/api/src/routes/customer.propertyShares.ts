import { Router } from "express";
import type { RequestHandler } from "express";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { buildPropertySlug } from "../lib/publicPropertyDto.js";

/**
 * Minting attributable property share links.
 *
 * Separate from `/customer/saved-properties/:id/share`, which can only act on a
 * property the customer already saved. Most sharing happens straight from a
 * listing the customer never saved, and those shares were previously invisible.
 *
 * Creating the link before it is sent is what makes attribution work: the token
 * has to exist in the URL the recipient receives, so the caller must ask for the
 * URL rather than sharing the address bar.
 */
const router = Router();
router.use(requireAuth as RequestHandler);

const SHARE_TOKEN_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";
const SHARE_CHANNELS = ["WHATSAPP", "COPY_LINK", "NATIVE", "SMS", "EMAIL", "FACEBOOK", "TWITTER"] as const;

const createShareSchema = z.object({
  propertyId: z.number().int().positive(),
  channel: z.enum(SHARE_CHANNELS).optional(),
});

function newShareToken(): string {
  const bytes = randomBytes(16);
  let token = "";
  for (let i = 0; i < 16; i += 1) {
    token += SHARE_TOKEN_ALPHABET[bytes[i] % SHARE_TOKEN_ALPHABET.length];
  }
  return token;
}

function webOrigin(): string {
  return process.env.WEB_ORIGIN || process.env.FRONTEND_URL || process.env.APP_ORIGIN || "";
}

router.post("/", (async (req: AuthedRequest, res) => {
  const userId = (req as any).user?.id as number | undefined;
  if (!userId) return res.status(401).json({ ok: false, error: "Authentication required" });

  const parsed = createShareSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ ok: false, error: "propertyId is required" });
  }
  const { propertyId, channel } = parsed.data;

  try {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
      select: { id: true, title: true },
    });
    if (!property) return res.status(404).json({ ok: false, error: "Property not found" });

    const share = await prisma.propertyShare.create({
      data: { token: newShareToken(), sharerId: userId, propertyId, channel: channel ?? null },
      select: { token: true, createdAt: true },
    });

    // Keep the legacy timestamp in step when the property is also saved, so the
    // customer's Shared tab keeps working exactly as before.
    await prisma.savedProperty.updateMany({
      where: { userId, propertyId, sharedAt: null },
      data: { sharedAt: share.createdAt },
    }).catch(() => undefined);

    const slug = buildPropertySlug(property.title || "", property.id);
    return res.json({
      ok: true,
      data: {
        token: share.token,
        url: `${webOrigin()}/public/properties/${slug}?s=${encodeURIComponent(share.token)}`,
      },
    });
  } catch (error) {
    console.warn("Failed to create property share", error);
    // The caller falls back to the plain listing URL, so sharing still works
    // without attribution rather than failing in the user's face.
    return res.status(503).json({ ok: false, error: "Share link unavailable" });
  }
}) as unknown as RequestHandler);

export default router;
