"use client";

/**
 * Sales portal pagination: "21 to 40 of 132", numbered pages with gaps
 * (1 … 4 5 6 … 12), previous/next, and a rows-per-page choice. Renders nothing
 * when everything fits on one page at the smallest size.
 */
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Page numbers to show, with null for a gap. */
export function pageWindow(page: number, pages: number): Array<number | null> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: Array<number | null> = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(pages - 1, page + 1);
  if (start > 2) out.push(null);
  for (let p = start; p <= end; p++) out.push(p);
  if (end < pages - 1) out.push(null);
  out.push(pages);
  return out;
}

const cell = "grid h-8 min-w-8 place-items-center rounded-md border border-solid px-2 text-[12px] font-semibold tabular-nums";

export default function SalesPager({
  page,
  pageSize,
  total,
  sizes = [10, 25, 50],
  disabled,
  noun = "rows",
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  sizes?: number[];
  disabled?: boolean;
  noun?: string;
  onPage: (page: number) => void;
  onPageSize?: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= Math.min(...sizes)) return null;
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-4 py-2.5" aria-label="Pages">
      <div className="flex items-center gap-3 text-[12px] text-slate-500">
        <span className="tabular-nums">{first.toLocaleString("en-US")} to {last.toLocaleString("en-US")} of {total.toLocaleString("en-US")}</span>
        {onPageSize ? (
          <label className="inline-flex items-center gap-1.5">
            <span className="hidden sm:inline">Show</span>
            <select
              value={pageSize}
              disabled={disabled}
              onChange={(e) => onPageSize(Number(e.target.value))}
              aria-label={`${noun} per page`}
              className="h-8 rounded-md border border-solid border-slate-300 bg-white px-1.5 text-[12px] font-medium text-slate-700 outline-none focus:border-[#02665e]"
            >
              {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
            <span className="hidden sm:inline">per page</span>
          </label>
        ) : null}
      </div>

      {pages > 1 ? (
        <div className="flex items-center gap-1">
          <button type="button" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" className={`${cell} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40`}>
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          {/* Numbers on wider screens; "3 / 12" on phones. */}
          <span className="hidden items-center gap-1 sm:flex">
            {pageWindow(page, pages).map((p, i) =>
              p === null ? (
                <span key={`gap-${i}`} className="px-1 text-[12px] text-slate-400" aria-hidden>…</span>
              ) : (
                <button
                  key={p}
                  type="button"
                  disabled={disabled}
                  onClick={() => onPage(p)}
                  aria-current={p === page ? "page" : undefined}
                  aria-label={`Page ${p}`}
                  className={`${cell} ${p === page ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}
                >
                  {p}
                </button>
              ),
            )}
          </span>
          <span className="px-1 text-[12px] font-semibold tabular-nums text-slate-600 sm:hidden">{page} / {pages}</span>
          <button type="button" disabled={disabled || page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" className={`${cell} border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40`}>
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </nav>
  );
}
