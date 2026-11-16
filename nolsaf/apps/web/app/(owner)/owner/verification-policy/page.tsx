"use client";

import React from "react";
import Terms from "@/components/Terms";
import { VERIFICATION_LAST_UPDATED, VERIFICATION_SECTIONS } from "@/components/verificationContent";

export default function OwnerVerificationPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms
            headline="Verification Policy"
            lastUpdated={VERIFICATION_LAST_UPDATED}
            sections={VERIFICATION_SECTIONS}
          />
        </div>
      </div>
    </div>
  );
}
