import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "What we do",
  description:
    "What NoLSAF does: end-to-end travel services that connect accommodation, transport, payments, filtering, and planning in one platform.",
  alternates: { canonical: "https://nolsaf.com/about/what" },
};

export default function AboutWhatPage() {
  return (
    <article className="max-w-none space-y-6">
      <div className="not-prose -mx-5 sm:-mx-8">
        <section className="relative min-w-0 overflow-hidden rounded-lg border border-white/10 bg-[#02665e] shadow-card p-6 ring-1 ring-white/10 sm:p-7">
          <div className="prose prose-invert w-full min-w-0 max-w-3xl break-words">
            <h2>What we do</h2>
            <p>
              NoLSAF provides end-to-end services that make travel feel simple: choose a place to stay, plan how to reach it, pay using the
              method that fits your location, and get support for the experience around the stay.
            </p>
          </div>
        </section>
      </div>

      <div className="not-prose -mx-5 grid min-w-0 gap-4 sm:-mx-8 lg:grid-cols-2">
        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#02665e]/0 via-[#02665e]/35 to-[#02665e]/0" />
            <div className="absolute inset-0 bg-gradient-to-br from-white via-slate-50 to-white" />
            <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-[#02665e]/10 blur-3xl" />
          </div>
          <div className="relative">
            <div className="text-base font-semibold tracking-tight text-slate-900">
              1) Accommodation search treated as a “service”
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              We treat searching for accommodation as part of the treatment the process should be calm, fast, and confidence-building.
              Filtering should not take hours. We structure discovery so travelers can quickly find what fits.
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#02665e]/0 via-[#02665e]/35 to-[#02665e]/0" />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
            <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-[#02665e]/10 blur-3xl" />
          </div>
          <div className="relative">
            <div className="text-base font-semibold tracking-tight text-slate-900">2) End-to-end travel in one platform</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              We believe booking is incomplete if transport is separated from accommodation. That’s why NoLSAF supports an integrated
              journey from planning to arrival, so travelers can engage on a “single click” experience rather than juggling disconnected
              tools.
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#02665e]/0 via-[#02665e]/35 to-[#02665e]/0" />
            <div className="absolute inset-0 bg-gradient-to-br from-white via-[#02665e]/5 to-white" />
            <div className="absolute -top-20 -left-20 h-60 w-60 rounded-full bg-[#02665e]/12 blur-3xl" />
          </div>
          <div className="relative">
            <div className="text-base font-semibold tracking-tight text-slate-900">3) Payments that work locally and internationally</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              Travelers come from different places and use different payment methods. NoLSAF is built to support both local and
              international payment options, so users can choose what works for them.
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#02665e]/0 via-[#02665e]/35 to-[#02665e]/0" />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-slate-100/40 to-white" />
            <div className="absolute -bottom-20 -right-20 h-60 w-60 rounded-full bg-[#02665e]/10 blur-3xl" />
          </div>
          <div className="relative">
            <div className="text-base font-semibold tracking-tight text-slate-900">4) Town-to-tourist-site friendly discovery</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              We classify and present stays in a way that is easy to navigate from town stays to tourist-site destinations so users can
              move from “where am I going?” to “what should I book?” without confusion.
            </p>
          </div>
        </section>
      </div>

      <div className="not-prose -mx-5 grid min-w-0 gap-4 sm:-mx-8 lg:grid-cols-2">
        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#02665e]/0 via-[#02665e]/35 to-[#02665e]/0" />
            <div className="absolute inset-0 bg-gradient-to-br from-white via-slate-50 to-white" />
            <div className="absolute -top-20 -right-20 h-60 w-60 rounded-full bg-[#02665e]/10 blur-3xl" />
          </div>
          <div className="relative">
            <div className="text-base font-semibold tracking-tight text-slate-900">5) Group Stays: budget-friendly offers with owner claiming</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              For certain circumstances, we support a group-stay flow where travelers can submit offers and property owners can claim
              offers that fit them. This approach helps expand access and supports budget-friendly travel across the region.
            </p>
          </div>
        </section>

        <section className="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-slate-50 p-6 shadow-card sm:p-7">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-[#02665e]/0 via-[#02665e]/35 to-[#02665e]/0" />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
            <div className="absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-[#02665e]/10 blur-3xl" />
          </div>
          <div className="relative">
            <div className="text-base font-semibold tracking-tight text-slate-900">6) Agents and event managers</div>
            <p className="mt-2 text-sm leading-relaxed text-slate-700">
              Travel is not only about visiting towns many travelers come for traditional tourism and need clarity on arrangements,
              budgets, timing, and what to prioritize. Our agent system is designed to make that easy and structured.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-700">
              On NoLSAF, travelers can request support and get coordinated guidance from agents and event managers including destination
              information, budget expectations, and recommended arrangements then connect those plans to real bookings.
            </p>

            <ul className="mt-4 space-y-2 text-sm leading-relaxed text-slate-700">
              <li className="flex min-w-0 gap-3">
                <span
                  aria-hidden
                  className="mt-[0.35rem] h-5 w-1 flex-none rounded-full bg-gradient-to-b from-[#02665e]/60 via-[#02665e]/35 to-[#02665e]/15"
                />
                <span className="min-w-0 flex-1 break-words">
                  <strong>Arrangements and coordination:</strong> help organizing accommodation, transport, and key activities as one journey.
                </span>
              </li>
              <li className="flex min-w-0 gap-3">
                <span
                  aria-hidden
                  className="mt-[0.35rem] h-5 w-1 flex-none rounded-full bg-gradient-to-b from-[#02665e]/60 via-[#02665e]/35 to-[#02665e]/15"
                />
                <span className="min-w-0 flex-1 break-words">
                  <strong>Budget clarity:</strong> guidance on expected costs and options so travelers can choose what fits their wallet.
                </span>
              </li>
              <li className="flex min-w-0 gap-3">
                <span
                  aria-hidden
                  className="mt-[0.35rem] h-5 w-1 flex-none rounded-full bg-gradient-to-b from-[#02665e]/60 via-[#02665e]/35 to-[#02665e]/15"
                />
                <span className="min-w-0 flex-1 break-words">
                  <strong>Local insight:</strong> practical information about destinations so visitors can plan confidently.
                </span>
              </li>
              <li className="flex min-w-0 gap-3">
                <span
                  aria-hidden
                  className="mt-[0.35rem] h-5 w-1 flex-none rounded-full bg-gradient-to-b from-[#02665e]/60 via-[#02665e]/35 to-[#02665e]/15"
                />
                <span className="min-w-0 flex-1 break-words">
                  <strong>Partner-friendly workflow:</strong> a system that helps agents turn planning into confirmed bookings and support
                  clients end-to-end.
                </span>
              </li>
            </ul>
          </div>
        </section>
      </div>
    </article>
  );
}
