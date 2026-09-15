"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Linkedin, Instagram, Youtube, X, Facebook } from "lucide-react";

type FooterPillVariant = "brand" | "neutral";

const APP_VERSION = "v0.1.0";

function FooterPolicyItem({
  children,
  href,
}: {
  children: React.ReactNode;
  href: string;
}) {
  const className =
    "group relative inline-flex appearance-none items-center rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-sm font-semibold cursor-pointer " +
    "text-slate-200 no-underline transition-all duration-300 ease-out " +
    "hover:text-white hover:bg-white/10 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 " +
    "motion-reduce:transition-none";

  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (href.startsWith("/") && typeof window !== "undefined") {
          sessionStorage.setItem("navigationContext", "agent");
        }
      }}
    >
      <span className="relative">
        {children}
        <span className="pointer-events-none absolute -bottom-1 left-0 h-px w-0 bg-gradient-to-r from-[#02665e] to-sky-500 transition-all duration-300 group-hover:w-full" />
      </span>
    </Link>
  );
}

function FooterPolicyAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  const className =
    "group relative inline-flex appearance-none items-center rounded-md border border-transparent bg-transparent px-2.5 py-1.5 text-sm font-semibold cursor-pointer " +
    "text-slate-200 no-underline transition-all duration-300 ease-out " +
    "hover:text-white hover:bg-white/10 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 " +
    "motion-reduce:transition-none";

  return (
    <button
      type="button"
      onClick={onClick}
      className={className}
    >
      <span className="relative">
        {children}
        <span className="pointer-events-none absolute -bottom-1 left-0 h-px w-0 bg-gradient-to-r from-[#02665e] to-sky-500 transition-all duration-300 group-hover:w-full" />
      </span>
    </button>
  );
}

function FooterPill({
  children,
  href,
  variant = "brand",
}: {
  children: React.ReactNode;
  href: string;
  variant?: FooterPillVariant;
}) {
  const base =
    "group relative inline-flex items-center rounded-full border bg-white/10 px-3 py-1.5 text-xs font-semibold no-underline overflow-hidden " +
    "transition-[transform,background-color,border-color,color] duration-300 ease-out " +
    "hover:-translate-y-[1px] active:translate-y-0 active:scale-[0.99] " +
    "motion-reduce:transition-none motion-reduce:hover:transform-none motion-reduce:active:transform-none";

  const brand =
    "border-white/15 text-emerald-200 hover:bg-white/15 hover:border-white/25 focus-visible:ring-2 focus-visible:ring-[#02665e]/25";
  const neutral =
    "border-white/15 text-slate-200 hover:bg-white/10 hover:border-white/25 focus-visible:ring-2 focus-visible:ring-white/20";

  const overlayTint =
    variant === "brand"
      ? "bg-gradient-to-b from-[#02665e]/20 to-[#02665e]/10"
      : "bg-gradient-to-b from-white/10 to-white/0";

  const overlayShine = variant === "brand" ? "via-white/70" : "via-slate-200/80";

  const className = `${base} ${variant === "brand" ? brand : neutral}`;

  return (
    <Link
      href={href}
      className={className}
      onClick={() => {
        if (href.startsWith("/") && typeof window !== "undefined") {
          sessionStorage.setItem("navigationContext", "agent");
        }
      }}
    >
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 ${overlayTint}`}
      />
      <span
        aria-hidden
        className={`pointer-events-none absolute -inset-y-2 -left-1/3 w-1/3 rotate-12 bg-gradient-to-r from-transparent ${overlayShine} to-transparent opacity-0 blur-[1px] transition-all duration-500 ease-out group-hover:left-full group-hover:opacity-60 motion-reduce:hidden`}
      />
      <span className="relative z-10">{children}</span>
    </Link>
  );
}

function IconLinkButton({
  href,
  label,
  iconComponent,
  iconSize = 20,
  iconClassName = "",
  iconActiveClass = "",
  containerClassName = "",
  onClick,
  delay = 0,
}: {
  href: string;
  label: string;
  iconComponent?: React.ComponentType<any> | undefined;
  iconSize?: number;
  iconClassName?: string;
  iconActiveClass?: string;
  containerClassName?: string;
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
  delay?: number;
}) {
  const [touched, setTouched] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  const clearTouch = (delay = 600) => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => setTouched(false), delay);
  };

  const onTouchStart = () => {
    setTouched(true);
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
  };

  const onTouchEnd = () => {
    clearTouch(700);
  };

  const onPointerDown = () => {
    setTouched(true);
  };

  const onPointerUp = () => {
    clearTouch(300);
  };

  let clonedIcon: React.ReactNode;
  const IconComp = iconComponent;
  if (IconComp) {
    clonedIcon = React.createElement(IconComp, {
      size: iconSize,
      "aria-hidden": true,
      className: `${iconClassName ?? ""} ${touched ? iconActiveClass : ""} stroke-current transition-all duration-300`.trim(),
      strokeWidth: 1.5,
    });
  } else {
    clonedIcon = <span className="inline-block w-5 h-5 rounded-sm bg-gray-300" aria-hidden="true" />;
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onClick}
      aria-label={label}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{ animationDelay: `${delay}ms` }}
      className={`group relative inline-flex items-center justify-center rounded-full no-underline focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#02665e]/30 focus:ring-offset-slate-950 transition-all duration-300 ease-out transform hover:-translate-y-[1px] hover:shadow-md active:translate-y-0 active:shadow-sm ${touched ? "-translate-y-[1px]" : ""} ${containerClassName}`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-white/50 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      {clonedIcon}
      <span className="sr-only">{label}</span>
    </a>
  );
}

