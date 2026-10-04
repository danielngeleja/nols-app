import { Router, Request, Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { ask, isTwigaLanguage } from "../lib/twiga";
import { ground } from "../lib/twiga/grounding";
import {
  CONVERSATION_STATUS,
  acknowledgementFor,
  awaitingNoticeFor,
  handoffReasonFor,
  HANDOFF_REASON,
  isAwaitingNotice,
  isWithHuman,
  normaliseHandoffReason,
  releasedToTwigaFor,
  requiresSignInForHandoff,
  returnPathForHandoff,
  shouldPersistTranscript,
  signInForSupportFor,
  signedInHandoffFor,
  shouldReleaseToTwiga,
  talkToPersonFollowUp,
} from "../lib/twiga/handoff";
import {
  limitChatbotMessages,
  limitChatbotConversations,
  limitChatbotLanguageChange,
  limitChatbotUpdates,
  limitChatbotMentions,
} from "../middleware/rateLimit";
import { resolveMentions, searchMentionables, type ResolvedMention } from "../lib/twiga/mentions";
import { answerForPlace, recentPlace, withoutTokens } from "../lib/twiga/placeAnswers";
import { parseStay } from "../lib/twiga/stayDates";
import { markVisitorRead, readReceipts } from "../lib/twiga/readReceipts";
import { z } from "zod";
import crypto from "crypto";

const router = Router();

// Supported languages
// Swahili is first-class here: it is the primary language of the market, and
// every registry entry carries sw copy.
const SUPPORTED_LANGUAGES = ["en", "sw", "es", "fr", "pt", "ar", "zh"] as const;
type SupportedLanguage = typeof SUPPORTED_LANGUAGES[number];

// Validation schemas using Zod
const messageSchema = z.object({
  message: z
    .string()
    .min(1, "Message cannot be empty")
    .max(5000, "Message is too long (maximum 5000 characters)")
    .refine((msg) => msg.trim().length > 0, "Message cannot be only whitespace"),
  language: z.enum(["en", "sw", "es", "fr", "pt", "ar", "zh"]).optional().default("en"),
  // Still accepted for backwards compatibility with deployed clients, but the
  // server ignores it: the session is derived from the token or httpOnly cookie.
  sessionId: z.string().max(100).nullish(),
  /** Page the visitor is on, used only as the return path after sign-in. */
  page: z.string().max(500).nullish(),
});

const setLanguageSchema = z.object({
  language: z.enum(["en", "sw", "es", "fr", "pt", "ar", "zh"]),
  sessionId: z.string().max(100).nullish(), // ignored, see messageSchema
});

const SESSION_COOKIE = "chatbot_session_id";

/**
 * Resolve the session this request is allowed to act on.
 *
 * A session id is a capability over a support transcript, so it is never taken
 * from the request body. A signed-in visitor is always pinned to their own
 * account session; an anonymous visitor is pinned to the httpOnly cookie we
 * issued them, and gets a fresh server-generated id if they have none.
 */
function resolveSessionId(req: Request): string {
  const authedReq = req as AuthedRequest;
  if (authedReq.user?.id) {
    return `user_${authedReq.user.id}`;
  }

  const cookieSessionId = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieSessionId === "string" && cookieSessionId.length > 0 && cookieSessionId.length <= 100) {
    return cookieSessionId;
  }
  return `anon_${crypto.randomUUID()}`;
}

