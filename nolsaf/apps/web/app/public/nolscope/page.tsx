import NolScopeEstimator from "@/components/NolScopeEstimator";
import NolScopeHeroFacts from "@/components/NolScopeHeroFacts";
import NolScopeHeroInsights from "@/components/NolScopeHeroInsights";
import NolScopeHeroRoute from "@/components/NolScopeHeroRoute";
import { ArrowDown } from "lucide-react";
import type { Metadata } from "next";
import { SITE_URL, seoKeywords } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Tanzania Trip Cost Estimator | NoLScope",
  description:
    "Estimate Tanzania safari, beach, cultural and local tourism trip costs. NoLScope covers visa fees, park fees, transport, activities and accommodation.",
  keywords: [
    "Tanzania trip cost estimator",
    "Tanzania safari cost",
    "Zanzibar trip cost",
    "Tanzania park fees",
    "East Africa travel budget",
    "NoLScope",
    ...seoKeywords,
  ],
  alternates: { canonical: `${SITE_URL}/public/nolscope` },
  openGraph: {
    title: "Tanzania Trip Cost Estimator | NoLScope",
    description: "Estimate visa, park, transport, activity and accommodation costs before travelling in Tanzania.",
    url: `${SITE_URL}/public/nolscope`,
  },
};

export default function NolScopePage() {
  return (
    <main className="min-h-screen bg-[#f3f7f6]">
      {/* ── Hero: the promise on the left, what we price on the right ── */}
      <section className="public-container pt-4">
        {/* Calm: one flat colour, few words, one action */}
        <div className="relative overflow-hidden rounded-3xl bg-[#024d47] text-white">
          <div className="relative grid gap-10 px-6 py-12 sm:px-10 md:grid-cols-[minmax(0,1fr)_340px] md:items-center lg:grid-cols-[minmax(0,1fr)_400px] lg:py-14">
            {/* Left */}
            <div className="text-center md:text-left">
              <p className="m-0 text-[13px] font-semibold text-emerald-200">NoLScope</p>
              <h1 className="m-0 mt-2 text-[34px] font-extrabold leading-[1.1] tracking-tight sm:text-[44px]">
                Know what your Tanzania trip costs.
              </h1>
              <p className="m-0 mx-auto mt-3 max-w-md text-[15px] leading-7 text-white/70 md:mx-0">
                Visa, parks, transport and stays, itemised in minutes.
              </p>
              <a
                href="#estimator"
                className="mt-7 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-[15px] font-bold text-[#024d47] no-underline shadow-lg transition-transform hover:-translate-y-0.5"
              >
                Start your estimate
                <ArrowDown className="h-4 w-4" />
              </a>
              <NolScopeHeroFacts />
              {/* Connects the promise to the data: the most-visited places, joined as one route */}
              <div className="hidden sm:block">
                <NolScopeHeroRoute />
              </div>
            </div>

            {/* Right: a live answer, not decoration: which places suit the month, from our season data */}
            <div className="w-full">
              <NolScopeHeroInsights />
            </div>
          </div>
        </div>
      </section>

      {/* ── Workspace: the estimator on a soft mapped background ── */}
      <section
        id="estimator"
        className="relative scroll-mt-20"
        style={{
          backgroundImage: [
            "radial-gradient(ellipse 50% 40% at 15% 0%, rgba(2,102,94,0.08), transparent 70%)",
            "radial-gradient(ellipse 40% 35% at 90% 30%, rgba(245,158,11,0.06), transparent 70%)",
            "radial-gradient(rgba(2,102,94,0.10) 1px, transparent 1px)",
          ].join(","),
          backgroundSize: "auto, auto, 24px 24px",
        }}
      >
        <div className="public-container pb-24 pt-10">
          <div className="mb-6">
            <h2 className="m-0 text-[24px] font-bold tracking-tight text-slate-950 sm:text-[28px]">Build your estimate</h2>
            <p className="m-0 mt-1 text-[14px] text-slate-500">Four quick steps. Your trip summary updates as you go.</p>
          </div>
          <NolScopeEstimator />
        </div>
      </section>
    </main>
  );
}
