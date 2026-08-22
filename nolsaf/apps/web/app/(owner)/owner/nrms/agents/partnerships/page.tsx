"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, Ban, CheckCircle2, Clock3, Handshake, Loader2, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useNrms } from "../../_components/NrmsProvider";

type Agency = {
  legalName: string;
  tradingName: string | null;
  reference?: string;
  verificationStatus: string;
};

type Partnership = {
  id: number;
  status: string;
  initiatedBy: string;
  requestedAt: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  currency: string;
  paymentTerms: string;
  bookingMode: string;
  agency: Agency | null;
};

function formatDate(value: string | null) {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function AgencyMark({ name }: { name: string }) {
  const letters = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "A";
  return <span className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-emerald-100 text-sm font-extrabold text-emerald-800">{letters}</span>;
}

export default function PartnershipRequestsPage() {
  const { selectedPropertyId } = useNrms();
  const [links, setLinks] = useState<Partnership[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [rejecting, setRejecting] = useState<Partnership | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<any>(`/api/owner/nrms/agents/property/${selectedPropertyId}`);
      setLinks(response.data?.links ?? []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Partnership requests could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  const incoming = useMemo(() => links.filter((link) => link.initiatedBy === "AGENT" && link.status === "REQUESTED"), [links]);
  const history = useMemo(() => links.filter((link) => link.initiatedBy === "AGENT" && ["ACTIVE", "REJECTED", "TERMINATED"].includes(link.status)).slice(0, 8), [links]);

  const decide = useCallback(async (link: Partnership, action: "approve" | "reject", decisionReason?: string) => {
    setBusyId(link.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post(`/api/owner/nrms/agents/${link.id}/${action}`, action === "reject" ? { reason: decisionReason } : {});
      setNotice(action === "approve"
        ? "Partnership activated. You can now configure rate access and commercial terms in Travel agents."
        : "Partnership request declined. The operator cannot access your rates, rooms or contacts.");
      setRejecting(null);
      setReason("");
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "The decision could not be completed.");
    } finally {
      setBusyId(null);
    }
  }, [load]);

  if (!selectedPropertyId) {
    return <div className="rounded-xl border border-solid border-neutral-200 bg-white p-6 text-sm text-neutral-600">Select a property to review its partnership requests.</div>;
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <header className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-700"><ShieldCheck className="h-3.5 w-3.5" /> Verified network</span>
            <h1 className="m-0 mt-3 text-2xl font-extrabold tracking-tight text-neutral-950 sm:text-3xl">Partnership requests</h1>
            <p className="m-0 mt-2 text-[13px] leading-relaxed text-neutral-500 sm:text-sm">Review tourism operators asking to represent or book your property. A request alone never reveals rates, inventory, guest data or private contacts.</p>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3">
            <span className="text-3xl font-black tabular-nums text-emerald-700">{incoming.length}</span>
            <span className="text-xs font-semibold leading-tight text-emerald-800">awaiting<br />your decision</span>
          </div>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          [ShieldCheck, "Identity checked", "NoLSAF verification is required before activation."],
          [Handshake, "Mutual consent", "The operator requests; your property independently accepts."],
          [BadgeCheck, "Access stays scoped", "Rates and booking rights are configured only after approval."],
        ].map(([Icon, title, copy]: any) => (
          <div key={title} className="flex gap-3 rounded-xl border border-solid border-neutral-200 bg-white p-4">
            <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-emerald-50 text-emerald-700"><Icon className="h-4 w-4" /></span>
            <div><p className="m-0 text-[13px] font-bold text-neutral-900">{title}</p><p className="m-0 mt-1 text-[11px] leading-relaxed text-neutral-500">{copy}</p></div>
          </div>
        ))}
      </div>

      {notice && <div className="rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] text-emerald-800">{notice}</div>}
      {error && <div className="rounded-xl border border-solid border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>}

      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div><h2 className="m-0 text-base font-bold text-neutral-900">Incoming requests</h2><p className="m-0 mt-0.5 text-[12px] text-neutral-500">Only operator-initiated relationships appear here.</p></div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-[11px] font-bold text-neutral-600">{incoming.length} pending</span>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white p-6 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading requests…</div>
        ) : incoming.length === 0 ? (
          <div className="rounded-xl border border-dashed border-solid border-neutral-300 bg-white px-5 py-10 text-center">
            <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-emerald-50 text-emerald-700"><CheckCircle2 className="h-5 w-5" /></span>
            <p className="m-0 mt-3 text-sm font-bold text-neutral-800">You are all caught up</p>
            <p className="m-0 mt-1 text-[12px] text-neutral-500">New verified operator requests will appear here.</p>
          </div>
        ) : (
          <ul className="m-0 grid list-none gap-3 p-0 xl:grid-cols-2">
            {incoming.map((link) => {
              const name = link.agency?.tradingName || link.agency?.legalName || "Travel operator";
              const verified = link.agency?.verificationStatus === "VERIFIED";
              const busy = busyId === link.id;
              return (
                <li key={link.id} className="rounded-2xl border border-solid border-neutral-200 bg-white p-4 shadow-sm sm:p-5">
                  <div className="flex items-start gap-3">
                    <AgencyMark name={name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2"><h3 className="m-0 truncate text-[15px] font-extrabold text-neutral-900">{name}</h3>{verified && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700"><BadgeCheck className="h-3 w-3" /> NoLSAF verified</span>}</div>
                      {link.agency?.legalName !== name && <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-500">{link.agency?.legalName}</p>}
                      <p className="m-0 mt-1 font-mono text-[10px] font-semibold text-neutral-400">{link.agency?.reference || `LINK-${link.id}`}</p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-neutral-50 p-3 sm:grid-cols-4">
                    <Meta label="Requested" value={formatDate(link.requestedAt)} />
                    <Meta label="Booking" value={link.bookingMode === "INSTANT" ? "Instant" : "On request"} />
                    <Meta label="Payment" value={link.paymentTerms === "PREPAID" ? "Prepaid" : link.paymentTerms} />
                    <Meta label="Currency" value={link.currency} />
                  </div>

                  {!verified && <p className="m-0 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">This operator must complete NoLSAF verification before the partnership can activate.</p>}
                  <p className="m-0 mt-3 text-[11px] leading-relaxed text-neutral-500">Approval establishes the relationship only. Review rates and final commercial settings under <strong>Travel agents</strong> before selling begins.</p>
                  <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <button type="button" onClick={() => { setRejecting(link); setReason(""); }} disabled={busy} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[12px] font-bold text-neutral-700 hover:border-red-200 hover:text-red-700 disabled:opacity-50"><Ban className="h-3.5 w-3.5" /> Decline</button>
                    <button type="button" onClick={() => void decide(link, "approve")} disabled={busy || !verified} title={!verified ? "NoLSAF verification is required" : undefined} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-solid border-emerald-700 bg-emerald-700 px-3 py-2 text-[12px] font-bold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-500">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Approve partnership</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {history.length > 0 && (
        <section className="rounded-xl border border-solid border-neutral-200 bg-white p-4 sm:p-5">
          <h2 className="m-0 flex items-center gap-2 text-sm font-bold text-neutral-900"><Clock3 className="h-4 w-4 text-neutral-400" /> Recent decisions</h2>
          <ul className="m-0 mt-3 divide-y divide-neutral-100 list-none p-0">
            {history.map((link) => <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className="m-0 text-[13px] font-bold text-neutral-800">{link.agency?.tradingName || link.agency?.legalName || "Travel operator"}</p><p className="m-0 mt-0.5 text-[10px] text-neutral-400">{formatDate(link.decidedAt)}</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${link.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>{link.status === "ACTIVE" ? "Approved" : link.status === "REJECTED" ? "Declined" : "Terminated"}</span></li>)}
          </ul>
        </section>
      )}

      {rejecting && (
        <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-0 sm:place-items-center sm:p-4" role="dialog" aria-modal="true" aria-label="Decline partnership request">
          <div className="w-full rounded-t-2xl bg-white p-5 shadow-2xl sm:max-w-md sm:rounded-2xl">
            <h2 className="m-0 text-lg font-extrabold text-neutral-900">Decline partnership?</h2>
            <p className="m-0 mt-2 text-[13px] leading-relaxed text-neutral-600">{rejecting.agency?.tradingName || rejecting.agency?.legalName || "The operator"} will not receive rates, rooms, contacts or booking access.</p>
            <label className="mt-4 block text-[12px] font-bold text-neutral-700" htmlFor="decline-reason">Reason <span className="font-normal text-neutral-400">(optional)</span></label>
            <textarea id="decline-reason" value={reason} onChange={(event) => setReason(event.target.value.slice(0, 300))} rows={3} placeholder="Give the operator a clear reason" className="mt-1.5 w-full resize-none rounded-lg border border-solid border-neutral-300 px-3 py-2 text-sm outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100" />
            <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRejecting(null)} className="rounded-lg border border-solid border-neutral-200 bg-white px-4 py-2 text-[12px] font-bold text-neutral-700">Keep request</button><button type="button" onClick={() => void decide(rejecting, "reject", reason.trim() || undefined)} disabled={busyId === rejecting.id} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-solid border-red-700 bg-red-700 px-4 py-2 text-[12px] font-bold text-white disabled:opacity-50">{busyId === rejecting.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Decline request</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><span className="block text-[9px] font-bold uppercase tracking-wide text-neutral-400">{label}</span><span className="mt-0.5 block truncate text-[11px] font-bold text-neutral-800" title={value}>{value}</span></div>;
}
