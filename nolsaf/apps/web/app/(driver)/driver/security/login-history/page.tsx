"use client"

import React from "react"
import LoginHistoryTable from "@/components/security/LoginHistoryTable"
import RecognisedDevices from "@/components/account-security/RecognisedDevices"

export default function LoginHistoryPage() {
  return (
    <>
      <LoginHistoryTable
        apiUrl="/api/driver/security/logins"
        backHref="/driver/security"
        containerClassName="w-full max-w-6xl mx-auto px-4"
      />
      <div className="w-full max-w-6xl mx-auto px-4 mt-5" style={{ boxSizing: "border-box" }}>
        <RecognisedDevices />
      </div>
    </>
  )
}
