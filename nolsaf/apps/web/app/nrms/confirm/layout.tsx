import type { Metadata } from "next";
import type { ReactNode } from "react";

// Booking outcome page, reached only after a hold is placed and carrying the
// guest's own reservation state. Not a search result.
export const metadata: Metadata = {
  title: "Booking confirmation",
  robots: { index: false, follow: false, nocache: true },
};

export default function DirectConfirmLayout({ children }: { children: ReactNode }) {
  return children;
}
