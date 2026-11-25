"use client";

/**
 * Long-stay tenancies for admins (docs/LONG_STAY_RENTALS.md, milestone 7):
 * landlord payouts to approve, problems to decide, refunds owed, move-ins.
 * Every action is checked and audited on the server; TZS payouts continue in
 * Disbursements, USD payouts are paid by bank and recorded here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import AdminNotificationTarget from "@/components/longStay/AdminNotificationTarget";
import Link from "next/link";
import { AlertTriangle, ArrowUpRight, CalendarDays, CalendarX2, CheckCircle2, HandCoins, History, Home, Inbox, KeyRound, List, Loader2, Phone, RefreshCw, ShieldCheck, Undo2, Users, Wallet, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

type View = "payouts" | "disputes" | "refunds" | "movein" | "ending" | "claims" | "all";
type Item = {
  ref: string;
  status: string;
  payoutStatus: string;
  home: string | null;
  landlord: { name: string | null; phone: string | null };
  tenant: { name: string | null; phone: string | null };
  currency: string;
  moveInDate: string | null;
  termMonths: number | null;
  paidAmount: number | null;
  balanceDue: number | null;
  landlordBalanceAmount: number | null;
  tenantBalanceAmount: number | null;
  balanceMismatch: boolean;
  moveInConfirmedBy: string | null;
  landlordPayout: number;
  payoutReleasedAt: string | null;
  disputedAt: string | null;
  area?: string;
  endDate?: string | null;
  monthlyRent?: number | null;
  upfrontMonths?: number | null;
  bookingAmount?: number | null;
  tenantFee?: number | null;
  landlordCommission?: number | null;
  payoutDeduction?: number | null;
  timeline?: Partial<Record<"offeredAt" | "offerAcceptedAt" | "landlordLeaseAcceptedAt" | "tenantLeaseAcceptedAt" | "paymentDueAt" | "paidAt" | "landlordConfirmedAt" | "tenantConfirmedAt" | "moveInConfirmedAt" | "noticeGivenAt" | "endedAt" | "cancelledAt", string | null>>;
  leaseVersion?: string | null;
  leaseFingerprint?: string | null;
  moveIn?: { landlordMethod: string | null; tenantMethod: string | null; keysReceived: boolean | null; matchesListing: boolean | null };
  cancel?: { by: string | null; reason: string | null } | null;
  tenantId?: { status: string; idType: string; expiresOn: string | null } | null;
};

/** The journey every tenancy follows; the card shows where this one is. */
const JOURNEY: Array<{ key: string; label: string; at: (i: Item) => string | null | undefined }> = [
  { key: "reserved", label: "Reserved", at: (i) => i.timeline?.offeredAt },
  { key: "confirmed", label: "Landlord confirmed", at: (i) => i.timeline?.offerAcceptedAt },
  { key: "lease", label: "Lease signed", at: (i) => (i.timeline?.landlordLeaseAcceptedAt && i.timeline?.tenantLeaseAcceptedAt ? [i.timeline.landlordLeaseAcceptedAt, i.timeline.tenantLeaseAcceptedAt].sort()[1] : null) },
  { key: "paid", label: "First month paid", at: (i) => i.timeline?.paidAt },
  { key: "movein", label: "Moved in", at: (i) => i.timeline?.moveInConfirmedAt },
  { key: "payout", label: "Landlord paid", at: (i) => i.payoutReleasedAt },
  { key: "ended", label: "Ended", at: (i) => i.timeline?.endedAt },
];

function softenCaps(value: string | null | undefined) {
  const s = String(value || "").trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bNolsaf\b/g, "NoLSAF");
}

function whenEat(iso: string | null | undefined) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : null;
}

function daysFromToday(isoDay: string | null | undefined) {
  if (!isoDay) return null;
  const today = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Dar_es_Salaam" }) + "T00:00:00Z").getTime();
  return Math.round((new Date(`${isoDay.slice(0, 10)}T00:00:00Z`).getTime() - today) / 86_400_000);
}

function Journey({ item }: { item: Item }) {
  const cancelled = item.status === "CANCELLED";
  const steps = JOURNEY.map((s) => ({ ...s, when: s.at(item) || null }));
  const reached = steps.reduce((last, s, idx) => (s.when ? idx : last), -1);
  return (
    <div className="border-0 border-b border-solid border-slate-100 px-4 py-3.5 sm:px-5">
      <ol className="m-0 grid list-none grid-cols-2 gap-x-2 gap-y-3 p-0 sm:grid-cols-4 lg:grid-cols-7">
        {steps.map((s, idx) => {
          const done = Boolean(s.when);
          const current = !cancelled && !done && idx === reached + 1;
          return (
            <li key={s.key} className="relative min-w-0">
              <div className="flex items-center gap-2">
                <span className={`grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${done ? "bg-[#02665e] text-white" : current ? "border-2 border-solid border-[#02665e] bg-white text-[#02665e]" : "bg-slate-100 text-slate-400"}`}>{idx + 1}</span>
                <span className={`truncate text-[12px] font-semibold ${done ? "text-slate-900" : current ? "text-[#02665e]" : "text-slate-400"}`}>{s.label}</span>
              </div>
              <p className="m-0 mt-0.5 truncate pl-7 text-[11px] text-slate-500">{done ? whenEat(s.when) : current ? "Next" : ""}</p>
            </li>
          );
        })}
      </ol>
      {cancelled ? (
        <p className="m-0 mt-3 rounded-md bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800">
          Cancelled{item.cancel?.by ? ` by the ${item.cancel.by.toLowerCase()}` : ""}{item.timeline?.cancelledAt ? `, ${whenEat(item.timeline.cancelledAt)}` : ""}{item.cancel?.reason ? `: ${item.cancel.reason}` : ""}
        </p>
      ) : null}
    </div>
  );
}

