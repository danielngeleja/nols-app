"use client"

import React, { Suspense, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, ShieldAlert } from "lucide-react"

type State = "idle" | "working" | "done" | "already" | "error"

/**
 * Opened from the "Sign out that device" button in the new sign-in email.
 * Mail scanners open links on their own, so nothing happens until the person
 * presses the button here. Works signed out: the link itself is the proof.
 */
function SignOutDevice() {
  const token = useSearchParams()?.get("t") || ""
  const [state, setState] = useState<State>(token ? "idle" : "error")
  const [message, setMessage] = useState(token ? "" : "This link is incomplete. Sign in and review your devices instead.")

  const signOut = async () => {
    setState("working")
    try {
      const res = await fetch("/api/auth/sign-in-alert/sign-out", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setState("error")
        setMessage(body?.message || "We could not sign that device out. Sign in and review your devices instead.")
        return
      }
      setState(body?.alreadySignedOut ? "already" : "done")
    } catch {
      setState("error")
      setMessage("We could not reach NoLSAF. Check your connection and try again.")
    }
  }

  const finished = state === "done" || state === "already"

  return (
    <div className="card mx-auto w-full max-w-lg rounded-xl p-6 sm:p-8" style={{ boxSizing: "border-box" }}>
      <div className="flex items-start gap-3">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg ${finished ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
          {finished ? <CheckCircle2 className="h-5 w-5" aria-hidden /> : <ShieldAlert className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <h1 className="m-0 text-lg font-bold text-slate-900">
            {finished ? "That device is signed out" : "Sign out the new device"}
          </h1>
          <p className="mb-0 mt-1 text-sm text-slate-600">
            {state === "done" && "It can no longer use your account. NoLSAF will alert you again if it signs in."}
            {state === "already" && "It was already signed out. NoLSAF will alert you again if it signs in."}
            {(state === "idle" || state === "working") && "This signs out only the device from the alert email. Your other devices stay signed in."}
            {state === "error" && message}
          </p>
        </div>
      </div>

      {(state === "idle" || state === "working") && (
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={state === "working"}
          className="btn mt-6 h-11 w-full rounded-lg border-0 bg-rose-700 px-4 text-sm font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
        >
          {state === "working" ? "Signing out..." : "Sign out that device"}
        </button>
      )}

      {finished && (
        <div className="mt-6 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-900">
          <strong>If you did not sign in, change your password now.</strong> Someone who knows it can sign in again.
          <div className="mt-3">
            <Link href="/account/forgot-password" className="btn h-10 rounded-lg border-0 bg-rose-700 px-4 text-sm font-semibold text-white no-underline hover:bg-rose-800">
              Reset password
            </Link>
          </div>
        </div>
      )}

      {state === "error" && (
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/account/login" className="btn btn-outline h-10 rounded-lg px-4 text-sm font-semibold no-underline">Sign in</Link>
          <Link href="/account/forgot-password" className="btn h-10 rounded-lg border-0 bg-rose-700 px-4 text-sm font-semibold text-white no-underline hover:bg-rose-800">Reset password</Link>
        </div>
      )}
    </div>
  )
}

export default function SignOutDevicePage() {
  return (
    <main className="public-container w-full py-10 sm:py-16" style={{ boxSizing: "border-box" }}>
      <Suspense fallback={null}>
        <SignOutDevice />
      </Suspense>
    </main>
  )
}
