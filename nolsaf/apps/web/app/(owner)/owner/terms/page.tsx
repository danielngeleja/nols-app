"use client";

import React from "react";
import Terms from "@/components/Terms";
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from "@/components/termsContent";

export default function OwnerTermsPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms headline="Owner Terms and Conditions" lastUpdated={TERMS_LAST_UPDATED} sections={TERMS_SECTIONS} />
        </div>
      </div>
    </div>
  );
}

