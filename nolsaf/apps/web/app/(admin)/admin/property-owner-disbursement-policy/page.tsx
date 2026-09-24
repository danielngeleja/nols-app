"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import {
  PROPERTY_OWNER_DISBURSEMENT_POLICY_LAST_UPDATED,
  PROPERTY_OWNER_DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/propertyOwnerDisbursementPolicyContent";
import { DollarSign } from "lucide-react";

export default function AdminPropertyOwnerDisbursementPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Property Owner Disbursement Policy" Icon={DollarSign} variant="admin" />

        <div className="p-6">
          <Terms
            headline=""
            lastUpdated={PROPERTY_OWNER_DISBURSEMENT_POLICY_LAST_UPDATED}
            sections={PROPERTY_OWNER_DISBURSEMENT_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
