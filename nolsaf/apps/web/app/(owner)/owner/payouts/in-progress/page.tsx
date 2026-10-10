"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { PayoutRow } from "@/components/owner-payouts/PayoutList";
import { STAGES, formatTzs, sum, useNow, useOwnerPayouts, type PayoutStage } from "@/components/owner-payouts/shared";

const FILTERS: Array<{ key: string; label: string; stages: PayoutStage[] }> = [
  { key: "all", label: "All", stages: ["UNLOCKING", "WAITING", "READY", "ON_HOLD", "SENDING", "UNDER_REVIEW"] },
  { key: "unlocking", label: "Unlocking", stages: ["UNLOCKING", "WAITING"] },
  { key: "ready", label: "Ready", stages: ["READY"] },
  { key: "onway", label: "On its way", stages: ["SENDING", "UNDER_REVIEW"] },
  { key: "hold", label: "On hold", stages: ["ON_HOLD"] },
];

export default function PayoutsInProgressPage() {
  const { payouts, enabled, loading, error } = useOwnerPayouts();
  const now = useNow();
  const [filter, setFilter] = useState("all");

  const selected = FILTERS.find((f) => f.key === filter) ?? FILTERS[0];
  const rows = useMemo(
    () =>
      payouts
        .filter((p) => selected.stages.includes(p.stage))
        .sort((a, b) => new Date(a.releaseAt).getTime() - new Date(b.releaseAt).getTime()),
    [payouts, selected]
  );

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-sm text-slate-500">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading your payouts...
      </div>
    );
  }
  if (error) return <p className="m-0 rounded-2xl border border-solid border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">{error}</p>;
  if (!enabled) {
    return (
      <p className="m-0 rounded-2xl border border-solid border-slate-200 bg-white px-5 py-6 text-sm text-slate-600">
        Stays will show here once the new payout flow starts on 28 October 2026. Until then, see{" "}
        <Link href="/owner/payouts/older-claims" className="font-semibold text-[#02665e]">Older claims</Link>.
      </p>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
      <div className="flex flex-col gap-2 border-0 border-b border-solid border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {FILTERS.map((f) => {
          const count = payouts.filter((p) => f.stages.includes(p.stage)).length;
          const on = f.key === filter;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-solid px-3 text-xs font-semibold transition-colors ${
                on ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
              <span className={`tabular-nums ${on ? "text-white/80" : "text-slate-400"}`}>{count}</span>
            </button>
          );
        })}
        </div>
        <span className="text-xs text-slate-500 sm:ml-auto sm:shrink-0">
          <span className="font-semibold tabular-nums text-slate-700">{formatTzs(sum(rows, selected.stages))}</span> in this view
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="m-0 px-5 py-10 text-center text-sm text-slate-500">
          {filter === "all"
            ? "Nothing in progress. When a guest checks in, their stay appears here."
            : `No payouts are ${STAGES[selected.stages[0]].label.toLowerCase()} right now.`}
        </p>
      ) : (
        <ul className="m-0 list-none divide-y divide-slate-100 p-0">
          {rows.map((p) => (
            <PayoutRow key={p.bookingReference} payout={p} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
