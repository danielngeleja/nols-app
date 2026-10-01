"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  FileText,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from "lucide-react";

type InvoiceRow = {
  id: number;
  invoiceNumber?: string | null;
  receiptNumber?: string | null;
  issuedAt: string;
  total: number;
  commissionAmount?: number | null;
  netPayable: number | null;
  status: string;
  ownerId: number;
  owner?: { id: number; name: string | null; email: string | null; phone: string | null; role: string } | null;
  booking?: {
    id: number;
    property?: { id: number; title: string | null; type: string | null } | null;
    user?: { id: number; name: string | null; email: string | null } | null;
  } | null;
  verifiedByUser?: { id: number; name: string | null } | null;
  approvedByUser?: { id: number; name: string | null } | null;
  paidByUser?: { id: number; name: string | null } | null;
  paidAt?: string | null;
  paymentMethod?: string | null;
  paymentRef?: string | null;
};

type StatusSummary = { status: string; count: number; total: number; netPayable: number; commission: number };

const PAGE_SIZE = 25;

/** The invoice lifecycle, in order. DRAFT is rare and folded into Requested's position only when present. */
const STAGES: Array<{ key: string; label: string; hint: string; icon: typeof Clock; text: string; bar: string; soft: string; pill: string }> = [
  { key: "REQUESTED", label: "Requested", hint: "Submitted by the payee", icon: FileText, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50/70", pill: "bg-amber-50 text-amber-700 ring-amber-200" },
  { key: "VERIFIED", label: "Verified", hint: "Checked against the booking", icon: ShieldCheck, text: "text-sky-700", bar: "bg-sky-500", soft: "bg-sky-50/70", pill: "bg-sky-50 text-sky-700 ring-sky-200" },
  { key: "APPROVED", label: "Approved", hint: "Cleared for payout", icon: BadgeCheck, text: "text-indigo-700", bar: "bg-indigo-500", soft: "bg-indigo-50/70", pill: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  { key: "PROCESSING", label: "Processing", hint: "Payout on its way", icon: Clock, text: "text-violet-700", bar: "bg-violet-500", soft: "bg-violet-50/70", pill: "bg-violet-50 text-violet-700 ring-violet-200" },
  { key: "PAID", label: "Paid", hint: "Money sent", icon: CheckCircle2, text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50/70", pill: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  { key: "REJECTED", label: "Rejected", hint: "Not payable", icon: XCircle, text: "text-rose-700", bar: "bg-rose-500", soft: "bg-rose-50/70", pill: "bg-rose-50 text-rose-700 ring-rose-200" },
];
const AWAITING = new Set(["REQUESTED", "VERIFIED", "APPROVED", "PROCESSING"]);

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";

function stageOf(status: string) {
  return STAGES.find((s) => s.key === String(status || "").toUpperCase()) ?? null;
}

function tzs(amount: number | null | undefined) {
  if (amount == null || !Number.isFinite(Number(amount))) return "None";
  return `TSh ${Number(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function compactTzs(amount: number) {
  if (amount >= 1_000_000_000) return `TSh ${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `TSh ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 10_000) return `TSh ${Math.round(amount / 1000)}K`;
  return tzs(amount);
}

function eatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function eatTime(iso: string) {
  return `${new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function humanize(status: string) {
  const s = String(status || "").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function InvoicesManagementPage() {
  const [items, setItems] = useState<InvoiceRow[]>([]);
  const [summary, setSummary] = useState<StatusSummary[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Search runs on the server across every invoice, not just this page.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
        if (status) params.set("status", status);
        if (search) params.set("q", search);
        const r = await fetch(`/api/admin/invoices?${params.toString()}`, { credentials: "include" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (!mounted) return;
        setItems(j.items ?? []);
        setTotal(j.total ?? 0);
        if (Array.isArray(j.summary)) setSummary(j.summary);
        setError(null);
      } catch (e) {
        console.error("invoices fetch", e);
        if (mounted) {
          setItems([]);
          setError("Could not load invoices. Refresh to try again.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [page, status, search, reloadKey]);

  const byStatus = useMemo(() => new Map(summary.map((s) => [String(s.status).toUpperCase(), s])), [summary]);
  const all = summary.reduce((acc, s) => ({ count: acc.count + s.count }), { count: 0 });
  const paid = byStatus.get("PAID");
  const awaiting = summary.filter((s) => AWAITING.has(String(s.status).toUpperCase()));
  const awaitingNet = awaiting.reduce((sum, s) => sum + s.netPayable, 0);
  const awaitingCount = awaiting.reduce((sum, s) => sum + s.count, 0);
  const otherStatuses = summary.filter((s) => !stageOf(s.status));
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const facts = [
    { label: "Invoices", value: summary.length ? all.count.toLocaleString() : loading ? "..." : total.toLocaleString(), detail: "from owners and drivers", tone: "text-white" },
    { label: "Paid out", value: paid ? compactTzs(paid.netPayable) : summary.length ? "TSh 0" : "...", detail: paid ? `${paid.count} invoices settled` : "nothing paid yet", tone: "text-emerald-300" },
    { label: "Waiting for payout", value: summary.length ? compactTzs(awaitingNet) : "...", detail: `${awaitingCount} requested, verified, approved or processing`, tone: awaitingCount ? "text-amber-300" : "text-white" },
    { label: "Commission earned", value: paid ? compactTzs(paid.commission) : summary.length ? "TSh 0" : "...", detail: "kept by NoLSAF on paid invoices", tone: "text-white" },
  ];

  const pickStatus = (key: string) => {
    setStatus((current) => (current === key ? null : key));
    setPage(1);
  };

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatus(null);
    setPage(1);
  };

  const activeStage = status ? stageOf(status) : null;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Payouts</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Invoices</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Every payout invoice from property owners and drivers. Each one moves from requested to paid on its own; this page is for tracking and receipts.</p>
            </div>
            <button type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 text-sm text-rose-800">
          <X className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="border-0 bg-transparent p-0 text-xs font-semibold text-rose-700 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Lifecycle, doubling as the status filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {STAGES.map((stage) => {
            const Icon = stage.icon;
            const s = byStatus.get(stage.key);
            const n = s?.count ?? 0;
            const share = all.count ? Math.round((n / all.count) * 100) : 0;
            const selected = status === stage.key;
            return (
              <button
                key={stage.key}
                type="button"
                onClick={() => pickStatus(stage.key)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${stage.text}`}><Icon className="h-3.5 w-3.5" /> {stage.label}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{summary.length ? n : "..."}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{n ? `${compactTzs(s!.netPayable)} net` : stage.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
        {otherStatuses.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 px-1.5 pb-1 text-[11px] text-neutral-500">
            Also:
            {otherStatuses.map((s) => (
              <button key={s.status} type="button" onClick={() => pickStatus(String(s.status).toUpperCase())} className={`inline-flex h-7 items-center gap-1 rounded-full border border-solid px-2.5 font-semibold ${status === String(s.status).toUpperCase() ? "border-neutral-900 bg-neutral-100 text-neutral-900" : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"}`}>
                {humanize(s.status)} <span className="tabular-nums text-neutral-400">{s.count}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{activeStage ? `${activeStage.label} invoices` : status ? `${humanize(status)} invoices` : "All invoices"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">{loading ? "Loading..." : `${total.toLocaleString()} ${total === 1 ? "invoice" : "invoices"}${search ? ` matching "${search}"` : ""}, newest first`}</p>
          </div>
          {(status || search) && (
            <button type="button" onClick={clearFilters} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> Clear filters
            </button>
          )}
          <div className="relative ml-auto w-full min-w-0 sm:w-96">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Invoice or receipt number, owner, email or property"
              aria-label="Search invoices"
              className="box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white pl-9 pr-9 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            />
            {searchInput && (
              <button type="button" onClick={() => setSearchInput("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] text-neutral-400">
                <th className="px-4 py-2.5 font-semibold sm:px-5">Invoice</th>
                <th className="px-3 py-2.5 font-semibold">Payee</th>
                <th className="px-3 py-2.5 font-semibold">Property</th>
                <th className="px-3 py-2.5 font-semibold">Issued</th>
                <th className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th className="px-3 py-2.5 text-right font-semibold">Commission</th>
                <th className="px-3 py-2.5 text-right font-semibold">Net payout</th>
                <th className="px-3 py-2.5 font-semibold">Status</th>
                <th className="px-4 py-2.5 text-right font-semibold sm:px-5">Receipt</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-0 border-t border-solid border-neutral-200">
                    <td colSpan={9} className="px-5 py-4"><div className="h-3 w-3/4 animate-pulse rounded-full bg-neutral-200/80" /></td>
                  </tr>
                ))
              ) : items.length === 0 ? (
                <tr className="border-0 border-t border-solid border-neutral-200">
                  <td colSpan={9} className="px-5 py-8">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Receipt className="h-5 w-5" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-sm font-semibold text-neutral-900">{status || search ? "No invoices match" : "No invoices yet"}</p>
                        <p className="m-0 mt-0.5 text-xs text-neutral-500">{status || search ? "Try another search or clear the filters." : "Invoices appear here once owners or drivers request a payout."}</p>
                      </div>
                      {(status || search) && (
                        <button type="button" onClick={clearFilters} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">Clear filters</button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((inv) => {
                  const isDriver = inv.owner?.role === "DRIVER";
                  const stage = stageOf(inv.status);
                  return (
                    <tr key={inv.id} className="border-0 border-t border-solid border-neutral-200 align-top transition-colors hover:bg-neutral-50/80">
                      <td className="px-4 py-3 sm:px-5">
                        <div className="font-mono text-[13px] font-semibold text-neutral-900">{inv.invoiceNumber || "No number"}</div>
                        <div className="mt-0.5 text-[11px] text-neutral-400">#{inv.id}{inv.receiptNumber ? <> · Receipt <span className="font-mono">{inv.receiptNumber}</span></> : null}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold text-neutral-900">{inv.owner?.name || `Payee #${inv.ownerId}`}</span>
                          <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${isDriver ? "bg-cyan-50 text-cyan-700" : "bg-sky-50 text-sky-700"}`}>{isDriver ? "Driver" : "Owner"}</span>
                        </div>
                        {inv.owner?.email && <div className="max-w-[240px] truncate text-xs text-neutral-400">{inv.owner.email}</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="max-w-[220px] truncate text-neutral-800">{inv.booking?.property?.title || (isDriver ? "Transport trip" : "Not linked")}</div>
                        {inv.booking?.property?.type && <div className="text-xs text-neutral-400">{humanize(inv.booking.property.type)}</div>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3">
                        <div className="tabular-nums text-neutral-800">{eatDate(inv.issuedAt)}</div>
                        <div className="text-xs tabular-nums text-neutral-400">{eatTime(inv.issuedAt)}</div>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-neutral-700">{tzs(Number(inv.total))}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right tabular-nums text-neutral-500">{inv.commissionAmount ? tzs(Number(inv.commissionAmount)) : "None"}</td>
                      <td className="whitespace-nowrap px-3 py-3 text-right font-semibold tabular-nums text-neutral-900">{inv.netPayable != null ? tzs(Number(inv.netPayable)) : "Not set"}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${stage?.pill ?? "bg-neutral-100 text-neutral-600 ring-neutral-200"}`}>
                          {stage ? <stage.icon className="h-3 w-3" /> : null}
                          {stage?.label ?? humanize(inv.status)}
                        </span>
                        {inv.paidAt && <div className="mt-1 text-[11px] tabular-nums text-neutral-500">Paid {eatDate(inv.paidAt)}{inv.paymentMethod ? ` · ${inv.paymentMethod}` : ""}</div>}
                        {!inv.paidAt && inv.approvedByUser?.name && <div className="mt-1 text-[11px] text-neutral-400">Approved by {inv.approvedByUser.name}</div>}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        {inv.receiptNumber ? (
                          <a href={`/api/admin/invoices/${inv.id}/receipt.png`} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:bg-neutral-50 hover:no-underline">
                            <Download className="h-3.5 w-3.5" /> Receipt
                          </a>
                        ) : (
                          <span className="text-xs text-neutral-400">{inv.status === "PAID" ? "Pending" : "After payment"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <span className="text-xs text-neutral-500">
            {total === 0 ? "No invoices" : <>Showing <span className="font-semibold tabular-nums text-neutral-900">{(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)}</span> of <span className="font-semibold tabular-nums text-neutral-900">{total.toLocaleString()}</span></>}
          </span>
          <div className="flex items-center gap-2">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-neutral-400" />}
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums text-neutral-500">Page <span className="font-semibold text-neutral-900">{page}</span> of <span className="font-semibold text-neutral-900">{totalPages}</span></span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages || loading} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <p className="m-0 flex items-center gap-1.5 text-[11px] text-neutral-400">
        <Wallet className="h-3.5 w-3.5" /> Amounts in Tanzanian shillings. Approving and paying invoices happens in Revenue and Payments, not here.
      </p>
    </div>
  );
}
