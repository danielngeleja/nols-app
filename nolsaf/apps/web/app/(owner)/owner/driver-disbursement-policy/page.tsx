"use client";

import React from "react";
import Terms from "@/components/Terms";
import {
  DRIVER_DISBURSEMENT_POLICY_LAST_UPDATED,
  DRIVER_DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/driverDisbursementPolicyContent";

export default function OwnerDriverDisbursementPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms
            headline="Driver Disbursement Policy"
            lastUpdated={DRIVER_DISBURSEMENT_POLICY_LAST_UPDATED}
            sections={DRIVER_DISBURSEMENT_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
