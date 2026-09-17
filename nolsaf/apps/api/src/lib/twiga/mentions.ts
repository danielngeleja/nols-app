import { prisma } from "@nolsaf/prisma";
import { buildPropertySlug } from "../publicPropertyDto";

/*
 * @-mentions in Twiga messages.
 *
 * A visitor can tag an approved property or a region while typing. The tag is
 * stored inline in the message content as a small token, so it survives in the
 * transcript without a schema change and every reader (widget, admin console)
 * can render it as a link:
 *
 *   @[Sea Breeze Villa](property:sea-breeze-villa-ck3x9...)
 *   @[Zanzibar](region:Zanzibar)
 *
 * Properties are identified by their public slug (title plus nrmsBookingKey),
 * never by the numeric id: internal ids must not be exposed publicly.
 *
 * Tokens are never trusted as sent. `resolveMentions` re-reads each one from
 * the database: a property must still be APPROVED and a region must have at
 * least one approved listing. The label is replaced with the canonical title,
 * so nobody can tag a listing as "Free stay, click here". Anything that fails
 * is flattened to its plain label.
 */

export const MAX_MENTIONS_PER_MESSAGE = 3;

const TOKEN = /@\[([^\]\n]{1,120})\]\((property|region):([^)\s]{1,200})\)/g;

export type ResolvedMention =
  | { kind: "property"; id: number; key: string; label: string; slug: string }
  | { kind: "region"; name: string; label: string };

