"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Fingerprint, History, KeyRound, LayoutGrid, ShieldCheck, Smartphone } from "lucide-react"

const SECTIONS = [
  { href: "/owner/settings", label: "Overview", Icon: LayoutGrid, title: "Account security", blurb: "Your account controls your properties, bookings and payouts. Keep it locked to you." },
  { href: "/owner/settings/password", label: "Password", Icon: KeyRound, title: "Password", blurb: "Change the password you use to sign in." },
  { href: "/owner/settings/2fa", label: "Two-step verification", Icon: Smartphone, title: "Two-step verification", blurb: "Ask for a code after your password, so a stolen password alone cannot get in." },
  { href: "/owner/settings/passkeys", label: "Passkeys", Icon: Fingerprint, title: "Passkeys", blurb: "Sign in with your fingerprint, face or device PIN instead of a password." },
  { href: "/owner/settings/login-history", label: "Sign-in history", Icon: History, title: "Sign-in history", blurb: "Every recent sign-in to your account. Anything you do not recognise, act on it." },
]

export default function OwnerSecurityLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || "/owner/settings"
  const current = [...SECTIONS].sort((a, b) => b.href.length - a.href.length).find((s) => pathname === s.href || pathname.startsWith(`${s.href}/`)) ?? SECTIONS[0]

  return (
    <div className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <header className="overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div className="flex items-start gap-4 px-6 pb-5 pt-6 sm:px-8">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/[0.08] text-[#5eead4] ring-1 ring-inset ring-white/10">
            <ShieldCheck className="h-6 w-6" aria-hidden />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5eead4]">Settings</p>
            <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight sm:text-[28px]">{current.title}</h1>
            <p className="m-0 mt-1 max-w-2xl text-sm leading-6 text-white/65">{current.blurb}</p>
          </div>
        </div>
        <nav aria-label="Security sections" className="flex gap-1 overflow-x-auto px-4 sm:px-6">
          {SECTIONS.map((section) => {
            const active = section.href === current.href
            return (
              <Link
                key={section.href}
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-t-xl px-3.5 text-sm font-semibold no-underline transition ${active ? "bg-white text-[#012a26]" : "text-white/65 hover:bg-white/[0.06] hover:text-white"}`}
              >
                <section.Icon className="h-4 w-4" aria-hidden />
                {section.label}
              </Link>
            )
          })}
        </nav>
      </header>

      {children}
    </div>
  )
}
