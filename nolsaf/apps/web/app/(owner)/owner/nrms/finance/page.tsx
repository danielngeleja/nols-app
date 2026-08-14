"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, BadgeCheck, BookOpen, Calculator, CalendarCheck2, CheckCircle2, ClipboardCheck, Loader2, LockKeyhole, Plus, Receipt, RefreshCw, Scale, WalletCards, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../_components/NrmsProvider";
import { serviceLabelForRole } from "../_components/ShiftPanel";

type Tab = "audit" | "cashiers" | "expenses" | "ledger" | "tax" | "nbs";
type ExpenseRow = { id: number; category: string; description: string; amount: number; currency: string; paymentMethod: string | null; incurredAt: string; recordedBy: string; voidedAt: string | null; voidReason: string | null; createdAt: string };
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
  unassignedSales: { count: number; amount: number; byMethod: Array<{ method: string; count: number; amount: number }> };
  unclassifiedTenders: Array<{ id: number; orderNumber: string; currency: string; total: number; settledAt: string; outlet: { name: string; type: string }; guest: string; room: string }>;
  ledger: { balanced: boolean; accounts: Array<{ accountCode: string; accountName: string; accountType: string; currency: string; debit: number; credit: number; balance: number }>; transactions: LedgerTransaction[] };
  tax: { total: number; note: string; rows: Array<{ transactionNumber: string; occurredAt: string; description: string; currency: string; tax: number }> };
  nbs: { month: string; reportingDays: number; bedsAvailable: number; bedNightsAvailable: number; bedNightsOccupied: number; domesticBedNights: number; internationalBedNights: number; roomNightsOccupied: number; bedOccupancyRate: number; missingNationalityBedNights: number; methodology: string };
};

const tabs: Array<{ id: Tab; label: string; icon: typeof ClipboardCheck }> = [
  { id: "audit", label: "Night Audit", icon: ClipboardCheck }, { id: "cashiers", label: "Cashier variance", icon: WalletCards },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "ledger", label: "Accounting ledger", icon: BookOpen }, { id: "tax", label: "Tax register", icon: Calculator }, { id: "nbs", label: "NBS statistics", icon: Scale },
];
const EXPENSE_CATEGORIES: Array<{ value: string; label: string }> = [
  { value: "STAFF_WAGES", label: "Staff wages" },
  { value: "UTILITIES", label: "Utilities" },
  { value: "SUPPLIES", label: "Supplies" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "MARKETING", label: "Marketing" },
  { value: "RENT", label: "Rent" },
  { value: "LICENSING", label: "Licensing" },
  { value: "OTHER", label: "Other" },
];
function expenseCategoryLabel(value: string): string { return EXPENSE_CATEGORIES.find((item) => item.value === value)?.label ?? value; }

