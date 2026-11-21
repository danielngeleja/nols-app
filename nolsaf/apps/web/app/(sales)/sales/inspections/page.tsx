"use client";

/**
 * Long-stay home inspections for a Sales Partner (docs/LONG_STAY_RENTALS.md
 * section 13). The partner goes to the home and reports from there: the
 * phone's position, 4 to 12 photos taken on site, the standards checklist and
 * a recommendation. The server measures the distance from the listing's pin
 * and flags anything odd; NoLSAF then passes, fails or asks for a redo.
 * The flat fee is earned for every report NoLSAF accepts, pass or fail.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, Clock3, Crosshair, Footprints, Loader2, MapPin, Navigation, Phone, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type CheckItem = { key: string; label: string; required: boolean };
type Inspection = {
  ref: string;
  status: "ASSIGNED" | "SUBMITTED" | "PASSED" | "FAILED";
  reason: string;
  dueBy: string | null;
  home: { title: string | null; type: string | null; area: string; pin: { lat: number; lng: number } | null; listing: { monthlyRent: number; currency: string; furnished: string; utilities: Record<string, string> } | null };
  landlord: { name: string | null; phone: string | null };
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  feeAmount: number | null;
};
type Visit = { ref: string; visitAt: string; note: string | null; home: { title: string | null; area: string; pin: { lat: number; lng: number } | null }; tenant: { name: string | null; phone: string | null } };
type Data = { checklist: CheckItem[]; minPhotos: number; maxPhotos: number; items: Inspection[] };

const STATUS: Record<Inspection["status"], { label: string; tone: string }> = {
  ASSIGNED: { label: "To visit", tone: "bg-amber-50 text-amber-800" },
  SUBMITTED: { label: "With NoLSAF", tone: "bg-sky-50 text-sky-800" },
  PASSED: { label: "Passed", tone: "bg-emerald-50 text-emerald-800" },
  FAILED: { label: "Failed", tone: "bg-red-50 text-red-700" },
};

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}
const mapsLink = (pin: { lat: number; lng: number }) => `https://www.google.com/maps/dir/?api=1&destination=${pin.lat},${pin.lng}`;

export default function SalesInspectionsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        apiClient.get<Data>("/api/sales/long-stay/inspections"),
        apiClient.get<{ items: Visit[] }>("/api/sales/long-stay/visits").catch(() => ({ data: { items: [] } })),
      ]);
      setData(a.data);
      setVisits(b.data.items);
      setError("");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load your inspections.");
      setData({ checklist: [], minPhotos: 4, maxPhotos: 12, items: [] });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const todo = data?.items.filter((i) => i.status === "ASSIGNED") ?? [];
  const rest = data?.items.filter((i) => i.status !== "ASSIGNED") ?? [];

  return (
    <SalesShell>
      <div id="sales-inspections" className="w-full space-y-4">
        <style>{`#sales-inspections, #sales-inspections * { box-sizing: border-box; }`}</style>
        <SalesPageHeader
          title="Inspections"
          description="Long-stay homes NoLSAF asked you to check on site. Report from the home: the position and photos are checked by NoLSAF."
          icon={ClipboardCheck}
        />
        {error ? <p className="m-0 text-sm text-red-700">{error}</p> : null}

        {data === null ? (
          <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <>
            <section aria-label="To visit">
              <h2 className="m-0 text-sm font-bold text-slate-900">To visit <span className="font-normal text-slate-500">({todo.length})</span></h2>
              {todo.length === 0 ? (
                <p className="m-0 mt-2 rounded-lg border border-solid border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">No homes to inspect right now. NoLSAF will notify you.</p>
              ) : (
                <ul className="m-0 mt-2 list-none space-y-2 p-0">
                  {todo.map((item) => (
                    <li key={item.ref} className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
                      <InspectionHead item={item} />
                      {open === item.ref ? (
                        <ReportForm item={item} data={data} onDone={() => { setOpen(null); void load(); }} onCancel={() => setOpen(null)} />
                      ) : (
                        <div className="flex flex-wrap gap-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
                          <button type="button" onClick={() => setOpen(item.ref)} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-sm font-semibold text-white hover:bg-[#014e47] [font-family:inherit]">
                            <ClipboardCheck className="h-4 w-4" />I am at the home: start the report
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
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
                        <p className="m-0 mt-0.5 text-slate-700">{eat(v.visitAt)} · {v.tenant.name || "Tenant"}{v.tenant.phone ? <> · <a href={`tel:${v.tenant.phone}`} className="font-semibold text-[#02665e] no-underline">{v.tenant.phone}</a></> : null}</p>
                        {v.note ? <p className="m-0 mt-0.5 text-slate-500">{v.note}</p> : null}
                      </div>
                      {v.home.pin ? <a href={mapsLink(v.home.pin)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#02665e] no-underline"><Navigation className="h-3.5 w-3.5" />Directions</a> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {rest.length ? (
              <section aria-label="Sent">
                <h2 className="m-0 text-sm font-bold text-slate-900">Sent</h2>
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
    </SalesShell>
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
        {item.dueBy && item.status === "ASSIGNED" ? <p className={`m-0 mt-1 inline-flex items-center gap-1 text-[12px] ${late ? "font-semibold text-red-700" : "text-slate-500"}`}><Clock3 className="h-3.5 w-3.5" />{late ? "Overdue since" : "Visit by"} {eat(item.dueBy)}</p> : null}
        {item.feeAmount ? <p className="m-0 mt-1 text-[12px] font-semibold text-emerald-700">TZS {item.feeAmount.toLocaleString("en-US")} added to your earnings</p> : null}
      </div>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold ${s.tone}`}>{s.label}</span>
    </div>
  );
}

function ReportForm({ item, data, onDone, onCancel }: { item: Inspection; data: Data; onDone: () => void; onCancel: () => void }) {
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number; at: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [photos, setPhotos] = useState<File[]>([]);
  const [checks, setChecks] = useState<Record<string, "PASS" | "FAIL" | "NA">>({});
  const [recommendation, setRecommendation] = useState<"PASS" | "FAIL" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ distanceMeters: number | null; flags: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const requiredFailed = data.checklist.filter((c) => c.required && checks[c.key] && checks[c.key] !== "PASS");
  const answered = data.checklist.every((c) => checks[c.key]);

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

  const addPhotos = (list: FileList | null) => {
    if (!list) return;
    const next = [...photos, ...Array.from(list)].slice(0, data.maxPhotos);
    if (next.some((f) => f.size > 8 * 1024 * 1024)) { setError("Each photo must be 8 MB or smaller."); return; }
    setPhotos(next);
    setError("");
  };

  const submit = async () => {
    setError("");
    if (!position) return setError("Capture your position at the home first.");
    if (photos.length < data.minPhotos) return setError(`Take at least ${data.minPhotos} photos at the home.`);
    if (!answered) return setError("Answer every item on the checklist.");
    if (!recommendation) return setError("Recommend pass or fail.");
    if (recommendation === "PASS" && requiredFailed.length) return setError("A home cannot pass while a required item is not met.");
    if (note.trim().length < 10) return setError("Write a short note of what you saw (10 characters or more).");
    const form = new FormData();
    photos.forEach((f) => form.append("photos", f));
    form.append("latitude", String(position.lat));
    form.append("longitude", String(position.lng));
    form.append("accuracyMeters", String(position.accuracy));
    form.append("capturedAt", position.at);
    form.append("checklist", JSON.stringify(checks));
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
    <button type="button" onClick={() => setChecks((c) => ({ ...c, [key]: value }))} aria-pressed={checks[key] === value}
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
        <p className="m-0 text-[13px] font-semibold text-slate-800">2. Photos at the home ({photos.length} of {data.minPhotos} to {data.maxPhotos})</p>
        <p className="m-0 text-[12px] text-slate-500">Outside with the gate or door, each room, the bathroom, the kitchen, the meter.</p>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { addPhotos(e.target.files); e.target.value = ""; }} />
        <div className="mt-1.5 flex flex-wrap gap-2">
          {photos.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-700">
              {f.name.slice(0, 18)}
              <button type="button" aria-label="Remove photo" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} className="grid h-4 w-4 cursor-pointer place-items-center border-0 bg-transparent p-0 text-slate-500"><X className="h-3 w-3" /></button>
            </span>
          ))}
          {photos.length < data.maxPhotos ? (
            <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-dashed border-slate-300 bg-slate-50 px-3 text-[12.5px] font-semibold text-slate-600 hover:border-[#02665e] [font-family:inherit]">
              <Camera className="h-4 w-4" />Take photo
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <p className="m-0 text-[13px] font-semibold text-slate-800">3. Standards</p>
        <ul className="m-0 mt-1.5 list-none p-0">
          {data.checklist.map((c) => (
            <li key={c.key} className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 py-2 text-[13px] first:border-t-0">
              <span className="min-w-0 flex-1 text-slate-700">{c.label}{c.required ? <span className="text-red-600"> *</span> : null}</span>
              <span className="flex gap-1">{seg(c.key, "PASS", "Yes")}{seg(c.key, "FAIL", "No")}{c.required ? null : seg(c.key, "NA", "N/A")}</span>
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
        <button type="button" onClick={onCancel} className="inline-flex h-10 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Cancel</button>
      </div>
    </div>
  );
}
