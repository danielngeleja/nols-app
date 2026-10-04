"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import {
  MessageSquare,
  User,
  Mail,
  Phone,
  Clock,
  CheckCircle,
  ChevronRight,
  Search,
  X,
  AlertCircle,
  Globe,
  Loader2,
  RefreshCw,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { renderWithMentions, stripMentions } from "@/lib/twigaMentions";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const api = apiClient;

function authify() {}

// Input sanitization helper
function sanitizeInput(input: string): string {
  return input.trim().replace(/[<>]/g, "");
}

// Validate conversation ID
function isValidConversationId(id: number | null | undefined): boolean {
  return id !== null && id !== undefined && Number.isInteger(id) && id > 0;
}

// Toast notification helper
function showToast(type: "success" | "error" | "info" | "warning", title: string, message?: string, duration?: number) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("nols:toast", {
        detail: { type, title, message, duration: duration ?? 5000 },
      })
    );
  }
}

/** Dates in East Africa Time, the zone every NoLSAF agent works in. */
function fmtEAT(value: string | Date | null | undefined, opts: { dateOnly?: boolean; timeOnly?: boolean } = {}): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const zone = "Africa/Dar_es_Salaam";
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: zone });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: zone });
  if (opts.dateOnly) return date;
  if (opts.timeOnly) return time;
  return `${date}, ${time}`;
}

/**
 * A tiny trend line for a stat tile. Inline SVG rather than a chart library:
 * it has no axes, no tooltip and has to sit in a 28px row.
 */
