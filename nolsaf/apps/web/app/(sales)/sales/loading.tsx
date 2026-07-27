export default function Loading() {
  return (
    <div id="sales-workspace" className="min-h-screen bg-[#f5f7f6] lg:flex">
      <aside className="bg-[#07332d] text-white rounded-3xl lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-[252px] lg:shrink-0 lg:flex-col">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-4 lg:px-5 lg:py-5">
          <span className="h-10 w-10 rounded-xl bg-emerald-400/70 animate-pulse" />
          <div className="min-w-0 space-y-2">
            <div className="h-3 w-24 rounded-full bg-emerald-200/70 animate-pulse" />
            <div className="h-2.5 w-32 rounded-full bg-emerald-200/70 animate-pulse" />
          </div>
        </div>

        <nav className="flex flex-col gap-2 px-3 py-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <div key={index} className="flex h-10 items-center gap-3 rounded-full bg-white/5 px-3">
              <span className="h-3.5 w-3.5 rounded-full bg-white/20 animate-pulse" />
              <span className="h-3 rounded-full bg-white/20 w-24 animate-pulse" />
            </div>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="border-b border-slate-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:sticky lg:top-0 lg:z-20">
          <div className="mx-auto flex min-h-10 max-w-[1600px] items-center justify-between gap-3">
            <div className="space-y-2">
              <div className="h-3.5 w-40 rounded-full bg-slate-200 animate-pulse" />
              <div className="h-2.5 w-32 rounded-full bg-slate-200 animate-pulse" />
            </div>
            <div className="flex items-center gap-2">
              <span className="h-9 w-9 rounded-full bg-slate-200 animate-pulse" />
              <span className="h-9 w-9 rounded-full bg-slate-200 animate-pulse" />
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          <div className="space-y-6">
            <div className="rounded-3xl bg-white p-6 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
              <div className="h-6 w-48 rounded-full bg-slate-200 animate-pulse" />
              <div className="mt-6 grid gap-4 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="space-y-3 rounded-3xl bg-slate-100 p-4">
                    <div className="h-4 w-2/3 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-3 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-3 rounded-full bg-slate-200 animate-pulse w-5/6" />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div key={index} className="rounded-3xl bg-white p-6 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
                  <div className="h-5 w-1/3 rounded-full bg-slate-200 animate-pulse" />
                  <div className="mt-4 space-y-3">
                    <div className="h-3 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-3 rounded-full bg-slate-200 animate-pulse" />
                    <div className="h-3 rounded-full bg-slate-200 animate-pulse w-2/3" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
