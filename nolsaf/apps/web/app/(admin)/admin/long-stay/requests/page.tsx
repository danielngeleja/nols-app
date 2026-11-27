"use client";

/**
 * Long stay for assisted listings (docs/LONG_STAY_RENTALS.md section 15).
 * A Sales Partner listing a home for an owner asks NoLSAF to switch long stay
 * on for that owner. Approving switches it on for the owner (all their homes,
 * like the owner page switch) and texts the owner with a "Not expecting
 * this?" link; declining needs a reason the partner sees.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Clock3, Eye, Handshake, Inbox, KeyRound, Loader2, ShieldAlert, UserRound, X, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import AdminNotificationTarget from "@/components/longStay/AdminNotificationTarget";

type View = "PENDING" | "APPROVED" | "DECLINED" | "ALL";
type Request = {
  ref: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN";
  /** The owner's long-stay switch right now (one switch for all their homes). */
  ownerSwitch?: "ON" | "PAUSED" | "OFF";
  reason: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  listingStatus: string | null;
  visitRecorded: boolean;
  property: { title: string | null; type: string | null; area: string | null };
  owner: { name: string | null; phone: string | null; newAccount: boolean; phoneVerified: boolean };
  partner: { name: string | null; code: string | null };
  regionalRecommendation?: { regionName: string; leadName: string; note: string | null; at: string } | null;
};
type Payload = { view: View; counts: Record<string, number>; requests: Request[]; migrationNeeded?: boolean };

const STATUS = {
  PENDING: { label: "Waiting", tone: "bg-amber-50 text-amber-900" },
  APPROVED: { label: "Approved", tone: "bg-emerald-50 text-emerald-800" },
  DECLINED: { label: "Declined", tone: "bg-red-50 text-red-700" },
  WITHDRAWN: { label: "Withdrawn", tone: "bg-slate-100 text-slate-700" },
};

const SWITCH = {
  ON: { label: "On", dot: "bg-emerald-500", text: "text-emerald-700" },
  PAUSED: { label: "Paused", dot: "bg-amber-500", text: "text-amber-700" },
  OFF: { label: "Off", dot: "bg-slate-300", text: "text-slate-500" },
};

/** "JAMESON APARTMENT" reads "Jameson Apartment"; mixed case is kept. */
function titleCase(value: string | null) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function initials(value: string | null) {
  return String(value || "").split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "LS";
}

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}

