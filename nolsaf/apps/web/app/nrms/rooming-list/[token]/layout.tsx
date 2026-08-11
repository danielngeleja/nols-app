import type { Metadata } from "next";
import type { ReactNode } from "react";

// The link is a bearer credential. The API already answers with X-Robots-Tag,
// and this keeps the page itself out of search results too.
export const metadata: Metadata = {
  title: "Rooming list",
  robots: { index: false, follow: false, nocache: true },
};

export default function RoomingListLayout({ children }: { children: ReactNode }) {
  return children;
}
