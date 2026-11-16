"use client";

import React from "react";
import Terms from "@/components/Terms";
import {
  CANCELLATION_POLICY_LAST_UPDATED,
  CANCELLATION_POLICY_SECTIONS,
} from "@/components/cancellationPolicyContent";

export default function OwnerCancellationPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms
            headline="Cancellation Policy"
            lastUpdated={CANCELLATION_POLICY_LAST_UPDATED}
            sections={CANCELLATION_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
