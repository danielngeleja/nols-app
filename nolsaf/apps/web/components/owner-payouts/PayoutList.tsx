"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { STAGES, formatEat, formatTzs, ruleLabel, stayDates, timeLeft, type OwnerPayout, type PayoutStage } from "./shared";

const STEPS = ["Checked in", "Unlocks", "Ready", "Withdrawn", "Paid"] as const;

function stepIndex(stage: PayoutStage): number {
  switch (stage) {
    case "UNLOCKING":
    case "WAITING":
    case "ON_HOLD":
      return 1;
    case "READY":
      return 2;
    case "SENDING":
    case "UNDER_REVIEW":
      return 3;
    default:
      return 4;
  }
}

/** Five fixed steps, the same for every stay, so owners always know where a payout is. */
export function StageTracker({ stage }: { stage: PayoutStage }) {
  const current = stepIndex(stage);
  const held = stage === "ON_HOLD";
  const finished = stage === "PAID" || stage === "SETTLED";
  return (
    <ol className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0 text-[11px]" aria-label={`Progress: ${STAGES[stage].label}`}>
      {STEPS.map((step, i) => {
        const done = i < current || (finished && i === current);
        const isCurrent = i === current && !finished;
        return (
          <li key={step} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${
                done
                  ? "text-emerald-700"
                  : isCurrent
                    ? held
                      ? "bg-amber-50 text-amber-800"
                      : "bg-[#02665e] text-white"
                    : "text-slate-400"
              }`}
              aria-current={isCurrent ? "step" : undefined}
            >
              {done && <Check className="h-3 w-3" aria-hidden />}
              {isCurrent && held ? "On hold" : step}
            </span>
            {i < STEPS.length - 1 && <span className="text-slate-300" aria-hidden>›</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** One plain sentence explaining the current stage. */
export function stageSentence(p: OwnerPayout, now: number): string {
  switch (p.stage) {
    case "UNLOCKING":
      return p.rule === "CHECKIN_CONFIRMED"
        ? "Validated check-in recorded. Payout checks are running."
        : `Unlocks ${formatEat(p.releaseAt)}, ${timeLeft(p.releaseAt, now)}. ${ruleLabel(p.rule)}.`;
    case "WAITING":
      return `Waiting: ${p.reason ?? "a final check"}.`;
    case "ON_HOLD":
      return `On hold: ${p.reason ?? "under review"}. No money moves while a payout is on hold.`;
    case "READY":
      return `Ready to withdraw since ${formatEat(p.availableAt ?? p.releaseAt)}.`;
    case "SENDING":
      return "Withdrawn and on its way to your payout account.";
    case "UNDER_REVIEW":
      return `Withdrawn. With our payments team, normally paid within 24 hours.${p.reason ? ` ${p.reason}.` : ""}`;
    case "PAID":
      return `Paid ${formatEat(p.paidAt ?? p.releasedAt)}.`;
    case "SETTLED":
      return "Used in full to settle an earlier refund. Nothing more is owed from it.";
    case "CANCELLED":
      return "Cancelled: the booking was cancelled or the claim rejected.";
  }
}

export function PayoutRow({ payout, now, showReceipt = false }: { payout: OwnerPayout; now: number; showReceipt?: boolean }) {
  const meta = STAGES[payout.stage];
  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${meta.chip}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} aria-hidden />
            {meta.label}
          </span>
          <span className="truncate text-sm font-semibold text-slate-900">{payout.propertyTitle || "Your property"}</span>
          <span className="text-xs text-slate-500">
            {payout.guestName ? `${payout.guestName}, ` : ""}
            {stayDates(payout.checkIn, payout.checkOut)}
          </span>
        </div>
        <StageTracker stage={payout.stage} />
        <p className="m-0 text-xs leading-5 text-slate-600">{stageSentence(payout, now)}</p>
      </div>
      <div className="flex flex-shrink-0 flex-col items-start gap-1 lg:items-end">
        <span className="text-base font-bold tabular-nums text-slate-900">{formatTzs(payout.amount)}</span>
        {payout.recoveryDeducted > 0 && (
          <span className="text-[11px] text-slate-500">less {formatTzs(payout.recoveryDeducted)} for an earlier refund</span>
        )}
        {showReceipt && payout.stage === "PAID" && (
          <Link href={`/owner/invoices/${encodeURIComponent(payout.invoiceReference)}`} className="text-xs font-semibold text-[#02665e] no-underline hover:underline">
            View statement
          </Link>
        )}
      </div>
    </li>
  );
}
