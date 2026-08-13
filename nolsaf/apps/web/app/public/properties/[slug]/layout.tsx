import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { cache } from "react";
import { serializeJsonLd } from "@/lib/safeJsonLd";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com";

const HOTEL_STAR_MAP: Record<string, number> = {
  basic: 1,
  simple: 2,
  moderate: 3,
  high: 4,
  luxury: 5,
};

function isShareableImageUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

type Props = {
  params: Promise<{ slug: string }>;
  children: ReactNode;
};

// Cached so generateMetadata and the layout share one fetch per request
const fetchProperty = cache(async (slug: string) => {
  const apiBase =
    process.env.API_ORIGIN ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000";

  const res = await fetch(
    `${apiBase}/api/public/properties/${encodeURIComponent(slug)}`,
    { cache: "no-store" }
  );
  if (!res.ok) throw new Error("not found");
  const json = await res.json();
  return json?.property ?? json;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;

  try {
    const property = await fetchProperty(slug);
    if (!property?.title) throw new Error("no title");

    const title = property.title as string;
    const description: string =
      (property.description as string | null) ||
      [
        property.type,
        property.city || property.district,
        property.regionName,
        property.country,
      ]
        .filter(Boolean)
        .join(", ") ||
      "Verified accommodation on NoLSAF";

    const location = [property.city || property.district, property.regionName]
      .filter(Boolean)
      .join(", ");

    const pageTitle = location ? `${title} | ${location}` : title;
    const ogImage = (property.images as string[] | undefined)?.find(isShareableImageUrl);
    const canonicalUrl = `${SITE_URL}/public/properties/${slug}`;

    return {
      title: pageTitle,
      description: description.slice(0, 160),
      alternates: { canonical: canonicalUrl },
      openGraph: {
        title: pageTitle,
        description: description.slice(0, 160),
        url: canonicalUrl,
        type: "website",
        ...(ogImage
          ? { images: [{ url: ogImage, width: 1200, height: 800, alt: title }] }
          : {}),
      },
      twitter: {
        card: "summary_large_image",
        title: pageTitle,
        description: description.slice(0, 160),
        ...(ogImage ? { images: [ogImage] } : {}),
      },
    };
  } catch {
    return {
      title: "Property Details",
      description: "View property details, availability, and book your stay on NoLSAF.",
    };
  }
}

export default async function PropertySlugLayout({ params, children }: Props) {
  const { slug } = await params;
  const nonce = (await headers()).get("x-nonce") || undefined;

  let jsonLd: Record<string, unknown> | null = null;

  try {
    const property = await fetchProperty(slug);

    if (property?.title) {
      const canonicalUrl = `${SITE_URL}/public/properties/${slug}`;
      const description: string =
        (property.description as string | null) ||
        [property.type, property.city || property.district, property.regionName, property.country]
          .filter(Boolean)
          .join(", ") ||
        "Verified accommodation on NoLSAF";

      // Determine Schema.org @type from property type
      const typeMap: Record<string, string> = {
        hotel: "Hotel",
        hostel: "Hostel",
        resort: "Resort",
        motel: "Motel",
        "bed and breakfast": "BedAndBreakfast",
        apartment: "Apartment",
      };
      const schemaType =
        typeMap[(property.type as string)?.toLowerCase()] ?? "LodgingBusiness";

      // Address
      const address: Record<string, string> = {
        "@type": "PostalAddress",
        addressCountry: property.country ?? "TZ",
      };
      if (property.regionName) address.addressRegion = property.regionName;
      if (property.city || property.district)
        address.addressLocality = property.city ?? property.district;
      if (property.street) address.streetAddress = property.street;

      jsonLd = {
        "@context": "https://schema.org",
        "@type": schemaType,
        name: property.title,
        description: description.slice(0, 300),
        url: canonicalUrl,
        address,
      };

      // Geo coordinates
      if (property.latitude && property.longitude) {
        jsonLd.geo = {
          "@type": "GeoCoordinates",
          latitude: property.latitude,
          longitude: property.longitude,
        };
      }

      // Images
      const shareableImages = ((property.images as string[] | undefined) || []).filter(isShareableImageUrl);
      if (shareableImages.length) {
        jsonLd.image = shareableImages.slice(0, 3);
      }

      // Hotel star rating
      const starNum = HOTEL_STAR_MAP[(property.hotelStar as string)?.toLowerCase()];
      if (starNum) {
        jsonLd.starRating = { "@type": "Rating", ratingValue: starNum };
      }

      // Price range
      if (property.basePrice && property.currency) {
        jsonLd.priceRange = `${property.currency} ${property.basePrice.toLocaleString()}`;
      }

      // Review data is loaded by the interactive page. Avoid duplicating that
      // backend request in layout JSON-LD generation on every property view.
    }
  } catch {
    // JSON-LD is enhancement only — never break the page
  }

  return (
    <>
      {/* suppressHydrationWarning below because browsers blank the nonce
          attribute after parsing, by design, so the client reads "" where the
          server sent a real value. Same reason as the root layout's JSON-LD. */}
      {jsonLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
      )}
      {children}
    </>
  );
}
