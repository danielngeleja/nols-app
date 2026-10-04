"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Linkedin, Instagram, Youtube, X, Facebook, Mail, MapPin, Phone } from "lucide-react";

const APP_VERSION = "v0.1.0";

// `withRail` is accepted for existing callers; the full-width footer draws its own brand line.
export default function PublicFooter(_props: { withRail?: boolean }) {
  const year = new Date().getFullYear();
  const [newsletterEmail, setNewsletterEmail] = useState<string>('');
  const [newsletterLoading, setNewsletterLoading] = useState(false);
  const [newsletterStatus, setNewsletterStatus] = useState<null | { ok: boolean; message: string }>(null);


  const subscribeNewsletter = async () => {
    setNewsletterStatus(null);
    const email = (newsletterEmail || '').trim();
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      setNewsletterStatus({ ok: false, message: 'Please enter a valid email address.' });
      return;
    }
    setNewsletterLoading(true);
    try {
      // Double opt-in: the API saves the signup and emails a confirmation link.
      const res = await fetch('/api/public/newsletter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok !== false) {
        setNewsletterStatus({ ok: true, message: String(data?.message || 'Check your inbox to confirm your email.') });
        setNewsletterEmail('');
      } else {
        setNewsletterStatus({
          ok: false,
          message: String(data?.message || data?.error || (res.status === 429 ? 'Too many attempts. Please try again in a few minutes.' : 'Subscription failed. Please try again.')),
        });
      }
    } catch {
      setNewsletterStatus({ ok: false, message: 'Could not reach NoLSAF. Check your connection and try again.' });
    } finally {
      setNewsletterLoading(false);
    }
  };
  // Set navigation context for policy pages
  useEffect(() => {
    if (typeof window !== 'undefined') {
      sessionStorage.setItem('navigationContext', 'public');
    }
  }, []);

  return (
    <footer aria-label="Site footer" className="relative mt-10 hidden w-full page-bottom-buffer md:block">
      <div className="public-container relative z-10 pb-10 pt-4">
        <div
          className="relative box-border overflow-hidden rounded-[20px] text-white ring-1 ring-inset ring-white/[0.06] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.7)]"
          style={{ background: "linear-gradient(135deg, #07090c 0%, #0b1211 60%, #0d1714 100%)" }}
        >
          <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(560px circle at 0% 0%, rgba(2,102,94,0.28), transparent 60%)" }} />

          {/* Main grid: brand | three link columns | newsletter card */}
          <div className="relative box-border grid grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,0.8fr))] gap-8 px-8 pb-10 pt-9 lg:grid-cols-[minmax(0,1.2fr)_repeat(3,minmax(0,0.75fr))_minmax(0,1.25fr)] lg:gap-10 lg:px-10">
            <div className="min-w-0">
              {/* Logo shown openly: the mark itself, full size, no tile around it */}
              <Link href="/" className="inline-flex items-center gap-2 text-white no-underline hover:no-underline" aria-label="NoLSAF home">
                <Image
                  src="/assets/NoLS2025-04.png"
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 object-contain brightness-0 invert"
                />
                <span className="text-[20px] font-bold leading-none tracking-tight">NoLSAF</span>
              </Link>

              {/* Two short phrases on their own lines, so it never breaks mid-sentence */}
              <p className="m-0 mt-3 text-[14px] font-semibold leading-snug text-white">
                Launched in Tanzania.
                <span className="block font-normal text-emerald-300/90">Growing across Africa.</span>
              </p>

              {/* Contact: one card, labelled rows, divided by hairlines */}
              <ul className="m-0 mt-5 list-none overflow-hidden rounded-xl border border-solid border-white/[0.08] bg-white/[0.02] p-0">
                {[
                  { label: "Call us", value: "+255 736 766 726", href: "tel:+255736766726", Icon: Phone },
                  { label: "Email", value: "support@nolsaf.com", href: "mailto:support@nolsaf.com", Icon: Mail },
                  { label: "Office", value: "Dar es Salaam, Tanzania", href: null, Icon: MapPin },
                ].map(({ label, value, href, Icon }, index) => {
                  const row = (
                    <>
                      <Icon className="h-4 w-4 shrink-0 text-emerald-300" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[10.5px] font-semibold uppercase tracking-[0.1em] text-white/40">{label}</span>
                        <span className="block truncate text-[13px] text-white/85">{value}</span>
                      </span>
                    </>
                  );
                  return (
                    <li key={label} className={index > 0 ? "border-0 border-t border-solid border-white/[0.06]" : ""}>
                      {href ? (
                        <a href={href} className="flex items-center gap-3 px-3.5 py-2.5 no-underline transition-colors hover:bg-white/[0.04] hover:no-underline">
                          {row}
                        </a>
                      ) : (
                        <div className="flex items-center gap-3 px-3.5 py-2.5">{row}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {[
              {
                title: "Company",
                links: [
                  { href: "/about/who", label: "Who we are" },
                  { href: "/about/what", label: "What we do" },
                  { href: "/about/story", label: "Our story" },
                  { href: "/careers", label: "Careers" },
                ],
              },
              {
                title: "Support",
                links: [
                  { href: "/help", label: "Help Center" },
                  // Anti-impersonation: someone checking a suspicious message needs a
                  // route to the real corporate record from any page on the site.
                  { href: "/verify", label: "Verify NoLSAF" },
                  { href: "/stay-safe", label: "Stay safe" },
                  { href: "/cancellation-policy", label: "Cancellation" },
                  { href: "/verification-policy", label: "Verification" },
                ],
              },
              {
                title: "Partners",
                links: [
                  { href: "/account/register?mode=register&role=owner&next=%2Fowner", label: "Owner portal" },
                  { href: "/account/register?mode=register&role=driver&next=%2Fdriver", label: "Driver portal" },
                  { href: "/nrms", label: "NRMS for hotels" },
                ],
              },
            ].map((group) => (
              <nav key={group.title} aria-label={group.title} className="min-w-0">
                <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45"><span className="h-px w-4 bg-emerald-300/70" aria-hidden />{group.title}</p>
                <ul className="m-0 mt-3.5 grid list-none gap-2.5 p-0">
                  {group.links.map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className="group/l inline-flex items-center text-[13.5px] text-white/70 no-underline transition-colors hover:text-white hover:no-underline">
                        <span className="mr-0 h-px w-0 bg-emerald-300 transition-all duration-200 group-hover/l:mr-2 group-hover/l:w-2.5" aria-hidden />
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}

            {/* Newsletter: its own card on large screens, full row under the columns on tablets */}
            <div className="col-span-4 box-border min-w-0 rounded-2xl border border-solid border-white/[0.09] p-5 lg:col-span-1" style={{ background: "linear-gradient(160deg, rgba(2,102,94,0.22) 0%, rgba(255,255,255,0.03) 70%)" }}>
              <p className="m-0 flex items-center gap-2 whitespace-nowrap text-[14px] font-semibold text-white"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-emerald-300/15 text-emerald-300"><Mail className="h-3.5 w-3.5" aria-hidden /></span>Monthly travel updates</p>
              <p className="m-0 mt-2 text-[12.5px] leading-snug text-white/55">New stays, destinations and features. No spam.</p>
              <form
                className="mt-3.5 flex gap-2 lg:flex-col"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!newsletterLoading) void subscribeNewsletter();
                }}
              >
                <label htmlFor="footer-newsletter-email" className="sr-only">Email for NoLSAF updates</label>
                <input
                  id="footer-newsletter-email"
                  type="email"
                  value={newsletterEmail}
                  onChange={(e) => setNewsletterEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="box-border h-10 min-w-0 flex-1 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-[13.5px] text-white outline-none placeholder:text-white/35 focus:border-emerald-300/60 lg:w-full lg:flex-none"
                />
                <button
                  type="submit"
                  disabled={newsletterLoading}
                  className="group/s inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border-0 bg-emerald-400 px-4 text-[13px] font-semibold text-[#012e29] transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70 lg:w-full"
                >
                  {newsletterLoading ? "Subscribing" : "Subscribe"}
                  {!newsletterLoading && <span aria-hidden className="transition-transform group-hover/s:translate-x-0.5">&rarr;</span>}
                </button>
              </form>
              {newsletterStatus ? (
                <p role="status" aria-live="polite" className={`m-0 mt-2 text-[12.5px] ${newsletterStatus.ok ? "text-emerald-300" : "text-rose-300"}`}>
                  {newsletterStatus.message}
                </p>
              ) : null}
            </div>
          </div>

          {/* Bottom bar: copyright, legal, social */}
          <div className="relative box-border flex flex-wrap items-center justify-between gap-4 border-0 border-t border-solid border-white/[0.08] px-8 py-4 lg:px-10">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[12.5px]">
              <span className="text-white/50">&copy; {year} NoLSAF</span>
              {[
                { href: "/terms", label: "Terms" },
                { href: "/privacy", label: "Privacy" },
                { href: "/cookies-policy", label: "Cookies" },
                { href: "/account-deletion", label: "Delete account" },
              ].map((item) => (
                <Link key={item.href} href={item.href} className="text-white/60 no-underline transition-colors hover:text-white hover:no-underline">
                  {item.label}
                </Link>
              ))}
              <span className="text-[11px] tabular-nums text-white/30">{APP_VERSION}</span>
            </div>

            <div className="flex items-center gap-1">
              {[
                { href: "https://www.linkedin.com/company/nolsaf", label: "NoLSAF on LinkedIn", Icon: Linkedin },
                { href: "https://www.instagram.com/nolsaf", label: "NoLSAF on Instagram", Icon: Instagram },
                { href: "https://www.youtube.com/@nolsaf", label: "NoLSAF on YouTube", Icon: Youtube },
                { href: "https://x.com/nolsaf", label: "NoLSAF on X", Icon: X },
                { href: "https://www.facebook.com/nolsaf", label: "NoLSAF on Facebook", Icon: Facebook },
              ].map(({ href, label, Icon }) => (
                <a
                  key={href}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white/55 no-underline transition hover:bg-white/[0.08] hover:text-white"
                >
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );}
