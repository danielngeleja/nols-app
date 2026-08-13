"use client";

// Group-stay revenue/payout tracking — READ-ONLY, mirroring tour-revenue.
// Source: GET /api/admin/group-stays/revenue/overview.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Users,
  TrendingUp,
  HandCoins,
  Hourglass,
  Wallet,
  ChevronLeft,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  ChevronsUpDown,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

type RevenueStatus =
  | "PENDING"
  | "AWAITING_DEPOSIT"
  | "DEPOSIT_PAID"
  | "CONFIRMED"
  | "COMPLETED"
  | "CANCELED";

type Record_ = {
  id: number;
  groupType: string;
  headcount: number;
  destination: string;
  customerName: string;
  ownerName: string | null;
  propertyTitle: string | null;
  currency: string;
  gmv: number;
  ownerPayout: number;
  nolsafRevenue: number;
  commissionPercent: number;
  depositAmount: number;
  depositPaid: boolean;
  status: RevenueStatus;
  realized: boolean;
  createdAt: string;
};

type Overview = {
  ok: boolean;
  baseCurrency: string;
  summary: {
    total: number;
    realizedCount: number;
    pendingCount: number;
    canceledCount: number;
    gmv: number;
    nolsafRevenue: number;
    ownerPayout: number;
    pendingRevenue: number;
  };
  records: Record_[];
  generatedAt: string;
};

const STATUS_TONE: Record<RevenueStatus, string> = {
  PENDING: "border-slate-200 bg-slate-50 text-slate-700",
  AWAITING_DEPOSIT: "border-amber-200 bg-amber-50 text-amber-700",
  DEPOSIT_PAID: "border-sky-200 bg-sky-50 text-sky-700",
  CONFIRMED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  CANCELED: "border-rose-200 bg-rose-50 text-rose-700",
};

const STATUS_LABEL: Record<RevenueStatus, string> = {
  PENDING: "Pending",
  AWAITING_DEPOSIT: "Awaiting deposit",
  DEPOSIT_PAID: "Deposited",
  // Booking flips to CONFIRMED once the deposit is paid; surface that as "Deposited"
  // (only the deposit is collected by NoLSAF — the balance is paid to the owner at the property).
  CONFIRMED: "Deposited",
  COMPLETED: "Completed",
  CANCELED: "Canceled",
};

