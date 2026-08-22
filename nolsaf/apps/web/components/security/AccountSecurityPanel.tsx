"use client"

import React, { useEffect, useState } from "react"
import { Shield } from "lucide-react"

import PasswordChangeForm from "@/components/security/PasswordChangeForm"
import TotpSettingsSection from "@/components/security/TotpSettingsSection"
import ActiveSessionsSection from "@/components/security/ActiveSessionsSection"

export type AccountSecurityPanelProps = {
  variant?: "page" | "embedded"
  roleLabelOverride?: string
}

type Me = {
  role?: string | null
  twoFactorEnabled?: boolean
}

async function fetchJson(url: string) {
  const res = await fetch(url, { credentials: "include" })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error((body && body.error) || `Failed (status ${res.status})`)
  return body?.data ?? body
}

export default function AccountSecurityPanel({ variant = "page", roleLabelOverride }: AccountSecurityPanelProps) {
  const embedded = variant === "embedded"
  const [me, setMe] = useState<Me | null>(null)

  const refreshMe = async () => {
    try {
      const meData = await fetchJson("/api/account/me")
      setMe(meData)
    } catch {
      setMe(null)
    }
  }

  useEffect(() => {
    void refreshMe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const roleUpper = String(roleLabelOverride || me?.role || "").toUpperCase()

  return (
    <div className={`w-full ${embedded ? "space-y-4" : "space-y-6"}`}>
      {!embedded ? (
        <div
          className="relative overflow-hidden rounded-3xl shadow-[0_4px_32px_rgba(0,0,0,0.4)] border border-slate-700/60"
          style={{ background: "linear-gradient(135deg, #0c1222 0%, #0f2460 52%, #02665e 100%)" }}
        >
          {/* BG glow */}
          <div className="pointer-events-none absolute inset-0" style={{
            background: "radial-gradient(480px circle at 20% 30%, rgba(56,189,248,0.15), transparent 55%), radial-gradient(380px circle at 85% 70%, rgba(2,102,94,0.35), transparent 60%)"
          }} />
          <div className="relative flex flex-col items-center text-center px-6 py-10 sm:px-10 sm:py-12 gap-3">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-md scale-110" style={{ background: "rgba(56,189,248,0.2)" }} />
              <div className="relative h-16 w-16 rounded-2xl flex items-center justify-center shadow-lg"
                style={{ background: "linear-gradient(135deg, rgba(56,189,248,0.18) 0%, rgba(2,102,94,0.22) 100%)", border: "1px solid rgba(255,255,255,0.15)" }}>
                <Shield className="h-8 w-8 text-white drop-shadow" />
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow">Security</h1>
            <p className="text-sm text-blue-200/70 font-medium">Manage your account security settings</p>
          </div>
        </div>
      ) : null}

      <TotpSettingsSection
        enabled={!!me?.twoFactorEnabled}
        setupUrl="/api/account/2fa/totp/setup"
        verifyUrl="/api/account/2fa/totp/verify"
        disableUrl="/api/account/2fa/disable"
        embedded={embedded}
      />

      <PasswordChangeForm
        apiUrl="/api/account/password/change"
        variant="section"
        roleLabel={roleUpper || "ACCOUNT"}
        requireCurrentPassword
        submitLabel="Update Password"
      />

      <ActiveSessionsSection
        listUrl="/api/account/sessions"
        revokeUrl="/api/account/sessions/revoke"
        revokeOthersUrl="/api/account/sessions/revoke-others"
        embedded={embedded}
      />
    </div>
  )
}
