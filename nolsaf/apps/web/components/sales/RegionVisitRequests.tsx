"use client";

/**
 * My region: owners who asked for a NoLSAF visit in this region
 * (docs/SALES_VISIT_REQUESTS.md). The lead picks a partner of the region; the
 * request becomes that partner's lead with the owner's contact. The lead never
 * sees the owner's phone or email here.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, DoorOpen, Loader2, MapPin, UserCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Request = {
  ref: string;
  status: "NEW" | "ASSIGNED" | "CLOSED";
  contactName: string;
  propertyName: string;
  propertyType: string | null;
  estimatedRooms: number | null;
  location: string;
  interest: string;
  message: string | null;
  assignedTo: { code: string; name: string } | null;
  assignedAt: string | null;
  createdAt: string;
};
type Payload = { requests: Request[]; partners: Array<{ code: string; name: string }>; unavailable?: boolean };

const INTEREST: Record<string, string> = {
  MARKETPLACE: "Bookings on NoLSAF",
  NRMS: "NRMS",
  NRMS_AND_MARKETPLACE: "NRMS and bookings",
  NOT_SURE: "Not sure yet",
};

function eatDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}

export default function RegionVisitRequests() {
  const [data, setData] = useState<Payload | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: d } = await apiClient.get<Payload>("/api/sales/region/visit-requests");
      setData(d);
    } catch {
      setData(null);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const assign = async (ref: string) => {
    const agentCode = choice[ref];
    if (!agentCode) return setError("Choose a partner first.");
    setBusy(ref);
    setError("");
    setNotice("");
    try {
      const { data: r } = await apiClient.post(`/api/sales/region/visit-requests/${ref}/assign`, { agentCode });
      setNotice(`Assigned to ${r?.assignedTo?.name ?? agentCode}. It is now in their leads with the owner's contact.`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not assign.");
    } finally {
      setBusy("");
    }
  };

  if (!data || data.unavailable) return null;
  const waiting = data.requests.filter((r) => r.status === "NEW");
  const assigned = data.requests.filter((r) => r.status === "ASSIGNED");
  if (!waiting.length && !assigned.length) return null;

  return (
    <section className="mt-5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <div className="border-0 border-b border-solid border-slate-100 px-4 py-3">
        <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-900"><DoorOpen className="h-4 w-4 text-[#02665e]" aria-hidden />Owners asking for a visit</h2>
        <p className="m-0 mt-0.5 text-xs text-slate-500">Give each one to a partner who can call within 48 hours. Their phone number goes to that partner only. NoLSAF assigns any you leave.</p>
      </div>
      {error && <p className="m-0 border-0 border-b border-solid border-rose-100 bg-rose-50 px-4 py-2 text-sm text-rose-800">{error}</p>}
      {notice && <p className="m-0 flex items-center gap-2 border-0 border-b border-solid border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</p>}

      <ul className="m-0 list-none p-0">
        {waiting.map((r) => (
          <li key={r.ref} className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-slate-900">{r.propertyName}{r.estimatedRooms ? <span className="font-normal text-slate-500"> · {r.estimatedRooms} rooms</span> : null}</p>
              <p className="m-0 flex items-center gap-1 truncate text-xs text-slate-500"><MapPin className="h-3 w-3 shrink-0" aria-hidden />{r.location} · {r.contactName} · wants {INTEREST[r.interest] ?? r.interest} · {eatDay(r.createdAt)}</p>
              {r.message ? <p className="m-0 mt-1 line-clamp-2 text-xs text-slate-600">&ldquo;{r.message}&rdquo;</p> : null}
            </div>
            {data.partners.length ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label={`Partner for ${r.propertyName}`}
                  value={choice[r.ref] ?? ""}
                  onChange={(e) => setChoice((c) => ({ ...c, [r.ref]: e.target.value }))}
                  className="h-8 max-w-[12rem] rounded-md border border-solid border-slate-300 bg-white px-2 text-[12px] [font-family:inherit]"
                >
                  <option value="">Choose a partner</option>
                  {data.partners.map((p) => <option key={p.code} value={p.code}>{p.name} ({p.code})</option>)}
                </select>
                <button type="button" disabled={busy === r.ref} onClick={() => void assign(r.ref)} className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border-0 bg-[#02665e] px-2.5 text-[12px] font-semibold text-white [font-family:inherit] hover:bg-[#014d47] disabled:opacity-50">
                  {busy === r.ref ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />} Assign
                </button>
              </div>
            ) : (
              <span className="text-xs text-slate-500">No other active partner in your region yet. NoLSAF will assign it.</span>
            )}
          </li>
        ))}
        {assigned.map((r) => (
          <li key={r.ref} className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-2.5 first:border-t-0">
            <div className="min-w-0">
              <p className="m-0 text-sm text-slate-700">{r.propertyName} <span className="text-slate-400">· {r.location}</span></p>
            </div>
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {r.assignedTo?.name ?? "Assigned"}{r.assignedAt ? `, ${eatDay(r.assignedAt)}` : ""}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
