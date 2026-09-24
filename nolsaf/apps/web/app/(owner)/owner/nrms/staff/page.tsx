"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import { AlertTriangle, BadgeCheck, ClipboardCheck, Clock3, Copy, Loader2, Mail, MessageCircle, PauseCircle, Repeat, ShieldAlert, ShieldCheck, UserPlus, UserX, UsersRound } from "lucide-react";
import { useNrms } from "../_components/NrmsProvider";
import { NrmsDirectoryShell, NrmsLifecycleRail } from "../_components/NrmsDirectory";

type Outlet = { id: number; name: string; type: string };
type Membership = {
  id: number;
  role: string;
  status: string;
  user: { id: number; fullName: string | null; name: string | null; email: string | null; phone: string | null };
  outlet: Outlet | null;
  /** When the emailed invitation stops working. Null unless pending. */
  invitationExpiresAt?: string | null;
  /** The link in their inbox is dead; only a resend will work now. */
  invitationExpired?: boolean;
  /** Last sale rung up here, or last platform sign-in, whichever is later. */
  lastActiveAt?: string | null;
  /** Active, but nothing recorded for a long time. A prompt, not a verdict. */
  dormant?: boolean;
};

/** Roster health, assembled by the API from what it already knows. */
type StaffReview = {
  active: number;
  pending: number;
  expiredInvites: number;
  dormant: number;
  dormantAfterDays: number;
  inviteValidDays: number;
};
/**
 * Staff roles come from the API, not from a list kept here.
 *
 * This page used to hold its own copy of the roles, of which ones need an
 * outlet, and of who may appoint a manager. All three are decided server side
 * in nrmsStaffRoles.ts and the assign handler, so a role added there now shows
 * up in this picker, brings its outlet requirement, and labels the roster,
 * with no edit to this file.
 */
type StaffRoleOption = {
  value: string;
  label: string;
  requiresOutlet: boolean;
  /** The outlet type this role must attach to, or null when any will do. */
  outletType: string | null;
  /** Whether THIS signed-in user may assign it. */
  assignable: boolean;
};
const REVOKE_REASONS = ["Contract ended", "Not available now", "End of season", "Role changed", "Misconduct", "Other"];

/** Two letters for the roster avatar, so a row reads as a person before it reads as a role. */
function initialsOf(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  const letters = parts.map((part) => part[0]).join("");
  return letters ? letters.toUpperCase() : "?";
}

/** Preflight is disabled in this app, so outlines here are `ring-*`: a bare
 *  `border` on a span or div sets no border-style and paints nothing. */
const STATUS_PRESENTATION: Record<string, { label: string; chip: string; dot: string; avatar: string }> = {
  ACTIVE: {
    label: "Active",
    chip: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
    dot: "bg-emerald-500",
    avatar: "bg-emerald-50 text-emerald-700 ring-2 ring-emerald-200",
  },
  PENDING: {
    label: "Pending",
    chip: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
    dot: "bg-amber-500",
    avatar: "bg-amber-50 text-amber-700 ring-2 ring-amber-200",
  },
  DISABLED: {
    label: "Revoked",
    chip: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
    dot: "bg-neutral-400",
    avatar: "bg-neutral-100 text-neutral-400 ring-2 ring-neutral-200",
  },
};

/** A pending invitation past its validity is not waiting on the staff member
 *  any more, it is waiting on a resend. Showing it as plain "Pending" told the
 *  owner to be patient about a link that no longer works. */
const EXPIRED_INVITE_PRESENTATION = {
  label: "Invite expired",
  chip: "bg-red-50 text-red-700 ring-1 ring-red-200",
  dot: "bg-red-500",
  avatar: "bg-red-50 text-red-600 ring-2 ring-red-200",
};

/** Compact "3 days ago" style, so a roster reads at a glance. */
function sinceLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return null;
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

