"use client"

import SecurityPassword from "@/components/account-security/SecurityPassword"
import { AGENT_SECURITY } from "@/components/account-security/securityData"

// Same security pages as owners and travellers, scoped to the operator workspace.
export default function AgentPasswordPage() {
  return <SecurityPassword scope={AGENT_SECURITY} />
}
