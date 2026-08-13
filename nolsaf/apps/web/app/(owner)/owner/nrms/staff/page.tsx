"use client";

import { useCallback, useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, Loader2, Mail, ShieldCheck, UserPlus, UserX, UsersRound } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";

type Outlet = { id: number; name: string; type: string };
type Membership = { id: number; role: string; status: string; user: { id: number; fullName: string | null; name: string | null; email: string | null; phone: string | null }; outlet: Outlet | null };
const ROLES = [
  { value: "MANAGER", label: "NRMS manager" },
  { value: "FRONT_DESK", label: "Front desk" },
  { value: "HOUSEKEEPER", label: "Housekeeper" },
  { value: "RESTAURANT", label: "Restaurant staff" },
  { value: "BAR", label: "Bar staff" },
  { value: "OUTLET_SUPERVISOR", label: "Outlet supervisor" },
];
const REVOKE_REASONS = ["Contract ended", "Not available now", "End of season", "Role changed", "Misconduct", "Other"];

export default function NrmsStaffPage() {
  const { selectedPropertyId } = useNrms();
  const [staff, setStaff] = useState<Membership[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("FRONT_DESK");
  const [outletId, setOutletId] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [resendingId, setResendingId] = useState<number | null>(null);
  const [revokingId, setRevokingId] = useState<number | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Membership | null>(null);
  const [revokeReason, setRevokeReason] = useState(REVOKE_REASONS[0]);
  const [revokeNote, setRevokeNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!selectedPropertyId) return;
    setLoading(true); setError(null);
    try {
      const [staffResponse, contextResponse] = await Promise.all([
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/staff`),
        apiClient.get(`/api/nrms/operations/property/${selectedPropertyId}/context`),
      ]);
      setStaff(staffResponse.data?.staff ?? []);
      setOutlets(contextResponse.data?.outlets ?? []);
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to load NRMS staff" ); }
    finally { setLoading(false); }
  }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load]);

  const needsOutlet = ["RESTAURANT", "BAR", "OUTLET_SUPERVISOR"].includes(role);
  const eligibleOutlets = outlets.filter((outlet) => role === "RESTAURANT" ? outlet.type === "RESTAURANT" : role === "BAR" ? outlet.type === "BAR" : true);

  const assign = async () => {
    if (!selectedPropertyId || !email.trim() || (needsOutlet && !outletId)) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/staff`, { email: email.trim(), role, outletId: needsOutlet ? outletId : null });
      const assignedEmail = email.trim();
      if (response.data?.needsConfirmation) {
        setNotice(response.data?.emailSent
          ? `Invitation sent to ${assignedEmail}. Access activates once they confirm the email.`
          : `Assignment saved as pending, but the invitation email could not be sent to ${assignedEmail}. Use Resend invitation to try again.`);
      } else {
        setNotice("Assignment updated.");
      }
      setEmail(""); setOutletId(""); await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to assign staff member"); }
    finally { setBusy(false); }
  };

  const resendInvitation = async (membership: Membership) => {
    if (!selectedPropertyId || membership.status !== "PENDING" || resendingId !== null) return;
    const recipient = membership.user.email;
    if (!recipient) {
      setError("This pending assignment no longer has an email address. Update the user's account before resending.");
      return;
    }
    setResendingId(membership.id); setError(null); setNotice(null);
    try {
      const response = await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/staff`, {
        email: recipient,
        role: membership.role,
        outletId: membership.outlet?.id ?? null,
      });
      if (response.data?.emailSent) {
        setNotice(`A fresh invitation was sent to ${recipient}. The previous confirmation link is no longer valid.`);
      } else {
        setError(`The invitation remains pending, but the email could not be sent to ${recipient}. Please try again later.`);
      }
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Failed to resend the invitation");
    } finally {
      setResendingId(null);
    }
  };

  const openRevoke = (membership: Membership) => {
    if (revokingId) return;
    setRevokeReason(REVOKE_REASONS[0]); setRevokeNote("");
    setRevokeTarget(membership);
  };

  const confirmRevoke = async () => {
    if (!selectedPropertyId || !revokeTarget || revokingId) return;
    const reason = revokeReason === "Other" ? revokeNote.trim() : revokeReason;
    if (reason.length < 3) return;
    const staffLabel = revokeTarget.user.fullName || revokeTarget.user.name || revokeTarget.user.email || "this staff member";
    setRevokingId(revokeTarget.id); setError(null); setNotice(null);
    try {
      await apiClient.delete(`/api/nrms/operations/property/${selectedPropertyId}/staff/${revokeTarget.id}`, { data: { reason } });
      setRevokeTarget(null);
      setNotice(`Access revoked for ${staffLabel}. Reason: ${reason}.`);
      await load();
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to revoke staff access"); }
    finally { setRevokingId(null); }
  };

  if (loading) return <div className="flex min-h-72 items-center justify-center text-neutral-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Loading staff…</div>;

  const activeCount = staff.filter((m) => m.status === "ACTIVE").length;

  return <div className="mx-auto max-w-6xl space-y-4 pb-8">
    <section className="relative overflow-hidden rounded-2xl border border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f4fbf8_58%,#ebf8f5_100%)] p-4 shadow-[0_18px_45px_-34px_rgba(2,102,94,0.45)] sm:p-5">
      <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full border border-emerald-700/[0.06]" aria-hidden="true" />
      <div className="relative flex flex-col gap-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-100 bg-white text-emerald-700 shadow-sm">
            <UsersRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-700">Access control</p>
            <h1 className="m-0 mt-0.5 text-sm font-bold tracking-tight text-neutral-950">Staff and roles</h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-emerald-100 bg-white/85 px-3 py-2 shadow-sm">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
          <div>
            <p className="m-0 text-[9px] font-bold uppercase tracking-[0.12em] text-neutral-400">Active staff</p>
            <p className="m-0 text-xs font-bold text-neutral-900">{activeCount} <span className="font-medium text-neutral-400">of {staff.length}</span></p>
          </div>
        </div>
      </div>

      <div className="relative mt-3.5 flex items-center gap-1.5 border-t border-emerald-100/70 pt-3">
        {[
          { n: 1, label: "Invite by email" },
          { n: 2, label: "Staff confirms" },
          { n: 3, label: "Access activates" },
        ].map((step, index, arr) => (
          <div key={step.n} className="flex min-w-0 flex-1 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-[10px] font-bold text-emerald-800">{step.n}</span>
            <span className="truncate text-[11px] font-semibold text-neutral-600">{step.label}</span>
            {index < arr.length - 1 && <span className="mx-0.5 h-px flex-1 bg-emerald-200" aria-hidden="true" />}
          </div>
        ))}
      </div>
    </section>

    {error && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{notice}</div>}

    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_18px_45px_-36px_rgba(15,23,42,0.5)]">
      <div className="relative flex flex-wrap items-center justify-between gap-3 overflow-hidden border-b border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f0faf6_100%)] px-4 py-3.5 sm:px-5">
        <div className="pointer-events-none absolute -right-8 -top-12 h-28 w-28 rounded-full border border-emerald-600/[0.06]" aria-hidden="true" />
        <div className="relative flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UserPlus className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold text-neutral-950">Assign registered user</h3>
            <p className="mb-0 mt-0.5 text-[10px] text-neutral-500">The staff member must already have a NoLSAF account using this email. They receive an invitation email and access activates only after they confirm it.</p>
          </div>
        </div>
        <span className="relative shrink-0 rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-emerald-700 shadow-sm">Confirmation required</span>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void assign(); }} className="grid min-w-0 grid-cols-1 gap-3 p-4 sm:grid-cols-12 sm:items-end sm:p-5">
        <label className={`min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 ${needsOutlet ? "sm:col-span-5" : "sm:col-span-6"}`}>
          Account email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@example.com" autoComplete="email" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
        </label>
        <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:col-span-3">
          Staff role
          <select value={role} onChange={(event) => { setRole(event.target.value); setOutletId(""); }} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10">{ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </label>
        {needsOutlet && <label className="min-w-0 text-[10px] font-bold uppercase tracking-wide text-neutral-500 sm:col-span-2">
          Assigned outlet
          <select value={outletId} onChange={(event) => setOutletId(event.target.value ? Number(event.target.value) : "")} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"><option value="">Select outlet</option>{eligibleOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select>
        </label>}
        <button type="submit" disabled={busy || !email.trim() || (needsOutlet && !outletId)} className={`box-border inline-flex !h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none ${needsOutlet ? "sm:col-span-2" : "sm:col-span-3"}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{busy ? "Assigning..." : "Assign access"}</button>
      </form>
    </section>

    <section className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_18px_45px_-36px_rgba(15,23,42,0.5)]">
      <div className="relative flex items-center justify-between gap-3 overflow-hidden border-b border-emerald-100 bg-[linear-gradient(135deg,#ffffff_0%,#f0faf6_100%)] px-4 py-3.5 sm:px-5">
        <div className="pointer-events-none absolute -right-8 -top-12 h-28 w-28 rounded-full border border-emerald-600/[0.06]" aria-hidden="true" />
        <div className="relative flex items-center gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-100 bg-white text-emerald-700 shadow-sm"><UsersRound className="h-4 w-4" /></span><h3 className="m-0 text-sm font-bold text-neutral-950">Property team</h3></div>
        <span className="relative shrink-0 rounded-full border border-emerald-100 bg-white px-2.5 py-1 text-[10px] font-bold text-emerald-700 shadow-sm">{staff.length} {staff.length === 1 ? "assignment" : "assignments"}</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {staff.map((membership) => (
          <div key={membership.id} className="grid min-w-0 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_11rem_11rem_8rem_8.5rem] sm:items-center">
            <div className="min-w-0"><p className="m-0 truncate text-xs font-bold text-neutral-900">{membership.user.fullName || membership.user.name || "Staff member"}</p><p className="mb-0 mt-0.5 truncate text-[10px] text-neutral-400">{membership.user.email || membership.user.phone || `User #${membership.user.id}`}</p></div>
            <span className="text-xs font-semibold text-neutral-600">{ROLES.find((item) => item.value === membership.role)?.label ?? membership.role}</span>
            <span className="text-xs text-neutral-500">{membership.outlet?.name ?? "All property"}</span>
            <span className={`w-fit rounded-full px-2 py-1 text-[9px] font-bold ${membership.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : membership.status === "PENDING" ? "bg-amber-50 text-amber-700" : "bg-neutral-100 text-neutral-500"}`}>{membership.status === "PENDING" ? "AWAITING CONFIRMATION" : membership.status === "DISABLED" ? "REVOKED" : membership.status}</span>
            {membership.status === "PENDING" ? (
              <button type="button" onClick={() => void resendInvitation(membership)} disabled={resendingId !== null || !membership.user.email} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-2.5 text-[10px] font-bold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50">
                {resendingId === membership.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}Resend invitation
              </button>
            ) : membership.status === "ACTIVE" ? (
              <button type="button" onClick={() => openRevoke(membership)} disabled={revokingId !== null} className="inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-red-200 bg-white px-2.5 text-[10px] font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                {revokingId === membership.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}Revoke
              </button>
            ) : <span />}
          </div>
        ))}
      </div>
      {staff.length === 0 && <div className="py-14 text-center text-sm text-neutral-400">No NRMS staff assigned yet.</div>}
    </section>

    {revokeTarget && <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel revoke" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => { if (!revokingId) setRevokeTarget(null); }} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-start gap-3 border-b border-neutral-100 px-5 py-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><UserX className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold text-neutral-950">Revoke access</h3>
            <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-700">{revokeTarget.user.fullName || revokeTarget.user.name || revokeTarget.user.email}</span>
              {" "}({ROLES.find((item) => item.value === revokeTarget.role)?.label ?? revokeTarget.role}{revokeTarget.outlet ? `, ${revokeTarget.outlet.name}` : ""}) loses access immediately.
            </p>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-500">
            Reason
            <select value={revokeReason} onChange={(event) => setRevokeReason(event.target.value)} className="mt-1.5 box-border !h-10 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none transition focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-500/10">
              {REVOKE_REASONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {revokeReason === "Other" && <label className="block text-[10px] font-bold uppercase tracking-wide text-neutral-500">
            Details
            <input type="text" value={revokeNote} onChange={(event) => setRevokeNote(event.target.value)} maxLength={300} placeholder="Short reason" className="mt-1.5 box-border !h-10 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-red-400 focus:bg-white focus:ring-2 focus:ring-red-500/10" />
          </label>}
          <p className="m-0 text-[10px] text-neutral-400">You can re-assign them later; they would receive a new invitation to confirm.</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 bg-neutral-50/70 px-5 py-3">
          <button type="button" onClick={() => setRevokeTarget(null)} disabled={revokingId !== null} className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void confirmRevoke()} disabled={revokingId !== null || (revokeReason === "Other" && revokeNote.trim().length < 3)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border-0 bg-red-600 px-3.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">
            {revokingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}Revoke access
          </button>
        </div>
      </div>
    </div>}
  </div>;
}
