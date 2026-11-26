import type { Metadata } from "next";
import { SITE_URL } from "@/lib/seo";
import VisitRequestForm from "./VisitRequestForm";

const TITLE = "Request a NoLSAF visit";
const DESCRIPTION =
  "Own a hotel, lodge, guest house or home in Tanzania? Ask for a NoLSAF visit. A verified NoLSAF Sales Partner near you will call, visit and help you list your property or set up NRMS.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `${SITE_URL}/public/request-a-visit` },
  openGraph: { type: "website", siteName: "NoLSAF", title: `${TITLE} | NoLSAF`, description: DESCRIPTION, url: `${SITE_URL}/public/request-a-visit` },
};

export default function RequestVisitPage() {
  return <VisitRequestForm />;
}
