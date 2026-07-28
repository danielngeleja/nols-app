"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, ArrowLeft, BedDouble, Building2, CalendarClock, CheckCircle2, ClipboardList, Loader2, MapPin, QrCode, Search, ShieldAlert, Store, UsersRound, WalletCards } from "lucide-react";
import { CountPill, EmptyState, SectionHeader } from "../_components/CommercialUi";

type Detail = {
  property: {
    id: number; title: string; status: string; regionName: string | null; nrmsActivatedAt: string | null;
    qrOrderingFrozenAt: string | null;
    housekeepingDailyServiceEnabled: boolean; housekeepingDailyServiceTime: string;
    guestPayInstructions: Array<{ label: string; value: string; name: string | null }>;
    owner: { id: number; fullName: string | null; name: string | null; email: string | null; phone: string | null };
  };
  enrollment: { id: number; status: string; suspendedAt: string | null } | null;
  restrictionCases: Array<{ referenceCode: string; scope: string; reason: string; appliedAt: string; notificationEmailSentAt: string | null; notificationEmailError: string | null }>;
  account: { id: number; status: string; freezePreviousStatus: string | null; frozenAt: string | null; frozenReason: string | null; trialStartsAt: string; trialEndsAt: string; unpaidBalance: number; unpaidLimit: number; policy: { version: string; roomNightPrice: number; currency: string } | null } | null;
  staff: Array<{ membershipId: number; role: string; status: string; confirmedAt: string | null; outlet: { name: string; type: string } | null; user: { id: number; name: string; email: string | null } }>;
  outlets: Array<{ id: number; name: string; code: string; type: string; status: string; currency: string; autoAcceptQrOrders: boolean; activeMenuItems: number; totalOrders: number }>;
  orderPoints: Array<{ id: number; type: string; label: string; active: boolean; updatedAt: string; roomUnit: { code: string; floor: number | null } | null }>;
  housekeeping: Array<{ status: string; count: number }>;
  orders30d: { byStatus: Array<{ status: string; count: number }>; completedCount: number; completedTotal: number; qrCount: number };
  nightAudits: Array<{ id: number; status: string; reportNumber: string; startedAt: string; completedAt: string | null; businessDay: { businessDate: string } }>;
  cashierShifts: Array<{ id: number; businessDate: string; status: string; currency: string; expectedCash: number; declaredCash: number | null; variance: number | null; operator: string }>;
  openBusinessDay: { businessDate: string; openedAt: string } | null;
};

const HK_BADGE: Record<string, string> = {
  CLEAN: "border-emerald-100 bg-emerald-50 text-emerald-700",
  INSPECTED: "border-teal-100 bg-teal-50 text-teal-700",
  DIRTY: "border-red-100 bg-red-50 text-red-700",
  IN_PROGRESS: "border-amber-100 bg-amber-50 text-amber-700",
};

const ACCOUNT_BADGE: Record<string, string> = {
  TRIAL: "border-sky-100 bg-sky-50 text-sky-700",
  ACTIVE: "border-emerald-100 bg-emerald-50 text-emerald-700",
  WARNING: "border-amber-100 bg-amber-50 text-amber-700",
  PAYMENT_REQUIRED: "border-red-100 bg-red-50 text-red-700",
  PAYMENT_PENDING: "border-violet-100 bg-violet-50 text-violet-700",
  FROZEN: "border-orange-100 bg-orange-50 text-orange-700",
  CLOSED: "border-neutral-200 bg-neutral-100 text-neutral-500",
};

