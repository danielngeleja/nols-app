"use client";

// Slim status bar for the tour operator workspace, the same as OwnerFooter:
// policies, live system health, help. Each policy is a page inside the
// workspace (/account/agent/policies/*), so the rail and header stay.
// AgentFooter is still used on /about, /careers and /help.
import Link from "next/link";
import { Fragment } from "react";
import { Popover, Transition } from "@headlessui/react";
import { ChevronUp, FileText, Headphones } from "lucide-react";
import SystemHealthPopover from "@/components/SystemHealthPopover";
import { AGENT_POLICIES } from "@/app/account/agent/policies/agentPolicies";

const footerLink = "inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-white/60 no-underline transition-colors hover:bg-white/[0.07] hover:text-white hover:no-underline visited:text-white/60";

export default function AgentOperationalFooter() {
  return (
    <footer
      aria-label="Tour operator workspace resources"
      className="mb-3 mt-2 shrink-0 rounded-lg border border-solid border-white/10 bg-[#252d2c] px-3.5 py-2 text-white sm:px-5"
    >
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-white/60">
        <Popover className="relative">
          {({ open }) => (
            <>
              <Popover.Button className={`${footerLink} cursor-pointer border-0 bg-transparent font-bold outline-none focus-visible:ring-2 focus-visible:ring-white/20 ${open ? "!text-white" : ""}`}>
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
                <Popover.Panel className="absolute bottom-full left-0 z-50 mb-2 w-60 overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white p-1.5 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]">
                  <p className="m-0 px-2.5 pb-1 pt-1.5 text-[11px] font-bold text-neutral-400">Operator policies</p>
                  {AGENT_POLICIES.map((policy) => (
                    <Popover.Button
                      key={policy.href}
                      as={Link}
                      href={policy.href}
                      className="flex items-center rounded-md px-2.5 py-2 text-[12.5px] font-semibold text-neutral-700 no-underline hover:bg-neutral-50 hover:text-[#02665e] hover:no-underline"
                    >
                      {policy.label}
                    </Popover.Button>
                  ))}
                </Popover.Panel>
              </Transition>
            </>
          )}
        </Popover>

        <SystemHealthPopover variant="dark" />

        <Link href="/account/agent/help" className={footerLink}>
          <Headphones className="h-3.5 w-3.5" aria-hidden />
          Help
        </Link>
      </div>
    </footer>
  );
}
