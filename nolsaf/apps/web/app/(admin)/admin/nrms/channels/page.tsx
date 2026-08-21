"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  BellRing,
  Building2,
  CalendarRange,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  KeyRound,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Unplug,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { SummaryCard } from "../_components/CommercialUi";

type HealthState = "HEALTHY" | "SYNCING" | "ATTENTION" | "CRITICAL" | "PAUSED" | "DISCONNECTED";

type Delivery = {
  id: number;
  eventType: string;
  status: string;
  attemptCount: number;
  lastError: string | null;
  updatedAt: string;
};

type Issue = {
  id: number;
  kind: string;
  severity: string;
  status: string;
  externalRef: string | null;
  internalRef: string | null;
  lastSeenAt: string;
};

type Connection = {
  id: number;
  provider: { id: number; code: string; name: string };
  property: {
    id: number;
    title: string;
    status: string;
    regionName: string | null;
    owner: { id: number; fullName: string | null; name: string | null; email: string };
  };
  connectionType: string;
  status: string;
  trustTier: string;
  externalPropertyId: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  mapping: { property: string; rooms: number; rates: number };
  credential: { active: boolean; version: number | null; activatedAt: string | null };
  alertRoute: { adminsEnabled: boolean; ownerEnabled: boolean; minimumSeverity: "ATTENTION" | "CRITICAL"; cooldownMinutes: number; updatedAt: string | null };
  activeAlerts: Array<{ id: number; kind: string; severity: string; occurrenceCount: number; firstSeenAt: string; lastSeenAt: string; lastNotifiedAt: string | null; details: { reasons?: string[] } | null }>;
  stopSellRequests: Array<{ id: number; action: "APPLY" | "RELEASE"; status: string; fromDate: string; toDate: string; reason: string; requestedById: number; approvedById: number | null; decisionReason: string | null; deliveryId: number | null; requestedAt: string; decidedAt: string | null; providerConfirmedAt: string | null; failedAt: string | null; failureMessage: string | null }>;
  stopSellState: { action: "APPLY" | "RELEASE"; fromDate: string; toDate: string; providerConfirmedAt: string } | null;
  queues: {
    inbound: Record<string, number>;
    outbound: Record<string, number>;
    openIssues: number;
    criticalIssues: number;
    stuckDeliveries: number;
  };
  health: { state: HealthState; lagMinutes: number | null; reasons: string[] };
  lastRun: {
    id: number;
    kind: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    itemCount: number;
    successCount: number;
    failureCount: number;
    errorMessage: string | null;
  } | null;
  recentFailures: Delivery[];
  recentIssues: Issue[];
};

type Overview = {
  summary: { totalConnections: number; byStatus: Record<string, number>; deadLetters: number; openIssues: number };
  providers: Array<{ id: number; code: string; name: string; status: string; _count: { connections: number } }>;
  workers: Array<{ id: number; worker: string; status: string; healthy: boolean; lastSuccessAt: string | null; lastError: string | null }>;
  connections: Connection[];
  pagination: { limit: number; nextCursor: number | null };
};

type ChannelHistory = {
  window: { days: number; from: string; to: string; bucketMinutes: number; truncated: boolean };
  slo: { samples: number; availabilityBps: number | null; p95LagMinutes: number | null; deliverySuccessBps: number | null; attentionSamples: number; criticalSamples: number };
  buckets: Array<{ startedAt: string; samples: number; availabilityBps: number | null; averageLagMinutes: number | null; p95LagMinutes: number | null; deliverySuccessBps: number | null; attentionSamples: number; criticalSamples: number; maxQueueDepth: number }>;
  connections: Array<{ id: number; propertyTitle: string; provider: { code: string; name: string }; samples: number; availabilityBps: number | null; p95LagMinutes: number | null }>;
};

type Action =
  | { kind: "PAUSE" | "RESUME" | "REQUEUE" | "REVOKE"; connection: Connection }
  | { kind: "RETRY"; connection: Connection; delivery: Delivery }
  | { kind: "RESOLVE"; connection: Connection; issue: Issue };

const HEALTH_STYLE: Record<HealthState, string> = {
  HEALTHY: "border-emerald-200 bg-emerald-50 text-emerald-700",
  SYNCING: "border-blue-200 bg-blue-50 text-blue-700",
  ATTENTION: "border-amber-200 bg-amber-50 text-amber-800",
  CRITICAL: "border-red-200 bg-red-50 text-red-700",
  PAUSED: "border-neutral-200 bg-neutral-100 text-neutral-600",
  DISCONNECTED: "border-neutral-300 bg-white text-neutral-600",
};

const ACTION_COPY = {
  PAUSE: { title: "Pause channel", prompt: "Explain why outbound synchronization should be paused.", confirm: "Pause channel", danger: false },
  RESUME: { title: "Resume channel", prompt: "Explain why this channel is safe to resume.", confirm: "Resume channel", danger: false },
  REQUEUE: { title: "Requeue failed deliveries", prompt: "Explain why all failed deliveries should be retried.", confirm: "Requeue deliveries", danger: false },
  REVOKE: { title: "Revoke provider credentials", prompt: "Give the security reason for revoking credentials and disconnecting this channel.", confirm: "Revoke credentials", danger: true },
  RETRY: { title: "Retry delivery", prompt: "Explain why this delivery is ready for another attempt.", confirm: "Retry delivery", danger: false },
  RESOLVE: { title: "Resolve reconciliation issue", prompt: "Record the resolution or evidence used to close this issue.", confirm: "Resolve issue", danger: false },
} as const;

