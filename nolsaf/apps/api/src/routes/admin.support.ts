import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { CONVERSATION_STATUS } from "../lib/twiga/handoff.js";

// GET /api/admin/support/overview
// The support desk in one read: every queue where a traveller, owner or operator
// is waiting on a person, how many are waiting and since when, plus the contact
// details customers are shown (System Settings). Read-only.
export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

type Queue = { key: string; count: number; oldestAt: string | null };

async function queue(key: string, model: any, where: Record<string, unknown>, dateField = "createdAt"): Promise<Queue> {
  try {
    const [count, oldest] = await Promise.all([
      model.count({ where }),
      model.findFirst({ where, orderBy: { [dateField]: "asc" }, select: { [dateField]: true } }),
    ]);
    const at = oldest?.[dateField];
    return { key, count, oldestAt: at ? new Date(at).toISOString() : null };
  } catch {
    return { key, count: 0, oldestAt: null };
  }
}

router.get("/overview", async (_req, res) => {
  try {
    const db = prisma as any;
    const [twigaWaiting, twigaActive, cancellations, tourCases, guestCodes, groupRequests, settings, handoffs] = await Promise.all([
      queue("twiga_waiting", db.chatbotConversation, { status: CONVERSATION_STATUS.AWAITING_AGENT }, "handoffAt"),
      queue("twiga_active", db.chatbotConversation, { status: CONVERSATION_STATUS.AGENT_ACTIVE }, "updatedAt"),
      queue("cancellations", db.cancellationRequest, { status: { in: ["SUBMITTED", "REVIEWING"] } }),
      queue("tour_cases", db.tourCase, { status: { notIn: ["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"] } }),
      queue("guest_codes", db.guestCodeRequest, { status: { in: ["NEEDS_REVIEW", "UNREACHABLE"] } }),
      queue("group_requests", db.groupBooking, { status: "PENDING" }),
      db.systemSetting.findUnique({ where: { id: 1 }, select: { supportEmail: true, supportPhone: true } }).catch(() => null),
      // The newest hand-offs still waiting: why the visitor asked for a person.
      db.chatbotConversation
        .findMany({
          where: { status: CONVERSATION_STATUS.AWAITING_AGENT },
          orderBy: { handoffAt: "asc" },
          take: 5,
          select: { handoffReason: true, handoffAt: true, language: true, userId: true },
        })
        .catch(() => []),
    ]);

    res.json({
      queues: [twigaWaiting, twigaActive, cancellations, tourCases, guestCodes, groupRequests],
      contact: {
        // What customers actually see (same order as /api/public/support): Settings,
        // then the environment, then the official company contacts.
        email: settings?.supportEmail?.trim() || process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim() || "support@nolsaf.com",
        phone: settings?.supportPhone?.trim() || process.env.NEXT_PUBLIC_SUPPORT_PHONE?.trim() || "+255 736 766 726",
        fromSettings: Boolean(settings?.supportEmail?.trim() || settings?.supportPhone?.trim()),
      },
      handoffs: (handoffs as any[]).map((h) => ({
        reason: h.handoffReason ?? null,
        at: h.handoffAt ? new Date(h.handoffAt).toISOString() : null,
        language: h.language ?? null,
        signedIn: Boolean(h.userId),
      })),
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[GET /admin/support/overview]", err);
    res.status(500).json({ error: "Unable to load the support desk" });
  }
});

export default router;
