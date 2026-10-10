"use client"

import { useEffect, useState } from "react"
import { BadgePercent, CalendarCheck, Check, Gift, Loader2, ShieldCheck } from "lucide-react"
import apiClient from "@/lib/apiClient"

type Prefs = { bookings: boolean; promotions: boolean; referrals: boolean }
type Key = "promotions" | "referrals"

const card = "rounded-xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
const unwrap = (payload: any): Prefs | null => payload?.data?.preferences ?? payload?.preferences ?? null

function Switch({ on, busy, onChange, label }: { on: boolean; busy: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full border-0 transition-colors disabled:opacity-60 ${on ? "bg-emerald-600" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  )
}

/** Guest notification choices. Booking and security messages are not optional; marketing is opt-in. */
export default function AccountNotificationsPage() {
  const [prefs, setPrefs] = useState<Prefs | null>(null)
  const [saving, setSaving] = useState<Key | null>(null)
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  useEffect(() => {
    apiClient.get("/api/account/notification-preferences")
      .then((r) => setPrefs(unwrap(r.data) ?? { bookings: true, promotions: false, referrals: true }))
      .catch(() => setStatus({ tone: "error", text: "Your notification settings could not be loaded. Refresh to try again." }))
  }, [])

  // Each switch saves on its own, so there is no Save button to forget.
  async function change(key: Key, value: boolean) {
    if (!prefs) return
    const previous = prefs
    setPrefs({ ...prefs, [key]: value })
    setSaving(key)
    setStatus(null)
    try {
      const r = await apiClient.put("/api/account/notification-preferences", { [key]: value })
      setPrefs(unwrap(r.data) ?? { ...previous, [key]: value })
      setStatus({ tone: "ok", text: "Saved" })
    } catch {
      setPrefs(previous)
      setStatus({ tone: "error", text: "That change was not saved. Try again." })
    } finally {
      setSaving(null)
    }
  }

  const optional: Array<{ key: Key; Icon: typeof Gift; title: string; text: string }> = [
    { key: "promotions", Icon: BadgePercent, title: "Offers and news", text: "Seasonal prices, new places to stay and travel ideas. Off unless you turn it on." },
    { key: "referrals", Icon: Gift, title: "Referral updates", text: "When someone joins or books with your invite link." },
  ]

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
      <section className={card}>
        <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
          <div>
            <h2 className="m-0 text-base font-bold text-slate-900">What we send you</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-500">By email and text message. Changes save straight away.</p>
          </div>
          {status && <span role={status.tone === "error" ? "alert" : "status"} className={`text-xs font-semibold ${status.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{status.text}</span>}
        </div>

        {/* Always on */}
        <div className="flex items-start gap-4 border-0 border-t border-solid border-slate-200 px-5 py-4 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><CalendarCheck className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-slate-900">Bookings and payments</p>
            <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">Confirmations, check-in codes, receipts, changes and cancellations.</p>
          </div>
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"><Check className="h-3 w-3" /> Always on</span>
        </div>
        <div className="flex items-start gap-4 border-0 border-t border-solid border-slate-200 px-5 py-4 sm:px-6">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><ShieldCheck className="h-[18px] w-[18px]" /></span>
          <div className="min-w-0 flex-1">
            <p className="m-0 text-sm font-semibold text-slate-900">Account security</p>
            <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">Sign-in codes, new sign-ins and password changes.</p>
          </div>
          <span className="mt-1 inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600"><Check className="h-3 w-3" /> Always on</span>
        </div>

        {/* Your choice */}
        {optional.map(({ key, Icon, title, text }) => (
          <div key={key} className="flex items-start gap-4 border-0 border-t border-solid border-slate-200 px-5 py-4 sm:px-6">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Icon className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-semibold text-slate-900">{title}</p>
              <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">{text}</p>
            </div>
            {prefs ? (
              <span className="mt-1 flex items-center gap-2">
                {saving === key && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
                <Switch on={prefs[key]} busy={saving !== null} onChange={(v) => void change(key, v)} label={title} />
              </span>
            ) : <span className="mt-1 h-6 w-11 rounded-full bg-slate-100" aria-hidden />}
          </div>
        ))}
      </section>

      <aside className={`${card} p-5`}>
        <h2 className="m-0 text-sm font-bold text-slate-900">Why some are always on</h2>
        <p className="m-0 mt-2 text-xs leading-5 text-slate-600">Booking and security messages carry things you need: your check-in code, your receipt, or a warning that someone signed in. Turning them off could cost you a stay or your account, so they always reach you.</p>
        <p className="m-0 mt-3 text-xs leading-5 text-slate-600">We never share your contact details with advertisers.</p>
      </aside>
    </div>
  )
}
