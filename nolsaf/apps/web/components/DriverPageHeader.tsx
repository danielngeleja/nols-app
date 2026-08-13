"use client";
import React, { type ReactElement } from "react";
import { usePathname } from "next/navigation";
import { ListChecks, FileText, Gift, Lock, Settings } from "lucide-react";
import type { PageHeaderProps } from "@/components/ui/PageHeader";

export type DriverPageHeaderProps = Omit<PageHeaderProps, "variant" | "title"> & {
  /** Optional short title to render beside the icon for compact pages */
  title?: string;
};

// Compact header for driver pages. Choose an icon based on route
export default function DriverPageHeader(props?: DriverPageHeaderProps): ReactElement {
  const { title } = props || {};
  const pathname = usePathname() || "/";

  // Normalize trailing slash: treat '/driver' and '/driver/' the same
  const normalized = pathname.replace(/\/+$/, "");

  // Don't show header on main dashboard - it has its own header
  if (normalized === "/driver") {
    return <></>;
  }

  // Compact header for non-dashboard driver pages. Choose an icon based on route
  // Use the same Gift icon as the sidebar for the driver bonus page to keep UI consistent.
  const Icon = normalized.startsWith("/driver/security")
    ? Lock
    : normalized.startsWith("/driver/management")
    ? Settings
    : normalized.startsWith("/driver/bonus")
    ? Gift
    : normalized.startsWith("/driver/invoices")
    ? FileText
    : ListChecks;

  return (
    <div className="py-6 text-center">
      <div className="inline-flex items-center justify-center gap-3">
        <div className="p-2 rounded-full bg-transparent inline-flex items-center justify-center">
          <Icon className="h-8 w-8 text-gray-800" aria-hidden />
        </div>
        {title ? (
          <h1 className="text-xl font-semibold">{title}</h1>
        ) : (
          <span className="sr-only">Driver</span>
        )}
      </div>
    </div>
  );
}
