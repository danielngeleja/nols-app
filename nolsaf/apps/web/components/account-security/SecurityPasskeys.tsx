"use client"

import React, { useEffect, useState } from "react"
import { Check, CircleAlert, Fingerprint, KeyRound, Loader2, Plus, ScanFace, Smartphone, Trash2 } from "lucide-react"
import { eatDateTime, type Passkey, type SecurityScope } from "./securityData"

const API = "/api/account/security/passkeys"

const b64urlToBytes = (value: string): Uint8Array | null => {
  try {
    let s = String(value || "").trim()
    if (!s) return null
    s = s.replace(/-/g, "+").replace(/_/g, "/")
    s += "=".repeat((4 - (s.length % 4)) % 4)
    const bin = atob(s)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}
const utf8 = (text: string) => new TextEncoder().encode(String(text))
const toB64url = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf)
  let str = ""
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_")
}

/** Why passkeys cannot work in this browser right now, in plain words. Empty when they can. */
function notReadyReason(): string {
  if (typeof window === "undefined") return ""
  const host = window.location.hostname
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1"
  if (typeof PublicKeyCredential === "undefined") return "This browser does not support passkeys. Try Chrome, Edge or Safari on a phone or computer that supports them."
  if (!window.isSecureContext && !local) return "Passkeys only work on a secure (https) page."
  try {
    if (window.top !== window.self) return "Passkeys are blocked inside embedded pages. Open this page directly in your browser."
  } catch {
    return "Passkeys are blocked inside embedded pages. Open this page directly in your browser."
  }
  if (/(FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|WhatsApp)/i.test(navigator.userAgent || "")) return "Passkeys are often blocked inside app browsers such as WhatsApp, Facebook or Instagram. Open this page in Chrome or Safari."
  if (!navigator?.credentials?.create) return "This browser cannot create passkeys. Update it and try again."
  return ""
}

function rpMismatch(rpId: unknown): string | null {
  const rp = String(rpId || "").trim().toLowerCase()
  const host = window.location.hostname.toLowerCase()
  if (!rp || !host || host === rp || host.endsWith(`.${rp}`)) return null
  return `Passkeys are set up for ${rp}, but this page is open on ${host}. Open ${window.location.href.replace(window.location.host, rp)} instead.`
}

function webAuthnMessage(e: any): string {
  const name = String(e?.name || "")
  if (name === "NotAllowedError") return "The passkey prompt was cancelled or timed out. Try again and approve it on your device."
  if (name === "SecurityError") return "Your browser blocked the passkey for security reasons. Make sure you are on the real NoLSAF site over https."
  if (name === "InvalidStateError") return "This device already has a passkey for your account. Remove the old one first if you want to replace it."
  if (name === "NotSupportedError") return "This device does not support the kind of passkey we need. Try another device or browser."
  return String(e?.message || "") || "The passkey could not be added. Please try again."
}

