"use client";

import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import {
  TOUR_OPERATOR_DISBURSEMENT_POLICY_LAST_UPDATED,
  TOUR_OPERATOR_DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/tourOperatorDisbursementPolicyContent";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";
import LayoutFrame from "@/components/LayoutFrame";
import { HandCoins } from "lucide-react";

// Operators read this from their workspace and the public site alike, so it
// always uses the public frame.
export default function TourOperatorDisbursementPolicyPage() {
  return (
    <>
      <PublicHeader />
      <main className="min-h-screen bg-white text-slate-900">
        <LayoutFrame heightVariant="sm" topVariant="sm" colorVariant="muted" variant="solid" />
        <PolicyDocumentHeader title="Tour Operator Disbursement Policy" Icon={HandCoins} />
        <section className="relative overflow-x-hidden bg-[#f7f9fb] pb-4 pt-6 sm:pb-6 sm:pt-8 md:pb-10 md:pt-10">
          <div className="public-container">
            <div className="box-border w-full overflow-x-hidden rounded-lg border border-gray-100 bg-white p-4 shadow-sm sm:p-6 md:p-10 lg:p-12">
              <Terms
                headline=""
                lastUpdated={TOUR_OPERATOR_DISBURSEMENT_POLICY_LAST_UPDATED}
                sections={TOUR_OPERATOR_DISBURSEMENT_POLICY_SECTIONS}
              />
            </div>
          </div>
        </section>
      </main>
      <PublicFooter withRail={false} />
    </>
  );
}
