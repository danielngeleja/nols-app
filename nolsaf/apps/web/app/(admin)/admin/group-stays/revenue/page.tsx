"use client";

// Group-stay revenue/payout tracking. READ-ONLY, mirroring tour-revenue.
// Source: GET /api/admin/group-stays/revenue/overview.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TrendingUp, HandCoins, Hourglass, Wallet, ArrowUp, ArrowDown, ChevronsUpDown, Search, X, AlertCircle, Coins, ExternalLink } from "lucide-react";
import apiClient from "@/lib/apiClient";
import TablePagination from "@/components/TablePagination";

type RevenueStatus = "PENDING" | "AWAITING_DEPOSIT" | "DEPOSIT_PAID" | "CONFIRMED" | "COMPLETED" | "CANCELED";

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

// Booking flips to CONFIRMED once the deposit is paid; surface that as "Deposited"
// (only the deposit is collected by NoLSAF, the balance is paid to the owner at the property).
// Awaiting deposit is green and deposited is blue, matching the Assignments page.
const STATUS_META: Record<RevenueStatus, { label: string; text: string; dot: string }> = {
  PENDING: { label: "Pending", text: "text-neutral-600", dot: "bg-neutral-400" },
  AWAITING_DEPOSIT: { label: "Awaiting deposit", text: "text-green-700", dot: "bg-green-600" },
  DEPOSIT_PAID: { label: "Deposited", text: "text-blue-700", dot: "bg-blue-600" },
  CONFIRMED: { label: "Deposited", text: "text-blue-700", dot: "bg-blue-600" },
  COMPLETED: { label: "Completed", text: "text-neutral-700", dot: "bg-neutral-500" },
  CANCELED: { label: "Canceled", text: "text-rose-600", dot: "bg-rose-500" },
};

// Filter chips group the two "deposited" statuses together.
const FILTERS: Array<{ key: string; label: string; match: (s: RevenueStatus) => boolean }> = [
  { key: "all", label: "All", match: () => true },
  { key: "awaiting", label: "Awaiting deposit", match: (s) => s === "AWAITING_DEPOSIT" },
  { key: "deposited", label: "Deposited", match: (s) => s === "DEPOSIT_PAID" || s === "CONFIRMED" },
  { key: "completed", label: "Completed", match: (s) => s === "COMPLETED" },
  { key: "pending", label: "Pending", match: (s) => s === "PENDING" },
  { key: "canceled", label: "Canceled", match: (s) => s === "CANCELED" },
];

function humanizeLabel(value: string | null | undefined) {
  const text = String(value || "").replace(/[_-]+/g, " ").trim().toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
}

