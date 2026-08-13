import SalesShell from "@/components/SalesShell";

function SalesRouteSkeleton() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading Sales page">
      <div className="flex items-center gap-3">
        <span className="h-11 w-11 rounded-xl bg-emerald-100 animate-pulse" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-44 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-3 w-full max-w-xl rounded-full bg-slate-200 animate-pulse" />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="space-y-3 border border-slate-200 bg-white p-5">
            <div className="h-3 w-24 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-7 w-36 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-3 w-4/5 rounded-full bg-slate-100 animate-pulse" />
          </div>
        ))}
      </div>

      <div className="space-y-4 border border-slate-200 bg-white p-5">
        <div className="h-4 w-36 rounded-full bg-slate-200 animate-pulse" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="grid grid-cols-4 gap-4 border-t border-slate-100 pt-4">
            <div className="h-3 rounded-full bg-slate-200 animate-pulse" />
            <div className="h-3 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-3 rounded-full bg-slate-100 animate-pulse" />
            <div className="h-3 rounded-full bg-slate-200 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <SalesShell>
      <SalesRouteSkeleton />
    </SalesShell>
  );
}
