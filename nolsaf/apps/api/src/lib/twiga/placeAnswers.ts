import { prisma } from "@nolsaf/prisma";
import { calculateAvailability } from "../availabilityCalculator";
import { buildPropertySlug } from "../publicPropertyDto";
import { formatMention, resolveMentions, type ResolvedMention } from "./mentions";
import { fromDay, parseStay, type StayRequest } from "./stayDates";
import type { TwigaLink } from "./types";

/*
 * Answers about a tagged property or region, read live from the listing.
 *
 * When a visitor tags "@Sea Breeze Villa this weekend", a registry article
 * about "how booking works" is the wrong answer. This module reads the listing
 * itself, works out the dates, checks sellable availability with the same
 * calculator the booking page uses, and replies with the facts and a link that
 * opens the booking page on those dates. Alternatives it suggests are written as
 * mention tokens, so they render as tappable chips in the widget.
 *
 * Everything here is read-only and limited to APPROVED listings.
 */

export type PlaceAnswer = { text: string; links: TwigaLink[]; followUps: string[] };

type Lang = "en" | "sw";

const t = (lang: Lang, en: string, sw: string) => (lang === "sw" ? sw : en);

const TYPE_LABELS: Record<string, { en: string; sw: string }> = {
  VILLA: { en: "villa", sw: "villa" },
  APARTMENT: { en: "apartment", sw: "apatimenti" },
  HOTEL: { en: "hotel", sw: "hoteli" },
  LODGE: { en: "lodge", sw: "lodge" },
  CONDO: { en: "condo", sw: "kondo" },
  GUEST_HOUSE: { en: "guest house", sw: "nyumba ya wageni" },
  BUNGALOW: { en: "bungalow", sw: "bungalow" },
  CABIN: { en: "cabin", sw: "kibanda" },
  HOMESTAY: { en: "homestay", sw: "homestay" },
  TOWNHOUSE: { en: "townhouse", sw: "nyumba ya mjini" },
  HOUSE: { en: "house", sw: "nyumba" },
};

function typeLabel(type: string | null | undefined, lang: Lang): string {
  const entry = TYPE_LABELS[String(type ?? "").toUpperCase()];
  return entry ? entry[lang] : t(lang, "stay", "malazi");
}

function money(amount: number, currency: string | null | undefined): string {
  return `${currency || "TZS"} ${Math.round(amount).toLocaleString("en-US")}`;
}

