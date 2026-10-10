"use client"

import React, { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Check, CircleAlert, Fingerprint, History, KeyRound, MonitorSmartphone, ShieldCheck, Smartphone } from "lucide-react"
import apiClient from "@/lib/apiClient"
import { eatDateTime, parseLogin, relativeTime, unwrapMe, type LoginRecord, type Passkey, type SecurityScope } from "./securityData"

type State = {
  twoStep: "TOTP" | "SMS" | null
  phone: string | null
  passkeys: Passkey[]
  logins: LoginRecord[]
}

export default function SecurityOverview({ scope }: { scope: SecurityScope }) {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const [me, keys, logins] = await Promise.allSettled([
        apiClient.get("/api/account/me"),
        fetch("/api/account/security/passkeys", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/account/security/logins", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      ])
      if (!mounted) return
      const user = me.status === "fulfilled" ? unwrapMe(me.value.data) : null
      setState({
        twoStep: user?.twoFactorEnabled ? (user.twoFactorMethod === "SMS" ? "SMS" : "TOTP") : null,
        phone: user?.phone ?? null,
        passkeys: keys.status === "fulfilled" && Array.isArray(keys.value?.items) ? keys.value.items : [],
        logins: logins.status === "fulfilled" ? logins.value?.records || logins.value?.items || [] : [],
      })
    })()
    return () => { mounted = false }
  }, [])

  const loading = state === null
  const signIns = (state?.logins ?? []).filter((r) => !parseLogin(r).isLogout)
  const lastGood = signIns.find((r) => r.success !== false) ?? null
  const monthAgo = Date.now() - 30 * 86_400_000
  const failed30 = signIns.filter((r) => r.success === false && new Date(r.at).getTime() > monthAgo).length

  const checks = [
    { label: "Password set", done: true, hint: "You sign in with a password.", href: `${scope.base}/password`, action: "Change" },
    { label: "Two-step verification", done: Boolean(state?.twoStep), hint: state?.twoStep ? `On, using ${state.twoStep === "SMS" ? "text message" : "an authenticator app"}.` : "Off. A stolen password alone could open your account.", href: `${scope.base}/2fa`, action: state?.twoStep ? "Manage" : "Turn on" },
    { label: "A passkey on your device", done: (state?.passkeys.length ?? 0) > 0, hint: state?.passkeys.length ? `${state.passkeys.length} passkey${state.passkeys.length === 1 ? "" : "s"} saved.` : "Faster sign-in that cannot be phished.", href: `${scope.base}/passkeys`, action: state?.passkeys.length ? "Manage" : "Add one" },
  ]
  const score = checks.filter((c) => c.done).length
  const level = score === 3 ? { label: "Strong", tone: "text-emerald-700", ring: "#02665e", note: "Your account has every protection we offer." }
    : score === 2 ? { label: "Good", tone: "text-sky-700", ring: "#0284c7", note: "One more step makes your account strong." }
      : { label: "Basic", tone: "text-amber-700", ring: "#d97706", note: `Only a password protects ${scope.protects}.` }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
      <div className="min-w-0 space-y-5">
        {/* Protection level: one segment per protection, each filled when that protection is on */}
        <section className="rounded-xl border border-solid border-slate-300/80 bg-white p-5 shadow-[0_1px_3px_rgba(15,23,42,0.06)] sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Protection level</p>
              <p className={`m-0 mt-1 text-2xl font-bold ${loading ? "text-slate-300" : level.tone}`}>{loading ? "Checking" : level.label}</p>
            </div>
            <p className="m-0 text-sm font-semibold tabular-nums text-slate-500">{loading ? "" : `${score} of 3 steps`}</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-1.5" aria-hidden>
            {checks.map((c) => (
              <span key={c.label} className="h-2 rounded-full bg-slate-200">
                <span className="block h-full rounded-full transition-all duration-500" style={{ width: !loading && c.done ? "100%" : "0%", backgroundColor: level.ring }} />
              </span>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {checks.map((c) => (
              <span key={c.label} className={`truncate text-[11px] font-medium ${!loading && c.done ? "text-slate-700" : "text-slate-400"}`}>{c.label}</span>
            ))}
          </div>
          <p className="m-0 mt-3 text-sm text-slate-600">{loading ? "Reading your security settings." : level.note}</p>
        </section>

        {/* Checklist */}
        <section className="overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
          <h2 className="m-0 px-6 pb-2 pt-5 text-base font-bold text-slate-900">Your protection</h2>
          <ul className="m-0 list-none p-0">
            {checks.map((check) => (
              <li key={check.label} className="flex items-center gap-4 border-0 border-t border-solid border-slate-100 px-6 py-4 first:border-t-0">
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${loading ? "bg-slate-100" : check.done ? "bg-[#02665e] text-white" : "bg-amber-50 text-amber-600 ring-1 ring-inset ring-amber-200"}`}>
                  {loading ? null : check.done ? <Check className="h-4 w-4" aria-hidden /> : <CircleAlert className="h-4 w-4" aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-slate-900">{check.label}</span>
                  <span className="block text-xs text-slate-500">{loading ? "…" : check.hint}</span>
                </span>
                <Link href={check.href} className={`inline-flex h-9 shrink-0 items-center gap-1 rounded-xl px-3.5 text-xs font-bold no-underline ${!loading && !check.done ? "bg-[#02665e] text-white hover:bg-[#014d47]" : "border border-solid border-slate-200 bg-white text-slate-700 hover:bg-slate-50"}`}>
                  {check.action} <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* Shortcuts */}
        <section className="grid gap-3 sm:grid-cols-2">
          {[
            { href: `${scope.base}/password`, Icon: KeyRound, title: "Password", body: "Change the password you sign in with." },
            { href: `${scope.base}/2fa`, Icon: Smartphone, title: "Two-step verification", body: "Authenticator app or text message codes." },
            { href: `${scope.base}/passkeys`, Icon: Fingerprint, title: "Passkeys", body: "Fingerprint, face or device PIN sign-in." },
            { href: `${scope.base}/login-history`, Icon: History, title: "Sign-in history", body: "Where and when your account was used." },
          ].map((item) => (
            <Link key={item.href} href={item.href} className="group flex items-center gap-3.5 rounded-xl border border-solid border-slate-200 bg-white p-4 no-underline transition hover:border-[#02665e]/40">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#012a26] text-[#5eead4]"><item.Icon className="h-[18px] w-[18px]" aria-hidden /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900">{item.title}</span>
                <span className="block truncate text-xs text-slate-500">{item.body}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
            </Link>
          ))}
        </section>
      </div>

      {/* Recent activity */}
      <aside className="min-w-0 space-y-5 xl:sticky xl:top-24">
        <section className="rounded-xl border border-solid border-slate-200 bg-white p-5">
          <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Last sign-in</p>
          {loading ? (
            <div className="mt-3 h-14 rounded-xl bg-slate-50" />
          ) : lastGood ? (
            <div className="mt-3 flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-[#02665e]"><MonitorSmartphone className="h-5 w-5" aria-hidden /></span>
              <div className="min-w-0">
                <p className="m-0 truncate text-sm font-bold text-slate-900">{parseLogin(lastGood).device}</p>
                <p className="m-0 text-xs text-slate-500">{relativeTime(lastGood.at)} · {eatDateTime(lastGood.at).time}</p>
                {lastGood.ip ? <p className="m-0 mt-0.5 font-mono text-[11px] text-slate-400">{lastGood.ip}</p> : null}
              </div>
            </div>
          ) : (
            <p className="m-0 mt-3 text-sm text-slate-500">No sign-ins recorded yet.</p>
          )}
          <div className={`mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold ${failed30 ? "bg-rose-50 text-rose-700" : "bg-slate-50 text-slate-600"}`}>
            {failed30 ? <CircleAlert className="h-4 w-4 shrink-0" aria-hidden /> : <ShieldCheck className="h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />}
            {loading ? "Checking failed attempts" : failed30 ? `${failed30} failed sign-in attempt${failed30 === 1 ? "" : "s"} in the last 30 days` : "No failed sign-in attempts in the last 30 days"}
          </div>
          <Link href={`${scope.base}/login-history`} className="mt-4 inline-flex items-center gap-1 text-xs font-bold text-[#02665e] no-underline">See all sign-ins <ArrowRight className="h-3.5 w-3.5" aria-hidden /></Link>
        </section>

        <section className="rounded-xl border border-solid border-slate-200 bg-white p-5">
          <p className="m-0 text-sm font-bold text-slate-900">Good habits</p>
          <ul className="m-0 mt-3 list-none space-y-2.5 p-0 text-xs leading-5 text-slate-600">
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />Never share a sign-in code with anyone, even someone who says they are from NoLSAF.</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />Use a password you do not use anywhere else.</li>
            <li className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />If a sign-in looks strange, change your password straight away.</li>
          </ul>
        </section>
      </aside>
    </div>
  )
}
