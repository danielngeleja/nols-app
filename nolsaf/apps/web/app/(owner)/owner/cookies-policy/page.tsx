"use client";

import React from "react";
import Terms from "@/components/Terms";
import { COOKIES_LAST_UPDATED, COOKIES_SECTIONS } from "@/components/cookiesContent";

export default function OwnerCookiesPolicyPage() {
  return (
    <div className="max-w-5xl mx-auto py-8 px-4">
      <div className="bg-white rounded-lg shadow p-0 overflow-hidden">
        <div className="p-6">
          <Terms headline="Cookies Policy" lastUpdated={COOKIES_LAST_UPDATED} sections={COOKIES_SECTIONS} />
        </div>
      </div>
    </div>
  );
}
