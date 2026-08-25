import type { Metadata } from "next";
import type { ReactNode } from "react";

// One guest's private review link. Bearer credential in the URL, so it stays
// out of search results.
export const metadata: Metadata = {
  title: "Share your stay",
  robots: { index: false, follow: false, nocache: true },
};

export default function GuestReviewLayout({ children }: { children: ReactNode }) {
  return children;
}
