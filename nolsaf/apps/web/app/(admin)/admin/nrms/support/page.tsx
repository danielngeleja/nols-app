"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  BedDouble,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  ClipboardList,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  History,
  LockKeyhole,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Users,
  UtensilsCrossed,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { buildDisputeWorkbook, type DisputeReport } from "@/lib/nrmsDisputeWorkbook";
import { useAdminHref } from "@/lib/adminRecordRefs";
import { useFinanceGrant } from "@/lib/useFinanceGrant";

type AccountOption = {
  propertyId: number;
  propertyTitle: string;
  status: string;
  unpaidBalance: number;
};

type RoomSummary = {
  status: string;
  count: number;
};

type SupportSnapshot = {
  readOnly: true;
  property: {
    id: number;
    title: string;
    owner: {
      id: number;
      name: string;
      email: string | null;
      phone: string | null;
    };
  };
  account: {
    status: string;
    trialEndsAt: string | null;
    unpaidBalance: number;
    unpaidLimit: number;
    policyVersion: string;
  };
  operations: {
    rooms: RoomSummary[];
    openReservations: number;
    openOrders: number;
    openHousekeeping: number;
    activeStaff: number;
    openShift: { id: number; openedAt: string; userId: number } | null;
    lastAudit: { id: number; status: string; reportNumber: string; completedAt: string | null } | null;
  };
};

type ExportForm = {
  format: "PDF" | "XLSX";
  from: string;
  to: string;
  reason: string;
};

// Account status look. Classes spelled out for Tailwind.
const STATUS: Record<string, { label: string; text: string; dot: string; soft: string }> = {
  TRIAL: { label: "Trial", text: "text-sky-700", dot: "bg-sky-500", soft: "bg-sky-50" },
  ACTIVE: { label: "Active", text: "text-emerald-700", dot: "bg-emerald-500", soft: "bg-emerald-50" },
  WARNING: { label: "Warning", text: "text-amber-700", dot: "bg-amber-500", soft: "bg-amber-50" },
  PAYMENT_REQUIRED: { label: "Payment required", text: "text-rose-700", dot: "bg-rose-500", soft: "bg-rose-50" },
  PAYMENT_PENDING: { label: "Payment pending", text: "text-violet-700", dot: "bg-violet-500", soft: "bg-violet-50" },
  CLOSED: { label: "Closed", text: "text-neutral-600", dot: "bg-neutral-400", soft: "bg-neutral-100" },
};
const statusOf = (s: string) => STATUS[s] || { label: s.replaceAll("_", " "), text: "text-neutral-600", dot: "bg-neutral-400", soft: "bg-neutral-100" };

const ROOM_TONE: Record<string, { bar: string; label: string }> = {
  CLEAN: { bar: "bg-emerald-500", label: "Clean" },
  INSPECTED: { bar: "bg-teal-500", label: "Inspected" },
  DIRTY: { bar: "bg-rose-400", label: "Dirty" },
  IN_PROGRESS: { bar: "bg-amber-400", label: "In progress" },
  OUT_OF_SERVICE: { bar: "bg-neutral-400", label: "Out of service" },
};

type SearchScope = "ALL" | "PAYMENT" | "OWING" | "TRIAL";

/** Search filters. Typing one of `words` alone switches to that filter. */
const SEARCH_SCOPES: { key: SearchScope; label: string; test: (a: AccountOption) => boolean; words: string[] }[] = [
  { key: "ALL", label: "All", test: () => true, words: ["all"] },
  { key: "PAYMENT", label: "Needs payment", test: (a) => ["PAYMENT_REQUIRED", "WARNING", "PAYMENT_PENDING"].includes(a.status), words: ["payment", "warning", "overdue", "blocked"] },
  { key: "OWING", label: "Owing", test: (a) => a.unpaidBalance > 0, words: ["owing", "owes", "balance", "debt", "unpaid"] },
  { key: "TRIAL", label: "On trial", test: (a) => a.status === "TRIAL", words: ["trial"] },
];

const RECENT_CASES_KEY = "nolsaf.admin.support.recentProperties";

/** The property name with the matched part emphasised. */
function highlightMatch(title: string, query: string) {
  if (!query) return title;
  const at = title.toLowerCase().indexOf(query);
  if (at < 0) return title;
  return (
    <>
      {title.slice(0, at)}
      <mark className="rounded-sm bg-emerald-100 px-0.5 font-semibold text-[#02665e]">{title.slice(at, at + query.length)}</mark>
      {title.slice(at + query.length)}
    </>
  );
}

