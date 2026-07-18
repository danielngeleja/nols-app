"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Power, RefreshCw, ShieldAlert, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { CountPill, EmptyState, SectionHeader, SummaryCard } from "../_components/CommercialUi";

type Worker = { worker: string; status: string; healthy: boolean; lastSuccessAt: string | null; lastFailureAt: string | null; lastError: string | null };

function shortDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function NrmsHealthPage() {
  const [health, setHealth] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [qrDialogOpen, setQrDialogOpen] = useState(false);
  const [qrTarget, setQrTarget] = useState<boolean | null>(null);
  const [qrReason, setQrReason] = useState("");
  const [qrDialogError, setQrDialogError] = useState<string | null>(null);
  const [qrSaving, setQrSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setHealth((await apiClient.get("/api/admin/nrms/system/health")).data); }
    catch (error: any) { setMessage(error?.response?.data?.error || "Unable to load NRMS health"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  function openQrDialog(enabled: boolean) {
    setQrTarget(enabled);
    setQrReason("");
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
  const workers: Worker[] = health?.workers ?? [];
  const unhealthyCount = workers.filter((w) => !w.healthy).length;

  if (loading && !health) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><RefreshCw className="h-6 w-6 animate-spin" /></div>;

  return (
    <div id="nrms-health" className="mx-auto min-w-0 max-w-6xl space-y-5 px-4 py-6">
      {/* Preflight is disabled in this project; without border-box, w-full controls overflow their container */}
      <style>{`#nrms-health, #nrms-health * { box-sizing: border-box; }`}</style>

      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">HEALTH</div>
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><ShieldAlert className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">NRMS commercial</p>
                <span className="inline-flex rounded-full border border-emerald-100 bg-white px-2 py-0.5 text-[10px] font-bold text-emerald-700 shadow-sm">Emergency controls</span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">System health</h1>
              <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500 sm:text-sm">Persistent worker status and the global QR ordering kill switch.</p>
            </div>
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2.5 text-xs font-bold text-emerald-800 shadow-sm transition hover:bg-white"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh</button>
        </div>
      </section>

      {message && <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-sm font-medium text-amber-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> <span>{message}</span></div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard icon={Power} label="Global QR ordering" value={qrEnabled ? "Operational" : "Shut down"} detail={qrEnabled ? "Public menus are live" : "Emergency shutdown active"} tone={qrEnabled ? "emerald" : "amber"} />
        <SummaryCard icon={Activity} label="Worker heartbeat" value={workers.length ? (unhealthyCount > 0 ? "Attention" : "Healthy") : "No data"} detail={`${workers.length} monitored ${workers.length === 1 ? "worker" : "workers"}`} tone={unhealthyCount > 0 ? "amber" : "emerald"} />
        <SummaryCard icon={ShieldAlert} label="Workers needing attention" value={String(unhealthyCount)} detail="Missed heartbeat or failed run" tone={unhealthyCount > 0 ? "amber" : "slate"} />
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Power} title="Global QR ordering" subtitle="Emergency stop for public guest ordering across every property" tone={qrEnabled ? "emerald" : "red"} right={<span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${qrEnabled ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"}`}>{qrEnabled ? "Operational" : "Shut down"}</span>} />
        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${qrEnabled ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-red-100 bg-red-50 text-red-700"}`}><Power className="h-5 w-5" /></span>
              <p className="m-0 text-sm text-neutral-600">{qrEnabled ? "Public QR menus and ordering are enabled for all properties." : "Emergency shutdown is active. Staff ordering is unaffected."}</p>
            </div>
            <button type="button" onClick={() => openQrDialog(!qrEnabled)} className={`shrink-0 rounded-lg border-0 px-4 py-2.5 text-xs font-bold text-white transition ${qrEnabled ? "bg-red-600 hover:bg-red-700" : "bg-emerald-700 hover:bg-emerald-800"}`}>{qrEnabled ? "Shut down QR ordering" : "Restore QR ordering"}</button>
          </div>
          {health?.qrOrdering?.changedAt && (
            <div className="mt-4 rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-2.5">
              <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-400">Last change</p>
              <p className="mb-0 mt-0.5 text-xs font-medium text-neutral-700">{shortDateTime(health.qrOrdering.changedAt)}</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">{health.qrOrdering.reason || "No reason recorded"}</p>
            </div>
          )}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Activity} title="Worker heartbeat" subtitle="Background jobs that keep dunning, signals and retention current" right={<CountPill count={workers.length} singular="worker" plural="workers" />} />
        <div className="bg-neutral-50/70 p-3 sm:p-4">
          {!loading && workers.length === 0 && <EmptyState icon={Activity} title="No worker heartbeat recorded" text="Start the NRMS workers after applying the migration to begin monitoring." />}
          <div className="space-y-2.5">
            {workers.map((worker) => (
              <div key={worker.worker} className="relative overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_8px_24px_-24px_rgba(15,23,42,0.7)]">
                <span className={`absolute inset-y-0 left-0 w-1 ${worker.healthy ? "bg-emerald-500" : "bg-amber-400"}`} aria-hidden="true" />
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 pl-4 sm:p-4 sm:pl-5">
                  <div className="flex min-w-0 items-center gap-3">
                    {worker.healthy ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" /> : <ShieldAlert className="h-4 w-4 shrink-0 text-amber-600" />}
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-bold text-neutral-900">{worker.worker}</p>
                      <p className="mb-0 mt-0.5 text-xs text-neutral-500">Last success {worker.lastSuccessAt ? shortDateTime(worker.lastSuccessAt) : "Never"}</p>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${worker.healthy ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>{worker.status}</span>
                    {worker.lastError && <p className="mb-0 mt-1 max-w-sm truncate text-[10px] text-amber-700" title={worker.lastError}>{worker.lastError}</p>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {qrDialogOpen && qrTarget !== null && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-neutral-950/60 px-3 py-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="qr-control-dialog-title">
          <div className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-[22rem] overflow-y-auto rounded-2xl border border-white/70 bg-white shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="border-b border-neutral-100 px-4 py-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${qrTarget ? "bg-emerald-500" : "bg-red-500"}`} aria-hidden="true" />
                    <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">NRMS control</p>
                  </div>
                  <h2 id="qr-control-dialog-title" className="mt-1 text-base font-bold tracking-tight text-neutral-950">{qrTarget ? "Restore QR ordering" : "Shut down QR ordering"}</h2>
                </div>
                <button type="button" onClick={() => setQrDialogOpen(false)} className="shrink-0 rounded-lg border border-neutral-200 p-1.5 text-neutral-400 transition hover:bg-neutral-50 hover:text-neutral-700" aria-label="Close QR ordering confirmation"><X className="h-4 w-4" /></button>
              </div>
            </div>

            <div className="space-y-2.5 p-4">
              {qrDialogError && <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs font-medium text-red-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {qrDialogError}</div>}
              <label htmlFor="qr-control-reason" className="block text-xs font-bold text-neutral-700">Reason for this change</label>
              <textarea id="qr-control-reason" autoFocus rows={3} value={qrReason} onChange={(event) => { setQrReason(event.target.value); setQrDialogError(null); }} placeholder={qrTarget ? "Why restore QR ordering?" : "Why shut down QR ordering?"} className="block min-h-20 w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
              <p className="m-0 text-[10px] leading-4 text-neutral-400">Saved to the admin audit trail.</p>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setQrDialogOpen(false)} disabled={qrSaving} className="rounded-lg border border-neutral-200 bg-white px-3.5 py-2 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
                <button type="button" onClick={() => void submitQrOrdering()} disabled={qrSaving || qrReason.trim().length < 5} className={`inline-flex items-center justify-center gap-2 rounded-lg border-0 px-3.5 py-2 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-50 ${qrTarget ? "bg-emerald-700 hover:bg-emerald-800" : "bg-red-600 hover:bg-red-700"}`}>
                  {qrSaving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : null}
                  {qrTarget ? "Restore QR" : "Confirm shutdown"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