function localDay(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function lastCompletedDay() { return localDay(new Date(Date.now() - 86_400_000)); }
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

const ACCOUNT_TYPE_ORDER = ["ASSET", "LIABILITY", "REVENUE", "EXPENSE"];
const ACCOUNT_TYPE_STYLE: Record<string, { label: string; dot: string; border: string }> = {
  ASSET: { label: "Assets", dot: "bg-blue-500", border: "border-l-blue-400" },
  LIABILITY: { label: "Liabilities", dot: "bg-amber-500", border: "border-l-amber-400" },
  REVENUE: { label: "Revenue", dot: "bg-emerald-500", border: "border-l-emerald-400" },
  EXPENSE: { label: "Expenses", dot: "bg-violet-500", border: "border-l-violet-400" },
};

function Metric({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "green" | "amber" }) {
  return <div className={`min-w-0 rounded-xl border p-4 ${tone === "green" ? "border-emerald-200 bg-emerald-50" : tone === "amber" ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white"}`}><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</p><p className="mb-0 mt-1 text-xl font-bold tabular-nums text-neutral-950">{value}</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{note}</p></div>;
}

export default function FinanceControlPage() {
  const { selectedPropertyId } = useNrms();
  const [tab, setTab] = useState<Tab>("audit");
  const [businessDate, setBusinessDate] = useState(lastCompletedDay());
  const [month, setMonth] = useState(lastCompletedDay().slice(0, 7));
  const [data, setData] = useState<FinanceData | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [counted, setCounted] = useState<Record<number, string>>({}); const [notes, setNotes] = useState<Record<number, string>>({});
  const [tenderCorrections, setTenderCorrections] = useState<Record<number, string>>({});
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [expensesLoading, setExpensesLoading] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ category: "OTHER", description: "", amount: "", incurredAt: localDay(), paymentMethod: "" });
  const [expenseVoidReason, setExpenseVoidReason] = useState<Record<number, string>>({});
  const [voidTargetId, setVoidTargetId] = useState<number | null>(null);
  const [confirmNightAudit, setConfirmNightAudit] = useState(false);

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

  const loadExpenses = useCallback(async () => {
    if (!selectedPropertyId) return;
    setExpensesLoading(true);
    try {
      const from = `${month}-01`;
      const to = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).toISOString().slice(0, 10);
      const response = await apiClient.get(`/api/owner/nrms/finance/property/${selectedPropertyId}/expenses?from=${from}&to=${to}`);
      setExpenses(response.data.expenses ?? []);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Unable to load expenses"); }
    finally { setExpensesLoading(false); }
  }, [month, selectedPropertyId]);
  useEffect(() => { if (tab === "expenses") void loadExpenses(); }, [tab, loadExpenses]);
  useEffect(() => { setConfirmNightAudit(false); }, [businessDate, selectedPropertyId]);

  const createExpense = async () => {
    if (!selectedPropertyId) return;
    const amount = Number(expenseForm.amount);
    if (!expenseForm.description.trim() || !Number.isFinite(amount) || amount <= 0) { setError("Enter a description and a positive amount before saving the expense."); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/expenses`, {
        category: expenseForm.category,
        description: expenseForm.description.trim(),
        amount,
        incurredAt: expenseForm.incurredAt,
        paymentMethod: expenseForm.paymentMethod || undefined,
      });
      setMessage("Expense recorded. It will post to the ledger when this business date's Night Audit closes.");
      setExpenseForm({ category: "OTHER", description: "", amount: "", incurredAt: localDay(), paymentMethod: "" });
      await loadExpenses();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not record this expense"); }
    finally { setBusy(false); }
  };
  const voidExpense = async (expenseId: number) => {
    const reason = (expenseVoidReason[expenseId] || "").trim();
    if (reason.length < 3) { setError("Explain why this expense is being voided (at least 3 characters)."); return; }
    setBusy(true); setError(null); setMessage(null);
    try {
      await apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/expenses/${expenseId}/void`, { reason });
      setMessage("Expense voided.");
      setVoidTargetId(null);
      setExpenseVoidReason((current) => ({ ...current, [expenseId]: "" }));
      await loadExpenses();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Could not void this expense"); }
    finally { setBusy(false); }
  };

  const action = async (request: () => Promise<unknown>, success: string) => {
    setBusy(true); setError(null); setMessage(null);
    try { await request(); setMessage(success); await load(); return true; }
    catch (cause: any) { setError(cause?.response?.data?.error || "The control action could not be completed"); return false; }
    finally { setBusy(false); }
  };
  const propertyCurrency = data?.property.currency || "Currency not set";
  const isCompletedBusinessDate = businessDate < localDay();
  const closeShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/close`, { declaredCash: Number(counted[shift.id]), closeNote: notes[shift.id]?.trim() || undefined }), "Cashier shift closed and its variance has been recorded.");
  const signOffShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/sign-off`), "Shift sales acknowledged and signed off.");
  const closeAudit = async () => {
    const closed = await action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/night-audit/close`, { businessDate }), "Night Audit completed. This date is locked, the next business day is open, and operations can continue.");
    if (closed) setConfirmNightAudit(false);
  };
  const classifyTender = (orderId: number) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/outlet-orders/${orderId}/classify`, { method: tenderCorrections[orderId] }), "Outlet payment method classified for reconciliation.");
  const canManage = data?.accessRole === "OWNER" || data?.accessRole === "MANAGER";
  useEffect(() => {
    if (tab !== "audit" || !canManage || !isCompletedBusinessDate || Boolean(data?.blockers.length) || data?.businessDay.status === "CLOSED") setConfirmNightAudit(false);
  }, [canManage, data?.blockers.length, data?.businessDay.status, isCompletedBusinessDate, tab]);
  const profitAndLoss = useMemo(() => {
    const byCurrency = new Map<string, { revenue: number; expense: number }>();
    for (const account of data?.ledger.accounts ?? []) {
      const row = byCurrency.get(account.currency) ?? { revenue: 0, expense: 0 };
      if (account.accountType === "REVENUE") row.revenue += account.credit - account.debit;
      if (account.accountType === "EXPENSE") row.expense += account.debit - account.credit;
      byCurrency.set(account.currency, row);
    }
    return [...byCurrency.entries()].map(([currency, row]) => ({ currency, revenue: row.revenue, expense: row.expense, net: row.revenue - row.expense }));
  }, [data]);
  const accountGroups = useMemo(() => {
    const groups = new Map<string, FinanceData["ledger"]["accounts"]>();
    for (const account of data?.ledger.accounts ?? []) {
      const list = groups.get(account.accountType) ?? [];
      list.push(account);
      groups.set(account.accountType, list);
    }
    for (const list of groups.values()) list.sort((a, b) => a.accountCode.localeCompare(b.accountCode));
    const known = ACCOUNT_TYPE_ORDER.filter((type) => groups.has(type));
    const rest = [...groups.keys()].filter((type) => !ACCOUNT_TYPE_ORDER.includes(type));
    return [...known, ...rest].map((type) => ({ type, accounts: groups.get(type)! }));
  }, [data]);

  if (loading && !data) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading financial controls…</div>;
  return <div className="mx-auto max-w-[1500px] space-y-4 pb-10">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="m-0 text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-700">NRMS financial control</p><h2 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Business date, cash and statutory records</h2><p className="mb-0 mt-1 text-xs text-neutral-500">One controlled flow from operational transactions to Night Audit, ledgers and NBS statistics.</p></div><button type="button" onClick={() => void load()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600"><RefreshCw className="h-4 w-4" />Refresh</button></header>
    <section className="grid gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div className="flex min-w-0 flex-wrap items-center gap-2"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><CalendarCheck2 className="h-4 w-4" /></span><div className="flex min-w-0 flex-wrap items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50/70 p-1.5"><div className="flex h-10 items-center gap-1.5"><span className="pl-1 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Business date</span><div className="w-[148px]"><DatePickerField label="Business date" value={businessDate} onChangeAction={setBusinessDate} widthClassName="!w-full" size="sm" twoMonths={false} allowPast /></div></div><span className="hidden h-6 w-px bg-neutral-200 sm:block" aria-hidden /><div className="flex h-10 items-center gap-1.5"><span className="text-[9px] font-bold uppercase tracking-wide text-neutral-400">NBS month</span><div className="w-[132px]"><DatePickerField label="NBS reporting month" value={`${month}-01`} onChangeAction={(next) => setMonth(next.slice(0, 7))} widthClassName="!w-full" size="sm" twoMonths={false} allowPast display="month" /></div></div></div></div><div className="grid grid-cols-2 gap-2 sm:flex"><div className={`flex min-w-[142px] items-center gap-2 rounded-xl border px-3 py-2 ${data?.businessDay.status === "CLOSED" ? "border-neutral-800 bg-neutral-900 text-white" : "border-emerald-100 bg-emerald-50 text-emerald-800"}`}><LockKeyhole className="h-4 w-4 shrink-0" /><div><p className="m-0 text-[8px] font-bold uppercase tracking-wide opacity-60">Business date</p><p className="mb-0 mt-0.5 text-[10px] font-bold">{data?.businessDay.status.replaceAll("_", " ")}</p></div></div><div className={`flex min-w-[142px] items-center gap-2 rounded-xl border px-3 py-2 ${data?.ledger.balanced ? "border-emerald-100 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}><CheckCircle2 className="h-4 w-4 shrink-0" /><div><p className="m-0 text-[8px] font-bold uppercase tracking-wide opacity-60">Ledger control</p><p className="mb-0 mt-0.5 text-[10px] font-bold">{data?.ledger.balanced ? "Balanced" : "Review required"}</p></div></div></div></section>
    {(error || message) && <div className={`rounded-xl border px-4 py-3 text-xs font-semibold ${error ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}
    <nav className="grid grid-cols-2 gap-1 rounded-2xl border border-neutral-200 bg-white p-1 shadow-sm sm:grid-cols-5">{tabs.filter((item) => data?.accessRole !== "FRONT_DESK" || ["audit", "cashiers"].includes(item.id)).map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border-0 px-2 text-[11px] font-bold ${tab === item.id ? "bg-[#073c35] text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-50"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>

    {tab === "audit" && (
      <div className="grid gap-4 xl:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="m-0 text-base font-bold">Night Audit checklist</h3>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Every blocking item must be cleared. There is no override or bypass.</p>
            </div>
            <CalendarCheck2 className="h-6 w-6 text-emerald-700" />
          </div>
          <div className="mt-4 space-y-2">
            {data?.businessDay.status === "CLOSED" ? (
              <div className="flex gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-neutral-700 shadow-sm ring-1 ring-neutral-200"><LockKeyhole className="h-4 w-4" /></span>
                <div>
                  <p className="m-0 text-xs font-bold text-neutral-900">This business date is already closed</p>
                  <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-600">The ledger and Night Audit are locked for this date. Operations continue on the next open business date; any later correction must be recorded there with its audit reason.</p>
                  {data.businessDay.closedAt && <p className="mb-0 mt-1.5 text-[9px] font-semibold text-neutral-400">Closed {time(data.businessDay.closedAt)}</p>}
                </div>
              </div>
            ) : !isCompletedBusinessDate ? (
              <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                <div><p className="m-0 text-xs font-bold text-amber-900">This business date is still operating</p><p className="mb-0 mt-1 text-[10px] text-amber-700">Choose yesterday or an earlier open date. Today cannot be locked while guests and outlets are still operating.</p></div>
              </div>
            ) : data?.blockers.length ? (
              data.blockers.map((blocker) => <div key={blocker.code} className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" /><div><p className="m-0 text-xs font-bold text-red-800">{blocker.message}</p><p className="mb-0 mt-1 text-[10px] text-red-600">Resolve this in the related operational workspace, then refresh this control.</p></div></div>)
            ) : (
              <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4"><CheckCircle2 className="h-5 w-5 text-emerald-700" /><div><p className="m-0 text-xs font-bold text-emerald-800">All closing controls passed</p><p className="mb-0 mt-1 text-[10px] text-emerald-700">NRMS is ready to post balanced entries and lock this completed business date.</p></div></div>
            )}
          </div>

          {confirmNightAudit && canManage && isCompletedBusinessDate && !data?.blockers.length && data?.businessDay.status !== "CLOSED" && (
            <div className="mt-4 rounded-xl border border-solid border-amber-300 bg-amber-50 p-4" role="region" aria-live="polite" aria-labelledby="night-audit-confirmation-title">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-amber-700 shadow-sm ring-1 ring-amber-200"><LockKeyhole className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <p id="night-audit-confirmation-title" className="m-0 text-sm font-bold text-amber-950">Close business date {businessDate}?</p>
                  <p className="mb-0 mt-1 text-xs leading-5 text-amber-900">Review the impact before confirming. This is a controlled financial close, not a temporary status change.</p>
                  <ul className="mb-0 mt-3 space-y-1.5 pl-4 text-[11px] leading-4 text-amber-900">
                    <li>Balanced operational entries will be posted to the accounting ledger and the Night Audit report will be stored.</li>
                    <li>This completed business date will be locked. Any later correction must be recorded on an open business date with its audit reason.</li>
                    <li>The next business date will open immediately so check-ins, checkouts, payments and outlet operations can continue.</li>
                  </ul>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => void closeAudit()} disabled={busy} className="inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-amber-700 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50">
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LockKeyhole className="h-3.5 w-3.5" />} Yes, post ledger and close
                    </button>
                    <button type="button" onClick={() => setConfirmNightAudit(false)} disabled={busy} className="min-h-10 cursor-pointer rounded-lg border border-solid border-amber-300 bg-white px-4 text-xs font-bold text-amber-900 transition hover:bg-amber-100 disabled:opacity-50">Not yet</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => setConfirmNightAudit(true)}
            disabled={!canManage || busy || !isCompletedBusinessDate || Boolean(data?.blockers.length) || data?.businessDay.status === "CLOSED" || confirmNightAudit}
            className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-xs font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400"
          >
            <LockKeyhole className="h-4 w-4" />
            {data?.businessDay.status === "CLOSED" ? "Business date closed" : !isCompletedBusinessDate ? "Choose a completed business date" : !canManage ? "Manager approval required to close" : confirmNightAudit ? "Review the impact above" : "Review closing impact"}
          </button>
        </section>
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
          <h3 className="m-0 text-sm font-bold">Audit history</h3>
          <div className="mt-3 space-y-2">
            {data?.businessDay.audits.map((audit) => <div key={audit.id} className="rounded-xl border border-neutral-200 p-3"><div className="flex items-center justify-between gap-3"><strong className="text-xs">{audit.reportNumber}</strong><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${audit.status === "CLOSED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{audit.status}</span></div><p className="mb-0 mt-1 text-[10px] text-neutral-500">{time(audit.completedAt || audit.startedAt)}</p></div>)}
            {!data?.businessDay.audits.length && <p className="text-xs text-neutral-400">No Night Audit has been attempted for this date.</p>}
          </div>
        </section>
      </div>
    )}

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
          </tr>)}{Boolean(data?.unassignedSales.count) && <tr className="border-t border-neutral-100 bg-amber-50/40 text-xs">
            <td className="p-2.5 pl-5 font-bold">Other sales<small className="mt-0.5 block font-normal text-amber-700">Settled outside any shift</small></td>
            <td className="p-2.5 text-neutral-400">—</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-400">—</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-400">—</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-400">—</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-400">—</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{cash(data!.unassignedSales.byMethod.find((row) => row.method === "CASH")?.amount ?? 0, data!.property.currency || "TZS")}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{cash(data!.unassignedSales.byMethod.find((row) => row.method === "MOBILE_MONEY")?.amount ?? 0, data!.property.currency || "TZS")}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{cash(data!.unassignedSales.byMethod.find((row) => row.method === "BANK")?.amount ?? 0, data!.property.currency || "TZS")}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-600">{cash(data!.unassignedSales.byMethod.find((row) => row.method === "CARD")?.amount ?? 0, data!.property.currency || "TZS")}</td>
            <td className="p-2.5 text-right tabular-nums text-neutral-400">—</td>
            <td className="p-2.5 pr-5 text-[10px] leading-4 text-amber-800">{data!.unassignedSales.count} sale{data!.unassignedSales.count === 1 ? "" : "s"} · {cash(data!.unassignedSales.amount, data!.property.currency || "TZS")} total, settled by an owner or manager with no open shift. No cashier is accountable for this cash.</td>
          </tr>}{!data?.shifts.length && !data?.unassignedSales.count && <tr><td colSpan={12} className="border-t border-neutral-100 p-0"><div className="flex min-h-36 flex-col items-center justify-center px-6 py-8 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400"><WalletCards className="h-4 w-4" /></span><p className="mb-0 mt-3 text-xs font-bold text-neutral-600">No cashier shift for this business date</p><p className="mb-0 mt-1 max-w-sm text-[10px] leading-4 text-neutral-400">Attendants open their shift from their own Shift &amp; cash page before recording cash receipts.</p></div></td></tr>}</tbody>
        </table>
      </div>
    </section>}

    {tab === "expenses" && <div className="grid gap-4 xl:grid-cols-[.7fr_1.3fr]">
      <section id="nrms-expense-form" className="h-fit min-w-0 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <style>{`#nrms-expense-form, #nrms-expense-form * { box-sizing: border-box; }`}</style>
        <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700"><Receipt className="h-4 w-4" /></span><div><h3 className="m-0 text-base font-bold">Record an expense</h3><p className="mb-0 mt-1 text-xs text-neutral-500">Posts to the general ledger when that business date's Night Audit closes, the same way charges and payments do.</p></div></div>
        <div className="mt-4 space-y-3">
          <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Category</label><select value={expenseForm.category} onChange={(event) => setExpenseForm((current) => ({ ...current, category: event.target.value }))} className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 outline-none focus:border-emerald-500">{EXPENSE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Description</label><input type="text" value={expenseForm.description} onChange={(event) => setExpenseForm((current) => ({ ...current, description: event.target.value }))} maxLength={300} placeholder="e.g. July electricity bill" className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs text-neutral-800 outline-none focus:border-emerald-500" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Amount ({propertyCurrency})</label><input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0.00" className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs tabular-nums text-neutral-800 outline-none focus:border-emerald-500" /></div>
            <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Date</label><DatePickerField label="Expense date" value={expenseForm.incurredAt} onChangeAction={(next) => setExpenseForm((current) => ({ ...current, incurredAt: next }))} widthClassName="!w-full" size="sm" twoMonths={false} allowPast /></div>
          </div>
          <div><label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-neutral-400">Payment method</label><select value={expenseForm.paymentMethod} onChange={(event) => setExpenseForm((current) => ({ ...current, paymentMethod: event.target.value }))} className="h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 outline-none focus:border-emerald-500"><option value="">Accrued (not yet paid)</option><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="BANK">Bank transfer</option><option value="CARD">Card</option><option value="OTHER">Other</option></select><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-400">Leave as accrued if this is owed to a supplier rather than paid out of till or account today.</p></div>
          <button type="button" onClick={() => void createExpense()} disabled={!canManage || busy} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-xs font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400"><Plus className="h-4 w-4" />{!canManage ? "Manager approval required" : "Save expense"}</button>
        </div>
      </section>

      <section id="nrms-expense-list" className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <style>{`#nrms-expense-list, #nrms-expense-list * { box-sizing: border-box; }`}</style>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4"><div><h3 className="m-0 text-base font-bold">Expenses this month</h3><p className="mb-0 mt-1 text-xs text-neutral-500">{month}, by date recorded.</p></div><span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[10px] font-bold text-neutral-500">{expenses.filter((row) => !row.voidedAt).length} active</span></header>
        {expensesLoading && !expenses.length ? <div className="flex min-h-40 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading expenses…</div> : (
          <div className="divide-y divide-neutral-100">
            {expenses.map((row) => (
              <div key={row.id} className={`px-5 py-3 transition-colors ${row.voidedAt ? "bg-neutral-50/70" : "hover:bg-neutral-50/60"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className={`m-0 truncate text-xs font-bold ${row.voidedAt ? "text-neutral-400 line-through" : "text-neutral-900"}`}>{row.description}</p>
                    <p className="mb-0 mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] leading-none text-neutral-400">
                      <span className="rounded-full bg-neutral-100 px-1.5 py-1 font-bold text-neutral-500">{expenseCategoryLabel(row.category)}</span>
                      <span>{new Date(row.incurredAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
                      <span aria-hidden>·</span>
                      <span>{row.paymentMethod ? row.paymentMethod.replace(/_/g, " ").toLowerCase() : "accrued, unpaid"}</span>
                      <span aria-hidden>·</span>
                      <span className="truncate">{row.recordedBy}</span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <strong className={`whitespace-nowrap text-sm tabular-nums ${row.voidedAt ? "text-neutral-400 line-through" : "text-neutral-900"}`}>{cash(row.amount, row.currency)}</strong>
                    {!row.voidedAt && canManage && voidTargetId !== row.id && <button type="button" onClick={() => setVoidTargetId(row.id)} title="Void this expense" aria-label={`Void ${row.description}`} className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-300 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"><XCircle className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
                {row.voidedAt && <p className="mb-0 mt-1.5 text-[10px] font-bold text-red-500">Voided: {row.voidReason}</p>}
                {!row.voidedAt && canManage && voidTargetId === row.id && (
                  <div className="mt-2.5 rounded-lg border border-red-100 bg-red-50/50 p-2.5">
                    <p className="mb-2 mt-0 text-[10px] font-bold uppercase tracking-wide text-red-500">Why is this being voided?</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <input type="text" autoFocus value={expenseVoidReason[row.id] ?? ""} onChange={(event) => setExpenseVoidReason((current) => ({ ...current, [row.id]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") void voidExpense(row.id); if (event.key === "Escape") setVoidTargetId(null); }} placeholder="e.g. duplicate entry, wrong amount" className="h-8 min-w-[160px] flex-1 rounded-md border border-red-200 bg-white px-2.5 text-[11px] text-neutral-700 outline-none focus:border-red-400" />
                      <button type="button" onClick={() => void voidExpense(row.id)} disabled={busy} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border-0 bg-red-600 px-3 text-[10px] font-bold text-white hover:bg-red-700 disabled:bg-neutral-200 disabled:text-neutral-400"><XCircle className="h-3.5 w-3.5" />Void expense</button>
                      <button type="button" onClick={() => setVoidTargetId(null)} className="inline-flex h-8 shrink-0 items-center rounded-md border border-neutral-200 bg-white px-3 text-[10px] font-bold text-neutral-500 hover:bg-neutral-50">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
            {!expensesLoading && !expenses.length && <div className="flex min-h-36 flex-col items-center justify-center px-6 py-8 text-center"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400"><Receipt className="h-4 w-4" /></span><p className="mb-0 mt-3 text-xs font-bold text-neutral-600">No expenses recorded this month</p></div>}
          </div>
        )}
      </section>
    </div>}

    {tab === "ledger" && <section className="space-y-4">
      {profitAndLoss.length > 0 && <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="m-0 text-sm font-bold">Profit and loss</h3>
        <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Revenue recognized less expenses posted for the selected range, including staff wages recorded on the Expenses tab. Stock cost and depreciation are not tracked yet, so this is not a complete P&amp;L.</p>
        <div className="mt-3 space-y-3">{profitAndLoss.map((row) => <div key={row.currency} className="grid gap-3 sm:grid-cols-3">
          <Metric label={`Revenue (${row.currency})`} value={cash(row.revenue, row.currency)} note="Room, restaurant, bar and other service revenue" tone="green" />
          <Metric label={`Expenses (${row.currency})`} value={cash(row.expense, row.currency)} note="Platform fees and other posted costs" tone="amber" />
          <Metric label={`Net (${row.currency})`} value={cash(row.net, row.currency)} note={row.net >= 0 ? "Profit for the range" : "Loss for the range"} tone={row.net >= 0 ? "green" : "amber"} />
        </div>)}</div>
      </div>}
      <div className="space-y-5">
        {accountGroups.map((group) => {
          const style = ACCOUNT_TYPE_STYLE[group.type] ?? { label: group.type, dot: "bg-neutral-400", border: "border-l-neutral-300" };
          return (
            <div key={group.type}>
              <div className="mb-2.5 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${style.dot}`} /><p className="m-0 text-[13px] font-bold text-neutral-900">{style.label}</p><span className="text-[11px] text-neutral-400">{group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}</span></div>
              <div className="grid gap-3 md:grid-cols-3">
                {group.accounts.map((account) => (
                  <div key={`${account.accountCode}-${account.currency}`} className={`min-w-0 rounded-xl border border-l-4 bg-white p-4 ${style.border}`}>
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{account.accountCode} · {account.accountName}</p>
                    <p className="mb-0 mt-1 text-xl font-bold tabular-nums text-neutral-950">{cash(Math.abs(account.balance), account.currency)}</p>
                    <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{cash(account.debit, account.currency)} debit · {cash(account.credit, account.currency)} credit</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="border-b border-neutral-200 p-4"><h3 className="m-0 text-sm font-bold">Double-entry journal</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">Entries are generated once by source key and become immutable when the business date closes. Debit and credit match on every transaction &mdash; that balance is what makes the ledger correct.</p></div>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="min-w-[900px] border-collapse text-left text-xs">
            <thead><tr className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
              <th className="sticky left-0 z-10 whitespace-nowrap border-b border-r border-neutral-200 bg-neutral-50 p-3">Transaction</th>
              <th className="whitespace-nowrap border-b border-neutral-200 bg-neutral-50 p-3">Source</th>
              <th className="min-w-[180px] border-b border-neutral-200 bg-neutral-50 p-3">Description</th>
              <th className="min-w-[180px] border-b border-neutral-200 bg-neutral-50 p-3">Accounts</th>
              <th className="border-b border-l border-blue-100 bg-blue-50/70 p-3 text-right text-blue-800">Debit</th>
              <th className="border-b border-l border-violet-100 bg-violet-50/70 p-3 text-right text-violet-800">Credit</th>
            </tr></thead>
            <tbody>{data?.ledger.transactions.map((transaction) => <tr key={transaction.id} className="group border-t border-neutral-100 align-top transition-colors hover:bg-neutral-50/70">
              <td className="sticky left-0 z-10 whitespace-nowrap border-r border-neutral-200 bg-white p-3 font-bold text-neutral-900 transition-colors group-hover:bg-neutral-50">{transaction.transactionNumber}<small className="mt-1 block font-normal text-neutral-400">{time(transaction.occurredAt)}</small></td>
              <td className="whitespace-nowrap p-3 text-neutral-500">{transaction.sourceType.replaceAll("_", " ")}</td>
              <td className="min-w-[180px] max-w-[280px] p-3 text-neutral-700">{transaction.description}</td>
              <td className="min-w-[180px] max-w-[240px] p-3 text-neutral-500">{transaction.entries.map((entry) => <div key={entry.id} className="mb-1">{entry.accountCode} · {entry.accountName}</div>)}</td>
              <td className="border-l border-blue-100 bg-blue-50/40 p-3 text-right font-bold tabular-nums text-blue-800">{cash(transaction.entries.reduce((sum, entry) => sum + Number(entry.debit), 0), transaction.currency)}</td>
              <td className="border-l border-violet-100 bg-violet-50/40 p-3 text-right font-bold tabular-nums text-violet-800">{cash(transaction.entries.reduce((sum, entry) => sum + Number(entry.credit), 0), transaction.currency)}</td>
            </tr>)}{!data?.ledger.transactions.length && <tr><td colSpan={6} className="p-10 text-center text-neutral-400">The ledger is posted when Night Audit closes this business date.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </section>}

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
