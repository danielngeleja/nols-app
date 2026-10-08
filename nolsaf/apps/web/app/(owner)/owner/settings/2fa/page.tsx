"use client"

import React, { useState, useEffect, useRef } from "react"
import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Check, CircleAlert, Loader2, MessageSquare, ShieldCheck, Smartphone } from 'lucide-react'
import apiClient from "@/lib/apiClient"
import BackupCodesPanel from "@/components/security/BackupCodesPanel"
import RegenerateBackupCodes from "@/components/security/RegenerateBackupCodes"

const api = apiClient

type Status = { totpEnabled: boolean; smsEnabled: boolean; phone?: string | null }

export default function Owner2FAPage() {
  const [me, setMe] = useState<any>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [twofa, setTwofa] = useState<any>(null)
  const [code, setCode] = useState("")
  const [smsCode, setSmsCode] = useState("")
  const [disableCode, setDisableCode] = useState("")
  const [showDisableInput, setShowDisableInput] = useState(false)
  const [showSmsDisableInput, setShowSmsDisableInput] = useState(false)
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  /** Plain backup codes, returned once when the authenticator is turned on. */
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [totpFlow, setTotpFlow] = useState<'idle'|'provision'|'verifying'|'enabled'|'disabled'>('idle')
  const [smsFlow, setSmsFlow] = useState<'idle'|'sent'|'verifying'|'enabled'|'disabled'>('idle')
  const totpVerifyingRef = useRef(false)
  const smsVerifyingRef = useRef(false)
  useEffect(() => {
    let mounted = true
    setInitialLoading(true)
    ;(async () => {
      try {
        const r = await api.get("/api/account/me")
        if (!mounted) return
        // API returns { ok: true, data: user } via sendSuccess, so r.data = { ok: true, data: user }
        // Extract user data: if r.data.data exists, use it; otherwise r.data might be the user object directly
        const userData = (r.data?.ok && r.data?.data) ? r.data.data : (r.data?.data || r.data)
        setMe(userData)
        // Read 2FA status directly from database - use twoFactorEnabled from userData
        const isTotpEnabled = !!userData?.twoFactorEnabled && userData?.twoFactorMethod === 'TOTP'
        const isSmsEnabled = !!userData?.twoFactorEnabled && userData?.twoFactorMethod === 'SMS'
        const newStatus = { 
          totpEnabled: isTotpEnabled, 
          smsEnabled: isSmsEnabled,
          phone: userData?.phone || null 
        }
        setStatus(newStatus)
        setTotpFlow(isTotpEnabled ? 'enabled' : 'idle')
        setSmsFlow(isSmsEnabled ? 'enabled' : 'idle')
        if (mounted) setInitialLoading(false)
      } catch (e: any) {
        if (mounted) {
          setError('Failed to load account information')
          setInitialLoading(false)
        }
      }
    })()
    return () => { mounted = false }
  }, [])

  const dispatchToast = (t: any) => { try { window.dispatchEvent(new CustomEvent('nols:toast', { detail: t })) } catch (e) {} }

  const start2FA = async () => {
    setError(null)
    setCode('')
    setTwofa(null)
    setTotpFlow('provision')
    setLoading(true)
    try {
      const r = await api.post("/api/account/2fa/totp/setup")
      // API returns { ok: true, data: { qrDataUrl, otpauthUrl, secretMasked } }
      const qrData = r.data?.data || r.data
      setTwofa(qrData)
      dispatchToast({ type: 'info', title: '2FA Setup', message: 'Scan the QR code with your authenticator app', duration: 5000 })
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to start TOTP setup.'
      setError(msg)
      setTotpFlow('idle')
      dispatchToast({ type: 'error', title: 'Failed to start TOTP', message: msg, duration: 5000 })
    } finally {
      setLoading(false)
    }
  }

  const verify2FA = async () => {
    if (totpVerifyingRef.current) return
    if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
      setError('Please enter a valid 6-digit code')
      return
    }
    totpVerifyingRef.current = true
    setError(null)
    setLoading(true)
    setTotpFlow('verifying')
    try {
      // Ensure code is a 6-digit string
      const codeToSend = String(code).replace(/\D/g, '').slice(0, 6)
      if (codeToSend.length !== 6) {
        setError('Please enter a valid 6-digit code')
        return
      }
      const r = await api.post("/api/account/2fa/totp/verify", { code: codeToSend })
      // API returns { ok: true, data: { backupCodes: [...] } }
      const responseData = r.data?.data || r.data
      // Shown on screen once; never logged. The API keeps only hashes.
      setBackupCodes(Array.isArray(responseData?.backupCodes) ? responseData.backupCodes : [])

      setSuccess('2FA enabled successfully!')
      dispatchToast({ type: 'success', title: '2FA enabled', message: 'Authenticator enabled. Save your backup codes.', duration: 8000 })
      
      // Immediately update state to reflect enabled status (verification succeeded)
      // We know 2FA is enabled because the verify endpoint returned success
      setTotpFlow('enabled')
      setStatus(prev => ({ 
        ...prev, 
        totpEnabled: true, 
        smsEnabled: prev?.smsEnabled || false,
        phone: prev?.phone || me?.phone || null 
      }))
      setTwofa(null)
      setCode("")
      
      // Then refresh user data from database to get the latest state
      const me2 = await api.get("/api/account/me")
      // API returns { ok: true, data: user } via sendSuccess
      const userData = (me2.data?.ok && me2.data?.data) ? me2.data.data : (me2.data?.data || me2.data)
      
      // Update me state with fresh data from database
      setMe(userData)
      // Ensure status reflects database state
      if (userData?.twoFactorEnabled) {
        setStatus(prev => ({ 
          totpEnabled: true,
          smsEnabled: prev ? prev.smsEnabled : false,
          phone: userData?.phone || (prev ? prev.phone : null) || null 
        }))
      }
      
      // Don't redirect immediately - let user see the enabled state
      // setTimeout(() => router.push('/owner/settings'), 1500)
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to enable authenticator.'
      setError(msg)
      setTotpFlow('provision')
      dispatchToast({ type: 'error', title: 'Failed to enable authenticator', message: msg, duration: 6000 })
    } finally {
      setLoading(false)
      totpVerifyingRef.current = false
    }
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

  const disable2FA = async () => {
    if (!disableCode || disableCode.trim().length === 0) {
      setError('Please enter a TOTP code or backup code')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await api.post("/api/account/2fa/disable", { code: disableCode.trim() })
      setSuccess('2FA disabled successfully')
      dispatchToast({ type: 'success', title: '2FA disabled', message: 'Two-factor authentication disabled.', duration: 4500 })
      
      // Refresh user data from database to get updated 2FA status
      const me2 = await api.get("/api/account/me")
      const userData = me2.data?.data || me2.data
      setMe(userData)
      
      // Update status from database
      const isTotpEnabled = !!userData.twoFactorEnabled && userData.twoFactorMethod === 'TOTP'
      const isSmsEnabled = !!userData.twoFactorEnabled && userData.twoFactorMethod === 'SMS'
      setStatus({ 
        totpEnabled: isTotpEnabled, 
        smsEnabled: isSmsEnabled,
        phone: userData.phone || null 
      })
      setTotpFlow(isTotpEnabled ? 'enabled' : 'idle')
      setSmsFlow(isSmsEnabled ? 'enabled' : 'idle')
      setShowDisableInput(false)
      setDisableCode("")
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to disable 2FA.'
      setError(msg)
      dispatchToast({ type: 'error', title: 'Failed to disable 2FA', message: msg, duration: 4500 })
    } finally {
      setLoading(false)
    }
  }

  const handleSmsSend = async () => {
    if (!me?.phone) {
      setError('Phone number is required for SMS 2FA. Please update your profile with a phone number.')
      return
    }
    setError(null)
    setSending(true)
    try {
      await api.post("/api/account/2fa/sms/send", {})
      setSmsFlow('sent')
      dispatchToast({ type: 'info', title: 'SMS sent', message: 'A verification code was sent to your phone.', duration: 5000 })
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to send SMS code.'
      setError(msg)
      dispatchToast({ type: 'error', title: 'Failed to send SMS', message: msg, duration: 5000 })
    } finally {
      setSending(false)
    }
  }

  const handleSmsVerify = async () => {
    if (smsVerifyingRef.current) return
    if (!smsCode || smsCode.length !== 6 || !/^\d{6}$/.test(smsCode)) {
      setError('Please enter a valid 6-digit verification code')
      return
    }
    smsVerifyingRef.current = true
    setError(null)
    setLoading(true)
    setSmsFlow('verifying')
    try {
      const codeToSend = String(smsCode).replace(/\D/g, '').slice(0, 6)
      await api.post("/api/account/2fa/sms/verify", { code: codeToSend })
      
      // Refresh user data to get updated 2FA status
      const me2 = await api.get("/api/account/me")
      const userData = me2.data?.data || me2.data
      setMe(userData)
      
      const isSmsEnabled = !!userData.twoFactorEnabled && userData.twoFactorMethod === 'SMS'
      setStatus(s => s ? { ...s, smsEnabled: isSmsEnabled } : { totpEnabled: false, smsEnabled: isSmsEnabled })
      setSmsFlow(isSmsEnabled ? 'enabled' : 'idle')
      setSmsCode('')
      dispatchToast({ type: 'success', title: 'Two-factor enabled', message: 'SMS-based 2FA enabled.', duration: 4500 })
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to verify SMS code.'
      setError(msg)
      setSmsFlow('sent')
      dispatchToast({ type: 'error', title: '2FA', message: msg, duration: 4000 })
    } finally {
      setLoading(false)
      smsVerifyingRef.current = false
    }
  }

  const handleSmsDisableClick = async () => {
    setError(null)
    setSending(true)
    try {
      // Send a verification code to the registered phone, same as enabling
      await api.post("/api/account/2fa/sms/send", {})
      setShowSmsDisableInput(true)
      setSmsCode("")
      dispatchToast({ type: 'info', title: 'SMS sent', message: 'A verification code was sent to your phone. Enter it to disable SMS 2FA.', duration: 5000 })
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to send SMS code.'
      setError(msg)
      dispatchToast({ type: 'error', title: 'Failed to send SMS', message: msg, duration: 5000 })
    } finally {
      setSending(false)
    }
  }

  const cancelSmsDisable = () => {
    setShowSmsDisableInput(false)
    setSmsCode("")
    setError(null)
  }

  const handleSmsDisable = async () => {
    if (!smsCode || smsCode.length !== 6 || !/^\d{6}$/.test(smsCode)) {
      setError('Please enter a valid 6-digit verification code')
      dispatchToast({ type: 'error', title: 'Error', message: 'Please enter a valid 6-digit verification code', duration: 4000 })
      return
    }
    setError(null)
    setLoading(true)
    try {
      const codeToSend = String(smsCode).replace(/\D/g, '').slice(0, 6)
      await api.post("/api/account/2fa/sms/disable", { code: codeToSend })
      
      // Refresh user data to get updated 2FA status
      const me2 = await api.get("/api/account/me")
      const userData = me2.data?.data || me2.data
      setMe(userData)
      
      const isSmsEnabled = !!userData.twoFactorEnabled && userData.twoFactorMethod === 'SMS'
      setStatus(s => s ? { ...s, smsEnabled: isSmsEnabled } : { totpEnabled: false, smsEnabled: isSmsEnabled })
      setSmsFlow(isSmsEnabled ? 'enabled' : 'disabled')
      setSmsCode('')
      setShowSmsDisableInput(false)
      dispatchToast({ type: 'success', title: 'Two-factor disabled', message: 'SMS-based 2FA disabled.', duration: 4500 })
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to disable SMS-based 2FA.'
      setError(msg)
      dispatchToast({ type: 'error', title: '2FA', message: msg, duration: 4000 })
    } finally {
      setLoading(false)
    }
  }

  const totpOn = Boolean((me?.twoFactorEnabled && me?.twoFactorMethod === 'TOTP') || status?.totpEnabled || totpFlow === 'enabled')
  const smsOn = Boolean(status?.smsEnabled || smsFlow === 'enabled')
  const anyOn = totpOn || smsOn
  const phone: string | null = status?.phone || me?.phone || null
  const maskedPhone = phone ? `${phone.slice(0, Math.min(5, phone.length - 3))}${"•".repeat(Math.max(0, phone.length - 8))}${phone.slice(-3)}` : null
  const codeInput = "box-border h-14 w-full rounded-xl border border-solid border-slate-300 bg-white text-center font-mono text-2xl font-bold tracking-[0.5em] text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
  const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] px-5 text-sm font-bold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50"
  const ghost = "inline-flex h-11 items-center justify-center rounded-xl border border-solid border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
  const danger = "inline-flex h-11 items-center justify-center gap-2 rounded-xl border-0 bg-rose-600 px-5 text-sm font-bold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
  const turnOff = "inline-flex h-10 items-center justify-center rounded-xl border border-solid border-rose-200 bg-white px-4 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"

  const Pill = ({ on }: { on: boolean }) => (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset ${on ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"}`}>
      {on ? <Check className="h-3 w-3" aria-hidden /> : null}{on ? "On" : "Off"}
    </span>
  )

  if (initialLoading) {
    return (
      <div className="grid gap-5 lg:grid-cols-2" aria-busy="true">
        <div className="h-24 rounded-2xl bg-white lg:col-span-2" />
        <div className="h-72 rounded-2xl bg-white" />
        <div className="h-72 rounded-2xl bg-white" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Where things stand */}
      <section className={`flex flex-wrap items-center gap-4 rounded-2xl p-5 ring-1 ring-inset ${anyOn ? "bg-emerald-50 ring-emerald-200" : "bg-amber-50 ring-amber-200"}`}>
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-white ${anyOn ? "bg-[#02665e]" : "bg-amber-500"}`}>
          {anyOn ? <ShieldCheck className="h-5 w-5" aria-hidden /> : <CircleAlert className="h-5 w-5" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-base font-bold text-slate-900">{anyOn ? "Two-step verification is on" : "Two-step verification is off"}</p>
          <p className="m-0 mt-0.5 text-sm text-slate-600">
            {anyOn ? `After your password, we ask for a code ${totpOn ? "from your authenticator app" : `sent by text to ${maskedPhone || "your phone"}`}.` : "Right now your password is the only thing protecting your account and payouts. Turn on one method below."}
          </p>
        </div>
      </section>

      {error && <p className="m-0 flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{error}</p>}
      {success && !error && <p className="m-0 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"><Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{success}</p>}

      {backupCodes.length > 0 && <BackupCodesPanel codes={backupCodes} onDone={() => setBackupCodes([])} />}

      <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
        {/* Authenticator app */}
        <section className={`overflow-hidden rounded-2xl border border-solid bg-white ${totpOn ? "border-[#02665e]/40" : "border-slate-200"}`}>
          <header className="flex items-start gap-3.5 px-6 pb-4 pt-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]"><Smartphone className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="m-0 text-base font-bold text-slate-900">Authenticator app</h2>
                <span className="rounded-full bg-[#5eead4]/25 px-2 py-0.5 text-[10.5px] font-bold text-[#02665e]">Recommended</span>
              </div>
              <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">Google Authenticator, Microsoft Authenticator or Authy make a new 6-digit code every 30 seconds. Works without signal.</p>
            </div>
            <Pill on={totpOn} />
          </header>

          <div className="border-0 border-t border-solid border-slate-100 px-6 py-5">
            {totpOn ? (
              !showDisableInput ? (
                <div className="space-y-4">
                  {backupCodes.length === 0 && <RegenerateBackupCodes url="/api/account/2fa/codes/regenerate" />}
                  <button type="button" onClick={handleDisableClick} disabled={loading} className={turnOff}>Turn off authenticator</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <label htmlFor="totp-off" className="text-xs font-bold text-slate-700">Enter a code from your app, or a backup code, to turn it off</label>
                  <input id="totp-off" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="Code" autoFocus className="box-border h-12 w-full rounded-xl border border-solid border-slate-300 bg-white px-4 font-mono text-lg tracking-[0.2em] outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-100" />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={disable2FA} disabled={loading || !disableCode.trim()} className={danger}>{loading ? "Turning off..." : "Turn off"}</button>
                    <button type="button" onClick={cancelDisable} disabled={loading} className={ghost}>Keep it on</button>
                  </div>
                </div>
              )
            ) : !twofa ? (
              <div className="space-y-4">
                <ol className="m-0 list-none space-y-2.5 p-0">
                  {["Install an authenticator app on your phone.", "Scan the QR code we show you.", "Type the 6-digit code from the app to confirm."].map((step, index) => (
                    <li key={step} className="flex items-start gap-2.5 text-sm text-slate-700"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-600">{index + 1}</span><span className="pt-0.5">{step}</span></li>
                  ))}
                </ol>
                <button type="button" onClick={start2FA} disabled={loading} className={primary}>{loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Smartphone className="h-4 w-4" aria-hidden />}{loading ? "Preparing..." : "Set up authenticator"}</button>
              </div>
            ) : (
              <div className="grid gap-5 sm:grid-cols-[180px_minmax(0,1fr)]">
                <div>
                  <div className="grid aspect-square w-full max-w-[180px] place-items-center overflow-hidden rounded-2xl bg-white p-2 ring-1 ring-slate-200">
                    {twofa?.qrDataUrl ? <Image src={twofa.qrDataUrl} alt="QR code for your authenticator app" width={176} height={176} className="h-full w-full object-contain" /> : <Loader2 className="h-6 w-6 animate-spin text-slate-300" aria-hidden />}
                  </div>
                  {twofa?.secretMasked ? <p className="m-0 mt-2 text-center font-mono text-[11px] text-slate-400">Key {twofa.secretMasked}</p> : null}
                </div>
                <div className="space-y-3">
                  <p className="m-0 text-sm text-slate-700"><strong>Scan this code</strong> with your authenticator app, then type the 6 digits it shows.</p>
                  <input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) void verify2FA() }} placeholder="000000" aria-label="6-digit code" autoFocus className={codeInput} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={verify2FA} disabled={loading || code.length !== 6} className={primary}>{totpFlow === 'verifying' ? "Checking..." : "Confirm and turn on"}</button>
                    <button type="button" onClick={() => { setTwofa(null); setCode(''); setTotpFlow('idle') }} className={ghost}>Cancel</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Text message */}
        <section className={`overflow-hidden rounded-2xl border border-solid bg-white ${smsOn ? "border-[#02665e]/40" : "border-slate-200"}`}>
          <header className="flex items-start gap-3.5 px-6 pb-4 pt-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700"><MessageSquare className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0 flex-1">
              <h2 className="m-0 text-base font-bold text-slate-900">Text message</h2>
              <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">We text a 6-digit code to {maskedPhone ? <strong className="font-mono text-slate-700">{maskedPhone}</strong> : "your phone"} each time you sign in. Needs signal.</p>
            </div>
            <Pill on={smsOn} />
          </header>

          <div className="border-0 border-t border-solid border-slate-100 px-6 py-5">
            {!phone && !smsOn ? (
              <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-inset ring-amber-200">
                <p className="m-0 text-sm font-bold text-amber-900">Add a phone number first</p>
                <p className="m-0 mt-1 text-xs text-amber-900/80">Text codes need the phone number on your profile.</p>
                <Link href="/owner/profile" className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-white px-3 text-xs font-bold text-amber-900 no-underline ring-1 ring-inset ring-amber-300 hover:bg-amber-100">Open my profile <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
              </div>
            ) : smsOn ? (
              !showSmsDisableInput ? (
                <button type="button" onClick={handleSmsDisableClick} disabled={loading || sending} className={turnOff}>{sending ? "Sending a code..." : "Turn off text codes"}</button>
              ) : (
                <div className="space-y-3">
                  <label htmlFor="sms-off" className="text-xs font-bold text-slate-700">We sent a code to {maskedPhone}. Enter it to turn text codes off.</label>
                  <input id="sms-off" inputMode="numeric" maxLength={6} value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ''))} placeholder="000000" autoFocus className={codeInput} />
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleSmsDisable} disabled={loading || smsCode.length !== 6} className={danger}>{loading ? "Turning off..." : "Turn off"}</button>
                    <button type="button" onClick={cancelSmsDisable} disabled={loading} className={ghost}>Keep it on</button>
                  </div>
                </div>
              )
            ) : smsFlow === 'sent' || smsFlow === 'verifying' ? (
              <div className="space-y-3">
                <p className="m-0 text-sm text-slate-700">Enter the code we texted to <strong className="font-mono">{maskedPhone}</strong>.</p>
                <input inputMode="numeric" maxLength={6} value={smsCode} onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === "Enter" && smsCode.length === 6) void handleSmsVerify() }} placeholder="000000" aria-label="Text message code" autoFocus className={codeInput} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleSmsVerify} disabled={smsFlow === 'verifying' || smsCode.length !== 6} className={primary}>{smsFlow === 'verifying' ? "Checking..." : "Confirm and turn on"}</button>
                  <button type="button" onClick={handleSmsSend} disabled={sending} className={ghost}>{sending ? "Sending..." : "Send a new code"}</button>
                  <button type="button" onClick={() => { setSmsFlow('idle'); setSmsCode('') }} className="inline-flex h-11 items-center border-0 bg-transparent px-2 text-sm font-semibold text-slate-500 hover:text-slate-800">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="m-0 text-sm text-slate-700">We will text a code to your phone to confirm it is yours.</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={handleSmsSend} disabled={sending} className={primary}>{sending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <MessageSquare className="h-4 w-4" aria-hidden />}{sending ? "Sending..." : "Text me a code"}</button>
                  <button type="button" onClick={() => setSmsFlow('sent')} className={ghost}>I already have a code</button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
