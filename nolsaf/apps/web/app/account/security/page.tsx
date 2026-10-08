"use client"

import SecurityOverview from "@/components/account-security/SecurityOverview"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountSecurityOverviewPage() {
  return <SecurityOverview scope={CUSTOMER_SECURITY} />
}
