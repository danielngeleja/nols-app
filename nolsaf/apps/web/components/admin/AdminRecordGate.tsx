"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAdminRecordId, type AdminRecordKind } from "@/lib/adminRecordRefs";

/** Swaps the raw address-bar segment for the reference, keeping the rest of the path and the query. */
function swapSegment(raw: string, ref: string) {
  if (typeof window === "undefined") return ref;
  const parts = window.location.pathname.split("/");
  const index = parts.lastIndexOf(encodeURIComponent(raw));
  if (index < 0) return window.location.pathname;
  parts[index] = encodeURIComponent(ref);
  return `${parts.join("/")}${window.location.search}${window.location.hash}`;
}

/**
 * Wraps an admin detail page whose address carries a record reference.
 * It resolves the reference to the id the page's API calls use, shows a quiet
 * loading or not-found state meanwhile, and replaces a legacy numeric address
 * with the reference one.
 *
 *   <AdminRecordGate kind="owner" param={params.id} backHref="/admin/owners">
 *     {(ownerId) => <OwnerDetail ownerId={ownerId} />}
 *   </AdminRecordGate>
 */
export default function AdminRecordGate({
  kind,
  param,
  backHref,
  children,
}: {
  kind: AdminRecordKind;
  param: string | string[] | null | undefined;
  backHref?: string;
  children: (id: number) => ReactNode;
}) {
  const raw = String(Array.isArray(param) ? param[0] ?? "" : param ?? "");
  const record = useAdminRecordId(kind, raw, (ref) => swapSegment(raw, ref));

  if (record.id) return <>{children(record.id)}</>;

  if (record.loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center gap-2 text-sm text-neutral-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Opening record
      </div>
    );
  }

  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 text-center">
      <p className="m-0 text-sm font-semibold text-neutral-900">{record.error || "Record not found"}</p>
      <p className="m-0 text-xs text-neutral-500">The link may be out of date, or the record was removed.</p>
      {backHref ? (
        <Link href={backHref} className="mt-2 text-xs font-semibold text-[#02665e] no-underline hover:underline">
          Back to the list
        </Link>
      ) : null}
    </div>
  );
}
