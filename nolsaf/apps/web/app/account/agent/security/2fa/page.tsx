"use client"

import React from "react"
import TwoFactorSettings from "@/components/security/TwoFactorSettings"

export default function AgentTwoFactorPage() {
  return (
    <TwoFactorSettings
      statusUrl="/api/account/security/2fa"
      provisionTotpUrl="/api/account/security/2fa/provision?type=totp"
      postUrl="/api/account/security/2fa"
      smsSendUrl="/api/account/2fa/sms/send"
      smsVerifyUrl="/api/account/2fa/sms/verify"
      smsDisableUrl="/api/account/2fa/sms/disable"
      backHref="/account/agent/security"
      regenerateCodesUrl="/api/account/2fa/codes/regenerate"
      containerClassName="public-container w-full"
    />
  )
}
