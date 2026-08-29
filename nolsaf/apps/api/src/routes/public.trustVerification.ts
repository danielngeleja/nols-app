import { Router } from "express";
import type { RequestHandler } from "express";
import QRCode from "qrcode";
import {
  CHANNEL_TYPES,
  findPublishedChannelMatch,
  loadPublicVerificationPayload,
} from "../lib/trustVerification.js";
import { limitPublicTrustChannelVerify } from "../middleware/rateLimit.js";
import { rateLimitWithRedis } from "../lib/redisRateLimitStore.js";

/**
 * The payload is small and identical for every caller, but it is one of the few
 * unauthenticated endpoints that fans out to two tables. A generous per-IP cap
 * keeps a scripted hammering from competing with real traffic for connections.
 */
const limitPublicTrustPayload = rateLimitWithRedis({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

/**
 * Public corporate verification data for /verify.
 *
 * Serves only records that are published, evidence-approved, unexpired, and not
 * archived. Everything else is invisible here, including anything merely
 * PENDING or UNDER_REVIEW: a half-approved claim on a verification page is
 * worse than no claim at all.
 *
 * The whole feature stays dark until TRUST_VERIFICATION_PUBLIC is enabled, so
 * the page cannot go live before the legal copy and evidence are signed off.
 */
const router = Router();

export function trustVerificationPublicEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.TRUST_VERIFICATION_PUBLIC || "").trim().toLowerCase(),
  );
}

router.get("/", limitPublicTrustPayload as RequestHandler, (async (_req, res) => {
  if (!trustVerificationPublicEnabled()) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  try {
    const payload = await loadPublicVerificationPayload();
    // must-revalidate rather than a plain max-age: an unpublish has to take
    // effect the moment it is made, and a stale cached copy of a withdrawn
    // corporate claim is exactly what this page exists to prevent.
    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    return res.json({ ok: true, data: payload });
  } catch (error) {
    console.error("GET /public/verify failed", error);
    return res.status(500).json({ ok: false, error: "Verification data unavailable" });
  }
}) as unknown as RequestHandler);

/**
 * Exact-match channel verification.
 *
 * This is intentionally not a search or autocomplete endpoint. It reveals an
 * approved public channel only when the submitted value matches it exactly
 * after type-aware normalisation. Failed checks return no candidate values.
 */
router.post("/channel", limitPublicTrustChannelVerify as RequestHandler, (async (req, res) => {
  if (!trustVerificationPublicEnabled()) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  const channelType = String(req.body?.channelType || "").trim().toUpperCase();
  const value = String(req.body?.value || "").trim();
  if (!(CHANNEL_TYPES as readonly string[]).includes(channelType)) {
    return res.status(400).json({ ok: false, error: "Choose a valid channel type." });
  }
  if (!value || value.length > 500) {
    return res.status(400).json({ ok: false, error: "Enter a valid channel value." });
  }

  try {
    const channel = await findPublishedChannelMatch(channelType, value);
    res.setHeader("Cache-Control", "no-store");
    return res.json({
      ok: true,
      data: {
        matched: Boolean(channel),
        channel: channel
          ? {
              channelType: channel.channelType,
              label: channel.label,
              value: channel.value,
              href: channel.href,
              notes: channel.notes,
              confirmedAt: channel.confirmedAt?.toISOString() || null,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("POST /public/verify/channel failed", error);
    return res.status(500).json({ ok: false, error: "Channel verification is unavailable." });
  }
}) as unknown as RequestHandler);

/**
 * The verification QR.
 *
 * Encodes the canonical /verify URL and nothing else. Corporate data is never
 * put inside the code, because a printed card cannot be corrected: the page has
 * to stay the single revocable source of truth.
 *
 * SVG so it stays sharp at any print size, with high error correction and a
 * proper quiet zone for business cards, invoices, and contracts.
 */
router.get("/qr.svg", (async (_req, res) => {
  if (!trustVerificationPublicEnabled()) {
    return res.status(404).json({ ok: false, error: "Not found" });
  }

  try {
    const origin = (process.env.WEB_ORIGIN || process.env.FRONTEND_URL || process.env.APP_ORIGIN || "").replace(/\/$/, "");
    const target = `${origin}/verify`;

    const svg = await QRCode.toString(target, {
      type: "svg",
      errorCorrectionLevel: "H",
      margin: 4,
      color: { dark: "#0f172a", light: "#ffffff" },
    });

    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(svg);
  } catch (error) {
    console.error("GET /public/verify/qr.svg failed", error);
    return res.status(500).json({ ok: false, error: "QR unavailable" });
  }
}) as unknown as RequestHandler);

export default router;
