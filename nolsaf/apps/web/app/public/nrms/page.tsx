import type { Metadata } from "next";
import { SITE_URL, seoKeywords } from "@/lib/seo";
import NrmsPublicPitch from "./NrmsPublicPitch";

export const metadata: Metadata = {
  title: "NRMS — NoLSAF Rooms Management System",
  description:
    "NRMS is NoLSAF's rooms management system for property owners: a live room calendar, front desk, restaurant and bar with QR ordering, OTA channel sync, housekeeping, and USALI-standard financial reports, all in one workspace.",
  keywords: ["NRMS", "NoLSAF Rooms Management System", "hotel PMS Tanzania", "property management system", ...seoKeywords],
  alternates: { canonical: `${SITE_URL}/public/nrms` },
  openGraph: {
    title: "NRMS — NoLSAF Rooms Management System",
    description: "One workspace for your rooms, front desk, restaurant and bar, OTA channels, housekeeping and financial reporting.",
    url: `${SITE_URL}/public/nrms`,
  },
};

export default function PublicNrmsPage() {
  return <NrmsPublicPitch />;
}
