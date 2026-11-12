"use client";

/**
 * Agency Desk, admin: who holds the desk, the agency group stays that need an
 * admin (large-group shortlists to release, owner payouts and refunds to record
 * for groups the client prepaid in full), and every tour referral across
 * partners with blocked attempts first and a void action. Granting happens on
 * the partner record, never here.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Compass, Handshake, Loader2, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type Holder = {
  partnerId: number; agentCode: string; name: string | null; partnerStatus: string; region: string | null;
  capability: { status: string; stayRate: number; acceptedAt: string | null } | null;
  liveLinks: number; bookingsCredited: number; bookingsBlocked: number; earned: number;
  toursCredited?: number; toursBlocked?: number; tourEarned?: number;
};
type TourCredit = {
  bookingCode: string | null;
  partner: { agentCode: string; name: string | null };
  link: string | null;
  tour: {
    title: string; operator: string | null; destination: string | null; startDate: string | null; travelers: number; status: string; paymentStatus: string;
    total: number; nolsafCommission: number; currency: string;
  } | null;
  credit: "ACTIVE" | "BLOCKED" | "VOID";
  blockedReason: string | null;
  voidReason: string | null;
  commission: { status: string; amount: number; reason: string | null; paidAt: string | null } | null;
  creditedAt: string;
};
type TourFilter = "ALL" | "ACTIVE" | "BLOCKED" | "VOID";
type Group = {
  reference: string; groupStay: string; agentCode: string; shortlistStatus: string;
  shortlist: Array<{ property: string; ownerTotal: number | null; status: string | null }>;
  booking: {
    status: string; rooms: number; headcount: number; destination: string; total: number | null; currency: string; paid: boolean;
    checkedInAt: string | null; property: string | null; owner: string | null;
    ownerPayout: { amount: number | null; status: string; paidAt: string | null; ref: string | null };
    refund: { status: string; amount: number | null; retained: number | null; refundedAt: string | null; ref: string | null };
    nolsafShare: number;
  } | null;
};
type Tab = "groups" | "tours" | "holders";

const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-neutral-500";
const field = "h-9 min-w-0 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[13px] outline-none focus:border-emerald-400";
const btn = "inline-flex h-9 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[12px] font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";
const money = (v: number | null, c = "TZS") => (v == null ? "-" : `${c === "TZS" ? "TSh" : c} ${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`);
const eat = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "-");
const STATUS: Record<string, string> = { PENDING_ACCEPTANCE: "Waiting to accept", ACTIVE: "Live", SUSPENDED: "Paused", REVOKED: "Ended" };
const words = (v: string | null | undefined) => {
  const t = String(v || "").replace(/_/g, " ").toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "-";
};

export default function AdminSalesAgencyPage() {
  const [tab, setTab] = useState<Tab>("groups");
  const [holders, setHolders] = useState<Holder[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [inputs, setInputs] = useState<Record<string, { reason: string; transferRef: string; retain: string }>>({});
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [tours, setTours] = useState<TourCredit[]>([]);
  const [tourCounts, setTourCounts] = useState({ active: 0, blocked: 0, void: 0 });
  const [tourFilter, setTourFilter] = useState<TourFilter>("ALL");
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [h, g, t] = await Promise.all([
        apiClient.get("/api/admin/sales/agency/capabilities"),
        apiClient.get("/api/admin/sales/agency/groups"),
        apiClient.get("/api/admin/sales/agency/tours"),
      ]);
      setHolders(h.data?.items || []);
      setEnabled(Boolean(h.data?.enabled));
      setGroups(g.data?.items || []);
      setTours(t.data?.items || []);
      setTourCounts(t.data?.counts || { active: 0, blocked: 0, void: 0 });
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load the Agency Desk.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const value = (ref: string) => inputs[ref] || { reason: "", transferRef: "", retain: "0" };
  const set = (ref: string, patch: Partial<{ reason: string; transferRef: string; retain: string }>) => setInputs((s) => ({ ...s, [ref]: { ...value(ref), ...patch } }));

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (cause: any) {
      if (cause?.response?.data?.require2fa) {
        window.dispatchEvent(new CustomEvent("finance-grant-required"));
        setError("Finance verification is needed. Use Unlock finance at the top, then try again.");
      } else setError(cause?.response?.data?.error || "That did not work.");
    } finally {
      setBusy("");
    }
  };

  const reviewing = groups.filter((g) => g.shortlistStatus === "PENDING_REVIEW");
  const payoutsDue = groups.filter((g) => g.booking?.ownerPayout.status === "PENDING");
  const refundsDue = groups.filter((g) => g.booking?.refund.status === "DUE");

  return (
    <div className="space-y-4">
      <SalesAdminHeader<Tab>
        title="Agency Desk"
        description="Sales partners NoLSAF selected to bring guests and groups. Grant or end the desk from the partner record."
        metrics={[
          { label: "Desk holders", value: holders.filter((h) => h.capability?.status === "ACTIVE").length },
          { label: "Shortlists to review", value: reviewing.length, tone: reviewing.length ? "warn" : "muted" },
          { label: "Owner payouts due", value: payoutsDue.length, tone: payoutsDue.length ? "warn" : "muted" },
          { label: "Refunds due", value: refundsDue.length, tone: refundsDue.length ? "warn" : "muted" },
          { label: "Tours blocked", value: tourCounts.blocked, tone: tourCounts.blocked ? "warn" : "muted" },
          { label: "Switched on", value: enabled ? "Yes" : "No", tone: enabled ? "good" : "warn" },
        ]}
        onRefresh={() => void load()}
        loading={loading}
        tabs={[
          { key: "groups", label: "Group stays", Icon: Users },
          { key: "tours", label: "Tours", Icon: Compass },
          { key: "holders", label: "Desk holders", Icon: Handshake },
        ]}
        activeTab={tab}
        onTab={setTab}
      />

      {error ? <p className="m-0 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      {notice ? <p className="m-0 flex items-center gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="h-4 w-4" />{notice}</p> : null}

      {loading && !groups.length && !holders.length ? (
        <div className="grid min-h-40 place-items-center text-neutral-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : tab === "tours" ? (
        <div className="space-y-4">
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-neutral-200 bg-neutral-200 lg:grid-cols-4">
            {([
              { key: "ALL", label: "All tour credits", value: tourCounts.active + tourCounts.blocked + tourCounts.void, sub: "Across all partners", tone: "" },
              { key: "ACTIVE", label: "Credited", value: tourCounts.active, sub: "Earn after the tour completes", tone: tourCounts.active ? "text-emerald-700" : "" },
              { key: "BLOCKED", label: "Blocked", value: tourCounts.blocked, sub: "Partner as traveller or operator", tone: tourCounts.blocked ? "text-rose-700" : "" },
              { key: "VOID", label: "Voided by NoLSAF", value: tourCounts.void, sub: "Commission reversed", tone: "" },
            ] as const).map((t) => (
              <button key={t.key} type="button" onClick={() => setTourFilter(t.key)} aria-pressed={tourFilter === t.key}
                className={`border-0 px-4 py-3 text-left ${tourFilter === t.key ? "bg-emerald-50/60 ring-1 ring-inset ring-emerald-200" : "bg-white hover:bg-neutral-50"}`}>
                <p className="m-0 text-[12px] text-neutral-500">{t.label}</p>
                <p className={`m-0 mt-0.5 text-xl font-bold tabular-nums text-neutral-900 ${t.tone}`}>{t.value}</p>
                <p className="m-0 truncate text-[11px] text-neutral-500">{t.sub}</p>
              </button>
            ))}
          </section>
          <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px] border-collapse">
                <thead className="bg-neutral-50"><tr>{["Tour", "Partner", "Date and people", "Tour status", "Credit", "Partner earning", "Action"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
                <tbody>
                  {tours.filter((t) => tourFilter === "ALL" || t.credit === tourFilter).length ? tours.filter((t) => tourFilter === "ALL" || t.credit === tourFilter).map((t, i) => {
                    const key = t.bookingCode || `row-${i}`;
                    return (
                      <tr key={key} className={`border-0 border-t border-solid border-neutral-100 align-top text-[13px] ${t.credit === "BLOCKED" ? "bg-rose-50/40" : ""}`}>
                        <td className="px-3 py-2.5">
                          <p className="m-0 font-semibold text-neutral-900">{t.tour?.title || "Tour"}</p>
                          <p className="m-0 text-[11px] text-neutral-500">{[t.tour?.operator, t.tour?.destination].filter(Boolean).join(" · ") || "-"}</p>
                          {t.bookingCode ? <p className="m-0 font-mono text-[11px] text-neutral-400">{t.bookingCode}</p> : null}
                        </td>
                        <td className="px-3 py-2.5"><p className="m-0 text-neutral-800">{t.partner.name || t.partner.agentCode}</p><p className="m-0 font-mono text-[11px] text-neutral-500">{t.partner.agentCode}</p></td>
                        <td className="px-3 py-2.5">{eat(t.tour?.startDate ?? null)}<p className="m-0 text-[11px] text-neutral-500">{t.tour ? `${t.tour.travelers} ${t.tour.travelers === 1 ? "person" : "people"} · ${money(t.tour.total, t.tour.currency)}` : "-"}</p></td>
                        <td className="px-3 py-2.5">{t.tour ? words(t.tour.status) : "-"}<p className="m-0 text-[11px] text-neutral-500">{t.tour ? (t.tour.paymentStatus === "PAID" ? "Paid" : words(t.tour.paymentStatus)) : ""}</p></td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${t.credit === "ACTIVE" ? "bg-emerald-50 text-emerald-800" : t.credit === "BLOCKED" ? "bg-rose-50 text-rose-700" : "bg-neutral-100 text-neutral-600"}`}>{t.credit === "ACTIVE" ? "Credited" : words(t.credit)}</span>
                          {t.blockedReason ? <p className="m-0 mt-0.5 text-[11px] text-rose-700">{t.blockedReason}</p> : null}
                          {t.voidReason ? <p className="m-0 mt-0.5 text-[11px] text-neutral-500">{t.voidReason}</p> : null}
                        </td>
                        <td className="px-3 py-2.5">
                          {t.commission ? (
                            <><span className="font-semibold tabular-nums">{money(t.commission.amount)}</span><p className="m-0 text-[11px] text-neutral-500">{words(t.commission.status)}{t.commission.reason ? `: ${t.commission.reason}` : ""}</p></>
                          ) : <span className="text-[12px] text-neutral-400">{t.credit === "ACTIVE" ? "After completion" : "-"}</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          {t.credit !== "VOID" && t.bookingCode ? (
                            voiding === key ? (
                              <div className="flex min-w-[220px] flex-col gap-1.5">
                                <input className={field} placeholder="Reason (kept in the audit log)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
                                <div className="flex gap-1.5">
                                  <button type="button" className={`${btn} text-rose-700`} disabled={!!busy || voidReason.trim().length < 5}
                                    onClick={() => void run(`void-${key}`, async () => {
                                      await apiClient.post("/api/admin/sales/agency/tours/void", { bookingCode: t.bookingCode, reason: voidReason.trim() });
                                      setVoiding(null);
                                      setVoidReason("");
                                    }, "Tour credit voided. Any commission on it was reversed or will come off the next payout.")}>Void (finance code)</button>
                                  <button type="button" className={btn} onClick={() => { setVoiding(null); setVoidReason(""); }}>Back</button>
                                </div>
                              </div>
                            ) : (
                              <button type="button" className={btn} onClick={() => { setVoiding(key); setVoidReason(""); }}>Void credit</button>
                            )
                          ) : <span className="text-neutral-400">-</span>}
                        </td>
                      </tr>
                    );
                  }) : <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-neutral-500">{tours.length ? "No tours match this filter." : "No tour referrals yet."}</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : tab === "holders" ? (
        <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="bg-neutral-50"><tr>{["Partner", "Desk", "Rate", "Live links", "Stays credited", "Tours credited", "Blocked", "Earned"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {holders.length ? holders.map((h) => (
                  <tr key={h.agentCode} className="border-0 border-t border-solid border-neutral-100 text-[13px]">
                    <td className="px-3 py-2.5"><Link href={`/admin/sales/partners?q=${encodeURIComponent(h.agentCode)}`} className="font-semibold text-neutral-900 no-underline hover:underline">{h.name || h.agentCode}</Link><p className="m-0 font-mono text-[11px] text-neutral-500">{h.agentCode}</p></td>
                    <td className="px-3 py-2.5">{STATUS[h.capability?.status || ""] || "-"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{h.capability ? `${h.capability.stayRate}%` : "-"}</td>
                    <td className="px-3 py-2.5 tabular-nums">{h.liveLinks}</td>
                    <td className="px-3 py-2.5 tabular-nums">{h.bookingsCredited}</td>
                    <td className="px-3 py-2.5 tabular-nums">{h.toursCredited ?? 0}{h.tourEarned ? <p className="m-0 text-[11px] text-neutral-500">{money(h.tourEarned)}</p> : null}</td>
                    <td className={`px-3 py-2.5 tabular-nums ${h.bookingsBlocked + (h.toursBlocked ?? 0) ? "font-semibold text-rose-700" : ""}`}>{h.bookingsBlocked + (h.toursBlocked ?? 0)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{money(h.earned)}</td>
                  </tr>
                )) : <tr><td colSpan={8} className="px-3 py-8 text-center text-sm text-neutral-500">No partner holds the Agency Desk yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse">
              <thead className="bg-neutral-50"><tr>{["Group", "Partner", "Group size", "Shortlist", "Payment", "Owner payout", "Action"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>
                {groups.length ? groups.map((g) => {
                  const b = g.booking;
                  const v = value(g.reference);
                  return (
                    <tr key={g.reference} className="border-0 border-t border-solid border-neutral-100 align-top text-[13px]">
                      <td className="px-3 py-2.5"><p className="m-0 font-semibold text-neutral-900">{g.groupStay}</p><p className="m-0 text-[11px] text-neutral-500">{b?.destination || "-"}</p></td>
                      <td className="px-3 py-2.5 font-mono text-[12px]">{g.agentCode}</td>
                      <td className="px-3 py-2.5">{b ? `${b.headcount} people, ${b.rooms} rooms` : "-"}</td>
                      <td className="px-3 py-2.5">
                        {g.shortlist.length ? g.shortlist.map((s, i) => <p key={i} className="m-0">{s.property} <span className="text-neutral-500">{money(s.ownerTotal)}</span></p>) : <span className="text-neutral-400">None yet</span>}
                        {g.shortlistStatus === "PENDING_REVIEW" ? <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">Waiting for you</span> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {b?.paid ? `Paid ${money(b.total, b.currency)}` : "Not paid"}
                        {b?.checkedInAt ? <p className="m-0 text-[11px] text-neutral-500">Checked in {eat(b.checkedInAt)}</p> : null}
                        {b && ["CANCELED", "CANCELLED"].includes(b.status) ? <p className="m-0 text-[11px] font-semibold text-rose-700">Cancelled</p> : null}
                        {b?.refund.status === "DUE" ? <p className="m-0 text-[11px] font-semibold text-amber-800">Refund due {money(b.refund.amount, b.currency)}</p> : null}
                        {b?.refund.status === "REFUNDED" ? <p className="m-0 text-[11px] text-neutral-500">Refunded {money(b.refund.amount, b.currency)} {eat(b.refund.refundedAt)}{b.refund.ref ? ` · ${b.refund.ref}` : ""}</p> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        {b?.ownerPayout.status === "PAID" ? <span>Paid {eat(b.ownerPayout.paidAt)}<p className="m-0 text-[11px] text-neutral-500">{b.ownerPayout.ref}</p></span>
                          : b?.ownerPayout.status === "PENDING" ? <span className="font-semibold text-amber-800">{money(b.ownerPayout.amount, b.currency)} due to {b.owner || "owner"}</span>
                          : <span className="text-neutral-400">After check-in</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {cancelling === g.reference && b ? (
                          <div className="flex min-w-[260px] flex-col gap-1.5">
                            <p className="m-0 text-[12px] text-neutral-600">
                              {b.paid
                                ? `The guest paid ${money(b.total, b.currency)}. The owner's share always goes back. NoLSAF may keep up to ${money(b.nolsafShare, b.currency)}.`
                                : "Not paid: cancelling records no refund."}
                            </p>
                            {b.paid ? <input className={field} inputMode="numeric" placeholder="NoLSAF keeps (TSh)" value={v.retain} onChange={(e) => set(g.reference, { retain: e.target.value.replace(/\D/g, "") })} /> : null}
                            <input className={field} placeholder="Reason (kept in the audit log)" value={v.reason} onChange={(e) => set(g.reference, { reason: e.target.value })} />
                            <div className="flex flex-wrap gap-1.5">
                              <button type="button" className={`${btn} text-rose-700`} disabled={!!busy || v.reason.trim().length < 5}
                                onClick={() => void run(`${g.reference}-c`, async () => {
                                  await apiClient.post(`/api/admin/sales/agency/groups/${g.reference}/cancel`, { reason: v.reason.trim(), retainAmount: Number(v.retain || 0) });
                                  setCancelling(null);
                                }, "Group cancelled. Any refund is now due.")}>Cancel group (finance code)</button>
                              <button type="button" className={btn} onClick={() => setCancelling(null)}>Back</button>
                            </div>
                          </div>
                        ) : b?.refund.status === "DUE" ? (
                          <div className="flex min-w-[260px] flex-col gap-1.5">
                            <input className={field} placeholder="Refund transfer reference" value={v.transferRef} onChange={(e) => set(g.reference, { transferRef: e.target.value })} />
                            <input className={field} placeholder="Reason (kept in the audit log)" value={v.reason} onChange={(e) => set(g.reference, { reason: e.target.value })} />
                            <button type="button" className={btn} disabled={!!busy || v.reason.trim().length < 5 || v.transferRef.trim().length < 3}
                              onClick={() => void run(`${g.reference}-f`, () => apiClient.post(`/api/admin/sales/agency/groups/${g.reference}/refund`, { transferRef: v.transferRef.trim(), reason: v.reason.trim() }), "Refund recorded.")}>Record refund {money(b.refund.amount, b.currency)} (finance code)</button>
                          </div>
                        ) : g.shortlistStatus === "PENDING_REVIEW" || b?.ownerPayout.status === "PENDING" ? (
                          <div className="flex min-w-[260px] flex-col gap-1.5">
                            {b?.ownerPayout.status === "PENDING" ? <input className={field} placeholder="Transfer reference" value={v.transferRef} onChange={(e) => set(g.reference, { transferRef: e.target.value })} /> : null}
                            <input className={field} placeholder="Reason (kept in the audit log)" value={v.reason} onChange={(e) => set(g.reference, { reason: e.target.value })} />
                            <div className="flex flex-wrap gap-1.5">
                              {g.shortlistStatus === "PENDING_REVIEW" ? (
                                <>
                                  <button type="button" className={btn} disabled={!!busy || v.reason.trim().length < 5} onClick={() => void run(`${g.reference}-r`, () => apiClient.post(`/api/admin/sales/agency/groups/${g.reference}/shortlist`, { decision: "RELEASE", reason: v.reason.trim() }), "Shortlist released to the client.")}>Release to client</button>
                                  <button type="button" className={btn} disabled={!!busy || v.reason.trim().length < 5} onClick={() => void run(`${g.reference}-x`, () => apiClient.post(`/api/admin/sales/agency/groups/${g.reference}/shortlist`, { decision: "RETURN", reason: v.reason.trim() }), "Shortlist returned to the partner.")}>Return</button>
                                </>
                              ) : null}
                              {b?.ownerPayout.status === "PENDING" ? (
                                <button type="button" className={btn} disabled={!!busy || v.reason.trim().length < 5 || v.transferRef.trim().length < 3} onClick={() => void run(`${g.reference}-p`, () => apiClient.post(`/api/admin/sales/agency/groups/${g.reference}/owner-payout`, { transferRef: v.transferRef.trim(), reason: v.reason.trim() }), "Owner payout recorded.")}>Record payout (finance code)</button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                        {cancelling !== g.reference && b && !["CANCELED", "CANCELLED"].includes(b.status) && !b.checkedInAt && b.ownerPayout.status !== "PAID" ? (
                          <button type="button" className={`${btn} mt-1.5 text-rose-700`} onClick={() => setCancelling(g.reference)}>Cancel group</button>
                        ) : null}
                      </td>
                    </tr>
                  );
                }) : <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-neutral-500">No agency group stays yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
