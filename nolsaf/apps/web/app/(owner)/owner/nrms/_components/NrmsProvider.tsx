"use client";

// Shared NRMS context: enrollment status, workspace mode, and the selected
// property. Entitlement is enforced by the backend (requireNrms); this
// provider only decides which screen to show.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import apiClient from "@/lib/apiClient";

export type NrmsProperty = {
  id: number;
  title: string;
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "SUSPENDED";
  currency: string | null;
  nrmsActivatedAt: string | null;
  nrmsQrOrderingFrozenAt?: string | null;
  nrmsAccessRole?: "OWNER" | "MANAGER" | "FRONT_DESK" | "RESTAURANT" | "BAR" | "OUTLET_SUPERVISOR";
  nrmsOutletId?: number | null;
  nrmsPaygAccount?: { status: string; trialStartsAt: string; trialEndsAt: string; unpaidBalance: string | number; unpaidLimit: string | number } | null;
  restriction?: { referenceCode: string; reason?: string | null } | null;
  qrRestriction?: { referenceCode: string; reason?: string | null } | null;
};

export type NrmsEnrollment = {
  status: string;
  trialStartsAt: string | null;
  trialEndsAt: string | null;
  activatedAt: string | null;
  plan: { code: string; name: string; config: Record<string, unknown> | null };
} | null;

export type NrmsUsagePolicy = { currency: string; roomNightPrice: string | number; trialDays: number } | null;

// The API's global error handler (apps/api/src/middleware/errorHandler.ts) is
// the single source of truth for what an error message should say: it relays
// deliberate messages verbatim and substitutes a safe generic one for
// unexpected 5xx failures. This function should NOT re-derive its own
// wording — it only fills the one gap the backend cannot cover: no response
// ever arrived at all (connection refused, timeout, DNS failure, or a proxy
// in front of the API failing before reaching it), which reads as the
// server or its database being unreachable.
function describeNrmsLoadError(e: any): string {
  if (!e?.response) {
    return "Could not reach the NoLSAF server. This usually means the server or its database is temporarily unreachable, not just NRMS.";
  }
  const serverMessage = e.response.data?.error;
  if (typeof serverMessage === "string" && serverMessage.trim()) return serverMessage;
  const status = e.response.status;
  return status
    ? `The server responded with an error (status ${status}).`
    : "The server returned an unexpected response.";
}

type NrmsStatus = {
  loading: boolean;
  error: string | null;
  entitled: boolean;
  workspaceMode: "MARKETPLACE_ONLY" | "MARKETPLACE_NRMS";
  enrollment: NrmsEnrollment;
  usagePolicy: NrmsUsagePolicy;
  restriction: { referenceCode: string; reason?: string | null } | null;
  properties: NrmsProperty[];
  selectedPropertyId: number | null;
  selectedProperty: NrmsProperty | null;
  setSelectedPropertyId: (id: number) => void;
  refresh: () => Promise<void>;
  activate: () => Promise<{ ok: boolean; message?: string }>;
  activateProperty: (propertyId: number) => Promise<{ ok: boolean; message?: string }>;
};

const NrmsContext = createContext<NrmsStatus | null>(null);

const SELECTED_KEY = "nolsaf:nrms:property";

export function NrmsProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entitled, setEntitled] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"MARKETPLACE_ONLY" | "MARKETPLACE_NRMS">("MARKETPLACE_ONLY");
  const [enrollment, setEnrollment] = useState<NrmsEnrollment>(null);
  const [usagePolicy, setUsagePolicy] = useState<NrmsUsagePolicy>(null);
  const [restriction, setRestriction] = useState<{ referenceCode: string; reason?: string | null } | null>(null);
  const [properties, setProperties] = useState<NrmsProperty[]>([]);
  const [selectedPropertyId, setSelectedPropertyIdState] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      let r;
      try {
        r = await apiClient.get<any>("/api/owner/nrms");
      } catch (ownerError: any) {
        if (![401, 403].includes(Number(ownerError?.response?.status))) throw ownerError;
        r = await apiClient.get<any>("/api/nrms/operations/me");
      }
      const data = r.data || {};
      setEntitled(Boolean(data.entitled));
      setWorkspaceMode(data.workspaceMode === "MARKETPLACE_NRMS" ? "MARKETPLACE_NRMS" : "MARKETPLACE_ONLY");
      setEnrollment(data.enrollment ?? null);
      setUsagePolicy(data.usagePolicy ?? null);
      setRestriction(data.restriction ?? null);
      const props: NrmsProperty[] = Array.isArray(data.properties)
        ? data.properties.map((property: NrmsProperty) => ({ ...property, nrmsAccessRole: property.nrmsAccessRole ?? "OWNER" }))
        : [];
      setProperties(props);
      setSelectedPropertyIdState((current) => {
        if (current && props.some((p) => p.id === current)) return current;
        let stored: number | null = null;
        try {
          stored = Number(localStorage.getItem(SELECTED_KEY)) || null;
        } catch {
          stored = null;
        }
        if (stored && props.some((p) => p.id === stored)) return stored;
        const activated = props.find((p) => p.nrmsActivatedAt);
        return activated?.id ?? props[0]?.id ?? null;
      });
    } catch (e: any) {
      setError(describeNrmsLoadError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const setSelectedPropertyId = useCallback((id: number) => {
    setSelectedPropertyIdState(id);
    try {
      localStorage.setItem(SELECTED_KEY, String(id));
    } catch {
      // storage may be unavailable
    }
  }, []);

  const activate = useCallback(async () => {
    try {
      await apiClient.post("/api/owner/nrms/activate", {});
      await refresh();
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.response?.data?.error || "Activation failed" };
    }
  }, [refresh]);

  const activateProperty = useCallback(
    async (propertyId: number) => {
      try {
        await apiClient.post(`/api/owner/nrms/properties/${propertyId}/activate`, {});
        await refresh();
        return { ok: true };
      } catch (e: any) {
        return { ok: false, message: e?.response?.data?.error || "Property activation failed" };
      }
    },
    [refresh],
  );

  const selectedProperty = useMemo(
    () => properties.find((p) => p.id === selectedPropertyId) ?? null,
    [properties, selectedPropertyId],
  );

  const value: NrmsStatus = {
    loading,
    error,
    entitled,
    workspaceMode,
    enrollment,
    usagePolicy,
    restriction,
    properties,
    selectedPropertyId,
    selectedProperty,
    setSelectedPropertyId,
    refresh,
    activate,
    activateProperty,
  };

  return <NrmsContext.Provider value={value}>{children}</NrmsContext.Provider>;
}

export function useNrms(): NrmsStatus {
  const ctx = useContext(NrmsContext);
  if (!ctx) throw new Error("useNrms must be used inside NrmsProvider");
  return ctx;
}

export function trialDaysLeft(enrollment: NrmsEnrollment): number | null {
  if (!enrollment || enrollment.status !== "TRIAL" || !enrollment.trialEndsAt) return null;
  const ms = new Date(enrollment.trialEndsAt).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / (24 * 60 * 60 * 1000)) : 0;
}

export function propertyTrialDaysLeft(property: NrmsProperty | null): number | null {
  if (!property?.nrmsPaygAccount || property.nrmsPaygAccount.status !== "TRIAL") return null;
  const ms = new Date(property.nrmsPaygAccount.trialEndsAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
