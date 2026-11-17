"use client"

import SecurityTwoStep from "@/components/account-security/SecurityTwoStep"
import { AGENT_SECURITY } from "@/components/account-security/securityData"

// Same security pages as owners and travellers, scoped to the operator workspace.
export default function AgentTwoStepPage() {
  return <SecurityTwoStep scope={AGENT_SECURITY} />
}
