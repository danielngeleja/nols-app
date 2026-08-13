import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileClock,
  Mail,
  ShieldCheck,
  Smartphone,
  Trash2,
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

const deletionEmail =
  "mailto:privacy@nolsaf.com?subject=NoLSAF%20Account%20Deletion%20Request&body=Hello%20NoLSAF%20Privacy%20Team%2C%0A%0AI%20request%20permanent%20deletion%20of%20my%20NoLSAF%20account%20and%20associated%20personal%20data.%0A%0AFull%20name%3A%20%0ARegistered%20email%20or%20phone%3A%20%0A%0APlease%20contact%20me%20to%20verify%20this%20request.%0A";

const deletedData = [
  "Your NoLSAF profile and personal contact details are deleted or irreversibly anonymized.",
  "Account credentials, active sessions, saved places, preferences, and notification history are removed.",
  "Other account-linked personal data is deleted unless NoLSAF must retain it for a reason described below.",
];

const retainedData = [
  "Booking, payment, invoice, and tax records may be retained for at least seven years where required for financial reporting, tax, refunds, disputes, fraud prevention, or applicable law.",
  "Customer-support communications may be retained for up to three years to resolve requests and disputes.",
  "A minimal suppression record may be retained when needed to honor communication choices or prevent fraud. Sensitive travel documents are retained only as long as reasonably required for the booked service, safety, disputes, or law.",
];

export default function AccountDeletionPage() {
  return (
    <>
      <PublicHeader />

      <main className="min-h-screen bg-[#f5f8f7] text-slate-900">
        <section className="relative overflow-hidden border-b border-emerald-950/10 bg-[#033f3b] text-white">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-emerald-300/15 blur-3xl"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-28 left-1/4 h-72 w-72 rounded-full bg-amber-300/10 blur-3xl"
          />

          <div className="public-container relative py-14 sm:py-20">
            <div className="mx-auto max-w-4xl text-center">
              <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/15 bg-white/10 shadow-xl shadow-black/10">
                <Trash2 className="h-8 w-8" aria-hidden="true" />
              </div>
              <p className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-emerald-200">
                NoLSAF account and data controls
              </p>
              <h1 className="text-4xl font-black tracking-tight sm:text-5xl">
                Delete your NoLSAF account
              </h1>
              <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-emerald-50/90 sm:text-lg">
                You can permanently delete your account from the NoLSAF mobile app or request deletion here if you cannot access the app.
              </p>
            </div>
          </div>
        </section>

        <section className="public-container py-10 sm:py-14">
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[1.08fr_0.92fr]">
            <article className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex items-start gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-[#02665e]">
                  <Smartphone className="h-6 w-6" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#02665e]">Fastest method</p>
                  <h2 className="mt-1 text-2xl font-extrabold text-slate-950">Delete inside the mobile app</h2>
                </div>
              </div>

              <ol className="mt-7 space-y-4">
                {[
                  "Sign in to the NoLSAF mobile app.",
                  "Open Account, then select Preferences.",
                  "Choose Delete Account and review the information shown.",
                  "Confirm your identity and approve permanent deletion.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#02665e] text-sm font-extrabold text-white">
                      {index + 1}
                    </span>
                    <p className="pt-1 text-[15px] leading-6 text-slate-700">{step}</p>
                  </li>
                ))}
              </ol>

              <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
                Account deletion is permanent. You may need to complete an active trip or resolve an active service obligation before deletion can finish.
              </div>
            </article>

            <aside className="rounded-3xl border border-emerald-900/10 bg-gradient-to-br from-[#eaf7f3] to-white p-6 shadow-sm sm:p-8">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-[#02665e] shadow-sm">
                <Mail className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-2xl font-extrabold text-slate-950">Cannot access the app?</h2>
              <p className="mt-3 text-[15px] leading-7 text-slate-700">
                Send a deletion request to the NoLSAF Privacy Team. Use the email address registered to your account when possible, and include your full name plus your registered email address or phone number.
              </p>

              <a
                href={deletionEmail}
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#02665e] px-5 py-3 text-center text-sm font-bold text-white no-underline shadow-md shadow-emerald-950/15 transition hover:bg-[#014f49] focus:outline-none focus:ring-2 focus:ring-[#02665e] focus:ring-offset-2 sm:w-auto"
              >
                Request account deletion
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </a>

              <p className="mt-4 text-sm text-slate-600">
                Or email{" "}
                <a className="font-bold text-[#02665e] underline" href="mailto:privacy@nolsaf.com">
                  privacy@nolsaf.com
                </a>{" "}
                with the subject “NoLSAF Account Deletion Request”.
              </p>

              <div className="mt-6 flex gap-3 rounded-2xl border border-white bg-white/80 p-4">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#02665e]" aria-hidden="true" />
                <p className="text-sm leading-6 text-slate-700">
                  To protect your account, NoLSAF will verify that the request came from you before deleting data. Never email your password, payment PIN, or one-time verification code.
                </p>
              </div>
            </aside>
          </div>
        </section>

        <section className="public-container pb-12 sm:pb-16">
          <div className="mx-auto max-w-6xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8 lg:p-10">
            <div className="max-w-3xl">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#02665e]">Data handling</p>
              <h2 className="mt-2 text-3xl font-black text-slate-950">What is deleted and what may be retained</h2>
              <p className="mt-3 text-[15px] leading-7 text-slate-600">
                Deleting an account is not the same as deactivating it. NoLSAF removes or anonymizes the account and associated personal data, except for limited records that must be retained for legitimate legal, financial, safety, or fraud-prevention reasons.
              </p>
            </div>

            <div className="mt-8 grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-700" aria-hidden="true" />
                  <h3 className="text-lg font-extrabold text-emerald-950">Deleted or anonymized</h3>
                </div>
                <ul className="mt-5 space-y-4">
                  {deletedData.map((item) => (
                    <li key={item} className="flex gap-3 text-sm leading-6 text-slate-700">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-600" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <FileClock className="h-6 w-6 text-amber-700" aria-hidden="true" />
                  <h3 className="text-lg font-extrabold text-amber-950">Limited records retained</h3>
                </div>
                <ul className="mt-5 space-y-4">
                  {retainedData.map((item) => (
                    <li key={item} className="flex gap-3 text-sm leading-6 text-slate-700">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-600" aria-hidden="true" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-4 rounded-2xl bg-slate-950 p-5 text-white sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex items-start gap-3">
                <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
                <p className="max-w-3xl text-sm leading-6 text-slate-200">
                  After identity verification and resolution of any active service obligation, NoLSAF processes the deletion request and confirms completion. Records retained under the periods above are restricted to the stated purposes.
                </p>
              </div>
              <Link
                href="/privacy"
                className="shrink-0 text-sm font-bold text-emerald-300 underline decoration-emerald-300/50 underline-offset-4 hover:text-emerald-200"
              >
                Read the Privacy Policy
              </Link>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter withRail={false} />
    </>
  );
}
