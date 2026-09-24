import type { Metadata } from "next";
import TourPackagesFilterPanel from "./TourPackagesFilterPanel";
import { SITE_URL, seoKeywords } from "@/lib/seo";

export const metadata: Metadata = {
  title: "Tanzania & East Africa Tour Packages",
  description:
    "Browse Tanzania and East Africa tour packages from approved operators, including safari, cultural, beach, hiking, family and local tourism experiences.",
  keywords: [
    "Tanzania safari packages",
    "East Africa tour packages",
    "Africa tour operators",
    "Zanzibar beach holidays",
    "Serengeti safari",
    "Ngorongoro crater tours",
    "Kilimanjaro travel",
    ...seoKeywords,
  ],
  alternates: { canonical: `${SITE_URL}/public/tour-packages` },
  openGraph: {
    title: "Tanzania & East Africa Tour Packages | NoLSAF",
    description: "Compare verified safari, cultural, beach and local tourism packages from approved operators.",
    url: `${SITE_URL}/public/tour-packages`,
  },
};

/**
 * The hero, search and filters live in the panel with the listing data, so the
 * search sits in the hero and the counts come from the real listing.
 */
export default function PublicTourPackagesPage() {
  return (
    <main className="min-h-screen bg-white">
      <section className="public-container pb-12 pt-4">
        <TourPackagesFilterPanel />
      </section>
    </main>
  );
}
