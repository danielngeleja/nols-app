"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
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

function money(value: number, currency = "TZS") {
  return `${currency === "TZS" ? "TSh" : currency} ${Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
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
  const pageSize = 25;

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

  return (
    <SalesShell>
      <style jsx global>{`#sales-properties-page, #sales-properties-page * { box-sizing: border-box; }`}</style>
      <div id="sales-properties-page">
        <SalesPageHeader
          icon={Building2}
          title="Attributed properties"
          description="Your verified property portfolio, product coverage and recorded earnings in one accountable view."
        />

        <section className="mt-5 border border-slate-200 bg-white p-4 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setPage(1);
              setSearch(query.trim());
            }}
          >
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search property or location" className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <select value={product} onChange={(event) => { setPage(1); setProduct(event.target.value); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">All products</option>
              <option value="NRMS">NRMS</option>
              <option value="MARKETPLACE">Marketplace</option>
            </select>
            <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as (typeof attributionStatuses)[number]); }} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {attributionStatuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
            <button type="submit" className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand-50">Search</button>
          </form>
        </section>

        {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <section className="mt-5">
          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading properties...</div>
          ) : properties.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
              <p className="text-sm font-medium text-gray-900">No attributed properties found</p>
              <p className="mt-1 text-sm text-gray-500">Verified conversion requests will appear after admin review.</p>
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {properties.map((property) => (
                <Link key={property.id} href={`/sales/properties/${property.id}`} className="border border-slate-200 bg-white p-5 no-underline shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)] transition hover:border-emerald-300 hover:shadow-[0_18px_38px_-30px_rgba(5,90,74,0.55)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-base font-semibold text-gray-900">{property.title}</h2>
                      <p className="mt-1 text-xs text-gray-500">{[property.city, property.district, property.regionName].filter(Boolean).join(", ") || "Location not recorded"}</p>
                    </div>
                    <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-700">{property.type.replaceAll("_", " ")}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {property.salesAttributions.map((attribution) => (
                      <span key={attribution.id} className={`rounded-full px-2.5 py-1 text-xs ${statusTone(attribution.status)}`}>
                        {attribution.productType} · {attribution.status}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-gray-100 pt-4 text-sm">
                    <div>
                      <p className="text-xs text-gray-500">Recorded earnings</p>
                      <p className="mt-1 font-semibold text-gray-900">{money(property.totalEarnings, property.currency)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Rooms</p>
                      <p className="mt-1 font-semibold text-gray-900">{property.totalBedrooms ?? "Not recorded"}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-gray-600">{total.toLocaleString()} properties</span>
          <div className="flex gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Previous</button>
            <button type="button" disabled={page * pageSize >= total} onClick={() => setPage((value) => value + 1)} className="rounded-lg border border-gray-300 px-3 py-1.5 disabled:opacity-40">Next</button>
          </div>
        </div>
      </div>
    </SalesShell>
  );
}
