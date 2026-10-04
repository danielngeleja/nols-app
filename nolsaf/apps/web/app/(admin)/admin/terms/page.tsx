"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from "@/components/termsContent";
import { FileText } from "lucide-react";

export default function AdminTermsPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Terms of Service" Icon={FileText} variant="admin" />
        <div className="p-6">
          <Terms headline="" lastUpdated={TERMS_LAST_UPDATED} sections={TERMS_SECTIONS} />
        </div>
      </div>
    </div>
  );
}
