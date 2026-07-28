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
  Database,
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
  Sparkles,
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
  });
}

function localDateValue(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
  const today = useMemo(() => localDateValue(new Date()), []);

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
    if (!propertyId) return;
    setLoadingSnapshot(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.get(`/api/admin/nrms/support/property/${propertyId}/snapshot`);
      setSnapshot(response.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to open the support snapshot");
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const exportFile = async () => {
    if (!propertyId || exportValidation) return;
    setExporting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await apiClient.post(
        `/api/admin/nrms/support/property/${propertyId}/dispute-export`,
        {
          format: form.format,
          from: new Date(`${form.from}T00:00:00`).toISOString(),
          to: new Date(`${form.to}T23:59:59`).toISOString(),
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
    <div className="mx-auto min-w-0 max-w-[1440px] space-y-6 px-4 py-5 sm:px-6 sm:py-7 lg:px-8">
      <header className="relative isolate overflow-hidden rounded-2xl bg-gradient-to-br from-[#063c37] via-[#075e57] to-[#078375] px-5 py-6 text-white shadow-[0_12px_32px_rgba(2,102,94,0.14)] sm:px-8 sm:py-7">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-100">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1"><Sparkles className="h-3 w-3" /> Pro workspace</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/10 px-2.5 py-1"><LockKeyhole className="h-3 w-3" /> Read-only access</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/[0.12] ring-1 ring-white/15"><Eye className="h-5 w-5 text-emerald-100" /></span>
              <div className="min-w-0">
                <h1 className="m-0 text-2xl font-bold tracking-tight text-white sm:text-[28px]">Support snapshot</h1>
                <p className="mb-0 mt-1 max-w-2xl text-sm leading-6 text-emerald-50/80">A focused view of live property context, account health, and audit-ready dispute exports.</p>
              </div>
            </div>
          </div>
          <Link href="/admin/nrms" className="inline-flex min-h-10 w-full shrink-0 items-center justify-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 text-xs font-bold text-white no-underline transition hover:bg-white/15 sm:w-auto">
            NRMS directory <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>
        <div className="mt-6 grid gap-2 border-t border-white/15 pt-4 text-[11px] text-emerald-50/80 sm:grid-cols-3">
          <span className="inline-flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-emerald-200" /> Owner-safe support tools</span>
          <span className="inline-flex items-center gap-2"><Database className="h-3.5 w-3.5 text-emerald-200" /> Live operational records</span>
          <span className="inline-flex items-center gap-2"><Clock3 className="h-3.5 w-3.5 text-emerald-200" /> Every export is audited</span>
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
                disabled={loadingAccounts}
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
              disabled={!propertyId || loadingSnapshot}
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
        <section className="rounded-2xl border border-dashed border-neutral-300 bg-gradient-to-b from-neutral-50 to-white px-6 py-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-neutral-400 shadow-sm ring-1 ring-neutral-200"><Building2 className="h-5 w-5" /></span>
          <h2 className="mb-0 mt-4 text-base font-bold text-neutral-900">No support snapshot open</h2>
          <p className="mx-auto mb-0 mt-1 max-w-md text-xs leading-5 text-neutral-500">Select a property above to review its account, current operations, and dispute-ready records.</p>
        </section>
      )}

      {snapshot && (
        <>
          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-4 border-b border-neutral-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700"><ShieldCheck className="h-4 w-4" /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 truncate text-base font-bold text-neutral-950">{snapshot.property.title}</h2>
                    <span className={`rounded-full border px-2.5 py-1 text-[9px] font-bold ${STATUS_BADGE[snapshot.account.status] ?? STATUS_BADGE.CLOSED}`}>{snapshot.account.status.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mb-0 mt-1 text-[11px] text-neutral-500">Verified support context - property ID {snapshot.property.id}</p>
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

          <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
            <div className="flex flex-col gap-1 border-b border-neutral-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-2"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-50 text-sky-700"><Activity className="h-4 w-4" /></span><div><h2 className="m-0 text-sm font-bold text-neutral-950">Live operations</h2><p className="mb-0 mt-0.5 text-[11px] text-neutral-500">Current property workspace state</p></div></div>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[9px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Live record</span>
            </div>
            <div className="grid min-w-0 gap-px bg-neutral-100 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Rooms ready", `${readyRooms} / ${roomTotal}`],
                ["Active staff", String(snapshot.operations.activeStaff)],
                ["Cashier shift", snapshot.operations.openShift ? "Open" : "Closed"],
                ["Shift opened", snapshot.operations.openShift ? formatDateTime(snapshot.operations.openShift.openedAt) : "Not applicable"],
                ["Last audit", snapshot.operations.lastAudit?.status ?? "None"],
                ["Audit completed", formatDateTime(snapshot.operations.lastAudit?.completedAt)],
              ].map(([label, value]) => (
                <div key={label} className="min-w-0 bg-white px-5 py-4 sm:px-6">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">{label}</p>
                  <p className={`mb-0 mt-1 text-xs ${label === "Rooms ready" || label === "Cashier shift" ? "font-bold text-neutral-900" : "text-neutral-600"}`} title={value}>{value}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 bg-neutral-50/60 px-5 py-4 sm:px-6">
              <span className="mr-1 text-[9px] font-bold uppercase tracking-[0.14em] text-neutral-400">Room status</span>
              {snapshot.operations.rooms.length > 0 ? snapshot.operations.rooms.map((row) => (
                <span key={row.status} className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${ROOM_TONE[row.status]?.badge ?? "bg-neutral-100 text-neutral-600"}`}>{row.status.replaceAll("_", " ")} {row.count}</span>
              )) : <span className="text-xs text-neutral-400">No active rooms configured</span>}
            </div>
          </section>

          <section className="overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-[0_8px_22px_rgba(2,102,94,0.07)]">
            <div className="relative isolate overflow-hidden border-b border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-teal-50 px-5 py-6 sm:px-7">
              <div className="absolute -right-10 -top-16 -z-10 h-44 w-44 rounded-full bg-emerald-200/40 blur-3xl" />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white shadow-sm"><FileText className="h-5 w-5" /></span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="m-0 text-lg font-bold tracking-tight text-neutral-950">Dispute export</h2>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[9px] font-bold text-amber-700"><ShieldCheck className="h-3 w-3" /> Audited workflow</span>
                    </div>
                    <p className="mb-0 mt-1.5 max-w-xl text-xs leading-5 text-neutral-600">Create a secure report for the selected period. The owner is notified automatically after generation.</p>
                  </div>
                </div>
                <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-[9px] font-bold text-emerald-700"><LockKeyhole className="h-3 w-3" /> Pro controls enabled</span>
              </div>
            </div>
            <div className="grid min-w-0 gap-6 px-5 py-6 sm:px-7 lg:grid-cols-[minmax(0,1.35fr)_minmax(220px,0.65fr)] lg:gap-8">
              <div className="min-w-0 space-y-5">
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
                <label className="block min-w-0">
                  <span className="mb-2 flex items-center justify-between gap-3 text-[10px] font-bold uppercase tracking-[0.14em] text-neutral-500"><span>Export reason</span><span className="font-normal normal-case tracking-normal text-neutral-400">{form.reason.trim().length}/300</span></span>
                  <textarea value={form.reason} maxLength={300} rows={3} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Example: Owner disputed statement #42" className="min-h-24 w-full min-w-0 resize-none rounded-lg border border-neutral-200 px-3.5 py-3 text-xs leading-5 text-neutral-700 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10" />
                </label>
                <p className="m-0 flex items-start gap-2 rounded-lg bg-neutral-50 px-3.5 py-3 text-[10px] leading-4 text-neutral-500"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />This reason is saved in the admin audit and included in the owner notification.</p>
              </div>
              <aside className="min-w-0 rounded-xl border border-neutral-100 bg-neutral-50/80 p-4 sm:p-5">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-neutral-400">Export checklist</p>
                <div className="mt-4 space-y-3">
                  {["Property context loaded", "Date range validated", "Owner notification queued"].map((item, index) => (
                    <div key={item} className="flex items-start gap-2.5 text-xs text-neutral-600"><span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${index === 2 && exportValidation ? "bg-neutral-200 text-neutral-400" : "bg-emerald-100 text-emerald-700"}`}><CheckCircle2 className="h-3 w-3" /></span><span>{item}</span></div>
                  ))}
                </div>
                <div className="mt-5 border-t border-neutral-200 pt-4"><p className="m-0 text-[10px] font-bold text-neutral-700">Smart audit trail</p><p className="mb-0 mt-1 text-[10px] leading-4 text-neutral-500">Every generated file is linked to this support snapshot and the reason you provide.</p></div>
              </aside>
            </div>
            <div className="flex flex-col gap-4 border-t border-neutral-100 bg-neutral-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <div className="min-w-0"><p className={`m-0 text-[10px] font-medium ${exportValidation ? "text-neutral-500" : "text-emerald-700"}`}>{exportValidation ?? `Ready to export ${formatDate(form.from)} through ${formatDate(form.to)}.`}</p><p className="mb-0 mt-1 text-[9px] text-neutral-400">The action is audited and the owner is notified.</p></div>
              <button type="button" disabled={Boolean(exportValidation) || exporting} onClick={() => void exportFile()} className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-lg border-0 bg-emerald-700 px-5 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500 sm:w-auto">
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{exporting ? "Generating export" : `Generate ${form.format}`}
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
