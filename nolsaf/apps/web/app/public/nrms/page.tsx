import type { Metadata } from "next";
import { SITE_URL, seoKeywords } from "@/lib/seo";
import NrmsPublicPitch from "./NrmsPublicPitch";

const NRMS_TITLE = "NRMS: NoLSAF Rooms Management System";
const NRMS_SOCIAL_DESCRIPTION =
  "One workspace for your rooms, front desk, restaurant and bar, OTA channels, housekeeping and financial reporting.";
const NRMS_OG_IMAGE = `${SITE_URL}/images/nrms/front-desk-hero.png`;
// /nrms is the canonical NRMS landing page: it is the one in the sitemap, the
// one the public footer links to, and it carries the SoftwareApplication and
// FAQPage structured data. This route is a second pitch of the same product,
// so it points its ranking signals there instead of competing with it.
const NRMS_CANONICAL = `${SITE_URL}/nrms`;

export const metadata: Metadata = {
  title: NRMS_TITLE,
  description:
    "NRMS is NoLSAF's rooms management system for property owners: a live room calendar, front desk, restaurant and bar with QR ordering, OTA channel sync, housekeeping, and USALI-standard financial reports, all in one workspace.",
  keywords: ["NRMS", "NoLSAF Rooms Management System", "hotel PMS Tanzania", "property management system", ...seoKeywords],
  alternates: { canonical: NRMS_CANONICAL },
  openGraph: {
    type: "website",
    siteName: "NoLSAF",
    locale: "en_US",
    title: `${NRMS_TITLE} | NoLSAF`,
    description: NRMS_SOCIAL_DESCRIPTION,
    url: NRMS_CANONICAL,
    images: [
      {
        url: NRMS_OG_IMAGE,
        width: 1738,
        height: 905,
        alt: "NRMS front desk workspace by NoLSAF",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${NRMS_TITLE} | NoLSAF`,
    description: NRMS_SOCIAL_DESCRIPTION,
    images: [NRMS_OG_IMAGE],
  },
};

export default function PublicNrmsPage() {
  return <NrmsPublicPitch />;
}
