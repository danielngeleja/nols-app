import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, MailX, TriangleAlert } from "lucide-react";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

export const metadata: Metadata = {
  title: "Newsletter",
  description: "Manage your NoLSAF travel updates subscription.",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the newsletter confirm and unsubscribe links. The API does the
 * work and redirects here with ?status=confirmed | unsubscribed | invalid | unavailable.
 */
const STATES = {
  confirmed: {
    Icon: CheckCircle2,
    tone: "text-emerald-600 bg-emerald-50",
    title: "You're subscribed",
    body: "Thanks for confirming. You'll get NoLSAF travel updates about once a month: new stays, destinations and features.",
  },
  unsubscribed: {
    Icon: MailX,
    tone: "text-slate-600 bg-slate-100",
    title: "You've been unsubscribed",
    body: "You won't receive NoLSAF travel updates anymore. Changed your mind? You can sign up again from the footer on any page.",
  },
  unavailable: {
    Icon: Clock,
    tone: "text-amber-600 bg-amber-50",
    title: "Almost ready",
    body: "Newsletter signups are opening soon. Please try the link again a little later.",
  },
  invalid: {
    Icon: TriangleAlert,
    tone: "text-amber-600 bg-amber-50",
    title: "This link has expired",
    body: "Confirmation links work once and last 48 hours. Sign up again from the footer and we'll send you a fresh one.",
  },
} as const;

export default async function NewsletterStatusPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const raw = Array.isArray(sp?.status) ? sp?.status[0] : sp?.status;
  const key = (raw && raw in STATES ? raw : "invalid") as keyof typeof STATES;
  const { Icon, tone, title, body } = STATES[key];

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50">
      <PublicHeader />
      <main className="public-container flex flex-1 items-center justify-center py-16">
        <div className="box-border w-full max-w-md rounded-2xl bg-white p-8 text-center ring-1 ring-inset ring-slate-200/80 shadow-[0_18px_44px_-28px_rgba(2,40,36,0.35)]">
          <span className={`mx-auto flex h-14 w-14 items-center justify-center rounded-2xl ${tone}`}>
            <Icon className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="m-0 mt-5 text-[22px] font-bold tracking-tight text-slate-900">{title}</h1>
          <p className="m-0 mt-2 text-[14.5px] leading-relaxed text-slate-600">{body}</p>
          <Link
            href="/public"
            className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#02665e] px-5 text-[14px] font-semibold text-white no-underline transition hover:bg-[#014e47] hover:no-underline"
          >
            Back to NoLSAF
          </Link>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
