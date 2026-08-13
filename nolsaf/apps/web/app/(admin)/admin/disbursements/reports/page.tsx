"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Check, ChevronRight, Download, GitBranch, Loader2, RotateCcw, Search, X } from "lucide-react";
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
const filterPanelClass = "rounded-lg border border-neutral-200 bg-neutral-50/70 p-3.5 sm:p-4";

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

  return (
    <div id="disbursement-reports" className="mx-auto w-full max-w-7xl space-y-4">
      <style>{`#disbursement-reports, #disbursement-reports * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm">
              <BarChart3 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Finance export</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Disbursement Reports</h1>
              <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500 sm:text-sm">
                Filter by group or beneficiary, then export exactly what you see. Both NoLSAF and provider references are included for line by line
                reconciliation.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button type="button" onClick={reset} disabled={loading} className={actionClass}>
              Reset
            </button>
            <button type="button" onClick={() => void run(1)} disabled={loading} className={`${actionClass} !border-emerald-700 !bg-emerald-700 !text-white`}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Run report
            </button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">{notice}</div>}

      <section className="rounded-xl border border-neutral-200 bg-white p-4 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)] sm:p-5">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="m-0 text-sm font-bold text-neutral-900">Report filters</h2>
            <p className="mb-0 mt-0.5 text-xs text-neutral-500">Set the reporting period first, then narrow the payouts only if needed.</p>
          </div>
          <p className="m-0 text-[11px] font-medium text-neutral-400">All fields are optional except the date basis.</p>
        </div>

        <div className="space-y-3">
          <div className={filterPanelClass}>
            {/* Heading and presets share one row so the panel opens with a
                single line of chrome above the fields. Presets only fill the
                two dates below, which stay editable, so a cycle that does not
                run Monday to Sunday is still reachable by hand. */}
            <div className="mb-3 flex flex-col gap-2.5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="m-0 text-xs font-bold text-neutral-800">Reporting period</p>
                <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Choose which event date the range should use.</p>
              </div>
              <div className="inline-flex w-full overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white lg:w-auto">
                {[{ value: "", label: "All time" }, ...PERIOD_PRESETS].map((preset) => {
                  const active = preset.value ? period === preset.value : !period && !from && !to;
                  return (
                    <button
                      key={preset.value || "ALL"}
                      type="button"
                      onClick={() => (preset.value ? applyPeriod(preset.value) : clearPeriod())}
                      className={`flex h-9 min-w-0 flex-1 appearance-none items-center justify-center truncate border-0 border-r border-solid border-neutral-200 px-2 text-[11px] font-bold transition last:border-r-0 lg:flex-none lg:px-3.5 ${active ? "bg-emerald-700 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"}`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div>
                <label className={labelClass} htmlFor="report-date-field">Date basis</label>
                <select id="report-date-field" value={dateField} onChange={(e) => setDateField(e.target.value)} className={fieldClass}>
                  {DATE_FIELDS.map((field) => (
                    <option key={field.value} value={field.value}>{field.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className={labelClass}>From</p>
                <DatePickerField
                  label="Report start date"
                  value={from}
                  onChangeAction={(next: string) => { setFrom(next); setPeriod(""); }}
                  max={to || undefined}
                  size="sm"
                  twoMonths={false}
                  widthClassName="w-full !rounded-lg"
                />
              </div>
              <div>
                <p className={labelClass}>To</p>
                <DatePickerField
                  label="Report end date"
                  value={to}
                  onChangeAction={(next: string) => { setTo(next); setPeriod(""); }}
                  min={from || undefined}
                  size="sm"
                  twoMonths={false}
                  widthClassName="w-full !rounded-lg"
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="report-currency">Currency</label>
                <select id="report-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={fieldClass}>
                  <option value="">All currencies</option>
                  <option value="TZS">TZS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className={filterPanelClass}>
              <div className="mb-3">
                <p className="m-0 text-xs font-bold text-neutral-800">Recipient scope</p>
                <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Include whole groups or locate one payout recipient.</p>
              </div>
              <div>
                <p className={labelClass}>Recipient group</p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => setGroups([])}
                    className={`rounded-md border px-3 py-1.5 text-[11px] font-bold transition ${groups.length === 0 ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200"}`}
                  >
                    All groups
                  </button>
                  {GROUPS.map((group) => {
                    const active = groups.includes(group.value);
                    return (
                      <button
                        key={group.value}
                        type="button"
                        onClick={() => toggle(groups, setGroups, group.value)}
                        className={`rounded-md border px-3 py-1.5 text-[11px] font-bold transition ${active ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-emerald-200"}`}
                      >
                        {active && <Check className="mr-1 inline h-3 w-3" />}
                        {group.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="relative mt-4">
                <label className={labelClass} htmlFor="report-recipient">Specific recipient</label>
                {recipient ? (
                  <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3">
                    <span className="min-w-0 truncate text-xs font-bold text-emerald-800">
                      {recipient.name} <span className="font-medium text-emerald-700">({recipient.group})</span>
                    </span>
                    <button type="button" onClick={() => setRecipient(null)} aria-label="Clear recipient" className="shrink-0 rounded-md p-1 text-emerald-700 hover:bg-emerald-100">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      id="report-recipient"
                      value={recipientQuery}
                      onChange={(e) => setRecipientQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void searchRecipients(); } }}
                      placeholder="Name on the payout account"
                      className={fieldClass}
                    />
                    <button type="button" onClick={() => void searchRecipients()} disabled={searchingRecipients} aria-label="Search recipients" className={`${actionClass} !w-10 !px-0`}>
                      {searchingRecipients ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                    </button>
                  </div>
                )}
                {recipientOpen && !recipient && (
                  <div className="absolute left-0 right-0 z-20 mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-neutral-200 bg-white shadow-xl">
                    {recipientOptions.length === 0 ? (
                      <p className="m-0 px-3 py-2.5 text-xs text-neutral-500">No beneficiary matches this scope.</p>
                    ) : (
                      recipientOptions.map((option) => (
                        <button
                          key={option.userId}
                          type="button"
                          onClick={() => { setRecipient(option); setRecipientOpen(false); setRecipientQuery(""); }}
                          className="flex w-full items-center justify-between gap-2 border-0 border-b border-solid border-neutral-100 bg-white px-3 py-2 text-left last:border-b-0 hover:bg-emerald-50"
                        >
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
            </div>

            <div className={filterPanelClass}>
              <div className="mb-3">
                <p className="m-0 text-xs font-bold text-neutral-800">Payout details</p>
                <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Match a destination, batch, reference, account, or remark.</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className={labelClass} htmlFor="report-destination-type">Destination type</label>
                  <select id="report-destination-type" value={destinationType} onChange={(e) => setDestinationType(e.target.value)} className={fieldClass}>
                    <option value="">Mobile money and bank</option>
                    <option value="MOBILE_MONEY">Mobile money only</option>
                    <option value="BANK">Bank only</option>
                  </select>
                </div>
                <div>
                  {/* Options come from the rows in scope, not a hardcoded MNO
                      list: payout accounts can be banks, and a fixed list of
                      three networks made those rows unreachable. */}
                  <label className={labelClass} htmlFor="report-bank">Institution</label>
                  <select id="report-bank" value={bankName} onChange={(e) => setBankName(e.target.value)} className={fieldClass}>
                    <option value="">All institutions</option>
                    {institutionOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="report-batch">Batch reference</label>
                  <input id="report-batch" value={batchReference} onChange={(e) => setBatchReference(e.target.value)} placeholder="BATCH-..." className={fieldClass} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass} htmlFor="report-q">Search payouts</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                    <input id="report-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, account name or number, remarks" className={`${fieldClass} !pl-9`} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className={filterPanelClass}>
            <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="m-0 text-xs font-bold text-neutral-800">Payout status</p>
                <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Select from the standard payout path, its security off-ramp, or post-payment recovery.</p>
              </div>
              <button
                type="button"
                onClick={() => setStatuses([])}
                className={`h-8 rounded-md border px-3 text-[11px] font-bold transition ${statuses.length === 0 ? "border-neutral-800 bg-neutral-800 text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400"}`}
              >
                {statuses.length === 0 ? "All statuses" : `Clear ${statuses.length} selected`}
              </button>
            </div>
            <div className="border border-neutral-200 bg-white p-2.5">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-neutral-500">Standard payout path</span>
                <span className="h-px flex-1 bg-neutral-200" />
              </div>

              <div className="overflow-x-auto pb-1">
                <div className="flex min-w-[980px] items-stretch">
                  {PAYOUT_PATH.map((step, index) => {
                    const active = statuses.includes(step.status);
                    return (
                      <div key={step.status} className="flex min-w-0 flex-1 items-center">
                        <button
                          type="button"
                          aria-pressed={active}
                          onClick={() => toggle(statuses, setStatuses, step.status)}
                          className={`min-h-[62px] min-w-0 flex-1 border border-t-2 px-2.5 py-2 text-left transition ${active ? step.selectedClass : `${step.accentClass} border-x-neutral-200 border-b-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50`}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className={`grid h-5 w-5 place-items-center rounded-full text-[9px] font-bold ${active ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-500"}`}>
                              {index + 1}
                            </span>
                            {active && <Check className="h-3 w-3" />}
                          </span>
                          <span className="mt-1 block truncate !text-[10px] font-bold">{step.status}</span>
                          <span className={`mt-0.5 block truncate !text-[9px] ${active ? "text-white/75" : "text-neutral-400"}`}>{step.caption}</span>
                        </button>
                        <ChevronRight className="mx-1 h-3.5 w-3.5 shrink-0 text-neutral-300" aria-hidden />
                      </div>
                    );
                  })}

                  <div className="min-w-[210px] flex-[1.35] border border-t-2 border-x-neutral-200 border-b-neutral-200 border-t-emerald-400 bg-white px-2.5 py-2">
                    <span className="flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-full bg-neutral-100 text-[9px] font-bold text-neutral-500">7</span>
                      <span className="!text-[9px] font-bold uppercase tracking-[0.08em] text-neutral-500">Provider outcome</span>
                    </span>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {[
                        { status: "PAID", selected: "border-emerald-600 bg-emerald-600 text-white", idle: "border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400" },
                        { status: "FAILED", selected: "border-rose-600 bg-rose-600 text-white", idle: "border-rose-200 bg-rose-50 text-rose-800 hover:border-rose-400" },
                      ].map((outcome) => {
                        const active = statuses.includes(outcome.status);
                        return (
                          <button
                            key={outcome.status}
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggle(statuses, setStatuses, outcome.status)}
                            className={`min-h-7 rounded-md border px-2 !text-[9px] font-bold transition ${active ? outcome.selected : outcome.idle}`}
                          >
                            {outcome.status}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-2 grid gap-2 lg:grid-cols-2">
                <div className="flex flex-col gap-2 border-l-2 border-rose-300 bg-rose-50/60 p-2.5 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-rose-100 text-rose-700">
                      <GitBranch className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block !text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-700">Security off-ramp</span>
                      <span className="block !text-[9px] text-neutral-500">Integrity checks pause release for review</span>
                    </span>
                  </span>
                  <button
                    type="button"
                    aria-pressed={statuses.includes("SECURITY_REVIEW")}
                    onClick={() => toggle(statuses, setStatuses, "SECURITY_REVIEW")}
                    className={`min-h-8 whitespace-nowrap rounded-md border px-3 !text-[10px] font-bold transition ${statuses.includes("SECURITY_REVIEW") ? "border-rose-600 bg-rose-600 text-white" : "border-rose-200 bg-white text-rose-800 hover:border-rose-400"}`}
                  >
                    Security review
                  </button>
                </div>

                <div className="flex flex-col gap-2 border-l-2 border-violet-300 bg-violet-50/60 p-2.5 sm:flex-row sm:items-center">
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-violet-100 text-violet-700">
                      <RotateCcw className="h-3.5 w-3.5" />
                    </span>
                    <span>
                      <span className="block !text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-700">Post-payment recovery</span>
                      <span className="block !text-[9px] text-neutral-500">Released funds awaiting and completing recovery</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {[
                      { status: "RECOVERY_PENDING", label: "Pending" },
                      { status: "RECOVERED", label: "Recovered" },
                    ].map((recovery, index) => {
                      const active = statuses.includes(recovery.status);
                      return (
                        <span key={recovery.status} className="flex items-center gap-1.5">
                          {index > 0 && <ChevronRight className="h-3 w-3 text-violet-300" aria-hidden />}
                          <button
                            type="button"
                            aria-pressed={active}
                            onClick={() => toggle(statuses, setStatuses, recovery.status)}
                            className={`min-h-8 whitespace-nowrap rounded-md border px-2.5 !text-[10px] font-bold transition ${active ? "border-violet-600 bg-violet-600 text-white" : "border-violet-200 bg-white text-violet-800 hover:border-violet-400"}`}
                          >
                            {recovery.label}
                          </button>
                        </span>
                      );
                    })}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-100 bg-emerald-50/50 p-3.5 sm:p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="grid gap-3 md:grid-cols-[minmax(260px,0.75fr)_minmax(0,1.25fr)] md:items-end">
                <div>
                  <label className={labelClass} htmlFor="report-label">Report label</label>
                  <input
                    id="report-label"
                    value={label}
                    onChange={(e) => { setLabel(e.target.value); setLabelTouched(true); }}
                    placeholder="e.g. Week ended 30 July 2026"
                    className={fieldClass}
                  />
                  <p className="mb-0 mt-1 text-[10px] text-neutral-500">Used only where a payout has no remarks.</p>
                </div>
                <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-lg border border-emerald-100 bg-white px-3 py-2 text-xs text-neutral-600">
                  <input className="mt-0.5 accent-emerald-700" type="checkbox" checked={unmasked} onChange={(e) => setUnmasked(e.target.checked)} />
                  <span>
                    <span className="block font-bold text-neutral-700">Include full destination numbers</span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-neutral-500">Use only for provider reconciliation. This export is recorded in the admin audit.</span>
                  </span>
                </label>
              </div>
              <button type="button" onClick={() => void exportCsv()} disabled={exporting || loading} className={`${actionClass} !h-10 !border-emerald-700 !bg-emerald-700 !px-4 !text-white`}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Download CSV
              </button>
            </div>
          </div>
        </div>
      </section>

      {summary && (
        <div className="grid gap-3 lg:grid-cols-3">
          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className={labelClass}>Selection</p>
            <p className="m-0 text-2xl font-bold text-neutral-950">{summary.rows.toLocaleString("en-US")}</p>
            <p className="mb-0 mt-0.5 text-xs text-neutral-500">payout(s) across {summary.recipients.toLocaleString("en-US")} beneficiary(ies)</p>
            <div className="mt-2.5 space-y-1">
              {summary.totals.map((total) => (
                <p key={total.currency} className="m-0 text-sm font-bold text-neutral-800">{money(total.amount, total.currency)}</p>
              ))}
              {summary.rows > exportLimit && (
                <p className="mb-0 mt-1.5 text-[11px] text-amber-700">Over the {exportLimit.toLocaleString("en-US")} row export limit. Narrow the range to download.</p>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className={labelClass}>By group</p>
            <div className="space-y-1.5">
              {summary.byGroup.length === 0 && <p className="m-0 text-xs text-neutral-500">Nothing in this selection.</p>}
              {summary.byGroup.map((entry) => (
                <div key={entry.sourceType} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-neutral-700">{entry.label}</span>
                  <span className="text-neutral-500">{entry.count} · {Number(entry.amount).toLocaleString("en-US")}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-neutral-200 bg-white p-4">
            <p className={labelClass}>By status</p>
            <div className="flex flex-wrap gap-1.5">
              {summary.byStatus.length === 0 && <p className="m-0 text-xs text-neutral-500">Nothing in this selection.</p>}
              {summary.byStatus.map((entry) => (
                <span key={entry.status} className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(entry.status)}`}>
                  {entry.status.replace(/_/g, " ")} {entry.count}
                </span>
              ))}
            </div>
          </section>
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        {loading ? (
          <div className="grid min-h-56 place-items-center text-neutral-400">
            <div className="text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mb-0 mt-2 text-xs">Running report</p>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <p className="mb-0 text-sm font-bold text-neutral-800">Nothing matches these filters</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Widen the date range, or clear the group and status filters.</p>
            </div>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                    <th className="px-4 py-3 font-bold">{dateLabel}</th>
                    <th className="px-4 py-3 font-bold">Reference</th>
                    <th className="px-4 py-3 font-bold">Recipient</th>
                    <th className="px-4 py-3 font-bold">Source</th>
                    <th className="px-4 py-3 text-right font-bold">Amount</th>
                    <th className="px-4 py-3 font-bold">Status</th>
                    <th className="px-4 py-3 font-bold">Batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {rows.map((row) => {
                    const stamp = dateField === "paidAt" ? row.paidAt : dateField === "approvedAt" ? row.approvedAt : row.createdAt;
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="px-4 py-3 text-xs text-neutral-500">{stamp ? new Date(stamp).toLocaleString() : "n/a"}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-neutral-950">
                          <div>{row.externalReferenceId}</div>
                          {row.pgReferenceId && <div className="text-neutral-400">{row.pgReferenceId}</div>}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div className="font-bold text-neutral-800">{row.recipient.name}</div>
                          <div className="text-slate-400">
                            {row.recipient.accountName} · {row.recipient.destinationType === "BANK" ? "Bank" : "Mobile money"} ·{" "}
                            {row.recipient.provider} · {row.recipient.accountNumber}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">{row.sourceType.replace(/_/g, " ")} #{row.sourceId}</td>
                        <td className="px-4 py-3 text-right text-sm font-bold text-slate-950">{money(row.amount, row.currency)}</td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(row.status)}`}>{row.status.replace(/_/g, " ")}</span>
                        </td>
                        <td className="px-4 py-3 font-mono text-[11px] text-neutral-500">{row.batch?.batchReference || "n/a"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-2 border-0 border-t border-solid border-neutral-100 px-4 py-2.5">
              <p className="m-0 text-xs text-neutral-500">
                Page {page} · showing {rows.length} of {summary?.rows.toLocaleString("en-US") ?? "?"}
              </p>
              <div className="flex gap-1.5">
                <button type="button" disabled={page <= 1 || loading} onClick={() => void run(page - 1)} className={actionClass}>Previous</button>
                <button type="button" disabled={rows.length < pageSize || loading} onClick={() => void run(page + 1)} className={actionClass}>Next</button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
