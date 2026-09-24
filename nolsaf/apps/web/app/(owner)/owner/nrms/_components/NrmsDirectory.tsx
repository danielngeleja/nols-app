"use client";

import type { LucideIcon } from "lucide-react";
import { ChevronRight, LayoutGrid, List, Search, X } from "lucide-react";
import type { ReactNode } from "react";

export type NrmsDirectoryStage = {
  key: string;
  label: string;
  hint: string;
  count: number;
  icon: LucideIcon;
  text: string;
  bar: string;
  soft: string;
};

export function NrmsLifecycleRail({ stages, selected, onSelect }: {
  stages: NrmsDirectoryStage[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);
  return (
    <section className="rounded-2xl border border-solid border-neutral-200 bg-white p-2">
      <div className={`grid grid-cols-2 gap-2 ${stages.length > 3 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        {stages.map((stage, index) => {
          const Icon = stage.icon;
          const share = total > 0 ? Math.round((stage.count / total) * 100) : 0;
          const active = selected === stage.key;
          return (
            <button
              key={stage.key}
              type="button"
              onClick={() => onSelect(active ? "" : stage.key)}
              aria-pressed={active}
              className={`group relative min-w-0 rounded-xl border border-solid p-4 text-left transition-all ${active ? `border-neutral-900 ${stage.soft}` : "border-transparent bg-neutral-50/70 hover:border-neutral-200 hover:bg-white"}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className={`inline-flex items-center gap-1.5 text-sm font-semibold ${stage.text}`}><Icon className="h-4 w-4" />{stage.label}</span>
                <span className="text-xs tabular-nums text-neutral-400">{index < 2 ? `Step ${index + 1}` : `${share}%`}</span>
              </span>
              <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{stage.count.toLocaleString()}</span>
              <span className="mt-1.5 block truncate text-xs text-neutral-500">{stage.hint}</span>
              <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                <span className={`block h-full rounded-full ${stage.bar}`} style={{ width: `${stage.count > 0 ? Math.max(share, 4) : 0}%` }} />
              </span>
              {index === 0 && <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-neutral-300 ring-1 ring-neutral-200 lg:block" aria-hidden />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function NrmsDirectoryShell({
  title,
  count,
  loading,
  query,
  onQueryChange,
  placeholder,
  view,
  onViewChange,
  filter,
  onClearFilter,
  toolbar,
  secondaryToolbar,
  children,
}: {
  title: string;
  count: number;
  loading?: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  view: "cards" | "list";
  onViewChange: (view: "cards" | "list") => void;
  filter?: string;
  onClearFilter?: () => void;
  toolbar?: ReactNode;
  secondaryToolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-4 bg-neutral-50/40 px-4 py-4 sm:px-5">
        <div className="min-w-0 border-l-2 border-emerald-600 pl-3">
          <h2 className="m-0 text-base font-bold leading-tight text-neutral-950">{title}</h2>
          <p className="mb-0 mt-1 text-xs font-medium tabular-nums text-neutral-500">{loading ? "Loading records..." : `${count.toLocaleString()} ${count === 1 ? "record" : "records"}`}</p>
        </div>
        {filter && onClearFilter && (
          <button type="button" onClick={onClearFilter} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
            <X className="h-3 w-3" /> Show all
          </button>
        )}
        <div className="ml-auto flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          {toolbar}
          <div className="relative min-w-0 flex-1 sm:w-80 sm:flex-none">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} className="h-10 w-full min-w-0 rounded-lg border border-solid border-neutral-200 bg-white pl-10 pr-9 text-sm text-neutral-800 shadow-sm shadow-neutral-100/70 outline-none transition placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15" placeholder={placeholder} />
            {query && <button type="button" onClick={() => onQueryChange("")} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700" aria-label="Clear search"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="inline-flex h-10 items-center rounded-lg border border-solid border-neutral-200 bg-white p-0.5 shadow-sm shadow-neutral-100/70" role="group" aria-label="Directory layout">
            {([['cards', LayoutGrid, 'Cards'], ['list', List, 'List']] as const).map(([key, Icon, label]) => (
              <button key={key} type="button" onClick={() => onViewChange(key)} aria-pressed={view === key} title={label} className={`inline-flex h-8 w-8 items-center justify-center rounded-md border-0 transition-colors ${view === key ? "bg-neutral-900 text-white shadow-sm" : "bg-transparent text-neutral-400 hover:text-neutral-700"}`}><Icon className="h-4 w-4" /></button>
            ))}
          </div>
        </div>
      </div>
      {secondaryToolbar && <div className="border-t border-neutral-100 bg-white px-4 py-2.5 sm:px-5">{secondaryToolbar}</div>}
      {children}
    </section>
  );
}
