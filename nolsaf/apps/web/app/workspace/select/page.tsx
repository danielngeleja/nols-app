"use client";

// Workspace selector. Shown after login when an account holds more than one
// workspace. A single-workspace account never sees this page: it is redirected
// straight through, so nothing changes for ordinary users.
//
// See docs/SALES_PARTNER_WORKSPACE.md section 4.3.
import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BadgeDollarSign,
  Bell,
  ChevronRight,
  FileSignature,
  Loader2,
  Sparkles,
  TrendingUp,
  User,
} from "lucide-react";
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

  return (
    <div id="workspace-select" className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">
            <Sparkles className="h-3 w-3" />
            {name ? `Welcome back, ${name}` : "Welcome back"}
          </span>
          <h1 className="mb-0 mt-3 text-xl font-bold tracking-tight text-neutral-950">
            Where would you like to go?
          </h1>
          <p className="mb-0 mt-1.5 text-[13px] text-neutral-500">
            You are signed in with a Sales workspace and a personal account.
          </p>
        </div>

        {error ? (
          <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}

        {sales ? (
          <button
            type="button"
            onClick={() => go("SALES")}
            disabled={selecting !== null}
            className="mb-3 block w-full overflow-hidden rounded-2xl bg-[#07332d] text-left text-white shadow-[0_18px_40px_-24px_rgba(4,54,44,0.7)] transition hover:shadow-[0_20px_46px_-22px_rgba(4,54,44,0.85)] focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-60"
          >
            <span className="flex items-center gap-3 px-4 pb-3.5 pt-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-emerald-950">
                {salesPending ? <FileSignature className="h-5 w-5" /> : <BadgeDollarSign className="h-5 w-5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-bold">Sales workspace</span>
                <span className="mt-0.5 block text-xs text-emerald-100/80">
                  {salesPending ? "Agreement ready for review" : "Leads, properties and earnings"}
                </span>
              </span>
              <span className="inline-flex shrink-0 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[10px] font-bold text-emerald-200">
                {salesPending ? "PENDING" : "ACTIVE"}
              </span>
              {selecting === "SALES" ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-200" />
              ) : (
                <ChevronRight className="h-4 w-4 shrink-0 text-emerald-200" />
              )}
            </span>
            <span className="flex items-center gap-4 border-t border-white/10 px-4 py-2.5">
              {(salesPending
                ? [[FileSignature, "Review"], [Bell, "Updates"], [User, "Your account"]]
                : [[TrendingUp, "Leads"], [BadgeDollarSign, "Earnings"], [Bell, "Updates"]]
              ).map(([Icon, label]: any) => (
                <span key={label} className="inline-flex items-center gap-1.5 text-[11px] text-emerald-100/75">
                  <Icon className="h-3.5 w-3.5" />{label}
                </span>
              ))}
            </span>
          </button>
        ) : null}

        {normal ? (
          <button
            type="button"
            onClick={() => go("NORMAL")}
            disabled={selecting !== null}
            className="flex w-full items-center gap-3 rounded-2xl border border-neutral-200 bg-white px-4 py-3.5 text-left shadow-[0_10px_30px_-26px_rgba(15,23,42,0.5)] transition hover:border-neutral-300 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-neutral-600">
              <User className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold text-neutral-900">My personal account</span>
              <span className="mt-0.5 block text-xs text-neutral-400">Bookings, trips and your profile</span>
            </span>
            {selecting === "NORMAL" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neutral-400" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-neutral-300" />
            )}
          </button>
        ) : null}

        <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 text-[11.5px] text-neutral-500">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-3.5 w-3.5 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
          />
          Remember my choice on this device
        </label>
      </div>
    </div>
  );
}
