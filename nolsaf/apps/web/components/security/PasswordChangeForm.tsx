"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Eye, EyeOff, Lock, CheckCircle2, XCircle, AlertCircle } from "lucide-react"
import { useRouter } from "next/navigation"
import SecuritySettingsShell from "@/components/security/SecuritySettingsShell"
import {
  validatePasswordAgainstPolicy,
  type PasswordPolicy,
} from "@/lib/passwordPolicy"
import { useServerPasswordPolicy } from "@/hooks/useServerPasswordPolicy"

export type PasswordChangeFormProps = {
  apiUrl: string
  redirectHref?: string
  backHref?: string
  roleLabel?: string
  variant?: "page" | "section"
  minLength?: number
  maxLength?: number
  exactLength?: number
  requireCurrentPassword?: boolean
  submitLabel?: string
}

export default function PasswordChangeForm({
  apiUrl,
  redirectHref,
  backHref,
  roleLabel = "DRIVER",
  variant = "page",
  minLength,
  maxLength,
  exactLength,
  requireCurrentPassword = true,
  submitLabel,
}: PasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const { policy: serverPolicy, policyReady, policyStatus, retryPolicy } = useServerPasswordPolicy()
  const [passwordMatch, setPasswordMatch] = useState<boolean | null>(null)
  const [inputLocked, setInputLocked] = useState(false)
  const [confirmInputLocked, setConfirmInputLocked] = useState(false)
  const [consecutiveFailures, setConsecutiveFailures] = useState(0)
  const [timeoutUntil, setTimeoutUntil] = useState<number | null>(null)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0)
  const router = useRouter()

  const policy = useMemo<PasswordPolicy>(() => {
    if (typeof exactLength === "number") {
      return { ...serverPolicy, minLength: exactLength, maxLength: exactLength }
    }
    const configuredMin = typeof minLength === "number" ? Math.max(serverPolicy.minLength, minLength) : serverPolicy.minLength
    const configuredMax = typeof maxLength === "number" ? Math.min(serverPolicy.maxLength, maxLength) : serverPolicy.maxLength
    return { ...serverPolicy, minLength: Math.min(configuredMin, configuredMax), maxLength: configuredMax }
  }, [serverPolicy, minLength, maxLength, exactLength])
  const effectiveMaxLength = policy.maxLength
  const passwordValidation = useMemo(() => validatePasswordAgainstPolicy(newPassword, policy), [newPassword, policy])
  const lengthLabel =
    typeof exactLength === "number" ? `Exactly ${exactLength} characters` : `At least ${policy.minLength} characters`
  const placeholderLabel =
    typeof exactLength === "number" ? `${exactLength} characters` : `at least ${policy.minLength} characters`

  useEffect(() => {
    if (confirmPassword && newPassword) {
      setPasswordMatch(newPassword === confirmPassword)
    } else if (confirmPassword && !newPassword) {
      setPasswordMatch(false)
    } else {
      setPasswordMatch(null)
    }
  }, [newPassword, confirmPassword])

  useEffect(() => {
    const lockLen = effectiveMaxLength
    const shouldLock = newPassword.length === lockLen && confirmPassword.length === lockLen && newPassword === confirmPassword
    setInputLocked(shouldLock)
    setConfirmInputLocked(shouldLock)
  }, [newPassword, confirmPassword, effectiveMaxLength])

  useEffect(() => {
    const checkTimers = () => {
      const now = Date.now()
      if (timeoutUntil && now < timeoutUntil) {
        setRemainingSeconds(Math.ceil((timeoutUntil - now) / 1000))
      } else if (timeoutUntil && now >= timeoutUntil) {
        setTimeoutUntil(null)
        setConsecutiveFailures(0)
        setRemainingSeconds(0)
      } else {
        setRemainingSeconds(0)
      }
      if (cooldownUntil && now >= cooldownUntil) {
        setCooldownUntil(null)
      }
    }
    checkTimers()
    const interval = setInterval(checkTimers, 1000)
    return () => clearInterval(interval)
  }, [timeoutUntil, cooldownUntil])

  const isSameAsCurrent = currentPassword && newPassword && currentPassword === newPassword

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (timeoutUntil && Date.now() < timeoutUntil) {
      return
    }

    if (cooldownUntil && Date.now() < cooldownUntil) {
      const remaining = Math.ceil((cooldownUntil - Date.now()) / 60000)
      setError(`Password was recently changed. Please wait ${remaining} minute(s) before changing it again.`)
      return
    }

    if (!newPassword) {
      setError("Please enter a new password")
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match")
      return
    }
    if (typeof exactLength === "number") {
      if (newPassword.length !== exactLength) {
        setError(`Password must be exactly ${exactLength} characters`)
        return
      }
    } else {
      if (newPassword.length < policy.minLength || newPassword.length > effectiveMaxLength) {
        setError(
          newPassword.length < policy.minLength
            ? `Password must be at least ${policy.minLength} characters`
            : "Password is too long",
        )
        return
      }
    }
    if (!passwordValidation.valid) {
      setError("Password requirements:\n" + passwordValidation.reasons.join("\n"))
      return
    }

    if (!policyReady) {
      setError("Password requirements are unavailable. Reload them before changing your password.")
      return
    }
    if (currentPassword && newPassword === currentPassword) {
      setError("The new password must be different from your current password. Please choose a different password.")
      return
    }

    setLoading(true)
    try {
      const res = await fetch(apiUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        const reasons = b?.reasons || b?.details?.reasons || []

        const newFailureCount = consecutiveFailures + 1
        setConsecutiveFailures(newFailureCount)
        if (newFailureCount >= 3) {
          const lockoutDuration = 5 * 60 * 1000
          setTimeoutUntil(Date.now() + lockoutDuration)
          setRemainingSeconds(300)
        } else {
          if (Array.isArray(reasons) && reasons.length) {
            setError("Password change failed:\n" + reasons.join("\n"))
          } else {
            setError((b && b.error) || `Failed (status ${res.status})`)
          }
        }
      } else {
        setConsecutiveFailures(0)
        setTimeoutUntil(null)
        const cooldownDuration = 30 * 60 * 1000
        setCooldownUntil(Date.now() + cooldownDuration)

        setSuccess("Password updated successfully")
        try {
          window.dispatchEvent(
            new CustomEvent("nols:toast", {
              detail: {
                type: "success",
                title: "Password updated",
                message: "Your password was changed. You cannot change it again for 30 minutes.",
                duration: 5000,
              },
            }),
          )
        } catch (e) {}
        if (redirectHref) setTimeout(() => router.push(redirectHref), 800)
        setCurrentPassword("")
        setNewPassword("")
        setConfirmPassword("")
      }
    } catch (err: any) {
      const newFailureCount = consecutiveFailures + 1
      setConsecutiveFailures(newFailureCount)
      if (newFailureCount >= 3) {
        const lockoutDuration = 5 * 60 * 1000
        setTimeoutUntil(Date.now() + lockoutDuration)
        setRemainingSeconds(300)
      } else {
        setError(err?.message ?? String(err))
      }
    } finally {
      setLoading(false)
    }
  }

  const safeBackHref = backHref || redirectHref || "/"

  const requirements = passwordValidation.requirements.map((requirement) => ({
    check: requirement.pass,
    label: requirement.id === "length" ? lengthLabel : requirement.label,
  }))

  const isSection = variant === "section"
  const roleUpper = String(roleLabel || "").toUpperCase()
  const pageContainerClass = roleUpper === "DRIVER" ? "w-full max-w-6xl mx-auto px-4" : "public-container w-full"

  const SectionRequirements =
    isSection && newPassword && policyReady ? (
      <div className="mt-2 space-y-2">
        <div className="space-y-1.5">
          <div className="flex items-center justify-between mb-1">
            <span
              className={`text-xs font-semibold transition-colors duration-200 ${
                passwordValidation.strength === "strong" ? "text-green-600" : passwordValidation.strength === "medium" ? "text-yellow-600" : "text-gray-500"
              }`}
            >
              {passwordValidation.strength === "strong" && "✓ Strong password"}
              {passwordValidation.strength === "medium" && "⚠ Password needs improvement"}
              {passwordValidation.strength === "weak" && "Password is too weak"}
            </span>
          </div>
        </div>

        <div className="space-y-1.5 pt-1">
          <div className="text-xs font-semibold text-slate-600 mb-1.5">Password requirements:</div>
          <div className="space-y-1.5">
            {requirements.map((req, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                {req.check ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                )}
                <span className={req.check ? "text-green-700 font-medium" : "text-slate-500"}>{req.label}</span>
              </div>
            ))}
          </div>
        </div>

        {isSameAsCurrent ? (
          <div className="rounded-lg bg-red-900/20 border border-red-500/30 p-3">
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-400 flex-shrink-0" />
              <span className="text-sm font-semibold text-red-400">The new password must be different from your current password.</span>
            </div>
          </div>
        ) : null}
      </div>
    ) : null

  const InputsGrid = (
    <div
      className={
        isSection
          ? "grid grid-cols-1 md:grid-cols-3 gap-4 w-full"
          : "grid w-full grid-cols-1 gap-5 sm:gap-6 lg:grid-cols-3"
      }
    >
      <div
        className={
          isSection
            ? "min-w-0"
            : "min-w-0 rounded-2xl border border-slate-200/70 bg-white/80 p-4 sm:p-5"
        }
      >
        <label className={isSection ? "text-sm grid gap-1.5 w-full" : "text-sm grid gap-2 w-full"}>
          <span className={isSection ? "font-medium text-slate-300 text-sm" : "font-semibold text-slate-700"}>Current password</span>
          {isSection ? (
            <div className="relative">
              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                className="border border-slate-700 rounded-lg px-3 py-2.5 pr-14 text-sm focus:border-emerald-500/50 focus:outline-none focus:ring-1 focus:ring-emerald-500/20 transition-all duration-200 ease-out w-full bg-slate-800/60 text-slate-100 placeholder:text-slate-500"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400 transition-all duration-200 border-0 bg-transparent outline-none focus:outline-none p-1.5 rounded-md hover:bg-slate-700/50 focus:bg-slate-700/50 cursor-pointer"
                aria-label={showCurrentPassword ? "Hide password" : "Show password"}
              >
                {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          ) : (
            <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:ring-2 focus-within:ring-emerald-200 focus-within:border-emerald-300">
              <input
                type={showCurrentPassword ? "text" : "password"}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter your current password"
                className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <div className="my-2 w-px bg-slate-200" aria-hidden />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="inline-flex w-12 shrink-0 appearance-none items-center justify-center border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-50 hover:text-emerald-600 focus:outline-none focus-visible:outline-none"
                aria-label={showCurrentPassword ? "Hide password" : "Show password"}
              >
                {showCurrentPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          )}
        </label>
      </div>

      <div
        className={
          isSection
            ? "min-w-0"
            : "min-w-0 rounded-2xl border border-slate-200/70 bg-white/80 p-4 sm:p-5"
        }
      >
        <label className={isSection ? "text-sm grid gap-1.5 w-full" : "text-sm grid gap-2 w-full"}>
          <span className={isSection ? "font-medium text-slate-300 text-sm" : "font-semibold text-slate-700"}>New password</span>
          {isSection ? (
            <div className="relative">
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => {
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const value = e.target.value
                  const truncated = value.slice(0, effectiveMaxLength)
                  setNewPassword(truncated)
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const pastedText = e.clipboardData.getData("text")
                  const truncated = pastedText.slice(0, effectiveMaxLength)
                  setNewPassword(truncated)
                }}
                maxLength={effectiveMaxLength}
                disabled={!policyReady || inputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)}
                placeholder={placeholderLabel}
                className={`border rounded-lg px-3 py-2.5 pr-14 text-sm focus:outline-none focus:ring-1 transition-all duration-300 ease-out w-full bg-slate-800/60 text-slate-100 placeholder:text-slate-500 ${
                  inputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)
                    ? "bg-slate-700 cursor-not-allowed border-red-500/60"
                    : !newPassword
                      ? "border-slate-200 focus:border-[#02665e]/50 focus:ring-[#02665e]/20"
                      : passwordValidation.strength === "strong"
                        ? "border-green-500 focus:border-green-600 focus:ring-green-200"
                        : passwordValidation.strength === "medium"
                          ? "border-yellow-500 focus:border-yellow-600 focus:ring-yellow-200"
                          : "border-red-300 focus:border-red-400 focus:ring-red-200"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400 transition-all duration-200 border-0 bg-transparent outline-none focus:outline-none p-1.5 rounded-md hover:bg-slate-700/50 focus:bg-slate-700/50 cursor-pointer"
                aria-label={showNewPassword ? "Hide password" : "Show password"}
              >
                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          ) : (
            <div
              className={`flex items-stretch overflow-hidden rounded-xl border shadow-sm transition focus-within:ring-2 ${
                inputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)
                  ? "border-slate-200 bg-slate-100 text-slate-600"
                  : !newPassword
                    ? "border-slate-200 bg-white focus-within:border-emerald-300 focus-within:ring-emerald-200"
                    : passwordValidation.strength === "strong"
                      ? "border-green-500 bg-white focus-within:border-green-600 focus-within:ring-green-200"
                      : passwordValidation.strength === "medium"
                        ? "border-yellow-500 bg-white focus-within:border-yellow-600 focus-within:ring-yellow-200"
                        : "border-red-300 bg-white focus-within:border-red-400 focus-within:ring-red-200"
              }`}
            >
              <input
                type={showNewPassword ? "text" : "password"}
                value={newPassword}
                onChange={(e) => {
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const value = e.target.value
                  const truncated = value.slice(0, effectiveMaxLength)
                  setNewPassword(truncated)
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const pastedText = e.clipboardData.getData("text")
                  const truncated = pastedText.slice(0, effectiveMaxLength)
                  setNewPassword(truncated)
                }}
                maxLength={effectiveMaxLength}
                disabled={!policyReady || inputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)}
                placeholder={`Enter your new password (${placeholderLabel})`}
                className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-600"
              />
              <div className="my-2 w-px bg-slate-200" aria-hidden />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="inline-flex w-12 shrink-0 appearance-none items-center justify-center border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-50 hover:text-emerald-600 focus:outline-none focus-visible:outline-none disabled:opacity-60"
                aria-label={showNewPassword ? "Hide password" : "Show password"}
                disabled={!policyReady || inputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)}
              >
                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          )}
        </label>
        {SectionRequirements}
      </div>

      <div
        className={
          isSection
            ? "min-w-0"
            : "min-w-0 rounded-2xl border border-slate-200/70 bg-white/80 p-4 sm:p-5"
        }
      >
        <label className={isSection ? "text-sm grid gap-1.5 w-full" : "text-sm grid gap-2 w-full"}>
          <span className={isSection ? "font-medium text-slate-300 text-sm" : "font-semibold text-slate-700"}>Confirm new password</span>
          {isSection ? (
            <div className="relative">
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const value = e.target.value
                  const truncated = value.slice(0, effectiveMaxLength)
                  setConfirmPassword(truncated)
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const pastedText = e.clipboardData.getData("text")
                  const truncated = pastedText.slice(0, effectiveMaxLength)
                  setConfirmPassword(truncated)
                }}
                maxLength={effectiveMaxLength}
                disabled={!policyReady || confirmInputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)}
                placeholder={placeholderLabel}
                className={`border rounded-lg px-3 py-2.5 pr-14 text-sm focus:outline-none focus:ring-1 transition-all duration-300 ease-out w-full bg-slate-800/60 text-slate-100 placeholder:text-slate-500 ${
                  confirmInputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)
                    ? "bg-slate-700 cursor-not-allowed border-red-500/60"
                    : !confirmPassword
                      ? "border-slate-200 focus:border-[#02665e]/50 focus:ring-[#02665e]/20"
                      : passwordMatch === true
                        ? "border-green-500 focus:border-green-600 focus:ring-green-200"
                        : passwordMatch === false
                          ? "border-red-500 focus:border-red-600 focus:ring-red-200"
                          : "border-slate-200 focus:border-[#02665e]/50 focus:ring-[#02665e]/20"
                }`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-400 transition-all duration-200 border-0 bg-transparent outline-none focus:outline-none p-1.5 rounded-md hover:bg-slate-700/50 focus:bg-slate-700/50 cursor-pointer"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
              >
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          ) : (
            <div
              className={`flex items-stretch overflow-hidden rounded-xl border shadow-sm transition focus-within:ring-2 ${
                confirmInputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)
                  ? "border-slate-200 bg-slate-100 text-slate-600"
                  : !confirmPassword
                    ? "border-slate-200 bg-white focus-within:border-emerald-300 focus-within:ring-emerald-200"
                    : passwordMatch === null
                      ? "border-slate-200 bg-white focus-within:border-emerald-300 focus-within:ring-emerald-200"
                      : passwordMatch === true
                        ? "border-green-500 bg-white focus-within:border-green-600 focus-within:ring-green-200"
                        : "border-red-500 bg-white focus-within:border-red-600 focus-within:ring-red-200"
              }`}
            >
              <input
                type={showConfirmPassword ? "text" : "password"}
                value={confirmPassword}
                onChange={(e) => {
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const value = e.target.value
                  const truncated = value.slice(0, effectiveMaxLength)
                  setConfirmPassword(truncated)
                }}
                onPaste={(e) => {
                  e.preventDefault()
                  if (timeoutUntil && Date.now() < timeoutUntil) return
                  const pastedText = e.clipboardData.getData("text")
                  const truncated = pastedText.slice(0, effectiveMaxLength)
                  setConfirmPassword(truncated)
                }}
                maxLength={effectiveMaxLength}
                disabled={!policyReady || confirmInputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)}
                placeholder={`Confirm your new password (${placeholderLabel})`}
                className="min-w-0 flex-1 border-0 bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-600"
              />
              <div className="my-2 w-px bg-slate-200" aria-hidden />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="inline-flex w-12 shrink-0 appearance-none items-center justify-center border-0 bg-transparent text-slate-500 transition-colors hover:bg-slate-50 hover:text-emerald-600 focus:outline-none focus-visible:outline-none disabled:opacity-60"
                aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                disabled={!policyReady || confirmInputLocked || (timeoutUntil !== null && Date.now() < timeoutUntil)}
              >
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          )}
        </label>

        {confirmPassword ? (
          <div className="mt-2">
            {passwordMatch === true ? (
              <div className={isSection ? "text-xs text-green-600 font-medium" : "flex items-center gap-1.5 text-xs text-green-600 font-medium animate-in fade-in slide-in-from-top-1 duration-200"}>
                {isSection ? null : <CheckCircle2 className="h-3.5 w-3.5 flex-shrink-0" />}
                <span>Passwords match</span>
              </div>
            ) : passwordMatch === false ? (
              <div className={isSection ? "text-xs text-red-600 font-medium" : "flex items-center gap-1.5 text-xs text-red-600 font-medium animate-in fade-in slide-in-from-top-1 duration-200"}>
                {isSection ? null : <XCircle className="h-3.5 w-3.5 flex-shrink-0" />}
                <span>Passwords do not match</span>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )

  const FormFields = (
    <>
      {policyStatus !== "ready" ? (
        <div className={isSection ? "rounded-lg border border-amber-500/30 bg-amber-900/20 p-3 text-sm text-amber-300" : "rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"}>
          <span>{policyStatus === "loading" ? "Loading password requirements…" : "Password requirements could not be loaded."}</span>
          {policyStatus === "error" ? (
            <button type="button" onClick={retryPolicy} className="ml-2 border-0 bg-transparent p-0 font-semibold underline">
              Retry
            </button>
          ) : null}
        </div>
      ) : null}
      {InputsGrid}

      {!isSection && newPassword && policyReady ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="space-y-2">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between mb-1">
                <span
                  className={`text-xs font-semibold transition-colors duration-200 ${
                    passwordValidation.strength === "strong" ? "text-green-600" : passwordValidation.strength === "medium" ? "text-yellow-600" : "text-red-600"
                  }`}
                >
                  {passwordValidation.strength === "strong" && "✓ Strong password"}
                  {passwordValidation.strength === "medium" && "⚠ Password needs improvement"}
                  {passwordValidation.strength === "weak" && "✗ Password is too weak"}
                </span>
                <span className="text-xs text-slate-500">{passwordValidation.score}%</span>
              </div>
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${
                    passwordValidation.strength === "strong"
                      ? "bg-gradient-to-r from-green-500 to-emerald-600"
                      : passwordValidation.strength === "medium"
                        ? "bg-gradient-to-r from-yellow-400 to-orange-500"
                        : "bg-gradient-to-r from-red-400 to-red-600"
                  }`}
                  style={{ width: `${passwordValidation.score}%` } as React.CSSProperties}
                />
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <div className="text-xs font-semibold text-slate-400 mb-1.5">Password requirements:</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1.5 gap-x-4">
                {requirements.map((req, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-xs">
                    {req.check ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                    )}
                    <span className={req.check ? "text-green-700 font-medium" : "text-slate-500"}>{req.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {isSameAsCurrent ? (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-red-600 font-medium animate-in fade-in slide-in-from-top-1 duration-200 bg-red-50 border border-red-200 rounded-lg p-2">
                <div className="flex items-center gap-1.5">
                  <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span>The new password must be different from your current password.</span>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {timeoutUntil && Date.now() < timeoutUntil && (
        <div className={isSection ? "rounded-lg bg-red-900/20 border-2 border-red-500/30 p-4" : "rounded-md bg-red-50 border-2 border-red-200 p-4"}>
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-bold text-red-400 mb-1">
                Account temporarily locked due to {consecutiveFailures >= 3 ? 3 : consecutiveFailures} failed attempt
                {consecutiveFailures >= 3 ? "s" : consecutiveFailures > 1 ? "s" : ""}
              </div>
              <div className="text-sm text-red-400">
                Please wait <span className="font-bold text-red-300">{remainingSeconds}</span> second
                {remainingSeconds !== 1 ? "s" : ""} before trying again.
              </div>
            </div>
          </div>
        </div>
      )}

      {cooldownUntil && Date.now() < cooldownUntil && (
        <div className={isSection ? "rounded-lg bg-blue-900/20 border border-blue-500/30 p-3" : "rounded-md bg-blue-50 border-2 border-blue-200 p-3"}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-blue-600 flex-shrink-0" />
              <div className="text-sm font-semibold text-blue-300">
              Password was recently changed. You can change it again in {Math.ceil((cooldownUntil - Date.now()) / 60000)} minute(s).
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className={isSection ? "rounded-lg bg-red-900/20 border border-red-500/30 p-3" : "rounded-md bg-red-50 border-2 border-red-200 p-3"}>
          <div className={isSection ? "text-sm font-medium text-red-400 whitespace-pre-line" : "text-sm font-medium text-red-800 whitespace-pre-line"}>{error}</div>
        </div>
      )}
      {success && (
        <div className={isSection ? "rounded-lg bg-green-900/20 border border-green-500/30 p-3" : "rounded-md bg-green-50 border-2 border-green-200 p-3"}>
          <div className="text-sm font-medium text-green-400">{success}</div>
        </div>
      )}

      <div className={isSection ? "flex justify-end pt-2" : "flex w-full flex-col sm:flex-row flex-wrap items-stretch sm:items-center justify-end gap-3 pt-4"}>
        {!isSection ? (
          <Link
            href={safeBackHref}
            className="w-full sm:w-auto inline-flex items-center justify-center px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors border-2 border-slate-200 hover:border-slate-300 no-underline whitespace-nowrap"
          >
            Cancel
          </Link>
        ) : null}
        <button
          type="submit"
          disabled={
            loading ||
            !policyReady ||
            !passwordValidation.valid ||
            newPassword !== confirmPassword ||
            (requireCurrentPassword ? !currentPassword : false) ||
            isSameAsCurrent ||
            (timeoutUntil !== null && Date.now() < timeoutUntil) ||
            (cooldownUntil !== null && Date.now() < cooldownUntil)
          }
          className={
            isSection
              ? "w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 sm:px-6 py-3 rounded-xl bg-[#02665e] text-white font-semibold text-sm hover:bg-[#014d47] hover:shadow-md active:scale-[0.98] transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:bg-[#02665e]"
              : "w-full sm:w-auto inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors border-2 border-emerald-600 hover:border-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          }
        >
          {loading ? (isSection ? "Saving..." : "Saving...") : submitLabel || (isSection ? "Update Password" : "Save")}
        </button>
      </div>
    </>
  )

  if (isSection) {
    return (
      <section className="rounded-2xl border border-slate-700/60 bg-[#0f1923] shadow-lg transition-all duration-200 p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start gap-4 mb-6">
          <div className="h-12 w-12 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center flex-shrink-0 transition-transform duration-200 hover:scale-110">
            <Lock className="h-6 w-6 text-emerald-400" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0 break-words">
            <div className="font-semibold text-lg text-slate-100 break-words">Change Password</div>
            <p className="text-sm text-slate-400 mt-1 whitespace-normal break-words">Update your account password. Choose a strong, unique password.</p>
          </div>
        </div>

        <form
          className="space-y-4 w-full"
          onSubmit={(e) => {
            void submit(e)
          }}
        >
          {FormFields}
        </form>
      </section>
    )
  }

  return (
    <SecuritySettingsShell
      containerClassName={pageContainerClass}
      title="Change Password"
      description="Update your account password. Choose a strong, unique password."
      icon={Lock}
      iconBgClassName="bg-emerald-50"
      iconClassName="text-emerald-700"
      backHref={safeBackHref}
      backLabel="Back to Security"
      backAriaLabel="Back to Security"
    >
      <div className="mx-auto w-full max-w-5xl rounded-3xl border border-slate-200/70 bg-white/75 backdrop-blur shadow-card ring-1 ring-slate-900/5 overflow-hidden">
        <div className="p-5 sm:p-6">
          <form onSubmit={submit} className="space-y-5">
            {FormFields}
          </form>
        </div>
      </div>
    </SecuritySettingsShell>
  )
}
