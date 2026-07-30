"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  BedDouble,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  ListFilter,
  MapPin,
  RotateCcw,
  Search,
  WalletCards,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Attribution = {
  id: number;
  productType: string;
  status: string;
  attributedAt: string;
  commissionStartsAt: string | null;
  commissionEndsAt: string | null;
};

type PropertyRow = {
  id: number;
  title: string;
  status: string;
  type: string;
  city: string | null;
  district: string | null;
  regionName: string | null;
  totalBedrooms: number | null;
  nrmsActivatedAt: string | null;
  salesAttributions: Attribution[];
  totalEarnings: number;
  currency: string;
};

const attributionStatuses = ["ALL", "VERIFIED", "ACTIVE", "DISPUTED", "EXPIRED", "REVOKED"] as const;
const pageSize = 25;

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

export default function SalesPropertiesPage() {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [product, setProduct] = useState("");
  const [status, setStatus] = useState<(typeof attributionStatuses)[number]>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/sales/properties", {
        params: {
          page,
          pageSize,
          ...(search ? { q: search } : {}),
          ...(product ? { product } : {}),
          ...(status !== "ALL" ? { status } : {}),
        },
      });
      setProperties(response.data?.properties || []);
      setTotal(Number(response.data?.total || 0));
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load attributed properties.");
    } finally {
      setLoading(false);
    }
  }, [page, product, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const hasFilters = Boolean(search || product || status !== "ALL");
  const activeFilterCount = [search, product, status !== "ALL" ? status : ""].filter(Boolean).length;

  const clearFilters = () => {
    setQuery("");
    setSearch("");
    setProduct("");
    setStatus("ALL");
    setPage(1);
  };

  return (
    <SalesShell>
      <div id="sales-properties-page">
        <SalesPageHeader
          icon={Building2}
          title="Attributed properties"
          description="Your verified property portfolio, product coverage and recorded earnings in one accountable view."
        />

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)]" aria-label="Property filters">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <ListFilter className="h-4 w-4" />
              </span>
              <div>
                <h2 className="m-0 text-xs font-black text-slate-800">Find a property</h2>
                <p className="m-0 mt-0.5 text-[10px] text-slate-400">
                  Search and narrow your verified portfolio
                  {activeFilterCount ? ` · ${activeFilterCount} active filter${activeFilterCount === 1 ? "" : "s"}` : ""}
                </p>
              </div>
            </div>
            {hasFilters ? (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset filters
              </button>
            ) : null}
          </div>
          <form
            className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(query.trim());
            }}
          >
            <label className="relative min-w-0">
              <span className="sr-only">Search properties</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search property, city or region"
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <label>
              <span className="sr-only">Product</span>
              <select
                value={product}
                onChange={(event) => { setPage(1); setProduct(event.target.value); }}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              >
                <option value="">All products</option>
                <option value="NRMS">NRMS</option>
                <option value="MARKETPLACE">Marketplace</option>
              </select>
            </label>
            <label>
              <span className="sr-only">Attribution status</span>
              <select
                value={status}
                onChange={(event) => { setPage(1); setStatus(event.target.value as (typeof attributionStatuses)[number]); }}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              >
                {attributionStatuses.map((item) => (
                  <option key={item} value={item}>{item === "ALL" ? "All statuses" : formatLabel(item)}</option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#073c35] px-5 text-sm font-bold text-white transition hover:bg-emerald-800"
            >
              <Search className="h-4 w-4" />
              Search
            </button>
          </form>
        </section>

        {error ? (
          <p className="mb-0 mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_40px_-34px_rgba(15,23,42,0.5)]" aria-label="Attributed property portfolio">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="m-0 text-sm font-black text-slate-900">Property portfolio</h2>
              <p className="mb-0 mt-1 text-[11px] text-slate-400">
                {loading ? "Loading verified attributions" : `${total.toLocaleString()} propert${total === 1 ? "y" : "ies"}`}
              </p>
            </div>
            {!loading && total > 0 ? (
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                Page {page} of {totalPages}
              </span>
            ) : null}
          </div>

          {loading ? (
            <>
              <div className="space-y-3 bg-slate-50/60 p-3 md:hidden" role="status" aria-label="Loading attributed properties">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <span className="block h-4 w-3/4 rounded bg-slate-200" />
                        <span className="block h-3 w-1/2 rounded bg-slate-100" />
                      </div>
                      <span className="h-6 w-16 rounded-full bg-slate-100" />
                    </div>
                    <div className="mt-4 flex gap-2">
                      <span className="h-7 w-24 rounded-lg bg-slate-100" />
                      <span className="h-7 w-28 rounded-lg bg-slate-100" />
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-3">
                      <span className="h-11 rounded-xl bg-slate-100" />
                      <span className="h-11 rounded-xl bg-slate-100" />
                    </div>
                    <span className="mt-4 block h-11 rounded-xl bg-slate-100" />
                  </div>
                ))}
              </div>
              <div className="hidden divide-y divide-slate-100 md:block" role="status" aria-label="Loading attributed properties table">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="grid animate-pulse grid-cols-[minmax(190px,1.4fr)_120px_minmax(190px,1fr)_80px_130px_40px] gap-4 px-5 py-4">
                    <span className="h-4 rounded bg-slate-200" />
                    <span className="h-4 rounded bg-slate-100" />
                    <span className="h-4 rounded bg-slate-100" />
                    <span className="h-4 rounded bg-slate-100" />
                    <span className="h-4 rounded bg-slate-200" />
                    <span className="h-8 w-8 rounded-lg bg-slate-100" />
                  </div>
                ))}
              </div>
            </>
          ) : properties.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <Building2 className="h-6 w-6" />
                </span>
                <p className="mb-0 mt-4 text-sm font-black text-slate-800">
                  {hasFilters ? "No properties match these filters" : "No attributed properties yet"}
                </p>
                <p className="mx-auto mb-0 mt-1 max-w-md text-xs leading-5 text-slate-500">
                  {hasFilters
                    ? "Try a broader search or reset the filters to see your full verified portfolio."
                    : "Properties appear here after a conversion has been reviewed and attributed by an administrator."}
                </p>
                {hasFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 text-xs font-bold text-emerald-800 transition hover:bg-emerald-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Show all properties
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-3 bg-slate-50/60 p-3 md:hidden">
                {properties.map((property) => {
                  const location = [property.city, property.district, property.regionName].filter(Boolean).join(", ") || "Location not recorded";
                  return (
                    <article
                      key={property.id}
                      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_16px_36px_-30px_rgba(15,23,42,0.45)]"
                    >
                      <div className="h-1 bg-emerald-600" aria-hidden />
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <h3 className="m-0 truncate text-sm font-black text-slate-950">{property.title}</h3>
                            <p className="mb-0 mt-1 flex min-w-0 items-center gap-1.5 text-[10px] text-slate-400">
                              <MapPin className="h-3 w-3 shrink-0" />
                              <span className="truncate">{location}</span>
                            </p>
                          </div>
                          <span className="shrink-0 rounded-lg bg-slate-100 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-slate-600">
                            {formatLabel(property.type)}
                          </span>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {property.salesAttributions.map((attribution) => (
                            <span
                              key={attribution.id}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white px-2 py-1 shadow-sm"
                            >
                              <span className="text-[9px] font-black text-slate-700">{formatLabel(attribution.productType)}</span>
                              <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase ${statusTone(attribution.status)}`}>
                                {formatLabel(attribution.status)}
                              </span>
                            </span>
                          ))}
                        </div>

                        <dl className="mb-0 mt-4 grid grid-cols-2 gap-2">
                          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
                            <dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                              <BedDouble className="h-3 w-3" />
                              Rooms
                            </dt>
                            <dd className="m-0 mt-1 text-xs font-black text-slate-800">{property.totalBedrooms ?? "—"}</dd>
                          </div>
                          <div className="rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-100">
                            <dt className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                              <WalletCards className="h-3 w-3" />
                              Earnings
                            </dt>
                            <dd className="m-0 mt-1 break-words text-[11px] font-black leading-4 text-emerald-900">
                              {money(property.totalEarnings, property.currency)}
                            </dd>
                          </div>
                        </dl>

                        <Link
                          href={`/sales/properties/${property.id}`}
                          className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#073c35] px-4 text-xs font-black text-white no-underline shadow-[0_12px_24px_-18px_rgba(7,60,53,0.9)] transition hover:bg-emerald-800 hover:text-white hover:no-underline"
                        >
                          View property
                          <Eye className="h-4 w-4" />
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] border-collapse text-left">
                <thead className="bg-slate-50/80">
                  <tr className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                    <th className="px-5 py-3">Property</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Attribution</th>
                    <th className="px-4 py-3 text-center">Rooms</th>
                    <th className="px-4 py-3 text-right">Recorded earnings</th>
                    <th className="w-16 px-4 py-3 text-center">View</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {properties.map((property) => {
                    const location = [property.city, property.district, property.regionName].filter(Boolean).join(", ") || "Location not recorded";
                    return (
                      <tr key={property.id} className="group text-sm transition hover:bg-emerald-50/30">
                        <td className="px-5 py-4">
                          <Link
                            href={`/sales/properties/${property.id}`}
                            className="block max-w-xs truncate font-bold text-slate-900 no-underline transition hover:text-emerald-800 hover:no-underline"
                          >
                            {property.title}
                          </Link>
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
                            <MapPin className="h-3 w-3" />
                            <span className="max-w-xs truncate">{location}</span>
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                            {formatLabel(property.type)}
                          </span>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {property.salesAttributions.map((attribution) => (
                              <span key={attribution.id} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-100 bg-white px-2 py-1 shadow-sm">
                                <span className="text-[10px] font-black text-slate-700">{attribution.productType}</span>
                                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${statusTone(attribution.status)}`}>
                                  {formatLabel(attribution.status)}
                                </span>
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700">
                            <BedDouble className="h-3.5 w-3.5 text-slate-400" />
                            {property.totalBedrooms ?? "—"}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-right">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-black text-slate-900">
                            <WalletCards className="h-3.5 w-3.5 text-emerald-600" />
                            {money(property.totalEarnings, property.currency)}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <Link
                            href={`/sales/properties/${property.id}`}
                            aria-label={`View ${property.title}`}
                            className="inline-grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-500 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 hover:no-underline"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}

          {!loading && properties.length > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
              <p className="m-0 text-[11px] text-slate-500">
                Showing {(page - 1) * pageSize + 1}&ndash;{Math.min(page * pageSize, total)} of {total.toLocaleString()}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-800 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="min-w-14 text-center text-xs font-bold text-slate-600">{page} / {totalPages}</span>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-emerald-300 hover:text-emerald-800 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </SalesShell>
  );
}
