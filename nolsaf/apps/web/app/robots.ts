import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          "/",
          "/public/",
          "/nrms",
          "/tourism/",
          "/services/",
          "/about/",
          "/help/",
          "/updates/",
          "/careers",
          "/terms",
          "/privacy",
          "/cookies-policy",
          "/cancellation-policy",
          "/disbursement-policy",
          "/property-owner-disbursement-policy",
          "/driver-disbursement-policy",
          "/verification-policy",
          "/stay-safe",
          "/security",
        ],
        disallow: [
          "/admin/",
          "/owner/",
          "/driver/",
          "/account/",
          "/login",
          "/register",
          "/api/",
          "/version",
          "/docs/",
          "/maintenance",
          // NRMS guest and partner links are bearer credentials in the URL.
          // The pages carry noindex too; this stops them being fetched at all.
          "/nrms/guest/",
          "/nrms/rooming-list/",
          "/nrms/agency/pro-forma/",
          "/nrms/agent/activate",
          "/nrms/choose",
          "/nrms/confirm",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
