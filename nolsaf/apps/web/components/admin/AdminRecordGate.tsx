"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAdminRecordId, type AdminRecordKind } from "@/lib/adminRecordRefs";
import NotFoundNumerals from "@/components/NotFoundNumerals";
import StatusMark from "@/components/StatusMark";

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
      <div role="status" className="flex min-h-[56vh] flex-col items-center justify-center gap-4 text-center">
        <StatusMark ring="idle" size={64} />
        <p className="m-0 inline-flex items-center gap-2 text-sm font-medium text-neutral-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Opening record
        </p>
      </div>
    );
  }

  // A wrong or stale link is not a failure: it gets the site's 404 look. Only
  // a load that genuinely failed (server or network) gets the status ring.
  const notFound = !record.error || record.error === "Record not found" || record.error === "Missing record reference";
  const primary = "inline-flex h-11 items-center rounded-full bg-[#02665e] px-6 text-sm font-semibold text-white no-underline transition hover:bg-[#02514b]";
  const secondary = "inline-flex h-11 cursor-pointer items-center rounded-full border border-solid border-neutral-300 bg-white px-6 text-sm font-semibold text-neutral-800 no-underline transition hover:border-[#02665e] hover:text-[#02665e]";

  return (
    <section role="alert" className="box-border flex min-h-[64vh] items-center justify-center px-4 py-12 text-neutral-900">
      <div className="flex w-full max-w-md flex-col items-center text-center">
        {notFound ? <NotFoundNumerals className="h-auto w-[200px] sm:w-[260px]" /> : <StatusMark ring="down" />}

        <h1 className={`mb-0 text-2xl font-bold tracking-tight text-neutral-900 sm:text-[26px] ${notFound ? "mt-9" : "mt-6"}`}>
          {notFound ? "Record not found" : "Could not open this record"}
        </h1>
        <p className="mb-0 mt-2.5 text-[15px] leading-6 text-neutral-500">
          {notFound
            ? "The link may be out of date, or the record was removed."
            : "Something went wrong on our side while opening it. Your data is safe."}
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {notFound ? (
            <>
              {backHref ? <Link href={backHref} className={primary}>Back to the list</Link> : null}
              <Link href="/admin" className={backHref ? secondary : primary}>Go to dashboard</Link>
            </>
          ) : (
            <>
              <button type="button" onClick={() => window.location.reload()} className={`${primary} cursor-pointer border-0`}>Try again</button>
              {backHref ? <Link href={backHref} className={secondary}>Back to the list</Link> : null}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
