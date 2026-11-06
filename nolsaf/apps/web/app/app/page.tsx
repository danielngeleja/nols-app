import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import QRCode from "qrcode";
import Image from "next/image";
import { ArrowRight, BadgeCheck, BatteryFull, CalendarCheck2, Compass, Heart, MapPin, Search, ShieldCheck, SlidersHorizontal, Smartphone, Star, TicketCheck, UserRound, Wifi } from "lucide-react";
import { StoreBadge } from "@/components/app-distribution/AppDownloadPromotion";
import { SITE_URL } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";

const PAGE_URL = `${SITE_URL}/app`;
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.nolsaf.app";
const title = "NoLSAF Android App | Download on Google Play";
const description = "Get the NoLSAF traveller app for Android to discover verified stays, explore trips and keep your travel bookings close at hand.";

async function publishedPlayUrl(): Promise<string | null> {
  const apiOrigin = (process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000")).replace(/\/$/, "");
  if (!apiOrigin) return null;
  try {
    const response = await fetch(`${apiOrigin}/api/public/app-distribution`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(2500) });
    if (!response.ok) return null;
    const settings = await response.json() as { enabled?: boolean; androidStoreUrl?: string | null };
    if (!settings.enabled || !settings.androidStoreUrl) return null;
    const url = new URL(settings.androidStoreUrl);
    return url.protocol === "https:" && url.hostname === "play.google.com" && url.pathname === "/store/apps/details" && url.searchParams.get("id") === "com.nolsaf.app"
      ? PLAY_URL
      : null;
  } catch {
    return null;
  }
}

async function installQrSvg(url: string): Promise<string | null> {
  try {
    return await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: "M", color: { dark: "#012a26", light: "#ffffff" } });
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: PAGE_URL },
  openGraph: { type: "website", title, description, url: PAGE_URL },
};

const journey = [
  { icon: Search, title: "Explore", detail: "Search a destination and browse stays that were checked before they were listed." },
  { icon: CalendarCheck2, title: "Choose", detail: "Compare rooms, beds, guest capacity and dates, then book with the details in front of you." },
  { icon: TicketCheck, title: "Travel", detail: "Your confirmed booking stays on your phone, ready when you arrive." },
];

const faqs = [
  { q: "Which phones can use the app?", a: "The NoLSAF app is on Android first. On iPhone, everything works in Safari at nolsaf.com, and you can add it to your Home Screen." },
  { q: "Do I need a new account?", a: "No. Sign in with the same NoLSAF account you use on the website and your bookings come with you." },
  { q: "Where does NoLSAF operate?", a: "NoLSAF is launched in Tanzania, with stays and trips across the country." },
];

function PlayBadge({ href, dark = false }: { href: string; dark?: boolean }) {
  return <StoreBadge item={{ href, platform: "Android", store: "Google Play", kind: "android" }} compact={false} dark={dark} />;
}

