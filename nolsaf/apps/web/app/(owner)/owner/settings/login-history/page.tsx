"use client"

import SecurityLoginHistory from "@/components/account-security/SecurityLoginHistory"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

export default function OwnerLoginHistoryPage() {
  return <SecurityLoginHistory scope={OWNER_SECURITY} />
}
