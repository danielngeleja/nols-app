/**
 * Loading placeholders for the owner Room availability page, drawn in the
 * page's own shapes (dark-teal panels) so nothing jumps when data lands.
 * One soft shimmer, no spinners, no "Loading..." text.
 */

const SHIMMER = `
  @keyframes oa-shimmer { 0% { background-position: -480px 0 } 100% { background-position: 480px 0 } }
  .oa-sk { background: linear-gradient(90deg, rgba(255,255,255,.05) 0%, rgba(255,255,255,.12) 40%, rgba(255,255,255,.05) 80%); background-size: 960px 100%; animation: oa-shimmer 1.4s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .oa-sk { animation: none; } }
`;

function Bar({ className = "" }: { className?: string }) {
  return <div className={`oa-sk rounded-full ${className}`} />;
}

/** Room tiles only, for the floor board while its rooms load. */
export function BoardTilesSkeleton({ count = 12 }: { count?: number }) {
  return (
    <>
      <style>{SHIMMER}</style>
      <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6" aria-hidden>
        {Array.from({ length: count }).map((_, i) => (
          <li key={i} className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="flex items-center justify-between gap-2">
              <Bar className="h-2.5 w-14" />
              <Bar className="h-3.5 w-9" />
            </div>
            <Bar className="mt-3 h-6 w-8 rounded-md" />
            <Bar className="mt-3 h-1 w-full" />
            <Bar className="mt-2 h-2.5 w-20" />
          </li>
        ))}
      </ul>
    </>
  );
}

/** The floor board while the floor plan loads. */
export function BoardSkeleton() {
  return (
    <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#012a26]" aria-busy="true" aria-label="Loading rooms by floor">
      <style>{SHIMMER}</style>
      <div className="px-5 pb-3 pt-4">
        <Bar className="h-3.5 w-28" />
        <Bar className="mt-2 h-2.5 w-64 max-w-full" />
      </div>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {[88, 72, 72, 72, 72, 120, 72].map((w, i) => <div key={i} className="oa-sk h-8 rounded-xl" style={{ width: w }} />)}
      </div>
      <div className="border-0 border-t border-white/10 p-4 sm:p-5">
        <BoardTilesSkeleton />
      </div>
    </section>
  );
}

