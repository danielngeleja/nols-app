"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, ChevronDown, Clock3, Cpu, Power, QrCode, RefreshCw, ShieldAlert, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Worker = { worker: string; status: string; healthy: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null };

const AUTO_REFRESH_SECONDS = 60;
const SHUTDOWN_WORD = "SHUTDOWN";

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ago(value: string | null | undefined, now: number): string {
  if (!value) return "Never";
  const secs = Math.max(0, Math.round((now - new Date(value).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

// "nrms-dunning-worker" -> "Dunning worker"
function workerName(value: string) {
  const text = value.replace(/^nrms[-_.]?/i, "").replace(/[-_.]+/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : value;
}

export default function NrmsHealthPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [openError, setOpenError] = useState<string | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<boolean | null>(null);
  const [qrReason, setQrReason] = useState("");
  const [qrConfirmWord, setQrConfirmWord] = useState("");
  const [qrDialogError, setQrDialogError] = useState<string | null>(null);
  const [qrSaving, setQrSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setHealth((await apiClient.get("/api/admin/nrms/system/health")).data);
      setCheckedAt(Date.now());
      setMessage(null);
    } catch (error: any) {
      setMessage(error?.response?.data?.error || "Unable to load NRMS health");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // One ticking clock drives "x min ago" labels and the auto refresh countdown.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  const nextRefreshIn = checkedAt ? Math.max(0, AUTO_REFRESH_SECONDS - Math.floor((now - checkedAt) / 1000)) : AUTO_REFRESH_SECONDS;
  useEffect(() => {
    if (autoRefresh && !qrDialogOpen && checkedAt && nextRefreshIn === 0 && !loading) void load();
  }, [autoRefresh, qrDialogOpen, checkedAt, nextRefreshIn, loading, load]);

  useEffect(() => {
    if (!qrDialogOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !qrSaving) setQrDialogOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [qrDialogOpen, qrSaving]);

  function openQrDialog(enabled: boolean) {
    setQrTarget(enabled);
    setQrReason("");
    setQrConfirmWord("");
    setQrDialogError(null);
    setQrDialogOpen(true);
  }

  async function submitQrOrdering() {
    if (qrTarget === null) return;
    const reason = qrReason.trim();
    if (reason.length < 5) {
      setQrDialogError("Enter at least five characters explaining this change.");
      return;
    }
    if (!qrTarget && qrConfirmWord.trim().toUpperCase() !== SHUTDOWN_WORD) {
      setQrDialogError(`Type ${SHUTDOWN_WORD} to confirm the shutdown.`);
      return;
    }
    setQrSaving(true);
    setMessage(null);
    try {
      await apiClient.post("/api/admin/nrms/system/qr-ordering", { enabled: qrTarget, reason });
      setQrDialogOpen(false);
      setQrTarget(null);
      await load();
    } catch (error: any) {
      setQrDialogError(error?.response?.data?.error || "The QR control could not be changed");
    } finally {
      setQrSaving(false);
    }
  }

  const qrEnabled = health?.qrOrdering?.enabled !== false;
  const workers: Worker[] = useMemo(
    () => [...(health?.workers ?? [])].sort((a: Worker, b: Worker) => Number(a.healthy) - Number(b.healthy) || a.worker.localeCompare(b.worker)),
    [health],
  );
  const unhealthyCount = workers.filter((w) => !w.healthy).length;

  // Overall status, in priority order.
  const overall = !health
    ? { key: "unknown", title: "Status unavailable", text: "The health check could not be loaded.", tone: "neutral" as const }
    : !qrEnabled
      ? { key: "shutdown", title: "Guest QR ordering is shut down", text: "Emergency stop is active. Staff ordering keeps working.", tone: "red" as const }
      : unhealthyCount > 0
        ? { key: "degraded", title: `${unhealthyCount} ${unhealthyCount === 1 ? "worker needs" : "workers need"} attention`, text: "Guest ordering is live, but background jobs are behind.", tone: "amber" as const }
        : workers.length === 0
          ? { key: "nodata", title: "Ordering live, no worker data", text: "No heartbeat has been recorded yet.", tone: "sky" as const }
          : { key: "ok", title: "All systems operational", text: "Guest ordering is live and every worker checked in.", tone: "emerald" as const };

  const TONE = {
    emerald: { band: "border-emerald-200 bg-emerald-50", dot: "bg-emerald-500", ping: "bg-emerald-400", title: "text-emerald-950", text: "text-emerald-800/80" },
    amber: { band: "border-amber-200 bg-amber-50", dot: "bg-amber-500", ping: "bg-amber-400", title: "text-amber-950", text: "text-amber-800/80" },
    red: { band: "border-rose-200 bg-rose-50", dot: "bg-rose-600", ping: "bg-rose-400", title: "text-rose-950", text: "text-rose-800/80" },
    sky: { band: "border-sky-200 bg-sky-50", dot: "bg-sky-500", ping: "bg-sky-400", title: "text-sky-950", text: "text-sky-800/80" },
    neutral: { band: "border-neutral-200 bg-neutral-50", dot: "bg-neutral-400", ping: "bg-neutral-300", title: "text-neutral-900", text: "text-neutral-600" },
  }[overall.tone];

  if (loading && !health && !message) {
    return <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-neutral-500"><RefreshCw className="h-4 w-4 animate-spin" /> Checking NRMS health</div>;
  }

  const shutdownReady = qrReason.trim().length >= 5 && (qrTarget || qrConfirmWord.trim().toUpperCase() === SHUTDOWN_WORD);

  return (
    <div className="space-y-5 w-full min-w-0">
      {/* Top bar: back link + check controls */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/admin/nrms" className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 no-underline transition hover:text-neutral-900">
          <ArrowLeft className="h-3.5 w-3.5" /> NRMS directory
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-xs font-semibold text-neutral-900">System health</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={autoRefresh}
            onClick={() => setAutoRefresh((v) => !v)}
            className="inline-flex h-8 items-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 text-xs text-neutral-600 transition hover:bg-neutral-50"
            title="Refresh automatically every minute"
          >
            <span className={`relative inline-flex h-4 w-7 rounded-full transition-colors ${autoRefresh ? "bg-emerald-600" : "bg-neutral-300"}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${autoRefresh ? "left-3.5" : "left-0.5"}`} />
            </span>
            <span className="tabular-nums">{autoRefresh ? `Auto in ${nextRefreshIn}s` : "Auto off"}</span>
          </button>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Check now
          </button>
        </div>
      </div>

      {/* Status banner */}
      <section className={`relative overflow-hidden rounded-2xl border border-solid ${TONE.band}`}>
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: "linear-gradient(to right, rgba(0,0,0,0.05) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.05) 1px, transparent 1px)", backgroundSize: "22px 22px" }}
          aria-hidden
        />
        <div className="relative flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
          <span className="relative flex h-4 w-4 flex-shrink-0">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${TONE.ping}`} />
            <span className={`relative inline-flex h-4 w-4 rounded-full ${TONE.dot}`} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 font-mono text-[11px] uppercase tracking-[0.18em] text-neutral-500">NRMS system health</p>
            <h1 className={`m-0 mt-0.5 text-xl font-bold tracking-tight sm:text-2xl ${TONE.title}`}>{overall.title}</h1>
            <p className={`m-0 mt-0.5 text-sm ${TONE.text}`}>{overall.text}</p>
          </div>
          <dl className="m-0 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-solid border-black/5 bg-black/5 text-center sm:w-[22rem]">
            {[
              { label: "Guest QR", value: qrEnabled ? "On" : "Off", cls: qrEnabled ? "text-emerald-700" : "text-rose-600" },
              { label: "Workers", value: String(workers.length), cls: "text-neutral-900" },
              { label: "Failing", value: String(unhealthyCount), cls: unhealthyCount ? "text-amber-700" : "text-neutral-400" },
            ].map((s) => (
              <div key={s.label} className="bg-white/80 px-3 py-2.5">
                <dt className="text-[10px] uppercase tracking-[0.12em] text-neutral-400">{s.label}</dt>
                <dd className={`m-0 mt-0.5 font-mono text-lg font-bold tabular-nums ${s.cls}`}>{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative flex items-center gap-1.5 border-0 border-t border-solid border-black/5 bg-white/50 px-5 py-2 font-mono text-[11px] text-neutral-500 sm:px-6">
          <Clock3 className="h-3 w-3" /> Last checked {checkedAt ? `${ago(new Date(checkedAt).toISOString(), now)} · ${new Date(checkedAt).toLocaleTimeString("en-GB")}` : "never"}
        </div>
      </section>

      {message && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span className="flex-1">{message}</span>
          <button type="button" onClick={() => setMessage(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-amber-800 hover:underline">Dismiss</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        {/* Emergency control panel */}
        <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-5 py-3">
            <ShieldAlert className="h-4 w-4 text-rose-600" />
            <h2 className="m-0 text-sm font-bold text-neutral-900">Emergency control</h2>
            <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-neutral-400">All properties</span>
          </div>

          <div className="flex flex-1 flex-col items-center px-5 py-6 text-center">
            {/* Physical-style switch that shows the real state */}
            <div className={`flex h-24 w-14 flex-col items-center rounded-full border-2 border-solid p-1.5 transition-colors ${qrEnabled ? "justify-start border-emerald-200 bg-emerald-50" : "justify-end border-rose-200 bg-rose-50"}`} aria-hidden>
              <span className={`flex h-10 w-10 items-center justify-center rounded-full shadow-md ${qrEnabled ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
                <Power className="h-5 w-5" />
              </span>
            </div>
            <p className="m-0 mt-4 flex items-center gap-2 text-xs font-medium text-neutral-500"><QrCode className="h-3.5 w-3.5" /> Guest QR menus and ordering</p>
            <p className={`m-0 mt-1 font-mono text-2xl font-bold tracking-tight ${qrEnabled ? "text-emerald-700" : "text-rose-600"}`}>{qrEnabled ? "LIVE" : "SHUT DOWN"}</p>
            <p className="m-0 mt-1 max-w-xs text-xs text-neutral-500">
              {qrEnabled ? "Guests can scan and order at every property." : "Public menus are blocked everywhere. Staff ordering is unaffected."}
            </p>

            <button
              type="button"
              onClick={() => openQrDialog(!qrEnabled)}
              className={`mt-5 inline-flex h-11 w-full max-w-xs items-center justify-center gap-2 rounded-xl border-0 text-sm font-semibold text-white transition ${qrEnabled ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-700 hover:bg-emerald-800"}`}
            >
              <Power className="h-4 w-4" /> {qrEnabled ? "Shut down QR ordering" : "Restore QR ordering"}
            </button>
          </div>

          <div className="border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-5 py-3">
            <p className="m-0 font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-400">Last change</p>
            {health?.qrOrdering?.changedAt ? (
              <div className="mt-1.5 flex items-start gap-2.5">
                <span className={`mt-1 h-2 w-2 flex-shrink-0 rounded-full ${qrEnabled ? "bg-emerald-500" : "bg-rose-500"}`} />
                <div className="min-w-0">
                  <p className="m-0 text-xs text-neutral-800">
                    {qrEnabled ? "Restored" : "Shut down"} <span className="text-neutral-400">· {ago(health.qrOrdering.changedAt, now)} · {shortDateTime(health.qrOrdering.changedAt)}</span>
                  </p>
                  <p className="m-0 mt-0.5 text-xs italic text-neutral-500">&ldquo;{health.qrOrdering.reason || "No reason recorded"}&rdquo;</p>
                </div>
              </div>
            ) : (
              <p className="m-0 mt-1 text-xs text-neutral-500">No changes recorded. Ordering has been live since setup.</p>
            )}
          </div>
        </section>

        {/* Workers */}
        <section className="min-w-0 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
          <div className="flex items-center gap-2 border-0 border-b border-solid border-neutral-100 px-5 py-3">
            <Activity className="h-4 w-4 text-neutral-500" />
            <h2 className="m-0 text-sm font-bold text-neutral-900">Background workers</h2>
            <span className="ml-auto inline-flex items-center gap-3 font-mono text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{workers.length - unhealthyCount} ok</span>
              <span className="inline-flex items-center gap-1"><span className={`h-1.5 w-1.5 rounded-full ${unhealthyCount ? "bg-amber-500" : "bg-neutral-300"}`} />{unhealthyCount} failing</span>
            </span>
          </div>
          <p className="m-0 border-0 border-b border-solid border-neutral-100 px-5 py-2 text-xs text-neutral-500">Jobs that keep dunning, signals and retention current. Failing workers are listed first.</p>

          {workers.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-100 text-neutral-400"><Cpu className="h-5 w-5" /></span>
              <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No worker heartbeat recorded</p>
              <p className="m-0 mt-1 text-xs text-neutral-500">Start the NRMS workers after applying the migration to begin monitoring.</p>
            </div>
          ) : (
            <ul className="m-0 list-none p-0">
              {workers.map((worker) => {
                const expanded = openError === worker.worker;
                return (
                  <li key={worker.worker} className={`border-0 border-b border-solid border-neutral-100 last:border-b-0 ${worker.healthy ? "" : "bg-amber-50/40"}`}>
                    <div className="flex items-center gap-3 px-5 py-3">
                      <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${worker.healthy ? "bg-emerald-50 text-emerald-600" : "bg-amber-100 text-amber-700"}`}>
                        {worker.healthy ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 flex flex-wrap items-center gap-x-2 text-sm">
                          <span className="font-semibold text-neutral-900">{workerName(worker.worker)}</span>
                          <span className="font-mono text-[11px] text-neutral-400">{worker.worker}</span>
                        </p>
                        <p className="m-0 mt-0.5 text-xs text-neutral-500">
                          Last success <span className={worker.healthy ? "text-neutral-700" : "font-medium text-amber-800"} title={worker.lastSuccessAt ? shortDateTime(worker.lastSuccessAt) : undefined}>{ago(worker.lastSuccessAt, now)}</span>
                          {worker.lastFailureAt && <> · last failure <span className="text-neutral-700" title={shortDateTime(worker.lastFailureAt)}>{ago(worker.lastFailureAt, now)}</span></>}
                        </p>
                      </div>
                      <span className={`flex-shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold uppercase ${worker.healthy ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>{worker.status}</span>
                      {worker.lastError && (
                        <button
                          type="button"
                          onClick={() => setOpenError(expanded ? null : worker.worker)}
                          aria-expanded={expanded}
                          className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                          aria-label={expanded ? "Hide last error" : "Show last error"}
                        >
                          <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
                        </button>
                      )}
                    </div>
                    {worker.lastError && expanded && (
                      <pre className="m-0 mx-5 mb-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-neutral-900 px-3 py-2.5 font-mono text-[11px] leading-5 text-amber-200">{worker.lastError}</pre>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {qrDialogOpen && qrTarget !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-neutral-950/60 px-3 py-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="qr-control-dialog-title" onMouseDown={() => { if (!qrSaving) setQrDialogOpen(false); }}>
          <div className="my-auto w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-[0_28px_80px_rgba(0,0,0,0.3)]" onMouseDown={(e) => e.stopPropagation()}>
            <div className={`flex items-start gap-3 px-5 py-4 ${qrTarget ? "bg-emerald-600" : "bg-rose-600"} text-white`}>
              <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-white/15"><Power className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 font-mono text-[10px] uppercase tracking-[0.16em] text-white/70">NRMS emergency control</p>
                <h2 id="qr-control-dialog-title" className="m-0 mt-0.5 text-lg font-bold">{qrTarget ? "Restore QR ordering" : "Shut down QR ordering"}</h2>
              </div>
              <button type="button" onClick={() => setQrDialogOpen(false)} disabled={qrSaving} className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border-0 bg-white/10 text-white/80 hover:bg-white/20" aria-label="Close QR ordering confirmation"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-3.5 px-5 py-4">
              <div className={`rounded-lg px-3 py-2.5 text-xs ${qrTarget ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900"}`}>
                {qrTarget
                  ? "Guests at every property will be able to scan menus and place orders again immediately."
                  : "Guests at every property will immediately lose access to QR menus and ordering. Staff ordering keeps working."}
              </div>

              {qrDialogError && <div className="flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700" role="alert"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {qrDialogError}</div>}

              <label htmlFor="qr-control-reason" className="block text-xs font-semibold text-neutral-700">
                Reason for this change
                <textarea
                  id="qr-control-reason"
                  autoFocus
                  rows={3}
                  value={qrReason}
                  onChange={(event) => { setQrReason(event.target.value); setQrDialogError(null); }}
                  placeholder={qrTarget ? "What was fixed, and why it is safe to restore" : "What is happening, for example a payment outage"}
                  className="mt-1.5 block min-h-20 w-full resize-none rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2.5 font-[inherit] text-sm font-normal text-neutral-900 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-100"
                />
                <span className="mt-1 flex justify-between text-[11px] font-normal text-neutral-400">
                  <span>Saved to the admin audit trail</span>
                  <span className="tabular-nums">{qrReason.trim().length < 5 ? `${5 - qrReason.trim().length} more` : "OK"}</span>
                </span>
              </label>

              {!qrTarget && (
                <label htmlFor="qr-control-confirm" className="block text-xs font-semibold text-neutral-700">
                  Type <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-rose-700">{SHUTDOWN_WORD}</span> to confirm
                  <input
                    id="qr-control-confirm"
                    value={qrConfirmWord}
                    onChange={(e) => { setQrConfirmWord(e.target.value); setQrDialogError(null); }}
                    autoComplete="off"
                    spellCheck={false}
                    className="mt-1.5 block h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 font-mono text-sm uppercase tracking-[0.1em] text-neutral-900 outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100"
                  />
                </label>
              )}
            </div>

            <div className="flex justify-end gap-2 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-5 py-3">
              <button type="button" onClick={() => setQrDialogOpen(false)} disabled={qrSaving} className="h-10 rounded-lg border border-solid border-neutral-200 bg-white px-4 text-sm font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={() => void submitQrOrdering()} disabled={qrSaving || !shutdownReady} className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border-0 px-4 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${qrTarget ? "bg-emerald-700 hover:bg-emerald-800" : "bg-rose-600 hover:bg-rose-700"}`}>
                {qrSaving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
                {qrTarget ? "Restore now" : "Shut down now"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
