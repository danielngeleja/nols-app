"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Instagram, Loader2,
  MessageCircle, RefreshCw, ScanSearch, Search, ShieldAlert, Unplug, Wifi, X,
  type LucideIcon,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { CountPill, EmptyState, SummaryCard } from "../_components/CommercialUi";

type Connection = {
  id: number;
  propertyId: number;
  provider: "INSTAGRAM" | "WHATSAPP";
  status: string;
  displayName: string | null;
  externalAccountId: string | null;
  phoneRegistrationComplete: boolean | null;
  tokenExpiresAt: string | null;
  webhookSubscribedAt: string | null;
  lastWebhookAt: string | null;
  lastOutboundAt: string | null;
  lastError: string | null;
  updatedAt: string;
  property: { id: number; title: string; regionName: string | null; owner: { id: number; fullName: string | null; name: string | null; email: string | null } };
};

type Overview = {
  generatedAt: string;
  readiness: { appConfigured: boolean; instagramOAuthConfigured: boolean; whatsappEmbeddedSignupConfigured: boolean; webhookConfigured: boolean; graphVersion: string };
  worker: { status: string; healthy: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null } | null;
  summary: { connections: Record<string, number>; webhookJobs: Record<string, number>; outboundMessages: Record<string, number>; inquiries: Record<string, number> };
  connections: Connection[];
  failures: {
    webhookJobs: Array<{ id: number; propertyId: number | null; provider: string; eventKind: string; attemptCount: number; lastError: string | null; updatedAt: string }>;
    outboundMessages: Array<{ id: number; channel: string; attemptCount: number; errorMessage: string | null; createdAt: string; inquiry: { propertyId: number; reference: string; property: { title: string } } }>;
  };
};

type Control = { kind: "REPLAY" | "FLAG_REAUTH" | "CLEAR_ERROR" | "DISCONNECT"; connection?: Connection; propertyId?: number; propertyTitle?: string };
type Diagnostic = {
  provider: "INSTAGRAM" | "WHATSAPP";
  propertyId: number;
  checkedAt: string;
  verdict: "HEALTHY" | "ATTENTION_REQUIRED" | "AWAITING_META_WEBHOOK" | "CONFIGURATION_BROKEN" | "PROCESSING_BROKEN";
  checks: Array<{ id: string; label: string; status: "PASS" | "WARN" | "FAIL"; detail: string }>;
  evidence: Record<string, string | number | boolean | null>;
};

type FailureGroup = {
  key: string;
  provider: string;
  source: "WEBHOOK" | "OUTBOUND";
  propertyId: number | null;
  propertyTitle: string | null;
  error: string;
  errorCode: string;
  count: number;
  maxAttempts: number;
  lastSeenAt: string;
  itemLabels: string[];
  eventKinds: string[];
};

