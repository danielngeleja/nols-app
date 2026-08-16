import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import CountryTourismSiteList, { type TourismSite } from "@/components/CountryTourismSiteList";
import CountryFiltersRow from "@/components/CountryFiltersRow";
import { SITE_URL, seoKeywords } from "@/lib/seo";

type CountryTourism = {
  id: string;
  name: string;
  subtitle: string;
  hero: {
    title: string;
    body: string;
  };
  major?: TourismSite[];
  minor?: TourismSite[];
  zones?: Array<{ title: string; items: TourismSite[] }>;
  highlights?: Array<{ src: string; alt: string }>;
};

type SearchParams = Record<string, string | string[] | undefined>;

function getSearchParam(searchParams: SearchParams, key: string): string {
  const value = searchParams[key];
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

const COUNTRY_TOURISM: Record<string, CountryTourism> = {
  tanzania: {
    id: "tanzania",
    name: "Tanzania",
    subtitle: "Safaris, parks, mountains, and islands",
    hero: {
      title: "Plan your Tanzania trip by park",
      body: "Choose a park, then review approved stays inside or nearby. NoLSAF keeps booking, payment, and transport coordinated end‑to‑end.",
    },
    highlights: [
      { src: "/assets/Mount Kilimanjaro.jpg", alt: "Mount Kilimanjaro" },
      { src: "/assets/Ngorongoro.jpg", alt: "Ngorongoro" },
      { src: "/assets/Ngrongoro Creator.jpg", alt: "Ngorongoro Crater" },
      { src: "/assets/Serengeti National Park.jpg", alt: "Serengeti National Park" },
      { src: "/assets/Serengeti baloon.jpg", alt: "Serengeti balloon safari" },
      { src: "/assets/Great Migration.jpg", alt: "Great Migration" },
    ],
    zones: [
      {
        title: "Southern Zone",
        items: [
          { slug: "ruaha-national-park", name: "Ruaha National Park", note: "" },
          { slug: "katavi-national-park", name: "Katavi National Park", note: "" },
          { slug: "kitulo-national-park", name: "Kitulo National Park", note: "" },
        ],
      },
      {
        title: "Western Zone",
        items: [
          { slug: "serengeti-national-park", name: "Serengeti National Park", note: "" },
          { slug: "saanane-island-national-park", name: "Saanane Island National Park", note: "" },
          { slug: "burigi-chato-national-park", name: "Burigi-Chato National Park", note: "" },
          { slug: "rubondo-national-park", name: "Rubondo National Park", note: "" },
          { slug: "gombe-national-park", name: "Gombe National Park", note: "" },
          { slug: "mahale-mountains-national-park", name: "Mahale Mountains National Park", note: "" },
          { slug: "ibanda-kyerwa-national-park", name: "Ibanda-Kyerwa National Park", note: "" },
          { slug: "rumanyika-karagwe-national-park", name: "Rumanyika-Karagwe National Park", note: "" },
          { slug: "ugalla-river-national-park", name: "Ugalla River National Park", note: "" },
        ],
      },
      {
        title: "Northern Zone",
        items: [
          { slug: "tarangire-national-park", name: "Tarangire National Park", note: "" },
          { slug: "arusha-national-park", name: "Arusha National Park", note: "" },
          { slug: "mkomazi-national-park", name: "Mkomazi National Park", note: "" },
          { slug: "lake-manyara", name: "Lake Manyara National Park", note: "" },
          { slug: "kilimanjaro-national-park", name: "Kilimanjaro National Park", note: "" },
        ],
      },
      {
        title: "Eastern Zone",
        items: [
          { slug: "saadani-national-park", name: "Saadani National Park", note: "" },
          { slug: "mikumi-national-park", name: "Mikumi National Park", note: "" },
          { slug: "udzungwa-mountains-national-park", name: "Udzungwa Mountains National Park", note: "" },
          { slug: "nyerere-national-park", name: "Nyerere National Park", note: "" },
        ],
      },
    ],
  },

  // NOTE: Kenya and Uganda intentionally removed — Tanzania is our only
  // current coverage. Keeping non-covered countries out of this map makes their
  // URLs (e.g. /public/countries/uganda) fall through to the noindex "not
  // available" branch below so Google drops them from the index.
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ country: string }>;
}): Promise<Metadata> {
  const resolvedParams = await params;
  const countryKey = String(resolvedParams?.country || "").toLowerCase().trim();
  const data = COUNTRY_TOURISM[countryKey];

  // Non-covered country (anything but Tanzania today): keep it out of the index
  // and point search engines back to the countries hub so stale URLs like
  // /public/countries/uganda are dropped rather than ranked.
  if (!data) {
    return {
      title: "Explore Tourism by Country",
      description:
        "NoLSAF currently covers Tanzania. Explore verified stays, tourism sites, transport and travel planning by destination.",
      robots: { index: false, follow: true },
      alternates: { canonical: `${SITE_URL}/public/countries` },
    };
  }

  const countryName = data.name;
  const title =
    countryKey === "tanzania"
      ? "Tanzania Tourism Guide: Safaris, Parks, Beaches, Stays & Transport"
      : `${countryName} Tourism Guide: Stays, Tours & Transport`;
  const description = `${data.name} travel planning with verified stays, tourism sites, transport, tour packages and booking support on NoLSAF. ${data.subtitle}.`;

  return {
    title,
    description,
    keywords: [
      `${countryName} tourism`,
      `${countryName} travel`,
      `${countryName} accommodation`,
      `${countryName} tours`,
      `${countryName} transport`,
      ...seoKeywords,
    ],
    alternates: { canonical: `${SITE_URL}/public/countries/${countryKey}` },
    openGraph: {
      title: `${title} | NoLSAF`,
      description,
      url: `${SITE_URL}/public/countries/${countryKey}`,
    },
  };
}

