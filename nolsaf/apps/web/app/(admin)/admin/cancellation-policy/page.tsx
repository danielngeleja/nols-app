"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import {
  CANCELLATION_POLICY_LAST_UPDATED,
  CANCELLATION_POLICY_SECTIONS,
} from "@/components/cancellationPolicyContent";
import { XCircle } from "lucide-react";

export default function AdminCancellationPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Cancellation Policy" Icon={XCircle} variant="admin" />
        <div className="p-6">
          <Terms
            headline=""
            lastUpdated={CANCELLATION_POLICY_LAST_UPDATED}
            sections={CANCELLATION_POLICY_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
