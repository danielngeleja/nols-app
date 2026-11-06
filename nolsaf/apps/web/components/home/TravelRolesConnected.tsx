"use client";

// Home section: NoLSAF and the four roles it connects, drawn as a family tree.
//
// NoLSAF sits at the top; one stem drops to a crossbar that branches to each
// role. A soft pulse runs along the lines, out of NoLSAF, down the stem, out
// along the crossbar and into every card, so the connection reads as live.
// Visitors who prefer reduced motion see the still tree.
//
// Each card carries one live fact from the platform (stays listed, operators
// verified) beside what the role gets and where to start.
//
// Phones: the same tree turned on its side, a rail down the left with a
// branch into each card.

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Car, Compass, Users } from "lucide-react";

type Counts = { stays: number | null; operators: number | null };

type Role = {
  label: string;
  Icon: typeof Users;
  href: string;
  desc: string;
  cta: string;
  /** One short fact; live when it comes from a count. */
  fact: (c: Counts) => { text: string; live: boolean } | null;
};

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const ROLES: Role[] = [
  {
    label: "Travellers",
    Icon: Users,
    href: "/public/properties",
    desc: "Verified stays, rides and tours in one trip.",
    cta: "Find a stay",
    fact: (c) => (c.stays ? { text: `${plural(c.stays, "verified stay", "verified stays")} to book`, live: true } : null),
  },
  {
    label: "Drivers",
    Icon: Car,
    href: "/account/register?role=driver",
    desc: "Airport runs and scheduled trips, clear pay.",
    cta: "Drive with us",
    fact: () => ({ text: "Paid per completed trip", live: false }),
  },
  {
    label: "Property owners",
    Icon: Building2,
    href: "/account/register?role=owner",
    desc: "Reach verified guests and manage bookings.",
    cta: "List a property",
    fact: (c) => (c.stays ? { text: `Join ${plural(c.stays, "listed stay", "listed stays")}`, live: true } : null),
  },
  {
    label: "Tour operators",
    Icon: Compass,
    href: "/careers?role=agent",
    desc: "Sell packages and prove delivery to travellers.",
    cta: "Become an operator",
    fact: (c) => (c.operators ? { text: `${plural(c.operators, "verified operator", "verified operators")} selling`, live: true } : null),
  },
];

// The pulse: a bright segment slides along each line, away from NoLSAF.
// Same cycle everywhere; delays stagger it so it reads as one wave.
const FLOW_CSS = `
/* Base styles are off site-wide, so width plus padding would overflow on phones without this */
#roles-tree, #roles-tree * { box-sizing: border-box; }
/* No position here: Tailwind utilities sit in a cascade layer, so any position set in this
   unlayered block would beat them. Lines get position from the markup instead. */
#roles-tree .flow { overflow: hidden; background: rgba(2,102,94,0.2); }
#roles-tree .flow::after { content: ""; position: absolute; animation: rt-down 2.8s cubic-bezier(.45,0,.55,1) infinite; animation-delay: var(--d, 0s); }
#roles-tree .flow.v::after { left: 0; right: 0; top: 0; height: 70%; background: linear-gradient(to bottom, transparent, #02665e, transparent); }
#roles-tree .flow.h-left::after { top: 0; bottom: 0; right: 0; width: 45%; background: linear-gradient(to left, transparent, #02665e, transparent); animation-name: rt-left; }
#roles-tree .flow.h-right::after { top: 0; bottom: 0; left: 0; width: 45%; background: linear-gradient(to right, transparent, #02665e, transparent); animation-name: rt-right; }
#roles-tree .d1 { --d: 0.45s; }
#roles-tree .d2 { --d: 1.05s; }
@keyframes rt-down { 0% { transform: translateY(-110%); } 55%, 100% { transform: translateY(160%); } }
@keyframes rt-left { 0% { transform: translateX(110%); } 55%, 100% { transform: translateX(-240%); } }
@keyframes rt-right { 0% { transform: translateX(-110%); } 55%, 100% { transform: translateX(240%); } }
#roles-tree .joint { box-shadow: 0 0 0 0 rgba(2,102,94,0.35); animation: rt-joint 2.8s ease-out infinite 0.4s; }
@keyframes rt-joint { 0% { box-shadow: 0 0 0 0 rgba(2,102,94,0.35); } 40%, 100% { box-shadow: 0 0 0 7px rgba(2,102,94,0); } }
@media (prefers-reduced-motion: reduce) {
  #roles-tree .flow::after, #roles-tree .joint { animation: none; display: none; }
  #roles-tree .flow { background: rgba(2,102,94,0.32); }
}
`;

