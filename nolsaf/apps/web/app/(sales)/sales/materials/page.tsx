"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, ExternalLink, FileText, Search } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type Material = {
  id: number;
  title: string;
  description: string | null;
  category: string;
  fileUrl: string | null;
  externalUrl: string | null;
  updatedAt: string;
};

const categories = ["ALL", "PRODUCT_GUIDE", "SALES_SCRIPT", "PRESENTATION", "CASE_STUDY", "POLICY", "TRAINING", "FAQ"] as const;

export default function SalesMaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>([]);
  const [category, setCategory] = useState<(typeof categories)[number]>("ALL");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.get("/api/sales/materials", {
        params: {
          pageSize: 100,
          ...(category !== "ALL" ? { category } : {}),
          ...(search ? { q: search } : {}),
        },
      });
      setMaterials(response.data?.materials || []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load learning materials.");
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <SalesShell>
      <style jsx global>{`#sales-materials-page, #sales-materials-page * { box-sizing: border-box; }`}</style>
      <div id="sales-materials-page">
        <SalesPageHeader
          icon={BookOpen}
          title="Learning and materials"
          description="Current product guides, sales scripts, training resources and programme policies published by NoLSAF."
        />

        <section className="mt-5 border border-slate-200 bg-white p-4 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm" placeholder="Search materials" />
            </div>
            <select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              {categories.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}
            </select>
            <button type="submit" className="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand-50">Search</button>
          </form>
        </section>

        {error ? <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

        <section className="mt-5">
          {loading ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center text-sm text-gray-500">Loading materials...</div>
          ) : materials.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-center">
              <p className="text-sm font-medium text-gray-900">No published materials found</p>
              <p className="mt-1 text-sm text-gray-500">Try another category or check again later.</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {materials.map((item) => {
                const href = item.fileUrl || item.externalUrl!;
                return (
                  <article key={item.id} className="flex min-h-56 flex-col border border-slate-200 bg-white p-5 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)] transition hover:border-emerald-300">
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand"><FileText className="h-5 w-5" /></span>
                      <span className="rounded-full bg-gray-100 px-2 py-1 text-[10px] font-medium text-gray-700">{item.category.replaceAll("_", " ")}</span>
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-gray-900">{item.title}</h2>
                    <p className="mt-2 line-clamp-3 text-sm leading-6 text-gray-600">{item.description || "Open this resource for the latest guidance."}</p>
                    <div className="mt-auto pt-5">
                      <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white no-underline hover:bg-brand-700">
                        Open resource <ExternalLink className="h-4 w-4" />
                      </a>
                      <p className="mt-2 text-[11px] text-gray-400">Updated {new Date(item.updatedAt).toLocaleDateString("en-GB")}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </SalesShell>
  );
}
