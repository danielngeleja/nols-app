"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

type SiteOption = {
  value: string;
  label: string;
};

export default function CountryFiltersRow(props: {
  basePath: string;
  hasZones: boolean;
  zones: string[];
  sites: SiteOption[];
  zone: string;
  category: "all" | "major" | "minor";
  site: string;
  /** Parks per zone, for the counts on the zone tabs. */
  zoneCounts?: Record<string, number>;
}) {
  const router = useRouter();

  const selectedSiteLabel = props.site
    ? props.sites.find((s) => s.value === props.site)?.label ?? props.site
    : "";

  const hasAnyFilter = Boolean(props.zone || props.site || props.category !== "all");
  const showGlobalClear = hasAnyFilter && !props.site;

  const navigate = useCallback(
    (next: { zone?: string; category?: "all" | "major" | "minor"; site?: string }) => {
      const params = new URLSearchParams();

      const zone = typeof next.zone === "string" ? next.zone : props.zone;
      const category = typeof next.category === "string" ? next.category : props.category;
      const site = typeof next.site === "string" ? next.site : props.site;

      if (props.hasZones) {
        if (zone) params.set("zone", zone);
      } else {
        if (category && category !== "all") params.set("category", category);
      }

      if (site) params.set("site", site);

      const qs = params.toString();
      router.push(qs ? `${props.basePath}?${qs}` : props.basePath, { scroll: false });
    },
    [router, props.basePath, props.category, props.hasZones, props.site, props.zone],
  );

  const selectClass =
    "h-10 w-full min-w-0 cursor-pointer rounded-lg border border-solid border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 outline-none transition hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
  const total = props.zoneCounts ? Object.values(props.zoneCounts).reduce((a, b) => a + b, 0) : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      {props.hasZones ? (
        <div className="-mx-1 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Zones">
          {[{ value: "", label: "All zones", count: total }, ...props.zones.map((z) => ({ value: z, label: z.replace(/ Zone$/, ""), count: props.zoneCounts?.[z] ?? null }))].map((tab) => {
            const active = props.zone === tab.value;
            return (
              <button
                key={tab.value || "all"}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => navigate({ zone: tab.value, site: "" })}
                className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-solid px-3 text-[13px] font-semibold transition ${active ? "border-[#012a26] bg-[#012a26] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}
              >
                {tab.label}
                {tab.count !== null && tab.count !== undefined ? (
                  <span className={`rounded px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-white/15 text-[#5eead4]" : "bg-slate-100 text-slate-500"}`}>{tab.count}</span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="min-w-0" style={{ maxWidth: 260 }}>
          <label className="sr-only" htmlFor="country-category">Category</label>
          <select id="country-category" value={props.category} onChange={(e) => navigate({ category: (e.target.value as "all" | "major" | "minor") || "all" })} className={selectClass}>
            <option value="all">All</option>
            <option value="major">Major</option>
            <option value="minor">More to explore</option>
          </select>
        </div>
      )}

      <div className="flex min-w-0 items-center gap-2">
        {props.site ? (
          <span className="inline-flex h-10 min-w-0 items-center gap-2 rounded-lg border border-solid border-[#02665e]/30 bg-emerald-50 pl-3 pr-1.5 text-sm font-semibold text-[#02665e]">
            <span className="truncate" style={{ maxWidth: 260 }}>{selectedSiteLabel}</span>
            <button type="button" onClick={() => navigate({ site: "" })} aria-label="Clear park" className="grid h-7 w-7 shrink-0 place-items-center rounded-md border-0 bg-white text-slate-500 hover:text-slate-900">×</button>
          </span>
        ) : (
          <div className="min-w-0 flex-1 lg:flex-none" style={{ width: 280 }}>
            <label className="sr-only" htmlFor="country-site">Jump to a park</label>
            <select id="country-site" value={props.site} onChange={(e) => navigate({ site: e.target.value })} className={selectClass}>
              <option value="">Jump to a park...</option>
              {props.sites.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        )}
        {showGlobalClear && (
          <button type="button" onClick={() => router.push(props.basePath, { scroll: false })} className="h-10 shrink-0 rounded-lg border-0 bg-transparent px-2 text-sm font-semibold text-[#02665e] hover:underline">
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