function RoleCard({ role, counts, loading }: { role: Role; counts: Counts; loading: boolean }) {
  const { label, Icon, href, desc, cta } = role;
  const fact = role.fact(counts);
  return (
    <Link
      href={href}
      className="group flex h-full min-w-0 flex-col rounded-lg border border-solid border-slate-300/80 bg-white p-4 no-underline transition-colors hover:border-[#02665e]/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e]"
    >
      <span className="flex items-center gap-2.5">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[#02665e]/[0.08] text-[#02665e] transition-colors group-hover:bg-[#02665e] group-hover:text-white">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <span className="min-w-0 truncate text-[15px] font-semibold text-slate-900">{label}</span>
      </span>
      <span className="mt-2 block text-[13px] leading-snug text-slate-500">{desc}</span>

      {/* One fact: live counts get a small live dot */}
      <span className="mt-3 flex min-h-[22px] items-center">
        {fact ? (
          <span className="inline-flex items-center gap-1.5 rounded bg-slate-50 px-2 py-0.5 text-[11.5px] font-medium text-slate-700 ring-1 ring-inset ring-slate-200">
            {fact.live ? <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /> : null}
            {fact.text}
          </span>
        ) : loading ? (
          <span className="h-[22px] w-32 animate-pulse rounded bg-slate-100" aria-hidden />
        ) : null}
      </span>

      <span className="mt-auto inline-flex items-center gap-1 pt-3 text-[13px] font-semibold text-[#02665e]">
        {cta} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </span>
    </Link>
  );
}

function Root() {
  // Just the mark: shown as it is (brand colour, never restyled) on a white tile.
  return (
    <span className="inline-flex h-16 w-16 items-center justify-center rounded-xl border border-solid border-[#02665e]/30 bg-white shadow-[0_12px_28px_-16px_rgba(2,102,94,0.7)]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/NoLS2025-04.png" alt="NoLSAF" className="h-10 w-10 object-contain" />
    </span>
  );
}

export default function TravelRolesConnected() {
  const [counts, setCounts] = useState<Counts>({ stays: null, operators: null });
  const [loading, setLoading] = useState(true);

  // Live facts for the cards. Both endpoints are cached public lists; a
  // failure just leaves the fact out.
  useEffect(() => {
    let alive = true;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
    Promise.all([
      fetch("/api/public/properties?page=1&pageSize=1").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/public/agents?page=1&pageSize=50").then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([stays, agents]) => {
      if (!alive) return;
      setCounts({ stays: num(stays?.total), operators: num(agents?.total) });
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section
      id="roles-tree"
      aria-label="NoLSAF and the roles it connects"
      className="mx-auto w-full min-w-0 max-w-5xl overflow-hidden rounded-xl bg-white/70 p-4 sm:p-6 md:px-8 md:py-7"
      style={{ backgroundImage: "radial-gradient(rgba(2,102,94,0.10) 1px, transparent 1px)", backgroundSize: "18px 18px" }}
    >
      <style>{FLOW_CSS}</style>

      {/* ── Tablet and desktop: the tree, top down ── */}
      <div className="hidden md:block">
        <div className="flex justify-center">
          <Root />
        </div>
        {/* Stem from NoLSAF to the crossbar */}
        <div className="flex justify-center" aria-hidden>
          <span className="flow v relative h-6 w-0.5" />
        </div>

        {/* Four equal columns with a 16px gap: a column centre sits at (100% - 48px) / 8 from its edge */}
        <div className="relative grid grid-cols-4 gap-x-4">
          {/* Crossbar in two halves flowing outward, stopping where the rounded elbows take over */}
          <span aria-hidden className="flow h-left d1 h-0.5" style={{ position: "absolute", top: 0, right: "50%", left: "calc((100% - 48px) / 8 + 8px)" }} />
          <span aria-hidden className="flow h-right d1 h-0.5" style={{ position: "absolute", top: 0, left: "50%", right: "calc((100% - 48px) / 8 + 8px)" }} />
          {/* Rounded elbows where the outer branches turn down */}
          <span aria-hidden className="h-2 w-2 rounded-tl-md border-0 border-l-2 border-t-2 border-solid border-[#02665e]/20" style={{ position: "absolute", top: 0, left: "calc((100% - 48px) / 8 - 1px)" }} />
          <span aria-hidden className="h-2 w-2 rounded-tr-md border-0 border-r-2 border-t-2 border-solid border-[#02665e]/20" style={{ position: "absolute", top: 0, right: "calc((100% - 48px) / 8 - 1px)" }} />
          {/* Joint where the stem meets the crossbar */}
          <span aria-hidden className="joint h-2.5 w-2.5 rounded-full bg-[#02665e]" style={{ position: "absolute", top: 1, left: "50%", transform: "translate(-50%, -50%)" }} />

          {ROLES.map((role, i) => {
            const outer = i === 0 || i === ROLES.length - 1;
            return (
              <div key={role.label} className="flex min-w-0 flex-col">
                {/* Drop into the card; the outer ones start below their elbow */}
                <div className={`flex justify-center ${outer ? "pt-2" : ""}`} aria-hidden>
                  <span className={`flow v d2 relative w-0.5 ${outer ? "h-4" : "h-6"}`} />
                </div>
                <RoleCard role={role} counts={counts} loading={loading} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Phones: the tree on its side ── */}
      <div className="md:hidden">
        <Root />
        {/* The rail drops from the centre of the 64px logo tile (32px), cards start 12px after it */}
        <ol className="relative m-0 list-none pl-11 pt-3">
          {ROLES.map((role, i) => {
            const last = i === ROLES.length - 1;
            return (
              <li key={role.label} className="relative mb-3 last:mb-0">
                {/* This card's piece of the rail: from the gap above down to its branch (or its foot) */}
                <span
                  aria-hidden
                  className="flow v w-0.5"
                  style={{ position: "absolute", left: "-0.8125rem", top: "-0.75rem", ...(last ? { height: "2.5rem" } : { bottom: 0 }), ["--d" as string]: `${i * 0.35}s` } as React.CSSProperties}
                />
                {/* Branch from the rail into the card */}
                <span aria-hidden className="flow h-right d1 h-0.5 w-3" style={{ position: "absolute", left: "-0.75rem", top: "1.75rem" }} />
                <RoleCard role={role} counts={counts} loading={loading} />
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
