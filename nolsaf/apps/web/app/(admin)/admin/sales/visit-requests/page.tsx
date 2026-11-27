"use client";

/**
 * Owners' "Request a NoLSAF visit" queue (docs/SALES_VISIT_REQUESTS.md).
 * Assign a request to a Sales Partner by agent code (it becomes their lead),
 * or close it with a reason. Regional leads assign their own region's from
 * My region; anything they have not picked up stays here.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, DoorOpen, Inbox, Loader2, MapPin, Phone, UserCheck, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type Status = "NEW" | "ASSIGNED" | "CLOSED";
type VisitRequest = {
  ref: string;
  status: Status;
  region: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  propertyName: string;
  propertyType: string | null;
  estimatedRooms: number | null;
  location: string;
  interest: string;
  message: string | null;
  assignedTo: { code: string; name: string } | null;
  assignedByRole: "ADMIN" | "REGION_LEAD" | null;
  assignedAt: string | null;
  closedReason: string | null;
  closedAt: string | null;
  createdAt: string;
};
type Payload = { counts: Record<Status, number>; regions: Array<{ code: string; name: string }>; requests: VisitRequest[] };

const INTEREST: Record<string, string> = {
  MARKETPLACE: "Bookings on NoLSAF",
  NRMS: "NRMS",
  NRMS_AND_MARKETPLACE: "NRMS and bookings",
  NOT_SURE: "Not sure yet",
};
const PRODUCTS = [
  { value: "", label: "As the owner asked" },
  { value: "NRMS", label: "NRMS" },
  { value: "MARKETPLACE", label: "Marketplace" },
  { value: "NRMS_AND_MARKETPLACE", label: "NRMS and Marketplace" },
];

const ROW_GRID = "grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_1.25rem] gap-5";
const field = "h-9 w-full min-w-0 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-sm outline-none [font-family:inherit] focus:border-[#02665e]";
const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-sm font-semibold text-white [font-family:inherit] hover:bg-[#014d47] disabled:opacity-50";
const ghost = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 [font-family:inherit] hover:bg-slate-50 disabled:opacity-50";

function when(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

export default function SalesVisitRequestsPage() {
  const [tab, setTab] = useState<Status>("NEW");
  const [region, setRegion] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [migrationNeeded, setMigrationNeeded] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: payload } = await apiClient.get<Payload>("/api/admin/sales/visit-requests", { params: { status: tab, ...(region ? { region } : {}) } });
      setData(payload);
      setError("");
      setMigrationNeeded(false);
    } catch (e: any) {
      if (e?.response?.data?.migrationNeeded) setMigrationNeeded(true);
      else setError(e?.response?.data?.error || "Could not load visit requests.");
    } finally {
      setLoading(false);
    }
  }, [tab, region]);
  useEffect(() => { void load(); }, [load]);

  const done = async (message: string) => {
    setNotice(message);
    setOpen(null);
    await load();
  };

  const requests = data?.requests ?? [];

  return (
    <div id="admin-sales-visits" className="w-full min-w-0">
      <style>{`#admin-sales-visits, #admin-sales-visits * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<Status>
        title="Visit requests"
        description="Owners who asked for a NoLSAF visit. Assign each to a Sales Partner; it becomes their lead."
        metrics={[
          { label: "Waiting", value: data ? data.counts.NEW : "-", tone: data?.counts.NEW ? "warn" : "default" },
          { label: "Assigned", value: data ? data.counts.ASSIGNED : "-" },
        ]}
        onRefresh={() => void load()}
        loading={loading}
        tabs={[
          { key: "NEW", label: "Waiting", Icon: Inbox, count: data?.counts.NEW || undefined },
          { key: "ASSIGNED", label: "Assigned", Icon: UserCheck },
          { key: "CLOSED", label: "Closed", Icon: XCircle },
        ]}
        activeTab={tab}
        onTab={(key) => { setTab(key); setOpen(null); setNotice(""); }}
      />

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="visit-region" className="text-xs font-semibold text-slate-500">Region</label>
        <select id="visit-region" className={`${field} w-auto`} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">All regions</option>
          {(data?.regions ?? []).map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
          <option value="NONE">No region chosen</option>
        </select>
      </div>

      {notice && <p role="status" className="m-0 mt-3 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"><CheckCircle2 className="size-4" aria-hidden />{notice}</p>}
      {error && <p role="alert" className="m-0 mt-3 rounded-md border border-solid border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {migrationNeeded && <p role="status" className="m-0 mt-3 rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Visit requests need a database update first (migration 20261126130000).</p>}

      {loading && !data ? (
        <p className="m-0 mt-3 flex min-h-32 items-center justify-center gap-2 rounded-lg border border-solid border-slate-200 bg-white text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading visit requests</p>
      ) : requests.length === 0 && !migrationNeeded ? (
        <div className="mt-3 flex min-h-32 flex-col items-center justify-center gap-2 rounded-lg border border-solid border-slate-200 bg-white p-6 text-center">
          <DoorOpen className="size-6 text-slate-300" aria-hidden />
          <p className="m-0 text-sm text-slate-500">{tab === "NEW" ? "No owner is waiting for a visit." : tab === "ASSIGNED" ? "Nothing assigned yet." : "Nothing closed."}</p>
        </div>
      ) : (
        <section className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
          <div className={`${ROW_GRID} border-0 border-b border-solid border-slate-100 bg-slate-50/70 px-5 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400 max-lg:hidden`}>
            <span>Property</span><span>Owner</span><span>{tab === "NEW" ? "Wants" : tab === "ASSIGNED" ? "Assigned to" : "Closed"}</span><span>Received</span><span />
          </div>
          <ul className="m-0 list-none p-0">
            {requests.map((r) => {
              const expanded = open === r.ref;
              return (
                <li key={r.ref} className="border-0 border-b border-solid border-slate-100 last:border-b-0">
                  <button type="button" onClick={() => setOpen(expanded ? null : r.ref)} aria-expanded={expanded} className={`${ROW_GRID} w-full cursor-pointer items-center border-0 px-5 py-3 text-left [font-family:inherit] transition-colors max-lg:grid-cols-[minmax(0,1fr)_auto] ${expanded ? "bg-slate-50" : "bg-transparent hover:bg-slate-50"}`}>
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-semibold text-slate-900">{r.propertyName}</p>
                      <p className="m-0 flex items-center gap-1 truncate text-[11px] text-slate-500"><MapPin className="size-3 shrink-0" aria-hidden />{r.location}{r.region ? ` · ${r.region}` : " · No region"}</p>
                    </div>
                    <div className="min-w-0 max-lg:hidden">
                      <p className="m-0 truncate text-sm text-slate-800">{r.contactName}</p>
                      <p className="m-0 truncate text-[11px] text-slate-500">{r.contactPhone}</p>
                    </div>
                    <div className="min-w-0 max-lg:hidden">
                      {r.status === "ASSIGNED" && r.assignedTo ? (
                        <>
                          <p className="m-0 truncate text-sm text-slate-800">{r.assignedTo.name}</p>
                          <p className="m-0 truncate text-[11px] text-slate-500">{r.assignedTo.code} · by {r.assignedByRole === "REGION_LEAD" ? "regional lead" : "admin"}</p>
                        </>
                      ) : r.status === "CLOSED" ? (
                        <p className="m-0 truncate text-sm text-slate-600">{r.closedReason}</p>
                      ) : (
                        <p className="m-0 truncate text-sm text-slate-700">{INTEREST[r.interest] ?? r.interest}</p>
                      )}
                    </div>
                    <div className="min-w-0 max-lg:hidden">
                      <p className="m-0 font-mono text-[11px] font-semibold text-slate-700">{r.ref}</p>
                      <p className="m-0 text-[11px] text-slate-400">{when(r.createdAt)}</p>
                    </div>
                    <ChevronDown className={`size-4 text-slate-400 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {expanded ? <RequestDetail request={r} onDone={done} onError={setError} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequestDetail({ request: r, onDone, onError }: { request: VisitRequest; onDone: (message: string) => Promise<void>; onError: (message: string) => void }) {
  const [agentCode, setAgentCode] = useState("");
  const [product, setProduct] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<"assign" | "close" | null>(null);

  const assign = async () => {
    if (!agentCode.trim()) return onError("Enter the partner's agent code.");
    setBusy("assign");
    try {
      const { data } = await apiClient.post(`/api/admin/sales/visit-requests/${r.ref}/assign`, { agentCode: agentCode.trim(), ...(product ? { product } : {}) });
      const extra = data?.linkedExisting ? " They already had this property as a lead, so it was added there." : data?.possibleDuplicate ? " The new lead is flagged as a possible duplicate for review." : "";
      await onDone(`${r.ref} assigned to ${data?.assignedTo?.name ?? agentCode}.${extra}`);
    } catch (e: any) {
      onError(e?.response?.data?.error || "Could not assign.");
    } finally {
      setBusy(null);
    }
  };

  const close = async () => {
    if (reason.trim().length < 3) return onError("Give a short reason.");
    setBusy("close");
    try {
      await apiClient.post(`/api/admin/sales/visit-requests/${r.ref}/close`, { reason: reason.trim() });
      await onDone(`${r.ref} closed.`);
    } catch (e: any) {
      onError(e?.response?.data?.error || "Could not close.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="border-0 border-t border-solid border-slate-100 bg-slate-50 px-5 py-4">
      <dl className="m-0 grid grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div><dt className="text-[11px] font-semibold text-slate-500">Owner</dt><dd className="m-0 text-slate-900">{r.contactName}</dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Phone</dt><dd className="m-0"><a href={`tel:${r.contactPhone.replace(/\s+/g, "")}`} className="inline-flex items-center gap-1 text-[#02665e] no-underline"><Phone className="size-3.5" aria-hidden />{r.contactPhone}</a></dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Email</dt><dd className="m-0 truncate text-slate-900">{r.contactEmail || "Not given"}</dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Wants</dt><dd className="m-0 text-slate-900">{INTEREST[r.interest] ?? r.interest}</dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Type</dt><dd className="m-0 text-slate-900">{r.propertyType || "Not given"}</dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Rooms</dt><dd className="m-0 text-slate-900">{r.estimatedRooms ?? "Not given"}</dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Region</dt><dd className="m-0 text-slate-900">{r.region || "Not chosen"}</dd></div>
        <div><dt className="text-[11px] font-semibold text-slate-500">Request</dt><dd className="m-0 font-mono text-slate-900">{r.ref}</dd></div>
      </dl>
      {r.message ? <p className="m-0 mt-3 whitespace-pre-line rounded-md border border-solid border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{r.message}</p> : null}

      {r.status === "NEW" ? (
        <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
          <div className="rounded-md border border-solid border-slate-200 bg-white p-3">
            <p className="m-0 mb-2 text-sm font-semibold text-slate-900">Assign to a Sales Partner</p>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input aria-label="Agent code" placeholder="Agent code, e.g. NSA-DAR-0042" className={field} value={agentCode} onChange={(e) => setAgentCode(e.target.value.toUpperCase())} />
              <select aria-label="Product for the lead" className={field} value={product} onChange={(e) => setProduct(e.target.value)}>
                {PRODUCTS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
              <button type="button" className={btn} disabled={busy !== null} onClick={() => void assign()}>
                {busy === "assign" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <UserCheck className="size-4" aria-hidden />}Assign
              </button>
            </div>
            <p className="m-0 mt-2 text-[11px] text-slate-500">Creates a lead for the partner with the owner&apos;s contact, a 48 hour follow-up and the usual claim protection.</p>
          </div>
          <div className="rounded-md border border-solid border-slate-200 bg-white p-3">
            <p className="m-0 mb-2 text-sm font-semibold text-slate-900">Close without a visit</p>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <input aria-label="Reason" placeholder="Spam, duplicate, could not reach the owner" maxLength={300} className={field} value={reason} onChange={(e) => setReason(e.target.value)} />
              <button type="button" className={ghost} disabled={busy !== null} onClick={() => void close()}>
                {busy === "close" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}Close
              </button>
            </div>
          </div>
        </div>
      ) : r.status === "ASSIGNED" ? (
        <p className="m-0 mt-3 text-sm text-slate-600">Assigned {when(r.assignedAt)} to {r.assignedTo?.name} ({r.assignedTo?.code}) by {r.assignedByRole === "REGION_LEAD" ? "the regional lead" : "an admin"}. Follow it in Conversion review once the partner requests conversion.</p>
      ) : (
        <p className="m-0 mt-3 text-sm text-slate-600">Closed {when(r.closedAt)}: {r.closedReason}</p>
      )}
    </div>
  );
}