/** Characters that would break the token syntax if they appeared in a label. */
function cleanLabel(value: string): string {
  return value.replace(/[[\]()\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

export function formatMention(mention: ResolvedMention): string {
  if (mention.kind === "property") {
    return `@[${cleanLabel(mention.label)}](property:${mention.slug})`;
  }
  return `@[${cleanLabel(mention.label)}](region:${encodeURIComponent(mention.name)})`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Validate and canonicalise every mention token in a message.
 *
 * Returns the content to store (tokens rewritten or flattened), the plain text
 * to hand to Twiga's matcher (labels only, no token syntax), and the mentions
 * that survived.
 */
export async function resolveMentions(message: string): Promise<{
  content: string;
  plain: string;
  mentions: ResolvedMention[];
}> {
  const matches = Array.from(message.matchAll(TOKEN));
  if (matches.length === 0) return { content: message, plain: message, mentions: [] };

  const considered = matches.slice(0, MAX_MENTIONS_PER_MESSAGE);

  const propertyKeys = new Set<string>();
  const regionNames = new Set<string>();
  for (const match of considered) {
    const [, , kind, value] = match;
    if (kind === "property") {
      const key = propertyKeyFromToken(value);
      if (key) propertyKeys.add(key);
    } else {
      const name = safeDecode(value).trim();
      if (name && name.length <= 120) regionNames.add(name);
    }
  }

  const properties = propertyKeys.size
    ? await prisma.property.findMany({
        where: { nrmsBookingKey: { in: Array.from(propertyKeys) }, status: "APPROVED" },
        select: { id: true, title: true, nrmsBookingKey: true },
      })
    : [];
  const propertyByKey = new Map<string, { id: number; title: string; nrmsBookingKey: string }>(
    properties.map((p) => [p.nrmsBookingKey.toLowerCase(), p])
  );

  // MySQL collation makes this equality case-insensitive, and we keep the
  // stored spelling so "zanzibar" becomes "Zanzibar".
  const regionByName = new Map<string, string>();
  for (const name of regionNames) {
    const hit = await prisma.property.findFirst({
      where: { status: "APPROVED", regionName: name },
      select: { regionName: true },
    });
    if (hit?.regionName) regionByName.set(name.toLowerCase(), hit.regionName);
  }

  const mentions: ResolvedMention[] = [];
  let index = 0;

  const rewrite = (useLabelsOnly: boolean) =>
    message.replace(TOKEN, (_whole, label: string, kind: string, value: string) => {
      const position = index++;
      const plainLabel = `@${cleanLabel(label)}`;
      if (position >= MAX_MENTIONS_PER_MESSAGE) return plainLabel;

      if (kind === "property") {
        const key = propertyKeyFromToken(value);
        const property = key ? propertyByKey.get(key) : undefined;
        if (!property?.nrmsBookingKey) return plainLabel;
        const mention: ResolvedMention = {
          kind: "property",
          id: property.id,
          key: property.nrmsBookingKey,
          label: property.title,
          slug: buildPropertySlug(property.title, property.nrmsBookingKey),
        };
        if (!useLabelsOnly) mentions.push(mention);
        return useLabelsOnly ? `@${cleanLabel(property.title)}` : formatMention(mention);
      }

      const canonical = regionByName.get(safeDecode(value).trim().toLowerCase());
      if (!canonical) return plainLabel;
      const mention: ResolvedMention = { kind: "region", name: canonical, label: canonical };
      if (!useLabelsOnly) mentions.push(mention);
      return useLabelsOnly ? `@${cleanLabel(canonical)}` : formatMention(mention);
    });

  const content = rewrite(false);
  index = 0;
  const plain = rewrite(true);

  return { content, plain, mentions };
}

/**
 * The public booking key inside a property token value. Accepts the slug form
 * and, for messages written before the switch, the old "id|slug" form (only
 * the slug half is read).
 */
export function propertyKeyFromToken(value: string): string | null {
  const slug = value.includes("|") ? value.slice(value.indexOf("|") + 1) : value;
  return publicKeyFromSlug(safeDecode(slug));
}

export type MentionSearchResult = {
  regions: Array<{ name: string; count: number }>;
  properties: Array<{
    title: string;
    type: string;
    place: string;
    slug: string;
    thumbnail: string | null;
    here: boolean;
  }>;
};

/** The public key at the end of a /public/properties/<slug> path segment. */
function publicKeyFromSlug(slug: string): string | null {
  const raw = slug.trim().toLowerCase();
  const key = raw.includes("-") ? raw.slice(raw.lastIndexOf("-") + 1) : raw;
  return /^[a-z0-9]{20,40}$/.test(key) ? key : null;
}

/**
 * What the @ picker offers. Approved listings only, small and fast: this runs
 * as the visitor types.
 *
 * `contextSlug` is the property page the visitor is standing on, if any. That
 * property is offered first, because "@" on a listing page almost always means
 * "this one".
 */
export async function searchMentionables(query: string, contextSlug?: string | null): Promise<MentionSearchResult> {
  const q = query.trim().slice(0, 60);

  const regionGroups = await prisma.property.groupBy({
    by: ["regionName"],
    where: {
      status: "APPROVED",
      regionName: q ? { contains: q } : { not: null },
    },
    _count: { regionName: true },
    orderBy: { _count: { regionName: "desc" } },
    take: 8,
  });
  const regions = regionGroups
    .map((g) => ({ name: String(g.regionName ?? "").trim(), count: Number(g._count?.regionName ?? 0) }))
    .filter((r) => r.name && r.count > 0)
    .slice(0, 4);

  const select = {
    id: true,
    title: true,
    type: true,
    regionName: true,
    district: true,
    city: true,
    nrmsBookingKey: true,
    images: { select: { thumbnailUrl: true, url: true }, orderBy: { createdAt: "asc" as const }, take: 1 },
  };

  const contextKey = contextSlug ? publicKeyFromSlug(contextSlug) : null;
  const contextProperty = contextKey
    ? await prisma.property.findFirst({ where: { status: "APPROVED", nrmsBookingKey: contextKey }, select })
    : null;

  const matchesContext =
    contextProperty &&
    (!q || [contextProperty.title, contextProperty.regionName, contextProperty.city, contextProperty.district]
      .some((field) => String(field ?? "").toLowerCase().includes(q.toLowerCase())));

  const list = await prisma.property.findMany({
    where: {
      status: "APPROVED",
      ...(contextProperty ? { id: { not: contextProperty.id } } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q } },
              { regionName: { contains: q } },
              { city: { contains: q } },
              { district: { contains: q } },
            ],
          }
        : {}),
    },
    orderBy: { id: "desc" },
    take: matchesContext ? 5 : 6,
    select,
  });

  const rows = matchesContext && contextProperty ? [contextProperty, ...list] : list;

  const properties = rows
    .filter((p) => p.nrmsBookingKey)
    .map((p) => ({
      title: p.title,
      type: p.type,
      place: [p.district || p.city, p.regionName].filter(Boolean).join(", "),
      slug: buildPropertySlug(p.title, String(p.nrmsBookingKey)),
      thumbnail: p.images?.[0]?.thumbnailUrl || p.images?.[0]?.url || null,
      here: Boolean(contextProperty && p.id === contextProperty.id),
    }));

  return { regions, properties };
}
