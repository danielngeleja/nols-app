"use client"

import { useEffect, useState } from "react"
import { AlertCircle, Fingerprint, KeyRound, LockKeyhole, MessageSquareText, ShieldCheck } from "lucide-react"

export type AdminMfaStart = {
  adminMfaRequired: true
  code: "ADMIN_MFA_REQUIRED"
  expiresInSeconds: number
  enrollmentRequired: boolean
  methods: {
    passkey: boolean
    totp: boolean
    smsBootstrap: boolean
  }
  maskedPhone?: string | null
}

type Props = {
  initial: AdminMfaStart
  onComplete: (data: { token?: string; user?: { role?: string } }) => Promise<void> | void
  onCancel: () => void
}

function b64urlToUint8(value: string): Uint8Array<ArrayBuffer> {
  let normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/")
  while (normalized.length % 4) normalized += "="
  const binary = atob(normalized)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function arrayBufferToB64url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value)
  let binary = ""
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index])
  return btoa(binary).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}

async function postJson(path: string, body: unknown = {}) {
  const response = await fetch(path, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(String(data?.error || data?.message || "Verification failed")) as Error & { code?: string }
    error.code = data?.code
    throw error
  }
  return data
}

function browserPasskeyError(error: unknown, action: "use" | "create"): string {
  const cause = error as { name?: string; message?: string }
  if (cause?.name === "NotAllowedError") {
    return action === "create"
      ? "Passkey registration was cancelled or this device could not verify you."
      : "Passkey verification was cancelled or no matching passkey is available on this device."
  }
  if (cause?.name === "SecurityError") return "Passkeys require HTTPS and the correct NoLSAF domain."
  return cause?.message || "Passkey verification failed."
}

