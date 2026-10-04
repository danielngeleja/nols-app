"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { renderWithMentions, stripMentions, type MentionTone } from "@/lib/twigaMentions";
import {
  ArrowDown, ArrowUpRight, AtSign, Bell, Building2, Check, CheckCheck, ChevronDown, Clock3, Copy, Globe, Headphones, LogIn, MapPin, Maximize2, MessageCircle, UserPlus,
  Minimize2, Send, ThumbsDown, ThumbsUp, X,
} from "lucide-react";

/*
 * Twiga support widget.
 *
 * Built on the project's own design language rather than a private palette:
 *   .card    -> bg-white rounded-2xl border-gray-200 shadow-card
 *   .btn     -> rounded-lg px-4 py-2 text-sm font-medium
 *   brand    -> #02665e (bg-brand / text-brand / border-brand)
 *   surface  -> #fafcfc
 * Earlier revisions of this file invented their own ink and accent colours,
 * which is why the widget never sat properly next to the rest of the product.
 *
 * The panel itself is a dark surface so it reads as a layer above whatever
 * page it opens on. It has two moods: teal-black with emerald accents while
 * Twiga is answering, warm amber-black once NoLSAF Support has the chat (see
 * `theme` in the component). The launcher
 * keeps brand green so it is findable on light pages.
 *
 * Preflight is disabled in this project, so every button carries an explicit
 * background and border, and every border is declared `border-solid`. Without
 * those, buttons keep browser chrome and borders do not draw.
 *
 * Behaviour notes, all deliberate reversals of how this used to work:
 *   - The panel closes itself after 30 seconds unused, but never wipes the
 *     transcript, and never while the visitor is pointing at it, typing, tagging,
 *     or waiting on a reply. Agent replies still reach a closed panel through
 *     the badge, preview card, chime and tab title.
 *   - The panel is anchored, not draggable.
 *   - Messages are grouped, so a three-part answer is not three avatars.
 *   - `links` and `followUps` from the API are rendered. The old UI discarded
 *     both, which is why answers felt like dead ends.
 */

const API_BASE_URL = "";
const BRAND_MARK = "/assets/NoLS2025-04.png";

/**
 * The NoLSAF mark, served straight from /public.
 *
 * A plain img rather than next/image on purpose: this is a decorative 18 to
 * 28 pixel avatar, so the optimizer saves nothing, and routing it through
 * /_next/image adds a request that can fail independently of the asset itself.
 * A static file reference cannot break that way.
 */
const BrandMark = ({ className = "" }: { className?: string }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={BRAND_MARK} alt="" aria-hidden className={`object-contain ${className}`} />
);

interface MessageLink {
  label: string;
  href: string;
}

interface Message {
  id: string | number;
  /** "agent" is a person from the support team, not Twiga. */
  role: "user" | "assistant" | "agent";
  content: string;
  timestamp: Date | string;
  links?: MessageLink[];
  followUps?: string[];
  reaction?: "like" | "dislike" | null;
  /** Twiga asked an anonymous visitor to sign in before a person can join. */
  signInRequired?: boolean;
}

type SupportedLanguage = "en" | "sw" | "es" | "fr" | "pt" | "ar" | "zh";

const LANGUAGES: { code: SupportedLanguage; name: string }[] = [
  { code: "en", name: "English" },
  { code: "sw", name: "Kiswahili" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "pt", name: "Português" },
  { code: "ar", name: "العربية" },
  { code: "zh", name: "中文" },
];

/* ── @ mentions ───────────────────────────────────────────────────────────
 * Typing @ opens a picker of approved properties and regions. The textarea
 * shows a readable "@Sea Breeze Villa"; on send each picked label is swapped
 * for the token the API validates and stores (see lib/twigaMentions.tsx).
 * ──────────────────────────────────────────────────────────────────────── */

const MAX_MENTIONS = 3;

interface PickedMention {
  label: string;
  token: string;
}

interface MentionOption {
  key: string;
  kind: "region" | "property";
  label: string;
  detail: string;
  token: string;
  thumbnail?: string | null;
  here?: boolean;
}

function tokenLabel(value: string): string {
  return value.replace(/[[\]()\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function propertyOption(p: {
  title: string;
  type?: string;
  place?: string;
  slug: string;
  thumbnail?: string | null;
  here?: boolean;
}): MentionOption {
  const kind = String(p.type || "").replace(/_/g, " ").toLowerCase();
  return {
    key: `property-${p.slug}`,
    kind: "property",
    label: String(p.title),
    detail: [kind ? kind.charAt(0).toUpperCase() + kind.slice(1) : null, p.place].filter(Boolean).join(" · "),
    token: `@[${tokenLabel(String(p.title))}](property:${p.slug})`,
    thumbnail: p.thumbnail ?? null,
    here: Boolean(p.here),
  };
}

/**
 * The @ query the caret is currently inside, if any. The @ must start the text
 * or follow whitespace, so an email address never opens the picker. Up to three
 * words are allowed ("@dar es salaam"); a trailing space closes it.
 */
function findMentionQuery(value: string, caret: number): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = before.match(/(^|\s)@([^\s@[\]()]{0,30}(?: [^\s@[\]()]{1,30}){0,2})$/);
  if (!match) return null;
  const query = match[2];
  return { start: caret - query.length - 1, query };
}

/** Replace each picked "@Label" in the text with its token, first occurrence each. */
function encodeMentions(text: string, picked: PickedMention[]): string {
  let out = text;
  let from = 0;
  for (const mention of picked) {
    const needle = `@${mention.label}`;
    const at = out.indexOf(needle, from);
    if (at < 0) continue;
    const after = out.charAt(at + needle.length);
    if (after && /[\p{L}\p{N}]/u.test(after)) continue;
    out = out.slice(0, at) + mention.token + out.slice(at + needle.length);
    from = at + mention.token.length;
  }
  return out;
}

/** Conversation lifecycle, mirrored from apps/api/src/lib/twiga/handoff.ts. */
type ConversationStatus = "BOT" | "AWAITING_AGENT" | "AGENT_ACTIVE" | "RESOLVED";

function isWithHuman(status: ConversationStatus): boolean {
  return status === "AWAITING_AGENT" || status === "AGENT_ACTIVE";
}

const AGENT_POLL_INTERVAL_MS = 8_000;

/** Unused this long, the open panel closes. The conversation is kept. */
const AUTO_CLOSE_MS = 30_000;

/**
 * Two soft rising notes, synthesised so there is no audio file to ship or
 * fail to load. Browsers block audio until the page has had a user gesture;
 * asking for a person is one, so the chime is allowed by the time it matters.
 */
function playChime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const start = ctx.currentTime;
    [880, 1318.5].forEach((frequency, i) => {
      const at = start + i * 0.13;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.16, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.38);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.4);
    });
    window.setTimeout(() => void ctx.close(), 900);
  } catch {
    // Audio is a nicety; never let it break the conversation.
  }
}

/** Shown on an empty conversation instead of a wall of text in a bubble. */
const STARTERS = [
  "How do I book a property?",
  "Where is my booking?",
  "What payment methods do you accept?",
  "Tell me about Zanzibar",
];

/**
 * Openers that match the page the visitor is standing on.
 *
 * A generic "How do I book a property?" is noise to someone already staring at
 * a checkout page. First matching rule wins; anything unmatched falls back to
 * STARTERS above.
 */
