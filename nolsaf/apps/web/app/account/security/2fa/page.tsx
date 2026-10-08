"use client"

import SecurityTwoStep from "@/components/account-security/SecurityTwoStep"
import { CUSTOMER_SECURITY } from "@/components/account-security/securityData"

export default function AccountTwoStepPage() {
  return <SecurityTwoStep scope={CUSTOMER_SECURITY} />
}
