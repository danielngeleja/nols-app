"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, BadgeCheck, CircleAlert, Send, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { tsh } from "./eventHireTypes";
import { errorText, label, needsFinanceGrant, useWorkspaceRefresh } from "./admin/eventAdmin";
import { BookingDrawer } from "./admin/AdminEventBookings";
import { Chips, Empty, ErrorNote, FinanceLocked, Loading, Panel, Pill, btn } from "./admin/ui";

type Transfer = {
  reference: string; sourceId: number; kind: string; amount: number; status: string;
  payeeName: string; verifiedDestinationOnFile: boolean;
  booking: { reference: string; venueTitle: string; status: string };
  disbursement: { id: number; status: string; externalReferenceId: string } | null;
};
type View = "" | "REVIEW" | "APPROVED" | "PAID";
const PURPOSE: Record<string, string> = { OWNER_PAYOUT: "Owner earnings", DAMAGE_AWARD: "Damage award to owner", DEPOSIT_REFUND: "Deposit back to client", CANCELLATION_REFUND: "Cancellation refund to client" };
const purpose = (kind: string) => kind.startsWith("EXTRA_REFUND_") ? "Additional payment refund" : PURPOSE[kind] || label(kind);

export default function AdminEventSettlements() {
  return <Suspense fallback={<Loading />}><Settlements /></Suspense>;
}

function Settlements() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get("view") as View | null;
  const [status, setStatus] = useState<View>(fromUrl && ["REVIEW", "APPROVED", "PAID"].includes(fromUrl) ? fromUrl : "");
  const [rows, setRows] = useState<Transfer[]>([]);
  const [page, setPage] = useState(1), [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [locked, setLocked] = useState(false);
  const [openRef, setOpenRef] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const r = await apiClient.get("/api/admin/event-hire/operations/settlements", { params: { page, ...(status ? { status } : {}) } });
      setRows(r.data.transfers); setHasMore(r.data.hasMore); setLocked(false);
    } catch (e) {
      setRows([]);
      if (needsFinanceGrant(e)) setLocked(true);
      else setError(errorText(e, "Could not load payouts and refunds."));
    } finally { setLoading(false); }
  }, [page, status]);
  useEffect(() => { void load(); }, [load]);
  useWorkspaceRefresh(useCallback(() => { void load(); }, [load]), true);

  const pick = (v: View) => { setStatus(v); setPage(1); router.replace(v ? `${pathname}?view=${v}` : pathname, { scroll: false }); };
  const pageTotal = rows.reduce((n, t) => n + t.amount, 0);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          { Icon: BadgeCheck, t: "1. Approve the entitlement", d: "Open the booking, check evidence and approve. Nothing moves yet." },
          { Icon: Send, t: "2. Release through finance", d: "Approved items go to Disbursements, rechecked against the verified destination." },
          { Icon: ShieldCheck, t: "3. Provider confirms", d: "Marked paid only when the payout provider confirms the transfer." },
        ].map(s => (
          <div key={s.t} className="flex min-w-0 items-start gap-3 rounded-lg border border-solid border-neutral-200 bg-white px-4 py-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-[#02665e]/[0.07] text-[#02665e]"><s.Icon className="h-4 w-4" /></span>
            <span className="min-w-0"><strong className="block text-[13px] font-semibold text-neutral-900">{s.t}</strong><span className="block text-[12px] leading-5 text-neutral-500">{s.d}</span></span>
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <Chips label="Entitlement status" value={status} onChange={pick} items={[
          { key: "", label: "All" },
          { key: "REVIEW", label: "To approve" },
          { key: "APPROVED", label: "Ready to release" },
          { key: "PAID", label: "Paid" },
        ]} />
        <Link className={btn} href="/admin/disbursements?source=EVENT_HIRE">Open Disbursements<ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Panel flush>
        {locked ? <FinanceLocked what="The payout and refund queue" /> : loading ? <Loading>Loading payouts and refunds</Loading> : rows.length === 0 ? (
          <Empty icon={<Send className="h-5 w-5" />} title={status === "REVIEW" ? "Nothing to approve" : status === "APPROVED" ? "Nothing waiting for release" : "No payouts or refunds yet"}>Entitlements are prepared after an event is completed, the claim window has passed and any review is resolved.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
              <thead><tr className="bg-neutral-50 text-[11px] font-semibold text-neutral-500">
                <th className="px-4 py-2.5 font-semibold">Event and purpose</th><th className="px-4 py-2.5 font-semibold">Recipient</th>
                <th className="px-4 py-2.5 text-right font-semibold">Amount</th><th className="px-4 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 font-semibold">Disbursement</th><th className="px-4 py-2.5 font-semibold">Next step</th>
              </tr></thead>
              <tbody>{rows.map(t => (
                <tr key={t.reference} className="border-0 border-t border-solid border-neutral-100 align-middle">
                  <td className="max-w-[240px] px-4 py-3"><p className="m-0 truncate font-semibold text-neutral-900">{t.booking.venueTitle}</p><p className="m-0 text-[12px] text-neutral-500">{purpose(t.kind)}</p></td>
                  <td className="px-4 py-3"><p className="m-0 text-neutral-800">{t.payeeName}</p><p className={`m-0 flex items-center gap-1 text-[11px] ${t.verifiedDestinationOnFile ? "text-emerald-700" : "text-amber-700"}`}>{t.verifiedDestinationOnFile ? <ShieldCheck className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}{t.verifiedDestinationOnFile ? "Verified destination on file" : "No verified destination yet"}</p></td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-neutral-900">{tsh(t.amount)}</td>
                  <td className="px-4 py-3"><Pill status={t.status}>{t.status === "REVIEW" ? "To approve" : t.status === "APPROVED" ? "Ready to release" : label(t.status)}</Pill></td>
                  <td className="px-4 py-3">{t.disbursement ? <><p className="m-0 text-[12px] font-semibold text-neutral-800">{label(t.disbursement.status)}</p><p className="m-0 font-mono text-[11px] text-neutral-400">{t.disbursement.externalReferenceId}</p></> : <span className="text-[12px] text-neutral-400">Not requested</span>}</td>
                  <td className="px-4 py-3">
                    {t.status === "REVIEW" ? <button type="button" onClick={() => setOpenRef(t.booking.reference)} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-[#02665e] hover:underline">Review and approve<ArrowRight className="h-3 w-3" /></button>
                      : t.status === "APPROVED" && !t.disbursement ? <Link className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#02665e] no-underline hover:underline" href={`/admin/disbursements?sourceType=EVENT_HIRE&sourceId=${t.sourceId}`}>Prepare disbursement<ArrowRight className="h-3 w-3" /></Link>
                      : <button type="button" onClick={() => setOpenRef(t.booking.reference)} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-neutral-600 hover:text-[#02665e] hover:underline">Open booking<ArrowRight className="h-3 w-3" /></button>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {!locked && (rows.length > 0 || page > 1) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-3">
            <span className="text-[12px] text-neutral-500">Page {page} · {tsh(pageTotal)} on this page</span>
            <span className="flex gap-2">
              <button type="button" className={btn} disabled={page === 1 || loading} onClick={() => setPage(p => p - 1)}>Previous</button>
              <button type="button" className={btn} disabled={!hasMore || loading} onClick={() => setPage(p => p + 1)}>Next</button>
            </span>
          </div>
        )}
      </Panel>

      {openRef && <BookingDrawer key={openRef} reference={openRef} onClose={() => setOpenRef(null)} />}
    </div>
  );
}
