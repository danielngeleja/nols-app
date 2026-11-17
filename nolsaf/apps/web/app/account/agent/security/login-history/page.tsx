"use client"

import SecurityLoginHistory from "@/components/account-security/SecurityLoginHistory"
import { AGENT_SECURITY } from "@/components/account-security/securityData"

// Same security pages as owners and travellers, scoped to the operator workspace.
export default function AgentLoginHistoryPage() {
  return <SecurityLoginHistory scope={AGENT_SECURITY} />
}
