"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import {
  DISBURSEMENT_POLICY_LAST_UPDATED,
  DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/disbursementPolicyContent";
import { DollarSign } from "lucide-react";

export default function AdminDisbursementPolicyPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="overflow-hidden rounded-2xl bg-white shadow">
        <PolicyDocumentHeader title="Disbursement Policy" Icon={DollarSign} variant="admin" />

        <div className="p-6">
          <Terms
            headline=""
            lastUpdated={DISBURSEMENT_POLICY_LAST_UPDATED}
            sections={DISBURSEMENT_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
