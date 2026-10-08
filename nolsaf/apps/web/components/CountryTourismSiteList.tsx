"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ArrowLeft, TreePine } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import PublicApprovedPropertyCard from "./PublicApprovedPropertyCard";

export type TourismSiteProperty = {
  name: string;
  note?: string;
  href?: string;
  imageSrc?: string;
  imageAlt?: string;
  placement?: "INSIDE" | "NEARBY";
};

export type TourismSite = {
  slug?: string;
  name: string;
  note: string;
  details?: string[];
  imageSrc?: string;
  imageAlt?: string;
  properties?: TourismSiteProperty[];
};

type PublicPropertyCard = {
  id: number;
  slug: string;
  title: string;
  type: string;
  location: string;
  primaryImage: string | null;
  parkPlacement: "INSIDE" | "NEARBY" | null;
  services?: any;
  basePrice: number | null;
  currency: string | null;
};

function slugifyTourismSite(input: string) {
  return String(input || "")
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export default function CountryTourismSiteList({
  title,
  items,
  hideHeader = false,
  defaultOpenFirst = false,
  propertyGrid = "compact",
  basePath,
}: {
  title: string;
  items: TourismSite[];
  hideHeader?: boolean;
  defaultOpenFirst?: boolean;
  propertyGrid?: "compact" | "wide";
  basePath?: string;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const isFocusedSingle = Boolean(basePath) && defaultOpenFirst && items.length === 1;

  const initialOpen = useMemo(() => {
    if (!defaultOpenFirst) return new Set<number>();
    return items.length ? new Set<number>([0]) : new Set<number>();
  }, [defaultOpenFirst, items.length]);
  const [open, setOpen] = useState<Set<number>>(initialOpen);

  useEffect(() => {
    if (!defaultOpenFirst) return;
    if (!items.length) return;
    setOpen((prev) => (prev.size ? prev : new Set<number>([0])));
  }, [defaultOpenFirst, items.length]);

  const [systemCommission, setSystemCommission] = useState<number>(0);
  const [propertiesBySiteSlug, setPropertiesBySiteSlug] = useState<Record<string, PublicPropertyCard[] | undefined>>({});
  const [loadingBySiteSlug, setLoadingBySiteSlug] = useState<Record<string, boolean | undefined>>({});
  const [errorBySiteSlug, setErrorBySiteSlug] = useState<Record<string, string | undefined>>({});
  // Tracks slugs that have been fetched (or are in-flight) so we never loop on empty/error results
  const fetchedSlugs = React.useRef<Set<string>>(new Set());

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/support/system-settings`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (mounted && json?.commissionPercent !== undefined) {
            const commission = Number(json.commissionPercent);
            setSystemCommission(isNaN(commission) ? 0 : commission);
          }
        }
      } catch {
        // Silently fail - will use 0 as default
      }
    };
    load();
    return () => { mounted = false; };
  }, []);

  const ensurePropertiesLoaded = useCallback(async (siteSlug: string) => {
    if (!siteSlug) return;
    // Use a ref-based guard so this never loops on empty/error results.
    // [] is falsy, so a state-based check would re-fetch endlessly on empty results.
    if (fetchedSlugs.current.has(siteSlug)) return;
    fetchedSlugs.current.add(siteSlug);

    setLoadingBySiteSlug((prev) => ({ ...prev, [siteSlug]: true }));
    setErrorBySiteSlug((prev) => ({ ...prev, [siteSlug]: undefined }));

    try {
      const resp = await fetch(
        `/api/public/properties?tourismSiteSlug=${encodeURIComponent(siteSlug)}`,
        { method: "GET", cache: "no-store", credentials: "include", headers: { Accept: "application/json" } }
      );
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = (await resp.json()) as { items?: PublicPropertyCard[] };
      const cards = Array.isArray(data?.items) ? data.items : [];

      setPropertiesBySiteSlug((prev) => ({ ...prev, [siteSlug]: cards }));
    } catch (e: any) {
      console.error("Failed to load park properties", e);
      // Remove from fetched so the user can manually retry
      fetchedSlugs.current.delete(siteSlug);
      const msg = String(e?.message || "");
      const friendly = msg.includes("502") || msg.includes("503") || msg.includes("504")
        ? "Service temporarily unavailable"
        : msg || "Failed to load";
      setErrorBySiteSlug((prev) => ({ ...prev, [siteSlug]: friendly }));
      setPropertiesBySiteSlug((prev) => ({ ...prev, [siteSlug]: [] }));
    } finally {
      setLoadingBySiteSlug((prev) => ({ ...prev, [siteSlug]: false }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Stable — fetchedSlugs ref used for deduplication

  const retryLoad = useCallback((siteSlug: string) => {
    setErrorBySiteSlug((prev) => { const n = { ...prev }; delete n[siteSlug]; return n; });
    setPropertiesBySiteSlug((prev) => { const n = { ...prev }; delete n[siteSlug]; return n; });
    setLoadingBySiteSlug((prev) => ({ ...prev, [siteSlug]: false }));
    void ensurePropertiesLoaded(siteSlug);
  }, [ensurePropertiesLoaded]);

  useEffect(() => {
    if (!defaultOpenFirst) return;
    const first = items[0];
    if (!first) return;
    const siteSlug = first?.slug ? String(first.slug) : slugifyTourismSite(first?.name || "");
    void ensurePropertiesLoaded(siteSlug);
  }, [defaultOpenFirst, ensurePropertiesLoaded, items]);

  const toggle = (index: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      const willOpen = !next.has(index);
      if (!willOpen) next.delete(index);
      else next.add(index);

      if (willOpen) {
        const site = items[index];
        const siteSlug = site?.slug ? String(site.slug) : slugifyTourismSite(site?.name || "");
        void ensurePropertiesLoaded(siteSlug);
      }

      return next;
    });
  };

  return (
    <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      {!hideHeader ? (
        <header className="flex items-center justify-between gap-4 border-0 border-b border-solid border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#012a26] text-[#5eead4]"><TreePine className="h-4 w-4" aria-hidden /></span>
            <h2 className="m-0 text-base font-bold tracking-tight text-slate-900">{title}</h2>
          </div>
          <span className="text-xs font-semibold text-slate-500"><strong className="tabular-nums text-slate-900">{items.length}</strong> park{items.length === 1 ? "" : "s"}</span>
        </header>
      ) : null}

      <ul
        className={[
          "m-0 list-none grid gap-px bg-slate-100 p-0",
          isFocusedSingle ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
        ].join(" ")}
      >
        {items.map((s, i) => {
          const isOpen = isFocusedSingle ? true : open.has(i);

          const siteSlug = s.slug ? String(s.slug) : slugifyTourismSite(s.name);
          const loadedProps = propertiesBySiteSlug[siteSlug];
          const isLoading = !!loadingBySiteSlug[siteSlug];
          const loadError = errorBySiteSlug[siteSlug];
          const allProperties = loadError ? undefined : loadedProps;
          const insideProperties = (allProperties ?? []).filter((p) => p.parkPlacement === "INSIDE");
          const nearbyProperties = (allProperties ?? []).filter((p) => p.parkPlacement === "NEARBY");
          const showCountBadge = (!loadError && loadedProps !== undefined) || isLoading;
          const countLabel = loadedProps !== undefined ? String(loadedProps.length) : "…";

          return (
            <li
              key={siteSlug}
              className={[
                "group bg-white",
                !isFocusedSingle && isOpen ? "sm:col-span-2" : "",
              ].join(" ")}
            >
              {isFocusedSingle ? (
                <div className="bg-[#012a26] px-5 py-5 text-white sm:px-6">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (!basePath) return;
                        const qp = new URLSearchParams(sp?.toString() ?? "");
                        qp.delete("site");
                        const qs = qp.toString();
                        router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
                      }}
                      className="group/back inline-flex h-8 items-center gap-1.5 rounded-md border border-solid border-white/15 bg-transparent px-2.5 text-xs font-semibold text-white/80 transition-colors hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#5eead4]/40"
                      aria-label="Back to all parks"
                    >
                      <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover/back:-translate-x-0.5" aria-hidden />
                      All parks
                    </button>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">
                      <TreePine className="h-3.5 w-3.5" aria-hidden /> National park
                    </span>
                  </div>

                  <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="m-0 text-2xl font-bold leading-tight tracking-tight sm:text-[28px]">{s.name}</h2>
                      <p className="m-0 mt-1 text-sm text-white/65">
                        {s.note
                          ? s.note
                          : isLoading
                            ? "Checking which stays are open to book..."
                            : loadedProps && loadedProps.length > 0
                              ? `${loadedProps.length} approved propert${loadedProps.length === 1 ? "y" : "ies"} you can book for this park.`
                              : "No stays listed for this park yet. New properties are approved regularly."}
                      </p>
                    </div>

                    <dl className="m-0 flex shrink-0 overflow-hidden rounded-lg border border-solid border-white/10">
                      {[
                        { label: "Stays", value: isLoading ? "…" : loadedProps ? loadedProps.length : "-" },
                        { label: "Inside", value: isLoading ? "…" : loadedProps ? insideProperties.length : "-" },
                        { label: "Nearby", value: isLoading ? "…" : loadedProps ? nearbyProperties.length : "-" },
                      ].map((stat, index) => (
                        <div key={stat.label} className={`px-4 py-2 text-center ${index > 0 ? "border-0 border-l border-solid border-white/10" : ""}`}>
                          <dd className="m-0 text-lg font-extrabold tabular-nums text-white">{stat.value}</dd>
                          <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">{stat.label}</dt>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    if (basePath) {
                      const qp = new URLSearchParams(sp?.toString() ?? "");
                      const current = String(qp.get("site") || "").trim();
                      const nextSlug = siteSlug;
                      if (current && current === nextSlug) qp.delete("site");
                      else qp.set("site", nextSlug);

                      const qs = qp.toString();
                      router.push(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
                      return;
                    }
                    toggle(i);
                  }}
                  className={[
                    "flex w-full items-center justify-between gap-3 border-0 px-5 py-3.5 text-left",
                    isOpen ? "bg-emerald-50/60" : "bg-white hover:bg-slate-50",
                    "motion-safe:transition-colors",
                    "focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#02665e]/30",
                  ].join(" ")}
                  aria-expanded={isOpen}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="w-5 shrink-0 text-xs font-bold tabular-nums text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-semibold leading-snug ${isOpen ? "text-[#02665e]" : "text-slate-900"}`}>{s.name.replace(/ National Park$/, "")}</span>
                      <span className="block text-[11px] text-slate-400">National park</span>
                    </span>
                  </div>

                  <div className="shrink-0 flex items-center gap-3">
                    {showCountBadge ? (
                      <div
                        className={[
                          "inline-flex h-6 items-center justify-center rounded-md px-2 text-[11px] font-semibold tabular-nums",
                          loadedProps && loadedProps.length > 0 ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-500",
                        ].join(" ")}
                        aria-label={loadedProps ? `Approved properties: ${countLabel}` : "Loading approved properties"}
                      >
                        {loadedProps !== undefined ? `${countLabel} stay${loadedProps.length === 1 ? "" : "s"}` : countLabel}
                      </div>
                    ) : null}

                    <ChevronDown
                      className={[
                        "h-4 w-4 text-slate-500 transition-transform duration-200",
                        isOpen ? "rotate-180" : "rotate-0",
                      ].join(" ")}
                      aria-hidden
                    />
                  </div>
                </button>
              )}

              {isOpen ? (
                <div className={[
                  "px-4 sm:px-5 pb-6",
                  isFocusedSingle ? "pt-2" : "",
                ].join(" ")}
                >
                  <div className="pt-4">
                    {s.note ? <div className="text-sm text-slate-700 leading-relaxed">{s.note}</div> : null}
                    {Array.isArray(s.details) && s.details.length ? (
                      <div className="mt-3 space-y-2">
                        {s.details.slice(0, 3).map((d) => (
                          <div key={d} className="text-sm text-slate-600 leading-relaxed">
                            <span className="text-emerald-700 font-semibold">•</span> {d}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5">

                    <div className="mt-3">
                      {isLoading ? (
                        <div className="space-y-3 animate-pulse">
                          {[0, 1].map((i) => (
                            <div key={i} className="h-[88px] rounded-lg bg-slate-100" />
                          ))}
                        </div>
                      ) : loadError ? (
                        <div className="flex flex-col items-start gap-2 rounded-lg bg-rose-50 px-4 py-3">
                          <p className="text-sm text-rose-700">{loadError} — unable to load properties.</p>
                          <button
                            type="button"
                            onClick={() => retryLoad(siteSlug)}
                            className="text-xs font-semibold text-emerald-700 hover:underline underline-offset-2 focus:outline-none"
                          >
                            Try again
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {(allProperties ?? []).length ? (
                      <div className="mt-3 max-h-[520px] overflow-auto pr-1">
                        <div className="space-y-4">
                          {insideProperties.length ? (
                            <div>
                              <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Inside the park <span className="rounded bg-slate-100 px-1.5 tabular-nums text-slate-600">{insideProperties.length}</span></p>
                              <div
                                className={[
                                  "mt-2 grid gap-5",
                                  propertyGrid === "wide" ? "grid-cols-2 sm:grid-cols-2 lg:grid-cols-5" : "grid-cols-1 lg:grid-cols-2",
                                ].join(" ")}
                              >
                                {insideProperties.map((p) => (
                                  <PublicApprovedPropertyCard key={p.id ?? p.slug} p={p} systemCommission={systemCommission} />
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {nearbyProperties.length ? (
                            <div>
                              <p className="m-0 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">Nearby <span className="rounded bg-slate-100 px-1.5 tabular-nums text-slate-600">{nearbyProperties.length}</span></p>
                              <div
                                className={[
                                  "mt-2 grid gap-5",
                                  propertyGrid === "wide" ? "grid-cols-2 sm:grid-cols-2 lg:grid-cols-5" : "grid-cols-1 lg:grid-cols-2",
                                ].join(" ")}
                              >
                                {nearbyProperties.map((p) => (
                                  <PublicApprovedPropertyCard key={p.id ?? p.slug} p={p} systemCommission={systemCommission} />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : !isLoading && !loadError && loadedProps !== undefined ? (
                      <div className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-5 py-8 text-center">
                        <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[#012a26] text-[#5eead4]">
                          <TreePine className="h-5 w-5" aria-hidden />
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-slate-700">No properties listed yet</p>
                          <p className="mt-1 text-xs text-slate-500 max-w-[22rem] mx-auto leading-relaxed">
                            We are adding stays for this park. Check back soon, new properties are approved regularly.
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
