"use client";

import { useEffect, useState } from "react";

/**
 * Three live proof points under the hero action, read from the estimator's own
 * API: how many destinations it prices, when rates were last verified, and
 * that it costs nothing. Shown as figures, not a sentence, so they carry weight.
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
      .then((d) => alive && d?.lastUpdatedAt && setVerified(new Date(d.lastUpdatedAt).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" })))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const facts = [
    { value: destCount != null ? String(destCount) : "…", label: "destinations priced" },
    { value: verified ?? "…", label: "rates last verified" },
    { value: "Free", label: "no sign-up needed" },
  ];

  return (
    <dl className="m-0 mx-auto mt-6 grid max-w-md grid-cols-3 md:mx-0 border-0 border-t border-solid border-white/10 pt-4 text-left">
      {facts.map((f, i) => (
        <div key={f.label} className={`min-w-0 ${i > 0 ? "border-0 border-l border-solid border-white/10 pl-4" : "pr-4"}`}>
          <dt className="sr-only">{f.label}</dt>
          <dd className="m-0 truncate text-[17px] font-bold leading-tight tabular-nums text-white">{f.value}</dd>
          <dd className="m-0 mt-0.5 text-[11.5px] leading-snug text-white/55">{f.label}</dd>
        </div>
      ))}
    </dl>
  );
}
