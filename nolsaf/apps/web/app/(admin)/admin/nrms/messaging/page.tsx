"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, Instagram, Loader2,
  MessageCircle, RefreshCw, ScanSearch, Search, ShieldAlert, Unplug, Wifi, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { CountPill, EmptyState, SectionHeader, SummaryCard } from "../_components/CommercialUi";

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

const STATUS_STYLE: Record<string, string> = {
  CONNECTED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  PENDING: "border-amber-200 bg-amber-50 text-amber-700",
  REAUTH_REQUIRED: "border-orange-200 bg-orange-50 text-orange-700",
  ERROR: "border-red-200 bg-red-50 text-red-700",
  DISCONNECTED: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

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

  if (loading && !data) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;

  return (
    <div id="admin-meta-messaging" className="mx-auto w-full min-w-0 max-w-7xl space-y-5 px-4 py-6 2xl:max-w-[1720px]">
      <style>{`#admin-meta-messaging, #admin-meta-messaging * { box-sizing: border-box; }`}</style>
      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">META</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><MessageCircle className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS operations</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Meta Messaging Control Center</h1>
              <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">Platform-wide Instagram and WhatsApp connections, delivery health, and recovery controls.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {(failedJobs + failedOutbound) > 0 && <button type="button" onClick={() => openControl({ kind: "REPLAY" })} className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-white px-3 py-2.5 text-xs font-bold text-red-700 shadow-sm transition hover:bg-red-50"><RefreshCw className="h-4 w-4" /> Retry all failures</button>}
            <button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-50"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
          </div>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{error}</span></div>}
      {notice && <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><span className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice"><X className="h-4 w-4" /></button></div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <SummaryCard icon={Wifi} label="Connected channels" value={String(connected)} detail={`${total(data?.summary.connections)} total connections`} tone="emerald" />
        <SummaryCard icon={MessageCircle} label="Social inquiries" value={String(total(data?.summary.inquiries))} detail={`${Number(data?.summary.inquiries.WHATSAPP || 0)} WhatsApp · ${Number(data?.summary.inquiries.INSTAGRAM || 0)} Instagram`} tone="blue" />
        <SummaryCard icon={RefreshCw} label="Retrying now" value={String(retrying)} detail="Inbound and outbound queue" tone={retrying ? "amber" : "slate"} />
        <SummaryCard icon={ShieldAlert} label="Failed delivery" value={String(failedJobs + failedOutbound)} detail={`${failedJobs} inbound · ${failedOutbound} outbound`} tone={(failedJobs + failedOutbound) ? "amber" : "emerald"} />
        <SummaryCard icon={Activity} label="Need attention" value={String(attention)} detail="Connection or token issue" tone={attention ? "amber" : "slate"} />
      </div>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Activity} title="Platform readiness" subtitle={`Meta Graph API ${data?.readiness.graphVersion || "unknown"}`} tone={configurationReady && data?.worker?.healthy ? "emerald" : "red"} right={<span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${configurationReady && data?.worker?.healthy ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>{configurationReady && data?.worker?.healthy ? "Operational" : "Attention required"}</span>} />
        <div className="grid gap-2.5 bg-neutral-50/70 p-3 sm:grid-cols-2 lg:grid-cols-5 sm:p-4">
          {[
            ["Meta app credentials", data?.readiness.appConfigured],
            ["Webhook verification", data?.readiness.webhookConfigured],
            ["WhatsApp signup", data?.readiness.whatsappEmbeddedSignupConfigured],
            ["Instagram OAuth", data?.readiness.instagramOAuthConfigured],
            ["Messaging worker", data?.worker?.healthy],
          ].map(([label, ok]) => <div key={String(label)} className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-3 text-xs font-bold text-neutral-700">{ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}<span>{String(label)}</span></div>)}
        </div>
      </section>

      {(failedJobs + failedOutbound) > 0 && <section className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={ShieldAlert} title="Failures requiring intervention" subtitle="Dead webhook jobs and permanently failed replies" tone="red" right={<CountPill count={failedJobs + failedOutbound} singular="failure" plural="failures" />} />
        <div className="grid gap-3 bg-red-50/40 p-3 lg:grid-cols-2 sm:p-4">
          {data?.failures.webhookJobs.map((job) => <div key={`job-${job.id}`} className="rounded-xl border border-red-100 bg-white p-3.5"><div className="flex items-start justify-between gap-3"><div><p className="m-0 text-xs font-bold text-neutral-900">{job.provider} webhook #{job.id}</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">Property #{job.propertyId || "unmatched"} · {job.eventKind} · {job.attemptCount} attempts</p></div>{job.propertyId && <button type="button" onClick={() => openControl({ kind: "REPLAY", propertyId: job.propertyId!, propertyTitle: `Property #${job.propertyId}` })} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-700">Retry property</button>}</div><p className="mb-0 mt-2 line-clamp-2 text-[11px] leading-4 text-red-700">{job.lastError || "No error detail recorded"}</p></div>)}
          {data?.failures.outboundMessages.map((message) => <div key={`message-${message.id}`} className="rounded-xl border border-red-100 bg-white p-3.5"><div className="flex items-start justify-between gap-3"><div><p className="m-0 text-xs font-bold text-neutral-900">{message.channel} reply · {message.inquiry.reference}</p><p className="mb-0 mt-1 text-[11px] text-neutral-500">{message.inquiry.property.title} · {message.attemptCount} attempts</p></div><button type="button" onClick={() => openControl({ kind: "REPLAY", propertyId: message.inquiry.propertyId, propertyTitle: message.inquiry.property.title })} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-700">Retry property</button></div><p className="mb-0 mt-2 line-clamp-2 text-[11px] leading-4 text-red-700">{message.errorMessage || "No error detail recorded"}</p></div>)}
        </div>
      </section>}

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={MessageCircle} title="Property connections" subtitle="No access tokens or secrets are exposed to this console" right={<CountPill count={filtered.length} singular="connection" plural="connections" />} />
        <div className="flex flex-col gap-2.5 border-b border-neutral-100 px-4 py-3 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search property, owner or Meta account" className="block min-h-9 w-full rounded-lg border border-neutral-200 py-1.5 pl-9 pr-3 text-xs outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></div>
          <select value={provider} onChange={(event) => setProvider(event.target.value)} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600"><option value="">All providers</option><option value="WHATSAPP">WhatsApp</option><option value="INSTAGRAM">Instagram</option></select>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="min-h-9 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600"><option value="">All statuses</option>{Object.keys(STATUS_STYLE).map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[64rem] border-collapse text-left">
            <thead><tr className="border-b border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400"><th className="px-5 py-2.5">Connection</th><th className="px-4 py-2.5">Property & owner</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Webhook</th><th className="px-4 py-2.5">Outbound</th><th className="px-5 py-2.5 text-right">Controls</th></tr></thead>
            <tbody>{filtered.map((connection) => <tr key={connection.id} className="border-b border-neutral-50 text-xs last:border-0 hover:bg-emerald-50/40">
              <td className="px-5 py-3"><div className="flex items-center gap-2.5">{connection.provider === "WHATSAPP" ? <MessageCircle className="h-4 w-4 text-emerald-600" /> : <Instagram className="h-4 w-4 text-fuchsia-600" />}<div><p className="m-0 font-bold text-neutral-900">{connection.displayName || connection.provider}</p><p className="mb-0 mt-0.5 max-w-44 truncate text-[10px] text-neutral-400">{connection.externalAccountId || `Connection #${connection.id}`}</p></div></div></td>
              <td className="px-4 py-3"><Link href={`/admin/nrms/${connection.propertyId}`} className="font-bold text-neutral-800 no-underline hover:text-emerald-700">{connection.property.title}</Link><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{ownerName(connection)}</p></td>
              <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[connection.status] || STATUS_STYLE.ERROR}`}>{connection.status.replaceAll("_", " ")}</span>{connection.lastError && <p className="mb-0 mt-1 max-w-48 truncate text-[10px] text-red-600" title={connection.lastError}>{connection.lastError}</p>}</td>
              <td className="px-4 py-3 text-neutral-500">{shortDate(connection.lastWebhookAt)}</td><td className="px-4 py-3 text-neutral-500">{shortDate(connection.lastOutboundAt)}</td>
              <td className="px-5 py-3"><div className="flex justify-end gap-1.5"><button type="button" onClick={() => void runDiagnostic(connection)} disabled={diagnosingId !== null} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[10px] font-bold text-sky-700 disabled:opacity-40">{diagnosingId === connection.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />} Diagnose</button>{connection.lastError && <button type="button" onClick={() => openControl({ kind: "CLEAR_ERROR", connection })} className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-neutral-600">Clear error</button>}<button type="button" onClick={() => openControl({ kind: "FLAG_REAUTH", connection })} disabled={connection.status === "DISCONNECTED"} className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-bold text-amber-700 disabled:opacity-40">Require login</button><button type="button" onClick={() => openControl({ kind: "DISCONNECT", connection })} disabled={connection.status === "DISCONNECTED"} className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[10px] font-bold text-red-700 disabled:opacity-40"><Unplug className="h-3.5 w-3.5" /></button></div></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!filtered.length && <EmptyState icon={Search} title="No Meta connections found" text={data?.connections.length ? "Change the search or filters to see more connections." : "Property connections will appear here after an owner links Instagram or WhatsApp."} />}
      </section>

      {control && <div className="fixed inset-0 z-[100] flex items-center justify-center bg-neutral-950/60 px-3 py-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="meta-control-title"><div className="w-full max-w-sm rounded-2xl border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]"><div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-3.5"><div><p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Audited Meta control</p><h2 id="meta-control-title" className="m-0 mt-1 text-base font-bold text-neutral-950">{control.kind === "REPLAY" ? `Retry ${control.connection?.property.title || control.propertyTitle || "all"} failures` : control.kind === "FLAG_REAUTH" ? "Require owner reauthorization" : control.kind === "CLEAR_ERROR" ? "Clear stored error" : "Disconnect Meta account"}</h2></div><button type="button" onClick={() => setControl(null)} aria-label="Close control"><X className="h-4 w-4 text-neutral-400" /></button></div><div className="space-y-3 p-4">{control.kind === "DISCONNECT" && <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">This revokes the stored token and removes the linked Meta account identifiers. The owner must connect the account again.</div>}<label htmlFor="meta-control-reason" className="block text-xs font-bold text-neutral-700">Operational reason</label><textarea id="meta-control-reason" autoFocus rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this action required?" className="block min-h-20 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /><p className="m-0 text-[10px] text-neutral-400">At least 8 characters. Saved in the admin audit trail.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setControl(null)} className="rounded-lg border border-neutral-200 px-3.5 py-2 text-xs font-bold text-neutral-600">Cancel</button><button type="button" onClick={() => void submitControl()} disabled={saving || reason.trim().length < 8} className={`inline-flex items-center gap-2 rounded-lg border-0 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50 ${control.kind === "DISCONNECT" ? "bg-red-600" : "bg-emerald-700"}`}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{control.kind === "REPLAY" ? "Queue retry" : control.kind === "DISCONNECT" ? "Disconnect" : "Confirm"}</button></div></div></div></div>}

      {diagnostic && diagnosticConnection && <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-neutral-950/60 px-3 py-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="meta-diagnostic-title"><div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]"><div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-neutral-100 bg-white px-4 py-3.5 sm:px-5"><div className="flex min-w-0 items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${diagnostic.verdict === "HEALTHY" ? "bg-emerald-50 text-emerald-700" : diagnostic.verdict === "ATTENTION_REQUIRED" || diagnostic.verdict === "AWAITING_META_WEBHOOK" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}><ScanSearch className="h-4 w-4" /></span><div className="min-w-0"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Live Meta diagnostic</p><h2 id="meta-diagnostic-title" className="m-0 mt-1 truncate text-base font-bold text-neutral-950">{diagnosticConnection.property.title} · {diagnostic.provider}</h2><p className="mb-0 mt-1 text-[10px] text-neutral-400">Checked {shortDate(diagnostic.checkedAt)} · audit recorded</p></div></div><button type="button" onClick={() => { setDiagnostic(null); setDiagnosticConnection(null); }} className="shrink-0 rounded-lg border border-neutral-200 p-1.5" aria-label="Close diagnostic"><X className="h-4 w-4 text-neutral-400" /></button></div><div className="space-y-4 p-4 sm:p-5"><div className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 ${diagnostic.verdict === "HEALTHY" ? "border-emerald-200 bg-emerald-50" : diagnostic.verdict === "ATTENTION_REQUIRED" || diagnostic.verdict === "AWAITING_META_WEBHOOK" ? "border-amber-200 bg-amber-50" : "border-red-200 bg-red-50"}`}><div><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">Verdict</p><p className="mb-0 mt-1 text-sm font-black text-neutral-900">{diagnostic.verdict.replaceAll("_", " ")}</p></div><span className="text-xs font-bold text-neutral-600">{diagnostic.checks.filter((item) => item.status === "PASS").length}/{diagnostic.checks.length} passed</span></div><div className="space-y-2">{diagnostic.checks.map((item) => <div key={item.id} className="rounded-xl border border-neutral-200 bg-neutral-50/70 p-3.5"><div className="flex items-start gap-3"><span className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.status === "PASS" ? "bg-emerald-500" : item.status === "WARN" ? "bg-amber-400" : "bg-red-500"}`} /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="m-0 text-xs font-bold text-neutral-900">{item.label}</p><span className={`rounded-full px-1.5 py-0.5 text-[9px] font-black ${item.status === "PASS" ? "bg-emerald-100 text-emerald-700" : item.status === "WARN" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>{item.status}</span></div><p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-600">{item.detail}</p></div></div></div>)}</div><div className="flex justify-end gap-2 border-t border-neutral-100 pt-4"><button type="button" onClick={() => void runDiagnostic(diagnosticConnection)} disabled={diagnosingId !== null} className="inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2 text-xs font-bold text-sky-700 disabled:opacity-50">{diagnosingId !== null ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Run again</button><button type="button" onClick={() => { setDiagnostic(null); setDiagnosticConnection(null); }} className="rounded-lg border border-neutral-200 px-3.5 py-2 text-xs font-bold text-neutral-600">Close</button></div></div></div></div>}
    </div>
  );
}
