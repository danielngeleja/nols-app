"use client";

type Props = {
  /** 1-based current page. */
  page: number;
  /** Rows per page. */
  pageSize: number;
  /** Total number of rows across all pages. */
  total: number;
  /** Called with the next 1-based page number. */
  onPageChange: (page: number) => void;
  /** Temporarily disable navigation while a server-side page loads. */
  disabled?: boolean;
  /** Optional extra content rendered on the left (e.g. a "Load more" button). */
  children?: React.ReactNode;
};

/** Simple client-side Previous/Next pagination footer for tables. */
export default function TablePagination({ page, pageSize, total, onPageChange, disabled = false, children }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(safePage * pageSize, total);

  return (
    <div className="flex flex-col gap-2 px-5 py-4 border-t border-slate-100 bg-white sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3 text-xs text-slate-400 font-medium">
        <span>Showing {start}–{end} of {total}</span>
        {children}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={disabled || safePage <= 1}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 transition"
        >
          Previous
        </button>
        <span className="text-xs font-semibold text-slate-600">Page {safePage} of {totalPages}</span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={disabled || safePage >= totalPages}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 transition"
        >
          Next
        </button>
      </div>
    </div>
  );
}
