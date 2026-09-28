"use client";

import Link from "next/link";
import { FileText, Headphones } from "lucide-react";
import SystemHealthPopover from "@/components/SystemHealthPopover";

export default function NrmsOperationalFooter() {
  return (
    <footer
      aria-label="NRMS workspace resources"
      className="mx-3 mb-3 mt-2 shrink-0 rounded-2xl border border-neutral-200 bg-white px-3.5 py-2 shadow-sm sm:px-5"
    >
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-neutral-500">
        <Link
          href="/owner/nrms/policy"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 no-underline transition-colors hover:text-neutral-900 hover:no-underline"
        >
          <FileText className="h-3.5 w-3.5" aria-hidden />
          Policies
        </Link>

        <SystemHealthPopover />

        <Link
          href="/owner/nrms/help"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 no-underline transition-colors hover:text-neutral-900 hover:no-underline"
        >
          <Headphones className="h-3.5 w-3.5" aria-hidden />
          Help
        </Link>
      </div>
    </footer>
  );
}
