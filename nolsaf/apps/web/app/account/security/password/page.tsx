"use client"

import SecurityPassword from "@/components/account-security/SecurityPassword"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountPasswordPage() {
  return <SecurityPassword scope={CUSTOMER_SECURITY} />
}
