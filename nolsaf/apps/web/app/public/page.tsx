import type { Metadata } from "next";
import { SITE_URL, seoKeywords } from "@/lib/seo";

const baseMetadata: Metadata = {
  title: { absolute: "NoLSAF | Quality Stays, Tours & Transport" },
  description:
    "Discover verified accommodation, Tanzania tour packages, airport transfers, group stays, travel planning and NoLScope cost estimates across Tanzania and East Africa.",
  keywords: seoKeywords,
  alternates: { canonical: `${SITE_URL}/public` },
  openGraph: {
    type: "website",
    title: "NoLSAF | Quality Stays, Tours & Transport",
    description:
      "Verified stays, tours, airport transfers, group accommodation and travel planning in one tourism platform built for Africa.",
    url: `${SITE_URL}/public`,
    images: [{ url: `${SITE_URL}/og-default.jpg`, width: 1200, height: 630, alt: "NoLSAF tourism services" }],
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const apiOrigin = (process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000")).replace(/\/$/, "");
  if (!apiOrigin) return baseMetadata;
  try {
    const response = await fetch(`${apiOrigin}/api/public/app-distribution`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    if (!response.ok) return baseMetadata;
    const settings = await response.json() as { enabled?: boolean; showOnHome?: boolean; iosStoreUrl?: string | null };
    if (!settings.enabled || !settings.showOnHome || !settings.iosStoreUrl) return baseMetadata;
    const appId = new URL(settings.iosStoreUrl).pathname.match(/\/id(\d+)\/?$/)?.[1];
    if (!appId) return baseMetadata;
    return { ...baseMetadata, other: { "apple-itunes-app": `app-id=${appId}` } };
  } catch {
    return baseMetadata;
  }
}

export { default } from "./PublicHomeClient";
