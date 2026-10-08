"use client"

import SecurityShell from "@/components/account-security/SecurityShell"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

export default function OwnerSecurityLayout({ children }: { children: React.ReactNode }) {
  return <SecurityShell scope={OWNER_SECURITY}>{children}</SecurityShell>
}
