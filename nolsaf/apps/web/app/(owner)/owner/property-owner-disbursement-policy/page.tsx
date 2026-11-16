"use client";

import React from "react";
import Terms from "@/components/Terms";
import {
  PROPERTY_OWNER_DISBURSEMENT_POLICY_LAST_UPDATED,
  PROPERTY_OWNER_DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/propertyOwnerDisbursementPolicyContent";

export default function OwnerPropertyOwnerDisbursementPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms
            headline="Property Owner Disbursement Policy"
            lastUpdated={PROPERTY_OWNER_DISBURSEMENT_POLICY_LAST_UPDATED}
            sections={PROPERTY_OWNER_DISBURSEMENT_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
