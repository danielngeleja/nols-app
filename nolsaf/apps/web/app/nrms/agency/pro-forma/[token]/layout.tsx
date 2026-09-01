import type { Metadata } from "next";
import type { ReactNode } from "react";

// A pro forma invoice addressed to one agency, reachable by bearer token and
// downloadable as a PDF. Never indexable.
export const metadata: Metadata = {
  title: "Pro forma invoice",
  robots: { index: false, follow: false, nocache: true },
};

export default function ProFormaLayout({ children }: { children: ReactNode }) {
  return children;
}
