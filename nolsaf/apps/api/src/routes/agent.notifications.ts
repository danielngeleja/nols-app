import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { z } from "zod";
import { AuthedRequest, requireAuth, requireRole } from "../middleware/auth.js";
import { limitAgentPortalRead } from "../middleware/rateLimit.js";
import { deleteReadNotification, deleteReadNotifications, fetchNotifications, markNotificationRead } from "../services/notifications";

const router = Router();
router.use(requireAuth as any, requireRole("AGENT") as any);

// Everything addressed to this operator: admin and booking messages ("agent"), tour
// cancellation cases ("cancellation") and NRMS hotel partnership updates ("system").
const AGENT_INBOX_TYPES = ["agent", "cancellation", "system"];

const listQuerySchema = z
  .object({
    tab: z.enum(["unread", "viewed"]).optional(),
    page: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default("1")
      .transform((v) => Number(v) || 1),
    pageSize: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .default("20")
      .transform((v) => Math.min(Math.max(Number(v) || 20, 1), 100)),
  })
  .strict();

const idParamsSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
  })
  .strict();

// GET /api/agent/notifications?tab=unread|viewed&page=1&pageSize=20
router.get(
  "/",
  limitAgentPortalRead as any,
  (async (req: AuthedRequest, res: any) => {
    const userId = req.user!.id;

    const parsed = listQuerySchema.safeParse(req.query ?? {});
    if (!parsed.success) return res.status(400).json({ ok: false, error: "invalid_query" });

    const tab = parsed.data.tab ?? "unread";
    const page = parsed.data.page;
    const pageSize = parsed.data.pageSize;

    const result = await fetchNotifications({ tab: tab as any, page, pageSize, userId, types: AGENT_INBOX_TYPES } as any);
    return res.json(result);
  }) as any
);

router.post(
  "/mark-all-read",
  limitAgentPortalRead as any,
  (async (req: AuthedRequest, res: any) => {
    const result = await prisma.notification.updateMany({
      where: { userId: req.user!.id, type: { in: AGENT_INBOX_TYPES }, unread: true },
      data: { unread: false, readAt: new Date() },
    });
    return res.json({ ok: true, updated: result.count });
  }) as any
);

// POST /api/agent/notifications/:id/mark-read
router.post(
  "/:id/mark-read",
  limitAgentPortalRead as any,
  (async (req: AuthedRequest, res: any) => {
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return res.status(400).json({ ok: false, error: "invalid_id" });

    const id = Number(params.data.id);
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ ok: false, error: "invalid_id" });

    const userId = req.user!.id;
    const r = await markNotificationRead(id, undefined, userId, { types: AGENT_INBOX_TYPES });
    if (!r.ok) return res.status(404).json(r);
    return res.json(r);
  }) as any
);

router.delete(
  "/read",
  limitAgentPortalRead as any,
  (async (req: AuthedRequest, res: any) => {
    const result = await deleteReadNotifications({ userId: req.user!.id, types: AGENT_INBOX_TYPES });
    if (!result.ok) return res.status(500).json(result);
    return res.json(result);
  }) as any
);

router.delete(
  "/:id",
  limitAgentPortalRead as any,
  (async (req: AuthedRequest, res: any) => {
    const params = idParamsSchema.safeParse(req.params ?? {});
    if (!params.success) return res.status(400).json({ ok: false, error: "invalid_id" });
    const result = await deleteReadNotification(Number(params.data.id), undefined, req.user!.id, { types: AGENT_INBOX_TYPES });
    if (!result.ok) return res.status(404).json(result);
    return res.json(result);
  }) as any
);

export default router;