export default function SecurityPasskeys(_props: { scope: SecurityScope }) {
  const [keys, setKeys] = useState<Passkey[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [blocked, setBlocked] = useState("")

  useEffect(() => {
    setBlocked(notReadyReason())
    let mounted = true
    ;(async () => {
      try {
        const res = await fetch(API, { credentials: "include" })
        const body = res.ok ? await res.json().catch(() => null) : null
        if (mounted) setKeys(Array.isArray(body?.items) ? body.items : [])
      } catch {
        if (mounted) setKeys([])
      }
    })()
    return () => { mounted = false }
  }, [])

  const flash = (message: string) => {
    setNotice(message)
    setTimeout(() => setNotice(null), 4000)
  }

  const register = async () => {
    setError(null)
    const reason = notReadyReason()
    if (reason) { setError(reason); return }
    setBusy(true)
    try {
      const optRes = await fetch(API, { method: "POST", credentials: "include" })
      if (!optRes.ok) {
        const b = await optRes.json().catch(() => null)
        setError(b?.error || `The passkey could not be started (status ${optRes.status}).`)
        return
      }
      const publicKey = (await optRes.json()).publicKey as any
      const mismatch = rpMismatch(publicKey?.rp?.id || publicKey?.rpId)
      if (mismatch) { setError(mismatch); return }
      if (typeof publicKey.challenge === "string") {
        const decoded = b64urlToBytes(publicKey.challenge)
        if (!decoded) throw new Error("The sign-in server sent an invalid challenge.")
        publicKey.challenge = decoded
      }
      // The user id is an opaque string; the browser wants its UTF-8 bytes.
      if (publicKey.user && typeof publicKey.user.id === "string") publicKey.user.id = utf8(publicKey.user.id)
      if (Array.isArray(publicKey.excludeCredentials)) {
        publicKey.excludeCredentials = publicKey.excludeCredentials.map((c: any) => (c && typeof c.id === "string" ? { ...c, id: b64urlToBytes(c.id) ?? utf8(c.id) } : c))
      }

      const cred: any = await navigator.credentials.create({ publicKey })
      if (!cred) { setError("The passkey prompt was cancelled."); return }

      const rawId = toB64url(cred.rawId)
      const verifyRes = await fetch(`${API}/verify`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: typeof cred.id === "string" && cred.id ? cred.id : rawId,
          rawId,
          type: typeof cred.type === "string" && cred.type ? cred.type : "public-key",
          response: { attestationObject: toB64url(cred.response.attestationObject), clientDataJSON: toB64url(cred.response.clientDataJSON) },
          clientExtensionResults: typeof cred.getClientExtensionResults === "function" ? cred.getClientExtensionResults() : {},
          name: "My device",
        }),
      })
      if (!verifyRes.ok) {
        const b = await verifyRes.json().catch(() => null)
        const extra = b?.details || b?.message
        setError((b?.error || `The passkey could not be saved (status ${verifyRes.status}).`) + (extra ? ` ${extra}` : ""))
        return
      }
      const saved = await verifyRes.json().catch(() => null)
      if (saved?.ok && saved.item) {
        setKeys((prev) => [saved.item, ...(prev ?? [])])
        flash("Passkey added. You can use it next time you sign in.")
      }
    } catch (e) {
      console.error("Passkey registration error:", e)
      setError(webAuthnMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch(`${API}/${id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error || `The passkey could not be removed (status ${res.status}).`)
        return
      }
      setKeys((prev) => (prev ?? []).filter((k) => k.id !== id))
      setConfirmId(null)
      flash("Passkey removed.")
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
      <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 px-6 py-5">
          <div>
            <h2 className="m-0 text-base font-bold text-slate-900">Your passkeys</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-500">Each device you added can sign you in without a password.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-slate-600">{keys === null ? "…" : keys.length}</span>
        </div>

        {(error || notice) && (
          <div className="px-6 pb-4">
            {error ? (
              <p className="m-0 flex items-start gap-2 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200"><CircleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />{error}</p>
            ) : (
              <p className="m-0 flex items-start gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200"><Check className="mt-px h-4 w-4 shrink-0" aria-hidden />{notice}</p>
            )}
          </div>
        )}

        {keys === null ? (
          <div className="space-y-2 px-6 pb-6">{[0, 1].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-50" />)}</div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center border-0 border-t border-solid border-slate-100 px-6 py-12 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-xl bg-emerald-50 text-[#02665e]"><Fingerprint className="h-7 w-7" aria-hidden /></span>
            <p className="m-0 mt-4 text-sm font-bold text-slate-900">No passkeys yet</p>
            <p className="m-0 mt-1 max-w-sm text-xs leading-5 text-slate-500">Add one on the phone or computer you use most. Next time, sign in with your fingerprint or face.</p>
            <button type="button" onClick={() => void register()} disabled={busy || Boolean(blocked)} className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-bold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} Add a passkey
            </button>
          </div>
        ) : (
          <ul className="m-0 list-none p-0">
            {keys.map((key) => {
              const added = key.createdAt ? eatDateTime(key.createdAt) : null
              const confirming = confirmId === key.id
              return (
                <li key={key.id} className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-slate-100 px-6 py-4">
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]"><KeyRound className="h-5 w-5" aria-hidden /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">{key.name || "Passkey"}</span>
                    <span className="block text-xs text-slate-500">{added ? `Added ${added.day}` : "Added earlier"}</span>
                  </span>
                  {confirming ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-rose-700">Remove this passkey?</span>
                      <button type="button" onClick={() => void remove(key.id)} disabled={busy} className="inline-flex h-8 items-center rounded-lg border-0 bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-60">{busy ? "Removing..." : "Remove"}</button>
                      <button type="button" onClick={() => setConfirmId(null)} disabled={busy} className="inline-flex h-8 items-center rounded-lg border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600">Keep</button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirmId(key.id)} aria-label={`Remove ${key.name || "passkey"}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <aside className="space-y-5 lg:sticky lg:top-24">
        <section className="overflow-hidden rounded-xl bg-[#012a26] p-5 text-white">
          <p className="m-0 text-sm font-bold">Add a passkey on this device</p>
          <ol className="m-0 mt-3 list-none space-y-2.5 p-0 text-xs leading-5 text-white/75">
            {[
              { Icon: Plus, text: "Press Add a passkey." },
              { Icon: Smartphone, text: "Your device asks you to confirm. Choose this device or a security key." },
              { Icon: ScanFace, text: "Use your fingerprint, face or screen lock PIN. That is it." },
            ].map((step, index) => (
              <li key={index} className="flex gap-2.5"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white/10 text-[#5eead4]"><step.Icon className="h-3.5 w-3.5" aria-hidden /></span><span className="pt-0.5">{step.text}</span></li>
            ))}
          </ol>
          {blocked ? (
            <p className="m-0 mt-4 rounded-xl bg-white/10 px-3 py-2.5 text-xs leading-5 text-amber-200">{blocked}</p>
          ) : (
            <button type="button" onClick={() => void register()} disabled={busy} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border-0 bg-[#5eead4] text-sm font-bold text-[#012a26] hover:bg-[#8ff3e1] disabled:opacity-60">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Fingerprint className="h-4 w-4" aria-hidden />}
              {busy ? "Waiting for your device..." : "Add a passkey"}
            </button>
          )}
        </section>
        <section className="rounded-xl border border-solid border-slate-200 bg-white p-5">
          <p className="m-0 text-sm font-bold text-slate-900">Why use a passkey</p>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0 text-xs leading-5 text-slate-600">
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />Nothing to remember or type.</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />It only works on the real NoLSAF site, so fake login pages cannot steal it.</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />Your fingerprint or face never leaves your device.</li>
          </ul>
        </section>
      </aside>
    </div>
  )
}
