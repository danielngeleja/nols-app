import { Router, Request, Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole, blockImpersonated, AuthedRequest } from "../middleware/auth";
import { CONVERSATION_STATUS, MESSAGE_ROLE, OPEN_CONVERSATION_STATUSES, isAwaitingNotice } from "../lib/twiga/handoff";
import { markAgentRead, readReceipts } from "../lib/twiga/readReceipts";

const router = Router();

// All routes require admin authentication
router.use(requireAuth as any, requireRole("ADMIN") as any);

/** Longest agent reply we accept, matching the visitor-side message limit. */
const replySchema = z.object({
  content: z
    .string()
    .min(1, "Reply cannot be empty")
    .max(5000, "Reply is too long (maximum 5000 characters)")
    .refine((value) => value.trim().length > 0, "Reply cannot be only whitespace"),
});

function conversationId(req: Request): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /api/admin/chatbot/follow-up-count - chats waiting on a person nobody has picked up (sidebar badge)
router.get("/follow-up-count", async (req: Request, res: Response) => {
  try {
    // Status, not the legacy needsFollowUp flag: the old keyword matcher set
    // that flag on ordinary Twiga chats, and those rows kept the badge lit
    // with nothing for anyone to do.
    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const count = await prisma.chatbotConversation.count({
      where: { status: CONVERSATION_STATUS.AWAITING_AGENT },
    });
    return res.json({ success: true, count });
  } catch (error: any) {
    console.error("Get follow-up count error:", error);
    return res.status(500).json({ error: "Failed to fetch follow-up count" });
  }
});

// GET /api/admin/chatbot/stats - Get analytics and statistics
router.get("/stats", async (req: Request, res: Response) => {
  try {
    const { days = "7" } = req.query;
    const daysNum = parseInt(days as string, 10) || 7;
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysNum);
    startDate.setHours(0, 0, 0, 0); // Start of day

    // Get basic counts
    const [
      totalConversations,
      needsFollowUpCount,
      followedUpCount,
      recentConversations,
    ] = await Promise.all([
      // Total conversations
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      prisma.chatbotConversation.count(),
      // Open: waiting for an agent or with one. Key names kept for existing callers.
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      prisma.chatbotConversation.count({ where: { status: { in: [...OPEN_CONVERSATION_STATUSES] } } }),
      // Resolved, by an agent or by the 12-hour quiet rule
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      prisma.chatbotConversation.count({ where: { status: CONVERSATION_STATUS.RESOLVED } }),
      // Recent conversations (last 24 hours)
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      prisma.chatbotConversation.count({
        where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      }),
    ]);

    // Get conversations by day with error handling
    let conversationsByDay: Array<{ date: string; count: number }> = [];
    try {
      const conversationsByDayRaw = await prisma.$queryRaw<any>`
        SELECT DATE(createdAt) as date, COUNT(*) as count
        FROM chatbot_conversations
        WHERE createdAt >= ${startDate}
        GROUP BY DATE(createdAt)
        ORDER BY date ASC
      `;

      conversationsByDay = (conversationsByDayRaw || []).map((row: any) => {
        let dateStr = row.date;
        // Handle different date formats from MySQL
        if (dateStr instanceof Date) {
          dateStr = dateStr.toISOString().split('T')[0];
        } else if (typeof dateStr === 'string') {
          // MySQL DATE() returns YYYY-MM-DD format, use as-is
          dateStr = dateStr.split('T')[0];
        } else if (dateStr) {
          dateStr = String(dateStr).split('T')[0];
        }
        return {
          date: dateStr || '',
          count: Number(row.count) || 0,
        };
      });
    } catch (err: any) {
      console.error("Error fetching conversations by day:", err);
      // Continue with empty array
    }

    // Get top languages with error handling
    let topLanguages: Array<{ language: string; count: number }> = [];
    try {
      const topLanguagesRaw = await prisma.$queryRaw<any>`
        SELECT language, COUNT(*) as count
        FROM chatbot_conversations
        WHERE createdAt >= ${startDate}
        GROUP BY language
        ORDER BY count DESC
        LIMIT 5
      `;

      topLanguages = (topLanguagesRaw || []).map((row: any) => ({
        language: String(row.language || ''),
        count: Number(row.count) || 0,
      }));
    } catch (err: any) {
      console.error("Error fetching top languages:", err);
      // Continue with empty array
    }

    return res.json({
      success: true,
      stats: {
        total: totalConversations,
        needsFollowUp: needsFollowUpCount,
        followedUp: followedUpCount,
        recent: recentConversations,
        conversationsByDay,
        topLanguages,
      },
    });
  } catch (error: any) {
    console.error("Get chatbot stats error:", error);
    console.error("Error stack:", error?.stack);
    return res.status(500).json({ 
      error: "Failed to fetch stats", 
      message: error?.message || "Unknown error" 
    });
  }
});

