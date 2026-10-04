import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  FileClock,
  Mail,
  ShieldCheck,
  Smartphone,
  Trash2,
  TriangleAlert,
  UserCheck,
  Inbox,
  BadgeCheck,
} from "lucide-react";

import PublicFooter from "@/components/PublicFooter";
import PublicHeader from "@/components/PublicHeader";

export const metadata: Metadata = {
  title: "Delete Your Account",
  description:
    "Request permanent deletion of your NoLSAF account and learn which associated data is deleted or retained.",
  alternates: { canonical: "https://nolsaf.com/account-deletion" },
  robots: { index: true, follow: true },
  openGraph: {
    title: "Delete Your NoLSAF Account",
    description:
      "How to request permanent deletion of a NoLSAF account and its associated personal data.",
    url: "https://nolsaf.com/account-deletion",
    type: "website",
  },
};

// Policy and legal surfaces use Trebuchet MS (see the brand font decision).
const DOC_FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

const deletionEmail =
  "mailto:privacy@nolsaf.com?subject=NoLSAF%20Account%20Deletion%20Request&body=Hello%20NoLSAF%20Privacy%20Team%2C%0A%0AI%20request%20permanent%20deletion%20of%20my%20NoLSAF%20account%20and%20associated%20personal%20data.%0A%0AFull%20name%3A%20%0ARegistered%20email%20or%20phone%3A%20%0A%0APlease%20contact%20me%20to%20verify%20this%20request.%0A";

const appDeletionSteps = [
  { title: "Sign in", text: "Sign in to the NoLSAF mobile app." },
  { title: "Open Preferences", text: "Open Account, then select Preferences." },
  { title: "Delete Account", text: "Choose Delete Account and review the information shown." },
  { title: "Confirm", text: "Confirm your identity and approve permanent deletion." },
];

const deletedData = [
  "Your NoLSAF profile and personal contact details are deleted or irreversibly anonymized.",
  "Account credentials, active sessions, saved places, preferences, and notification history are removed.",
  "Other account-linked personal data is deleted unless NoLSAF must retain it for a reason described below.",
];

// Each retained record with how long it may be kept, so the period is readable at a glance
const retainedData = [
  {
    period: "At least 7 years",
    text: "Booking, payment, invoice, and tax records may be retained for at least seven years where required for financial reporting, tax, refunds, disputes, fraud prevention, or applicable law.",
  },
  {
    period: "Up to 3 years",
    text: "Customer-support communications may be retained for up to three years to resolve requests and disputes.",
  },
  {
    period: "Only as needed",
    text: "A minimal suppression record may be retained when needed to honor communication choices or prevent fraud. Sensitive travel documents are retained only as long as reasonably required for the booked service, safety, disputes, or law.",
  },
];

const afterRequest = [
  { Icon: Inbox, title: "Request received", text: "From the app, or by email to the Privacy Team." },
  { Icon: UserCheck, title: "We verify it is you", text: "NoLSAF confirms the request came from the account holder." },
  { Icon: FileClock, title: "Open items settled", text: "Any active trip or service obligation is resolved first." },
  { Icon: BadgeCheck, title: "Deleted and confirmed", text: "The deletion is processed and completion is confirmed." },
];

