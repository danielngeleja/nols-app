"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, BadgeCheck, BedDouble, BookOpen, Calculator, CalendarCheck2, CheckCircle2, ChevronLeft, ChevronRight, Clock3, ClipboardCheck, Loader2, LockKeyhole, LogIn, LogOut, Plus, Receipt, RefreshCw, Scale, Settings2, WalletCards, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { useNrms } from "../_components/NrmsProvider";
import FiscalReceiptsCard from "../_components/FiscalReceiptsCard";
import { serviceLabelForRole } from "../_components/ShiftPanel";
import NrmsModalFrame from "../_components/NrmsModalFrame";

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
type NightAuditReview = {
  generatedAt: string;
  window: { startedAt: string; through: string };
  controls: { passed: boolean; blockers: Blocker[]; warnings: Blocker[] };
  operations: { arrivals: number; departures: number; reservationsCreated: number; inHouseAtReview: number };
  cashiers: { total: number; open: number; closed: number; signedOff: number; expectedCash: number; declaredCash: number; variance: number };
  ledger: {
    transactionCount: number;
    stockMovementsPosted: number;
    debitTotal: number;
    creditTotal: number;
    balanced: boolean;
    bySource: Array<{ sourceType: string; count: number; debit: number; credit: number }>;
    activities: Array<{ sourceType: string; description: string; currency: string; occurredAt: string; debit: number; credit: number }>;
  };
};
type FinanceData = {
  property: { id: number; title: string; currency: string | null }; accessRole: "OWNER" | "MANAGER" | "FRONT_DESK"; businessDate: string; month: string;
  nightAuditPolicy: { closeTime: string; timezone: string; activeBusinessDate: string; latestClosableDate: string; nextCloseAt: string; canCloseSelectedDate: boolean };
  unclosedBusinessDays: Array<{ id: number; businessDate: string; status: "OPEN" | "CLOSING"; openedAt: string; canClose: boolean }>;
  nightAuditReview: NightAuditReview | null;
  businessDay: { id: number | null; status: string; openedAt?: string; closedAt?: string | null; audits: Array<{ id: number; reportNumber: string; status: string; startedAt: string; completedAt: string | null; summary: any }> };
  blockers: Blocker[]; warnings: Blocker[]; shifts: Shift[];
  unassignedSales: { count: number; amount: number; byMethod: Array<{ method: string; count: number; amount: number }> };
  unclassifiedTenders: Array<{ id: number; orderNumber: string; currency: string; total: number; settledAt: string; outlet: { name: string; type: string }; guest: string; room: string }>;
  ledger: { loaded: boolean; balanced: boolean; accounts: Array<{ accountCode: string; accountName: string; accountType: string; currency: string; debit: number; credit: number; balance: number }>; transactions: LedgerTransaction[] };
  tax: { total: number; note: string; rows: Array<{ transactionNumber: string; occurredAt: string; description: string; currency: string; tax: number }> };
  nbs: { month: string; reportingDays: number; bedsAvailable: number; bedNightsAvailable: number; bedNightsOccupied: number; domesticBedNights: number; internationalBedNights: number; roomNightsOccupied: number; bedOccupancyRate: number; missingNationalityBedNights: number; methodology: string };
  stock?: { tracked: boolean; value: number };
};

