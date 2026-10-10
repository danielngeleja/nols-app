"use client"

import type { SecurityScope } from "./securityData"
import React, { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Check, CircleAlert, Eye, EyeOff, Loader2, RefreshCw, X } from "lucide-react"
import { validatePasswordAgainstPolicy } from "@/lib/passwordPolicy"
import { useServerPasswordPolicy } from "@/hooks/useServerPasswordPolicy"

const LOCKOUT_MS = 5 * 60 * 1000
const COOLDOWN_MS = 30 * 60 * 1000

export default function SecurityPassword({ scope }: { scope: SecurityScope }) {
  const router = useRouter()
  const { policy, policyReady, policyStatus, retryPolicy } = useServerPasswordPolicy()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState({ current: false, next: false, confirm: false })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [failures, setFailures] = useState(0)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [tick, setTick] = useState(() => Date.now())

  useEffect(() => {
    if (!lockedUntil && !cooldownUntil) return
    const t = setInterval(() => setTick(Date.now()), 1000)
    return () => clearInterval(t)
  }, [lockedUntil, cooldownUntil])

  useEffect(() => {
    if (lockedUntil && tick >= lockedUntil) { setLockedUntil(null); setFailures(0) }
    if (cooldownUntil && tick >= cooldownUntil) setCooldownUntil(null)
  }, [tick, lockedUntil, cooldownUntil])

  const check = useMemo(() => validatePasswordAgainstPolicy(next, policy), [next, policy])
  const sameAsCurrent = Boolean(current && next && current === next)
  const matches = confirm.length > 0 && next === confirm
  const lockSeconds = lockedUntil ? Math.max(0, Math.ceil((lockedUntil - tick) / 1000)) : 0
  const ready = policyReady && current.length > 0 && check.valid && matches && !sameAsCurrent && !lockedUntil && !cooldownUntil && !saving

  const fail = (message: string) => {
    const count = failures + 1
    setFailures(count)
    if (count >= 3) {
      setLockedUntil(Date.now() + LOCKOUT_MS)
      setTick(Date.now())
      setError(null)
    } else {
      setError(message)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!ready) return
    setSaving(true)
    try {
      const res = await fetch("/api/account/password/change", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        const reasons = body?.reasons || body?.details?.reasons || []
        fail(Array.isArray(reasons) && reasons.length ? reasons.join(" ") : body?.error || `The password could not be changed (status ${res.status}).`)
        return
      }
      setFailures(0)
      setCooldownUntil(Date.now() + COOLDOWN_MS)
      setDone(true)
      setCurrent("")
      setNext("")
      setConfirm("")
      window.dispatchEvent(new CustomEvent("nols:toast", { detail: { type: "success", title: "Password updated", message: "Your password was changed. You cannot change it again for 30 minutes.", duration: 5000 } }))
      setTimeout(() => router.push(scope.base), 1200)
    } catch (err: any) {
      fail(err?.message || "The password could not be changed.")
    } finally {
      setSaving(false)
    }
  }

  const strength = !next ? null : check.strength === "strong" ? { label: "Strong", bar: "bg-[#02665e]", width: "100%", tone: "text-emerald-700" } : check.strength === "medium" ? { label: "Almost there", bar: "bg-amber-500", width: "60%", tone: "text-amber-700" } : { label: "Too weak", bar: "bg-rose-500", width: "25%", tone: "text-rose-600" }
  const field = "min-w-0 flex-1 border-0 bg-transparent px-4 text-sm text-slate-900 outline-none placeholder:text-slate-400"

  const renderField = ({ id, label, value, onChange, visible, toggle, placeholder, autoComplete, state }: { id: string; label: string; value: string; onChange: (v: string) => void; visible: boolean; toggle: () => void; placeholder: string; autoComplete: string; state?: "good" | "bad" | null }) => (
    <div>
      <label htmlFor={id} className="text-xs font-bold text-slate-700">{label}</label>
      <div className={`mt-1.5 flex h-12 items-stretch overflow-hidden rounded-xl border border-solid bg-white transition focus-within:ring-2 focus-within:ring-[#02665e]/15 ${state === "bad" ? "border-rose-300" : state === "good" ? "border-emerald-300" : "border-slate-300 focus-within:border-[#02665e]"}`}>
        <input id={id} type={visible ? "text" : "password"} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} maxLength={policy.maxLength} disabled={Boolean(lockedUntil)} className={field} />
        <button type="button" onClick={toggle} aria-label={visible ? "Hide password" : "Show password"} className="grid w-12 shrink-0 place-items-center border-0 bg-transparent text-slate-400 hover:text-[#02665e]">
          {visible ? <EyeOff className="h-[18px] w-[18px]" aria-hidden /> : <Eye className="h-[18px] w-[18px]" aria-hidden />}
        </button>
      </div>
    </div>
  )

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <form onSubmit={submit} className="rounded-xl border border-solid border-slate-200 bg-white p-6 sm:p-7" noValidate>
        <h2 className="m-0 text-base font-bold text-slate-900">Change your password</h2>
        <p className="m-0 mt-1 text-xs text-slate-500">Confirm the password you use now, then choose a new one.</p>

        {policyStatus === "error" && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl bg-amber-50 px-4 py-3 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">
            <span className="flex-1">The password rules could not be loaded, so changes are paused.</span>
            <button type="button" onClick={retryPolicy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-amber-600 px-3 font-bold text-white"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Try again</button>
          </div>
        )}
        {lockedUntil && (
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">
            <CircleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
            Too many failed tries. You can try again in {Math.floor(lockSeconds / 60)}:{String(lockSeconds % 60).padStart(2, "0")}.
          </div>
        )}
        {done && (
          <div className="mt-5 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">
            <Check className="mt-px h-4 w-4 shrink-0" aria-hidden />
            Password changed. Taking you back to Security.
          </div>
        )}

        <div className="mt-6 space-y-5">
          {renderField({ id: "pw-current", label: "Current password", value: current, onChange: setCurrent, visible: show.current, toggle: () => setShow((s) => ({ ...s, current: !s.current })), placeholder: "The password you use now", autoComplete: "current-password" })}
          <div className="border-0 border-t border-dashed border-slate-200" />
          <div>
            {renderField({ id: "pw-new", label: "New password", value: next, onChange: setNext, visible: show.next, toggle: () => setShow((s) => ({ ...s, next: !s.next })), placeholder: `At least ${policy.minLength} characters`, autoComplete: "new-password", state: next ? (check.valid && !sameAsCurrent ? "good" : "bad") : null })}
            {strength && (
              <div className="mt-2 flex items-center gap-3">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full transition-all duration-300 ${strength.bar}`} style={{ width: strength.width }} /></span>
                <span className={`text-[11px] font-bold ${strength.tone}`}>{strength.label}</span>
              </div>
            )}
            {sameAsCurrent && <p className="m-0 mt-1.5 text-xs font-semibold text-rose-600">The new password must be different from the one you use now.</p>}
          </div>
          <div>
            {renderField({ id: "pw-confirm", label: "Type the new password again", value: confirm, onChange: setConfirm, visible: show.confirm, toggle: () => setShow((s) => ({ ...s, confirm: !s.confirm })), placeholder: "Same as above", autoComplete: "new-password", state: confirm ? (matches ? "good" : "bad") : null })}
            {confirm && !matches && <p className="m-0 mt-1.5 text-xs font-semibold text-rose-600">The two passwords do not match yet.</p>}
          </div>
        </div>

        {error && <p className="m-0 mt-5 flex items-start gap-1.5 text-xs font-semibold text-rose-600"><CircleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />{error}</p>}

        <div className="mt-6 flex flex-wrap items-center justify-end gap-3 border-0 border-t border-solid border-slate-100 pt-5">
          <button type="button" onClick={() => router.push(scope.base)} className="inline-flex h-11 items-center rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" disabled={!ready} className="inline-flex h-11 items-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-bold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {saving ? "Saving..." : cooldownUntil ? "Changed recently" : "Update password"}
          </button>
        </div>
      </form>

      <aside className="space-y-5 lg:sticky lg:top-24">
        <section className="rounded-xl border border-solid border-slate-200 bg-white p-5">
          <p className="m-0 text-sm font-bold text-slate-900">Your new password needs</p>
          {policyReady ? (
            <ul className="m-0 mt-3 list-none space-y-2 p-0">
              {check.requirements.map((req) => (
                <li key={req.id} className={`flex items-center gap-2.5 text-sm ${req.pass ? "text-slate-900" : "text-slate-500"}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${req.pass ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-300"}`}>{req.pass ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}</span>
                  {req.label}
                </li>
              ))}
              <li className={`flex items-center gap-2.5 text-sm ${next && !sameAsCurrent ? "text-slate-900" : "text-slate-500"}`}>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${next && !sameAsCurrent ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-300"}`}>{next && !sameAsCurrent ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}</span>
                Different from your current password
              </li>
            </ul>
          ) : (
            <p className="m-0 mt-3 text-xs text-slate-500">{policyStatus === "error" ? "Rules unavailable." : "Loading the rules..."}</p>
          )}
        </section>
        <section className="rounded-xl bg-slate-50 p-5 ring-1 ring-inset ring-slate-200">
          <p className="m-0 text-sm font-bold text-slate-900">Good to know</p>
          <ul className="m-0 mt-2 list-disc space-y-1.5 pl-4 text-xs leading-5 text-slate-600">
            <li>After a change, you have to wait 30 minutes before changing it again.</li>
            <li>Three wrong tries in a row pause changes for 5 minutes.</li>
            <li>A long phrase you can remember beats a short, complex word.</li>
          </ul>
        </section>
      </aside>
    </div>
  )
}
