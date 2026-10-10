import { Check, X } from "lucide-react";

/**
 * The five steps of an invoice claim (the previous payout flow), drawn on the
 * dark header band. `current` is the step in progress; earlier steps are done.
 * `dates` optionally puts a date under each step; `rejected` marks the
 * current step as stopped.
 */
export const CLAIM_STEPS = ["Create invoice", "Send to NoLSAF", "Verified", "Approved", "Paid"] as const;

export function claimStepOf(status: string | null | undefined): number {
  switch (String(status ?? "").toUpperCase()) {
    case "DRAFT":
      return 1; // created; sending it is the next step
    case "REQUESTED":
      return 2;
    case "VERIFIED":
      return 3;
    case "APPROVED":
    case "PROCESSING":
      return 4;
    case "PAID":
      return 5; // everything done
    default:
      return 2;
  }
}

export function ClaimSteps({
  current,
  dates,
  rejected,
  className = "",
}: {
  current: number;
  dates?: (string | null | undefined)[];
  rejected?: boolean;
  className?: string;
}) {
  return (
    <ol className={`m-0 grid list-none grid-cols-5 gap-1.5 p-0 sm:gap-2 ${className}`} aria-label="Payout claim steps">
      {CLAIM_STEPS.map((label, i) => {
        const done = i < current;
        const now = i === current;
        const stopped = now && rejected;
        return (
          <li key={label} className="min-w-0">
            <span
              className={`block h-1.5 rounded-full ${done ? "bg-[#5eead4]" : stopped ? "bg-rose-400" : now ? "bg-[#5eead4]/40" : "bg-white/10"}`}
              aria-hidden
            />
            <span className={`mt-2 flex items-center gap-1 text-[11px] font-semibold ${done ? "text-white" : now ? (stopped ? "text-rose-200" : "text-[#9fd8cc]") : "text-white/40"}`}>
              {done ? <Check className="h-3 w-3 shrink-0 text-[#5eead4]" aria-hidden /> : stopped ? <X className="h-3 w-3 shrink-0" aria-hidden /> : null}
              <span className="truncate">{stopped ? "Rejected" : label}</span>
            </span>
            {dates?.[i] ? (
              <span className="mt-0.5 hidden text-[10px] text-white/45 sm:block">
                {new Date(String(dates[i])).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short" })}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
