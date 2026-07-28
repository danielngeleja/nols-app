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

function categoryLabel(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(" ");
}

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
      <div id="sales-materials-page">
        <SalesPageHeader
          icon={BookOpen}
          title="Learning and materials"
          description="Current product guides, sales scripts, training resources and programme policies published by NoLSAF."
        />

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_14px_35px_-32px_rgba(15,23,42,0.45)]">
          <form
            className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_220px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              setSearch(query.trim());
            }}
          >
            <label className="relative min-w-0">
              <span className="sr-only">Search materials</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50/50 py-2 pl-10 pr-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100"
                placeholder="Search titles, topics or guidance"
              />
            </label>
            <label>
              <span className="sr-only">Material category</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              >
                {categories.map((item) => (
                  <option key={item} value={item}>
                    {item === "ALL" ? "All categories" : categoryLabel(item)}
                  </option>
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

        <section className="mt-5" aria-label="Published learning materials">
          {!loading ? (
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="m-0 text-sm font-black text-slate-900">Published resources</h2>
                <p className="mb-0 mt-1 text-[11px] text-slate-400">
                  {materials.length} resource{materials.length === 1 ? "" : "s"}
                  {category !== "ALL" ? ` in ${categoryLabel(category)}` : ""}
                </p>
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" role="status" aria-label="Loading learning materials">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start justify-between">
                    <span className="h-10 w-10 rounded-xl bg-slate-100" />
                    <span className="h-6 w-24 rounded-full bg-slate-100" />
                  </div>
                  <span className="mt-5 block h-5 w-3/4 rounded bg-slate-200" />
                  <span className="mt-3 block h-3 w-full rounded bg-slate-100" />
                  <span className="mt-2 block h-3 w-2/3 rounded bg-slate-100" />
                  <span className="mt-8 block h-9 w-28 rounded-lg bg-slate-100" />
                </div>
              ))}
            </div>
          ) : materials.length === 0 ? (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-50 text-emerald-700">
                  <BookOpen className="h-6 w-6" />
                </span>
                <p className="mb-0 mt-4 text-sm font-black text-slate-800">No matching resources</p>
                <p className="mb-0 mt-1 text-xs text-slate-500">Try another search or material category.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {materials.map((item) => {
                const href = item.fileUrl || item.externalUrl;
                return (
                  <article
                    key={item.id}
                    className="group flex min-h-60 flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.5)] transition hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-[0_20px_42px_-32px_rgba(8,127,104,0.35)]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                        <FileText className="h-5 w-5" />
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-600">
                        {categoryLabel(item.category)}
                      </span>
                    </div>
                    <h3 className="mb-0 mt-4 line-clamp-2 text-base font-black leading-6 text-slate-900">{item.title}</h3>
                    <p className="mb-0 mt-2 line-clamp-3 text-sm leading-6 text-slate-600">
                      {item.description || "Open this resource for the latest published guidance."}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                      <p className="m-0 text-[10px] font-medium text-slate-400">
                        Updated {new Date(item.updatedAt).toLocaleDateString("en-GB")}
                      </p>
                      {href ? (
                        <a
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-9 items-center gap-2 rounded-lg bg-[#073c35] px-3 text-xs font-bold text-white no-underline transition hover:bg-emerald-800 hover:no-underline"
                        >
                          Open
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <span className="rounded-lg bg-slate-100 px-3 py-2 text-[10px] font-bold text-slate-400">Unavailable</span>
                      )}
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
