"use client";

/**
 * Long stay for assisted listings (docs/LONG_STAY_RENTALS.md section 15).
 * A Sales Partner listing a home for an owner asks NoLSAF to switch long stay
 * on for that owner. Approving switches it on for the owner (all their homes,
 * like the owner page switch) and texts the owner with a "Not expecting
 * this?" link; declining needs a reason the partner sees.
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Inbox, KeyRound, Loader2, MapPin, ShieldAlert, UserRound, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";
import AdminNotificationTarget from "@/components/longStay/AdminNotificationTarget";

type View = "PENDING" | "APPROVED" | "DECLINED" | "ALL";
type Request = {
  ref: string;
  status: "PENDING" | "APPROVED" | "DECLINED" | "WITHDRAWN";
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
          <ul className="m-0 list-none p-0">
            {rows.map((r) => (
              <RequestRow
                key={r.ref}
                request={r}
                expanded={open === r.ref}
                onToggle={() => setOpen(open === r.ref ? null : r.ref)}
                onDecided={(message) => { setNotice(message); setOpen(null); setVersion((v) => v + 1); }}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RequestRow({ request: r, expanded, onToggle, onDecided }: { request: Request; expanded: boolean; onToggle: () => void; onDecided: (message: string) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"" | "APPROVED" | "DECLINED">("");
  const [error, setError] = useState("");
  const status = STATUS[r.status];

  const decide = async (decision: "APPROVED" | "DECLINED") => {
    setBusy(decision);
    setError("");
    try {
      const { data } = await apiClient.post(`/api/admin/long-stay/access-requests/${r.ref}/decide`, { decision, note: note.trim() || null });
      window.dispatchEvent(new Event("nols:admin-long-stay-queue-change"));
      onDecided(decision === "APPROVED"
        ? `Long stay is on for ${r.owner.name || "the owner"}.${data?.ownerTold === false ? " The owner SMS could not be sent; call them." : " The owner was told by SMS."}`
        : "Request declined. The partner was told why.");
    } catch (e: any) {
      setError(e?.response?.data?.error || "Could not save the decision.");
    } finally {
      setBusy("");
    }
  };

  return (
    <li className="border-0 border-t border-solid border-slate-100 first:border-t-0">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="flex w-full cursor-pointer items-center justify-between gap-4 border-0 bg-transparent px-4 py-3 text-left hover:bg-slate-50">
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-slate-900">{r.property.title || "Assisted listing"}</p>
          <p className="m-0 truncate text-xs text-slate-500">
            {r.owner.name || "Owner"} · by {r.partner.name || "partner"}{r.partner.code ? ` (${r.partner.code})` : ""} · {eat(r.createdAt)}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${status.tone}`}>{status.label}</span>
      </button>

      {expanded && (
        <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-4 py-4">
          <p className="m-0 text-sm text-slate-800">&ldquo;{r.reason}&rdquo;</p>
          {r.regionalRecommendation && (
            <p className="m-0 mt-2 inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
              <CheckCircle2 className="size-3.5" aria-hidden /> Recommended by the {r.regionalRecommendation.regionName} lead, {r.regionalRecommendation.leadName}
              {r.regionalRecommendation.note ? <span className="font-normal">: {r.regionalRecommendation.note}</span> : null}
            </p>
          )}
          <dl className="m-0 mt-3 grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <div className="flex items-start gap-2">
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
              <div><dt className="text-slate-500">Home</dt><dd className="m-0 text-slate-800">{[readable(r.property.type), r.property.area].filter(Boolean).join(", ") || "Not set yet"}</dd></div>
            </div>
            <div className="flex items-start gap-2">
              <UserRound className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
              <div>
                <dt className="text-slate-500">Owner</dt>
                <dd className="m-0 text-slate-800">
                  {r.owner.name || "Owner"}{r.owner.phone ? ` · ${r.owner.phone}` : ""}
                  {r.owner.newAccount ? (r.owner.phoneVerified ? " · has signed in" : " · new account, not signed in yet") : " · existing owner"}
                </dd>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
              <div>
                <dt className="text-slate-500">Checks</dt>
                <dd className="m-0 text-slate-800">{r.visitRecorded ? "Partner visit recorded" : "No partner visit recorded"} · listing {readable(r.listingStatus) || "unknown"}</dd>
              </div>
            </div>
            {r.decidedAt && (
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-slate-400" aria-hidden />
                <div>
                  <dt className="text-slate-500">Decision</dt>
                  <dd className="m-0 text-slate-800">{status.label} {eat(r.decidedAt)}{r.decidedBy ? ` by ${r.decidedBy}` : ""}{r.decisionNote ? `: ${r.decisionNote}` : ""}</dd>
                </div>
              </div>
            )}
          </dl>

          {r.status === "PENDING" && (
            <div className="mt-4">
              <p className="m-0 text-xs text-slate-600">Approving switches long stay on for this owner, for all their homes, and texts them. Call the owner first if anything looks off.</p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={300}
                rows={2}
                placeholder="Note to the partner (required to decline)"
                className="mt-2 w-full rounded-md border border-solid border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-[#02665e]"
              />
              {error && <p role="alert" className="m-0 mt-1 text-xs text-red-700">{error}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={Boolean(busy)} onClick={() => decide("APPROVED")} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-50">
                  {busy === "APPROVED" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CheckCircle2 className="size-4" aria-hidden />}
                  Approve and switch on
                </button>
                <button type="button" disabled={Boolean(busy) || note.trim().length < 10} onClick={() => decide("DECLINED")} className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                  {busy === "DECLINED" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <XCircle className="size-4" aria-hidden />}
                  Decline
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