/** Issue/refresh the anonymous session cookie so the visitor can read back their own transcript. */
function setSessionCookie(req: Request, res: Response, sessionId: string): void {
  const authedReq = req as AuthedRequest;
  if (authedReq.user?.id) return; // signed-in sessions are derived from the token, not a cookie
  if (req.cookies?.[SESSION_COOKIE] === sessionId) return;

  res.cookie(SESSION_COOKIE, sessionId, {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

/** True when this request is allowed to read the given conversation. */
function canAccessConversation(
  req: Request,
  conversation: { sessionId: string; userId: number | null }
): boolean {
  const authedReq = req as AuthedRequest;
  const userId = authedReq.user?.id ?? null;

  // Owned by an account: only that account may read it.
  if (conversation.userId !== null) {
    return userId !== null && conversation.userId === userId;
  }

  // Anonymous: only the browser holding the matching httpOnly cookie may read it.
  return req.cookies?.[SESSION_COOKIE] === conversation.sessionId;
}

// Get or create conversation
async function getOrCreateConversation(
  sessionId: string,
  userId: number | null,
  language: SupportedLanguage
) {
  // @ts-ignore - Prisma Client needs regeneration after schema changes
  const conversation = await prisma.chatbotConversation.upsert({
    where: { sessionId },
    // Claim ownership on update too: a signed-in visitor's session row may
    // predate their login (or have been created before auth was wired up),
    // and an unowned row would otherwise stay readable via the cookie branch.
    update: { language, updatedAt: new Date(), ...(userId ? { userId } : {}) },
    create: {
      sessionId,
      userId,
      language,
    },
  });
  return conversation;
}

/**
 * Whether any admin console is connected right now.
 *
 * Drives the visitor's second tick: one tick means the message is saved, two
 * mean the support console is open and has been alerted. Cached briefly
 * because every open widget polls, and with the Redis adapter fetchSockets is
 * a round trip across API workers.
 */
let consoleOnlineCache: { at: number; online: boolean } | null = null;
async function agentConsoleOnline(req: Request): Promise<boolean> {
  if (consoleOnlineCache && Date.now() - consoleOnlineCache.at < 10_000) return consoleOnlineCache.online;
  try {
    const io = (req as any).app?.get?.("io") || (global as any).io;
    const online = io && typeof io.in === "function" ? (await io.in("admin").fetchSockets()).length > 0 : false;
    consoleOnlineCache = { at: Date.now(), online };
    return online;
  } catch {
    return false;
  }
}

type VisitorAlertKind = "handoff" | "message";

/**
 * Tell the admin console a visitor needs a person.
 *
 * Two moments matter: the hand-off itself, and every later message the visitor
 * sends while the chat is with support. Both go out as the standard
 * `admin:notification:new` event, so the existing listener toasts, chimes and
 * drops it into the bell drawer, plus `chatbot:activity` so the Twiga page and
 * its sidebar badge refresh live.
 *
 * One inbox record per conversation: a follow-up message refreshes the unread
 * record for that chat instead of stacking a new one for every line typed.
 */
async function alertAdminsOfVisitor(
  kind: VisitorAlertKind,
  conversation: { id: number; userId: number | null },
  req: Request,
  detail: { text: string; mentions: ResolvedMention[] }
) {
  try {
    const io = (req as any).app?.get?.("io") || (global as any).io;
    const preview = detail.text.replace(/\s+/g, " ").trim().slice(0, 160);
    const tagged = detail.mentions.map((m) => m.label).join(", ");
    const title = kind === "handoff" ? "Visitor asked for NoLSAF Support" : "New message in a support chat";
    const body = [preview ? `"${preview}"` : null, tagged ? `Tagged: ${tagged}` : null].filter(Boolean).join(" · ");
    const link = `/admin/agents/ai?conversation=${conversation.id}`;
    const meta = {
      type: "chatbot_followup",
      notificationKind: kind === "handoff" ? "twiga_handoff" : "twiga_message",
      conversationId: conversation.id,
      source: "chatbot",
      link,
      mentions: detail.mentions,
    };

    let record: { id: number; createdAt: Date } | null = null;
    try {
      const existing =
        kind === "message"
          ? await prisma.notification.findFirst({
              where: {
                userId: null,
                ownerId: null,
                type: "chatbot",
                unread: true,
                meta: { path: "$.conversationId", equals: conversation.id },
              },
              orderBy: { createdAt: "desc" },
              select: { id: true },
            })
          : null;

      record = existing
        ? await prisma.notification.update({
            where: { id: existing.id },
            data: { title, body, meta, createdAt: new Date() },
            select: { id: true, createdAt: true },
          })
        : await prisma.notification.create({
            data: { userId: null, ownerId: null, title, body, unread: true, meta, type: "chatbot" },
            select: { id: true, createdAt: true },
          });
    } catch (notifError: any) {
      console.warn("Failed to record Twiga admin notification:", notifError?.message || notifError);
    }

    if (io && typeof io.to === "function") {
      io.to("admin").emit("admin:notification:new", {
        id: record?.id,
        title,
        body,
        type: "chatbot",
        template: meta.notificationKind,
        priority: "normal",
        createdAt: (record?.createdAt ?? new Date()).toISOString(),
        meta,
      });
      io.to("admin").emit("chatbot:activity", {
        kind,
        conversationId: conversation.id,
        timestamp: new Date().toISOString(),
      });
      // Kept for any console still listening to the old event name.
      if (kind === "handoff") {
        io.to("admin").emit("chatbot:follow-up-needed", {
          conversationId: conversation.id,
          timestamp: new Date().toISOString(),
          type: "chatbot_followup",
        });
      }
    }
  } catch (error: any) {
    // An alert failing must never fail the visitor's message.
    console.warn("Failed to alert admins of visitor activity:", error?.message || error);
  }
}

// POST /api/chatbot/message - Send a message to the chatbot
router.post("/message", limitChatbotMessages, async (req: Request, res: Response) => {
  try {
    // Validate input using Zod
    const validationResult = messageSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validationResult.error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { message, language, page } = validationResult.data;

    // Tags are re-validated against approved listings before anything is stored.
    // `plain` is what Twiga reads: labels only, no token syntax.
    const { content: storedContent, plain: plainMessage, mentions } = await resolveMentions(message.trim());

    // Validate language
    const lang = SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)
      ? (language as SupportedLanguage)
      : "en";

    // Get user from auth if available
    const authedReq = req as AuthedRequest;
    const userId = authedReq.user?.id || null;

    // Derived from the token or the httpOnly cookie, never from the request body.
    const sessionId = resolveSessionId(req);

    // Get or create conversation
    const conversation = await getOrCreateConversation(sessionId, userId, lang);

    // Save user message to database
    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const userMessage = await prisma.chatbotMessage.create({
      data: {
        conversationId: conversation.id,
        role: "user",
        content: storedContent,
        language: lang,
      },
    });

    // A support thread whose agent has gone quiet comes back to Twiga, so a new
    // question gets an answer instead of silence. Asking for a person again
    // simply hands it over again below.
    let releasedToTwiga = false;
    if (conversation.status === CONVERSATION_STATUS.AGENT_ACTIVE) {
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      const lastAgent = await prisma.chatbotMessage.findFirst({
        where: { conversationId: conversation.id, role: "agent" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      if (shouldReleaseToTwiga({ status: conversation.status, lastAgentMessageAt: lastAgent?.createdAt ?? null })) {
        // @ts-ignore - Prisma Client needs regeneration after schema changes
        await prisma.chatbotConversation.update({
          where: { id: conversation.id },
          data: { status: CONVERSATION_STATUS.BOT, needsFollowUp: false, resolvedAt: new Date(), updatedAt: new Date() },
        });
        conversation.status = CONVERSATION_STATUS.BOT;
        releasedToTwiga = true;
      }
    }

    // Once a thread is with a person, Twiga stays out of it entirely. It used to
    // answer every visitor message with the same "added to the thread" line;
    // the widget now shows delivery ticks instead, which say the same thing
    // without repeating it.
    if (isWithHuman(conversation.status)) {
      // The agent is not watching this tab; tell them the visitor wrote again.
      await alertAdminsOfVisitor("message", conversation, req, { text: plainMessage, mentions });

      // Bump the thread so it rises in the agent's queue.
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      await prisma.chatbotConversation.update({
        where: { id: conversation.id },
        data: { updatedAt: new Date() },
      });

      setSessionCookie(req, res, sessionId);

      return res.json({
        success: true,
        sessionId,
        status: conversation.status,
        messages: [
          {
            id: userMessage.id,
            role: "user",
            content: userMessage.content,
            timestamp: userMessage.createdAt.toISOString(),
          },
        ],
        agentOnline: await agentConsoleOnline(req),
        intent: null,
        confidence: 0,
        offerHandoff: false,
        grounded: false,
      });
    }

    // Resolve against the Twiga knowledge registry. Owners get the owner and
    // NRMS body of knowledge; everyone else gets the customer one.
    const registryResolution = ask(plainMessage, {
      language: isTwigaLanguage(lang) ? lang : "en",
      audience: authedReq.user?.role === "OWNER" ? "owner" : "customer",
      userId,
    });

    // A tagged place gets a live answer from the listing itself: facts, dates,
    // availability, price and a booking link. A message that only adds dates
    // ("12 to 15 October") reuses the place tagged in the last half hour.
    // Asking for a person, or an emergency, always wins over this.
    const wantsPerson = registryResolution.entryId === "human-handoff" || registryResolution.entryId === "emergency";
    let placeTarget: ResolvedMention | null = null;
    if (!wantsPerson) {
      placeTarget = mentions.find((m) => m.kind === "property") ?? mentions[0] ?? null;
      if (!placeTarget && parseStay(withoutTokens(storedContent)).mentionsDates) {
        placeTarget = await recentPlace(conversation.id, userMessage.id);
      }
    }
    const placeAnswer = placeTarget ? await answerForPlace(placeTarget, storedContent, lang) : null;

    const resolution = placeAnswer
      ? {
          ...registryResolution,
          text: placeAnswer.text,
          entryId: "place-answer",
          confidence: 1,
          links: placeAnswer.links,
          followUps: placeAnswer.followUps,
          shouldOfferHandoff: false,
        }
      : registryResolution;

    // For a signed-in visitor, lead with their own records where we have them.
    // Read-only, scoped to their own id, and silently skipped on any failure.
    const grounded = userId
      ? await ground(resolution.entryId, { userId, role: authedReq.user?.role ?? null })
      : null;

    // Hand off only when Twiga could not answer confidently, or the visitor
    // asked for a person. The previous keyword list matched words as common as
    // "help" and "problem", so nearly every conversation was flagged and the
    // admin queue carried no signal at all.
    const handoffReason = handoffReasonFor({
      entryId: resolution.entryId,
      shouldOfferHandoff: resolution.shouldOfferHandoff,
    });

    // An anonymous visitor asking for a person is sent to sign in first, and
    // comes back to the same page with the conversation handed over (see
    // POST /resume-after-sign-in). Emergencies are never gated.
    const signInRequired = requiresSignInForHandoff(handoffReason, userId);
    const returnTo = returnPathForHandoff(page);
    const signInLinks = [
      { label: lang === "sw" ? "Ingia" : "Sign in", href: `/login?next=${encodeURIComponent(returnTo)}` },
      { label: lang === "sw" ? "Fungua akaunti bure" : "Create free account", href: `/account/register?next=${encodeURIComponent(returnTo)}` },
    ];

    const parts = signInRequired && handoffReason
      ? [signInForSupportFor(handoffReason, lang)]
      : [releasedToTwiga && !handoffReason ? releasedToTwigaFor(lang) : null, grounded, resolution.text];
    if (handoffReason && !signInRequired) parts.push(acknowledgementFor(handoffReason, lang));
    const answer = parts.filter(Boolean).join("\n\n");

    // Save assistant message to database
    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const assistantMessage = await prisma.chatbotMessage.create({
      data: {
        conversationId: conversation.id,
        role: "assistant",
        content: answer,
        language: lang,
      },
    });

    let status: string = conversation.status ?? CONVERSATION_STATUS.BOT;

    if (handoffReason && !signInRequired && !isWithHuman(status)) {
      status = CONVERSATION_STATUS.AWAITING_AGENT;
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      await prisma.chatbotConversation.update({
        where: { id: conversation.id },
        data: {
          status,
          handoffAt: new Date(),
          handoffReason: normaliseHandoffReason(handoffReason),
          // Kept in step so the existing admin queue and its unread badge keep
          // working while the console moves over to `status`.
          needsFollowUp: true,
          resolvedAt: null,
          updatedAt: new Date(),
        },
      });

      // Toast, chime, bell drawer and the Twiga sidebar badge on every admin console.
      await alertAdminsOfVisitor("handoff", conversation, req, { text: plainMessage, mentions });
    }

    // Issue/refresh the anonymous session cookie so this browser can read its own history
    setSessionCookie(req, res, sessionId);

    return res.json({
      success: true,
      sessionId,
      messages: [
        {
          id: userMessage.id,
          role: "user",
          content: userMessage.content,
          timestamp: userMessage.createdAt.toISOString(),
        },
        {
          id: assistantMessage.id,
          role: "assistant",
          content: assistantMessage.content,
          timestamp: assistantMessage.createdAt.toISOString(),
          // Rendered by the widget as deep-link buttons and suggestion chips.
          links: signInRequired ? signInLinks : resolution.links,
          // Unsure answers offer a person rather than handing over silently.
          followUps: signInRequired
            ? []
            : resolution.shouldOfferHandoff
              ? [talkToPersonFollowUp(lang), ...resolution.followUps.filter((f) => f !== talkToPersonFollowUp(lang))].slice(0, 4)
              : resolution.followUps,
        },
      ],
      // Diagnostics for the admin console, and the signal the widget uses to
      // surface a "talk to a person" affordance.
      intent: resolution.entryId,
      confidence: resolution.confidence,
      offerHandoff: resolution.shouldOfferHandoff,
      /** True when the answer was personalised from the caller's own records. */
      grounded: grounded !== null,
      /** Drives the widget: agent presence, and holding the transcript open. */
      status,
      persistTranscript: shouldPersistTranscript(status),
      /** The visitor must sign in before a person joins; the reply carries the links. */
      signInRequired,
    });
  } catch (error: any) {
    console.error("Chatbot message error:", error);
    return res.status(500).json({ error: "Failed to process message" });
  }
});

// GET /api/chatbot/mentions?q=&context= - Suggestions for the @ tag picker.
// Approved properties and regions only. `context` is the property slug of the
// page the visitor is on, offered first.
router.get("/mentions", limitChatbotMentions, async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.slice(0, 60) : "";
    const context = typeof req.query.context === "string" ? req.query.context.slice(0, 200) : null;
    const result = await searchMentionables(q, context);
    res.setHeader("Cache-Control", "private, max-age=30");
    return res.json({ success: true, ...result });
  } catch (error: any) {
    console.error("Chatbot mentions error:", error);
    return res.status(500).json({ error: "Failed to load suggestions" });
  }
});

// GET /api/chatbot/conversations/:sessionId - Get conversation history
router.get("/conversations/:sessionId", limitChatbotConversations, async (req: Request, res: Response) => {
  try {
    // The path param is only a hint. The transcript we are willing to return is
    // the one this request actually owns, so resolve it from the token/cookie
    // and refuse anything else rather than trusting a guessable id.
    const requestedSessionId = req.params.sessionId;
    const ownSessionId = resolveSessionId(req);
    // Pin the anonymous visitor to this id from first contact, so the transcript
    // they are about to start is readable by them on the next load.
    setSessionCookie(req, res, ownSessionId);

    if (requestedSessionId !== ownSessionId) {
      return res.json({ success: true, sessionId: ownSessionId, messages: [] });
    }

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const conversation = await prisma.chatbotConversation.findUnique({
      where: { sessionId: ownSessionId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!conversation) {
      return res.json({ success: true, sessionId: ownSessionId, messages: [] });
    }

    // Check authorization
    if (!canAccessConversation(req, conversation)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const status = conversation.status ?? CONVERSATION_STATUS.BOT;

    return res.json({
      success: true,
      conversation: {
        id: conversation.id,
        sessionId: conversation.sessionId,
        language: conversation.language,
        createdAt: conversation.createdAt,
        status,
        /** Hold the transcript open while a person is on the thread. */
        persistTranscript: shouldPersistTranscript(status),
      },
      agentOnline: isWithHuman(status) ? await agentConsoleOnline(req) : false,
      messages: conversation.messages.filter((msg: any) => !isAwaitingNotice(msg.content)).map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("Get conversation error:", error);
    return res.status(500).json({ error: "Failed to fetch conversation" });
  }
});

/**
 * POST /api/chatbot/resume-after-sign-in
 *
 * The visitor asked for a person while signed out, was sent to sign in or
 * register, and has come back to the page they started on. Two things happen:
 *
 * 1. The anonymous transcript follows them into their account. Ownership is
 *    proven by the httpOnly session cookie this browser already holds, the same
 *    check every other anonymous read uses, so nobody can claim someone else's
 *    chat by guessing an id.
 * 2. If `handoff` is set, the conversation is handed to the support team and
 *    admins are alerted, exactly as if they had asked while signed in.
 */
router.post("/resume-after-sign-in", limitChatbotLanguageChange, async (req: Request, res: Response) => {
  try {
    const authedReq = req as AuthedRequest;
    const userId = authedReq.user?.id ?? null;
    if (!userId) return res.status(401).json({ error: "Sign in first" });

    const wantsHandoff = req.body?.handoff === true;
    const accountSessionId = `user_${userId}`;
    const cookieSessionId = req.cookies?.[SESSION_COOKIE];

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    let conversation = await prisma.chatbotConversation.findUnique({ where: { sessionId: accountSessionId } });

    const anonymous =
      typeof cookieSessionId === "string" && cookieSessionId.startsWith("anon_") && cookieSessionId.length <= 100
        ? // @ts-ignore - Prisma Client needs regeneration after schema changes
          await prisma.chatbotConversation.findUnique({ where: { sessionId: cookieSessionId } })
        : null;

    if (anonymous && anonymous.userId === null) {
      if (!conversation) {
        // Simplest case: the anonymous thread becomes the account's thread.
        // @ts-ignore - Prisma Client needs regeneration after schema changes
        conversation = await prisma.chatbotConversation.update({
          where: { id: anonymous.id },
          data: { sessionId: accountSessionId, userId, updatedAt: new Date() },
        });
      } else if (anonymous.id !== conversation.id) {
        // The account already has a thread: move the anonymous messages into it,
        // keeping their timestamps so the transcript reads in order.
        // @ts-ignore - Prisma Client needs regeneration after schema changes
        await prisma.chatbotMessage.updateMany({
          where: { conversationId: anonymous.id },
          data: { conversationId: conversation.id },
        });
        // @ts-ignore - Prisma Client needs regeneration after schema changes
        await prisma.chatbotConversation.update({
          where: { id: anonymous.id },
          data: { userId, updatedAt: new Date() },
        });
      }
    }

    // The account session now owns the transcript; the anonymous cookie is spent.
    if (cookieSessionId) {
      res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    }

    if (!conversation) {
      // Nothing to carry over and nothing to hand off.
      return res.json({ success: true, sessionId: accountSessionId, status: CONVERSATION_STATUS.BOT, handedOff: false });
    }

    let status: string = conversation.status ?? CONVERSATION_STATUS.BOT;
    let handedOff = false;

    if (wantsHandoff && !isWithHuman(status)) {
      const lang = SUPPORTED_LANGUAGES.includes(conversation.language as SupportedLanguage) ? conversation.language : "en";
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      const account = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, name: true } });
      const firstName = String(account?.fullName || account?.name || "").trim().split(/\s+/)[0] || null;

      status = CONVERSATION_STATUS.AWAITING_AGENT;
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      await prisma.chatbotConversation.update({
        where: { id: conversation.id },
        data: {
          status,
          handoffAt: new Date(),
          handoffReason: normaliseHandoffReason(HANDOFF_REASON.REQUESTED),
          needsFollowUp: true,
          resolvedAt: null,
          updatedAt: new Date(),
        },
      });
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      await prisma.chatbotMessage.create({
        data: { conversationId: conversation.id, role: "assistant", content: signedInHandoffFor(lang, firstName), language: lang },
      });

      // Quote what they actually asked, not the sign-in exchange.
      // @ts-ignore - Prisma Client needs regeneration after schema changes
      const lastQuestion = await prisma.chatbotMessage.findFirst({
        where: { conversationId: conversation.id, role: "user" },
        orderBy: { createdAt: "desc" },
        select: { content: true },
      });
      const { plain, mentions } = await resolveMentions(String(lastQuestion?.content ?? ""));
      await alertAdminsOfVisitor("handoff", { id: conversation.id, userId }, req, { text: plain, mentions });
      handedOff = true;
    }

    return res.json({ success: true, sessionId: accountSessionId, status, handedOff });
  } catch (error: any) {
    console.error("Resume after sign-in error:", error);
    return res.status(500).json({ error: "Failed to resume conversation" });
  }
});

/**
 * POST /api/chatbot/cancel-handoff
 *
 * Give the visitor a way back to Twiga.
 *
 * Asking for a person silences the bot, which is right while an agent is
 * dealing with the thread. But if nobody has picked it up yet, the visitor is
 * stuck: every message comes back "our support team has this one" and they
 * cannot get an answer to anything, even something Twiga could have handled.
 * Leaving someone in that state is worse than never offering the handoff.
 *
 * Only AWAITING_AGENT can be cancelled. Once an agent has actually replied the
 * thread is a conversation with a person, and yanking it back to the bot
 * mid-exchange would be rude to both sides.
 */
router.post("/cancel-handoff", limitChatbotLanguageChange, async (req: Request, res: Response) => {
  try {
    const sessionId = resolveSessionId(req);

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const conversation = await prisma.chatbotConversation.findUnique({
      where: { sessionId },
      select: { id: true, sessionId: true, userId: true, status: true },
    });

    if (!conversation || !canAccessConversation(req, conversation)) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    if (conversation.status !== CONVERSATION_STATUS.AWAITING_AGENT) {
      return res.json({ success: true, status: conversation.status ?? CONVERSATION_STATUS.BOT });
    }

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    await prisma.chatbotConversation.update({
      where: { id: conversation.id },
      data: {
        status: CONVERSATION_STATUS.BOT,
        needsFollowUp: false,
        handoffAt: null,
        handoffReason: null,
        updatedAt: new Date(),
      },
    });

    return res.json({ success: true, status: CONVERSATION_STATUS.BOT });
  } catch (error: any) {
    console.error("Cancel handoff error:", error);
    return res.status(500).json({ error: "Failed to cancel handoff" });
  }
});

/**
 * GET /api/chatbot/updates
 *
 * Lightweight poll for the widget: has an agent replied since the last message
 * this browser has seen? Returns only messages newer than `after`, so an open
 * widget can pick up a human reply without refetching the whole transcript.
 */
router.get("/updates", limitChatbotUpdates, async (req: Request, res: Response) => {
  try {
    const sessionId = resolveSessionId(req);
    const afterRaw = Number(req.query.after);
    const after = Number.isInteger(afterRaw) && afterRaw > 0 ? afterRaw : 0;

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const conversation = await prisma.chatbotConversation.findUnique({
      where: { sessionId },
      select: { id: true, sessionId: true, userId: true, status: true },
    });

    if (!conversation || !canAccessConversation(req, conversation)) {
      // Nothing to report rather than an error: the widget polls this on a
      // timer and a 403 loop would be noise in the console for no benefit.
      return res.json({ success: true, messages: [], status: CONVERSATION_STATUS.BOT });
    }

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const messages = await prisma.chatbotMessage.findMany({
      where: { conversationId: conversation.id, id: { gt: after } },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true, role: true, content: true, createdAt: true },
    });

    const status = conversation.status ?? CONVERSATION_STATUS.BOT;

    // `seen=1` is sent only while the chat is open and visible on screen. Written
    // at most every 15 seconds, since every open widget polls.
    if (req.query.seen === "1" && isWithHuman(status) && (await markVisitorRead(conversation.id))) {
      // Let an agent with this chat open see "Seen by visitor" without reloading.
      try {
        const io = (req as any).app?.get?.("io") || (global as any).io;
        io?.to?.("admin")?.emit?.("chatbot:activity", {
          kind: "seen",
          conversationId: conversation.id,
          timestamp: new Date().toISOString(),
        });
      } catch {
        // Realtime is optional; the agent sees it on the next load.
      }
    }
    const { agentLastReadAt } = isWithHuman(status)
      ? await readReceipts(conversation.id)
      : { agentLastReadAt: null };

    return res.json({
      success: true,
      status,
      /** Visitor messages created at or before this have been read by an agent. */
      agentLastReadAt,
      persistTranscript: shouldPersistTranscript(status),
      /** Second tick: an admin console is connected and alerted. */
      agentOnline: isWithHuman(status) ? await agentConsoleOnline(req) : false,
      messages: messages.filter((msg: any) => !isAwaitingNotice(msg.content)).map((msg: any) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("Chatbot updates error:", error);
    return res.status(500).json({ error: "Failed to fetch updates" });
  }
});

// GET /api/chatbot/conversations - Get all conversations for authenticated user
router.get("/conversations", requireAuth as any, async (req: Request, res: Response) => {
  try {
    const authedReq = req as AuthedRequest;
    const userId = authedReq.user!.id;

    // @ts-ignore - Prisma Client needs regeneration after schema changes
    const conversations = await prisma.chatbotConversation.findMany({
      where: { userId },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1, // Get last message for preview
        },
      },
      orderBy: { updatedAt: "desc" },
      take: 50, // Limit to recent 50 conversations
    });

    return res.json({
      success: true,
      conversations: conversations.map((conv: any) => ({
        id: conv.id,
        sessionId: conv.sessionId,
        language: conv.language,
        lastMessage: conv.messages[0]?.content || null,
        updatedAt: conv.updatedAt,
        createdAt: conv.createdAt,
      })),
    });
  } catch (error: any) {
    console.error("Get conversations error:", error);
    return res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// POST /api/chatbot/set-language - Update conversation language
router.post("/set-language", limitChatbotLanguageChange, async (req: Request, res: Response) => {
  try {
    // Validate input using Zod
    const validationResult = setLanguageSchema.safeParse(req.body);
    if (!validationResult.success) {
      return res.status(400).json({
        error: "Validation failed",
        details: validationResult.error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      });
    }

    const { language } = validationResult.data;

    // Validate language
    const lang = SUPPORTED_LANGUAGES.includes(language as SupportedLanguage)
      ? (language as SupportedLanguage)
      : "en";

    const authedReq = req as AuthedRequest;
    const userId = authedReq.user?.id || null;
    // Derived from the token or the httpOnly cookie, never from the request body.
    const sessionId = resolveSessionId(req);
    setSessionCookie(req, res, sessionId);

    const conversation = await getOrCreateConversation(sessionId, userId, lang);

    return res.json({
      success: true,
      sessionId: conversation.sessionId,
      language: conversation.language,
    });
  } catch (error: any) {
    console.error("Set language error:", error);
    return res.status(500).json({ error: "Failed to set language" });
  }
});

export default router;

