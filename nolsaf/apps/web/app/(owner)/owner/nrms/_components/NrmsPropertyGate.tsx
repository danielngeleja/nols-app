"use client";

import Link from "next/link";
import { Building2, CircleAlert, Hourglass, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { useNrms, type NrmsProperty } from "./NrmsProvider";

type Kind = "none" | "pending" | "rejected";

const COPY: Record<Kind, { badge: string; title: string; description: string; cta: string; href: string; tone: "emerald" | "amber" }> = {
  none: {
    badge: "Step 1 of setup",
    title: "List a property first",
    description: "NRMS runs on top of an approved NoLSAF Marketplace listing. Add your property to get started.",
    cta: "Add your property",
    href: "/owner/properties/add",
    tone: "emerald",
  },
  pending: {
    badge: "Awaiting NoLSAF review",
    title: "Your property is pending approval",
    description: "NRMS unlocks automatically once NoLSAF approves this property as a Marketplace listing. This is usually reviewed within a few business days.",
    cta: "Check listing status",
    href: "/owner/properties/pending",
    tone: "emerald",
  },
  rejected: {
    badge: "Needs your attention",
    title: "Your property submission was rejected",
    description: "Review the reasons NoLSAF listed and resubmit your property. NRMS opens up once it's approved.",
    cta: "Review and resubmit",
    href: "/owner/properties/pending",
    tone: "amber",
  },
};

function classifyProperties(properties: NrmsProperty[]): Kind | null {
  if (properties.length === 0) return "none";
  if (properties.some((p) => p.status === "APPROVED")) return null;
  if (properties.some((p) => p.status === "REJECTED")) return "rejected";
  return "pending"; // PENDING or DRAFT-only
}

export default function NrmsPropertyGate({ loading, onRefresh }: { loading?: boolean; onRefresh: () => void }) {
  const { properties } = useNrms();
  const kind = useMemo(() => classifyProperties(properties), [properties]);
  if (!kind) return null;

  const copy = COPY[kind];
  const isAmber = copy.tone === "amber";
  const Icon = kind === "none" ? Building2 : kind === "pending" ? Hourglass : CircleAlert;

  return (
    <section
      role="status"
      className={`relative w-full max-w-sm overflow-hidden rounded-[24px] border p-6 text-center shadow-[0_20px_46px_-26px_rgba(6,78,59,0.35)] ${
        isAmber ? "border-amber-100 bg-[linear-gradient(180deg,#fffaf0_0%,#ffffff_60%)]" : "border-emerald-100 bg-[linear-gradient(180deg,#f2fbf7_0%,#ffffff_60%)]"
      }`}
    >
      <span className={`pointer-events-none absolute -top-10 left-1/2 h-24 w-24 -translate-x-1/2 rounded-full blur-2xl ${isAmber ? "bg-amber-200/30" : "bg-emerald-200/30"}`} aria-hidden="true" />

      <span className={`relative mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border bg-white shadow-sm ring-4 ${isAmber ? "border-amber-100 text-amber-600 ring-amber-50" : "border-emerald-100 text-emerald-700 ring-emerald-50"}`}>
        <Icon className="h-6 w-6" />
      </span>
      <span className={`relative mt-3.5 inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${isAmber ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
        {copy.badge}
      </span>
      <h2 className="relative mt-2.5 text-xl font-bold tracking-tight text-neutral-950">{copy.title}</h2>
      <p className="relative mb-0 mt-2 text-sm leading-6 text-neutral-500">{copy.description}</p>

      <div className="relative mt-5 flex flex-col gap-2">
        <Link
          href={copy.href}
          className={`inline-flex min-h-10 items-center justify-center rounded-xl px-4 text-sm font-bold text-white no-underline transition hover:text-white ${isAmber ? "bg-amber-600 hover:bg-amber-700" : "bg-[#073c35] hover:bg-[#0a5148]"}`}
        >
          {copy.cta}
        </Link>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white text-sm font-bold text-neutral-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Check again
        </button>
      </div>
    </section>
  );
}
