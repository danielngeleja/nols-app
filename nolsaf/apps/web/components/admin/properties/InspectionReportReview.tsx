"use client";

import { useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, ArrowDown, Camera, Check, ChevronDown, ChevronUp, ClipboardCheck, Crosshair, ExternalLink, FileText, Loader2, MapPin, Minus, RotateCcw, ShieldCheck, X } from "lucide-react";

export type InspectionPoint = { latitude: number; longitude: number };
export type InspectionCheck = { key: string; label: string; required: boolean };
export type InspectionDecision = "PASS" | "FAIL" | "REDO";
export type InspectionReport = {
  checklist: Record<string, "PASS" | "FAIL" | "NA">;
  findings?: Record<string, { note: string; photoIndex?: number }>;
  photoCount: number;
  photoLabels?: string[];
  recommendation: "PASS" | "FAIL" | null;
  note: string | null;
  position: InspectionPoint | null;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  flags: string[];
  capturedAt: string | null;
  submittedAt: string | null;
};

const blockingFlags = new Set(["FAR_FROM_PIN", "DUPLICATE_PHOTO"]);
const flagLabels: Record<string, string> = {
  NO_PIN: "The listing has no map pin to compare.",
  FAR_FROM_PIN: "The phone was more than 300 m from the listing pin.",
  LOW_ACCURACY: "The phone’s GPS uncertainty was over 100 m.",
  DUPLICATE_PHOTO: "A photo was used in another inspection.",
  LATE_UPLOAD: "The report was uploaded more than 6 hours after capture.",
};
const photoLabels = ["Property entrance", "Inside the home", "Key finding"];
const sectionHeading = "m-0 flex items-center gap-2 text-sm font-semibold text-slate-950";
const actionClass = "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-solid px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";
const utilityAction = "inline-flex min-h-8 items-center gap-1.5 rounded-md border border-solid border-slate-200 bg-white px-2.5 text-xs font-semibold text-[#245c52] no-underline transition hover:border-[#a5cbbf] hover:bg-[#edf6f2] hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e]";
const metres = (value: number) => `${value.toLocaleString("en-US")} m`;
const coordinates = ({ latitude, longitude }: InspectionPoint) => `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
const mapPoint = ({ latitude, longitude }: InspectionPoint) => `${latitude},${longitude}`;
const visitTime = (value: string) => `${new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Dar_es_Salaam" }).format(new Date(value))} EAT`;

export default function InspectionReportReview({ inspectionRef, report, checklist, pin, busy, error, onDecision }: {
  inspectionRef: string;
  report: InspectionReport;
  checklist: InspectionCheck[];
  pin: InspectionPoint | null;
  busy: boolean;
  error?: string;
  onDecision?: (decision: InspectionDecision, note: string) => void;
}) {
  const id = useId();
  const gallery = useRef<HTMLElement>(null);
  const decisionPanel = useRef<HTMLElement>(null);
  const checklistScroll = useRef<HTMLDivElement>(null);
  const checklistRows = useRef<HTMLUListElement>(null);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const [photo, setPhoto] = useState<number | null>(null);
  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState("");
  const [checksFilter, setChecksFilter] = useState<"all" | "findings">("all");
  const [scrollEdges, setScrollEdges] = useState({ above: false, below: false });
  const required = checklist.filter((item) => item.required);
  const requiredMet = required.filter((item) => report.checklist[item.key] === "PASS").length;
  const hasBlockingFlag = report.flags.some((flag) => blockingFlags.has(flag));
  const allPhotosOpened = report.photoCount > 0 && opened.size === report.photoCount;
  const passIssues = [
    report.recommendation !== "PASS" && (report.recommendation === "FAIL" ? "The partner recommended failing the inspection." : "The partner’s recommendation is missing."),
    requiredMet < required.length && `${required.length - requiredMet} required checks were not met.`,
    hasBlockingFlag && "The report has evidence flags that block a pass.",
    !allPhotosOpened && (report.photoCount ? "Open each evidence photo before passing." : "This report has no evidence photos."),
  ].filter((issue): issue is string => typeof issue === "string");
  const photos = Array.from({ length: report.photoCount }, (_, index) => report.photoLabels?.[index] || photoLabels[index] || `Photo ${index + 1}`);
  const photoSrc = photo === null ? null : `/api/admin/long-stay/inspections/${encodeURIComponent(inspectionRef)}/photos/${photo}`;
  const noteReady = note.trim().length >= 5;
  const needsAttention = (item: InspectionCheck) => report.checklist[item.key] === "FAIL" || (item.required && report.checklist[item.key] !== "PASS");
  const issues = checklist.filter(needsAttention);
  const orderedChecks = [...issues, ...checklist.filter((item) => !needsAttention(item))];
  const shownChecks = checksFilter === "findings" ? issues : orderedChecks;
  const metrics = [
    { label: "Required checks met", value: required.length ? `${requiredMet} / ${required.length}` : "Unavailable", Icon: ClipboardCheck, tone: requiredMet < required.length ? "text-rose-800" : "text-[#215b4e]" },
    { label: "Evidence flags", value: report.flags.length ? `${report.flags.length} · ${hasBlockingFlag ? "Blocks pass" : "To review"}` : "None flagged", Icon: ShieldCheck, tone: hasBlockingFlag ? "text-rose-800" : "text-slate-950" },
    { label: "Photos reviewed", value: `${opened.size} / ${report.photoCount}`, Icon: Camera, tone: allPhotosOpened ? "text-[#215b4e]" : "text-slate-950" },
  ];

  useEffect(() => {
    const viewport = checklistScroll.current;
    const rows = checklistRows.current;
    if (!viewport || !rows) return;
    const update = () => {
      const above = viewport.scrollTop > 1;
      const below = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 1;
      setScrollEdges((current) => current.above === above && current.below === below ? current : { above, below });
    };
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    observer.observe(rows);
    viewport.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  function scrollChecks(direction: -1 | 1) {
    const viewport = checklistScroll.current;
    if (viewport) viewport.scrollBy({ top: direction * viewport.clientHeight * 0.75 });
  }

  function openPhoto(index: number, fromFinding = false) {
    if (photo !== index || load === "failed") {
      setPhoto(index);
      setLoad("loading");
      setAttempt((current) => current + 1);
    }
    if (fromFinding) {
      gallery.current?.focus({ preventScroll: true });
      gallery.current?.scrollIntoView({ block: "start" });
    }
  }

  return (
    <section aria-labelledby={`${id}-report`} className="min-w-0 space-y-4 border-0 border-t border-solid border-slate-200 bg-[#f5f8f7] p-3 sm:p-5">
      <div className="overflow-hidden rounded-lg border border-solid border-[#d8e5e1] bg-white">
        <header className="flex flex-wrap items-center gap-3 bg-[#f1f7f4] px-4 py-3.5 sm:px-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white"><FileText className="size-5" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <h3 id={`${id}-report`} className="m-0 text-lg font-semibold tracking-tight text-slate-950">Partner inspection report</h3>
            {report.submittedAt && <p className="m-0 mt-1 text-xs text-slate-600">Submitted {visitTime(report.submittedAt)}</p>}
          </div>
          <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold ring-1 ring-inset ${report.recommendation === "PASS" ? "bg-white text-[#215b4e] ring-[#bddbd0]" : report.recommendation === "FAIL" ? "bg-rose-50 text-rose-800 ring-rose-200" : "bg-white text-slate-700 ring-slate-200"}`}>
            {report.recommendation === "PASS" ? <Check className="size-4" aria-hidden /> : report.recommendation === "FAIL" ? <X className="size-4" aria-hidden /> : null}
            {report.recommendation === "PASS" ? "Partner recommends pass" : report.recommendation === "FAIL" ? "Partner recommends fail" : "Recommendation missing"}
          </span>
          {onDecision && <button type="button" onClick={() => {
            decisionPanel.current?.focus({ preventScroll: true });
            decisionPanel.current?.scrollIntoView({ block: "nearest" });
          }} className={`${utilityAction} cursor-pointer [font-family:inherit]`}>Go to decision <ArrowDown className="size-3.5" aria-hidden /></button>}
        </header>
        <dl className="m-0 grid grid-cols-2 gap-px border-0 border-t border-solid border-[#d8e5e1] bg-[#d8e5e1] sm:grid-cols-3">
          {metrics.map(({ label, value, Icon, tone }, index) => (
            <div key={label} className={`min-w-0 bg-white px-4 py-3 sm:px-5 ${index === 2 ? "col-span-2 sm:col-span-1" : ""}`}>
              <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600"><Icon className="size-3.5 shrink-0 text-[#39796d]" aria-hidden />{label}</dt>
              <dd aria-live={index === 2 ? "polite" : undefined} className={`m-0 mt-1 text-lg font-bold tabular-nums ${tone}`}>{value}</dd>
            </div>
          ))}
        </dl>
        {report.note && <div className="flex items-start gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-4 py-3.5 sm:px-5"><FileText className="mt-0.5 size-4 shrink-0 text-[#39796d]" aria-hidden /><div className="min-w-0"><p className="m-0 text-xs font-semibold text-slate-700">Partner’s notes</p><p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-800">{report.note}</p></div></div>}
        {report.flags.length > 0 && (
          <ul aria-label="Evidence flags" className="m-0 list-none space-y-2 border-0 border-t border-solid border-slate-100 p-3 sm:px-5">
            {report.flags.map((flag) => (
              <li key={flag} className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${blockingFlags.has(flag) ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span><strong>{blockingFlags.has(flag) ? "Blocks a pass" : "Needs a closer look"}</strong> · {flagLabels[flag] ?? flag}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
          <div className="p-4">
            <h4 className={sectionHeading}><Crosshair className="size-4 text-[#28645a]" aria-hidden />Location evidence</h4>
            {report.capturedAt && <p className="m-0 mt-1 text-xs text-slate-600">Captured {visitTime(report.capturedAt)}</p>}
            <dl className="m-0 mt-3 grid grid-cols-2 divide-x divide-slate-200 rounded-md bg-slate-50 p-2.5">
              <div className="px-1"><dt className="text-xs text-slate-600">Distance from listing pin</dt><dd className="m-0 mt-1 text-sm font-semibold text-slate-900">{report.distanceMeters === null ? "Unavailable" : metres(report.distanceMeters)}</dd></div>
              <div className="pl-3"><dt className="text-xs text-slate-600">GPS uncertainty</dt><dd className="m-0 mt-1 text-sm font-semibold text-slate-900">{report.accuracyMeters === null ? "Unavailable" : `±${metres(report.accuracyMeters)}`}</dd></div>
            </dl>
            {report.distanceMeters != null && report.accuracyMeters != null && report.distanceMeters <= report.accuracyMeters && (
              <p className="m-0 mt-2 text-xs leading-relaxed text-slate-600">The distance between the pins is within the phone’s GPS uncertainty.</p>
            )}
          </div>
          <EvidenceMap pin={pin} position={report.position} />
          <div className="space-y-3 border-0 border-t border-solid border-slate-200 p-4">
            <dl className="m-0 grid gap-1.5">
              <Coordinate label="Listing pin" point={pin} color="bg-[#02665e]" />
              <Coordinate label="Partner’s phone" point={report.position} color="bg-orange-600" />
            </dl>
            {pin && report.position && (
              <a href={`https://www.google.com/maps/dir/?api=1&origin=${mapPoint(report.position)}&destination=${mapPoint(pin)}`} target="_blank" rel="noopener noreferrer"
                className={utilityAction}>
                Compare in Google Maps <ExternalLink className="size-3" aria-hidden />
              </a>
            )}
          </div>
        </section>

        <section ref={gallery} tabIndex={-1} aria-labelledby={`${id}-photos`} className="min-w-0 scroll-mt-16 rounded-lg border border-solid border-slate-200 bg-white p-4 focus-visible:outline-2 focus-visible:outline-[#02665e]">
          <h4 id={`${id}-photos`} className={sectionHeading}><Camera className="size-4 text-[#28645a]" aria-hidden />Photo evidence</h4>
          {photos.length > 0 ? (
            <>
              <div className="mt-3 grid gap-1.5 sm:grid-cols-3" role="group" aria-label="Select an evidence photo">
                {photos.map((label, index) => (
                  <button key={index} type="button" aria-pressed={photo === index} onClick={() => openPhoto(index)}
                    className={`flex min-h-11 min-w-0 cursor-pointer items-center gap-1.5 rounded-md border border-solid px-2 py-1.5 text-left text-xs font-semibold [font-family:inherit] ${photo === index ? "border-[#86b3a7] bg-[#e9f4f0] text-[#174c43]" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                    <span className="grid size-5 shrink-0 place-items-center rounded bg-slate-100 text-[11px] tabular-nums">{opened.has(index) ? <Check className="size-3.5 text-[#02665e]" aria-label="Opened" /> : index + 1}</span><span className="min-w-0 break-words">{label}</span>
                  </button>
                ))}
              </div>
              <figure className="m-0 mt-3 overflow-hidden rounded-md border border-solid border-slate-200 bg-slate-100">
                <div className="relative grid aspect-[4/3] max-h-[30rem] place-items-center overflow-hidden">
                  {photoSrc && load !== "failed" && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={attempt} src={photoSrc} alt={photos[photo!]} className="absolute inset-0 block size-full object-contain"
                      onLoad={() => { if (photo !== null) setOpened((current) => new Set(current).add(photo)); setLoad("ready"); }}
                      onError={() => setLoad("failed")} />
                  )}
                  {!photoSrc && <p className="m-0 px-4 text-center text-sm text-slate-600">Choose a photo to inspect it at full frame.</p>}
                  {photoSrc && load === "loading" && <span role="status" className="relative inline-flex items-center gap-2 text-sm text-slate-700"><Loader2 className="size-4 animate-spin" aria-hidden />Loading photo</span>}
                  {photo !== null && load === "failed" && <div role="status" className="flex flex-col items-center gap-2 px-3 text-center text-sm text-slate-700">This photo could not load.<button type="button" onClick={() => openPhoto(photo)} className={`${utilityAction} cursor-pointer`}>Try again</button></div>}
                </div>
                {photo !== null && <figcaption className="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 text-xs text-slate-700"><span>{photo + 1} of {photos.length} · {photos[photo]}</span>{photoSrc && load === "ready" && <a href={photoSrc} target="_blank" rel="noopener noreferrer" className={utilityAction}>Open full size <ExternalLink className="size-3" aria-hidden /></a>}</figcaption>}
              </figure>
            </>
          ) : <p className="m-0 mt-2 text-sm text-slate-600">No photos were attached.</p>}
        </section>
      </div>

      <section aria-labelledby={`${id}-checklist`} className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 px-4 py-3">
          <h4 id={`${id}-checklist`} className={sectionHeading}><span className="grid size-8 place-items-center rounded-md bg-[#edf5f2] text-[#28645a]"><ClipboardCheck className="size-4" aria-hidden /></span>Inspection checklist</h4>
          <div className="inline-flex max-w-full rounded-md border border-solid border-slate-200 bg-slate-50 p-0.5" role="group" aria-label="Filter inspection checks">
            {([{ key: "all", label: "All checks", count: checklist.length }, { key: "findings", label: "Needs attention", count: issues.length }] as const).map(({ key, label, count }) => (
              <button key={key} type="button" aria-pressed={checksFilter === key} aria-controls={`${id}-checks`} onClick={() => {
                setChecksFilter(key);
                if (checklistScroll.current) checklistScroll.current.scrollTop = 0;
              }} className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded border-0 px-2.5 text-xs font-semibold transition [font-family:inherit] ${checksFilter === key ? "bg-white text-[#215b4e] shadow-sm" : "bg-transparent text-slate-600 hover:text-slate-900"}`}>
                {label}<span className={`rounded px-1 tabular-nums ${key === "findings" && count ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>{count}</span>
              </button>
            ))}
          </div>
        </header>
        <div ref={checklistScroll} id={`${id}-checks`} role="region" aria-label="Inspection check results" tabIndex={0}
          className="max-h-[min(23rem,55dvh)] overflow-y-auto [scrollbar-color:#86a89f_#edf3f1] [scrollbar-gutter:stable] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#02665e]">
          <div aria-hidden className="sticky top-0 z-[1] hidden grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] gap-3 border-0 border-b border-solid border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600 sm:grid">
            <span className="pl-9">Check</span><span>Priority</span><span>Result</span>
          </div>
          {shownChecks.length === 0 && <p className="m-0 px-4 py-5 text-sm text-slate-600">{checksFilter === "findings" ? "No checks need attention." : "No checklist results were supplied."}</p>}
          <ul ref={checklistRows} className="m-0 list-none divide-y divide-slate-100 p-0">
            {shownChecks.map((item) => {
              const result = report.checklist[item.key];
              const finding = report.findings?.[item.key];
              const index = finding?.photoIndex;
              const issue = needsAttention(item);
              return (
                <li key={item.key} className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] ${issue ? "bg-amber-50/65" : "hover:bg-slate-50/70"}`}>
                  <div className="flex min-w-0 items-start gap-2">
                    <span className={`grid size-7 shrink-0 place-items-center rounded ${issue ? "bg-amber-100 text-amber-900" : result === "PASS" ? "bg-[#e8f4ef] text-[#215b4e]" : "bg-slate-100 text-slate-500"}`}>
                      {issue ? <AlertTriangle className="size-3.5" aria-hidden /> : result === "PASS" ? <Check className="size-3.5" aria-hidden /> : <Minus className="size-3.5" aria-hidden />}
                    </span>
                    <div className="min-w-0 pt-1">
                      <p className="m-0 font-medium leading-snug text-slate-900">{item.label}</p>
                      <span className="text-xs text-slate-500 sm:hidden">{item.required ? "Required" : "Optional"}</span>
                      {finding?.note && <p className="m-0 mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">{finding.note}</p>}
                      {index != null && index >= 0 && index < photos.length && <button type="button" onClick={() => openPhoto(index, true)} className={`${utilityAction} mt-2 max-w-full cursor-pointer text-left`}><Camera className="size-3.5 shrink-0" aria-hidden /><span>Photo {index + 1} · {photos[index]}</span></button>}
                    </div>
                  </div>
                  <span className="mt-1 hidden text-xs text-slate-600 sm:block">{item.required ? "Required" : "Optional"}</span>
                  <span className={`mt-0.5 justify-self-start rounded px-1.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${issue ? "bg-amber-100 text-amber-950 ring-amber-200" : result === "PASS" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-700 ring-slate-200"}`}>{result === "PASS" ? "Met" : result === "FAIL" ? "Not met" : result === "NA" ? "N/A" : "Unanswered"}</span>
                </li>
              );
            })}
          </ul>
        </div>
        {(scrollEdges.above || scrollEdges.below) && (
          <footer className="flex items-center justify-between gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50 px-4 py-1.5">
            <span className="text-xs font-medium text-slate-600">{shownChecks.length} checks · scroll to review</span>
            <div className="flex gap-1" role="group" aria-label="Scroll checklist">
              <button type="button" aria-label="Scroll checks up" disabled={!scrollEdges.above} onClick={() => scrollChecks(-1)} className={`${utilityAction} min-h-7 cursor-pointer px-1.5 disabled:cursor-default disabled:opacity-40`}><ChevronUp className="size-4" aria-hidden /></button>
              <button type="button" aria-label="Scroll checks down" disabled={!scrollEdges.below} onClick={() => scrollChecks(1)} className={`${utilityAction} min-h-7 cursor-pointer px-1.5 disabled:cursor-default disabled:opacity-40`}><ChevronDown className="size-4" aria-hidden /></button>
            </div>
          </footer>
        )}
      </section>

      {onDecision && (
        <section ref={decisionPanel} tabIndex={-1} aria-labelledby={`${id}-decision`} className="scroll-mt-16 space-y-3 rounded-lg border border-solid border-[#d8e5e1] bg-white p-4 focus-visible:outline-2 focus-visible:outline-[#02665e] sm:p-5">
          <h4 id={`${id}-decision`} className={sectionHeading}><ShieldCheck className="size-4 text-[#28645a]" aria-hidden />NoLSAF decision</h4>
          {passIssues.length > 0 && (
            <div className="rounded-md bg-amber-50 px-3 py-2.5 text-sm text-amber-950">
              <p className="m-0 font-semibold">Pass unavailable</p>
              <ul className="m-0 mt-1 space-y-0.5 pl-4">{passIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
            </div>
          )}
          <div>
            <label htmlFor={`${id}-note`} className="block text-sm font-semibold text-slate-900">Decision note</label>
            <p id={`${id}-note-help`} className="m-0 mt-1 text-xs leading-relaxed text-slate-600">Write at least five characters. The landlord sees the reason for a fail, and the partner sees the reason for a return visit.</p>
            <textarea id={`${id}-note`} aria-describedby={`${id}-note-help`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} rows={3}
              className="mt-2 box-border block w-full resize-y rounded-md border border-solid border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#02665e] focus:outline-none [font-family:inherit]" />
          </div>
          {error && <p role="alert" className="m-0 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || !noteReady || passIssues.length > 0} onClick={() => onDecision("PASS", note.trim())} className={`${actionClass} border-[#02665e] bg-[#02665e] text-white hover:bg-[#014e47]`}><Check className="size-4" aria-hidden />Pass for 12 months</button>
            <button type="button" disabled={busy || !noteReady} onClick={() => onDecision("FAIL", note.trim())} className={`${actionClass} border-rose-200 bg-white text-rose-800 hover:bg-rose-50`}><X className="size-4" aria-hidden />Fail inspection</button>
            <button type="button" disabled={busy || !noteReady} onClick={() => onDecision("REDO", note.trim())} className={`${actionClass} border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}><RotateCcw className="size-4" aria-hidden />Request another visit</button>
            {busy && <span role="status" className="inline-flex items-center gap-1.5 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Saving decision</span>}
          </div>
          <p className="m-0 text-xs text-slate-600">Pass and fail pay the partner’s inspection fee. A return visit carries no fee.</p>
        </section>
      )}
    </section>
  );
}

function Coordinate({ label, point, color }: { label: string; point: InspectionPoint | null; color: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md bg-slate-50 px-2.5 py-1.5 text-xs">
      <dt className="flex items-center gap-2 text-slate-700"><span className={`size-2 rounded-full ${color}`} aria-hidden />{label}</dt>
      <dd className="m-0 text-slate-700">{point ? <a href={`https://www.google.com/maps/search/?api=1&query=${mapPoint(point)}`} aria-label={`Open ${label} in Google Maps, ${coordinates(point)}`} target="_blank" rel="noopener noreferrer" className={`${utilityAction} min-h-7 font-mono font-medium tabular-nums`}>{coordinates(point)}<ExternalLink className="size-3 shrink-0" aria-hidden /></a> : "Unavailable"}</dd>
    </div>
  );
}

function EvidenceMap({ pin, position }: { pin: InspectionPoint | null; position: InspectionPoint | null }) {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const [failed, setFailed] = useState(false);
  const centre = position ?? pin;
  if (!token || !centre || failed) {
    return <p className="m-0 flex min-h-24 items-center justify-center gap-2 bg-slate-50 px-3 text-center text-xs text-slate-600"><MapPin className="size-4 shrink-0" aria-hidden />{centre ? "Map preview unavailable. Open the coordinates below." : "No coordinates available for the map."}</p>;
  }
  const markers = [
    pin && `pin-s+02665e(${pin.longitude},${pin.latitude})`,
    position && `pin-s+ea580c(${position.longitude},${position.latitude})`,
  ].filter(Boolean).join(",");
  const both = Boolean(pin && position);
  const view = both ? "auto" : `${centre.longitude},${centre.latitude},15,0`;
  const src = `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${markers}/${view}/640x300@2x?${both ? "padding=64&" : ""}access_token=${encodeURIComponent(token)}`;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={both ? "Map with the teal listing pin and orange partner’s phone position" : pin ? "Map with the listing pin" : "Map with the partner’s phone position"} onError={() => setFailed(true)} width={640} height={300} className="block h-auto w-full bg-slate-100" />
  );
}
