"use client";

import { useState } from "react";
import LoadingScreen from "@/components/LoadingScreen";
import { hasClientNavigated } from "@/components/RouteProgress";

// First load gets the branded splash; moving between public pages keeps the
// header and shows listing-shaped skeletons instead.
export default function PublicLoading() {
  const [navigated] = useState(hasClientNavigated);
  if (!navigated) return <LoadingScreen label="Finding verified stays…" />;

  return (
    <main role="status" aria-live="polite" aria-label="Loading" className="header-offset min-h-screen">
      <section className="public-container nls-load-appear py-8 sm:py-10">
        <div className="nls-skeleton h-7 w-56 max-w-full" />
        <div className="nls-skeleton mt-3 h-4 w-80 max-w-full" />

        <div className="mt-6 flex flex-wrap gap-2">
          {[88, 112, 96, 120].map((w, i) => (
            <div key={i} className="nls-skeleton h-9 rounded-full" style={{ width: w }} />
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <div className="nls-skeleton aspect-[4/3] w-full rounded-2xl" />
              <div className="nls-skeleton mt-3 h-4 w-4/5" />
              <div className="nls-skeleton mt-2 h-3.5 w-1/2" />
              <div className="nls-skeleton mt-3 h-4 w-1/3" />
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
