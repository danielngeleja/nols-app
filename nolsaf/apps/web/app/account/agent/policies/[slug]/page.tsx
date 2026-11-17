"use client";

// The policies that govern a tour operator, read inside the operator workspace
// (rail, header and footer stay), the way owners read theirs under /owner.
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Terms, { type TermsSection } from "@/components/Terms";
import { TERMS_LAST_UPDATED, TERMS_SECTIONS } from "@/components/termsContent";
import { PRIVACY_LAST_UPDATED, PRIVACY_SECTIONS } from "@/components/privacyContent";
import { COOKIES_LAST_UPDATED, COOKIES_SECTIONS } from "@/components/cookiesContent";
import { CANCELLATION_POLICY_LAST_UPDATED, CANCELLATION_POLICY_SECTIONS } from "@/components/cancellationPolicyContent";
import {
  TOUR_OPERATOR_DISBURSEMENT_POLICY_LAST_UPDATED,
  TOUR_OPERATOR_DISBURSEMENT_POLICY_SECTIONS,
} from "@/components/tourOperatorDisbursementPolicyContent";
import { AGENT_POLICIES, type AgentPolicySlug } from "../agentPolicies";

const DOCUMENTS: Record<AgentPolicySlug, { headline: string; lastUpdated: string; sections: TermsSection[] }> = {
  terms: { headline: "Terms and Conditions", lastUpdated: TERMS_LAST_UPDATED, sections: TERMS_SECTIONS },
  privacy: { headline: "Privacy Policy", lastUpdated: PRIVACY_LAST_UPDATED, sections: PRIVACY_SECTIONS },
  cookies: { headline: "Cookies Policy", lastUpdated: COOKIES_LAST_UPDATED, sections: COOKIES_SECTIONS },
  cancellation: { headline: "Cancellation Policy", lastUpdated: CANCELLATION_POLICY_LAST_UPDATED, sections: CANCELLATION_POLICY_SECTIONS },
  disbursement: {
    headline: "Tour Operator Disbursement Policy",
    lastUpdated: TOUR_OPERATOR_DISBURSEMENT_POLICY_LAST_UPDATED,
    sections: TOUR_OPERATOR_DISBURSEMENT_POLICY_SECTIONS,
  },
};

export default function AgentPolicyPage() {
  const params = useParams<{ slug: string }>();
  const slug = String(params?.slug || "") as AgentPolicySlug;
  const doc = DOCUMENTS[slug];
  if (!doc) notFound();

  return (
    <div className="w-full min-w-0 space-y-3 pb-6">
      <nav aria-label="Operator policies" className="flex flex-wrap items-center gap-1 rounded-lg border border-solid border-neutral-200 bg-white p-1">
        <Link href="/account/agent" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold text-neutral-500 no-underline hover:bg-neutral-50 hover:text-neutral-900">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Workspace
        </Link>
        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden />
        {AGENT_POLICIES.map((p) => {
          const active = p.href === `/account/agent/policies/${slug}`;
          return (
            <Link
              key={p.href}
              href={p.href}
              aria-current={active ? "page" : undefined}
              className={`inline-flex h-8 items-center rounded-md px-2.5 text-xs font-semibold no-underline transition ${
                active ? "bg-[#02665e] text-white hover:text-white" : "text-neutral-600 hover:bg-neutral-50 hover:text-[#02665e]"
              }`}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>

      <div className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
        <div className="p-4 sm:p-6">
          <Terms headline={doc.headline} lastUpdated={doc.lastUpdated} sections={doc.sections} />
        </div>
      </div>
    </div>
  );
}
