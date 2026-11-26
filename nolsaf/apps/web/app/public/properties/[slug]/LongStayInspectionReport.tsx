import { BadgeCheck, CalendarCheck, Check, CircleAlert, ClipboardList, Droplets, House, Lock, Minus, ShieldCheck, Sofa, X } from "lucide-react";

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

export function inspectionScore(checks: InspectionCheck[]) {
  const applicable = checks.filter((check) => check.result !== "NA").length;
  const confirmed = checks.filter((check) => check.result === "PASS").length;
  const hasRecorded = checks.some((check) => check.result === "PASS" || check.result === "FAIL");
  const score = hasRecorded && applicable ? Math.round(confirmed / applicable * 100) : null;
  return { applicable, confirmed, score };
}

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

/** The checklist grouped into what a tenant cares about. Unknown keys fall into "Other checks". */
const THEMES: Array<{ key: string; title: string; blurb: string; Icon: typeof House; keys: string[] }> = [
  { key: "real", title: "Real and as listed", blurb: "The home exists, is where it says, and may be let", Icon: BadgeCheck, keys: ["MATCHES_LISTING", "LOCATION", "RIGHT_TO_LET"] },
  { key: "basics", title: "Everyday essentials", blurb: "Water, power, toilet and bathroom", Icon: Droplets, keys: ["WATER", "POWER", "SANITATION"] },
  { key: "safe", title: "Safe and sound", blurb: "Locks, structure, wiring and fire risk", Icon: Lock, keys: ["SECURITY", "STRUCTURE", "SAFETY"] },
  { key: "comfort", title: "Living comfort", blurb: "Access, furniture and bills as listed", Icon: Sofa, keys: ["ACCESS", "FURNISHING", "UTILITIES_AS_LISTED"] },
];

function grade(score: number) {
  if (score >= 100) return { word: "Excellent", tone: "#02665e" };
  if (score >= 90) return { word: "Very good", tone: "#02665e" };
  if (score >= 75) return { word: "Good", tone: "#0f766e" };
  return { word: "Fair", tone: "#b45309" };
}