function Sparkline({ values, color, caption }: { values: number[]; color: string; caption: string }) {
  const w = 96;
  const h = 24;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  const line = points.length > 1 ? points.join(" ") : `0,${h - 2} ${w},${h - 2}`;
  return (
    <span className="flex w-full items-end justify-between gap-2">
      <span className="text-[11.5px] text-neutral-500">{caption}</span>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="flex-shrink-0 overflow-visible" aria-hidden>
        <polygon points={`0,${h} ${line} ${w},${h}`} fill={color} opacity={0.1} />
        <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** Display names for the language codes the widget offers. */
const LANGUAGE_NAMES: Record<string, string> = {
  EN: "English",
  SW: "Kiswahili",
  ES: "Español",
  FR: "Français",
  PT: "Português",
  AR: "العربية",
  ZH: "中文",
};

type Conversation = {
  id: number;
  sessionId: string;
  userId: number | null;
  userName: string | null;
  userEmail: string | null;
  userPhone: string | null;
  language: string;
  needsFollowUp: boolean;
  followUpNotes: string | null;
  followedUpAt: string | null;
  followedUpBy: number | null;
  /** Only on the full conversation (detail endpoint). */
  followedUpByName?: string | null;
  /** Lifecycle, from apps/api/src/lib/twiga/handoff.ts. */
  status?: "BOT" | "AWAITING_AGENT" | "AGENT_ACTIVE" | "RESOLVED";
  assignedToId?: number | null;
  handoffReason?: string | null;
  handoffAt?: string | null;
  resolvedAt?: string | null;
  /** Read receipts: when the visitor last had the chat open. */
  visitorLastReadAt?: string | null;
  agentLastReadAt?: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
};

type FullConversation = Conversation & {
  messages: Array<{
    id: number;
    role: "user" | "assistant" | "agent";
    content: string;
    timestamp: string;
  }>;
};

type Stats = {
  total: number;
  needsFollowUp: number;
  followedUp: number;
  recent: number;
  conversationsByDay: Array<{ date: string; count: number }>;
  topLanguages: Array<{ language: string; count: number }>;
};

export default function AIAgentsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;
  const [viewingConversation, setViewingConversation] = useState<FullConversation | null>(null);
  const [filter, setFilter] = useState<"all" | "needsFollowUp" | "followedUp">("needsFollowUp");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [followUpNotes, setFollowUpNotes] = useState("");
  const [markingFollowUp, setMarkingFollowUp] = useState(false);
  /** Reply the visitor will see, as opposed to the internal follow-up notes. */
  const [agentReply, setAgentReply] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [loadingConversationDetails, setLoadingConversationDetails] = useState(false);
  const [timeRange, setTimeRange] = useState<"7" | "30" | "90">("7");
  const [error, setError] = useState<string | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [conversationDetailsError, setConversationDetailsError] = useState<string | null>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    setStatsError(null);
    try {
      authify();
      const response = await api.get<{ success: boolean; stats: Stats }>("/api/admin/chatbot/stats", {
        params: { days: timeRange },
      });
      if (response.data.success) {
        setStats(response.data.stats);
      }
    } catch (err: any) {
      console.error("Failed to load stats", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load statistics";
      setStatsError(errorMessage);
      showToast("error", "Failed to Load Statistics", errorMessage);
    } finally {
      setLoadingStats(false);
    }
  }, [timeRange]);

  const loadConversations = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      authify();
      const params: any = {
        page,
        pageSize,
        sortBy: "updatedAt",
        sortOrder: "desc",
      };
      // "needsFollowUp" is the Open view and "followedUp" the Resolved view.
      if (filter === "needsFollowUp") {
        params.status = "AWAITING_AGENT,AGENT_ACTIVE";
      } else if (filter === "followedUp") {
        params.status = "RESOLVED";
      }

      const response = await api.get<{
        success: boolean;
        conversations: Conversation[];
        total: number;
        page: number;
        pageSize: number;
      }>("/api/admin/chatbot/conversations", { params });

      if (response.data.success) {
        setConversations(response.data.conversations || []);
        setTotal(response.data.total || 0);
      }
    } catch (err: any) {
      console.error("Failed to load conversations", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load conversations";
      setError(errorMessage);
      showToast("error", "Failed to Load Conversations", errorMessage);
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  // Debounce search input
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  useEffect(() => {
    authify();
    loadStats();
    loadConversations();
  }, [loadStats, loadConversations]);

  const loadConversationDetails = useCallback(async (id: number) => {
    if (!isValidConversationId(id)) {
      showToast("error", "Invalid Conversation", "Invalid conversation ID provided");
      return;
    }

    setLoadingConversationDetails(true);
    setConversationDetailsError(null);
    try {
      authify();
      const response = await api.get<{
        success: boolean;
        conversation: FullConversation;
      }>(`/api/admin/chatbot/conversations/${id}`);

      if (response.data.success) {
        setViewingConversation(response.data.conversation);
      }
    } catch (err: any) {
      console.error("Failed to load conversation details", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to load conversation details";
      setConversationDetailsError(errorMessage);
      showToast("error", "Failed to Load Conversation", errorMessage);
    } finally {
      setLoadingConversationDetails(false);
    }
  }, []);

  const markAsFollowedUp = useCallback(async (id: number) => {
    if (!isValidConversationId(id)) {
      showToast("error", "Invalid Conversation", "Invalid conversation ID provided");
      return;
    }

    const sanitizedNotes = sanitizeInput(followUpNotes).trim();
    if (sanitizedNotes.length > 2000) {
      showToast("error", "Notes Too Long", "Follow-up notes must be less than 2000 characters");
      return;
    }

    setMarkingFollowUp(true);
    try {
      authify();
      // Resolve moves the thread's status to RESOLVED. The old /follow-up call only
      // cleared a flag, so the chat stayed "Agent on it" in the open queue.
      await api.post(`/api/admin/chatbot/conversations/${id}/resolve`, sanitizedNotes ? { notes: sanitizedNotes } : {});

      await loadStats();
      await loadConversations();
      if (viewingConversation && viewingConversation.id === id) {
        await loadConversationDetails(id);
      }
      setFollowUpNotes("");
      showToast("success", "Chat resolved", "Moved to Resolved. It reopens if the visitor asks for a person again.");
      // The sidebar badge counts open follow-ups; this one just closed.
      window.dispatchEvent(new CustomEvent("nols:twiga-queue-change"));
    } catch (err: any) {
      console.error("Failed to mark follow-up", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to mark follow-up";
      showToast("error", "Failed to Mark Follow-up", errorMessage);
    } finally {
      setMarkingFollowUp(false);
    }
  }, [followUpNotes, loadStats, loadConversations, viewingConversation, loadConversationDetails]);

  /**
   * Send a reply the visitor actually sees, in their own chat widget.
   *
   * Distinct from follow-up notes above, which are internal and never leave the
   * admin console. This is the whole point of the handoff: before it, a visitor
   * who asked for a person got a flag in a queue and no answer.
   */
  const sendAgentReply = useCallback(async (id: number) => {
    if (!isValidConversationId(id)) {
      showToast("error", "Invalid Conversation", "Invalid conversation ID provided");
      return;
    }

    const body = agentReply.trim();
    if (!body) {
      showToast("warning", "Reply Required", "Write a reply before sending");
      return;
    }
    if (body.length > 5000) {
      showToast("error", "Reply Too Long", "Replies must be under 5000 characters");
      return;
    }

    setSendingReply(true);
    try {
      authify();
      // Not passed through sanitizeInput: that strips angle brackets, which
      // would quietly mangle a genuine reply, and the content is rendered as
      // plain text in the widget rather than as HTML.
      await api.post(`/api/admin/chatbot/conversations/${id}/reply`, { content: body });

      setAgentReply("");
      await loadConversationDetails(id);
      await loadConversations();
      showToast("success", "Reply Sent", "The visitor can see your reply in their chat");
    } catch (err: any) {
      console.error("Failed to send reply", err);
      const errorMessage = err?.response?.data?.error || err?.message || "Failed to send reply";
      showToast("error", "Failed to Send Reply", errorMessage);
    } finally {
      setSendingReply(false);
    }
  }, [agentReply, loadConversationDetails, loadConversations]);

  const filteredConversations = conversations.filter((conv) => {
    if (!debouncedSearch) return true;
    const query = sanitizeInput(debouncedSearch).toLowerCase();
    return (
      conv.userName?.toLowerCase().includes(query) ||
      conv.userEmail?.toLowerCase().includes(query) ||
      conv.userPhone?.toLowerCase().includes(query) ||
      conv.lastMessage?.toLowerCase().includes(query) ||
      conv.sessionId.toLowerCase().includes(query)
    );
  });

  const pages = Math.max(1, Math.ceil(total / pageSize));

  /* ── derived figures ──────────────────────────────────────────────────── */

  /** Daily volume for the selected window, padded to zeros when nothing came back. */
  const trend = useMemo(() => {
    const source = stats?.conversationsByDay ?? [];
    if (source.length > 0) {
      return source.map((d) => ({
        date: new Date(d.date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
        conversations: Number(d.count),
      }));
    }
    const span = Math.min(Number(timeRange), 14);
    return Array.from({ length: span }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (span - 1 - i));
      return { date: date.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), conversations: 0 };
    });
  }, [stats, timeRange]);

  const trendTotal = trend.reduce((sum, d) => sum + d.conversations, 0);
  const dailyAverage = trend.length ? Math.round((trendTotal / trend.length) * 10) / 10 : 0;
  const peakDay = trend.reduce(
    (best, d) => (d.conversations > best.conversations ? d : best),
    trend[0] ?? { date: "n/a", conversations: 0 }
  );

  const openCount = stats?.needsFollowUp ?? 0;
  const closedCount = stats?.followedUp ?? 0;
  const decided = openCount + closedCount;
  /** Share of flagged conversations that somebody actually closed out. */
  const handledRate = decided > 0 ? Math.round((closedCount / decided) * 100) : 0;

  const languageRows = useMemo(() => {
    const rows = (stats?.topLanguages ?? []).map((l) => ({
      code: String(l.language || "").toUpperCase() || "??",
      count: Number(l.count),
    }));
    const top = Math.max(1, ...rows.map((r) => r.count));
    const sum = rows.reduce((s, r) => s + r.count, 0);
    return rows.slice(0, 6).map((r) => ({
      ...r,
      width: Math.max(3, Math.round((r.count / top) * 100)),
      share: sum > 0 ? Math.round((r.count / sum) * 100) : 0,
    }));
  }, [stats]);

  /** Scroll target so the queue tile can take you straight to the list. */
  const listRef = useRef<HTMLDivElement>(null);
  const focusQueue = useCallback((next: "all" | "needsFollowUp" | "followedUp") => {
    setFilter(next);
    setPage(1);
    listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  /* ── live alerts ─────────────────────────────────────────────────────────
   * A bell or toast link lands here as ?conversation=<id>: open that chat.
   * While the page is open, a visitor handing off or writing again refreshes
   * the figures and the list, and the open chat if it is the one that moved.
   * Read from window.location rather than useSearchParams so the page does
   * not need a Suspense boundary.
   * ──────────────────────────────────────────────────────────────────────── */

  useEffect(() => {
    const id = Number(new URLSearchParams(window.location.search).get("conversation"));
    if (Number.isInteger(id) && id > 0) void loadConversationDetails(id);
    // Only on arrival; later navigation within the page is handled by clicks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openIdRef = useRef<number | null>(null);
  useEffect(() => {
    openIdRef.current = viewingConversation?.id ?? null;
  }, [viewingConversation]);

  useEffect(() => {
    const onActivity = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: number; kind?: string }>).detail;
      if (detail?.kind !== "seen") {
        void loadStats();
        void loadConversations();
      }
      if (detail?.conversationId && detail.conversationId === openIdRef.current) {
        void loadConversationDetails(detail.conversationId);
      }
    };
    window.addEventListener("nols:twiga-activity", onActivity);
    return () => window.removeEventListener("nols:twiga-activity", onActivity);
  }, [loadStats, loadConversations, loadConversationDetails]);

  /* ── conversation drawer ──────────────────────────────────────────────── */

  const closeDetails = useCallback(() => {
    setViewingConversation(null);
    setFollowUpNotes("");
    setAgentReply("");
  }, []);

  const transcriptRef = useRef<HTMLDivElement>(null);

  // Escape closes, and a freshly opened transcript starts at the newest message,
  // which is the one the agent needs to answer.
  useEffect(() => {
    if (!viewingConversation) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDetails();
    };
    window.addEventListener("keydown", onKey);
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    return () => window.removeEventListener("keydown", onKey);
  }, [viewingConversation, closeDetails]);

  return (
    <div className="space-y-4">
      {/* ── Header ──
          One bar carrying identity, the one number that means work, and the
          two controls. The old centred hero spent a screen height saying the
          page title twice and showed nothing actionable. */}
      <div className="rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]">
            <MessageSquare className="h-5 w-5 text-white" />
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="text-[17px] font-bold leading-tight text-neutral-900">Twiga</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] leading-tight text-neutral-500">
              <span>Chatbot conversations, handoffs and follow-ups</span>
              <span className="text-neutral-300">|</span>
              <span className={`inline-flex items-center gap-1.5 font-semibold ${openCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${openCount > 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                {openCount > 0 ? `${openCount} waiting on us` : "Nothing waiting"}
              </span>
            </p>
          </div>

          {/* Window for every figure and the chart below it. */}
          <div className="inline-flex flex-shrink-0 items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5">
            {(["7", "30", "90"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => {
                  setTimeRange(value);
                  setPage(1);
                }}
                className={`rounded-md border-0 px-3 py-1.5 text-[12px] font-semibold transition ${
                  timeRange === value
                    ? "bg-white text-[#02665e] shadow-sm"
                    : "bg-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {value} days
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              loadStats();
              loadConversations();
            }}
            disabled={loadingStats || loading}
            title="Reload figures and conversations"
            className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loadingStats || loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* ── Figures ──
          Four tiles with one shared anatomy: label and icon, figure, then a
          visual that explains the figure. Every tile is the same element shape
          so they align; clickable ones are plain buttons with border-0, since
          preflight is off and a bare button draws the browser's grey frame. */}
      {loadingStats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="animate-pulse rounded-xl border border-solid border-neutral-200 bg-white p-4">
              <div className="h-2.5 w-20 rounded bg-neutral-200" />
              <div className="mt-3 h-6 w-12 rounded bg-neutral-200" />
              <div className="mt-4 h-6 w-full rounded bg-neutral-100" />
            </div>
          ))}
        </div>
      ) : statsError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-5 py-4">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-600" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-rose-900">Figures could not be loaded</p>
            <p className="truncate text-[12px] text-rose-700">{statsError}</p>
          </div>
          <button
            type="button"
            onClick={loadStats}
            className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-rose-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      ) : stats ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {(
            [
              {
                key: "total",
                label: "Conversations",
                value: stats.total.toLocaleString(),
                icon: MessageSquare,
                iconTone: "bg-[#02665e]/10 text-[#02665e]",
                valueTone: "text-neutral-900",
                foot: (
                  <Sparkline values={trend.map((d) => d.conversations)} color="#02665e" caption={`${trendTotal} in ${timeRange} days`} />
                ),
                onClick: () => focusQueue("all"),
                active: filter === "all",
                accent: "bg-[#02665e]",
              },
              {
                key: "open",
                label: "Open",
                value: String(openCount),
                icon: AlertCircle,
                iconTone: openCount > 0 ? "bg-rose-50 text-rose-600" : "bg-neutral-100 text-neutral-400",
                valueTone: openCount > 0 ? "text-rose-600" : "text-neutral-900",
                foot: (
                  <span className={`inline-flex items-center gap-1.5 text-[11.5px] font-semibold ${openCount > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${openCount > 0 ? "animate-pulse bg-rose-500" : "bg-emerald-500"}`} />
                    {openCount > 0 ? "Open the queue" : "Queue is clear"}
                    {openCount > 0 && <ChevronRight className="h-3 w-3" />}
                  </span>
                ),
                onClick: () => focusQueue("needsFollowUp"),
                active: filter === "needsFollowUp",
                accent: "bg-rose-500",
              },
              {
                key: "closed",
                label: "Resolved",
                value: String(closedCount),
                icon: CheckCircle,
                iconTone: "bg-emerald-50 text-emerald-600",
                valueTone: "text-neutral-900",
                foot: (
                  <span className="flex w-full items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-rose-100">
                      <span className="block h-full rounded-full bg-emerald-500" style={{ width: `${handledRate}%` }} />
                    </span>
                    <span className="text-[11.5px] font-semibold tabular-nums text-neutral-600">{handledRate}% closed</span>
                  </span>
                ),
                onClick: () => focusQueue("followedUp"),
                active: filter === "followedUp",
                accent: "bg-emerald-500",
              },
              {
                key: "recent",
                label: "Last 24 hours",
                value: String(stats.recent),
                icon: Clock,
                iconTone: "bg-sky-50 text-sky-600",
                valueTone: "text-neutral-900",
                foot: (
                  <span className="text-[11.5px] text-neutral-500">
                    {stats.recent > dailyAverage ? (
                      <span className="font-semibold text-emerald-600">Above</span>
                    ) : stats.recent < dailyAverage ? (
                      <span className="font-semibold text-amber-600">Below</span>
                    ) : (
                      <span className="font-semibold text-neutral-700">On</span>
                    )}{" "}
                    the {dailyAverage}/day average
                  </span>
                ),
                onClick: null,
                active: false,
                accent: "",
              },
            ] as const
          ).map((tile) => {
            const Icon = tile.icon;
            const body = (
              <>
                {tile.active && <span className={`absolute inset-x-0 top-0 h-[3px] ${tile.accent}`} aria-hidden />}
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold text-neutral-500">{tile.label}</span>
                  <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tile.iconTone}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                </span>
                <span className={`mt-1 block text-[28px] font-bold leading-none tracking-tight ${tile.valueTone}`}>{tile.value}</span>
                <span className="mt-3 flex h-7 w-full items-end">{tile.foot}</span>
              </>
            );
            const shell =
              "relative flex flex-col items-start overflow-hidden rounded-xl border border-solid bg-white p-4 text-left font-[inherit] transition";
            return tile.onClick ? (
              <button
                key={tile.key}
                type="button"
                onClick={tile.onClick}
                aria-pressed={tile.active}
                className={`${shell} cursor-pointer hover:-translate-y-px hover:shadow-md ${
                  tile.active ? "border-neutral-300 shadow-sm" : "border-neutral-200 hover:border-neutral-300"
                }`}
              >
                {body}
              </button>
            ) : (
              <div key={tile.key} className={`${shell} border-neutral-200`}>
                {body}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* ── Analytics ──
          Volume on the left because it is the widest story; the two
          breakdowns stack on the right. Pie and bar charts with legends were
          replaced by plain proportional bars: three slices and six languages
          do not need a charting library to be read. */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-solid border-neutral-200 bg-white lg:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-5 py-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">Volume</p>
              <h2 className="mt-0.5 text-[15px] font-bold text-neutral-900">Conversations per day</h2>
            </div>
            <dl className="flex items-stretch gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200">
              {[
                { label: "In window", value: trendTotal.toLocaleString() },
                { label: "Daily average", value: String(dailyAverage) },
                { label: "Busiest day", value: peakDay.conversations > 0 ? peakDay.date : "None" },
              ].map((item) => (
                <div key={item.label} className="bg-white px-3 py-1.5">
                  <dt className="text-[9.5px] font-bold uppercase tracking-[0.08em] text-neutral-400">{item.label}</dt>
                  <dd className="m-0 text-[13px] font-bold text-neutral-900">{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="px-2 pb-3 pt-4">
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={trend} margin={{ top: 4, right: 16, bottom: 0, left: -12 }}>
                <defs>
                  <linearGradient id="twigaVolume" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#02665e" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#02665e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="date" tickLine={false} axisLine={false} fontSize={11} stroke="#a3a3a3" minTickGap={24} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={11} stroke="#a3a3a3" width={40} />
                <Tooltip
                  cursor={{ stroke: "#02665e", strokeOpacity: 0.25 }}
                  contentStyle={{ border: "1px solid #e5e5e5", borderRadius: 8, fontSize: 12, padding: "6px 10px" }}
                  formatter={(value: number) => [value, "Conversations"]}
                />
                <Area
                  type="monotone"
                  dataKey="conversations"
                  stroke="#02665e"
                  strokeWidth={2}
                  fill="url(#twigaVolume)"
                  dot={false}
                  activeDot={{ r: 4, strokeWidth: 0, fill: "#02665e" }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {/* Follow-up outcome */}
          <div className="rounded-xl border border-solid border-neutral-200 bg-white px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">Follow-up outcome</p>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-[22px] font-bold leading-none text-neutral-900">{handledRate}%</span>
              <span className="text-[12px] text-neutral-500">of flagged chats closed out</span>
            </div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-neutral-100">
              {decided > 0 && (
                <>
                  <span className="h-full bg-emerald-500" style={{ width: `${handledRate}%` }} />
                  <span className="h-full bg-rose-400" style={{ width: `${100 - handledRate}%` }} />
                </>
              )}
            </div>
            <div className="mt-3 space-y-1.5">
              {[
                { label: "Resolved", value: closedCount, dot: "bg-emerald-500", next: "followedUp" as const },
                { label: "Still open", value: openCount, dot: "bg-rose-400", next: "needsFollowUp" as const },
                {
                  label: "Handled by Twiga alone",
                  value: Math.max(0, (stats?.total ?? 0) - decided),
                  dot: "bg-neutral-300",
                  next: "all" as const,
                },
              ].map((row) => (
                <button
                  key={row.label}
                  type="button"
                  onClick={() => focusQueue(row.next)}
                  className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-1 py-0.5 text-left text-[12px] text-neutral-600 transition hover:bg-neutral-50"
                >
                  <span className={`h-2 w-2 flex-shrink-0 rounded-sm ${row.dot}`} />
                  <span className="flex-1">{row.label}</span>
                  <span className="font-semibold tabular-nums text-neutral-900">{row.value.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Languages */}
          <div className="flex-1 rounded-xl border border-solid border-neutral-200 bg-white px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">Languages</p>
            {languageRows.length === 0 ? (
              <p className="mt-3 text-[12px] text-neutral-400">No conversations in this window yet.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {languageRows.map((row) => (
                  <li key={row.code}>
                    <div className="mb-1 flex items-center justify-between text-[12px]">
                      <span className="flex items-center gap-2 text-neutral-700">
                        <span className="rounded bg-neutral-100 px-1.5 py-px text-[10px] font-bold text-neutral-500">{row.code}</span>
                        {LANGUAGE_NAMES[row.code] ?? row.code}
                      </span>
                      <span className="tabular-nums text-neutral-500">
                        <span className="font-semibold text-neutral-900">{row.count}</span> · {row.share}%
                      </span>
                    </div>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-neutral-100">
                      <span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${row.width}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* ── Conversations ── */}
      <div ref={listRef} className="scroll-mt-4 overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
          <div className="mr-auto">
            <h2 className="text-[15px] font-bold text-neutral-900">Conversations</h2>
            <p className="text-[12px] text-neutral-500">
              {total.toLocaleString()} {filter === "needsFollowUp" ? "open" : filter === "followedUp" ? "resolved" : "in total"}
            </p>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input
              type="text"
              placeholder="Search name, email, phone, message"
              value={searchQuery}
              onChange={(e) => {
                if (e.target.value.length <= 200) setSearchQuery(e.target.value);
              }}
              aria-label="Search conversations by name, email, phone, message, or session ID"
              maxLength={200}
              className="box-border w-full rounded-lg border border-solid border-neutral-200 bg-neutral-50 py-2 pl-9 pr-8 font-[inherit] text-[13px] text-neutral-800 outline-none transition focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/10"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded border-0 bg-transparent text-neutral-400 hover:text-neutral-700"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-100 p-0.5">
            {[
              { key: "needsFollowUp" as const, label: "Open", count: openCount },
              { key: "followedUp" as const, label: "Resolved", count: closedCount },
              { key: "all" as const, label: "All", count: stats?.total ?? null },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setFilter(tab.key);
                  setPage(1);
                }}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border-0 px-3 py-1.5 text-[12px] font-semibold transition ${
                  filter === tab.key ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"
                }`}
              >
                {tab.label}
                {tab.count !== null && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] font-bold ${
                      filter === tab.key
                        ? tab.key === "needsFollowUp"
                          ? "bg-rose-100 text-rose-700"
                          : tab.key === "followedUp"
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-neutral-200 text-neutral-700"
                        : "bg-neutral-200/70 text-neutral-500"
                    }`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="divide-y divide-neutral-100">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-3 px-5 py-4">
                <div className="h-9 w-9 rounded-full bg-neutral-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-40 rounded bg-neutral-200" />
                  <div className="h-2.5 w-3/4 rounded bg-neutral-100" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-wrap items-center gap-3 bg-rose-50 px-5 py-4">
            <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-rose-900">Conversations could not be loaded</p>
              <p className="truncate text-[12px] text-rose-700">{error}</p>
            </div>
            <button
              type="button"
              onClick={loadConversations}
              className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-rose-700"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        ) : filteredConversations.length === 0 ? (
          <div className="flex flex-col items-center px-5 py-12 text-center">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100">
              {filter === "needsFollowUp" && !debouncedSearch ? (
                <CheckCircle className="h-5 w-5 text-emerald-600" />
              ) : (
                <MessageSquare className="h-5 w-5 text-neutral-400" />
              )}
            </div>
            <p className="mt-3 text-[13px] font-semibold text-neutral-800">
              {debouncedSearch
                ? "No conversation matches that search"
                : filter === "needsFollowUp"
                  ? "No open chats. Nobody is waiting on a person"
                  : "No conversations yet"}
            </p>
            <p className="mt-1 text-[12px] text-neutral-500">
              {debouncedSearch ? "Search looks through this page only." : "New chats land here as visitors talk to Twiga."}
            </p>
          </div>
        ) : (
          <>
            {/* Column labels, hidden on phones where rows stack. */}
            <div className="hidden grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_110px_120px_24px] gap-4 bg-neutral-50 px-5 py-2 text-[10.5px] font-bold uppercase tracking-[0.1em] text-neutral-500 md:grid">
              <span>Visitor</span>
              <span>Last message</span>
              <span>Status</span>
              <span className="text-right">Last activity</span>
              <span />
            </div>

            <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
              {filteredConversations.map((conv) => {
                const when = new Date(conv.lastMessageTime ?? conv.updatedAt);
                // Status decides the chip. The legacy needsFollowUp flag was set on
                // plain Twiga chats by the old keyword matcher, so it no longer leads.
                const tone = conv.status === "AWAITING_AGENT"
                  ? { rule: "bg-amber-400", chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "Waiting for agent" }
                  : conv.status === "AGENT_ACTIVE"
                    ? { rule: "bg-sky-500", chip: "bg-sky-50 text-sky-700 ring-sky-200", label: "Agent on it" }
                    : conv.status === "RESOLVED"
                      ? { rule: "bg-emerald-500", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Resolved" }
                      : { rule: "bg-transparent", chip: "bg-neutral-100 text-neutral-600 ring-neutral-200", label: "Twiga only" };
                const initials = (conv.userName || "")
                  .split(" ")
                  .filter(Boolean)
                  .map((n) => n[0])
                  .join("")
                  .toUpperCase()
                  .slice(0, 2);

                return (
                  <li key={conv.id} className="relative">
                    {/* Status rule on the left edge: scan the colour, not the text. */}
                    <span className={`absolute inset-y-0 left-0 w-[3px] ${tone.rule}`} aria-hidden />
                    <button
                      type="button"
                      onClick={() => loadConversationDetails(conv.id)}
                      aria-label={`Open conversation with ${conv.userName || "anonymous visitor"}`}
                      className="group grid w-full grid-cols-1 gap-2 border-0 bg-white px-5 py-3.5 text-left transition hover:bg-neutral-50 md:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)_110px_120px_24px] md:items-center md:gap-4"
                    >
                      <span className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[12px] font-bold text-[#02665e]">
                          {initials || <User className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-neutral-900">
                            {conv.userName || "Anonymous visitor"}
                          </span>
                          <span className="flex min-w-0 items-center gap-2 text-[11px] text-neutral-500">
                            {conv.userEmail ? (
                              <span className="flex min-w-0 items-center gap-1">
                                <Mail className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{conv.userEmail}</span>
                              </span>
                            ) : conv.userPhone ? (
                              <span className="flex items-center gap-1">
                                <Phone className="h-3 w-3 flex-shrink-0" />
                                {conv.userPhone}
                              </span>
                            ) : (
                              <span className="text-neutral-400">No contact left</span>
                            )}
                          </span>
                        </span>
                      </span>

                      <span className="min-w-0">
                        <span className="line-clamp-2 text-[12.5px] leading-snug text-neutral-700">
                          {conv.lastMessage ? stripMentions(conv.lastMessage) : <span className="text-neutral-400">No messages</span>}
                        </span>
                        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-neutral-400">
                          <span className="inline-flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {conv.messageCount}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Globe className="h-3 w-3" />
                            {conv.language.toUpperCase()}
                          </span>
                        </span>
                      </span>

                      <span>
                        <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${tone.chip}`}>
                          {tone.label}
                        </span>
                      </span>

                      <span className="text-[11.5px] text-neutral-500 md:text-right">
                        <span className="inline-flex items-center gap-1 md:justify-end">
                          <Clock className="h-3 w-3 md:hidden" />
                          {when.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" })}
                        </span>
                        <span className="ml-1.5 text-neutral-400 md:ml-0 md:block">
                          {when.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })}
                        </span>
                      </span>

                      <ChevronRight className="hidden h-4 w-4 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-neutral-600 md:block" />
                    </button>
                  </li>
                );
              })}
            </ul>

            {pages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50 px-5 py-3">
                <span className="text-[12px] text-neutral-500">
                  {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, total)} of {total.toLocaleString()}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPage(Math.max(1, page - 1))}
                    disabled={page === 1}
                    className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 transition hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="px-1 text-[12px] tabular-nums text-neutral-500">
                    {page} / {pages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(Math.min(pages, page + 1))}
                    disabled={page === pages}
                    className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-neutral-700 transition hover:border-neutral-300 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Conversation case file ──
          Transcript and reply on the left, because answering the visitor is
          the job. Facts and the internal close-out on the right. The old modal
          stacked four cards and a footer Close button, so the notes box was
          often the only thing on screen and the conversation was scrolled
          out of sight. */}
      {viewingConversation && (() => {
        const conv = viewingConversation;
        const tone = conv.status === "AWAITING_AGENT"
          ? { chip: "bg-amber-50 text-amber-800 ring-amber-200", label: "Waiting for agent" }
          : conv.status === "AGENT_ACTIVE"
            ? { chip: "bg-sky-50 text-sky-700 ring-sky-200", label: "Agent on it" }
            : conv.status === "RESOLVED"
              ? { chip: "bg-emerald-50 text-emerald-700 ring-emerald-200", label: "Resolved" }
              : { chip: "bg-neutral-100 text-neutral-600 ring-neutral-200", label: "Twiga only" };
        const isOpenThread = conv.status === "AWAITING_AGENT" || conv.status === "AGENT_ACTIVE";
        const initials = (conv.userName || "")
          .split(" ")
          .filter(Boolean)
          .map((n) => n[0])
          .join("")
          .toUpperCase()
          .slice(0, 2);
        const canReply = conv.status !== "RESOLVED";

        const facts: Array<{ label: string; value: string | null }> = [
          { label: "Started", value: fmtEAT(conv.createdAt) },
          { label: "Last activity", value: fmtEAT(conv.lastMessageTime ?? conv.updatedAt) },
          { label: "Messages", value: String(conv.messages.length) },
          { label: "Language", value: LANGUAGE_NAMES[conv.language.toUpperCase()] ?? conv.language.toUpperCase() },
          { label: "Handed over", value: conv.handoffAt ? fmtEAT(conv.handoffAt) : null },
          { label: "Resolved", value: conv.resolvedAt ? fmtEAT(conv.resolvedAt) : null },
          { label: "Account", value: conv.userId ? `User #${conv.userId}` : "Guest visitor" },
        ];

        let lastDay = "";

        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/50 p-3 backdrop-blur-[2px] sm:p-6"
            onClick={closeDetails}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Conversation details"
              onClick={(e) => e.stopPropagation()}
              className="flex h-[min(760px,calc(100vh-24px))] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            >
              {/* Header: who, how to reach them, where the case stands. */}
              <div className="flex flex-shrink-0 items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[13px] font-bold text-[#02665e]">
                  {initials || <User className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[15px] font-bold text-neutral-900">{conv.userName || "Anonymous visitor"}</h2>
                    <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${tone.chip}`}>
                      {tone.label}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-neutral-500">
                    {conv.userEmail && (
                      <a href={`mailto:${conv.userEmail}`} className="inline-flex items-center gap-1 text-neutral-500 no-underline hover:text-[#02665e]">
                        <Mail className="h-3 w-3" />
                        {conv.userEmail}
                      </a>
                    )}
                    {conv.userPhone && (
                      <a href={`tel:${conv.userPhone}`} className="inline-flex items-center gap-1 text-neutral-500 no-underline hover:text-[#02665e]">
                        <Phone className="h-3 w-3" />
                        {conv.userPhone}
                      </a>
                    )}
                    {!conv.userEmail && !conv.userPhone && <span className="text-neutral-400">No contact details left</span>}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={closeDetails}
                  aria-label="Close conversation"
                  title="Close (Esc)"
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-0 bg-transparent text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {loadingConversationDetails ? (
                <div className="flex flex-1 items-center justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-[#02665e]" />
                </div>
              ) : conversationDetailsError ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
                  <AlertCircle className="h-6 w-6 text-rose-600" />
                  <p className="text-[13px] font-semibold text-neutral-800">This conversation could not be loaded</p>
                  <p className="text-[12px] text-neutral-500">{conversationDetailsError}</p>
                  <button
                    type="button"
                    onClick={() => loadConversationDetails(conv.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 py-1.5 text-[12px] font-semibold text-white"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col md:flex-row">
                  {/* ── Left: transcript + reply ── */}
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-neutral-50">
                    <div ref={transcriptRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-5 py-4">
                      {conv.messages.length === 0 && (
                        <p className="py-10 text-center text-[12px] text-neutral-400">No messages in this conversation.</p>
                      )}
                      {conv.messages.map((msg) => {
                        const day = fmtEAT(msg.timestamp, { dateOnly: true }) ?? "";
                        const showDay = day !== lastDay;
                        lastDay = day;
                        const mine = msg.role === "user";
                        const agent = msg.role === "agent";
                        return (
                          <div key={msg.id}>
                            {showDay && (
                              <div className="my-3 flex items-center gap-3">
                                <span className="h-px flex-1 bg-neutral-200" />
                                <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neutral-400">{day}</span>
                                <span className="h-px flex-1 bg-neutral-200" />
                              </div>
                            )}
                            <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                              <div className={`max-w-[80%] ${mine ? "" : "text-right"}`}>
                                <p className="mb-0.5 px-1 text-[10.5px] text-neutral-400">
                                  <span className={`font-semibold ${agent ? "text-amber-700" : mine ? "text-neutral-600" : "text-[#02665e]"}`}>
                                    {mine ? conv.userName || "Visitor" : agent ? "NoLSAF Support" : "Twiga"}
                                  </span>
                                  {" · "}
                                  {fmtEAT(msg.timestamp, { timeOnly: true })}
                                </p>
                                <div
                                  className={`whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-left text-[13px] leading-relaxed ${
                                    mine
                                      ? "rounded-tl-md border border-solid border-neutral-200 bg-white text-neutral-800"
                                      : agent
                                        ? "rounded-tr-md bg-amber-100 text-amber-950"
                                        : "rounded-tr-md bg-[#02665e] text-white"
                                  }`}
                                >
                                  {/* Tagged stays and regions open in a new tab so the reply draft survives. */}
                                  {renderWithMentions(msg.content, mine || agent ? "light" : "onBrand", true)}
                                </div>
                                {/* Did the visitor see this reply? Read from the widget's receipt. */}
                                {agent && (
                                  <p className="mt-0.5 px-1 text-[10.5px] font-medium text-neutral-400">
                                    {conv.visitorLastReadAt && new Date(conv.visitorLastReadAt).getTime() >= new Date(msg.timestamp).getTime() ? (
                                      <span className="text-sky-600">Seen by visitor</span>
                                    ) : (
                                      "Delivered, not seen yet"
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Reply composer, docked under the transcript it answers. */}
                    <div className="flex-shrink-0 border-0 border-t border-solid border-neutral-200 bg-white px-4 py-3">
                      {canReply ? (
                        <>
                          <div className="rounded-xl border border-solid border-neutral-200 bg-white transition focus-within:border-[#02665e] focus-within:ring-2 focus-within:ring-[#02665e]/10">
                            <textarea
                              value={agentReply}
                              onChange={(e) => {
                                if (e.target.value.length <= 5000) setAgentReply(e.target.value);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && agentReply.trim() && !sendingReply) {
                                  e.preventDefault();
                                  sendAgentReply(conv.id);
                                }
                              }}
                              placeholder={`Reply to ${conv.userName?.split(" ")[0] || "the visitor"}`}
                              rows={2}
                              className="box-border block w-full resize-none rounded-xl border-0 bg-transparent px-3.5 py-2.5 font-[inherit] text-[13px] leading-relaxed text-neutral-800 outline-none placeholder:text-neutral-400"
                            />
                            <div className="flex items-center justify-between gap-3 px-3 pb-2">
                              <span className="text-[11px] text-neutral-400">
                                Shows in their chat as NoLSAF Support · Ctrl + Enter to send
                              </span>
                              <button
                                type="button"
                                onClick={() => sendAgentReply(conv.id)}
                                disabled={sendingReply || !agentReply.trim()}
                                className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-[#014f49] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                              >
                                {sendingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                                {sendingReply ? "Sending" : "Send reply"}
                              </button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="py-1 text-center text-[12px] text-neutral-500">This conversation is resolved. The visitor starts a new one to talk again.</p>
                      )}
                    </div>
                  </div>

                  {/* ── Right: facts + internal close-out ── */}
                  <aside className="flex min-h-0 w-full flex-shrink-0 flex-col overflow-y-auto border-0 border-t border-solid border-neutral-200 bg-white md:w-[300px] md:border-l md:border-t-0">
                    <div className="px-5 py-4">
                      <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">Details</p>
                      <dl className="mt-2.5 space-y-2">
                        {facts
                          .filter((f) => f.value)
                          .map((f) => (
                            <div key={f.label} className="flex items-baseline justify-between gap-3 text-[12px]">
                              <dt className="text-neutral-500">{f.label}</dt>
                              <dd className="m-0 text-right font-medium text-neutral-900">{f.value}</dd>
                            </div>
                          ))}
                      </dl>
                      {conv.handoffReason && (
                        <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2">
                          <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-700">Why it was handed over</p>
                          <p className="mt-0.5 text-[12px] leading-snug text-amber-950">{conv.handoffReason}</p>
                        </div>
                      )}
                      <p className="mt-3 truncate font-mono text-[10.5px] text-neutral-400" title={conv.sessionId}>
                        {conv.sessionId}
                      </p>
                    </div>

                    <div className="mt-auto border-0 border-t border-solid border-neutral-200 px-5 py-4">
                      {isOpenThread ? (
                        <>
                          <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#02665e]">Resolve</p>
                          <p className="mt-1 text-[12px] leading-snug text-neutral-500">
                            Notes are internal and optional. Quiet chats resolve on their own after 12 hours.
                          </p>
                          <textarea
                            value={followUpNotes}
                            onChange={(e) => {
                              if (e.target.value.length <= 2000) setFollowUpNotes(e.target.value);
                            }}
                            placeholder="Called the guest, rebooked for 14 Oct"
                            maxLength={2000}
                            rows={4}
                            className="mt-2.5 box-border block w-full resize-none rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2 font-[inherit] text-[12.5px] leading-relaxed text-neutral-800 outline-none transition placeholder:text-neutral-400 focus:border-[#02665e] focus:bg-white focus:ring-2 focus:ring-[#02665e]/10"
                          />
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="text-[11px] tabular-nums text-neutral-400">{followUpNotes.length}/2000</span>
                            <button
                              type="button"
                              onClick={() => markAsFollowedUp(conv.id)}
                              disabled={markingFollowUp}
                              className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"
                            >
                              {markingFollowUp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                              Resolve chat
                            </button>
                          </div>
                        </>
                      ) : conv.status === "RESOLVED" || conv.followUpNotes ? (
                        <>
                          <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-emerald-700">
                            <CheckCircle className="h-3 w-3" />
                            Resolved
                          </p>
                          {/* An agent's resolve stamps followedUpAt and resolvedAt together; the quiet-hours worker stamps only resolvedAt. */}
                          {conv.followedUpBy && (!conv.resolvedAt || (conv.followedUpAt && Math.abs(new Date(conv.resolvedAt).getTime() - new Date(conv.followedUpAt).getTime()) < 5000)) ? (
                            <div className="mt-2 flex items-center gap-2.5 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-2">
                              <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-[11px] font-bold text-emerald-700" aria-hidden>
                                {(conv.followedUpByName || "A").trim().charAt(0).toUpperCase()}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-[12.5px] font-semibold text-neutral-900">
                                  {conv.followedUpByName || "Admin"}
                                </span>
                                <span className="block text-[11px] text-neutral-500">Resolved by</span>
                              </span>
                              <span className="flex-shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-neutral-600">
                                ID {conv.followedUpBy}
                              </span>
                            </div>
                          ) : (
                            <p className="mt-1 text-[12px] text-neutral-500">Closed after 12 quiet hours.</p>
                          )}
                          {conv.followUpNotes?.trim() && (
                            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-emerald-50 px-3 py-2 text-[12.5px] leading-relaxed text-emerald-950">
                              {conv.followUpNotes}
                            </p>
                          )}
                          {(conv.resolvedAt || conv.followedUpAt) && (
                            <p className="mt-1.5 text-[11px] text-neutral-400">{fmtEAT((conv.resolvedAt || conv.followedUpAt) as string)}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-[12px] text-neutral-400">Not flagged for follow-up. Twiga handled this one.</p>
                      )}
                    </div>
                  </aside>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