function shortDateTime(value: string | null): string {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function queueCount(connection: Connection, statuses: string[]): number {
  return statuses.reduce((total, status) => total + Number(connection.queues.outbound[status] ?? 0), 0);
}

function ownerName(connection: Connection): string {
  return connection.property.owner.fullName || connection.property.owner.name || connection.property.owner.email;
}

function percentFromBps(value: number | null): string {
  return value == null ? "No evidence" : `${(value / 100).toFixed(2)}%`;
}

function dateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function ChannelAdvancedControls({ connection, onChanged }: { connection: Connection; onChanged: (message: string) => Promise<void> }) {
  type Mode = "ALERTS" | "ROTATION" | "STOP_SELL" | "DECISION";
  const [mode, setMode] = useState<Mode | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [adminsEnabled, setAdminsEnabled] = useState(connection.alertRoute.adminsEnabled);
  const [ownerEnabled, setOwnerEnabled] = useState(connection.alertRoute.ownerEnabled);
  const [minimumSeverity, setMinimumSeverity] = useState<"ATTENTION" | "CRITICAL">(connection.alertRoute.minimumSeverity);
  const [cooldownMinutes, setCooldownMinutes] = useState(connection.alertRoute.cooldownMinutes);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [stopAction, setStopAction] = useState<"APPLY" | "RELEASE">("APPLY");
  const [from, setFrom] = useState(dateInputValue(new Date()));
  const [to, setTo] = useState(dateInputValue(new Date(Date.now() + 30 * 24 * 60 * 60_000)));
  const [decision, setDecision] = useState<"APPROVE" | "REJECT">("APPROVE");
  const [decisionRequest, setDecisionRequest] = useState<Connection["stopSellRequests"][number] | null>(null);

  const pendingRequests = connection.stopSellRequests.filter((request) => request.status === "PENDING_APPROVAL");
  const latestConfirmed = connection.stopSellState;
  const stopSellActive = latestConfirmed?.action === "APPLY";

  function open(nextMode: Mode) {
    setMode(nextMode);
    setReason("");
    setDialogError(null);
    if (nextMode === "ALERTS") {
      setAdminsEnabled(connection.alertRoute.adminsEnabled);
      setOwnerEnabled(connection.alertRoute.ownerEnabled);
      setMinimumSeverity(connection.alertRoute.minimumSeverity);
      setCooldownMinutes(connection.alertRoute.cooldownMinutes);
    }
    if (nextMode === "ROTATION") { setClientId(""); setClientSecret(""); }
    if (nextMode === "STOP_SELL") setStopAction(stopSellActive ? "RELEASE" : "APPLY");
  }

  function openDecision(request: Connection["stopSellRequests"][number], nextDecision: "APPROVE" | "REJECT") {
    setDecisionRequest(request);
    setDecision(nextDecision);
    open("DECISION");
  }

  async function submit() {
    if (!mode || reason.trim().length < 8) return;
    if (mode === "ALERTS" && !adminsEnabled && !ownerEnabled) { setDialogError("Keep at least one alert destination enabled."); return; }
    if (mode === "ROTATION" && (!clientId.trim() || !clientSecret)) { setDialogError("Enter both replacement credential fields."); return; }
    if (mode === "STOP_SELL" && (!from || !to || to < from)) { setDialogError("Choose a valid stop-sell date range."); return; }
    if (mode === "DECISION" && !decisionRequest) return;
    setSaving(true);
    setDialogError(null);
    try {
      let message = "Channel control updated";
      if (mode === "ALERTS") {
        await apiClient.put(`/api/admin/nrms/channels/connections/${connection.id}/alert-route`, { adminsEnabled, ownerEnabled, minimumSeverity, cooldownMinutes, reason: reason.trim() });
        message = `Alert routing updated for ${connection.property.title}.`;
      } else if (mode === "ROTATION") {
        const credentials = connection.provider.code === "EXPEDIA" ? { username: clientId.trim(), password: clientSecret } : { clientId: clientId.trim(), clientSecret };
        await apiClient.post(`/api/admin/nrms/channels/connections/${connection.id}/rotate-credentials`, { ...credentials, reason: reason.trim() });
        setClientSecret("");
        message = `Replacement credentials verified and activated for ${connection.property.title}.`;
      } else if (mode === "STOP_SELL") {
        await apiClient.post(`/api/admin/nrms/channels/connections/${connection.id}/stop-sell/requests`, { action: stopAction, from, to, reason: reason.trim() });
        message = `${stopAction === "APPLY" ? "Stop-sell" : "Inventory release"} sent for independent approval.`;
      } else if (decisionRequest) {
        const response = await apiClient.post(`/api/admin/nrms/channels/stop-sell/requests/${decisionRequest.id}/decision`, { action: decision, reason: reason.trim() });
        message = decision === "REJECT" ? `Stop-sell request #${decisionRequest.id} rejected.` : response.data?.request?.status === "CONFIRMED" ? `Provider confirmed request #${decisionRequest.id}.` : `Request #${decisionRequest.id} approved and queued for provider confirmation.`;
      }
      setMode(null);
      setDecisionRequest(null);
      await onChanged(message);
    } catch (requestError: any) {
      setDialogError(requestError?.response?.data?.error || "The operational control could not be completed");
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "ALERTS" ? "Alert routing" : mode === "ROTATION" ? "Rotate provider credentials" : mode === "STOP_SELL" ? (stopAction === "APPLY" ? "Request emergency stop-sell" : "Request inventory release") : `${decision === "APPROVE" ? "Approve" : "Reject"} request #${decisionRequest?.id ?? ""}`;

  return (
    <div className="mt-4 border-t border-neutral-200 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-600">Advanced operations</h3>
          <p className="mb-0 mt-1 text-[11px] text-neutral-400">Audited alert, credential and inventory controls.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => open("ALERTS")} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[11px] font-bold text-neutral-600 hover:bg-neutral-50"><BellRing className="h-3.5 w-3.5" /> Alert route</button>
          <button type="button" onClick={() => open("ROTATION")} disabled={!["BOOKING_COM", "EXPEDIA"].includes(connection.provider.code)} className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 bg-white px-3 py-2 text-[11px] font-bold text-neutral-600 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-40"><KeyRound className="h-3.5 w-3.5" /> Rotate credentials</button>
          <button type="button" onClick={() => open("STOP_SELL")} disabled={!["BOOKING_COM", "EXPEDIA"].includes(connection.provider.code) || !["ACTIVE", "PILOT"].includes(connection.status)} className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-[11px] font-bold disabled:cursor-not-allowed disabled:opacity-40 ${stopSellActive ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700"}`}><CalendarRange className="h-3.5 w-3.5" /> {stopSellActive ? "Release stop-sell" : "Emergency stop-sell"}</button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-[11px] text-neutral-500"><strong className="block text-neutral-700">Alerts</strong>{connection.alertRoute.minimumSeverity.toLowerCase()}+ · {connection.alertRoute.cooldownMinutes} min · {connection.alertRoute.adminsEnabled ? "admins" : ""}{connection.alertRoute.adminsEnabled && connection.alertRoute.ownerEnabled ? " + " : ""}{connection.alertRoute.ownerEnabled ? "owner" : ""}</div>
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2.5 text-[11px] text-neutral-500"><strong className="block text-neutral-700">Credential version</strong>{connection.credential.active ? `Active v${connection.credential.version}` : "No active credential"}</div>
        <div className={`rounded-md border px-3 py-2.5 text-[11px] ${stopSellActive ? "border-red-200 bg-red-50 text-red-700" : "border-neutral-200 bg-white text-neutral-500"}`}><strong className="block">Inventory control</strong>{stopSellActive ? `Stop-sell confirmed through ${new Date(latestConfirmed!.toDate).toLocaleDateString()}` : "Normal provider inventory"}</div>
      </div>

      {connection.activeAlerts.length ? <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><strong>{connection.activeAlerts[0]?.severity} alert:</strong> {connection.activeAlerts[0]?.details?.reasons?.join(" · ") || "Channel health requires review"}</div> : null}

      {pendingRequests.length ? (
        <div className="mt-3 space-y-2">
          {pendingRequests.map((request) => <div key={request.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5"><div><p className="m-0 text-xs font-bold text-amber-900">#{request.id} · {request.action === "APPLY" ? "Stop-sell" : "Inventory release"} awaiting approval</p><p className="mb-0 mt-0.5 text-[10px] text-amber-700">Requested by admin #{request.requestedById} · {new Date(request.fromDate).toLocaleDateString()}–{new Date(request.toDate).toLocaleDateString()}</p></div><div className="flex gap-2"><button type="button" onClick={() => openDecision(request, "REJECT")} className="rounded-md border border-neutral-200 bg-white px-2.5 py-1.5 text-[10px] font-bold text-neutral-600">Reject</button><button type="button" onClick={() => openDecision(request, "APPROVE")} className="rounded-md border-0 bg-amber-700 px-2.5 py-1.5 text-[10px] font-bold text-white">Approve</button></div></div>)}
        </div>
      ) : null}

      {mode ? (
        <div className="fixed inset-0 z-[120] flex items-center justify-center overflow-y-auto bg-neutral-950/60 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby={`advanced-channel-dialog-${connection.id}`}>
          <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5"><div><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">{connection.provider.name} · {connection.property.title}</p><h2 id={`advanced-channel-dialog-${connection.id}`} className="m-0 mt-1 text-base font-bold text-neutral-950">{title}</h2></div><button type="button" onClick={() => setMode(null)} disabled={saving} className="rounded-md border border-neutral-200 p-1.5 text-neutral-400"><X className="h-4 w-4" /></button></div>
            <div className="space-y-3 p-4 sm:p-5">
              {dialogError ? <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {dialogError}</div> : null}

              {mode === "ALERTS" ? <>
                <div className="grid grid-cols-2 gap-2"><label className="flex items-center gap-2 rounded-md border border-neutral-200 p-3 text-xs font-bold text-neutral-700"><input type="checkbox" checked={adminsEnabled} onChange={(event) => setAdminsEnabled(event.target.checked)} /> Admin operations</label><label className="flex items-center gap-2 rounded-md border border-neutral-200 p-3 text-xs font-bold text-neutral-700"><input type="checkbox" checked={ownerEnabled} onChange={(event) => setOwnerEnabled(event.target.checked)} /> Property owner</label></div>
                <div className="grid grid-cols-2 gap-2"><label className="text-xs font-bold text-neutral-700">Minimum severity<select value={minimumSeverity} onChange={(event) => setMinimumSeverity(event.target.value as "ATTENTION" | "CRITICAL")} className="mt-1.5 h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm"><option value="ATTENTION">Attention</option><option value="CRITICAL">Critical only</option></select></label><label className="text-xs font-bold text-neutral-700">Cooldown minutes<input type="number" min={5} max={1440} value={cooldownMinutes} onChange={(event) => setCooldownMinutes(Number(event.target.value))} className="mt-1.5 h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm" /></label></div>
              </> : null}

              {mode === "ROTATION" ? <><div className="rounded-md border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800">Replacement credentials are verified against the mapped property before the current version is revoked. Secret values are encrypted and never returned.</div><label className="block text-xs font-bold text-neutral-700">{connection.provider.code === "EXPEDIA" ? "API username" : "Client ID"}<input value={clientId} onChange={(event) => setClientId(event.target.value)} autoComplete="off" className="mt-1.5 h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm" /></label><label className="block text-xs font-bold text-neutral-700">{connection.provider.code === "EXPEDIA" ? "API password" : "Client secret"}<input type="password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} autoComplete="new-password" className="mt-1.5 h-10 w-full rounded-md border border-neutral-200 bg-white px-3 text-sm" /></label></> : null}

              {mode === "STOP_SELL" ? <><div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">A different administrator must approve this request. The UI will show queued until the provider acknowledges delivery.</div><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setStopAction("APPLY")} className={`rounded-md border px-3 py-2 text-xs font-bold ${stopAction === "APPLY" ? "border-red-300 bg-red-50 text-red-700" : "border-neutral-200 bg-white text-neutral-500"}`}>Apply stop-sell</button><button type="button" onClick={() => setStopAction("RELEASE")} className={`rounded-md border px-3 py-2 text-xs font-bold ${stopAction === "RELEASE" ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-white text-neutral-500"}`}>Release inventory</button></div><div className="grid grid-cols-2 gap-2"><label className="text-xs font-bold text-neutral-700">From<input type="date" min={dateInputValue(new Date())} value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm" /></label><label className="text-xs font-bold text-neutral-700">Through<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} className="mt-1.5 h-10 w-full rounded-md border border-neutral-200 bg-white px-2 text-sm" /></label></div></> : null}

              {mode === "DECISION" && decisionRequest ? <div className={`rounded-md border p-3 text-xs leading-5 ${decision === "APPROVE" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-neutral-200 bg-neutral-50 text-neutral-700"}`}>{decision === "APPROVE" ? "Approval queues the provider delivery immediately. You cannot approve a request you created." : "Rejection closes the request without changing provider inventory."}<p className="mb-0 mt-2 font-bold">Range: {new Date(decisionRequest.fromDate).toLocaleDateString()}–{new Date(decisionRequest.toDate).toLocaleDateString()}</p></div> : null}

              <label className="block text-xs font-bold text-neutral-700">Operational reason<textarea rows={3} maxLength={300} value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1.5 block min-h-20 w-full resize-none rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" /></label>
              <p className="m-0 text-[10px] text-neutral-400">Saved with administrator, target, time, IP and user agent.</p>
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setMode(null)} disabled={saving} className="rounded-md border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600">Cancel</button><button type="button" onClick={() => void submit()} disabled={saving || reason.trim().length < 8} className={`inline-flex items-center gap-2 rounded-md border-0 px-3.5 py-2 text-xs font-bold text-white disabled:opacity-50 ${mode === "STOP_SELL" && stopAction === "APPLY" || mode === "DECISION" && decision === "APPROVE" ? "bg-amber-700" : "bg-emerald-700"}`}>{saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}{mode === "ALERTS" ? "Save route" : mode === "ROTATION" ? "Verify and rotate" : mode === "STOP_SELL" ? "Request approval" : decision === "APPROVE" ? "Approve and deliver" : "Reject request"}</button></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ChannelControlPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<ChannelHistory | null>(null);
  const [historyDays, setHistoryDays] = useState(7);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [provider, setProvider] = useState("");
  const [status, setStatus] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (appliedQuery) params.set("q", appliedQuery);
      if (provider) params.set("provider", provider);
      if (status) params.set("status", status);
      const response = await apiClient.get<Overview>(`/api/admin/nrms/channels/overview?${params.toString()}`);
      setOverview(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Unable to load OTA channel control");
    } finally {
      setLoading(false);
    }
  }, [appliedQuery, provider, status]);

  useEffect(() => { void load(); }, [load]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const response = await apiClient.get<ChannelHistory>(`/api/admin/nrms/channels/history?days=${historyDays}`);
      setHistory(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Unable to load channel SLO history");
    } finally {
      setHistoryLoading(false);
    }
  }, [historyDays]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function advancedChanged(message: string) {
    setNotice(message);
    await Promise.all([load(), loadHistory()]);
  }

  const activeCount = useMemo(() => {
    const counts = overview?.summary.byStatus ?? {};
    return Number(counts.ACTIVE ?? 0) + Number(counts.PILOT ?? 0);
  }, [overview]);

  function applySearch(event: FormEvent) {
    event.preventDefault();
    setAppliedQuery(query.trim());
  }

  function openAction(next: Action) {
    setAction(next);
    setReason("");
    setConfirmation("");
    setActionError(null);
  }

  async function submitAction() {
    if (!action || reason.trim().length < 8) return;
    if (action.kind === "REVOKE" && confirmation !== "REVOKE") return;
    setSaving(true);
    setActionError(null);
    try {
      let url = "";
      let body: Record<string, string> = { reason: reason.trim() };
      if (action.kind === "PAUSE" || action.kind === "RESUME") {
        url = `/api/admin/nrms/channels/connections/${action.connection.id}/state`;
        body = { ...body, action: action.kind };
      } else if (action.kind === "REQUEUE") {
        url = `/api/admin/nrms/channels/connections/${action.connection.id}/requeue`;
      } else if (action.kind === "REVOKE") {
        url = `/api/admin/nrms/channels/connections/${action.connection.id}/revoke-credentials`;
      } else if (action.kind === "RETRY") {
        url = `/api/admin/nrms/channels/deliveries/${action.delivery.id}/retry`;
      } else if (action.kind === "RESOLVE") {
        url = `/api/admin/nrms/channels/issues/${action.issue.id}/resolve`;
      } else {
        return;
      }
      await apiClient.post(url, body);
      const completed = ACTION_COPY[action.kind].confirm;
      setAction(null);
      setNotice(`${completed} completed for ${action.connection.property.title}.`);
      await load();
    } catch (requestError: any) {
      setActionError(requestError?.response?.data?.error || "The admin action could not be completed");
    } finally {
      setSaving(false);
    }
  }

  const workersNeedingAttention = overview?.workers.filter((worker) => !worker.healthy).length ?? 0;
  const visibleBuckets = history?.buckets.slice(-32) ?? [];
  const maxChartLag = Math.max(1, ...visibleBuckets.map((bucket) => bucket.p95LagMinutes ?? 0));

  if (loading && !overview) {
    return <div className="flex min-h-[45vh] items-center justify-center text-neutral-400"><RefreshCw className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div id="channel-control" className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 py-6">
      <style>{`#channel-control, #channel-control * { box-sizing: border-box; }`}</style>

      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900">
        <ArrowLeft className="h-3.5 w-3.5" /> NRMS directory
      </Link>

      <section className="relative overflow-hidden rounded-xl bg-[linear-gradient(135deg,#ffffff_0%,#f3faf7_70%,#eaf7f3_100%)] p-5 shadow-sm ring-1 ring-inset ring-emerald-100/70 sm:p-6">
        <div className="pointer-events-none absolute -right-12 -top-20 h-56 w-56 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 text-white shadow-sm"><Activity className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS operations</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">OTA channel control</h1>
              <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500 sm:text-sm">Monitor provider health, queues, mapping and reconciliation. Every control action requires a reason and is written to the admin audit trail.</p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg border border-emerald-100 bg-white px-3.5 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </button>
        </div>
      </section>

      {error && <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error}</div>}
      {notice && <div className="flex items-start justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status"><span className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X className="h-4 w-4" /></button></div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Building2} label="Connections" value={String(overview?.summary.totalConnections ?? 0)} detail="Across every provider" tone="blue" />
        <SummaryCard icon={CheckCircle2} label="Active channels" value={String(activeCount)} detail="Active or pilot" tone="emerald" />
        <SummaryCard icon={ShieldAlert} label="Open issues" value={String(overview?.summary.openIssues ?? 0)} detail="Reconciliation review" tone={(overview?.summary.openIssues ?? 0) > 0 ? "amber" : "slate"} />
        <SummaryCard icon={AlertTriangle} label="Dead letters" value={String(overview?.summary.deadLetters ?? 0)} detail={`${workersNeedingAttention} worker alerts`} tone={(overview?.summary.deadLetters ?? 0) > 0 ? "amber" : "slate"} />
      </div>

      <section className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-inset ring-sky-200/70">
        <div className="flex items-start gap-3 bg-sky-50/70 p-5 sm:p-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-sky-700 text-white shadow-sm"><ShieldAlert className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-sky-900">Expedia certification gate</h2>
            <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-sky-800">Code-complete does not mean live. Expedia stays in pilot trust until every step below is signed off. Owners see only an activation notice; this operational checklist lives here and in the connectivity runbook.</p>
          </div>
        </div>
        <ul className="m-0 grid list-none gap-2 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3">
          {["Partner enrollment", "API scopes granted", "Webhook registration", "ARI endpoint assignment", "Sandbox certification", "Reconciled test property"].map((step) => (
            <li key={step} className="flex items-center gap-2 rounded-lg bg-neutral-50/70 px-3 py-2.5 text-xs font-semibold text-neutral-700 ring-1 ring-inset ring-neutral-200/60"><Clock3 className="h-3.5 w-3.5 shrink-0 text-sky-600" />{step}</li>
          ))}
        </ul>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-neutral-50/80 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-blue-100 bg-white text-blue-700"><BarChart3 className="h-4 w-4" /></span><div><h2 className="m-0 text-sm font-bold text-neutral-900">Channel SLO and lag history</h2><p className="mb-0 mt-0.5 text-[11px] text-neutral-400">Persistent operational evidence sampled every five minutes</p></div></div>
          <div className="flex items-center gap-1 rounded-md border border-neutral-200 bg-white p-1">
            {[1, 7, 30, 90].map((days) => <button key={days} type="button" onClick={() => setHistoryDays(days)} className={`rounded px-2.5 py-1.5 text-[10px] font-bold transition ${historyDays === days ? "bg-emerald-700 text-white" : "text-neutral-500 hover:bg-neutral-50"}`}>{days === 1 ? "24h" : `${days}d`}</button>)}
          </div>
        </div>
        <div className="p-4 sm:p-5">
          <div className="grid gap-px overflow-hidden rounded-md border border-neutral-200 bg-neutral-200 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Operational availability", percentFromBps(history?.slo.availabilityBps ?? null), `${history?.slo.samples ?? 0} evidence samples`],
              ["Delivery success", percentFromBps(history?.slo.deliverySuccessBps ?? null), "Acknowledged vs terminal delivery"],
              ["P95 synchronization lag", history?.slo.p95LagMinutes == null ? "No evidence" : `${history.slo.p95LagMinutes} min`, "95th percentile observed lag"],
              ["SLO breach samples", String((history?.slo.attentionSamples ?? 0) + (history?.slo.criticalSamples ?? 0)), `${history?.slo.criticalSamples ?? 0} critical`],
            ].map(([label, value, detail]) => <div key={label} className="min-w-0 bg-white px-3.5 py-3"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p><p className="mb-0 mt-1 truncate text-base font-black text-neutral-900">{value}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{detail}</p></div>)}
          </div>

          {historyLoading && !history ? <div className="flex h-32 items-center justify-center text-neutral-300"><RefreshCw className="h-5 w-5 animate-spin" /></div> : visibleBuckets.length ? (
            <div className="mt-4">
              <div className="flex h-32 min-w-0 items-end gap-1 border-b border-neutral-200 px-1" aria-label="P95 lag history">
                {visibleBuckets.map((bucket) => {
                  const lag = bucket.p95LagMinutes ?? 0;
                  const height = Math.max(4, Math.round((lag / maxChartLag) * 100));
                  const tone = bucket.criticalSamples > 0 ? "bg-red-500" : bucket.attentionSamples > 0 ? "bg-amber-400" : "bg-emerald-500";
                  return <div key={bucket.startedAt} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${shortDateTime(bucket.startedAt)} · p95 lag ${lag} min · queue ${bucket.maxQueueDepth}`}><span className={`block w-full min-w-1 rounded-t-sm ${tone}`} style={{ height: `${height}%` }} /></div>;
                })}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 text-[10px] text-neutral-400"><span>{visibleBuckets[0] ? shortDateTime(visibleBuckets[0].startedAt) : ""}</span><span className="flex flex-wrap justify-center gap-3"><i className="inline-flex items-center gap-1 not-italic"><b className="h-2 w-2 bg-emerald-500" /> within SLO</i><i className="inline-flex items-center gap-1 not-italic"><b className="h-2 w-2 bg-amber-400" /> attention</i><i className="inline-flex items-center gap-1 not-italic"><b className="h-2 w-2 bg-red-500" /> critical</i></span><span>{visibleBuckets.at(-1) ? shortDateTime(visibleBuckets.at(-1)!.startedAt) : ""}</span></div>
              {history?.window.truncated ? <p className="mb-0 mt-2 text-[10px] text-amber-700">This portfolio view reached the 50,000-sample safety limit. Filter to a connection for complete long-range evidence.</p> : null}
            </div>
          ) : <div className="flex h-32 flex-col items-center justify-center text-center"><BarChart3 className="h-5 w-5 text-neutral-300" /><p className="m-0 mt-2 text-xs font-bold text-neutral-600">Evidence collection has started</p><p className="mb-0 mt-1 text-[11px] text-neutral-400">The first chart appears after the channel operations worker records a sample.</p></div>}
          {history?.connections.length ? <div className="mt-4 border-t border-neutral-200 pt-3"><p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Channels needing SLO review</p><div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{[...history.connections].sort((a, b) => (a.availabilityBps ?? 10_001) - (b.availabilityBps ?? 10_001) || (b.p95LagMinutes ?? 0) - (a.p95LagMinutes ?? 0)).slice(0, 6).map((item) => <div key={item.id} className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2"><div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-700">{item.propertyTitle}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">{item.provider.name} · {item.samples} samples</p></div><div className="shrink-0 text-right"><p className="m-0 text-xs font-black text-neutral-800">{percentFromBps(item.availabilityBps)}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">p95 {item.p95LagMinutes == null ? "—" : `${item.p95LagMinutes}m`}</p></div></div>)}</div></div> : null}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)]">
        <div className="border-b border-neutral-200 bg-neutral-50/80 p-4">
          <form onSubmit={applySearch} className="grid gap-2.5 lg:grid-cols-[minmax(15rem,1fr)_12rem_12rem_auto]">
            <label className="relative min-w-0">
              <span className="sr-only">Search channels</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Property, owner or hotel ID" className="h-10 w-full rounded-lg border border-neutral-200 bg-white pl-9 pr-3 text-sm text-neutral-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </label>
            <select value={provider} onChange={(event) => setProvider(event.target.value)} className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" aria-label="Filter by provider">
              <option value="">All providers</option>
              {overview?.providers.map((item) => <option key={item.id} value={item.code}>{item.name} ({item._count.connections})</option>)}
            </select>
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" aria-label="Filter by status">
              <option value="">All statuses</option>
              {["ACTIVE", "PILOT", "PAUSED", "ERROR", "DISCONNECTED"].map((value) => <option key={value} value={value}>{value.toLowerCase().replace("_", " ")}</option>)}
            </select>
            <button type="submit" className="h-10 rounded-lg border-0 bg-emerald-700 px-5 text-xs font-bold text-white transition hover:bg-emerald-800">Search</button>
          </form>
        </div>

        {overview?.workers.length ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-neutral-100 px-4 py-3 text-xs">
            <span className="font-bold text-neutral-500">Workers</span>
            {overview.workers.map((worker) => (
              <span key={worker.worker} className="inline-flex min-w-0 items-center gap-1.5 text-neutral-600" title={worker.lastError || undefined}>
                <span className={`h-2 w-2 shrink-0 rounded-full ${worker.healthy ? "bg-emerald-500" : "bg-amber-500"}`} />
                <span className="max-w-52 truncate">{worker.worker}</span>
                <span className="text-neutral-400">{worker.status}</span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="bg-neutral-50/60 p-3 sm:p-4">
          {!overview?.connections.length && !loading ? (
            <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center">
              <Activity className="h-6 w-6 text-neutral-300" />
              <p className="m-0 mt-3 text-sm font-bold text-neutral-700">No channel connections found</p>
              <p className="mb-0 mt-1 text-xs text-neutral-400">Change the filters or onboard a provider connection from a property.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {overview?.connections.map((connection) => {
                const isExpanded = expanded === connection.id;
                const failed = queueCount(connection, ["FAILED", "DEAD_LETTER"]);
                const waiting = queueCount(connection, ["PENDING", "SENDING"]);
                return (
                  <article key={connection.id} className="min-w-0 overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_8px_25px_-25px_rgba(15,23,42,0.7)]">
                    <div className={`h-1 ${connection.health.state === "CRITICAL" ? "bg-red-500" : connection.health.state === "ATTENTION" ? "bg-amber-400" : connection.health.state === "HEALTHY" ? "bg-emerald-500" : "bg-neutral-300"}`} />
                    <div className="p-4 sm:p-5">
                      <div className="flex min-w-0 flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-md border border-blue-100 bg-blue-50 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700">{connection.provider.name}</span>
                            <span className={`rounded-md border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${HEALTH_STYLE[connection.health.state]}`}>{connection.health.state.toLowerCase()}</span>
                            <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">{connection.status}</span>
                          </div>
                          <h2 className="m-0 mt-2 truncate text-base font-bold text-neutral-950">{connection.property.title}</h2>
                          <p className="mb-0 mt-1 truncate text-xs text-neutral-500">{ownerName(connection)}{connection.property.regionName ? ` · ${connection.property.regionName}` : ""}{connection.externalPropertyId ? ` · Hotel ${connection.externalPropertyId}` : ""}</p>
                        </div>

                        <div className="flex flex-wrap gap-2 xl:justify-end">
                          {connection.status === "PAUSED" ? (
                            <button type="button" onClick={() => openAction({ kind: "RESUME", connection })} className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"><Play className="h-3.5 w-3.5" /> Resume</button>
                          ) : connection.status !== "DISCONNECTED" ? (
                            <button type="button" onClick={() => openAction({ kind: "PAUSE", connection })} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50"><Pause className="h-3.5 w-3.5" /> Pause</button>
                          ) : null}
                          {failed > 0 && ["ACTIVE", "PILOT"].includes(connection.status) ? <button type="button" onClick={() => openAction({ kind: "REQUEUE", connection })} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 transition hover:bg-blue-100"><RotateCcw className="h-3.5 w-3.5" /> Requeue {failed}</button> : null}
                          {connection.credential.active ? <button type="button" onClick={() => openAction({ kind: "REVOKE", connection })} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"><KeyRound className="h-3.5 w-3.5" /> Revoke</button> : null}
                          <button type="button" onClick={() => setExpanded(isExpanded ? null : connection.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50">Details {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-neutral-200 bg-neutral-200 sm:grid-cols-2 xl:grid-cols-5">
                        {[
                          ["Mapping", `${connection.mapping.rooms} rooms · ${connection.mapping.rates} rates`],
                          ["Queue", waiting ? `${waiting} waiting` : "Clear"],
                          ["Failures", failed ? `${failed} delivery` : "None"],
                          ["Issues", connection.queues.openIssues ? `${connection.queues.openIssues} open` : "None"],
                          ["Last success", shortDateTime(connection.lastSuccessAt)],
                        ].map(([label, value]) => (
                          <div key={label} className="min-w-0 bg-white px-3 py-2.5">
                            <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
                            <p className="mb-0 mt-1 truncate text-xs font-bold text-neutral-700" title={value}>{value}</p>
                          </div>
                        ))}
                      </div>

                      {connection.health.reasons.length ? <p className="mb-0 mt-3 text-xs text-amber-700"><span className="font-bold">Health note:</span> {connection.health.reasons.join(" · ")}</p> : null}
                    </div>

                    {isExpanded ? (
                      <div className="border-t border-neutral-200 bg-neutral-50/80 p-4 sm:p-5">
                        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                          <div className="min-w-0 rounded-lg border border-neutral-200 bg-white p-3.5">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-600">Failed deliveries</h3>
                              <span className="text-[10px] text-neutral-400">Latest 5</span>
                            </div>
                            {!connection.recentFailures.length ? <p className="mb-0 mt-3 text-xs text-neutral-400">No failed or dead-letter delivery.</p> : (
                              <div className="mt-2 divide-y divide-neutral-100">
                                {connection.recentFailures.map((delivery) => (
                                  <div key={delivery.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                                    <div className="min-w-0">
                                      <p className="m-0 truncate text-xs font-bold text-neutral-700">{delivery.eventType}</p>
                                      <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400" title={delivery.lastError || undefined}>{delivery.status} · attempt {delivery.attemptCount} · {delivery.lastError || "No error message"}</p>
                                    </div>
                                    {["ACTIVE", "PILOT"].includes(connection.status) ? <button type="button" onClick={() => openAction({ kind: "RETRY", connection, delivery })} className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1.5 text-[10px] font-bold text-blue-700 hover:bg-blue-100">Retry</button> : null}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 rounded-lg border border-neutral-200 bg-white p-3.5">
                            <div className="flex items-center justify-between gap-3">
                              <h3 className="m-0 text-xs font-bold uppercase tracking-wide text-neutral-600">Reconciliation issues</h3>
                              <span className="text-[10px] text-neutral-400">Latest 5</span>
                            </div>
                            {!connection.recentIssues.length ? <p className="mb-0 mt-3 text-xs text-neutral-400">No open reconciliation issue.</p> : (
                              <div className="mt-2 divide-y divide-neutral-100">
                                {connection.recentIssues.map((issue) => (
                                  <div key={issue.id} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
                                    <div className="min-w-0">
                                      <p className="m-0 truncate text-xs font-bold text-neutral-700">{issue.kind}</p>
                                      <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{issue.severity} · {issue.externalRef || issue.internalRef || "No reference"}</p>
                                    </div>
                                    <button type="button" onClick={() => openAction({ kind: "RESOLVE", connection, issue })} className="shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">Resolve</button>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 border-t border-neutral-200 pt-3 text-[11px] text-neutral-500">
                          <span><strong className="text-neutral-700">Credentials:</strong> {connection.credential.active ? `active v${connection.credential.version}` : "none"}</span>
                          <span><strong className="text-neutral-700">Trust:</strong> {connection.trustTier}</span>
                          <span><strong className="text-neutral-700">Last inbound:</strong> {shortDateTime(connection.lastInboundAt)}</span>
                          <span><strong className="text-neutral-700">Last outbound:</strong> {shortDateTime(connection.lastOutboundAt)}</span>
                          <Link href={`/admin/nrms/${connection.property.id}`} className="font-bold text-emerald-700 no-underline hover:text-emerald-900">Open property record</Link>
                        </div>
                        {connection.lastErrorMessage ? <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800"><strong>{connection.lastErrorCode || "Latest error"}:</strong> {connection.lastErrorMessage}</div> : null}
                        <ChannelAdvancedControls connection={connection} onChanged={advancedChanged} />
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {action ? (
        <div className="fixed inset-0 z-[110] flex items-center justify-center overflow-y-auto bg-neutral-950/60 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="channel-action-title">
          <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-xl border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-start justify-between gap-3 border-b border-neutral-100 px-4 py-4 sm:px-5">
              <div className="min-w-0">
                <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">{action.connection.provider.name} · {action.connection.property.title}</p>
                <h2 id="channel-action-title" className="m-0 mt-1 text-base font-bold text-neutral-950">{ACTION_COPY[action.kind].title}</h2>
              </div>
              <button type="button" onClick={() => setAction(null)} disabled={saving} className="rounded-lg border border-neutral-200 p-1.5 text-neutral-400 hover:bg-neutral-50 hover:text-neutral-700" aria-label="Close action dialog"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-4 sm:p-5">
              {actionError ? <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-medium text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {actionError}</div> : null}
              {action.kind === "REVOKE" ? <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700"><Unplug className="mt-0.5 h-4 w-4 shrink-0" /> This disconnects the channel, revokes active and staged credentials, and stops queued deliveries. Reconnection must use the property onboarding flow.</div> : null}
              <div>
                <label htmlFor="channel-action-reason" className="block text-xs font-bold text-neutral-700">Operational reason</label>
                <p className="mb-2 mt-0.5 text-[11px] leading-4 text-neutral-400">{ACTION_COPY[action.kind].prompt}</p>
                <textarea id="channel-action-reason" autoFocus rows={3} maxLength={300} value={reason} onChange={(event) => { setReason(event.target.value); setActionError(null); }} className="block min-h-24 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
                <p className="mb-0 mt-1 text-right text-[10px] text-neutral-400">{reason.trim().length}/300 · minimum 8</p>
              </div>
              {action.kind === "REVOKE" ? (
                <div>
                  <label htmlFor="channel-revoke-confirmation" className="block text-xs font-bold text-neutral-700">Type REVOKE to confirm</label>
                  <input id="channel-revoke-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value.toUpperCase())} autoComplete="off" className="mt-2 h-10 w-full rounded-lg border border-red-200 bg-red-50/50 px-3 text-sm font-bold tracking-wide text-red-800 outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100" />
                </div>
              ) : null}
              <p className="m-0 flex items-center gap-1.5 text-[10px] text-neutral-400"><Clock3 className="h-3 w-3" /> The reason, administrator, time, IP and target are audited.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setAction(null)} disabled={saving} className="rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={() => void submitAction()} disabled={saving || reason.trim().length < 8 || (action.kind === "REVOKE" && confirmation !== "REVOKE")} className={`inline-flex items-center justify-center gap-2 rounded-lg border-0 px-3.5 py-2 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${ACTION_COPY[action.kind].danger ? "bg-red-600 hover:bg-red-700" : "bg-emerald-700 hover:bg-emerald-800"}`}>
                  {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                  {ACTION_COPY[action.kind].confirm}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
