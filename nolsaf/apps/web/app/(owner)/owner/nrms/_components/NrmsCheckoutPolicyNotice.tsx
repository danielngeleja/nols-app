import Link from "next/link";
import { ArrowUpRight, ShieldAlert } from "lucide-react";

export default function NrmsCheckoutPolicyNotice({
  group = false,
}: {
  group?: boolean;
}) {
  return (
    <aside className="px-1 py-1" aria-label="NRMS checkout policy notice">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
          <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold text-neutral-700">Early-checkout safeguard</p>
          <p className="mb-0 mt-1 text-xs leading-5 text-neutral-500">
            This closes {group ? "the ready stays" : "the stay"} before the booked departure date and returns unused dates to availability.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-5">
            <span className="font-medium text-red-600">Never check out an occupied room.</span>
            <Link
              href="/owner/nrms/policy#accurate-occupancy-and-departure"
              target="_blank"
              className="inline-flex items-center gap-0.5 font-medium text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:text-emerald-800"
            >
              NRMS policy
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </aside>
  );
}
