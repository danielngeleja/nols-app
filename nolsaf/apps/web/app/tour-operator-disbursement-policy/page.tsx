import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Tour Operator Disbursement Policy",
  description:
    "How NoLSAF pays tour operators: a pre-trip advance for supplier costs and the balance after the trip, with the rules that protect operators and travellers.",
  alternates: { canonical: "https://nolsaf.com/tour-operator-disbursement-policy" },
  openGraph: {
    title: "Tour Operator Disbursement Policy | NoLSAF",
    description: "Pre-trip advances, post-trip balances, cancellations and recovery for tour operators on NoLSAF.",
  },
};

export { default } from "./TourOperatorDisbursementPolicyClient";
