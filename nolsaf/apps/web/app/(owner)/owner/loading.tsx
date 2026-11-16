export default function OwnerLoading() {
  return (
    <div className="h-screen overflow-hidden flex flex-col bg-neutral-50">
      {/* Header skeleton */}
      <div className="h-14 w-full border-b border-slate-200 bg-white px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-lg bg-slate-200 animate-pulse" />
          <div className="h-5 w-28 rounded-full bg-slate-200 animate-pulse" />
        </div>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-8 w-8 rounded-full bg-slate-200 animate-pulse" />
          <div className="h-8 w-24 rounded-full bg-slate-200 animate-pulse" />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar skeleton */}
        <div className="hidden md:flex flex-col w-56 shrink-0 border-r border-slate-200 bg-white px-3 py-4 gap-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-9 w-full rounded-md bg-slate-100 animate-pulse" style={{ opacity: 1 - i * 0.08 }} />
          ))}
        </div>

        {/* Main content skeleton */}
        <div className="flex-1 overflow-auto p-6 space-y-5">
          {/* Page title */}
          <div className="h-7 w-44 rounded-full bg-slate-200 animate-pulse" />

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-lg bg-white border border-slate-200 animate-pulse" />
            ))}
          </div>

          {/* Content cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="h-48 rounded-lg bg-white border border-slate-200 animate-pulse" />
            <div className="h-48 rounded-lg bg-white border border-slate-200 animate-pulse" />
          </div>

          {/* Table skeleton */}
          <div className="rounded-lg bg-white border border-slate-200 p-4 space-y-3">
            <div className="h-5 w-32 rounded-full bg-slate-200 animate-pulse" />
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-12 w-full rounded-md bg-slate-100 animate-pulse" style={{ opacity: 1 - i * 0.12 }} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
