"use client"

import SecurityOverview from "@/components/account-security/SecurityOverview"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

export default function OwnerSecurityOverviewPage() {
  return <SecurityOverview scope={OWNER_SECURITY} />
}
