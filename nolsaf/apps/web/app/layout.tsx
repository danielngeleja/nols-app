// apps/web/app/layout.tsx

import "@/styles/globals.css";
import "@/styles/property-visualization.css";
import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import ToastContainer from "../components/ToastContainer";
import SuspendedAccessOverlay from "../components/SuspendedAccessOverlay";
import MobilePublicNav from "../components/MobilePublicNav";
import CookieConsent from "../components/CookieConsent";
import GlobalAlertGuard from "../components/GlobalAlertGuard";
import ClientErrorReporter from "../components/ClientErrorReporter";
import PerformanceMeasureGuard from "../components/PerformanceMeasureGuard";
import RouteChromeShell from "../components/RouteChromeShell";
import { SITE_URL, buildRootJsonLd, seoKeywords } from "@/lib/seo";
import { serializeJsonLd } from "@/lib/safeJsonLd";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: "NoLSAF",
  creator: "NoLSAF",
  publisher: "NoLSAF",
  category: "travel",
  classification: "Tourism, accommodation, transport, group stays, tour packages and travel planning",
  title: {
    default: "NoLSAF | Quality Stays, Tours & Transport",
    template: "%s | NoLSAF",
  },
  description:
    "NoLSAF is a verification-first tourism platform for Tanzania and East Africa: verified accommodation, tour packages, group stays, airport transfers, travel planning, and trip cost estimates.",
  keywords: seoKeywords,
  openGraph: {
    type: "website",
    siteName: "NoLSAF",
    title: "NoLSAF | Quality Stays, Tours & Transport",
    description:
      "Discover verified stays, tour packages, transport, group stays and travel planning across Tanzania, East Africa and Africa.",
    url: SITE_URL,
    locale: "en_US",
    images: [
      {
        url: `${SITE_URL}/og-default.jpg`,
        width: 1200,
        height: 630,
        alt: "NoLSAF - Tanzania tourism, verified accommodation, tours and transport",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "NoLSAF | Quality Stays, Tours & Transport",
    description:
      "Verified accommodation, tours, transport, group stays and travel planning for Tanzania and East Africa.",
    images: [`${SITE_URL}/og-default.jpg`],
  },
  icons: {
    icon: [{ url: "/icon", type: "image/png", sizes: "64x64" }],
    apple: [{ url: "/apple-icon", type: "image/png", sizes: "180x180" }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  alternates: {
    canonical: SITE_URL,
  },
  other: {
    "geo.region": "TZ",
    "geo.placename": "Tanzania",
    ICBM: "-6.7924, 39.2083",
  },
};

/**
 * Root shell: keep it neutral (no role header, no sidebars).
 * Child segment layouts (/admin, /owner) will render their own header/sidebar.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const jsonLd = buildRootJsonLd();
  const nonce = (await headers()).get("x-nonce") || undefined;

  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      {/* suppressHydrationWarning on <body> prevents browser-extension text/attribute
           injection (Grammarly, LastPass, etc.) from throwing React error #418. */}
      <body suppressHydrationWarning>
        <script
          type="application/ld+json"
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
        <GlobalAlertGuard />
        <ClientErrorReporter />
        <PerformanceMeasureGuard />
        <RouteChromeShell>
          <Suspense fallback={null}>{children}</Suspense>
        </RouteChromeShell>
        <Suspense fallback={null}>
          <SuspendedAccessOverlay />
        </Suspense>
        <ToastContainer />
        <Suspense fallback={null}>
          <MobilePublicNav />
        </Suspense>
        <CookieConsent />
      </body>
    </html>
  );
}
