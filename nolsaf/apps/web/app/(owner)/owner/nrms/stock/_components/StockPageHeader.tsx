"use client";

// The header every Stock workspace page shares: title row with actions,
// a band of figure tiles, and underline tabs with counts. Kept in one place so
// Store operations, Supplier payables and the rest look like one product.

import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cardClass } from "../items/_components/ui";

export type TileTone = "brand" | "amber" | "red" | "calm" | "neutral";

export type StockTile = { icon: LucideIcon; label: string; value: string; note?: string; tone?: TileTone };

const TILE_TONE: Record<TileTone, { chip: string; value: string; ring: string }> = {
  brand: { chip: "bg-brand/10 text-brand", value: "text-neutral-950", ring: "border-brand/25" },
  amber: { chip: "bg-amber-100 text-amber-700", value: "text-amber-800", ring: "border-amber-300" },
  red: { chip: "bg-red-100 text-red-700", value: "text-red-700", ring: "border-red-300" },
  calm: { chip: "bg-emerald-50 text-emerald-700", value: "text-neutral-950", ring: "border-neutral-200" },
  neutral: { chip: "bg-neutral-100 text-neutral-600", value: "text-neutral-950", ring: "border-neutral-200" },
};

export type StockTab<T extends string> = { key: T; label: string; icon: LucideIcon; count?: number; alert?: boolean };

export default function StockPageHeader<T extends string = string>({ icon: Icon, title, subtitle, actions, tiles, tabs, activeTab, onTab, ariaLabel }: {
  icon: LucideIcon;
  title: string;
  subtitle: string;
  actions?: ReactNode;
  /** Null while loading: grey placeholders keep the layout still. Undefined: no figure band. */
  tiles?: StockTile[] | null;
  /** Omit on pages without tabs (a single supplier's account). */
  tabs?: Array<StockTab<T>>;
  activeTab?: T;
  onTab?: (tab: T) => void;
  ariaLabel?: string;
}) {
  return (
    <section className={`${cardClass} overflow-hidden`}>
      <div className="flex flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand text-white shadow-sm"><Icon className="h-6 w-6" /></span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-2xl font-bold tracking-tight text-neutral-950">{title}</h1>
            <p className="m-0 mt-0.5 text-sm text-neutral-500">{subtitle}</p>
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </div>

      {tiles !== undefined && <div className={`grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/70 px-4 py-4 sm:grid-cols-2 sm:px-6 ${tiles && tiles.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4"}`}>
        {(tiles ?? Array.from({ length: 4 }, () => null)).map((tile, index) => {
          if (!tile) return <div key={index} className="h-[92px] animate-pulse rounded-xl border border-solid border-neutral-200 bg-white" />;
          const tone = TILE_TONE[tile.tone ?? "neutral"];
          return (
            <div key={tile.label} className={`flex items-start gap-3 rounded-xl border border-solid bg-white p-3.5 shadow-sm ${tone.ring}`}>
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tone.chip}`}><tile.icon className="h-4 w-4" /></span>
              <div className="min-w-0">
                <p className="m-0 text-[11px] font-bold uppercase tracking-wide text-neutral-500">{tile.label}</p>
                <p className={`m-0 mt-0.5 truncate text-xl font-bold tabular-nums ${tone.value}`}>{tile.value}</p>
                {tile.note && <p className="m-0 mt-0.5 truncate text-xs text-neutral-500">{tile.note}</p>}
              </div>
            </div>
          );
        })}
      </div>}

      {tabs && tabs.length > 0 && <nav className="flex gap-1 overflow-x-auto border-0 border-t border-solid border-neutral-100 px-2 sm:px-4" role="tablist" aria-label={ariaLabel}>
        {tabs.map((tab) => {
          const active = tab.key === activeTab;
          return (
            <button key={tab.key} type="button" role="tab" aria-selected={active} onClick={() => onTab?.(tab.key)} className={`-mb-px inline-flex h-12 shrink-0 items-center gap-2 border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-bold [font-family:inherit] transition ${active ? "border-brand text-brand" : "border-transparent text-neutral-500 hover:text-neutral-800"}`}>
              <tab.icon className="h-4 w-4" />{tab.label}
              {(tab.count ?? 0) > 0 && <span className={`rounded-full px-1.5 text-xs ${tab.alert ? "bg-amber-100 text-amber-800" : "bg-brand/10 text-brand"}`}>{tab.count}</span>}
            </button>
          );
        })}
      </nav>}
    </section>
  );
}
