"use client"

import SecurityPasskeys from "@/components/account-security/SecurityPasskeys"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountPasskeysPage() {
  return <SecurityPasskeys scope={CUSTOMER_SECURITY} />
}
