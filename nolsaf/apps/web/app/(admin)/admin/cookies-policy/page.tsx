"use client";

import React from "react";
import Terms from "@/components/Terms";
import PolicyDocumentHeader from "@/components/PolicyDocumentHeader";
import { COOKIES_LAST_UPDATED, COOKIES_SECTIONS } from "@/components/cookiesContent";
import { Cookie } from "lucide-react";

export default function AdminCookiesPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-2xl shadow p-0 overflow-hidden">
        <PolicyDocumentHeader title="Cookies Policy" Icon={Cookie} variant="admin" />
        <div className="p-6">
          <Terms headline="" lastUpdated={COOKIES_LAST_UPDATED} sections={COOKIES_SECTIONS} />
        </div>
      </div>
    </div>
  );
}
