import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";

/**
 * Public endpoints for attributable property shares.
 *
 * A share link is `/public/properties/<slug>?s=<token>`. The listing page pings
 * this router once per browser session so the sharer can see whether anyone
 * actually opened what they sent.
 *
 * Deliberately not recorded: visitor IP, user agent, or any per-open row. Only
 * aggregate counters live on the share, so a link that is never acted on leaves
 * no personal data behind.
 */
const router = Router();

const TOKEN_PATTERN = /^[a-z2-9]{16}$/;

router.post("/:token/open", (async (req, res) => {
  const token = String(req.params.token || "");
  if (!TOKEN_PATTERN.test(token)) {
    return res.status(400).json({ ok: false, error: "Invalid share token" });
  }

  try {
    const share = await prisma.propertyShare.findUnique({
      where: { token },
      select: { id: true, sharerId: true, revokedAt: true },
    });
    // Unknown or revoked tokens return ok so a stale link never surfaces an
    // error to a visitor who did nothing wrong.
    if (!share || share.revokedAt) return res.json({ ok: true, counted: false });

    // A sharer opening their own link is not engagement.
    const viewerId = (req as any).user?.id as number | undefined;
    if (viewerId && viewerId === share.sharerId) {
      return res.json({ ok: true, counted: false });
    }

    const now = new Date();
    await prisma.propertyShare.update({
      where: { id: share.id },
      data: {
        openCount: { increment: 1 },
        lastOpenedAt: now,
        ...(await hasFirstOpen(share.id) ? {} : { firstOpenedAt: now }),
      },
    });

    return res.json({ ok: true, counted: true });
  } catch (error) {
    console.warn("Property share open ping failed", error);
    // Never let attribution bookkeeping break a public page.
    return res.json({ ok: true, counted: false });
  }
}) as unknown as RequestHandler);

async function hasFirstOpen(id: number): Promise<boolean> {
  const row = await prisma.propertyShare.findUnique({ where: { id }, select: { firstOpenedAt: true } });
  return Boolean(row?.firstOpenedAt);
}

export default router;
