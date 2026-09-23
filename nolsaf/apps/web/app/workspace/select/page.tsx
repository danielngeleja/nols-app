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
  const firstName = name.trim().split(/\s+/)[0] || "";

  const choices = [
    sales
      ? {
          key: "SALES" as const,
          title: "Sales workspace",
          subtitle: salesPending ? "Your agreement is ready to review" : "Leads, properties and earnings",
          Icon: salesPending ? FileSignature : BadgeDollarSign,
          iconTone: "bg-emerald-50 text-emerald-700",
          badge: salesPending
            ? { text: "Action needed", tone: "bg-amber-50 text-amber-700" }
            : { text: "Active", tone: "bg-emerald-50 text-emerald-700" },
        }
      : null,
    normal
      ? {
          key: "NORMAL" as const,
          title: "Personal account",
          subtitle: "Bookings, trips and your profile",
          Icon: User,
          iconTone: "bg-slate-100 text-slate-600",
          badge: null,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: Workspace;
    title: string;
    subtitle: string;
    Icon: typeof User;
    iconTone: string;
    badge: { text: string; tone: string } | null;
  }>;

  return (
    <div id="workspace-select" className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="m-0 text-sm font-medium text-emerald-700">{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</p>
          <h1 className="m-0 mt-1.5 text-2xl font-bold tracking-tight text-slate-900">Where would you like to go?</h1>
          <p className="m-0 mt-1.5 text-sm text-slate-500">You can switch between them at any time.</p>
        </div>

        {error ? (
          <p className="m-0 mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        <div className="space-y-3">
          {choices.map((choice) => {
            const busy = selecting === choice.key;
            return (
              <button
                key={choice.key}
                type="button"
                onClick={() => go(choice.key)}
                disabled={selecting !== null}
                className="group flex w-full items-center gap-4 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-4 text-left shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] transition [font-family:inherit] hover:border-emerald-300 hover:shadow-[0_14px_34px_-24px_rgba(8,127,104,0.45)] focus:outline-none focus-visible:border-emerald-400 focus-visible:ring-2 focus-visible:ring-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${choice.iconTone}`}>
                  <choice.Icon className="h-5 w-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-slate-900">{choice.title}</span>
                    {choice.badge ? (
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${choice.badge.tone}`}>{choice.badge.text}</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-sm text-slate-500">{choice.subtitle}</span>
                </span>
                {busy ? (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" aria-label="Opening" />
                ) : (
                  <ChevronRight className="h-5 w-5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" aria-hidden />
                )}
              </button>
            );
          })}
        </div>

        <label className="mt-5 flex cursor-pointer items-center justify-center gap-2 text-sm text-slate-500">
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
