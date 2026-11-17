"use client"

import SecurityOverview from "@/components/account-security/SecurityOverview"
import { AGENT_SECURITY } from "@/components/account-security/securityData"

// Same security pages as owners and travellers, scoped to the operator workspace.
export default function AgentSecurityOverviewPage() {
  return <SecurityOverview scope={AGENT_SECURITY} />
}
