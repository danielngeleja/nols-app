"use client"

import React from "react"
import TwoFactorSettings from "@/components/security/TwoFactorSettings"

export default function TwoFAPage() {
  return (
    <TwoFactorSettings
      statusUrl="/api/driver/security/2fa"
      provisionTotpUrl="/api/driver/security/2fa/provision?type=totp"
      postUrl="/api/driver/security/2fa"
      smsSendUrl="/api/driver/security/2fa/sms/send"
      smsVerifyUrl="/api/driver/security/2fa/sms/verify"
      smsDisableUrl="/api/driver/security/2fa/sms/disable"
      backHref="/driver/security"
      regenerateCodesUrl="/api/driver/security/2fa/codes/regenerate"
      containerClassName="w-full max-w-6xl mx-auto px-4"
    />
  )
}
