"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Landmark, ListChecks, Loader2, RotateCcw, Search, Users, X } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";

type SummaryEntry = { count: number; amount: string };
type Summary = {
  rows: number;
  recipients: number;
  totals: Array<SummaryEntry & { currency: string }>;
  byStatus: Array<SummaryEntry & { status: string }>;
  byGroup: Array<SummaryEntry & { sourceType: string; label: string }>;
  byDestination: Array<SummaryEntry & { bankName: string }>;
};

type ReportRow = {
  id: number;
  externalReferenceId: string;
  pgReferenceId: string | null;
  status: string;
  sourceType: string;
  sourceId: number;
  amount: string;
  currency: string;
  bankName: string;
  riskLevel: string | null;
  remarks: string | null;
  createdAt: string;
  approvedAt: string | null;
  paidAt: string | null;
  batch: { id: number; batchReference: string; status: string } | null;
  recipient: {
    userId: number;
    name: string;
    accountName: string;
    accountNumber: string;
    destinationType: string;
    provider: string;
    isVerified: boolean;
  };
};

type Recipient = { userId: number; name: string; accountName: string; group: string; count: number; amount: string };

const GROUPS = [
  { value: "OWNERS", label: "Owners" },
  { value: "TOURS", label: "Tours" },
  { value: "DRIVERS", label: "Drivers" },
  { value: "SALES", label: "Sales" },
];

const PAYOUT_PATH = [
  {
    status: "REQUESTED",
    caption: "Created",
    accentClass: "border-amber-400",
    selectedClass: "border-amber-600 bg-amber-600 text-white",
  },
  {
    status: "APPROVED",
    caption: "Reviewed",
    accentClass: "border-amber-400",
    selectedClass: "border-amber-600 bg-amber-600 text-white",
  },
  {
    status: "BATCHED",
    caption: "Grouped",
    accentClass: "border-amber-400",
    selectedClass: "border-amber-600 bg-amber-600 text-white",
  },
  {
    status: "AUTHORIZED",
    caption: "Released",
    accentClass: "border-amber-400",
    selectedClass: "border-amber-600 bg-amber-600 text-white",
  },
  {
    status: "SUBMITTED",
    caption: "Sent to provider",
    accentClass: "border-sky-400",
    selectedClass: "border-sky-600 bg-sky-600 text-white",
  },
  {
    status: "PROCESSING",
    caption: "Provider settling",
    accentClass: "border-sky-400",
    selectedClass: "border-sky-600 bg-sky-600 text-white",
  },
];

const DATE_FIELDS = [
  { value: "createdAt", label: "Requested date" },
  { value: "approvedAt", label: "Approved date" },
  { value: "paidAt", label: "Paid date" },
];

const actionClass =
  "inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass =
  "h-10 w-full rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs text-neutral-700 outline-none transition hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const labelClass = "m-0 mb-1.5 block text-[10px] font-bold uppercase tracking-[0.11em] text-neutral-500";

/** YYYY-MM-DD from a local calendar day. The API resolves the day's edges in the reporting timezone. */
function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Monday-start weeks. A business cycle that ends mid-week is still reachable by picking the two dates by hand. */
function startOfWeek(date: Date): Date {
  const start = new Date(date);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * The periods finance actually reports on, resolved at click time so a session
 * left open overnight cannot apply yesterday's idea of "this week". Each one
 * only fills the two date fields, so there is a single date model and the
 * range stays editable afterwards.
 */
function periodRange(kind: string): { from: string; to: string; label: string } | null {
  const today = new Date();
  if (kind === "THIS_WEEK" || kind === "LAST_WEEK") {
    const start = startOfWeek(today);
    if (kind === "LAST_WEEK") start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: isoDay(start), to: isoDay(end), label: `Week ended ${end.getDate()} ${MONTHS[end.getMonth()]} ${end.getFullYear()}` };
  }
  if (kind === "THIS_MONTH" || kind === "LAST_MONTH") {
    const offset = kind === "LAST_MONTH" ? -1 : 0;
    const start = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
    return { from: isoDay(start), to: isoDay(end), label: `${MONTHS[start.getMonth()]} ${start.getFullYear()}` };
  }
  if (kind === "THIS_YEAR" || kind === "LAST_YEAR") {
    const year = today.getFullYear() + (kind === "LAST_YEAR" ? -1 : 0);
    return { from: isoDay(new Date(year, 0, 1)), to: isoDay(new Date(year, 11, 31)), label: `Year ${year}` };
  }
  return null;
}

