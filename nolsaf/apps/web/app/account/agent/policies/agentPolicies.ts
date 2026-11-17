/** The policies a tour operator works under, each a page inside the operator workspace. */
export type AgentPolicySlug = "terms" | "privacy" | "cookies" | "cancellation" | "disbursement";

export const AGENT_POLICIES: Array<{ href: string; label: string }> = [
  { href: "/account/agent/contract", label: "Partnership agreement" },
  { href: "/account/agent/policies/disbursement", label: "Operator disbursements" },
  { href: "/account/agent/policies/cancellation", label: "Cancellation" },
  { href: "/account/agent/policies/terms", label: "Terms" },
  { href: "/account/agent/policies/privacy", label: "Privacy" },
  { href: "/account/agent/policies/cookies", label: "Cookies" },
];