function formatMoney(value: number): string {
  return `TZS ${Number(value || 0).toLocaleString("en-TZ")}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });
}

async function exportErrorMessage(cause: any): Promise<string> {
  const payload = cause?.response?.data;
  if (payload instanceof Blob) {
    try {
      const parsed = JSON.parse(await payload.text());
      if (typeof parsed?.error === "string") return parsed.error;
    } catch {
      return "The export could not be generated";
    }
  }
  return payload?.error || "The export could not be generated";
}

export default function SupportPage() {
  const recordHref = useAdminHref();
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [snapshot, setSnapshot] = useState<SupportSnapshot | null>(null);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingSnapshot, setLoadingSnapshot] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "operations" | "exports">("overview");
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [exportHistory, setExportHistory] = useState<{ propertyId: number; title: string; format: string; from: string; to: string; at: string }[]>([]);
  const [form, setForm] = useState<ExportForm>({ format: "PDF", from: "", to: "", reason: "" });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scope, setScope] = useState<SearchScope>("ALL");
  // Recent cases live in this browser only: a per-viewer convenience, never shared.
  const [recentIds, setRecentIds] = useState<number[]>([]);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(RECENT_CASES_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setRecentIds(parsed.filter((n) => Number.isInteger(n)).slice(0, 5));
    } catch {
      // Storage blocked: recents simply stay empty.
    }
  }, []);
  const rememberRecent = (id: number) => {
    setRecentIds((previous) => {
      const next = [id, ...previous.filter((x) => x !== id)].slice(0, 5);
      try { window.localStorage.setItem(RECENT_CASES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  // Finance unlock: read the live grant on load, follow the unlock panel, and lapse on time.
  const { unlocked: financeUnlocked, untilLabel: financeUntilLabel } = useFinanceGrant(
    () => setError((prev) => (prev === "OTP required" ? null : prev)),
  );
  /** Step 2 of the case rail: true once the admin has looked past the overview. */
  const [reviewed, setReviewed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => { setHydrated(true); }, []);

  useEffect(() => {
    let active = true;
    setLoadingAccounts(true);
    apiClient
      .get("/api/admin/nrms/commercial/accounts")
      .then((response) => {
        if (active) setAccounts(response.data?.accounts ?? []);
      })
      .catch((cause: any) => {
        if (active) setError(cause?.response?.data?.error || "Failed to load NRMS properties");
      })
      .finally(() => {
        if (active) setLoadingAccounts(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // "/" anywhere on the page (outside a field) jumps to the property search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close the property picker on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [pickerOpen]);

  const selectedAccount = useMemo(() => accounts.find((a) => String(a.propertyId) === propertyId) ?? null, [accounts, propertyId]);
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), []);

  // Smart search: a typed scope word ("owing", "trial") switches the filter,
  // names that start with the query rank first, and an exact #ID wins.
  const searchState = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const wordScope = SEARCH_SCOPES.find((s) => s.words.includes(q));
    const activeScope = wordScope ? wordScope.key : scope;
    const textQ = wordScope ? "" : q;
    const idQ = textQ.replace(/^#/, "");
    const scopeDef = SEARCH_SCOPES.find((s) => s.key === activeScope) ?? SEARCH_SCOPES[0];
    const matches = accounts
      .filter((a) => scopeDef.test(a) && (!textQ || a.propertyTitle.toLowerCase().includes(textQ) || String(a.propertyId) === idQ))
      .map((a) => ({ a, rank: !textQ ? 0 : String(a.propertyId) === idQ ? -2 : a.propertyTitle.toLowerCase().startsWith(textQ) ? -1 : 0 }))
      .sort((x, y) => x.rank - y.rank || x.a.propertyTitle.localeCompare(y.a.propertyTitle))
      .map((x) => x.a);
    // With nothing typed and no filter, recent cases come first.
    const showRecent = !textQ && activeScope === "ALL";
    const recent = showRecent ? recentIds.map((id) => matches.find((a) => a.propertyId === id)).filter((a): a is AccountOption => Boolean(a)) : [];
    const rest = matches.filter((a) => !recent.includes(a));
    return { list: [...recent, ...rest], recentCount: recent.length, activeScope, textQ, wordScope: Boolean(wordScope) };
  }, [accounts, pickerQuery, scope, recentIds]);
  const filteredAccounts = searchState.list;
  const scopeCounts = useMemo(
    () => Object.fromEntries(SEARCH_SCOPES.map((s) => [s.key, accounts.filter(s.test).length])) as Record<SearchScope, number>,
    [accounts],
  );

  const choosePeriod = (days: number) => {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    setForm((previous) => ({ ...previous, from: start.toISOString().slice(0, 10), to: today }));
  };

  const periodDays = form.from && form.to ? Math.round((new Date(`${form.to}T12:00:00Z`).getTime() - new Date(`${form.from}T12:00:00Z`).getTime()) / 86400000) + 1 : null;

  const roomTotal = useMemo(() => snapshot?.operations.rooms.reduce((total, row) => total + row.count, 0) ?? 0, [snapshot]);
  const readyRooms = useMemo(
    () => snapshot?.operations.rooms.filter((row) => row.status === "CLEAN" || row.status === "INSPECTED").reduce((total, row) => total + row.count, 0) ?? 0,
    [snapshot],
  );

  const exportValidation = useMemo(() => {
    if (!form.from || !form.to) return "Choose the start and end dates";
    const from = new Date(`${form.from}T00:00:00`);
    const to = new Date(`${form.to}T23:59:59`);
    if (to < from) return "The end date must be on or after the start date";
    if (form.to > today) return "The reporting period cannot end in the future";
    if (to.getTime() - from.getTime() > 366 * 86400000) return "Choose a period of up to 366 days";
    if (form.reason.trim().length < 5) return "Enter a reason of at least 5 characters";
    return null;
  }, [form, today]);

  const loadSnapshot = async (id: string = propertyId) => {
    if (!id || loadingSnapshot || exporting) return;
    setLoadingSnapshot(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.get(`/api/admin/nrms/support/property/${id}/snapshot`);
      setSnapshot(response.data);
      setLoadedAt(new Date().toISOString());
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to open the support snapshot");
    } finally {
      setLoadingSnapshot(false);
    }
  };

  // Picking a property opens its snapshot straight away.
  /** Close the open case and go back to choosing a property. */
  const closeCase = () => {
    setPropertyId("");
    setSnapshot(null);
    setTab("overview");
    setReviewed(false);
    setForm({ format: "PDF", from: "", to: "", reason: "" });
    setPickerQuery("");
    searchRef.current?.focus();
  };

  const pickProperty = (id: number) => {
    const next = String(id);
    rememberRecent(id);
    setPickerOpen(false);
    setPickerQuery("");
    setScope("ALL");
    if (next === propertyId && snapshot) return;
    setPropertyId(next);
    setSnapshot(null);
    setTab("overview");
    setReviewed(false);
    setForm({ format: "PDF", from: "", to: "", reason: "" });
    void loadSnapshot(next);
  };

  const exportFile = async () => {
    if (!snapshot || snapshot.property.id !== Number(propertyId) || exportValidation || exporting || loadingSnapshot) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const body = {
        format: form.format,
        from: new Date(`${form.from}T00:00:00+03:00`).toISOString(),
        to: new Date(`${form.to}T23:59:59.999+03:00`).toISOString(),
        reason: form.reason.trim(),
      };
      const endpoint = `/api/admin/nrms/support/property/${propertyId}/dispute-export`;
      let blob: Blob;
      let fileName = `nrms-dispute-${propertyId}-${form.from}-${form.to}.${form.format.toLowerCase()}`;
      if (form.format === "XLSX") {
        // The API audits the export and returns redacted rows; the workbook is styled here with
        // the same ExcelJS house style as the NRMS property report.
        const response = await apiClient.post(endpoint, body);
        const report = response.data?.report as DisputeReport | undefined;
        if (!report) throw new Error("The export data could not be read");
        blob = await buildDisputeWorkbook(report);
        fileName = `${report.documentNumber}-${form.from}-${form.to}.xlsx`;
      } else {
        const response = await apiClient.post(endpoint, body, { responseType: "blob" });
        blob = response.data;
      }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportHistory((previous) => [{ propertyId: snapshot.property.id, title: snapshot.property.title, format: form.format, from: form.from, to: form.to, at: new Date().toISOString() }, ...previous]);
      setNotice(`${form.format === "XLSX" ? "Excel workbook" : form.format} generated. The action was audited and the owner was notified.`);
    } catch (cause: any) {
      setError(await exportErrorMessage(cause));
    } finally {
      setExporting(false);
    }
  };

  const sessionExports = snapshot ? exportHistory.filter((row) => row.propertyId === snapshot.property.id) : [];
  const rangeOk = Boolean(form.from && form.to && form.to >= form.from && form.to <= today && periodDays != null && periodDays <= 367);
  const checklist = [
    { label: "Property snapshot loaded", ready: Boolean(snapshot) },
    { label: "Reporting period (EAT)", ready: rangeOk },
    { label: "Audit reason", ready: form.reason.trim().length >= 5 },
  ];

  // Looking at operations or exports counts as having reviewed the context.
  useEffect(() => {
    if (snapshot && tab !== "overview") setReviewed(true);
  }, [snapshot, tab]);

  /** The live case rail. Each step knows if it is done, current, and where it goes. */
  const exported = sessionExports.length > 0;
  const caseSteps = [
    {
      title: "Open a property", icon: Building2,
      sub: snapshot ? snapshot.property.title : loadingSnapshot ? "Opening the snapshot" : "Search above or pick below",
      done: Boolean(snapshot), current: !snapshot, enabled: true,
      go: () => searchRef.current?.focus(),
    },
    {
      title: "Review the context", icon: Activity,
      sub: reviewed ? "Standing and operations read" : "Standing, owner, rooms, audits",
      done: Boolean(snapshot) && reviewed, current: Boolean(snapshot) && !reviewed, enabled: Boolean(snapshot),
      go: () => setTab(tab === "overview" ? "operations" : "overview"),
    },
    {
      title: "Export evidence", icon: FileText,
      sub: exported ? `${sessionExports.length} export${sessionExports.length === 1 ? "" : "s"} made` : exportValidation ? "Period and reason needed" : "Ready to generate",
      done: exported, current: Boolean(snapshot) && reviewed && !exported, enabled: Boolean(snapshot),
      go: () => setTab("exports"),
    },
  ];

  /** Properties most likely behind a support call: payment trouble first, then balance. */
  const suggestions = useMemo(() => {
    const weight = (a: AccountOption) =>
      a.status === "PAYMENT_REQUIRED" ? 4 : a.status === "WARNING" ? 3 : a.status === "PAYMENT_PENDING" ? 2 : a.unpaidBalance > 0 ? 1 : 0;
    return [...accounts].sort((a, b) => weight(b) - weight(a) || b.unpaidBalance - a.unpaidBalance || a.propertyTitle.localeCompare(b.propertyTitle)).slice(0, 6);
  }, [accounts]);

  return (
    <div className="w-full min-w-0 space-y-4">
      {/* Console header with the live case rail */}
      <header className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-start sm:justify-between sm:px-6 sm:pt-5">
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-500">
              <Link href="/admin/nrms" className="text-neutral-500 no-underline hover:text-[#02665e]">NRMS</Link>
              <ChevronRight className="h-3 w-3 text-neutral-300" aria-hidden />
              <span>Support operations</span>
              {financeUnlocked ? (
                <span className="ml-1 inline-flex items-center gap-1 rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-[#02665e] ring-1 ring-inset ring-emerald-100"><ShieldCheck className="h-3 w-3" aria-hidden /> Finance unlocked</span>
              ) : (
                <span className="ml-1 inline-flex items-center gap-1 rounded bg-neutral-100 px-1.5 py-0.5 font-semibold text-neutral-600"><LockKeyhole className="h-3 w-3" aria-hidden /> Read only</span>
              )}
            </p>
            <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Support workspace</h1>
            <p className="m-0 mt-1 text-[12px] text-neutral-500">Open a property, read its context, and export audited evidence for a dispute.</p>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:shrink-0">
            {financeUnlocked ? (
              <span className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-50 px-3.5 text-xs font-semibold text-[#02665e] ring-1 ring-inset ring-emerald-200 sm:flex-none">
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Unlocked until {financeUntilLabel} EAT
              </span>
            ) : (
              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))}
                className="inline-flex h-9 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3.5 text-xs font-semibold text-white transition hover:bg-[#014d47] sm:flex-none"
              >
                <LockKeyhole className="h-3.5 w-3.5" aria-hidden /> Unlock finance actions
              </button>
            )}
            <Link href="/admin/nrms" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-3.5 text-xs font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline sm:flex-none">
              NRMS directory <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        </div>

        {/* Case rail: the three steps, live. A step ticks off when it is actually done. */}
        <nav aria-label="Investigation steps" className="relative mt-4 border-0 border-t border-solid border-neutral-100">
          <span className="absolute inset-x-0 top-0 h-0.5 bg-neutral-100" aria-hidden />
          <span className="absolute left-0 top-0 h-0.5 bg-[#02665e] transition-all duration-500" style={{ width: `${(caseSteps.filter((s) => s.done).length / caseSteps.length) * 100}%` }} aria-hidden />
          <ol className="m-0 grid list-none grid-cols-3 p-0">
            {caseSteps.map((step, index) => {
              const Icon = step.icon;
              return (
                <li key={step.title} className={`min-w-0 ${index > 0 ? "border-0 border-l border-solid border-neutral-100" : ""}`}>
                  <button
                    type="button"
                    onClick={step.go}
                    disabled={!step.enabled}
                    aria-current={step.current ? "step" : undefined}
                    className={`flex h-full w-full min-w-0 cursor-pointer items-start gap-2.5 border-0 px-3 py-3 text-left transition disabled:cursor-not-allowed sm:gap-3 sm:px-6 sm:py-3.5 ${step.current ? "bg-emerald-50/50" : "bg-transparent hover:bg-neutral-50 disabled:hover:bg-transparent"}`}
                  >
                    <span
                      className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold transition ${
                        step.done ? "bg-[#02665e] text-white" : step.current ? "bg-white text-[#02665e] ring-2 ring-[#02665e]" : "bg-neutral-100 text-neutral-400"
                      }`}
                    >
                      {step.done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : index + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`flex items-center gap-1.5 text-[12px] font-bold sm:text-sm ${step.enabled ? "text-neutral-900" : "text-neutral-400"}`}>
                        <Icon className="hidden h-3.5 w-3.5 shrink-0 text-neutral-400 sm:block" aria-hidden />
                        <span className="truncate">{step.title}</span>
                      </span>
                      <span className={`mt-0.5 hidden truncate text-[11px] sm:block ${step.current ? "text-[#02665e]" : "text-neutral-400"}`}>{step.sub}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </header>

      {/* Smart search: the open case sits in the field as a chip; "/" focuses it */}
      <div ref={pickerRef} className="relative">
        <div className={`flex min-w-0 items-stretch overflow-hidden rounded-lg border border-solid bg-white transition ${pickerOpen ? "border-[#02665e] ring-4 ring-emerald-50" : "border-neutral-200 hover:border-neutral-300"}`}>
          <label htmlFor="support-property-search" className="flex shrink-0 cursor-text items-center gap-2 bg-[#0b2420] px-3 text-white sm:px-4">
            <Search className="h-4 w-4 text-emerald-300" aria-hidden />
            <span className="hidden text-[11px] font-bold uppercase tracking-[0.14em] sm:inline">Investigate</span>
          </label>
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-3 py-2 sm:flex-nowrap">
          {selectedAccount ? (
            <span className="inline-flex max-w-full min-w-0 shrink-0 items-center gap-2 rounded-md bg-[#0b2420] py-1 pl-2.5 pr-1 text-white sm:max-w-[60%]">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusOf(selectedAccount.status).dot}`} aria-hidden />
              <span className="min-w-0 truncate text-[12px] font-semibold">{selectedAccount.propertyTitle}</span>
              <span className={`hidden shrink-0 text-[11px] tabular-nums sm:inline ${selectedAccount.unpaidBalance > 0 ? "text-amber-200" : "text-white/50"}`}>
                {selectedAccount.unpaidBalance > 0 ? formatMoney(selectedAccount.unpaidBalance) : "Nothing owed"}
              </span>
              <button
                type="button"
                onClick={closeCase}
                aria-label={`Close the ${selectedAccount.propertyTitle} case`}
                title="Close case"
                className="grid h-5 w-5 shrink-0 cursor-pointer place-items-center rounded border-0 bg-white/10 text-white/70 transition hover:bg-white/20 hover:text-white"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ) : null}
          {scope !== "ALL" ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-50 py-0.5 pl-2 pr-0.5 text-[11px] font-semibold text-[#02665e] ring-1 ring-inset ring-emerald-100">
              {SEARCH_SCOPES.find((s) => s.key === scope)?.label}
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setScope("ALL"); setActiveIndex(0); }}
                aria-label="Clear filter"
                className="grid h-4 w-4 cursor-pointer place-items-center rounded border-0 bg-transparent text-[#02665e] hover:bg-emerald-100"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ) : null}
          <input
            id="support-property-search"
            ref={searchRef}
            value={pickerQuery}
            onFocus={() => setPickerOpen(true)}
            onChange={(e) => { setPickerQuery(e.target.value); setPickerOpen(true); setActiveIndex(0); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setPickerOpen(true); setActiveIndex((i) => Math.min(i + 1, Math.max(0, filteredAccounts.length - 1))); }
              if (e.key === "ArrowUp") { e.preventDefault(); setActiveIndex((i) => Math.max(0, i - 1)); }
              if (e.key === "Enter" && filteredAccounts[activeIndex]) { e.preventDefault(); pickProperty(filteredAccounts[activeIndex].propertyId); searchRef.current?.blur(); }
              if (e.key === "Escape") { setPickerOpen(false); searchRef.current?.blur(); }
            }}
            // Only disable after mount, so the server HTML and the first client render agree.
            disabled={hydrated && (loadingAccounts || exporting)}
            placeholder={
              loadingAccounts ? "Loading properties..."
                : selectedAccount ? "Switch property..."
                : `Search ${accounts.length} properties by name or #ID`
            }
            aria-label="Search NRMS properties"
            aria-expanded={pickerOpen}
            aria-controls="support-property-results"
            role="combobox"
            className="min-w-[10rem] flex-1 border-0 bg-transparent py-1 text-sm text-neutral-900 outline-none placeholder:text-neutral-400 disabled:opacity-60"
          />
          </div>
          {/* At rest the bar already says where attention is needed: one click filters. */}
          {!pickerQuery && scope === "ALL" && !loadingSnapshot ? (
            <div className="hidden shrink-0 items-center gap-1.5 pr-2 lg:flex" role="group" aria-label="Quick filters">
              {SEARCH_SCOPES.filter((s) => s.key !== "ALL").map((s) => {
                const count = scopeCounts[s.key] ?? 0;
                const dot = s.key === "PAYMENT" ? "bg-amber-500" : s.key === "OWING" ? "bg-rose-500" : "bg-sky-500";
                return (
                  <button
                    key={s.key}
                    type="button"
                    disabled={count === 0}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { setScope(s.key); setActiveIndex(0); setPickerOpen(true); searchRef.current?.focus(); }}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-neutral-50 px-2 py-1 text-[11px] font-medium text-neutral-600 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-[#02665e] disabled:cursor-default disabled:opacity-40 disabled:hover:border-neutral-200 disabled:hover:bg-neutral-50 disabled:hover:text-neutral-600"
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
                    {s.label}
                    <span className="font-bold tabular-nums text-neutral-900">{count}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="flex shrink-0 items-center pr-3">
            {loadingSnapshot ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#02665e]"><Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> Opening</span>
            ) : (
              <kbd className="hidden rounded border border-solid border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-sans text-[10px] font-semibold text-neutral-400 sm:inline">/</kbd>
            )}
          </div>
        </div>

        {pickerOpen && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)]">
            {/* Filters, with live counts. Mouse down keeps focus in the field. */}
            <div className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-neutral-100 px-2 py-2" role="group" aria-label="Filter properties">
              {SEARCH_SCOPES.map((s) => {
                const on = searchState.activeScope === s.key;
                return (
                  <button
                    key={s.key}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setScope(s.key);
                      setActiveIndex(0);
                      if (searchState.wordScope) setPickerQuery("");
                    }}
                    aria-pressed={on}
                    className={`inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border-0 px-2.5 py-1 text-[11px] font-semibold transition ${on ? "bg-[#02665e] text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
                  >
                    {s.label}
                    <span className={`tabular-nums ${on ? "text-white/70" : "text-neutral-400"}`}>{scopeCounts[s.key] ?? 0}</span>
                  </button>
                );
              })}
            </div>

            <ul id="support-property-results" role="listbox" className="m-0 max-h-80 list-none overflow-y-auto p-1">
              {filteredAccounts.length === 0 ? (
                <li className="px-3 py-6 text-center text-xs text-neutral-500">
                  No property matches{searchState.textQ ? ` "${searchState.textQ}"` : ""}{searchState.activeScope !== "ALL" ? " in this filter" : ""}.
                </li>
              ) : (
                filteredAccounts.map((a, index) => {
                  const st = statusOf(a.status);
                  const chosen = String(a.propertyId) === propertyId;
                  const highlighted = index === activeIndex;
                  const sectionLabel = searchState.recentCount > 0 && index === 0
                    ? "Recent cases"
                    : searchState.recentCount > 0 && index === searchState.recentCount
                      ? "All properties"
                      : null;
                  return (
                    <li key={a.propertyId}>
                      {sectionLabel ? <p className="m-0 px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{sectionLabel}</p> : null}
                      <button
                        type="button"
                        role="option"
                        aria-selected={chosen}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => pickProperty(a.propertyId)}
                        className={`flex w-full cursor-pointer items-center gap-3 rounded-md border-0 px-3 py-2 text-left transition ${highlighted ? "bg-emerald-50" : "bg-transparent"}`}
                      >
                        {index < searchState.recentCount
                          ? <History className="h-3.5 w-3.5 shrink-0 text-neutral-300" aria-hidden />
                          : <span className={`h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-neutral-900">{highlightMatch(a.propertyTitle, searchState.textQ)}</span>
                          <span className="text-[11px] text-neutral-400">
                            <span className="font-mono">#{a.propertyId}</span>
                            <span className={st.text}> · {st.label}</span>
                            {chosen ? <span className="font-semibold text-[#02665e]"> · open now</span> : null}
                          </span>
                        </span>
                        <span className={`shrink-0 text-right text-xs tabular-nums ${a.unpaidBalance > 0 ? "font-semibold text-rose-600" : "text-neutral-300"}`}>
                          {a.unpaidBalance > 0 ? formatMoney(a.unpaidBalance) : "Settled"}
                        </span>
                        {highlighted ? <span className="hidden shrink-0 rounded border border-solid border-neutral-200 bg-white px-1 text-[10px] font-semibold text-neutral-400 sm:inline">Enter</span> : null}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-0 border-t border-solid border-neutral-100 bg-neutral-50 px-3 py-1.5 text-[10px] text-neutral-400">
              <span className="font-semibold text-neutral-500">{filteredAccounts.length} {filteredAccounts.length === 1 ? "property" : "properties"}</span>
              <span><kbd className="font-sans font-semibold">↑ ↓</kbd> move</span>
              <span><kbd className="font-sans font-semibold">Enter</kbd> open</span>
              <span><kbd className="font-sans font-semibold">Esc</kbd> close</span>
              <span className="hidden sm:inline">Type <span className="font-semibold">owing</span>, <span className="font-semibold">trial</span> or <span className="font-semibold">payment</span> to filter</span>
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 px-1 text-[11px] text-neutral-500">
        <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Guest identifiers redacted in exports</span>
        <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Every export is audited and the owner is notified</span>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error === "OTP required" ? "Finance OTP required. Use Unlock finance actions, then try again." : error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Before a property is open: start where you are most likely needed */}
      {!snapshot && !loadingSnapshot && (
        <section aria-label="Suggested properties" className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-2 pt-4 sm:px-5">
            <div>
              <h2 className="m-0 text-sm font-bold text-neutral-900">Start where you are needed</h2>
              <p className="m-0 mt-0.5 text-[11px] text-neutral-500">Properties most likely behind a support call: payment trouble first, then the largest balances.</p>
            </div>
            <span className="text-[11px] text-neutral-400">{accounts.length} NRMS {accounts.length === 1 ? "property" : "properties"}</span>
          </div>
          {loadingAccounts ? (
            <div className="grid gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse bg-white" />)}</div>
          ) : suggestions.length === 0 ? (
            <p className="m-0 px-5 pb-5 text-xs text-neutral-500">No NRMS properties yet.</p>
          ) : (
            <div className="grid gap-px border-0 border-t border-solid border-neutral-100 bg-neutral-100 sm:grid-cols-2 lg:grid-cols-3">
              {suggestions.map((a) => {
                const st = statusOf(a.status);
                const urgent = a.status === "PAYMENT_REQUIRED" || a.status === "WARNING";
                return (
                  <button
                    key={a.propertyId}
                    type="button"
                    onClick={() => pickProperty(a.propertyId)}
                    className="group flex min-w-0 cursor-pointer items-start gap-3 border-0 bg-white px-4 py-3.5 text-left transition hover:bg-emerald-50/50 sm:px-5"
                  >
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-neutral-900">{a.propertyTitle}</span>
                      <span className={`mt-0.5 block truncate text-[11px] ${urgent ? st.text : "text-neutral-500"}`}>
                        {urgent ? st.label : a.unpaidBalance > 0 ? `Owes ${formatMoney(a.unpaidBalance)}` : `${st.label}, nothing owed`}
                        {urgent && a.unpaidBalance > 0 ? ` · ${formatMoney(a.unpaidBalance)}` : ""}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-neutral-300 transition group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {loadingSnapshot && !snapshot && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-solid border-neutral-200 bg-white py-16 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening support snapshot
        </div>
      )}

      {snapshot && (() => {
        const st = statusOf(snapshot.account.status);
        const unpaidPct = snapshot.account.unpaidLimit > 0 ? Math.min((snapshot.account.unpaidBalance / snapshot.account.unpaidLimit) * 100, 100) : 0;
        return (
          <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
            {/* Case header */}
            <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:px-6">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="m-0 truncate text-lg font-bold text-neutral-950">{snapshot.property.title}</h2>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.soft} ${st.text}`}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</span>
                </div>
                <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                  <span className="font-mono">Property #{snapshot.property.id}</span>
                  <span className="inline-flex items-center gap-1"><History className="h-3.5 w-3.5" /> Snapshot {formatDateTime(loadedAt)} EAT</span>
                </p>
              </div>
              <div className="flex flex-shrink-0 flex-wrap gap-2">
                <button type="button" onClick={() => void loadSnapshot()} disabled={loadingSnapshot || exporting} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-50 disabled:opacity-60">
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingSnapshot ? "animate-spin" : ""}`} /> Refresh
                </button>
                <Link href={recordHref("property", snapshot.property.id)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
                  Property <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <Link href={recordHref("property", snapshot.property.id, { base: "/admin/nrms/integrity" })} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
                  Activity log <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>

            {/* Tabs */}
            <nav className="mt-4 flex gap-1 border-0 border-b border-solid border-neutral-200 px-3 sm:px-4" aria-label="Support workspace sections">
              {([["overview", "Overview", ClipboardList], ["operations", "Operations", Activity], ["exports", "Dispute exports", FileText]] as const).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={tab === value}
                  onClick={() => setTab(value)}
                  className={`relative inline-flex h-11 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === value ? "text-[#02665e]" : "text-neutral-500 hover:text-neutral-800"}`}
                >
                  <Icon className="h-4 w-4" /> {label}
                  {value === "exports" && sessionExports.length > 0 && <span className="rounded-full bg-emerald-100 px-1.5 text-[11px] tabular-nums text-[#02665e]">{sessionExports.length}</span>}
                  {tab === value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-[#02665e]" aria-hidden />}
                </button>
              ))}
            </nav>

            {/* Overview */}
            <div hidden={tab !== "overview"} className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-md border border-solid border-neutral-200">
                  <p className="m-0 border-0 border-b border-solid border-neutral-100 px-4 py-2.5 text-xs font-semibold text-neutral-800">Owner</p>
                  <div className="flex items-center gap-3 px-4 py-3">
                    <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-neutral-900 text-white"><User className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="m-0 truncate text-sm font-semibold text-neutral-900">{snapshot.property.owner.name}</p>
                      <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-xs text-neutral-500"><Mail className="h-3.5 w-3.5 flex-shrink-0" />{snapshot.property.owner.email ?? "No email"}</p>
                      <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500"><Phone className="h-3.5 w-3.5 flex-shrink-0" />{snapshot.property.owner.phone ?? "No phone"}</p>
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-solid border-neutral-200">
                  <p className="m-0 border-0 border-b border-solid border-neutral-100 px-4 py-2.5 text-xs font-semibold text-neutral-800">Account standing</p>
                  <div className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-neutral-500">Outstanding</span>
                      <span className={`text-lg font-bold tabular-nums ${snapshot.account.unpaidBalance > 0 ? "text-rose-600" : "text-neutral-900"}`}>{formatMoney(snapshot.account.unpaidBalance)}</span>
                    </div>
                    {snapshot.account.unpaidLimit > 0 && (
                      <>
                        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
                          <div className={`h-full rounded-full ${unpaidPct >= 80 ? "bg-rose-500" : unpaidPct >= 50 ? "bg-amber-400" : "bg-emerald-500"}`} style={{ width: `${unpaidPct}%` }} />
                        </div>
                        <p className="m-0 mt-1 text-[11px] text-neutral-400">{Math.round(unpaidPct)}% of the {formatMoney(snapshot.account.unpaidLimit)} limit</p>
                      </>
                    )}
                    <dl className="m-0 mt-3 grid grid-cols-2 gap-2 text-xs">
                      <div><dt className="text-neutral-400">Policy</dt><dd className="m-0 font-mono text-neutral-800">{snapshot.account.policyVersion}</dd></div>
                      <div><dt className="text-neutral-400">Trial ends</dt><dd className="m-0 text-neutral-800">{formatDate(snapshot.account.trialEndsAt)}</dd></div>
                    </dl>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-solid border-neutral-200 bg-neutral-200 md:grid-cols-4">
                {[
                  { icon: BedDouble, label: "Open stays", value: snapshot.operations.openReservations },
                  { icon: UtensilsCrossed, label: "Open orders", value: snapshot.operations.openOrders },
                  { icon: ClipboardList, label: "Housekeeping tasks", value: snapshot.operations.openHousekeeping },
                  { icon: Users, label: "Active staff", value: snapshot.operations.activeStaff },
                ].map((m) => {
                  const Icon = m.icon;
                  return (
                    <button key={m.label} type="button" onClick={() => setTab("operations")} className="flex min-w-0 items-center gap-3 border-0 bg-white px-4 py-3 text-left transition hover:bg-neutral-50">
                      <Icon className="h-4 w-4 flex-shrink-0 text-neutral-400" />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] text-neutral-500">{m.label}</span>
                        <span className="block text-xl font-bold tabular-nums text-neutral-900">{m.value}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Operations */}
            <div hidden={tab !== "operations"} className="space-y-5 p-5 sm:p-6">
              <div className="rounded-md border border-solid border-neutral-200 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="m-0 text-sm font-semibold text-neutral-900">Room readiness</h3>
                  <span className="text-xs text-neutral-500"><span className="text-lg font-bold tabular-nums text-neutral-900">{readyRooms}</span> of {roomTotal} rooms ready</span>
                </div>
                {roomTotal === 0 ? (
                  <p className="m-0 mt-2 text-xs text-neutral-500">No active rooms configured.</p>
                ) : (
                  <>
                    <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-neutral-100" aria-hidden="true">
                      {snapshot.operations.rooms.map((row) => <span key={row.status} className={ROOM_TONE[row.status]?.bar ?? "bg-neutral-400"} style={{ width: `${(row.count / roomTotal) * 100}%` }} />)}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
                      {snapshot.operations.rooms.map((row) => (
                        <span key={row.status} className="inline-flex items-center gap-1.5 text-xs text-neutral-600">
                          <span className={`h-2 w-2 rounded-full ${ROOM_TONE[row.status]?.bar ?? "bg-neutral-400"}`} />
                          {ROOM_TONE[row.status]?.label ?? row.status.replaceAll("_", " ")}
                          <span className="font-semibold tabular-nums text-neutral-900">{row.count}</span>
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-md border border-solid border-neutral-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-sm font-semibold text-neutral-900">Cashier shift</h3>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${snapshot.operations.openShift ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>
                      {snapshot.operations.openShift ? <Circle className="h-2 w-2 fill-current" /> : null}
                      {snapshot.operations.openShift ? "Open now" : "No open shift"}
                    </span>
                  </div>
                  {snapshot.operations.openShift ? (
                    <p className="m-0 mt-3 text-sm text-neutral-800">Opened {formatDateTime(snapshot.operations.openShift.openedAt)} <span className="text-neutral-400">EAT</span><span className="mt-0.5 block font-mono text-[11px] text-neutral-400">Shift #{snapshot.operations.openShift.id}</span></p>
                  ) : (
                    <p className="m-0 mt-3 text-xs text-neutral-500">All cashier shifts are closed.</p>
                  )}
                </div>
                <div className="rounded-md border border-solid border-neutral-200 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="m-0 text-sm font-semibold text-neutral-900">Latest night audit</h3>
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">{snapshot.operations.lastAudit ? snapshot.operations.lastAudit.status.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "None"}</span>
                  </div>
                  {snapshot.operations.lastAudit ? (
                    <p className="m-0 mt-3 text-sm text-neutral-800">
                      <span className="break-all font-mono">{snapshot.operations.lastAudit.reportNumber}</span>
                      <span className="mt-0.5 block text-xs text-neutral-500">Completed {formatDateTime(snapshot.operations.lastAudit.completedAt)} EAT</span>
                    </p>
                  ) : (
                    <p className="m-0 mt-3 text-xs text-neutral-500">No night audit recorded yet.</p>
                  )}
                </div>
              </div>
              <p className="m-0 text-[11px] text-neutral-400">Point-in-time snapshot. Refresh to see the latest figures.</p>
            </div>

            {/* Dispute exports */}
            <div hidden={tab !== "exports"}>
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-6 p-5 sm:p-6">
                  {/* 1. Format */}
                  <div>
                    <p className="m-0 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] text-[10px] font-bold text-white">1</span> Report format
                    </p>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      {([
                        ["PDF", FileText, "PDF summary", "Readable summary of orders, reservations and PAYG statements"],
                        ["XLSX", FileSpreadsheet, "Excel workbook", "NRMS report workbook: cover, schedules with totals, basis sheet"],
                      ] as const).map(([value, Icon, title, text]) => {
                        const on = form.format === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setForm({ ...form, format: value })}
                            aria-pressed={on}
                            disabled={exporting}
                            className={`flex items-start gap-3 rounded-md border border-solid p-3 text-left transition ${on ? "border-[#02665e] bg-emerald-50/60 ring-2 ring-emerald-100" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
                          >
                            <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${on ? "bg-[#02665e] text-white" : "bg-neutral-100 text-neutral-500"}`}><Icon className="h-4 w-4" /></span>
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold text-neutral-900">{title}</span>
                              <span className="mt-0.5 block text-xs text-neutral-500">{text}</span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* 2. Period */}
                  <div>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="m-0 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] text-[10px] font-bold text-white">2</span> Reporting period
                      </p>
                      <span className="text-[11px] text-neutral-400">East Africa Time · up to 366 days</span>
                    </div>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {[{ days: 1, label: "Today" }, { days: 7, label: "Last 7 days" }, { days: 30, label: "Last 30 days" }, { days: 90, label: "Last 90 days" }].map((p) => {
                        const on = periodDays === p.days && form.to === today;
                        return (
                          <button key={p.days} type="button" disabled={exporting} onClick={() => choosePeriod(p.days)} className={`h-8 rounded-full border border-solid px-3 text-xs font-medium transition disabled:opacity-50 ${on ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>
                            {p.label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="min-w-0">
                        <span className="mb-1.5 block text-xs text-neutral-500">From</span>
                        <DatePickerField label="Dispute export period starts" value={form.from} max={form.to || today} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setForm({ ...form, from: next.slice(0, 10) })} />
                      </div>
                      <div className="min-w-0">
                        <span className="mb-1.5 block text-xs text-neutral-500">To</span>
                        <DatePickerField label="Dispute export period ends" value={form.to} min={form.from || undefined} max={today} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setForm({ ...form, to: next.slice(0, 10) })} />
                      </div>
                    </div>
                  </div>

                  {/* 3. Reason */}
                  <div>
                    <label htmlFor="export-reason" className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold text-neutral-900">
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] text-[10px] font-bold text-white">3</span> Purpose
                      </span>
                      <span className="text-[11px] tabular-nums text-neutral-400">{form.reason.trim().length}/300</span>
                    </label>
                    <textarea
                      id="export-reason"
                      value={form.reason}
                      maxLength={300}
                      rows={3}
                      onChange={(event) => setForm({ ...form, reason: event.target.value })}
                      placeholder="Example: Owner disputed statement #42"
                      className="mt-2.5 min-h-24 w-full min-w-0 resize-none rounded-lg border border-solid border-neutral-200 px-3 py-2.5 font-[inherit] text-sm text-neutral-800 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                    />
                    <p className="m-0 mt-1 text-[11px] text-neutral-400">Saved in the admin audit and included in the owner notification.</p>
                  </div>
                </div>

                {/* Summary + generate */}
                <aside className="min-w-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50 p-5 sm:p-6 lg:border-l lg:border-t-0">
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Export summary</p>
                  <div className="mt-3 rounded-md border border-solid border-neutral-200 bg-white p-3">
                    <p className="m-0 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                      {form.format === "PDF" ? <FileText className="h-4 w-4 text-[#02665e]" /> : <FileSpreadsheet className="h-4 w-4 text-[#02665e]" />}
                      {form.format} · {snapshot.property.title}
                    </p>
                    <p className="m-0 mt-1 text-xs text-neutral-500">
                      {form.from && form.to ? `${formatDate(form.from)} to ${formatDate(form.to)}${periodDays ? ` · ${periodDays} ${periodDays === 1 ? "day" : "days"}` : ""}` : "No period selected"}
                    </p>
                  </div>
                  <ul className="m-0 mt-4 list-none space-y-2 p-0">
                    {checklist.map((c) => (
                      <li key={c.label} className={`flex items-center gap-2 text-xs ${c.ready ? "text-neutral-800" : "text-neutral-400"}`}>
                        {c.ready ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
                        {c.label}
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    disabled={Boolean(exportValidation) || exporting}
                    onClick={() => void exportFile()}
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] text-sm font-semibold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
                  >
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {exporting ? "Generating export" : `Generate ${form.format}`}
                  </button>
                  <p className={`m-0 mt-2 text-center text-[11px] ${exportValidation ? "text-neutral-500" : "text-emerald-700"}`}>{exportValidation ?? "Ready to generate"}</p>
                  <p className="m-0 mt-4 border-0 border-t border-solid border-neutral-200 pt-3 text-[11px] leading-4 text-neutral-500">
                    <LockKeyhole className="mr-1 inline h-3 w-3 align-[-1px]" />
                    The server checks finance authorization, records the reason and notifies the owner. Guest identifiers are redacted.
                  </p>
                </aside>
              </div>

              {/* Session downloads */}
              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4 sm:px-6">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="m-0 text-sm font-semibold text-neutral-900">Downloads this session</h3>
                  <span className="text-[11px] text-neutral-400">Resets on reload. Server audits stay stored.</span>
                </div>
                {sessionExports.length === 0 ? (
                  <p className="m-0 mt-2 text-xs text-neutral-500">No exports generated for this property yet.</p>
                ) : (
                  <ul className="m-0 mt-3 list-none space-y-1.5 p-0">
                    {sessionExports.map((row, index) => (
                      <li key={`${row.at}-${index}`} className="flex flex-wrap items-center gap-3 rounded-lg bg-neutral-50 px-3 py-2 text-xs">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-neutral-900">
                          {row.format === "PDF" ? <FileText className="h-3.5 w-3.5 text-[#02665e]" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-[#02665e]" />}{row.format}
                        </span>
                        <span className="text-neutral-600">{formatDate(row.from)} to {formatDate(row.to)}</span>
                        <span className="ml-auto text-neutral-400">Generated {formatDateTime(row.at)} EAT</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </section>
        );
      })()}
    </div>
  );
}
