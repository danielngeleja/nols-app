import type { Metadata } from "next";
import type { ReactNode } from "react";

// Card checks are private answers for one owner at one moment: never indexed.
export const metadata: Metadata = {
  title: "Verify a NoLSAF representative",
  description: "Check that the person in front of you is an authorised NoLSAF sales representative.",
  robots: { index: false, follow: false },
};

export default function SalesVerifyLayout({ children }: { children: ReactNode }) {
  return children;
}
