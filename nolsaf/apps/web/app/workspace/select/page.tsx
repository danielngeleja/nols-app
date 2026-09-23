"use client";

// Workspace selector. Shown after login when an account holds more than one
// workspace. A single-workspace account never sees this page: it is redirected
// straight through, so nothing changes for ordinary users.
//
// See docs/SALES_PARTNER_WORKSPACE.md section 4.3.
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BadgeDollarSign, ChevronRight, FileSignature, Loader2, User } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Workspace = "NORMAL" | "SALES";

interface WorkspaceOption {
  workspace: Workspace;
  label: string;
  description: string;
  status?: string;
  entryPath?: string;
}

const HOME_FOR: Record<Workspace, string> = {
  NORMAL: "/account",
  SALES: "/sales",
};

const REMEMBER_KEY = "nolsaf:account-workspace-choice";

export default function WorkspaceSelectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [name, setName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<Workspace | null>(null);
  const [error, setError] = useState<string>("");
  const [remember, setRemember] = useState(false);

  const go = useCallback(
    async (workspace: Workspace) => {
      setSelecting(workspace);
      setError("");
      try {
        await apiClient.post("/api/me/workspace/select", { workspace });
        const option = options.find((item) => item.workspace === workspace);
        if (remember && typeof window !== "undefined") {
          localStorage.setItem(REMEMBER_KEY, workspace);
        }
        router.replace(option?.entryPath || HOME_FOR[workspace]);
      } catch {
        setError("Could not open that workspace. Please try again.");
        setSelecting(null);
      }
    },
    [options, remember, router],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [workspacesRes, sessionRes] = await Promise.all([
          apiClient.get("/api/me/workspaces"),
          apiClient.get("/api/account/session").catch(() => null),
        ]);
        if (cancelled) return;

        const list: WorkspaceOption[] = workspacesRes.data?.workspaces || [];
        // /api/account/session responds { ok, data: { displayName, name, ... } }
        const session = sessionRes?.data?.data;
        setName(session?.displayName || session?.name || "");

        // Nothing to choose between: send them where they were always going.
        if (!workspacesRes.data?.requiresSelection || list.length <= 1) {
          const only = list[0];
          router.replace(only?.entryPath || HOME_FOR[only?.workspace || "NORMAL"]);
          return;
        }

        const forceChooser =
          typeof window !== "undefined" &&
          new URLSearchParams(window.location.search).get("switch") === "1";
        if (forceChooser && typeof window !== "undefined") {
          localStorage.removeItem(REMEMBER_KEY);
        }
        const remembered =
          !forceChooser && typeof window !== "undefined"
            ? localStorage.getItem(REMEMBER_KEY)
            : null;
        const rememberedOption = list.find(
          (item) => item.workspace === remembered,
        );
        if (rememberedOption) {
          await apiClient.post("/api/me/workspace/select", {
            workspace: rememberedOption.workspace,
          });
          router.replace(
            rememberedOption.entryPath || HOME_FOR[rememberedOption.workspace],
          );
          return;
        }
        setOptions(list);
      } catch {
        if (!cancelled) setError("Could not load your workspaces.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f4f5f7] text-neutral-400">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const sales = options.find((option) => option.workspace === "SALES");
  const normal = options.find((option) => option.workspace === "NORMAL");
  const salesPending = sales?.status === "PENDING";
  // "DANIEL WAPILI" and "daniel" both read "Daniel".
  const firstName = (name.trim().split(/\s+/)[0] || "").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

  // Each workspace keeps its own colour everywhere on the tile, so the two
  // choices are told apart at a glance: brand green for Sales, info blue for
  // the personal account (both from the house palette).
  const choices = [
    sales
      ? {
          key: "SALES" as const,
          title: "Sales workspace",
          subtitle: salesPending ? "Your agreement is ready to review." : "Your leads, properties and earnings.",
          points: salesPending ? ["Review agreement", "Updates"] : ["Leads", "Earnings", "Payouts"],
          Icon: salesPending ? FileSignature : BadgeDollarSign,
          badge: salesPending ? "Action needed" : "Active",
          theme: {
            card: "border-emerald-200 bg-gradient-to-b from-emerald-50 to-white hover:border-emerald-400 focus-visible:ring-emerald-200",
            icon: "bg-[#02665e] text-white shadow-[0_12px_24px_-12px_rgba(2,102,94,0.8)]",
            badge: salesPending ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
            point: "bg-white/80 text-emerald-800 ring-1 ring-inset ring-emerald-200",
            action: "bg-[#02665e] text-white group-hover:bg-[#014e47]",
          },
        }
      : null,
    normal
      ? {
          key: "NORMAL" as const,
          title: "Personal account",
          subtitle: "Your bookings, trips and profile.",
          points: ["Bookings", "Trips", "Profile"],
          Icon: User,
          badge: null,
          theme: {
            card: "border-blue-200 bg-gradient-to-b from-blue-50 to-white hover:border-blue-400 focus-visible:ring-blue-200",
            icon: "bg-[#022099] text-white shadow-[0_12px_24px_-12px_rgba(2,32,153,0.7)]",
            badge: "",
            point: "bg-white/80 text-[#022099] ring-1 ring-inset ring-blue-200",
            action: "bg-[#022099] text-white group-hover:bg-[#011a7a]",
          },
        }
      : null,
  ].filter(Boolean) as Array<{
    key: Workspace;
    title: string;
    subtitle: string;
    points: string[];
    Icon: typeof User;
    badge: string | null;
    theme: { card: string; icon: string; badge: string; point: string; action: string };
  }>;

  return (
    <div id="workspace-select" className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-7 text-center">
          <p className="m-0 text-sm font-medium text-emerald-700">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</p>
          <h1 className="m-0 mt-1.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-[28px]">Where would you like to go?</h1>
          <p className="m-0 mt-1.5 text-sm text-slate-500">You can switch between them at any time.</p>
        </div>

        {error ? (
          <p className="m-0 mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className={`grid gap-4 ${choices.length > 1 ? "sm:grid-cols-2" : ""}`}>
          {choices.map((choice) => {
            const busy = selecting === choice.key;
            return (
              <button
                key={choice.key}
                type="button"
                onClick={() => go(choice.key)}
                disabled={selecting !== null}
                className={`group flex min-h-[15rem] w-full flex-col rounded-3xl border-2 border-solid p-5 text-left shadow-[0_18px_40px_-30px_rgba(15,23,42,0.5)] transition duration-200 [font-family:inherit] hover:-translate-y-1 hover:shadow-[0_26px_50px_-30px_rgba(15,23,42,0.55)] focus:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 ${choice.theme.card}`}
              >
                <span className="flex items-start justify-between gap-3">
                  <span className={`grid h-14 w-14 place-items-center rounded-2xl ${choice.theme.icon}`}>
                    <choice.Icon className="h-6 w-6" aria-hidden />
                  </span>
                  {choice.badge ? (
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${choice.theme.badge}`}>{choice.badge}</span>
                  ) : null}
                </span>

                <span className="mt-5 block text-lg font-bold tracking-tight text-slate-900">{choice.title}</span>
                <span className="mt-1 block text-sm text-slate-600">{choice.subtitle}</span>

                <span className="mt-3 flex flex-wrap gap-1.5">
                  {choice.points.map((point) => (
                    <span key={point} className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${choice.theme.point}`}>{point}</span>
                  ))}
                </span>

                <span className="mt-auto block pt-5">
                  <span className={`inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold transition sm:w-auto ${choice.theme.action}`}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    {busy ? "Opening" : `Open ${choice.key === "SALES" ? "workspace" : "account"}`}
                    {busy ? null : <ChevronRight className="h-4 w-4 transition group-hover:translate-x-0.5" aria-hidden />}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <label className="mt-6 flex cursor-pointer items-center justify-center gap-2 text-sm text-slate-500">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-4 w-4 rounded border border-solid border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          Remember my choice on this device
        </label>
      </div>
    </div>
  );
}