export default async function CountryTourismPage({
  params,
  searchParams,
}: {
  params: Promise<{ country: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const raw = String(resolvedParams?.country || "");
  const decoded = (() => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  })();

  const countryKey = decoded.toLowerCase().trim();
  const data = COUNTRY_TOURISM[countryKey];
  const available = Object.values(COUNTRY_TOURISM);
  const zoneFilterRaw = getSearchParam(resolvedSearchParams, "zone").trim();
  const zoneFilter = zoneFilterRaw || "";
  const categoryFilterRaw = getSearchParam(resolvedSearchParams, "category").trim().toLowerCase();
  const categoryFilter = categoryFilterRaw === "major" || categoryFilterRaw === "minor" ? categoryFilterRaw : "all";
  const siteFilterRaw = getSearchParam(resolvedSearchParams, "site").trim();
  const siteFilter = siteFilterRaw || "";

  const selectedSites = (() => {
    if (!siteFilter) return [] as TourismSite[];
    const fromZones = (data?.zones ?? []).flatMap((z) => z.items ?? []);
    const fromMajorMinor = [...(data?.major ?? []), ...(data?.minor ?? [])];
    const all = [...fromZones, ...fromMajorMinor].filter((s) => s?.slug === siteFilter);
    const uniq = new Map<string, TourismSite>();
    for (const s of all) {
      const key = String(s.slug || s.name);
      if (!uniq.has(key)) uniq.set(key, s);
    }
    return Array.from(uniq.values());
  })();

  const heroCtaGradient =
    data?.id === "tanzania"
      ? "bg-gradient-to-r from-emerald-700 via-slate-800 to-teal-700"
      : data?.id === "kenya"
        ? "bg-gradient-to-r from-slate-800 via-red-500 to-emerald-600"
        : data?.id === "uganda"
          ? "bg-gradient-to-r from-slate-800 via-amber-400 to-red-500"
          : null;

  if (!data) {
    return (
      <main className="relative min-h-screen text-slate-900 header-offset overflow-hidden">
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute inset-0 bg-gradient-to-b from-emerald-50 via-white to-slate-50" />
          <div className="absolute -top-28 -left-28 h-[28rem] w-[28rem] rounded-full bg-emerald-200/35 blur-3xl" />
          <div className="absolute top-24 -right-40 h-[34rem] w-[34rem] rounded-full bg-teal-200/30 blur-3xl" />
          <div className="absolute -bottom-48 left-1/3 h-[36rem] w-[36rem] rounded-full bg-lime-200/25 blur-3xl" />
        </div>
        <section className="public-container py-8 sm:py-10">
          <div className="flex items-center justify-between gap-4">
            <Link
              href="/public"
              className="inline-flex items-center gap-2 rounded-full bg-slate-900/90 text-white px-4 py-2 text-sm font-semibold no-underline hover:no-underline shadow-sm"
            >
              <ChevronRight className="h-4 w-4 rotate-180" aria-hidden />
              Back
            </Link>
          </div>

          <div className="mt-6 rounded-[32px] p-[1px] bg-gradient-to-br from-white/70 via-emerald-200/25 to-teal-200/25 shadow-[0_22px_70px_rgba(2,6,23,0.10)] ring-1 ring-white/60">
            <div className="rounded-[31px] bg-white/75 backdrop-blur-xl border border-white/70 p-6 sm:p-8">
              <div className="text-slate-900 text-2xl sm:text-3xl font-semibold tracking-tight">Country page not available yet</div>
              <div className="mt-2 text-slate-600 text-sm sm:text-base leading-relaxed max-w-[78ch]">
                We couldnt find details for <span className="font-semibold text-slate-900">{decoded || raw || "this country"}</span>.
                Choose an option below, or pick one of the available countries to explore tourism sites.
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/public/properties?page=1"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-700 text-white px-5 py-2.5 text-sm font-semibold no-underline hover:no-underline shadow-[0_14px_32px_rgba(2,6,23,0.14)]"
                >
                  Accommodation only
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link
                  href="/public/nolscope"
                  className="inline-flex items-center gap-2 rounded-full bg-white/75 ring-1 ring-slate-200/70 px-5 py-2.5 text-slate-900 text-sm font-semibold no-underline hover:no-underline"
                >
                  Estimate full trip
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-[32px] p-[1px] bg-gradient-to-br from-white/70 via-emerald-200/25 to-teal-200/25 ring-1 ring-white/60 shadow-[0_18px_55px_rgba(2,6,23,0.10)]">
            <div className="rounded-[31px] bg-white/75 backdrop-blur-xl border border-white/70 p-6 sm:p-8">
              <div className="text-slate-900 text-xl sm:text-2xl font-semibold tracking-tight">Available countries</div>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                {available.map((c) => (
                  <Link
                    key={c.id}
                    href={`/public/countries/${encodeURIComponent(c.id)}`}
                    className="no-underline hover:no-underline rounded-2xl bg-white/70 border border-slate-200/70 px-4 py-3 transition hover:bg-white/85 hover:border-slate-300/70"
                  >
                    <div className="text-slate-900 font-semibold">{c.name}</div>
                    <div className="mt-1 text-sm text-slate-600">{c.subtitle}</div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen text-slate-900 header-offset overflow-hidden">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-50 via-white to-slate-50" />
        <div className="absolute -top-28 -left-28 h-[28rem] w-[28rem] rounded-full bg-emerald-200/35 blur-3xl" />
        <div className="absolute top-24 -right-40 h-[34rem] w-[34rem] rounded-full bg-teal-200/30 blur-3xl" />
        <div className="absolute -bottom-48 left-1/3 h-[36rem] w-[36rem] rounded-full bg-lime-200/25 blur-3xl" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/55" />
      </div>
      <section className="public-container py-8 sm:py-10">

        {/* ── hero card ─────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-[28px] shadow-[0_28px_80px_rgba(2,6,23,0.28)]">
          {/* flag color bar */}
          <div
            className="h-[5px] w-full flex-shrink-0"
            style={{
              background:
                data.id === 'tanzania'
                  ? 'linear-gradient(90deg,#1C8B3C 25%,#F7D100 25%,#F7D100 50%,#1a1a1a 50%,#1a1a1a 75%,#00A3DD 75%)'
                  : data.id === 'kenya'
                    ? 'linear-gradient(90deg,#006600 25%,#cc0000 25%,#cc0000 50%,#1a1a1a 50%,#1a1a1a 75%,#fff 75%)'
                    : data.id === 'uganda'
                      ? 'linear-gradient(90deg,#000 25%,#FCDC04 25%,#FCDC04 50%,#D90000 50%,#D90000 75%,#000 75%)'
                      : 'linear-gradient(90deg,#02665e,#024d47)',
            }}
          />

          {/* dark card body */}
          <div
            className="relative px-6 py-10 sm:px-12 sm:py-14"
            style={{ background: 'linear-gradient(135deg,#02665e 0%,#024d47 55%,#021f1c 100%)' }}
          >
            {/* back button — top-left overlay */}
            <Link
              href="/public"
              className="absolute top-4 left-4 inline-flex items-center gap-1 rounded-full bg-white/15 ring-1 ring-white/25 text-white/80 px-3 py-1.5 text-xs font-semibold no-underline hover:no-underline motion-safe:transition hover:bg-white/22 z-10"
            >
              <ChevronRight className="h-3 w-3 rotate-180" aria-hidden />
              Back
            </Link>

            {/* dot-grid texture */}
            <div
              className="pointer-events-none absolute inset-0 opacity-[0.07]"
              aria-hidden
              style={{
                backgroundImage: 'radial-gradient(circle,rgba(255,255,255,0.9) 1px,transparent 1px)',
                backgroundSize: '22px 22px',
              }}
            />

            {/* ghost country code */}
            <div
              className="pointer-events-none absolute right-4 bottom-2 text-[120px] sm:text-[180px] font-black leading-none select-none"
              aria-hidden
              style={{ color: 'rgba(255,255,255,0.04)', fontFamily: 'serif', lineHeight: 1 }}
            >
              {data.id === 'tanzania' ? 'TZ' : data.id === 'kenya' ? 'KE' : data.id === 'uganda' ? 'UG' : data.name.slice(0, 2).toUpperCase()}
            </div>

            {/* content */}
            <div className="relative max-w-[62ch] mx-auto text-center">

              {/* country / subtitle pill */}
              <div className="inline-flex items-center gap-2 rounded-full bg-white/10 ring-1 ring-white/20 px-4 py-1.5 mb-6">
                <span className="text-[11px] font-bold tracking-[0.12em] uppercase text-white">{data.name}</span>
                <span className="text-white/30 text-xs">•</span>
                <span className="text-[11px] font-normal text-white/60">{data.subtitle}</span>
              </div>

              {/* headline */}
              <h1 className="text-white text-3xl sm:text-[2.6rem] font-extrabold tracking-tight leading-tight">
                {data.hero.title}
              </h1>

              {/* body */}
              <p className="mt-3 text-white/65 text-sm sm:text-base leading-relaxed">
                {data.hero.body}
              </p>

              {/* 3-step flow */}
              <div className="mt-8 flex items-start justify-center">
                {[
                  { num: '01', label: 'Choose a park' },
                  { num: '02', label: 'Shortlist stays' },
                  { num: '03', label: 'Book + transport' },
                ].map((step, i) => (
                  <div key={step.num} className="flex items-start">
                    <div className="flex flex-col items-center text-center w-28 sm:w-32">
                      <div
                        className="flex items-center justify-center w-10 h-10 rounded-full text-[13px] font-bold text-white ring-1 ring-white/30"
                        style={{ background: 'rgba(255,255,255,0.13)' }}
                      >
                        {step.num}
                      </div>
                      <div className="mt-2 text-[11px] sm:text-xs font-medium text-white/65 leading-snug px-1">
                        {step.label}
                      </div>
                    </div>
                    {i < 2 && (
                      <div
                        className="mt-5 h-px bg-white/20 flex-shrink-0"
                        style={{ width: 36 }}
                      />
                    )}
                  </div>
                ))}
              </div>

              {/* CTA buttons */}
              <div className="mt-9 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link
                  href={`/public/properties?country=${encodeURIComponent(data.id)}&page=1`}
                  className={
                    `inline-flex items-center justify-center rounded-full px-8 h-11 text-sm font-bold no-underline hover:no-underline shadow-[0_8px_28px_rgba(0,0,0,0.30)] motion-safe:transition ` +
                    (heroCtaGradient
                      ? `text-white ${heroCtaGradient}`
                      : 'text-[#02665e] bg-white hover:bg-white/95')
                  }
                >
                  Accommodation only
                </Link>
                <Link
                  href="/public/nolscope"
                  className="inline-flex items-center justify-center rounded-full px-8 h-11 bg-white/12 ring-1 ring-white/30 text-white text-sm font-semibold no-underline hover:no-underline motion-safe:transition hover:bg-white/18"
                >
                  Estimate full trip
                </Link>
              </div>
            </div>
          </div>
        </div>

        {(() => {
          const hasZones = Array.isArray(data.zones) && data.zones.length;
          const allSites: TourismSite[] = hasZones
            ? (data.zones ?? []).flatMap((z) => z.items)
            : [...(data.major ?? []), ...(data.minor ?? [])];

          const uniqueSites = Array.from(
            new Map(
              allSites
                .filter((s): s is TourismSite & { slug: string } => typeof s.slug === "string" && s.slug.length > 0)
                .map((s) => [s.slug, s] as const),
            ).values(),
          ).sort((a, b) => a.name.localeCompare(b.name));

          const basePath = `/public/countries/${encodeURIComponent(data.id)}`;

          return (
            <div className="mt-5">
              <div className="rounded-2xl border border-slate-200/60 bg-white/90 backdrop-blur-md shadow-[0_4px_18px_rgba(2,6,23,0.06)] px-4 py-4 sm:px-5">
                <div className="mb-3 flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: '#02665e' }} />
                  <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-slate-400">Filter parks &amp; zones</span>
                </div>
                <CountryFiltersRow
                  basePath={basePath}
                  hasZones={Boolean(hasZones)}
                  zones={(data.zones ?? []).map((z) => z.title)}
                  sites={uniqueSites.map((s) => ({ value: s.slug, label: s.name }))}
                  zone={zoneFilter}
                  category={categoryFilter}
                  site={siteFilter}
                />
              </div>
            </div>
          );
        })()}

        {(() => {
          const basePath = `/public/countries/${encodeURIComponent(data.id)}`;

          const matches = (s: TourismSite) => {
            if (siteFilter && s.slug !== siteFilter) return false;
            return true;
          };

          if (siteFilter && selectedSites.length) {
            return (
              <div className="mt-8">
                <CountryTourismSiteList
                  title=""
                  items={selectedSites}
                  hideHeader
                  defaultOpenFirst
                  propertyGrid="wide"
                  basePath={basePath}
                />
              </div>
            );
          }

          if (Array.isArray(data.zones) && data.zones.length) {
            const filteredZones = (data.zones ?? [])
              .filter((z) => (!zoneFilter ? true : z.title === zoneFilter))
              .map((z) => ({
                ...z,
                items: (z.items ?? []).filter(matches),
              }))
              .filter((z) => z.items.length > 0);

            if (!filteredZones.length) {
              return (
                <div className="mt-8 rounded-3xl bg-white/70 backdrop-blur-xl border border-slate-200/70 p-6 text-center">
                  <div className="text-slate-900 font-semibold">No parks match your filters</div>
                  <div className="mt-1 text-sm text-slate-600">Try clearing a filter or searching a different name.</div>
                </div>
              );
            }

            return (
              <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
                {filteredZones.map((z) => (
                  <CountryTourismSiteList key={z.title} title={z.title} items={z.items} basePath={basePath} />
                ))}
              </div>
            );
          }

          const majorFiltered = (data.major ?? []).filter(matches);
          const minorFiltered = (data.minor ?? []).filter(matches);
          const showMajor = categoryFilter === "all" || categoryFilter === "major";
          const showMinor = categoryFilter === "all" || categoryFilter === "minor";
          const listsToShow = [showMajor ? 1 : 0, showMinor ? 1 : 0].reduce((a, b) => a + b, 0);

          if ((showMajor && !majorFiltered.length) && (showMinor && !minorFiltered.length)) {
            return (
              <div className="mt-8 rounded-3xl bg-white/70 backdrop-blur-xl border border-slate-200/70 p-6 text-center">
                <div className="text-slate-900 font-semibold">No sites match your filters</div>
                <div className="mt-1 text-sm text-slate-600">Try clearing a filter or searching a different name.</div>
              </div>
            );
          }

          return (
            <div className={`mt-8 grid grid-cols-1 ${listsToShow === 1 ? "lg:grid-cols-1" : "lg:grid-cols-2"} gap-6`}>
              {showMajor ? <CountryTourismSiteList title="Major tourist sites" items={majorFiltered} basePath={basePath} /> : null}
              {showMinor ? <CountryTourismSiteList title="More to explore" items={minorFiltered} basePath={basePath} /> : null}
            </div>
          );
        })()}

        {/* ── NoLSAF advantage ─────────────────────────────────── */}
        <div className="mt-10 overflow-hidden rounded-[24px] bg-white border border-slate-100 shadow-[0_8px_40px_rgba(2,6,23,0.10)]">

          {/* rainbow top strip */}
          <div className="h-[5px] w-full grid grid-cols-3">
            <div style={{ background: '#02665e' }} />
            <div style={{ background: '#10b981' }} />
            <div style={{ background: '#02b4f5' }} />
          </div>

          {/* header area */}
          <div className="px-6 pt-8 pb-6 sm:px-10 sm:pt-10 flex flex-col md:flex-row md:items-start md:justify-between gap-6">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 mb-4" style={{ background: 'rgba(2,102,94,0.08)' }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: '#02665e' }} />
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase" style={{ color: '#02665e' }}>Why NoLSAF</span>
              </div>
              <h2 className="text-slate-900 text-2xl sm:text-[2rem] font-extrabold tracking-tight leading-snug">
                The{' '}
                <span style={{ color: '#02665e' }}>NoLSAF</span>
                {' '}advantage
              </h2>
              <p className="mt-3 text-slate-500 text-sm sm:text-base leading-relaxed max-w-[54ch]">
                A tourism trip is only smooth when stays, transport, and verification work together. NoLSAF connects the steps so you don&apos;t have to piece everything together.
              </p>
            </div>
            <div className="flex flex-wrap gap-3 shrink-0 md:pt-2">
              <Link
                href={`/public/properties?country=${encodeURIComponent(data.id)}&page=1`}
                className="inline-flex items-center justify-center rounded-full px-7 h-11 text-sm font-bold no-underline hover:no-underline shadow-[0_6px_20px_rgba(2,102,94,0.28)] motion-safe:transition hover:opacity-90 text-white"
                style={{ background: '#02665e' }}
              >
                Start booking
              </Link>
              <Link
                href="/public/group-stays"
                className="inline-flex items-center justify-center rounded-full px-7 h-11 bg-white border border-slate-200 text-slate-800 text-sm font-semibold no-underline hover:no-underline motion-safe:transition hover:border-slate-300 hover:bg-slate-50"
              >
                Group stays
              </Link>
            </div>
          </div>

          {/* divider */}
          <div className="mx-6 sm:mx-10 border-t border-slate-100" />

          {/* benefit tiles */}
          <div className="px-4 pt-5 pb-6 sm:px-6 sm:pb-8 grid grid-cols-1 md:grid-cols-3 gap-4">

            {/* tile 1 — emerald */}
            <div className="relative overflow-hidden rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'linear-gradient(135deg,#f0fdf8 0%,#dcfce7 100%)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-sm" style={{ background: '#02665e' }}>
                01
              </div>
              <div className="text-slate-900 font-bold tracking-tight">Verified stays</div>
              <p className="text-[13px] text-slate-500 leading-relaxed">Book listings with clearer details so you can match location to your itinerary.</p>
              <div className="pointer-events-none absolute -bottom-4 -right-4 w-20 h-20 rounded-full opacity-30" style={{ background: '#02665e' }} />
            </div>

            {/* tile 2 — sky */}
            <div className="relative overflow-hidden rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'linear-gradient(135deg,#f0f9ff 0%,#e0f2fe 100%)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-sm" style={{ background: '#0284c7' }}>
                02
              </div>
              <div className="text-slate-900 font-bold tracking-tight">Coordinated transport</div>
              <p className="text-[13px] text-slate-500 leading-relaxed">Add pickup and move from booking to arrival with confirmation steps.</p>
              <div className="pointer-events-none absolute -bottom-4 -right-4 w-20 h-20 rounded-full opacity-25" style={{ background: '#0284c7' }} />
            </div>

            {/* tile 3 — amber */}
            <div className="relative overflow-hidden rounded-2xl p-5 flex flex-col gap-3" style={{ background: 'linear-gradient(135deg,#fffbeb 0%,#fef3c7 100%)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white text-sm font-black shadow-sm" style={{ background: '#b45309' }}>
                03
              </div>
              <div className="text-slate-900 font-bold tracking-tight">Secure payments + support</div>
              <p className="text-[13px] text-slate-500 leading-relaxed">Pay with trusted methods and get assistance when you need it.</p>
              <div className="pointer-events-none absolute -bottom-4 -right-4 w-20 h-20 rounded-full opacity-25" style={{ background: '#b45309' }} />
            </div>

          </div>
        </div>
      </section>
    </main>
  );
}