export default function GroupStayRevenuePage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiClient.get("/api/admin/group-stays/revenue/overview");
        if (!cancelled) setData(res.data as Overview);
      } catch (e: any) {
        if (!cancelled) setError(e?.response?.data?.error || e?.message || "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = useMemo(() => {
    const cur = data?.baseCurrency || "TZS";
    const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
    return (v: number) => `${cur} ${nf.format(Math.round(v || 0))}`;
  }, [data?.baseCurrency]);

  const loading = data === null && !error;
  const s = data?.summary;

  // ── Sorting + pagination (client-side; API returns up to 1000 rows) ──
  type SortKey = "id" | "ownerName" | "gmv" | "ownerPayout" | "nolsafRevenue" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("nolsafRevenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "ownerName" || key === "status" ? "asc" : "desc");
    }
    setPage(1);
  };

  const sorted = useMemo(() => {
    const rows = [...(data?.records || [])];
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (sortKey === "ownerName" || sortKey === "status") {
        av = (sortKey === "ownerName" ? a.ownerName : a.status) || "";
        bv = (sortKey === "ownerName" ? b.ownerName : b.status) || "";
        return String(av).localeCompare(String(bv)) * dir;
      }
      av = a[sortKey] as number;
      bv = b[sortKey] as number;
      return (av - bv) * dir;
    });
    return rows;
  }, [data?.records, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="mx-auto box-border w-full max-w-full min-w-0 space-y-4 overflow-x-clip px-3 py-4 sm:space-y-6 sm:px-4 sm:py-6 lg:px-6 xl:px-8">
      <div
        className="relative box-border w-full max-w-full overflow-hidden rounded-2xl border border-white/10 shadow-2xl"
        style={{
          background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
          boxShadow: "0 18px 42px -18px rgba(2,102,94,0.42)",
        }}
      >
        <div className="relative z-10 px-5 py-6 sm:px-7 sm:py-8">
          <div className="flex items-center gap-2 text-xs text-white/65">
            <Users className="h-4 w-4" />
            <span>Group stay</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">Group stay revenue</h1>
          <p className="mt-2 text-sm text-white/65 sm:text-base">
            Owner payout and NoLSAF take per group booking. Read only. Rolled into the{" "}
            <Link href="/admin/finance" className="text-white underline-offset-2 hover:underline">
              All Revenue
            </Link>{" "}
            view.
          </p>
        </div>
      </div>

        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            Couldn’t load group stay revenue: {error}
          </div>
        )}

        {/* Summary */}
        <div className="box-border grid w-full max-w-full gap-4 rounded-xl border border-[#02665e]/20 bg-gradient-to-r from-[#02665e]/10 to-emerald-50 p-4 shadow-sm sm:grid-cols-2 sm:p-6 xl:grid-cols-4">
          <SummaryCard label="NoLSAF revenue" sublabel="Realized take" icon={TrendingUp} tone="bg-[#02665e]/20 text-[#02665e]" currency={data?.baseCurrency || "TZS"} value={s ? s.nolsafRevenue : null} loading={loading} />
          <SummaryCard label="GMV" sublabel="Gross value" icon={Wallet} tone="bg-blue-100 text-blue-700" currency={data?.baseCurrency || "TZS"} value={s ? s.gmv : null} loading={loading} />
          <SummaryCard label="Owner payout" sublabel={s ? `${s.realizedCount} realized` : "Owners"} icon={HandCoins} tone="bg-emerald-100 text-emerald-700" currency={data?.baseCurrency || "TZS"} value={s ? s.ownerPayout : null} loading={loading} />
          <SummaryCard label="Pending revenue" sublabel={s ? `${s.pendingCount} in pipeline` : "Pipeline"} icon={Hourglass} tone="bg-amber-100 text-amber-700" currency={data?.baseCurrency || "TZS"} value={s ? s.pendingRevenue : null} loading={loading} />
        </div>

        {/* Records table */}
        <section className="box-border w-full max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-4 py-4 sm:px-5 sm:py-5">
            <div className="text-sm font-semibold text-slate-900">Bookings</div>
            <div className="text-xs text-slate-500">{data ? `${data.records.length} financial records` : "Loading"}</div>
          </div>

          <div className="w-full max-w-full overflow-x-auto overflow-y-visible overscroll-x-contain [scrollbar-gutter:stable]">
            {loading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-12 rounded-xl bg-slate-100 animate-pulse" />
                ))}
              </div>
            ) : data && data.records.length > 0 ? (
              <table className="w-full min-w-[1120px] text-xs">
                <thead>
                  <tr className="whitespace-nowrap border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wide text-slate-600">
                    <SortableTh label="Booking" active={sortKey === "id"} dir={sortDir} onClick={() => toggleSort("id")} />
                    <SortableTh label="Owner" active={sortKey === "ownerName"} dir={sortDir} onClick={() => toggleSort("ownerName")} />
                    <SortableTh label="GMV" align="right" active={sortKey === "gmv"} dir={sortDir} onClick={() => toggleSort("gmv")} />
                    <SortableTh label="Owner payout" align="right" active={sortKey === "ownerPayout"} dir={sortDir} onClick={() => toggleSort("ownerPayout")} />
                    <SortableTh label="NoLSAF take" align="right" active={sortKey === "nolsafRevenue"} dir={sortDir} onClick={() => toggleSort("nolsafRevenue")} />
                    <SortableTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => (
                    <tr key={r.id} className="border-b border-slate-100 transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/admin/group-stays/bookings?id=${r.id}`} className="font-semibold text-slate-900 no-underline hover:underline">
                          #{r.id} · {r.groupType}
                        </Link>
                        <div className="text-[11px] text-slate-500">
                          {r.headcount} pax · {r.destination} · {r.customerName}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {r.ownerName || <span className="text-slate-400">Unassigned</span>}
                        {r.propertyTitle && <div className="text-[11px] text-slate-500">{r.propertyTitle}</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmt(r.gmv)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-700">{fmt(r.ownerPayout)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{fmt(r.nolsafRevenue)}</td>
                      <td className="px-4 py-3">
                        <span className={"inline-flex rounded-lg border px-2 py-0.5 text-[11px] font-semibold " + STATUS_TONE[r.status]}>
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="px-4 py-8 text-sm text-slate-500">No group-stay revenue records yet.</div>
            )}
          </div>

          {!loading && sorted.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-xs text-slate-500">
              <span>
                {(safePage - 1) * pageSize + 1}–{Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  Prev
                </button>
                <span className="px-2 tabular-nums text-slate-600">
                  Page {safePage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="inline-flex items-center gap-1 rounded border border-slate-300 px-2.5 py-1.5 text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          )}
        </section>

        {data && (
          <p className="text-[11px] text-slate-500">
            NoLSAF take = GMV minus owner payout. Realized at deposit. Generated{" "}
            {new Date(data.generatedAt).toLocaleString()}.
          </p>
        )}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
}) {
  return (
    <th className={"px-4 py-3 font-medium " + (align === "right" ? "text-right" : "text-left")}>
      <button
        type="button"
        onClick={onClick}
        className={
          "inline-flex items-center gap-1 bg-transparent border-0 p-0 shadow-none appearance-none cursor-pointer uppercase tracking-wide transition-colors hover:text-slate-900 " +
          (align === "right" ? "flex-row-reverse " : "") +
          (active ? "text-slate-900" : "text-slate-600")
        }
      >
        <span>{label}</span>
        {active ? (
          dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

const SUM_NF = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function SummaryCard({
  className,
  label,
  sublabel,
  icon: Icon,
  tone,
  currency,
  value,
  loading,
}: {
  className?: string;
  label: string;
  sublabel: string;
  icon: any;
  tone: string;
  currency: string;
  value: number | null;
  loading: boolean;
}) {
  return (
    <div className={"flex min-w-0 items-center gap-3 " + (className ?? "")}>
      <div className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-lg " + tone}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs font-medium text-slate-600 sm:text-sm">{label}</div>
        <div className="mt-0.5 flex items-baseline gap-1.5 whitespace-nowrap">
        {loading ? (
          <span className="inline-block h-6 w-24 rounded bg-slate-200 animate-pulse" />
        ) : (
          <>
            <span className="text-xs font-semibold text-slate-500">{currency}</span>
            <span className="text-xl font-bold tabular-nums text-slate-900 sm:text-2xl">
              {value === null ? "0" : SUM_NF.format(Math.round(value))}
            </span>
          </>
        )}
        </div>
        <div className="mt-0.5 truncate text-xs text-slate-500">{sublabel}</div>
      </div>
    </div>
  );
}
