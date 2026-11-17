"use client"

import SecurityPasskeys from "@/components/account-security/SecurityPasskeys"
import { AGENT_SECURITY } from "@/components/account-security/securityData"

// Same security pages as owners and travellers, scoped to the operator workspace.
export default function AgentPasskeysPage() {
  return <SecurityPasskeys scope={AGENT_SECURITY} />
}
