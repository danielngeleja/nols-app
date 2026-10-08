"use client"

import SecurityPasskeys from "@/components/account-security/SecurityPasskeys"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

export default function OwnerPasskeysPage() {
  return <SecurityPasskeys scope={OWNER_SECURITY} />
}
