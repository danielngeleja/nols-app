"use client";

/**
 * Assisted listings: properties sales partners listed for owners
 * (docs/SALES_ASSISTED_LISTING.md). Owner queries come first: each one has
 * paused its listing until an admin calls the owner and resumes or cancels it.
 * Approval of the listing itself happens in Properties as usual; attribution in
 * Conversion review.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Building2, CheckCircle2, Clock3, Loader2, PauseCircle, Send, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type Status = "DRAFTING" | "SUBMITTED" | "RETURNED" | "APPROVED" | "PAUSED_OBJECTION" | "CANCELLED";
type Row = {
  id: number;
  status: Status;
  ownerAccount: "CREATED" | "ATTACHED_EXISTING";
  ownerName: string | null;
  ownerPhone: string;
  ownerEngaged: boolean;
  property: { title: string; status: string; regionName: string | null; district: string | null } | null;
  partner: { id: number; code: string; name: string | null };
  visit: { capturedAt: string; distanceMeters: number | null; status: string } | null;
  noticeSentAt: string | null;
  liveNoticeSentAt: string | null;
  objectedAt: string | null;
  objectionNote: string | null;
  statusBeforeObjection: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  cancelReason: string | null;
  updatedAt: string;
};
type Tab = "QUERIES" | "REVIEW" | "OPEN" | "LIVE" | "CLOSED";

const TAB_STATUS: Record<Tab, Status> = {
  QUERIES: "PAUSED_OBJECTION",
  REVIEW: "SUBMITTED",
  OPEN: "DRAFTING",
  LIVE: "APPROVED",
  CLOSED: "CANCELLED",
};
const STATUS_TONE: Record<Status, string> = {
  DRAFTING: "bg-sky-50 text-sky-800",
  SUBMITTED: "bg-amber-50 text-amber-800",
  RETURNED: "bg-orange-50 text-orange-800",
  APPROVED: "bg-emerald-50 text-emerald-800",
  PAUSED_OBJECTION: "bg-rose-50 text-rose-700",
  CANCELLED: "bg-neutral-100 text-neutral-600",
};
const STATUS_TEXT: Record<Status, string> = {
  DRAFTING: "Partner listing",
  SUBMITTED: "In property review",
  RETURNED: "Returned to partner",
  APPROVED: "Live",
  PAUSED_OBJECTION: "Owner query",
  CANCELLED: "Cancelled",
};
const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-500";

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

export default function AdminAssistedListingsPage() {
  const [tab, setTab] = useState<Tab>("QUERIES");
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState<Partial<Record<Status, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get("/api/admin/sales/assisted-listings", { params: { status: TAB_STATUS[tab], pageSize: 100 } });
      setRows(data?.listings ?? []);
      setCounts(data?.counts ?? {});
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load assisted listings");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => { void load(); }, [load]);

  const act = async (row: Row, kind: "RESUME" | "CANCEL" | "WITHDRAW") => {
    const why = (reason[row.id] || "").trim();
    if (why.length < 5) {
      setError("Write a reason of at least 5 characters first (what the owner said, or why).");
      return;
    }
    setBusy(`${kind}-${row.id}`);
    setError("");
    setNotice("");
    try {
      if (kind === "WITHDRAW") {
        await apiClient.post(`/api/admin/sales/assisted-listings/${row.id}/cancel`, { reason: why });
        setNotice(`"${row.property?.title || "Listing"}" withdrawn.`);
      } else {
        const { data } = await apiClient.post(`/api/admin/sales/assisted-listings/${row.id}/resolve`, { outcome: kind, reason: why });
        setNotice(kind === "RESUME"
          ? `"${row.property?.title || "Listing"}" resumed.`
          : `"${row.property?.title || "Listing"}" cancelled.${data?.partnerPaused ? ` ${row.partner.code} can no longer list for owners until you clear the pause.` : ""}`);
      }
      setReason((current) => ({ ...current, [row.id]: "" }));
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "That did not work. Reload and try again.");
    } finally {
      setBusy(null);
    }
  };

  const queries = counts.PAUSED_OBJECTION ?? 0;
  return (
    <div id="admin-assisted-listings" className="space-y-4">
      <style>{`#admin-assisted-listings, #admin-assisted-listings * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader
        title="Assisted listings"
        description="Properties sales partners listed for owners. The owner only receives SMS updates and sets their own payout details. Approve the listing in Properties and the attribution in Conversion review."
        metrics={[
          { label: "Owner queries", value: queries, tone: queries ? "warn" : "muted" },
          { label: "In review", value: counts.SUBMITTED ?? 0 },
          { label: "Being listed", value: (counts.DRAFTING ?? 0) + (counts.RETURNED ?? 0) },
          { label: "Live", value: counts.APPROVED ?? 0, tone: "good" },
        ]}
        onRefresh={() => void load()}
        loading={loading}
        tabs={[
          { key: "QUERIES", label: "Owner queries", Icon: PauseCircle, count: queries },
          { key: "REVIEW", label: "In review", Icon: Clock3, count: counts.SUBMITTED ?? 0 },
          { key: "OPEN", label: "Being listed", Icon: Building2, count: counts.DRAFTING ?? 0 },
          { key: "LIVE", label: "Live", Icon: CheckCircle2, count: counts.APPROVED ?? 0 },
          { key: "CLOSED", label: "Cancelled", Icon: XCircle, count: counts.CANCELLED ?? 0 },
        ]}
        activeTab={tab}
        onTab={setTab}
      />

      {error ? (
        <p className="m-0 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}
        </p>
      ) : null}
      {notice ? (
        <p className="m-0 flex items-start gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        {loading ? (
          <div className="grid min-h-40 place-items-center text-neutral-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <p className="m-0 px-5 py-10 text-center text-sm text-neutral-500">Nothing here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead className="bg-neutral-50">
                <tr>
                  <th className={th}>Property</th>
                  <th className={th}>Owner</th>
                  <th className={th}>Partner</th>
                  <th className={th}>Evidence</th>
                  <th className={th}>Status</th>
                  <th className={th}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-0 border-t border-solid border-neutral-100 align-top">
                    <td className="px-3 py-3">
                      <p className="m-0 font-semibold text-neutral-900">{row.property?.title || "Untitled"}</p>
                      <p className="m-0 text-xs text-neutral-500">{[row.property?.district, row.property?.regionName].filter(Boolean).join(", ") || "Location not set"}</p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="m-0 text-neutral-800">{row.ownerName || "Owner"}</p>
                      <p className="m-0 text-xs text-neutral-500">{row.ownerPhone}</p>
                      <p className="m-0 text-xs text-neutral-500">
                        {row.ownerAccount === "CREATED" ? "New account" : "Existing owner"}, {row.ownerEngaged ? "has signed in" : "not signed in yet"}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <p className="m-0 font-mono text-xs text-neutral-800">{row.partner.code}</p>
                      <p className="m-0 text-xs text-neutral-500">{row.partner.name || ""}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-neutral-600">
                      <p className="m-0">Visit {row.visit ? eat(row.visit.capturedAt) : "missing"}{row.visit?.distanceMeters != null ? `, ${row.visit.distanceMeters} m from reference` : ""}</p>
                      <p className="m-0">SMS 1 {row.noticeSentAt ? eat(row.noticeSentAt) : "not sent"}</p>
                      {row.liveNoticeSentAt ? <p className="m-0">Live SMS {eat(row.liveNoticeSentAt)}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONE[row.status]}`}>{STATUS_TEXT[row.status]}</span>
                      {row.status === "PAUSED_OBJECTION" ? (
                        <p className="m-0 mt-1 text-xs text-rose-700">
                          Queried {eat(row.objectedAt)}{row.statusBeforeObjection ? ` (was ${STATUS_TEXT[row.statusBeforeObjection as Status]?.toLowerCase() || row.statusBeforeObjection})` : ""}
                          {row.objectionNote ? `: "${row.objectionNote}"` : ""}
                        </p>
                      ) : null}
                      {row.cancelReason ? <p className="m-0 mt-1 text-xs text-neutral-500">{row.cancelReason}</p> : null}
                    </td>
                    <td className="px-3 py-3">
                      {row.status === "CANCELLED" ? null : (
                        <div className="w-60 space-y-2">
                          <input
                            value={reason[row.id] || ""}
                            onChange={(event) => setReason((current) => ({ ...current, [row.id]: event.target.value }))}
                            placeholder={row.status === "PAUSED_OBJECTION" ? "What the owner said" : "Reason"}
                            maxLength={300}
                            className="h-9 w-full rounded-lg border border-solid border-neutral-300 px-2.5 text-xs outline-none focus:border-[#02665e]"
                          />
                          {row.status === "PAUSED_OBJECTION" ? (
                            <div className="grid grid-cols-2 gap-1.5">
                              <button type="button" disabled={busy !== null} onClick={() => void act(row, "RESUME")} className="h-9 rounded-lg border border-solid border-emerald-300 bg-emerald-50 text-xs font-semibold text-emerald-800 disabled:opacity-50">
                                Owner agreed, resume
                              </button>
                              <button type="button" disabled={busy !== null} onClick={() => void act(row, "CANCEL")} className="h-9 rounded-lg border border-solid border-rose-300 bg-rose-50 text-xs font-semibold text-rose-700 disabled:opacity-50">
                                Cancel listing
                              </button>
                            </div>
                          ) : (
                            <button type="button" disabled={busy !== null} onClick={() => void act(row, "WITHDRAW")} className="h-9 w-full rounded-lg border border-solid border-neutral-300 bg-white text-xs font-semibold text-neutral-700 disabled:opacity-50">
                              Withdraw listing
                            </button>
                          )}
                          {row.status === "SUBMITTED" ? (
                            <Link href="/admin/properties" className="inline-flex items-center gap-1 text-xs font-semibold text-[#02665e] no-underline">
                              <Send className="h-3.5 w-3.5" /> Review in Properties
                            </Link>
                          ) : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
