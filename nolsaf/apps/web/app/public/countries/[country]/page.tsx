import Link from "next/link";
import Image from "next/image";
import type { Metadata } from "next";
import { Car, ChevronRight, ShieldCheck, Wallet } from "lucide-react";
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
                  href="/public/properties"
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
    <main className="relative min-h-screen overflow-hidden bg-[#f6f8f7] text-slate-900 header-offset">
      <section className="public-container py-8 sm:py-10">

        {/* ── Where you are ── */}
        <nav aria-label="Breadcrumb" className="mb-3 flex items-center gap-1.5 text-[12.5px] text-slate-500">
          <Link href="/public" className="inline-flex items-center gap-1 font-medium text-slate-500 no-underline hover:text-[#02665e] hover:no-underline">
            <ChevronRight className="h-3.5 w-3.5 rotate-180" aria-hidden /> Home
          </Link>
          <span aria-hidden className="text-slate-300">/</span>
          <span className="font-medium text-slate-800">{data.name}</span>
        </nav>

        {/* ── Hero: the promise and the two actions, with one photo ── */}
        <div className="overflow-hidden rounded-xl bg-[#012a26] text-white">
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center lg:gap-10">
            <div className="min-w-0">
              <p className="m-0 inline-flex items-center gap-2 text-[12px] font-semibold text-[#5eead4]">
                <span className="flex h-2.5 w-5 overflow-hidden rounded-[2px] ring-1 ring-white/30" aria-hidden>
                  <span className="h-full flex-1" style={{ background: "#1C8B3C" }} />
                  <span className="h-full w-[3px]" style={{ background: "#F7D100" }} />
                  <span className="h-full w-[3px]" style={{ background: "#0b0b0b" }} />
                  <span className="h-full w-[3px]" style={{ background: "#F7D100" }} />
                  <span className="h-full flex-1" style={{ background: "#00A3DD" }} />
                </span>
                {data.name}
              </p>
              <h1 className="m-0 mt-3 text-[26px] font-bold leading-[1.15] tracking-tight sm:text-[34px]">
                Plan your trip <span className="text-[#5eead4]">park by park.</span>
              </h1>
              <p className="m-0 mt-2.5 max-w-[56ch] text-[14.5px] leading-6 text-white/70">{data.hero.body}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={`/public/properties?country=${encodeURIComponent(data.id)}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white px-4 text-[13.5px] font-semibold text-[#02665e] no-underline transition-colors hover:bg-emerald-50 hover:no-underline">
                  Find a stay <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/public/nolscope" className="inline-flex h-10 items-center rounded-lg border border-solid border-white/25 px-4 text-[13.5px] font-semibold text-white no-underline transition-colors hover:bg-white/[0.06] hover:no-underline">
                  Estimate the full trip
                </Link>
              </div>
            </div>

            <figure className="relative m-0 hidden aspect-[4/3] w-full overflow-hidden rounded-lg ring-1 ring-white/10 sm:block lg:aspect-[16/11]">
              <Image src="/assets/Toursite.jpeg" alt="Mount Kilimanjaro with elephants and zebras on the plains" fill priority sizes="(min-width: 1024px) 360px, 100vw" className="object-cover" style={{ objectPosition: "50% 65%" }} />
              <figcaption className="absolute bottom-2.5 left-2.5 rounded bg-[#012a26]/90 px-2 py-0.5 text-[11px] font-medium text-white">Kilimanjaro, Northern Zone</figcaption>
            </figure>
          </div>
        </div>

        {/* ── Parks by zone: one bar with the count, the zones and a quick jump ── */}
        {(() => {
          const zones = data.zones ?? [];
          const hasZones = Array.isArray(data.zones) && data.zones.length;
          const allSites: TourismSite[] = hasZones
            ? zones.flatMap((z) => z.items)
            : [...(data.major ?? []), ...(data.minor ?? [])];

          const uniqueSites = Array.from(
            new Map(
              allSites
                .filter((s): s is TourismSite & { slug: string } => typeof s.slug === "string" && s.slug.length > 0)
                .map((s) => [s.slug, s] as const),
            ).values(),
          ).sort((a, b) => a.name.localeCompare(b.name));

          const parkCount = new Set(zones.flatMap((z) => z.items.map((i) => i.slug || i.name))).size;
          const basePath = `/public/countries/${encodeURIComponent(data.id)}`;

          return (
            <div className="mt-4 rounded-xl border border-solid border-slate-300/80 bg-white px-4 py-3.5 sm:px-5">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="m-0 text-[15px] font-semibold text-slate-900">Parks by zone</h2>
                {hasZones ? (
                  <p className="m-0 text-[12.5px] text-slate-500">
                    <span className="font-semibold tabular-nums text-slate-800">{parkCount}</span> national parks across {zones.length} zones
                  </p>
                ) : null}
              </div>
              <CountryFiltersRow
                basePath={basePath}
                hasZones={Boolean(hasZones)}
                zones={zones.map((z) => z.title)}
                zoneCounts={Object.fromEntries(zones.map((z) => [z.title, z.items.length]))}
                sites={uniqueSites.map((s) => ({ value: s.slug, label: s.name }))}
                zone={zoneFilter}
                category={categoryFilter}
                site={siteFilter}
              />
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
                <div className="mt-5 rounded-xl border border-solid border-slate-200 bg-white p-6 text-center">
                  <div className="text-slate-900 font-semibold">No parks match your filters</div>
                  <div className="mt-1 text-sm text-slate-600">Try clearing a filter or searching a different name.</div>
                </div>
              );
            }

            // items-start: each zone card is as tall as its own list, never stretched to its neighbour
            return (
              <div className={`mt-4 grid grid-cols-1 items-start gap-4 ${filteredZones.length > 1 ? "xl:grid-cols-2" : ""}`}>
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
              <div className="mt-5 rounded-xl border border-solid border-slate-200 bg-white p-6 text-center">
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

        {/* Why NoLSAF: one plain card, pitch on the left, three proofs on the right */}
        <div className="mt-6 overflow-hidden rounded-xl border border-solid border-slate-300/80 bg-white">
          <div className="flex flex-col lg:flex-row">
            <div className="flex flex-col justify-between gap-6 p-6 sm:p-8" style={{ flex: "1 1 0%", minWidth: 0 }}>
              <div>
                <p className="m-0 text-[12px] font-semibold text-[#02665e]">Why book with NoLSAF</p>
                <h2 className="m-0 mt-1.5 text-[21px] font-bold leading-tight tracking-tight text-slate-900 sm:text-[24px]">
                  One booking for the stay, the ride and the help in between.
                </h2>
                <p className="m-0 mt-3 text-sm leading-6 text-slate-500" style={{ maxWidth: 520 }}>
                  A safari only runs smoothly when the stay, the transport and the checks work together. NoLSAF connects them, so you do not have to.
                </p>
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Link href={`/public/properties?country=${encodeURIComponent(data.id)}`} className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#02665e] px-4 text-[13.5px] font-semibold text-white no-underline hover:bg-[#014d47] hover:no-underline">
                  Start booking <ChevronRight className="h-4 w-4" aria-hidden />
                </Link>
                <Link href="/public/group-stays" className="inline-flex h-10 items-center rounded-lg border border-solid border-slate-300 bg-white px-4 text-[13.5px] font-semibold text-slate-800 no-underline hover:border-slate-400 hover:bg-slate-50 hover:no-underline">
                  Plan a group stay
                </Link>
              </div>
            </div>

            <ul className="m-0 list-none border-0 border-t border-solid border-slate-100 p-0 lg:border-l lg:border-t-0" style={{ flex: "1 1 0%", minWidth: 0 }}>
              {[
                { Icon: ShieldCheck, title: "Verified stays", body: "Every listing is reviewed before it goes live, with clear details so you can match the location to your route." },
                { Icon: Car, title: "Transport that lines up", body: "Add a pickup when you book. Your ride is tied to the same booking, with confirmation at each step." },
                { Icon: Wallet, title: "Secure payment, real support", body: "Pay with mobile money or card through trusted providers, and reach the NoLSAF team when you need help." },
              ].map((item, index) => (
                <li key={item.title} className={`flex items-start gap-4 px-6 py-5 sm:px-8 ${index > 0 ? "border-0 border-t border-solid border-slate-100" : ""}`}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/[0.08] text-[#02665e]"><item.Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-900">{item.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-6 text-slate-500">{item.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