const CONTEXT_STARTERS: Array<{ test: RegExp; context: string; starters: string[] }> = [
  { test: /^\/(properties|property)\//, context: "Viewing a property", starters: ["Is this property available on my dates?", "What is the cancellation policy?", "How do I pay for this booking?"] },
  { test: /^\/(properties|search)/, context: "Browsing stays", starters: ["Help me choose a place to stay", "Which areas are best for families?", "How do prices work here?"] },
  { test: /^\/(checkout|book|booking)/, context: "Booking in progress", starters: ["What happens after I pay?", "Which payment methods can I use?", "Can I change my dates later?"] },
  { test: /^\/(tours|tour)/, context: "Looking at tours", starters: ["What is included in this tour?", "How do I join a tour?", "Can I cancel a tour booking?"] },
  { test: /^\/(transport|drivers?)/, context: "Transport", starters: ["How do airport pickups work?", "How much is transport in Dar es Salaam?", "Can I book a driver for a full day?"] },
  { test: /^\/account\/bookings/, context: "Your bookings", starters: ["Where is my booking?", "How do I cancel this booking?", "I need my check-in code"] },
  { test: /^\/account/, context: "Your account", starters: ["How do I update my details?", "How do refunds reach me?", "I cannot sign in"] },
  { test: /^\/(nrms|owner)/, context: "For property owners", starters: ["What does NRMS cost?", "How do I list my property?", "How do owner payouts work?"] },
  { test: /^\/(help|support|faq)/, context: "Help centre", starters: ["I need help with a payment", "How do cancellations work?", "Talk to a person"] },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Message body
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Render a reply with its structure intact.
 *
 * Answers are written as a lead, a list, then a closing line. Flattening that
 * into one pre-wrapped paragraph made every reply a block you had to read end
 * to end to find the one line you wanted.
 */
function MessageBody({ content, tone }: { content: string; tone: MentionTone }) {
  const text = typeof content === "string" ? content : "";
  // Tagged properties and regions render as linked chips inside the prose.
  const rich = (value: string) => renderWithMentions(value, tone);
  const blocks = text.split(/\n{2,}/).filter((b) => b.trim().length > 0);

  // Never render an empty bubble. A message that looks blank is worse than one
  // formatted plainly, and the reader cannot tell it is a bug.
  if (blocks.length === 0) {
    return <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{rich(text)}</p>;
  }

  return (
    <div className="space-y-2.5">
      {blocks.map((block, bi) => {
        const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
        // Measure the visible text, not the token syntax behind a chip.
        const isList = lines.length > 1 && lines.every((l) => stripMentions(l).length <= 90);

        if (!isList) {
          return (
            <p key={bi} className="text-[13.5px] leading-relaxed">
              {rich(lines.join(" "))}
            </p>
          );
        }

        const heading = /:$/.test(lines[0]) ? lines[0] : null;
        const items = heading ? lines.slice(1) : lines;

        // Steps are already numbered in the copy ("1. Register with the driver
        // role"). Adding a bullet to those gave every step two markers, so an
        // ordered list keeps its own numbers and drops the dot.
        const ordered = items.length > 1 && items.every((l) => /^\d+[.)]\s+/.test(l));

        return (
          <div key={bi} className="space-y-1.5">
            {heading && <p className="text-xs font-semibold leading-snug opacity-75">{rich(heading)}</p>}
            {ordered ? (
              <ol className="space-y-1.5">
                {items.map((line, li) => {
                  const [, number, rest] = line.match(/^(\d+)[.)]\s+([\s\S]*)$/) ?? [];
                  return (
                    <li key={li} className="flex gap-2.5 text-[13.5px] leading-snug">
                      <span
                        aria-hidden
                        className="mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full bg-current text-[10px] font-semibold opacity-90"
                      >
                        <span className="text-[#0c1614]">{number}</span>
                      </span>
                      <span className="min-w-0 pt-px">{rich(rest ?? "")}</span>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <ul className="space-y-1">
                {items.map((line, li) => (
                  <li key={li} className="flex gap-2 text-[13.5px] leading-snug">
                    <span
                      aria-hidden
                      className="mt-[7px] h-1 w-1 flex-shrink-0 rounded-full bg-current opacity-40"
                    />
                    <span className="min-w-0">{rich(line.replace(/^[-•]\s*/, ""))}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
 * Widget
 * ──────────────────────────────────────────────────────────────────────── */

interface FloatingChatWidgetProps {
  hiddenRoutes?: string[];
  position?: "bottom-right" | "bottom-left";
  /** Extra bottom offset applied on mobile so the launcher clears a mobile nav bar. */
  mobileBottomOffset?: number;
}

export default function FloatingChatWidget({
  hiddenRoutes: _hiddenRoutes = [],
  position = "bottom-right",
  mobileBottomOffset = 0,
}: FloatingChatWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  // Stored for the next visit only. The server derives the real session from
  // the token or httpOnly cookie and ignores any id the client sends.
  const [, setSessionId] = useState<string | null>(null);
  const [language, setLanguage] = useState<SupportedLanguage>("en");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [status, setStatus] = useState<ConversationStatus>("BOT");
  const [unreadCount, setUnreadCount] = useState(0);
  /** Wide mode: a long itinerary or policy answer is unreadable in a 392px column. */
  const [isExpanded, setIsExpanded] = useState(false);
  const [copiedId, setCopiedId] = useState<string | number | null>(null);
  const [showJump, setShowJump] = useState(false);
  /** An admin console is connected: the visitor's messages show two ticks. */
  const [agentOnline, setAgentOnline] = useState(false);
  /** When an agent last opened this chat; older visitor messages read as seen. */
  const [agentLastReadAt, setAgentLastReadAt] = useState<number>(0);
  const [historyReady, setHistoryReady] = useState(false);
  /** Latest agent reply, previewed over the launcher while the panel is closed. */
  const [preview, setPreview] = useState<string | null>(null);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<{ start: number; query: string } | null>(null);
  const [mentionOptions, setMentionOptions] = useState<MentionOption[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOpenRef = useRef(false);
  const mentionCacheRef = useRef(new Map<string, MentionOption[]>());
  const pathname = usePathname();

  const endRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const revealRef = useRef<NodeJS.Timeout | null>(null);
  const initialisedRef = useRef(false);
  /** Highest NUMERIC message id rendered. Local ids are strings so they cannot poison it. */
  const lastSeenIdRef = useRef(0);
  /** Was the reader at the bottom as of the last scroll event? */
  const atBottomRef = useRef(true);

  const hasConversation = messages.length > 0;

  /** What this visitor is looking at, used for the opening suggestions. */
  const pageContext = useMemo(() => {
    const path = pathname || "/";
    const match = CONTEXT_STARTERS.find((entry) => entry.test.test(path));
    return match ? { label: match.context, starters: match.starters } : { label: null as string | null, starters: STARTERS };
  }, [pathname]);

  // Ctrl/Cmd + / opens the widget from anywhere, Escape closes it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "/") {
        event.preventDefault();
        setIsOpen((open) => !open);
        setIsMinimized(false);
        setUnreadCount(0);
      }
      if (event.key === "Escape" && isOpen && !mentionOpenRef.current) setIsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  /* ── auto close ──────────────────────────────────────────────────────────
   * Anything the visitor does inside the panel resets the clock. It never
   * closes while the pointer is over it (they are reading), while there is a
   * draft or the @ picker is open, or while a reply is on its way.
   * ──────────────────────────────────────────────────────────────────────── */
  const lastActivityRef = useRef(Date.now());
  const pointerInsideRef = useRef(false);
  const busyRef = useRef(false);
  const markActive = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  useEffect(() => {
    busyRef.current = isSending || isThinking;
  }, [isSending, isThinking]);

  // New messages count as activity: someone is talking to the visitor.
  useEffect(() => {
    markActive();
  }, [messages, markActive]);

  useEffect(() => {
    if (!isOpen) return;
    markActive();
    const timer = window.setInterval(() => {
      if (pointerInsideRef.current || busyRef.current || mentionOpenRef.current) return;
      if (inputRef.current?.value.trim()) return;
      if (Date.now() - lastActivityRef.current < AUTO_CLOSE_MS) return;
      setLanguageOpen(false);
      setIsOpen(false);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isOpen, markActive]);

  /**
   * Show a jump button instead of yanking the reader down mid-answer.
   *
   * The result is kept in a ref as well as state because the scroll effect has
   * to know where the reader was BEFORE a new message was committed. Measuring
   * after the commit counts the new bubble itself as distance from the bottom,
   * which made every single reply look like the reader had scrolled away.
   */
  const onTranscriptScroll = useCallback(() => {
    markActive();
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 160;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
  }, [markActive]);

  const copyAnswer = useCallback(async (id: string | number, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1600);
    } catch {
      // Clipboard can be blocked; silently leave the icon as it was.
    }
  }, []);

  useEffect(() => {
    if (!isOpen || isMinimized) return;
    // Only follow the conversation when the reader was already at the bottom.
    // Yanking the view down while somebody is re-reading an earlier answer is
    // the single most annoying thing a chat panel can do; the jump button
    // below tells them there is something new instead.
    if (!atBottomRef.current) {
      setShowJump(true);
      return;
    }
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    setShowJump(false);
  }, [messages, isThinking, isOpen, isMinimized]);

  /* ── attention ────────────────────────────────────────────────────────────
   * A visitor who asked for a person has usually wandered off to another tab
   * or closed the panel by the time an agent answers. Before this, the reply
   * only arrived if the panel happened to be open, and arrived silently. Now:
   *   - polling runs whenever the conversation is with a human, open or not
   *   - a short chime plays on every agent reply
   *   - closed panel: unread badge plus a preview card over the launcher
   *   - hidden tab: the tab title flashes and, if allowed, a browser
   *     notification is shown
   * ──────────────────────────────────────────────────────────────────────── */

  const isOpenRef = useRef(isOpen);
  const isMinimizedRef = useRef(isMinimized);
  const messagesRef = useRef<Message[]>([]);
  /** Highest agent message id already announced, so nothing chimes twice. */
  const announcedRef = useRef(0);
  const titleFlashRef = useRef<{ original: string; timer: number | null }>({ original: "", timer: null });

  useEffect(() => {
    isOpenRef.current = isOpen;
    isMinimizedRef.current = isMinimized;
  }, [isOpen, isMinimized]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) setNotifyPermission(Notification.permission);
  }, []);

  const stopTitleFlash = useCallback(() => {
    const flash = titleFlashRef.current;
    if (flash.timer === null) return;
    window.clearInterval(flash.timer);
    flash.timer = null;
    document.title = flash.original;
  }, []);

  const startTitleFlash = useCallback((label: string) => {
    const flash = titleFlashRef.current;
    if (flash.timer !== null) return;
    flash.original = document.title;
    let showing = false;
    flash.timer = window.setInterval(() => {
      showing = !showing;
      document.title = showing ? label : flash.original;
    }, 1200);
  }, []);

  useEffect(() => {
    const onReturn = () => {
      if (!document.hidden && isOpenRef.current && !isMinimizedRef.current) stopTitleFlash();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", onReturn);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", onReturn);
      stopTitleFlash();
    };
  }, [stopTitleFlash]);

  const announce = useCallback(
    (incoming: Message[]) => {
      const replies = incoming.filter(
        (m) => m.role === "agent" && typeof m.id === "number" && m.id > announcedRef.current
      );
      if (replies.length === 0) return;
      announcedRef.current = Math.max(...replies.map((m) => m.id as number));
      const latest = replies[replies.length - 1];

      playChime();

      const inView = isOpenRef.current && !isMinimizedRef.current && !document.hidden;
      if (inView) return;

      setUnreadCount((c) => c + replies.length);
      if (!isOpenRef.current || isMinimizedRef.current) setPreview(latest.content);

      if (document.hidden) {
        startTitleFlash("New reply from NoLSAF Support");
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            const note = new Notification("NoLSAF Support replied", {
              body: latest.content.slice(0, 140),
              icon: BRAND_MARK,
              tag: "twiga-agent-reply",
            });
            note.onclick = () => {
              window.focus();
              setIsOpen(true);
              setIsMinimized(false);
              note.close();
            };
          } catch {
            // Some browsers only allow notifications from a service worker.
          }
        }
      }
    },
    [startTitleFlash]
  );

  const enableNotifications = useCallback(async () => {
    if (!("Notification" in window)) return;
    try {
      setNotifyPermission(await Notification.requestPermission());
    } catch {
      // Permission prompts can be blocked outright; nothing to do.
    }
  }, []);

  // Reading the panel clears everything and records how far the visitor got,
  // so a reply that lands while they are on another page is still flagged.
  useEffect(() => {
    if (!isOpen || isMinimized) return;
    setUnreadCount(0);
    setPreview(null);
    stopTitleFlash();
    const top = messages.reduce((max, m) => (typeof m.id === "number" && m.id > max ? m.id : max), 0);
    if (top > 0) {
      try {
        localStorage.setItem("chatbot_seen_id", String(top));
      } catch {
        // Storage can be unavailable in private windows.
      }
    }
  }, [isOpen, isMinimized, messages, stopTitleFlash]);

  useEffect(() => {
    for (const m of messages) {
      if (typeof m.id === "number" && m.id > lastSeenIdRef.current) {
        lastSeenIdRef.current = m.id;
      }
    }
  }, [messages]);

  /* ── history ─────────────────────────────────────────────────────────── */

  const loadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    try {
      const stored = localStorage.getItem("chatbot_session_id") ?? "";
      const savedLang = localStorage.getItem("chatbot_language") as SupportedLanguage | null;
      if (savedLang) setLanguage(savedLang);

      const res = await fetch(
        `${API_BASE_URL}/api/chatbot/conversations/${encodeURIComponent(stored || "new")}`,
        { credentials: "include" }
      );
      const data = await res.json();

      const resolved = data?.conversation?.sessionId ?? data?.sessionId;
      if (resolved) {
        setSessionId(resolved);
        localStorage.setItem("chatbot_session_id", resolved);
      }
      if (data?.conversation?.status) setStatus(data.conversation.status);
      if (data?.conversation?.language) setLanguage(data.conversation.language);
      if (typeof data?.agentOnline === "boolean") setAgentOnline(data.agentOnline);

      if (Array.isArray(data?.messages) && data.messages.length > 0) {
        const mapped: Message[] = data.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp),
        }));
        setMessages(mapped);

        // Anything already stored counts as announced, except agent replies
        // that arrived after the visitor last had the panel open.
        const numericIds = mapped.map((m) => m.id).filter((id): id is number => typeof id === "number");
        const newest = numericIds.length ? Math.max(...numericIds) : 0;
        let seen = 0;
        try {
          seen = Number(localStorage.getItem("chatbot_seen_id") || 0);
        } catch {
          seen = 0;
        }
        if (!isOpenRef.current && seen > 0 && newest > seen) {
          announcedRef.current = seen;
          announce(mapped);
        } else {
          announcedRef.current = newest;
        }
      }
    } catch {
      // An unreachable history endpoint should not stop a new conversation.
    } finally {
      setIsLoadingHistory(false);
      setHistoryReady(true);
    }
  }, [announce]);

  useEffect(() => {
    if (isOpen && !initialisedRef.current) {
      initialisedRef.current = true;
      void loadHistory();
    }
  }, [isOpen, loadHistory]);

  // Back from signing in. The link Twiga gave carried ?twiga=handoff: move the
  // anonymous transcript into the account, hand it to the team, and reopen the
  // chat exactly where the visitor left it. The marker is removed first so a
  // refresh or a shared link never repeats the hand-off.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("twiga") !== "handoff") return;
    url.searchParams.delete("twiga");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/chatbot/resume-after-sign-in`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ handoff: true }),
        });
        // 401: they came back without finishing sign-in. Leave the chat as it was.
        if (!res.ok) return;
        const data = await res.json();
        if (!data?.success) return;
        try {
          if (data.sessionId) localStorage.setItem("chatbot_session_id", data.sessionId);
          if (data.status) localStorage.setItem("chatbot_status", data.status);
        } catch {
          // Storage can be unavailable in private windows.
        }
        if (data.status) setStatus(data.status as ConversationStatus);
        initialisedRef.current = true;
        await loadHistory();
        setIsOpen(true);
        setIsMinimized(false);
      } catch {
        // The visitor can still open the chat and ask again.
      }
    })();
  }, [loadHistory]);

  // A visitor handed to support who navigates to another page must keep
  // receiving replies, so resume the conversation without waiting for a click.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("chatbot_status");
    } catch {
      stored = null;
    }
    if ((stored === "AWAITING_AGENT" || stored === "AGENT_ACTIVE") && !initialisedRef.current) {
      initialisedRef.current = true;
      void loadHistory();
    }
  }, [loadHistory]);

  useEffect(() => {
    if (!historyReady) return;
    try {
      localStorage.setItem("chatbot_status", status);
    } catch {
      // Storage can be unavailable in private windows.
    }
  }, [status, historyReady]);

  /* ── polling for a human reply ───────────────────────────────────────── */

  useEffect(() => {
    if (!historyReady || !isWithHuman(status)) return;
    let cancelled = false;

    const poll = async () => {
      try {
        // Only claim "seen" when the chat is actually on screen.
        const onScreen = isOpenRef.current && !isMinimizedRef.current && !document.hidden;
        const res = await fetch(`${API_BASE_URL}/api/chatbot/updates?after=${lastSeenIdRef.current}${onScreen ? "&seen=1" : ""}`, {
          credentials: "include",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.success) return;

        if (data.status) setStatus(data.status as ConversationStatus);
        if (typeof data.agentOnline === "boolean") setAgentOnline(data.agentOnline);
        if (data.agentLastReadAt) setAgentLastReadAt(new Date(data.agentLastReadAt).getTime() || 0);
        if (Array.isArray(data.messages) && data.messages.length > 0) {
          const known = new Set(messagesRef.current.map((m) => m.id));
          const fresh: Message[] = data.messages
            .filter((m: any) => !known.has(m.id))
            .map((m: any) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: new Date(m.timestamp),
            }));
          if (fresh.length === 0) return;
          messagesRef.current = [...messagesRef.current, ...fresh];
          setMessages((prev) => {
            const have = new Set(prev.map((m) => m.id));
            const add = fresh.filter((m) => !have.has(m.id));
            return add.length ? [...prev, ...add] : prev;
          });
          announce(fresh);
        }
      } catch {
        // The next tick retries; a failed poll is not worth surfacing.
      }
    };

    const id = setInterval(poll, AGENT_POLL_INTERVAL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [historyReady, status, announce]);

  useEffect(
    () => () => {
      if (revealRef.current) clearTimeout(revealRef.current);
    },
    []
  );

  /* ── actions ─────────────────────────────────────────────────────────── */

  const changeLanguage = useCallback(async (next: SupportedLanguage) => {
    setLanguage(next);
    setLanguageOpen(false);
    localStorage.setItem("chatbot_language", next);
    try {
      await fetch(`${API_BASE_URL}/api/chatbot/set-language`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ language: next }),
      });
    } catch {
      // Cosmetic; the next message carries the language anyway.
    }
  }, []);

  /**
   * Take the conversation back from the queue.
   *
   * Asking for a person silences Twiga, which is right while an agent is
   * handling it. If nobody has picked it up, the visitor is otherwise stuck
   * with "support has this one" and cannot get an answer to anything.
   */
  const cancelHandoff = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/chatbot/cancel-handoff`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      const data = await res.json();
      if (!data?.success) return;
      setStatus((data.status as ConversationStatus) ?? "BOT");
      setMessages((prev) => [
        ...prev,
        {
          id: `local-resumed-${Date.now()}`,
          role: "assistant",
          content: "No problem, I am back. Ask me anything, and say the word if you still want a person.",
          timestamp: new Date(),
        },
      ]);
    } catch {
      // Leave the banner as it is; the visitor can try again.
    }
  }, []);

  const send = useCallback(
    async (raw: string) => {
      const body = encodeMentions(raw.trim(), picked);
      if (!body || isSending) return;
      setPicked([]);
      setMentionQuery(null);

      // String id on purpose: the poll cursor tracks the highest NUMERIC id, so
      // a locally-invented numeric id would push it past every real database id
      // and agent replies would never be fetched again.
      // Sending is an explicit act, so always follow your own message down even
      // if you were reading further up a moment ago.
      atBottomRef.current = true;
      setShowJump(false);

      const localId = `local-user-${Date.now()}`;
      setMessages((prev) => [...prev, { id: localId, role: "user", content: body, timestamp: new Date() }]);
      setInput("");
      if (inputRef.current) inputRef.current.style.height = "auto";
      setIsSending(true);

      try {
        const res = await fetch(`${API_BASE_URL}/api/chatbot/message`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          // The page is only used as the return path if Twiga has to ask the
          // visitor to sign in before a person can join.
          body: JSON.stringify({
            message: body,
            language,
            page: `${window.location.pathname}${window.location.search}`,
          }),
        });
        const data = await res.json();
        if (!data?.success) throw new Error(data?.error || "Failed to send");

        if (data.sessionId) {
          setSessionId(data.sessionId);
          localStorage.setItem("chatbot_session_id", data.sessionId);
        }
        if (data.status) setStatus(data.status as ConversationStatus);
        if (typeof data.agentOnline === "boolean") setAgentOnline(data.agentOnline);

        // Swap the optimistic copy for the stored one so it carries its real id,
        // otherwise the poll would later fetch it again as a duplicate.
        const stored = data.messages?.find((m: any) => m.role === "user");
        if (stored) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === localId
                ? { ...m, id: stored.id, content: stored.content ?? m.content, timestamp: new Date(stored.timestamp) }
                : m
            )
          );
        }

        const reply = data.messages?.find((m: any) => m.role === "assistant");
        if (!reply) return;

        // A short beat on the indicator, then the whole reply. Typing it out
        // character by character over a fixed window meant hundreds of
        // characters per tick on a long answer, which reads as a jumpy dump.
        setIsThinking(true);
        if (revealRef.current) clearTimeout(revealRef.current);
        const beat = Math.min(900, 280 + String(reply.content ?? "").length * 1.1);

        revealRef.current = setTimeout(() => {
          setIsThinking(false);
          setMessages((prev) =>
            prev.some((m) => m.id === reply.id)
              ? prev
              : [
                  ...prev,
                  {
                    id: reply.id,
                    role: "assistant",
                    content: reply.content,
                    timestamp: new Date(reply.timestamp),
                    links: Array.isArray(reply.links) ? reply.links : undefined,
                    followUps: Array.isArray(reply.followUps) ? reply.followUps : undefined,
                    signInRequired: Boolean(data.signInRequired),
                  },
                ]
          );
        }, beat);
      } catch {
        setIsThinking(false);
        setMessages((prev) => [
          ...prev.map((m) => (m.id === localId ? { ...m, id: `local-failed-${Date.now()}` } : m)),
          {
            id: `local-error-${Date.now()}`,
            role: "assistant",
            content: "Something went wrong sending that. Please try again.",
            timestamp: new Date(),
          },
        ]);
      } finally {
        setIsSending(false);
      }
    },
    [isSending, language, picked]
  );

  const handleInput = (value: string, caret?: number) => {
    setInput(value);
    // A tag whose text was edited away is no longer a tag.
    setPicked((prev) => prev.filter((m) => value.includes(`@${m.label}`)));
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
    syncMentionQuery(value, caret ?? el.selectionStart ?? value.length);
  };

  /** Open, update or close the picker from the caret position. */
  const syncMentionQuery = (value: string, caret: number) => {
    const found = findMentionQuery(value, caret);
    // An @ that already begins a picked tag is finished, even when the words
    // typed after it would otherwise read as a longer query.
    const insidePicked = found && picked.some((m) => value.startsWith(`@${m.label}`, found.start));
    const next = found && !insidePicked ? found : null;
    setMentionQuery((prev) => (prev?.start === next?.start && prev?.query === next?.query ? prev : next));
    if (!next) setMentionIndex(0);
  };

  const mentionContext = useMemo(() => {
    const match = (pathname || "").match(/^\/public\/properties\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  }, [pathname]);

  const mentionLimitReached = picked.length >= MAX_MENTIONS;

  useEffect(() => {
    mentionOpenRef.current = mentionQuery !== null;
  }, [mentionQuery]);

  // Debounced search. Results are cached per query for the life of the panel,
  // so backspacing through a word does not refetch it.
  useEffect(() => {
    if (!mentionQuery || mentionLimitReached) return;
    const cacheKey = `${mentionContext}::${mentionQuery.query.toLowerCase()}`;
    const cached = mentionCacheRef.current.get(cacheKey);
    if (cached) {
      setMentionOptions(cached);
      setMentionLoading(false);
      return;
    }
    setMentionLoading(true);
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: mentionQuery.query });
        if (mentionContext) params.set("context", mentionContext);
        const res = await fetch(`${API_BASE_URL}/api/chatbot/mentions?${params}`, {
          credentials: "include",
          signal: controller.signal,
        });
        const data = await res.json();
        if (!data?.success) throw new Error("mentions failed");
        const options: MentionOption[] = [
          ...(data.properties ?? [])
            .filter((p: any) => p.here)
            .map((p: any) => propertyOption(p)),
          ...(data.regions ?? []).map((r: any) => ({
            key: `region-${r.name}`,
            kind: "region" as const,
            label: String(r.name),
            detail: `${r.count} ${r.count === 1 ? "stay" : "stays"}`,
            token: `@[${tokenLabel(String(r.name))}](region:${encodeURIComponent(String(r.name))})`,
          })),
          ...(data.properties ?? [])
            .filter((p: any) => !p.here)
            .map((p: any) => propertyOption(p)),
        ];
        mentionCacheRef.current.set(cacheKey, options);
        setMentionOptions(options);
        setMentionIndex(0);
      } catch (error) {
        if ((error as Error)?.name !== "AbortError") setMentionOptions([]);
      } finally {
        if (!controller.signal.aborted) setMentionLoading(false);
      }
    }, 160);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [mentionQuery, mentionContext, mentionLimitReached]);

  const chooseMention = (option: MentionOption) => {
    if (!mentionQuery) return;
    const el = inputRef.current;
    const insert = `@${option.label} `;
    const end = mentionQuery.start + 1 + mentionQuery.query.length;
    const next = input.slice(0, mentionQuery.start) + insert + input.slice(end);
    const caret = mentionQuery.start + insert.length;
    setPicked((prev) => [...prev.filter((m) => m.label !== option.label), { label: option.label, token: option.token }]);
    setMentionQuery(null);
    setInput(next);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
    });
  };

  /** The @ button: drop an @ at the caret and open the picker, for phones and the curious. */
  const startMention = () => {
    const el = inputRef.current;
    const caret = el?.selectionStart ?? input.length;
    const needsSpace = caret > 0 && !/\s/.test(input.charAt(caret - 1));
    const insert = needsSpace ? " @" : "@";
    const next = input.slice(0, caret) + insert + input.slice(caret);
    const nextCaret = caret + insert.length;
    setInput(next);
    setMentionQuery({ start: nextCaret - 1, query: "" });
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const onComposerKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const pickerOpen = mentionQuery !== null && !mentionLimitReached;

    if (pickerOpen && mentionOptions.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const step = e.key === "ArrowDown" ? 1 : -1;
        setMentionIndex((i) => (i + step + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        chooseMention(mentionOptions[Math.min(mentionIndex, mentionOptions.length - 1)]);
        return;
      }
    }
    if (mentionQuery !== null && e.key === "Escape") {
      e.preventDefault();
      setMentionQuery(null);
      return;
    }

    // Backspace straight after a tag removes the whole tag, like a chip.
    if (e.key === "Backspace") {
      const el = e.currentTarget;
      if (el.selectionStart === el.selectionEnd) {
        const caret = el.selectionStart;
        const before = input.slice(0, caret);
        const hit = picked.find((m) => before.endsWith(`@${m.label}`));
        if (hit) {
          e.preventDefault();
          const start = caret - hit.label.length - 1;
          const next = input.slice(0, start) + input.slice(caret);
          setPicked((prev) => prev.filter((m) => m !== hit));
          setInput(next);
          requestAnimationFrame(() => el.setSelectionRange(start, start));
          return;
        }
      }
    }

    // Enter sends, Shift+Enter makes a new line.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  };

  const formatTime = (ts: Date | string) => {
    const d = typeof ts === "string" ? new Date(ts) : ts;
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  /** Group consecutive messages from one sender so avatars do not repeat. */
  const grouped = useMemo(
    () =>
      messages.map((message, i) => ({
        message,
        firstOfGroup: i === 0 || messages[i - 1].role !== message.role,
        lastOfGroup: i === messages.length - 1 || messages[i + 1].role !== message.role,
      })),
    [messages]
  );

  const firstAgentIndex = messages.findIndex((m) => m.role === "agent");
  /** Any visitor message older than the latest agent reply has been read by the team. */
  const latestAgentReplyId = messages.reduce(
    (max, m) => (m.role === "agent" && typeof m.id === "number" && m.id > max ? m.id : max),
    0
  );
  const lastMessage = messages[messages.length - 1];
  const suggestions =
    !isThinking && !isSending && lastMessage?.role === "assistant" && lastMessage.followUps?.length
      ? lastMessage.followUps
      : [];

  const anchor = position === "bottom-left" ? { left: "20px" } : { right: "20px" };

  /**
   * Two surfaces, so nobody has to read a label to know who is answering.
   * Twiga is cool teal-black with emerald accents. The moment the chat is with
   * NoLSAF Support (queued or live) the whole panel warms to a dark amber and
   * the actions turn amber. Twiga's earlier bubbles keep their teal card, so
   * the hand-over point is visible in the transcript as well.
   */
  const theme = isWithHuman(status)
    ? {
        panel: "bg-[#15110b] border-amber-300/15",
        header: "bg-[#1f180e] border-amber-300/10",
        ring: "ring-[#1f180e]",
        glow: "radial-gradient(120% 140% at 0% 0%, rgba(245,158,11,0.30) 0%, rgba(245,158,11,0) 62%)",
        surface: "bg-[#15110b]",
        composer: "bg-[#1a150d] border-amber-300/10",
        field: "border-amber-200/10 bg-amber-100/[0.04] focus-within:border-amber-400/50 focus-within:ring-amber-400/10",
        caret: "caret-amber-400",
        send: "bg-amber-400 text-amber-950 hover:bg-amber-300",
        spinner: "border-amber-950/30 border-t-amber-950",
        jump: "bg-[#2a2115] hover:border-amber-400/40 hover:text-amber-200",
        picker: "bg-[#1d170e] border-amber-300/15",
        pickerActive: "bg-amber-400/10",
        pickerIcon: "text-amber-300 hover:text-amber-200",
      }
    : {
        panel: "bg-[#0c1614] border-white/10",
        header: "bg-[#0f201d] border-white/[0.06]",
        ring: "ring-[#0f201d]",
        glow: "radial-gradient(120% 140% at 0% 0%, rgba(2,102,94,0.55) 0%, rgba(2,102,94,0) 60%)",
        surface: "bg-[#0c1614]",
        composer: "bg-[#0f1c1a] border-white/[0.06]",
        field: "border-white/10 bg-white/[0.04] focus-within:border-emerald-400/50 focus-within:ring-emerald-400/10",
        caret: "caret-emerald-400",
        send: "bg-emerald-400 text-[#06231f] hover:bg-emerald-300",
        spinner: "border-[#06231f]/30 border-t-[#06231f]",
        jump: "bg-[#1a2a27] hover:border-emerald-400/40 hover:text-emerald-300",
        picker: "bg-[#101d1b] border-white/10",
        pickerActive: "bg-emerald-400/10",
        pickerIcon: "text-emerald-300 hover:text-emerald-200",
      };

  return (
    <div className="fixed z-50">
      {mobileBottomOffset > 0 && (
        <style>{`@media (max-width:767px){.twiga-launcher{bottom:${20 + mobileBottomOffset}px !important}.twiga-panel{bottom:${20 + mobileBottomOffset}px !important}.twiga-preview{bottom:${88 + mobileBottomOffset}px !important}}`}</style>
      )}

      {isOpen && (
        <div
          className={`twiga-panel animate-fadeIn fixed flex flex-col overflow-hidden rounded-2xl border border-solid shadow-[0_24px_60px_-12px_rgba(0,0,0,0.6)] transition-colors duration-500 ${theme.panel}`}
          style={{
            ...anchor,
            bottom: "20px",
            width: isExpanded ? "min(calc(100vw - 32px), 560px)" : "min(calc(100vw - 32px), 392px)",
            height: isMinimized ? "auto" : isExpanded ? "min(760px, calc(100vh - 60px))" : "min(620px, calc(100vh - 120px))",
            transition: "width 180ms ease, height 180ms ease",
          }}
          onPointerEnter={() => {
            pointerInsideRef.current = true;
            markActive();
          }}
          onPointerLeave={() => {
            pointerInsideRef.current = false;
            markActive();
          }}
          onPointerDown={markActive}
          onKeyDown={markActive}
          onWheel={markActive}
          onTouchStart={markActive}
          onScroll={markActive}
        >
          {/* ── Header ──
              Says who is on the other end right now. Once an agent takes the
              chat, the title becomes NoLSAF Support and a second avatar joins
              Twiga's, so the visitor can see a person arrived without reading
              a banner that repeats the same sentence. */}
          <div
            className={`flex-shrink-0 border-0 border-b border-solid px-3.5 py-3 transition-colors duration-500 ${theme.header}`}
            style={{ backgroundImage: theme.glow }}
          >
            <div className="flex items-center gap-3">
              <div className="relative flex flex-shrink-0 items-center">
                <span className={`flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white ring-2 ${theme.ring}`}>
                  <BrandMark className="h-6 w-6" />
                </span>
                {isWithHuman(status) && (
                  <span
                    className={`-ml-2.5 flex h-9 w-9 items-center justify-center rounded-full ring-2 ${theme.ring} ${
                      status === "AGENT_ACTIVE" ? "bg-amber-400 text-amber-950" : "bg-white/10 text-white/80"
                    }`}
                  >
                    <Headphones className="h-4 w-4" />
                  </span>
                )}
                <span
                  className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ${theme.ring} ${
                    status === "AWAITING_AGENT" ? "animate-pulse bg-amber-300" : "bg-emerald-400"
                  }`}
                />
              </div>

              {/* One word. The avatars and the dot already say who is here and
                  whether they are live; a sentence under it was just noise. */}
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <p
                  className="truncate text-[15px] font-semibold leading-none text-white"
                  title={
                    status === "AWAITING_AGENT"
                      ? "Waiting for the support team"
                      : status === "AGENT_ACTIVE"
                        ? "NoLSAF Support is in this chat"
                        : "Twiga replies instantly"
                  }
                >
                  {isWithHuman(status) ? "Support" : "Twiga"}
                </p>
                {status === "AWAITING_AGENT" && (
                  <span className="rounded-full bg-amber-400/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-amber-200">
                    Queued
                  </span>
                )}
                {isMinimized && unreadCount > 0 && (
                  <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold leading-none text-amber-950">
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </span>
                )}
              </div>

              <div className="flex flex-shrink-0 items-center">
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setLanguageOpen((o) => !o)}
                    aria-label={`Change language (${language.toUpperCase()})`}
                    title={`Language: ${LANGUAGES.find((l) => l.code === language)?.name ?? language}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-white/60 transition hover:bg-white/10 hover:text-white"
                  >
                    <Globe className="h-3.5 w-3.5" />
                  </button>
                  {languageOpen && (
                    <div className="absolute right-0 top-9 z-10 w-40 overflow-hidden rounded-xl border border-solid border-white/10 bg-[#15211f] py-1 shadow-2xl">
                      {LANGUAGES.map((l) => (
                        <button
                          key={l.code}
                          type="button"
                          onClick={() => changeLanguage(l.code)}
                          className="flex w-full items-center justify-between border-0 bg-transparent px-3 py-2 text-left text-[13px] text-white/80 transition hover:bg-white/[0.06] hover:text-white"
                        >
                          {l.name}
                          {language === l.code && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {!isMinimized && (
                  <button
                    type="button"
                    onClick={() => setIsExpanded((e) => !e)}
                    aria-label={isExpanded ? "Narrow the chat" : "Widen the chat"}
                    title={isExpanded ? "Narrow" : "Widen"}
                    className="hidden h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-white/60 transition hover:bg-white/10 hover:text-white sm:inline-flex"
                  >
                    {isExpanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setIsMinimized((m) => !m)}
                  aria-label={isMinimized ? "Show conversation" : "Hide conversation"}
                  title={isMinimized ? "Show" : "Hide"}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <ChevronDown className={`h-4 w-4 transition ${isMinimized ? "rotate-180" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close chat"
                  title="Close"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border-0 bg-transparent text-white/60 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* ── Queue strip ──
                  Only while waiting. Once an agent is on, the header already
                  says so and a second banner is noise. */}
              {status === "AWAITING_AGENT" && (
                <div className="flex flex-shrink-0 items-center gap-2.5 border-0 border-b border-solid border-amber-400/15 bg-amber-400/[0.08] px-3.5 py-2">
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-400" />
                  </span>
                  <p className="min-w-0 flex-1 text-[12px] leading-snug text-amber-100/90">
                    <span className="font-semibold">You are in the queue.</span>{" "}
                    {notifyPermission === "granted" ? "We will notify you when they reply." : "We will chime when they reply."}
                  </p>
                  {notifyPermission === "default" && (
                    <button
                      type="button"
                      onClick={() => void enableNotifications()}
                      title="Get a browser notification when an agent replies"
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-full border-0 bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-amber-950 transition hover:bg-amber-300"
                    >
                      <Bell className="h-3 w-3" />
                      Notify me
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={cancelHandoff}
                    className="flex-shrink-0 rounded-full border border-solid border-amber-300/30 bg-transparent px-2.5 py-1 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-400/10"
                  >
                    Ask Twiga
                  </button>
                </div>
              )}

              {/* ── Transcript ── */}
              <div className="relative flex min-h-0 flex-1 flex-col">
              <div
                ref={scrollRef}
                onScroll={onTranscriptScroll}
                className={`flex-1 overflow-y-auto px-4 py-4 transition-colors duration-500 [color-scheme:dark] ${theme.surface}`}
              >
                {isLoadingHistory && !hasConversation ? (
                  <div className="flex h-full items-center justify-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-solid border-white/10 border-t-emerald-400" />
                  </div>
                ) : !hasConversation ? (
                  /* Welcome state: a compact greeting with real starting points,
                     rather than a seven line feature list inside a bubble. */
                  <div className="flex h-full flex-col justify-end">
                    <div className="mb-5">
                      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white">
                        <BrandMark className="h-7 w-7 object-contain" />
                      </div>
                      <p className="text-base font-semibold leading-snug text-white">Karibu. I am Twiga.</p>
                      <p className="mt-1 text-[13.5px] leading-relaxed text-white/55">
                        Ask me about bookings, payments, transport, tours or your account. If you would
                        rather talk to a person, just say so.
                      </p>
                    </div>
                    {/* Say which page these suggestions came from, so they do not
                        look like a random list. */}
                    {pageContext.label && (
                      <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/35">
                        {pageContext.label}
                      </p>
                    )}
                    <div className="space-y-2">
                      {pageContext.starters.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void send(s)}
                          className="flex w-full items-center justify-between gap-2 rounded-xl border border-solid border-white/[0.08] bg-white/[0.03] px-3.5 py-2.5 text-left text-[13px] font-medium text-white/85 transition hover:border-emerald-400/40 hover:bg-emerald-400/[0.06]"
                        >
                          {s}
                          <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 text-white/35" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {grouped.map(({ message, firstOfGroup, lastOfGroup }, index) => {
                      const mine = message.role === "user";
                      const fromAgent = message.role === "agent";
                      // Mark the moment a person joined, once, like any chat app does.
                      const agentJoined = fromAgent && index === firstAgentIndex;

                      return (
                        <div key={message.id}>
                          {agentJoined && (
                            <div className="my-3 flex items-center gap-2.5">
                              <span className="h-px flex-1 bg-amber-400/20" />
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-2.5 py-1 text-[10.5px] font-semibold text-amber-200 ring-1 ring-inset ring-amber-400/25">
                                <Headphones className="h-3 w-3" />
                                A support agent joined
                              </span>
                              <span className="h-px flex-1 bg-amber-400/20" />
                            </div>
                          )}
                        <div
                          className={`group flex gap-2.5 ${mine ? "justify-end" : "justify-start"} ${
                            lastOfGroup ? "pb-3" : "pb-0.5"
                          }`}
                        >
                          {!mine && (
                            <div className="w-7 flex-shrink-0">
                              {firstOfGroup &&
                                (fromAgent ? (
                                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-400 text-amber-950">
                                    <Headphones className="h-3.5 w-3.5" />
                                  </div>
                                ) : (
                                  <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-0 bg-white">
                                    <BrandMark className="h-[18px] w-[18px]" />
                                  </div>
                                ))}
                            </div>
                          )}

                          <div className={`min-w-0 ${mine ? "max-w-[82%]" : "max-w-[88%]"}`}>
                            {firstOfGroup && !mine && (
                              <p className="mb-1 text-[11px] font-semibold leading-none text-white/60">
                                {fromAgent ? (
                                  <>
                                    NoLSAF Support <span className="font-normal text-white/35">· Agent</span>
                                  </>
                                ) : (
                                  "Twiga"
                                )}
                              </p>
                            )}

                            <div
                              className={`rounded-2xl px-3.5 py-2.5 ${
                                mine
                                  ? "rounded-br-md bg-[#0b7a6f] text-white"
                                  : fromAgent
                                    ? "rounded-tl-md bg-amber-400/[0.12] text-amber-50 ring-1 ring-inset ring-amber-400/25"
                                    : "rounded-tl-md border border-solid border-white/[0.07] bg-[#152320] text-white/90"
                              }`}
                            >
                              <MessageBody content={message.content} tone={mine ? "onBrand" : fromAgent ? "agent" : "twiga"} />
                            </div>

                            {/* Sign-in gate: two clear actions rather than small chips,
                                because this is the only way forward to a person. */}
                            {message.signInRequired && message.links && message.links.length > 0 && (
                              <div className="mt-2 grid grid-cols-2 gap-1.5">
                                {message.links.map((link, li) => (
                                  <a
                                    key={link.href}
                                    href={link.href}
                                    className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-[12.5px] font-semibold no-underline transition ${
                                      li === 0
                                        ? "bg-emerald-400 text-[#06231f] hover:bg-emerald-300"
                                        : "border border-solid border-white/15 bg-white/[0.04] text-white/85 hover:border-emerald-400/40 hover:text-emerald-200"
                                    }`}
                                  >
                                    {li === 0 ? <LogIn className="h-3.5 w-3.5" /> : <UserPlus className="h-3.5 w-3.5" />}
                                    {link.label}
                                  </a>
                                ))}
                                <p className="col-span-2 mt-0.5 text-[11px] leading-snug text-white/45">
                                  You come back to this page and the chat goes to the team automatically.
                                </p>
                              </div>
                            )}

                            {/* Deep links the answer carries. Previously discarded. */}
                            {!message.signInRequired && message.links && message.links.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {message.links.map((link) => (
                                  <a
                                    key={link.href}
                                    href={link.href}
                                    className="inline-flex items-center gap-1 rounded-full border border-solid border-emerald-400/30 bg-transparent px-2.5 py-1 text-xs font-medium text-emerald-300 no-underline transition hover:bg-emerald-400/10"
                                  >
                                    {link.label}
                                    <ArrowUpRight className="h-3 w-3" />
                                  </a>
                                ))}
                              </div>
                            )}

                            {lastOfGroup && (
                              <div className={`mt-1 flex items-center gap-2 ${mine ? "justify-end" : ""}`}>
                                <span className="text-[10.5px] text-white/35">
                                  {/* A locally created id means the server has not stored it yet. */}
                                  {mine && String(message.id).startsWith("local-user-")
                                    ? "Sending…"
                                    : mine && String(message.id).startsWith("local-failed-")
                                      ? <span className="font-semibold text-rose-300">Not sent</span>
                                      : formatTime(message.timestamp)}
                                </span>
                                {/* Delivery ticks while a person has the chat, in place of
                                    the old "added to the thread" message after every line:
                                    one tick saved, two ticks the support console has it,
                                    two blue ticks an agent opened the chat or replied since. */}
                                {mine && isWithHuman(status) && (() => {
                                  const id = message.id;
                                  if (typeof id !== "number") {
                                    return String(id).startsWith("local-user-")
                                      ? <Clock3 className="h-3 w-3 text-white/35" aria-label="Sending" />
                                      : null;
                                  }
                                  const sentAt = new Date(message.timestamp).getTime();
                                  if (latestAgentReplyId > id || (agentLastReadAt > 0 && sentAt <= agentLastReadAt)) {
                                    return (
                                      <span title="Seen by the support team" aria-label="Seen by the support team" className="text-sky-400">
                                        <CheckCheck className="h-3.5 w-3.5" />
                                      </span>
                                    );
                                  }
                                  if (agentOnline || status === "AGENT_ACTIVE") {
                                    return (
                                      <span title="Delivered to the support team" aria-label="Delivered to the support team" className="text-white/45">
                                        <CheckCheck className="h-3.5 w-3.5" />
                                      </span>
                                    );
                                  }
                                  return (
                                    <span title="Sent. The team will see it as soon as they are online." aria-label="Sent" className="text-white/45">
                                      <Check className="h-3.5 w-3.5" />
                                    </span>
                                  );
                                })()}
                                {!mine && (
                                  <span className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                                    {/* A booking reference or a set of steps is
                                        usually wanted somewhere else. */}
                                    <button
                                      type="button"
                                      aria-label="Copy answer"
                                      title="Copy answer"
                                      onClick={() => void copyAnswer(message.id, message.content)}
                                      className={`flex h-5 w-5 items-center justify-center rounded border-0 p-0 transition ${
                                        copiedId === message.id
                                          ? "bg-emerald-400/15 text-emerald-300"
                                          : "bg-transparent text-white/30 hover:bg-white/10 hover:text-white/80"
                                      }`}
                                    >
                                      {copiedId === message.id ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                    </button>
                                    {(["like", "dislike"] as const).map((kind) => {
                                      const Icon = kind === "like" ? ThumbsUp : ThumbsDown;
                                      const active = message.reaction === kind;
                                      return (
                                        <button
                                          key={kind}
                                          type="button"
                                          aria-label={kind === "like" ? "Helpful" : "Not helpful"}
                                          onClick={() =>
                                            setMessages((prev) =>
                                              prev.map((m) =>
                                                m.id === message.id
                                                  ? { ...m, reaction: m.reaction === kind ? null : kind }
                                                  : m
                                              )
                                            )
                                          }
                                          className={`flex h-5 w-5 items-center justify-center rounded border-0 p-0 transition ${
                                            active
                                              ? "bg-white/10 text-white"
                                              : "bg-transparent text-white/30 hover:bg-white/10 hover:text-white/80"
                                          }`}
                                        >
                                          <Icon className="h-3 w-3" />
                                        </button>
                                      );
                                    })}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        </div>
                      );
                    })}

                    {(isThinking || isSending) && (
                      <div className="flex gap-2.5 pb-3">
                        <div className="w-7 flex-shrink-0">
                          <div className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-white">
                            <BrandMark className="h-[18px] w-[18px] object-contain" />
                          </div>
                        </div>
                        <div className="rounded-2xl rounded-tl-md border border-solid border-white/[0.07] bg-[#152320] px-3.5 py-3">
                          <span className="flex gap-1">
                            {[0, 140, 280].map((d) => (
                              <span
                                key={d}
                                className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/40"
                                style={{ animationDelay: `${d}ms` }}
                              />
                            ))}
                          </span>
                        </div>
                      </div>
                    )}

                    <div ref={endRef} />
                  </div>
                )}
              </div>

              {/* Back to the newest message, shown only once the reader has
                  scrolled away from it. */}
              {showJump && hasConversation && (
                <button
                  type="button"
                  onClick={() => {
                    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                    atBottomRef.current = true;
                    setShowJump(false);
                  }}
                  className={`absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-solid border-white/10 px-3 py-1.5 text-[11px] font-semibold text-white/80 shadow-lg transition ${theme.jump}`}
                >
                  <ArrowDown className="h-3 w-3" />
                  Latest message
                </button>
              )}
              </div>

              {/* ── Suggested replies ──
                  One scrolling row, so three long follow-ups cannot push the
                  composer down the panel. */}
              {suggestions.length > 0 && (
                <div className={`flex flex-shrink-0 gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${theme.surface}`}>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      className="inline-flex flex-shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-solid border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-medium text-white/75 transition hover:border-emerald-400/40 hover:bg-emerald-400/10 hover:text-emerald-200"
                    >
                      {s}
                      <ArrowUpRight className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                </div>
              )}

              {/* ── Composer ── */}
              <div className={`relative flex-shrink-0 border-0 border-t border-solid px-3 pb-2.5 pt-3 transition-colors duration-500 ${theme.composer}`}>
                {/* ── @ picker ──
                    Hidden once a multi-word query stops matching anything: that
                    is someone writing "@ the office" in prose, not tagging. */}
                {mentionQuery !== null &&
                  !(mentionQuery.query.includes(" ") && !mentionLoading && mentionOptions.length === 0) && (
                  <div
                    role="listbox"
                    aria-label="Tag a property or region"
                    className={`absolute bottom-full left-3 right-3 z-20 mb-2 overflow-hidden rounded-xl border border-solid shadow-[0_18px_40px_-12px_rgba(0,0,0,0.7)] ${theme.picker}`}
                  >
                    <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-white/[0.06] px-3 py-2">
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/45">
                        {mentionQuery.query ? `Matching "${mentionQuery.query}"` : "Tag a place"}
                      </span>
                      <span className="text-[10px] text-white/35">
                        <kbd className="rounded bg-white/10 px-1 font-sans text-white/60">↑↓</kbd>{" "}
                        <kbd className="rounded bg-white/10 px-1 font-sans text-white/60">Enter</kbd>
                      </span>
                    </div>

                    {mentionLimitReached ? (
                      <p className="px-3 py-3 text-[12px] text-white/60">
                        Up to {MAX_MENTIONS} tags per message. Send this one, then tag more.
                      </p>
                    ) : mentionLoading && mentionOptions.length === 0 ? (
                      <div className="space-y-1.5 p-2">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="flex animate-pulse items-center gap-2.5 rounded-lg px-2 py-1.5">
                            <span className="h-8 w-8 rounded-lg bg-white/[0.06]" />
                            <span className="h-2.5 w-32 rounded bg-white/[0.06]" />
                          </div>
                        ))}
                      </div>
                    ) : mentionOptions.length === 0 ? (
                      <p className="px-3 py-3 text-[12px] text-white/55">
                        No approved stay or region matches that. Keep typing, or remove the @.
                      </p>
                    ) : (
                      <ul className="m-0 max-h-64 list-none overflow-y-auto p-1.5">
                        {mentionOptions.map((option, i) => {
                          const active = i === mentionIndex;
                          const sectionStart = i === 0 || mentionOptions[i - 1].kind !== option.kind || mentionOptions[i - 1].here !== option.here;
                          return (
                            <li key={option.key}>
                              {sectionStart && (
                                <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-white/35">
                                  {option.here ? "This page" : option.kind === "region" ? "Regions" : "Stays"}
                                </p>
                              )}
                              <button
                                type="button"
                                role="option"
                                aria-selected={active}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => setMentionIndex(i)}
                                onClick={() => chooseMention(option)}
                                className={`flex w-full items-center gap-2.5 rounded-lg border-0 px-2 py-1.5 text-left transition ${
                                  active ? theme.pickerActive : "bg-transparent"
                                }`}
                              >
                                {option.kind === "property" && option.thumbnail ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={option.thumbnail} alt="" className="h-8 w-8 flex-shrink-0 rounded-lg object-cover" />
                                ) : (
                                  <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/[0.06] ${theme.pickerIcon}`}>
                                    {option.kind === "region" ? <MapPin className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[13px] font-medium text-white/90">{option.label}</span>
                                  <span className="block truncate text-[11px] text-white/45">{option.detail}</span>
                                </span>
                                {active && <span className="text-[10px] font-semibold text-white/40">Enter</span>}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void send(input);
                  }}
                  className={`flex items-end gap-2 rounded-2xl border border-solid px-3 py-2 transition focus-within:bg-white/[0.06] focus-within:ring-2 ${theme.field}`}
                >
                  <textarea
                    ref={inputRef}
                    rows={1}
                    value={input}
                    onChange={(e) => handleInput(e.target.value, e.target.selectionStart)}
                    onKeyDown={onComposerKeyDown}
                    onClick={(e) => syncMentionQuery(e.currentTarget.value, e.currentTarget.selectionStart)}
                    onKeyUp={(e) => {
                      if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End") {
                        syncMentionQuery(e.currentTarget.value, e.currentTarget.selectionStart);
                      }
                    }}
                    onBlur={() => window.setTimeout(() => setMentionQuery(null), 120)}
                    aria-autocomplete="list"
                    placeholder={isWithHuman(status) ? "Message the support team" : "Ask Twiga anything"}
                    className={`max-h-24 min-h-[22px] flex-1 resize-none border-0 bg-transparent p-0 font-[inherit] text-[13.5px] leading-relaxed text-white/90 outline-none ring-0 placeholder:text-white/35 focus:ring-0 ${theme.caret}`}
                  />
                  <button
                    type="button"
                    onClick={startMention}
                    aria-label="Tag a property or region"
                    title="Tag a property or region"
                    className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-0 bg-transparent text-white/45 transition hover:bg-white/10 ${theme.pickerIcon}`}
                  >
                    <AtSign className="h-4 w-4" />
                  </button>
                  <button
                    type="submit"
                    disabled={!input.trim() || isSending}
                    aria-label="Send message"
                    className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border-0 transition ${
                      input.trim() && !isSending
                        ? theme.send
                        : "cursor-not-allowed bg-white/[0.08] text-white/30"
                    }`}
                  >
                    {isSending ? <span className={`h-3.5 w-3.5 animate-spin rounded-full border-2 border-solid ${theme.spinner}`} /> : <Send className="h-3.5 w-3.5" />}
                  </button>
                </form>
                {/* Keyboard hint on the left, the way out to a person on the right. */}
                <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
                  <span className="text-[10.5px] text-white/35">
                    <kbd className="rounded bg-white/10 px-1 font-sans text-[10px] text-white/60">Enter</kbd> to send ·{" "}
                    <kbd className="rounded bg-white/10 px-1 font-sans text-[10px] text-white/60">@</kbd> to tag a place
                  </span>
                  {!isWithHuman(status) ? (
                    <button
                      type="button"
                      onClick={() => void send("I would like to talk to a person")}
                      className="border-0 bg-transparent p-0 text-[10.5px] font-medium text-white/45 transition hover:text-emerald-300"
                    >
                      Talk to a person
                    </button>
                  ) : (
                    <span className="text-[10.5px] text-white/35">Twiga · NoLSAF support</span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Launcher ── */}
      {/* Preview of the agent's reply, so the visitor reads it without opening
          anything and knows a person, not the bot, is waiting on them. */}
      {!isOpen && preview && (
        <div
          className="twiga-preview animate-fadeIn fixed w-[min(calc(100vw-32px),300px)]"
          style={{ ...anchor, bottom: "88px" }}
        >
          <div className="relative overflow-hidden rounded-2xl border border-solid border-amber-300/15 bg-[#1a150d] shadow-[0_16px_40px_-10px_rgba(0,0,0,0.5)]">
            <span className="absolute inset-y-0 left-0 w-[3px] bg-amber-400" aria-hidden />
            <button
              type="button"
              onClick={() => {
                setIsOpen(true);
                setIsMinimized(false);
              }}
              className="flex w-full items-start gap-2.5 border-0 bg-transparent py-3 pl-4 pr-9 text-left"
            >
              <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-400 text-amber-950">
                <Headphones className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold text-white">
                  NoLSAF Support <span className="font-normal text-white/40">replied</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-white/70">{preview}</span>
                <span className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-300">
                  Open chat
                  <ArrowUpRight className="h-3 w-3" />
                </span>
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPreview(null)}
              aria-label="Dismiss"
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-md border-0 bg-transparent text-white/40 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      {!isOpen && (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setIsMinimized(false);
            setUnreadCount(0);
          }}
          aria-label={unreadCount > 0 ? `Open chat, ${unreadCount} new replies` : "Open chat with Twiga"}
          title="Ask Twiga (Ctrl + /)"
          className="twiga-launcher group fixed flex h-14 items-center gap-2 rounded-full border-0 bg-brand px-4 text-white shadow-card transition-all hover:-translate-y-0.5 hover:brightness-95"
          style={{ ...anchor, bottom: "20px" }}
        >
          {/* A ring that keeps pulsing until the reply is read. */}
          {unreadCount > 0 && <span className="absolute inset-0 animate-ping rounded-full bg-amber-400/40" aria-hidden />}
          <MessageCircle className="relative h-[22px] w-[22px] flex-shrink-0" />
          {/* The label only appears on hover, so the resting footprint stays a circle. */}
          <span className="hidden max-w-0 overflow-hidden whitespace-nowrap text-sm font-semibold opacity-0 transition-all duration-200 group-hover:max-w-[7rem] group-hover:opacity-100 sm:inline">
            Ask Twiga
          </span>
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}
