"use client"

import SecurityTwoStep from "@/components/account-security/SecurityTwoStep"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

export default function OwnerTwoStepPage() {
  return <SecurityTwoStep scope={OWNER_SECURITY} />
}
