"use client";

/**
 * Long-stay home inspections for a Sales Partner (docs/LONG_STAY_RENTALS.md
 * section 13). The partner goes to the home and reports from there: the
 * phone's position, three photos taken on site, the standards checklist and
 * a recommendation. The server measures the distance from the listing's pin
 * and flags anything odd; NoLSAF then passes, fails or asks for a redo.
 * The flat fee is earned for every report NoLSAF accepts, pass or fail.
 */
import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, ClipboardCheck, Clock3, Crosshair, Footprints, Loader2, MapPin, Navigation, Phone, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import { inspectionDate } from "@/lib/salesInspection";

type CheckItem = { key: string; label: string; required: boolean };
type Finding = { note: string; photoIndex?: number };
type Inspection = {
  ref: string;
  status: "INVITED" | "ASSIGNED" | "SUBMITTED" | "PASSED" | "FAILED";
  reason: string;
  assignedAt: string | null;
  dueBy: string | null;
  /** Set while INVITED: accept or decline before this time. */
  replyBy?: string | null;
  home: { title: string | null; type: string | null; area: string; pin: { lat: number; lng: number } | null; listing: { monthlyRent: number; currency: string; furnished: string; utilities: Record<string, string> } | null };
  landlord: { name: string | null; phone: string | null };
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  feeAmount: number | null;
};
type Visit = { ref: string; visitAt: string; note: string | null; home: { title: string | null; area: string; pin: { lat: number; lng: number } | null }; tenant: { name: string | null; phone: string | null } };
type Data = { checklist: CheckItem[]; photoSlots: Array<{ label: string; hint: string }>; items: Inspection[]; inspectionFee?: number };

const DECLINE_REASONS = ["Too far from my area", "No time in the next 5 days", "I know the landlord personally", "I am travelling"];

const STATUS: Record<Inspection["status"], { label: string; tone: string }> = {
  INVITED: { label: "Invitation", tone: "bg-violet-50 text-violet-800" },
  ASSIGNED: { label: "To visit", tone: "bg-amber-50 text-amber-800" },
  SUBMITTED: { label: "With NoLSAF", tone: "bg-sky-50 text-sky-800" },
  PASSED: { label: "Passed", tone: "bg-emerald-50 text-emerald-800" },
  FAILED: { label: "Failed", tone: "bg-red-50 text-red-700" },
};

