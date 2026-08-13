"use client"

import React, { useEffect, useState } from "react"
import { Key, Trash, Fingerprint } from "lucide-react"
import SecuritySettingsShell from "@/components/security/SecuritySettingsShell"

export type PasskeysManagerProps = {
  apiBasePath: string
  backHref: string
  title?: string
  description?: string
  containerClassName?: string
}

export default function PasskeysManager({
  apiBasePath,
  backHref,
  title = "Passkeys",
  description = "Passwordless sign-in with biometrics or security keys.",
  containerClassName,
}: PasskeysManagerProps) {
  const [loading, setLoading] = useState(false)
  const [keys, setKeys] = useState<Array<{ id: string; name: string; createdAt?: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch(apiBasePath, { credentials: "include" })
        if (!mounted) return
        if (!res.ok) return
        const body = await res.json().catch(() => null)
        if (body && Array.isArray(body.items)) setKeys(body.items)
      } catch (e) {
        /* ignore */
      } finally {
        setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [apiBasePath])

  const base64urlToUint8 = (b64url: string): Uint8Array | null => {
    try {
      let s = String(b64url || "").trim()
      if (!s) return null
      s = s.replace(/-/g, "+").replace(/_/g, "/")
      const pad = (4 - (s.length % 4)) % 4
      if (pad) s += "=".repeat(pad)
      const bin = atob(s)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return bytes
    } catch {
      return null
    }
  }

  const utf8ToUint8 = (text: string): Uint8Array => new TextEncoder().encode(String(text))

  const isLocalhost = () => {
    try {
      const h = window.location.hostname
      return h === "localhost" || h === "127.0.0.1" || h === "::1"
    } catch {
      return false
    }
  }

  const getCurrentHostname = () => {
    try {
      return window.location.hostname.toLowerCase()
    } catch {
      return ""
    }
  }

  const rpIdMatchesCurrentHost = (rpId: unknown) => {
    const rp = String(rpId || "").trim().toLowerCase()
    const host = getCurrentHostname()
    if (!rp || !host) return true
    return host === rp || host.endsWith(`.${rp}`)
  }

  const formatRpIdMismatch = (rpId: unknown) => {
    const rp = String(rpId || "").trim().toLowerCase()
    const host = getCurrentHostname()
    if (!rp || !host || rpIdMatchesCurrentHost(rp)) return null

    const canonicalUrl = window.location.href.replace(window.location.host, rp)
    return (
      `Passkeys are configured for ${rp}, but this page is opened on ${host}. ` +
      `Open ${canonicalUrl} directly in Chrome or Safari, or update the app passkey settings to use a parent RP ID such as nolsaf.com.`
    )
  }

  const isLikelyEmbeddedMobileBrowser = () => {
    try {
      const ua = navigator.userAgent || ""
      return /(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp)/i.test(ua)
    } catch {
      return false
    }
  }

  const getWebAuthnNotReadyReason = () => {
    if (typeof window === "undefined") return ""
    if (typeof PublicKeyCredential === "undefined") {
      return "Passkeys aren’t supported in this browser or device. Try Chrome, Edge, or Safari on a passkey-capable device."
    }
    if (!window.isSecureContext && !isLocalhost()) {
      return "Passkeys require a secure context. Open this site on HTTPS (or use localhost in development)."
    }
    try {
      if (window.top !== window.self) {
        return "Passkeys can be blocked in embedded views/iframes. Open this page directly in the browser (not inside another app)."
      }
    } catch {
      return "Passkeys can be blocked in embedded views. Open this page directly in the browser."
    }
    if (isLikelyEmbeddedMobileBrowser()) {
      return "Passkeys are often blocked inside app browsers such as WhatsApp, Facebook, or Instagram. Open this page directly in Chrome or Safari, then try again."
    }
    if (!navigator?.credentials?.create) {
      return "Passkey registration isn’t available in this browser context. Try a modern browser and reload."
    }
    return ""
  }

  const formatWebAuthnError = (e: any) => {
    const name = String(e?.name || "")
    const message = String(e?.message || "")

    if (name === "NotAllowedError") {
      return (
        "Passkey registration was cancelled or blocked by the browser. " +
        "Make sure you approve the prompt, and that you’re using HTTPS (or localhost), in a normal browser tab (not an embedded app browser)."
      )
    }

    if (name === "SecurityError") {
      return (
        "Passkeys are blocked by security policy in this context. " +
        "Make sure the site is opened on HTTPS and the domain matches the app’s passkey settings."
      )
    }

    if (name === "InvalidStateError") {
      return "A passkey for this device/account may already exist. Try removing the existing passkey and registering again."
    }

    if (name === "NotSupportedError") {
      return "This device/browser doesn’t support the requested passkey options. Try a different device or browser."
    }

    if (message) return message
    return "Registration failed; please try again."
  }

  const arrToB64Url = (buf: ArrayBuffer) => {
    const bytes = new Uint8Array(buf)
    let str = ""
    for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
    return btoa(str).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
  }

  const register = async () => {
    setError(null)
    setLoading(true)
    try {
      const notReady = getWebAuthnNotReadyReason()
      if (notReady) {
        setError(notReady)
        return
      }

      const optRes = await fetch(apiBasePath, { method: "POST", credentials: "include" })
      if (!optRes.ok) {
        const b = await optRes.json().catch(() => null)
        setError((b && b.error) || `Failed (status ${optRes.status})`)
        return
      }
      const body = await optRes.json()
      const publicKey = body.publicKey as any
      const rpMismatch = formatRpIdMismatch(publicKey?.rp?.id || publicKey?.rpId)
      if (rpMismatch) {
        setError(rpMismatch)
        return
      }

      if (publicKey.challenge != null && typeof publicKey.challenge === "string") {
        const decoded = base64urlToUint8(publicKey.challenge)
        if (!decoded) throw new Error("Invalid publicKey.challenge received from server")
        publicKey.challenge = decoded
      }

      if (publicKey.user && publicKey.user.id != null && typeof publicKey.user.id === "string") {
        // SimpleWebAuthn v8 returns userID verbatim. The browser expects bytes,
        // so encode the opaque identifier as UTF-8 instead of attempting a
        // Base64URL decode that succeeds or fails depending on the ID length.
        publicKey.user.id = utf8ToUint8(publicKey.user.id)
      }

      if (Array.isArray(publicKey.excludeCredentials)) {
        publicKey.excludeCredentials = publicKey.excludeCredentials.map((c: any) => {
          if (c && c.id != null && typeof c.id === "string") {
            const decoded = base64urlToUint8(c.id)
            return { ...c, id: decoded ?? utf8ToUint8(c.id) }
          }
          return c
        })
      }

      const cred: any = (await navigator.credentials.create({ publicKey })) as any
      if (!cred) {
        setError("Credential creation was cancelled")
        return
      }

      const rawId = arrToB64Url(cred.rawId)
      const id = typeof cred.id === "string" && cred.id.length ? cred.id : rawId
      const type = typeof cred.type === "string" && cred.type.length ? cred.type : "public-key"
      const attObj = arrToB64Url(cred.response.attestationObject)
      const clientData = arrToB64Url(cred.response.clientDataJSON)
      const clientExtensionResults = typeof cred.getClientExtensionResults === "function" ? cred.getClientExtensionResults() : {}

      const verifyRes = await fetch(`${apiBasePath}/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          rawId,
          type,
          response: { attestationObject: attObj, clientDataJSON: clientData },
          clientExtensionResults,
          name: "My device",
        }),
      })
      if (!verifyRes.ok) {
        const b = await verifyRes.json().catch(() => null)
        const extra = b && (b.details || b.message)
        setError(((b && b.error) || `Failed (status ${verifyRes.status})`) + (extra ? `: ${extra}` : ""))
        return
      }
      const vbody = await verifyRes.json().catch(() => null)
      if (vbody && vbody.ok && vbody.item) {
        setKeys((prev) => [vbody.item, ...prev])
        setSuccess("Passkey registered and saved")
        setError(null)
        setTimeout(() => setSuccess(null), 4000)
      }
    } catch (e: any) {
      console.error("Passkey registration error:", e)
      setError(formatWebAuthnError(e))
    } finally {
      setLoading(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch(`${apiBasePath}/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError((b && b.error) || `Failed (status ${res.status})`)
      } else {
        setKeys((prev) => prev.filter((k) => k.id !== id))
        setSuccess("Passkey removed")
        setTimeout(() => setSuccess(null), 4000)
      }
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <SecuritySettingsShell
      containerClassName={containerClassName}
      title={title}
      description={description}
      icon={Fingerprint}
      iconBgClassName="bg-emerald-50"
      iconClassName="text-emerald-700"
      backHref={backHref}
      backLabel="Back to Security"
      backAriaLabel="Back to Security"
    >
      <div className="rounded-3xl border border-slate-200/70 bg-white/75 backdrop-blur shadow-card ring-1 ring-slate-900/5 overflow-hidden">
        <div className="p-5 sm:p-6 space-y-6">
          <div className="p-4 border-2 border-slate-200 rounded-lg bg-slate-50">
            <h3 className="text-sm font-semibold text-slate-900 mb-2">How to register a passkey:</h3>
            <ol className="list-decimal list-inside space-y-1 text-sm text-slate-600">
              <li>Click the Register passkey button</li>
              <li>When the browser prompt appears, choose your security key or biometric option</li>
              <li>Complete the device interaction (PIN / touch / biometric)</li>
              <li>If registration fails, check the server challenge encoding (must be base64url)</li>
            </ol>
          </div>

          <div className="p-5 border-2 border-slate-200 rounded-lg bg-white hover:border-emerald-300 hover:shadow-md transition-all">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-50 flex items-center justify-center">
                  <Key className="h-5 w-5 text-purple-600" aria-hidden />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-gray-900">Registered passkeys</h3>
                  <p className="text-sm text-slate-500 mt-0.5">Manage devices and security keys registered for passwordless sign-in.</p>
                </div>
              </div>
              <button
                onClick={register}
                disabled={loading}
                className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors border ${
                  loading
                    ? "text-slate-400 bg-slate-50 border-slate-200 opacity-60 cursor-not-allowed"
                    : "text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200 hover:border-emerald-300"
                }`}
              >
                <Key className="h-4 w-4" aria-hidden />
                <span>{loading ? "Registering…" : "Register passkey"}</span>
              </button>
            </div>

            <div className="mt-4 space-y-2">
              {keys.length === 0 ? (
                <div className="py-8 text-center">
                  <div className="flex flex-col items-center">
                    <Fingerprint className="h-12 w-12 text-slate-300 mb-3" aria-hidden />
                    <div className="text-sm font-medium text-slate-600 mb-1">No passkeys registered</div>
                    <div className="text-xs text-slate-500">Register a passkey to enable passwordless sign-in</div>
                  </div>
                </div>
              ) : (
                keys.map((k) => (
                  <div
                    key={k.id}
                    className="flex items-center justify-between p-3 border-2 border-slate-200 rounded-lg bg-white hover:border-slate-300 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-purple-50 flex items-center justify-center">
                        <Key className="h-4 w-4 text-purple-600" aria-hidden />
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{k.name}</div>
                        <div className="text-xs text-slate-500 mt-0.5">{k.createdAt ? new Date(k.createdAt).toLocaleString() : "—"}</div>
                      </div>
                    </div>
                    {confirmRemoveId === k.id ? (
                      <div className="flex items-center gap-2">
                        <div className="hidden sm:block text-xs text-slate-600 mr-1">Are you sure?</div>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          disabled={loading}
                          className="inline-flex items-center px-3 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 hover:bg-slate-50 rounded-md transition-colors border border-slate-200 hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmRemoveId(null)
                            void remove(k.id)
                          }}
                          disabled={loading}
                          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors border border-red-200 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Trash className="h-4 w-4" aria-hidden />
                          <span>{loading ? "Removing…" : "Remove"}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null)
                          setSuccess(null)
                          setConfirmRemoveId(k.id)
                        }}
                        disabled={loading}
                        className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors border border-red-200 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Trash className="h-4 w-4" aria-hidden />
                        <span>Remove</span>
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {error ? (
            <div className="rounded-md bg-red-50 border-2 border-red-200 p-3">
              <div className="text-sm font-medium text-red-800">{error}</div>
            </div>
          ) : null}
          {success ? (
            <div className="rounded-md bg-green-50 border-2 border-green-200 p-3">
              <div className="text-sm font-medium text-green-800">{success}</div>
            </div>
          ) : null}
        </div>
      </div>
    </SecuritySettingsShell>
  )
}
