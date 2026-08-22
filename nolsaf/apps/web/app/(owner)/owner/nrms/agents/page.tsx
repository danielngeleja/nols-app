"use client";
// Travel agents (NRMS Agent B2B): the hotel's home for its approved travel
// agents. A hotel looks up an agency, attaches it with its own terms, and
// approves / suspends / rejects it. The approved-agent limit (maxAgents) is set
// by NoLSAF; a hotel at its limit is told to contact NoLSAF to raise it.
//
// Isolation: this page only ever shows links for the selected property. The same
// agency can be linked by other hotels, but their terms and bookings never show
// here.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import apiClient from "@/lib/apiClient";
import { ArrowLeft, BadgeCheck, Ban, Building2, Calendar, CheckCircle2, ChevronDown, Clock, Eye, FileText, Globe, Handshake, Loader2, Mail, MapPin, Phone, Plus, Search, ShieldAlert, ShieldCheck, Tag, User, UserPlus, Wallet, X } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type Agency = { id: number; reference?: string; legalName: string; tradingName: string | null; verificationStatus: string; status: string; contactEmail?: string | null; activationPending?: boolean };
type AgencyDetail = Agency & {
  registrationNo: string | null; tin: string | null; licenseNo: string | null; nationality: string | null; countryCode: string | null;
  contactName: string | null; contactPhone: string | null; address: string | null;
  documents: Array<{ type: string; uploadedAt: string | null }>; documentCount: number;
  verifiedAt: string | null; verificationNote: string | null; createdAt: string | null;
};
type AgentLink = {
  id: number; status: string; currency: string; paymentTerms: string; bookingMode: string; creditLimit: number;
  decidedAt: string | null; decisionReason: string | null; suspensionAuthority?: "HOTEL" | "ADMIN" | null; agency: Agency | null;
  rateAccess: Array<{ ratePlanId: number; roomTypeId: number | null }>;
};
type Match = { id: number; legalName: string; tradingName: string | null; registrationNo: string | null; tin: string | null; verificationStatus: string; status: string; matchedOn: string[] };

const LINK_STATUS: Record<string, { cls: string; label: string }> = {
  INVITED: { cls: "bg-amber-50 text-amber-700", label: "Invited" },
  REQUESTED: { cls: "bg-cyan-50 text-cyan-700", label: "Partnership requested" },
  AGENT_ACCEPTED: { cls: "bg-blue-50 text-blue-700", label: "Accepted by agent" },
  ACTIVE: { cls: "bg-emerald-50 text-emerald-700", label: "Active" },
  SUSPENDED: { cls: "bg-orange-50 text-orange-700", label: "Suspended" },
  REJECTED: { cls: "bg-neutral-100 text-neutral-500", label: "Rejected" },
  TERMINATED: { cls: "bg-red-50 text-red-700", label: "Terminated" },
};
const VERIFY: Record<string, { cls: string; label: string }> = {
  VERIFIED: { cls: "text-emerald-700", label: "Verified by NoLSAF" },
  PENDING: { cls: "text-amber-700", label: "Awaiting NoLSAF verification" },
  REJECTED: { cls: "text-red-600", label: "Verification rejected" },
};

