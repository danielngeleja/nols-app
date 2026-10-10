"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { AlertTriangle, ArrowRight, BedDouble, Car, Check, Compass, Users, Download, ExternalLink, FileText, Loader2, SlidersHorizontal, Trash2, UserRound, X } from "lucide-react"
import apiClient from "@/lib/apiClient"
import { renderAndPrintAdminReport, updateAdminReportPrintWindowStatus } from "@/lib/adminReportPrint"
import DataRequestDialog, { type DataFormat } from "./DataRequestDialog"
import { buildCustomerDataReportHtml, customerDataReportReference, type AccountExport } from "@/lib/customerDataReport"

type Summary = {
  memberSince: string
  profile: { hasName: boolean; hasEmail: boolean; hasPhone: boolean }
  counts: { stays: number; completedStays: number; upcomingStays: number; rides: number; welcomes: number; tours?: number; groupStays?: number; reviews?: number; saved?: number }
  welcomePreferences: { saved: boolean; shareWithProperty: boolean; celebrateOptIn: boolean; drinkLikes: string[]; dietaryTags: string[] }
  lastExportAt: string | null
  /** Three wrong codes lock data downloads until NoLSAF support unlocks them. */
  exportLocked?: boolean
}

const EAT = "Africa/Dar_es_Salaam"
const card = "rounded-xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]"
const divider = "border-0 border-t border-solid border-slate-200"
const outline = "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 no-underline transition hover:border-emerald-400 hover:text-emerald-800 hover:no-underline disabled:cursor-not-allowed disabled:opacity-50"
const DRINK: Record<string, string> = { TEA_COFFEE: "Tea or coffee", FRESH_JUICE: "Fresh juice", SOFT_DRINK: "Soft drink", WATER: "Water", MOCKTAIL: "Mocktail" }
const DIET: Record<string, string> = { NO_SUGAR: "No sugar", LACTOSE_FREE: "Lactose-free", NUT_ALLERGY: "Nut allergy", VEGETARIAN: "Vegetarian" }
const when = (iso: string) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: EAT })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: EAT })} EAT`
}
const unwrap = (payload: any): Summary | null => payload?.data?.counts ? payload.data : payload?.counts ? payload : null

function Switch({ on, busy, onChange, label }: { on: boolean; busy: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={busy} onClick={() => onChange(!on)} className={`relative h-6 w-11 shrink-0 rounded-full border-0 transition-colors disabled:opacity-60 ${on ? "bg-emerald-600" : "bg-slate-300"}`}>
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  )
}

/** Who can see each kind of data. Kept in one place so the page and the policy say the same thing. */
const ACCESS: Array<{ what: string; you: string; nolsaf: string; property: string; advertisers: string }> = [
  { what: "Name and phone", you: "yes", nolsaf: "yes", property: "Your stay", advertisers: "no" },
  { what: "Stays and rides", you: "yes", nolsaf: "yes", property: "Their own", advertisers: "no" },
  { what: "Welcome preferences", you: "yes", nolsaf: "yes", property: "If shared", advertisers: "no" },
]
function Cell({ value }: { value: string }) {
  if (value === "yes") return <Check className="mx-auto h-4 w-4 text-emerald-600" aria-label="Yes" />
  if (value === "no") return <X className="mx-auto h-4 w-4 text-rose-500" aria-label="Never" />
  return <span className="block text-center text-[11px] font-semibold leading-4 text-amber-700">{value}</span>
}

/** Guest privacy: what the account holds, who sees it, a copy on demand, and the way out. */
export default function AccountPrivacyPage() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [exporting, setExporting] = useState<"" | "pdf" | "json">("")
  // Both formats go through the request window: questions, then a code to a verified contact.
  const [requesting, setRequesting] = useState<DataFormat | null>(null)
  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await apiClient.get("/api/account/data-summary")
      setSummary(unwrap(r.data))
      setLoadError(false)
    } catch {
      setLoadError(true)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const exportFailed = (cause: any) => setStatus({ tone: "error", text: cause?.response?.status === 429 ? "Too many requests. Wait a few minutes and try again." : "Your data could not be prepared. Try again." })

  const grantHeader = (grant: string) => ({ headers: { "X-Data-Export-Grant": grant } })

  // The readable copy: our report template, saved as PDF from the print dialog (phones included).
  // The print window was opened by the confirming click in the request window.
  async function downloadPdf(grant: string, printWindow: Window) {
    setExporting("pdf")
    setStatus(null)
    try {
      const { data } = await apiClient.get<AccountExport>("/api/account/export", grantHeader(grant))
      updateAdminReportPrintWindowStatus(printWindow, "preview")
      const generated = new Date(data.exportedAt || Date.now())
      const reportRef = customerDataReportReference(generated)
      let barcodeDataUrl: string | null = null
      try {
        const mod: any = await import("jsbarcode")
        const JsBarcode: any = mod?.default ?? mod
        const svgNode = document.createElementNS("http://www.w3.org/2000/svg", "svg")
        JsBarcode(svgNode, reportRef, { format: "CODE128", displayValue: false, margin: 0, width: 1.1, height: 30, background: "#ffffff", lineColor: "#0b1220" })
        barcodeDataUrl = `data:image/svg+xml;base64,${window.btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svgNode))))}`
      } catch { barcodeDataUrl = null }
      const html = buildCustomerDataReportHtml(data, { logoUrl: new URL("/assets/NoLS2025-04.png", window.location.origin).toString(), reportRef, barcodeDataUrl })
      await renderAndPrintAdminReport(printWindow, html)
      setStatus({ tone: "ok", text: "Choose Save as PDF in the print window" })
      void load()
    } catch (cause: any) {
      if (!printWindow.closed) printWindow.close()
      exportFailed(cause)
    } finally {
      setExporting("")
    }
  }

  // The machine-readable copy, for moving data to another service.
  async function downloadJson(grant: string) {
    setExporting("json")
    setStatus(null)
    try {
      const r = await apiClient.get("/api/account/export", { responseType: "blob", ...grantHeader(grant) })
      const url = URL.createObjectURL(r.data as Blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `nolsaf-my-data-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setStatus({ tone: "ok", text: "Downloaded" })
      void load()
    } catch (cause: any) {
      exportFailed(cause)
    } finally {
      setExporting("")
    }
  }

  async function setShare(on: boolean) {
    if (!summary) return
    const previous = summary
    setSummary({ ...summary, welcomePreferences: { ...summary.welcomePreferences, shareWithProperty: on } })
    setSharing(true)
    setStatus(null)
    try {
      await apiClient.patch("/api/customer/karibu/preferences/sharing", { shareWithProperty: on })
      setStatus({ tone: "ok", text: on ? "Sharing turned on" : "Sharing turned off" })
    } catch {
      setSummary(previous)
      setStatus({ tone: "error", text: "That change was not saved. Try again." })
    } finally {
      setSharing(false)
    }
  }

  if (loadError && !summary) {
    return (
      <div className={`${card} p-6 text-center`}>
        <p className="m-0 text-sm font-semibold text-slate-900">Your privacy settings could not be loaded</p>
        <button type="button" onClick={() => void load()} className={`${outline} mt-3`}>Try again</button>
      </div>
    )
  }
  if (!summary) {
    return <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading your data</div>
  }

  const { counts, profile, welcomePreferences: wp } = summary
  const profileMissing = [!profile.hasName && "name", !profile.hasEmail && "email", !profile.hasPhone && "phone"].filter(Boolean) as string[]
  const sharedItems = [...wp.drinkLikes.map((d) => DRINK[d] ?? d), ...wp.dietaryTags.map((t) => DIET[t] ?? t)]

  const holdings = [
    { Icon: UserRound, label: "Profile", value: profileMissing.length ? "Incomplete" : "Complete", hint: profileMissing.length ? `Add your ${profileMissing.join(" and ")}` : "Name, email and phone", href: "/account/profile", warn: profileMissing.length > 0 },
    { Icon: BedDouble, label: "Stays", value: String(counts.stays), hint: counts.upcomingStays ? `${counts.upcomingStays} upcoming` : `${counts.completedStays} completed`, href: "/account/bookings", warn: false },
    { Icon: Compass, label: "Tours", value: String(counts.tours ?? 0), hint: (counts.tours ?? 0) === 1 ? "Tour package" : "Tour packages", href: "/account/tour-packages", warn: false },
    { Icon: Users, label: "Group stays", value: String(counts.groupStays ?? 0), hint: "Requested for a group", href: "/account/group-stays", warn: false },
    { Icon: Car, label: "Rides", value: String(counts.rides), hint: counts.rides === 1 ? "Ride booked" : "Rides booked", href: "/account/rides", warn: false },
    { Icon: SlidersHorizontal, label: "Welcome preferences", value: wp.saved ? "Set" : "Not set", hint: wp.saved ? (wp.shareWithProperty ? "Shared with your stay" : "Private to you") : "Optional", href: "/account/karibu#preferences", warn: false },
  ]

  return (
    <div className="space-y-5">
      {/* What the account holds: real numbers, each a door to the data itself */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" aria-label="What your account holds">
        {holdings.map(({ Icon, label, value, hint, href, warn }) => (
          <Link key={label} href={href} className={`${card} group flex min-w-0 flex-col gap-3 p-4 no-underline transition hover:border-emerald-400 hover:no-underline`}>
            <span className="flex items-center justify-between">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Icon className="h-4 w-4" /></span>
              <ArrowRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-700" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-slate-500">{label}</span>
              <span className="mt-0.5 block text-xl font-bold tabular-nums text-slate-900">{value}</span>
              <span className={`mt-0.5 block truncate text-xs ${warn ? "font-semibold text-amber-700" : "text-slate-500"}`}>{hint}</span>
            </span>
          </Link>
        ))}
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px] xl:items-start">
        <div className="min-w-0 space-y-5">
          {/* Choices */}
          <section className={card}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-6">
              <div>
                <h2 className="m-0 text-base font-bold text-slate-900">Your choices</h2>
                <p className="m-0 mt-0.5 text-xs text-slate-500">With NoLSAF since {new Date(summary.memberSince).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: EAT })}</p>
              </div>
              {status && <span role={status.tone === "error" ? "alert" : "status"} className={`text-xs font-semibold ${status.tone === "ok" ? "text-emerald-700" : "text-rose-700"}`}>{status.text}</span>}
            </div>

            {/* Sharing, controlled right here */}
            <div className={`${divider} px-5 py-5 sm:px-6`}>
              <div className="flex items-start gap-4">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><SlidersHorizontal className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-sm font-semibold text-slate-900">Share welcome preferences with the property</p>
                  <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">Staff at the place you are staying see them during your stay only. Off means they see nothing.</p>
                  {wp.saved && sharedItems.length > 0 ? (
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] font-semibold text-slate-500">{wp.shareWithProperty ? "They see:" : "Would share:"}</span>
                      {sharedItems.map((item) => <span key={item} className="rounded-full border border-solid border-slate-300 bg-white px-2.5 py-0.5 text-[11px] font-medium text-slate-700">{item}</span>)}
                      <Link href="/account/karibu#preferences" className="ml-1 text-[11px] font-semibold text-emerald-700 no-underline hover:underline">Edit</Link>
                    </div>
                  ) : (
                    <p className="m-0 mt-2.5 text-xs text-slate-500">Nothing to share yet. <Link href="/account/karibu#preferences" className="font-semibold text-emerald-700 no-underline hover:underline">Add your preferences</Link></p>
                  )}
                </div>
                <Switch on={wp.shareWithProperty} busy={sharing} onChange={(v) => void setShare(v)} label="Share welcome preferences with the property" />
              </div>
            </div>

            {/* Copy of data */}
            <div className={`${divider} flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6`}>
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#0b2420] text-emerald-300"><Download className="h-[18px] w-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-slate-900">Download a copy of your data</p>
                <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">
                  Your profile and up to 1,000 recent records in each category: stays, tours, group stays, rides, cancellations, reviews, saved stays, trip estimates, notification choices, and Karibu preferences and welcomes. For a broader copy, contact privacy@nolsaf.com.
                </p>
                {summary.exportLocked && (
                  <p role="alert" className="m-0 mt-2 flex items-start gap-1.5 rounded-lg border border-solid border-rose-200 bg-rose-50 px-2.5 py-2 text-xs font-medium text-rose-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>Data downloads are locked on your account after too many wrong codes. Contact <a href="mailto:support@nolsaf.com" className="font-semibold text-rose-900 underline">support@nolsaf.com</a> and we will unlock them once we confirm it is you.</span>
                  </p>
                )}
                <p className="m-0 mt-1 text-[11px] text-slate-400">
                  {summary.lastExportAt ? `Last downloaded ${when(summary.lastExportAt)}` : "Never downloaded"}
                  <span className="mx-1.5 text-slate-300">·</span>
                  <button type="button" onClick={() => setRequesting("json")} disabled={!!exporting || summary.exportLocked} className="border-0 bg-transparent p-0 text-[11px] font-semibold text-emerald-700 hover:underline disabled:opacity-50">
                    {exporting === "json" ? "Preparing" : "Machine-readable copy (JSON)"}
                  </button>
                </p>
              </div>
              <button type="button" onClick={() => setRequesting("pdf")} disabled={!!exporting || summary.exportLocked} className={outline}>
                {exporting === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} {exporting === "pdf" ? "Preparing" : "Download PDF"}
              </button>
            </div>
          </section>

          {/* Danger zone, apart from everyday choices */}
          <section className="rounded-xl border border-solid border-rose-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:px-6">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-700"><Trash2 className="h-[18px] w-[18px]" /></span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-sm font-semibold text-slate-900">Delete your account</p>
                <p className="m-0 mt-0.5 text-xs leading-5 text-slate-500">Closes your account and removes your personal data. Receipts and records we must keep by law are retained as the policy explains.</p>
                {counts.upcomingStays > 0 && (
                  <p className="m-0 mt-2 inline-flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-900">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    You have {counts.upcomingStays} upcoming {counts.upcomingStays === 1 ? "stay" : "stays"}. Finish or cancel {counts.upcomingStays === 1 ? "it" : "them"} first.
                  </p>
                )}
              </div>
              <Link href="/account-deletion" className={`${outline} hover:border-rose-300 hover:text-rose-700`}>See how <ArrowRight className="h-4 w-4" /></Link>
            </div>
          </section>
        </div>

        {/* Who sees what */}
        <aside className={card}>
          <div className="px-5 py-4">
            <h2 className="m-0 text-sm font-bold text-slate-900">Who sees what</h2>
            <p className="m-0 mt-0.5 text-xs text-slate-500">Your data is never sold.</p>
          </div>
          <table className="w-full table-fixed border-collapse text-xs">
            <thead>
              <tr className={divider}>
                <th className="w-[34%] px-4 py-2.5 text-left text-[11px] font-semibold text-slate-400"><span className="sr-only">Data</span></th>
                {["You", "NoLSAF", "Property", "Advertisers"].map((h) => <th key={h} className="px-1 py-2.5 text-center text-[11px] font-semibold text-slate-500">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {ACCESS.map((row) => (
                <tr key={row.what} className={divider}>
                  <td className="px-4 py-3 font-medium text-slate-800">{row.what}</td>
                  <td className="px-1 py-3"><Cell value={row.you} /></td>
                  <td className="px-1 py-3"><Cell value={row.nolsaf} /></td>
                  <td className="px-1 py-3"><Cell value={row.property} /></td>
                  <td className="px-1 py-3"><Cell value={row.advertisers} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={`${divider} px-5 py-3`}>
            <Link href="/privacy" className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 no-underline hover:underline"><FileText className="h-3.5 w-3.5" /> Read the privacy policy <ExternalLink className="h-3 w-3" /></Link>
          </div>
        </aside>
      </div>
      {requesting && (
        <DataRequestDialog
          format={requesting}
          onClose={() => { setRequesting(null); void load() }}
          onVerified={async (grant, format, printWindow) => {
            if (format === "pdf" && printWindow) await downloadPdf(grant, printWindow)
            else await downloadJson(grant)
          }}
        />
      )}
    </div>
  )
}
