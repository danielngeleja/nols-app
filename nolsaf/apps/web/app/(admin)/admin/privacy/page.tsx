"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/components/privacyContent";
import { Shield } from "lucide-react";

export default function AdminPrivacyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Privacy Policy" Icon={Shield} variant="admin" />
        <div className="p-6">
          <Terms headline="" lastUpdated={PRIVACY_LAST_UPDATED} sections={PRIVACY_SECTIONS} />
        </div>
      </div>
    </div>
  );
}
