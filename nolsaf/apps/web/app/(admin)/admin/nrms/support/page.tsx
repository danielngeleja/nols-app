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
  format: "PDF" | "CSV";
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

  const filteredAccounts = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    return accounts
      .filter((a) => !q || a.propertyTitle.toLowerCase().includes(q) || String(a.propertyId) === q.replace(/^#/, ""))
      .sort((a, b) => a.propertyTitle.localeCompare(b.propertyTitle));
  }, [accounts, pickerQuery]);

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
  const pickProperty = (id: number) => {
    const next = String(id);
    setPickerOpen(false);
    setPickerQuery("");
    if (next === propertyId && snapshot) return;
    setPropertyId(next);
    setSnapshot(null);
    setTab("overview");
    setForm({ format: "PDF", from: "", to: "", reason: "" });
    void loadSnapshot(next);
  };

  const exportFile = async () => {
    if (!snapshot || snapshot.property.id !== Number(propertyId) || exportValidation || exporting || loadingSnapshot) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.post(
        `/api/admin/nrms/support/property/${propertyId}/dispute-export`,
        {
          format: form.format,
          from: new Date(`${form.from}T00:00:00+03:00`).toISOString(),
          to: new Date(`${form.to}T23:59:59.999+03:00`).toISOString(),
          reason: form.reason.trim(),
        },
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(response.data);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nrms-dispute-${propertyId}-${form.from}-${form.to}.${form.format.toLowerCase()}`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportHistory((previous) => [{ propertyId: snapshot.property.id, title: snapshot.property.title, format: form.format, from: form.from, to: form.to, at: new Date().toISOString() }, ...previous]);
      setNotice(`${form.format} export generated. The action was audited and the owner was notified.`);
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

  return (
    <div className="space-y-5 w-full min-w-0">
      {/* Header */}
      <header className="rounded-2xl border border-solid border-indigo-100 bg-white">
        <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between sm:px-6">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><Eye className="h-5 w-5" /></span>
            <div className="min-w-0">
              <p className="m-0 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <Link href="/admin/nrms" className="text-neutral-500 no-underline hover:text-neutral-900">NRMS</Link>
                <ChevronRight className="h-3 w-3 text-neutral-300" />
                <span>Support operations</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 px-1.5 py-0.5 text-[11px] font-semibold text-indigo-700"><LockKeyhole className="h-3 w-3" /> Read only</span>
              </p>
              <h1 className="m-0 mt-0.5 text-xl font-bold tracking-tight text-neutral-950">Support workspace</h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("finance-grant-required"))} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border-0 bg-indigo-600 px-3.5 text-xs font-semibold text-white transition hover:bg-indigo-700">
              <LockKeyhole className="h-3.5 w-3.5" /> Unlock finance actions
            </button>
            <Link href="/admin/nrms" className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3.5 text-xs font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
              NRMS directory <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>

        {/* Property picker: the heart of the page */}
        <div className="border-0 border-t border-solid border-indigo-100 bg-indigo-50/40 px-5 py-4 sm:px-6">
          <div ref={pickerRef} className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              disabled={loadingAccounts || exporting}
              aria-expanded={pickerOpen}
              aria-haspopup="listbox"
              className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-3.5 py-2.5 text-left shadow-sm transition hover:border-indigo-300 disabled:opacity-60"
            >
              <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${selectedAccount ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-400"}`}>
                <Building2 className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                {selectedAccount ? (
                  <>
                    <span className="block truncate text-sm font-semibold text-neutral-900">{selectedAccount.propertyTitle}</span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-neutral-500">
                      <span className="font-mono">#{selectedAccount.propertyId}</span>
                      <span className={`inline-flex items-center gap-1 ${statusOf(selectedAccount.status).text}`}><span className={`h-1.5 w-1.5 rounded-full ${statusOf(selectedAccount.status).dot}`} />{statusOf(selectedAccount.status).label}</span>
                      <span className={selectedAccount.unpaidBalance > 0 ? "text-rose-600" : ""}>Outstanding {formatMoney(selectedAccount.unpaidBalance)}</span>
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block text-sm font-semibold text-neutral-800">{loadingAccounts ? "Loading properties…" : "Choose a property to investigate"}</span>
                    <span className="mt-0.5 block text-xs text-neutral-500">{loadingAccounts ? " " : `${accounts.length} NRMS properties · search by name or ID`}</span>
                  </>
                )}
              </span>
              {loadingSnapshot ? <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-indigo-600" /> : <ChevronDown className={`h-4 w-4 flex-shrink-0 text-neutral-400 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />}
            </button>

            {pickerOpen && (
              <div className="absolute left-0 right-0 top-full z-30 mt-1.5 overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white shadow-[0_20px_50px_-20px_rgba(15,23,42,0.35)]">
                <div className="relative border-0 border-b border-solid border-neutral-100 p-2">
                  <Search className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                  <input
                    autoFocus
                    value={pickerQuery}
                    onChange={(e) => setPickerQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && filteredAccounts[0]) pickProperty(filteredAccounts[0].propertyId);
                      if (e.key === "Escape") setPickerOpen(false);
                    }}
                    placeholder="Search property name or #ID"
                    className="h-9 w-full rounded-lg border-0 bg-neutral-50 pl-9 pr-3 text-sm text-neutral-900 outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100"
                  />
                </div>
                <ul role="listbox" className="m-0 max-h-72 list-none overflow-y-auto p-1">
                  {filteredAccounts.length === 0 ? (
                    <li className="px-3 py-6 text-center text-xs text-neutral-500">No properties match</li>
                  ) : (
                    filteredAccounts.map((a) => {
                      const st = statusOf(a.status);
                      const active = String(a.propertyId) === propertyId;
                      return (
                        <li key={a.propertyId}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => pickProperty(a.propertyId)}
                            className={`flex w-full items-center gap-3 rounded-lg border-0 px-3 py-2 text-left transition ${active ? "bg-indigo-50" : "bg-transparent hover:bg-neutral-50"}`}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm text-neutral-900">{a.propertyTitle}</span>
                              <span className="font-mono text-[11px] text-neutral-400">#{a.propertyId}</span>
                            </span>
                            <span className={`inline-flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${st.soft} ${st.text}`}><span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />{st.label}</span>
                            <span className={`w-28 flex-shrink-0 text-right text-xs tabular-nums ${a.unpaidBalance > 0 ? "text-rose-600" : "text-neutral-400"}`}>{formatMoney(a.unpaidBalance)}</span>
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5 text-indigo-500" /> Guest identifiers redacted in exports</span>
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5 text-indigo-500" /> Every export is audited and the owner is notified</span>
          </div>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error === "OTP required" ? "Finance OTP required. Use Unlock finance actions, then try again." : error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50/60 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Before a property is chosen: how the workspace works */}
      {!snapshot && !loadingSnapshot && (
        <section className="grid gap-3 md:grid-cols-3">
          {[
            { n: 1, icon: Building2, title: "Open a property", text: "Pick it above. Its snapshot loads right away." },
            { n: 2, icon: Activity, title: "Review the context", text: "Account standing, owner contact, rooms, shifts and night audits." },
            { n: 3, icon: FileText, title: "Export evidence", text: "Choose an EAT period and reason to generate an audited PDF or CSV." },
          ].map((s) => {
            const Icon = s.icon;
            return (
              <div key={s.n} className="flex items-start gap-3 rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-4">
                <span className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-bold text-indigo-700">{s.n}</span>
                <div className="min-w-0">
                  <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-neutral-900"><Icon className="h-4 w-4 text-neutral-400" /> {s.title}</p>
                  <p className="m-0 mt-1 text-xs text-neutral-500">{s.text}</p>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {loadingSnapshot && !snapshot && (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-solid border-neutral-200 bg-white py-16 text-sm text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Opening support snapshot
        </div>
      )}

      {snapshot && (() => {
        const st = statusOf(snapshot.account.status);
        const unpaidPct = snapshot.account.unpaidLimit > 0 ? Math.min((snapshot.account.unpaidBalance / snapshot.account.unpaidLimit) * 100, 100) : 0;
        return (
          <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
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
                <Link href={`/admin/nrms/${snapshot.property.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
                  Property <ExternalLink className="h-3.5 w-3.5" />
                </Link>
                <Link href={`/admin/nrms/integrity/${snapshot.property.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition hover:bg-neutral-50 hover:no-underline">
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
                  className={`relative inline-flex h-11 items-center gap-1.5 border-0 bg-transparent px-3 text-sm font-semibold transition-colors ${tab === value ? "text-indigo-700" : "text-neutral-500 hover:text-neutral-800"}`}
                >
                  <Icon className="h-4 w-4" /> {label}
                  {value === "exports" && sessionExports.length > 0 && <span className="rounded-full bg-indigo-100 px-1.5 text-[11px] tabular-nums text-indigo-700">{sessionExports.length}</span>}
                  {tab === value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-indigo-600" aria-hidden />}
                </button>
              ))}
            </nav>

            {/* Overview */}
            <div hidden={tab !== "overview"} className="space-y-5 p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-xl border border-solid border-neutral-200">
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

                <div className="rounded-xl border border-solid border-neutral-200">
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

              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-solid border-neutral-200 bg-neutral-200 md:grid-cols-4">
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
              <div className="rounded-xl border border-solid border-neutral-200 p-4">
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
                <div className="rounded-xl border border-solid border-neutral-200 p-4">
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
                <div className="rounded-xl border border-solid border-neutral-200 p-4">
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
                      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">1</span> Report format
                    </p>
                    <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                      {([
                        ["PDF", FileText, "PDF summary", "Readable summary of orders, reservations and PAYG statements"],
                        ["CSV", FileSpreadsheet, "CSV detail", "Record rows for filtering and deeper investigation"],
                      ] as const).map(([value, Icon, title, text]) => {
                        const on = form.format === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setForm({ ...form, format: value })}
                            aria-pressed={on}
                            disabled={exporting}
                            className={`flex items-start gap-3 rounded-xl border border-solid p-3 text-left transition ${on ? "border-indigo-500 bg-indigo-50/60 ring-2 ring-indigo-100" : "border-neutral-200 bg-white hover:border-neutral-300"}`}
                          >
                            <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${on ? "bg-indigo-600 text-white" : "bg-neutral-100 text-neutral-500"}`}><Icon className="h-4 w-4" /></span>
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
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">2</span> Reporting period
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
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-bold text-white">3</span> Purpose
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
                      className="mt-2.5 min-h-24 w-full min-w-0 resize-none rounded-lg border border-solid border-neutral-200 px-3 py-2.5 font-[inherit] text-sm text-neutral-800 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                    />
                    <p className="m-0 mt-1 text-[11px] text-neutral-400">Saved in the admin audit and included in the owner notification.</p>
                  </div>
                </div>

                {/* Summary + generate */}
                <aside className="min-w-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50 p-5 sm:p-6 lg:border-l lg:border-t-0">
                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Export summary</p>
                  <div className="mt-3 rounded-xl border border-solid border-neutral-200 bg-white p-3">
                    <p className="m-0 flex items-center gap-2 text-sm font-semibold text-neutral-900">
                      {form.format === "PDF" ? <FileText className="h-4 w-4 text-indigo-600" /> : <FileSpreadsheet className="h-4 w-4 text-indigo-600" />}
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
                    className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-indigo-600 text-sm font-semibold text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
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
                          {row.format === "PDF" ? <FileText className="h-3.5 w-3.5 text-indigo-600" /> : <FileSpreadsheet className="h-3.5 w-3.5 text-indigo-600" />}{row.format}
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