const FALLBACK_STATUS = {
  chip: "bg-neutral-100 text-neutral-500 ring-1 ring-neutral-200",
  dot: "bg-neutral-400",
  avatar: "bg-neutral-100 text-neutral-400 ring-2 ring-neutral-200",
};

export default function NrmsStaffPage() {
  const { selectedPropertyId, selectedProperty } = useNrms();
  const [staff, setStaff] = useState<Membership[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [roleOptions, setRoleOptions] = useState<StaffRoleOption[]>([]);
  /** Reported by the API: revoking a manager is its own capability, not
   *  something this page should infer by comparing role strings. */
  const [canRevokeManager, setCanRevokeManager] = useState(false);
  const [review, setReview] = useState<StaffReview | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [view, setView] = useState<"cards" | "list">("list");
  /** Replacing is one intent: bring the new person in, then stand the old
   *  one down. Kept as a single flow so the two never drift apart. */
  const [replaceTarget, setReplaceTarget] = useState<Membership | null>(null);
  const [replaceEmail, setReplaceEmail] = useState("");
  const [replaceReason, setReplaceReason] = useState(REVOKE_REASONS[0]);
  const [replacing, setReplacing] = useState(false);
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
  /** Set when the assign attempt failed only because no NoLSAF account uses
   *  that address. The owner can act on it rather than being told to go
   *  and chase the person by some other means. */
  const [needsAccountFor, setNeedsAccountFor] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);
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
      setReview(staffResponse.data?.review ?? null);
      setOutlets(contextResponse.data?.outlets ?? []);
      setRoleOptions(contextResponse.data?.staffRoles ?? []);
      setCanRevokeManager(Boolean(contextResponse.data?.access?.canRevokeManager));
    } catch (cause: any) { setError(cause?.response?.data?.error || "Failed to load NRMS staff" ); }
    finally { setLoading(false); }
  }, [selectedPropertyId]);
  useEffect(() => { void load(); }, [load]);

  const assignableRoles = roleOptions.filter((item) => item.assignable);
  const selectedRole = roleOptions.find((item) => item.value === role) ?? null;
  const needsOutlet = selectedRole?.requiresOutlet ?? false;
  // Only outlets the assign handler would actually accept for this role.
  const eligibleOutlets = selectedRole?.outletType
    ? outlets.filter((outlet) => outlet.type === selectedRole.outletType)
    : outlets;

  /** Roster label for a stored role. Falls back to the raw code prettified, so
   *  a membership written under a since-retired role still reads as something. */
  const roleLabel = useCallback((code: string) => {
    const served = roleOptions.find((item) => item.value === code);
    if (served) return served.label;
    return code.replace(/_/g, " ").toLowerCase().replace(/^\S/, (c) => c.toUpperCase());
  }, [roleOptions]);

  // The default role must be one this user can actually assign, and it must
  // exist: a manager who cannot appoint managers should never be sitting on a
  // preselected role the server will refuse.
  useEffect(() => {
    if (assignableRoles.length === 0) return;
    if (assignableRoles.some((item) => item.value === role)) return;
    setRole(assignableRoles[0].value);
    setOutletId("");
  }, [assignableRoles, role]);

  /**
   * Where an invited staff member creates their account.
   *
   * A staff member holds an ordinary traveller account: NRMS roles sit
   * alongside `User.role`, they do not replace it. So the link opens the normal
   * registration with the role preset and their address filled in; nothing
   * about being staff changes how they sign up.
   */
  const registrationLink = useMemo(() => {
    if (!needsAccountFor) return "";
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}/account/register?mode=register&role=traveller&email=${encodeURIComponent(needsAccountFor)}`;
  }, [needsAccountFor]);

  /** Shown to the owner, not sent anywhere. The href keeps its percent
   *  encoding; printing `%40` at a hotelier reads as a broken link. */
  const readableLink = useMemo(() => {
    if (!registrationLink) return "";
    try {
      return decodeURIComponent(registrationLink);
    } catch {
      return registrationLink;
    }
  }, [registrationLink]);

  const shareSubject = useMemo(
    () => (selectedProperty?.title ? `Your NoLSAF account for ${selectedProperty.title}` : "Your NoLSAF account"),
    [selectedProperty],
  );

  const shareMessage = useMemo(() => {
    if (!needsAccountFor) return "";
    const propertyName = selectedProperty?.title ? ` at ${selectedProperty.title}` : "";
    return [
      `Hello,`,
      ``,
      `You are being added to the team${propertyName} on NoLSAF. Before that can happen you need a free NoLSAF account.`,
      ``,
      `Please register using this address: ${needsAccountFor}`,
      registrationLink,
      ``,
      `Once you have registered, tell me and I will assign your role. You will then get a confirmation email to activate it.`,
    ].join("\n");
  }, [needsAccountFor, registrationLink, selectedProperty]);

  const assign = async () => {
    if (!selectedPropertyId || !email.trim() || (needsOutlet && !outletId)) return;
    setBusy(true); setError(null); setNotice(null); setNeedsAccountFor(null); setCopiedLink(false);
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
    } catch (cause: any) {
      // "No account yet" is not really a failure, it is the next step. Keep the
      // address so the owner can send them a sign-up link from here.
      if (cause?.response?.data?.code === "STAFF_ACCOUNT_NOT_FOUND") {
        setNeedsAccountFor(email.trim());
        setError(null);
      } else {
        setError(cause?.response?.data?.error || "Failed to assign staff member");
      }
    }
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

  /**
   * Hand a role from one person to another as a single action.
   *
   * The new person is assigned FIRST and the outgoing one stood down only once
   * that succeeds, so the outlet is never left uncovered by a half-finished
   * replacement. The revoke reason names the incoming email, which puts the
   * handover into the audit log rather than leaving two unrelated entries.
   */
  const confirmReplace = async () => {
    if (!selectedPropertyId || !replaceTarget || replacing) return;
    const incoming = replaceEmail.trim();
    if (!incoming) return;
    const outgoingLabel = replaceTarget.user.fullName || replaceTarget.user.name || replaceTarget.user.email || "the previous holder";
    setReplacing(true); setError(null); setNotice(null);
    try {
      const assigned = await apiClient.post(`/api/nrms/operations/property/${selectedPropertyId}/staff`, {
        email: incoming,
        role: replaceTarget.role,
        outletId: replaceTarget.outlet?.id ?? null,
      });

      try {
        await apiClient.delete(`/api/nrms/operations/property/${selectedPropertyId}/staff/${replaceTarget.id}`, {
          data: { reason: `${replaceReason}. Replaced by ${incoming}` },
        });
      } catch (revokeCause: any) {
        // The replacement is in but the outgoing person is still active. Say so
        // plainly: pretending it worked would leave two people holding the role.
        setError(
          `${incoming} was assigned, but ${outgoingLabel} could not be stood down: `
          + `${revokeCause?.response?.data?.error || "the revoke failed"}. Both currently hold this role. Revoke the outgoing assignment manually.`,
        );
        setReplaceTarget(null);
        await load();
        return;
      }

      setReplaceTarget(null);
      setNotice(assigned.data?.emailSent === false
        ? `${outgoingLabel} was stood down and ${incoming} was assigned, but the invitation email could not be sent. Use Resend to try again.`
        : `${outgoingLabel} was stood down and an invitation was sent to ${incoming}. Access activates once they confirm.`);
      await load();
    } catch (cause: any) {
      // Assignment failed, so nothing was revoked and cover is unchanged.
      setError(cause?.response?.data?.error || "Failed to assign the replacement. No access was changed.");
    } finally {
      setReplacing(false);
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
  const memberStage = (membership: Membership) => membership.invitationExpired || membership.dormant ? "REVIEW" : membership.status;
  const visibleStaff = staff.filter((membership) => {
    const term = query.trim().toLowerCase();
    const name = membership.user.fullName || membership.user.name || "";
    return (!statusFilter || memberStage(membership) === statusFilter)
      && (!term || [name, membership.user.email, membership.user.phone, roleLabel(membership.role), membership.outlet?.name].some((value) => String(value || "").toLowerCase().includes(term)));
  });
  const staffStages = [
    { key: "PENDING", label: "Invited", hint: "Waiting for access confirmation", count: staff.filter((item) => item.status === "PENDING" && !item.invitationExpired).length, icon: Clock3, text: "text-amber-700", bar: "bg-amber-400", soft: "bg-amber-50" },
    { key: "ACTIVE", label: "Active", hint: "Property access enabled", count: staff.filter((item) => item.status === "ACTIVE" && !item.dormant).length, icon: BadgeCheck, text: "text-emerald-700", bar: "bg-emerald-500", soft: "bg-emerald-50" },
    { key: "REVIEW", label: "Needs review", hint: "Expired invitation or dormant access", count: staff.filter((item) => item.invitationExpired || item.dormant).length, icon: ShieldAlert, text: "text-orange-700", bar: "bg-orange-400", soft: "bg-orange-50" },
    { key: "DISABLED", label: "Revoked", hint: "Property access removed", count: staff.filter((item) => item.status === "DISABLED").length, icon: PauseCircle, text: "text-rose-600", bar: "bg-rose-400", soft: "bg-rose-50" },
  ];

  return <div className="mx-auto w-full min-w-0 max-w-[1440px] space-y-4 px-1 pb-8 sm:px-0">
    <section className="min-w-0 overflow-hidden rounded-2xl bg-white shadow-[0_18px_45px_-36px_rgba(15,23,42,0.5)] ring-1 ring-neutral-200">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[linear-gradient(135deg,#ffffff_0%,#f2faf7_100%)] px-4 py-3 shadow-[inset_0_-1px_0_0_#e5e7eb] sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-emerald-700 shadow-sm ring-1 ring-emerald-100">
            <UsersRound className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 text-base font-bold tracking-tight text-neutral-950">Staff and roles</h1>
            <p className="mb-0 mt-0.5 truncate text-xs text-neutral-500">Invite by email, they confirm, access activates.</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50/70 px-2.5 py-1 ring-1 ring-emerald-100">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
          <span className="text-xs font-bold text-emerald-800">{activeCount} active</span>
          <span className="text-xs font-medium text-emerald-700/60">of {staff.length}</span>
        </div>
      </div>

      <form onSubmit={(event) => { event.preventDefault(); void assign(); }} className="grid min-w-0 grid-cols-1 gap-2.5 px-4 py-3.5 sm:grid-cols-12 sm:px-5 sm:items-end sm:gap-3">
        <label className={`min-w-0 text-xs font-bold uppercase tracking-wide text-neutral-500 ${needsOutlet ? "sm:col-span-4" : "sm:col-span-6"}`}>
          Account email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="staff@example.com" autoComplete="email" className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10" />
        </label>
        <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-neutral-500 sm:col-span-3">
          Staff role
          <select value={role} onChange={(event) => { setRole(event.target.value); setOutletId(""); }} disabled={assignableRoles.length === 0} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10 disabled:cursor-not-allowed disabled:text-neutral-400">{assignableRoles.length === 0 ? <option value="">No role available</option> : assignableRoles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
        </label>
        {needsOutlet && <label className="min-w-0 text-xs font-bold uppercase tracking-wide text-neutral-500 sm:col-span-3">
          Assigned outlet
          <select value={outletId} onChange={(event) => setOutletId(event.target.value ? Number(event.target.value) : "")} className="mt-1.5 box-border !h-10 w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-0 text-sm font-semibold normal-case tracking-normal text-neutral-800 outline-none transition focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/10"><option value="">Select outlet</option>{eligibleOutlets.map((outlet) => <option key={outlet.id} value={outlet.id}>{outlet.name}</option>)}</select>
        </label>}
        <button type="submit" disabled={busy || !email.trim() || !role || assignableRoles.length === 0 || (needsOutlet && !outletId)} className={`box-border inline-flex !h-10 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#073c35] px-3 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 disabled:shadow-none ${needsOutlet ? "sm:col-span-2" : "sm:col-span-3"}`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{busy ? "Assigning..." : "Assign access"}</button>
        <p className="m-0 text-xs leading-relaxed text-neutral-500 sm:col-span-12">The staff member must already have a NoLSAF account with this email. Access activates only after they confirm the invitation.</p>
      </form>
    </section>

    {error && <div className="flex gap-2 rounded-xl bg-red-50 px-3.5 py-2.5 text-xs text-red-700 ring-1 ring-red-200"><AlertTriangle className="mt-px h-4 w-4 shrink-0" />{error}</div>}

    {/* No account yet. Previously this was a dead end that told the owner to go
        and arrange registration somewhere else. A staff member holds an
        ordinary traveller account, so the sign-up link is the same one anyone
        uses, with their address filled in. */}
    {needsAccountFor && (
      <div className="min-w-0 rounded-xl bg-sky-50 px-3.5 py-3 ring-1 ring-sky-200">
        <div className="flex min-w-0 items-start gap-2">
          <UserPlus className="mt-px h-4 w-4 shrink-0 text-sky-700" />
          <div className="min-w-0">
            <p className="m-0 text-xs font-bold text-sky-900">No NoLSAF account uses this email yet</p>
            <p className="mb-0 mt-0.5 text-xs leading-relaxed text-sky-800">
              <span className="font-semibold break-all">{needsAccountFor}</span> needs a free NoLSAF account before you can
              assign a role. It is an ordinary traveller account, the same one guests use. Send them this link, then assign
              the role once they have registered.
            </p>
          </div>
        </div>

        <div className="mt-2.5 flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(registrationLink);
                setCopiedLink(true);
                window.setTimeout(() => setCopiedLink(false), 2000);
              } catch {
                // Clipboard is blocked in some browsers and over plain http.
                // The link is visible below, so it can still be copied by hand.
                setCopiedLink(false);
              }
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-2.5 text-xs font-bold text-sky-800 transition hover:bg-sky-100"
          >
            {copiedLink ? <ShieldCheck className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedLink ? "Link copied" : "Copy sign-up link"}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareMessage)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-2.5 text-xs font-bold text-sky-800 no-underline transition hover:bg-sky-100"
          >
            <MessageCircle className="h-3.5 w-3.5" />
            WhatsApp
          </a>
          {/* mailto opens the owner's own mail client. NoLSAF sends nothing to
              an address it has no account for, so this cannot be used to mail
              strangers through the platform. */}
          <a
            href={`mailto:${encodeURIComponent(needsAccountFor)}?subject=${encodeURIComponent(shareSubject)}&body=${encodeURIComponent(shareMessage)}`}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-300 bg-white px-2.5 text-xs font-bold text-sky-800 no-underline transition hover:bg-sky-100"
          >
            <Mail className="h-3.5 w-3.5" />
            Email
          </a>
          <button
            type="button"
            onClick={() => { setNeedsAccountFor(null); setCopiedLink(false); }}
            className="inline-flex h-8 items-center rounded-lg border-0 bg-transparent px-2 text-xs font-semibold text-sky-700 transition hover:text-sky-900"
          >
            Dismiss
          </button>
        </div>

        {/* Kept visible so the owner can see where they are sending people, and
            so the link is still usable where the clipboard is blocked. Decoded
            for reading; the buttons above share the encoded form. */}
        <p className="m-0 mt-2.5 select-all break-all rounded-lg bg-white/70 px-2.5 py-1.5 font-mono text-xs leading-relaxed text-sky-800 ring-1 ring-sky-200">
          {readableLink}
        </p>
      </div>
    )}
    {notice && <div className="flex gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-xs text-emerald-800 ring-1 ring-emerald-200"><ShieldCheck className="mt-px h-4 w-4 shrink-0" />{notice}</div>}

    {/* Access review. A prompt to look at the roster, built from what the API
        already knows. It records no attestation: "someone confirmed this list
        on a date" would need a column that does not exist yet. */}
    {review && (review.expiredInvites > 0 || review.dormant > 0) && (
      <div className="flex flex-wrap items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900 ring-1 ring-amber-200">
        <ClipboardCheck className="mt-px h-4 w-4 shrink-0 text-amber-700" />
        <div className="min-w-0">
          <p className="m-0 font-bold">This team list needs a look</p>
          <p className="mb-0 mt-1 text-xs leading-relaxed text-amber-800">
            {[
              review.expiredInvites > 0
                ? `${review.expiredInvites} invitation${review.expiredInvites === 1 ? "" : "s"} expired after ${review.inviteValidDays} days and must be resent`
                : null,
              review.dormant > 0
                ? `${review.dormant} active ${review.dormant === 1 ? "person has" : "people have"} recorded nothing for over ${review.dormantAfterDays} days`
                : null,
            ].filter(Boolean).join(". ")}. Access that is not needed should be revoked.
          </p>
        </div>
      </div>
    )}

    <NrmsLifecycleRail stages={staffStages} selected={statusFilter} onSelect={setStatusFilter} />
    <NrmsDirectoryShell title={statusFilter ? `${staffStages.find((stage) => stage.key === statusFilter)?.label ?? statusFilter} staff` : "Property team"} count={visibleStaff.length} query={query} onQueryChange={setQuery} placeholder="Search name, email, role or outlet" view={view} onViewChange={setView} filter={statusFilter} onClearFilter={() => setStatusFilter("")}>
      {/* Names the columns below. Hidden on mobile, where each row collapses
          into one block and headings would label nothing. */}
      {visibleStaff.length > 0 && view === "list" && (
        <div className="hidden gap-x-5 bg-neutral-50/60 px-5 py-2.5 shadow-[inset_0_-1px_0_0_#eef2f6] sm:grid sm:grid-cols-[minmax(0,1fr)_11rem_8rem_10.5rem]">
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Staff member</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Role and scope</span>
          <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Status</span>
          <span className="text-right text-[11px] font-bold uppercase tracking-[0.1em] text-neutral-500">Action</span>
        </div>
      )}
      {/* A list, not a stack of divs. Preflight is off, so the UA indent and
          bullets have to be cleared explicitly. */}
      <ul className={`m-0 list-none p-0 ${view === "cards" ? "grid grid-cols-1 gap-3 border-t border-neutral-100 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3" : ""}`}>
        {visibleStaff.map((membership, index) => {
          const displayName = membership.user.fullName || membership.user.name || "Staff member";
          const baseStatus = STATUS_PRESENTATION[membership.status] ?? { label: membership.status, ...FALLBACK_STATUS };
          // An expired invitation outranks "Pending": it is the actionable truth.
          const status = membership.invitationExpired ? EXPIRED_INVITE_PRESENTATION : baseStatus;
          const lastActive = sinceLabel(membership.lastActiveAt);
          const managerLockedOut = membership.role === "MANAGER" && !canRevokeManager;
          const action = membership.status === "ACTIVE" && !managerLockedOut ? (
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => { setReplaceEmail(""); setReplaceReason(REVOKE_REASONS[0]); setReplaceTarget(membership); }} disabled={replacing || revokingId !== null} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50">
                <Repeat className="h-3.5 w-3.5" />Replace
              </button>
              <button type="button" onClick={() => openRevoke(membership)} disabled={revokingId !== null || replacing} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                {revokingId === membership.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}Revoke
              </button>
            </div>
          ) : membership.status === "PENDING" && !managerLockedOut ? (
            <button type="button" onClick={() => void resendInvitation(membership)} disabled={resendingId !== null || !membership.user.email} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-white px-3 text-xs font-bold text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50">
              {resendingId === membership.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}Resend
            </button>
          ) : managerLockedOut ? (
            <span className="whitespace-nowrap text-xs font-semibold text-neutral-400">Owner controlled</span>
          ) : null;
          return (
            // Two columns, not four. The old fixed 8.5rem/7.5rem tracks left the
            // person stranded at one edge and the controls at the other on a
            // wide screen; status and the action now travel together as one
            // right-hand cluster.
            <li key={membership.id} className={`grid min-w-0 grid-cols-2 items-center gap-x-5 gap-y-2.5 px-4 py-3.5 transition hover:bg-neutral-50/70 ${view === "cards" ? "rounded-xl border border-neutral-200 bg-white shadow-sm" : `sm:grid-cols-[minmax(0,1fr)_11rem_8rem_10.5rem] sm:px-5 ${index > 0 ? "shadow-[inset_0_1px_0_0_#eef2f6]" : ""}`}`}>
              <div className="col-span-2 flex min-w-0 items-center gap-3 sm:col-span-1">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${status.avatar}`} aria-hidden="true">{initialsOf(displayName)}</span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-sm font-bold text-neutral-900">{displayName}</p>
                  <p className="mb-0 mt-0.5 truncate text-xs text-neutral-500">{membership.user.email || membership.user.phone || `User #${membership.user.id}`}</p>
                  {/* Role rides with the person on narrow screens, where a
                      separate column would only wrap into an orphan line. */}
                  <p className="mb-0 mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-neutral-500 sm:hidden">
                    <span className="font-semibold text-neutral-700">{roleLabel(membership.role)}</span>
                    <span className="text-neutral-300">·</span>
                    <span>{membership.outlet?.name ?? "All property"}</span>
                  </p>
                  {/* Only shown when it changes what the owner should do. */}
                  {membership.invitationExpired ? (
                    <p className="mb-0 mt-0.5 text-xs text-red-600">Emailed link no longer works</p>
                  ) : membership.dormant ? (
                    <p className="mb-0 mt-0.5 text-xs text-amber-700">
                      Nothing recorded {lastActive ? `since ${lastActive}` : "yet"}
                    </p>
                  ) : membership.status === "ACTIVE" && lastActive ? (
                    <p className="mb-0 mt-0.5 text-xs text-neutral-500">Last active {lastActive}</p>
                  ) : null}
                </div>
              </div>

              {/* Left aligned inside its own column: right aligning made every
                  role label start at a different x down the list. */}
              <div className={`${view === "cards" ? "col-span-2 block border-t border-neutral-100 pt-2" : "hidden sm:block"} min-w-0`}>
                <p className="m-0 truncate text-sm font-semibold text-neutral-700">{roleLabel(membership.role)}</p>
                <p className="mb-0 mt-0.5 truncate text-xs text-neutral-500">{membership.outlet?.name ?? "All property"}</p>
              </div>

              <div className="min-w-0">
                <span className={`inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ${status.chip}`}>
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
                  <span className="truncate">{status.label}</span>
                </span>
              </div>
              {/* Its own track, so an empty action cell keeps the columns to its
                  left in place instead of letting them slide right. */}
              <div className="flex min-w-0 justify-end">{action}</div>
            </li>
          );
        })}
      </ul>
      {visibleStaff.length === 0 && (
        <div className="px-4 py-12 text-center sm:px-5">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-neutral-50 text-neutral-300 ring-1 ring-neutral-200">
            <UsersRound className="h-5 w-5" />
          </span>
          <p className="m-0 text-sm font-semibold text-neutral-700">No one is assigned yet</p>
          <p className="mx-auto mb-0 mt-1 max-w-sm text-xs leading-relaxed text-neutral-500">
            Invite a teammate with the form above. They keep their own NoLSAF sign in, and access starts only once they confirm.
          </p>
        </div>
      )}
    </NrmsDirectoryShell>

    {replaceTarget && <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel replacement" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => { if (!replacing) setReplaceTarget(null); }} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-lg border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-start gap-3 px-5 py-4 shadow-[inset_0_-1px_0_0_#f1f5f9]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700"><Repeat className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-semibold text-neutral-950">Replace on this role</h3>
            <p className="mb-0 mt-0.5 text-[11px] leading-relaxed text-neutral-500">
              <span className="font-semibold text-neutral-700">{replaceTarget.user.fullName || replaceTarget.user.name || replaceTarget.user.email}</span>
              {" "}hands over {roleLabel(replaceTarget.role)}{replaceTarget.outlet ? ` at ${replaceTarget.outlet.name}` : ""}.
            </p>
          </div>
        </div>
        <div className="space-y-3 px-5 py-4">
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Replacement account email
            <input type="email" value={replaceEmail} onChange={(event) => setReplaceEmail(event.target.value)} placeholder="staff@example.com" autoComplete="email" className="mt-1.5 box-border !h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-0 text-sm font-medium normal-case tracking-normal text-neutral-900 outline-none transition placeholder:font-normal placeholder:text-neutral-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/10" />
          </label>
          <label className="block text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
            Why the outgoing person is leaving the role
            <select value={replaceReason} onChange={(event) => setReplaceReason(event.target.value)} className="mt-1.5 box-border !h-10 w-full rounded-md border border-neutral-300 bg-white px-3 py-0 text-sm font-medium normal-case tracking-normal text-neutral-800 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/10">
              {REVOKE_REASONS.filter((item) => item !== "Other").map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <p className="m-0 text-[10px] leading-relaxed text-neutral-400">
            The replacement is invited first, and the outgoing person keeps access until that succeeds, so the role is never
            left uncovered. Sales history stays with whoever rang it up.
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-neutral-100 bg-white px-5 py-3">
          <button type="button" onClick={() => setReplaceTarget(null)} disabled={replacing} className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-3.5 text-xs font-semibold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void confirmReplace()} disabled={replacing || !replaceEmail.trim()} className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-[#073c35] px-3.5 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">
            {replacing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5" />}Replace
          </button>
        </div>
      </div>
    </div>}

    {revokeTarget && <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4">
      <button type="button" aria-label="Cancel revoke" className="absolute inset-0 border-0 bg-neutral-950/45 backdrop-blur-sm" onClick={() => { if (!revokingId) setRevokeTarget(null); }} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-neutral-200">
        <div className="flex items-start gap-3 px-5 py-4 shadow-[inset_0_-1px_0_0_#f1f5f9]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600"><UserX className="h-4 w-4" /></span>
          <div className="min-w-0">
            <h3 className="m-0 text-sm font-bold text-neutral-950">Revoke access</h3>
            <p className="mb-0 mt-0.5 text-[11px] text-neutral-500">
              <span className="font-semibold text-neutral-700">{revokeTarget.user.fullName || revokeTarget.user.name || revokeTarget.user.email}</span>
              {" "}({roleLabel(revokeTarget.role)}{revokeTarget.outlet ? `, ${revokeTarget.outlet.name}` : ""}) loses access immediately.
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
        <div className="flex flex-wrap justify-end gap-2 bg-neutral-50/70 px-5 py-3 shadow-[inset_0_1px_0_0_#f1f5f9]">
          <button type="button" onClick={() => setRevokeTarget(null)} disabled={revokingId !== null} className="inline-flex h-9 items-center rounded-xl border border-neutral-200 bg-white px-3.5 text-xs font-bold text-neutral-600 transition hover:bg-neutral-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={() => void confirmRevoke()} disabled={revokingId !== null || (revokeReason === "Other" && revokeNote.trim().length < 3)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border-0 bg-red-600 px-3.5 text-xs font-bold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400">
            {revokingId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserX className="h-3.5 w-3.5" />}Revoke access
          </button>
        </div>
      </div>
    </div>}
  </div>;
}