const mapsLink = (pin: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`;

export default function SalesInspectionsPage() {
  return (
    <SalesShell>
      <Suspense fallback={<LoadingInspections />}>
        <InspectionQueue />
      </Suspense>
    </SalesShell>
  );
}

function LoadingInspections() {
  return <div role="status" aria-label="Loading inspections" className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
}

function InspectionQueue() {
  const focusedRef = useSearchParams().get("inspection");
  const [data, setData] = useState<Data | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const [a, b] = await Promise.all([
        apiClient.get<Data>("/api/sales/long-stay/inspections", { params: { inspection: focusedRef }, signal }),
        apiClient.get<{ items: Visit[] }>("/api/sales/long-stay/visits", { signal }).catch(() => ({ data: { items: [] } })),
      ]);
      if (signal?.aborted) return;
      setData(a.data);
      setVisits(b.data.items);
    } catch (requestError: any) {
      if (signal?.aborted) return;
      setError(requestError?.response?.data?.error || "Could not load your inspections.");
    }
  }, [focusedRef]);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const focused = data?.items.find((item) => item.ref === focusedRef);
  const otherItems = data?.items.filter((item) => item.ref !== focusedRef) ?? [];
  const invites = otherItems.filter((i) => i.status === "INVITED");
  const todo = otherItems.filter((i) => i.status === "ASSIGNED");
  const rest = otherItems.filter((i) => i.status !== "ASSIGNED" && i.status !== "INVITED");
  const card = (item: Inspection, emphasized = false) => item.status === "INVITED" ? (
    <InvitationCard item={item} fee={data?.inspectionFee ?? null} emphasized={emphasized} onChanged={(accepted) => { if (accepted) setOpen(null); void load(); }} />
  ) : (
    <div className={`overflow-hidden rounded-lg border border-solid bg-white ${emphasized ? "border-emerald-300 ring-1 ring-emerald-100" : "border-slate-200"}`}>
      <InspectionHead item={item} compact={item.status !== "ASSIGNED"} />
      {item.status === "ASSIGNED" ? (
        open === item.ref && data ? (
          <ReportForm key={item.ref} item={item} data={data} onDone={() => { setOpen(null); void load(); }} onCancel={() => setOpen(null)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3">
            <button type="button" onClick={() => setOpen(item.ref)} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-sm font-semibold text-white hover:bg-[#014e47] [font-family:inherit]">
              <ClipboardCheck className="h-4 w-4" aria-hidden /> Start on-site report
            </button>
            <span className="text-xs text-slate-600">Open the form when you arrive at the home.</span>
          </div>
        )
      ) : null}
    </div>
  );

  return (
      <div id="sales-inspections" className="w-full space-y-4">
        <style>{`#sales-inspections, #sales-inspections * { box-sizing: border-box; }`}</style>
        <SalesPageHeader
          title="Home inspections"
          description="Arrange each visit with the landlord. Submit your location, photos and findings from the home."
          icon={ClipboardCheck}
          actions={<Link href="/sales/leads" className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-solid border-slate-200 px-3 text-xs font-semibold text-[#02665e] no-underline hover:bg-emerald-50"><ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Leads</Link>}
        />
        {error ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            <p className="m-0">{error}</p>
            <button type="button" onClick={() => void load()} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-rose-800 underline">Retry</button>
          </div>
        ) : null}

        {!data ? (!error ? <LoadingInspections /> : null) : (
          <>
            {focusedRef ? focused ? (
              <section aria-label="Selected inspection">{card(focused, true)}</section>
            ) : (
              <p role="status" className="m-0 rounded-lg border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">This inspection is no longer available in your workspace. Your current assignments are below.</p>
            ) : null}
            {invites.length ? (
              <section aria-label="Invitations">
                <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-900">
                  Invitations <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800">{invites.length} waiting for your reply</span>
                </h2>
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {invites.map((item) => <li key={item.ref}>{card(item)}</li>)}
                </ul>
              </section>
            ) : null}

            <section aria-label="To visit">
              <h2 className="m-0 text-sm font-bold text-slate-900">{focused?.status === "ASSIGNED" ? "Other visits" : "To visit"} <span className="font-normal text-slate-500">({todo.length})</span></h2>
              {todo.length === 0 ? (
                <p className="m-0 mt-2 rounded-lg border border-solid border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">{focused?.status === "ASSIGNED" ? "No other visits scheduled." : invites.length ? "Accept an invitation above to add it here." : "No homes to inspect right now. NoLSAF texts you when it has an invitation."}</p>
              ) : (
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {todo.map((item) => <li key={item.ref}>{card(item)}</li>)}
                </ul>
              )}
            </section>

            {visits.length ? (
              <section aria-label="Tenant visits">
                <h2 className="m-0 text-sm font-bold text-slate-900">Tenant visits to accompany</h2>
                <ul className="m-0 mt-2 list-none overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-0">
                  {visits.map((v) => (
                    <li key={v.ref} className="flex flex-wrap items-start gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
                      <Footprints className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" />
                      <div className="min-w-0 flex-1 text-[13px]">
                        <p className="m-0 font-semibold text-slate-900">{v.home.title} <span className="font-normal text-slate-500">{v.home.area}</span></p>
                        <p className="m-0 mt-0.5 text-slate-700">{inspectionDate(v.visitAt)} · {v.tenant.name || "Tenant"}{v.tenant.phone ? <> · <a href={`tel:${v.tenant.phone}`} className="font-semibold text-[#02665e] no-underline">{v.tenant.phone}</a></> : null}</p>
                        {v.note ? <p className="m-0 mt-0.5 text-slate-500">{v.note}</p> : null}
                      </div>
                      {v.home.pin ? <a href={mapsLink(v.home.pin)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline"><Navigation className="h-3.5 w-3.5" />Directions</a> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {rest.length ? (
              <section aria-label="Submitted reports">
                <h2 className="m-0 text-sm font-bold text-slate-900">Submitted reports</h2>
                <ul className="m-0 mt-2 list-none overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-0">
                  {rest.map((item) => (
                    <li key={item.ref} className="border-0 border-t border-solid border-slate-100 first:border-t-0"><InspectionHead item={item} compact /></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </div>
  );
}

function timeLeft(iso: string | null | undefined) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h >= 1 ? `${h}h ${m}m left` : `${m}m left`;
}

/**
 * An invitation from NoLSAF: what the home is, what the partner earns, and
 * how long they have to answer. Contact and exact pin open only after accepting.
 */
function InvitationCard({ item, fee, emphasized, onChanged }: { item: Inspection; fee: number | null; emphasized?: boolean; onChanged: (accepted: boolean) => void }) {
  const [mode, setMode] = useState<"idle" | "decline">("idle");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"accept" | "decline" | null>(null);
  const [error, setError] = useState("");
  const left = timeLeft(item.replyBy);
  const urgent = item.replyBy ? new Date(item.replyBy).getTime() - Date.now() < 6 * 3_600_000 : false;

  const act = async (kind: "accept" | "decline") => {
    if (kind === "decline" && reason.trim().length < 3) { setError("Tell NoLSAF briefly why you cannot go."); return; }
    setBusy(kind);
    setError("");
    try {
      await apiClient.post(`/api/sales/long-stay/inspections/${encodeURIComponent(item.ref)}/${kind}`, kind === "decline" ? { reason: reason.trim() } : {});
      onChanged(kind === "accept");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not send your answer. Try again.");
      setBusy(null);
    }
  };

  return (
    <article className={`overflow-hidden rounded-lg border border-solid bg-white ${emphasized ? "border-violet-300 ring-1 ring-violet-100" : "border-violet-200"}`}>
      <div className="flex flex-wrap items-start gap-3 px-4 py-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-violet-50 text-violet-700"><ClipboardCheck className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[11.5px] font-semibold text-violet-700">NoLSAF invites you to inspect</p>
          <p className="m-0 mt-0.5 truncate text-sm font-semibold text-slate-900">A long-stay home in {item.home.area || "your area"}</p>
          <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
            {item.home.type ? `${item.home.type.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())} · ` : ""}
            {item.home.listing ? `${item.home.listing.currency} ${item.home.listing.monthlyRent.toLocaleString("en-US")} a month` : "Monthly rental"}
            {item.reason === "AFTER_DISPUTE" ? " · after a tenant complaint" : item.reason === "YEARLY" ? " · yearly check" : " · first inspection"}
          </p>
        </div>
        {left ? (
          <span className={`inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] font-semibold tabular-nums ${urgent ? "bg-rose-50 text-rose-700" : "bg-violet-50 text-violet-800"}`}>
            <Clock3 className="h-3.5 w-3.5" />Reply: {left}
          </span>
        ) : null}
      </div>

      <dl className="m-0 grid grid-cols-1 gap-px border-0 border-t border-solid border-slate-100 bg-slate-100 sm:grid-cols-3">
        <div className="bg-white px-4 py-2.5">
          <dt className="text-[11px] font-semibold text-slate-500">You earn</dt>
          <dd className="m-0 text-[14px] font-bold text-emerald-700">{fee ? `TZS ${fee.toLocaleString("en-US")}` : "Flat fee"}</dd>
          <p className="m-0 text-[11px] text-slate-400">For a report NoLSAF accepts, pass or fail</p>
        </div>
        <div className="bg-white px-4 py-2.5">
          <dt className="text-[11px] font-semibold text-slate-500">Time to visit</dt>
          <dd className="m-0 text-[14px] font-bold text-slate-900">5 days</dd>
          <p className="m-0 text-[11px] text-slate-400">Starts when you accept</p>
        </div>
        <div className="bg-white px-4 py-2.5">
          <dt className="text-[11px] font-semibold text-slate-500">After you accept</dt>
          <dd className="m-0 text-[13px] font-semibold text-slate-900">Landlord contact and exact pin</dd>
          <p className="m-0 text-[11px] text-slate-400">Then 3 photos, location and checklist from the home</p>
        </div>
      </dl>

      {mode === "decline" ? (
        <div className="border-0 border-t border-solid border-slate-100 px-4 py-3">
          <p className="m-0 text-[12.5px] font-semibold text-slate-700">Why can you not go? NoLSAF will invite someone else.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {DECLINE_REASONS.map((r) => (
              <button key={r} type="button" onClick={() => { setReason(r); setError(""); }}
                className={`cursor-pointer rounded-md border border-solid px-2.5 py-1 text-[12px] [font-family:inherit] ${reason === r ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"}`}>{r}</button>
            ))}
          </div>
          <input value={reason} onChange={(e) => { setReason(e.target.value); setError(""); }} maxLength={300} placeholder="Or write your own reason"
            className="mt-2 block h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <button type="button" disabled={busy !== null} onClick={() => void act("decline")} className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-slate-800 px-3.5 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-60 [font-family:inherit]">
              {busy === "decline" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}Decline invitation
            </button>
            <button type="button" onClick={() => { setMode("idle"); setReason(""); setError(""); }} className="inline-flex min-h-9 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Back</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
          <button type="button" disabled={busy !== null} onClick={() => void act("accept")} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-60 [font-family:inherit]">
            {busy === "accept" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Accept, I will visit
          </button>
          <button type="button" disabled={busy !== null} onClick={() => setMode("decline")} className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 [font-family:inherit]">
            <X className="h-4 w-4" />I can&apos;t go
          </button>
          <span className="text-[12px] text-slate-500">If you do not reply in time, NoLSAF asks another partner.</span>
        </div>
      )}
      {error ? <p className="m-0 px-4 pb-3 text-[12.5px] text-rose-700">{error}</p> : null}
    </article>
  );
}

function InspectionHead({ item, compact }: { item: Inspection; compact?: boolean }) {
  const s = STATUS[item.status];
  const late = item.status === "ASSIGNED" && item.dueBy && new Date(item.dueBy).getTime() < Date.now();
  return (
    <div className="flex flex-wrap items-start gap-3 px-4 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><MapPin className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="m-0 truncate text-sm font-semibold text-slate-900">{item.home.title || "Long-stay home"}</p>
        <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">
          {item.home.area}
          {item.home.listing ? ` · ${item.home.listing.currency} ${item.home.listing.monthlyRent.toLocaleString("en-US")} a month` : ""}
          {item.reason === "AFTER_DISPUTE" ? " · after a tenant complaint" : item.reason === "YEARLY" ? " · yearly check" : ""}
        </p>
        {!compact ? (
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-700">
            <span>Landlord: {item.landlord.name || "-"}</span>
            {item.landlord.phone ? <a href={`tel:${item.landlord.phone}`} className="inline-flex items-center gap-1 font-semibold text-[#02665e] no-underline"><Phone className="h-3.5 w-3.5" />{item.landlord.phone}</a> : null}
            {item.home.pin ? <a href={mapsLink(item.home.pin)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#02665e] no-underline"><Navigation className="h-3.5 w-3.5" />Directions</a> : null}
          </p>
        ) : null}
        {item.reviewNote ? <p className="m-0 mt-1 text-[12.5px] text-slate-600">NoLSAF: {item.reviewNote}</p> : null}
        {item.dueBy && item.status === "ASSIGNED" ? <p className={`m-0 mt-1 inline-flex items-center gap-1 text-[12px] ${late ? "font-semibold text-red-700" : "text-slate-500"}`}><Clock3 className="h-3.5 w-3.5" />{late ? "Overdue since" : "Report due"} {inspectionDate(item.dueBy)}</p> : null}
        {item.status === "ASSIGNED" && item.assignedAt ? <p className="m-0 mt-0.5 text-xs text-slate-500">Assigned {inspectionDate(item.assignedAt)}</p> : null}
        {item.status === "SUBMITTED" && item.submittedAt ? <p className="m-0 mt-1 text-xs text-slate-500">Report received {inspectionDate(item.submittedAt)}</p> : null}
        {item.feeAmount ? <p className="m-0 mt-1 text-[12px] font-semibold text-emerald-700">Report fee TZS {item.feeAmount.toLocaleString("en-US")}</p> : null}
      </div>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}>{item.status === "ASSIGNED" && item.reviewedAt ? "Return visit" : s.label}</span>
    </div>
  );
}

function ReportForm({ item, data, onDone, onCancel }: { item: Inspection; data: Data; onDone: () => void; onCancel: () => void }) {
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number; at: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState<Array<File | null>>(() => data.photoSlots.map(() => null));
  const [checks, setChecks] = useState<Record<string, "PASS" | "FAIL" | "NA">>({});
  const [findings, setFindings] = useState<Record<string, Finding>>({});
  const [recommendation, setRecommendation] = useState<"PASS" | "FAIL" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ distanceMeters: number | null; flags: string[] } | null>(null);
  const requiredFailed = data.checklist.filter((c) => c.required && checks[c.key] && checks[c.key] !== "PASS");
  const answered = data.checklist.every((c) => checks[c.key]);
  const photoCount = photos.filter(Boolean).length;

  const locate = () => {
    setError("");
    if (!("geolocation" in navigator)) { setError("This phone cannot share its location."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setPosition({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: Math.round(p.coords.accuracy), at: new Date(p.timestamp).toISOString() }); setLocating(false); },
      () => { setError("Allow location for this site, stand outside the home and try again."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  };

  const changePhoto = (index: number, file: File | null) => {
    if (file && file.size > 8 * 1024 * 1024) { setError("Each photo must be 8 MB or smaller."); return; }
    setPhotos((current) => current.map((photo, n) => n === index ? file : photo));
    setError("");
  };

  const updateFinding = (key: string, change: Partial<Finding>) => {
    setFindings((current) => ({ ...current, [key]: { ...(current[key] ?? { note: "" }), ...change } }));
    setError("");
  };

  const submit = async () => {
    setError("");
    if (!position) return setError("Capture your position at the home first.");
    if (photoCount !== data.photoSlots.length) return setError("Take exactly three photos at the home, one for each slot.");
    if (!answered) return setError("Answer every item on the checklist.");
    const failedChecks = data.checklist.filter(({ key }) => checks[key] === "FAIL");
    const missingFinding = failedChecks.find(({ key }) => (findings[key]?.note.trim().length ?? 0) < 3);
    if (missingFinding) return setError("Add a short finding for every item answered No.");
    if (!recommendation) return setError("Recommend pass or fail.");
    if (recommendation === "PASS" && requiredFailed.length) return setError("A home cannot pass while a required item is not met.");
    if (note.trim().length < 10) return setError("Write a short note of what you saw (10 characters or more).");
    const form = new FormData();
    photos.forEach((photo) => { if (photo) form.append("photos", photo); });
    form.append("latitude", String(position.lat));
    form.append("longitude", String(position.lng));
    form.append("accuracyMeters", String(position.accuracy));
    form.append("capturedAt", position.at);
    form.append("checklist", JSON.stringify(checks));
    form.append("findings", JSON.stringify(Object.fromEntries(failedChecks.map(({ key }) => [key, findings[key]]))));
    form.append("recommendation", recommendation);
    form.append("note", note.trim());
    setBusy(true);
    try {
      const response = await apiClient.post(`/api/sales/long-stay/inspections/${encodeURIComponent(item.ref)}/report`, form, { headers: { "Content-Type": "multipart/form-data" } });
      setResult({ distanceMeters: response.data.distanceMeters, flags: response.data.flags || [] });
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not send the report. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <div className="border-0 border-t border-solid border-slate-100 px-4 py-4 text-[13px]">
        <p className="m-0 flex items-center gap-2 font-semibold text-emerald-800"><CheckCircle2 className="h-4 w-4" />Report sent to NoLSAF</p>
        <p className="m-0 mt-1 text-slate-600">{result.distanceMeters != null ? `You were ${result.distanceMeters} m from the listing's pin.` : "The listing has no pin; NoLSAF will check the location."}</p>
        {result.flags.length ? <p className="m-0 mt-1 flex items-center gap-1.5 text-amber-800"><AlertTriangle className="h-4 w-4" />NoLSAF will look at: {result.flags.join(", ").toLowerCase().replace(/_/g, " ")}</p> : null}
        <button type="button" onClick={onDone} className="mt-3 inline-flex h-9 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Done</button>
      </div>
    );
  }

  const seg = (key: string, value: "PASS" | "FAIL" | "NA", label: string) => (
    <button type="button" onClick={() => {
      setChecks((c) => ({ ...c, [key]: value }));
      if (value === "FAIL" && data.checklist.some((item) => item.key === key && item.required)) {
        setRecommendation((current) => current === "PASS" ? "" : current);
      }
      setError("");
    }} aria-pressed={checks[key] === value}
      className={`h-8 min-w-12 cursor-pointer rounded-md border border-solid px-2 text-[12px] font-semibold [font-family:inherit] ${checks[key] === value
        ? value === "PASS" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : value === "FAIL" ? "border-red-500 bg-red-50 text-red-700" : "border-slate-400 bg-slate-100 text-slate-700"
        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"}`}>
      {label}
    </button>
  );

  return (
    <div className="space-y-4 border-0 border-t border-solid border-slate-100 px-4 py-4">
      <div>
        <p className="m-0 text-[13px] font-semibold text-slate-800">1. Your position at the home</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={locate} disabled={locating} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-[#02665e] bg-white px-3.5 text-sm font-semibold text-[#02665e] hover:bg-[#02665e]/5 disabled:opacity-60 [font-family:inherit]">
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}{position ? "Capture again" : "Capture position"}
          </button>
          {position ? <span className={`text-[12.5px] ${position.accuracy > 100 ? "text-amber-700" : "text-emerald-700"}`}>Captured, within about {position.accuracy} m{position.accuracy > 100 ? ". Step outside for a better signal." : ""}</span> : null}
        </div>
      </div>

      <div>
        <p className="m-0 text-[13px] font-semibold text-slate-800">2. Photos at the home <span className="ml-1 font-normal text-slate-600">{photoCount} of {data.photoSlots.length}</span></p>
        <ul className="m-0 mt-2 grid list-none gap-2 p-0 md:grid-cols-3">
          {data.photoSlots.map(({ label, hint }, index) => (
            <li key={label} className="flex min-w-0 flex-col rounded-md border border-solid border-slate-200 bg-slate-50 p-3">
              <p className="m-0 text-[13px] font-semibold text-slate-800">{index + 1}. {label}</p>
              <p className="m-0 mb-2 mt-1 grow text-xs leading-5 text-slate-600">{hint}</p>
              {photos[index] ? <p className="m-0 mb-2 flex min-w-0 items-center gap-1 text-xs text-emerald-800"><CheckCircle2 className="size-3.5 shrink-0" aria-hidden /><span className="truncate">{photos[index].name}</span></p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-xs font-semibold text-[#02665e] hover:bg-[#02665e]/5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-[#02665e]">
                  <Camera className="size-4" aria-hidden />{photos[index] ? "Replace" : "Take photo"}
                  <input aria-label={`${photos[index] ? "Replace photo" : "Take photo"} for ${label}`} type="file" accept="image/*" capture="environment" className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) changePhoto(index, file);
                      event.target.value = "";
                    }}
                  />
                </label>
                {photos[index] ? (
                  <button type="button" aria-label={`Remove photo for ${label}`} onClick={() => changePhoto(index, null)}
                    className="grid size-8 cursor-pointer place-items-center rounded-md border border-solid border-slate-200 bg-white p-0 text-slate-600 hover:text-red-700">
                    <X className="size-4" aria-hidden />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div>
        <p className="m-0 text-[13px] font-semibold text-slate-800">3. Standards</p>
        <ul className="m-0 mt-1.5 list-none p-0">
          {data.checklist.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 py-2 text-[13px] first:border-t-0">
              <span id={`inspection-${item.ref}-${c.key}`} className="min-w-0 flex-1 text-slate-700">{c.label}{c.required ? <span className="text-red-600"> *</span> : null}</span>
              <span role="group" aria-labelledby={`inspection-${item.ref}-${c.key}`} className="flex gap-1">{seg(c.key, "PASS", "Yes")}{seg(c.key, "FAIL", "No")}{c.required ? null : seg(c.key, "NA", "N/A")}</span>
              {checks[c.key] === "FAIL" ? (
                <div className="grid w-full min-w-0 gap-2 rounded-md border border-solid border-slate-200 bg-slate-50 p-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)]">
                  <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-700">
                    What did you find?
                    <textarea rows={2} required maxLength={300} placeholder="Describe the issue and where you found it."
                      value={findings[c.key]?.note ?? ""} onChange={(event) => updateFinding(c.key, { note: event.target.value })}
                      className="box-border w-full resize-y rounded-md border border-solid border-slate-300 bg-white px-2 py-1.5 text-[13px] font-normal text-slate-800" />
                  </label>
                  <label className="grid min-w-0 content-start gap-1 text-xs font-semibold text-slate-700">
                    Link a photo (optional)
                    <select value={findings[c.key]?.photoIndex ?? ""} onChange={(event) => updateFinding(c.key, { photoIndex: event.target.value === "" ? undefined : Number(event.target.value) })}
                      className="box-border h-9 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-2 text-xs font-normal text-slate-800">
                      <option value="">No photo linked</option>
                      {data.photoSlots.map(({ label }, index) => <option key={label} value={index}>{index + 1}. {label}</option>)}
                    </select>
                  </label>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="m-0 mt-1 text-[11.5px] text-slate-400">* Must be Yes for the home to pass.</p>
      </div>

      <div>
        <p className="m-0 text-[13px] font-semibold text-slate-800">4. Your recommendation</p>
        <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-sm">
          <button type="button" disabled={requiredFailed.length > 0} onClick={() => setRecommendation("PASS")} aria-pressed={recommendation === "PASS"}
            className={`flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40 [font-family:inherit] ${recommendation === "PASS" ? "border-emerald-600 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}>
            <CheckCircle2 className="h-4 w-4" />Pass
          </button>
          <button type="button" onClick={() => setRecommendation("FAIL")} aria-pressed={recommendation === "FAIL"}
            className={`flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid text-sm font-semibold [font-family:inherit] ${recommendation === "FAIL" ? "border-red-500 bg-red-50 text-red-700" : "border-slate-300 bg-white text-slate-700"}`}>
            <XCircle className="h-4 w-4" />Fail
          </button>
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="What you saw, who you met, and anything the tenant should know"
          className="mt-2 min-h-20 w-full resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
        <p className="m-0 mt-1 text-[11.5px] text-slate-500">You earn the same fee for a pass or a fail. Report what you see.</p>
      </div>

      {error ? <p className="m-0 text-[13px] text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={submit} className="inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-60 [font-family:inherit]">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}{busy ? "Sending photos" : "Send report"}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className="inline-flex h-10 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 [font-family:inherit]">Cancel</button>
      </div>
    </div>
  );
}
