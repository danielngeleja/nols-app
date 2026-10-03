import { Router, type RequestHandler } from "express";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import {
  adminRecordReference,
  isAdminRecordKind,
  resolveAdminRecordReference,
} from "../lib/adminRecordReference.js";

/**
 * Admin page addresses use opaque references instead of row ids.
 * - POST /batch turns {kind, id} pairs into references for links.
 * - GET /resolve turns a reference from the address bar back into the id the
 *   page uses for its API calls.
 * Admin only; admins can already read these ids, the point is the URL.
 */
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: any) => (req?.user?.id ? `record-refs:${String(req.user.id)}` : req.ip || "unknown"),
  message: { error: "Too many requests. Please wait a moment and try again." },
});
const MAX_ITEMS = 500;

router.post("/batch", limiter, (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, MAX_ITEMS) : [];
  const refs: Record<string, string> = {};
  for (const item of items) {
    const kind = item?.kind;
    const id = Number(item?.id);
    if (!isAdminRecordKind(kind) || !Number.isInteger(id) || id <= 0) continue;
    refs[`${kind}:${id}`] = adminRecordReference(kind, id);
  }
  res.json({ refs });
});

router.get("/resolve", limiter, async (req, res, next) => {
  try {
    const kind = String(req.query.kind ?? "");
    const ref = String(req.query.ref ?? "").trim();
    if (!isAdminRecordKind(kind)) return res.status(400).json({ error: "Unknown record kind" });
    const id = await resolveAdminRecordReference(kind, ref);
    if (!id) return res.status(404).json({ error: "Record not found" });
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.json({ id });
  } catch (err) {
    return next(err);
  }
});

export default router;