function shortDate(value: string | null | undefined): string {
  if (!value) return "Never";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

function agreementDate(value: string | null | undefined): string {
  if (!value) return "Awaiting confirmation";
  return new Date(value).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type OrderPoint = Detail["orderPoints"][number];

function parseOrderPointLabel(label: string): { category: string; order: number } {
  const match = label.match(/^(.*?)[\s-]+(\d+)$/);
  if (!match) return { category: label, order: Number.MAX_SAFE_INTEGER };
  return { category: match[1], order: Number(match[2]) };
}

function floorLabel(floor: number | null): string {
  if (floor == null) return "Floor not set";
  if (floor === 0) return "Ground floor";
  return `Floor ${floor}`;
}

function groupOrderPoints(points: OrderPoint[], query: string) {
  const q = query.trim().toLowerCase();
  const matches = q ? points.filter((p) => p.label.toLowerCase().includes(q)) : points;
  const groups = new Map<string, { key: string; label: string; isRoom: boolean; order: number; points: (OrderPoint & { category: string; order: number })[] }>();
  for (const p of matches) {
    const { category, order } = parseOrderPointLabel(p.label);
    const isRoom = p.type === "ROOM";
    const floor = isRoom ? p.roomUnit?.floor ?? null : null;
    const key = isRoom ? `floor:${floor ?? "none"}` : "tables";
    const label = isRoom ? floorLabel(floor) : "Tables";
    const groupOrder = isRoom ? (floor == null ? Number.MAX_SAFE_INTEGER - 1 : floor) : Number.MAX_SAFE_INTEGER;
    if (!groups.has(key)) groups.set(key, { key, label, isRoom, order: groupOrder, points: [] });
    groups.get(key)!.points.push({ ...p, category, order });
  }
  for (const g of groups.values()) g.points.sort((a, b) => a.category.localeCompare(b.category) || a.order - b.order || a.label.localeCompare(b.label));
  return [...groups.values()].sort((a, b) => a.order - b.order);
}

const enforceButtonBase = "inline-flex min-h-9 items-center rounded-lg border px-3.5 text-xs font-bold transition";

export default function AdminNrmsPropertyPage() {
  const params = useParams();
  const propertyId = Number(params?.propertyId);
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [qrQuery, setQrQuery] = useState("");

  const [enforce, setEnforce] = useState<{ endpoint: string; title: string; warning: string; danger?: boolean } | null>(null);
  const [reason, setReason] = useState("");
  const [enforcing, setEnforcing] = useState(false);
  const [enforceError, setEnforceError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!Number.isInteger(propertyId) || propertyId <= 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get(`/api/admin/nrms/property/${propertyId}`);
      setData(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to load property oversight");
    } finally {
      setLoading(false);
    }
  }, [propertyId]);
  useEffect(() => { void load(); }, [load]);

  const openEnforce = (endpoint: string, title: string, warning: string, danger = false) => {
    setEnforce({ endpoint, title, warning, danger });
    setReason("");
    setEnforceError(null);
  };

  const runEnforce = async () => {
    if (!enforce || enforcing || reason.trim().length < 5) return;
    setEnforcing(true);
    setEnforceError(null);
    try {
      const response = await apiClient.post(enforce.endpoint, { reason: reason.trim() });
      const referenceCode = response.data?.referenceCode;
      const emailSent = response.data?.emailDelivery?.sent;
      setNotice(
        `${enforce.title}: done.${referenceCode ? ` Reference ${referenceCode}.` : ""} ` +
        (emailSent === false
          ? "The in-app notice was saved, but the email could not be delivered; the failure is recorded for follow-up."
          : "The owner email and in-app notice were sent, and the action is on the audit log."),
      );
      setEnforce(null);
      await load();
    } catch (cause: any) {
      const payload = cause?.response?.data;
      setEnforceError(
        payload?.require2fa
          ? "This action needs the finance OTP grant. Complete admin OTP verification (Finance area), then retry."
          : payload?.error || "The action failed",
      );
    } finally {
      setEnforcing(false);
    }
  };

  if (loading) return <div className="flex min-h-[40vh] items-center justify-center text-neutral-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3.5 text-sm font-medium text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {error || "Property not found"}</div>
        <Link href="/admin/nrms" className="mt-4 inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> Back to directory</Link>
      </div>
    );
  }

  const owner = data.property.owner;
  const currency = data.account?.policy?.currency ?? "TZS";
  const restrictions = [
    data.enrollment?.status === "SUSPENDED" && { label: "Owner NRMS suspended", tone: "border-red-100 bg-red-50 text-red-700" },
    data.account?.status === "FROZEN" && { label: "Property temporarily frozen", tone: "border-orange-100 bg-orange-50 text-orange-700" },
    data.account?.status === "CLOSED" && { label: "Property permanently closed", tone: "border-red-100 bg-red-50 text-red-700" },
    data.property.qrOrderingFrozenAt && { label: "Guest QR ordering frozen", tone: "border-amber-100 bg-amber-50 text-amber-700" },
  ].filter(Boolean) as { label: string; tone: string }[];
  const qrGroups = groupOrderPoints(data.orderPoints, qrQuery);
  const qrActiveCount = data.orderPoints.filter((p) => p.active).length;

  return (
    <div id="nrms-property-detail" className="mx-auto min-w-0 max-w-7xl space-y-5 px-4 py-6">
      {/* Preflight is disabled in this project; without border-box, w-full controls (e.g. the enforcement textarea) overflow their container */}
      <style>{`#nrms-property-detail, #nrms-property-detail * { box-sizing: border-box; }`}</style>
      <Link href="/admin/nrms" className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 no-underline transition hover:text-emerald-900"><ArrowLeft className="h-3.5 w-3.5" /> NRMS directory</Link>

      <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-5 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 h-48 w-48 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
        <div className="pointer-events-none absolute right-8 top-2 text-6xl font-black tracking-tighter text-emerald-950/[0.025] sm:text-7xl" aria-hidden="true">NRMS</div>
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-700 shadow-sm"><Building2 className="h-5 w-5" /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Property oversight</p>
                {data.account && <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold ${ACCOUNT_BADGE[data.account.status] ?? "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{data.account.status.replaceAll("_", " ")}</span>}
              </div>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-neutral-950 sm:text-2xl">{data.property.title}</h1>
              <p className="mb-0 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-neutral-500">
                <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5 text-neutral-400" /> {data.property.regionName ?? "Region unknown"}</span>
                <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5 text-neutral-400" /> Activated {shortDate(data.property.nrmsActivatedAt)}</span>
                <span>Owner: {owner.fullName || owner.name || `#${owner.id}`} ({owner.email ?? owner.phone ?? "no contact"})</span>
              </p>
              {restrictions.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {restrictions.map((r) => <span key={r.label} className={`rounded-full border px-2.5 py-0.5 text-[10px] font-bold ${r.tone}`}>{r.label}</span>)}
                </div>
              )}
              {(data.restrictionCases?.length ?? 0) > 0 && (
                <div className="mt-3 space-y-1.5">
                  {data.restrictionCases.map((restriction) => (
                    <div key={restriction.referenceCode} className="rounded-lg border border-orange-200 bg-orange-50/80 px-3 py-2 text-xs text-orange-950">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono font-bold">{restriction.referenceCode}</span>
                        <span className={`font-bold ${restriction.notificationEmailSentAt ? "text-emerald-700" : "text-red-700"}`}>
                          {restriction.notificationEmailSentAt ? "Email sent" : "Email needs follow-up"}
                        </span>
                      </div>
                      <p className="mb-0 mt-1 leading-5">{restriction.reason}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          {data.account && (
            <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3.5 py-2.5 shadow-sm">
              <WalletCards className="h-4 w-4 text-emerald-700" />
              <div>
                <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Balance</p>
                <p className="m-0 text-sm font-bold tabular-nums text-neutral-900">{currency} {data.account.unpaidBalance.toLocaleString()} <span className="font-medium text-neutral-400">/ {data.account.unpaidLimit.toLocaleString()}</span></p>
                {data.account.policy && <p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Policy {data.account.policy.version} · {currency} {data.account.policy.roomNightPrice.toLocaleString()} / room-night</p>}
              </div>
            </div>
          )}
        </div>
        {data.openBusinessDay && <p className="mb-0 mt-3.5 inline-flex items-center gap-1.5 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 text-[11px] font-medium text-emerald-800 shadow-sm">Business day open: {shortDate(data.openBusinessDay.businessDate)}</p>}
      </section>

      {notice && (
        <div className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm font-medium text-emerald-800" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="ml-auto shrink-0 rounded-md border-0 bg-transparent p-0 text-xs font-bold text-emerald-600 transition hover:text-emerald-900">Dismiss</button>
        </div>
      )}

      <section className="min-w-0 overflow-hidden rounded-2xl border border-red-100 bg-white shadow-[0_12px_35px_-32px_rgba(220,38,38,0.35)]">
        <SectionHeader icon={ShieldAlert} tone="red" title="Enforcement" subtitle="Every action requires a reason, is written to the audit log, and notifies the owner." />
        <div className="p-4 sm:p-5">
          <p className="m-0 text-[11px] text-neutral-400">Suspend and freeze also require the finance OTP grant.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {data.enrollment && (data.enrollment.status === "SUSPENDED" ? (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/enrollment/${owner.id}/restore`, "Restore owner NRMS", "Restores the whole NRMS workspace for this owner and all their staff.")} className={`${enforceButtonBase} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>Restore owner NRMS</button>
            ) : (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/enrollment/${owner.id}/suspend`, "Suspend owner NRMS", "Blocks the entire NRMS workspace for this owner, every property and every staff member. Marketplace is unaffected.", true)} className={`${enforceButtonBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>Suspend owner NRMS</button>
            ))}
            {data.account && (data.account.status === "FROZEN" ? (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/unfreeze`, "Unfreeze property", "Reopens NRMS operations for this property.")} className={`${enforceButtonBase} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>Unfreeze property</button>
            ) : data.account.status === "CLOSED" ? null : (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/freeze`, "Freeze property", "Blocks NRMS operations for this property only. Other properties of the owner keep working.", true)} className={`${enforceButtonBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>Freeze property</button>
            ))}
            {data.account?.status === "FROZEN" && <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/close`, "Permanently close property", "This is irreversible operational closure and makes the property eligible for retention scheduling.", true)} className={`${enforceButtonBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>Permanently close</button>}
            {data.property.qrOrderingFrozenAt ? (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/qr-ordering/unfreeze`, "Resume guest QR ordering", "Guests can scan and order again.")} className={`${enforceButtonBase} border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>Resume QR ordering</button>
            ) : (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/qr-ordering/freeze`, "Freeze guest QR ordering", "The public menu and ordering pages stop working for this property. Staff ordering continues.")} className={`${enforceButtonBase} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>Freeze QR ordering</button>
            )}
            {data.orderPoints.some((p) => p.active) && (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/order-points/deactivate-all`, "Deactivate all QR points", "Every printed QR code stops scanning immediately.", true)} className={`${enforceButtonBase} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>Deactivate all QR points</button>
            )}
            {data.orderPoints.length > 0 && (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/order-points/rotate-all`, "Rotate all QR tokens", "All existing printed codes become invalid; fresh codes must be printed.", true)} className={`${enforceButtonBase} border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}>Rotate all QR tokens</button>
            )}
            {data.staff.some((m) => m.status === "PENDING") && (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/invites/invalidate`, "Invalidate pending invites", "Outstanding staff invites for this property stop working.")} className={`${enforceButtonBase} border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50`}>Invalidate pending invites</button>
            )}
            {data.property.guestPayInstructions.length > 0 && (
              <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/property/${data.property.id}/pay-instructions/clear`, "Clear guest payment details", "The payment details are removed from the guest page pending owner correction. Use when the details look fraudulent.", true)} className={`${enforceButtonBase} border-red-200 bg-red-50 text-red-700 hover:bg-red-100`}>Clear payment details</button>
            )}
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={ClipboardList} title="Orders, last 30 days" subtitle="Completed and QR-originated orders" />
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap gap-1.5">
              {data.orders30d.byStatus.map((row) => (
                <span key={row.status} className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-[10px] font-bold text-neutral-600">{row.status.replaceAll("_", " ")}: {row.count}</span>
              ))}
              {data.orders30d.byStatus.length === 0 && <span className="text-xs text-neutral-400">No orders in the last 30 days.</span>}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="rounded-lg bg-neutral-50 p-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Completed</p><p className="mb-0 mt-0.5 text-base font-black tabular-nums text-neutral-950">{data.orders30d.completedCount}</p></div>
              <div className="rounded-lg bg-neutral-50 p-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Revenue</p><p className="mb-0 mt-0.5 text-base font-black tabular-nums text-neutral-950">{currency} {data.orders30d.completedTotal.toLocaleString()}</p></div>
              <div className="rounded-lg bg-neutral-50 p-3"><p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">Via QR</p><p className="mb-0 mt-0.5 text-base font-black tabular-nums text-neutral-950">{data.orders30d.qrCount}</p></div>
            </div>
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={BedDouble} title="Housekeeping" subtitle="Room status across the property" />
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap gap-1.5">
              {data.housekeeping.map((row) => (
                <span key={row.status} className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${HK_BADGE[row.status] ?? "border-neutral-200 bg-neutral-50 text-neutral-500"}`}>{row.status.replaceAll("_", " ")}: {row.count}</span>
              ))}
              {data.housekeeping.length === 0 && <span className="text-xs text-neutral-400">No active rooms.</span>}
            </div>
            <p className="mb-0 mt-4 text-[11px] text-neutral-400">Daily occupied-room service: {data.property.housekeepingDailyServiceEnabled ? `on, at ${data.property.housekeepingDailyServiceTime}` : "off"}</p>
          </div>
        </section>
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={UsersRound} title="Staff" subtitle="Everyone assigned to this property" right={<CountPill count={data.staff.length} singular="member" plural="members" />} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] border-collapse text-left">
            <thead><tr className="border-b border-neutral-100 text-[10px] font-bold uppercase tracking-wide text-neutral-400"><th className="px-4 py-2.5 sm:px-5">Name</th><th className="px-4 py-2.5">Email</th><th className="px-4 py-2.5">Role</th><th className="px-4 py-2.5">Outlet</th><th className="px-4 py-2.5">Status</th><th className="px-4 py-2.5">Agreed at</th><th className="px-4 py-2.5 sm:px-5" /></tr></thead>
            <tbody>
              {data.staff.map((m) => (
                <tr key={m.membershipId} className="border-b border-neutral-50 text-xs transition last:border-0 hover:bg-neutral-50/60">
                  <td className="px-4 py-3 font-bold text-neutral-800 sm:px-5">{m.user.name}</td>
                  <td className="px-4 py-3 text-neutral-500">{m.user.email ?? "n/a"}</td>
                  <td className="px-4 py-3 text-neutral-600">{m.role.replaceAll("_", " ")}</td>
                  <td className="px-4 py-3 text-neutral-500">{m.outlet ? m.outlet.name : "All areas"}</td>
                  <td className="px-4 py-3"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${m.status === "ACTIVE" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : m.status === "PENDING" ? "border-amber-100 bg-amber-50 text-amber-700" : "border-neutral-200 bg-neutral-100 text-neutral-400"}`}>{m.status}</span></td>
                  <td className={`px-4 py-3 text-[10px] ${m.confirmedAt ? "font-semibold text-neutral-600" : "text-amber-600"}`}>{agreementDate(m.confirmedAt)}</td>
                  <td className="px-4 py-3 text-right sm:px-5">
                    {["ACTIVE", "PENDING"].includes(m.status) && (
                      <button type="button" onClick={() => openEnforce(`/api/admin/nrms/enforce/staff/${m.user.id}/disable`, `Disable ${m.user.name} globally`, "Disables this person across every NRMS property they work at and signs them out everywhere.", true)} className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-[10px] font-bold text-red-600 transition hover:bg-red-50">Disable globally</button>
                    )}
                  </td>
                </tr>
              ))}
              {data.staff.length === 0 && <tr><td colSpan={7}><EmptyState icon={UsersRound} title="No staff assigned" text="Staff appear here once the owner invites members to this property." /></td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={Store} title="Outlets" subtitle="Ordering points inside the property" right={<CountPill count={data.outlets.length} singular="outlet" plural="outlets" />} />
        <div className="divide-y divide-neutral-50">
          {data.outlets.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-neutral-50/60 sm:px-5">
              <div className="min-w-0"><p className="m-0 truncate font-bold text-neutral-800">{o.name}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{o.type.toLowerCase()} · {o.activeMenuItems} items · {o.totalOrders} orders all time</p></div>
              <div className="flex shrink-0 items-center gap-1.5">
                {o.autoAcceptQrOrders && <span className="rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[9px] font-bold text-violet-700">QR auto-accept</span>}
                <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${o.status === "ACTIVE" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-100 text-neutral-400"}`}>{o.status}</span>
              </div>
            </div>
          ))}
          {data.outlets.length === 0 && <EmptyState icon={Store} title="No outlets" text="Outlets appear here once the owner sets up ordering points." />}
        </div>
      </section>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader
          icon={QrCode}
          title="QR order points"
          subtitle="Printed room and table codes"
          right={
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">{qrActiveCount} active</span>
              <CountPill count={data.orderPoints.length} singular="point" plural="points" />
            </div>
          }
        />
        <div className="border-b border-neutral-100 px-4 py-3 sm:px-5">
          <div className="relative max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" aria-hidden="true" />
            <input value={qrQuery} onChange={(e) => setQrQuery(e.target.value)} placeholder="Search room or table" className="block min-h-9 w-full min-w-0 rounded-lg border border-neutral-200 bg-white py-1.5 pl-9 pr-3 text-xs text-neutral-900 outline-none transition placeholder:text-neutral-400 hover:border-neutral-300 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" aria-label="Search QR order points" />
          </div>
        </div>
        <div className="p-3 sm:p-4">
          {qrGroups.length === 0 && (
            data.orderPoints.length === 0
              ? <EmptyState icon={QrCode} title="No QR points generated" text="Room and table codes appear here once the owner prints them." />
              : <EmptyState icon={Search} title="No matches" text="No QR points match this search." />
          )}
          <div className="space-y-6">
            {qrGroups.map((group) => {
              const activeInGroup = group.points.filter((p) => p.active).length;
              const inactiveInGroup = group.points.length - activeInGroup;
              return (
                <section key={group.key} className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_4px_18px_rgba(15,23,42,0.06)] ring-1 ring-neutral-950/[0.02]">
                  <header className="relative flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-neutral-200 bg-gradient-to-r from-white via-white to-emerald-50/50 px-4 py-4 sm:px-5">
                    <span className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-emerald-600" aria-hidden="true" />
                    <h4 className="m-0 flex items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-emerald-50 text-emerald-700 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)]">{group.isRoom ? <Building2 className="h-[18px] w-[18px]" /> : <Store className="h-[18px] w-[18px]" />}</span>
                      <span>
                        <span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-700">{group.isRoom ? "Floor zone" : "Table zone"}</span>
                        <span className="mt-0.5 block text-base font-bold tracking-tight text-neutral-950">{group.label}</span>
                      </span>
                    </h4>
                    <span className="rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-bold text-neutral-500 shadow-sm">{group.points.length} {group.points.length === 1 ? "point" : "points"}</span>
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-bold text-neutral-600 shadow-sm"><span className="h-1.5 w-1.5 rounded-full ring-2 ring-white bg-emerald-500" />{activeInGroup} active</span>
                      {inactiveInGroup > 0 && <span className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2.5 py-1 text-[10px] font-bold text-neutral-600 shadow-sm"><span className="h-1.5 w-1.5 rounded-full ring-2 ring-white bg-neutral-300" />{inactiveInGroup} inactive</span>}
                    </span>
                  </header>
                  <div className="p-3 sm:p-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                      {group.points.map((p) => (
                        <article key={p.id} className={`overflow-hidden rounded-2xl border border-l-4 border-neutral-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition hover:border-neutral-300 hover:shadow-md ${p.active ? "border-l-emerald-400" : "border-l-neutral-300"}`}>
                          <div className="p-3.5">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="m-0 truncate text-sm font-bold tracking-tight text-neutral-950">{p.label}</p>
                                <p className="mb-0 mt-0.5 truncate text-[10px] font-medium uppercase tracking-wide text-neutral-400">{p.category}</p>
                              </div>
                              <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${p.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-100 text-neutral-500"}`}><span className={`h-1.5 w-1.5 rounded-full ${p.active ? "bg-emerald-500" : "bg-neutral-400"}`} />{p.active ? "Active" : "Inactive"}</span>
                            </div>
                          </div>
                          <div className="border-t border-neutral-100 bg-neutral-50/60 px-3.5 py-2">
                            <p className="m-0 text-[9px] font-medium text-neutral-400">Updated {shortDate(p.updatedAt)}</p>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </section>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={WalletCards} title="Night audits" subtitle="Last 10 business-day closes" />
          <div className="divide-y divide-neutral-50">
            {data.nightAudits.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-neutral-50/60 sm:px-5">
                <div className="min-w-0"><p className="m-0 truncate font-bold text-neutral-800">{a.reportNumber}</p><p className="mb-0 mt-0.5 text-[10px] text-neutral-400">Business date {shortDate(a.businessDay?.businessDate)}</p></div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${a.status === "CLOSED" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : a.status === "BLOCKED" || a.status === "FAILED" ? "border-red-100 bg-red-50 text-red-700" : "border-neutral-200 bg-neutral-100 text-neutral-500"}`}>{a.status}</span>
              </div>
            ))}
            {data.nightAudits.length === 0 && <EmptyState icon={WalletCards} title="No night audits run" text="Audits appear here once the property closes its first business day." />}
          </div>
        </section>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
          <SectionHeader icon={WalletCards} title="Cashier shifts" subtitle="Last 10 declared cash counts" />
          <div className="divide-y divide-neutral-50">
            {data.cashierShifts.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-xs transition hover:bg-neutral-50/60 sm:px-5">
                <div className="min-w-0"><p className="m-0 truncate font-bold text-neutral-800">{s.operator}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{shortDate(s.businessDate)} · expected {s.currency} {s.expectedCash.toLocaleString()}{s.declaredCash != null ? ` · declared ${s.declaredCash.toLocaleString()}` : ""}</p></div>
                {s.variance != null && s.variance !== 0
                  ? <span className="shrink-0 rounded-full border border-red-100 bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-700">Variance {s.variance.toLocaleString()}</span>
                  : <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-bold ${s.status === "CLOSED" ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>{s.status}</span>}
              </div>
            ))}
            {data.cashierShifts.length === 0 && <EmptyState icon={WalletCards} title="No cashier shifts" text="Shifts appear here once staff open and declare a cash drawer." />}
          </div>
        </section>
      </div>

      <section className="min-w-0 overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_12px_35px_-32px_rgba(15,23,42,0.4)]">
        <SectionHeader icon={WalletCards} title="Guest payment details" subtitle="As shown on the QR order page" />
        <div className="p-4 sm:p-5">
          {data.property.guestPayInstructions.length === 0 ? (
            <p className="m-0 text-xs text-neutral-400">None configured. Guests are told to pay at the counter.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {data.property.guestPayInstructions.map((row, index) => (
                <div key={index} className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs">
                  <p className="m-0 text-[9px] font-bold uppercase tracking-wide text-neutral-400">{row.label}</p>
                  <p className="mb-0 mt-0.5 font-bold text-neutral-800">{row.value}</p>
                  {row.name && <p className="mb-0 mt-0.5 text-[10px] text-neutral-500">{row.name}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {enforce && (
        <div className="fixed inset-0 z-[10000] flex items-start justify-center overflow-y-auto px-4 pb-4 pt-20 sm:pt-24">
          <button type="button" aria-label="Close enforcement dialog" className="fixed inset-0 border-0 bg-neutral-950/60 backdrop-blur-md" onClick={() => !enforcing && setEnforce(null)} />
          <div role="dialog" aria-modal="true" className="relative mx-auto my-8 w-full max-w-md max-h-[calc(100vh-4rem)] overflow-y-auto rounded-2xl border border-white/70 bg-white p-5 shadow-[0_28px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-start gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm ${enforce.danger ? "border-red-100 bg-red-50 text-red-600" : "border-amber-100 bg-amber-50 text-amber-600"}`}>
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="m-0 text-base font-bold tracking-tight text-neutral-950">{enforce.title}</h3>
                <p className="mb-0 mt-1.5 text-sm leading-5 text-neutral-600">{enforce.warning}</p>
              </div>
            </div>
            <label className="mt-4 block">
              <span className="mb-1 block text-xs font-bold text-neutral-600">Reason (recorded on the audit log and sent to the owner)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value.slice(0, 300))} rows={3} placeholder="Why this action is being taken" className="w-full resize-none rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-sm text-neutral-900 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100" />
            </label>
            {enforceError && <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {enforceError}</div>}
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" onClick={() => setEnforce(null)} disabled={enforcing} className="inline-flex min-h-10 items-center rounded-lg border border-neutral-200 bg-white px-4 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
              <button type="button" onClick={runEnforce} disabled={enforcing || reason.trim().length < 5} className={`inline-flex min-h-10 items-center gap-2 rounded-lg border-0 px-5 text-xs font-bold text-white transition disabled:opacity-50 ${enforce.danger ? "bg-red-600 hover:bg-red-700" : "bg-amber-600 hover:bg-amber-700"}`}>
                {enforcing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
