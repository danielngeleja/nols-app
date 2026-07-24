"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, BookOpen, Calculator, CalendarCheck2, CheckCircle2, ClipboardCheck, Loader2, LockKeyhole, RefreshCw, Scale, WalletCards } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../_components/NrmsProvider";
import { serviceLabelForRole } from "../_components/ShiftPanel";

type Tab = "audit" | "cashiers" | "ledger" | "tax" | "nbs";
type Blocker = { code: string; count: number; message: string };
type ShiftCloseSummary = {
  mySales: { count: number; amount: number; byMethod: Array<{ method: string; count: number; amount: number }> };
  myFolioPayments: { count: number; amount: number; byMethod: Array<{ method: string; count: number; amount: number }> };
  folioPosted: { count: number; amount: number };
  unpaid: { count: number; amount: number };
};
type Shift = { id: number; cashierName: string; assignment: { role: string; outletName: string | null } | null; handoverFromName: string | null; currency: string; status: string; openingFloat: number; liveExpectedCash: number; expectedCash: number; declaredCash: number | null; variance: number | null; closeNote: string | null; closeSummary: ShiftCloseSummary | null; openedAt: string; closedAt: string | null; ownerSignedOffAt: string | null; ownerSignedOffByName: string | null };
type LedgerEntry = { id: number; accountCode: string; accountName: string; debit: number; credit: number };
type LedgerTransaction = { id: number; transactionNumber: string; description: string; sourceType: string; currency: string; occurredAt: string; entries: LedgerEntry[] };
type FinanceData = {
  property: { id: number; title: string; currency: string | null }; accessRole: "OWNER" | "MANAGER" | "FRONT_DESK"; businessDate: string; month: string;
  businessDay: { id: number | null; status: string; openedAt?: string; closedAt?: string | null; audits: Array<{ id: number; reportNumber: string; status: string; startedAt: string; completedAt: string | null; summary: any }> };
  blockers: Blocker[]; warnings: Blocker[]; shifts: Shift[];
  unclassifiedTenders: Array<{ id: number; orderNumber: string; currency: string; total: number; settledAt: string; outlet: { name: string; type: string }; guest: string; room: string }>;
  ledger: { balanced: boolean; accounts: Array<{ accountCode: string; accountName: string; accountType: string; currency: string; debit: number; credit: number; balance: number }>; transactions: LedgerTransaction[] };
  tax: { total: number; note: string; rows: Array<{ transactionNumber: string; occurredAt: string; description: string; currency: string; tax: number }> };
  nbs: { month: string; reportingDays: number; bedsAvailable: number; bedNightsAvailable: number; bedNightsOccupied: number; domesticBedNights: number; internationalBedNights: number; roomNightsOccupied: number; bedOccupancyRate: number; missingNationalityBedNights: number; methodology: string };
};

const tabs: Array<{ id: Tab; label: string; icon: typeof ClipboardCheck }> = [
  { id: "audit", label: "Night Audit", icon: ClipboardCheck }, { id: "cashiers", label: "Cashier variance", icon: WalletCards },
  { id: "ledger", label: "Accounting ledger", icon: BookOpen }, { id: "tax", label: "Tax register", icon: Calculator }, { id: "nbs", label: "NBS statistics", icon: Scale },
];