function dayLabel(day: string, lang: Lang): string {
  return fromDay(day).toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function rangeLabel(stay: StayRequest, lang: Lang): string {
  const nights = stay.nights ?? 1;
  const n = t(lang, nights === 1 ? "1 night" : `${nights} nights`, `usiku ${nights}`);
  return `${dayLabel(stay.checkIn!, lang)} ${t(lang, "to", "hadi")} ${dayLabel(stay.checkOut!, lang)} (${n})`;
}

function problemText(stay: StayRequest, lang: Lang): string | null {
  switch (stay.problem) {
    case "past":
      return t(lang, "Those dates have already passed. Which dates are you planning?", "Tarehe hizo zimeshapita. Unapanga tarehe gani?");
    case "too_far":
      return t(lang, "I can only check up to about 18 months ahead. Try dates a little sooner.", "Naweza kuangalia hadi takriban miezi 18 mbele. Jaribu tarehe za karibu zaidi.");
    case "order":
      return t(lang, "The check-out date needs to be after check-in. Which dates did you mean?", "Tarehe ya kuondoka inapaswa kuwa baada ya kuingia. Ulimaanisha tarehe gani?");
    case "too_long":
      return t(lang, "That is a long stay. For more than 60 nights, our team can arrange it directly; ask me to pass it to them.", "Huo ni muda mrefu. Kwa zaidi ya usiku 60, timu yetu inaweza kupanga moja kwa moja; niambie niwapelekee.");
    default:
      return null;
  }
}

function askForDates(lang: Lang): string {
  return t(
    lang,
    'Which dates do you have in mind? Tell me something like "12 to 15 October" or "this weekend for 2 people" and I will check what is free.',
    'Una tarehe gani akilini? Niambie kitu kama "12 hadi 15 Oktoba" au "wikendi hii watu 2" nami nitaangalia kilicho wazi.'
  );
}

const DATE_FOLLOW_UPS: Record<Lang, string[]> = {
  en: ["This weekend", "Tomorrow for 1 night", "Next Friday for 2 nights"],
  sw: ["Wikendi hii", "Kesho usiku 1", "Ijumaa ijayo usiku 2"],
};

type Sellable = { rooms: number; closed: boolean } | null;

async function sellable(propertyId: number, stay: StayRequest): Promise<Sellable> {
  try {
    const result = await calculateAvailability(propertyId, fromDay(stay.checkIn!), fromDay(stay.checkOut!));
    return { rooms: result.summary.totalSellableRooms, closed: result.restrictions.length > 0 };
  } catch {
    return null;
  }
}

function bookingHref(slug: string, stay: StayRequest | null): string {
  const base = `/public/properties/${encodeURIComponent(slug)}`;
  if (!stay?.checkIn || !stay.checkOut) return base;
  const params = new URLSearchParams({ checkIn: stay.checkIn, checkOut: stay.checkOut });
  if (stay.guests) params.set("guests", String(stay.guests));
  return `${base}?${params}`;
}

const propertySelect = {
  id: true,
  title: true,
  type: true,
  regionName: true,
  district: true,
  city: true,
  basePrice: true,
  currency: true,
  maxGuests: true,
  totalBedrooms: true,
  nrmsBookingKey: true,
} as const;

type Listing = {
  id: number;
  title: string;
  type: string;
  regionName: string | null;
  district: string | null;
  city: string | null;
  basePrice: unknown;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  nrmsBookingKey: string;
};

function priceOf(listing: Listing): number | null {
  const n = Number(listing.basePrice);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tokenFor(listing: Listing): string {
  return formatMention({
    kind: "property",
    id: listing.id,
    key: listing.nrmsBookingKey,
    label: listing.title,
    slug: buildPropertySlug(listing.title, listing.nrmsBookingKey),
  });
}

function regionHref(name: string, stay: StayRequest | null): string {
  const params = new URLSearchParams({ region: name });
  if (stay?.checkIn && stay.checkOut) {
    params.set("checkIn", stay.checkIn);
    params.set("checkOut", stay.checkOut);
  }
  return `/public/properties?${params}`;
}

/** Free listings from a set, checked in parallel, cheapest first. */
async function freeAmong(listings: Listing[], stay: StayRequest, limit: number) {
  const checked = await Promise.all(
    listings.map(async (listing) => ({ listing, state: await sellable(listing.id, stay) }))
  );
  return checked
    .filter((c) => c.state && !c.state.closed && c.state.rooms > 0)
    .map((c) => c.listing)
    .sort((a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity))
    .slice(0, limit);
}

function listingLine(listing: Listing, stay: StayRequest | null, lang: Lang): string {
  const price = priceOf(listing);
  const nights = stay?.nights ?? null;
  const parts = [tokenFor(listing)];
  if (price) {
    parts.push(
      nights && stay?.checkIn
        ? t(lang, `${money(price, listing.currency)}/night, about ${money(price * nights, listing.currency)}`, `${money(price, listing.currency)}/usiku, takriban ${money(price * nights, listing.currency)}`)
        : t(lang, `from ${money(price, listing.currency)}/night`, `kuanzia ${money(price, listing.currency)}/usiku`)
    );
  }
  return `- ${parts.join(" · ")}`;
}

/* ── property ─────────────────────────────────────────────────────────── */

async function answerForProperty(key: string, message: string, lang: Lang, now: Date): Promise<PlaceAnswer | null> {
  const listing = (await prisma.property.findFirst({
    where: { nrmsBookingKey: key, status: "APPROVED" },
    select: propertySelect,
  })) as Listing | null;
  if (!listing) return null;

  const slug = buildPropertySlug(listing.title, listing.nrmsBookingKey);
  const stay = parseStay(message, now);
  const place = [listing.district || listing.city, listing.regionName].filter(Boolean).join(", ");
  const price = priceOf(listing);
  const openLink: TwigaLink = { label: t(lang, "Open listing", "Fungua tangazo"), href: bookingHref(slug, null) };

  // No usable dates yet: introduce the place and ask.
  if (!stay.checkIn) {
    const intro = t(
      lang,
      `${listing.title} is a ${typeLabel(listing.type, lang)}${place ? ` in ${place}` : ""}.`,
      `${listing.title} ni ${typeLabel(listing.type, lang)}${place ? ` iliyopo ${place}` : ""}.`
    );
    const facts = [
      price ? t(lang, `From ${money(price, listing.currency)} a night`, `Kuanzia ${money(price, listing.currency)} kwa usiku`) : null,
      listing.maxGuests ? t(lang, `Sleeps up to ${listing.maxGuests}`, `Hulaza hadi watu ${listing.maxGuests}`) : null,
      listing.totalBedrooms ? t(lang, `${listing.totalBedrooms} bedroom${listing.totalBedrooms === 1 ? "" : "s"}`, `Vyumba vya kulala ${listing.totalBedrooms}`) : null,
    ].filter(Boolean);
    const body = [intro, facts.length > 1 ? facts.map((f) => `- ${f}`).join("\n") : facts[0], problemText(stay, lang) ?? askForDates(lang)];
    return { text: body.filter(Boolean).join("\n\n"), links: [openLink], followUps: DATE_FOLLOW_UPS[lang] };
  }

  const range = rangeLabel(stay, lang);
  const state = await sellable(listing.id, stay);
  const tooMany =
    stay.guests && listing.maxGuests && stay.guests > listing.maxGuests
      ? t(lang, `Note: it sleeps up to ${listing.maxGuests}, so a party of ${stay.guests} may need more than one room or another stay.`, `Kumbuka: hulaza hadi watu ${listing.maxGuests}, hivyo kundi la watu ${stay.guests} linaweza kuhitaji zaidi ya chumba kimoja au malazi mengine.`)
      : null;

  if (!state) {
    return {
      text: t(lang, `I could not check ${listing.title} for ${range} just now. The listing shows live availability.`, `Sikuweza kuangalia ${listing.title} kwa ${range} kwa sasa. Tangazo linaonyesha upatikanaji wa moja kwa moja.`),
      links: [{ label: t(lang, "Check on the listing", "Angalia kwenye tangazo"), href: bookingHref(slug, stay) }],
      followUps: [],
    };
  }

  if (!state.closed && state.rooms > 0) {
    const lines = [
      t(lang, `Good news: ${listing.title} is available ${range}.`, `Habari njema: ${listing.title} iko wazi ${range}.`),
      price && stay.nights
        ? t(
            lang,
            `From ${money(price, listing.currency)} a night, so about ${money(price * stay.nights, listing.currency)} for the stay. The booking page shows the exact total before you pay.`,
            `Kuanzia ${money(price, listing.currency)} kwa usiku, hivyo takriban ${money(price * stay.nights, listing.currency)} kwa muda wote. Ukurasa wa kuhifadhi unaonyesha jumla kamili kabla ya kulipa.`
          )
        : null,
      tooMany,
    ];
    return {
      text: lines.filter(Boolean).join("\n\n"),
      links: [
        { label: t(lang, "Book these dates", "Hifadhi tarehe hizi"), href: bookingHref(slug, stay) },
      ],
      followUps: lang === "sw"
        ? ["Sera ya kughairi ni ipi?", "Naweza kulipa kwa njia gani?"]
        : ["What is the cancellation policy?", "Which payment methods can I use?"],
    };
  }

  // Full or closed: offer free stays nearby for the same dates.
  const neighbours = listing.regionName
    ? ((await prisma.property.findMany({
        where: { status: "APPROVED", regionName: listing.regionName, id: { not: listing.id } },
        orderBy: { id: "desc" },
        take: 8,
        select: propertySelect,
      })) as Listing[])
    : [];
  const free = neighbours.length ? await freeAmong(neighbours, stay, 3) : [];

  const headline = state.closed
    ? t(lang, `${listing.title} is not taking bookings ${range}.`, `${listing.title} haipokei nafasi ${range}.`)
    : t(lang, `${listing.title} is fully booked ${range}.`, `${listing.title} imejaa ${range}.`);

  const alternatives = free.length
    ? `${t(lang, `These stays in ${listing.regionName} are free on those dates:`, `Malazi haya ${listing.regionName} yako wazi tarehe hizo:`)}\n${free.map((l) => listingLine(l, stay, lang)).join("\n")}`
    : t(lang, "I could not find another free stay nearby for those dates. Try different dates, or ask me to pass this to our team.", "Sikupata malazi mengine yaliyo wazi karibu kwa tarehe hizo. Jaribu tarehe nyingine, au niambie niwapelekee timu yetu.");

  return {
    text: [headline, alternatives, tooMany].filter(Boolean).join("\n\n"),
    links: listing.regionName
      ? [{ label: t(lang, `All stays in ${listing.regionName}`, `Malazi yote ${listing.regionName}`), href: regionHref(listing.regionName, stay) }]
      : [openLink],
    followUps: DATE_FOLLOW_UPS[lang],
  };
}

/* ── region ───────────────────────────────────────────────────────────── */

async function answerForRegion(name: string, message: string, lang: Lang, now: Date): Promise<PlaceAnswer | null> {
  const where = { status: "APPROVED", regionName: name };
  const [count, prices, listings] = await Promise.all([
    prisma.property.count({ where }),
    prisma.property.aggregate({ where: { ...where, basePrice: { gt: 0 } }, _min: { basePrice: true }, _max: { basePrice: true } }),
    prisma.property.findMany({ where, orderBy: { id: "desc" }, take: 12, select: propertySelect }) as Promise<Listing[]>,
  ]);
  if (count === 0) return null;

  const stay = parseStay(message, now);
  const allLink: TwigaLink = { label: t(lang, `All stays in ${name}`, `Malazi yote ${name}`), href: regionHref(name, stay.checkIn ? stay : null) };
  const min = Number(prices._min.basePrice);
  const max = Number(prices._max.basePrice);
  const currency = listings.find((l) => l.currency)?.currency ?? "TZS";
  const priceRange =
    min > 0 && max > 0
      ? min === max
        ? t(lang, `, from ${money(min, currency)} a night`, `, kuanzia ${money(min, currency)} kwa usiku`)
        : t(lang, `, from ${money(min, currency)} to ${money(max, currency)} a night`, `, kuanzia ${money(min, currency)} hadi ${money(max, currency)} kwa usiku`)
      : "";
  const summary = t(
    lang,
    `${name} has ${count} approved stay${count === 1 ? "" : "s"} on NoLSAF${priceRange}.`,
    `${name} ina malazi ${count} yaliyoidhinishwa kwenye NoLSAF${priceRange}.`
  );

  if (!stay.checkIn) {
    const picks = [...listings].sort((a, b) => (priceOf(a) ?? Infinity) - (priceOf(b) ?? Infinity)).slice(0, 3);
    const list = picks.length
      ? `${t(lang, "A few to start with:", "Machache ya kuanzia:")}\n${picks.map((l) => listingLine(l, null, lang)).join("\n")}`
      : null;
    return {
      text: [summary, list, problemText(stay, lang) ?? askForDates(lang)].filter(Boolean).join("\n\n"),
      links: [allLink],
      followUps: DATE_FOLLOW_UPS[lang],
    };
  }

  const range = rangeLabel(stay, lang);
  const fitting = stay.guests ? listings.filter((l) => !l.maxGuests || l.maxGuests >= stay.guests!) : listings;
  const free = await freeAmong(fitting.slice(0, 10), stay, 4);

  const text = free.length
    ? [
        summary,
        `${t(lang, `Free ${range}${stay.guests ? ` for ${stay.guests}` : ""}:`, `Yaliyo wazi ${range}${stay.guests ? ` kwa watu ${stay.guests}` : ""}:`)}\n${free.map((l) => listingLine(l, stay, lang)).join("\n")}`,
        t(lang, "Tap a stay to open it on those dates.", "Gusa malazi kuyafungua kwa tarehe hizo."),
      ]
    : [
        summary,
        t(lang, `None of the stays I checked in ${name} are free ${range}. The full list may have more, or try different dates.`, `Hakuna kati ya malazi niliyoangalia ${name} yaliyo wazi ${range}. Orodha kamili inaweza kuwa na zaidi, au jaribu tarehe nyingine.`),
      ];

  return { text: text.join("\n\n"), links: [allLink], followUps: free.length ? [] : DATE_FOLLOW_UPS[lang] };
}

/* ── entry points ─────────────────────────────────────────────────────── */

/** Message text with mention tokens removed, for date parsing. */
export function withoutTokens(content: string): string {
  return content.replace(/@\[[^\]\n]{1,120}\]\((?:property|region):[^)\s]{1,200}\)/g, " ");
}

