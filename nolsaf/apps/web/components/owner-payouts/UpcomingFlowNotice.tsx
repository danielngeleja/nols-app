"use client";

import Link from "next/link";
import { ArrowRight, BadgeCheck, CalendarClock, DoorOpen, KeyRound, Timer, Wallet } from "lucide-react";

/**
 * Shown on Payouts until the new flow is switched on (policy section 1.4).
 * Explains the change in three steps and gives a countdown to the start date.
 */

const START = new Date("2026-10-27T21:00:00Z"); // 28 October 2026, 00:00 EAT

const STEPS = [
  {
    Icon: DoorOpen,
    title: "Guest checks in",
    text: "You validate the booking code as today. The guest gets a check-in confirmation by SMS or email.",
  },
  {
    Icon: Timer,
    title: "Ready after check-in",
    text: "Once payment, guest alert and payout checks pass, the stay's payout is ready to withdraw, including card-paid stays.",
  },
  {
    Icon: KeyRound,
    title: "Withdraw with a code",
    text: "Tap Withdraw here and confirm with a one-time code. Eligible payouts are sent within minutes.",
  },
];

function daysLeft(now: number): number {
  return Math.max(0, Math.ceil((START.getTime() - now) / 86_400_000));
}

export default function UpcomingFlowNotice() {
  const days = daysLeft(Date.now());

  return (
    <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col justify-between gap-6 p-6 sm:p-8">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#02665e]/[0.08] px-3 py-1 text-xs font-semibold text-[#02665e]">
              <CalendarClock className="h-3.5 w-3.5" aria-hidden />
              Starts 28 October 2026
            </span>
            <h2 className="m-0 mt-4 text-xl font-bold leading-snug tracking-tight text-slate-900 sm:text-2xl">
              A faster way to get paid for every stay
            </h2>
            <p className="m-0 mt-2 max-w-md text-sm leading-6 text-slate-600">
              Each stay will unlock on its own and you withdraw it here when you choose. Until the start date, your claims follow the
              current process.
            </p>
          </div>

          <div className="flex items-end gap-3">
            <div className="rounded-xl bg-slate-50 px-4 py-3">
              <p className="m-0 text-3xl font-bold leading-none tabular-nums text-slate-900">{days}</p>
              <p className="m-0 mt-1 text-[11px] font-medium text-slate-500">{days === 1 ? "day to go" : "days to go"}</p>
            </div>
            <p className="m-0 pb-1 text-xs leading-5 text-slate-500">
              Nothing changes for claims
              <br />
              already in progress.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/owner/payouts/older-claims"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014d47] hover:no-underline"
            >
              See your current claims <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link
              href="/owner/payouts/account"
              className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 no-underline transition-colors hover:bg-slate-50 hover:no-underline"
            >
              <Wallet className="h-4 w-4" aria-hidden /> Check your payout account
            </Link>
          </div>
        </div>

        <div className="border-0 border-t border-solid border-slate-200 bg-slate-50/70 p-6 sm:p-8 lg:border-l lg:border-t-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">How it will work</p>
          <ol className="m-0 mt-4 list-none space-y-0 p-0">
            {STEPS.map((step, i) => (
              <li key={step.title} className="relative flex gap-4 pb-6 last:pb-0">
                {i < STEPS.length - 1 && (
                  <span className="absolute left-[19px] top-10 h-[calc(100%-2.5rem)] w-px bg-slate-200" aria-hidden />
                )}
                <span className="relative z-[1] grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-solid border-slate-200 bg-white text-[#02665e]">
                  <step.Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="m-0 text-sm font-semibold text-slate-900">
                    <span className="mr-1.5 text-slate-400 tabular-nums">{i + 1}.</span>
                    {step.title}
                  </p>
                  <p className="m-0 mt-1 text-[13px] leading-5 text-slate-600">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <p className="m-0 mt-6 flex items-start gap-2 rounded-xl border border-solid border-emerald-100 bg-white px-3.5 py-3 text-xs leading-5 text-slate-600">
            <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            Your payout account is checked with the provider, and every withdrawal is confirmed by a code sent only to you.
          </p>
        </div>
      </div>
    </section>
  );
}
