import { CalendarCheck, Check, ChevronDown, CircleAlert, ClipboardList, House, Minus, ShieldCheck, X } from "lucide-react";

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
      <h3 className="m-0 text-xs font-semibold text-slate-600">{title}</h3>
      <ul className="m-0 mt-1.5 grid list-none gap-x-5 p-0 md:grid-cols-2">
        {checks.map((check) => {
          const result = check.result === "PASS" ? { Icon: Check, label: "Confirmed", color: "text-[#02665e]" }
            : check.result === "FAIL" ? { Icon: X, label: "Not met", color: "text-amber-800" }
            : { Icon: Minus, label: check.result === "NA" ? "Not applicable" : "Not recorded", color: "text-slate-600" };
          return (
            <li key={check.key} className="flex items-start gap-2 border-0 border-t border-solid border-slate-100 py-1.5 text-xs leading-5 text-slate-700">
              <span title={result.label} className={`mt-0.5 grid size-4 shrink-0 place-items-center ${result.color}`}>
                <result.Icon className="size-3.5" aria-hidden /><span className="sr-only">{result.label}</span>
              </span>
              <span className="min-w-0">{check.label}{check.result !== "PASS" && <span aria-hidden className={`ml-1.5 font-semibold ${result.color}`}>· {result.label}</span>}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function InspectionConfidence({ checks }: { checks: InspectionCheck[] }) {
  const applicable = checks.filter((check) => check.result !== "NA");
  if (!applicable.some((check) => check.result === "PASS" || check.result === "FAIL")) return null;

  const confirmed = applicable.filter((check) => check.result === "PASS").length;
  const score = Math.round((confirmed / applicable.length) * 100);
  const groups = [
    { label: "Required", items: applicable.filter((check) => check.required) },
    { label: "Additional", items: applicable.filter((check) => !check.required) },
  ];

  return (
    <section aria-label="Inspection confidence" className="grid gap-3 bg-[#f2f7f5] px-3 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:items-center sm:gap-5 sm:px-4">
      <div className="flex items-center gap-3">
        <span className="shrink-0 text-2xl font-bold leading-none tabular-nums tracking-tight text-[#07564d]">{score}%</span>
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold text-slate-950">Inspection confidence</h3>
          <p className="m-0 mt-0.5 text-xs leading-4 text-slate-600">{confirmed} of {applicable.length} applicable checks confirmed at the visit</p>
        </div>
      </div>
      <div className="min-w-0">
        <div aria-hidden="true" className="flex gap-0.5 sm:gap-1">
          {applicable.map(({ key, result }) => (
            <span key={key} className={`h-2.5 min-w-0 flex-1 rounded-sm ${result === "PASS" ? "bg-[#238477]" : result === "FAIL" ? "bg-amber-500" : "border border-dashed border-slate-400 bg-white"}`} />
          ))}
        </div>
        <ul aria-label="Confirmed checks by type" className="m-0 mt-1.5 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-xs text-slate-600">
          {groups.filter(({ items }) => items.length > 0).map(({ label, items }) => (
            <li key={label}>{label} <strong className="font-semibold tabular-nums text-slate-950">{items.filter((check) => check.result === "PASS").length} of {items.length}</strong></li>
          ))}
        </ul>
      </div>
    </section>
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
  const required = checks.filter((check) => check.required);
  const additional = checks.filter((check) => !check.required);
  const findings = checks.filter((check) => check.result === "FAIL");
  const hasRecordedChecks = checks.some((check) => check.result === "PASS" || check.result === "FAIL");

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
        <div className="mt-3">
          {dates.length ? (
            <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1.5 border-0 border-t border-solid border-slate-100 py-2.5">
              {dates.map(({ label, date }) => date ? (
                <div key={label} className="flex flex-wrap items-baseline gap-x-1.5 text-xs">
                  <dt className="inline-flex items-center gap-1 text-slate-600">{label === "Valid through" && <CalendarCheck className="size-3.5 text-[#02665e]" aria-hidden />}{label}</dt>
                  <dd className="m-0 font-semibold tabular-nums text-slate-900"><time dateTime={date}>{dayLabel.format(new Date(`${date}T00:00:00Z`))}</time></dd>
                </div>
              ) : null)}
            </dl>
          ) : null}
          {checks.length ? (
            <div className="overflow-hidden divide-y divide-slate-100 rounded-md border border-solid border-slate-200">
              <InspectionConfidence checks={checks} />
              {findings.length > 0 && (
                <div className="px-3 py-2.5 sm:px-4">
                  <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-amber-900"><CircleAlert className="size-4" aria-hidden />Checks that were not met</p>
                  <ul className="m-0 mt-1 list-none space-y-1 p-0">
                    {findings.map((check) => (
                      <li key={check.key} className="flex flex-wrap items-baseline gap-x-2 text-xs leading-5 text-slate-700">
                        <span>{check.label}</span>
                        <span className="rounded bg-amber-50 px-1.5 font-medium text-amber-900">{check.required ? "Required" : "Additional"}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <details className="group">
                <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3 text-xs font-semibold text-[#02665e] hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#02665e] sm:px-4 [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-1.5"><ClipboardList className="size-4" aria-hidden />Full checklist <span className="font-normal text-slate-500">· {checks.length} checks</span></span>
                  <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <div className="space-y-3 border-0 border-t border-solid border-slate-100 px-3 py-3 sm:px-4">
                  {hasRecordedChecks && <p className="m-0 text-xs leading-5 text-slate-600">The score is the share of applicable checks the Sales Partner confirmed and NoLSAF reviewed. Unrecorded checks count as unconfirmed.</p>}
                  <Checklist title="Required checks" checks={required} />
                  <Checklist title="Additional checks" checks={additional} />
                </div>
              </details>
            </div>
          ) : <p className="m-0 text-sm text-slate-600">The checklist is unavailable for this visit.</p>}
        </div>
      ) : (
        <div className="mt-4"><InspectionProgress inReview={status === "IN_REVIEW"} /></div>
      )}
    </section>
  );
}