const TABS: Array<{ key: View; label: string; Icon: typeof Wallet }> = [
  { key: "payouts", label: "Payouts", Icon: Wallet },
  { key: "disputes", label: "Problems", Icon: AlertTriangle },
  { key: "refunds", label: "Refunds owed", Icon: Undo2 },
  { key: "movein", label: "Moving in", Icon: KeyRound },
  { key: "ending", label: "Ending", Icon: CalendarX2 },
  { key: "claims", label: "Claims", Icon: HandCoins },
  { key: "all", label: "All", Icon: List },
];
const PAYOUT_LABEL: Record<string, string> = { NONE: "Not paid", HELD: "Held", READY: "Ready to approve", REVIEW: "Needs review", APPROVED: "In Disbursements", RELEASED: "Sent", REFUND_DUE: "Refund owed", REFUNDED: "Refunded" };
const STAY_LABEL: Record<string, string> = { OFFERED: "Awaiting landlord", ACCEPTED: "Lease to sign", AWAITING_PAYMENT: "Awaiting payment", RESERVED: "Reserved", MOVE_IN: "Moving in", ACTIVE: "Active", ENDING: "Ending", ENDED: "Ended", CANCELLED: "Cancelled", DISPUTED: "Problem reported", OVERDUE: "Overdue" };
const EVENT_TITLE: Record<string, string> = { RESERVATION_REQUESTED: "Reservation requested", ACCEPTED: "Landlord confirmed", LEASE_ACCEPTED: "Lease signed", AWAITING_PAYMENT: "Both signatures received", RESERVED: "Card payment received", MOVE_IN: "Move-in opened", ACTIVE: "Move-in confirmed", PAYOUT_PAID: "Payout sent", PAYOUT_RECORDED: "Bank payout recorded" };

function PayoutStatus({ status }: { status: string }) {
  const tone = status === "REVIEW" || status === "REFUND_DUE" ? "bg-amber-50 text-amber-900"
    : status === "RELEASED" ? "bg-emerald-50 text-emerald-800" : status === "NONE" ? "bg-slate-100 text-slate-700" : "bg-sky-50 text-sky-900";
  return <span className={`inline-flex w-fit rounded-md px-2 py-1 text-xs font-semibold ${tone}`}>{PAYOUT_LABEL[status] ?? status}</span>;
}

