"use client";

import Link from "next/link";
import { ArrowRight, CalendarClock, Wallet } from "lucide-react";
import { formatTzs, useNow } from "./shared";

/** Shows the payout balance and disabled withdrawal action before launch. */
const START = new Date("2026-10-27T21:00:00Z"); // 28 October 2026, 00:00 EAT

function daysLeft(now: number): number {
  return Math.max(0, Math.ceil((START.getTime() - now) / 86_400_000));
}

export default function UpcomingFlowNotice() {
  const days = daysLeft(useNow());

  return (
    <section id="withdraw" className="scroll-mt-6 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
      <div className="flex flex-col gap-6 p-5 sm:p-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/[0.08] px-3 py-1.5 text-xs font-semibold text-[#02665e]">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Starts 28 October 2026
            </span>
            <span className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-600">
              {days > 0 ? `${days} ${days === 1 ? "day" : "days"} left` : "Coming soon"}
            </span>
          </div>
          <p className="m-0 mt-6 text-sm font-medium text-slate-500">Ready to withdraw</p>
          <p className="m-0 mt-1 text-4xl font-bold tracking-tight tabular-nums text-slate-900 sm:text-5xl">{formatTzs(0)}</p>
          <p className="m-0 mt-2 text-xs text-slate-500">No payouts available yet.</p>
        </div>

        <div className="min-w-0 rounded-xl border border-solid border-emerald-200 bg-emerald-50/40 p-4 lg:w-[21rem]">
          <h2 className="m-0 mb-3 text-sm font-bold text-slate-900">Withdraw earnings</h2>
          <button type="button" disabled className="h-11 w-full cursor-not-allowed rounded-xl border-0 bg-slate-200 px-5 text-sm font-semibold text-slate-500">
            Withdraw {formatTzs(0)}
          </button>
          <p className="m-0 mt-2 text-center text-xs text-slate-500">Available when payouts begin.</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
        <p className="m-0 text-xs text-slate-500">Current claims continue as usual.</p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/owner/payouts/older-claims" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline hover:underline">
            Current claims <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
          <Link href="/owner/payouts/account" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 no-underline hover:underline">
            <Wallet className="h-3.5 w-3.5" aria-hidden /> Payout account
          </Link>
        </div>
      </div>
    </section>
  );
}
