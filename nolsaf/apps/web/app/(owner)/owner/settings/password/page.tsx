"use client"

import PasswordChangeForm from "@/components/security/PasswordChangeForm"

export default function OwnerPasswordPage() {
  return (
    <PasswordChangeForm
      apiUrl="/api/account/password/change"
      redirectHref="/owner/settings"
      backHref="/owner/settings"
      roleLabel="OWNER"
      variant="page"
      requireCurrentPassword
      submitLabel="Update Password"
    />
  )
}
