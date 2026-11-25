import Link from "next/link";
import { ArrowLeft, Bell } from "lucide-react";

export default function AdminNotificationTarget({ href, children }: { href: string; children: string }) {
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-950">
      <span className="flex items-center gap-2 font-semibold"><Bell className="size-4" aria-hidden />{children}</span>
      <Link href={href} className="inline-flex items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 font-semibold text-[#02665e] no-underline hover:bg-emerald-100">
        <ArrowLeft className="size-4" aria-hidden /> Back to queue
      </Link>
    </div>
  );
}
