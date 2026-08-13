"use client";

import Terms from "@/components/Terms";
import { NRMS_POLICY_LAST_UPDATED, NRMS_POLICY_SECTIONS } from "@/components/nrmsPolicyContent";

export default function NrmsPolicyPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-8">
        <Terms
          headline="NRMS Policy"
          lastUpdated={NRMS_POLICY_LAST_UPDATED}
          sections={NRMS_POLICY_SECTIONS}
        />
      </div>
    </div>
  );
}
