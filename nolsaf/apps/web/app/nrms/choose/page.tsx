"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, Building2, ChevronRight, Clock8, Coffee, GlassWater, Loader2, Receipt, ShieldCheck, Sparkles, User, UtensilsCrossed, Wallet } from "lucide-react";
import apiClient from "@/lib/apiClient";

type StaffProperty = {
  id: number;
  title: string;
  nrmsAccessRole?: string;
  nrmsOutletId?: number | null;
};

type RoleMeta = { label: string; Icon: typeof BedDouble };

const ROLE_META: Record<string, RoleMeta> = {
  MANAGER: { label: "NRMS manager", Icon: ShieldCheck },
  FRONT_DESK: { label: "Front desk", Icon: BedDouble },
  HOUSEKEEPER: { label: "Housekeeper", Icon: Sparkles },
  RESTAURANT: { label: "Restaurant staff", Icon: UtensilsCrossed },
  BAR: { label: "Bar staff", Icon: GlassWater },
  OUTLET_SUPERVISOR: { label: "Outlet supervisor", Icon: Coffee },
};

const roleMeta = (role?: string): RoleMeta => ROLE_META[role ?? ""] ?? { label: role ? role.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "Staff", Icon: Building2 };

const REMEMBER_KEY = "nolsaf:nrms-workspace-choice";

export default function NrmsWorkspaceChoicePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<StaffProperty[]>([]);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [remember, setRemember] = useState(false);

  // Every role except pure housekeeping lands on the operations desk; a
  // housekeeper-only assignment goes straight to housekeeping. Kept in sync
  // with the footer chips so nobody is shown a door their role cannot open.
  const staffHref = properties.length && properties.every((property) => property.nrmsAccessRole === "HOUSEKEEPER")
    ? "/owner/nrms/housekeeping"
    : "/owner/nrms/orders";

  useEffect(() => {
    (async () => {
      try {
        const response = await apiClient.get<any>("/api/nrms/operations/me");
        const list: StaffProperty[] = Array.isArray(response.data?.properties) ? response.data.properties : [];
        if (list.length === 0) {
          router.replace("/account");
          return;
        }
        // A ?switch=1 link (from an account-switch control) forces the chooser
        // back and forgets the saved choice, so a remembered path is never a trap.
        const forceChooser = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("switch") === "1";
        if (forceChooser && typeof window !== "undefined") localStorage.removeItem(REMEMBER_KEY);
        const remembered = !forceChooser && typeof window !== "undefined" ? localStorage.getItem(REMEMBER_KEY) : null;
        if (remembered === "staff") {
          router.replace(list.every((property) => property.nrmsAccessRole === "HOUSEKEEPER") ? "/owner/nrms/housekeeping" : "/owner/nrms/orders");
          return;
        }
        if (remembered === "personal") {
          router.replace("/account");
          return;
        }
        setFirstName(response.data?.viewer?.firstName ?? null);
        setProperties(list);
        setLoading(false);
      } catch {
        router.replace("/account");
      }
    })();
  }, [router]);

  const go = (choice: "staff" | "personal", href: string) => {
    if (remember && typeof window !== "undefined") localStorage.setItem(REMEMBER_KEY, choice);
    router.push(href);
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }

  const housekeepingOnly = properties.every((property) => property.nrmsAccessRole === "HOUSEKEEPER");
  const primaryProperty = properties[0];
  const primaryRole = roleMeta(primaryProperty?.nrmsAccessRole);
  const extraCount = properties.length - 1;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
            <Sparkles className="h-3 w-3" />{firstName ? `Welcome back, ${firstName}` : "Welcome back"}
          </span>
          <h1 className="mb-0 mt-3 text-xl font-bold tracking-tight text-neutral-950">Where would you like to go?</h1>
          <p className="mb-0 mt-1.5 text-[13px] text-neutral-500">You are signed in with a staff assignment and a personal account.</p>
        </div>

        <button
          type="button"
          onClick={() => go("staff", staffHref)}
          className="mb-3 block w-full overflow-hidden rounded-2xl bg-[#07332d] text-left text-white shadow-[0_18px_40px_-24px_rgba(4,54,44,0.7)] transition hover:shadow-[0_20px_46px_-22px_rgba(4,54,44,0.85)]"
        >
          <div className="flex items-center gap-3 px-4 pb-3.5 pt-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950"><primaryRole.Icon className="h-5 w-5" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold">Staff workspace</span>
              <span className="mt-0.5 block truncate text-xs text-emerald-100/80">{primaryProperty?.title}{extraCount > 0 ? ` +${extraCount} more` : ""}</span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold text-emerald-200">
              <primaryRole.Icon className="h-3 w-3" />{primaryRole.label}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-emerald-200" />
          </div>
          <div className="flex items-center gap-4 border-t border-white/10 px-4 py-2.5">
            {(housekeepingOnly
              ? [[BedDouble, "Rooms"], [Sparkles, "Housekeeping"], [Clock8, "Your tasks"]]
              : [[Receipt, "Orders"], [Wallet, "Take payments"], [Clock8, "Your shift"]]
            ).map(([Icon, label]: any, index) => (
              <span key={index} className="inline-flex items-center gap-1.5 text-[11px] text-emerald-100/75"><Icon className="h-3.5 w-3.5" />{label}</span>
            ))}
          </div>
        </button>

        <button
          type="button"
          onClick={() => go("personal", "/account")}
          className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 text-left shadow-[0_10px_30px_-26px_rgba(15,23,42,0.5)] transition hover:border-neutral-300"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600"><User className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-bold text-neutral-900">My personal account</span>
            <span className="mt-0.5 block text-xs text-neutral-400">Bookings, trips and your profile</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300" />
        </button>

        <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-[11.5px] text-neutral-500">
          <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="h-3.5 w-3.5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500" />
          Remember my choice on this device
        </label>
      </div>
    </div>
  );
}
