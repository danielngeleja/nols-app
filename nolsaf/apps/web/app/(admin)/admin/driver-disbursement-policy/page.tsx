"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import {
  DRIVER_DISBURSEMENT_POLICY_LAST_UPDATED,
  DRIVER_DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/driverDisbursementPolicyContent";
import { DollarSign } from "lucide-react";

export default function AdminDriverDisbursementPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Driver Disbursement Policy" Icon={DollarSign} variant="admin" />
        <div className="p-6">
          <Terms
            headline=""
            lastUpdated={DRIVER_DISBURSEMENT_POLICY_LAST_UPDATED}
            sections={DRIVER_DISBURSEMENT_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
