"use client";

/**
 * "How points work" as a pop-up card: every rule in one table, with how many
 * times it applied to you this period and the points it gave you, adding up
 * to your total. Mirrors POINTS in apps/api/src/lib/salesLeaderboard.ts.
 */
import { useEffect } from "react";
import { BadgeCheck, CalendarCheck, Footprints, Home, Sparkles, ThumbsDown, Undo2, Wallet, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PointsBreakdown = { confirmed: number; live: number; visits: number; revenuePoints: number; denials: number; reversalPoints: number };

type Rule = { Icon: LucideIcon; what: string; hint: string; per: string; count: number | null; points: number | null; negative?: boolean };

export default function PointsRulesDialog({ breakdown, total, periodLabel, onClose }: { breakdown: PointsBreakdown | null; total: number; periodLabel: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const b = breakdown;
  const rules: Rule[] = [
    { Icon: BadgeCheck, what: "Owner confirms you brought them", hint: "The strongest proof of your work", per: "+50 each", count: b?.confirmed ?? null, points: b ? b.confirmed * 50 : null },
    { Icon: Home, what: "A property's first booking", hint: "It goes live on NoLSAF", per: "+30 each", count: b?.live ?? null, points: b ? b.live * 30 : null },
    { Icon: Footprints, what: "Clean visit", hint: "Up to 3 per lead", per: "+5 each", count: b?.visits ?? null, points: b ? b.visits * 5 : null },
    { Icon: Wallet, what: "NoLSAF revenue after check-out", hint: "From properties you brought in", per: "+1 per TSh 10,000", count: null, points: b?.revenuePoints ?? null },
    { Icon: ThumbsDown, what: "Owner says no, or does not know you", hint: "Protects owners from false claims", per: "−40 each", count: b?.denials ?? null, points: b ? -b.denials * 40 : null, negative: true },
    { Icon: Undo2, what: "Revenue later reversed", hint: "Cancellations and refunds", per: "−1 per TSh 10,000", count: null, points: b ? -b.reversalPoints : null, negative: true },
  ];

  const fmt = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toLocaleString("en-US")}`;

  return (
    <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-950/40 p-3 sm:p-6" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="points-rules-title"
        className="flex max-h-[calc(100dvh-24px)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Sparkles className="h-4 w-4" aria-hidden /></span>
            <div className="min-w-0">
              <h2 id="points-rules-title" className="m-0 text-base font-bold text-slate-900">How points work</h2>
              <p className="m-0 mt-0.5 text-[12px] text-slate-500">Only verified results count. Your numbers are for {periodLabel}.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:bg-slate-50">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 overflow-auto">
          <table className="w-full min-w-[520px] border-collapse text-left">
            <thead className="sticky top-0 bg-slate-50">
              <tr>
                <th scope="col" className="px-5 py-2.5 text-[11px] font-semibold text-slate-500">What earns points</th>
                <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">Points</th>
                <th scope="col" className="px-3 py-2.5 text-right text-[11px] font-semibold text-slate-500">You</th>
                <th scope="col" className="px-5 py-2.5 text-right text-[11px] font-semibold text-slate-500">Your points</th>
              </tr>
            </thead>
            <tbody>
              {rules.map(({ Icon, what, hint, per, count, points, negative }) => (
                <tr key={what} className="border-0 border-t border-solid border-slate-100">
                  <td className="px-5 py-3">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md ${negative ? "bg-rose-50 text-rose-600" : "bg-[#02665e]/10 text-[#02665e]"}`}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-medium text-slate-900">{what}</span>
                        <span className="block text-[11px] text-slate-500">{hint}</span>
                      </span>
                    </div>
                  </td>
                  <td className={`whitespace-nowrap px-3 py-3 text-right text-[12px] font-semibold ${negative ? "text-rose-700" : "text-slate-700"}`}>{per}</td>
                  <td className="px-3 py-3 text-right text-[13px] tabular-nums text-slate-600">{count === null ? "–" : count}</td>
                  <td className={`px-5 py-3 text-right text-[13px] font-semibold tabular-nums ${points === null || points === 0 ? "text-slate-400" : points < 0 ? "text-rose-700" : "text-slate-900"}`}>{points === null ? "–" : fmt(points)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-0 border-t border-solid border-slate-200 bg-[#02665e]/[0.05]">
                <td colSpan={3} className="px-5 py-3 text-[13px] font-semibold text-slate-900">Your total</td>
                <td className="px-5 py-3 text-right text-base font-bold tabular-nums text-[#02665e]">{total.toLocaleString("en-US")}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <footer className="flex items-start gap-2 border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-3 text-[12px] text-slate-600">
          <CalendarCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <span>Flagged visits count once NoLSAF reviews them. The month resets on the 1st, so everyone can win next month. Earnings are never shown on the board.</span>
        </footer>
      </section>
    </div>
  );
}
