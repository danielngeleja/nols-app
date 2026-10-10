"use client"

import SecurityShell from "@/components/account-security/SecurityShell"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountSecurityLayout({ children }: { children: React.ReactNode }) {
  return (
    // The account layout already provides the page container; nesting a second one doubled the gutters.
    <SecurityShell scope={CUSTOMER_SECURITY} className="w-full min-w-0 space-y-5 pb-6 [&_*]:box-border">
      {children}
    </SecurityShell>
  )
}
