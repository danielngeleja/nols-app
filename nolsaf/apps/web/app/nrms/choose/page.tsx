"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BedDouble, ChevronRight, Loader2, ShieldCheck, User } from "lucide-react";
import apiClient from "@/lib/apiClient";

type StaffProperty = {
  id: number;
  title: string;
  nrmsAccessRole?: string;
  nrmsOutletId?: number | null;
};

const ROLE_LABELS: Record<string, string> = {
  MANAGER: "NRMS manager",
  FRONT_DESK: "Front desk",
  HOUSEKEEPER: "Housekeeper",
  RESTAURANT: "Restaurant staff",
  BAR: "Bar staff",
  OUTLET_SUPERVISOR: "Outlet supervisor",
};

export default function NrmsWorkspaceChoicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<StaffProperty[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiClient.get<any>("/api/nrms/operations/me");
        const list: StaffProperty[] = Array.isArray(response.data?.properties) ? response.data.properties : [];
        if (list.length === 0) {
          router.replace("/account");
          return;
        }
        setProperties(list);
        setLoading(false);
      } catch {
        router.replace("/account");
      }
    })();
  }, [router]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 px-4 py-10">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Welcome back</p>
          <h1 className="mb-0 mt-1 text-xl font-bold text-neutral-950">Where would you like to go?</h1>
          <p className="mb-0 mt-1 text-xs text-neutral-500">You have a staff assignment, choose how to continue.</p>
        </div>

        <Link
          href={properties.every((property) => property.nrmsAccessRole === "HOUSEKEEPER") ? "/owner/nrms/housekeeping" : "/owner/nrms/orders"}
          className="block overflow-hidden rounded-3xl border border-emerald-900/20 bg-[#082f2a] text-white no-underline shadow-sm transition hover:shadow-md hover:no-underline"
        >
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950"><BedDouble className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold">Staff workspace</p>
              <p className="mb-0 mt-0.5 truncate text-[11px] text-emerald-100/70">
                {properties.map((property) => `${property.title} (${ROLE_LABELS[property.nrmsAccessRole ?? ""] ?? property.nrmsAccessRole ?? "Staff"})`).join(", ")}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-emerald-200" />
          </div>
          <div className="flex items-center gap-2 border-t border-white/10 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200/70">
            <ShieldCheck className="h-3.5 w-3.5" /> Property operations
          </div>
        </Link>

        <Link href="/account" className="block overflow-hidden rounded-3xl border border-neutral-200 bg-white no-underline shadow-sm transition hover:shadow-md hover:no-underline">
          <div className="flex items-center gap-3 px-5 py-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-700"><User className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold text-neutral-900">My personal account</p>
              <p className="mb-0 mt-0.5 text-[11px] text-neutral-400">Bookings, trips and your profile</p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300" />
          </div>
        </Link>
      </div>
    </div>
  );
}
