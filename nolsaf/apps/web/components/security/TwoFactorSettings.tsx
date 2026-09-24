"use client"

import React, { useEffect, useRef, useState } from "react"
import { Lock, Smartphone, Shield, CheckCircle, XCircle } from "lucide-react"
import Spinner from "@/components/Spinner"
import SecuritySettingsShell from "@/components/security/SecuritySettingsShell"
import BackupCodesPanel from "@/components/security/BackupCodesPanel"
import RegenerateBackupCodes from "@/components/security/RegenerateBackupCodes"

type Status = { totpEnabled: boolean; smsEnabled: boolean; phone?: string | null }

export type TwoFactorSettingsProps = {
  statusUrl: string
  provisionTotpUrl: string
  postUrl: string
  smsSendUrl: string
  smsVerifyUrl: string
  smsDisableUrl: string
  backHref: string
  containerClassName?: string
  /** Where "Generate new backup codes" posts. Hidden when not provided. */
  regenerateCodesUrl?: string
}

export default function TwoFactorSettings({
  statusUrl,
  provisionTotpUrl,
  postUrl,
  smsSendUrl,
  smsVerifyUrl,
  smsDisableUrl,
  backHref,
  containerClassName,
  regenerateCodesUrl,
}: TwoFactorSettingsProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  const [totpFlow, setTotpFlow] = useState<"idle" | "provision" | "verifying" | "enabled" | "disabled">("idle")
  const [smsFlow, setSmsFlow] = useState<"idle" | "sent" | "verifying" | "enabled" | "disabled">("idle")
  const [otp, setOtp] = useState("")
  const [disableCode, setDisableCode] = useState("")
  const [showDisableInput, setShowDisableInput] = useState(false)
  const [smsDisableCode, setSmsDisableCode] = useState("")
  const [showSmsDisableInput, setShowSmsDisableInput] = useState(false)
  const [sending, setSending] = useState(false)
  const [provision, setProvision] = useState<{ qr?: string; secret?: string; otpauth?: string } | null>(null)
  /** Plain backup codes, returned once when the authenticator is turned on. */
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const totpVerifyingRef = useRef(false)
  const smsVerifyingRef = useRef(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch(statusUrl, { credentials: "include" })
        if (!mounted) return
        if (!res.ok) return
        const body = await res.json().catch(() => null)
        if (body) {
          const isTotpEnabled = !!body.totpEnabled
          const isSmsEnabled = !!body.smsEnabled
          setStatus({ totpEnabled: isTotpEnabled, smsEnabled: isSmsEnabled, phone: body.phone ?? null })
          setTotpFlow(isTotpEnabled ? "enabled" : "idle")
          setSmsFlow(isSmsEnabled ? "enabled" : "idle")
        }
      } catch (e) {
        // ignore
      }
    })()
    return () => {
      mounted = false
    }
  }, [statusUrl])

  const dispatchToast = (t: any) => {
    try {
      window.dispatchEvent(new CustomEvent("nols:toast", { detail: t }))
    } catch (e) {}
  }

  const handleTotpEnableStart = async () => {
    setError(null)
    setOtp("")
    setProvision(null)
    setTotpFlow("provision")
    try {
      const res = await fetch(provisionTotpUrl, { credentials: "include" })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError((b && b.error) || `Failed (status ${res.status})`)
        setTotpFlow("idle")
        return
      }
      const body = await res.json().catch(() => null)
      setProvision({ qr: body?.qr ?? null, secret: body?.secret ?? null, otpauth: body?.otpauth ?? null })
    } catch (e: any) {
      setError(String(e))
      setTotpFlow("idle")
    }
  }

  const handleTotpVerify = async () => {
    if (totpVerifyingRef.current) return
    totpVerifyingRef.current = true
    setError(null)
    setLoading(true)
    setTotpFlow("verifying")
    try {
      const payload: any = { type: "totp", action: "enable", code: otp }
      if (provision?.secret) payload.secret = provision.secret
      const res = await fetch(postUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && (body.error || body.details)) || `Failed (status ${res.status})`)
        setTotpFlow("provision")
        dispatchToast({ type: "error", title: "2FA", message: "Failed to enable authenticator." })
      } else {
        setStatus((s) => (s ? { ...s, totpEnabled: true } : { totpEnabled: true, smsEnabled: false }))
        setTotpFlow("enabled")
        if (Array.isArray(body?.backupCodes)) setBackupCodes(body.backupCodes)
        dispatchToast({ type: "success", title: "Two-factor enabled", message: "Authenticator/TOTP enabled." })
      }
    } catch (e: any) {
      setError(String(e))
      setTotpFlow("provision")
    } finally {
      setLoading(false)
    }
    totpVerifyingRef.current = false
  }

  const handleDisableClick = () => {
    setShowDisableInput(true)
    setDisableCode("")
    setError(null)
  }

  const cancelDisable = () => {
    setShowDisableInput(false)
    setDisableCode("")
    setError(null)
  }

  const handleTotpDisable = async () => {
    if (!disableCode || disableCode.trim().length === 0) {
      setError("Please enter a TOTP code or backup code")
      dispatchToast({ type: "error", title: "Error", message: "Please enter a TOTP code or backup code" })
      return
    }
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(postUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "totp", action: "disable", code: disableCode.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && body.error) || `Failed (status ${res.status})`)
        dispatchToast({ type: "error", title: "2FA", message: "Failed to disable authenticator." })
      } else {
        setStatus((s) => (s ? { ...s, totpEnabled: false } : { totpEnabled: false, smsEnabled: false }))
        setTotpFlow("disabled")
        setShowDisableInput(false)
        setDisableCode("")
        dispatchToast({ type: "success", title: "Two-factor disabled", message: "Authenticator/TOTP disabled." })
      }
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleSmsSend = async () => {
    setError(null)
    setSending(true)
    try {
      const res = await fetch(smsSendUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && body.error) || `Failed (status ${res.status})`)
        dispatchToast({ type: "error", title: "Failed to send SMS", message: (body && body.error) || "Failed to send SMS code." })
      } else {
        setSmsFlow("sent")
        dispatchToast({ type: "info", title: "SMS sent", message: "A verification code was sent to your phone." })
      }
    } catch (e: any) {
      setError(String(e))
      dispatchToast({ type: "error", title: "Failed to send SMS", message: String(e) })
    } finally {
      setSending(false)
    }
  }

  const handleSmsVerify = async () => {
    if (smsVerifyingRef.current) return
    if (!otp || otp.length !== 6 || !/^\d{6}$/.test(otp)) {
      setError("Please enter a valid 6-digit verification code")
      dispatchToast({ type: "error", title: "Error", message: "Please enter a valid 6-digit verification code" })
      return
    }
    smsVerifyingRef.current = true
    setError(null)
    setLoading(true)
    setSmsFlow("verifying")
    try {
      const codeToSend = String(otp).replace(/\D/g, "").slice(0, 6)
      const res = await fetch(smsVerifyUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToSend }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && body.error) || `Failed (status ${res.status})`)
        setSmsFlow("sent")
        dispatchToast({ type: "error", title: "2FA", message: (body && body.error) || "Failed to verify SMS code." })
      } else {
        const statusRes = await fetch(statusUrl, { credentials: "include" })
        const statusBody = await statusRes.json().catch(() => null)
        if (statusBody) {
          const isTotpEnabled = !!statusBody.totpEnabled
          const isSmsEnabled = !!statusBody.smsEnabled
          setStatus({ totpEnabled: isTotpEnabled, smsEnabled: isSmsEnabled, phone: statusBody.phone ?? null })
          setSmsFlow(isSmsEnabled ? "enabled" : "idle")
        } else {
          setStatus((s) => (s ? { ...s, smsEnabled: true } : { totpEnabled: false, smsEnabled: true }))
          setSmsFlow("enabled")
        }
        setOtp("")
        dispatchToast({ type: "success", title: "Two-factor enabled", message: "SMS-based 2FA enabled." })
      }
    } catch (e: any) {
      setError(String(e))
      setSmsFlow("sent")
      dispatchToast({ type: "error", title: "2FA", message: "Failed to verify SMS code." })
    } finally {
      setLoading(false)
      smsVerifyingRef.current = false
    }
  }

  const handleSmsDisableClick = async () => {
    setError(null)
    setSending(true)
    try {
      const res = await fetch(smsSendUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && body.error) || `Failed (status ${res.status})`)
        dispatchToast({ type: "error", title: "Failed to send SMS", message: (body && body.error) || "Failed to send SMS code." })
      } else {
        setShowSmsDisableInput(true)
        setSmsDisableCode("")
        dispatchToast({
          type: "info",
          title: "SMS sent",
          message: "A verification code was sent to your phone. Enter it to disable SMS 2FA.",
        })
      }
    } catch (e: any) {
      setError(String(e))
      dispatchToast({ type: "error", title: "Failed to send SMS", message: String(e) })
    } finally {
      setSending(false)
    }
  }

  const cancelSmsDisable = () => {
    setShowSmsDisableInput(false)
    setSmsDisableCode("")
    setError(null)
  }

  const handleSmsDisable = async () => {
    if (!smsDisableCode || smsDisableCode.length !== 6 || !/^\d{6}$/.test(smsDisableCode)) {
      setError("Please enter a valid 6-digit verification code")
      dispatchToast({ type: "error", title: "Error", message: "Please enter a valid 6-digit verification code" })
      return
    }
    setError(null)
    setLoading(true)
    try {
      const codeToSend = String(smsDisableCode).replace(/\D/g, "").slice(0, 6)
      const res = await fetch(smsDisableUrl, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeToSend }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError((body && body.error) || `Failed (status ${res.status})`)
        dispatchToast({ type: "error", title: "2FA", message: (body && body.error) || "Failed to disable SMS-based 2FA." })
      } else {
        const statusRes = await fetch(statusUrl, { credentials: "include" })
        const statusBody = await statusRes.json().catch(() => null)
        if (statusBody) {
          const isTotpEnabled = !!statusBody.totpEnabled
          const isSmsEnabled = !!statusBody.smsEnabled
          setStatus({ totpEnabled: isTotpEnabled, smsEnabled: isSmsEnabled, phone: statusBody.phone ?? null })
          setSmsFlow(isSmsEnabled ? "enabled" : "disabled")
        } else {
          setStatus((s) => (s ? { ...s, smsEnabled: false } : { totpEnabled: false, smsEnabled: false }))
          setSmsFlow("disabled")
        }
        setSmsDisableCode("")
        setShowSmsDisableInput(false)
        dispatchToast({ type: "success", title: "Two-factor disabled", message: "SMS-based 2FA disabled." })
      }
    } catch (e: any) {
      setError(String(e))
      dispatchToast({ type: "error", title: "2FA", message: "Failed to disable SMS-based 2FA." })
    } finally {
      setLoading(false)
    }
  }

  return (
    <SecuritySettingsShell
      containerClassName={containerClassName}
      title="Two-factor Authentication"
      description="Enable an additional layer of security for your account."
      icon={Shield}
      iconBgClassName="bg-emerald-50"
      iconClassName="text-emerald-700"
      backHref={backHref}
      backLabel="Back to Security"
      backAriaLabel="Back to Security"
    >
      <div className="rounded-3xl border border-slate-200/70 bg-white/75 backdrop-blur shadow-card ring-1 ring-slate-900/5 overflow-hidden">
        <div className="p-5 sm:p-6">
          <div className="space-y-4">
            <div className="p-5 border border-slate-200/70 rounded-2xl bg-white/80 hover:border-slate-300/70 hover:bg-white transition-colors">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 h-10 w-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                    <Smartphone className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">Authenticator / TOTP</h3>
                    <p className="text-sm text-slate-500 mt-0.5">Use an authenticator app to generate 6-digit codes.</p>
                  </div>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-3">
                  <div>
                    {status && status.totpEnabled ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <CheckCircle className="h-3 w-3" />
                        Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        <XCircle className="h-3 w-3" />
                        Disabled
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {status && status.totpEnabled ? (
                      !showDisableInput ? (
                        <button
                          onClick={handleDisableClick}
                          disabled={loading}
                          className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-red-700 hover:text-red-800 hover:bg-red-50 rounded-xl transition-colors border border-red-200 hover:border-red-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Disable
                        </button>
                      ) : null
                    ) : (
                      (() => {
                        const disabled = loading
                        return (
                          <button
                            onClick={handleTotpEnableStart}
                            disabled={disabled}
                            className={`h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold rounded-xl transition-colors border shadow-sm ${
                              disabled
                                ? "text-slate-400 bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
                                : "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200 hover:border-emerald-300"
                            }`}
                          >
                            {disabled ? <Lock className="h-4 w-4" aria-hidden /> : null}
                            <span>{disabled ? "Please wait" : "Enable"}</span>
                          </button>
                        )
                      })()
                    )}
                  </div>
                </div>
              </div>

              {status && status.totpEnabled && showDisableInput ? (
                <div className="mt-4 w-full max-w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:p-4">
                  <div className="w-full">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Enter TOTP code or backup code to disable</label>
                    <input
                      type="text"
                      value={disableCode}
                      onChange={(e) => setDisableCode(e.target.value)}
                      placeholder="Enter code"
                      className="h-11 block w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-mono shadow-sm focus:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-200 transition"
                      autoFocus
                    />
                    <p className="mt-1.5 text-xs text-slate-500">Enter a 6-digit TOTP code from your authenticator app or a backup code.</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleTotpDisable}
                      disabled={loading || !disableCode.trim()}
                      className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-red-700 hover:text-red-800 hover:bg-red-50 rounded-xl transition-colors border border-red-200 hover:border-red-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? "Disabling..." : "Disable"}
                    </button>
                    <button
                      onClick={cancelDisable}
                      disabled={loading}
                      className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200 hover:border-slate-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {regenerateCodesUrl && status?.totpEnabled && !showDisableInput && backupCodes.length === 0 && (
                <div className="mt-4">
                  <RegenerateBackupCodes url={regenerateCodesUrl} />
                </div>
              )}

              {backupCodes.length > 0 && (
                <div className="mt-4">
                  <BackupCodesPanel codes={backupCodes} onDone={() => setBackupCodes([])} />
                </div>
              )}

              {(totpFlow === "provision" || totpFlow === "verifying") && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm text-slate-600 mb-3">Scan this QR code in your authenticator app or enter the secret manually.</p>
                  <div className="flex w-full max-w-full flex-col items-stretch gap-4 sm:flex-row sm:items-start">
                    <div className="mx-auto flex h-40 w-40 max-w-full flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white shadow-sm sm:mx-0 sm:h-32 sm:w-32">
                      {provision?.qr ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={provision.qr} alt="TOTP QR code" className="w-full h-full object-contain p-2" />
                      ) : (
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <rect x="2" y="2" width="8" height="8" stroke="#93c5fd" strokeWidth="1.5" fill="#fff" />
                          <rect x="14" y="2" width="8" height="8" stroke="#93c5fd" strokeWidth="1.5" fill="#fff" />
                          <rect x="2" y="14" width="8" height="8" stroke="#93c5fd" strokeWidth="1.5" fill="#fff" />
                          <rect x="10" y="10" width="4" height="4" fill="#0ea5e9" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="max-w-full rounded-xl border border-slate-200 bg-white p-2.5 font-mono text-xs leading-5 text-slate-700 shadow-sm [overflow-wrap:anywhere]">{provision?.secret ?? "-"}</div>
                      <div className="mt-3 grid w-full min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center">
                        <input
                          value={otp}
                          onChange={(e) => setOtp(e.target.value)}
                          placeholder="Enter 6-digit code"
                          className="h-11 min-h-[44px] max-h-[44px] w-full min-w-0 rounded-xl border border-slate-200 bg-white px-4 py-0 text-sm font-mono leading-none tabular-nums shadow-sm transition focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200 sm:w-44"
                        />
                        {(() => {
                          const isVerifying = totpFlow === "verifying"
                          const disabled = isVerifying || otp.length < 6
                          return (
                            <button
                              onClick={handleTotpVerify}
                              disabled={disabled}
                              className={`h-11 min-h-[44px] max-h-[44px] inline-flex w-full items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold shadow-sm transition-colors sm:w-auto ${
                                disabled
                                  ? "text-slate-400 bg-white border-slate-200 opacity-60 cursor-not-allowed"
                                  : "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200 hover:border-emerald-300"
                              }`}
                            >
                              {isVerifying ? (
                                <Spinner size="sm" ariaLabel="Verifying" />
                              ) : disabled ? (
                                <Lock className="h-4 w-4" aria-hidden />
                              ) : null}
                              <span>{isVerifying ? "Verifying" : "Verify"}</span>
                            </button>
                          )
                        })()}
                        <button
                          onClick={() => {
                            setTotpFlow("idle")
                            setProvision(null)
                          }}
                          className="h-11 min-h-[44px] max-h-[44px] inline-flex w-full items-center justify-center rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 sm:w-auto"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-5 border border-slate-200/70 rounded-2xl bg-white/80 hover:border-slate-300/70 hover:bg-white transition-colors">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                    <Smartphone className="h-5 w-5 text-purple-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-900">SMS-based 2FA</h3>
                    <p className="text-sm text-slate-500 mt-0.5">Receive codes via SMS to your registered phone.</p>
                  </div>
                </div>

                <div className="flex flex-col items-start sm:items-end gap-3">
                  <div>
                    {status && status.smsEnabled ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                        <CheckCircle className="h-3 w-3" />
                        Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                        <XCircle className="h-3 w-3" />
                        Disabled
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {(status && status.smsEnabled) || smsFlow === "enabled" ? (
                      !showSmsDisableInput ? (
                        <button
                          onClick={handleSmsDisableClick}
                          disabled={loading || sending}
                          className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-red-700 hover:text-red-800 hover:bg-red-50 rounded-xl transition-colors border border-red-200 hover:border-red-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {sending ? "Sending code..." : "Disable"}
                        </button>
                      ) : null
                    ) : (
                      <>
                        {(() => {
                          const disabled = sending
                          return (
                            <button
                              onClick={handleSmsSend}
                              disabled={disabled}
                              className={`h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold rounded-xl transition-colors border shadow-sm ${
                                disabled
                                  ? "text-slate-400 bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
                                  : "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200 hover:border-emerald-300"
                              }`}
                            >
                              {disabled ? <Lock className="h-4 w-4" aria-hidden /> : null}
                              <span>{disabled ? "Sending..." : "Send code"}</span>
                            </button>
                          )
                        })()}
                        <button
                          onClick={() => setSmsFlow("sent")}
                          className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200 hover:border-slate-300 shadow-sm"
                        >
                          I have a code
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {(status && status.smsEnabled) && showSmsDisableInput ? (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="w-full">
                    <label className="block text-xs font-semibold text-slate-700 mb-1.5">Enter SMS code to disable</label>
                    <input
                      type="text"
                      maxLength={6}
                      value={smsDisableCode}
                      onChange={(e) => setSmsDisableCode(e.target.value.replace(/\D/g, ""))}
                      placeholder="000000"
                      className="h-11 block w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-mono text-center shadow-sm focus:border-red-300 focus:outline-none focus:ring-2 focus:ring-red-200 transition"
                      autoFocus
                    />
                    <p className="mt-1.5 text-xs text-slate-500">Enter the 6-digit code sent to your phone.</p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      onClick={handleSmsDisable}
                      disabled={loading || smsDisableCode.length !== 6}
                      className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-red-700 hover:text-red-800 hover:bg-red-50 rounded-xl transition-colors border border-red-200 hover:border-red-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? "Disabling..." : "Disable SMS 2FA"}
                    </button>
                    <button
                      onClick={cancelSmsDisable}
                      disabled={loading}
                      className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200 hover:border-slate-300 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              {(smsFlow === "sent" || smsFlow === "verifying") && (
                <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-sm text-slate-600 mb-3">
                    A code was sent to <strong>{status?.phone ?? "your phone"}</strong>. Enter it below to verify.
                  </p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      value={otp}
                      onChange={(e) => setOtp(e.target.value)}
                      placeholder="Enter SMS code"
                      className="h-11 w-44 px-4 border border-slate-200 rounded-xl bg-white text-sm font-mono tabular-nums shadow-sm focus:border-emerald-300 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition"
                    />
                    {(() => {
                      const isVerifying = smsFlow === "verifying"
                      const disabled = isVerifying || otp.length < 6
                      return (
                        <button
                          onClick={handleSmsVerify}
                          disabled={disabled}
                          className={`h-11 inline-flex items-center justify-center gap-2 px-4 text-sm font-semibold rounded-xl transition-colors border shadow-sm ${
                            disabled
                              ? "text-slate-400 bg-white border-slate-200 opacity-60 cursor-not-allowed"
                              : "text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 border-emerald-200 hover:border-emerald-300"
                          }`}
                        >
                          {isVerifying ? (
                            <Spinner size="sm" ariaLabel="Verifying" />
                          ) : disabled ? (
                            <Lock className="h-4 w-4" aria-hidden />
                          ) : null}
                          <span>{isVerifying ? "Verifying" : "Verify"}</span>
                        </button>
                      )
                    })()}
                    <button
                      onClick={() => setSmsFlow("idle")}
                      className="h-11 inline-flex items-center justify-center px-4 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-xl transition-colors border border-slate-200 hover:border-slate-300 shadow-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="mt-4 rounded-md bg-red-50 border-2 border-red-200 p-3">
              <div className="text-sm font-medium text-red-800">{error}</div>
            </div>
          )}
        </div>
      </div>
    </SecuritySettingsShell>
  )
}
