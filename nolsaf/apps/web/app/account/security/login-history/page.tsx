"use client"

import SecurityLoginHistory from "@/components/account-security/SecurityLoginHistory"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountLoginHistoryPage() {
  return <SecurityLoginHistory scope={CUSTOMER_SECURITY} />
}