// Preflight is disabled app-wide, so `border-*` paints nothing on a div, span
// or tr: only elements with a UA border-style (button, input, select) keep one.
// Edges in this console are rings, or inset shadows for a single side.
const STATUS_STYLE: Record<string, { pill: string; dot: string }> = {
  CONNECTED: { pill: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500" },
  PENDING: { pill: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-500" },
  REAUTH_REQUIRED: { pill: "bg-orange-50 text-orange-700 ring-orange-200", dot: "bg-orange-500" },
  ERROR: { pill: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500" },
  DISCONNECTED: { pill: "bg-neutral-100 text-neutral-500 ring-neutral-200", dot: "bg-neutral-400" },
};

const ROW_RULE = "shadow-[inset_0_-1px_0_0_#f1f5f9]";

/** Relative age, so an operator reads staleness without doing date arithmetic. */
function timeAgo(value: string | null | undefined) {
  if (!value) return null;
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function total(record: Record<string, number> | undefined) {
  return Object.values(record ?? {}).reduce((sum, value) => sum + Number(value || 0), 0);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function ownerName(connection: Connection) {
  return connection.property.owner.fullName || connection.property.owner.name || connection.property.owner.email || `Owner #${connection.property.owner.id}`;
}

function errorCode(value: string | null | undefined) {
  const raw = String(value || "UNKNOWN_FAILURE").trim();
  return raw.split(":", 1)[0] || "UNKNOWN_FAILURE";
}

function failureCopy(code: string, provider: string) {
  const channel = provider === "WHATSAPP" ? "WhatsApp" : provider === "INSTAGRAM" ? "Instagram" : "Meta";
  const known: Record<string, { title: string; guidance: string }> = {
    META_CONNECTION_NOT_FOUND: {
      title: `${channel} connection not found`,
      guidance: `No active ${channel} connection matches these events. Confirm the account is connected, then retry the affected items.`,
    },
    META_CONVERSATION_NOT_CONNECTED: {
      title: "Guest conversation is not connected",
      guidance: "The reply has no valid Meta recipient. Open the property connection and confirm the guest conversation before retrying.",
    },
    META_CONNECTION_TOKEN_MISSING: {
      title: `${channel} authorization is missing`,
      guidance: `The saved ${channel} connection has no usable access token. Ask the property owner to reconnect the account.`,
    },
    META_SEND_FAILED: {
      title: `${channel} rejected the reply`,
      guidance: "Meta did not accept the outgoing message. Review the technical response, connection status and messaging window before retrying.",
    },
  };
  return known[code] ?? {
    title: `${channel} processing failure`,
    guidance: "Review the technical details, diagnose the affected connection and retry only after the cause has been corrected.",
  };
}

const PANEL_TONES = {
  emerald: { icon: "bg-emerald-50 text-emerald-700 ring-emerald-100", bg: "bg-emerald-50/40" },
  amber: { icon: "bg-amber-50 text-amber-700 ring-amber-100", bg: "bg-amber-50/50" },
  red: { icon: "bg-red-50 text-red-600 ring-red-100", bg: "bg-red-50/50" },
} as const;

/**
 * Panel header for this console. The shared SectionHeader draws its rule with
 * `border-b`, which paints nothing on a div here, and other admin pages depend
 * on its exact look, so this page carries its own rather than changing theirs.
 */
function PanelHeader({ icon: Icon, title, subtitle, tone, right, badge }: {
  icon: LucideIcon; title: string; subtitle: string;
  tone: keyof typeof PANEL_TONES; right?: ReactNode; badge?: ReactNode;
}) {
  const t = PANEL_TONES[tone];
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5 ${t.bg} ${ROW_RULE}`}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white shadow-sm ring-1 ${t.icon}`}><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 truncate text-sm font-bold text-neutral-900">{title}</h2>
            {badge}
          </div>
          <p className="mb-0 mt-0.5 text-[11px] leading-4 text-neutral-500">{subtitle}</p>
        </div>
      </div>
      {right}
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-neutral-600">{children}</span>;
}

function CheckCard({ item }: { item: Diagnostic["checks"][number] }) {
  const skin = item.status === "PASS" ? "bg-white ring-neutral-200" : item.status === "WARN" ? "bg-amber-50/60 ring-amber-200" : "bg-red-50/60 ring-red-200";
  const dot = item.status === "PASS" ? "bg-emerald-500" : item.status === "WARN" ? "bg-amber-400" : "bg-red-500";
  const tag = item.status === "PASS" ? "bg-emerald-100 text-emerald-700" : item.status === "WARN" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-700";
  return (
    <div className={`flex h-full min-w-0 items-start gap-3 rounded-xl p-3.5 ring-1 ${skin}`}>
      <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-xs font-bold text-neutral-900">{item.label}</p>
          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${tag}`}>{item.status}</span>
        </div>
        <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-600">{item.detail}</p>
      </div>
    </div>
  );
}

/** Relative age up front, exact timestamp on hover. "Never" is dimmed. */
function TimeCell({ value, rule }: { value: string | null; rule: string }) {
  const ago = timeAgo(value);
  return (
    <td className={`px-4 py-3 ${rule}`}>
      {ago
        ? <span className="text-neutral-600" title={shortDate(value)}>{ago}</span>
        : <span className="text-neutral-300">Never</span>}
    </td>
  );
}

/** The verdict is a machine enum. An operator needs the sentence behind it. */
const VERDICT_COPY: Record<Diagnostic["verdict"], string> = {
  HEALTHY: "Meta configuration and the NoLSAF processing path are both healthy.",
  CONFIGURATION_BROKEN: "The fault is in Meta or account configuration. Fix the failing checks below before retrying anything.",
  PROCESSING_BROKEN: "Meta is connected, but the NoLSAF queue or worker is not moving events. This is ours to fix, not the owner's.",
  AWAITING_META_WEBHOOK: "Configuration looks valid, but Meta has never delivered a webhook to this property. Send one test message from a guest account.",
  ATTENTION_REQUIRED: "One or more messaging checks need review. Start with the failures below.",
};

/** "reportedCallback" reads as "Reported callback". */
function humanizeKey(key: string) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

/** Dates as timestamps, booleans as yes/no, absent values called out as absent. */
function formatEvidence(value: string | number | boolean | null) {
  if (value === null || value === undefined || value === "") return { text: "Not recorded", muted: true };
  if (typeof value === "boolean") return { text: value ? "Yes" : "No", muted: false };
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return { text: shortDate(value), muted: false };
  return { text: String(value), muted: false };
}

export default function AdminMetaMessagingPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [control, setControl] = useState<Control | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [diagnosingId, setDiagnosingId] = useState<number | null>(null);
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [diagnosticConnection, setDiagnosticConnection] = useState<Connection | null>(null);
  const [expandedFailure, setExpandedFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData((await apiClient.get("/api/admin/nrms/messaging/overview")).data); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Unable to load Meta messaging operations"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.connections ?? []).filter((connection) => {
      if (provider && connection.provider !== provider) return false;
      if (status && connection.status !== status) return false;
      if (!q) return true;
      return [connection.property.title, ownerName(connection), connection.property.owner.email, connection.displayName, connection.externalAccountId]
        .some((value) => String(value || "").toLowerCase().includes(q));
    });
  }, [data, provider, query, status]);

  const failureGroups = useMemo<FailureGroup[]>(() => {
    const groups = new Map<string, FailureGroup>();
    const add = (item: Omit<FailureGroup, "count" | "maxAttempts" | "lastSeenAt" | "itemLabels" | "eventKinds"> & { attempts: number; seenAt: string; itemLabel: string; eventKind: string }) => {
      const existing = groups.get(item.key);
      if (existing) {
        existing.count += 1;
        existing.maxAttempts = Math.max(existing.maxAttempts, item.attempts);
        if (new Date(item.seenAt).getTime() > new Date(existing.lastSeenAt).getTime()) existing.lastSeenAt = item.seenAt;
        if (!existing.itemLabels.includes(item.itemLabel)) existing.itemLabels.push(item.itemLabel);
        if (!existing.eventKinds.includes(item.eventKind)) existing.eventKinds.push(item.eventKind);
        return;
      }
      groups.set(item.key, {
        key: item.key,
        provider: item.provider,
        source: item.source,
        propertyId: item.propertyId,
        propertyTitle: item.propertyTitle,
        error: item.error,
        errorCode: item.errorCode,
        count: 1,
        maxAttempts: item.attempts,
        lastSeenAt: item.seenAt,
        itemLabels: [item.itemLabel],
        eventKinds: [item.eventKind],
      });
    };

    for (const job of data?.failures.webhookJobs ?? []) {
      const code = errorCode(job.lastError);
      add({
        key: ["WEBHOOK", job.provider, job.propertyId ?? "unmatched", code].join(":"),
        provider: job.provider,
        source: "WEBHOOK",
        propertyId: job.propertyId,
        propertyTitle: null,
        error: job.lastError || "No error detail recorded",
        errorCode: code,
        attempts: job.attemptCount,
        seenAt: job.updatedAt,
        itemLabel: `Webhook #${job.id}`,
        eventKind: job.eventKind,
      });
    }
    for (const message of data?.failures.outboundMessages ?? []) {
      const code = errorCode(message.errorMessage);
      add({
        key: ["OUTBOUND", message.channel, message.inquiry.propertyId, code].join(":"),
        provider: message.channel,
        source: "OUTBOUND",
        propertyId: message.inquiry.propertyId,
        propertyTitle: message.inquiry.property.title,
        error: message.errorMessage || "No error detail recorded",
        errorCode: code,
        attempts: message.attemptCount,
        seenAt: message.createdAt,
        itemLabel: `Reply #${message.id} · ${message.inquiry.reference}`,
        eventKind: "REPLY",
      });
    }
    return [...groups.values()].sort((left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime());
  }, [data]);

  function openControl(next: Control) {
    setControl(next);
    setReason("");
    setError(null);
  }

  async function submitControl() {
    if (!control || reason.trim().length < 8) return;
    setSaving(true);
    setError(null);
    try {
      if (control.kind === "REPLAY") {
        const propertyId = control.connection?.propertyId ?? control.propertyId;
        const response = await apiClient.post("/api/admin/nrms/messaging/failures/replay", { ...(propertyId ? { propertyId } : {}), reason });
        const replayed = response.data?.replayed ?? {};
        setNotice(`Queued ${Number(replayed.webhookJobs || 0)} webhook job(s) and ${Number(replayed.outboundMessages || 0)} outbound message(s) for retry.`);
      } else if (control.connection) {
        await apiClient.post(`/api/admin/nrms/messaging/connections/${control.connection.id}/state`, { action: control.kind, reason });
        setNotice(control.kind === "DISCONNECT" ? `${control.connection.provider} was disconnected from ${control.connection.property.title}.` : control.kind === "FLAG_REAUTH" ? `${control.connection.property.title} was flagged for Meta reauthorization.` : `The stored error for ${control.connection.property.title} was cleared.`);
      }
      setControl(null);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "The Meta control could not be completed");
    } finally { setSaving(false); }
  }

  async function runDiagnostic(connection: Connection) {
    setDiagnosingId(connection.id);
    setError(null);
    try {
      const response = await apiClient.post(`/api/admin/nrms/messaging/connections/${connection.id}/diagnose`);
      setDiagnostic(response.data?.diagnostic);
      setDiagnosticConnection(connection);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || `Unable to diagnose ${connection.provider}`);
    } finally { setDiagnosingId(null); }
  }

  const failedJobs = Number(data?.summary.webhookJobs.DEAD || 0);
  const failedOutbound = Number(data?.summary.outboundMessages.FAILED || 0);
  const retrying = Number(data?.summary.webhookJobs.RETRY || 0) + Number(data?.summary.outboundMessages.RETRY || 0);
  const connected = Number(data?.summary.connections.CONNECTED || 0);
  const attention = (data?.connections ?? []).filter((connection) => !["CONNECTED", "DISCONNECTED"].includes(connection.status) || Boolean(connection.lastError)).length;
  const configurationReady = data ? Object.entries(data.readiness).filter(([key]) => key !== "graphVersion").every(([, value]) => Boolean(value)) : false;
  const systemHealthy = configurationReady && Boolean(data?.worker?.healthy);
  const readinessChecks = [
    { label: "Meta app credentials", ok: Boolean(data?.readiness.appConfigured) },
    { label: "Webhook verification", ok: Boolean(data?.readiness.webhookConfigured) },
    { label: "WhatsApp signup", ok: Boolean(data?.readiness.whatsappEmbeddedSignupConfigured) },
    { label: "Instagram OAuth", ok: Boolean(data?.readiness.instagramOAuthConfigured) },
    { label: "Messaging worker", ok: Boolean(data?.worker?.healthy) },
  ];
  const affectedScopes = new Set(failureGroups.map((group) => group.propertyId ?? "unmatched")).size;

  if (loading && !data) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div id="admin-meta-messaging" className="mx-auto w-full min-w-0 max-w-7xl space-y-5 px-4 py-6 2xl:max-w-[1720px]">
      {/* Preflight is off, so nothing in this app is border-box by default. */}
      <style>{"#admin-meta-messaging, #admin-meta-messaging * { box-sizing: border-box; }"}</style>

      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link>

      {/* Console header. An operations surface should state its own health in
          the first thing you see, so the worker and Graph version live here
          rather than only inside the readiness panel further down. */}
      <section className="relative overflow-hidden rounded-2xl bg-[linear-gradient(120deg,#071612_0%,#0c2a24_55%,#071612_100%)] shadow-[0_24px_60px_-38px_rgba(2,44,34,0.9)] ring-1 ring-emerald-950">
        <div className="pointer-events-none absolute right-6 top-1 select-none text-7xl font-black tracking-tighter text-white/[0.035] sm:text-8xl" aria-hidden="true">META</div>
        <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4 p-5 sm:p-6">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-800/60 text-emerald-100 shadow-sm ring-1 ring-emerald-700/70"><MessageCircle className="h-5 w-5" /></span>
          <div className="min-w-[16rem] flex-1">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-400">NRMS operations</p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Meta Messaging Control Center</h1>
            <p className="mb-0 mt-1 text-xs leading-5 text-emerald-100/60 sm:text-sm">Platform-wide Instagram and WhatsApp connections, delivery health, and recovery controls.</p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-9 items-center gap-2 rounded-lg px-3 text-[11px] font-bold ring-1 ${systemHealthy ? "bg-emerald-800/50 text-emerald-100 ring-emerald-700/70" : "bg-amber-500/15 text-amber-200 ring-amber-500/40"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${systemHealthy ? "animate-pulse bg-emerald-300" : "bg-amber-300"}`} aria-hidden="true" />
              {systemHealthy ? "All systems operational" : "Attention required"}
            </span>
            <span className="inline-flex min-h-9 items-center rounded-lg bg-white/5 px-3 font-mono text-[11px] font-bold text-emerald-200/80 ring-1 ring-white/10" title="Meta Graph API version in use">
              {data?.readiness.graphVersion || "unknown"}
            </span>
            {(failedJobs + failedOutbound) > 0 && <button type="button" onClick={() => openControl({ kind: "REPLAY" })} className="inline-flex min-h-9 appearance-none items-center gap-2 rounded-lg border-0 bg-red-600 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-red-500"><RefreshCw className="h-4 w-4" /> Retry all failures</button>}
            <button type="button" onClick={() => void load()} className="inline-flex min-h-9 appearance-none items-center gap-2 rounded-lg border-0 bg-white px-3.5 text-xs font-bold text-emerald-900 shadow-sm transition hover:bg-emerald-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl bg-red-50 p-3.5 text-sm font-medium text-red-700 ring-1 ring-red-200" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start justify-between gap-3 rounded-xl bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800 ring-1 ring-emerald-200" role="status"><span className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice" className="appearance-none border-0 bg-transparent p-0 text-emerald-700"><X className="h-4 w-4" /></button></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard icon={Wifi} label="Connected channels" value={String(connected)} detail={`${total(data?.summary.connections)} total connections`} tone="emerald" />
        <SummaryCard icon={MessageCircle} label="Social inquiries" value={String(total(data?.summary.inquiries))} detail={`${Number(data?.summary.inquiries.WHATSAPP || 0)} WhatsApp · ${Number(data?.summary.inquiries.INSTAGRAM || 0)} Instagram`} tone="blue" />
        <SummaryCard icon={RefreshCw} label="Retrying now" value={String(retrying)} detail="Inbound and outbound queue" tone={retrying ? "amber" : "slate"} />
        <SummaryCard icon={ShieldAlert} label="Failed delivery" value={String(failedJobs + failedOutbound)} detail={`${failedJobs} inbound · ${failedOutbound} outbound`} tone={(failedJobs + failedOutbound) ? "amber" : "emerald"} />
        <SummaryCard icon={Activity} label="Need attention" value={String(attention)} detail="Connection or token issue" tone={attention ? "amber" : "slate"} />
      </div>

      <section className="overflow-hidden rounded-2xl bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200">
        <PanelHeader
          icon={Activity}
          title="Platform readiness"
          subtitle="Credentials, webhooks and the worker that moves every Meta event"
          tone={systemHealthy ? "emerald" : "amber"}
          right={<span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${systemHealthy ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200"}`}><span className={`h-1.5 w-1.5 rounded-full ${systemHealthy ? "bg-emerald-500" : "bg-amber-500"}`} />{readinessChecks.filter((item) => item.ok).length} of {readinessChecks.length} ready</span>}
        />
        {/* gap-px over a tinted background gives real hairlines between cells
            without relying on borders, and keeps the strip flush edge to edge. */}
        <div className="grid gap-px bg-neutral-200/70 sm:grid-cols-2 lg:grid-cols-5">
          {readinessChecks.map((item) => (
            <div key={item.label} className={`flex min-w-0 items-center gap-2.5 px-3.5 py-3.5 ${item.ok ? "bg-white" : "bg-amber-50/60"}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${item.ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-100 text-amber-700"}`}>
                {item.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-xs font-bold text-neutral-800">{item.label}</span>
                <span className={`block text-[10px] font-bold uppercase tracking-[0.08em] ${item.ok ? "text-emerald-600" : "text-amber-700"}`}>{item.ok ? "Ready" : "Not configured"}</span>
              </span>
            </div>
          ))}
        </div>
        {/* The worker's own error was collected by the API and never rendered. */}
        {data?.worker && !data.worker.healthy && (
          <p className="m-0 bg-amber-50 px-4 py-2.5 text-[11px] leading-4 text-amber-900 shadow-[inset_0_1px_0_0_#fde68a] sm:px-5">
            <span className="font-bold">Messaging worker {String(data.worker.status || "unknown").toLowerCase()}.</span>{" "}
            {data.worker.lastError ? <span className="font-mono">{data.worker.lastError}</span> : "No error detail was recorded."}
            {data.worker.lastSuccessAt ? ` Last success ${shortDate(data.worker.lastSuccessAt)}.` : " No successful run recorded."}
          </p>
        )}
      </section>

      {(failedJobs + failedOutbound) > 0 && <section className="overflow-hidden rounded-2xl bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-red-200" aria-labelledby="meta-failures-title">
        <PanelHeader
          icon={ShieldAlert}
          title="Intervention queue"
          subtitle="Repeated jobs are combined by root cause. Correct the cause before retrying."
          tone="red"
          badge={<span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{failedJobs + failedOutbound} blocked</span>}
          right={<div className="flex shrink-0 items-center gap-1.5 text-[10px] font-bold text-neutral-500">
            <span className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-neutral-200">{failureGroups.length} root {failureGroups.length === 1 ? "cause" : "causes"}</span>
            <span className="rounded-lg bg-white px-2.5 py-1.5 ring-1 ring-neutral-200">{affectedScopes} affected {affectedScopes === 1 ? "scope" : "scopes"}</span>
          </div>}
        />

        <ul className="m-0 list-none p-0">
          {failureGroups.map((group, index) => {
            const copy = failureCopy(group.errorCode, group.provider);
            const isExpanded = expandedFailure === group.key;
            const scope = group.propertyTitle || (group.propertyId ? `Property #${group.propertyId}` : "Unmatched Meta account");
            return <li key={group.key} className={`relative bg-white px-4 py-4 pl-5 sm:px-5 sm:pl-6 ${index < failureGroups.length - 1 ? ROW_RULE : ""}`}>
              {/* Severity rail, so the incident reads as an incident. */}
              <span className="absolute inset-y-0 left-0 w-1 bg-red-500" aria-hidden="true" />
              <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="m-0 text-[13px] font-bold text-neutral-900">{copy.title}</h3>
                    <Tag>{group.provider}</Tag>
                    <Tag>{group.source === "WEBHOOK" ? "Inbound" : "Outbound"}</Tag>
                    {group.count > 1 && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 ring-1 ring-amber-200">{group.count} combined</span>}
                  </div>
                  {/* The machine-readable code is what an operator searches on,
                      so it is shown rather than hidden behind the drawer. */}
                  <p className="m-0 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    <code className="rounded bg-red-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-700 ring-1 ring-red-100">{group.errorCode}</code>
                    <span className="font-semibold text-neutral-700">{scope}</span>
                  </p>
                  <p className="mb-0 mt-1.5 max-w-3xl text-[11px] leading-4 text-neutral-500">{copy.guidance}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-neutral-400">
                    <span className={group.maxAttempts >= 5 ? "font-bold text-amber-600" : ""}>{group.maxAttempts} retry {group.maxAttempts === 1 ? "attempt" : "attempts"}</span>
                    <span className="text-neutral-200">·</span>
                    <span title={shortDate(group.lastSeenAt)}>Last seen {timeAgo(group.lastSeenAt) ?? shortDate(group.lastSeenAt)}</span>
                    <span className="text-neutral-200">·</span>
                    <span className="font-mono">{group.eventKinds.join(", ")}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {group.propertyId
                    ? <button type="button" onClick={() => openControl({ kind: "REPLAY", propertyId: group.propertyId!, propertyTitle: scope })} className="inline-flex min-h-8 appearance-none items-center gap-1.5 rounded-lg border-0 bg-red-600 px-3 text-[11px] font-bold text-white shadow-sm transition hover:bg-red-500"><RefreshCw className="h-3 w-3" /> Retry affected</button>
                    : <a href="#property-connections" className="inline-flex min-h-8 items-center rounded-lg bg-white px-3 text-[11px] font-bold text-neutral-700 no-underline ring-1 ring-neutral-200 transition hover:bg-neutral-50 hover:no-underline">Review connections</a>}
                  <button type="button" onClick={() => setExpandedFailure(isExpanded ? null : group.key)} aria-expanded={isExpanded} className="inline-flex min-h-8 appearance-none items-center gap-1.5 rounded-lg border-0 bg-neutral-100 px-3 text-[11px] font-bold text-neutral-600 transition hover:bg-neutral-200">Technical details <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-180" : ""}`} /></button>
                </div>
              </div>
              {isExpanded && <div className="mt-3 overflow-x-auto rounded-xl bg-neutral-950 p-3.5 text-[10px] leading-5 text-neutral-300 ring-1 ring-neutral-800">
                <dl className="m-0 grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_1fr]">
                  <dt className="text-neutral-500">Error code</dt><dd className="m-0 break-all font-mono text-red-300">{group.errorCode}</dd>
                  <dt className="text-neutral-500">Provider detail</dt><dd className="m-0 break-words font-mono text-neutral-200">{group.error}</dd>
                  <dt className="text-neutral-500">Affected items</dt><dd className="m-0 break-words">{group.itemLabels.join(" · ")}</dd>
                  <dt className="text-neutral-500">Last seen</dt><dd className="m-0 font-mono">{shortDate(group.lastSeenAt)}</dd>
                </dl>
              </div>}
            </li>;
          })}
        </ul>
      </section>}

      <section id="property-connections" className="min-w-0 scroll-mt-4 overflow-hidden rounded-2xl bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] ring-1 ring-neutral-200">
        <PanelHeader
          icon={MessageCircle}
          title="Property connections"
          subtitle="No access tokens or secrets are exposed to this console"
          tone="emerald"
          right={<CountPill count={filtered.length} singular="connection" plural="connections" />}
        />
        <div className={`flex flex-col gap-2.5 bg-neutral-50/60 px-4 py-3 sm:flex-row sm:px-5 ${ROW_RULE}`}>
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search property, owner or Meta account" className="block min-h-9 w-full rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-xs outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" /></div>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600"><option value="">All providers</option><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option></select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600"><option value="">All statuses</option>{Object.keys(STATUS_STYLE).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>
          {(query || provider || status) && <button type="button" onClick={() => { setQuery(""); setProvider(""); setStatus(""); }} className="min-h-9 shrink-0 appearance-none rounded-lg border-0 bg-white px-3 text-xs font-bold text-neutral-500 ring-1 ring-neutral-200 transition hover:text-neutral-800">Clear</button>}
        </div>
        {filtered.length ? <div className="overflow-x-auto">
          <table className="w-full min-w-[62rem] border-collapse text-left">
            <thead>
              {/* Written out, not interpolated: Tailwind only generates classes
                  it can find as complete strings in the source. */}
              <tr className="bg-neutral-50/60 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400 [&>th]:shadow-[inset_0_-1px_0_0_#f1f5f9]">
                <th className="px-5 py-2.5">Connection</th>
                <th className="px-4 py-2.5">Property &amp; owner</th>
                <th className="px-4 py-2.5">Status</th>
                <th className="px-4 py-2.5">Last inbound</th>
                <th className="px-4 py-2.5">Last outbound</th>
                <th className="px-5 py-2.5 text-right">Controls</th>
              </tr>
            </thead>
            <tbody>{filtered.map((connection, index) => {
              const style = STATUS_STYLE[connection.status] || STATUS_STYLE.ERROR;
              const rule = index < filtered.length - 1 ? ROW_RULE : "";
              const isWhatsApp = connection.provider === "WHATSAPP";
              return <tr key={connection.id} className="group text-xs transition hover:bg-emerald-50/40">
                <td className={`px-5 py-3 ${rule}`}>
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isWhatsApp ? "bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100" : "bg-fuchsia-50 text-fuchsia-600 ring-1 ring-fuchsia-100"}`}>
                      {isWhatsApp ? <MessageCircle className="h-4 w-4" /> : <Instagram className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 truncate font-bold text-neutral-900">{connection.displayName || (isWhatsApp ? "WhatsApp" : "Instagram")}</p>
                      <p className="mb-0 mt-0.5 max-w-44 truncate font-mono text-[10px] text-neutral-400" title={connection.externalAccountId || undefined}>{connection.externalAccountId || `Connection #${connection.id}`}</p>
                    </div>
                  </div>
                </td>
                <td className={`px-4 py-3 ${rule}`}>
                  <Link href={`/admin/nrms/${connection.propertyId}`} className="font-bold text-neutral-800 no-underline hover:text-emerald-700">{connection.property.title}</Link>
                  <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{ownerName(connection)}</p>
                </td>
                <td className={`px-4 py-3 ${rule}`}>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${style.pill}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} aria-hidden="true" />{connection.status.replaceAll("_", " ")}
                  </span>
                  {connection.lastError && <p className="mb-0 mt-1 max-w-48 truncate font-mono text-[10px] text-red-600" title={connection.lastError}>{connection.lastError}</p>}
                </td>
                <TimeCell value={connection.lastWebhookAt} rule={rule} />
                <TimeCell value={connection.lastOutboundAt} rule={rule} />
                <td className={`px-5 py-3 ${rule}`}>
                  <div className="flex justify-end gap-1.5">
                    <button type="button" onClick={() => void runDiagnostic(connection)} disabled={diagnosingId !== null} title="Run a live Meta diagnostic" className="inline-flex min-h-8 appearance-none items-center gap-1.5 rounded-lg border-0 bg-sky-600 px-2.5 text-[10px] font-bold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-40">{diagnosingId === connection.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} Diagnose</button>
                    {connection.lastError && <button type="button" onClick={() => openControl({ kind: "CLEAR_ERROR", connection })} title="Clear the stored error" className="min-h-8 appearance-none rounded-lg border-0 bg-white px-2.5 text-[10px] font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50">Clear error</button>}
                    <button type="button" onClick={() => openControl({ kind: "FLAG_REAUTH", connection })} disabled={connection.status === "DISCONNECTED"} title="Force the owner to sign in to Meta again" className="min-h-8 appearance-none rounded-lg border-0 bg-amber-50 px-2.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200 transition hover:bg-amber-100 disabled:opacity-40">Require login</button>
                    <button type="button" onClick={() => openControl({ kind: "DISCONNECT", connection })} disabled={connection.status === "DISCONNECTED"} aria-label={`Disconnect ${connection.provider} from ${connection.property.title}`} title="Disconnect this Meta account" className="inline-flex min-h-8 w-8 appearance-none items-center justify-center rounded-lg border-0 bg-red-50 text-red-700 ring-1 ring-red-200 transition hover:bg-red-100 disabled:opacity-40"><Unplug className="h-3.5 w-3.5" /></button>
                  </div>
                </td>
              </tr>;
            })}</tbody>
          </table>
        </div> : <EmptyState icon={Search} title="No Meta connections found" text={data?.connections.length ? "Change the search or filters to see more connections." : "Property connections will appear here after an owner links Instagram or WhatsApp."} />}
      </section>

      {control && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/60 px-3 py-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="meta-control-title">
        <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)] ring-1 ring-white/70">
          <div className={`flex items-start justify-between gap-3 px-4 py-3.5 ${control.kind === "DISCONNECT" ? "bg-red-50/60" : "bg-neutral-50/60"} ${ROW_RULE}`}>
            <div>
              <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Audited Meta control</p>
              <h2 id="meta-control-title" className="m-0 mt-1 text-base font-bold text-neutral-950">{control.kind === "REPLAY" ? `Retry ${control.connection?.property.title || control.propertyTitle || "all"} failures` : control.kind === "FLAG_REAUTH" ? "Require owner reauthorization" : control.kind === "CLEAR_ERROR" ? "Clear stored error" : "Disconnect Meta account"}</h2>
            </div>
            <button type="button" onClick={() => setControl(null)} aria-label="Close control" className="shrink-0 appearance-none border-0 bg-transparent p-0 text-neutral-400 transition hover:text-neutral-700"><X className="h-4 w-4" /></button>
          </div>
          <div className="space-y-3 p-4">
            {control.kind === "DISCONNECT" && <p className="m-0 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-700 ring-1 ring-red-200">This revokes the stored token and removes the linked Meta account identifiers. The owner must connect the account again.</p>}
            <label htmlFor="meta-control-reason" className="block text-xs font-bold text-neutral-700">Operational reason</label>
            <textarea id="meta-control-reason" autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this action required?" className="block min-h-20 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
            {/* The 8-character minimum was stated but never shown as progress. */}
            <p className="m-0 flex items-center justify-between gap-2 text-[10px] text-neutral-400">
              <span>Saved in the admin audit trail.</span>
              <span className={`font-bold tabular-nums ${reason.trim().length >= 8 ? "text-emerald-600" : "text-neutral-400"}`}>{Math.min(reason.trim().length, 8)}/8</span>
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setControl(null)} className="min-h-9 appearance-none rounded-lg border-0 bg-white px-3.5 text-xs font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50">Cancel</button>
              <button type="button" onClick={() => void submitControl()} disabled={saving || reason.trim().length < 8} className={`inline-flex min-h-9 appearance-none items-center gap-2 rounded-lg border-0 px-3.5 text-xs font-bold text-white shadow-sm transition disabled:opacity-50 ${control.kind === "DISCONNECT" ? "bg-red-600 hover:bg-red-500" : "bg-emerald-700 hover:bg-emerald-600"}`}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{control.kind === "REPLAY" ? "Queue retry" : control.kind === "DISCONNECT" ? "Disconnect" : "Confirm"}</button>
            </div>
          </div>
        </div>
      </div>}

      {diagnostic && diagnosticConnection && (() => {
        const passed = diagnostic.checks.filter((item) => item.status === "PASS").length;
        // Failures first: nine checks in a grid buries the two that matter.
        const rank = { FAIL: 0, WARN: 1, PASS: 2 } as const;
        const blocking = diagnostic.checks.filter((item) => item.status !== "PASS").sort((left, right) => rank[left.status] - rank[right.status]);
        const passing = diagnostic.checks.filter((item) => item.status === "PASS");
        const evidence = Object.entries(diagnostic.evidence ?? {});
        const verdictTone = diagnostic.verdict === "HEALTHY" ? "emerald" : diagnostic.verdict === "ATTENTION_REQUIRED" || diagnostic.verdict === "AWAITING_META_WEBHOOK" ? "amber" : "red";
        const verdictSkin = { emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200", amber: "bg-amber-50 text-amber-700 ring-amber-200", red: "bg-red-50 text-red-700 ring-red-200" }[verdictTone];
        const verdictBar = { emerald: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" }[verdictTone];
        return <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-neutral-950/60 px-3 py-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="meta-diagnostic-title">
          <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)] ring-1 ring-white/70">
            <div className={`sticky top-0 z-10 flex items-start justify-between gap-3 bg-white px-4 py-3.5 sm:px-5 ${ROW_RULE}`}>
              <div className="flex min-w-0 items-start gap-3">
                <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${verdictSkin}`}><ScanSearch className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Live Meta diagnostic</p>
                  <h2 id="meta-diagnostic-title" className="m-0 mt-1 truncate text-base font-bold text-neutral-950">{diagnosticConnection.property.title} · {diagnostic.provider}</h2>
                  <p className="mb-0 mt-1 text-[10px] text-neutral-400">Checked {shortDate(diagnostic.checkedAt)} · audit recorded</p>
                </div>
              </div>
              <button type="button" onClick={() => { setDiagnostic(null); setDiagnosticConnection(null); }} className="shrink-0 appearance-none rounded-lg border-0 bg-white p-1.5 ring-1 ring-neutral-200 transition hover:bg-neutral-50" aria-label="Close diagnostic"><X className="h-4 w-4 text-neutral-400" /></button>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              {/* The verdict was a raw enum with a count beside it. It now says
                  what the enum means and shows the pass ratio as a bar. */}
              <div className={`rounded-xl p-4 ring-1 ${verdictSkin}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-[14rem] flex-1">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] opacity-70">Verdict</p>
                    <p className="mb-0 mt-1 text-base font-black leading-5">{diagnostic.verdict.replaceAll("_", " ")}</p>
                  </div>
                  <p className="m-0 shrink-0 text-right text-xs font-bold tabular-nums opacity-80">{passed} of {diagnostic.checks.length} checks passed</p>
                </div>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/60">
                  <div className={`h-full rounded-full transition-[width] duration-500 ${verdictBar}`} style={{ width: `${Math.round((passed / Math.max(1, diagnostic.checks.length)) * 100)}%` }} />
                </div>
                <p className="mb-0 mt-3 text-[11px] leading-4 text-neutral-700">{VERDICT_COPY[diagnostic.verdict]}</p>
              </div>

              {/* Failing checks get their own block so they are never lost
                  among the passes. */}
              {blocking.length > 0 && <div>
                <p className="m-0 mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">Needs attention ({blocking.length})</p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {blocking.map((item) => <CheckCard key={item.id} item={item} />)}
                </div>
              </div>}

              {/* The passing checks, listed once. Repeating the failures here
                  under an "All checks" heading would say the same thing twice.
                  Two-column matrix in classes: a page-level <style> block used
                  to reach in and re-grid `.space-y-2` from a distance. */}
              {passing.length > 0 && <div>
                <p className="m-0 mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{blocking.length ? `Passing (${passing.length})` : `All checks passed (${passing.length})`}</p>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {passing.map((item) => <CheckCard key={item.id} item={item} />)}
                </div>
              </div>}

              {/* Evidence was fetched by this page and never shown. It is the
                  raw material an operator needs to act on the verdict. */}
              {evidence.length > 0 && <details className="group overflow-hidden rounded-xl bg-neutral-950 ring-1 ring-neutral-800">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3.5 py-2.5 text-[11px] font-bold text-neutral-300 [&::-webkit-details-marker]:hidden">
                  <span>Evidence collected from Meta ({evidence.length})</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 transition-transform group-open:rotate-180" />
                </summary>
                <dl className="m-0 grid gap-x-4 gap-y-1.5 px-3.5 pb-3.5 text-[10px] leading-5 sm:grid-cols-[13rem_1fr]">
                  {evidence.map(([key, value]) => {
                    const shown = formatEvidence(value);
                    return <div key={key} className="contents">
                      <dt className="text-neutral-500">{humanizeKey(key)}</dt>
                      <dd className={`m-0 break-words font-mono ${shown.muted ? "text-neutral-600" : "text-neutral-200"}`}>{shown.text}</dd>
                    </div>;
                  })}
                </dl>
              </details>}
              <div className="flex justify-end gap-2 pt-4 shadow-[inset_0_1px_0_0_#f1f5f9]">
                <button type="button" onClick={() => void runDiagnostic(diagnosticConnection)} disabled={diagnosingId !== null} className="inline-flex min-h-9 appearance-none items-center gap-2 rounded-lg border-0 bg-sky-600 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-sky-500 disabled:opacity-50">{diagnosingId !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run again</button>
                <button type="button" onClick={() => { setDiagnostic(null); setDiagnosticConnection(null); }} className="min-h-9 appearance-none rounded-lg border-0 bg-white px-3.5 text-xs font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50">Close</button>
              </div>
            </div>
          </div>
        </div>;
      })()}
    </div>
  );
}