export default function AccountDeletionPage() {
  return (
    <>
      <PublicHeader />

      <main className="min-h-screen bg-[#f5f8f7] text-slate-900" style={{ fontFamily: DOC_FONT }}>
        <style>{"#account-deletion, #account-deletion * { box-sizing: border-box; }"}</style>
        <div id="account-deletion">
          {/* ── Header: a document, not a banner ── */}
          <section className="bg-white">
            <div className="public-container">
              <div className="mx-auto max-w-3xl border-0 border-b border-solid border-slate-200 px-1 pb-8 pt-10 text-center sm:pb-10 sm:pt-14">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-rose-600 ring-1 ring-rose-100">
                  <Trash2 className="h-6 w-6" aria-hidden="true" />
                </span>
                <p className="m-0 mt-4 text-[12.5px] font-bold tracking-[0.04em] text-[#02665e]">NoLSAF account and data</p>
                <h1 className="m-0 mt-1.5 text-[30px] font-bold leading-tight tracking-tight text-[#0f2e2b] sm:text-[38px]">
                  Delete your NoLSAF account
                </h1>
                <p className="m-0 mx-auto mt-3 max-w-xl text-[15.5px] leading-7 text-slate-600">
                  You can permanently delete your account from the NoLSAF mobile app or request deletion here if you cannot access the app.
                </p>
                <div className="mx-auto mt-5 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3.5 py-1.5 text-[12.5px] font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Deletion is permanent and cannot be undone
                </div>
              </div>
            </div>
          </section>

          {/* ── Two ways to delete, side by side ── */}
          <section className="public-container py-10 sm:py-12">
            <div className="mx-auto max-w-5xl">
              <h2 className="m-0 text-center text-[13px] font-bold tracking-[0.04em] text-slate-500">Choose how to delete</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                {/* Option 1: in the app */}
                <article className="flex flex-col rounded-3xl border border-solid border-[#02665e]/25 bg-white p-6 shadow-[0_12px_32px_-18px_rgba(2,102,94,0.35)] sm:p-7">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-[#02665e] text-white">
                        <Smartphone className="h-5 w-5" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="m-0 text-[12px] font-bold text-[#02665e]">Option 1</p>
                        <h3 className="m-0 text-[20px] font-bold leading-snug text-slate-950">In the mobile app</h3>
                      </div>
                    </div>
                    <span className="flex-shrink-0 rounded-full bg-[#02665e]/10 px-2.5 py-1 text-[11.5px] font-bold text-[#02665e]">Fastest</span>
                  </div>

                  <ol className="m-0 mt-6 list-none p-0">
                    {appDeletionSteps.map((step, index) => (
                      <li key={step.title} className="relative flex gap-3.5 pb-4 last:pb-0">
                        {index < appDeletionSteps.length - 1 ? (
                          <span aria-hidden="true" className="absolute bottom-0 left-[15px] top-8 w-0.5 rounded-full bg-[#02665e]/15" />
                        ) : null}
                        <span className="relative flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[13px] font-black text-[#02665e] ring-4 ring-white">
                          {index + 1}
                        </span>
                        <div className="min-w-0 pt-1">
                          <p className="m-0 text-[14.5px] font-semibold text-slate-900">{step.title}</p>
                          <p className="m-0 mt-0.5 text-[13.5px] leading-6 text-slate-600">{step.text}</p>
                        </div>
                      </li>
                    ))}
                  </ol>

                  <p className="m-0 mt-auto flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-3 text-[13px] leading-6 text-amber-950">
                    <TriangleAlert className="mt-1 h-4 w-4 flex-shrink-0 text-amber-600" aria-hidden="true" />
                    <span>You may need to complete an active trip or resolve an active service obligation before deletion can finish.</span>
                  </p>
                </article>

                {/* Option 2: by email */}
                <article className="flex flex-col rounded-3xl border border-solid border-slate-200 bg-white p-6 sm:p-7">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      <Mail className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="m-0 text-[12px] font-bold text-slate-500">Option 2</p>
                      <h3 className="m-0 text-[20px] font-bold leading-snug text-slate-950">Cannot access the app?</h3>
                    </div>
                  </div>

                  <p className="m-0 mt-5 text-[14.5px] leading-7 text-slate-700">
                    Send a deletion request to the NoLSAF Privacy Team. Use the email address registered to your account when possible, and include your full name plus your registered email address or phone number.
                  </p>

                  <a
                    href={deletionEmail}
                    className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] px-5 text-[15px] font-bold text-white no-underline shadow-sm transition-colors hover:bg-[#014f49] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2"
                  >
                    Request account deletion
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </a>
                  <p className="m-0 mt-3 text-center text-[13px] text-slate-500">
                    Or email{" "}
                    <a className="font-bold text-[#02665e] underline" href="mailto:privacy@nolsaf.com">privacy@nolsaf.com</a>{" "}
                    with the subject &ldquo;NoLSAF Account Deletion Request&rdquo;.
                  </p>

                  <p className="m-0 mt-auto flex items-start gap-2 rounded-xl bg-[#02665e]/[0.06] px-3.5 py-3 text-[13px] leading-6 text-slate-700">
                    <ShieldCheck className="mt-1 h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden="true" />
                    <span>NoLSAF will verify that the request came from you before deleting data. Never email your password, payment PIN, or one-time verification code.</span>
                  </p>
                </article>
              </div>
            </div>
          </section>

          {/* ── What happens next ── */}
          <section className="public-container pb-10 sm:pb-12">
            <div className="mx-auto max-w-5xl">
              <h2 className="m-0 text-center text-[22px] font-bold text-slate-950 sm:text-[26px]">What happens after you ask</h2>
              <ol className="m-0 mt-6 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-4">
                {afterRequest.map(({ Icon, title, text }, index) => (
                  <li key={title} className="relative rounded-2xl border border-solid border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      </span>
                      <span className="text-[11px] font-bold tabular-nums text-slate-400">Step {index + 1}</span>
                    </div>
                    <p className="m-0 mt-3 text-[14.5px] font-bold text-slate-900">{title}</p>
                    <p className="m-0 mt-1 text-[13px] leading-6 text-slate-600">{text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* ── What is deleted, what may be kept ── */}
          <section className="public-container pb-14 sm:pb-16">
            <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white">
              <div className="border-0 border-b border-solid border-slate-100 px-6 py-6 sm:px-8">
                <h2 className="m-0 text-[22px] font-bold text-slate-950 sm:text-[26px]">What is deleted and what may be retained</h2>
                <p className="m-0 mt-2 max-w-3xl text-[14.5px] leading-7 text-slate-600">
                  Deleting an account is not the same as deactivating it. NoLSAF removes or anonymizes the account and associated personal data, except for limited records that must be retained for legitimate legal, financial, safety, or fraud-prevention reasons.
                </p>
              </div>

              <div className="grid md:grid-cols-2">
                {/* Deleted */}
                <div className="px-6 py-6 sm:px-8">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                      <CheckCircle2 className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="m-0 text-[17px] font-bold text-slate-950">Deleted or anonymized</h3>
                  </div>
                  <ul className="m-0 mt-4 list-none space-y-3 p-0">
                    {deletedData.map((item) => (
                      <li key={item} className="flex gap-3 text-[14px] leading-6 text-slate-700">
                        <CheckCircle2 className="mt-1 h-4 w-4 flex-shrink-0 text-emerald-600" aria-hidden="true" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Retained, each with its period */}
                <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-6 py-6 sm:px-8 md:border-l md:border-t-0">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                      <FileClock className="h-[18px] w-[18px]" aria-hidden="true" />
                    </span>
                    <h3 className="m-0 text-[17px] font-bold text-slate-950">Limited records retained</h3>
                  </div>
                  <ul className="m-0 mt-4 list-none space-y-3 p-0">
                    {retainedData.map((item) => (
                      <li key={item.period} className="rounded-xl bg-white p-3.5 ring-1 ring-slate-200/80">
                        <span className="inline-flex rounded-md bg-amber-100 px-2 py-0.5 text-[11.5px] font-bold text-amber-900">{item.period}</span>
                        <p className="m-0 mt-1.5 text-[13.5px] leading-6 text-slate-700">{item.text}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="flex flex-col gap-3 border-0 border-t border-solid border-slate-100 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
                <p className="m-0 max-w-3xl text-[13.5px] leading-6 text-slate-600">
                  After identity verification and resolution of any active service obligation, NoLSAF processes the deletion request and confirms completion. Records retained under the periods above are restricted to the stated purposes.
                </p>
                <Link
                  href="/privacy"
                  className="inline-flex flex-shrink-0 items-center gap-1.5 text-[14px] font-bold text-[#02665e] no-underline hover:underline"
                >
                  Read the Privacy Policy
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>

      <PublicFooter withRail={false} />
    </>
  );
}