function money(value: number | null | undefined, currency: string) {
  return value == null ? "-" : `${currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}
function day(iso: string | null) {
  return iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "-";
}

const EMPTY: Record<View, { title: string; text: string }> = {
  payouts: { title: "No payouts waiting", text: "A landlord's first month shows here once the tenant has moved in." },
  disputes: { title: "No problems reported", text: "When a tenant or landlord reports a problem, the money is held here for your decision." },
  refunds: { title: "No refunds owed", text: "Cancelled bookings that owe the tenant money show here until you pay them back." },
  movein: { title: "Nobody moving in", text: "Paid bookings waiting for move-in day and both confirmations." },
  ending: { title: "No stays ending", text: "Stays with notice given or past their end date show here." },
  claims: { title: "No open claims", text: "Money a landlord owes a tenant under the lease." },
  all: { title: "No long stays yet", text: "Every reservation and tenancy shows here once tenants reserve." },
};

export default function LongStayTenanciesPage() {
  const params = useSearchParams();
  const requestedView = params?.get("view");
  const initialView = TABS.find((tab) => tab.key === requestedView)?.key ?? "payouts";
  const target = params?.get("ref");
  const claim = initialView === "claims" ? params?.get("claim") : null;
  return <TenancyQueue key={`${initialView}:${target ?? ""}:${claim ?? ""}`} initialView={initialView} target={target} claim={claim} />;
}

function TenancyQueue({ initialView, target, claim }: { initialView: View; target: string | null | undefined; claim: string | null | undefined }) {
  const [view, setView] = useState<View>(initialView);
  const [items, setItems] = useState<Item[] | null>(null);
  const [counts, setCounts] = useState<Partial<Record<View, number>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Claims have their own list; the tenancy call still refreshes the counts.
      const response = await apiClient.get<{ items: Item[]; counts: Partial<Record<View, number>> }>("/api/admin/long-stay/tenancies", { params: { view: view === "claims" ? "payouts" : view, ref: target } });
      setCounts(response.data.counts ?? {});
      setItems(view === "claims" ? [] : response.data.items);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load tenancies.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [view, target]);
  useEffect(() => { setItems(null); setSelected(null); void load(); }, [load]);
  const refreshCase = () => {
    window.dispatchEvent(new Event("nols:admin-long-stay-queue-change"));
    return load();
  };
  const refreshSelected = async (ref: string) => {
    await Promise.all([
      refreshCase(),
      apiClient.get<{ items: Item[] }>("/api/admin/long-stay/tenancies", { params: { view: "all", ref } })
        .then(({ data }) => setSelected((current) => current?.ref === ref ? data.items[0] ?? null : current))
        .catch(() => setSelected((current) => current?.ref === ref ? null : current)),
    ]);
  };

  const attention = (counts.payouts ?? 0) + (counts.disputes ?? 0) + (counts.refunds ?? 0);
  return (
    <div id="ls-tenancies" className="w-full min-w-0 space-y-4">
      <style>{`#ls-tenancies, #ls-tenancies * { box-sizing: border-box; }`}</style>

      {/* Tenancy desk, in the No4P Agents style */}
      <section className="relative overflow-hidden rounded-lg bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
        <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">
              <Home className="h-3.5 w-3.5" /> Long stays
              <span className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-[10px] font-medium normal-case tracking-normal ${attention ? "bg-amber-400/15 text-amber-200" : "bg-emerald-400/15 text-emerald-200"}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${attention ? "bg-amber-400" : "bg-emerald-400"}`} />{counts.payouts == null ? "Loading" : attention ? `${attention} ${attention === 1 ? "needs" : "need"} you` : "Nothing waiting"}
              </span>
            </p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Tenancies</h1>
            <p className="m-0 mt-1 max-w-xl text-sm text-white/60">Approve payouts after move-in, decide problems, refund what tenants are owed, and follow every stay to its end.</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/admin/long-stay/payments" className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-white/15 bg-white/[0.06] px-3 text-[12.5px] font-semibold text-white no-underline hover:bg-white/[0.12]"><Wallet className="h-3.5 w-3.5" />Payments</Link>
            <button type="button" onClick={() => void load()} disabled={loading} aria-label="Refresh" title="Refresh"
              className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-solid border-white/15 bg-white/[0.06] text-white hover:bg-white/[0.12] disabled:opacity-60">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {(target || claim) ? (
        <AdminNotificationTarget href={`/admin/long-stay/tenancies?view=${view}`}>{claim ? "Claim from Notifications" : "Tenancy from Notifications"}</AdminNotificationTarget>
      ) : (
        /* Queue track: pick what to work on; the urgent ones say so */
        <section className="rounded-lg border border-solid border-neutral-200 bg-white p-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
            {TABS.map((t) => {
              const on = view === t.key;
              const value = t.key === "all" ? null : counts[t.key];
              const urgent = (t.key === "payouts" || t.key === "disputes" || t.key === "refunds" || t.key === "claims") && (value ?? 0) > 0;
              const hint: Record<View, string> = {
                payouts: "First month to approve",
                disputes: "Money held for a decision",
                refunds: "Owed back to tenants",
                movein: "Paid, moving in soon",
                ending: "Notice given or overdue",
                claims: "Landlords owing tenants",
                all: "Every reservation",
              };
              return (
                <button key={t.key} type="button" onClick={() => setView(t.key)} aria-pressed={on}
                  className={`min-w-0 cursor-pointer rounded-md border border-solid p-3 text-left transition-all [font-family:inherit] ${on ? "border-neutral-900 bg-emerald-50/50" : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}>
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-semibold text-neutral-800">{t.label}</span>
                    <t.Icon className={`h-4 w-4 shrink-0 ${urgent ? "text-amber-500" : "text-neutral-400"}`} />
                  </span>
                  <span className={`mt-2 block text-2xl font-bold tabular-nums leading-none ${urgent ? "text-amber-700" : "text-neutral-900"}`}>{value == null ? (t.key === "all" ? "All" : "...") : value}</span>
                  <span className="mt-1 block truncate text-[11px] text-neutral-500">{hint[t.key]}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {error ? <p className="m-0 text-sm text-red-700">{error}</p> : null}
      <div className="space-y-3">        {view === "claims" ? <ClaimsList target={claim} /> : items === null ? (
          <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
            <Inbox className="mx-auto h-7 w-7 text-slate-300" />
            <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{target ? "Tenancy unavailable" : EMPTY[view].title}</p>
            {!target && <p className="m-0 mt-0.5 text-[13px] text-slate-500">{EMPTY[view].text}</p>}
          </div>
        ) : target ? (
          <TenancyCard item={items[0]} onChanged={refreshCase} />
        ) : <TenancyRows items={items} onOpen={setSelected} />}
      </div>
      {selected && <TenancyDialog item={selected} onClose={() => setSelected(null)} onChanged={() => refreshSelected(selected.ref)} />}
    </div>
  );
}