/** Food and beverage revenue against its cost (stock control milestone 5). */
const FNB_REVENUE_CODES = ["4200", "4210", "4220"];
const COGS_CODES = ["5010", "5020"];
const STOCK_LOSS_CODES = ["5030", "5040", "5050", "5060"];

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
/** Step a YYYY-MM-DD business date without tripping over month ends. */
function shiftDay(day: string, delta: number) {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(Date.UTC(y!, m! - 1, d! + delta, 12)));
}
/** One date format across the page: "27 Aug 2026", matching the picker. */
function dayLabel(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!, 12)).toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" });
}
function cash(value: number, currency: string) { return `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function time(value?: string | null) { return value ? new Date(value).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) + " EAT" : "Not recorded"; }
function tenderAmount(shift: Shift, method: string): number { return shift.closeSummary?.mySales.byMethod.find((row) => row.method === method)?.amount ?? 0; }
const KNOWN_TENDER_METHODS = ["CASH", "MOBILE_MONEY", "BANK", "CARD"];
function otherTenderAmount(shift: Shift): number { return (shift.closeSummary?.mySales.byMethod ?? []).filter((row) => !KNOWN_TENDER_METHODS.includes(row.method)).reduce((sum, row) => sum + row.amount, 0); }
// Distinguishes a cashier's outlet at a glance so a long shift list doesn't read as one undifferentiated block.
function shiftRowTone(shift: Shift): string {
  if (shift.assignment?.role === "BAR") return "bg-violet-50/50 [&>td:first-child]:shadow-[inset_2px_0_0_0_#a78bfa]";
  if (shift.assignment?.role === "RESTAURANT") return "bg-sky-50/50 [&>td:first-child]:shadow-[inset_2px_0_0_0_#38bdf8]";
  return "";
}

const ACCOUNT_TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];
const ACCOUNT_TYPE_STYLE: Record<string, { label: string; dot: string; border: string }> = {
  ASSET: { label: "Assets", dot: "bg-blue-500", border: "shadow-[inset_3px_0_0_0_#60a5fa]" },
  LIABILITY: { label: "Liabilities", dot: "bg-amber-500", border: "shadow-[inset_3px_0_0_0_#fbbf24]" },
  REVENUE: { label: "Revenue", dot: "bg-emerald-500", border: "shadow-[inset_3px_0_0_0_#34d399]" },
  EXPENSE: { label: "Expenses", dot: "bg-violet-500", border: "shadow-[inset_3px_0_0_0_#a78bfa]" },
  EQUITY: { label: "Equity", dot: "bg-slate-500", border: "shadow-[inset_3px_0_0_0_#94a3b8]" },
};

/**
 * The three business-day states, told apart. The chip used to be
 * `status === "CLOSED" ? dark : emerald`, so NOT_OPENED, which means the day
 * has not started and Night Audit cannot run, rendered the same confident
 * green as a day that is trading normally.
 */
const BUSINESS_DAY_STATE: Record<string, { label: string; skin: string; note: string }> = {
  NOT_OPENED: { label: "Not opened", skin: "bg-amber-50 text-amber-800 ring-amber-300", note: "No business day exists for this date yet. Night Audit cannot run until it is opened." },
  OPEN: { label: "Open", skin: "bg-emerald-50 text-emerald-800 ring-emerald-200", note: "The day is trading. Sales and payments post to this date." },
  CLOSING: { label: "Closing", skin: "bg-amber-50 text-amber-800 ring-amber-300", note: "Night Audit is currently closing this business date." },
  CLOSED: { label: "Closed", skin: "bg-neutral-900 text-white ring-neutral-900", note: "Night Audit has run. This date is finalised and locked." },
};

/** Mirrors the workspace sidebar's Finance children, in the same order. */
const FINANCE_TABS: Array<{ id: Tab; label: string; icon: typeof WalletCards }> = [
  { id: "audit", label: "Night Audit", icon: CalendarCheck2 },
  { id: "cashiers", label: "Cashier variance", icon: WalletCards },
  { id: "expenses", label: "Expenses", icon: Receipt },
  { id: "ledger", label: "Accounting ledger", icon: BookOpen },
  { id: "tax", label: "Tax register", icon: Calculator },
  { id: "nbs", label: "NBS statistics", icon: Scale },
];

function Metric({ label, value, note, tone = "neutral" }: { label: string; value: string; note: string; tone?: "neutral" | "green" | "amber" }) {
  return <div className={`min-w-0 rounded-xl p-4 ring-1 ${tone === "green" ? "ring-emerald-200 bg-emerald-50" : tone === "amber" ? "ring-amber-200 bg-amber-50" : "ring-neutral-200 bg-white"}`}><p className="m-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500">{label}</p><p className="mb-0 mt-1 text-xl font-bold tabular-nums text-neutral-950">{value}</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{note}</p></div>;
}

function codeLabel(value: string) {
  return value.split("_").map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(" ");
}

function ReviewMetric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <div className="rounded-xl bg-neutral-50 p-3 ring-1 ring-neutral-200"><div className="flex items-center gap-2 text-neutral-500">{icon}<span className="text-[9px] font-bold uppercase tracking-[0.12em]">{label}</span></div><p className="mb-0 mt-2 text-lg font-extrabold tabular-nums text-neutral-950">{value}</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{note}</p></div>;
}

type AuditTone = "neutral" | "good" | "warn" | "bad";
const AUDIT_TONE_ICON: Record<AuditTone, React.ReactNode> = {
  neutral: null,
  good: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-label="OK" />,
  warn: <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Needs review" />,
  bad: <XCircle className="h-4 w-4 text-red-600" aria-label="Problem" />,
};

/** Night Audit summary tile: the corner mark says whether the figure is fine, not just what it is. */
function AuditTile({ icon, label, value, note, tone = "neutral" }: { icon: React.ReactNode; label: string; value: string; note: string; tone?: AuditTone }) {
  return <div className="min-w-0 rounded-xl bg-white p-3.5 ring-1 ring-neutral-200">
    <div className="flex items-center justify-between gap-2"><span className="flex items-center gap-2 text-neutral-500">{icon}<span className="text-[9px] font-bold uppercase tracking-[0.12em]">{label}</span></span>{AUDIT_TONE_ICON[tone]}</div>
    <p className="mb-0 mt-2 truncate text-lg font-extrabold tabular-nums text-neutral-950">{value}</p>
    <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">{note}</p>
  </div>;
}

type AuditStepState = "done" | "current" | "blocked" | "pending";
const AUDIT_STEP_SKIN: Record<AuditStepState, { bar: string; dot: string; label: string }> = {
  done: { bar: "bg-emerald-600", dot: "bg-emerald-600 text-white", label: "text-neutral-900" },
  current: { bar: "bg-sky-500", dot: "bg-sky-500 text-white", label: "text-neutral-900" },
  blocked: { bar: "bg-red-500", dot: "bg-red-500 text-white", label: "text-red-800" },
  pending: { bar: "bg-neutral-200", dot: "bg-neutral-200 text-neutral-500", label: "text-neutral-400" },
};

export default function FinanceControlPage() {
  const { selectedPropertyId } = useNrms();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>("audit");
  const [businessDate, setBusinessDate] = useState(() => searchParams.get("view") === "cashiers" ? localDay() : lastCompletedDay());
  const [month, setMonth] = useState(() => (searchParams.get("view") === "cashiers" ? localDay() : lastCompletedDay()).slice(0, 7));
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
  const [acknowledgeFiscalBacklog, setAcknowledgeFiscalBacklog] = useState(false);
  const [editingAuditTime, setEditingAuditTime] = useState(false);
  const [auditTimeDraft, setAuditTimeDraft] = useState("20:00");

  useEffect(() => {
    const view = searchParams.get("view");
    if (view === "audit" || view === "cashiers" || view === "expenses" || view === "ledger" || view === "tax" || view === "nbs") {
      setTab(view);
      setError(null);
      setMessage(null);
    }
    const requestedBusinessDate = searchParams.get("businessDate");
    if (requestedBusinessDate && /^\d{4}-\d{2}-\d{2}$/.test(requestedBusinessDate) && requestedBusinessDate <= localDay()) {
      setBusinessDate(requestedBusinessDate);
      setMonth(requestedBusinessDate.slice(0, 7));
    } else if (view === "cashiers") {
      const today = localDay();
      setBusinessDate(today);
      setMonth(today.slice(0, 7));
    } else if (view === "audit") {
      const completed = lastCompletedDay();
      setBusinessDate(completed);
      setMonth(completed.slice(0, 7));
    }
  }, [searchParams]);
  useEffect(() => {
    if (data?.accessRole === "FRONT_DESK" && !["audit", "cashiers"].includes(tab)) setTab("audit");
  }, [data?.accessRole, tab]);
  useEffect(() => {
    if (!editingAuditTime && data?.nightAuditPolicy.closeTime) setAuditTimeDraft(data.nightAuditPolicy.closeTime);
  }, [data?.nightAuditPolicy.closeTime, editingAuditTime]);

  const load = useCallback(async (silent = false) => {
    if (!selectedPropertyId) return; if (!silent) setLoading(true); setError(null);
    try { const response = await apiClient.get(`/api/owner/nrms/finance/property/${selectedPropertyId}?businessDate=${businessDate}&month=${month}&view=${tab}`); setData(response.data); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Unable to load financial control records"); }
    finally { if (!silent) setLoading(false); }
  }, [businessDate, month, selectedPropertyId, tab]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    // Only the two operational finance tabs need a live safety refresh. The
    // full payload also contains ledger, tax and NBS data, so do not reload it
    // every few seconds or while someone is reading a historical tab.
    if (!["audit", "cashiers"].includes(tab)) return;
    const refreshTimer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load(true);
    }, 60_000);
    return () => window.clearInterval(refreshTimer);
  }, [load, tab]);

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
  useEffect(() => {
    setConfirmNightAudit(false);
    setAcknowledgeFiscalBacklog(false);
  }, [businessDate, selectedPropertyId]);

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
  const fiscalBacklogWarning = data?.warnings.find((warning) => warning.code === "FISCAL_RECEIPTS_PENDING") ?? null;
  const canCloseSelectedDate = Boolean(data?.nightAuditPolicy.canCloseSelectedDate);
  const latestAuditDate = data?.nightAuditPolicy.latestClosableDate ?? lastCompletedDay();
  const unclosedBusinessDays = data?.unclosedBusinessDays ?? [];
  const oldestUnclosedDay = unclosedBusinessDays[0] ?? null;
  const closeShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/close`, { declaredCash: Number(counted[shift.id]), closeNote: notes[shift.id]?.trim() || undefined }), "Cashier shift closed and its variance has been recorded.");
  const reconcileShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/reconcile`, { declaredCash: Number(counted[shift.id]), closeNote: notes[shift.id]?.trim() || undefined }), "Physical cash count recorded. Review and sign off this shift.");
  const signOffShift = (shift: Shift) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/shifts/${shift.id}/sign-off`), "Shift sales acknowledged and signed off.");
  const closeAudit = async () => {
    const closed = await action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/night-audit/close`, {
      businessDate,
      acknowledgeFiscalBacklog: fiscalBacklogWarning ? acknowledgeFiscalBacklog : false,
    }), "Night Audit completed. This date is locked, the next business day is open, and operations can continue.");
    if (closed) {
      setConfirmNightAudit(false);
      setAcknowledgeFiscalBacklog(false);
      try {
        const response = await apiClient.get<{ finance: { targetBusinessDate: string | null } }>(`/api/nrms/operations/property/${selectedPropertyId}/attention`, { params: { fresh: 1 } });
        const nextDate = response.data.finance.targetBusinessDate;
        if (nextDate && nextDate !== businessDate) {
          setBusinessDate(nextDate);
          setMonth(nextDate.slice(0, 7));
          router.replace(`/owner/nrms/finance?view=audit&businessDate=${encodeURIComponent(nextDate)}`);
        }
      } catch { /* the sidebar refresh remains the fallback */ }
    }
  };
  const saveAuditTime = async () => {
    if (!selectedPropertyId || !/^([01]\d|2[0-3]):[0-5]\d$/.test(auditTimeDraft)) {
      setError("Choose a valid Night Audit time.");
      return;
    }
    const saved = await action(
      () => apiClient.put(`/api/owner/nrms/finance/property/${selectedPropertyId}/night-audit/settings`, { closeTime: auditTimeDraft }),
      `Night Audit boundary updated to ${auditTimeDraft} EAT.`,
    );
    if (saved) setEditingAuditTime(false);
  };
  const classifyTender = (orderId: number) => action(() => apiClient.post(`/api/owner/nrms/finance/property/${selectedPropertyId}/outlet-orders/${orderId}/classify`, { method: tenderCorrections[orderId] }), "Outlet payment method classified for reconciliation.");
  const canManage = data?.accessRole === "OWNER" || data?.accessRole === "MANAGER";
  const blockerAction = (code: string): { label: string; run: () => void } | null => {
    if (code === "OPEN_CASHIER_SHIFTS") return { label: "Review shift", run: () => router.push(`/owner/nrms/finance?view=cashiers&businessDate=${encodeURIComponent(businessDate)}`) };
    if (code === "UNRECONCILED_CASHIER_SHIFTS") return { label: "Reconcile shifts", run: () => router.push(`/owner/nrms/finance?view=cashiers&businessDate=${encodeURIComponent(businessDate)}`) };
    if (code === "OPEN_OUTLET_ORDERS") return { label: "Review orders", run: () => router.push("/owner/nrms/orders") };
    if (code === "DUE_OUT_GUESTS") return { label: "Review departures", run: () => router.push("/owner/nrms") };
    if (code === "UNCLASSIFIED_TENDERS") return { label: "Classify tenders", run: () => document.getElementById("unclassified-tenders")?.scrollIntoView({ behavior: "smooth", block: "start" }) };
    return null;
  };
  useEffect(() => {
    if (tab !== "audit" || !canManage || !canCloseSelectedDate || data?.businessDay.status === "CLOSED") setConfirmNightAudit(false);
  }, [canCloseSelectedDate, canManage, data?.businessDay.status, tab]);
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
  const grossProfit = useMemo(() => {
    const byCurrency = new Map<string, { revenue: number; cogs: number; losses: number }>();
    for (const account of data?.ledger.accounts ?? []) {
      const row = byCurrency.get(account.currency) ?? { revenue: 0, cogs: 0, losses: 0 };
      if (FNB_REVENUE_CODES.includes(account.accountCode)) row.revenue += account.credit - account.debit;
      if (COGS_CODES.includes(account.accountCode)) row.cogs += account.debit - account.credit;
      if (STOCK_LOSS_CODES.includes(account.accountCode)) row.losses += account.debit - account.credit;
      byCurrency.set(account.currency, row);
    }
    return [...byCurrency.entries()]
      .filter(([, row]) => row.cogs !== 0 || row.losses !== 0)
      .map(([currency, row]) => {
        const gross = row.revenue - row.cogs;
        return { currency, ...row, gross, margin: row.revenue > 0 ? Math.round((gross / row.revenue) * 1000) / 10 : null, afterLosses: gross - row.losses };
      });
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
    {/* Preflight is disabled app-wide, so `border-*` on a div paints nothing.
        Edges here are rings, and single-side rules are inset shadows. */}
    <section className="overflow-hidden rounded-2xl bg-white shadow-[0_14px_38px_-32px_rgba(15,23,42,0.5)] ring-1 ring-neutral-200">
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100"><WalletCards className="h-5 w-5" /></span>
        <div className="min-w-[16rem] flex-1">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.17em] text-emerald-700">NRMS financial control</p>
          <h2 className="mb-0 mt-0.5 text-xl font-bold tracking-tight text-neutral-950">Business date, cash and statutory records</h2>
          <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">One controlled flow from operational transactions to Night Audit, ledgers and NBS statistics.</p>
        </div>
        {/* Both states were 8px/10px chips in the far corner. They gate every
            action on this page, so they carry real weight now. */}
        <div className="flex flex-wrap items-center gap-2">
          {(() => {
            const state = BUSINESS_DAY_STATE[data?.businessDay.status ?? ""] ?? { label: "Unknown", skin: "bg-neutral-100 text-neutral-600 ring-neutral-200", note: "The state of this business day could not be read." };
            return (
              <span title={state.note} className={`inline-flex h-11 cursor-help items-center gap-2 rounded-xl px-3 text-xs font-bold ring-1 ${loading ? "bg-neutral-100 text-neutral-500 ring-neutral-200" : state.skin}`}>
                <LockKeyhole className="h-4 w-4 shrink-0 opacity-70" />
                <span className="flex flex-col leading-none">
                  <span className="text-[9px] font-bold uppercase tracking-[0.1em] opacity-60">Business date</span>
                  <span className="mt-1">{loading ? "Checking" : state.label}</span>
                </span>
              </span>
            );
          })()}
          <div>
            <button
              type="button"
              onClick={() => canManage && setEditingAuditTime(true)}
              disabled={!canManage}
              aria-expanded={editingAuditTime}
              title={canManage ? "Change the property's business-date cutoff" : "Only an owner or manager can change the Night Audit cutoff"}
              className="inline-flex h-11 items-center gap-2 rounded-xl border-0 bg-white px-3 text-left text-neutral-800 ring-1 ring-neutral-200 transition enabled:cursor-pointer enabled:hover:bg-neutral-50 enabled:hover:ring-neutral-300 disabled:cursor-default"
            >
              <Clock3 className="h-4 w-4 shrink-0 text-sky-700" aria-hidden />
              <span className="flex flex-col leading-none"><span className="text-[9px] font-bold uppercase tracking-[0.1em] text-neutral-400">Audit cutoff</span><span className="mt-1 text-xs font-extrabold tabular-nums">{data?.nightAuditPolicy.closeTime ?? "20:00"} <span className="font-semibold text-neutral-400">EAT</span></span></span>
              {canManage && <Settings2 className="ml-1 h-3.5 w-3.5 text-neutral-400" aria-hidden />}
            </button>
          </div>
          {data?.ledger.loaded && (() => {
            const hasLedgerEntries = Boolean(data?.ledger.transactions.length);
            const balanced = hasLedgerEntries && Boolean(data?.ledger.balanced);
            const label = loading ? "Checking" : !hasLedgerEntries ? (data?.businessDay.status === "CLOSED" ? "No entries posted" : "Awaiting Night Audit") : balanced ? "Balanced" : "Review required";
            return <span className={`inline-flex h-11 items-center gap-2 rounded-xl px-3 text-xs font-bold ring-1 ${balanced ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : hasLedgerEntries ? "bg-amber-50 text-amber-800 ring-amber-300" : "bg-neutral-100 text-neutral-600 ring-neutral-200"}`}>
              {balanced ? <CheckCircle2 className="h-4 w-4 shrink-0 opacity-70" /> : hasLedgerEntries ? <AlertTriangle className="h-4 w-4 shrink-0 opacity-70" /> : <BookOpen className="h-4 w-4 shrink-0 opacity-60" />}
              <span className="flex flex-col leading-none"><span className="text-[9px] font-bold uppercase tracking-[0.1em] opacity-60">Ledger control</span><span className="mt-1">{label}</span></span>
            </span>;
          })()}
          <button type="button" onClick={() => void load()} className="inline-flex h-11 appearance-none items-center gap-2 rounded-xl border-0 bg-white px-3.5 text-xs font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:text-emerald-800 hover:ring-emerald-300"><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh</button>
        </div>
      </header>

      {/* The two pickers scope everything below. They sat inside the same row
          as the status chips, with a wide gap between, so it was not obvious
          they were controls rather than more status. */}
      {/* DatePickerField's own `border` falls back to the UA outset style with
          preflight off, so inside this toolbar the picker is flattened and the
          segmented wrapper draws the single ring. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 bg-neutral-50/70 px-5 py-2.5 shadow-[inset_0_1px_0_0_#f1f5f9]">
        <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400"><CalendarCheck2 className="h-3.5 w-3.5" />Business date</span>
        {/* Reconciliation is done day by day, so stepping is the common move
            and it was only possible through the calendar popover. */}
        <div className="flex h-9 items-stretch overflow-hidden rounded-lg bg-white ring-1 ring-neutral-200 focus-within:ring-emerald-300">
          <button type="button" aria-label="Previous day" onClick={() => setBusinessDate(shiftDay(businessDate, -1))} className="flex w-9 appearance-none items-center justify-center border-0 bg-white text-neutral-500 transition hover:bg-emerald-50 hover:text-emerald-800"><ChevronLeft className="h-4 w-4" /></button>
          <div className="w-[140px] shadow-[inset_1px_0_0_0_#e5e5e5,inset_-1px_0_0_0_#e5e5e5] [&_button]:!h-9 [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!shadow-none [&_button]:!text-[13px] [&_button]:!font-semibold"><DatePickerField label="Business date" value={businessDate} onChangeAction={setBusinessDate} widthClassName="!w-full" size="sm" twoMonths={false} allowPast /></div>
          <button type="button" aria-label="Next day" disabled={businessDate >= localDay()} onClick={() => setBusinessDate(shiftDay(businessDate, 1))} className="flex w-9 appearance-none items-center justify-center border-0 bg-white text-neutral-500 transition hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"><ChevronRight className="h-4 w-4" /></button>
        </div>
        {businessDate !== (tab === "cashiers" ? data?.nightAuditPolicy.activeBusinessDate ?? localDay() : latestAuditDate) && (
          <button type="button" onClick={() => setBusinessDate(tab === "cashiers" ? data?.nightAuditPolicy.activeBusinessDate ?? localDay() : latestAuditDate)} className="inline-flex h-9 appearance-none items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-[11px] font-bold text-emerald-700 transition hover:bg-emerald-50"><RefreshCw className="h-3 w-3" />{tab === "cashiers" ? "Jump to active date" : "Jump to latest closable"}</button>
        )}
        {["expenses", "ledger", "tax", "nbs"].includes(tab) && <>
          <span className="hidden h-6 w-px bg-neutral-200 sm:block" aria-hidden="true" />
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-400">Reporting month</span>
            <div className="w-[132px] overflow-hidden rounded-lg bg-white ring-1 ring-neutral-200 [&_button]:!h-9 [&_button]:!rounded-none [&_button]:!border-0 [&_button]:!bg-transparent [&_button]:!shadow-none [&_button]:!text-[13px] [&_button]:!font-semibold"><DatePickerField label="Reporting month" value={`${month}-01`} onChangeAction={(next) => setMonth(next.slice(0, 7))} widthClassName="!w-full" size="sm" twoMonths={false} allowPast display="month" /></div>
          </div>
        </>}
        {/* Pending closes are an alert, not a filter, so they sit apart on the right. */}
        {tab === "audit" && unclosedBusinessDays.length > 0 && (
          <label className="relative ml-auto flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-amber-50 pl-2.5 pr-8 text-amber-900 ring-1 ring-amber-200 transition hover:ring-amber-300">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden />
            <select
              aria-label="Choose an unclosed business date"
              value={unclosedBusinessDays.some((openDay) => openDay.businessDate === businessDate) ? businessDate : ""}
              onChange={(event) => { if (event.target.value) { setBusinessDate(event.target.value); setMonth(event.target.value.slice(0, 7)); } }}
              style={{ appearance: "none", WebkitAppearance: "none", MozAppearance: "none", fontFamily: "inherit" }}
              className="h-full cursor-pointer border-0 bg-transparent p-0 text-[11px] font-bold text-amber-950 outline-none"
            >
              <option value="">{unclosedBusinessDays.length} unclosed day{unclosedBusinessDays.length === 1 ? "" : "s"} to audit</option>
              {unclosedBusinessDays.map((openDay) => <option key={openDay.id} value={openDay.businessDate}>{dayLabel(openDay.businessDate)} · {openDay.status === "CLOSING" ? "Closing" : openDay.canClose ? "Ready" : "Waiting"}</option>)}
            </select>
            <ChevronRight className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 rotate-90 text-amber-600" aria-hidden />
          </label>
        )}
      </div>

      {/* Six views were reachable only from the workspace sidebar, so the page
          never showed which one you were in or offered a way across. */}
      <nav aria-label="Financial control views" className="flex gap-1 overflow-x-auto px-3 shadow-[inset_0_1px_0_0_#e2e8f0]">
        {FINANCE_TABS.filter((item) => data?.accessRole !== "FRONT_DESK" || ["audit", "cashiers"].includes(item.id)).map((item) => {
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                const nextBusinessDate = item.id === "cashiers" ? data?.nightAuditPolicy.activeBusinessDate ?? localDay() : item.id === "audit" ? latestAuditDate : businessDate;
                setTab(item.id); setBusinessDate(nextBusinessDate); setMonth(nextBusinessDate.slice(0, 7)); setError(null); setMessage(null);
                router.replace(`/owner/nrms/finance?view=${item.id}&businessDate=${encodeURIComponent(nextBusinessDate)}`);
              }}
              aria-current={on ? "page" : undefined}
              className={`inline-flex min-h-11 shrink-0 appearance-none items-center gap-1.5 rounded-t-lg border-0 px-3 text-xs font-bold transition ${on ? "bg-white text-emerald-800 shadow-[inset_0_-2px_0_0_#047857]" : "bg-transparent text-neutral-500 hover:bg-white/70 hover:text-neutral-800"}`}
            >
              <item.icon className="h-3.5 w-3.5" />{item.label}
            </button>
          );
        })}
      </nav>
    </section>
    {editingAuditTime && canManage && (
      <NrmsModalFrame
        title="Night Audit cutoff"
        compact
        compactFooter
        small
        closeOnEscape={!busy}
        onClose={() => { if (!busy) { setEditingAuditTime(false); setAuditTimeDraft(data?.nightAuditPolicy.closeTime ?? "20:00"); } }}
        footer={<div className="flex items-center justify-end gap-2"><button type="button" onClick={() => { setEditingAuditTime(false); setAuditTimeDraft(data?.nightAuditPolicy.closeTime ?? "20:00"); }} disabled={busy} className="h-9 rounded-lg border-0 bg-white px-3 text-[11px] font-bold text-neutral-600 ring-1 ring-neutral-200 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void saveAuditTime()} disabled={busy || auditTimeDraft === data?.nightAuditPolicy.closeTime} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#073c35] px-3 text-[11px] font-bold text-white transition hover:bg-[#0b5148] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BadgeCheck className="h-3.5 w-3.5" />}Save</button></div>}
      >
        <div>
          <label className="block" htmlFor="night-audit-cutoff"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-500">Closing time</span><div className="mt-1.5 flex h-10 items-center overflow-hidden rounded-lg bg-white ring-1 ring-neutral-300 focus-within:ring-2 focus-within:ring-emerald-500"><input id="night-audit-cutoff" type="time" value={auditTimeDraft} onChange={(event) => setAuditTimeDraft(event.target.value)} className="h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-sm font-extrabold tabular-nums text-neutral-900 outline-none" /><span className="mr-2 rounded bg-neutral-100 px-1.5 py-1 text-[9px] font-bold text-neutral-500">EAT</span></div></label>
          <p className="mb-0 mt-2 text-[10px] leading-4 text-neutral-500">Earlier activity stays on the previous business date. Closing remains manual.</p>
        </div>
      </NrmsModalFrame>
    )}
    {(error || message) && <div className={`rounded-xl px-4 py-3 text-xs font-semibold ring-1 ${error ? "ring-red-200 bg-red-50 text-red-700" : "ring-emerald-200 bg-emerald-50 text-emerald-700"}`}>{error || message}</div>}
    {tab === "audit" && (
      <>
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
          <header className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><CalendarCheck2 className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <h3 className="m-0 text-base font-bold text-neutral-900">Night Audit · {dayLabel(businessDate)}</h3>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Review every recorded activity and closing outcome before locking the date.</p>
            </div>
            {data?.businessDay.status === "NOT_OPENED" ? (
              <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${BUSINESS_DAY_STATE.NOT_OPENED!.skin}`}>{BUSINESS_DAY_STATE.NOT_OPENED!.label}</span>
            ) : (
              <button type="button" onClick={() => setConfirmNightAudit(true)} disabled={busy || data?.businessDay.status === "CLOSING"} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-4 text-xs font-bold text-white transition hover:bg-[#0b5148] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400"><ClipboardCheck className="h-4 w-4" />{data?.businessDay.status === "CLOSED" ? "View final report" : "Open full review"}</button>
            )}
          </header>

          {data?.businessDay.status === "NOT_OPENED" ? (
            <div className="flex items-start gap-3 border-t border-neutral-100 bg-neutral-50 px-5 py-5">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-neutral-400" />
              <div className="min-w-0 flex-1"><p className="m-0 text-sm font-bold text-neutral-800">No operating record for this date</p><p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">This date was never opened for hotel operations. Browsing it does not create an artificial financial close.{oldestUnclosedDay ? " Choose a recorded unclosed day instead." : " There are no recorded unclosed business days."}</p>{oldestUnclosedDay && <button type="button" onClick={() => { setBusinessDate(oldestUnclosedDay.businessDate); setMonth(oldestUnclosedDay.businessDate.slice(0, 7)); }} className="mt-3 h-9 rounded-lg border-0 bg-[#073c35] px-3 text-[11px] font-bold text-white transition hover:bg-[#0b5148]">Review oldest unclosed · {dayLabel(oldestUnclosedDay.businessDate)}</button>}</div>
            </div>
          ) : (
            (() => {
              // One status reading drives the headline, the stepper and the tile marks,
              // so the card cannot say "locked" in one place and "waiting" in another.
              const status = data?.businessDay.status;
              const closed = status === "CLOSED";
              const closing = status === "CLOSING";
              const blockerCount = data?.blockers.length ?? 0;
              const warningCount = data?.warnings.length ?? 0;
              const readyToClose = canCloseSelectedDate && !blockerCount;
              const finalAudit = data?.businessDay.audits.find((audit) => audit.status === "CLOSED") ?? null;
              const currency = data?.property.currency || "TZS";
              const review = data?.nightAuditReview;
              const closeTime = data?.nightAuditPolicy.closeTime ?? "20:00";

              const headline = closed ? { icon: <LockKeyhole className="h-4 w-4" />, skin: "bg-neutral-900 text-white", title: "Completed and locked", detail: `Closed ${time(data?.businessDay.closedAt)}${finalAudit ? ` · Report ${finalAudit.reportNumber}` : ""}` }
                : closing ? { icon: <Loader2 className="h-4 w-4 animate-spin" />, skin: "bg-amber-100 text-amber-800", title: "Night Audit is running", detail: "The ledger is posting. This date locks when the run finishes." }
                : !canCloseSelectedDate ? { icon: <Clock3 className="h-4 w-4" />, skin: "bg-sky-100 text-sky-800", title: `Trading until the ${closeTime} EAT cutoff`, detail: `This date becomes eligible after the boundary. Next boundary: ${time(data?.nightAuditPolicy.nextCloseAt)}.` }
                : blockerCount ? { icon: <AlertTriangle className="h-4 w-4" />, skin: "bg-red-100 text-red-700", title: `${blockerCount} closing control${blockerCount === 1 ? "" : "s"} need attention`, detail: "Open the review to see each blocker, the day's activity and the affected outcome." }
                : { icon: <CheckCircle2 className="h-4 w-4" />, skin: "bg-emerald-100 text-emerald-800", title: "Ready to close", detail: `All blocking controls passed${warningCount ? `, ${warningCount} warning${warningCount === 1 ? "" : "s"} to acknowledge` : ""}. Review operations, cash and ledger entries before confirming.` };

              const steps: Array<{ label: string; detail: string; state: AuditStepState }> = [
                { label: "Day opened", detail: data?.businessDay.openedAt ? time(data.businessDay.openedAt) : "Trading started", state: "done" },
                { label: `Cutoff ${closeTime} EAT`, detail: closed || canCloseSelectedDate ? "Boundary passed" : `Next ${time(data?.nightAuditPolicy.nextCloseAt)}`, state: closed || canCloseSelectedDate ? "done" : "current" },
                { label: "Closing controls", detail: closed ? "All passed" : !canCloseSelectedDate ? "Checked after cutoff" : blockerCount ? `${blockerCount} blocking` : "All passed", state: closed ? "done" : !canCloseSelectedDate ? "pending" : blockerCount ? "blocked" : "done" },
                { label: "Audit and lock", detail: closed ? time(data?.businessDay.closedAt) : closing ? "Running now" : readyToClose ? "Ready to run" : "Waiting", state: closed ? "done" : closing || readyToClose ? "current" : "pending" },
              ];

              const cashiers = review?.cashiers;
              const ledger = review?.ledger;
              return (
                <div className="space-y-4 p-4 shadow-[inset_0_1px_0_0_#f1f5f9] sm:p-5">
                  <div className="rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-200">
                    <div className="flex items-start gap-3">
                      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${headline.skin}`}>{headline.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-bold text-neutral-900">{headline.title}</p>
                        <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-600">{headline.detail}</p>
                      </div>
                    </div>
                    <ol className="m-0 mt-4 grid list-none grid-cols-2 gap-x-3 gap-y-4 p-0 lg:grid-cols-4" aria-label="Night Audit progress">
                      {steps.map((step, index) => {
                        const skin = AUDIT_STEP_SKIN[step.state];
                        return (
                          <li key={step.label} className="min-w-0" aria-current={step.state === "current" || step.state === "blocked" ? "step" : undefined}>
                            <span className={`block h-1 rounded-full ${skin.bar}`} aria-hidden />
                            <div className="mt-2.5 flex items-start gap-2">
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${skin.dot}`}>{step.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" /> : step.state === "blocked" ? "!" : index + 1}</span>
                              <div className="min-w-0">
                                <p className={`m-0 truncate text-[11px] font-bold ${skin.label}`}>{step.label}</p>
                                <p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-500">{step.detail}</p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  </div>

                  {review && cashiers && ledger && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <AuditTile icon={<BedDouble className="h-3.5 w-3.5" />} label="Guest movement" value={`${review.operations.arrivals} in · ${review.operations.departures} out`} note={`${review.operations.inHouseAtReview} in house · ${review.operations.reservationsCreated} new reservation${review.operations.reservationsCreated === 1 ? "" : "s"}`} />
                    <AuditTile icon={<WalletCards className="h-3.5 w-3.5" />} label="Cashier shifts" value={cashiers.total ? `${cashiers.signedOff}/${cashiers.total} signed off` : "No shifts"} note={cashiers.total ? `${cashiers.open} still open · ${cashiers.closed} closed` : "No cashier shift was recorded for this date"} tone={!cashiers.total ? "neutral" : cashiers.open || cashiers.signedOff !== cashiers.total ? "warn" : "good"} />
                    <AuditTile icon={<Scale className="h-3.5 w-3.5" />} label="Cash variance" value={cash(cashiers.variance, currency)} note={cashiers.total ? `Expected ${cash(cashiers.expectedCash, currency)} · declared ${cash(cashiers.declaredCash, currency)}` : "No cash was counted"} tone={!cashiers.total ? "neutral" : cashiers.variance === 0 ? "good" : "warn"} />
                    <AuditTile icon={<BookOpen className="h-3.5 w-3.5" />} label="Ledger" value={`${ledger.transactionCount} ${ledger.transactionCount === 1 ? "entry" : "entries"}`} note={`${ledger.balanced ? "Balanced" : "Not balanced"} · ${ledger.stockMovementsPosted} stock movement${ledger.stockMovementsPosted === 1 ? "" : "s"}`} tone={ledger.balanced ? "good" : "bad"} />
                  </div>}

                  {data && data.businessDay.audits.length > 0 && <div>
                    <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Audit history</p>
                    <ul className="m-0 mt-2 list-none overflow-hidden rounded-xl p-0 ring-1 ring-neutral-200">
                      {data.businessDay.audits.map((audit, index) => (
                        <li key={audit.id} className={`flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-3.5 py-2.5 text-[11px] ${index ? "shadow-[inset_0_1px_0_0_#f1f5f9]" : ""}`}>
                          {audit.status === "CLOSED" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-red-600" />}
                          <span className="font-mono font-semibold text-neutral-800">{audit.reportNumber}</span>
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold ${audit.status === "CLOSED" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{codeLabel(audit.status)}</span>
                          <span className="ml-auto tabular-nums text-neutral-500">{time(audit.completedAt || audit.startedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>}
                </div>
              );
            })()
          )}
        </section>

        {confirmNightAudit && data?.businessDay.status !== "NOT_OPENED" && (
          <NrmsModalFrame
            title={`Night Audit · ${dayLabel(businessDate)}`}
            subtitle={`Business-date boundary ${data?.nightAuditPolicy.closeTime} EAT · review generated ${time(data?.nightAuditReview?.generatedAt)}`}
            icon={<ClipboardCheck className="h-5 w-5" />}
            extraWide
            closeOnEscape={!busy}
            onClose={() => { if (!busy) { setConfirmNightAudit(false); setAcknowledgeFiscalBacklog(false); } }}
            footer={<div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => setConfirmNightAudit(false)} disabled={busy} className="min-h-10 rounded-lg border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-700 disabled:opacity-50">Close review</button>{data?.businessDay.status === "OPEN" && <button type="button" onClick={() => void closeAudit()} disabled={!canManage || !canCloseSelectedDate || Boolean(data?.blockers.length) || busy || Boolean(fiscalBacklogWarning && !acknowledgeFiscalBacklog) || !data?.nightAuditReview?.ledger.balanced} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-0 bg-amber-700 px-5 text-xs font-bold text-white transition hover:bg-amber-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}Post ledger and close date</button>}</div>}
          >
            {!data?.nightAuditReview ? <div className="rounded-xl bg-neutral-50 p-5 text-sm text-neutral-600 ring-1 ring-neutral-200">This historical close predates the expanded activity snapshot. Its report number and ledger remain available in Audit history and Accounting ledger.</div> : <div className="space-y-5">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-2"><div><h4 className="m-0 text-sm font-bold text-neutral-900">Operational activity</h4><p className="mb-0 mt-1 text-[11px] text-neutral-500">Captured from {time(data.nightAuditReview.window.startedAt)} through {time(data.nightAuditReview.window.through)}.</p></div><span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700 ring-1 ring-sky-200">{data.nightAuditPolicy.closeTime} EAT boundary</span></div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ReviewMetric icon={<LogIn className="h-3.5 w-3.5" />} label="Checked in" value={String(data.nightAuditReview.operations.arrivals)} note="Arrivals completed in this business window" /><ReviewMetric icon={<LogOut className="h-3.5 w-3.5" />} label="Checked out" value={String(data.nightAuditReview.operations.departures)} note="Departures completed in this business window" /><ReviewMetric icon={<BedDouble className="h-3.5 w-3.5" />} label="In house" value={String(data.nightAuditReview.operations.inHouseAtReview)} note="Guests still checked in at review time" /><ReviewMetric icon={<CalendarCheck2 className="h-3.5 w-3.5" />} label="Reservations" value={String(data.nightAuditReview.operations.reservationsCreated)} note="Reservations created in this business window" /></div>
              </section>

              <section className="rounded-xl bg-neutral-50 p-4 ring-1 ring-neutral-200"><div className="flex items-center justify-between gap-3"><div><h4 className="m-0 text-sm font-bold text-neutral-900">Cashier reconciliation</h4><p className="mb-0 mt-1 text-[11px] text-neutral-500">Physical cash, recorded expectation and manager sign-off.</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${data.nightAuditReview.cashiers.open || data.nightAuditReview.cashiers.signedOff !== data.nightAuditReview.cashiers.total ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>{data.nightAuditReview.cashiers.signedOff}/{data.nightAuditReview.cashiers.total} signed off</span></div><div className="mt-3 grid gap-3 sm:grid-cols-3"><Metric label="Expected cash" value={cash(data.nightAuditReview.cashiers.expectedCash, data?.property.currency || "TZS")} note={`${data.nightAuditReview.cashiers.closed} closed shift${data.nightAuditReview.cashiers.closed === 1 ? "" : "s"}`} /><Metric label="Declared cash" value={cash(data.nightAuditReview.cashiers.declaredCash, data?.property.currency || "TZS")} note="Physical counts entered by cashiers or managers" /><Metric label="Variance" value={cash(data.nightAuditReview.cashiers.variance, data?.property.currency || "TZS")} note={data.nightAuditReview.cashiers.variance === 0 ? "Expected and declared cash agree" : "Explained variance retained in shift records"} tone={data.nightAuditReview.cashiers.variance === 0 ? "green" : "amber"} /></div></section>

              <section><h4 className="m-0 text-sm font-bold text-neutral-900">Closing controls</h4><p className="mb-0 mt-1 text-[11px] text-neutral-500">Every blocking control must clear. No override or bypass is available.</p><div className="mt-3 space-y-2">{data.nightAuditReview.controls.blockers.length ? data.nightAuditReview.controls.blockers.map((blocker) => { const next = blockerAction(blocker.code); return <div key={blocker.code} className="flex flex-wrap items-center gap-3 rounded-xl bg-red-50 p-3 ring-1 ring-red-200"><AlertTriangle className="h-4 w-4 shrink-0 text-red-600" /><div className="min-w-0 flex-1"><p className="m-0 text-xs font-bold text-red-900">{codeLabel(blocker.code)}</p><p className="mb-0 mt-1 text-[10px] text-red-700">{blocker.message}</p></div>{next && <button type="button" onClick={() => { setConfirmNightAudit(false); next.run(); }} className="h-8 rounded-lg border border-red-200 bg-white px-3 text-[10px] font-bold text-red-700">{next.label}</button>}</div>; }) : <div className="flex items-center gap-3 rounded-xl bg-emerald-50 p-3 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"><CheckCircle2 className="h-4 w-4" />All blocking controls passed.</div>}{data.nightAuditReview.controls.warnings.map((warning) => <div key={warning.code} className="flex items-start gap-3 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /><div><p className="m-0 text-xs font-bold text-amber-900">{codeLabel(warning.code)}</p><p className="mb-0 mt-1 text-[10px] text-amber-800">{warning.message}</p></div></div>)}</div></section>

              <section><div className="flex flex-wrap items-end justify-between gap-3"><div><h4 className="m-0 text-sm font-bold text-neutral-900">Proposed ledger outcome</h4><p className="mb-0 mt-1 text-[11px] text-neutral-500">Every activity below becomes an immutable balanced ledger transaction when you close.</p></div><div className="text-right"><p className="m-0 text-lg font-extrabold tabular-nums text-neutral-950">{cash(data.nightAuditReview.ledger.debitTotal, data?.property.currency || "TZS")}</p><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Debit = credit · {data.nightAuditReview.ledger.transactionCount} entries</p></div></div><div className="mt-3 overflow-hidden rounded-xl ring-1 ring-neutral-200"><div className="max-h-72 overflow-auto"><table className="w-full min-w-[680px] border-collapse text-left"><thead className="sticky top-0 bg-neutral-50 text-[9px] font-bold uppercase tracking-wide text-neutral-500"><tr><th className="px-3 py-2.5">Activity</th><th className="px-3 py-2.5">Type</th><th className="px-3 py-2.5">Time</th><th className="px-3 py-2.5 text-right">Debit</th><th className="px-3 py-2.5 text-right">Credit</th></tr></thead><tbody className="divide-y divide-neutral-100 text-[11px]">{data.nightAuditReview.ledger.activities.map((activity, index) => <tr key={`${activity.sourceType}-${index}`}><td className="max-w-[260px] px-3 py-2.5 font-semibold text-neutral-800">{activity.description}</td><td className="px-3 py-2.5 text-neutral-500">{codeLabel(activity.sourceType)}</td><td className="whitespace-nowrap px-3 py-2.5 text-neutral-500">{time(activity.occurredAt)}</td><td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{cash(activity.debit, activity.currency)}</td><td className="px-3 py-2.5 text-right tabular-nums text-neutral-700">{cash(activity.credit, activity.currency)}</td></tr>)}{!data.nightAuditReview.ledger.activities.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-neutral-400">No ledger activity is waiting to post for this date.</td></tr>}</tbody></table></div></div></section>

              <section className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200"><h4 className="m-0 text-sm font-bold text-amber-950">What closing will do</h4><ul className="mb-0 mt-2 space-y-1.5 pl-4 text-[11px] leading-4 text-amber-900"><li>Post the balanced activities above to the accounting ledger and store this review in the Night Audit report.</li><li>Lock {dayLabel(businessDate)}. Later corrections must be recorded on an open business date with an audit reason.</li><li>Open the next sequential business date so hotel operations continue without a gap.</li></ul>{fiscalBacklogWarning && <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-lg bg-white p-3 text-[11px] leading-4 text-amber-950 ring-1 ring-amber-300"><input type="checkbox" checked={acknowledgeFiscalBacklog} onChange={(event) => setAcknowledgeFiscalBacklog(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700" /><span><strong className="block">Acknowledge unresolved TRA delivery</strong>{fiscalBacklogWarning.message} I understand this acknowledgement is stored with the final Night Audit.</span></label>}</section>
            </div>}
          </NrmsModalFrame>
        )}
      </>
    )}

    {tab === "audit" && Boolean(data?.unclassifiedTenders?.length) && <section id="unclassified-tenders" className="scroll-mt-4 overflow-hidden rounded-xl ring-1 ring-amber-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-amber-50/70 px-4 py-3 shadow-[inset_0_-1px_0_0_#fef3c7]"><div><h3 className="m-0 text-sm font-bold text-neutral-900">Classify outlet payments</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">These older settled orders have no recorded tender. Select the actual method received before Night Audit.</p></div><span className="rounded-md ring-1 ring-amber-200 bg-white px-2 py-1 text-[9px] font-bold text-amber-800">{data?.unclassifiedTenders?.length} required</span></div>
      <div className="[&>*]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>*:last-child]:shadow-none">{data?.unclassifiedTenders?.map((order) => <div key={order.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1fr)_minmax(150px,.8fr)_auto_180px_auto] md:items-center"><div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{order.orderNumber} · {order.outlet.name}</p><p className="mb-0 mt-1 truncate text-[10px] text-neutral-400">Settled {time(order.settledAt)}</p></div><div className="min-w-0"><p className="m-0 truncate text-[11px] font-semibold text-neutral-700">{order.guest}</p><p className="mb-0 mt-0.5 truncate text-[9px] text-neutral-400">{order.room}</p></div><strong className="whitespace-nowrap text-xs tabular-nums text-neutral-900">{cash(order.total, order.currency)}</strong><select value={tenderCorrections[order.id] ?? ""} onChange={(event) => setTenderCorrections((current) => ({ ...current, [order.id]: event.target.value }))} className="h-9 rounded-lg border border-neutral-200 bg-white px-2 text-[10px] font-bold text-neutral-700 outline-none focus:border-emerald-500" aria-label={`Payment method for ${order.orderNumber}`}><option value="">Select payment method</option><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK">Bank transfer</option><option value="OTHER">Other</option></select><button type="button" onClick={() => classifyTender(order.id)} disabled={!canManage || busy || !tenderCorrections[order.id]} className="h-9 whitespace-nowrap rounded-lg border-0 bg-neutral-900 px-3 text-[10px] font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">Save method</button></div>)}</div>
    </section>}

    {tab === "cashiers" && <section id="nrms-cashier-shifts" className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-neutral-200">
      <style>{`#nrms-cashier-shifts, #nrms-cashier-shifts * { box-sizing: border-box; }`}</style>
      <header className="flex flex-wrap items-center gap-3 px-4 py-3.5 sm:px-5">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><WalletCards className="h-5 w-5" /></span>
        <div className="min-w-0"><h3 className="m-0 text-base font-bold text-neutral-900">Cashier shift variance</h3><p className="mb-0 mt-0.5 text-xs text-neutral-500">{dayLabel(businessDate)} · compare expected cash with the physical count, then close and sign off.</p></div>
        <div className="ml-auto flex items-center gap-3 text-xs font-semibold text-neutral-500"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" />Bar</span><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-sky-400" />Restaurant</span></div>
      </header>
      <div>
        {data?.shifts.map((shift) => {
          const missingPhysicalCount = shift.status === "CLOSED" && (shift.declaredCash == null || shift.variance == null);
          const physicalInput = counted[shift.id] ?? "";
          const physicalValue = physicalInput === "" ? null : Number(physicalInput);
          const expectedForControl = shift.status === "OPEN" ? shift.liveExpectedCash : shift.expectedCash;
          const liveVariance = physicalValue != null && Number.isFinite(physicalValue) ? physicalValue - expectedForControl : null;
          const needsVarianceNote = liveVariance != null && liveVariance !== 0;
          const canCloseShift = liveVariance != null && (!needsVarianceNote || Boolean(notes[shift.id]?.trim()));
          const businessDayOpen = data?.businessDay.status === "OPEN";
          const canRepairShift = canManage && businessDayOpen && canCloseShift;
          return <article key={shift.id} className={`grid min-w-0 shadow-[inset_0_1px_0_0_#ededed] lg:grid-cols-[minmax(0,1fr)_300px] ${shiftRowTone(shift)}`}>
            <div className="min-w-0 px-4 py-4 sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h4 className="m-0 truncate text-sm font-bold text-neutral-900">{shift.cashierName}</h4><span className={`rounded-full px-2 py-1 text-[11px] font-bold ${shift.status === "OPEN" ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-600"}`}>{shift.status}</span></div>
                  <p className="mb-0 mt-1 text-xs text-neutral-500">{shift.assignment ? `${serviceLabelForRole(shift.assignment.role)}${shift.assignment.outletName ? ` · ${shift.assignment.outletName}` : ""}` : "Property"} · opened {time(shift.openedAt)}</p>
                  {shift.handoverFromName && <p className="mb-0 mt-1 text-xs text-neutral-400">Took over from {shift.handoverFromName}</p>}
                </div>
              </div>

              <dl className="m-0 mt-4 grid grid-cols-2 gap-y-4 sm:grid-cols-4 sm:[&>div+div]:border-0 sm:[&>div+div]:border-l sm:[&>div+div]:border-solid sm:[&>div+div]:border-neutral-200 sm:[&>div+div]:pl-5">
                <div className="min-w-0"><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Opening float</dt><dd className="m-0 mt-1 text-sm font-semibold tabular-nums text-neutral-800">{cash(shift.openingFloat, shift.currency)}</dd></div>
                <div className="min-w-0"><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Expected cash</dt><dd className="m-0 mt-1 text-sm font-bold tabular-nums text-neutral-950">{cash(shift.liveExpectedCash, shift.currency)}</dd></div>
                <div className="min-w-0"><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Physical count</dt><dd className="m-0 mt-1">{shift.status === "OPEN" || missingPhysicalCount ? <label className="flex h-10 max-w-[190px] items-center overflow-hidden rounded-lg bg-white ring-1 ring-neutral-300 focus-within:ring-2 focus-within:ring-emerald-500"><span className="px-2.5 text-xs font-semibold text-neutral-500">{shift.currency}</span><input type="text" inputMode="decimal" value={physicalInput} onChange={(event) => setCounted((current) => ({ ...current, [shift.id]: event.target.value.replace(/[^0-9.]/g, "") }))} placeholder="0" aria-label={`Physical cash counted by ${shift.cashierName}`} className="h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-right text-sm font-semibold tabular-nums text-neutral-900 outline-none" /></label> : <span className="text-sm font-semibold tabular-nums text-neutral-800">{cash(shift.declaredCash!, shift.currency)}</span>}</dd></div>
                <div className="min-w-0"><dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">Variance</dt><dd className={`m-0 mt-1 text-sm font-bold tabular-nums ${(shift.status === "OPEN" || missingPhysicalCount ? liveVariance : Number(shift.variance)) ? "text-red-600" : "text-emerald-700"}`}>{shift.status === "OPEN" || missingPhysicalCount ? (liveVariance == null ? <span className="text-xs font-semibold text-amber-700">Enter count</span> : cash(liveVariance, shift.currency)) : cash(shift.variance!, shift.currency)}</dd></div>
              </dl>

              {shift.status === "OPEN" ? <p className="mb-0 mt-4 text-xs text-neutral-500">Tender totals will be frozen when this shift closes.</p> : <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-500">
                {[['Cash', 'CASH'], ['Mobile money', 'MOBILE_MONEY'], ['Bank', 'BANK'], ['Card', 'CARD']].map(([label, method]) => <span key={method}>{label} <strong className="font-semibold tabular-nums text-neutral-800">{cash(tenderAmount(shift, method!), shift.currency)}</strong></span>)}
                <span>Folio <strong className="font-semibold tabular-nums text-neutral-800">{cash(shift.closeSummary?.folioPosted.amount ?? 0, shift.currency)}</strong></span>
                {otherTenderAmount(shift) > 0 && <span>Other <strong className="font-semibold tabular-nums text-neutral-800">{cash(otherTenderAmount(shift), shift.currency)}</strong></span>}
              </div>}
            </div>

            <aside className="min-w-0 bg-neutral-50/70 px-4 py-4 shadow-[inset_1px_0_0_0_#ededed] sm:px-5 lg:flex lg:flex-col lg:justify-center">
              {shift.status === "OPEN" ? <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-neutral-700">Variance reason{needsVarianceNote ? " · required" : ""}<input value={notes[shift.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [shift.id]: event.target.value }))} placeholder={needsVarianceNote ? "Explain the cash difference" : "Only needed when cash differs"} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-500" /></label>
                <button type="button" onClick={() => closeShift(shift)} disabled={busy || !businessDayOpen || !canCloseShift} className="h-10 w-full rounded-lg border-0 bg-neutral-900 px-4 text-sm font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">Close shift</button>
                {(!businessDayOpen || !canCloseShift) && <p className="m-0 text-xs leading-4 text-neutral-500">{!businessDayOpen ? "This business date is already closing or closed." : liveVariance == null ? "Enter the physical cash count to continue." : "Explain the variance before closing."}</p>}
              </div> : missingPhysicalCount ? <div className="space-y-2.5">
                <p className="m-0 text-sm font-bold text-amber-800">Physical count was not recorded</p>
                <p className="m-0 text-xs leading-5 text-neutral-600">This legacy shift cannot be called matched or signed off until a manager records the missing drawer count.</p>
                <label className="block text-xs font-semibold text-neutral-700">Reconciliation reason{needsVarianceNote ? " · required" : ""}<input value={notes[shift.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [shift.id]: event.target.value }))} placeholder={needsVarianceNote ? "Explain the cash difference" : "Optional reconciliation note"} className="mt-1.5 h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-emerald-500" /></label>
                <button type="button" onClick={() => reconcileShift(shift)} disabled={busy || !canRepairShift} className="h-10 w-full rounded-lg border-0 bg-amber-700 px-4 text-sm font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-400">Record physical count</button>
                {data?.businessDay.status === "CLOSED" && <p className="m-0 text-xs leading-5 text-red-600">This historical date is locked. Its missing count remains visible for audit review and cannot be replaced with a later count.</p>}
              </div> : <div>
                {shift.closeSummary && shift.closeSummary.unpaid.count > 0 && <p className="m-0 text-xs font-semibold text-amber-700">{shift.closeSummary.unpaid.count} unpaid at close · {cash(shift.closeSummary.unpaid.amount, shift.currency)}</p>}
                <p className="mb-0 mt-1 text-sm font-semibold text-neutral-800">{shift.closeNote || (shift.closeSummary?.unpaid.count ? "Review unpaid orders" : "Cash matched")}</p>
                <div className="mt-3">{shift.ownerSignedOffAt ? <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><BadgeCheck className="h-4 w-4" />Signed off by {shift.ownerSignedOffByName} · {time(shift.ownerSignedOffAt)}</span> : canManage && businessDayOpen ? <button type="button" onClick={() => signOffShift(shift)} disabled={busy} className="h-10 w-full rounded-lg border border-solid border-emerald-300 bg-white px-4 text-sm font-bold text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">Acknowledge and sign off</button> : <span className={`text-xs ${businessDayOpen ? "text-neutral-500" : "font-semibold text-amber-700"}`}>{businessDayOpen ? "Manager sign-off pending" : "Sign-off was not completed before this date was locked"}</span>}</div>
              </div>}
            </aside>
          </article>;
        })}

        {Boolean(data?.unassignedSales.count) && <article className="grid min-w-0 bg-amber-50/40 shadow-[inset_0_1px_0_0_#ededed] lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 px-4 py-4 sm:px-5"><div className="flex flex-wrap items-center gap-2"><h4 className="m-0 text-sm font-bold text-neutral-900">Other sales</h4><span className="rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-800">OUTSIDE SHIFT</span></div><p className="mb-0 mt-1 text-xs text-neutral-600">{data!.unassignedSales.count} sale{data!.unassignedSales.count === 1 ? "" : "s"} · <strong>{cash(data!.unassignedSales.amount, data!.property.currency || "TZS")}</strong></p><div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-neutral-600">{[['Cash', 'CASH'], ['Mobile money', 'MOBILE_MONEY'], ['Bank', 'BANK'], ['Card', 'CARD']].map(([label, method]) => <span key={method}>{label} <strong className="tabular-nums text-neutral-800">{cash(data!.unassignedSales.byMethod.find((row) => row.method === method)?.amount ?? 0, data!.property.currency || "TZS")}</strong></span>)}</div></div>
          <aside className="bg-amber-50 px-4 py-4 text-xs leading-5 text-amber-900 shadow-[inset_1px_0_0_0_#fde68a] sm:px-5 lg:flex lg:items-center">Settled by an owner or manager with no open shift. No cashier is accountable for this cash.</aside>
        </article>}

        {!data?.shifts.length && !data?.unassignedSales.count && <div className="flex flex-col items-center justify-center px-6 py-10 text-center shadow-[inset_0_1px_0_0_#ededed]"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-neutral-100 text-neutral-400"><WalletCards className="h-5 w-5" /></span><p className="mb-0 mt-3 text-sm font-bold text-neutral-700">No cashier activity for {dayLabel(businessDate)}</p><p className="mb-0 mt-1 max-w-lg text-xs leading-5 text-neutral-500">No attendant opened Shift &amp; cash and no receipts were recorded outside a shift. If the property did not take outlet cash on this date, there is nothing to reconcile.</p></div>}
      </div>
    </section>}

    {tab === "expenses" && <div className="grid gap-4 xl:grid-cols-[.7fr_1.3fr]">
      <section id="nrms-expense-form" className="h-fit min-w-0 rounded-2xl ring-1 ring-neutral-200 bg-white p-5 shadow-sm">
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

      <section id="nrms-expense-list" className="min-w-0 overflow-hidden rounded-2xl ring-1 ring-neutral-200 bg-white shadow-sm">
        <style>{`#nrms-expense-list, #nrms-expense-list * { box-sizing: border-box; }`}</style>
        <header className="flex flex-wrap items-center justify-between gap-3 shadow-[inset_0_-1px_0_0_#e5e5e5] px-5 py-4"><div><h3 className="m-0 text-base font-bold">Expenses this month</h3><p className="mb-0 mt-1 text-xs text-neutral-500">{month}, by date recorded.</p></div><span className="rounded-full bg-neutral-100 px-3 py-1.5 text-[10px] font-bold text-neutral-500">{expenses.filter((row) => !row.voidedAt).length} active</span></header>
        {expensesLoading && !expenses.length ? <div className="flex min-h-40 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Loading expenses…</div> : (
          <div className="[&>*]:shadow-[inset_0_-1px_0_0_#f5f5f5] [&>*:last-child]:shadow-none">
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
                  <div className="mt-2.5 rounded-lg ring-1 ring-red-100 bg-red-50/50 p-2.5">
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
      {profitAndLoss.length > 0 && <div className="rounded-2xl ring-1 ring-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="m-0 text-sm font-bold">Profit and loss</h3>
        <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Revenue recognized less expenses posted for the selected range, including staff wages recorded on the Expenses tab and, where stock control is in use, the cost of goods sold. Depreciation is not tracked, so this is not a complete P&amp;L.</p>
        <div className="mt-3 space-y-3">{profitAndLoss.map((row) => <div key={row.currency} className="grid gap-3 sm:grid-cols-3">
          <Metric label={`Revenue (${row.currency})`} value={cash(row.revenue, row.currency)} note="Room, restaurant, bar and other service revenue" tone="green" />
          <Metric label={`Expenses (${row.currency})`} value={cash(row.expense, row.currency)} note="Platform fees and other posted costs" tone="amber" />
          <Metric label={`Net (${row.currency})`} value={cash(row.net, row.currency)} note={row.net >= 0 ? "Profit for the range" : "Loss for the range"} tone={row.net >= 0 ? "green" : "amber"} />
        </div>)}</div>
      </div>}
      {(grossProfit.length > 0 || data?.stock?.tracked) && <div className="rounded-2xl ring-1 ring-neutral-200 bg-white p-4 shadow-sm">
        <h3 className="m-0 text-sm font-bold">Food and beverage gross profit</h3>
        <p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Restaurant, bar and room service revenue against the cost of the goods sold, valued at what they cost when they left the shelf. Wastage, staff meals, complimentary and count losses are shown after it.</p>
        <div className="mt-3 space-y-3">
          {grossProfit.map((row) => <div key={row.currency} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label={`F&B revenue (${row.currency})`} value={cash(row.revenue, row.currency)} note="Restaurant, bar and room service" tone="green" />
            <Metric label={`Cost of goods sold (${row.currency})`} value={cash(row.cogs, row.currency)} note="Drinks and food taken from stock by sales" tone="amber" />
            <Metric label={`Gross profit (${row.currency})`} value={cash(row.gross, row.currency)} note={row.margin == null ? "No F&B revenue in the range" : `${row.margin}% of F&B revenue`} tone={row.gross >= 0 ? "green" : "amber"} />
            <Metric label={`After stock losses (${row.currency})`} value={cash(row.afterLosses, row.currency)} note={`${cash(row.losses, row.currency)} wastage, staff meals, complimentary and count losses`} tone={row.afterLosses >= 0 ? "neutral" : "amber"} />
          </div>)}
          {data?.stock?.tracked && <p className="m-0 text-[11px] text-neutral-600">Stock on the shelves today, at average cost: <strong className="tabular-nums text-neutral-900">{cash(data.stock.value, data.property.currency || "TZS")}</strong></p>}
          {grossProfit.length === 0 && <p className="m-0 text-[11px] text-neutral-500">No stock has posted in this range yet. Cost of goods sold appears after the Night Audit that follows the first stock sale.</p>}
        </div>
      </div>}
      <div className="space-y-5">
        {accountGroups.map((group) => {
          const style = ACCOUNT_TYPE_STYLE[group.type] ?? { label: group.type, dot: "bg-neutral-400", border: "shadow-[inset_3px_0_0_0_#d4d4d4]" };
          return (
            <div key={group.type}>
              <div className="mb-2.5 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${style.dot}`} /><p className="m-0 text-[13px] font-bold text-neutral-900">{style.label}</p><span className="text-[11px] text-neutral-400">{group.accounts.length} account{group.accounts.length === 1 ? "" : "s"}</span></div>
              <div className="grid gap-3 md:grid-cols-3">
                {group.accounts.map((account) => (
                  <div key={`${account.accountCode}-${account.currency}`} className={`min-w-0 rounded-xl bg-white p-4 ring-1 ring-neutral-200 ${style.border}`}>
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
      <div className="overflow-hidden rounded-2xl ring-1 ring-neutral-200 bg-white shadow-sm">
        <div className="shadow-[inset_0_-1px_0_0_#e5e5e5] p-4"><h3 className="m-0 text-sm font-bold">Double-entry journal</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">Entries are generated once by source key and become immutable when the business date closes. Debit and credit match on every transaction &mdash; that balance is what makes the ledger correct.</p></div>
        <div className="overflow-x-auto overscroll-x-contain">
          <table className="min-w-[900px] border-collapse text-left text-xs">
            <thead><tr className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
              <th className="sticky left-0 z-10 whitespace-nowrap bg-neutral-50 p-3 shadow-[inset_-1px_0_0_0_#e5e5e5,inset_0_-1px_0_0_#e5e5e5]">Transaction</th>
              <th className="whitespace-nowrap shadow-[inset_0_-1px_0_0_#e5e5e5] bg-neutral-50 p-3">Source</th>
              <th className="min-w-[180px] shadow-[inset_0_-1px_0_0_#e5e5e5] bg-neutral-50 p-3">Description</th>
              <th className="min-w-[180px] shadow-[inset_0_-1px_0_0_#e5e5e5] bg-neutral-50 p-3">Accounts</th>
              <th className="bg-blue-50/70 p-3 text-right text-blue-800 shadow-[inset_1px_0_0_0_#dbeafe,inset_0_-1px_0_0_#dbeafe]">Debit</th>
              <th className="bg-violet-50/70 p-3 text-right text-violet-800 shadow-[inset_1px_0_0_0_#ede9fe,inset_0_-1px_0_0_#ede9fe]">Credit</th>
            </tr></thead>
            <tbody>{data?.ledger.transactions.map((transaction) => <tr key={transaction.id} className="group shadow-[inset_0_1px_0_0_#f5f5f5] align-top transition-colors hover:bg-neutral-50/70">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-white p-3 shadow-[inset_-1px_0_0_0_#e5e5e5] font-bold text-neutral-900 transition-colors group-hover:bg-neutral-50">{transaction.transactionNumber}<small className="mt-1 block font-normal text-neutral-400">{time(transaction.occurredAt)}</small></td>
              <td className="whitespace-nowrap p-3 text-neutral-500">{transaction.sourceType.replaceAll("_", " ")}</td>
              <td className="min-w-[180px] max-w-[280px] p-3 text-neutral-700">{transaction.description}</td>
              <td className="min-w-[180px] max-w-[240px] p-3 text-neutral-500">{transaction.entries.map((entry) => <div key={entry.id} className="mb-1">{entry.accountCode} · {entry.accountName}</div>)}</td>
              <td className="bg-blue-50/40 p-3 text-right font-bold tabular-nums text-blue-800 shadow-[inset_1px_0_0_0_#dbeafe]">{cash(transaction.entries.reduce((sum, entry) => sum + Number(entry.debit), 0), transaction.currency)}</td>
              <td className="bg-violet-50/40 p-3 shadow-[inset_1px_0_0_0_#ede9fe] text-right font-bold tabular-nums text-violet-800">{cash(transaction.entries.reduce((sum, entry) => sum + Number(entry.credit), 0), transaction.currency)}</td>
            </tr>)}{!data?.ledger.transactions.length && <tr><td colSpan={6} className="p-10 text-center text-neutral-400">The ledger is posted when Night Audit closes this business date.</td></tr>}</tbody>
          </table>
        </div>
      </div>
    </section>}

    {tab === "tax" && <section className="overflow-hidden rounded-2xl bg-white shadow-[0_14px_38px_-32px_rgba(15,23,42,0.5)] ring-1 ring-neutral-200">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-bold text-neutral-950">Tax register</h3>
          {/* Was toLocaleDateString(), which printed 27/08/2026 next to a
              picker reading 27 Aug 2026. One format per page. */}
          <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">Tax captured separately on transactions for {dayLabel(businessDate)}.</p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-4 py-2.5 text-right ring-1 ring-emerald-200">
          <p className="m-0 text-[10px] font-bold uppercase tracking-wide text-emerald-700/70">Captured tax payable</p>
          <p className="mb-0 mt-0.5 text-lg font-bold tabular-nums text-emerald-900">{cash(data?.tax.total || 0, propertyCurrency)}</p>
        </div>
      </div>

      {/* Was a full-width amber block competing with the figure beside it.
          It is a footnote about how the number is derived, so it reads as one. */}
      {data?.tax.note && (
        <p className="m-0 flex items-start gap-2 bg-amber-50/70 px-5 py-2.5 text-[11px] leading-4 text-amber-900 shadow-[inset_0_1px_0_0_#fde68a]">
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span><span className="font-bold">How this is counted.</span> {data.tax.note}</span>
        </p>
      )}

      {data?.tax.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-xs">
            <thead>
              <tr className="bg-neutral-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400 [&>th]:shadow-[inset_0_-1px_0_0_#e2e8f0]">
                <th className="px-5 py-2.5">Transaction</th>
                <th className="px-3 py-2.5">Date and time</th>
                <th className="px-3 py-2.5">Tax basis</th>
                <th className="px-5 py-2.5 text-right">Tax payable</th>
              </tr>
            </thead>
            <tbody>
              {data.tax.rows.map((row, index) => (
                <tr key={row.transactionNumber} className={`transition hover:bg-neutral-50 ${index < data.tax.rows.length - 1 ? "[&>td]:shadow-[inset_0_-1px_0_0_#f5f5f5]" : ""}`}>
                  <td className="px-5 py-3 font-mono text-[11px] font-bold text-neutral-900">{row.transactionNumber}</td>
                  <td className="px-3 py-3 text-neutral-500">{time(row.occurredAt)}</td>
                  <td className="px-3 py-3 text-neutral-700">{row.description}</td>
                  <td className="px-5 py-3 text-right font-bold tabular-nums text-neutral-900">{cash(row.tax, row.currency)}</td>
                </tr>
              ))}
            </tbody>
            {/* The header total had no counterpart at the foot of the list, so
                a long register gave nothing to reconcile against. */}
            <tfoot>
              <tr className="bg-neutral-50/80 text-[11px] font-bold text-neutral-900 [&>td]:shadow-[inset_0_1px_0_0_#e2e8f0]">
                <td className="px-5 py-3 text-[10px] uppercase tracking-[0.08em] text-neutral-500" colSpan={3}>{data.tax.rows.length} {data.tax.rows.length === 1 ? "transaction" : "transactions"}</td>
                <td className="px-5 py-3 text-right tabular-nums">{cash(data.tax.total || 0, propertyCurrency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="px-5 py-12 text-center">
          <Calculator className="mx-auto h-8 w-8 text-neutral-300" />
          <p className="m-0 mt-3 text-sm font-bold text-neutral-700">No separately captured tax on this date</p>
          <p className="m-0 mt-1 text-xs text-neutral-400">Change the business date above, or check the counting rule.</p>
        </div>
      )}

      <div className="px-5 pb-5"><FiscalReceiptsCard /></div>
    </section>}

    {tab === "nbs" && data && <section className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Metric label="Physical beds available" value={String(data.nbs.bedsAvailable)} note="Active room units and their configured bed counts" /><Metric label="Bed-nights available" value={data.nbs.bedNightsAvailable.toLocaleString()} note={`${data.nbs.bedsAvailable} beds × ${data.nbs.reportingDays} reporting days`} /><Metric label="Bed-nights occupied" value={data.nbs.bedNightsOccupied.toLocaleString()} note={`${data.nbs.roomNightsOccupied} occupied room-nights`} tone="green" /><Metric label="Bed occupancy rate" value={`${data.nbs.bedOccupancyRate.toFixed(1)}%`} note="Occupied bed-nights ÷ available bed-nights" tone="green" /></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-2xl ring-1 ring-neutral-200 bg-white shadow-sm">
          <div className="shadow-[inset_0_-1px_0_0_#e5e5e5] px-5 py-4"><h3 className="m-0 text-sm font-bold">NBS monthly accommodation statistics</h3><p className="mb-0 mt-1 text-[10px] text-neutral-500">Aggregate operational statistics only; no guest-identifying data is included.</p></div>
          <div className="space-y-2 p-3 text-xs">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg ring-1 ring-slate-200 bg-slate-50 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="h-2 w-2 shrink-0 rounded-full bg-slate-400" /><div><p className="m-0 font-semibold text-slate-800">Reporting days in month</p><p className="mb-0 mt-0.5 text-[9px] text-slate-500">Calendar coverage for the selected reporting month</p></div></div><strong className="min-w-12 text-right text-sm tabular-nums text-slate-900">{data.nbs.reportingDays}</strong></div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg ring-1 ring-emerald-100 bg-emerald-50/70 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500" /><div><p className="m-0 font-semibold text-emerald-950">Domestic visitor bed-nights</p><p className="mb-0 mt-0.5 text-[9px] text-emerald-700/70">Occupied bed-nights from Tanzanian residents</p></div></div><strong className="min-w-12 text-right text-sm tabular-nums text-emerald-800">{data.nbs.domesticBedNights}</strong></div>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg ring-1 ring-blue-100 bg-blue-50/70 px-4 py-3"><div className="flex min-w-0 items-center gap-3"><span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" /><div><p className="m-0 font-semibold text-blue-950">International visitor bed-nights</p><p className="mb-0 mt-0.5 text-[9px] text-blue-700/70">Occupied bed-nights from non-resident visitors</p></div></div><strong className="min-w-12 text-right text-sm tabular-nums text-blue-800">{data.nbs.internationalBedNights}</strong></div>
            <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg px-4 py-3 ring-1 ${data.nbs.missingNationalityBedNights ? "ring-amber-200 bg-amber-50" : "ring-teal-100 bg-teal-50/70"}`}><div className="flex min-w-0 items-center gap-3"><span className={`h-2 w-2 shrink-0 rounded-full ${data.nbs.missingNationalityBedNights ? "bg-amber-500" : "bg-teal-500"}`} /><div><p className={`m-0 font-semibold ${data.nbs.missingNationalityBedNights ? "text-amber-950" : "text-teal-950"}`}>Bed-nights missing nationality</p><p className={`mb-0 mt-0.5 text-[9px] ${data.nbs.missingNationalityBedNights ? "text-amber-700" : "text-teal-700/70"}`}>{data.nbs.missingNationalityBedNights ? "Guest nationality records require completion" : "All occupied stays have nationality recorded"}</p></div></div><strong className={`min-w-12 text-right text-sm tabular-nums ${data.nbs.missingNationalityBedNights ? "text-amber-800" : "text-teal-800"}`}>{data.nbs.missingNationalityBedNights}</strong></div>
          </div>
        </div>
        <aside className="rounded-2xl border border-neutral-200 bg-neutral-50 p-5"><h3 className="m-0 text-sm font-bold">Submission readiness</h3><p className="mb-0 mt-3 text-xs leading-5 text-neutral-600">{data.nbs.methodology}</p>{data.nbs.missingNationalityBedNights > 0 && <div className="mt-4 rounded-xl ring-1 ring-amber-200 bg-amber-50 p-3 text-[10px] leading-4 text-amber-800">Complete missing guest nationalities before treating this month as submission-ready.</div>}<div className="mt-4 rounded-xl ring-1 ring-blue-200 bg-blue-50 p-3 text-[10px] leading-4 text-blue-800">Confirm every room’s physical bed count in Room setup. Guest capacity is not used as a substitute.</div></aside>
      </div>
    </section>}
  </div>;
}