const PERIOD_PRESETS = [
  { value: "THIS_WEEK", label: "This week" },
  { value: "LAST_WEEK", label: "Last week" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_YEAR", label: "This year" },
  { value: "LAST_YEAR", label: "Last year" },
];

function money(value: string, currency: string) {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function statusClass(status: string) {
  if (status === "PAID" || status === "RECOVERED") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "FAILED" || status === "SECURITY_REVIEW") return "border-red-100 bg-red-50 text-red-700";
  if (status === "SUBMITTED" || status === "PROCESSING") return "border-sky-100 bg-sky-50 text-sky-700";
  return "border-amber-100 bg-amber-50 text-amber-700";
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    return "Finance OTP verification is required. Unlock finance actions in the header, then try again.";
  }
  return cause?.response?.data?.error || fallback;
}

/**
 * Disbursement Reports — the finance export.
 *
 * Filters mirror how the money is actually organized: a whole group ("every
 * owner payout last month") or one named beneficiary, over a date range keyed
 * on the timestamp that matters for the question being asked. The preview and
 * the CSV run identical filters server-side, so the file is exactly what was
 * on screen.
 */
export default function DisbursementReportsPage() {
  const [dateField, setDateField] = useState("createdAt");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groups, setGroups] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [currency, setCurrency] = useState("");
  const [bankName, setBankName] = useState("");
  const [destinationType, setDestinationType] = useState("");
  const [batchReference, setBatchReference] = useState("");
  const [q, setQ] = useState("");
  const [label, setLabel] = useState("");
  // A preset names the period for you, but stops the moment you write your own.
  const [labelTouched, setLabelTouched] = useState(false);
  const [period, setPeriod] = useState("");
  const [unmasked, setUnmasked] = useState(false);

  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientOptions, setRecipientOptions] = useState<Recipient[]>([]);
  const [recipientOpen, setRecipientOpen] = useState(false);
  const [searchingRecipients, setSearchingRecipients] = useState(false);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<ReportRow[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [exportLimit, setExportLimit] = useState(20000);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openPanel, setOpenPanel] = useState<null | "period" | "who" | "status" | "details" | "export">(null);

  // One filter object feeds the preview, the recipient picker and the export,
  // so the three can never drift apart.
  const params = useMemo(() => {
    const value: Record<string, string | number> = { dateField };
    if (from) value.from = from;
    if (to) value.to = to;
    if (groups.length) value.groups = groups.join(",");
    if (statuses.length) value.statuses = statuses.join(",");
    if (recipient) value.recipientUserId = recipient.userId;
    if (currency) value.currency = currency;
    if (bankName) value.bankName = bankName;
    if (destinationType) value.destinationType = destinationType;
    if (batchReference) value.batchReference = batchReference.trim();
    if (q) value.q = q.trim();
    return value;
  }, [dateField, from, to, groups, statuses, recipient, currency, bankName, destinationType, batchReference, q]);

  /**
   * The institution list is built from the last result set, with whatever is
   * currently selected kept in place so the select never loses its own value
   * when a narrower filter drops that institution from the summary.
   */
  const institutionOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of summary?.byDestination ?? []) {
      seen.set(entry.bankName, `${entry.bankName.toUpperCase()} (${entry.count})`);
    }
    if (bankName && !seen.has(bankName)) seen.set(bankName, bankName.toUpperCase());
    return [...seen.entries()].map(([value, label]) => ({ value, label }));
  }, [summary, bankName]);

  const run = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError("");
      try {
        const response = await apiClient.get("/api/admin/disbursements/report", {
          params: { ...params, page: targetPage, pageSize },
        });
        setSummary(response.data?.summary || null);
        setRows(response.data?.rows || []);
        setExportLimit(response.data?.exportLimit || 20000);
        setPage(targetPage);
      } catch (cause: any) {
        setError(errorMessage(cause, "Could not run this report."));
      } finally {
        setLoading(false);
      }
    },
    [params, pageSize]
  );

  useEffect(() => { void run(1); /* first load only */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const searchRecipients = async () => {
    setSearchingRecipients(true);
    setError("");
    try {
      const response = await apiClient.get("/api/admin/disbursements/report/recipients", {
        params: { ...params, recipientUserId: undefined, q: recipientQuery.trim() || undefined },
      });
      setRecipientOptions(response.data?.recipients || []);
      setRecipientOpen(true);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load recipients."));
    } finally {
      setSearchingRecipients(false);
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    setError("");
    setNotice("");
    try {
      const response = await apiClient.get("/api/admin/disbursements/report.csv", {
        params: { ...params, ...(label ? { label } : {}), ...(unmasked ? { unmasked: "1" } : {}) },
        responseType: "blob",
      });
      const disposition = String(response.headers?.["content-disposition"] || "");
      const named = /filename="([^"]+)"/.exec(disposition)?.[1];
      const url = URL.createObjectURL(response.data);
      const link = document.createElement("a");
      link.href = url;
      link.download = named || `NoLSAF_Disbursement_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Export downloaded${unmasked ? " with full destination numbers. This download is recorded in the admin audit." : "."}`);
    } catch (cause: any) {
      // With responseType blob an error body arrives as a Blob, so the server's
      // message has to be read out of it rather than off response.data.error.
      let message = "";
      try {
        const text = cause?.response?.data instanceof Blob ? await cause.response.data.text() : "";
        message = text ? JSON.parse(text)?.error : "";
      } catch {}
      if (!message && cause?.response?.status === 403) {
        message = "Finance OTP verification is required. Unlock finance actions in the header, then export again.";
      }
      setError(message || errorMessage(cause, "Could not export this report."));
    } finally {
      setExporting(false);
    }
  };

  const applyPeriod = (kind: string) => {
    const range = periodRange(kind);
    if (!range) return;
    setPeriod(kind);
    setFrom(range.from);
    setTo(range.to);
    if (!labelTouched) setLabel(range.label);
  };

  const clearPeriod = () => {
    setPeriod("");
    setFrom("");
    setTo("");
    if (!labelTouched) setLabel("");
  };

  const toggle = (list: string[], setList: (next: string[]) => void, value: string) =>
    setList(list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

  const reset = () => {
    setDateField("createdAt");
    setPeriod("");
    setFrom("");
    setTo("");
    setLabelTouched(false);
    setGroups([]);
    setStatuses([]);
    setCurrency("");
    setBankName("");
    setDestinationType("");
    setBatchReference("");
    setQ("");
    setLabel("");
    setUnmasked(false);
    setRecipient(null);
    setRecipientQuery("");
    setRecipientOptions([]);
    setRecipientOpen(false);
  };

  const dateLabel = DATE_FIELDS.find((field) => field.value === dateField)?.label ?? "Date";
  const eat = (iso: string) =>
    `${new Date(iso).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })} EAT`;
  const periodName = period ? PERIOD_PRESETS.find((p) => p.value === period)?.label : from || to ? `${from || "start"} to ${to || "today"}` : "All time";
  const statusTotal = (summary?.byStatus ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const STATUS_BAR: Record<string, string> = {
    PAID: "#059669", RECOVERED: "#047857", FAILED: "#e11d48", SECURITY_REVIEW: "#be123c", RECOVERY_PENDING: "#7c3aed",
    SUBMITTED: "#0284c7", PROCESSING: "#0ea5e9",
  };

  // Every narrowing filter, as removable chips above the results.
  const chips: Array<{ key: string; label: string; clear: () => void }> = [
    ...(period || from || to ? [{ key: "period", label: `${dateLabel}: ${periodName}`, clear: clearPeriod }] : []),
    ...groups.map((g) => ({ key: `g-${g}`, label: GROUPS.find((x) => x.value === g)?.label ?? g, clear: () => setGroups(groups.filter((x) => x !== g)) })),
    ...(recipient ? [{ key: "recipient", label: recipient.name, clear: () => setRecipient(null) }] : []),
    ...statuses.map((s) => ({ key: `s-${s}`, label: s.replace(/_/g, " ").toLowerCase(), clear: () => setStatuses(statuses.filter((x) => x !== s)) })),
    ...(currency ? [{ key: "currency", label: currency, clear: () => setCurrency("") }] : []),
    ...(destinationType ? [{ key: "dest", label: destinationType === "BANK" ? "Bank only" : "Mobile money only", clear: () => setDestinationType("") }] : []),
    ...(bankName ? [{ key: "bank", label: bankName.toUpperCase(), clear: () => setBankName("") }] : []),
    ...(batchReference ? [{ key: "batch", label: batchReference, clear: () => setBatchReference("") }] : []),
    ...(q ? [{ key: "q", label: `"${q}"`, clear: () => setQ("") }] : []),
  ];

  const panelFooter = (
    <div className="mt-4 flex items-center justify-end gap-2 border-0 border-t border-solid border-neutral-100 pt-3">
      <button type="button" onClick={() => setOpenPanel(null)} className="h-9 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 hover:bg-neutral-50">Close</button>
      <button type="button" onClick={() => { setOpenPanel(null); void run(1); }} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#012a26] px-3.5 text-xs font-bold text-white">
        <Search className="h-3.5 w-3.5" aria-hidden /> Apply
      </button>
    </div>
  );

  const statusRow = (value: string, label: string, mark: string, line: boolean, tone: "path" | "good" | "bad" | "recovery" = "path") => {
    const active = statuses.includes(value);
    const dot = { path: "bg-[#012a26]", good: "bg-emerald-600", bad: "bg-rose-600", recovery: "bg-violet-600" }[tone];
    return (
      <li key={value} className="relative">
        {line && <span className="absolute left-[13px] top-8 h-[calc(100%-20px)] w-px bg-neutral-200" aria-hidden />}
        <button type="button" aria-pressed={active} onClick={() => toggle(statuses, setStatuses, value)}
          className={`flex w-full items-center gap-3 rounded-lg border-0 px-1.5 py-1.5 text-left transition ${active ? "bg-emerald-50" : "bg-transparent hover:bg-neutral-50"}`}>
          <span className={`relative grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${active ? `${dot} text-white` : "bg-neutral-100 text-neutral-500"}`}>{active ? <Check className="h-3 w-3" aria-hidden /> : mark}</span>
          <span className="min-w-0 flex-1">
            <span className={`block text-xs font-bold ${active ? "text-neutral-950" : "text-neutral-700"}`}>{label}</span>
            <span className="block font-mono text-[10px] text-neutral-400">{value}</span>
          </span>
        </button>
      </li>
    );
  };

  const railTitle = "m-0 mb-2.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-neutral-400";

  return (
    <div id="disbursement-reports" className="w-full min-w-0 space-y-4">
      <style>{`#disbursement-reports, #disbursement-reports * { box-sizing: border-box; }`}</style>

      {/* Dark band: what this is, the live totals and the actions */}
      <section className="overflow-hidden rounded-xl bg-[#012a26] text-white">
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-white/[0.08] text-[#5eead4] ring-1 ring-inset ring-white/10"><BarChart3 className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">Finance export</p>
              <h1 className="m-0 mt-0.5 text-xl font-bold tracking-tight sm:text-2xl">Disbursement reports</h1>
              <p className="m-0 mt-0.5 text-xs text-white/60 sm:text-sm">The table and the CSV use the same filters, with NoLSAF and provider references for line by line reconciliation.</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={reset} disabled={loading} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-transparent px-3.5 text-xs font-bold text-white/80 hover:bg-white/[0.06] disabled:opacity-40">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset
            </button>
            <button type="button" onClick={() => void run(1)} disabled={loading} className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#5eead4] px-4 text-xs font-bold text-[#012a26] hover:bg-[#8ff3e1] disabled:opacity-60">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Search className="h-4 w-4" aria-hidden />} Run report
            </button>
          </div>
        </div>
        <dl className="m-0 grid grid-cols-2 border-0 border-t border-solid border-white/10 lg:grid-cols-4">
          {[
            { label: "Payouts", value: summary ? summary.rows.toLocaleString("en-US") : "…", hint: periodName },
            { label: "Beneficiaries", value: summary ? summary.recipients.toLocaleString("en-US") : "…", hint: groups.length ? groups.map((g) => GROUPS.find((x) => x.value === g)?.label).join(", ") : "all groups" },
            { label: "Total", value: summary?.totals[0] ? money(summary.totals[0].amount, summary.totals[0].currency) : "…", hint: summary && summary.totals.length > 1 ? `+ ${summary.totals.slice(1).map((t) => money(t.amount, t.currency)).join(", ")}` : "in this selection" },
            { label: "Export", value: summary ? (summary.rows > exportLimit ? "Too large" : "Ready") : "…", hint: summary && summary.rows > exportLimit ? `limit ${exportLimit.toLocaleString("en-US")} rows` : "CSV matches the table" },
          ].map((stat, index) => (
            <div key={stat.label} className={`px-5 py-3.5 sm:px-6 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10" : ""} ${index === 2 ? "border-0 border-t border-solid border-white/10 lg:border-l lg:border-t-0" : ""} ${index === 3 ? "border-0 border-t border-solid border-white/10 lg:border-t-0" : ""}`}>
              <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/50">{stat.label}</dt>
              <dd className={`m-0 mt-0.5 truncate text-lg font-extrabold tabular-nums ${stat.label === "Export" && summary && summary.rows > exportLimit ? "text-amber-300" : "text-white"}`}>{stat.value}</dd>
              <p className="m-0 truncate text-[11px] text-white/50">{stat.hint}</p>
            </div>
          ))}
        </dl>
      </section>

      {error && <div className="rounded-lg border border-solid border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-solid border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">{notice}</div>}

      {/* Filter toolbar: one row, each button opens its own panel */}
      <div className="relative">
        {openPanel && <button type="button" aria-label="Close filters" onClick={() => setOpenPanel(null)} className="fixed inset-0 z-20 cursor-default border-0 bg-transparent" />}
        <div className="relative z-30 flex flex-wrap items-center gap-2 rounded-xl border border-solid border-neutral-200 bg-white p-2">
          {([
            { key: "period", label: "Period", value: periodName, Icon: CalendarDays, count: period || from || to ? 1 : 0 },
            { key: "who", label: "Paid to", value: recipient ? recipient.name : groups.length ? groups.map((g) => GROUPS.find((x) => x.value === g)?.label).join(", ") : "Everyone", Icon: Users, count: groups.length + (recipient ? 1 : 0) },
            { key: "status", label: "Status", value: statuses.length ? `${statuses.length} selected` : "Any", Icon: ListChecks, count: statuses.length },
            { key: "details", label: "Destination", value: [currency, destinationType === "BANK" ? "Bank" : destinationType ? "Mobile money" : "", bankName.toUpperCase(), batchReference].filter(Boolean).join(", ") || "Any", Icon: Landmark, count: [currency, destinationType, bankName, batchReference].filter(Boolean).length },
          ] as const).map((item) => {
            const open = openPanel === item.key;
            return (
              <button key={item.key} type="button" onClick={() => setOpenPanel(open ? null : item.key)} aria-expanded={open}
                className={`inline-flex h-10 min-w-0 items-center gap-2 rounded-lg border border-solid px-3 text-left transition ${open ? "border-[#012a26] bg-[#012a26] text-white" : item.count ? "border-[#02665e]/40 bg-emerald-50/60 text-neutral-900 hover:border-[#02665e]" : "border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300"}`}>
                <item.Icon className={`h-4 w-4 shrink-0 ${open ? "text-[#5eead4]" : "text-neutral-400"}`} aria-hidden />
                <span className="min-w-0 leading-tight">
                  <span className={`block text-[10px] font-bold uppercase tracking-[0.1em] ${open ? "text-white/60" : "text-neutral-400"}`}>{item.label}</span>
                  <span className="block max-w-[160px] truncate text-xs font-bold">{item.value}</span>
                </span>
                <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition ${open ? "rotate-180 text-white/70" : "text-neutral-400"}`} aria-hidden />
              </button>
            );
          })}

          <div className="relative min-w-0 flex-1" style={{ minWidth: 200 }}>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input aria-label="Search payouts" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void run(1); }} placeholder="Search reference, account or remarks" className={`${fieldClass} !h-10 !pl-9`} />
          </div>

          <button type="button" onClick={() => setOpenPanel(openPanel === "export" ? null : "export")} aria-expanded={openPanel === "export"}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-4 text-xs font-bold text-white hover:bg-[#014d47]">
            <Download className="h-4 w-4" aria-hidden /> Export CSV <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </button>

          {/* Panels */}
          {openPanel === "period" && (
            <div className="absolute left-2 top-full z-30 mt-2 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)]" style={{ width: "min(560px, calc(100vw - 32px))" }}>
              <p className={railTitle}>Quick periods</p>
              <div className="grid grid-cols-4 gap-1.5">
                {[{ value: "", label: "All time" }, ...PERIOD_PRESETS].map((preset) => {
                  const active = preset.value ? period === preset.value : !period && !from && !to;
                  return (
                    <button key={preset.value || "ALL"} type="button" onClick={() => (preset.value ? applyPeriod(preset.value) : clearPeriod())}
                      className={`h-9 rounded-lg border border-solid text-xs font-bold transition ${active ? "border-[#012a26] bg-[#012a26] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>
                      {preset.label}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 border-0 border-t border-solid border-neutral-100 pt-4">
                <div>
                  <label className={labelClass} htmlFor="report-date-field">Date basis</label>
                  <select id="report-date-field" value={dateField} onChange={(e) => setDateField(e.target.value)} className={fieldClass}>
                    {DATE_FIELDS.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
                  </select>
                </div>
                <div>
                  <p className={labelClass}>From</p>
                  <DatePickerField label="Report start date" value={from} onChangeAction={(next: string) => { setFrom(next); setPeriod(""); }} max={to || undefined} size="sm" twoMonths={false} widthClassName="w-full !rounded-lg" />
                </div>
                <div>
                  <p className={labelClass}>To</p>
                  <DatePickerField label="Report end date" value={to} onChangeAction={(next: string) => { setTo(next); setPeriod(""); }} min={from || undefined} size="sm" twoMonths={false} widthClassName="w-full !rounded-lg" />
                </div>
              </div>
              {panelFooter}
            </div>
          )}

          {openPanel === "who" && (
            <div className="absolute left-2 top-full z-30 mt-2 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)]" style={{ width: "min(460px, calc(100vw - 32px))" }}>
              <p className={railTitle}>Recipient group</p>
              <div className="grid grid-cols-5 gap-1.5">
                <button type="button" onClick={() => setGroups([])} className={`h-9 rounded-lg border border-solid text-xs font-bold transition ${groups.length === 0 ? "border-[#012a26] bg-[#012a26] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>All</button>
                {GROUPS.map((group) => {
                  const active = groups.includes(group.value);
                  return (
                    <button key={group.value} type="button" onClick={() => toggle(groups, setGroups, group.value)} className={`h-9 rounded-lg border border-solid text-xs font-bold transition ${active ? "border-[#012a26] bg-[#012a26] text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300"}`}>
                      {group.label}
                    </button>
                  );
                })}
              </div>
              <div className="relative mt-4 border-0 border-t border-solid border-neutral-100 pt-4">
                <label className={labelClass} htmlFor="report-recipient">One beneficiary</label>
                {recipient ? (
                  <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3">
                    <span className="min-w-0 truncate text-xs font-bold text-emerald-800">{recipient.name} <span className="font-medium text-emerald-700">({recipient.group})</span></span>
                    <button type="button" onClick={() => setRecipient(null)} aria-label="Clear recipient" className="shrink-0 rounded-md border-0 bg-transparent p-1 text-emerald-700 hover:bg-emerald-100"><X className="h-3.5 w-3.5" /></button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input id="report-recipient" value={recipientQuery} onChange={(e) => setRecipientQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchRecipients(); } }} placeholder="Name on the payout account" className={fieldClass} />
                    <button type="button" onClick={() => void searchRecipients()} disabled={searchingRecipients} aria-label="Search recipients" className={`${actionClass} !w-10 !px-0`}>
                      {searchingRecipients ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </button>
                  </div>
                )}
                {recipientOpen && !recipient && (
                  <div className="mt-2 max-h-56 overflow-y-auto rounded-lg border border-solid border-neutral-200 bg-white">
                    {recipientOptions.length === 0 ? (
                      <p className="m-0 px-3 py-2.5 text-xs text-neutral-500">No beneficiary matches this scope.</p>
                    ) : (
                      recipientOptions.map((option) => (
                        <button key={option.userId} type="button" onClick={() => { setRecipient(option); setRecipientOpen(false); setRecipientQuery(""); }}
                          className="flex w-full items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-white px-3 py-2 text-left last:border-b-0 hover:bg-emerald-50">
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-bold text-neutral-800">{option.name}</span>
                            <span className="block truncate text-[11px] text-neutral-500">{option.accountName} · {option.group} · {option.count} payout(s)</span>
                          </span>
                          <span className="shrink-0 text-xs font-bold text-neutral-700">{Number(option.amount).toLocaleString("en-US")}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              {panelFooter}
            </div>
          )}

          {openPanel === "status" && (
            <div className="absolute left-2 top-full z-30 mt-2 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)]" style={{ width: "min(620px, calc(100vw - 32px))" }}>
              <div className="grid gap-5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
                <div>
                  <p className={railTitle}>Payout path</p>
                  <ol className="m-0 list-none p-0">
                    {PAYOUT_PATH.map((step, index) => statusRow(step.status, step.caption, `${index + 1}`, index < PAYOUT_PATH.length - 1))}
                  </ol>
                </div>
                <div className="space-y-4">
                  <div>
                    <p className={railTitle}>Provider outcome</p>
                    <ul className="m-0 list-none p-0">{statusRow("PAID", "Paid", "✓", false, "good")}{statusRow("FAILED", "Failed", "!", false, "bad")}</ul>
                  </div>
                  <div>
                    <p className={railTitle}>Exceptions</p>
                    <ul className="m-0 list-none p-0">
                      {statusRow("SECURITY_REVIEW", "Security review", "!", false, "bad")}
                      {statusRow("RECOVERY_PENDING", "Recovery pending", "R", false, "recovery")}
                      {statusRow("RECOVERED", "Recovered", "R", false, "recovery")}
                    </ul>
                  </div>
                </div>
              </div>
              {panelFooter}
            </div>
          )}

          {openPanel === "details" && (
            <div className="absolute left-2 top-full z-30 mt-2 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)]" style={{ width: "min(460px, calc(100vw - 32px))" }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="report-currency">Currency</label>
                  <select id="report-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldClass}>
                    <option value="">All currencies</option>
                    <option value="TZS">TZS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="report-destination-type">Destination type</label>
                  <select id="report-destination-type" value={destinationType} onChange={(e) => setDestinationType(e.target.value)} className={fieldClass}>
                    <option value="">Mobile money and bank</option>
                    <option value="MOBILE_MONEY">Mobile money only</option>
                    <option value="BANK">Bank only</option>
                  </select>
                </div>
                <div className="col-span-2">
                  {/* Options come from the rows in scope, so bank accounts are reachable too. */}
                  <label className={labelClass} htmlFor="report-bank">Institution</label>
                  <select id="report-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} className={fieldClass}>
                    <option value="">All institutions</option>
                    {institutionOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className={labelClass} htmlFor="report-batch">Batch reference</label>
                  <input id="report-batch" value={batchReference} onChange={(e) => setBatchReference(e.target.value)} placeholder="BATCH-..." className={fieldClass} />
                </div>
              </div>
              {panelFooter}
            </div>
          )}

          {openPanel === "export" && (
            <div className="absolute right-2 top-full z-30 mt-2 rounded-xl border border-solid border-neutral-200 bg-white p-4 shadow-[0_24px_60px_-28px_rgba(15,23,42,0.45)]" style={{ width: "min(380px, calc(100vw - 32px))" }}>
              <p className="m-0 text-sm font-bold text-neutral-900">Export this selection</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">{summary ? `${summary.rows.toLocaleString("en-US")} payout(s), exactly as filtered.` : "Exactly what the table shows."}</p>
              <label className={`${labelClass} mt-4`} htmlFor="report-label">Report label</label>
              <input id="report-label" value={label} onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }} placeholder="e.g. Week ended 30 July 2026" className={fieldClass} />
              <p className="m-0 mt-1 text-[10.5px] text-neutral-500">Used only where a payout has no remarks.</p>
              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-lg border border-solid border-neutral-200 bg-neutral-50 px-3 py-2.5 text-xs text-neutral-600">
                <input className="mt-0.5 accent-emerald-700" type="checkbox" checked={unmasked} onChange={(e) => setUnmasked(e.target.checked)} />
                <span>
                  <span className="block font-bold text-neutral-800">Full destination numbers</span>
                  <span className="mt-0.5 block text-[10.5px] leading-4 text-neutral-500">For provider reconciliation only. Recorded in the admin audit.</span>
                </span>
              </label>
              {summary && summary.rows > exportLimit && <p className="m-0 mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Over the {exportLimit.toLocaleString("en-US")} row limit. Narrow the period to download.</p>}
              <button type="button" onClick={() => { void exportCsv(); setOpenPanel(null); }} disabled={exporting || loading || Boolean(summary && summary.rows > exportLimit)} className="mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] text-xs font-bold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Download className="h-4 w-4" aria-hidden />} Download CSV
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="min-w-0 space-y-4">
          {chips.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-400">Filtered by</span>
              {chips.map((chip) => (
                <span key={chip.key} className="inline-flex h-7 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white pl-2.5 pr-1 text-[11px] font-semibold capitalize text-neutral-700">
                  {chip.label}
                  <button type="button" onClick={chip.clear} aria-label={`Remove ${chip.label}`} className="grid h-5 w-5 place-items-center rounded border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-800"><X className="h-3 w-3" /></button>
                </span>
              ))}
              <button type="button" onClick={() => void run(1)} disabled={loading} className="ml-auto inline-flex h-7 items-center gap-1 rounded-md border-0 bg-[#012a26] px-2.5 text-[11px] font-bold text-white disabled:opacity-60">
                <Search className="h-3 w-3" aria-hidden /> Apply
              </button>
            </div>
          )}

          {summary && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                <p className={railTitle}>By group</p>
                {summary.byGroup.length === 0 ? <p className="m-0 text-xs text-neutral-500">Nothing in this selection.</p> : (
                  <ul className="m-0 list-none space-y-2.5 p-0">
                    {summary.byGroup.map((entry) => {
                      const share = summary.rows ? Math.round((entry.count / summary.rows) * 100) : 0;
                      return (
                        <li key={entry.sourceType}>
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-bold text-neutral-800">{entry.label}</span>
                            <span className="tabular-nums text-neutral-500"><strong className="text-neutral-800">{Number(entry.amount).toLocaleString("en-US")}</strong> · {entry.count}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-100"><div className="h-full rounded-full bg-[#02665e]" style={{ width: `${Math.max(share, 2)}%` }} /></div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section className="rounded-xl border border-solid border-neutral-200 bg-white p-4">
                <p className={railTitle}>By status</p>
                {summary.byStatus.length === 0 ? <p className="m-0 text-xs text-neutral-500">Nothing in this selection.</p> : (
                  <>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-neutral-100">
                      {summary.byStatus.map((entry) => (
                        <span key={entry.status} title={`${entry.status} ${entry.count}`} style={{ width: `${(entry.count / Math.max(statusTotal, 1)) * 100}%`, background: STATUS_BAR[entry.status] ?? "#d97706" }} />
                      ))}
                    </div>
                    <ul className="m-0 mt-3 grid list-none grid-cols-2 gap-x-3 gap-y-1.5 p-0">
                      {summary.byStatus.map((entry) => (
                        <li key={entry.status} className="flex items-center gap-2 text-xs">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_BAR[entry.status] ?? "#d97706" }} />
                          <span className="min-w-0 flex-1 truncate capitalize text-neutral-600">{entry.status.replace(/_/g, " ").toLowerCase()}</span>
                          <span className="font-bold tabular-nums text-neutral-800">{entry.count}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            </div>
          )}

          <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            {loading ? (
              <div className="grid min-h-56 place-items-center text-neutral-400">
                <div className="text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin" /><p className="mb-0 mt-2 text-xs">Running report</p></div>
              </div>
            ) : rows.length === 0 ? (
              <div className="grid min-h-56 place-items-center p-8 text-center">
                <div>
                  <p className="mb-0 text-sm font-bold text-neutral-800">Nothing matches these filters</p>
                  <p className="mb-0 mt-1 text-xs text-neutral-500">Widen the period, or remove a group or status filter.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="bg-neutral-50 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                        <th className="px-4 py-3 font-bold">{dateLabel}</th>
                        <th className="px-4 py-3 font-bold">Recipient</th>
                        <th className="px-4 py-3 font-bold">Reference</th>
                        <th className="px-4 py-3 text-right font-bold">Amount</th>
                        <th className="px-4 py-3 font-bold">Status</th>
                        <th className="px-4 py-3 font-bold">Batch</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const stamp = dateField === "paidAt" ? row.paidAt : dateField === "approvedAt" ? row.approvedAt : row.createdAt;
                        return (
                          <tr key={row.id} className="border-0 border-t border-solid border-neutral-100 align-top hover:bg-neutral-50/60">
                            <td className="whitespace-nowrap px-4 py-3 text-xs text-neutral-500">{stamp ? eat(stamp) : "n/a"}</td>
                            <td className="px-4 py-3 text-xs">
                              <div className="font-bold text-neutral-900">{row.recipient.name}</div>
                              <div className="text-neutral-400">{row.sourceType.replace(/_/g, " ").toLowerCase()} · {row.recipient.destinationType === "BANK" ? "Bank" : "Mobile money"} · {row.recipient.provider} · {row.recipient.accountNumber}</div>
                            </td>
                            <td className="px-4 py-3 font-mono text-[11px] text-neutral-900">
                              <div>{row.externalReferenceId}</div>
                              {row.pgReferenceId && <div className="text-neutral-400">{row.pgReferenceId}</div>}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-bold tabular-nums text-neutral-950">{money(row.amount, row.currency)}</td>
                            <td className="px-4 py-3"><span className={`whitespace-nowrap rounded-full border border-solid px-2 py-0.5 text-[10px] font-bold ${statusClass(row.status)}`}>{row.status.replace(/_/g, " ")}</span></td>
                            <td className="px-4 py-3 font-mono text-[11px] text-neutral-500">{row.batch?.batchReference || "n/a"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-2.5">
                  <p className="m-0 text-xs text-neutral-500">
                    Page <strong className="text-neutral-800">{page}</strong> · {(page - 1) * pageSize + 1}-{(page - 1) * pageSize + rows.length} of {summary?.rows.toLocaleString("en-US") ?? "?"}
                  </p>
                  <div className="flex gap-1.5">
                    <button type="button" disabled={page <= 1 || loading} onClick={() => void run(page - 1)} className={actionClass}><ChevronLeft className="h-3.5 w-3.5" aria-hidden /> Previous</button>
                    <button type="button" disabled={rows.length < pageSize || loading} onClick={() => void run(page + 1)} className={actionClass}>Next <ChevronRight className="h-3.5 w-3.5" aria-hidden /></button>
                  </div>
                </div>
              </>
            )}
          </section>
      </div>
    </div>
  );
}
