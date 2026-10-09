"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ArrowLeft, FileText, Loader2, LockKeyhole, Mail, MessageSquare, X } from "lucide-react"
import apiClient from "@/lib/apiClient"
import { openAdminReportPrintWindow } from "@/lib/adminReportPrint"

export type DataFormat = "pdf" | "json"

const COUNTRIES = ["Tanzania", "Kenya", "Uganda", "Rwanda", "Burundi", "Democratic Republic of the Congo", "Zambia", "Malawi", "Mozambique", "South Africa", "United Kingdom", "United States", "Germany", "Other country"]
const REASONS: Array<[string, string]> = [
  ["KNOW_WHAT_WE_HOLD", "I want to know what NoLSAF holds about me"],
  ["MOVE_TO_ANOTHER_SERVICE", "I want to move my data to another service"],
  ["CLOSING_ACCOUNT", "I plan to close my account soon"],
  ["SUPPORT_OR_DISPUTE", "I need it for a support or dispute matter"],
  ["LEGAL", "I need it for legal reasons"],
  ["OTHER", "Other"],
]
const EMPTY_DIGITS = ["", "", "", "", "", ""]
const BACKDROP = { backgroundColor: "rgba(2, 12, 10, 0.58)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" } as const
const field = "h-11 w-full min-w-0 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
const primary = "inline-flex h-11 items-center justify-center gap-2 rounded-xl border-0 bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"

/**
 * Before a copy of personal data is released: where the person lives, why
 * (optional), then a code sent to a contact already verified on the account.
 * `onVerified` receives a 10-minute grant. For the PDF it also receives the
 * print window, opened inside the confirming click so pop-up blockers allow it.
 */
