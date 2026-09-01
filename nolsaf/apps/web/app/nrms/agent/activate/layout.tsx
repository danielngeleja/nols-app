import type { Metadata } from "next";
import type { ReactNode } from "react";

// One-time agent invite landing where the agency sets its password. Nothing
// here should ever be crawled or cached.
export const metadata: Metadata = {
  title: "Activate your agent account",
  robots: { index: false, follow: false, nocache: true },
};

export default function AgentActivateLayout({ children }: { children: ReactNode }) {
  return children;
}
