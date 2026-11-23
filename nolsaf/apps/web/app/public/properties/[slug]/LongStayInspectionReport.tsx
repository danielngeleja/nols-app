import { CalendarCheck, Check, ClipboardList, House, Minus, ShieldCheck, X } from "lucide-react";

type CheckResult = "PASS" | "FAIL" | "NA" | null;
type InspectionCheck = { key: string; label: string; required: boolean; result: CheckResult };

export type PublicInspectionReport = {
  status: "PENDING" | "IN_REVIEW" | "FOLLOW_UP" | "EXPIRED" | "PASSED";
  visitedOn: string | null;
  reviewedOn: string | null;
  validUntil: string | null;
  checks: InspectionCheck[];
};

const STATUS_COPY = {
  PENDING: { label: "Visit pending", detail: "The home is awaiting an on-site visit by a NoLSAF Sales Partner." },
  IN_REVIEW: { label: "Report in review", detail: "The home visit is complete. NoLSAF is reviewing the partner’s findings." },
  FOLLOW_UP: { label: "Follow-up needed", detail: "Reservations can open once NoLSAF passes a new inspection." },
  EXPIRED: { label: "Inspection expired", detail: "NoLSAF needs a new inspection before reservations can open." },
  PASSED: { label: "Passed inspection", detail: "NoLSAF approved the findings from the Sales Partner’s home visit." },
} as const;

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function InspectionProgress({ inReview }: { inReview: boolean }) {
  const steps = [
    { label: "Home visit", detail: inReview ? "The Sales Partner submitted their findings." : "A Sales Partner checks the home in person.", Icon: House },
    { label: "NoLSAF review", detail: "NoLSAF reviews the findings and decides if the home passes.", Icon: ShieldCheck },
    { label: "Report available", detail: "Guests can read the checklist after a pass.", Icon: ClipboardList },
  ];
  const active = inReview ? 1 : 0;
  return (
    <ol aria-label="Inspection progress" className="m-0 grid list-none gap-x-6 gap-y-3 rounded-md bg-slate-50 px-4 py-3.5 sm:grid-cols-3">
      {steps.map(({ label, detail, Icon }, index) => (
        <li key={label} aria-current={index === active ? "step" : undefined} className="flex items-start gap-2.5">
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded bg-white ${index <= active ? "text-[#02665e]" : "text-slate-500"}`}>
            {index < active ? <Check className="h-4 w-4" aria-hidden /> : <Icon className="h-4 w-4" aria-hidden />}
          </span>
          <div className="min-w-0">
            <p className={`m-0 text-[13px] font-semibold ${index === active ? "text-[#02665e]" : "text-slate-900"}`}>
              {label}{index < active ? <span className="sr-only">, complete</span> : null}
            </p>
            <p className="m-0 mt-0.5 text-xs leading-[1.55] text-slate-600">{detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Checklist({ title, checks }: { title: string; checks: InspectionCheck[] }) {
  if (!checks.length) return null;
  return (
    <div>
      <h3 className="m-0 text-sm font-semibold text-slate-950">{title}</h3>
      <ul className="m-0 mt-2 list-none divide-y divide-slate-100 rounded-md bg-slate-50/70 px-3 sm:px-4">
        {checks.map((check) => {
          const result = check.result === "PASS" ? { Icon: Check, label: "Confirmed", color: "text-[#02665e]" }
            : check.result === "FAIL" ? { Icon: X, label: "Not met", color: "text-amber-800" }
            : { Icon: Minus, label: check.result === "NA" ? "Not applicable" : "Not recorded", color: "text-slate-600" };
          return (
            <li key={check.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-2.5 text-[13px] leading-5">
              <span className="min-w-0 flex-1 basis-48 text-slate-700">{check.label}</span>
              <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold ${result.color}`}>
                <result.Icon className="h-3.5 w-3.5" aria-hidden />{result.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function LongStayInspectionReport({ report, inspected }: {
  report?: PublicInspectionReport | null;
  inspected?: { inspectedOn: string | null; validUntil: string | null } | null;
}) {
  const status = report?.status ?? (inspected ? "PASSED" : "PENDING");
  const copy = STATUS_COPY[status];
  const dates = [
    { label: report ? "Home visited" : "Last inspection", date: report ? report.visitedOn : inspected?.inspectedOn },
    { label: "Reviewed by NoLSAF", date: report?.reviewedOn },
    { label: "Valid through", date: report?.validUntil ?? inspected?.validUntil },
  ].filter(({ date }) => date);
  const checks = report?.checks ?? [];

  return (
    <section id="long-stay-inspection" aria-labelledby="long-stay-inspection-title" className="scroll-mt-24 rounded-lg border border-solid border-slate-200 bg-white p-4 sm:p-6">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-[#02665e]">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-[180px]">
          <h2 id="long-stay-inspection-title" className="m-0 text-lg font-semibold leading-6 tracking-tight text-slate-950">On-site inspection report</h2>
          <p className="m-0 mt-0.5 max-w-[65ch] text-[13px] leading-5 text-slate-600">{copy.detail}</p>
        </div>
        <span className={`ml-auto inline-flex min-h-7 shrink-0 items-center rounded px-2.5 text-xs font-semibold ${status === "PASSED" ? "bg-emerald-50 text-[#02665e]" : status === "IN_REVIEW" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-900"}`}>
          {copy.label}
        </span>
      </header>

      {status === "PASSED" ? (
        <div className="mt-4 space-y-5">
          {dates.length ? (
            <dl className="m-0 flex flex-wrap gap-x-6 gap-y-3 rounded-md bg-slate-50 px-4 py-3">
              {dates.map(({ label, date }) => date ? (
                <div key={label} className="min-w-[115px] flex-1">
                  <dt className="flex items-center gap-1.5 text-xs text-slate-600"><CalendarCheck className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />{label}</dt>
                  <dd className="m-0 mt-0.5 text-sm font-semibold tabular-nums text-slate-900"><time dateTime={date}>{dayLabel.format(new Date(`${date}T00:00:00Z`))}</time></dd>
                </div>
              ) : null)}
            </dl>
          ) : null}
          {checks.length ? (
            <div className="grid gap-5 xl:grid-cols-2">
              <Checklist title="Required checks" checks={checks.filter((check) => check.required)} />
              <Checklist title="Additional checks" checks={checks.filter((check) => !check.required)} />
            </div>
          ) : <p className="m-0 text-sm text-slate-600">The checklist is unavailable for this visit.</p>}
        </div>
      ) : (
        <div className="mt-4"><InspectionProgress inReview={status === "IN_REVIEW"} /></div>
      )}
    </section>
  );
}
