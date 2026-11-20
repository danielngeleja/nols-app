"use client";

/**
 * Admin: a partner's right to list properties for owners (assisted listing,
 * docs/SALES_ASSISTED_LISTING.md), inside the partner record. Enable, pause,
 * unpause or remove it; every action needs a reason and is audited. The
 * right pauses itself when owners say they did not agree to a listing.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Loader2, PauseCircle, PlayCircle, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";

type State = {
  enabledAt: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  upheldObjections: number;
  counts: Record<string, number>;
};
type Action = "ENABLE" | "DISABLE" | "PAUSE" | "UNPAUSE";

const card = "overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white";
const head = "m-0 border-0 border-b border-solid border-neutral-100 bg-neutral-50 px-4 py-2 text-[12px] font-semibold text-neutral-700";
const field = "h-10 w-full min-w-0 rounded-md border border-solid border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-400";
const btn = "inline-flex h-10 items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const primary = "inline-flex h-10 items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3.5 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50";

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

export default function PartnerAssistedListingAdmin({ partnerId, partnerActive }: { partnerId: number; partnerActive: boolean }) {
  const [state, setState] = useState<State | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/api/admin/sales/partners/${partnerId}/assisted-listing`);
      setState(data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load this right");
    }
  }, [partnerId]);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: Action) => {
    if (reason.trim().length < 5) {
      setError("Write a reason of at least 5 characters first.");
      return;
    }
    setBusy(action);
    setError("");
    try {
      await apiClient.post(`/api/admin/sales/partners/${partnerId}/assisted-listing`, { action, reason: reason.trim() });
      setReason("");
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "That did not work");
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return <div className="grid min-h-32 place-items-center text-neutral-500">{error ? <p className="m-0 text-sm text-rose-700">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" />}</div>;
  }

  const on = Boolean(state.enabledAt);
  const paused = Boolean(state.pausedAt);
  const total = (key: string) => state.counts[key] ?? 0;

  return (
    <div className="space-y-4">
      <section className={card}>
        <p className={head}>List properties for owners</p>
        <div className="space-y-3 p-4">
          <p className="m-0 flex items-start gap-2 text-sm text-neutral-700">
            <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
            Lets this partner fill in the listing for an owner who agreed in person. The owner only gets SMS updates and adds their own payout details. Owner queries pause a listing at once.
          </p>
          <p className="m-0">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${!on ? "bg-neutral-100 text-neutral-600" : paused ? "bg-orange-50 text-orange-800" : "bg-emerald-50 text-emerald-800"}`}>
              {!on ? "Not enabled" : paused ? "Paused" : `Enabled since ${eat(state.enabledAt)}`}
            </span>
          </p>
          {paused && state.pauseReason ? (
            <p className="m-0 flex items-start gap-2 text-sm text-orange-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{state.pauseReason}</p>
          ) : null}
          <dl className="m-0 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            {[
              ["Being listed", total("DRAFTING") + total("RETURNED")],
              ["In review", total("SUBMITTED")],
              ["Live", total("APPROVED")],
              ["Owner queries", total("PAUSED_OBJECTION")],
              ["Owners said no", state.upheldObjections],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-md bg-neutral-50 px-3 py-2">
                <dt className="text-[11px] text-neutral-500">{label}</dt>
                <dd className="m-0 font-semibold tabular-nums text-neutral-900">{value}</dd>
              </div>
            ))}
          </dl>
          <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason (required, kept in the audit log)" maxLength={300} className={field} />
          {error ? <p className="m-0 text-sm text-rose-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            {!on ? (
              <button type="button" disabled={busy !== null || !partnerActive} onClick={() => void run("ENABLE")} className={primary} title={partnerActive ? undefined : "Only an active partner can be given this right"}>
                {busy === "ENABLE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Enable
              </button>
            ) : (
              <>
                {paused ? (
                  <button type="button" disabled={busy !== null} onClick={() => void run("UNPAUSE")} className={primary}>
                    {busy === "UNPAUSE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />} Clear the pause
                  </button>
                ) : (
                  <button type="button" disabled={busy !== null} onClick={() => void run("PAUSE")} className={btn}>
                    {busy === "PAUSE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />} Pause
                  </button>
                )}
                <button type="button" disabled={busy !== null} onClick={() => void run("DISABLE")} className={btn}>
                  {busy === "DISABLE" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Remove the right
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
