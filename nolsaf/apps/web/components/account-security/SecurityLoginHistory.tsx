"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, CircleAlert, History, KeyRound, LogIn, LogOut, RefreshCw, XCircle } from "lucide-react"
import { eatDateTime, parseLogin, type LoginRecord, type SecurityScope } from "./securityData"

type Filter = "all" | "ok" | "failed"

const PAGE_SIZE = 15
const HISTORY_LIMIT = 200

/** IPv4 addresses arrive in IPv6 form (::ffff:41.59.1.2); show the plain address. */
const cleanIp = (ip: string) => ip.replace(/^::ffff:/i, "")

export default function SecurityLoginHistory({ scope }: { scope: SecurityScope }) {
  const [records, setRecords] = useState<LoginRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>("all")
  const [page, setPage] = useState(1)

  const load = async () => {
    setError(null)
    setRecords(null)
    try {
      const res = await fetch(`/api/account/security/logins?limit=${HISTORY_LIMIT}`, { credentials: "include" })
      if (!res.ok) {
        const b = await res.json().catch(() => null)
        setError(b?.error || b?.message || `Your sign-in history could not be loaded (status ${res.status}).`)
        setRecords([])
        return
      }
      const b = await res.json()
      setRecords(b?.records || b?.items || [])
      setPage(1)
    } catch (e: any) {
      setError(e?.message || "Your sign-in history could not be loaded.")
      setRecords([])
    }
  }

  useEffect(() => { void load() }, [])

  const list = useMemo(() => records ?? [], [records])
  const failed = list.filter((r) => r.success === false)
  const ok = list.filter((r) => r.success !== false)
  const devices = new Set(list.filter((r) => !parseLogin(r).isLogout).map((r) => parseLogin(r).device)).size
  const shown = filter === "ok" ? ok : filter === "failed" ? failed : list
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageRows = shown.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const firstRow = shown.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0
  const lastRow = Math.min(currentPage * PAGE_SIZE, shown.length)

  // Page numbers with gaps: 1 … 4 5 6 … 14
  const pageItems: Array<number | "gap"> = []
  for (let n = 1; n <= pageCount; n++) {
    if (n === 1 || n === pageCount || Math.abs(n - currentPage) <= 1) pageItems.push(n)
    else if (pageItems[pageItems.length - 1] !== "gap") pageItems.push("gap")
  }

  const groups = useMemo(() => {
    const map = new Map<string, LoginRecord[]>()
    for (const r of pageRows) {
      const day = eatDateTime(r.at).day
      map.set(day, [...(map.get(day) ?? []), r])
    }
    return Array.from(map.entries())
  }, [pageRows])

  const tabs: Array<{ key: Filter; label: string; count: number }> = [
    { key: "all", label: "All activity", count: list.length },
    { key: "ok", label: "Successful", count: ok.length },
    { key: "failed", label: "Failed", count: failed.length },
  ]

  return (
    <div className="space-y-5">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Recorded events", value: list.length, hint: `latest ${HISTORY_LIMIT} kept here` },
          { label: "Successful", value: ok.length, hint: "sign-ins and sign-outs" },
          { label: "Failed attempts", value: failed.length, hint: failed.length ? "check these" : "none recorded", alert: failed.length > 0 },
          { label: "Devices", value: devices, hint: "browser and system pairs" },
        ].map((stat) => (
          <div key={stat.label} className={`rounded-2xl border border-solid bg-white p-4 ${stat.alert ? "border-rose-200" : "border-slate-200"}`}>
            <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{stat.label}</p>
            <p className={`m-0 mt-1 text-2xl font-extrabold tabular-nums ${stat.alert ? "text-rose-600" : "text-slate-900"}`}>{records === null ? "…" : stat.value}</p>
            <p className="m-0 text-[11px] text-slate-500">{stat.hint}</p>
          </div>
        ))}
      </section>

      {failed.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-rose-50 px-5 py-4 ring-1 ring-inset ring-rose-200">
          <CircleAlert className="h-5 w-5 shrink-0 text-rose-600" aria-hidden />
          <p className="m-0 min-w-0 flex-1 text-sm text-rose-900">
            <strong>Do not recognise a failed attempt?</strong> Someone may be guessing your password. Change it and turn on two-step verification.
          </p>
          <Link href={`${scope.base}/password`} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3.5 text-xs font-bold text-white no-underline hover:bg-rose-700"><KeyRound className="h-3.5 w-3.5" aria-hidden />Change password</Link>
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 sm:px-5">
          <div className="flex gap-1 overflow-x-auto" role="tablist">
            {tabs.map((tab) => {
              const active = filter === tab.key
              return (
                <button key={tab.key} type="button" role="tab" aria-selected={active} onClick={() => { setFilter(tab.key); setPage(1) }} className={`-mb-px inline-flex h-12 items-center gap-2 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold ${active ? "border-[#02665e] text-[#02665e]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                  {tab.label}
                  <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>{tab.count}</span>
                </button>
              )
            })}
          </div>
          <button type="button" onClick={() => void load()} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-solid border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"><RefreshCw className="h-3.5 w-3.5" aria-hidden />Refresh</button>
        </div>

        {error && <p className="m-0 mx-5 mt-4 rounded-xl bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-200">{error}</p>}

        {records === null ? (
          <div className="space-y-2 p-5">{[0, 1, 2, 3].map((i) => <div key={i} className="h-14 rounded-xl bg-slate-50" />)}</div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><History className="h-6 w-6" aria-hidden /></span>
            <p className="m-0 mt-3 text-sm font-bold text-slate-900">{filter === "failed" ? "No failed attempts" : "Nothing recorded yet"}</p>
            <p className="m-0 mt-1 text-xs text-slate-500">{filter === "failed" ? "Nobody has tried a wrong password on your account." : "Your sign-ins will appear here."}</p>
          </div>
        ) : (
          <div className="pb-2">
            {groups.map(([day, items]) => (
              <div key={day}>
                <p className="m-0 bg-slate-50/80 px-5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-500">{day}</p>
                <ul className="m-0 list-none p-0">
                  {items.map((record) => {
                    const info = parseLogin(record)
                    const bad = record.success === false
                    const Icon = bad ? XCircle : info.isLogout ? LogOut : LogIn
                    return (
                      <li key={record.id} className="flex items-center gap-3.5 border-0 border-t border-solid border-slate-100 px-5 py-3.5 first:border-t-0">
                        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${bad ? "bg-rose-50 text-rose-600" : info.isLogout ? "bg-slate-100 text-slate-500" : "bg-emerald-50 text-[#02665e]"}`}><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className={`text-sm font-bold ${bad ? "text-rose-700" : "text-slate-900"}`}>{bad ? "Failed sign-in" : info.isLogout ? "Signed out" : "Signed in"}</span>
                            {info.method && !info.isLogout ? <span className="rounded-full bg-slate-100 px-2 py-px text-[11px] font-semibold text-slate-600">{info.method}</span> : null}
                          </span>
                          <span className="block truncate text-xs text-slate-500">{info.device}</span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block text-xs font-semibold tabular-nums text-slate-700">{eatDateTime(record.at).time}</span>
                          {record.ip ? <span className="block font-mono text-[11px] text-slate-400">{cleanIp(record.ip)}</span> : null}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}

            {shown.length > PAGE_SIZE && (
              <nav aria-label="Sign-in history pages" className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 px-5 py-3">
                <p className="m-0 text-xs text-slate-500">
                  Showing <strong className="tabular-nums text-slate-900">{firstRow}-{lastRow}</strong> of <strong className="tabular-nums text-slate-900">{shown.length}</strong>
                </p>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setPage(currentPage - 1)} disabled={currentPage === 1} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  {pageItems.map((item, index) =>
                    item === "gap" ? (
                      <span key={`gap-${index}`} className="px-1 text-xs text-slate-400">…</span>
                    ) : (
                      <button
                        key={item}
                        type="button"
                        onClick={() => setPage(item)}
                        aria-current={item === currentPage ? "page" : undefined}
                        className={`h-8 min-w-8 rounded-lg border border-solid px-2 text-xs font-bold tabular-nums ${item === currentPage ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}
                      >
                        {item}
                      </button>
                    ),
                  )}
                  <button type="button" onClick={() => setPage(currentPage + 1)} disabled={currentPage === pageCount} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </nav>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
