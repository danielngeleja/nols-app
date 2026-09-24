"use client";

import { useEffect, useState } from "react";

/**
 * One quiet line of live facts under the hero action: the real destination
 * count and when rates were last verified, read from the estimator's own API.
 */
export default function NolScopeHeroFacts() {
  const [destCount, setDestCount] = useState<number | null>(null);
  const [verified, setVerified] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/public/nolscope/destinations")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setDestCount(Array.isArray(d.destinations) ? d.destinations.length : null))
      .catch(() => {});
    fetch("/api/public/nolscope/data-freshness")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d?.lastUpdatedAt && setVerified(new Date(d.lastUpdatedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const parts = [destCount != null ? `${destCount} destinations` : null, verified ? `Rates verified ${verified}` : null, "Free, no sign-up"].filter(Boolean);

  return <p className="m-0 mt-5 text-[12.5px] text-white/55">{parts.join("  ·  ")}</p>;
}