function tidyName(value: string | null | undefined) {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

// "LONGIDO, arusha" -> "Longido, Arusha"; "ILALA CBD, dar-es-salaam" -> "Ilala CBD, Dar es Salaam".
function formatPlace(value: string | null | undefined) {
  return String(value || "")
    .split(",")
    .map((part) =>
      part
        .split(/[-_\s]+/)
        .filter(Boolean)
        .map((word, i) => {
          if (i > 0 && ["es", "la", "wa", "na", "ya"].includes(word.toLowerCase())) return word.toLowerCase();
          if (["CBD", "UDSM", "JNIA", "KIA"].includes(word.toUpperCase())) return word.toUpperCase();
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        })
        .join(" "),
    )
    .filter(Boolean)
    .join(", ");
}

const gsRef = (id: number) => `GS-${String(id).padStart(4, "0")}`;

const NF = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

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

  const currency = data?.baseCurrency || "TZS";
  const money = (v: number | null | undefined) => `${currency} ${NF.format(Math.round(v || 0))}`;

  const loading = data === null && !error;
  const s = data?.summary;

  // Sorting, filtering and pagination (client-side; API returns up to 1000 rows)
  type SortKey = "id" | "ownerName" | "gmv" | "ownerPayout" | "nolsafRevenue" | "status";
  const [sortKey, setSortKey] = useState<SortKey>("nolsafRevenue");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
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

  const filterCounts = useMemo(() => {
    const out: Record<string, number> = {};
    FILTERS.forEach((f) => {
      out[f.key] = (data?.records || []).filter((r) => f.match(r.status)).length;
    });
    return out;
  }, [data?.records]);

  const sorted = useMemo(() => {
    const active = FILTERS.find((f) => f.key === filter) || FILTERS[0];
    const needle = q.trim().toLowerCase();
    const rows = (data?.records || []).filter((r) => {
      if (!active.match(r.status)) return false;
      if (!needle) return true;
      return [gsRef(r.id), String(r.id), r.customerName, r.ownerName, r.propertyTitle, r.destination, r.groupType]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle));
    });
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "ownerName" || sortKey === "status") {
        const av = (sortKey === "ownerName" ? a.ownerName : a.status) || "";
        const bv = (sortKey === "ownerName" ? b.ownerName : b.status) || "";
        return String(av).localeCompare(String(bv)) * dir;
      }
      return ((a[sortKey] as number) - (b[sortKey] as number)) * dir;
    });
    return rows;
  }, [data?.records, sortKey, sortDir, filter, q]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paged = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <div className="space-y-6 w-full min-w-0">
      {/* Header */}
      <div className="flex w-full min-w-0 flex-col gap-3 rounded-xl border border-solid border-neutral-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-100 sm:h-12 sm:w-12">
            <Coins className="h-5 w-5 sm:h-6 sm:w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-base font-bold tracking-tight text-neutral-900 sm:text-xl">Group stay revenue</h1>
            <p className="m-0 mt-0.5 text-xs text-neutral-500 sm:text-sm">Owner payout and NoLSAF take per group booking. Read only.</p>
          </div>
        </div>
        <Link
          href="/admin/finance"
          className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 self-start rounded-lg border border-solid border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 no-underline transition-colors hover:border-neutral-300 hover:bg-neutral-50 hover:no-underline sm:self-auto"
        >
          <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
          All revenue
        </Link>
      </div>

      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-solid border-rose-200 bg-rose-50/60 px-4 py-3 sm:px-5">
          <AlertCircle className="h-5 w-5 flex-shrink-0 text-rose-600" />
          <p className="m-0 text-sm text-rose-800">Could not load group stay revenue: {error}</p>
        </div>
      )}

      {/* Summary strip */}
      {(() => {
        const tiles = [
          { icon: TrendingUp, tone: "bg-emerald-50 text-emerald-700", label: "NoLSAF revenue", value: s?.nolsafRevenue, sub: s ? `Realized from ${s.realizedCount} ${s.realizedCount === 1 ? "booking" : "bookings"}` : "Realized take" },
          { icon: Hourglass, tone: "bg-green-50 text-green-700", label: "Pending revenue", value: s?.pendingRevenue, sub: s ? `${s.pendingCount} in pipeline` : "Pipeline" },
          { icon: Wallet, tone: "bg-blue-50 text-blue-700", label: "GMV", value: s?.gmv, sub: "Gross booking value, realized" },
          { icon: HandCoins, tone: "bg-violet-50 text-violet-700", label: "Owner payout", value: s?.ownerPayout, sub: s?.canceledCount ? `${s.canceledCount} canceled excluded` : "Owed to owners" },
        ];
        return (
          <div className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
            <div className="grid grid-cols-1 gap-px bg-neutral-100 sm:grid-cols-2 xl:grid-cols-4">
              {tiles.map((tile) => {
                const Icon = tile.icon;
                return (
                  <div key={tile.label} className="flex min-w-0 items-center gap-3 bg-white px-4 py-3.5 sm:px-5">
                    <span className={`inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tile.tone}`}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-medium text-neutral-500">{tile.label}</p>
                      {loading ? (
                        <span className="mt-1 inline-block h-6 w-28 animate-pulse rounded bg-neutral-100" />
                      ) : (
                        <p className="m-0 flex items-baseline gap-1 whitespace-nowrap leading-tight">
                          <span className="text-[11px] font-semibold text-neutral-400">{currency}</span>
                          <span className="text-xl font-bold tabular-nums text-neutral-900">{NF.format(Math.round(tile.value || 0))}</span>
                        </p>
                      )}
                      <p className="m-0 mt-0.5 truncate text-[11px] text-neutral-400" title={tile.sub}>{tile.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Revenue pipeline: how much NoLSAF take is already in hand vs still waiting on deposits */}
      {s && s.total > 0 && (() => {
        const earned = s.nolsafRevenue || 0;
        const waiting = s.pendingRevenue || 0;
        const sum = earned + waiting;
        const earnedPct = sum > 0 ? Math.round((earned / sum) * 100) : 0;
        const counts = [
          { label: "Realized", n: s.realizedCount, dot: "bg-blue-600" },
          { label: "In pipeline", n: s.pendingCount, dot: "bg-green-600" },
          { label: "Canceled", n: s.canceledCount, dot: "bg-rose-500" },
        ];
        return (
          <div className="rounded-xl border border-solid border-neutral-200 bg-white px-4 py-3.5 sm:px-5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <h3 className="m-0 text-sm font-bold text-neutral-900">NoLSAF take</h3>
              <span className="text-xs text-neutral-400">{earnedPct}% collected</span>
              <span className="ml-auto text-xs tabular-nums text-neutral-500">
                <span className="font-semibold text-neutral-900">{money(sum)}</span> expected in total
              </span>
            </div>
            <div className="mt-2.5 flex h-2 w-full overflow-hidden rounded-full bg-neutral-100">
              {earned > 0 && <div className="h-full bg-blue-600" style={{ width: `${Math.max(earnedPct, 2)}%` }} title={`Collected ${money(earned)}`} />}
              {waiting > 0 && <div className="h-full bg-green-500" style={{ width: `${Math.max(100 - earnedPct, 2)}%` }} title={`Waiting ${money(waiting)}`} />}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-500">
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-blue-600" /> Collected {money(earned)}</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-1 w-3 rounded-full bg-green-500" /> Waiting on deposit {money(waiting)}</span>
              <span className="ml-auto inline-flex flex-wrap items-center gap-x-3">
                {counts.map((c) => (
                  <span key={c.label} className="inline-flex items-center gap-1.5">
                    <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
                    {c.label} <span className="tabular-nums text-neutral-900">{c.n}</span>
                  </span>
                ))}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Bookings */}
      <section className="overflow-hidden rounded-xl border border-solid border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 sm:px-5">
          <h3 className="m-0 text-sm font-bold text-neutral-900">Bookings</h3>
          <span className="text-xs tabular-nums text-neutral-400">
            {data ? `${sorted.length} of ${data.records.length} financial records` : "Loading…"}
          </span>
          <div className="relative ml-auto w-full min-w-0 sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="text"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Search booking, customer or owner"
              className="h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-9 pr-9 text-sm text-neutral-800 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            />
            {q && (
              <button
                type="button"
                onClick={() => setQ("")}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 sm:px-5">
          {FILTERS.map((f) => {
            const active = filter === f.key;
            const n = filterCounts[f.key] ?? 0;
            if (f.key !== "all" && n === 0) return null;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => {
                  setFilter(f.key);
                  setPage(1);
                }}
                aria-pressed={active}
                className={`inline-flex h-8 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-medium transition-colors ${
                  active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                {f.label}
                <span className={`tabular-nums ${active ? "text-white/70" : "text-neutral-400"}`}>{n}</span>
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="space-y-2 border-0 border-t border-solid border-neutral-100 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 animate-pulse rounded-lg bg-neutral-100" />
            ))}
          </div>
        ) : sorted.length === 0 ? (
          <div className="border-0 border-t border-solid border-neutral-100 px-6 py-14 text-center">
            <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-neutral-100 text-neutral-400">
              <Coins className="h-5 w-5" />
            </span>
            <p className="m-0 mt-3 text-sm font-semibold text-neutral-800">No revenue records</p>
            <p className="m-0 mt-1 text-xs text-neutral-500">
              {q || filter !== "all" ? "Try another filter or search." : "Group stay bookings with pricing will appear here."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table w-full min-w-[1120px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-neutral-50 text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">
                    <SortableTh label="Booking" active={sortKey === "id"} dir={sortDir} onClick={() => toggleSort("id")} first />
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold">Customer</th>
                    <SortableTh label="Owner" active={sortKey === "ownerName"} dir={sortDir} onClick={() => toggleSort("ownerName")} />
                    <SortableTh label="GMV" align="right" active={sortKey === "gmv"} dir={sortDir} onClick={() => toggleSort("gmv")} />
                    <SortableTh label="Owner payout" align="right" active={sortKey === "ownerPayout"} dir={sortDir} onClick={() => toggleSort("ownerPayout")} />
                    <SortableTh label={<><span className="normal-case">NoLSAF</span> take</>} align="right" active={sortKey === "nolsafRevenue"} dir={sortDir} onClick={() => toggleSort("nolsafRevenue")} />
                    <th className="border-0 border-y border-solid border-neutral-100 px-4 py-2.5 text-right font-bold">Deposit</th>
                    <SortableTh label="Status" active={sortKey === "status"} dir={sortDir} onClick={() => toggleSort("status")} last />
                  </tr>
                </thead>
                <tbody>
                  {paged.map((r) => {
                    const meta = STATUS_META[r.status] || STATUS_META.PENDING;
                    const canceled = r.status === "CANCELED";
                    return (
                      <tr key={r.id} className={`border-0 border-b border-solid border-neutral-100 transition-colors last:border-b-0 hover:bg-neutral-50/70 ${canceled ? "text-neutral-400" : ""}`}>
                        <td className="px-4 py-3.5 sm:pl-5">
                          <Link
                            href={`/admin/group-stays/bookings?bookingId=${r.id}`}
                            className="group inline-flex items-center gap-1 rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-700 no-underline hover:bg-neutral-200 hover:no-underline"
                          >
                            {gsRef(r.id)}
                            <ExternalLink className="h-3 w-3 text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100" />
                          </Link>
                          <div className="mt-0.5 whitespace-nowrap text-xs text-neutral-400">
                            {humanizeLabel(r.groupType)} · {r.headcount} {r.headcount === 1 ? "guest" : "guests"}
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className={`max-w-[12rem] truncate ${canceled ? "" : "text-neutral-800"}`}>{tidyName(r.customerName) || "Unknown"}</div>
                          <div className="mt-0.5 max-w-[12rem] truncate text-xs text-neutral-400" title={formatPlace(r.destination)}>{formatPlace(r.destination) || " "}</div>
                        </td>
                        <td className="px-4 py-3.5">
                          {r.ownerName ? (
                            <>
                              <div className={`max-w-[12rem] truncate ${canceled ? "" : "text-neutral-800"}`}>{tidyName(r.ownerName)}</div>
                              <div className="mt-0.5 max-w-[12rem] truncate text-xs text-neutral-400">{r.propertyTitle ? tidyName(r.propertyTitle) : "No property yet"}</div>
                            </>
                          ) : (
                            <span className="text-neutral-400">Unassigned</span>
                          )}
                        </td>
                        <td className={`whitespace-nowrap px-4 py-3.5 text-right tabular-nums ${canceled ? "" : "text-neutral-800"}`}>{money(r.gmv)}</td>
                        <td className={`whitespace-nowrap px-4 py-3.5 text-right tabular-nums ${canceled ? "" : "text-neutral-800"}`}>{money(r.ownerPayout)}</td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right">
                          <div className={`tabular-nums ${canceled ? "line-through" : r.realized ? "font-semibold text-emerald-700" : "font-semibold text-neutral-900"}`}>{money(r.nolsafRevenue)}</div>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {r.commissionPercent ? `${r.commissionPercent}% commission` : "No commission set"}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 text-right">
                          <div className={`tabular-nums ${canceled ? "" : "text-neutral-800"}`}>{r.depositAmount ? money(r.depositAmount) : <span className="text-neutral-400">None</span>}</div>
                          <div className={`mt-0.5 text-xs ${r.depositPaid ? "text-blue-700" : "text-neutral-400"}`}>{r.depositPaid ? "Paid" : "Not paid"}</div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3.5 sm:pr-5">
                          <span className={`inline-flex items-center gap-1.5 ${meta.text}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </span>
                          <div className="mt-0.5 text-xs text-neutral-400">
                            {new Date(r.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <TablePagination page={safePage} pageSize={pageSize} total={sorted.length} onPageChange={setPage} />
          </>
        )}
      </section>

      {data && (
        <p className="m-0 text-[11px] text-neutral-400">
          NoLSAF take is GMV minus owner payout, realized when the deposit is paid. Generated {new Date(data.generatedAt).toLocaleString("en-GB")}.
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
  first,
  last,
}: {
  label: React.ReactNode;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  align?: "left" | "right";
  first?: boolean;
  last?: boolean;
}) {
  return (
    <th
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`border-0 border-y border-solid border-neutral-100 px-4 py-2.5 font-bold ${align === "right" ? "text-right" : "text-left"} ${first ? "sm:pl-5" : ""} ${last ? "sm:pr-5" : ""}`}
    >
      <button
        type="button"
        onClick={onClick}
        className={`inline-flex cursor-pointer appearance-none items-center gap-1 border-0 bg-transparent p-0 text-[11px] font-bold uppercase tracking-[0.1em] shadow-none transition-colors hover:text-neutral-900 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-neutral-900" : "text-neutral-500"}`}
      >
        <span>{label}</span>
        {active ? dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : <ChevronsUpDown className="h-3 w-3 opacity-40" />}
      </button>
    </th>
  );
}