function ScoreDial({ score, confirmed, applicable }: { score: number; confirmed: number; applicable: number }) {
  const r = 44;
  const circ = 2 * Math.PI * r;
  const g = grade(score);
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 108 108" className="h-[104px] w-[104px] shrink-0" role="img" aria-label={`Inspection score ${score} out of 100, ${g.word}`}>
        <circle cx="54" cy="54" r={r} fill="none" stroke="#e7efec" strokeWidth="9" />
        <circle cx="54" cy="54" r={r} fill="none" stroke={g.tone} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(score / 100) * circ} ${circ}`} transform="rotate(-90 54 54)" />
        <text x="54" y="55" textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: "#0f172a" }}>{score}</text>
        <text x="54" y="71" textAnchor="middle" style={{ fontSize: 9, fill: "#64748b" }}>out of 100</text>
      </svg>
      <div className="min-w-0">
        <p className="m-0 text-[11px] font-semibold text-slate-500">Inspection score</p>
        <p className="m-0 text-xl font-bold leading-tight" style={{ color: g.tone }}>{g.word}</p>
        <p className="m-0 mt-1 text-[12.5px] leading-5 text-slate-600">{confirmed} of {applicable} checks confirmed in person by a NoLSAF Sales Partner, then reviewed by NoLSAF.</p>
      </div>
    </div>
  );
}

function ThemeCard({ title, blurb, Icon, checks }: { title: string; blurb: string; Icon: typeof House; checks: InspectionCheck[] }) {
  const applicable = checks.filter((c) => c.result !== "NA");
  const ok = applicable.filter((c) => c.result === "PASS").length;
  const missed = applicable.filter((c) => c.result === "FAIL").length;
  const all = applicable.length > 0 && ok === applicable.length;
  return (
    <article className="flex min-w-0 flex-col rounded-md border border-solid border-slate-200 bg-white p-3.5">
      <header className="flex items-start gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-md ${all ? "bg-emerald-50 text-[#02665e]" : missed ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}><Icon className="h-4 w-4" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[13.5px] font-semibold text-slate-950">{title}</h3>
          <p className="m-0 text-[11.5px] leading-4 text-slate-500">{blurb}</p>
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${all ? "bg-emerald-50 text-[#02665e]" : missed ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-600"}`}>
          {applicable.length ? `${ok}/${applicable.length}` : "N/A"}
        </span>
      </header>
      <div aria-hidden="true" className="mt-3 flex gap-1">
        {applicable.map((c) => <span key={c.key} className={`h-1.5 flex-1 rounded-sm ${c.result === "PASS" ? "bg-[#238477]" : c.result === "FAIL" ? "bg-amber-500" : "bg-slate-200"}`} />)}
      </div>
      <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
        {checks.map((c) => {
          const r = c.result === "PASS" ? { Icon: Check, cls: "bg-emerald-50 text-[#02665e]", label: "Confirmed" }
            : c.result === "FAIL" ? { Icon: X, cls: "bg-amber-100 text-amber-800", label: "Not met" }
            : { Icon: Minus, cls: "bg-slate-100 text-slate-400", label: c.result === "NA" ? "Not applicable" : "Not recorded" };
          return (
            <li key={c.key} className="flex items-start gap-2 text-[12.5px] leading-5">
              <span title={r.label} className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${r.cls}`}><r.Icon className="size-2.5" aria-hidden /><span className="sr-only">{r.label}</span></span>
              <span className={c.result === "FAIL" ? "text-amber-900" : c.result === "PASS" ? "text-slate-700" : "text-slate-400"}>
                {c.label}{c.required ? "" : <span className="text-slate-400"> · extra</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function Validity({ visitedOn, reviewedOn, validUntil }: { visitedOn?: string | null; reviewedOn?: string | null; validUntil?: string | null }) {
  const start = reviewedOn || visitedOn;
  const t = (d: string) => new Date(`${d}T00:00:00Z`).getTime();
  const pct = start && validUntil ? Math.min(100, Math.max(0, ((Date.now() - t(start)) / (t(validUntil) - t(start))) * 100)) : null;
  const monthsLeft = validUntil ? Math.max(0, Math.round((t(validUntil) - Date.now()) / (30.44 * 86_400_000))) : null;
  return (
    <div className="rounded-md bg-slate-50 px-3.5 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800"><CalendarCheck className="size-3.5 text-[#02665e]" aria-hidden />
          {monthsLeft != null ? (monthsLeft > 0 ? `Valid for about ${monthsLeft} more ${monthsLeft === 1 ? "month" : "months"}` : "Due for its yearly re-check") : "Inspection dates"}
        </span>
        <span className="text-slate-500">Checked again every 12 months</span>
      </div>
      {pct != null ? <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-[#238477]" style={{ width: `${pct}%` }} /></div> : null}
      <dl className="m-0 mt-2 grid grid-cols-3 gap-2 text-[11.5px]">
        {[["Visited", visitedOn], ["Reviewed", reviewedOn], ["Valid through", validUntil]].map(([label, d]) => (
          <div key={label as string} className="min-w-0">
            <dt className="text-slate-500">{label}</dt>
            <dd className="m-0 font-semibold tabular-nums text-slate-900">{d ? <time dateTime={d as string}>{dayLabel.format(new Date(`${d}T00:00:00Z`))}</time> : "-"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function LongStayInspectionReport({ report, inspected, inspector }: {
  report?: PublicInspectionReport | null;
  inspector?: { name: string | null; code: string } | null;
  inspected?: { inspectedOn: string | null; validUntil: string | null } | null;
}) {
  const status = report?.status ?? (inspected ? "PASSED" : "PENDING");
  const copy = STATUS_COPY[status];
  const checks = report?.checks ?? [];
  const { applicable, confirmed, score } = inspectionScore(checks);
  const findings = checks.filter((c) => c.result === "FAIL");
  const known = new Set(THEMES.flatMap((t) => t.keys));
  const themes = [
    ...THEMES.map((t) => ({ ...t, checks: t.keys.map((k) => checks.find((c) => c.key === k)).filter(Boolean) as InspectionCheck[] })),
    { key: "other", title: "Other checks", blurb: "Further points checked at the visit", Icon: ClipboardList, keys: [], checks: checks.filter((c) => !known.has(c.key)) },
  ].filter((t) => t.checks.length);
  const hasRecorded = score !== null;

  return (
    <section id="long-stay-inspection" aria-labelledby="long-stay-inspection-title" className="scroll-mt-24 rounded-lg border border-solid border-slate-200 bg-white p-4 sm:p-6">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-2 sm:flex-nowrap">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-[#02665e]">
          <ShieldCheck className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-[180px]">
          <h2 id="long-stay-inspection-title" className="m-0 text-lg font-semibold leading-6 tracking-tight text-slate-950">{status === "PASSED" ? "Inspected in person by NoLSAF" : "Home inspection"}</h2>
          <p className="m-0 mt-0.5 max-w-[65ch] text-[13px] leading-5 text-slate-600">{copy.detail}</p>
        </div>
        <span className={`ml-auto inline-flex min-h-7 shrink-0 items-center gap-1 rounded px-2.5 text-xs font-semibold ${status === "PASSED" ? "bg-emerald-50 text-[#02665e]" : status === "IN_REVIEW" ? "bg-slate-100 text-slate-700" : "bg-amber-50 text-amber-900"}`}>
          {status === "PASSED" ? <Check className="size-3.5" aria-hidden /> : null}{copy.label}
        </span>
      </header>

      {inspector ? (
        <p className="m-0 mt-3 flex flex-wrap items-baseline gap-x-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-semibold">{report?.visitedOn ? "Inspected by" : "Assigned Sales Partner"}</span>
          <span>{inspector.name || inspector.code}</span>
          {inspector.name ? <span className="text-xs text-slate-500">{inspector.code}</span> : null}
        </p>
      ) : null}

      {status === "PASSED" ? (
        <div className="mt-4 space-y-3">
          {hasRecorded ? (
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center">
              <ScoreDial score={score} confirmed={confirmed} applicable={applicable} />
              <Validity visitedOn={report?.visitedOn ?? inspected?.inspectedOn} reviewedOn={report?.reviewedOn} validUntil={report?.validUntil ?? inspected?.validUntil} />
            </div>
          ) : (
            <Validity visitedOn={report?.visitedOn ?? inspected?.inspectedOn} reviewedOn={report?.reviewedOn} validUntil={report?.validUntil ?? inspected?.validUntil} />
          )}

          {findings.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-md border border-solid border-amber-200 bg-amber-50/70 px-3.5 py-2.5">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
              <div className="min-w-0 text-[12.5px] leading-5 text-amber-950">
                <p className="m-0 font-semibold">{findings.length === 1 ? "One point was not met at the visit" : `${findings.length} points were not met at the visit`}</p>
                <p className="m-0 text-amber-900">{findings.map((f) => f.label).join("; ")}. {findings.every((f) => !f.required) ? "These are extra checks; every required check passed." : "Ask NoLSAF before you reserve."}</p>
              </div>
            </div>
          )}

          {themes.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {themes.map((t) => <ThemeCard key={t.key} title={t.title} blurb={t.blurb} Icon={t.Icon} checks={t.checks} />)}
            </div>
          ) : <p className="m-0 text-sm text-slate-600">The checklist is unavailable for this visit.</p>}

          {hasRecorded ? (
            <p className="m-0 text-[11.5px] leading-5 text-slate-500">
              How this works: a NoLSAF Sales Partner visits the home, takes photos there and records their location, and answers each check. NoLSAF reviews the report before the home can be reserved. The score is the share of checks confirmed; checks that do not apply are left out.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-4"><InspectionProgress inReview={status === "IN_REVIEW"} /></div>
      )}
    </section>
  );
}
