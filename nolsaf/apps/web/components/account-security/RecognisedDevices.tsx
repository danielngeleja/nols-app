"use client"

import React, { useEffect, useState } from "react"
import { MonitorSmartphone, ShieldCheck } from "lucide-react"
import { eatDateTime } from "./securityData"

type Device = {
  id: string
  name: string
  firstSignInAt: string
  lastSignInAt: string
  signIns: number
  current: boolean
}

/**
 * Devices that sign in without a "new sign-in" alert. Removing one only means
 * its next sign-in alerts again; signing a device out is the sessions list.
 */
export default function RecognisedDevices() {
  const [devices, setDevices] = useState<Device[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    try {
      const res = await fetch("/api/account/security/recognised-devices", { credentials: "include" })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setError(body?.error || body?.message || "Your devices could not be loaded.")
        setDevices([])
        return
      }
      setDevices(body?.data?.devices || body?.devices || [])
    } catch {
      setError("Your devices could not be loaded.")
      setDevices([])
    }
  }

  useEffect(() => { void load() }, [])

  const forget = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch("/api/account/security/recognised-devices/forget", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error || body?.message || "The device could not be removed.")
        return
      }
      setDevices((prev) => (prev ?? []).filter((d) => d.id !== id))
    } catch {
      setError("The device could not be removed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
      <div className="flex items-start gap-3 border-0 border-b border-solid border-slate-100 px-4 py-4 sm:px-5">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#02665e]"><ShieldCheck className="h-[18px] w-[18px]" aria-hidden /></span>
        <div className="min-w-0">
          <p className="m-0 text-sm font-bold text-slate-900">Recognised devices</p>
          <p className="m-0 mt-0.5 text-xs text-slate-500">These devices sign in without a new sign-in alert. Remove one you no longer use, and NoLSAF will alert you if it signs in again.</p>
        </div>
      </div>

      {error && <p className="m-0 mx-5 mt-4 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}

      {devices === null ? (
        <div className="space-y-2 p-5">{[0, 1].map((i) => <div key={i} className="h-14 rounded-xl bg-slate-50" />)}</div>
      ) : devices.length === 0 ? (
        <p className="m-0 px-5 py-6 text-xs text-slate-500">No recognised devices yet. Each browser you sign in from appears here.</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center gap-3.5 border-0 border-t border-solid border-slate-100 px-5 py-3.5 first:border-t-0">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-600"><MonitorSmartphone className="h-[18px] w-[18px]" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="text-sm font-bold text-slate-900">{device.name}</span>
                  {device.current ? <span className="rounded-full bg-emerald-50 px-2 py-px text-[11px] font-semibold text-[#02665e]">This device</span> : null}
                </span>
                <span className="block truncate text-xs text-slate-500">
                  Last sign-in {eatDateTime(device.lastSignInAt).day}, {eatDateTime(device.lastSignInAt).time}
                  {" · "}{device.signIns} sign-in{device.signIns === 1 ? "" : "s"}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void forget(device.id)}
                disabled={busy === device.id}
                className="inline-flex h-9 shrink-0 items-center rounded-xl border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {busy === device.id ? "Removing..." : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
