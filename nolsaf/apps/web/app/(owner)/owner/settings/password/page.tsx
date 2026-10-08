"use client"

import SecurityPassword from "@/components/account-security/SecurityPassword"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

export default function OwnerPasswordPage() {
  return <SecurityPassword scope={OWNER_SECURITY} />
}