function TenancyRows({ items, onOpen }: { items: Item[]; onOpen: (item: Item) => void }) {
  return (
    <section aria-label="Tenancy queue" className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <h2 className="m-0 text-base font-bold text-slate-950">Tenancy queue</h2>
        <span className="text-xs font-semibold tabular-nums text-slate-600">{items.length} shown</span>
      </div>
      <div className="hidden grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,.85fr)_minmax(0,1fr)_5rem] gap-4 bg-[#f1f6f4] px-5 py-2.5 text-xs font-semibold text-[#215b50] lg:grid" aria-hidden>
        <span>Property</span><span>Tenant</span><span>Move-in</span><span>Payout</span><span>Details</span>
      </div>
      <ul className="m-0 list-none divide-y divide-slate-100 p-0">
        {items.map((item) => (
          <li key={item.ref} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 sm:px-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_minmax(0,.85fr)_minmax(0,1fr)_5rem]">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e8f3ef] text-[#02665e]"><Home className="size-4" aria-hidden /></span>
              <div className="min-w-0">
                <p className="m-0 break-words text-sm font-bold text-slate-950">{item.home || "Long stay"}</p>
                <p className="m-0 mt-0.5 text-xs text-slate-600">{STAY_LABEL[item.status] ?? item.status}</p>
              </div>
            </div>
            <p className="m-0 hidden break-words text-sm text-slate-700 lg:block">{item.tenant.name || "-"}</p>
            <p className="m-0 text-xs text-slate-600 lg:text-sm"><span className="lg:hidden">Move-in · </span>{day(item.moveInDate)}</p>
            <div className="col-start-2 row-start-1 lg:col-start-auto lg:row-start-auto"><PayoutStatus status={item.payoutStatus} /></div>
            <button type="button" onClick={() => onOpen(item)} aria-haspopup="dialog" aria-label={`View tenancy for ${item.home || "long stay"}`} className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-solid border-[#cde2d8] bg-white px-2.5 text-xs font-semibold text-[#215b50] hover:bg-[#edf6f2] focus-visible:outline-2 focus-visible:outline-[#02665e]">
              View <ArrowUpRight className="size-3.5" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TenancyDialog({ item, onClose, onChanged }: { item: Item; onClose: () => void; onChanged: () => Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); }, []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-label={`Tenancy for ${item.home || "long stay"}`}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-1.5rem)] w-[min(68rem,calc(100%-1.5rem))] max-w-none overflow-y-auto rounded-xl border-0 bg-white p-0 shadow-2xl backdrop:bg-[#071b17]/65">
      <TenancyCard item={item} onChanged={onChanged} onClose={() => dialog.current?.close()} />
    </dialog>
  );
}

type TenancyEvent = { actorRole: string; type: string; toStatus?: string | null; createdAt: string; data?: { reason?: string; note?: string } | null };

function TenancyCard({ item, onChanged, onClose }: { item: Item; onChanged: () => Promise<void>; onClose?: () => void }) {
  const [mode, setMode] = useState<"manual" | "resolve" | "history" | "claim" | null>(null);
  const [claimKind, setClaimKind] = useState("UNUSED_RENT");
  const [claimAmount, setClaimAmount] = useState("");
  const [claimReason, setClaimReason] = useState("");
  const [reference, setReference] = useState("");
  const [to, setTo] = useState("ACTIVE");
  const [payout, setPayout] = useState("READY");
  const [note, setNote] = useState("");
  const [reinspect, setReinspect] = useState(false);
  const [events, setEvents] = useState<TenancyEvent[] | null>(null);
  const [historyError, setHistoryError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const call = async (path: string, body: unknown, done: string) => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await apiClient.post(`/api/admin/long-stay/tenancies/${encodeURIComponent(item.ref)}/${path}`, body);
      setMessage({ tone: "ok", text: response.data?.next || done });
      setMode(null);
      await onChanged();
    } catch (requestError: any) {
      setMessage({ tone: "error", text: requestError?.response?.data?.error || "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const loadHistory = async () => {
    setHistoryError(false);
    setEvents(null);
    try {
      const response = await apiClient.get<{ events: TenancyEvent[] }>(`/api/admin/long-stay/tenancies/${encodeURIComponent(item.ref)}/events`);
      setEvents(response.data.events);
    } catch {
      setHistoryError(true);
    }
  };
  const openHistory = () => {
    if (mode === "history") { setMode(null); return; }
    setMode("history");
    void loadHistory();
  };

  const payable = ["READY", "REVIEW"].includes(item.payoutStatus) || item.payoutStatus === "APPROVED";
  const btn = "inline-flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-semibold disabled:opacity-50 [font-family:inherit]";
  const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

  return (
    <article className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      {/* Compact header: name, place and the status tags on one line */}
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-0 border-b border-solid border-slate-200 bg-[#0b2420] px-4 py-2.5 text-white sm:px-5">
        <Home className="size-4 shrink-0 text-emerald-300" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-[15px] font-bold text-white">
            {softenCaps(item.home) || "Long stay"}
            <span className="ml-2 font-normal text-white/60">{[softenCaps(item.area), item.monthlyRent != null ? `${money(item.monthlyRent, item.currency)}/mo` : "", item.termMonths ? `${item.termMonths} mo` : ""].filter(Boolean).join(" · ")}</span>
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-white">{STAY_LABEL[item.status] ?? item.status}</span>
          <PayoutStatus status={item.payoutStatus} />
          {(() => {
            const d = ["RESERVED", "MOVE_IN", "AWAITING_PAYMENT", "ACCEPTED", "OFFERED"].includes(item.status) ? daysFromToday(item.moveInDate) : null;
            return d == null ? null : (
              <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-100">
                {d > 0 ? `In ${d} ${d === 1 ? "day" : "days"}` : d === 0 ? "Moves in today" : `Moved in ${-d}d ago`}
              </span>
            );
          })()}
          <span className="hidden font-mono text-[10.5px] text-white/40 md:inline" title={item.ref}>{item.ref.slice(0, 11)}…</span>
          {onClose && <button type="button" onClick={onClose} aria-label="Close tenancy" className="ml-1 grid size-7 shrink-0 cursor-pointer place-items-center rounded border border-solid border-white/20 bg-white/5 text-white hover:bg-white/15"><X className="size-3.5" aria-hidden /></button>}
        </div>
      </header>

      <Journey item={item} />

      <div className="grid gap-3 p-4 sm:p-5 lg:grid-cols-3">
        {/* People */}
        <section className="min-w-0 rounded-lg border border-solid border-slate-200 p-3.5">
          <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-950"><Users className="size-4 text-[#02665e]" aria-hidden />People</h3>
          <dl className="m-0 mt-3 space-y-3">
            <Fact label="Landlord" value={softenCaps(item.landlord.name) || "-"} phone={item.landlord.phone} />
            <div>
              <Fact label="Tenant" value={softenCaps(item.tenant.name) || "-"} phone={item.tenant.phone} />
              {item.tenantId ? (
                <span className={`mt-1.5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ${item.tenantId.status === "APPROVED" ? "bg-emerald-50 text-emerald-800" : item.tenantId.status === "PENDING" ? "bg-amber-50 text-amber-800" : "bg-rose-50 text-rose-700"}`}>
                  <ShieldCheck className="size-3" aria-hidden />
                  ID {item.tenantId.status === "APPROVED" ? "verified" : item.tenantId.status.toLowerCase()} · {item.tenantId.idType === "PASSPORT" ? "Passport" : item.tenantId.idType === "RES_PERMIT" ? "Residence permit" : "National ID"}
                  {item.tenantId.expiresOn ? ` · to ${day(item.tenantId.expiresOn)}` : ""}
                </span>
              ) : <span className="mt-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">No long-stay ID on file</span>}
            </div>
            <Fact label="Stay" value={`${day(item.moveInDate)} to ${day(item.endDate ?? null)}`} sub={item.termMonths ? `${item.termMonths} months${item.upfrontMonths ? `, ${item.upfrontMonths} prepaid` : ""}` : null} />
          </dl>
        </section>

        {/* Money */}
        <section className="min-w-0 rounded-lg border border-solid border-[#d9e7e2] bg-[#f5f9f7] p-3.5">
          <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-950"><Wallet className="size-4 text-[#02665e]" aria-hidden />Money</h3>
          <dl className="m-0 mt-3 space-y-1.5 text-[13px]">
            <MoneyRow label="Monthly rent" value={money(item.monthlyRent, item.currency)} />
            <MoneyRow label="Tenant paid NoLSAF (card)" value={money(item.paidAmount ?? item.bookingAmount, item.currency)} sub={item.timeline?.paidAt ? `Paid ${whenEat(item.timeline.paidAt)}` : item.timeline?.paymentDueAt ? `Due ${whenEat(item.timeline.paymentDueAt)}` : "Not paid yet"} />
            <MoneyRow label="of which tenant fee" value={money(item.tenantFee, item.currency)} muted />
            <MoneyRow label="Rent due to landlord at move-in" value={money(item.balanceDue, item.currency)} />
            <div className="my-1.5 border-0 border-t border-dashed border-[#cfe0da]" />
            <MoneyRow label="First month held" value={money(item.monthlyRent, item.currency)} muted />
            <MoneyRow label="less landlord commission" value={item.landlordCommission != null ? `- ${money(item.landlordCommission, item.currency)}` : "-"} muted />
            {item.payoutDeduction ? <MoneyRow label="less recovered for claims" value={`- ${money(item.payoutDeduction, item.currency)}`} muted /> : null}
            <MoneyRow label="Landlord payout" value={money(item.landlordPayout, item.currency)} strong sub={item.payoutReleasedAt ? `Sent ${day(item.payoutReleasedAt)}` : PAYOUT_LABEL[item.payoutStatus] ?? item.payoutStatus} />
            {item.tenantFee != null && item.landlordCommission != null ? (
              <MoneyRow label="NoLSAF keeps" value={money(item.tenantFee + item.landlordCommission, item.currency)} brand />
            ) : null}
          </dl>
        </section>

        {/* Lease and move-in checks */}
        <section className="min-w-0 rounded-lg border border-solid border-slate-200 p-3.5">
          <h3 className="m-0 flex items-center gap-2 text-sm font-bold text-slate-950"><KeyRound className="size-4 text-[#02665e]" aria-hidden />Lease and move-in</h3>
          <ul className="m-0 mt-3 list-none space-y-2 p-0 text-[12.5px]">
            <Check ok={Boolean(item.timeline?.landlordLeaseAcceptedAt)} label="Landlord signed the lease" when={whenEat(item.timeline?.landlordLeaseAcceptedAt)} />
            <Check ok={Boolean(item.timeline?.tenantLeaseAcceptedAt)} label="Tenant signed the lease" when={whenEat(item.timeline?.tenantLeaseAcceptedAt)} />
            {item.leaseVersion ? <li className="pl-6 text-[11.5px] text-slate-500">Version {item.leaseVersion}{item.leaseFingerprint ? ` · fingerprint ${item.leaseFingerprint}` : ""}</li> : null}
            <Check ok={Boolean(item.timeline?.landlordConfirmedAt)} label={`Landlord received the balance${item.moveIn?.landlordMethod ? ` (${item.moveIn.landlordMethod === "BANK" ? "bank" : "mobile money"})` : ""}`} when={whenEat(item.timeline?.landlordConfirmedAt)} warn={item.balanceMismatch && item.landlordBalanceAmount != null && item.landlordBalanceAmount !== item.balanceDue ? money(item.landlordBalanceAmount, item.currency) : undefined} />
            <Check ok={Boolean(item.timeline?.tenantConfirmedAt)} label={`Tenant paid the balance${item.moveIn?.tenantMethod ? ` (${item.moveIn.tenantMethod === "BANK" ? "bank" : "mobile money"})` : ""}`} when={whenEat(item.timeline?.tenantConfirmedAt)} warn={item.balanceMismatch && item.tenantBalanceAmount != null && item.tenantBalanceAmount !== item.balanceDue ? money(item.tenantBalanceAmount, item.currency) : undefined} />
            <Check ok={item.moveIn?.keysReceived === true} bad={item.moveIn?.keysReceived === false} label="Keys handed over" />
            <Check ok={item.moveIn?.matchesListing === true} bad={item.moveIn?.matchesListing === false} label="Home matches the listing" />
            {item.moveInConfirmedBy ? <li className="pl-6 text-[11.5px] text-slate-500">Move-in confirmed by {item.moveInConfirmedBy === "BOTH" ? "both parties" : item.moveInConfirmedBy === "ADMIN" ? "NoLSAF" : "one party after 72 hours"}</li> : null}
          </ul>
          {item.balanceMismatch && <p role="status" className="m-0 mt-3 flex items-start gap-1.5 rounded-md bg-amber-50 p-2 text-xs font-semibold text-amber-900"><AlertTriangle className="size-4 shrink-0" aria-hidden />The reported balance differs from the lease ({money(item.balanceDue, item.currency)}). Check with both parties before paying.</p>}
        </section>
      </div>

      {mode === "manual" ? (
        <div className="border-0 border-t border-solid border-slate-100 p-4">
          <label htmlFor={`ref-${item.ref}`} className="block text-xs font-semibold text-slate-700">Bank transfer reference for {money(item.landlordPayout, item.currency)}</label>
          <input id={`ref-${item.ref}`} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || reference.trim().length < 4} onClick={() => call("payout/manual", { reference: reference.trim() }, "Payout recorded.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Record payout</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Cancel</button>
          </div>
        </div>
      ) : mode === "resolve" ? (
        <div className="grid gap-2 border-0 border-t border-solid border-slate-100 p-4 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-700">Tenancy goes to
            <select value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
              <option value="ACTIVE">Let (move-in stands)</option>
              <option value="MOVE_IN">Back to move-in confirmations</option>
              <option value="RESERVED">Back to reserved</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="ENDED">Ended</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">First month
            <select value={payout} onChange={(e) => setPayout(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
              <option value="READY">Pay the landlord</option>
              <option value="REVIEW">Keep holding for review</option>
              <option value="REFUND_DUE">Refund the tenant</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Decision note (kept on record)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="mt-1 min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm font-normal outline-none focus:border-[#02665e] [font-family:inherit]" />
          </label>
          <label className="flex items-start gap-2 text-xs text-slate-700 sm:col-span-2">
            <input type="checkbox" checked={reinspect} onChange={(e) => setReinspect(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[#02665e]" />
            End this home’s current inspection and request another visit. New reservations pause until the home passes again.
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy || note.trim().length < 10} onClick={() => call("resolve", { to, payout, note: note.trim(), reinspect }, "Decision saved.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Save decision</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Cancel</button>
          </div>
        </div>
      ) : mode === "claim" ? (
        <div className="grid gap-2 border-0 border-t border-solid border-slate-100 p-4 sm:grid-cols-[1fr_1fr]">
          <label className="block text-xs font-semibold text-slate-700">What the landlord owes the tenant
            <select value={claimKind} onChange={(e) => setClaimKind(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
              <option value="UNUSED_RENT">Unused prepaid months</option>
              <option value="BALANCE_RETURN">Balance to give back</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-700">Amount ({item.currency})
            <input value={claimAmount} onChange={(e) => setClaimAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 px-2.5 text-sm font-normal outline-none focus:border-[#02665e]" />
          </label>
          <label className="block text-xs font-semibold text-slate-700 sm:col-span-2">Why (both sides see this)
            <textarea value={claimReason} onChange={(e) => setClaimReason(e.target.value)} maxLength={500} className="mt-1 min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm font-normal outline-none focus:border-[#02665e] [font-family:inherit]" />
          </label>
          <p className="m-0 text-[12px] text-slate-500 sm:col-span-2">The landlord gets 14 days to pay the tenant directly. After that their long stays pause and it is taken from their next long-stay payout.</p>
          <div className="flex gap-2 sm:col-span-2">
            <button type="button" disabled={busy || !(Number(claimAmount) > 0) || claimReason.trim().length < 10} onClick={() => call("claims", { kind: claimKind, amount: Number(claimAmount), reason: claimReason.trim() }, "Claim opened.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>Open claim</button>
            <button type="button" onClick={() => setMode(null)} className={outline}>Cancel</button>
          </div>
        </div>
      ) : mode === "history" ? (
        <section aria-label="Tenancy activity" className="mx-4 mb-4 overflow-hidden rounded-lg border border-solid border-slate-200 sm:mx-5">
          <h3 className="m-0 flex items-center gap-2 bg-[#f1f6f4] px-3.5 py-3 text-sm font-bold text-slate-950"><History className="size-4 text-[#02665e]" aria-hidden />Tenancy activity</h3>
          {historyError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-3">
              <p role="alert" className="m-0 text-sm text-rose-800">Could not load tenancy activity.</p>
              <button type="button" onClick={() => void loadHistory()} className={outline}>Retry</button>
            </div>
          ) : events === null ? (
            <p role="status" className="m-0 flex items-center gap-2 p-3.5 text-sm text-slate-700"><Loader2 className="size-4 animate-spin" aria-hidden />Loading activity</p>
          ) : events.length === 0 ? (
            <p className="m-0 p-3.5 text-sm text-slate-600">No activity recorded.</p>
          ) : (
            <ol className="m-0 max-h-[min(24rem,50dvh)] list-none divide-y divide-slate-100 overflow-auto p-0">
              {events.map((event, index) => {
                const statusTitle = event.type.startsWith("STATUS_") && event.toStatus ? EVENT_TITLE[event.toStatus] ?? STAY_LABEL[event.toStatus] : undefined;
                const title = EVENT_TITLE[event.type] ?? statusTitle ?? event.type.replace(/_/g, " ").toLowerCase();
                const actor = event.actorRole === "SYSTEM" ? "NoLSAF system" : event.actorRole === "ADMIN" ? "NoLSAF admin" : event.actorRole.toLowerCase();
                return (
                  <li key={`${event.createdAt}:${index}`} className="grid gap-x-3 gap-y-1 px-3.5 py-2.5 sm:grid-cols-[minmax(0,1fr)_10rem]">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold text-slate-900 first-letter:uppercase">{title} <span className="ml-1 text-xs font-medium capitalize text-slate-600">· {actor}</span></p>
                      {(event.data?.reason || event.data?.note) && <p className="m-0 mt-1 break-words text-xs text-slate-600">{event.data.reason || event.data.note}</p>}
                    </div>
                    <time dateTime={event.createdAt} className="flex items-center gap-1.5 text-xs tabular-nums text-slate-600"><CalendarDays className="size-3.5 shrink-0 text-[#02665e]" aria-hidden />{new Date(event.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT</time>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-0 border-t border-solid border-slate-100 px-4 py-2.5">
        {payable && item.currency === "TZS" ? (
          <button type="button" disabled={busy} onClick={() => call("payout/approve", {}, "Sent to Disbursements.")} className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
            <Wallet className="h-4 w-4" />{item.payoutStatus === "APPROVED" ? "Request again" : "Approve payout"}
          </button>
        ) : null}
        {["READY", "REVIEW"].includes(item.payoutStatus) ? <button type="button" onClick={() => setMode("manual")} className={outline}>Record bank payout</button> : null}
        {item.status === "DISPUTED" || item.status === "MOVE_IN" || item.payoutStatus === "REVIEW" ? <button type="button" onClick={() => setMode("resolve")} className={outline}>Decide</button> : null}
        {["ACTIVE", "ENDING", "ENDED", "OVERDUE", "DISPUTED"].includes(item.status) && item.moveInConfirmedBy ? <button type="button" onClick={() => setMode("claim")} className={outline}>Open claim</button> : null}
        <button type="button" onClick={openHistory} aria-expanded={mode === "history"} className={`${outline} sm:ml-auto`}><History className="size-4 text-[#02665e]" aria-hidden />{mode === "history" ? "Hide activity" : "View activity"}</button>
        {item.payoutStatus === "APPROVED" ? <Link href="/admin/disbursements" className="text-[13px] font-semibold text-[#02665e] no-underline hover:underline">Open Disbursements</Link> : null}
      </div>
      {message ? <p className={`m-0 px-4 pb-3 text-xs ${message.tone === "ok" ? "text-emerald-700" : "text-red-700"}`}>{message.text}</p> : null}
    </article>
  );
}

function Fact({ label, value, sub, phone, warn, strong }: { label: string; value: string; sub?: string | null; phone?: string | null; warn?: boolean; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className={`m-0 mt-0.5 break-words tabular-nums ${warn ? "text-sm font-semibold text-amber-900" : strong ? "text-base font-bold text-[#215b50]" : "text-sm font-semibold text-slate-900"}`}>{value}</dd>
      {sub && <dd className="m-0 mt-0.5 text-xs text-slate-600">{sub}</dd>}
      {phone && <dd className="m-0 mt-0.5"><a href={`tel:${phone}`} className="inline-flex items-center gap-1 break-all text-xs font-medium text-[#02665e] no-underline hover:underline"><Phone className="size-3 shrink-0" aria-hidden />{phone}</a></dd>}
    </div>
  );
}

function MoneyRow({ label, value, sub, muted, strong, brand }: { label: string; value: string; sub?: string | null; muted?: boolean; strong?: boolean; brand?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={muted ? "pl-3 text-[12px] text-slate-500" : "text-slate-600"}>
        {label}
        {sub ? <span className="block text-[11px] text-slate-400">{sub}</span> : null}
      </dt>
      <dd className={`m-0 shrink-0 text-right tabular-nums ${strong ? "text-[15px] font-bold text-[#215b50]" : brand ? "font-semibold text-[#02665e]" : muted ? "text-[12px] text-slate-500" : "font-semibold text-slate-900"}`}>{value}</dd>
    </div>
  );
}

function Check({ ok, bad, label, when, warn }: { ok: boolean; bad?: boolean; label: string; when?: string | null; warn?: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-px grid size-4 shrink-0 place-items-center rounded-full ${bad ? "bg-rose-100 text-rose-700" : ok ? "bg-emerald-100 text-emerald-700" : "border-2 border-solid border-slate-200 bg-white"}`}>
        {bad ? <X className="size-2.5" aria-hidden /> : ok ? <CheckCircle2 className="size-3" aria-hidden /> : null}
      </span>
      <span className="min-w-0">
        <span className={bad ? "font-semibold text-rose-700" : ok ? "text-slate-800" : "text-slate-400"}>{label}</span>
        {warn ? <span className="ml-1 font-semibold text-amber-800">said {warn}</span> : null}
        {when ? <span className="block text-[11px] text-slate-400">{when}</span> : null}
      </span>
    </li>
  );
}

type ClaimRow = { id: number; kind: string; amount: number; recoveredAmount: number; currency: string; status: string; reason: string; dueAt: string; escalatedAt: string | null; closedAt: string | null; tenancyRef: string; home: string | null };

/** Claims under the lease: open, being recovered, or recovered and owed to the tenant. */
function ClaimsList({ target }: { target?: string | null }) {
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  const [acting, setActing] = useState<{ id: number; outcome: string } | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get<{ items: ClaimRow[] }>("/api/admin/long-stay/claims", { params: { scope: "open", id: target } });
      setRows(response.data.items);
    } catch {
      setRows([]);
    }
  }, [target]);
  useEffect(() => { void load(); }, [load]);

  const close = async () => {
    if (!acting) return;
    setMessage("");
    try {
      await apiClient.post(`/api/admin/long-stay/claims/${acting.id}/close`, { outcome: acting.outcome, note: note.trim() });
      setActing(null);
      setNote("");
      window.dispatchEvent(new Event("nols:admin-long-stay-queue-change"));
      void load();
    } catch (requestError: any) {
      setMessage(requestError?.response?.data?.error || "Could not save.");
    }
  };

  if (rows === null) return <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  if (!rows.length) return (
    <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center">
      <Inbox className="mx-auto h-7 w-7 text-slate-300" />
      <p className="m-0 mt-2 text-sm font-semibold text-slate-700">{target ? "Claim unavailable" : "No open claims"}</p>
      {!target && <p className="m-0 mt-0.5 text-[13px] text-slate-500">Open one from a tenancy when a landlord owes the tenant money under the lease.</p>}
    </div>
  );
  const btn = "inline-flex h-8 cursor-pointer items-center justify-center rounded-md px-3 text-[13px] font-semibold [font-family:inherit]";
  return (
    <div className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      {rows.map((c) => (
        <div key={c.id} className="border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
          <div className="flex flex-wrap items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold text-slate-900">{money(c.amount, c.currency)} <span className="font-normal text-slate-500">owed to the tenant, {c.home || "long stay"}</span></p>
              <p className="m-0 mt-0.5 text-xs text-slate-600">{c.reason}</p>
              <p className="m-0 mt-0.5 font-mono text-[11px] text-slate-400">{c.tenancyRef}</p>
              <p className="m-0 mt-1 text-xs">
                <span className={`rounded-md px-1.5 py-0.5 font-semibold ${c.status === "RECOVERING" ? "bg-red-50 text-red-700" : c.status === "RECOVERED" ? "bg-amber-50 text-amber-800" : "bg-sky-50 text-sky-800"}`}>
                  {c.closedAt ? `Closed ${day(c.closedAt)}` : c.status === "OPEN" ? `Due ${day(c.dueAt)}` : c.status === "RECOVERING" ? `Past due, ${money(c.recoveredAmount, c.currency)} recovered` : "Recovered: pay it to the tenant"}
                </span>
              </p>
            </div>
            {!c.closedAt && <div className="flex flex-wrap gap-2">
              {c.status === "RECOVERED" ? (
                <button type="button" onClick={() => setActing({ id: c.id, outcome: "PAID_TO_TENANT" })} className={`${btn} border-0 bg-[#02665e] text-white`}>Paid to tenant</button>
              ) : (
                <>
                  {c.recoveredAmount === 0 ? <button type="button" onClick={() => setActing({ id: c.id, outcome: "SETTLED" })} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Landlord paid</button> : null}
                  <button type="button" onClick={() => setActing({ id: c.id, outcome: "WAIVED" })} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Waive</button>
                </>
              )}
            </div>}
          </div>
          {acting?.id === c.id ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the record (reference, reason)" maxLength={500} className="h-8 min-w-0 flex-1 rounded-md border border-solid border-slate-300 px-2.5 text-sm outline-none focus:border-[#02665e]" />
              <button type="button" disabled={note.trim().length < 5} onClick={close} className={`${btn} border-0 bg-[#02665e] text-white disabled:opacity-50`}>Save</button>
              <button type="button" onClick={() => setActing(null)} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700`}>Cancel</button>
            </div>
          ) : null}
          {acting?.id === c.id && message ? <p className="m-0 mt-1 text-xs text-red-700">{message}</p> : null}
        </div>
      ))}
    </div>
  );
}