function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[224px]" aria-hidden>
      <div className="relative rounded-[2rem] bg-slate-950 p-[5px] shadow-[0_28px_56px_-18px_rgba(0,0,0,0.6)] ring-1 ring-white/15">
        <div className="relative overflow-hidden rounded-[1.7rem] bg-slate-50">
          {/* Status bar with a small camera island */}
          <div className="relative flex h-7 items-center justify-between px-5 text-[9px] font-semibold text-slate-900">
            <span className="tabular-nums">9:41</span>
            <span className="absolute left-1/2 top-1.5 h-[14px] w-14 -translate-x-1/2 rounded-full bg-slate-950" />
            <span className="flex items-center gap-1"><Wifi className="h-2.5 w-2.5" /><BatteryFull className="h-3 w-3" /></span>
          </div>

          <div className="px-3.5 pb-4 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="m-0 text-[9px] font-medium text-slate-500">Karibu</p>
                <p className="m-0 text-[13px] font-bold tracking-tight text-slate-900">Where to next?</p>
              </div>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-brand ring-1 ring-slate-200"><UserRound className="h-3.5 w-3.5" /></span>
            </div>

            <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-white px-2.5 py-2 text-[10px] text-slate-500 ring-1 ring-slate-200">
              <Search className="h-3 w-3 text-slate-400" />
              <span className="flex-1">Zanzibar, 2 guests</span>
              <span className="grid h-5 w-5 place-items-center rounded-md bg-brand text-white"><SlidersHorizontal className="h-2.5 w-2.5" /></span>
            </div>

            <div className="mt-2.5 flex gap-3 border-0 border-b border-solid border-slate-200 text-[10px] font-semibold">
              <span className="border-0 border-b-2 border-solid border-brand pb-1.5 text-brand">Stays</span>
              <span className="pb-1.5 text-slate-400">Lodges</span>
              <span className="pb-1.5 text-slate-400">Trips</span>
            </div>

            <div className="mt-3 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
              <div className="relative h-[104px]">
                <Image src="/assets/villa.jpg" alt="" fill sizes="214px" className="object-cover" />
                <span className="absolute left-1.5 top-1.5 inline-flex items-center gap-1 rounded bg-white/95 px-1.5 py-0.5 text-[8px] font-bold text-brand"><BadgeCheck className="h-2.5 w-2.5" /> Verified</span>
                <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-white/95 text-slate-700"><Heart className="h-2.5 w-2.5" /></span>
              </div>
              <div className="px-2.5 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="m-0 truncate text-[10.5px] font-bold text-slate-900">Ocean view villa</p>
                  <span className="inline-flex shrink-0 items-center gap-0.5 text-[9px] font-semibold text-slate-700"><Star className="h-2.5 w-2.5 fill-amber-400 text-amber-400" /> 4.8</span>
                </div>
                <p className="m-0 mt-0.5 text-[9px] text-slate-500">Nungwi, Zanzibar &middot; 2 beds &middot; 4 guests</p>
              </div>
            </div>

            <div className="mt-2 overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
              <div className="relative h-[104px]">
                <Image src="/assets/hotel.jpg" alt="" fill sizes="214px" className="object-cover" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function AppDownloadPage() {
  const playUrl = await publishedPlayUrl();
  const qrSvg = playUrl ? await installQrSvg(playUrl) : null;
  const nonce = (await headers()).get("x-nonce") || undefined;
  const appJsonLd = playUrl ? {
    "@context": "https://schema.org",
    "@type": "MobileApplication",
    "@id": `${PAGE_URL}#android-app`,
    name: "NoLSAF",
    description,
    url: PAGE_URL,
    installUrl: playUrl,
    downloadUrl: playUrl,
    operatingSystem: "Android",
    applicationCategory: "TravelApplication",
    publisher: { "@id": `${SITE_URL}/#organization` },
  } : null;

  return (
    <main id="app-download" className="pb-16 text-slate-900">
      <style>{"#app-download, #app-download * { box-sizing: border-box; }"}</style>
      {appJsonLd ? <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: serializeJsonLd(appJsonLd) }} /> : null}

      {/* Hero: the promise, the install path that suits the device, and a preview of the app */}
      <section className="public-container pt-4 sm:pt-6">
        <div className="relative grid overflow-hidden rounded-xl border border-solid border-brand-800 bg-brand-900 text-white lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_80%_at_0%_0%,rgba(2,138,122,0.28)_0%,transparent_70%)]" aria-hidden />

          {/* Message and install actions */}
          <div className="relative flex min-w-0 flex-col justify-center p-6 sm:p-8 lg:p-10">
            <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-brand-200">
              <span className="inline-flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" /> NoLSAF traveller app</span>
              <span className="h-3 w-px bg-white/20" aria-hidden />
              <span className="inline-flex items-center gap-1.5 text-white/70">
                <span className={`h-1.5 w-1.5 rounded-full ${playUrl ? "bg-brand-300" : "bg-white/40"}`} aria-hidden />
                {playUrl ? "Available on Android" : "Coming to Android"}
              </span>
            </p>
            <h1 className="m-0 mt-4 max-w-[18ch] text-[1.75rem] font-bold leading-[1.15] tracking-tight sm:text-[2.35rem]">
              Tanzania, booked from your <span className="text-brand-300">pocket.</span>
            </h1>
            <p className="m-0 mt-3 max-w-[44ch] text-sm leading-6 text-white/65 sm:text-[15px]">
              Discover verified stays, plan trips and keep every booking within reach. One account across the web and your phone.
            </p>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              {playUrl ? (
                <>
                  <PlayBadge href={playUrl} dark />
                  {qrSvg ? (
                    <div className="hidden h-[52px] items-center gap-2.5 whitespace-nowrap rounded-lg border border-solid border-white/15 py-1 pl-1 pr-3.5 lg:flex">
                      <div className="h-10 w-10 rounded-md bg-white p-1 [&>svg]:block [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: qrSvg }} role="img" aria-label="QR code to install the NoLSAF app from Google Play" />
                      <span className="text-[11px] leading-4 text-white/55"><strong className="block text-xs font-semibold text-white">Scan to install</strong>with your Android phone</span>
                    </div>
                  ) : null}
                </>
              ) : (
                <p className="m-0 w-full max-w-[44ch] rounded-lg border border-solid border-white/15 px-4 py-3 text-sm leading-6 text-white/75">
                  The Android app is finishing its Google Play release. Everything is already available on the web.
                </p>
              )}
              <Link href="/public" className="inline-flex h-[52px] items-center gap-2 px-1 text-sm font-semibold text-white no-underline transition hover:text-brand-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-300">
                Explore on the web <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <dl className="m-0 mt-8 grid grid-cols-3 gap-4 border-0 border-t border-solid border-white/10 pt-5">
              {[
                { icon: BadgeCheck, term: "Verified stays", desc: "Checked before listing" },
                { icon: Compass, term: "Trips and tours", desc: "Across Tanzania" },
                { icon: TicketCheck, term: "Your bookings", desc: "Always on hand" },
              ].map(({ icon: Icon, term, desc }) => (
                <div key={term} className="min-w-0">
                  <dt className="flex items-center gap-1.5 text-xs font-semibold text-white"><Icon className="h-3.5 w-3.5 shrink-0 text-brand-300" /> {term}</dt>
                  <dd className="m-0 mt-1 text-[11px] text-white/50">{desc}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* App preview panel: framed on a quiet grid, the phone is cropped by the bottom edge */}
          <div className="relative h-[250px] min-w-0 overflow-hidden border-0 border-t border-solid border-white/10 bg-brand-800/40 sm:h-[290px] lg:h-auto lg:min-h-[380px] lg:border-l lg:border-t-0">
            <div className="pointer-events-none absolute inset-0 opacity-60 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(70%_70%_at_50%_45%,black,transparent)]" aria-hidden />
            <span className="absolute left-4 top-3 text-[11px] font-medium text-white/40">App preview</span>
            <div className="absolute inset-x-0 top-10 lg:top-12">
              <PhoneMockup />
            </div>
          </div>
        </div>
      </section>

      {/* Journey: three steps joined by a single line, read left to right or top to bottom */}
      <section className="public-container mt-10" aria-labelledby="app-journey">
        <div className="max-w-[40ch]">
          <p className="m-0 text-sm font-semibold text-brand">From search to stay</p>
          <h2 id="app-journey" className="m-0 mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Three steps. No guesswork.</h2>
        </div>
        <ol className="relative m-0 mt-8 grid list-none gap-4 p-0 md:grid-cols-3 md:gap-6">
          <span className="pointer-events-none absolute left-6 right-6 top-6 hidden h-px bg-gradient-to-r from-brand-200 via-brand-400 to-brand-200 md:block" aria-hidden />
          {journey.map(({ icon: Icon, title: stepTitle, detail }, index) => (
            <li key={stepTitle} className="relative flex gap-4 md:block">
              <span className="relative z-10 grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-brand text-white ring-4 ring-slate-50"><Icon className="h-5 w-5" /></span>
              <div className="md:mt-5">
                <p className="m-0 font-mono text-[11px] text-slate-400">Step {index + 1}</p>
                <h3 className="m-0 mt-0.5 text-lg font-bold">{stepTitle}</h3>
                <p className="m-0 mt-1.5 max-w-[34ch] text-sm leading-6 text-slate-600">{detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Why the app: a bento grid where the lead benefit gets the large tile */}
      <section className="public-container mt-10" aria-labelledby="app-benefits">
        <h2 id="app-benefits" className="m-0 text-2xl font-bold tracking-tight sm:text-3xl">Built for how you travel</h2>
        <div className="mt-6 grid gap-4 md:grid-cols-3 md:grid-rows-2">
          <div className="card relative overflow-hidden rounded-xl p-6 md:col-span-2 md:row-span-2 md:p-8">
            <span className="relative grid h-11 w-11 place-items-center rounded-lg bg-brand-50 text-brand"><ShieldCheck className="h-5 w-5" /></span>
            <h3 className="relative m-0 mt-5 text-xl font-bold sm:text-2xl">Verified before it is listed</h3>
            <p className="relative m-0 mt-2 max-w-[46ch] text-sm leading-6 text-slate-600">
              Every stay on NoLSAF goes through review before guests can book it. You see the rooms, beds and guest capacity up front, so what you book is what you get.
            </p>
            <div className="relative mt-6 flex flex-wrap gap-2">
              {["Rooms and beds", "Guest capacity", "Exact dates", "Booking record"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5 rounded-md border border-solid border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700"><BadgeCheck className="h-3.5 w-3.5 text-brand" /> {item}</span>
              ))}
            </div>
          </div>
          <div className="card rounded-xl p-6">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand"><TicketCheck className="h-5 w-5" /></span>
            <h3 className="m-0 mt-4 text-base font-bold">Bookings in your pocket</h3>
            <p className="m-0 mt-1.5 text-sm leading-6 text-slate-600">Open your stay details at check in, even on the road.</p>
          </div>
          <div className="card rounded-xl p-6">
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-brand-50 text-brand"><UserRound className="h-5 w-5" /></span>
            <h3 className="m-0 mt-4 text-base font-bold">One account everywhere</h3>
            <p className="m-0 mt-1.5 text-sm leading-6 text-slate-600">Start on the web, continue on your phone. Same sign in.</p>
          </div>
        </div>
      </section>

      {/* Questions people ask before installing */}
      <section className="public-container mt-10" aria-labelledby="app-faq">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10">
          <div>
            <h2 id="app-faq" className="m-0 text-2xl font-bold tracking-tight sm:text-3xl">Good to know</h2>
            <p className="m-0 mt-2 flex items-center gap-2 text-sm text-slate-500"><MapPin className="h-4 w-4 text-brand" /> Launched in Tanzania.</p>
          </div>
          <div className="card divide-y divide-slate-100 overflow-hidden rounded-xl p-0">
            {faqs.map(({ q, a }) => (
              <details key={q} className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-900">
                  {q}
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-500 transition group-open:rotate-45 group-open:bg-brand group-open:text-white">+</span>
                </summary>
                <p className="m-0 mt-2 text-sm leading-6 text-slate-600">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="public-container mt-10">
        <div className="flex flex-col items-start justify-between gap-5 rounded-xl border border-solid border-brand-100 bg-brand-50 px-6 py-7 sm:flex-row sm:items-center sm:px-8">
          <div>
            <h2 className="m-0 text-xl font-bold tracking-tight text-brand-900">Your next stay is a tap away.</h2>
            <p className="m-0 mt-1 text-sm text-brand-700">{playUrl ? "Install the app, or keep exploring on the web." : "Start exploring on the web today."}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {playUrl ? <PlayBadge href={playUrl} /> : null}
            <Link href="/public/properties" className="btn btn-outline h-12 rounded-lg px-5 font-semibold no-underline">Browse stays <ArrowRight className="h-4 w-4" /></Link>
          </div>
        </div>
      </section>
    </main>
  );
}