function StatusPill({ status }: { status: string }) {
  const s = LINK_STATUS[status] ?? { cls: "bg-neutral-100 text-neutral-600", label: status };
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${s.cls}`}>{s.label}</span>;
}

/** Up to two initials from the agency name, for the row avatar. */
function initials(name?: string | null): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words[0]![0]! + (words[1]?.[0] ?? "")).toUpperCase();
}

/** A labelled metadata cell: small uppercase label above a bold value. */
function MetaCell({ label, children, warn }: { label: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <span className={`text-[12px] font-bold ${warn ? "text-amber-600" : "text-neutral-800"}`}>{children}</span>
    </div>
  );
}

export default function NrmsAgentsPage() {
  const { selectedPropertyId } = useNrms();
  const [maxAgents, setMaxAgents] = useState(0);
  const [prepayWindowMinutes, setPrepayWindowMinutes] = useState(24 * 60);
  const [links, setLinks] = useState<AgentLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [termsFor, setTermsFor] = useState<AgentLink | null>(null);
  const [rateFor, setRateFor] = useState<AgentLink | null>(null);
  const [detailFor, setDetailFor] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const res = await apiClient.get<any>(`/api/owner/nrms/agents/property/${selectedPropertyId}`);
      setMaxAgents(res.data?.maxAgents ?? 0);
      setPrepayWindowMinutes(res.data?.prepayWindowMinutes ?? 24 * 60);
      setLinks(res.data?.links ?? []);
    } catch (e: any) {
      setError(e?.response?.data?.error || "Failed to load travel agents");
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  useEffect(() => { void load(); }, [load]);

  const seatsUsed = useMemo(() => links.filter((l) => !["REJECTED", "TERMINATED"].includes(l.status)).length, [links]);
  const activeCount = useMemo(() => links.filter((l) => l.status === "ACTIVE").length, [links]);
  const pendingCount = useMemo(() => links.filter((l) => ["INVITED", "REQUESTED", "AGENT_ACCEPTED"].includes(l.status)).length, [links]);
  const capReached = seatsUsed >= maxAgents && maxAgents > 0;
  const seatsLeft = Math.max(0, maxAgents - seatsUsed);

  const act = useCallback(async (linkId: number, path: string, verb: "post" | "patch" | "put", body?: any, okMsg?: string) => {
    setBusyId(linkId); setError(null); setNotice(null);
    try {
      await (apiClient as any)[verb](`/api/owner/nrms/agents/${linkId}${path}`, body ?? {});
      if (okMsg) setNotice(okMsg);
      await load();
      return true;
    } catch (e: any) {
      setError(e?.response?.data?.error || "The action could not be completed");
      return false;
    } finally {
      setBusyId(null);
    }
  }, [load]);

  if (!selectedPropertyId) {
    return <div className="rounded-xl border border-solid border-neutral-200 bg-white p-6 text-sm text-neutral-600">Select a property to manage its travel agents.</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="m-0 flex items-center gap-2.5 text-lg font-bold text-neutral-900">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm"><Handshake className="h-[18px] w-[18px]" /></span>
            Travel agents
          </h1>
          <p className="m-0 mt-1.5 max-w-2xl text-[13px] leading-relaxed text-neutral-500">Approved agents book your rooms against live inventory at your negotiated rates. You control who sells, at what price, and whether each booking needs your approval.</p>
        </div>
        <button
          type="button"
          onClick={() => { setShowAdd(true); setNotice(null); setError(null); }}
          disabled={capReached}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400"
        >
          <Plus className="h-4 w-4" /> Add agent
        </button>
      </header>

      {/* Seat meter */}
      <div className="rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-col">
            <span className="text-[13px] font-semibold text-neutral-800">Approved-agent limit</span>
            <span className="text-[11px] text-neutral-400">Set by NoLSAF{seatsLeft > 0 ? ` · ${seatsLeft} seat${seatsLeft === 1 ? "" : "s"} available` : ""}</span>
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-extrabold tabular-nums leading-none ${capReached ? "text-orange-500" : "text-emerald-600"}`}>{seatsUsed}</span>
            <span className="text-[13px] font-semibold text-neutral-400">/ {maxAgents}</span>
          </div>
        </div>

        {/* Segmented seat pips when the cap is small enough to read at a glance; a bar otherwise. */}
        {maxAgents > 0 && maxAgents <= 12 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {Array.from({ length: maxAgents }, (_, i) => (
              <span
                key={i}
                title={i < seatsUsed ? "Seat in use" : "Seat available"}
                className={`h-2 flex-1 min-w-[16px] rounded-full transition-colors ${i < seatsUsed ? (capReached ? "bg-orange-400" : "bg-emerald-500") : "border border-solid border-neutral-200 bg-neutral-100"}`}
              />
            ))}
          </div>
        ) : (
          <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-neutral-100">
            <div className={`h-full rounded-full ${capReached ? "bg-orange-400" : "bg-emerald-500"}`} style={{ width: `${maxAgents ? Math.min(100, (seatsUsed / maxAgents) * 100) : 0}%` }} />
          </div>
        )}

        {/* Live breakdown chips */}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> {activeCount} active</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-amber-700"><Clock className="h-3.5 w-3.5" /> {pendingCount} pending</span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-1 text-neutral-500"><Handshake className="h-3.5 w-3.5" /> {seatsLeft} available</span>
        </div>

        {capReached && <p className="m-0 mt-3 rounded-lg bg-orange-50 px-3 py-2 text-[12px] text-orange-700">You have reached your limit. Contact NoLSAF to increase how many agents you can approve.</p>}
      </div>

      {notice && <div className="rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{notice}</div>}
      {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}

      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white p-6 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading agents…</div>
      ) : links.length === 0 ? (
        <div className="rounded-xl border border-dashed border-solid border-neutral-200 bg-white p-8 text-center">
          <p className="m-0 text-sm font-semibold text-neutral-700">No travel agents yet</p>
          <p className="m-0 mt-1 text-[13px] text-neutral-500">Add an agency to let it book your rooms at agreed rates.</p>
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {links.map((link) => {
            const verify = link.agency ? (VERIFY[link.agency.verificationStatus] ?? { cls: "text-neutral-500", label: link.agency.verificationStatus }) : null;
            const busy = busyId === link.id;
            const notVerified = link.agency?.verificationStatus !== "VERIFIED";
            const centralSuspension = link.status === "SUSPENDED" && link.suspensionAuthority === "ADMIN";
            const agentAccepted = link.status === "REQUESTED" || link.status === "AGENT_ACCEPTED" || (link.status === "SUSPENDED" && !centralSuspension);
            const canApprove = agentAccepted && link.status !== "ACTIVE";
            const noRates = link.rateAccess.length === 0;
            return (
              <li key={link.id} className="rounded-xl border border-solid border-neutral-200 bg-white p-4 transition hover:border-neutral-300 hover:shadow-sm">
                {/* Zone 1 - identity + actions */}
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => setDetailFor(link.id)} className="flex min-w-0 items-center gap-3 border-0 bg-transparent p-0 text-left group">
                    <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-50 to-teal-100 text-[13px] font-bold text-emerald-700">{initials(link.agency?.legalName)}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-[15px] font-bold text-neutral-900 group-hover:text-emerald-700">{link.agency?.legalName ?? "Agency"}</span>
                        <StatusPill status={link.status} />
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2">
                        {link.agency?.reference && <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-500">{link.agency.reference}</span>}
                        {verify && (
                          <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${verify.cls}`}>
                            {link.agency?.verificationStatus === "VERIFIED" ? <BadgeCheck className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />} {verify.label}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-2">
                    {busy && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" />}
                    <button type="button" onClick={() => setDetailFor(link.id)} disabled={busy} title="View full details" className="inline-flex items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-700 transition hover:border-neutral-300 disabled:opacity-50"><Eye className="h-3.5 w-3.5" /> Open</button>
                    <button type="button" onClick={() => setTermsFor(link)} disabled={busy} className="rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-700 transition hover:border-neutral-300 disabled:opacity-50">Terms</button>
                    {canApprove && (
                      <button type="button" onClick={() => void act(link.id, "/approve", "post", {}, "Agent activated.")} disabled={busy || notVerified} title={notVerified ? "The agency must be verified by NoLSAF before you can activate it" : undefined} className="inline-flex items-center gap-1 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-100 disabled:text-neutral-400"><CheckCircle2 className="h-3.5 w-3.5" /> Activate</button>
                    )}
                    {link.status === "INVITED" && <span className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700">Awaiting agency acceptance</span>}
                    {link.status === "REQUESTED" && <span className="rounded-lg border border-cyan-200 bg-cyan-50 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-700">Requested by operator</span>}
                    {centralSuspension && <span className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] font-semibold text-red-700">NoLSAF review required</span>}
                    {link.status === "INVITED" && link.agency?.activationPending && <button type="button" onClick={() => void act(link.id, "/resend-invite", "post", {}, "Invitation email sent again.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-600 disabled:opacity-50"><Mail className="h-3.5 w-3.5" /> Resend activation</button>}
                    {link.status === "ACTIVE" && (
                      <button type="button" onClick={() => void act(link.id, "/suspend", "post", {}, "Agent suspended.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-solid border-orange-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-orange-700 transition hover:bg-orange-50 disabled:opacity-50"><Clock className="h-3.5 w-3.5" /> Suspend</button>
                    )}
                    {["INVITED", "REQUESTED", "AGENT_ACCEPTED"].includes(link.status) && (
                      <button type="button" onClick={() => void act(link.id, "/reject", "post", {}, "Agent rejected.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-neutral-600 transition hover:border-red-200 hover:text-red-600 disabled:opacity-50"><Ban className="h-3.5 w-3.5" /> Reject</button>
                    )}
                    {["ACTIVE", "SUSPENDED"].includes(link.status) && (
                      <button type="button" onClick={() => void act(link.id, "/terminate", "post", {}, "Partnership terminated.")} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-solid border-red-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"><Ban className="h-3.5 w-3.5" /> Terminate</button>
                    )}
                  </div>
                </div>

                {/* Zone 2 - aligned data columns */}
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 border-0 border-t border-solid border-neutral-100 pt-3 sm:grid-cols-4">
                  <MetaCell label="Booking">{link.bookingMode === "INSTANT" ? "Instant confirm" : "Request to book"}</MetaCell>
                  <MetaCell label="Payment">{link.paymentTerms === "PREPAID" ? "Prepaid" : link.paymentTerms}</MetaCell>
                  <MetaCell label="Currency">{link.currency}</MetaCell>
                  <div className="flex flex-col">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Rate access</span>
                    {noRates ? (
                      <button type="button" onClick={() => setRateFor(link)} className="w-fit border-0 bg-transparent p-0 text-left text-[12px] font-bold text-amber-600 hover:underline">Set rates →</button>
                    ) : (
                      <button type="button" onClick={() => setRateFor(link)} className="w-fit border-0 bg-transparent p-0 text-left text-[12px] font-bold text-neutral-800 hover:text-emerald-700 hover:underline">{link.rateAccess.length} plan(s)</button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {showAdd && <AddAgentPanel propertyId={selectedPropertyId} onClose={() => setShowAdd(false)} onAdded={() => { setShowAdd(false); setNotice("Agent invited. The agency must accept the relationship before activation."); void load(); }} onInvited={(delivered) => { setShowAdd(false); setNotice(delivered ? "Invitation sent. The agency accepts the hotel relationship, then NoLSAF verification enables activation." : "The agency was created, but email delivery failed. Use Resend on the pending agent row."); void load(); }} onError={setError} />}
      {termsFor && <TermsModal propertyId={selectedPropertyId} link={termsFor} prepayWindowMinutes={prepayWindowMinutes} onClose={() => setTermsFor(null)} onSaved={() => { setTermsFor(null); setNotice("Terms updated."); void load(); }} onError={setError} />}
      {rateFor && <RateAccessModal link={rateFor} propertyId={selectedPropertyId} onClose={() => setRateFor(null)} onSaved={() => { setRateFor(null); setNotice("Rate access updated."); void load(); }} onError={setError} />}
      {detailFor && <AgentDetailModal linkId={detailFor} onClose={() => setDetailFor(null)} onEditTerms={(l) => { setDetailFor(null); setTermsFor(l); }} onEditRates={(l) => { setDetailFor(null); setRateFor(l); }} />}
    </div>
  );
}

function Field({ icon, label, value, mono }: { icon: ReactNode; label: string; value: ReactNode; mono?: boolean }) {
  const empty = value === null || value === undefined || value === "";
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition hover:bg-neutral-50">
      <span className="mt-0.5 text-neutral-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
        {empty ? (
          <span className="text-[12px] font-medium italic text-neutral-300">Not provided</span>
        ) : (
          <span className={`block break-words text-[13px] ${mono ? "font-mono" : "font-semibold"} text-neutral-800`}>{value}</span>
        )}
      </div>
    </div>
  );
}

function StatTile({ label, value, warn }: { label: string; value: ReactNode; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-solid border-neutral-200 bg-white px-3 py-2.5 text-center">
      <span className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</span>
      <span className={`mt-0.5 block text-[13px] font-bold ${warn ? "text-amber-600" : "text-neutral-800"}`}>{value}</span>
    </div>
  );
}

function AgentDetailModal({ linkId, onClose, onEditTerms, onEditRates }: { linkId: number; onClose: () => void; onEditTerms: (l: AgentLink) => void; onEditRates: (l: AgentLink) => void }) {
  const [link, setLink] = useState<AgentLink | null>(null);
  const [agency, setAgency] = useState<AgencyDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await apiClient.get<any>(`/api/owner/nrms/agents/${linkId}`);
        if (!live) return;
        setLink(res.data?.link ?? null);
        setAgency(res.data?.link?.agency ?? null);
      } catch (e: any) {
        if (live) setErr(e?.response?.data?.error || "Failed to load details");
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [linkId]);

  const verify = agency ? (VERIFY[agency.verificationStatus] ?? { cls: "text-neutral-500", label: agency.verificationStatus }) : null;
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "-");

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-2xl rounded-2xl border border-solid border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-5 py-3">
          <h2 className="m-0 text-[15px] font-bold text-neutral-900">Agent details</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border-0 bg-transparent p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 p-10 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : err ? (
          <div className="p-6 text-[13px] text-red-600">{err}</div>
        ) : agency && link ? (
          <div className="max-h-[80vh] overflow-y-auto">
            {/* Hero - clean and executive, no colour fill */}
            <div className="flex items-center gap-4 border-0 border-b border-solid border-neutral-100 px-6 py-5">
              <span className="grid h-14 w-14 flex-shrink-0 place-items-center rounded-2xl bg-neutral-900 text-[18px] font-bold tracking-tight text-white shadow-sm ring-1 ring-neutral-900/5">{initials(agency.legalName)}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="m-0 truncate text-[19px] font-extrabold tracking-tight text-neutral-900">{agency.legalName}</h3>
                  <StatusPill status={link.status} />
                </div>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-500">
                  {agency.reference && <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-600">{agency.reference}</span>}
                  {agency.tradingName && <span className="font-medium text-neutral-600">{agency.tradingName}</span>}
                  {agency.nationality && <span className="inline-flex items-center gap-1"><Globe className="h-3.5 w-3.5" /> {agency.nationality}</span>}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-5 p-6">
              {/* Verification banner */}
              <div className={`flex items-start gap-2.5 rounded-xl border border-solid px-3.5 py-3 ${agency.verificationStatus === "VERIFIED" ? "border-emerald-200 bg-emerald-50" : agency.verificationStatus === "REJECTED" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}>
                {agency.verificationStatus === "VERIFIED" ? <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600" /> : <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />}
                <div>
                  <p className={`m-0 text-[13px] font-bold ${verify?.cls}`}>{verify?.label}</p>
                  <p className="m-0 mt-0.5 text-[12px] text-neutral-600">{agency.verificationStatus === "VERIFIED" ? `Verified by NoLSAF${agency.verifiedAt ? ` on ${fmtDate(agency.verifiedAt)}` : ""}. Activation also requires the agency to accept your invitation.` : agency.verificationStatus === "REJECTED" ? "NoLSAF could not verify this agency. Contact support if you need more information." : "NoLSAF is reviewing this agency. You can set terms now; activation unlocks after verification and agency acceptance."}</p>
                </div>
              </div>

              {/* Agency & KYC */}
              <section>
                <h4 className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500"><Building2 className="h-3.5 w-3.5" /> Agency & KYC</h4>
                <div className="grid grid-cols-1 gap-1 rounded-xl border border-solid border-neutral-200 bg-white p-2 sm:grid-cols-2 lg:grid-cols-3">
                  <Field icon={<Building2 className="h-4 w-4" />} label="Trading name" value={agency.tradingName} />
                  <Field icon={<Globe className="h-4 w-4" />} label="Nationality" value={agency.nationality} />
                  <Field icon={<MapPin className="h-4 w-4" />} label="Country" value={agency.countryCode} />
                  <Field icon={<FileText className="h-4 w-4" />} label="Registration no." value={agency.registrationNo} mono />
                  <Field icon={<FileText className="h-4 w-4" />} label="TIN" value={agency.tin} mono />
                  <Field icon={<BadgeCheck className="h-4 w-4" />} label="Licence no." value={agency.licenseNo} mono />
                </div>
              </section>

              {/* Contact */}
              <section>
                <h4 className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500"><User className="h-3.5 w-3.5" /> Contact</h4>
                <div className="grid grid-cols-1 gap-1 rounded-xl border border-solid border-neutral-200 bg-white p-2 sm:grid-cols-2">
                  <Field icon={<User className="h-4 w-4" />} label="Contact person" value={agency.contactName} />
                  <Field icon={<Mail className="h-4 w-4" />} label="Email" value={agency.contactEmail ? <a href={`mailto:${agency.contactEmail}`} className="text-emerald-700 hover:underline">{agency.contactEmail}</a> : null} />
                  <Field icon={<Phone className="h-4 w-4" />} label="Phone" value={agency.contactPhone} />
                  <Field icon={<MapPin className="h-4 w-4" />} label="Address" value={agency.address} />
                </div>
              </section>

              {/* Terms at this property */}
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h4 className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500"><Wallet className="h-3.5 w-3.5" /> Terms at this property</h4>
                  <div className="flex items-center gap-3">
                    <button type="button" onClick={() => onEditRates(link)} className="border-0 bg-transparent p-0 text-[11px] font-semibold text-emerald-700 hover:underline">Rate access</button>
                    <button type="button" onClick={() => onEditTerms(link)} className="border-0 bg-transparent p-0 text-[11px] font-semibold text-emerald-700 hover:underline">Edit terms</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <StatTile label="Booking" value={link.bookingMode === "INSTANT" ? "Instant" : "On request"} />
                  <StatTile label="Payment" value={link.paymentTerms === "PREPAID" ? "Prepaid" : link.paymentTerms} />
                  <StatTile label="Currency" value={link.currency} />
                  <StatTile label="Rate access" value={link.rateAccess.length ? `${link.rateAccess.length} plan(s)` : "None"} warn={link.rateAccess.length === 0} />
                </div>
              </section>

              {/* Documents */}
              <section>
                <h4 className="m-0 mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-neutral-500"><FileText className="h-3.5 w-3.5" /> Documents ({agency.documentCount})</h4>
                {agency.documents.length === 0 ? (
                  <p className="m-0 rounded-xl border border-dashed border-solid border-neutral-200 bg-neutral-50 px-3 py-3 text-[12px] text-neutral-500">No verified document attestation is available. Raw KYC evidence is restricted to NoLSAF verification staff.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {agency.documents.map((d, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 rounded-xl border border-solid border-neutral-200 px-3 py-2.5">
                        <span className="flex items-center gap-2 text-[12px] font-semibold text-neutral-700"><span className="grid h-7 w-7 place-items-center rounded-lg bg-neutral-100"><FileText className="h-3.5 w-3.5 text-neutral-500" /></span> {d.type.replace(/_/g, " ")}</span>
                        <span className="rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[11px] font-semibold text-neutral-500">Protected by NoLSAF</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Timeline footer */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-0 border-t border-solid border-neutral-100 pt-3 text-[11px] text-neutral-400">
                <span className="inline-flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Added {fmtDate(agency.createdAt)}</span>
                {agency.verifiedAt && <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> Verified {fmtDate(agency.verifiedAt)}</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="p-6 text-[13px] text-neutral-500">No details available.</div>
        )}
      </div>
    </div>
  );
}

function AddAgentPanel({ propertyId, onClose, onAdded, onInvited, onError }: { propertyId: number; onClose: () => void; onAdded: () => void; onInvited: (delivered: boolean) => void; onError: (m: string) => void }) {
  const [mode, setMode] = useState<"search" | "invite">("search");
  const [q, setQ] = useState({ registrationNo: "", tin: "", contactEmail: "" });
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [attaching, setAttaching] = useState<number | null>(null);
  const [invite, setInvite] = useState({ email: "", legalName: "", nationality: "", tradingName: "", registrationNo: "", tin: "", contactName: "", contactPhone: "" });
  const [inviting, setInviting] = useState(false);

  const search = async () => {
    setSearching(true); setMatches(null);
    try {
      const body: any = {};
      if (q.registrationNo.trim()) body.registrationNo = q.registrationNo.trim();
      if (q.tin.trim()) body.tin = q.tin.trim();
      if (q.contactEmail.trim()) body.contactEmail = q.contactEmail.trim();
      const res = await apiClient.post<any>(`/api/owner/nrms/agents/property/${propertyId}/lookup`, body);
      setMatches(res.data?.matches ?? []);
    } catch (e: any) {
      onError(e?.response?.data?.error || "Lookup failed");
    } finally {
      setSearching(false);
    }
  };

  const attach = async (agentAccountId: number) => {
    setAttaching(agentAccountId);
    try {
      await apiClient.post(`/api/owner/nrms/agents/property/${propertyId}`, { agentAccountId });
      onAdded();
    } catch (e: any) {
      onError(e?.response?.data?.error || "Could not add this agency");
    } finally {
      setAttaching(null);
    }
  };

  const sendInvite = async () => {
    setInviting(true);
    try {
      const body: any = { email: invite.email.trim(), legalName: invite.legalName.trim(), nationality: invite.nationality.trim() };
      if (invite.tradingName.trim()) body.tradingName = invite.tradingName.trim();
      if (invite.registrationNo.trim()) body.registrationNo = invite.registrationNo.trim();
      if (invite.tin.trim()) body.tin = invite.tin.trim();
      if (invite.contactName.trim()) body.contactName = invite.contactName.trim();
      if (invite.contactPhone.trim()) body.contactPhone = invite.contactPhone.trim();
      const response = await apiClient.post<any>(`/api/owner/nrms/agents/property/${propertyId}/invite`, body);
      onInvited(response.data?.delivery === "SENT");
    } catch (e: any) {
      onError(e?.response?.data?.error || "Could not send the invitation");
    } finally {
      setInviting(false);
    }
  };

  const inviteValid = invite.email.trim().includes("@") && invite.legalName.trim().length >= 2 && invite.nationality.trim().length >= 2;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-2xl border border-solid border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-5 py-3">
          <h2 className="m-0 flex items-center gap-2 text-[15px] font-bold text-neutral-900">
            {mode === "invite" && <button type="button" onClick={() => setMode("search")} aria-label="Back" className="rounded-lg border-0 bg-transparent p-0 text-neutral-400 hover:text-neutral-700"><ArrowLeft className="h-4 w-4" /></button>}
            {mode === "search" ? "Add a travel agent" : "Invite a new agency"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border-0 bg-transparent p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>

        {mode === "search" ? (
          <div className="flex flex-col gap-3 p-5">
            <p className="m-0 text-[13px] text-neutral-500">Search for an agency already registered with NoLSAF by its registration number, TIN, or email, then add it to this property.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input value={q.registrationNo} onChange={(e) => setQ({ ...q, registrationNo: e.target.value })} placeholder="Registration no." className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-400" />
              <input value={q.tin} onChange={(e) => setQ({ ...q, tin: e.target.value })} placeholder="TIN" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-400" />
              <input value={q.contactEmail} onChange={(e) => setQ({ ...q, contactEmail: e.target.value })} placeholder="Email" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] outline-none focus:border-emerald-400" />
            </div>
            <button type="button" onClick={() => void search()} disabled={searching || (!q.registrationNo.trim() && !q.tin.trim() && !q.contactEmail.trim())} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-800 bg-neutral-800 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-neutral-900 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />} Search
            </button>

            {matches !== null && (
              matches.length === 0 ? (
                <div className="flex flex-col items-start gap-2 rounded-lg border border-solid border-neutral-100 bg-neutral-50 px-3 py-3">
                  <p className="m-0 text-[13px] text-neutral-600">No matching agency found. If this agency has never worked with NoLSAF, invite them and we will email a link to set up their account.</p>
                  <button type="button" onClick={() => { setInvite((v) => ({ ...v, registrationNo: q.registrationNo, tin: q.tin, email: q.contactEmail })); setMode("invite"); }} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700">
                    <UserPlus className="h-3.5 w-3.5" /> Invite a new agency
                  </button>
                </div>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {matches.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-solid border-neutral-200 px-3 py-2">
                      <div className="min-w-0">
                        <p className="m-0 truncate text-[13px] font-semibold text-neutral-900">{m.legalName}</p>
                        <p className="m-0 text-[11px] text-neutral-500">{(VERIFY[m.verificationStatus]?.label) ?? m.verificationStatus} · matched on {m.matchedOn.join(", ") || "-"}</p>
                      </div>
                      <button type="button" onClick={() => void attach(m.id)} disabled={attaching === m.id} className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-2.5 py-1.5 text-[12px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50">
                        {attaching === m.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} Add
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}

            {/* Always-available escape hatch to onboard someone brand new. */}
            <button type="button" onClick={() => setMode("invite")} className="mt-1 inline-flex items-center gap-1.5 self-start rounded-lg border-0 bg-transparent p-0 text-[12px] font-semibold text-emerald-700 hover:text-emerald-800">
              <UserPlus className="h-3.5 w-3.5" /> Can’t find them? Invite a new agency
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-5">
            <p className="m-0 text-[13px] text-neutral-500">We will email a one-time link for the agency to set their password. They can book once NoLSAF has verified them.</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600 sm:col-span-2">Agency legal name *
                <input value={invite.legalName} onChange={(e) => setInvite({ ...invite, legalName: e.target.value })} placeholder="e.g. Kilimanjaro Travel Ltd" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600">Contact email *
                <input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} placeholder="bookings@agency.co.tz" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600">Nationality *
                <input value={invite.nationality} onChange={(e) => setInvite({ ...invite, nationality: e.target.value })} placeholder="e.g. Tanzanian" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600">Trading name
                <input value={invite.tradingName} onChange={(e) => setInvite({ ...invite, tradingName: e.target.value })} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600">Contact person
                <input value={invite.contactName} onChange={(e) => setInvite({ ...invite, contactName: e.target.value })} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600">Registration no.
                <input value={invite.registrationNo} onChange={(e) => setInvite({ ...invite, registrationNo: e.target.value })} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600">TIN
                <input value={invite.tin} onChange={(e) => setInvite({ ...invite, tin: e.target.value })} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-semibold text-neutral-600 sm:col-span-2">Contact phone
                <input value={invite.contactPhone} onChange={(e) => setInvite({ ...invite, contactPhone: e.target.value })} placeholder="+255…" className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400" />
              </label>
            </div>
            <div className="mt-1 flex justify-end gap-2">
              <button type="button" onClick={() => setMode("search")} className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-600 hover:border-neutral-300">Back</button>
              <button type="button" onClick={() => void sendInvite()} disabled={inviting || !inviteValid} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400">
                {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />} Send invitation
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type RatePlan = {
  id: number; code: string; name: string; mealPlan: string; roomTypeId: number | null; roomTypeName: string | null;
  currency: string; adjustmentType: string; adjustment: number;
  sampleRates: Array<{ roomTypeName: string; rate: number }>;
};

const money0 = (n: number) => Math.round(n).toLocaleString();

/** Human-readable pricing basis, e.g. "10% off base" or "Fixed 50,000". */
function rateBasis(p: RatePlan): string {
  const a = p.adjustment;
  if (p.adjustmentType === "FIXED") return `Fixed ${p.currency} ${money0(a)}`;
  if (p.adjustmentType === "PERCENT") return a === 0 ? "Base rate" : `${Math.abs(a)}% ${a < 0 ? "off" : "above"} base`;
  if (p.adjustmentType === "OFFSET") return a === 0 ? "Base rate" : `${p.currency} ${money0(Math.abs(a))} ${a < 0 ? "off" : "above"} base`;
  return "Base rate";
}

/** Price range summary across a plan's applicable room types. */
function rateRange(p: RatePlan): string {
  if (p.sampleRates.length === 0) return "-";
  const vals = p.sampleRates.map((s) => s.rate);
  const min = Math.min(...vals), max = Math.max(...vals);
  return min === max ? `${p.currency} ${money0(min)}` : `${p.currency} ${money0(min)}–${money0(max)}`;
}

const titleCase = (s: string) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

function RateAccessModal({ link, propertyId, onClose, onSaved, onError }: { link: AgentLink; propertyId: number | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [plans, setPlans] = useState<RatePlan[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set(link.rateAccess.map((r) => r.ratePlanId)));
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      if (!propertyId) return;
      try {
        const res = await apiClient.get<any>(`/api/owner/nrms/agents/property/${propertyId}/rate-plans`);
        if (live) {
          const compatible = (res.data?.ratePlans ?? []).filter((plan: RatePlan) => plan.currency === link.currency && plan.sampleRates.length > 0);
          setPlans(compatible);
          setSelected((current) => new Set([...current].filter((id) => compatible.some((plan: RatePlan) => plan.id === id))));
        }
      } catch (e: any) {
        if (live) { onError(e?.response?.data?.error || "Failed to load rate plans"); setPlans([]); }
      }
    })();
    return () => { live = false; };
  }, [link.currency, propertyId, onError]);

  const toggle = (id: number) => setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleExpand = (id: number) => setExpanded((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const save = async () => {
    setSaving(true);
    try {
      const entries = [...selected].map((ratePlanId) => ({ ratePlanId, roomTypeId: null }));
      await apiClient.put(`/api/owner/nrms/agents/${link.id}/rate-access`, { entries });
      onSaved();
    } catch (e: any) {
      onError(e?.response?.data?.error || "Could not save rate access");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-solid border-neutral-200 bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-center justify-between border-0 border-b border-solid border-neutral-100 px-5 py-3">
          <h2 className="m-0 text-[15px] font-bold text-neutral-900">Rate access</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border-0 bg-transparent p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-5">
          <p className="m-0 text-[13px] text-neutral-500">Choose which {link.currency} rate plans this agent can sell. Only plans backed by an active {link.currency} room are eligible.</p>

          {plans === null ? (
            <div className="flex items-center gap-2 py-6 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading rate plans…</div>
          ) : plans.length === 0 ? (
            <div className="rounded-xl border border-dashed border-solid border-neutral-200 bg-neutral-50 px-4 py-6 text-center">
              <p className="m-0 text-[13px] font-semibold text-neutral-700">No rate plans yet</p>
              <p className="m-0 mt-1 text-[12px] text-neutral-500">Create rate plans in Hotel controls first, then choose which ones this agent can sell.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px] font-semibold text-neutral-400">
                <span>{selected.size} of {plans.length} selected</span>
                <button type="button" onClick={() => setSelected(selected.size === plans.length ? new Set() : new Set(plans.map((p) => p.id)))} className="border-0 bg-transparent p-0 text-emerald-700 hover:underline">{selected.size === plans.length ? "Clear all" : "Select all"}</button>
              </div>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
                {plans.map((p) => {
                  const on = selected.has(p.id);
                  const open = expanded.has(p.id);
                  return (
                    <li key={p.id} className={`overflow-hidden rounded-2xl border border-solid transition ${on ? "border-emerald-400 bg-emerald-50/40 shadow-sm ring-1 ring-emerald-500/10" : "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                      {/* Header */}
                      <div className="flex items-start gap-3.5 p-4">
                        <button type="button" onClick={() => toggle(p.id)} className="flex min-w-0 flex-1 items-start gap-3.5 border-0 bg-transparent p-0 text-left">
                          <span className={`mt-0.5 grid h-6 w-6 flex-shrink-0 place-items-center rounded-lg border border-solid transition ${on ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 bg-white"}`}>{on && <CheckCircle2 className="h-4 w-4" />}</span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-[15px] font-bold text-neutral-900">{p.name}</span>
                              <span className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral-500">{p.code}</span>
                            </span>
                            <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">{titleCase(p.mealPlan)}</span>
                              <span className="inline-flex items-center rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600">{p.roomTypeName ?? "All room types"}</span>
                              <span className="inline-flex items-center gap-1 rounded-md bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold text-neutral-600"><Tag className="h-3 w-3" /> {rateBasis(p)}</span>
                            </span>
                          </span>
                        </button>
                        <div className="flex flex-shrink-0 items-center gap-2 text-right">
                          <div>
                            <span className="block text-[16px] font-extrabold leading-tight text-neutral-900">{rateRange(p)}</span>
                            <span className="block text-[10px] font-medium uppercase tracking-wide text-neutral-400">per night</span>
                          </div>
                          {p.sampleRates.length > 1 && (
                            <button type="button" onClick={() => toggleExpand(p.id)} aria-label="Review rates by room type" className={`grid h-8 w-8 flex-shrink-0 place-items-center rounded-lg border border-solid transition ${open ? "border-neutral-300 bg-neutral-100 text-neutral-700" : "border-neutral-200 bg-white text-neutral-400 hover:text-neutral-700"}`}><ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} /></button>
                          )}
                        </div>
                      </div>
                      {/* Breakdown table */}
                      {open && p.sampleRates.length > 0 && (
                        <div className="border-0 border-t border-solid border-neutral-100 bg-white/60 px-4 py-3">
                          <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
                            <span>Room type</span><span>Rate / night</span>
                          </div>
                          <div className="flex flex-col">
                            {p.sampleRates.map((s, i) => (
                              <div key={i} className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 py-1.5 text-[13px] last:border-b-0">
                                <span className="font-medium text-neutral-700">{s.roomTypeName}</span>
                                <span className="font-bold tabular-nums text-neutral-900">{p.currency} {money0(s.rate)}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 bg-white px-5 py-3">
          <span className="text-[12px] font-medium text-neutral-400">{plans ? `${selected.size} plan${selected.size === 1 ? "" : "s"} selected` : ""}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-600 hover:border-neutral-300">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving || plans === null} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save rate access</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function paymentWindowLabel(minutes: number): string {
  if (minutes % (24 * 60) === 0) return `${minutes / (24 * 60)} day${minutes === 24 * 60 ? "" : "s"}`;
  if (minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? "" : "s"}`;
  return `${minutes} minutes`;
}

function TermsModal({ propertyId, link, prepayWindowMinutes, onClose, onSaved, onError }: { propertyId: number; link: AgentLink; prepayWindowMinutes: number; onClose: () => void; onSaved: () => void; onError: (m: string) => void }) {
  const [bookingMode, setBookingMode] = useState(link.bookingMode);
  const [currency, setCurrency] = useState(link.currency);
  const [supportedCurrencies, setSupportedCurrencies] = useState<string[] | null>(null);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [creditLimit] = useState(String(link.creditLimit ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void apiClient.get<any>(`/api/owner/nrms/agents/property/${propertyId}/rate-plans`).then((res) => {
      if (!live) return;
      const available = Array.isArray(res.data?.supportedCurrencies) ? res.data.supportedCurrencies : [];
      setSupportedCurrencies(available);
      if (!available.includes(link.currency) && available[0]) setCurrency(available[0]);
    }).catch((e: any) => {
      if (!live) return;
      setSupportedCurrencies([]);
      setCurrencyError(e?.response?.data?.error || "Could not verify the property's currencies");
    });
    return () => { live = false; };
  }, [link.currency, propertyId]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.patch(`/api/owner/nrms/agents/${link.id}/terms`, { bookingMode, currency: currency.toUpperCase(), paymentTerms: "PREPAID", creditLimit: Number(creditLimit) || 0 });
      onSaved();
    } catch (e: any) {
      onError(e?.response?.data?.error || "Could not update terms");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="w-full max-w-md rounded-2xl border border-solid border-neutral-200 bg-white shadow-xl">
        <div className="flex items-center justify-between border-0 border-b border-solid border-neutral-100 px-5 py-3">
          <h2 className="m-0 text-[15px] font-bold text-neutral-900">Agent terms</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg border-0 bg-transparent p-1 text-neutral-400 hover:text-neutral-700"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-col gap-3 p-5">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-neutral-700">
            Booking mode
            <select value={bookingMode} onChange={(e) => setBookingMode(e.target.value)} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400">
              <option value="REQUEST">Request to book (you approve each)</option>
              <option value="INSTANT">Instant confirm</option>
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-neutral-700">
              Payment
              <select value="PREPAID" disabled className="cursor-not-allowed rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2 text-[13px] font-normal text-neutral-600 outline-none">
                <option value="PREPAID">Prepaid (agent pays upfront)</option>
                <option value="CREDIT" disabled>Credit / on-account (coming soon)</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold text-neutral-700">
              Currency
              <select value={currency} onChange={(e) => setCurrency(e.target.value)} disabled={supportedCurrencies === null || supportedCurrencies.length === 0} className="rounded-lg border border-solid border-neutral-200 px-3 py-2 text-[13px] font-normal outline-none focus:border-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500">
                {supportedCurrencies === null && <option value={currency}>Checking currencies…</option>}
                {supportedCurrencies?.length === 0 && <option value={currency}>{currency} (not configured)</option>}
                {supportedCurrencies?.map((code) => <option key={code} value={code}>{code}{code === "TZS" ? " (Tanzanian Shilling)" : code === "USD" ? " (US Dollar)" : ""}</option>)}
              </select>
            </label>
          </div>
          {currencyError && <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-[11px] text-red-700">{currencyError}</p>}
          {supportedCurrencies?.length === 0 && !currencyError && <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">Add an active priced room and an active rate plan in the same currency before saving agent terms.</p>}
          {supportedCurrencies && supportedCurrencies.length > 0 && !supportedCurrencies.includes(link.currency) && <p className="m-0 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-700">The current {link.currency} term is not backed by a compatible room and rate plan. Saving will safely switch this agent to {currency}.</p>}
          <p className="m-0 flex items-start gap-1.5 rounded-lg bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500"><Wallet className="mt-px h-3.5 w-3.5 flex-shrink-0 text-neutral-400" /> Prepaid bookings must be settled within {paymentWindowLabel(prepayWindowMinutes)} of confirmation, including hotel-approved requests. The exact deadline is shown to the agent. Unpaid inventory is released after that deadline.</p>
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-solid border-neutral-200 bg-white px-3 py-2 text-[13px] font-semibold text-neutral-600 hover:border-neutral-300">Cancel</button>
            <button type="button" onClick={() => void save()} disabled={saving || supportedCurrencies === null || !supportedCurrencies.includes(currency)} className="inline-flex items-center gap-1.5 rounded-lg border border-solid border-emerald-600 bg-emerald-600 px-3.5 py-2 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:border-neutral-200 disabled:bg-neutral-200 disabled:text-neutral-400">{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save terms</button>
          </div>
        </div>
      </div>
    </div>
  );
}