function readable(value: string | null) {
  if (!value) return "";
  const text = value.replace(/_/g, " ").toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function LongStayRequestsPage() {
  const target = useSearchParams()?.get("ref") ?? null;
  const [view, setView] = useState<View>(target ? "ALL" : "PENDING");
  const [version, setVersion] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [open, setOpen] = useState<string | null>(target);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void apiClient.get<Payload>("/api/admin/long-stay/access-requests", { params: { view }, signal: controller.signal })
      .then(({ data: result }) => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch((e) => { if (!controller.signal.aborted) setError(e?.response?.data?.error || "Could not load requests."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [view, version]);

  const pending = data?.counts?.PENDING ?? 0;
  const rows = (data?.requests ?? []).filter((r) => !target || r.ref === target || view !== "ALL");
  const opened = open ? (data?.requests ?? []).find((r) => r.ref === open) ?? null : null;

  return (
    <div id="ls-requests" className="w-full">
      <style>{`#ls-requests, #ls-requests * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Long stay requests"
        description="Sales Partners listing homes for owners ask here to switch long stay on for that owner."
        metrics={[{ label: "Waiting for a decision", value: data ? pending : "-", tone: pending ? "warn" : "default" }]}
        onRefresh={() => setVersion((v) => v + 1)}
        loading={loading}
        tabs={[
          { key: "PENDING", label: "Waiting", Icon: Inbox, count: pending || undefined },
          { key: "APPROVED", label: "Approved", Icon: CheckCircle2 },
          { key: "DECLINED", label: "Declined", Icon: XCircle },
          { key: "ALL", label: "All", Icon: KeyRound },
        ]}
        activeTab={view}
        onTab={(next) => { if (next !== view) { setView(next); setNotice(""); } }}
      />
      {target && <AdminNotificationTarget href="/admin/long-stay/requests">Request from Notifications</AdminNotificationTarget>}
      {notice && <p role="status" className="m-0 mt-3 flex items-center gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900"><CheckCircle2 className="size-4" aria-hidden />{notice}</p>}

      <section aria-busy={loading} className="mt-3 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        {data?.migrationNeeded ? (
          <p className="m-0 px-4 py-6 text-sm text-amber-800">Long-stay requests need a database update before they can be used.</p>
        ) : loading && !data ? (
          <p role="status" className="m-0 flex min-h-32 items-center justify-center gap-2 text-sm text-slate-600"><Loader2 className="size-4 animate-spin" aria-hidden />Loading requests</p>
        ) : error ? (
          <p role="alert" className="m-0 px-4 py-6 text-sm text-red-700">{error}</p>
        ) : rows.length === 0 ? (
          <p className="m-0 px-4 py-10 text-center text-sm text-slate-500">{view === "PENDING" ? "No requests waiting." : "Nothing here yet."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead>
                <tr className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">Home</th>
                  <th className="px-4 py-2.5 font-semibold">Owner</th>
                  <th className="px-4 py-2.5 font-semibold">Partner</th>
                  <th className="px-4 py-2.5 font-semibold">Requested</th>
                  <th className="px-4 py-2.5 font-semibold">Owner switch</th>
                  <th className="px-4 py-2.5 font-semibold">Status</th>
                  <th className="w-14 px-4 py-2.5"><span className="sr-only">Open</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const status = STATUS[r.status];
                  const sw = SWITCH[r.ownerSwitch ?? "OFF"];
                  return (
                    <tr key={r.ref} className="border-0 border-t border-solid border-slate-100 align-middle hover:bg-slate-50/70">
                      <td className="max-w-[240px] px-4 py-3">
                        <p className="m-0 truncate font-semibold text-slate-900">{titleCase(r.property.title) || "Assisted listing"}</p>
                        <p className="m-0 truncate text-xs text-slate-500">{[readable(r.property.type), r.property.area].filter(Boolean).join(" · ") || "Details not set"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="m-0 truncate text-slate-800">{r.owner.name || "Owner"}</p>
                        <p className="m-0 font-mono text-xs text-slate-400">{r.owner.phone || "No phone"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="m-0 truncate text-slate-800">{r.partner.name || "Partner"}</p>
                        <p className="m-0 font-mono text-xs text-slate-400">{r.partner.code || ""}</p>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">{eat(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${sw.text}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${sw.dot}`} aria-hidden />{sw.label}
                        </span>
                      </td>
                      <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span></td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setOpen(r.ref)}
                          aria-label={`Open request for ${r.property.title || "this home"}`}
                          title="Open"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-solid border-slate-200 bg-white text-slate-500 hover:border-[#02665e]/40 hover:bg-[#02665e]/5 hover:text-[#02665e]"
                        >
                          <Eye className="size-4" aria-hidden />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {opened ? (
        <RequestCard
          key={opened.ref}
          request={opened}
          onClose={() => setOpen(null)}
          onDecided={(message) => { setNotice(message); setOpen(null); setVersion((v) => v + 1); }}
        />
      ) : null}
    </div>
  );
}

/** One request, opened from the eye: everything needed to decide, centered. */
function RequestCard({ request: r, onClose, onDecided }: { request: Request; onClose: () => void; onDecided: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "APPROVED" | "DECLINED">("");
  const [error, setError] = useState("");
  const status = STATUS[r.status];
  const sw = SWITCH[r.ownerSwitch ?? "OFF"];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const decide = async (decision: "APPROVED" | "DECLINED") => {
    if (decision === "DECLINED" && note.trim().length < 10) { setError("Write the partner a reason (at least 10 characters) to decline."); return; }
    setBusy(decision);
    setError("");
    try {
      const { data } = await apiClient.post(`/api/admin/long-stay/access-requests/${r.ref}/decide`, { decision, note: note.trim() || null });
      window.dispatchEvent(new Event("nols:admin-long-stay-queue-change"));
      const others = Number(data?.alsoSettled || 0);
      onDecided(decision === "APPROVED"
        ? `Long stay is on for ${r.owner.name || "the owner"}, for all their homes.${data?.ownerTold === false ? " The owner SMS could not be sent; call them." : " The owner was told by SMS."}${others ? ` ${others} other waiting request${others === 1 ? " for this owner was" : "s for this owner were"} approved too.` : ""}`
        : "Request declined. The partner was told why.");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save the decision.");
    } finally {
      setBusy("");
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-[2px]" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div id="ls-request-card" role="dialog" aria-modal="true" aria-labelledby="ls-request-title" className="relative max-h-[92vh] w-full max-w-[520px] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <style>{`#ls-request-card, #ls-request-card * { box-sizing: border-box; }`}</style>

        {/* Header: the home and where it stands */}
        <div className="bg-[#0b2420] px-5 pb-4 pt-5 text-white">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/10 text-[15px] font-bold">{initials(r.property.title)}</span>
              <div className="min-w-0">
                <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-white/45">Long stay request</p>
                <h2 id="ls-request-title" className="m-0 truncate text-[17px] font-semibold text-white">{titleCase(r.property.title) || "Assisted listing"}</h2>
                <p className="m-0 truncate text-[12.5px] text-white/60">{[readable(r.property.type), r.property.area].filter(Boolean).join(" · ") || "Details not set yet"}</p>
              </div>
            </div>
            <button type="button" onClick={onClose} disabled={Boolean(busy)} aria-label="Close" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-0 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11.5px]">
            <span className={`rounded-md px-2 py-1 font-bold ${status.tone}`}>{status.label}</span>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1 text-white/85"><span className={`h-1.5 w-1.5 rounded-full ${sw.dot}`} aria-hidden />Owner switch: {sw.label}</span>
            <span className="rounded-md bg-white/10 px-2 py-1 font-mono text-white/60">{r.ref}</span>
          </div>
        </div>

        <div className="space-y-4 px-5 py-4">
          {/* The partner's reason */}
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Why the partner asks</p>
            <blockquote className="m-0 mt-1.5 rounded-md border-0 border-l-[3px] border-solid border-[#02665e]/40 bg-slate-50 px-3 py-2 text-[13.5px] leading-relaxed text-slate-800">{r.reason}</blockquote>
            {r.regionalRecommendation && (
              <p className="m-0 mt-2 inline-flex items-start gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800">
                <CheckCircle2 className="mt-px size-3.5 shrink-0" aria-hidden />
                <span>Recommended by the {r.regionalRecommendation.regionName} lead, {r.regionalRecommendation.leadName}{r.regionalRecommendation.note ? <span className="font-normal">: {r.regionalRecommendation.note}</span> : null}</span>
              </p>
            )}
          </div>

          {/* Who is involved */}
          <dl className="m-0 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 text-[12.5px]">
            <Fact icon={UserRound} label="Owner" value={r.owner.name || "Owner"} sub={`${r.owner.phone || "No phone"} · ${r.owner.newAccount ? (r.owner.phoneVerified ? "has signed in" : "not signed in yet") : "existing owner"}`} />
            <Fact icon={Handshake} label="Partner" value={r.partner.name || "Partner"} sub={r.partner.code || ""} />
            <Fact icon={ShieldAlert} label="Checks" value={r.visitRecorded ? "Visit recorded" : "No visit recorded"} sub={`Listing ${readable(r.listingStatus).toLowerCase() || "unknown"}`} />
            <Fact icon={Clock3} label="Requested" value={eat(r.createdAt)} sub={r.decidedAt ? `${status.label} ${eat(r.decidedAt)}${r.decidedBy ? ` by ${r.decidedBy}` : ""}` : "Waiting for a decision"} />
          </dl>
          {r.decisionNote ? <p className="m-0 rounded-md bg-slate-50 px-3 py-2 text-[12.5px] text-slate-600">Decision note: {r.decisionNote}</p> : null}

          {r.status === "PENDING" ? (
            <div className="space-y-2.5">
              <p className="m-0 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-[12.5px] leading-5 text-amber-900">
                <KeyRound className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Approving switches long stay on for this owner, for all their homes, texts them, and approves any other waiting request for the same owner. Call the owner first if anything looks off.
              </p>
              <textarea
                value={note}
                onChange={(e) => { setNote(e.target.value); setError(""); }}
                maxLength={300}
                rows={2}
                placeholder="Note to the partner (required to decline)"
                className="w-full rounded-md border border-solid border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
              />
              {error && <p role="alert" className="m-0 text-xs text-red-700">{error}</p>}
            </div>
          ) : null}
        </div>

        {r.status === "PENDING" ? (
          <div className="flex flex-wrap gap-2 border-0 border-t border-solid border-slate-100 px-5 py-4">
            <button type="button" disabled={Boolean(busy)} onClick={() => decide("DECLINED")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              {busy === "DECLINED" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
              Decline
            </button>
            <button type="button" disabled={Boolean(busy)} onClick={() => decide("APPROVED")} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-50">
              {busy === "APPROVED" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
              Approve and switch on
            </button>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function Fact({ icon: Icon, label, value, sub }: { icon: typeof UserRound; label: string; value: string; sub: string }) {
  return (
    <div className="bg-white px-3 py-2.5">
      <dt className="flex items-center gap-1.5 text-[11px] text-slate-400"><Icon className="size-3.5" aria-hidden />{label}</dt>
      <dd className="m-0 mt-0.5 truncate font-semibold text-slate-900">{value}</dd>
      {sub ? <dd className="m-0 truncate text-[11.5px] text-slate-500">{sub}</dd> : null}
    </div>
  );
}
