import type { Metadata } from "next";
import { SITE_URL, seoKeywords } from "@/lib/seo";
import NrmsPublicPitch from "./NrmsPublicPitch";

const NRMS_TITLE = "NRMS: NoLSAF Rooms Management System";
const NRMS_SOCIAL_DESCRIPTION =
  "One workspace for your rooms, front desk, restaurant and bar, OTA channels, housekeeping and financial reporting.";
const NRMS_OG_IMAGE = `${SITE_URL}/images/nrms/front-desk-hero.png`;

export const metadata: Metadata = {
  title: NRMS_TITLE,
  description:
    "NRMS is NoLSAF's rooms management system for property owners: a live room calendar, front desk, restaurant and bar with QR ordering, OTA channel sync, housekeeping, and USALI-standard financial reports, all in one workspace.",
  keywords: ["NRMS", "NoLSAF Rooms Management System", "hotel PMS Tanzania", "property management system", ...seoKeywords],
  alternates: { canonical: `${SITE_URL}/public/nrms` },
  openGraph: {
    type: "website",
    siteName: "NoLSAF",
    locale: "en_US",
    title: `${NRMS_TITLE} | NoLSAF`,
    description: NRMS_SOCIAL_DESCRIPTION,
    url: `${SITE_URL}/public/nrms`,
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
