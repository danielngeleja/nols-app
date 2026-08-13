"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowLeftRight, BadgeDollarSign, Loader2, Store } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Workspace = "NORMAL" | "SALES";

type WorkspaceOption = {
  workspace: Workspace;
  label: string;
  description: string;
  status?: string;
  entryPath?: string;
};

type WorkspaceSwitcherProps = {
  currentWorkspace: Workspace;
  variant?: "account-menu" | "menu-dark" | "sales-sidebar" | "mobile-dark" | "standalone";
  collapsed?: boolean;
  onSwitchStart?: (workspace: Workspace, destination: string) => void;
  onSwitchError?: () => void;
};

const LAST_ROUTE_KEY: Record<Workspace, string> = {
  NORMAL: "nolsaf:last-workspace-route:normal",
  SALES: "nolsaf:last-workspace-route:sales",
};

function isSafeWorkspaceRoute(workspace: Workspace, value: string | null): value is string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  if (workspace === "SALES") return value === "/sales" || value.startsWith("/sales/");
  return ["/account", "/owner", "/driver", "/admin"].some(
    (prefix) => value === prefix || value.startsWith(`${prefix}/`),
  );
}

function announceSwitchError(): void {
  try {
    window.dispatchEvent(new CustomEvent("nols:toast", {
      detail: {
        type: "error",
        title: "Workspace switch failed",
        message: "Your current workspace is unchanged. Please try again.",
        duration: 4500,
      },
    }));
  } catch {
    // The visible button returns to its idle state when toast events are unavailable.
  }
}

export default function WorkspaceSwitcher({
  currentWorkspace,
  variant = "account-menu",
  collapsed = false,
  onSwitchStart,
  onSwitchError,
}: WorkspaceSwitcherProps) {
  const pathname = usePathname();
  const [options, setOptions] = useState<WorkspaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient.get("/api/me/workspaces")
      .then((response) => {
        if (!cancelled) setOptions(Array.isArray(response.data?.workspaces) ? response.data.workspaces : []);
      })
      .catch(() => {
        if (!cancelled) setOptions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!pathname || !isSafeWorkspaceRoute(currentWorkspace, pathname)) return;
    try {
      localStorage.setItem(LAST_ROUTE_KEY[currentWorkspace], pathname);
    } catch {
      // Route memory is optional. The server supplied entry path remains authoritative.
    }
  }, [currentWorkspace, pathname]);

  const target = useMemo(
    () => options.find((option) => option.workspace !== currentWorkspace) || null,
    [currentWorkspace, options],
  );

  const switchWorkspace = useCallback(async () => {
    if (!target || switching) return;
    const fallback = target.entryPath || (target.workspace === "SALES" ? "/sales" : "/account");
    let destination = fallback;
    try {
      const remembered = localStorage.getItem(LAST_ROUTE_KEY[target.workspace]);
      if (String(target.status || "ACTIVE").toUpperCase() === "ACTIVE" && isSafeWorkspaceRoute(target.workspace, remembered)) {
        destination = remembered;
      }
    } catch {
      // Use the entitlement-aware entry path supplied by the API.
    }

    setSwitching(true);
    onSwitchStart?.(target.workspace, destination);
    try {
      await apiClient.post("/api/me/workspace/select", { workspace: target.workspace });
      window.location.assign(destination);
    } catch {
      setSwitching(false);
      onSwitchError?.();
      announceSwitchError();
    }
  }, [onSwitchError, onSwitchStart, switching, target]);

  if (loading || !target) return null;

  const targetIsSales = target.workspace === "SALES";
  const targetIsPending = String(target.status || "ACTIVE").toUpperCase() === "PENDING";
  const Icon = targetIsSales ? BadgeDollarSign : Store;
  const label = targetIsSales
    ? targetIsPending
      ? "Review Sales agreement"
      : "Open Sales workspace"
    : "NoLSAF Dashboard";
  const compactLabel = targetIsSales
    ? targetIsPending
      ? "Sales agreement"
      : "Sales workspace"
    : "NoLSAF Dashboard";

  if (variant === "sales-sidebar") {
    return (
      <button
        type="button"
        onClick={switchWorkspace}
        disabled={switching}
        title={collapsed ? label : undefined}
        className={`flex min-h-9 w-full items-center rounded-lg border border-amber-200/10 bg-amber-100/[0.04] text-[12px] font-semibold text-amber-100 transition hover:border-amber-200/20 hover:bg-amber-300/10 hover:text-amber-50 disabled:opacity-60 ${
          collapsed ? "justify-center" : "gap-2.5 px-2.5"
        }`}
      >
        {switching ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />}
        {!collapsed ? label : null}
      </button>
    );
  }

  if (variant === "mobile-dark") {
    return (
      <div className="mt-1.5 border-t border-white/[0.07] px-1 pt-2">
        <button
          type="button"
          onClick={switchWorkspace}
          disabled={switching}
          className="flex w-full items-center gap-2.5 rounded-2xl border-0 bg-emerald-400/10 px-3 py-2.5 text-left text-[13px] font-semibold text-emerald-100 transition hover:bg-emerald-400/15 disabled:opacity-60"
        >
          {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4 text-emerald-300" />}
          <span className="flex-1">{label}</span>
          <ArrowLeftRight className="h-3.5 w-3.5 text-emerald-200/60" />
        </button>
      </div>
    );
  }

  if (variant === "menu-dark") {
    return (
      <button
        type="button"
        onClick={switchWorkspace}
        disabled={switching}
        className="group flex w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left text-sm font-medium text-emerald-200 transition hover:bg-emerald-400/10 hover:text-emerald-100 disabled:opacity-60"
      >
        {switching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Icon className="h-4 w-4 shrink-0 text-emerald-300" />}
        <span className="min-w-0 flex-1 truncate">{compactLabel}</span>
        <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-emerald-300/60 transition group-hover:rotate-180" />
      </button>
    );
  }

  if (variant === "standalone") {
    return (
      <button
        type="button"
        onClick={switchWorkspace}
        disabled={switching}
        className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#02665e] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#02554f] disabled:opacity-60"
      >
        {switching ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowLeftRight className="h-4 w-4" />}
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={switchWorkspace}
      disabled={switching}
      className="group flex w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-800 disabled:opacity-60"
    >
      {switching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin" /> : <Icon className="h-4 w-4 shrink-0 text-emerald-700" />}
      <span className="min-w-0 flex-1 truncate">{compactLabel}</span>
      <ArrowLeftRight className="h-3.5 w-3.5 shrink-0 text-emerald-600/60 transition group-hover:rotate-180" />
    </button>
  );
}