export default function AdminMfaLoginGate({ initial, onComplete, onCancel }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [code, setCode] = useState("")
  const [smsSent, setSmsSent] = useState(false)
  const [bootstrapVerified, setBootstrapVerified] = useState(false)
  const [showTotp, setShowTotp] = useState(initial.enrollmentRequired && initial.methods.totp)
  const [now, setNow] = useState(() => Date.now())
  const [smsExpiresAt, setSmsExpiresAt] = useState<number | null>(null)
  const [smsResendAt, setSmsResendAt] = useState<number | null>(null)

  useEffect(() => {
    if (!smsExpiresAt && !smsResendAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [smsExpiresAt, smsResendAt])

  const formatCountdown = (milliseconds: number) => {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = String(totalSeconds % 60).padStart(2, "0")
    return `${minutes}:${seconds}`
  }

  const smsRemainingMs = smsExpiresAt ? Math.max(0, smsExpiresAt - now) : 0
  const resendRemainingMs = smsResendAt ? Math.max(0, smsResendAt - now) : 0

  const ensurePasskeysAvailable = () => {
    if (typeof window === "undefined" || typeof PublicKeyCredential === "undefined" || !navigator.credentials) {
      throw new Error("Passkeys are not supported in this browser. Use a recent version of Chrome, Edge or Safari.")
    }
    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      throw new Error("Passkeys require a secure HTTPS connection.")
    }
  }

  const usePasskey = async () => {
    setLoading(true)
    setError(null)
    try {
      ensurePasskeysAvailable()
      const optionsBody = await postJson("/api/auth/admin-mfa/passkey/options")
      const source = optionsBody.publicKey
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: b64urlToUint8(source.challenge),
          rpId: source.rpId,
          timeout: source.timeout ?? 60_000,
          userVerification: "required",
          allowCredentials: (source.allowCredentials || []).map((item: { id: string; type: PublicKeyCredentialType; transports?: AuthenticatorTransport[] }) => ({
            ...item,
            id: b64urlToUint8(item.id),
          })),
        },
      }) as PublicKeyCredential | null
      if (!credential) throw new Error("No passkey response was returned.")
      const assertion = credential.response as AuthenticatorAssertionResponse
      const result = await postJson("/api/auth/admin-mfa/passkey/verify", {
        response: {
          id: credential.id,
          rawId: arrayBufferToB64url(credential.rawId),
          type: credential.type,
          response: {
            authenticatorData: arrayBufferToB64url(assertion.authenticatorData),
            clientDataJSON: arrayBufferToB64url(assertion.clientDataJSON),
            signature: arrayBufferToB64url(assertion.signature),
            userHandle: assertion.userHandle ? arrayBufferToB64url(assertion.userHandle) : null,
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        },
      })
      await onComplete(result)
    } catch (cause) {
      setError(browserPasskeyError(cause, "use"))
    } finally {
      setLoading(false)
    }
  }

  const verifyTotp = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await postJson("/api/auth/admin-mfa/totp/verify", { code })
      setCode("")
      if (result.enrollmentRequired) {
        setBootstrapVerified(true)
        return
      }
      await onComplete(result)
    } catch (cause) {
      setError((cause as Error)?.message || "Authenticator verification failed.")
    } finally {
      setLoading(false)
    }
  }

  const sendBootstrapSms = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await postJson("/api/auth/admin-mfa/bootstrap/send")
      const expiresInSeconds = Number(result?.expiresInSeconds) || 180
      setSmsSent(true)
      setCode("")
      setNow(Date.now())
      setSmsExpiresAt(Date.now() + expiresInSeconds * 1000)
      setSmsResendAt(Date.now() + 60_000)
    } catch (cause) {
      setError((cause as Error)?.message || "The security code could not be sent.")
    } finally {
      setLoading(false)
    }
  }

  const verifyBootstrapSms = async () => {
    setLoading(true)
    setError(null)
    try {
      await postJson("/api/auth/admin-mfa/bootstrap/verify", { code })
      setCode("")
      setBootstrapVerified(true)
    } catch (cause) {
      setError((cause as Error)?.message || "The security code is invalid.")
    } finally {
      setLoading(false)
    }
  }

  const registerPasskey = async () => {
    setLoading(true)
    setError(null)
    try {
      ensurePasskeysAvailable()
      const optionsBody = await postJson("/api/auth/admin-mfa/passkey/register/options")
      const source = optionsBody.publicKey
      const credential = await navigator.credentials.create({
        publicKey: {
          ...source,
          challenge: b64urlToUint8(source.challenge),
          user: { ...source.user, id: b64urlToUint8(source.user.id) },
          excludeCredentials: (source.excludeCredentials || []).map((item: { id: string }) => ({
            ...item,
            id: b64urlToUint8(item.id),
          })),
          authenticatorSelection: {
            ...source.authenticatorSelection,
            residentKey: "required",
            userVerification: "required",
          },
        },
      }) as PublicKeyCredential | null
      if (!credential) throw new Error("No passkey was created.")
      const attestation = credential.response as AuthenticatorAttestationResponse
      const result = await postJson("/api/auth/admin-mfa/passkey/register/verify", {
        response: {
          id: credential.id,
          rawId: arrayBufferToB64url(credential.rawId),
          type: credential.type,
          response: {
            attestationObject: arrayBufferToB64url(attestation.attestationObject),
            clientDataJSON: arrayBufferToB64url(attestation.clientDataJSON),
            transports: typeof attestation.getTransports === "function" ? attestation.getTransports() : [],
          },
          clientExtensionResults: credential.getClientExtensionResults(),
        },
      })
      await onComplete(result)
    } catch (cause) {
      setError(browserPasskeyError(cause, "create"))
    } finally {
      setLoading(false)
    }
  }

  const cancel = async () => {
    try {
      await postJson("/api/auth/admin-mfa/cancel")
    } catch {
      // Returning to the password screen is still safe; the challenge expires quickly.
    }
    onCancel()
  }

  const codeInput = (label: string) => (
    <div className="space-y-2">
      <label className="block text-xs font-semibold text-slate-700">{label}</label>
      <input
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="000000"
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center font-mono text-lg tracking-[0.35em] text-slate-900 outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
      />
    </div>
  )

  return (
    <div className="relative flex w-full flex-col bg-white">
      <div className="border-b border-slate-100 px-5 pb-4 pt-5 sm:px-6">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-50 text-[#02665e] ring-1 ring-emerald-100">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#02776c]">Admin security gate</p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-950">Verify it&apos;s you</h1>
            <p className="mt-0.5 text-xs text-slate-500">Your password was accepted. Verify your identity to continue.</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 px-5 pb-8 pt-5 sm:px-6 sm:pb-9">
        {initial.enrollmentRequired && (
          <div aria-label="Admin security setup progress" className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">
              <span className={`grid h-6 w-6 place-items-center rounded-full ${bootstrapVerified ? "bg-emerald-100 text-emerald-700" : "bg-[#02665e] text-white"}`}>1</span>
              <span className={bootstrapVerified ? "text-emerald-700" : "text-slate-800"}>Verify identity</span>
              <span className="h-px min-w-4 flex-1 bg-slate-300" />
              <span className={`grid h-6 w-6 place-items-center rounded-full ${bootstrapVerified ? "bg-[#02665e] text-white" : "bg-slate-200 text-slate-500"}`}>2</span>
              <span className={bootstrapVerified ? "text-slate-800" : "text-slate-500"}>Create passkey</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-red-500" />
            <span>{error}</span>
          </div>
        )}

        {initial.methods.passkey && !showTotp && (
          <>
            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 text-sm text-slate-700">
              Use the fingerprint, face, device PIN or security key registered to this administrator.
            </div>
            <button onClick={usePasskey} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 font-semibold text-white hover:bg-[#014e47] disabled:opacity-50">
              <Fingerprint className="h-5 w-5" />
              {loading ? "Verifying…" : "Continue with passkey"}
            </button>
            {initial.methods.totp && (
              <button onClick={() => { setShowTotp(true); setError(null) }} className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                Use authenticator code instead
              </button>
            )}
          </>
        )}

        {showTotp && !bootstrapVerified && (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800"><KeyRound className="h-4 w-4 text-[#02665e]" /> Authenticator app</div>
            {codeInput("Six-digit authenticator code")}
            <button onClick={verifyTotp} disabled={loading || code.length !== 6} className="min-h-11 w-full rounded-xl bg-[#02665e] px-4 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? "Checking…" : "Verify code"}
            </button>
            {initial.methods.passkey && <button onClick={() => { setShowTotp(false); setCode(""); setError(null) }} className="w-full text-sm font-semibold text-[#02665e]">Back to passkey</button>}
          </>
        )}

        {initial.enrollmentRequired && !bootstrapVerified && !showTotp && (
          <>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <LockKeyhole className="mt-0.5 h-5 w-5 flex-none text-amber-700" />
                <div>
                  <p className="text-sm font-semibold text-amber-950">Passkey setup required</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800">Verify the registered administrator phone, then create a passkey before entering the dashboard.</p>
                </div>
              </div>
            </div>
            {initial.methods.smsBootstrap ? (
              !smsSent ? (
                <button onClick={sendBootstrapSms} disabled={loading} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 text-sm font-semibold text-white disabled:opacity-50">
                  <MessageSquareText className="h-4 w-4" /> {loading ? "Sending…" : `Send code to ${initial.maskedPhone || "verified phone"}`}
                </button>
              ) : (
                <>
                  {codeInput(`Security code sent to ${initial.maskedPhone || "your verified phone"}`)}
                  <div className="flex items-center justify-between gap-3 text-[11px] text-slate-500">
                    <span>{smsRemainingMs > 0 ? `Code expires in ${formatCountdown(smsRemainingMs)}` : "Code expired — request a new one"}</span>
                    <span className="font-medium text-slate-600">Never share this code</span>
                  </div>
                  <button onClick={verifyBootstrapSms} disabled={loading || code.length !== 6 || smsRemainingMs <= 0} className="min-h-11 w-full rounded-xl bg-[#02665e] px-4 text-sm font-semibold text-white disabled:opacity-50">
                    {loading ? "Checking…" : "Verify phone"}
                  </button>
                  <button
                    onClick={sendBootstrapSms}
                    disabled={loading || resendRemainingMs > 0}
                    className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-4 text-xs font-semibold text-[#02665e] transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    {resendRemainingMs > 0 ? `Send a new code in ${formatCountdown(resendRemainingMs)}` : "Send a new code"}
                  </button>
                </>
              )
            ) : (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">No verified bootstrap method is available. Contact security support to restore administrator access.</div>
            )}
          </>
        )}

        {bootstrapVerified && (
          <>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
              Identity verified. Register a passkey on this device to finish securing the administrator account.
            </div>
            <button onClick={registerPasskey} disabled={loading} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] px-4 font-semibold text-white hover:bg-[#014e47] disabled:opacity-50">
              <Fingerprint className="h-5 w-5" /> {loading ? "Registering…" : "Register passkey and continue"}
            </button>
          </>
        )}

        <button onClick={cancel} disabled={loading} className="w-full border-0 bg-transparent py-1 text-xs font-semibold text-slate-500 hover:text-slate-800">Cancel and return to sign in</button>
      </div>
    </div>
  )
}
