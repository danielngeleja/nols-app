import type { Metadata } from "next";
import type { ReactNode } from "react";

// The link is a bearer credential and the page shows the hotel's payment
// instructions, so it must never reach a search index. Matches the rooming
// list layout, which already does this.
export const metadata: Metadata = {
  title: "Payment request",
  robots: { index: false, follow: false, nocache: true },
};

export default function GuestPaymentLayout({ children }: { children: ReactNode }) {
  return children;
}
