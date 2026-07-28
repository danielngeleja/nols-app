"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import apiClient from "@/lib/apiClient";

export interface SalesMe {
  partner: {
    id: number;
    agentCode: string;
    status: string;
    region: string | null;
    territory: string | null;
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
    activatedAt: string | null;
  };
  level: {
    level: string;
    benefits: { badge: string; summary: string };
    revenueGenerated: number;
    activeProperties: number;
    next: {
      level: string;
      badge: string;
      requiredRevenue: number;
      remainingRevenue: number;
      progress: number;
    } | null;
  };
  contract: {
    id: number;
    status: string;
    startsAt: string;
    expiresAt: string;
    daysRemaining: number;
    nrmsCommissionRate: number;
    marketplaceRevenueRate: number;
    isEarning: boolean;
  } | null;
}

type SalesWorkspaceState = {
  me: SalesMe | null;
  loading: boolean;
  denied: string;
};

const SalesWorkspaceContext = createContext<SalesWorkspaceState | null>(null);

export function SalesWorkspaceProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<SalesMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState("");

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const response = await apiClient.get("/api/sales/me");
        if (!cancelled) setMe(response.data);
      } catch (error: any) {
        if (cancelled) return;
        const status = error?.response?.status;
        setDenied(
          error?.response?.data?.error ||
            (status === 403
              ? "Your sales workspace is not active."
              : "Could not load your sales workspace."),
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(() => ({ me, loading, denied }), [me, loading, denied]);

  return (
    <SalesWorkspaceContext.Provider value={value}>
      {children}
    </SalesWorkspaceContext.Provider>
  );
}

export function useSalesWorkspace(): SalesWorkspaceState {
  const context = useContext(SalesWorkspaceContext);
  if (!context) {
    throw new Error("useSalesWorkspace must be used inside SalesWorkspaceProvider");
  }
  return context;
}
