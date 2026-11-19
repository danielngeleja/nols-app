"use client"

import React, { useCallback, useEffect, useState } from "react"
import { ShieldCheck, Smartphone } from "lucide-react"
import SecurityPasskeys from "@/components/account-security/SecurityPasskeys"
import SecurityTwoStep from "@/components/account-security/SecurityTwoStep"
import { OWNER_SECURITY } from "@/components/account-security/securityData"

type Status = {
  applies: boolean
  satisfied: boolean
  hasPasskey: boolean
  hasAuthenticator: boolean
  setupOnly: boolean
}

/**
 * Where a paid owner lands after an SMS-code or password sign-in once the
 * grace period is over (owner MFA policy). This session can only add a
 * passkey or an authenticator app; afterwards the owner signs in again with it.
 */
export default function SecureYourAccountPage() {
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showAuthenticator, setShowAuthenticator] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch("/api/auth/owner-mfa/status", { credentials: "include" })
      if (res.status === 401) {
        window.location.replace("/login")
        return
      }
      const body = await res.json().catch(() => null)
      if (!res.ok || !body) {
        setError("We could not check your account. Refresh the page to try again.")
        return
      }
      setStatus(body)
    } catch {
      setError("We could not reach NoLSAF. Check your connection and try again.")
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const signInAgain = async () => {
    setLeaving(true)
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" })
    } catch {
      // Signing out locally is enough to continue.
    }
    window.location.replace("/login")
  }

  const done = Boolean(status?.satisfied)
  const notNeeded = status !== null && !status.setupOnly && (!status.applies || status.satisfied)

  return (
    <main className="public-container w-full py-8 sm:py-12" style={{ boxSizing: "border-box" }}>
      <div className="mx-auto w-full max-w-5xl space-y-5" style={{ boxSizing: "border-box" }}>
        <header className="card rounded-xl p-5 sm:p-6" style={{ boxSizing: "border-box" }}>
          <div className="flex items-start gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-[#02665e]"><ShieldCheck className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <h1 className="m-0 text-lg font-bold text-slate-900">Protect your payouts</h1>
              <p className="m-0 mt-1 text-sm text-slate-600">
                Your account receives payouts, so a text code alone is no longer enough to open it. Add a passkey on this phone or computer, or an authenticator app. Someone who steals your SIM card cannot use either.
              </p>
            </div>
          </div>
          {error && <p className="m-0 mt-4 rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">{error}</p>}
        </header>

        {done || notNeeded ? (
          <section className="card rounded-xl p-5 sm:p-6" style={{ boxSizing: "border-box" }}>
            <p className="m-0 text-base font-bold text-slate-900">Your account is protected</p>
            <p className="m-0 mt-1 text-sm text-slate-600">
              {status?.setupOnly
                ? `Sign in again${status.hasPasskey ? " with your passkey" : ", then enter the code from your authenticator app"} to open your workspace.`
                : "You can go back to your workspace."}
            </p>
            {status?.setupOnly ? (
              <button type="button" onClick={() => void signInAgain()} disabled={leaving} className="btn mt-4 h-11 rounded-lg border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60">
                {leaving ? "Signing out..." : "Sign in again"}
              </button>
            ) : (
              <a href="/owner" className="btn mt-4 inline-flex h-11 items-center rounded-lg border-0 bg-[#02665e] px-5 text-sm font-semibold text-white no-underline hover:bg-[#014d47]">Go to my workspace</a>
            )}
          </section>
        ) : (
          <>
            <SecurityPasskeys scope={OWNER_SECURITY} />

            <section className="card rounded-xl p-5 sm:p-6" style={{ boxSizing: "border-box" }}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600"><Smartphone className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-bold text-slate-900">Prefer an authenticator app?</p>
                  <p className="m-0 mt-0.5 text-xs text-slate-500">Use Google Authenticator or Microsoft Authenticator. Text-message codes do not count here.</p>
                </div>
                <button type="button" onClick={() => setShowAuthenticator((v) => !v)} className="btn btn-outline h-10 rounded-lg px-4 text-sm font-semibold">
                  {showAuthenticator ? "Hide" : "Use an authenticator app"}
                </button>
              </div>
              {showAuthenticator && <div className="mt-5"><SecurityTwoStep scope={OWNER_SECURITY} /></div>}
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-xs text-slate-500">Added one? Check, then sign in again with it.</p>
              <button type="button" onClick={() => void load()} className="btn h-11 rounded-lg border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014d47]">
                I have added it
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
