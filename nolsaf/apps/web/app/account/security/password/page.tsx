"use client"

import React from "react"
import PasswordChangeForm from "@/components/security/PasswordChangeForm"

export default function PasswordPage() {
  return (
    <PasswordChangeForm
      apiUrl="/api/account/password/change"
      redirectHref="/account/security"
      backHref="/account/security"
      roleLabel="ACCOUNT"
      variant="page"
      requireCurrentPassword
      submitLabel="Update Password"
    />
  )
}
