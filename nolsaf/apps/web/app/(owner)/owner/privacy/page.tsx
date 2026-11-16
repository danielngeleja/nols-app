"use client";

import React from "react";
import Terms from "@/components/Terms";
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/components/privacyContent";

export default function OwnerPrivacyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms headline="Privacy Policy" lastUpdated={PRIVACY_LAST_UPDATED} sections={PRIVACY_SECTIONS} />
        </div>
      </div>
    </div>
  );
}