// GET /api/admin/chatbot/conversations - Get all conversations that need follow-up
router.get("/conversations", async (req: Request, res: Response) => {
  try {
    const { needsFollowUp, status, page = 1, pageSize = 20, sortBy = "updatedAt", sortOrder = "desc" } = req.query;
    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Number(pageSize);

    const where: any = {};
    // `status` is the lifecycle filter. `needsFollowUp` is kept so existing
    // callers keep working while the console moves across.
    if (typeof status === "string" && status.length > 0) {
      const wanted = status.split(",").map((s) => s.trim()).filter(Boolean);
      const allowed = wanted.filter((s) =>
        (Object.values(CONVERSATION_STATUS) as string[]).includes(s)
      );
      if (allowed.length > 0) where.status = { in: allowed };
    } else if (needsFollowUp === "true") {
      where.needsFollowUp = true;
    } else if (needsFollowUp === "false") {
      where.needsFollowUp = false;
    }

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const [conversations, total] = await Promise.all([
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      prisma.chatbotConversation.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
          messages: {
            orderBy: { createdAt: "desc" },
            take: 1, // Get last message for preview
          },
          _count: {
            select: { messages: true },
          },
        },
        orderBy: { [sortBy as string]: sortOrder as "asc" | "desc" },
        skip,
        take,
      }),
      // @ts-ignore
      prisma.chatbotConversation.count({ where }),
    ]);

    return res.json({
      success: true,
      conversations: conversations.map((conv: any) => ({
        id: conv.id,
        sessionId: conv.sessionId,
        userId: conv.userId,
        userName: conv.user?.name || null,
        userEmail: conv.user?.email || null,
        userPhone: conv.user?.phone || null,
        language: conv.language,
        needsFollowUp: conv.needsFollowUp,
        followUpNotes: conv.followUpNotes,
        followedUpAt: conv.followedUpAt,
        followedUpBy: conv.followedUpBy,
        status: conv.status,
        assignedToId: conv.assignedToId,
        handoffReason: conv.handoffReason,
        handoffAt: conv.handoffAt,
        resolvedAt: conv.resolvedAt,
        lastMessage: conv.messages[0]?.content || null,
        lastMessageTime: conv.messages[0]?.createdAt || null,
        messageCount: conv._count.messages,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      })),
      total,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (error: any) {
    console.error("Get chatbot conversations error:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// GET /api/admin/chatbot/conversations/:id - Get full conversation details
router.get("/conversations/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const conversation = await prisma.chatbotConversation.findUnique({
      where: { id: Number(id) },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Opening the thread is reading it: the visitor's messages turn blue.
    // Best effort and safe before the receipts migration is applied.
    const agentLastReadAt = await markAgentRead(conversation.id);
    const { visitorLastReadAt } = await readReceipts(conversation.id);

    // Who closed it, for the Resolved panel. A removed admin simply shows no name.
    const followedUpByUser = conversation.followedUpBy
      ? await prisma.user.findUnique({ where: { id: conversation.followedUpBy }, select: { name: true } }).catch(() => null)
      : null;

    return res.json({
      success: true,
      conversation: {
        agentLastReadAt,
        visitorLastReadAt,
        id: conversation.id,
        sessionId: conversation.sessionId,
        userId: conversation.userId,
        userName: conversation.user?.name || null,
        userEmail: conversation.user?.email || null,
        userPhone: conversation.user?.phone || null,
        language: conversation.language,
        needsFollowUp: conversation.needsFollowUp,
        followUpNotes: conversation.followUpNotes,
        followedUpAt: conversation.followedUpAt,
        followedUpBy: conversation.followedUpBy,
        followedUpByName: followedUpByUser?.name ?? null,
        status: conversation.status,
        assignedToId: conversation.assignedToId,
        handoffReason: conversation.handoffReason,
        handoffAt: conversation.handoffAt,
        resolvedAt: conversation.resolvedAt,
        // The repeated "added to the thread" notices are noise for the agent too.
        messages: conversation.messages.filter((msg: any) => !isAwaitingNotice(msg.content)).map((msg: any) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          authorId: msg.authorId ?? null,
          timestamp: msg.createdAt,
        })),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      },
    });
  } catch (error: any) {
    console.error("Get conversation error:", error);
    return res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

// POST /api/admin/chatbot/conversations/:id/follow-up - Mark conversation as followed up
router.post("/conversations/:id/follow-up", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { notes } = req.body;
    const authedReq = req as AuthedRequest;
    const adminId = authedReq.user!.id;

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const conversation = await prisma.chatbotConversation.update({
      where: { id: Number(id) },
      data: {
        needsFollowUp: false,
        followUpNotes: notes || null,
        followedUpAt: new Date(),
        followedUpBy: adminId,
        updatedAt: new Date(),
      },
    });

    return res.json({
      success: true,
      conversation: {
        id: conversation.id,
        needsFollowUp: conversation.needsFollowUp,
        followUpNotes: conversation.followUpNotes,
        followedUpAt: conversation.followedUpAt,
        followedUpBy: conversation.followedUpBy,
      },
    });
  } catch (error: any) {
    console.error("Mark follow-up error:", error);
    return res.status(500).json({ error: "Failed to mark follow-up" });
  }
});

/**
 * POST /api/admin/chatbot/conversations/:id/reply
 *
 * Write a human reply into the visitor's thread. This is the endpoint the whole
 * handoff exists for: before it, an admin could only record an internal note
 * that the person who asked for help never saw.
 *
 * Impersonation is blocked. An admin acting as someone else must not be able to
 * speak to a customer as support, because the transcript would attribute it to
 * the impersonated account and there would be no way to tell who really wrote it.
 */
router.post(
  "/conversations/:id/reply",
  blockImpersonated as any,
  async (req: Request, res: Response) => {
    try {
      const id = conversationId(req);
      if (id === null) return res.status(400).json({ error: "Invalid conversation id" });

      const parsed = replySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({
          error: "Validation failed",
          details: parsed.error.issues.map((e) => ({
            field: e.path.join("."),
            message: e.message,
          })),
        });
      }

      const adminId = (req as AuthedRequest).user!.id;

      const conversation = await prisma.chatbotConversation.findUnique({
        where: { id },
        select: { id: true, language: true, assignedToId: true },
      });
      if (!conversation) return res.status(404).json({ error: "Conversation not found" });

      // Replying means everything before this reply was read. Outside the
      // transaction on purpose: a receipt must never be able to fail a reply.
      void markAgentRead(id);

      const [message] = await prisma.$transaction([
        prisma.chatbotMessage.create({
          data: {
            conversationId: id,
            role: MESSAGE_ROLE.AGENT,
            content: parsed.data.content.trim(),
            language: conversation.language,
            authorId: adminId,
          },
        }),
        prisma.chatbotConversation.update({
          where: { id },
          data: {
            // Replying takes ownership. Claiming first is optional, not a gate:
            // making someone click claim before they can answer just adds a step
            // between a waiting visitor and their reply.
            status: CONVERSATION_STATUS.AGENT_ACTIVE,
            assignedToId: conversation.assignedToId ?? adminId,
            resolvedAt: null,
            // The thread is now being handled, so it leaves the unanswered queue.
            needsFollowUp: false,
            updatedAt: new Date(),
          },
        }),
      ]);

      return res.json({
        success: true,
        message: {
          id: message.id,
          role: message.role,
          content: message.content,
          authorId: message.authorId,
          timestamp: message.createdAt,
        },
      });
    } catch (error: any) {
      console.error("Agent reply error:", error);
      return res.status(500).json({ error: "Failed to send reply" });
    }
  }
);