export default function AgentFooter({ withRail = true }: { withRail?: boolean }) {
  const year = new Date().getFullYear();
  const [hasContractAccess, setHasContractAccess] = useState(false);

  // Keep the same navigation context behavior as the existing footer.
  useEffect(() => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("navigationContext", "agent");
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const loadContractAccess = async () => {
      try {
        const res = await fetch("/api/agent/me", {
          credentials: "include",
          signal: controller.signal,
        });
        if (!res.ok) return;

        const data = await res.json();
        if (!mounted) return;

        const applicationStatus = String(data?.agent?.application?.status || "").toUpperCase();
        const hasEmploymentDate = Boolean(data?.agent?.employmentCommencedAt);
        const hired = applicationStatus === "HIRED" || (hasEmploymentDate && applicationStatus.length === 0);

        setHasContractAccess(hired);
      } catch {
        // ignore and keep contract entry hidden when status cannot be verified
      }
    };

    void loadContractAccess();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  return (
    <footer
      aria-label="Footer"
      className="relative w-full mt-10 page-bottom-buffer overflow-hidden border-t border-gray-200/70 bg-gradient-to-b from-white via-slate-50 to-white"
    >
      <h2 className="sr-only">Footer</h2>

      {withRail ? (
        <div aria-hidden className="absolute inset-x-0 top-0 h-1 flex">
          <span className="footer-rail-seg footer-rail-green w-[34%]" />
          <span className="footer-rail-seg footer-rail-yellow w-[8%]" />
          <span className="footer-rail-seg footer-rail-black w-[8%]" />
          <span className="footer-rail-seg footer-rail-blue w-[50%]" />
        </div>
      ) : null}

      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(2,102,94,0.22),transparent_70%)] blur-2xl"
      />

      <div className="public-container pt-10 pb-10 relative z-10">
        <div className="rounded-3xl border border-white/12 bg-gradient-to-b from-slate-950/85 via-slate-900/80 to-slate-950/85 backdrop-blur-xl shadow-[0_18px_70px_rgba(0,0,0,0.45)] text-slate-200">
          <div className="px-5 py-8 sm:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              <div className="lg:col-span-5 space-y-4">
                <div className="flex items-start gap-3">
                  <Image
                    src="/assets/NoLS2025-04.png"
                    alt="NoLSAF"
                    width={120}
                    height={32}
                    className="object-contain brightness-0 invert"
                    style={{ width: "auto", height: "auto" }}
                  />
                  <span className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-200">
                    {APP_VERSION}
                  </span>
                </div>

                <p className="text-sm text-slate-300 leading-relaxed max-w-sm">
                  Agent portal support, resources, and policies.
                </p>

                <div className="flex items-center gap-3 pt-2 flex-wrap">
                  <IconLinkButton
                    href="https://www.linkedin.com/company/nolsaf"
                    label="NoLSAF on LinkedIn"
                    iconComponent={Linkedin}
                    iconSize={20}
                    iconClassName="text-[#0A66C2] relative z-10"
                    iconActiveClass="text-[#084A9A]"
                    containerClassName="h-11 w-11 bg-white/10 backdrop-blur-sm border border-white/15 hover:bg-white/15 hover:border-white/25"
                    delay={0}
                  />
                  <IconLinkButton
                    href="https://www.instagram.com/nolsaf"
                    label="NoLSAF on Instagram"
                    iconComponent={Instagram}
                    iconSize={20}
                    iconClassName="text-[#E4405F] relative z-10"
                    iconActiveClass="text-[#C32B4E]"
                    containerClassName="h-11 w-11 bg-white/10 backdrop-blur-sm border border-white/15 hover:bg-white/15 hover:border-white/25"
                    delay={100}
                  />
                  <IconLinkButton
                    href="https://www.youtube.com/@nolsaf"
                    label="NoLSAF on YouTube"
                    iconComponent={Youtube}
                    iconSize={20}
                    iconClassName="text-[#FF0000] relative z-10"
                    iconActiveClass="text-[#CC0000]"
                    containerClassName="h-11 w-11 bg-white/10 backdrop-blur-sm border border-white/15 hover:bg-white/15 hover:border-white/25"
                    delay={200}
                  />
                  <IconLinkButton
                    href="https://x.com/nolsaf"
                    label="NoLSAF on X"
                    iconComponent={X}
                    iconSize={20}
                    iconClassName="text-white relative z-10"
                    iconActiveClass="text-white"
                    containerClassName="h-11 w-11 bg-white/10 backdrop-blur-sm border border-white/15 hover:bg-white/15 hover:border-white/25"
                    delay={300}
                  />
                  <IconLinkButton
                    href="https://www.facebook.com/nolsaf"
                    label="NoLSAF on Facebook"
                    iconComponent={Facebook}
                    iconSize={20}
                    iconClassName="text-[#1877F2] relative z-10"
                    iconActiveClass="text-[#165db8]"
                    containerClassName="h-11 w-11 bg-white/10 backdrop-blur-sm border border-white/15 hover:bg-white/15 hover:border-white/25"
                    delay={400}
                  />
                </div>
              </div>

              <div className="lg:col-span-7">
                <div className="rounded-2xl border border-white/12 bg-white/6 backdrop-blur-sm p-5 shadow-sm shadow-black/20">
                  <div className="flex flex-col gap-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-slate-100 w-fit">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300" />
                      Need help?
                    </div>
                    <div className="text-sm text-slate-300">
                      Contact support or visit the Help Center for agent assistance.
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <FooterPill href="/help?ctx=agent" variant="brand">Help Center</FooterPill>
                    <FooterPill href="mailto:support@nolsaf.com" variant="neutral">support@nolsaf.com</FooterPill>
                    <FooterPill href="/account/agent/security" variant="neutral">Security</FooterPill>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-8 grid grid-cols-2 lg:grid-cols-3 gap-8">
              <div className="space-y-3">
                <h3 className="text-base font-semibold text-white">About</h3>
                <ul className="m-0 list-none p-0 space-y-1">
                  {[
                    { href: "/about/who?ctx=agent", label: "Who are we" },
                    { href: "/about/what?ctx=agent", label: "What we do" },
                    { href: "/about/story?ctx=agent", label: "Our Best Story" },
                  ].map((item) => (
                    <li key={item.href}>
                      <FooterPolicyItem href={item.href}>{item.label}</FooterPolicyItem>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-3">
                <h3 className="text-base font-semibold text-white">Resources</h3>
                <ul className="m-0 list-none p-0 space-y-1">
                  {[
                    { href: "/help?ctx=agent", label: "Help Center" },
                    { href: "/careers?ctx=agent", label: "Careers" },
                  ].map((item) => (
                    <li key={item.href}>
                      <FooterPolicyItem href={item.href}>{item.label}</FooterPolicyItem>
                    </li>
                  ))}
                  <li>
                    <span className="inline-flex items-center px-2.5 py-1.5 text-sm font-semibold text-slate-200">
                      Version: <span className="ml-1 text-slate-400">{APP_VERSION}</span>
                    </span>
                  </li>
                </ul>
              </div>

              <div className="col-span-2 lg:col-span-1 space-y-3">
                <h3 className="text-base font-semibold text-white">Agent Support</h3>
                <ul className="m-0 list-none p-0 grid grid-cols-2 gap-x-6 gap-y-1">
                  {[
                    { href: "/account/agent", label: "Agent Portal" },
                    { href: "/account/agent/bookings", label: "My Bookings" },
                    { href: "/account/agent/notifications", label: "Notifications" },
                    { href: "/account/agent/profile", label: "My Profile" },
                    { href: "/account/agent/profile/preview", label: "Preview" },
                    { href: "/account/agent/card", label: "My Card" },
                  ].map((item) => (
                    <li key={item.href}>
                      <FooterPolicyItem href={item.href}>{item.label}</FooterPolicyItem>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-8">
              <div className="h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <nav aria-label="Footer legal navigation" className="mt-4">
                <ul className="m-0 flex list-none flex-wrap items-center justify-center gap-2.5 p-0">
                  {(
                    [
                      { kind: "modal" as const, type: "terms" as const, label: "Terms" },
                      { kind: "modal" as const, type: "privacy" as const, label: "Privacy" },
                      { kind: "modal" as const, type: "cookies" as const, label: "Cookies" },
                      ...(hasContractAccess
                        ? [{ kind: "modal" as const, type: "contract" as const, label: "Partnership Contract" }]
                        : []),
                    ]
                  ).map((item, index) => (
                    <li
                      key={item.type}
                      className={
                        index === 0
                          ? ""
                          : "lg:relative lg:pl-4 lg:before:content-[''] lg:before:absolute lg:before:left-1 lg:before:top-1/2 lg:before:-translate-y-1/2 lg:before:h-4 lg:before:w-px lg:before:bg-white/15"
                      }
                    >
                      <FooterPolicyAction
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("open-legal", {
                              detail: { type: item.type },
                            })
                          )
                        }
                      >
                        {item.label}
                      </FooterPolicyAction>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>

            <div className="mt-8">
              <div className="h-px w-full bg-gradient-to-r from-transparent via-white/15 to-transparent" />
              <div className="mt-5 flex flex-col items-center gap-2">
                <div className="text-xs sm:text-sm text-slate-300 text-center">
                  <span className="font-semibold text-slate-200">© {year} </span>
                  <span className="font-extrabold text-emerald-200 tracking-wide">NoLSAF</span>
                  <span className="text-slate-400"> |All rights reserved</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
