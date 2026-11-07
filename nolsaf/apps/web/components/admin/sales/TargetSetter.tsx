"use client";

/**
 * Admin: set a partner's monthly target with the facts beside it. The system
 * suggests (3-month average + 20%); the admin confirms in one click. A preset
 * needs no typed reason; a custom number does. Raising this month after the
 * 10th is not offered: it applies from next month.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Target, TrendingUp } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Choice = "SUGGESTED" | "KEEP" | "STRETCH" | "CUSTOM";
type Context = {
  month: string;
  nextMonth: string;
  finishedMonths: string[];
  history: number[];
  thisMonth: { confirmed: number; target: number; setBy: string; daysLeft: number };
  nextMonthTarget: { target: number; setBy: string } | null;
  teamAverage: number | null;
  regionAverage: number | null;
  choices: { average: number; suggested: number; keep: number; stretch: number };
  rules: { raiseCutoffDay: number; raiseAllowedThisMonth: boolean; min: number; max: number };
};

const SET_BY: Record<string, string> = { ADMIN: "NoLSAF", TEAM_LEAD: "team lead", DEFAULT: "default" };

function monthName(key: string, style: "short" | "long" = "short") {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString("en-GB", { month: style, ...(style === "long" ? { year: "numeric" } : {}), timeZone: "UTC" });
}

export default function TargetSetter({ partnerId }: { partnerId: number }) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [loading, setLoading] = useState(true);
  const [which, setWhich] = useState<"current" | "next">("current");
  const [choice, setChoice] = useState<Choice>("SUGGESTED");
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get(`/api/admin/sales/partners/${partnerId}/target-context`);
      setCtx(data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the target details.");
    } finally {
      setLoading(false);
    }
  }, [partnerId]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !ctx) return <div className="flex items-center gap-2 rounded-lg border border-solid border-neutral-200 p-4 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading target</div>;
  if (!ctx) return error ? <p className="m-0 text-sm text-rose-700">{error}</p> : null;

  const month = which === "current" ? ctx.month : ctx.nextMonth;
  // Same as the server: a month with no target yet means the default of 5.
  const currentForMonth = which === "current" ? ctx.thisMonth.target : ctx.nextMonthTarget?.target ?? 5;
  const options: Array<{ key: Choice; label: string; value: number | null; hint: string }> = [
    { key: "SUGGESTED", label: "Suggested", value: ctx.choices.suggested, hint: ctx.choices.average ? `Average ${ctx.choices.average} + 20%` : "Starting target for a new partner" },
    { key: "KEEP", label: "Keep", value: currentForMonth, hint: "The current target" },
    { key: "STRETCH", label: "Stretch", value: ctx.choices.stretch, hint: "For a strong performer" },
    { key: "CUSTOM", label: "Custom", value: null, hint: `${ctx.rules.min} to ${ctx.rules.max}, with a reason` },
  ];
  const valueOf = (c: Choice) => (c === "CUSTOM" ? Number(custom) : options.find((o) => o.key === c)!.value!);
  // Raising this month after the cutoff is not offered at all.
  const lateRaise = (v: number) => which === "current" && !ctx.rules.raiseAllowedThisMonth && v > currentForMonth;
  const chosen = valueOf(choice);

  const save = async () => {
    if (!Number.isInteger(chosen) || chosen < ctx.rules.min || chosen > ctx.rules.max) return setError(`Enter a whole number from ${ctx.rules.min} to ${ctx.rules.max}.`);
    if (choice === "CUSTOM" && reason.trim().length < 5) return setError("Give a reason for a custom target.");
    if (lateRaise(chosen)) return setError(`After the ${ctx.rules.raiseCutoffDay}th a higher target applies from next month.`);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await apiClient.put(`/api/admin/sales/partners/${partnerId}/target`, {
        month,
        target: chosen,
        choice,
        ...(choice === "CUSTOM" ? { reason: reason.trim() } : {}),
      });
      setNotice(`${monthName(month, "long")} target set to ${chosen}. The partner has been told.`);
      setReason("");
      setCustom("");
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save the target.");
    } finally {
      setBusy(false);
    }
  };

  const progress = Math.min(100, Math.round((ctx.thisMonth.confirmed / Math.max(1, ctx.thisMonth.target)) * 100));

  return (
    <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 px-4 py-3">
        <h3 className="m-0 flex items-center gap-1.5 text-sm font-semibold text-neutral-900"><Target className="h-4 w-4 text-emerald-700" /> Monthly target</h3>
        <div className="inline-flex rounded-md border border-solid border-neutral-200 p-0.5" role="tablist" aria-label="Target month">
          {(["current", "next"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={which === k} onClick={() => { setWhich(k); setChoice("SUGGESTED"); setError(""); }}
              className={`h-7 rounded border-0 px-2.5 text-[12px] font-semibold ${which === k ? "bg-neutral-900 text-white" : "bg-transparent text-neutral-500 hover:text-neutral-800"}`}>
              {k === "current" ? monthName(ctx.month, "long") : monthName(ctx.nextMonth, "long")}
            </button>
          ))}
        </div>
      </div>

      {/* The facts */}
      <div className="grid gap-px bg-neutral-100 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div className="bg-white px-4 py-3">
          <p className="m-0 text-[11px] text-neutral-500">Confirmed properties, last 3 months</p>
          <div className="mt-1.5 flex items-end gap-3">
            {[...ctx.finishedMonths].reverse().map((m, i) => {
              const v = [...ctx.history].reverse()[i];
              const max = Math.max(1, ...ctx.history, ctx.choices.suggested);
              return (
                <div key={m} className="flex flex-col items-center gap-1">
                  <span className="text-[13px] font-bold tabular-nums text-neutral-900">{v}</span>
                  <span className="block w-7 rounded-sm bg-emerald-600/80" style={{ height: `${4 + (v / max) * 28}px` }} aria-hidden />
                  <span className="text-[11px] text-neutral-500">{monthName(m)}</span>
                </div>
              );
            })}
            <div className="ml-1 pb-5 text-[11px] text-neutral-500">avg <b className="font-semibold text-neutral-800">{ctx.choices.average}</b></div>
          </div>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="m-0 text-[11px] text-neutral-500">{monthName(ctx.month, "long")} so far</p>
          <p className="m-0 mt-0.5 text-lg font-bold tabular-nums text-neutral-900">{ctx.thisMonth.confirmed}<span className="text-[13px] font-medium text-neutral-400"> of {ctx.thisMonth.target}</span></p>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-neutral-100"><span className="block h-full rounded-full bg-emerald-600" style={{ width: `${progress}%` }} /></span>
          <p className="m-0 mt-1 text-[11px] text-neutral-500">{ctx.thisMonth.daysLeft} days left · set by {SET_BY[ctx.thisMonth.setBy] || "default"}</p>
        </div>
        <div className="bg-white px-4 py-3">
          <p className="m-0 flex items-center gap-1 text-[11px] text-neutral-500"><TrendingUp className="h-3 w-3" /> Peers, monthly average</p>
          <p className="m-0 mt-1 flex justify-between text-[13px]"><span className="text-neutral-500">Team</span><b className="font-semibold tabular-nums text-neutral-900">{ctx.teamAverage ?? "–"}</b></p>
          <p className="m-0 mt-0.5 flex justify-between text-[13px]"><span className="text-neutral-500">Region</span><b className="font-semibold tabular-nums text-neutral-900">{ctx.regionAverage ?? "–"}</b></p>
          {which === "next" ? <p className="m-0 mt-1 text-[11px] text-neutral-500">Next month: {ctx.nextMonthTarget ? `${ctx.nextMonthTarget.target}, set by ${SET_BY[ctx.nextMonthTarget.setBy] || "default"}` : "not set yet"}</p> : null}
        </div>
      </div>

      {/* The choice */}
      <div className="border-0 border-t border-solid border-neutral-100 px-4 py-3">
        <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Target choice">
          {options.map((o) => {
            const on = choice === o.key;
            const blocked = o.value !== null && lateRaise(o.value);
            return (
              <button key={o.key} type="button" role="radio" aria-checked={on} disabled={blocked} onClick={() => { setChoice(o.key); setError(""); }}
                title={blocked ? `Raising after the ${ctx.rules.raiseCutoffDay}th applies from next month` : undefined}
                className={`rounded-md border border-solid px-3 py-2 text-left ${on ? "border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600" : "border-neutral-200 bg-white hover:bg-neutral-50"} disabled:cursor-not-allowed disabled:opacity-45`}>
                <span className="flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-neutral-700">{o.key === "SUGGESTED" ? <Sparkles className="mr-1 inline h-3 w-3 text-emerald-600" /> : null}{o.label}</span>
                  {o.value !== null ? <span className="text-lg font-bold tabular-nums text-neutral-900">{o.value}</span> : null}
                </span>
                <span className="mt-0.5 block text-[11px] leading-tight text-neutral-500">{blocked ? "From next month only" : o.hint}</span>
              </button>
            );
          })}
        </div>

        {choice === "CUSTOM" ? (
          <div className="mt-2 grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
            <input value={custom} onChange={(e) => setCustom(e.target.value.replace(/\D/g, "").slice(0, 2))} inputMode="numeric" placeholder="Target" aria-label="Custom target"
              className="h-10 rounded-md border border-solid border-neutral-200 px-3 text-sm outline-none focus:border-emerald-400" />
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this number (kept in the audit log)" aria-label="Reason"
              className="h-10 rounded-md border border-solid border-neutral-200 px-3 text-sm outline-none focus:border-emerald-400" />
          </div>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <p className="m-0 text-[11px] text-neutral-500">
            {which === "current" && !ctx.rules.raiseAllowedThisMonth
              ? `After the ${ctx.rules.raiseCutoffDay}th you can lower this month's target, not raise it. Team leads can move your target by 2 at most.`
              : "Team leads can move your target by 2 at most. The partner is told the new number."}
          </p>
          <button type="button" onClick={() => void save()} disabled={busy || (choice === "CUSTOM" && !custom)}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Set {monthName(month)} target{Number.isFinite(chosen) && chosen > 0 ? ` to ${chosen}` : ""}
          </button>
        </div>
        {error ? <p className="m-0 mt-2 flex items-start gap-1.5 text-[13px] text-rose-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</p> : null}
        {notice ? <p className="m-0 mt-2 flex items-start gap-1.5 text-[13px] text-emerald-700"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />{notice}</p> : null}
      </div>
    </section>
  );
}