/** POST /api/admin/chatbot/conversations/:id/claim - take ownership without replying yet. */
router.post("/conversations/:id/claim", blockImpersonated as any, async (req: Request, res: Response) => {
  try {
    const id = conversationId(req);
    if (id === null) return res.status(400).json({ error: "Invalid conversation id" });

    const adminId = (req as AuthedRequest).user!.id;

    const conversation = await prisma.chatbotConversation.update({
      where: { id },
      data: {
        status: CONVERSATION_STATUS.AGENT_ACTIVE,
        assignedToId: adminId,
        needsFollowUp: false,
        resolvedAt: null,
        updatedAt: new Date(),
      },
      select: { id: true, status: true, assignedToId: true },
    });

    return res.json({ success: true, conversation });
  } catch (error: any) {
    console.error("Claim conversation error:", error);
    return res.status(500).json({ error: "Failed to claim conversation" });
  }
});

/**
 * POST /api/admin/chatbot/conversations/:id/resolve - close the thread.
 *
 * `notes` are internal. They are stored on the conversation, never written as a
 * message, so nothing here reaches the visitor.
 */
router.post("/conversations/:id/resolve", blockImpersonated as any, async (req: Request, res: Response) => {
  try {
    const id = conversationId(req);
    if (id === null) return res.status(400).json({ error: "Invalid conversation id" });

    const adminId = (req as AuthedRequest).user!.id;
    const notes = typeof req.body?.notes === "string" ? req.body.notes.slice(0, 5000) : null;

    const conversation = await prisma.chatbotConversation.update({
      where: { id },
      data: {
        status: CONVERSATION_STATUS.RESOLVED,
        resolvedAt: new Date(),
        needsFollowUp: false,
        followedUpAt: new Date(),
        followedUpBy: adminId,
        ...(notes ? { followUpNotes: notes } : {}),
        updatedAt: new Date(),
      },
      select: { id: true, status: true, resolvedAt: true },
    });

    return res.json({ success: true, conversation });
  } catch (error: any) {
    console.error("Resolve conversation error:", error);
    return res.status(500).json({ error: "Failed to resolve conversation" });
  }
});

/** POST /api/admin/chatbot/conversations/:id/reopen - put a closed thread back in the queue. */
router.post("/conversations/:id/reopen", blockImpersonated as any, async (req: Request, res: Response) => {
  try {
    const id = conversationId(req);
    if (id === null) return res.status(400).json({ error: "Invalid conversation id" });

    const conversation = await prisma.chatbotConversation.update({
      where: { id },
      data: {
        status: CONVERSATION_STATUS.AWAITING_AGENT,
        resolvedAt: null,
        needsFollowUp: true,
        updatedAt: new Date(),
      },
      select: { id: true, status: true },
    });

    return res.json({ success: true, conversation });
  } catch (error: any) {
    console.error("Reopen conversation error:", error);
    return res.status(500).json({ error: "Failed to reopen conversation" });
  }
});

export default router;

