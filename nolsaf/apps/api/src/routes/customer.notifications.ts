import { Router } from "express";
import type { RequestHandler } from "express";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { deleteReadNotification, deleteReadNotifications, fetchNotifications, markNotificationRead } from "../services/notifications";
import { prisma } from "@nolsaf/prisma";

const router = Router();
router.use(requireAuth as RequestHandler);

// GET /api/customer/notifications?tab=unread|viewed&page=1&pageSize=20
router.get("/", (async (req: AuthedRequest, res: any) => {
  const userId = req.user!.id;
  const tab = req.query.tab === "viewed" ? "viewed" : "unread";
  const page = Math.max(1, Number(req.query.page ?? "1"));
  const pageSize = Math.max(1, Math.min(100, Number(req.query.pageSize ?? "20")));

  const result = await fetchNotifications({ tab: tab as any, page, pageSize, userId });
  return res.json(result);
}) as any);

router.get("/:id", (async (req: AuthedRequest, res: any) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid notification ID" });
  const item = await prisma.notification.findFirst({ where: { id, userId: req.user!.id }, select: { id: true, title: true, body: true, createdAt: true, unread: true, meta: true } });
  if (!item) return res.status(404).json({ error: "Notification not found" });
  return res.json({ item });
}) as any);

// POST /api/customer/notifications/:id/mark-read
router.post("/:id/mark-read", (async (req: AuthedRequest, res: any) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const r = await markNotificationRead(id, undefined, userId);
  if (!r.ok) return res.status(404).json(r);
  return res.json(r);
}) as any);

// DELETE /api/customer/notifications/read - delete all read notifications for this traveller
router.delete("/read", (async (req: AuthedRequest, res: any) => {
  const userId = req.user!.id;
  const r = await deleteReadNotifications({ userId });
  if (!r.ok) return res.status(500).json(r);
  return res.json(r);
}) as any);

// DELETE /api/customer/notifications/:id - delete a read notification for this traveller
router.delete("/:id", (async (req: AuthedRequest, res: any) => {
  const { id } = req.params;
  const userId = req.user!.id;
  const r = await deleteReadNotification(id, undefined, userId);
  if (!r.ok) return res.status(404).json(r);
  return res.json(r);
}) as any);

export default router;