export default function DataRequestDialog({ format, onClose, onVerified }: {
  format: DataFormat
  onClose: () => void
  onVerified: (grant: string, format: DataFormat, printWindow: Window | null) => Promise<void> | void
}) {
  const [step, setStep] = useState<"questions" | "code">("questions")
  const [country, setCountry] = useState("Tanzania")
  const [reason, setReason] = useState("")
  const [otherReason, setOtherReason] = useState("")
  const [chosenFormat, setChosenFormat] = useState<DataFormat>(format)
  const [sentTo, setSentTo] = useState<{ via: "email" | "phone"; to: string; minutes: number } | null>(null)
  const [digits, setDigits] = useState<string[]>(EMPTY_DIGITS)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  // Set when the account locks (three wrong codes): no more codes until support unlocks it.
  const [locked, setLocked] = useState(false)
  const boxRefs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose() }
    window.addEventListener("keydown", onKey)
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey) }
  }, [busy, onClose])
  useEffect(() => { if (step === "code") boxRefs.current[0]?.focus() }, [step])

  // Fill the boxes from typing, autofill or a pasted code; the sixth digit confirms on its own.
  function enterDigits(from: number, raw: string) {
    const incoming = raw.replace(/\D/g, "")
    if (!incoming) return
    const next = [...digits]
    let at = from
    for (const d of incoming) { if (at > 5) break; next[at] = d; at += 1 }
    setDigits(next)
    setError("")
    if (next.every(Boolean)) void confirm(next.join(""))
    else boxRefs.current[Math.min(at, 5)]?.focus()
  }

  function onBoxKey(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault()
      const next = [...digits]
      if (next[index]) next[index] = ""
      else if (index > 0) { next[index - 1] = ""; boxRefs.current[index - 1]?.focus() }
      setDigits(next)
    } else if (e.key === "ArrowLeft" && index > 0) boxRefs.current[index - 1]?.focus()
    else if (e.key === "ArrowRight" && index < 5) boxRefs.current[index + 1]?.focus()
  }

  async function sendCode() {
    if (reason === "OTHER" && otherReason.trim().length < 3) return setError("Tell us briefly why, or choose another reason.")
    setBusy(true)
    setError("")
    try {
      const { data } = await apiClient.post("/api/account/export/request", {
        country, reason: reason || null, otherReason: reason === "OTHER" ? otherReason.trim() : null, format: chosenFormat,
      })
      const payload = data?.data ?? data
      setSentTo({ via: payload.sentVia, to: payload.sentTo, minutes: payload.expiresInMinutes ?? 10 })
      setDigits(EMPTY_DIGITS)
      setStep("code")
    } catch (cause: any) {
      setError(cause?.response?.data?.error || cause?.response?.data?.message || "We could not send your code. Try again.")
      if (cause?.response?.status === 423) setLocked(true)
    } finally {
      setBusy(false)
    }
  }

  async function confirm(entered: string) {
    if (busy || entered.length !== 6) return
    // Opened inside the keystroke or paste that completed the code, so the browser allows the print window.
    const printWindow = chosenFormat === "pdf" ? openAdminReportPrintWindow({ eyebrow: "NoLSAF personal data copy", heading: "Preparing your data", hideSteps: true }) : null
    if (chosenFormat === "pdf" && !printWindow) return setError("Allow pop-ups for NoLSAF, then try again.")
    setBusy(true)
    setError("")
    try {
      const { data } = await apiClient.post("/api/account/export/verify", { code: entered })
      const grant = (data?.data ?? data)?.grant as string
      await onVerified(grant, chosenFormat, printWindow)
      onClose()
    } catch (cause: any) {
      if (printWindow && !printWindow.closed) printWindow.close()
      setError(cause?.response?.data?.error || cause?.response?.data?.message || "That code could not be checked. Try again.")
      if (cause?.response?.data?.code === "DATA_EXPORT_LOCKED" || cause?.response?.data?.details?.code === "DATA_EXPORT_LOCKED" || cause?.response?.status === 423) setLocked(true)
      // Clear the boxes so the next attempt starts fresh.
      setDigits(EMPTY_DIGITS)
      setTimeout(() => boxRefs.current[0]?.focus(), 0)
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[1000] box-border flex items-center justify-center p-3 sm:p-6 [&_*]:box-border" style={BACKDROP} onMouseDown={() => { if (!busy) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="data-request-title" onMouseDown={(e) => e.stopPropagation()} className="flex max-h-[calc(100dvh-24px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-solid border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-0 border-b border-solid border-slate-200 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><LockKeyhole className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0">
              <h2 id="data-request-title" className="m-0 text-lg font-bold text-slate-900">Request your personal data</h2>
              <p className="m-0 mt-0.5 text-xs text-slate-500">{step === "questions" ? "A few questions first. This keeps your data safe." : "Confirm it is you."}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-solid border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900" aria-label="Close"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {locked ? (
            <div className="rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-900">
              <p className="m-0 flex items-center gap-2 font-bold"><LockKeyhole className="h-4 w-4" /> Data downloads are locked</p>
              <p className="m-0 mt-1.5 text-xs leading-5 text-rose-800">Too many wrong codes were entered, so we locked data downloads on your account to keep your data safe. Contact <a href="mailto:support@nolsaf.com" className="font-semibold text-rose-900 underline">support@nolsaf.com</a>. Once we confirm it is you, we unlock it and you can try again.</p>
            </div>
          ) : error && <p role="alert" className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">{error}</p>}

          {locked ? null : step === "questions" ? (
            <>
              <label className="block text-sm font-semibold text-slate-800">
                Where do you live?
                <select className={`${field} mt-1.5`} value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label className="block text-sm font-semibold text-slate-800">
                Why do you need it? <span className="font-normal text-slate-400">Optional</span>
                <select className={`${field} mt-1.5`} value={reason} onChange={(e) => { setReason(e.target.value); setError("") }}>
                  <option value="">Choose a reason</option>
                  {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {reason === "OTHER" && (
                <input className={field} value={otherReason} onChange={(e) => setOtherReason(e.target.value)} maxLength={200} placeholder="Tell us briefly why" aria-label="Other reason" />
              )}
              <fieldset className="m-0 border-0 p-0">
                <legend className="text-sm font-semibold text-slate-800">Format</legend>
                <div className="mt-1.5 grid grid-cols-2 gap-2">
                  {([["pdf", "Readable document (PDF)"], ["json", "Machine-readable (JSON)"]] as const).map(([value, label]) => (
                    <button key={value} type="button" role="radio" aria-checked={chosenFormat === value} onClick={() => setChosenFormat(value)} className={`flex h-11 items-center gap-2 rounded-lg border border-solid px-3 text-left text-xs font-semibold transition ${chosenFormat === value ? "border-emerald-600 bg-emerald-50 text-emerald-900" : "border-slate-300 bg-white text-slate-700 hover:border-slate-400"}`}>
                      <FileText className="h-4 w-4 shrink-0" /> {label}
                    </button>
                  ))}
                </div>
              </fieldset>
              <p className="m-0 rounded-lg bg-slate-50 px-3 py-2.5 text-xs leading-5 text-slate-600">We send a code to the email or phone already verified on your account. Your data is released only after you enter it, and we email you each time a copy is downloaded. Every request is recorded on your account.</p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-900">
                {sentTo?.via === "phone" ? <MessageSquare className="mt-0.5 h-4 w-4 shrink-0" /> : <Mail className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>We sent a 6-digit code to <strong className="font-semibold">{sentTo?.to}</strong>. It expires in {sentTo?.minutes ?? 10} minutes.</span>
              </div>
              <div>
                <p className="m-0 text-sm font-semibold text-slate-800">Enter the code</p>
                <div className="mt-2 grid grid-cols-6 gap-2" role="group" aria-label="6-digit code">
                  {Array.from({ length: 6 }, (_, i) => {
                    const digit = digits[i]
                    return (
                      <input
                        key={i}
                        ref={(el) => { boxRefs.current[i] = el }}
                        value={digit}
                        inputMode="numeric"
                        autoComplete={i === 0 ? "one-time-code" : "off"}
                        maxLength={6}
                        disabled={busy}
                        aria-label={`Digit ${i + 1}`}
                        onChange={(e) => { const v = e.target.value; enterDigits(i, v.length > 1 && !digit ? v : v.slice(-1)) }}
                        onPaste={(e) => { e.preventDefault(); enterDigits(0, e.clipboardData.getData("text")) }}
                        onKeyDown={(e) => onBoxKey(i, e)}
                        onFocus={(e) => e.target.select()}
                        className={`h-14 w-full min-w-0 rounded-xl border-2 border-solid bg-white text-center font-mono text-2xl font-bold text-slate-900 outline-none transition disabled:opacity-60 ${error ? "border-rose-300" : digit ? "border-emerald-500" : "border-slate-300"} focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/15`}
                      />
                    )
                  })}
                </div>
                <p className={`m-0 mt-2 flex items-center gap-1.5 text-xs ${busy ? "text-emerald-700" : "text-slate-500"}`}>
                  {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking your code and preparing your data</> : "It confirms on its own once all six digits are in."}
                </p>
              </div>
              <button type="button" onClick={() => { setStep("questions"); setError("") }} disabled={busy} className="inline-flex items-center gap-1 border-0 bg-transparent p-0 text-xs font-semibold text-emerald-700 hover:underline"><ArrowLeft className="h-3.5 w-3.5" /> Did not get it? Send a new code</button>
            </>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-0 border-t border-solid border-slate-200 bg-slate-50/80 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex h-11 items-center rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50">{locked ? "Close" : "Cancel"}</button>
          {!locked && step === "questions" ? (
            <button type="button" onClick={() => void sendCode()} disabled={busy} className={primary}>{busy && <Loader2 className="h-4 w-4 animate-spin" />} Send code</button>
          ) : null}
        </footer>
      </section>
    </div>,
    document.body,
  )
}
