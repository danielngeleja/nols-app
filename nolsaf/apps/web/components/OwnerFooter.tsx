"use client";

import Link from "next/link";
import { Fragment, useEffect } from "react";
import { Popover, Transition } from "@headlessui/react";
import { BookOpen, ChevronUp, FileText, Headphones } from "lucide-react";
import SystemHealthPopover from "@/components/SystemHealthPopover";

const OWNER_POLICIES = [
  { href: "/owner/terms", label: "Terms" },
  { href: "/owner/privacy", label: "Privacy" },
  { href: "/owner/cookies-policy", label: "Cookies" },
  { href: "/owner/verification-policy", label: "Verification" },
  { href: "/owner/cancellation-policy", label: "Cancellation" },
  { href: "/owner/property-owner-disbursement-policy", label: "Owner disbursements" },
] as const;

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  return parts.length === 2 ? parts.pop()?.split(";").shift() || null : null;
}

const footerLink = "inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 no-underline transition-colors hover:text-neutral-900 hover:no-underline";

/** Same slim bar as the NRMS workspace: policies, live system health, help. */
export default function OwnerFooter() {
  useEffect(() => {
    const role = getCookie("role");
    sessionStorage.setItem("navigationContext", role?.toLowerCase() || "owner");
  }, []);

  return (
    <div className="public-container py-3">
      <footer
        aria-label="Owner workspace resources"
        className="rounded-2xl border border-solid border-neutral-200 bg-white px-3.5 py-2 shadow-sm sm:px-5"
      >
        <div className="flex items-center justify-between gap-3 text-xs font-bold text-neutral-500">
          <Popover className="relative">
            {({ open }) => (
              <>
                <Popover.Button className={`${footerLink} border-0 bg-transparent font-bold outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 ${open ? "text-neutral-900" : "text-neutral-500"}`}>
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  Policies
                  <ChevronUp className={`h-3 w-3 transition-transform ${open ? "" : "rotate-180"}`} aria-hidden />
                </Popover.Button>
                <Transition
                  as={Fragment}
                  enter="transition duration-150 ease-out"
                  enterFrom="translate-y-1 opacity-0"
                  enterTo="translate-y-0 opacity-100"
                  leave="transition duration-100 ease-in"
                  leaveFrom="translate-y-0 opacity-100"
                  leaveTo="translate-y-1 opacity-0"
                >
                  <Popover.Panel className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white p-1.5 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]">
                    <p className="m-0 px-2.5 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-neutral-400">Owner policies</p>
                    {OWNER_POLICIES.map((policy) => (
                      <Popover.Button
                        key={policy.href}
                        as={Link}
                        href={policy.href}
                        className="flex items-center rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:text-[#02665e] hover:no-underline"
                      >
                        {policy.label}
                      </Popover.Button>
                    ))}
                  </Popover.Panel>
                </Transition>
              </>
            )}
          </Popover>

          <SystemHealthPopover />

          <div className="flex items-center gap-1">
            <Link href="/owner/docs" className={`${footerLink} hidden sm:inline-flex`}>
              <BookOpen className="h-3.5 w-3.5" aria-hidden />
              Docs
            </Link>
            <Link href="/owner/support" className={footerLink}>
              <Headphones className="h-3.5 w-3.5" aria-hidden />
              Help
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