export async function answerForPlace(
  target: ResolvedMention,
  content: string,
  language: string,
  now: Date = new Date()
): Promise<PlaceAnswer | null> {
  const lang: Lang = language === "sw" ? "sw" : "en";
  const message = withoutTokens(content);
  try {
    return target.kind === "property"
      ? await answerForProperty(target.key, message, lang, now)
      : await answerForRegion(target.name, message, lang, now);
  } catch (error: any) {
    console.warn("Twiga place answer failed:", error?.message || error);
    return null;
  }
}

/** How long a tag stays "in the conversation" for a follow-up like "and next weekend?". */
const CONTEXT_WINDOW_MS = 30 * 60 * 1000;

/**
 * The place the visitor tagged a moment ago, if this message only adds dates.
 * Lets "@Sea Breeze Villa" followed by "12 to 15 October" work without tagging
 * twice. Re-validated, so a listing that stopped being approved drops out.
 */
export async function recentPlace(conversationId: number, beforeMessageId: number, now: Date = new Date()): Promise<ResolvedMention | null> {
  // @ts-ignore - Prisma Client needs regeneration after schema changes
  const recent = await prisma.chatbotMessage.findMany({
    where: {
      conversationId,
      role: "user",
      id: { lt: beforeMessageId },
      createdAt: { gte: new Date(now.getTime() - CONTEXT_WINDOW_MS) },
    },
    orderBy: { id: "desc" },
    take: 6,
    select: { content: true },
  });
  for (const row of recent) {
    if (!/@\[[^\]]+\]\((?:property|region):/.test(String(row.content))) continue;
    const { mentions } = await resolveMentions(String(row.content));
    const pick = mentions.find((m) => m.kind === "property") ?? mentions[0];
    if (pick) return pick;
  }
  return null;
}