function localDay() { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function cash(value: number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function time(value?: string | null) { return value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " EAT" : "Not recorded"; }
function tenderAmount(shift: Shift, method: string): number { return shift.closeSummary?.mySales.byMethod.find((row) => row.method === method)?.amount ?? 0; }
const KNOWN_TENDER_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD"];
function otherTenderAmount(shift: Shift): number { return (shift.closeSummary?.mySales.byMethod ?? []).filter((row) => !KNOWN_TENDER_METHODS.includes(row.method)).reduce((sum, row) => sum + row.amount, 0); }
// Distinguishes a cashier's outlet at a glance so a long shift list doesn't read as one undifferentiated block.
function shiftRowTone(shift: Shift): string {
  if (shift.assignment?.role === "BAR") return "bg-violet-50/50 border-l-2 border-l-violet-400";
  if (shift.assignment?.role === "RESTAURANT") return "bg-sky-50/50 border-l-2 border-l-sky-400";
  return "border-l-2 border-l-transparent";
}

function Metric({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "green" | "amber" }) {
  return <div className={`min-w-0 rounded-xl border p-4 ${tone === "green" ? "border-emerald-200 bg-emerald-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white"}`}><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</p><p className="mb-0 mt-1 text-xl font-bold tabular-nums text-neutral-950">{value}</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{note}</p></div>;
}

export default function FinanceControlPage() {
  const { selectedPropertyId } = useNrms();
  const [tab, setTab] = useState<Tab>("audit");
  const [businessDate, setBusinessDate] = useState(localDay());
  const [month, setMonth] = useState(localDay().slice(0, 7));
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [counted, setCounted] = useState<Record<number, string>>({}); const [notes, setNotes] = useState<Record<number, string>>({});
  const [tenderCorrections, setTenderCorrections] = useState<Record<number, string>>({});

  const load = useCallback(async (silent = false) => {
    if (!selectedPropertyId) return; if (!silent) setLoading(true); setError(null);
    try { const response = await apiClient.get(`/api/owner/nrms/finance/property/${selectedPropertyId}?businessDate=${businessDate}&month=${month}`); setData(response.data); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Unable to load financial control records"); }
    finally { if (!silent) setLoading(false); }
  }, [businessDate, month, selectedPropertyId]);
  useEffect(() => {
    void load();
    // Cashier shifts and sales are shared with every attendant; poll so the
    // owner sees a shift open/close or a new sale without a manual refresh.
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 15_000);
    return () => window.clearInterval(refreshTimer);
  }, [load]);

  const action = async (request: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setMessage(null);
    try { await request(); setMessage(success); await load(); }
    catch (cause: any) { setError(cause?.response?.data?.error || "The control action could not be completed"); }
    finally { setBusy(false); }
  };
  const propertyCurrency = data?.property.currency || "Currency not set";
  const closeShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/close`, { declaredCash: Number(counted[shift.id]), closeNote: notes[shift.id]?.trim() || undefined }), "Cashier shift closed and its variance has been recorded.");
  const signOffShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/sign-off`), "Shift sales acknowledged and signed off.");
  const closeAudit = () => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/night-audit/close`, { businessDate }), "Night Audit completed. The business date and its balanced ledger are locked.");
  const classifyTender = (orderId: number) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/outlet-orders/${orderId}/classify`, { method: tenderCorrections[orderId] }), "Outlet payment method classified for reconciliation.");
  const canManage = data?.accessRole === "OWNER" || data?.accessRole === "MANAGER";

  if (loading && !data) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading financial controls…</div>;
  return <div className="mx-auto max-w-[1500px] space-y-4 pb-10">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-700">NRMS financial control</p><h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Business date, cash and statutory records</h2><p className="mb-0 mt-1 text-xs text-neutral-500">One controlled flow from operational transactions to Night Audit, ledgers and NBS statistics.</p></div><button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600"><RefreshCw className="h-4 w-4" />Refresh</button></header>
    <section className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CalendarCheck2 className="h-4 w-4" /></span><div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-1.5"><div className="flex h-10 items-center gap-1.5"><span className="pl-1 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Business date</span><div className="w-[148px]"><DatePickerField label="Business date" value={businessDate} onChangeAction={setBusinessDate} widthClassName="!w-full" size="sm" twoMonths={false} allowPast /></div></div><span className="hidden h-6 w-px bg-neutral-200 sm:block" aria-hidden /><div className="flex h-10 items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">NBS month</span><div className="w-[132px]"><DatePickerField label="NBS reporting month" value={`${month}-01`} onChangeAction={(next) => setMonth(next.slice(0, 7))} widthClassName="!w-full" size="sm" twoMonths={false} allowPast display="month" /></div></div></div></div><div className="grid grid-cols-2 gap-2 sm:flex"><div className={`flex min-w-[142px] items-center gap-2 rounded-xl border px-3 py-2 ${data?.businessDay.status === "CLOSED" ? "border-neutral-800 bg-neutral-900 text-white" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}><LockKeyhole className="h-4 w-4 shrink-0" /><div><p className="m-0 text-[8px] font-bold uppercase tracking-wide opacity-60">Business date</p><p className="mb-0 mt-0.5 text-[10px] font-bold">{data?.businessDay.status.replaceAll("_", " ")}</p></div></div><div className={`flex min-w-[142px] items-center gap-2 rounded-xl border px-3 py-2 ${data?.ledger.balanced ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><CheckCircle2 className="h-4 w-4 shrink-0" /><div><p className="m-0 text-[8px] font-bold uppercase tracking-wide opacity-60">Ledger control</p><p className="mb-0 mt-0.5 text-[10px] font-bold">{data?.ledger.balanced ? "Balanced" : "Review required"}</p></div></div></div></section>
    {(error || message) && <div className={`rounded-xl border px-4 py-3 text-xs font-semibold ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}
    <nav className="grid grid-cols-2 gap-1 rounded-2xl border border-neutral-200 bg-white p-1 shadow-sm sm:grid-cols-5">{tabs.filter((item) => data?.accessRole !== "FRONT_DESK" || ["audit", "cashiers"].includes(item.id)).map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-0 px-2 text-[11px] font-bold ${tab === item.id ? "bg-[#073c35] text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-50"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>

    {tab === "audit" && <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]"><section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><h3 className="m-0 text-base font-bold">Night Audit checklist</h3><p className="mb-0 mt-1 text-xs text-neutral-500">Every blocking item must be cleared. There is no override or bypass.</p></div><CalendarCheck2 className="h-6 w-6 text-emerald-700" /></div><div className="mt-4 space-y-2">{data?.blockers.length ? data.blockers.map((blocker) => <div key={blocker.code} className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /><div><p className="m-0 text-xs font-bold text-red-800">{blocker.message}</p><p className="mb-0 mt-1 text-[10px] text-red-600">Resolve this in the related operational workspace, then refresh this control.</p></div></div>) : <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-700" /><div><p className="m-0 text-xs font-bold text-emerald-800">All closing controls passed</p><p className="mb-0 mt-1 text-[10px] text-emerald-700">NRMS is ready to post balanced entries and lock this business date.</p></div></div>}</div><button type="button" onClick={closeAudit} disabled={!canManage || busy || Boolean(data?.blockers.length) || data?.businessDay.status === "CLOSED"} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-xs font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400"><LockKeyhole className="h-4 w-4" />{data?.businessDay.status === "CLOSED" ? "Business date closed" : !canManage ? "Manager approval required to close" : "Post ledger and close business date"}</button></section><section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><h3 className="m-0 text-sm font-bold">Audit history</h3><div className="mt-3 space-y-2">{data?.businessDay.audits.map((audit) => <div key={audit.id} className="rounded-xl border border-neutral-200 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-xs">{audit.reportNumber}</strong><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${audit.status === "CLOSED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{audit.status}</span></div><p className="mb-0 mt-1 text-[10px] text-neutral-500">{time(audit.completedAt || audit.startedAt)}</p></div>)}{!data?.businessDay.audits.length && <p className="text-xs text-neutral-400">No Night Audit has been attempted for this date.</p>}</div></section></div>}

    {tab === "audit" && Boolean(data?.unclassifiedTenders?.length) && <section className="overflow-hidden rounded-xl border border-amber-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-100 bg-amber-50/70 px-4 py-3"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Classify outlet payments</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">These older settled orders have no recorded tender. Select the actual method received before Night Audit.</p></div><span className="rounded-md border border-amber-200 bg-white px-2 py-1 text-[9px] font-bold text-amber-800">{data?.unclassifiedTenders?.length} required</span></div>
      <div className="divide-y divide-neutral-100">{data?.unclassifiedTenders?.map((order) => <div key={order.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(150px,.8fr)_auto_180px_auto] md:items-center"><div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{order.orderNumber} · {order.outlet.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">Settled {time(order.settledAt)}</p></div><div className="min-w-0"><p className="m-0 truncate text-[11px] font-semibold text-neutral-700">{order.guest}</p><p className="mb-0 mt-0.5 truncate text-[9px] text-neutral-400">{order.room}</p></div><strong className="whitespace-nowrap text-xs tabular-nums text-neutral-900">{cash(order.total, order.currency)}</strong><select value={tenderCorrections[order.id] ?? ""} onChange={(event) => setTenderCorrections((current) => ({ ...current, [order.id]: event.target.value }))} className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-[10px] font-bold text-neutral-700 outline-none focus:border-emerald-500" aria-label={`Payment method for ${order.orderNumber}`}><option value="">Select payment method</option><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select><button type="button" onClick={() => classifyTender(order.id)} disabled={!canManage || busy || !tenderCorrections[order.id]} className="h-9 whitespace-nowrap rounded-lg border-0 bg-neutral-900 px-3 text-[10px] font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">Save method</button></div>)}</div>
    </section>}

    {tab === "cashiers" && <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      <header className="border-b border-neutral-200 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><WalletCards className="h-4 w-4" /></span><div><h3 className="m-0 text-base font-bold">Cashier shift variance</h3><p className="mb-0 mt-1 text-xs text-neutral-500">Expected cash includes the opening float, cash folio payments and cash settled at outlets. Attendants open and close their own shift from their Shift &amp; cash page.</p></div></div>
        <div className="mt-3 flex items-center gap-3 text-[10px] font-bold text-neutral-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" />Bar</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />Restaurant</span></div>
      </header>
      <div className="overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[1440px] border-collapse text-left">
          <thead><tr className="bg-neutral-50 text-[9px] uppercase tracking-wide text-neutral-500">
            <th className="p-2.5 pl-5">Cashier</th>
            <th className="p-2.5">Opened</th>
            <th className="p-2.5 text-right">Opening float</th>
            <th className="p-2.5 text-right">Expected cash</th>
            <th className="p-2.5 text-right">Counted cash</th>
            <th className="p-2.5 text-right">Variance</th>
            <th className="p-2.5 text-right">Cash</th>
            <th className="p-2.5 text-right">Mobile money</th>
            <th className="p-2.5 text-right">Bank</th>
            <th className="p-2.5 text-right">Card</th>
            <th className="p-2.5 text-right">Folio</th>
            <th className="p-2.5 pr-5">Note and control</th>
          </tr></thead>
          <tbody>{data?.shifts.map((shift) => <tr key={shift.id} className={`border-t border-neutral-100 text-xs ${shiftRowTone(shift)}`}>
            <td className="p-2.5 pl-5 font-bold">{shift.cashierName}{shift.assignment && <small className="mt-0.5 block font-normal text-neutral-500">{serviceLabelForRole(shift.assignment.role)}{shift.assignment.outletName ? ` · ${shift.assignment.outletName}` : ""}</small>}<small className={`mt-0.5 block font-normal ${shift.status === "OPEN" ? "text-emerald-600" : "text-neutral-400"}`}>{shift.status}{shift.handoverFromName ? ` · took over from ${shift.handoverFromName}` : ""}</small></td>
            <td className="p-2.5 whitespace-nowrap text-neutral-500">{time(shift.openedAt)}</td>
            <td className="p-2.5 text-right tabular-nums">{cash(shift.openingFloat, shift.currency)}</td>
            <td className="p-2.5 text-right font-bold tabular-nums">{cash(shift.liveExpectedCash, shift.currency)}</td>
            <td className="p-2.5 text-right">{shift.status === "OPEN" ? <input type="text" inputMode="decimal" value={counted[shift.id] ?? ""} onChange={(event) => setCounted((current) => ({ ...current, [shift.id]: event.target.value.replace(/[^0-9.]/g, "") }))} placeholder="Physical count" className="h-8 w-32 rounded-md border border-neutral-200 bg-white px-2 text-right text-[10px] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" /> : cash(shift.declaredCash || 0, shift.currency)}</td>
            <td className={`p-2.5 text-right font-bold tabular-nums ${Number(shift.variance) ? "text-red-600" : "text-emerald-700"}`}>{shift.status === "OPEN" ? <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[8px] font-bold text-emerald-700">Pending</span> : cash(shift.variance || 0, shift.currency)}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{shift.status === "OPEN" ? "–" : cash(tenderAmount(shift, "CASH"), shift.currency)}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{shift.status === "OPEN" ? "–" : cash(tenderAmount(shift, "MOBILE_MONEY"), shift.currency)}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{shift.status === "OPEN" ? "–" : cash(tenderAmount(shift, "BANK"), shift.currency)}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{shift.status === "OPEN" ? "–" : cash(tenderAmount(shift, "CARD"), shift.currency)}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{shift.status === "OPEN" ? "–" : cash(shift.closeSummary?.folioPosted.amount ?? 0, shift.currency)}</td>
            <td className="p-2.5 pr-5">{shift.status === "OPEN" ? <div className="flex items-center justify-end gap-1.5"><input value={notes[shift.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [shift.id]: event.target.value }))} placeholder="Variance note if needed" className="h-8 w-44 rounded-md border border-neutral-200 bg-white px-2 text-[9px] outline-none focus:border-emerald-500" /><button type="button" onClick={() => closeShift(shift)} disabled={busy || counted[shift.id] === undefined} className="h-8 whitespace-nowrap rounded-md border-0 bg-neutral-900 px-3 text-[9px] font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">Close</button></div> : <div className="text-[10px] leading-4 text-neutral-500">
              {shift.closeSummary && shift.closeSummary.unpaid.count > 0 && <strong className="block text-amber-700">{shift.closeSummary.unpaid.count} unpaid at close ({cash(shift.closeSummary.unpaid.amount, shift.currency)})</strong>}
              {otherTenderAmount(shift) > 0 && <span className="block">Other tender {cash(otherTenderAmount(shift), shift.currency)}</span>}
              <span>{shift.closeNote || (shift.closeSummary?.unpaid.count ? "" : "Matched")}</span>
              <div className="mt-1.5">{shift.ownerSignedOffAt ? <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700"><BadgeCheck className="h-3 w-3" />Signed off by {shift.ownerSignedOffByName} · {time(shift.ownerSignedOffAt)}</span> : canManage ? <button type="button" onClick={() => signOffShift(shift)} disabled={busy} className="h-7 whitespace-nowrap rounded-md border border-emerald-200 bg-white px-2 text-[9px] font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Acknowledge and sign off</button> : <span className="text-[9px] text-neutral-400">Not yet signed off</span>}</div>
            </div>}</td>
          </tr>)}{!data?.shifts.length && <tr><td colSpan={12} className="border-t border-neutral-100 p-0"><div className="flex min-h-36 flex-col items-center justify-center px-6 py-8 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400"><WalletCards className="h-4 w-4" /></span><p className="mb-0 mt-3 text-xs font-bold text-neutral-600">No cashier shift for this business date</p><p className="mb-0 mt-1 max-w-sm text-[10px] leading-4 text-neutral-400">Attendants open their shift from their own Shift &amp; cash page before recording cash receipts.</p></div></td></tr>}</tbody>
        </table>
      </div>
    </section>}

    {tab === "ledger" && <section className="space-y-4"><div className="grid gap-3 md:grid-cols-3">{data?.ledger.accounts.slice(0, 6).map((account) => <Metric key={`${account.accountCode}-${account.currency}`} label={`${account.accountCode} · ${account.accountName}`} value={cash(Math.abs(account.balance), account.currency)} note={`${cash(account.debit, account.currency)} debit · ${cash(account.credit, account.currency)} credit`} />)}</div><div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"><div className="border-b border-neutral-200 p-4"><h3 className="m-0 text-sm font-bold">Double-entry journal</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">Entries are generated once by source key and become immutable when the business date closes.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] border-collapse text-left text-xs"><thead><tr className="bg-neutral-50 text-[9px] uppercase tracking-wide text-neutral-500"><th className="p-3">Transaction</th><th className="p-3">Source</th><th className="p-3">Description</th><th className="p-3">Accounts</th><th className="p-3 text-right">Debit</th><th className="p-3 text-right">Credit</th></tr></thead><tbody>{data?.ledger.transactions.map((transaction) => <tr key={transaction.id} className="border-t border-neutral-100 align-top"><td className="p-3 font-bold">{transaction.transactionNumber}<small className="mt-1 block font-normal text-neutral-400">{time(transaction.occurredAt)}</small></td><td className="p-3 text-neutral-500">{transaction.sourceType.replaceAll("_", " ")}</td><td className="p-3">{transaction.description}</td><td className="p-3">{transaction.entries.map((entry) => <div key={entry.id} className="mb-1">{entry.accountCode} · {entry.accountName}</div>)}</td><td className="p-3 text-right tabular-nums">{cash(transaction.entries.reduce((sum, entry) => sum + Number(entry.debit), 0), transaction.currency)}</td><td className="p-3 text-right tabular-nums">{cash(transaction.entries.reduce((sum, entry) => sum + Number(entry.credit), 0), transaction.currency)}</td></tr>)}{!data?.ledger.transactions.length && <tr><td colSpan={6} className="p-10 text-center text-neutral-400">The ledger is posted when Night Audit closes this business date.</td></tr>}</tbody></table></div></div></section>}

    {tab === "tax" && <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="grid gap-4 md:grid-cols-[260px_1fr]"><Metric label="Captured tax payable" value={cash(data?.tax.total || 0, propertyCurrency)} note="Credit less debit in account 2200 for the selected date" tone="green" /><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900"><strong>Tax data quality rule</strong><p className="mb-0 mt-1">{data?.tax.note}</p></div></div><div className="mt-5 overflow-x-auto"><table className="w-full min-w-[720px] border-collapse text-left text-xs"><thead><tr className="border-y border-neutral-200 bg-neutral-50 text-[9px] uppercase tracking-wide text-neutral-500"><th className="p-3">Transaction</th><th className="p-3">Date and time</th><th className="p-3">Tax basis</th><th className="p-3 text-right">Tax payable</th></tr></thead><tbody>{data?.tax.rows.map((row) => <tr key={row.transactionNumber} className="border-b border-neutral-100"><td className="p-3 font-bold">{row.transactionNumber}</td><td className="p-3 text-neutral-500">{time(row.occurredAt)}</td><td className="p-3">{row.description}</td><td className="p-3 text-right font-bold tabular-nums">{cash(row.tax, row.currency)}</td></tr>)}{!data?.tax.rows.length && <tr><td colSpan={4} className="p-8 text-center text-neutral-400">No separately captured tax has been posted for this business date.</td></tr>}</tbody></table></div></section>}

    {tab === "nbs" && data && <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Physical beds available" value={String(data.nbs.bedsAvailable)} note="Active room units and their configured bed counts" /><Metric label="Bed-nights available" value={data.nbs.bedNightsAvailable.toLocaleString()} note={`${data.nbs.bedsAvailable} beds × ${data.nbs.reportingDays} reporting days`} /><Metric label="Bed-nights occupied" value={data.nbs.bedNightsOccupied.toLocaleString()} note={`${data.nbs.roomNightsOccupied} occupied room-nights`} tone="green" /><Metric label="Bed occupancy rate" value={`${data.nbs.bedOccupancyRate.toFixed(1)}%`} note="Occupied bed-nights ÷ available bed-nights" tone="green" /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="border-b border-neutral-200 px-5 py-4"><h3 className="m-0 text-sm font-bold">NBS monthly accommodation statistics</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">Aggregate operational statistics only; no guest-identifying data is included.</p></div>
          <div className="space-y-2 p-3 text-xs">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" /><div><p className="m-0 font-semibold text-slate-800">Reporting days in month</p><p className="mb-0 mt-0.5 text-[9px] text-slate-500">Calendar coverage for the selected reporting month</p></div></div><strong className="min-w-12 text-right text-sm tabular-nums text-slate-900">{data.nbs.reportingDays}</strong></div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><div><p className="m-0 font-semibold text-emerald-950">Domestic visitor bed-nights</p><p className="mb-0 mt-0.5 text-[9px] text-emerald-700/70">Occupied bed-nights from Tanzanian residents</p></div></div><strong className="min-w-12 text-right text-sm tabular-nums text-emerald-800">{data.nbs.domesticBedNights}</strong></div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-blue-100 bg-blue-50/70 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" /><div><p className="m-0 font-semibold text-blue-950">International visitor bed-nights</p><p className="mb-0 mt-0.5 text-[9px] text-blue-700/70">Occupied bed-nights from non-resident visitors</p></div></div><strong className="min-w-12 text-right text-sm tabular-nums text-blue-800">{data.nbs.internationalBedNights}</strong></div>
            <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border px-4 py-3 ${data.nbs.missingNationalityBedNights ? "border-amber-200 bg-amber-50" : "border-teal-100 bg-teal-50/70"}`}><div className="flex min-w-0 items-center gap-3"><span className={`h-2 w-2 shrink-0 rounded-full ${data.nbs.missingNationalityBedNights ? "bg-amber-500" : "bg-teal-500"}`} /><div><p className={`m-0 font-semibold ${data.nbs.missingNationalityBedNights ? "text-amber-950" : "text-teal-950"}`}>Bed-nights missing nationality</p><p className={`mb-0 mt-0.5 text-[9px] ${data.nbs.missingNationalityBedNights ? "text-amber-700" : "text-teal-700/70"}`}>{data.nbs.missingNationalityBedNights ? "Guest nationality records require completion" : "All occupied stays have nationality recorded"}</p></div></div><strong className={`min-w-12 text-right text-sm tabular-nums ${data.nbs.missingNationalityBedNights ? "text-amber-800" : "text-teal-800"}`}>{data.nbs.missingNationalityBedNights}</strong></div>
          </div>
        </div>
        <aside className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5"><h3 className="m-0 text-sm font-bold">Submission readiness</h3><p className="mb-0 mt-3 text-xs leading-5 text-neutral-600">{data.nbs.methodology}</p>{data.nbs.missingNationalityBedNights > 0 && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">Complete missing guest nationalities before treating this month as submission-ready.</div>}<div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[10px] leading-4 text-blue-800">Confirm every room’s physical bed count in Room setup. Guest capacity is not used as a substitute.</div></aside>
      </div>
    </section>}
  </div>;
}
