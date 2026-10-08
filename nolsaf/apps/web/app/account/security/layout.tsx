"use client"

import SecurityShell from "@/components/account-security/SecurityShell"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountSecurityLayout({ children }: { children: React.ReactNode }) {
  return (
    <SecurityShell scope={CUSTOMER_SECURITY} className="public-container w-full min-w-0 space-y-5 py-6">
      {children}
    </SecurityShell>
  )
}
