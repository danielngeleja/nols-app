"use client";

import { Fragment, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Loader2,
  PlusCircle,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type PayoutAccountSummary = {
  id?: number;
  provider: string;
  accountNumber: string;
  accountName: string;
  userId?: number;
};

type DisbursementEvent = {
  id: number;
  eventType: string;
  status: string | null;
  message: string | null;
  pgReferenceId: string | null;
  fspReferenceId: string | null;
  operator: string | null;
  createdAt: string;
};

type Disbursement = {
  id: number;
  externalReferenceId: string;
  pgReferenceId: string | null;
  sourceType: string;
  sourceId: number;
  amount: number;
  currency: string;
  status: string;
  bankName: string;
  providerMessage: string | null;
  remarks: string | null;
  createdAt: string;
  approvedAt: string | null;
  submittedAt: string | null;
  paidAt: string | null;
  failedAt: string | null;
  payoutAccount: PayoutAccountSummary;
  events?: DisbursementEvent[];
};

const STATUSES = ["", "REQUESTED", "APPROVED", "SUBMITTED", "PROCESSING", "PAID", "FAILED"];
const SOURCE_TYPES = ["", "OWNER_INVOICE", "TOUR_BOOKING", "DRIVER_TRIP", "SALES_PAYOUT"];
const PAGE_SIZES = [25, 50, 100];
const STALE_MINUTES = 30;

const fieldClass =
  "min-h-10 w-full min-w-0 rounded-xl border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100";
const actionClass =
  "inline-flex min-h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-700 shadow-sm transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40";

function money(value: number, currency: string) {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function errorMessage(cause: any, fallback: string) {
  if (cause?.response?.data?.require2fa) {
    return "Finance OTP verification is required. Complete it in the verification panel, then retry.";
  }
  const data = cause?.response?.data;
  if (data?.retryClass) {
    return `${data.error || fallback} (retry guidance: ${retryGuidance(data.retryClass)})`;
  }
  return data?.error || fallback;
}

function retryGuidance(retryClass: string): string {
  switch (retryClass) {
    case "AUTH_RETRY":
      return "token refreshed, safe to retry";
    case "VALIDATION":
      return "fix the request data first, do not retry as-is";
    case "FRESHNESS":
      return "safe to retry, request will be rebuilt";
    case "RECONCILE_FIRST":
      return "do NOT retry — check status before doing anything else";
    default:
      return "unknown, check status before retrying";
  }
}

function statusClass(status: string) {
  if (status === "PAID") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (status === "FAILED") return "border-red-100 bg-red-50 text-red-700";
  if (status === "APPROVED") return "border-sky-100 bg-sky-50 text-sky-700";
  return "border-amber-100 bg-amber-50 text-amber-700"; // REQUESTED, SUBMITTED, PROCESSING
}

function isStale(item: Disbursement): boolean {
  if (!["SUBMITTED", "PROCESSING"].includes(item.status) || !item.submittedAt) return false;
  return Date.now() - new Date(item.submittedAt).getTime() > STALE_MINUTES * 60_000;
}

function sourceLabel(sourceType: string) {
  switch (sourceType) {
    case "OWNER_INVOICE":
      return "Owner invoice";
    case "TOUR_BOOKING":
      return "Tour booking";
    case "DRIVER_TRIP":
      return "Driver trip";
    case "SALES_PAYOUT":
      return "Sales payout";
    default:
      return sourceType;
  }
}

function Summary({
  icon: Icon,
  label,
  value,
  detail,
  tone,
  onClick,
  active,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  detail: string;
  tone: "emerald" | "amber" | "red" | "slate";
  onClick?: () => void;
  active?: boolean;
}) {
  const tones = {
    emerald: "border-emerald-100 bg-emerald-50 text-emerald-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    red: "border-red-100 bg-red-50 text-red-700",
    slate: "border-neutral-200 bg-neutral-100 text-neutral-600",
  };
  const clickable = typeof onClick === "function";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      aria-pressed={clickable ? Boolean(active) : undefined}
      className={`w-full rounded-2xl border bg-white p-4 text-left shadow-[0_12px_35px_-32px_rgba(15,23,42,0.45)] transition ${
        active ? "border-emerald-300 ring-2 ring-emerald-100" : "border-neutral-200"
      } ${clickable ? "cursor-pointer hover:border-emerald-200 hover:shadow-[0_16px_40px_-30px_rgba(2,102,94,0.5)]" : "cursor-default"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em] text-neutral-400">{label}</p>
          <p className="mb-0 mt-1 truncate text-xl font-black text-neutral-950">{value}</p>
        </div>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border ${tones[tone]}`}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <p className="mb-0 mt-2 text-[11px] text-neutral-500">{detail}</p>
    </button>
  );
}

function DisbursementsView() {
  const searchParams = useSearchParams();
  const [items, setItems] = useState<Disbursement[]>([]);
  const [status, setStatus] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ stuck: 0, failed: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Disbursement | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({ sourceType: "OWNER_INVOICE", sourceId: "", payoutAccountId: "", remarks: "" });

  // A dashboard (Owners revenue, Tours revenue, Drivers, Sales finance) can
  // deep-link here with ?sourceType=X&sourceId=Y once its own claim is
  // APPROVED, opening the request form pre-filled instead of making the
  // admin retype the source manually.
  useEffect(() => {
    const linkedSourceType = searchParams.get("sourceType");
    const linkedSourceId = searchParams.get("sourceId");
    if (linkedSourceType && SOURCE_TYPES.includes(linkedSourceType) && linkedSourceId) {
      setCreateForm((f) => ({ ...f, sourceType: linkedSourceType, sourceId: linkedSourceId }));
      setShowCreate(true);
    }
    // Only ever consumed once on load — the form is user-editable after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounce the search box so we hit the server-side search once the admin
  // stops typing, not on every keystroke. Resetting to page 1 keeps results
  // meaningful when the match set shrinks.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  // `silent` refreshes update the data in place without the full-screen loading
  // state or clobbering an error banner — used by the background auto-refresh so
  // the queue can update under the admin without the table flickering.
  const load = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
        setError("");
      }
      try {
        const response = await apiClient.get("/api/admin/disbursements", {
          params: {
            page,
            pageSize,
            status: status || undefined,
            sourceType: sourceType || undefined,
            q: debouncedQuery || undefined,
          },
        });
        setItems(response.data?.disbursements || []);
        setTotal(response.data?.total ?? 0);
        setStats({ stuck: response.data?.stats?.stuck ?? 0, failed: response.data?.stats?.failed ?? 0 });
      } catch (cause: any) {
        // A background poll that blips should not nuke the screen with an error.
        if (!silent) setError(errorMessage(cause, "Could not load disbursements."));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [status, sourceType, page, pageSize, debouncedQuery]
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Auto-refresh while money is actually moving: poll every 30s only when there
  // are in-flight (SUBMITTED/PROCESSING) or stuck payouts, the tab is visible,
  // and no action is mid-flight. This is how a landed AzamPay callback shows up
  // as PAID without anyone clicking refresh. Idle queues make no requests.
  const hasInFlight = useMemo(
    () => items.some((item) => item.status === "SUBMITTED" || item.status === "PROCESSING"),
    [items]
  );
  useEffect(() => {
    if (!hasInFlight && stats.stuck === 0) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (busy) return;
      void load(true);
    }, 30_000);
    return () => clearInterval(timer);
  }, [hasInFlight, stats.stuck, busy, load]);

  const setFilterStatus = (value: string) => {
    setStatus(value);
    setPage(1);
  };
  const setFilterSourceType = (value: string) => {
    setSourceType(value);
    setPage(1);
  };
  const setFilterPageSize = (value: number) => {
    setPageSize(value);
    setPage(1);
  };

  // Search now runs server-side (see the debounced q param), so every matching
  // row across all pages is reachable, not just the ones already on screen.
  const visible = items;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  const summary = useMemo(() => {
    const currencies = [...new Set(visible.map((item) => item.currency))];
    const pageValue = visible.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    return {
      count: total,
      value: currencies.length === 1 ? money(pageValue, currencies[0]) : visible.length ? "Mixed currencies" : "TSh 0",
      staleCount: stats.stuck,
      failedCount: stats.failed,
    };
  }, [visible, total, stats]);

  const loadDetail = useCallback(async (id: number) => {
    setDetailLoading(true);
    try {
      const response = await apiClient.get(`/api/admin/disbursements/${id}`);
      setDetail(response.data?.disbursement || null);
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not load disbursement detail."));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const toggleExpand = (item: Disbursement) => {
    if (expandedId === item.id) {
      setExpandedId(null);
      setDetail(null);
      return;
    }
    setExpandedId(item.id);
    setDetail(null);
    void loadDetail(item.id);
  };

  const runAction = async (id: number, action: "approve" | "submit" | "check-status") => {
    setBusy(`${action}-${id}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/disbursements/${id}/${action}`);
      const label = action === "check-status" ? "status re-checked" : `${action}d`;
      setNotice(`Disbursement #${id} ${label}.`);
      await load();
      if (expandedId === id) await loadDetail(id);
    } catch (cause: any) {
      setError(errorMessage(cause, `Could not ${action} disbursement #${id}.`));
    } finally {
      setBusy("");
    }
  };

  // A FAILED disbursement can be tried again (the ledger and guard both treat
  // FAILED as re-requestable). Reopen the create form prefilled from the failed
  // row so the admin doesn't retype the source or re-look-up the account.
  const reRequest = (item: Disbursement) => {
    setCreateForm({
      sourceType: item.sourceType,
      sourceId: String(item.sourceId),
      payoutAccountId: item.payoutAccount?.id ? String(item.payoutAccount.id) : "",
      remarks: item.remarks || "",
    });
    setShowCreate(true);
    setNotice(`Prefilled a new request from failed disbursement #${item.id}. Review and create it.`);
    setError("");
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const provisionAccount = async () => {
    const sourceId = Number(createForm.sourceId);
    if (!createForm.sourceType || !Number.isInteger(sourceId) || sourceId <= 0) {
      setError("Enter a valid source ID before looking up a payout account.");
      return;
    }
    setBusy("provision");
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post("/api/admin/disbursements/payout-accounts/provision", {
        sourceType: createForm.sourceType,
        sourceId,
      });
      const account = response.data?.account;
      const warning = response.data?.verificationWarning;
      if (account?.id) {
        setCreateForm((f) => ({ ...f, payoutAccountId: String(account.id) }));
        setNotice(
          warning
            ? `Found payout account #${account.id} (${account.provider} ${account.accountNumber}) — ${warning}`
            : `Found and verified payout account #${account.id} (${account.provider} ${account.accountNumber}).`
        );
      }
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not look up a payout account for this source."));
    } finally {
      setBusy("");
    }
  };

  const createDisbursement = async () => {
    const sourceId = Number(createForm.sourceId);
    const payoutAccountId = Number(createForm.payoutAccountId);
    if (!Number.isInteger(sourceId) || sourceId <= 0 || !Number.isInteger(payoutAccountId) || payoutAccountId <= 0) {
      setError("Enter a valid source ID and payout account ID.");
      return;
    }
    setBusy("create");
    setError("");
    setNotice("");
    try {
      await apiClient.post("/api/admin/disbursements", {
        sourceType: createForm.sourceType,
        sourceId,
        payoutAccountId,
        remarks: createForm.remarks || undefined,
      });
      setCreateForm({ sourceType: "OWNER_INVOICE", sourceId: "", payoutAccountId: "", remarks: "" });
      setShowCreate(false);
      setNotice("Disbursement requested.");
      await load();
    } catch (cause: any) {
      setError(errorMessage(cause, "Could not create the disbursement request."));
    } finally {
      setBusy("");
    }
  };

  return (
    <div id="admin-disbursements" className="mx-auto w-full max-w-7xl space-y-4 px-4 py-5 sm:space-y-5 sm:py-6 2xl:max-w-[1720px]">
      <style>{`#admin-disbursements, #admin-disbursements * { box-sizing: border-box; }`}</style>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">
          PAYOUTS
        </div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm">
              <Send className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">AzamPay disbursement</p>
                <span className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 shadow-sm">
                  Finance OTP protected
                </span>
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">Disbursements</h1>
              <p className="mb-0 mt-1 max-w-3xl text-xs leading-5 text-neutral-500 sm:text-sm">
                One queue across owner, tour, driver and sales-partner payouts. Approve, submit to AzamPay, and reconcile stuck transfers.
              </p>
            </div>
          </div>
          <div className="flex max-w-full flex-nowrap items-center gap-2 overflow-x-auto pb-1">
            {(hasInFlight || stats.stuck > 0) && (
              <span
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700"
                title="Auto-refreshing every 30s while payouts are in flight"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            )}
            <Link href="/admin/finance" className={`${actionClass} min-h-10 no-underline`}>
              <Wallet className="h-4 w-4" /> All revenue
            </Link>
            <button type="button" onClick={() => setShowCreate((v) => !v)} className={actionClass}>
              <PlusCircle className="h-4 w-4" /> New request
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className={`${actionClass} h-10 w-10 shrink-0 px-0`}
              aria-label="Refresh disbursements"
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700">{error}</div>}
      {notice && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          {notice}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary
          icon={Send}
          label="Total disbursements"
          value={String(summary.count)}
          detail={status || sourceType ? "Filtered, all pages. Click to clear" : "All disbursements, all pages"}
          tone="slate"
          active={!status && !sourceType}
          onClick={() => {
            setStatus("");
            setSourceType("");
            setPage(1);
          }}
        />
        <Summary icon={Wallet} label="This page's value" value={summary.value} detail={`Sum of the ${visible.length} rows shown`} tone="emerald" />
        <Summary icon={Clock3} label="Stuck > 30 min" value={String(summary.staleCount)} detail="All pages, past the reconciliation threshold" tone={summary.staleCount > 0 ? "amber" : "slate"} />
        <Summary
          icon={XCircle}
          label="Failed"
          value={String(summary.failedCount)}
          detail={summary.failedCount > 0 ? "All pages. Click to review" : "All pages, needs manual review"}
          tone={summary.failedCount > 0 ? "red" : "slate"}
          active={status === "FAILED"}
          onClick={() => setFilterStatus("FAILED")}
        />
      </div>

      {showCreate && (
        <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700">
              <PlusCircle className="h-4 w-4" />
            </span>
            <div>
              <h2 className="m-0 text-sm font-bold text-neutral-900">Request a disbursement</h2>
              <p className="mb-0 mt-0.5 text-xs text-neutral-500">
                The source must already be APPROVED in its own flow (invoice / tour booking / trip / sales payout), and the payout account
                must be verified.
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <select
              className={fieldClass}
              value={createForm.sourceType}
              onChange={(e) => setCreateForm({ ...createForm, sourceType: e.target.value })}
            >
              {SOURCE_TYPES.filter(Boolean).map((s) => (
                <option key={s} value={s}>
                  {sourceLabel(s)}
                </option>
              ))}
            </select>
            <input
              className={fieldClass}
              value={createForm.sourceId}
              onChange={(e) => setCreateForm({ ...createForm, sourceId: e.target.value })}
              placeholder="Source ID (invoice/booking/trip/payout)"
            />
            <div className="flex gap-2">
              <input
                className={fieldClass}
                value={createForm.payoutAccountId}
                onChange={(e) => setCreateForm({ ...createForm, payoutAccountId: e.target.value })}
                placeholder="Payout account ID"
              />
              <button
                type="button"
                disabled={busy === "provision"}
                onClick={() => void provisionAccount()}
                className={`${actionClass} shrink-0`}
                title="Create/verify a payout account from this payee's existing profile details"
              >
                {busy === "provision" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                Look up
              </button>
            </div>
            <input
              className={fieldClass}
              value={createForm.remarks}
              onChange={(e) => setCreateForm({ ...createForm, remarks: e.target.value })}
              placeholder="Remarks (optional)"
            />
          </div>
          <p className="mb-0 mt-2 text-[11px] text-neutral-500">
            No payout account yet? Click "Look up" to create and verify one from the payee's existing profile details (mobile money / bank
            info they already have on file) instead of typing an ID.
          </p>
          <button
            type="button"
            disabled={busy === "create"}
            onClick={() => void createDisbursement()}
            className={`${actionClass} mt-3 !border-emerald-700 !bg-emerald-700 !text-white`}
          >
            {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            Create request
          </button>
        </section>
      )}

      <section className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <div className="grid gap-3 lg:grid-cols-[1fr_200px_200px]">
          <label className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-neutral-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={`${fieldClass} pl-9`}
              placeholder="Reference, pgReferenceId, or account"
              aria-label="Search disbursements"
            />
          </label>
          <select value={status} onChange={(e) => setFilterStatus(e.target.value)} className={fieldClass}>
            {STATUSES.map((s) => (
              <option key={s || "ALL"} value={s}>
                {s || "ALL STATUSES"}
              </option>
            ))}
          </select>
          <select value={sourceType} onChange={(e) => setFilterSourceType(e.target.value)} className={fieldClass}>
            <option value="">ALL SOURCES</option>
            {SOURCE_TYPES.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {sourceLabel(s)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        {loading ? (
          <div className="grid min-h-56 place-items-center text-neutral-400">
            <div className="text-center">
              <Loader2 className="mx-auto h-5 w-5 animate-spin" />
              <p className="mb-0 mt-2 text-xs">Loading disbursements</p>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="grid min-h-56 place-items-center p-8 text-center">
            <div>
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
              </span>
              <p className="mb-0 mt-3 text-sm font-bold text-neutral-800">No matching disbursements</p>
              <p className="mb-0 mt-1 text-xs text-neutral-500">Try another status, source, or search term.</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-100 bg-neutral-50/70 text-[10px] font-bold uppercase tracking-[0.08em] text-neutral-400">
                  <th className="px-4 py-3 font-bold">Reference</th>
                  <th className="px-4 py-3 font-bold">Status</th>
                  <th className="px-4 py-3 font-bold">Source</th>
                  <th className="px-4 py-3 font-bold">Payout account</th>
                  <th className="px-4 py-3 text-right font-bold">Amount</th>
                  <th className="px-4 py-3 font-bold">Created</th>
                  <th className="px-4 py-3 font-bold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {visible.map((item) => {
                  const stale = isStale(item);
                  const expanded = expandedId === item.id;
                  return (
                    <Fragment key={item.id}>
                      <tr
                        className={`cursor-pointer align-top transition hover:bg-emerald-50/30 ${stale ? "bg-amber-50/40" : ""}`}
                        onClick={() => toggleExpand(item)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-medium text-neutral-950">{item.externalReferenceId}</span>
                          {item.providerMessage && <p className="mb-0 mt-1 max-w-[220px] truncate text-[11px] text-slate-400">{item.providerMessage}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col items-start gap-1">
                            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusClass(item.status)}`}>{item.status}</span>
                            {stale && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                <AlertTriangle className="h-3 w-3" /> Stuck &gt; {STALE_MINUTES}m
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          {sourceLabel(item.sourceType)} #{item.sourceId}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600">
                          <div>{item.payoutAccount.accountName}</div>
                          <div className="text-slate-400">
                            {item.payoutAccount.provider} · {item.payoutAccount.accountNumber}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-sm font-bold text-slate-950">{money(item.amount, item.currency)}</span>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex flex-wrap gap-2">
                            {item.status === "REQUESTED" && (
                              <button type="button" disabled={!!busy} onClick={() => void runAction(item.id, "approve")} className={actionClass}>
                                {busy === `approve-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                                Approve
                              </button>
                            )}
                            {item.status === "APPROVED" && (
                              <button type="button" disabled={!!busy} onClick={() => void runAction(item.id, "submit")} className={actionClass}>
                                {busy === `submit-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                                Submit
                              </button>
                            )}
                            {["SUBMITTED", "PROCESSING"].includes(item.status) && (
                              <button
                                type="button"
                                disabled={!!busy}
                                onClick={() => void runAction(item.id, "check-status")}
                                className={actionClass}
                              >
                                {busy === `check-status-${item.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
                                Check status
                              </button>
                            )}
                            {item.status === "FAILED" && (
                              <button
                                type="button"
                                disabled={!!busy}
                                onClick={() => reRequest(item)}
                                className={actionClass}
                                title="Prefill a new request from this failed payout"
                              >
                                <RefreshCw className="h-4 w-4" />
                                Re-request
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {expanded && (
                        <tr>
                          <td colSpan={7} className="border-t border-neutral-100 bg-neutral-50/60 px-4 py-4">
                            {detailLoading ? (
                              <div className="flex items-center gap-2 text-xs text-neutral-500">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading event history…
                              </div>
                            ) : !detail || detail.id !== item.id ? (
                              <p className="m-0 text-xs text-neutral-500">Could not load event history.</p>
                            ) : !detail.events || detail.events.length === 0 ? (
                              <p className="m-0 text-xs text-neutral-500">No provider events yet.</p>
                            ) : (
                              <ol className="m-0 grid gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
                                {detail.events.map((event) => (
                                  <li key={event.id} className="rounded-xl border border-neutral-200 bg-white p-3 text-xs">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <span className="font-bold text-neutral-800">{event.eventType}</span>
                                      <span className="text-neutral-400">{new Date(event.createdAt).toLocaleString()}</span>
                                    </div>
                                    <p className="mb-0 mt-1 text-neutral-600">
                                      {event.status ? `${event.status} — ` : ""}
                                      {event.message || "no message"}
                                    </p>
                                    {(event.pgReferenceId || event.fspReferenceId || event.operator) && (
                                      <p className="mb-0 mt-1 font-mono text-[10px] text-neutral-400">
                                        {[event.pgReferenceId, event.fspReferenceId, event.operator].filter(Boolean).join(" · ")}
                                      </p>
                                    )}
                                  </li>
                                ))}
                              </ol>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-neutral-100 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span>
              {total === 0 ? "No results" : `Showing ${rangeStart}-${rangeEnd} of ${total}`}
            </span>
            <select
              value={pageSize}
              onChange={(e) => setFilterPageSize(Number(e.target.value))}
              className="min-h-8 rounded-lg border border-neutral-200 bg-white px-2 text-xs text-neutral-700 outline-none focus:border-emerald-400"
              aria-label="Rows per page"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className={`${actionClass} h-8 px-2.5`}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-bold text-neutral-700">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className={`${actionClass} h-8 px-2.5`}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

/**
 * useSearchParams() must sit under a Suspense boundary in the App Router,
 * otherwise the route de-opts to a client-render bailout and the server
 * prerender diverges from the client hydration (seen as a disabled-attribute
 * hydration mismatch on the header buttons). The boundary keeps SSR and the
 * client in agreement.
 */
export default function AdminDisbursementsPage() {
  return (
    <Suspense fallback={null}>
      <DisbursementsView />
    </Suspense>
  );
}
