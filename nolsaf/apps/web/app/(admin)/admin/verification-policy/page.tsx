"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import { VERIFICATION_LAST_UPDATED, VERIFICATION_SECTIONS } from "@/components/verificationContent";
import { CheckCircle } from "lucide-react";

export default function AdminVerificationPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Verification Policy" Icon={CheckCircle} variant="admin" />
        <div className="p-6">
          <Terms headline="" lastUpdated={VERIFICATION_LAST_UPDATED} sections={VERIFICATION_SECTIONS} />
        </div>
      </div>
    </div>
  );
}
