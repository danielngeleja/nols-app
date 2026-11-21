"use client";

/**
 * Long-stay home inspections (docs/LONG_STAY_RENTALS.md section 13).
 * No long-stay home goes live without a NoLSAF Sales Partner's on-site check.
 * Assign a partner (not the owner, not the partner who brought the home in),
 * then review the report: PASS for a year, FAIL, or REDO with no fee.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Clock3, ExternalLink, Loader2, MapPin, Phone, RotateCcw, UserRoundCheck, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type View = "todo" | "review" | "passed" | "failed";
type CheckItem = { key: string; label: string; required: boolean };
type Item = {
  ref: string;
  status: "REQUESTED" | "ASSIGNED" | "SUBMITTED" | "PASSED" | "FAILED";
  reason: string;
  home: { title: string | null; area: string; hasPin: boolean };
  landlord: { name: string | null; phone: string | null };
  partner: { code: string; name: string | null } | null;
  assignedAt: string | null;
  dueBy: string | null;
  overdue: boolean;
  report: {
    checklist: Record<string, "PASS" | "FAIL" | "NA">;
    photoCount: number;
    recommendation: "PASS" | "FAIL";
    note: string;
    distanceMeters: number | null;
    accuracyMeters: number | null;
    flags: string[];
    capturedAt: string;
    submittedAt: string;
  } | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  validUntil: string | null;
  current: boolean;
  feeAmount: number | null;
  createdAt: string;
};
type Data = { counts: Record<View, number>; checklist: CheckItem[]; items: Item[] };

const TABS: Array<{ key: View; label: string; Icon: typeof Clock3 }> = [
  { key: "todo", label: "To assign or visit", Icon: Clock3 },
  { key: "review", label: "To review", Icon: ClipboardCheck },
  { key: "passed", label: "Passed", Icon: CheckCircle2 },
  { key: "failed", label: "Failed", Icon: XCircle },
];
const FLAG_TEXT: Record<string, string> = {
  NO_PIN: "The listing has no map pin",
  FAR_FROM_PIN: "Reported more than 300 m from the pin",
  LOW_ACCURACY: "Phone location was imprecise",
  DUPLICATE_PHOTO: "A photo was used on another inspection",
  LATE_UPLOAD: "Sent more than 6 hours after capture",
};
const BLOCKING = ["FAR_FROM_PIN", "DUPLICATE_PHOTO"];

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}
function day(iso: string | null) {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

export default function LongStayInspectionsPage() {
  const [view, setView] = useState<View>("todo");
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get<Data>(`/api/admin/long-stay/inspections?view=${view}`);
      setData(response.data);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load inspections.");
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  const counts = data?.counts;
  return (
    <div id="ls-inspections" className="w-full">
      <style>{`#ls-inspections, #ls-inspections * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Inspections"
        description="Every long-stay home is checked on site by a NoLSAF Sales Partner before it goes live, then once a year and after any upheld complaint."
        metrics={[
          { label: "Waiting", value: counts?.todo ?? "-", tone: counts?.todo ? "warn" : "default" },
          { label: "To review", value: counts?.review ?? "-", tone: counts?.review ? "warn" : "default" },
          { label: "Passed", value: counts?.passed ?? "-", tone: "good" },
          { label: "Failed", value: counts?.failed ?? "-", tone: "muted" },
        ]}
        onRefresh={load}
        loading={loading}
        tabs={TABS.map((t) => ({ ...t, count: counts?.[t.key] }))}
        activeTab={view}
        onTab={setView}
      />
      {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {data === null ? (
          <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : data.items.length === 0 ? (
          <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
            <ClipboardCheck className="mx-auto h-7 w-7 text-slate-300" />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{view === "todo" ? "No homes waiting" : view === "review" ? "No reports to review" : "Nothing here yet"}</p>
            <p className="m-0 mt-0.5 text-[13px] text-slate-500">A request opens when a landlord submits a long-stay home.</p>
          </div>
        ) : (
          data.items.map((item) => <InspectionCard key={item.ref} item={item} checklist={data.checklist} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

function InspectionCard({ item, checklist, onChanged }: { item: Item; checklist: CheckItem[]; onChanged: () => void }) {
  const [partnerCode, setPartnerCode] = useState(item.partner?.code ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [opened, setOpened] = useState<Set<number>>(new Set());

  const post = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`/api/admin/long-stay/inspections/${encodeURIComponent(item.ref)}/${path}`, body);
      onChanged();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const r = item.report;
  const blocking = (r?.flags ?? []).filter((f) => BLOCKING.includes(f));
  const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";
  const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <article className="rounded-lg border border-solid border-slate-200 bg-white">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><MapPin className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-[15px] font-bold text-slate-900">{item.home.title || "Long-stay home"}</p>
          <p className="m-0 mt-0.5 text-[13px] text-slate-500">
            {item.home.area}{!item.home.hasPin ? " · no map pin" : ""} · {item.reason === "AFTER_DISPUTE" ? "after an upheld complaint" : item.reason === "YEARLY" ? "yearly check" : "first inspection"}
          </p>
          <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-slate-600">
            <span>Landlord: {item.landlord.name || "-"}</span>
            {item.landlord.phone ? <a href={`tel:${item.landlord.phone}`} className="inline-flex items-center gap-1 text-[#02665e] no-underline"><Phone className="h-3.5 w-3.5" />{item.landlord.phone}</a> : null}
            {item.partner ? <span className="inline-flex items-center gap-1"><UserRoundCheck className="h-3.5 w-3.5 text-slate-400" />{item.partner.name || "Partner"} ({item.partner.code})</span> : null}
          </p>
        </div>
        <div className="text-right text-[12px]">
          {item.status === "REQUESTED" ? <span className="rounded-md bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">No partner yet</span> : null}
          {item.status === "ASSIGNED" ? <span className={`rounded-md px-2 py-0.5 font-semibold ${item.overdue ? "bg-red-50 text-red-700" : "bg-sky-50 text-sky-800"}`}>{item.overdue ? "Visit overdue" : `Visit by ${eat(item.dueBy)}`}</span> : null}
          {item.status === "PASSED" ? <span className={`rounded-md px-2 py-0.5 font-semibold ${item.current ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600"}`}>{item.current ? `Valid to ${day(item.validUntil)}` : "Expired"}</span> : null}
          {item.status === "FAILED" ? <span className="rounded-md bg-red-50 px-2 py-0.5 font-semibold text-red-700">Failed {day(item.reviewedAt)}</span> : null}
          {item.feeAmount ? <p className="m-0 mt-1 text-slate-500">Partner fee TZS {item.feeAmount.toLocaleString("en-US")}</p> : null}
        </div>
      </div>

      {(item.status === "REQUESTED" || item.status === "ASSIGNED") ? (
        <div className="flex flex-wrap items-end gap-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
          <label className="block text-xs font-semibold text-slate-700">{item.partner ? "Give it to another partner" : "Sales Partner code"}
            <input value={partnerCode} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} placeholder="NSA-DAR-0042" maxLength={30}
              className="mt-1 block h-9 w-48 rounded-md border border-solid border-slate-300 px-2.5 font-mono text-sm outline-none focus:border-[#02665e]" />
          </label>
          <button type="button" disabled={partnerCode.trim().length < 3 || busy === "assign"} onClick={() => post("assign", "assign", { partnerCode: partnerCode.trim() })} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
            {busy === "assign" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserRoundCheck className="h-4 w-4" />}{item.partner ? "Reassign" : "Assign"}
          </button>
          <p className="m-0 w-full text-[12px] text-slate-500">Not the owner, and not the partner who brought the home to NoLSAF. They get 5 days to visit.</p>
        </div>
      ) : null}

      {r ? (
        <div className="grid gap-4 border-0 border-t border-solid border-slate-100 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Evidence</p>
            <p className="m-0 mt-1 text-[13px] text-slate-700">
              {r.distanceMeters != null ? `${r.distanceMeters} m from the pin` : "No pin to compare"}, accurate to about {r.accuracyMeters ?? "?"} m · captured {eat(r.capturedAt)}
            </p>
            {r.flags.length ? (
              <ul className="m-0 mt-2 list-none space-y-1 p-0">
                {r.flags.map((f) => (
                  <li key={f} className={`flex items-center gap-1.5 text-[12.5px] ${BLOCKING.includes(f) ? "font-semibold text-red-700" : "text-amber-800"}`}><AlertTriangle className="h-3.5 w-3.5" />{FLAG_TEXT[f] || f}</li>
                ))}
              </ul>
            ) : <p className="m-0 mt-2 flex items-center gap-1.5 text-[12.5px] text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />No warning signs</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Array.from({ length: r.photoCount }, (_, n) => (
                <a key={n} href={`/api/admin/long-stay/inspections/${encodeURIComponent(item.ref)}/photos/${n}`} target="_blank" rel="noopener noreferrer"
                  onClick={() => setOpened((s) => new Set(s).add(n))}
                  className={`inline-flex h-8 items-center gap-1 rounded-md border border-solid px-2.5 text-[12px] font-semibold no-underline ${opened.has(n) ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700 hover:border-[#02665e]"}`}>
                  {opened.has(n) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}Photo {n + 1}
                </a>
              ))}
            </div>
            <p className="m-0 mt-3 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-700"><b>Partner:</b> {r.note}</p>
          </div>
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Checklist · recommends <span className={r.recommendation === "PASS" ? "text-emerald-700" : "text-red-700"}>{r.recommendation === "PASS" ? "pass" : "fail"}</span></p>
            <ul className="m-0 mt-1 list-none p-0">
              {checklist.map((c) => {
                const v = r.checklist?.[c.key];
                return (
                  <li key={c.key} className="flex items-start gap-2 border-0 border-t border-solid border-slate-100 py-1.5 text-[12.5px] first:border-t-0">
                    {v === "PASS" ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" /> : v === "FAIL" ? <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-red-600" /> : <span className="mt-px h-3.5 w-3.5 shrink-0 text-center text-[10px] text-slate-400">NA</span>}
                    <span className="text-slate-700">{c.label}{c.required ? "" : " (optional)"}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {item.status === "SUBMITTED" ? (
        <div className="border-0 border-t border-solid border-slate-100 px-4 py-3">
          <label htmlFor={`note-${item.ref}`} className="block text-xs font-semibold text-slate-700">Decision note (the landlord sees it on a fail; the partner on a redo)</label>
          <input id={`note-${item.ref}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
            className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={note.trim().length < 5 || busy !== null || blocking.length > 0 || r?.recommendation !== "PASS" || opened.size < (r?.photoCount ?? 0)}
              onClick={() => post("PASS", "review", { decision: "PASS", note: note.trim() })} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
              {busy === "PASS" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}Pass for a year
            </button>
            <button type="button" disabled={note.trim().length < 5 || busy !== null} onClick={() => post("FAIL", "review", { decision: "FAIL", note: note.trim() })} className={`${btn} border-0 bg-red-600 text-white hover:bg-red-700`}>
              <XCircle className="h-4 w-4" />Fail
            </button>
            <button type="button" disabled={note.trim().length < 5 || busy !== null} onClick={() => post("REDO", "review", { decision: "REDO", note: note.trim() })} className={outline}>
              <RotateCcw className="h-4 w-4" />Redo (no fee)
            </button>
            {opened.size < (r?.photoCount ?? 0) ? <span className="text-xs text-slate-400">Open every photo before passing.</span> : blocking.length ? <span className="text-xs text-red-700">Cannot pass with these warnings. Redo it.</span> : null}
          </div>
        </div>
      ) : item.reviewNote ? (
        <p className="m-0 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[12.5px] text-slate-600">NoLSAF: {item.reviewNote} · {eat(item.reviewedAt)}</p>
      ) : null}
      {error ? <p className="m-0 px-4 pb-3 text-xs text-red-700">{error}</p> : null}
    </article>
  );
}