/** Floor plan setup page: header band, empty-floor note and the building. Steady panels, soft shimmer. */
export function FloorPlanSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading floor plan" className="space-y-5">
      <style>{SHIMMER}</style>
      <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-5 sm:px-8 sm:pt-6">
        <Bar className="h-3 w-36" />
        <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-2.5">
            <Bar className="h-2.5 w-14" />
            <div className="oa-sk h-8 w-44 rounded-lg" />
            <Bar className="h-3 w-80 max-w-full" />
          </div>
          <div className="flex gap-2">
            <div className="oa-sk h-10 w-44 rounded-xl" />
            <div className="oa-sk h-10 w-32 rounded-xl" />
          </div>
        </div>
        <div className="mt-6 grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <Bar className="h-2.5 w-16" />
              <div className="oa-sk mt-2.5 h-6 w-10 rounded-md" />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="overflow-hidden rounded-3xl bg-[#012a26]">
          <div className="flex items-center justify-between border-0 border-b border-white/10 px-5 py-4">
            <Bar className="h-3 w-20" />
            <Bar className="h-2.5 w-40" />
          </div>
          {[6, 4, 5, 3].map((rooms, row) => (
            <div key={row} className="grid grid-cols-[92px_minmax(0,1fr)] border-0 border-b border-white/10 last:border-b-0 sm:grid-cols-[120px_minmax(0,1fr)]">
              <div className="space-y-2 border-0 border-r border-white/10 px-3 py-4 sm:px-4">
                <Bar className="h-3 w-12" />
                <Bar className="h-2.5 w-16" />
              </div>
              <div className="flex flex-wrap gap-2 px-3 py-3 sm:px-4">
                {Array.from({ length: rooms }).map((_, i) => (
                  <div key={i} className="h-14 w-[76px] rounded-xl border border-white/10 bg-white/[0.04] p-2">
                    <Bar className="h-3.5 w-5" />
                    <Bar className="mt-3 h-2 w-12" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-3 rounded-3xl border border-slate-200 bg-white p-5">
          <div className="h-3 w-24 rounded-full bg-slate-200" />
          <div className="h-2.5 w-44 rounded-full bg-slate-100" />
          {[0, 1, 2].map((i) => <div key={i} className="h-12 rounded-xl bg-slate-100" />)}
        </div>
      </div>
    </div>
  );
}

/** The whole page, before the property and its calendar have loaded. */
export function AvailabilityPageSkeleton() {
  const panel = "rounded-2xl border border-white/10 bg-[#012a26]";
  return (
    <div aria-busy="true" aria-label="Loading room availability" className="space-y-5">
      <style>{SHIMMER}</style>

      {/* Header band */}
      <div className="rounded-3xl bg-[#012a26] px-5 pb-6 pt-5 sm:px-8 sm:pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="oa-sk h-9 w-44 rounded-xl" />
          <div className="flex gap-2">
            <div className="oa-sk h-9 w-32 rounded-xl" />
            <div className="oa-sk h-9 w-24 rounded-xl" />
            <div className="oa-sk h-9 w-28 rounded-xl" />
          </div>
        </div>
        <Bar className="mt-6 h-2.5 w-32" />
        <div className="oa-sk mt-3 h-8 w-64 max-w-full rounded-lg" />
        <div className="mt-4 flex flex-wrap gap-2">
          <Bar className="h-6 w-28" />
          <Bar className="h-6 w-36" />
          <Bar className="h-4 w-60" />
        </div>
      </div>

      {/* Date bar */}
      <div className={`${panel} flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4`}>
        <div className="flex gap-2">
          {[64, 64, 72, 72].map((w, i) => <div key={i} className="oa-sk h-9 rounded-lg" style={{ width: w }} />)}
        </div>
        <div className="flex gap-2">
          <div className="oa-sk h-9 w-48 rounded-lg" />
          <div className="oa-sk h-9 w-9 rounded-lg" />
        </div>
      </div>

      {/* Occupancy card */}
      <div className={`${panel} grid overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]`}>
        <div className="border-0 border-b border-white/10 p-5 lg:border-b-0 lg:border-r">
          <Bar className="h-2.5 w-24" />
          <div className="oa-sk mt-3 h-9 w-48 rounded-lg" />
          <Bar className="mt-4 h-3 w-full" />
          <Bar className="mt-3 h-2.5 w-56" />
        </div>
        <div className="grid grid-cols-3 gap-px bg-white/10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="bg-[#012a26] px-4 py-4">
              <Bar className="h-2.5 w-20" />
              <div className="oa-sk mt-3 h-7 w-10 rounded-md" />
              <Bar className="mt-2 h-2.5 w-16" />
            </div>
          ))}
        </div>
      </div>

      {/* Rooms by floor */}
      <BoardSkeleton />

      {/* Sidebar and calendar */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="space-y-6 lg:col-span-4">
          {[160, 220, 110].map((h, i) => (
            <div key={i} className={`${panel} p-5`} style={{ height: h }}>
              <Bar className="h-3 w-28" />
              <Bar className="mt-3 h-2.5 w-44" />
              <div className="oa-sk mt-4 h-10 w-full rounded-xl" />
            </div>
          ))}
        </div>
        <div className={`${panel} p-5 lg:col-span-8`}>
          <Bar className="h-3 w-24" />
          <Bar className="mt-2 h-2.5 w-56" />
          <div className="mt-5 grid grid-cols-7 gap-2">
            {Array.from({ length: 35 }).map((_, i) => (
              <div key={i} className="oa-sk h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
