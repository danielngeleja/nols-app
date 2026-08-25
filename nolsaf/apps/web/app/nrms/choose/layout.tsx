import type { Metadata } from "next";
import type { ReactNode } from "react";

// A step inside the direct booking flow, not a destination. Indexing it would
// only add a thin, query-dependent duplicate of the property listing page.
export const metadata: Metadata = {
  title: "Choose your room",
  robots: { index: false, follow: true },
};

export default function DirectChooseLayout({ children }: { children: ReactNode }) {
  return children;
}
