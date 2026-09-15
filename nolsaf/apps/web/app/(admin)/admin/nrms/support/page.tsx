"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Hotel,
  Info,
  LockKeyhole,
  Loader2,
  RefreshCw,
  ShieldCheck,
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

const STATUS_BADGE: Record<string, string> = {
  TRIAL: "border-sky-200 bg-sky-50 text-sky-700",
  ACTIVE: "border-emerald-200 bg-emerald-50 text-emerald-700",
  WARNING: "border-amber-200 bg-amber-50 text-amber-700",
  PAYMENT_REQUIRED: "border-red-200 bg-red-50 text-red-700",
  PAYMENT_PENDING: "border-violet-200 bg-violet-50 text-violet-700",
  CLOSED: "border-neutral-200 bg-neutral-100 text-neutral-600",
};

const ROOM_TONE: Record<string, { bar: string; badge: string }> = {
  CLEAN: { bar: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700" },
  INSPECTED: { bar: "bg-teal-500", badge: "bg-teal-50 text-teal-700" },
  DIRTY: { bar: "bg-red-400", badge: "bg-red-50 text-red-700" },
  IN_PROGRESS: { bar: "bg-amber-400", badge: "bg-amber-50 text-amber-700" },
  OUT_OF_SERVICE: { bar: "bg-neutral-400", badge: "bg-neutral-100 text-neutral-600" },
};

function formatMoney(value: number): string {
  return `TZS ${Number(value || 0).toLocaleString("en-TZ")}`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Not available";
  return new Date(value).toLocaleDateString("en-TZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Dar_es_Salaam",
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Not available";
  return new Date(value).toLocaleString("en-TZ", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  });
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

  useEffect(() => {
    let active = true;
    setLoadingAccounts(true);
    apiClient
      .get("/api/admin/nrms/commercial/accounts")
      .then((response) => {
        if (!active) return;
        setAccounts(response.data?.accounts ?? []);
      })
      .catch((cause: any) => {
        if (!active) return;
        setError(cause?.response?.data?.error || "Failed to load NRMS properties");
      })
      .finally(() => {
        if (active) setLoadingAccounts(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selectedAccount = useMemo(
    () => accounts.find((account) => String(account.propertyId) === propertyId) ?? null,
    [accounts, propertyId],
  );
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), []);

  const choosePeriod = (days: number) => {
    const start = new Date(`${today}T12:00:00Z`);
    start.setUTCDate(start.getUTCDate() - days + 1);
    setForm((previous) => ({ ...previous, from: start.toISOString().slice(0, 10), to: today }));
  };

  const roomTotal = useMemo(
    () => snapshot?.operations.rooms.reduce((total, row) => total + row.count, 0) ?? 0,
    [snapshot],
  );

  const readyRooms = useMemo(
    () => snapshot?.operations.rooms
      .filter((row) => row.status === "CLEAN" || row.status === "INSPECTED")
      .reduce((total, row) => total + row.count, 0) ?? 0,
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

  const loadSnapshot = async () => {
    if (!propertyId || loadingSnapshot || exporting) return;
    setLoadingSnapshot(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.get(`/api/admin/nrms/support/property/${propertyId}/snapshot`);
      setSnapshot(response.data);
      setLoadedAt(new Date().toISOString());
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to open the support snapshot");
    } finally {
      setLoadingSnapshot(false);
    }
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

  const metricCards = snapshot
    ? [
        {
          label: "Account",
          value: snapshot.account.status.replaceAll("_", " "),
        },
        {
          label: "Outstanding",
          value: formatMoney(snapshot.account.unpaidBalance),
        },
        {
          label: "Open stays",
          value: String(snapshot.operations.openReservations),
        },
        {
          label: "Open orders",
          value: String(snapshot.operations.openOrders),
        },
        {
          label: "Housekeeping",
          value: String(snapshot.operations.openHousekeeping),
        },
      ]
    : [];

  return (
    <div id="nrms-support" className="w-full min-w-0 max-w-none space-y-4 px-3 py-4 sm:px-5 sm:py-5">
      <style>{`#nrms-support, #nrms-support * {box-sizing:border-box;} #nrms-support [class~="border"] {border-style:solid;} #nrms-support .grid > * {min-width:0;} #nrms-support .text-neutral-400 {color:#64748b;} #nrms-support section > div[class*="py-5"] {padding-top:16px;padding-bottom:16px;}`}</style>
      <header className="relative isolate overflow-hidden rounded-2xl border border-[#dedde8] bg-[#f5f3ee] px-5 py-5 sm:px-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 -z-10 w-[42%] opacity-60" style={{ backgroundImage: "radial-gradient(circle, #aaa6c5 1px, transparent 1px)", backgroundSize: "16px 16px", maskImage: "linear-gradient(to right, transparent, black)" }} />
        <div aria-hidden="true" className="pointer-events-none absolute -right-10 -top-20 -z-10 h-64 w-64 rotate-12 rounded-[48px] border border-indigo-200 bg-[#e8e5f2]/70" />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
              <span>NRMS / Support operations</span>
              <span className="inline-flex items-center gap-1.5 rounded-md border border-indigo-200 bg-white/70 px-2 py-1 text-indigo-700"><LockKeyhole className="h-3 w-3" /> Read-only context</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-[0_6px_16px_-8px_rgba(79,70,229,0.6)]"><Eye className="h-5 w-5" /></span>
              <div className="min-w-0">
                <h1 className="m-0 text-2xl font-bold tracking-tight text-slate-950">Support workspace</h1>
                <p className="mb-0 mt-1 max-w-2xl text-xs leading-5 text-slate-500">Review property context, investigate operations and prepare dispute evidence.</p>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('finance-grant-required'))} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border-0 bg-indigo-600 px-4 text-xs font-bold text-white hover:bg-indigo-700"><LockKeyhole className="h-3.5 w-3.5" />Unlock finance actions</button>
          <Link href="/admin/nrms" className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-indigo-200 bg-white/90 px-4 text-xs font-bold text-indigo-800 no-underline transition hover:bg-indigo-50">
            NRMS directory <ChevronRight className="h-3.5 w-3.5" />
          </Link>
          </div>
        </div>
        <div className="relative mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-slate-600">
          <span className="inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-indigo-500" /> Guest identifiers redacted in exports</span>
          <span className="inline-flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-indigo-500" /> Audited exports with owner notification</span>
        </div>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-auto border-0 bg-transparent p-0 text-xs font-bold text-red-700">Dismiss</button>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="ml-auto border-0 bg-transparent p-0 text-xs font-bold text-emerald-800">Dismiss</button>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><Hotel className="h-4 w-4" /></span>
            <div>
              <h2 className="m-0 text-sm font-bold text-neutral-950">Property context</h2>
              <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Choose a property to load its latest operational record.</p>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2.5 sm:flex-row lg:max-w-2xl">
            <label className="min-w-0 flex-1">
              <span className="sr-only">NRMS property</span>
              <select
                value={propertyId}
                onChange={(event) => {
                  setPropertyId(event.target.value);
                  setSnapshot(null);
                  setNotice(null);
                  setError(null);
                }}
                disabled={loadingAccounts || loadingSnapshot || exporting}
                className="min-h-11 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-xs font-bold text-neutral-700 outline-none transition focus:border-emerald-500 focus:bg-white disabled:text-neutral-400"
              >
                <option value="">{loadingAccounts ? "Loading properties..." : "Select an NRMS property"}</option>
                {accounts.map((account) => (
                  <option key={account.propertyId} value={account.propertyId}>
                    {account.propertyTitle} | {account.status.replaceAll("_", " ")} | {formatMoney(account.unpaidBalance)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={!propertyId || loadingSnapshot || exporting}
              onClick={() => void loadSnapshot()}
              className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
            >
              {loadingSnapshot ? <Loader2 className="h-4 w-4 animate-spin" /> : snapshot ? <RefreshCw className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              {loadingSnapshot ? "Opening" : snapshot ? "Refresh snapshot" : "Open snapshot"}
            </button>
          </div>
        </div>
        {selectedAccount && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-neutral-100 bg-neutral-50/70 px-5 py-3 text-[10px] text-neutral-500 sm:px-6">
            <span className="font-bold text-neutral-800">{selectedAccount.propertyTitle}</span>
            <span className={`rounded-full border px-2.5 py-1 font-bold ${STATUS_BADGE[selectedAccount.status] ?? STATUS_BADGE.CLOSED}`}>{selectedAccount.status.replaceAll("_", " ")}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Outstanding {formatMoney(selectedAccount.unpaidBalance)}</span>
          </div>
        )}
      </section>

      {!snapshot && !loadingSnapshot && (
        <section className="rounded-2xl border border-dashed border-neutral-300 bg-slate-50 px-6 py-6">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-neutral-400 shadow-sm ring-1 ring-neutral-200"><Building2 className="h-5 w-5" /></span>
          <h2 className="mb-0 mt-3 text-base font-bold text-neutral-900">Start with a property</h2>
          <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">1. Open its snapshot. 2. Review account and operations. 3. Select an EAT reporting period and generate an audited dispute export.</p>
        </section>
      )}

      {snapshot && (
        <>
          <nav className="flex flex-wrap gap-2 rounded-xl border border-neutral-200 bg-white p-2" aria-label="Support workspace sections">
            {([['overview', 'Overview'], ['operations', 'Operations'], ['exports', 'Dispute exports']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={tab === value} onClick={() => setTab(value)} className={`min-h-10 rounded-lg border-0 px-4 text-xs font-bold ${tab === value ? 'bg-emerald-700 text-white' : 'bg-slate-50 text-slate-700 hover:bg-slate-100'}`}>{label}</button>)}
            <span className="ml-auto self-center px-2 text-[11px] text-slate-500">Snapshot loaded {formatDateTime(loadedAt)} EAT</span>
          </nav>
          <div hidden={tab !== "overview"} className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 border-b border-neutral-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><ShieldCheck className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 truncate text-base font-bold text-neutral-950">{snapshot.property.title}</h2>
                    <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold ${STATUS_BADGE[snapshot.account.status] ?? STATUS_BADGE.CLOSED}`}>{snapshot.account.status.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mb-0 mt-1 text-[11px] text-neutral-500">Recorded support context · property ID {snapshot.property.id}</p>
                </div>
              </div>
              <div className="flex w-full gap-2 sm:w-auto">
                <Link href={`/admin/nrms/${snapshot.property.id}`} className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-neutral-200 px-3 text-[10px] font-bold text-neutral-700 no-underline transition hover:bg-neutral-50 sm:flex-none">View property</Link>
                <Link href={`/admin/nrms/integrity/${snapshot.property.id}`} className="inline-flex min-h-9 flex-1 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-800 no-underline transition hover:bg-emerald-100 sm:flex-none">Activity</Link>
              </div>
            </div>
            <div className="grid min-w-0 gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Owner", snapshot.property.owner.name],
                ["Email", snapshot.property.owner.email ?? "Not provided"],
                ["Phone", snapshot.property.owner.phone ?? "Not provided"],
                ["Policy", snapshot.account.policyVersion],
                ["Trial ends", formatDate(snapshot.account.trialEndsAt)],
                ["Access mode", "Read only"],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 bg-white px-5 py-4 sm:px-6">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">{label}</p>
                  <p className={`mb-0 mt-1 truncate text-xs ${label === "Owner" || label === "Access mode" ? "font-bold text-neutral-900" : "text-neutral-600"} ${label === "Access mode" ? "text-emerald-700" : ""}`} title={value}>{value}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            {metricCards.map((card) => (
              <div key={card.label} className="min-w-0 rounded-xl border border-neutral-200 bg-white px-4 py-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
                <p className="m-0 truncate text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">{card.label}</p>
                <p className="mb-0 mt-1.5 truncate text-lg font-bold tabular-nums text-neutral-950" title={card.value}>{card.value}</p>
              </div>
            ))}
          </div>

          </div>
          <div hidden={tab !== "operations"}>
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-1 border-b border-neutral-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Activity className="h-4 w-4" /></span><div><h2 className="m-0 text-sm font-bold text-neutral-950">Operations overview</h2><p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Activity, room readiness and closeout records</p></div></div>
              <span className="inline-flex w-fit rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">Point-in-time snapshot</span>
            </div>
            <div className="grid min-w-0 grid-cols-2 gap-3 p-4 lg:grid-cols-4">
              {[
                ["Open stays", String(snapshot.operations.openReservations)],
                ["Open orders", String(snapshot.operations.openOrders)],
                ["Housekeeping tasks", String(snapshot.operations.openHousekeeping)],
                ["Active staff", String(snapshot.operations.activeStaff)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                  <p className="m-0 text-[10px] font-bold text-slate-500">{label}</p>
                  <p className="mb-0 mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</p>
                </div>
              ))}
            </div>
            <div className="grid min-w-0 gap-4 px-4 pb-4 xl:grid-cols-2">
              <section className="min-w-0 rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="m-0 text-sm font-bold text-slate-900">Room readiness</h3><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">{readyRooms} ready / {roomTotal} rooms</span></div>
                <div className="mt-4 flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">{snapshot.operations.rooms.map((row) => <span key={row.status} className={ROOM_TONE[row.status]?.bar ?? "bg-slate-400"} style={{ width: `${roomTotal ? row.count / roomTotal * 100 : 0}%` }} />)}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{snapshot.operations.rooms.map((row) => <div key={row.status} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"><span className="flex items-center gap-2 text-[11px] text-slate-600"><span className={`h-2 w-2 shrink-0 rounded-full ${ROOM_TONE[row.status]?.bar ?? 'bg-slate-400'}`} />{row.status.replaceAll('_', ' ')}</span><b className="text-sm tabular-nums text-slate-900">{row.count}</b></div>)}</div>
                {roomTotal === 0 && <p className="mb-0 text-xs text-slate-500">No active rooms configured.</p>}
              </section>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <section className="min-w-0 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-bold text-slate-900">Cashier shift</h3><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${snapshot.operations.openShift ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{snapshot.operations.openShift ? 'Open' : 'No open shift'}</span></div>
                  <p className="mb-0 mt-4 text-[10px] font-bold text-slate-500">Opened (EAT)</p><p className="mb-0 mt-1 text-xs leading-5 text-slate-800">{snapshot.operations.openShift ? formatDateTime(snapshot.operations.openShift.openedAt) : 'Not applicable'}</p>
                  {snapshot.operations.openShift && <p className="mb-0 mt-2 text-[11px] text-slate-500">Shift #{snapshot.operations.openShift.id}</p>}
                </section>
                <section className="min-w-0 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-2"><h3 className="m-0 text-sm font-bold text-slate-900">Latest night audit</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-600">{snapshot.operations.lastAudit?.status ?? 'None'}</span></div>
                  <p className="mb-0 mt-3 break-all text-xs font-bold leading-5 text-slate-800">{snapshot.operations.lastAudit?.reportNumber ?? 'No audit recorded'}</p><p className="mb-0 mt-3 text-[10px] font-bold text-slate-500">Completed (EAT)</p><p className="mb-0 mt-1 text-xs leading-5 text-slate-800">{formatDateTime(snapshot.operations.lastAudit?.completedAt)}</p>
                </section>
              </div>
            </div>
          </section>

          </div>
          <div hidden={tab !== "exports"} className="space-y-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-[#f0eef7] px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white"><FileText className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-950">Prepare dispute evidence</h2>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[9px] font-bold text-amber-700"><ShieldCheck className="h-3 w-3" /> Audited workflow</span>
                    </div>
                    <p className="mb-0 mt-1.5 max-w-xl text-xs leading-5 text-neutral-600">Create a secure report for the selected period. The owner is notified automatically after generation.</p>
                  </div>
                </div>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-[9px] font-bold text-emerald-700"><LockKeyhole className="h-3 w-3" /> Finance authorization required</span>
              </div>
            </div>
            <div className="grid min-w-0 gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="min-w-0 space-y-5">
                <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="mb-3 mt-0 flex items-center gap-2 text-xs font-bold text-slate-800"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">1</span>Choose report format</h3>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <label className="block min-w-0">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">File format</span>
                    <div className="relative">
                      {form.format === "PDF" ? <FileText className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" /> : <FileSpreadsheet className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-700" />}
                      <select value={form.format} onChange={(event) => setForm({ ...form, format: event.target.value as ExportForm["format"] })} className="min-h-12 w-full min-w-0 rounded-lg border border-neutral-200 bg-white py-2 pl-10 pr-9 text-xs font-bold text-neutral-700 outline-none transition hover:border-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10">
                        <option value="PDF">PDF summary</option><option value="CSV">CSV detail</option>
                      </select>
                    </div>
                  </label>
                  <div className="min-w-0">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Reporting limit</span>
                    <div className="flex min-h-12 items-center gap-2 rounded-lg border border-dashed border-neutral-200 bg-neutral-50 px-3.5 text-xs text-neutral-600"><Clock3 className="h-4 w-4 shrink-0 text-neutral-400" /><span>Up to 366 days per export</span></div>
                  </div>
                </div>
                <p className="mb-0 mt-3 text-[11px] leading-5 text-slate-500">{form.format === "PDF" ? "PDF: a readable summary of orders, reservations and PAYG statements." : "CSV: structured record rows for filtering and further investigation."}</p>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="m-0 flex items-center gap-2 text-xs font-bold text-slate-800"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">2</span>Select reporting period</h3><span className="text-[10px] font-bold text-slate-500">East Africa Time · UTC+3</span></div>
                <div className="mb-4 flex flex-wrap gap-2">{[{ days: 1, label: 'Today' }, { days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' }].map((period) => <button key={period.days} type="button" disabled={exporting} onClick={() => choosePeriod(period.days)} className="min-h-8 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-[11px] font-bold text-indigo-700 hover:bg-indigo-100 disabled:opacity-50">{period.label}</button>)}</div>
                <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                  <div className="min-w-0">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Period starts</span>
                    <DatePickerField label="Dispute export period starts" value={form.from} max={form.to || today} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setForm({ ...form, from: next.slice(0, 10) })} />
                  </div>
                  <div className="min-w-0">
                    <span className="mb-2 block text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500">Period ends</span>
                    <DatePickerField label="Dispute export period ends" value={form.to} min={form.from || undefined} max={today} allowPast twoMonths={false} widthClassName="!w-full" onChangeAction={(next) => setForm({ ...form, to: next.slice(0, 10) })} />
                  </div>
                </div>
                </div>
                <div className="rounded-xl border border-slate-200 p-4">
                <h3 className="mb-3 mt-0 flex items-center gap-2 text-xs font-bold text-slate-800"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-indigo-700">3</span>Record the purpose</h3>
                <label className="block min-w-0">
                  <span className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500"><span>Export reason</span><span className="font-normal normal-case tracking-normal text-neutral-400">{form.reason.trim().length}/300</span></span>
                  <textarea value={form.reason} maxLength={300} rows={3} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Example: Owner disputed statement #42" className="min-h-24 w-full min-w-0 resize-none rounded-lg border border-neutral-200 px-3.5 py-3 text-xs leading-5 text-neutral-700 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" />
                </label>
                <p className="m-0 flex items-start gap-2 rounded-lg bg-neutral-50 px-3.5 py-3 text-[10px] leading-4 text-neutral-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />This reason is saved in the admin audit and included in the owner notification.</p>
                </div>
              </div>
              <aside className="min-w-0 self-start rounded-xl border border-indigo-200 bg-[#f7f6fb] p-4 sm:p-5">
                <p className="m-0 text-xs font-bold text-indigo-900">Review before generating</p>
                <p className="mb-0 mt-2 break-words text-sm font-bold text-slate-900">{snapshot.property.title}</p>
                <p className="mb-0 mt-1 text-[11px] text-slate-500">Property #{snapshot.property.id} · {form.format} report</p>
                <p className="mb-0 mt-2 text-[11px] leading-5 text-slate-600">{form.from && form.to ? `${formatDate(form.from)} to ${formatDate(form.to)} (EAT)` : 'Reporting period not selected'}</p>
                <div className="mt-4 space-y-3">
                  {[
                    { label: "Property context loaded", ready: true },
                    { label: "EAT date range validated", ready: Boolean(form.from && form.to && form.to >= form.from && form.to <= today && new Date(form.to).getTime() - new Date(form.from).getTime() < 366 * 86400000) },
                    { label: "Audit reason provided", ready: form.reason.trim().length >= 5 },
                  ].map((item) => (
                    <div key={item.label} className="flex items-start gap-2.5 text-xs text-neutral-600"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${item.ready ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500"}`}>{item.ready ? <CheckCircle2 className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}</span><span>{item.label}</span></div>
                  ))}
                </div>
                <div className="mt-5 border-t border-neutral-200 pt-4"><p className="m-0 text-[10px] font-bold text-neutral-700">What happens next</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">The server checks finance authorization, records the audit reason and notifies the owner. PDF summarizes records; CSV includes detail. Guest identifiers are redacted.</p></div>
              </aside>
            </div>
            <div className="flex flex-col gap-4 border-t border-neutral-100 bg-neutral-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="min-w-0"><p className={`m-0 text-[10px] font-medium ${exportValidation ? "text-neutral-500" : "text-emerald-700"}`}>{exportValidation ?? `Ready to export ${formatDate(form.from)} through ${formatDate(form.to)}.`}</p><p className="mb-0 mt-1 text-[9px] text-neutral-400">The action is audited and the owner is notified.</p></div>
              <button type="button" disabled={Boolean(exportValidation) || exporting} onClick={() => void exportFile()} className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 sm:w-auto">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{exporting ? "Generating export" : `Generate ${form.format}`}
              </button>
            </div>
          </section>
          <section className="rounded-xl border border-neutral-200 bg-white p-4">
            <h2 className="m-0 text-sm font-bold">Completed downloads this session</h2>
            <p className="mb-3 mt-1 text-xs text-slate-500">Download requests completed for this property. This list resets when the page reloads; server audits remain stored.</p>
            <div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-slate-50"><tr>{['Format', 'Reporting period (EAT)', 'Generated (EAT)'].map((label) => <th key={label} className="p-3">{label}</th>)}</tr></thead><tbody>{exportHistory.filter((row) => row.propertyId === snapshot.property.id).map((row, index) => <tr key={`${row.at}-${index}`}><td className="p-3 font-bold">{row.format}</td><td className="p-3">{formatDate(row.from)} to {formatDate(row.to)}</td><td className="p-3">{formatDateTime(row.at)}</td></tr>)}</tbody></table></div>
            {!exportHistory.some((row) => row.propertyId === snapshot.property.id) && <p className="mb-0 text-xs text-slate-500">No exports generated for this property in this session.</p>}
          </section>
          </div>
        </>
      )}
    </div>
  );
}
