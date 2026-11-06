import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { ArrowRight, BadgeCheck, CalendarDays, ChevronRight, Cpu, ExternalLink, Globe2, GraduationCap, Linkedin, MapPin, Quote, Users } from "lucide-react";
import { SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";
import { FOUNDERS, founderPersonJsonLd, founderUrl, type Founder } from "@/lib/founders";

/**
 * A founder's profile on nolsaf.com: the page a search for their name should
 * find. Title, heading and Person markup all say "<name>, <role> of NoLSAF",
 * and sameAs ties the same person to their social profiles.
 */

export function generateStaticParams() {
  return FOUNDERS.map((f) => ({ slug: f.slug }));
}

function findFounder(slug: string): Founder | undefined {
  return FOUNDERS.find((f) => f.slug === slug);
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const f = findFounder(slug);
  if (!f) return {};
  const title = `${f.name}, ${f.headline}`;
  const description = `${f.name} is the ${f.role.toLowerCase()} of NoLSAF, the travel platform launched in Tanzania and growing across Africa, with verified stays, transport and tours in one booking. ${f.bio[0].split(". ").slice(1).find((x) => !/^Launched in /.test(x)) ?? ""}`.trim();
  return {
    title,
    description,
    alternates: { canonical: founderUrl(f) },
    keywords: [f.name, ...f.alternateNames, `${f.name} NoLSAF`, "NoLSAF founder", "NoLSAF", "NoLS Africa"],
    openGraph: {
      type: "profile",
      title,
      description,
      url: founderUrl(f),
      images: [{ url: `${SITE_URL}${f.image}`, alt: f.imageAlt }],
    },
    twitter: { card: "summary", title, description },
  };
}

const socialLabel = (url: string) => (/linkedin\.com/i.test(url) ? "LinkedIn" : /instagram\.com/i.test(url) ? "Instagram" : /x\.com|twitter\.com/i.test(url) ? "X" : "Profile");

export default async function FounderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const f = findFounder(slug);
  if (!f) notFound();
  const others = FOUNDERS.filter((x) => x.slug !== f.slug);
  const nonce = (await headers()).get("x-nonce") || undefined;

  // ProfilePage with the Person as its subject, plus where the page sits in the site
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ProfilePage",
        "@id": `${founderUrl(f)}#page`,
        url: founderUrl(f),
        name: `${f.name}, ${f.headline}`,
        mainEntity: { "@id": `${founderUrl(f)}#person` },
        isPartOf: { "@id": `${SITE_URL}/#website` },
        about: { "@id": `${SITE_URL}/#organization` },
      },
      founderPersonJsonLd(f),
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "NoLSAF", item: SITE_URL },
          { "@type": "ListItem", position: 2, name: "Our story", item: `${SITE_URL}/about/story` },
          { "@type": "ListItem", position: 3, name: f.name, item: founderUrl(f) },
        ],
      },
    ],
  };

  return (
    <main id="founder-page" className="pb-16 pt-5 text-slate-900 sm:pt-7">
      <style>{"#founder-page, #founder-page * { box-sizing: border-box; }"}</style>
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />

      <div className="public-container">
        {/* Breadcrumb: the name sits inside NoLSAF, visibly and in markup */}
        <nav aria-label="Breadcrumb" className="mb-3 flex flex-wrap items-center gap-1.5 text-[12.5px] text-slate-500">
          <Link href="/public" className="font-medium text-slate-500 no-underline hover:text-[#02665e]">NoLSAF</Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden />
          <Link href="/about/story" className="font-medium text-slate-500 no-underline hover:text-[#02665e]">Our story</Link>
          <ChevronRight className="h-3.5 w-3.5 text-slate-300" aria-hidden />
          <span className="font-medium text-slate-800">{f.name}</span>
        </nav>

        {/* Profile header */}
        <header className="overflow-hidden rounded-xl bg-[#012a26] text-white">
          <div className="grid gap-6 p-5 sm:grid-cols-[160px_minmax(0,1fr)] sm:items-center sm:p-7 lg:grid-cols-[180px_minmax(0,1fr)_240px] lg:gap-7">
            <div className="relative aspect-square w-32 overflow-hidden rounded-lg ring-1 ring-white/15 sm:w-full">
              <Image src={f.image} alt={f.imageAlt} fill priority sizes="(min-width: 1024px) 180px, 160px" className="object-cover" />
            </div>

            <div className="min-w-0">
              <p className="m-0 inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#5eead4]">
                <BadgeCheck className="h-4 w-4" aria-hidden /> {f.role}, NoLSAF
              </p>
              <h1 className="m-0 mt-2 text-[28px] font-bold leading-tight tracking-tight sm:text-[36px]">{f.name}</h1>
              {/* Phones and tablets: a normal paragraph. Wide screens: the same words as a stepped pyramid that grows out from the photo. */}
              <p className={`m-0 mt-2 max-w-[60ch] text-[14.5px] leading-6 text-white/75 ${f.introPyramid?.length ? "xl:sr-only" : ""}`}>{f.bio[0]}</p>
              {f.introPyramid?.length ? (
                <p className="m-0 mt-3 hidden text-[14px] leading-[1.7] text-white/75 xl:block" aria-hidden>
                  {f.introPyramid.map((line) => (
                    <span key={line} className="block whitespace-nowrap">{line}</span>
                  ))}
                </p>
              ) : null}
              <p className="m-0 mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-white/60">
                <MapPin className="h-3.5 w-3.5" aria-hidden /> Dar es Salaam, Tanzania
              </p>
            </div>

            {/* The company first: where the name search should lead */}
            <aside className="rounded-lg bg-white/[0.06] p-4 ring-1 ring-inset ring-white/10 sm:col-span-2 lg:col-span-1">
              <div className="min-w-0">
                <p className="m-0 text-[12px] text-white/60">Building</p>
                <p className="m-0 mt-0.5 text-[17px] font-bold text-white">NoLSAF</p>
                <p className="m-0 mt-1 text-[12.5px] leading-5 text-white/65">Verified stays, transport and tours in one booking. Launched in Tanzania, growing across Africa.</p>
              </div>
              <div className="min-w-0">
              <Link href="/public" className="mt-3 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-md bg-white text-[13px] font-semibold text-[#02665e] no-underline transition-colors hover:bg-emerald-50">
                Visit NoLSAF <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
              {f.sameAs.length ? (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {f.sameAs.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener noreferrer me" className="inline-flex items-center gap-1 text-[12px] font-medium text-white/70 no-underline hover:text-white">
                      {/linkedin\.com/i.test(url) ? <Linkedin className="h-3.5 w-3.5" aria-hidden /> : <ExternalLink className="h-3.5 w-3.5" aria-hidden />}
                      {socialLabel(url)}
                    </a>
                  ))}
                </div>
              ) : null}
              </div>
            </aside>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          {/* About */}
          <section aria-labelledby="founder-about" className="rounded-xl border border-solid border-slate-300/80 bg-white p-5 sm:p-7">
            <h2 id="founder-about" className="m-0 text-[18px] font-semibold text-slate-900">About {f.name.split(" ")[0]}</h2>
            <div className="mt-3 space-y-3 text-[15px] leading-7 text-slate-700">
              {f.bio.slice(1).map((para) => (
                <p key={para.slice(0, 24)} className="m-0">{para}</p>
              ))}
            </div>

            {f.statement ? (
              <figure className="m-0 mt-5 rounded-lg border-0 border-l-[3px] border-solid border-[#02665e] bg-[#02665e]/[0.04] px-4 py-3.5">
                <Quote className="h-4 w-4 text-[#02665e]" aria-hidden />
                <blockquote className="m-0 mt-1.5 text-[15px] leading-7 text-slate-800">{f.statement}</blockquote>
                <figcaption className="mt-2 text-[12.5px] font-semibold text-slate-500">{f.name}, {f.headline}</figcaption>
              </figure>
            ) : null}

            {/* Leadership: how they lead, coordinate and manage */}
            {f.leadership?.length ? (
              <div className="mt-6 border-0 border-t border-solid border-slate-100 pt-5">
                <h2 className="m-0 flex items-center gap-2 text-[17px] font-semibold text-slate-900">
                  <Users className="h-[18px] w-[18px] text-[#02665e]" aria-hidden /> {f.leadershipTitle ?? "Leadership"}
                </h2>
                <div className="mt-2.5 space-y-3 text-[15px] leading-7 text-slate-700">
                  {f.leadership.map((para) => <p key={para.slice(0, 24)} className="m-0">{para}</p>)}
                </div>
              </div>
            ) : null}

            {/* Technology: the service gap it closes */}
            {f.technology?.length ? (
              <div className="mt-6 border-0 border-t border-solid border-slate-100 pt-5">
                <h2 className="m-0 flex items-center gap-2 text-[17px] font-semibold text-slate-900">
                  <Cpu className="h-[18px] w-[18px] text-[#02665e]" aria-hidden /> {f.technologyTitle ?? "Technology"}
                </h2>
                <div className="mt-2.5 space-y-3 text-[15px] leading-7 text-slate-700">
                  {f.technology.map((para) => <p key={para.slice(0, 24)} className="m-0">{para}</p>)}
                </div>
              </div>
            ) : null}

            {/* International forums attended */}
            {f.forums?.length ? (
              <div className="mt-6 border-0 border-t border-solid border-slate-100 pt-5">
                <h2 className="m-0 flex items-center gap-2 text-[17px] font-semibold text-slate-900">
                  <Globe2 className="h-[18px] w-[18px] text-[#02665e]" aria-hidden /> International forums
                </h2>
                <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
                  {[...f.forums].sort((a, b) => b.year - a.year).map((ev) => (
                    <li key={ev.name} className="rounded-lg border border-solid border-slate-200 p-3.5">
                      <p className="m-0 text-[15px] font-semibold text-slate-900">{ev.name}</p>
                      <p className="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-slate-500">
                        <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" aria-hidden /> {ev.venue}, {ev.city}</span>
                        <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" aria-hidden /> {ev.date}</span>
                      </p>
                      {ev.note ? <p className="m-0 mt-1.5 text-[13.5px] leading-6 text-slate-600">{ev.note}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <div className="space-y-4">
            {/* Focus at NoLSAF */}
            <section aria-labelledby="founder-focus" className="rounded-xl border border-solid border-slate-300/80 bg-white p-5">
              <h2 id="founder-focus" className="m-0 text-[15px] font-semibold text-slate-900">Focus at NoLSAF</h2>
              <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
                {f.focus.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-[13.5px] text-slate-700">
                    <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden /> {item}
                  </li>
                ))}
              </ul>
            </section>

            {/* Education */}
            {f.education?.length ? (
              <section aria-labelledby="founder-education" className="rounded-xl border border-solid border-slate-300/80 bg-white p-5">
                <h2 id="founder-education" className="m-0 text-[15px] font-semibold text-slate-900">Education</h2>
                <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
                  {f.education.map((e) => (
                    <li key={e.name} className="flex items-start gap-2.5 text-[13.5px] text-slate-700">
                      <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
                      <span>
                        <span className="block font-semibold text-slate-900">{e.name}</span>
                        {e.note ? <span className="block text-[12.5px] text-slate-500">{e.note}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* The other founders: one team, linked both ways */}
            {others.length ? (
              <section aria-labelledby="founder-team" className="rounded-xl border border-solid border-slate-300/80 bg-white p-5">
                <h2 id="founder-team" className="m-0 text-[15px] font-semibold text-slate-900">Founding team</h2>
                <ul className="m-0 mt-2.5 list-none space-y-1 p-0">
                  {others.map((o) => (
                    <li key={o.slug}>
                      <Link href={`/founders/${o.slug}`} className="group flex items-center gap-3 rounded-lg p-1.5 no-underline hover:bg-slate-50">
                        <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md ring-1 ring-slate-200">
                          <Image src={o.image} alt={o.imageAlt} fill sizes="40px" className="object-cover" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-semibold text-slate-900 group-hover:text-[#02665e]">{o.name}</span>
                          <span className="block text-[12px] text-slate-500">{o.headline}</span>
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 group-hover:text-[#02665e]" aria-hidden />
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link href="/about/story" className="mt-3 inline-flex items-center gap-1 text-[13px] font-semibold text-[#02665e] no-underline hover:underline">
                  Read the NoLSAF story <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
