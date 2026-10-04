"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import {
  AlertTriangle,
  Briefcase,
  Building2,
  Car,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldOff,
  User,
  UserCog,
  X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useAdminQueryId } from "@/lib/adminRecordRefs";

type UserRow = {
  id: number;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  nrmsFinanceRole?: "NONE" | "OPERATOR" | "APPROVER" | string;
  createdAt?: string;
  twoFactorEnabled?: boolean;
  isDisabled?: boolean | null;
};

type Notice = { tone: "success" | "error"; title: string; message?: string };

type UserAuditRow = {
  id: number;
  action: string;
  details?: any;
  createdAt: string;
  admin?: { id: number; name?: string | null; email?: string | null };
};

const api = apiClient;

// The persisted role stays AGENT for backward compatibility; in the admin UI
// that account type is a tour-company operator.
const ROLES: Array<{ role: string; title: string; hint: string; icon: typeof User; text: string; ring: string; bar: string; soft: string; pill: string }> = [
  { role: "CUSTOMER", title: "Travellers", hint: "Book stays, tours and rides", icon: User, text: "text-emerald-700", ring: "ring-emerald-500", bar: "bg-emerald-500", soft: "bg-emerald-50/70", pill: "bg-emerald-50 text-emerald-700" },
  { role: "OWNER", title: "Owners", hint: "List properties", icon: Building2, text: "text-sky-700", ring: "ring-sky-500", bar: "bg-sky-500", soft: "bg-sky-50/70", pill: "bg-sky-50 text-sky-700" },
  { role: "DRIVER", title: "Drivers", hint: "Run transport trips", icon: Car, text: "text-cyan-700", ring: "ring-cyan-500", bar: "bg-cyan-500", soft: "bg-cyan-50/70", pill: "bg-cyan-50 text-cyan-700" },
  { role: "AGENT", title: "Operators", hint: "Tour companies", icon: Briefcase, text: "text-amber-700", ring: "ring-amber-500", bar: "bg-amber-400", soft: "bg-amber-50/70", pill: "bg-amber-50 text-amber-800" },
  { role: "ADMIN", title: "Admins", hint: "Platform administrators", icon: UserCog, text: "text-violet-700", ring: "ring-violet-500", bar: "bg-violet-500", soft: "bg-violet-50/70", pill: "bg-violet-50 text-violet-700" },
];

const FINANCE_ROLES = [
  { value: "NONE", label: "None", hint: "No finance actions" },
  { value: "OPERATOR", label: "Operator", hint: "Code-gated finance operations" },
  { value: "APPROVER", label: "Approver", hint: "Can approve high-risk finance actions" },
];

const heroButton =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 transition-colors hover:bg-white/[0.12] hover:text-white disabled:opacity-60";
const sectionLabel = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";

function roleMeta(role: string) {
  return ROLES.find((r) => r.role === String(role || "").toUpperCase()) ?? null;
}

function roleName(role: string) {
  return roleMeta(role)?.title.replace(/s$/, "") ?? (String(role || "").charAt(0) + String(role || "").slice(1).toLowerCase());
}

function initials(u: Pick<UserRow, "name" | "email" | "id">) {
  const source = (u.name || u.email || `#${u.id}`).trim();
  const parts = source.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

function joined(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function eat(iso: string) {
  return `${new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`;
}

function auditLabel(action: string) {
  if (action === "DISABLE_USER") return "Disabled account access";
  if (action === "ENABLE_USER") return "Restored account access";
  if (action === "RESET_2FA") return "Reset two-step sign-in";
  return action.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export default function Page() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ADMIN");
  const [countsByRole, setCountsByRole] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [financeRole, setFinanceRole] = useState("NONE");
  const [reset2FA, setReset2FA] = useState(false);
  const [pendingReset2FA, setPendingReset2FA] = useState(false);
  const [ackReset2FA, setAckReset2FA] = useState(false);
  const [disableUser, setDisableUser] = useState(false);
  const [pendingDisableUser, setPendingDisableUser] = useState(false);
  const [ackDisableUser, setAckDisableUser] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [dialogNotice, setDialogNotice] = useState<Notice | null>(null);
  const [auditRows, setAuditRows] = useState<UserAuditRow[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const deepLinkedUserIdRef = useRef<number | null>(null);

  const hasPendingConfirmation = pendingReset2FA || pendingDisableUser;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = { page, perPage };
      if (q) params.q = q;
      if (role) params.role = role;
      // /api/* so it never collides with Next pages under /admin/*.
      const res = await api.get("/api/admin/users", { params });
      setUsers(res.data.data || []);
      setTotal(res.data.meta?.total || 0);
      setCountsByRole(res.data.meta?.countsByRole || {});
    } catch (err) {
      console.error(err);
      setUsers([]);
      setTotal(0);
      setCountsByRole({});
      setNotice({ tone: "error", title: "Failed to load users", message: "Please try again in a moment." });
    } finally {
      setLoading(false);
    }
  }, [page, perPage, q, role]);

  useEffect(() => { void load(); }, [load]);

  // Typing should not fire a request per keystroke once the table is large.
  useEffect(() => {
    const id = window.setTimeout(() => {
      setQ(qInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(id);
  }, [qInput]);

  useEffect(() => {
    const userId = editing?.id;
    if (!userId) {
      setAuditRows([]);
      setAuditLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setAuditLoading(true);
      try {
        const r = await api.get<{ data: UserAuditRow[] }>(`/api/admin/users/${userId}/audit`, { params: { limit: 25 } });
        if (!cancelled) setAuditRows(Array.isArray(r.data?.data) ? r.data.data : []);
      } catch {
        if (!cancelled) setAuditRows([]);
      } finally {
        if (!cancelled) setAuditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [editing?.id]);

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setFinanceRole(String(u.nrmsFinanceRole || "NONE").toUpperCase());
    setReset2FA(false);
    setPendingReset2FA(false);
    setAckReset2FA(false);
    setDisableUser(Boolean(u.isDisabled));
    setPendingDisableUser(false);
    setAckDisableUser(false);
    setDialogNotice(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setFinanceRole("NONE");
    setReset2FA(false);
    setPendingReset2FA(false);
    setAckReset2FA(false);
    setDisableUser(false);
    setPendingDisableUser(false);
    setAckDisableUser(false);
    setDialogNotice(null);
  };

  useEffect(() => {
    if (!editing) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) closeEdit(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, saving]);

  // ?userId=us_... opens that account directly (used by links from other admin pages).
  const [linkedUser, setLinkedUser] = useState<string | null>(null);
  useEffect(() => {
    setLinkedUser(new URLSearchParams(window.location.search).get("userId"));
  }, []);
  const linkedUserId = useAdminQueryId("user", linkedUser, "userId");
  useEffect(() => {
    const requestedId = linkedUserId ?? 0;
    if (!requestedId || deepLinkedUserIdRef.current === requestedId) return;
    deepLinkedUserIdRef.current = requestedId;
    let cancelled = false;
    (async () => {
      try {
        const response = await api.get(`/api/admin/users/${requestedId}`);
        const requestedUser = response.data?.user as UserRow | undefined;
        if (cancelled || !requestedUser) return;
        setRole(String(requestedUser.role || "ADMIN").toUpperCase());
        openEdit(requestedUser);
      } catch {
        if (!cancelled) setNotice({ tone: "error", title: "Account could not be opened", message: `User #${requestedId} is unavailable or you no longer have access.` });
      }
    })();
    return () => { cancelled = true; };
    // Runs once per linked account; openEdit is stable for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedUserId]);

  const pendingChanges = editing
    ? [
        reset2FA ? "Reset two-step sign-in" : null,
        disableUser !== Boolean(editing.isDisabled) ? (disableUser ? "Disable access" : "Restore access") : null,
        financeRole !== String(editing.nrmsFinanceRole || "NONE").toUpperCase() ? `Finance access to ${financeRole.toLowerCase()}` : null,
      ].filter(Boolean) as string[]
    : [];

  async function saveEdit() {
    if (!editing) return;
    if (hasPendingConfirmation) {
      setDialogNotice({ tone: "error", title: "Confirm or cancel the pending action first." });
      return;
    }
    const body: any = {};
    // Only security, status and finance access change here; the role is fixed.
    if (reset2FA) body.reset2FA = true;
    if (disableUser !== Boolean(editing.isDisabled)) body.disable = disableUser;
    if (financeRole !== String(editing.nrmsFinanceRole || "NONE").toUpperCase()) body.nrmsFinanceRole = financeRole;
    if (Object.keys(body).length === 0) {
      setDialogNotice({ tone: "error", title: "Nothing to save yet", message: "Change a setting or confirm an action first." });
      return;
    }
    setSaving(true);
    try {
      await api.patch(`/api/admin/users/${editing.id}`, body);
      const who = editing.name || editing.email || `User #${editing.id}`;
      closeEdit();
      setNotice({ tone: "success", title: `${who} updated`, message: pendingChanges.join(", ") + "." });
      await load();
    } catch (err: unknown) {
      const apiMessage = axios.isAxiosError(err) ? (err.response?.data as any)?.error || (err.response?.data as any)?.message : undefined;
      setDialogNotice({
        tone: "error",
        title: typeof apiMessage === "string" ? apiMessage : "Unable to save this user right now.",
        message: typeof apiMessage === "string" ? "No changes were made." : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  const countsTotal = Object.values(countsByRole).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const count = (r: string) => Number(countsByRole?.[r] ?? 0);
  const partners = count("OWNER") + count("DRIVER") + count("AGENT");
  const activeRole = roleMeta(role);
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const pageTwoFa = users.filter((u) => u.twoFactorEnabled).length;
  const pageDisabled = users.filter((u) => u.isDisabled).length;

  const facts = [
    { label: "Accounts", value: String(countsTotal), detail: "across every role", tone: "text-white" },
    { label: "Travellers", value: String(count("CUSTOMER")), detail: countsTotal ? `${Math.round((count("CUSTOMER") / countsTotal) * 100)}% of accounts` : "none yet", tone: "text-emerald-300" },
    { label: "Partners", value: String(partners), detail: `${count("OWNER")} owners · ${count("DRIVER")} drivers · ${count("AGENT")} operators`, tone: "text-white" },
    { label: "Admins", value: String(count("ADMIN")), detail: "with platform access", tone: "text-white" },
  ];

  const pickRole = (next: string) => {
    setRole((current) => (current === next ? "" : next));
    setPage(1);
  };

  const meta = editing ? roleMeta(editing.role) : null;

  return (
    <div className="w-full min-w-0 space-y-5">
      {/* Header */}
      <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
        <div className="relative px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">People</p>
              <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">Users</h1>
              <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Every account on the platform. Open one to reset two-step sign-in, change finance access or disable it. Roles are fixed.</p>
            </div>
            <button type="button" onClick={() => void load()} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Refresh" title="Refresh">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>

          <dl className="m-0 mt-5 grid grid-cols-2 gap-y-4 border-0 border-t border-solid border-white/10 pt-4 lg:grid-cols-4 lg:gap-y-0">
            {facts.map((fact, index) => (
              <div key={fact.label} className={`min-w-0 pr-4 ${index % 2 === 1 ? "border-0 border-l border-solid border-white/10 pl-4 sm:pl-5" : ""} ${index === 2 ? "lg:border-0 lg:border-l lg:border-solid lg:border-white/10 lg:pl-5" : ""}`}>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{fact.label}</dt>
                <dd className={`m-0 mt-1.5 truncate text-xl font-bold leading-tight tabular-nums ${fact.tone}`}>{fact.value}</dd>
                <dd className="m-0 mt-1 truncate text-xs text-white/50">{fact.detail}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {notice && (
        <div className={`flex items-start gap-2 rounded-xl border border-solid px-4 py-3 text-sm ${notice.tone === "success" ? "border-emerald-200 bg-emerald-50/60 text-emerald-900" : "border-rose-200 bg-rose-50/60 text-rose-800"}`} role="status" aria-live="polite">
          {notice.tone === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />}
          <span className="flex-1"><span className="font-semibold">{notice.title}</span>{notice.message ? <span className="opacity-80"> {notice.message}</span> : null}</span>
          <button type="button" onClick={() => setNotice(null)} className={`border-0 bg-transparent p-0 text-xs font-semibold hover:underline ${notice.tone === "success" ? "text-emerald-700" : "text-rose-700"}`}>Dismiss</button>
        </div>
      )}

      {/* Roles: who is on the platform, doubling as the filter */}
      <section className="rounded-2xl border border-solid border-neutral-300 bg-white p-2 shadow-sm">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
          {ROLES.map((r) => {
            const Icon = r.icon;
            const n = count(r.role);
            const share = countsTotal ? Math.round((n / countsTotal) * 100) : 0;
            const selected = role === r.role;
            return (
              <button
                key={r.role}
                type="button"
                onClick={() => pickRole(r.role)}
                aria-pressed={selected}
                className={`min-w-0 rounded-xl border border-solid p-3.5 text-left transition-all ${selected ? `border-neutral-900 ${r.soft}` : "border-transparent bg-neutral-50 ring-1 ring-inset ring-neutral-200 hover:bg-white"}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${r.text}`}><Icon className="h-3.5 w-3.5" /> {r.title}</span>
                  <span className="text-[11px] tabular-nums text-neutral-400">{share}%</span>
                </span>
                <span className="mt-2 block text-2xl font-bold tabular-nums leading-none text-neutral-900">{n}</span>
                <span className="mt-1 block truncate text-[11px] text-neutral-500">{r.hint}</span>
                <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                  <span className={`block h-full rounded-full ${r.bar}`} style={{ width: `${n > 0 ? Math.max(share, 4) : 0}%` }} />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Directory */}
      <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <h2 className="m-0 text-sm font-bold text-neutral-900">{activeRole ? activeRole.title : "All accounts"}</h2>
            <p className="m-0 text-xs tabular-nums text-neutral-400">
              {loading ? "Loading..." : `${total} ${total === 1 ? "account" : "accounts"}${q ? ` matching "${q}"` : ""}${users.length ? ` · ${pageTwoFa} of ${users.length} shown use 2FA${pageDisabled ? ` · ${pageDisabled} disabled` : ""}` : ""}`}
            </p>
          </div>
          {role && (
            <button type="button" onClick={() => { setRole(""); setPage(1); }} className="inline-flex h-7 items-center gap-1 rounded-full border-0 bg-neutral-100 px-2.5 text-xs font-medium text-neutral-600 hover:bg-neutral-200">
              <X className="h-3 w-3" /> All roles
            </button>
          )}
          <div className="relative ml-auto w-full min-w-0 sm:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
            <input
              value={qInput}
              onChange={(e) => setQInput(e.target.value)}
              placeholder="Search name, email or phone"
              aria-label="Search users"
              className="box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white pl-9 pr-9 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15"
            />
            {qInput && (
              <button type="button" onClick={() => setQInput("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-left text-sm">
            <thead>
              <tr className="text-[11px] text-neutral-400">
                <th className="px-4 py-2.5 font-semibold sm:px-5">Account</th>
                <th className="px-3 py-2.5 font-semibold">Phone</th>
                <th className="px-3 py-2.5 font-semibold">Role</th>
                <th className="px-3 py-2.5 font-semibold">Two-step sign-in</th>
                <th className="px-3 py-2.5 font-semibold">Access</th>
                <th className="px-3 py-2.5 font-semibold">Joined</th>
                <th className="px-4 py-2.5 sm:px-5" />
              </tr>
            </thead>
            <tbody>
              {loading && users.length === 0 ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-0 border-t border-solid border-neutral-200">
                    <td colSpan={7} className="px-5 py-4"><div className="h-3 w-2/3 animate-pulse rounded-full bg-neutral-200/80" /></td>
                  </tr>
                ))
              ) : users.length === 0 ? (
                <tr className="border-0 border-t border-solid border-neutral-200">
                  <td colSpan={7} className="px-5 py-6 text-sm text-neutral-500">{q ? "No accounts match that search." : "No accounts in this role."}</td>
                </tr>
              ) : (
                users.map((u) => {
                  const r = roleMeta(u.role);
                  return (
                    <tr key={u.id} onClick={() => openEdit(u)} className="cursor-pointer border-0 border-t border-solid border-neutral-200 transition-colors hover:bg-neutral-50/80">
                      <td className="px-4 py-3 sm:px-5">
                        <div className="flex items-center gap-3">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ring-2 ring-offset-2 ${u.isDisabled ? "bg-neutral-200 text-neutral-500 ring-neutral-300" : `bg-neutral-900 text-white ${r?.ring ?? "ring-neutral-300"}`}`}>
                            {initials(u)}
                          </span>
                          <div className="min-w-0">
                            <div className={`truncate font-medium ${u.isDisabled ? "text-neutral-400" : "text-neutral-900"}`}>{u.name || "Name not set"}</div>
                            <div className="truncate text-xs text-neutral-400">{u.email || "No email"} · #{u.id}</div>
                          </div>
                        </div>
                      </td>
                      <td className={`whitespace-nowrap px-3 py-3 tabular-nums ${u.phone ? "text-neutral-700" : "text-neutral-400"}`}>{u.phone || "Not set"}</td>
                      <td className="px-3 py-3"><span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${r?.pill ?? "bg-neutral-100 text-neutral-600"}`}>{roleName(u.role)}</span></td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.twoFactorEnabled ? "text-emerald-700" : "text-neutral-400"}`}>
                          {u.twoFactorEnabled ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
                          {u.twoFactorEnabled ? "On" : "Off"}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${u.isDisabled ? "text-rose-600" : "text-neutral-700"}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${u.isDisabled ? "bg-rose-500" : "bg-emerald-500"}`} />
                          {u.isDisabled ? "Disabled" : "Active"}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-neutral-500">{joined(u.createdAt) || "Unknown"}</td>
                      <td className="px-4 py-3 text-right sm:px-5"><ChevronRight className="ml-auto h-4 w-4 text-neutral-300" /></td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3 sm:px-5">
          <span className="text-xs text-neutral-500">
            {total === 0 ? "No accounts" : <>Showing <span className="font-semibold tabular-nums text-neutral-900">{(page - 1) * perPage + 1} to {Math.min(page * perPage, total)}</span> of <span className="font-semibold tabular-nums text-neutral-900">{total}</span></>}
          </span>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-xs text-neutral-500">
              <span className="hidden sm:inline">Rows</span>
              <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} aria-label="Rows per page" className="box-border h-8 rounded-lg border border-solid border-neutral-300 bg-white px-2 text-xs text-neutral-700 outline-none focus:border-emerald-500">
                {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1 || loading} aria-label="Previous page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs tabular-nums text-neutral-500">Page <span className="font-semibold text-neutral-900">{page}</span> of <span className="font-semibold text-neutral-900">{totalPages}</span></span>
            <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages || loading} aria-label="Next page" className="grid h-8 w-8 place-items-center rounded-lg border border-solid border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50 disabled:opacity-40">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* Account dialog */}
      {editing && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={`Account ${editing.id}`} onClick={() => !saving && closeEdit()}>
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-3.5">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-semibold ring-2 ring-offset-2 ${editing.isDisabled ? "bg-neutral-200 text-neutral-500 ring-neutral-300" : `bg-neutral-900 text-white ${meta?.ring ?? "ring-neutral-300"}`}`}>{initials(editing)}</span>
              <div className="min-w-0 flex-1">
                <h2 className="m-0 truncate text-sm font-bold text-neutral-900">{editing.name || "Name not set"}</h2>
                <p className="m-0 flex flex-wrap items-center gap-x-2 text-xs text-neutral-400">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${meta?.pill ?? "bg-neutral-100 text-neutral-600"}`}>{roleName(editing.role)}</span>
                  <span>Account #{editing.id}</span>
                </p>
              </div>
              <button type="button" onClick={closeEdit} disabled={saving} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <dl className="m-0 flex flex-wrap gap-px border-0 border-b border-solid border-neutral-200 bg-neutral-200">
                {[
                  { label: "Email", value: editing.email || "Not set" },
                  { label: "Phone", value: editing.phone || "Not set" },
                  { label: "Joined", value: joined(editing.createdAt) || "Unknown" },
                  { label: "Two-step sign-in", value: editing.twoFactorEnabled ? "On" : "Off", tone: editing.twoFactorEnabled ? "text-emerald-700" : "text-neutral-500" },
                  { label: "Access", value: editing.isDisabled ? "Disabled" : "Active", tone: editing.isDisabled ? "text-rose-600" : "text-emerald-700" },
                ].map((f) => (
                  <div key={f.label} className="min-w-[150px] flex-1 bg-white px-4 py-3">
                    <dt className={sectionLabel}>{f.label}</dt>
                    <dd className={`m-0 mt-1 truncate text-sm font-semibold ${f.tone ?? "text-neutral-900"}`} title={f.value}>{f.value}</dd>
                  </div>
                ))}
              </dl>

              {dialogNotice && (
                <div className={`mx-5 mt-4 flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${dialogNotice.tone === "success" ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800"}`} role="alert">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span><span className="font-semibold">{dialogNotice.title}</span>{dialogNotice.message ? ` ${dialogNotice.message}` : ""}</span>
                </div>
              )}

              {/* Security */}
              <div className="px-5 py-4">
                <p className={sectionLabel}>Security</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-100 text-neutral-600"><KeyRound className="h-4 w-4" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Reset two-step sign-in</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-500">Clears their authenticator so they must set it up again. Use when a phone is lost.</p>
                  </div>
                  {reset2FA ? (
                    <button type="button" onClick={() => setReset2FA(false)} className="inline-flex h-8 items-center gap-1 rounded-lg border-0 bg-amber-50 px-2.5 text-xs font-semibold text-amber-800 hover:bg-amber-100">
                      <Check className="h-3.5 w-3.5" /> Will reset <X className="h-3 w-3 opacity-60" />
                    </button>
                  ) : (
                    <button type="button" onClick={() => { setPendingReset2FA(true); setAckReset2FA(false); }} disabled={pendingReset2FA} className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-40">
                      Reset
                    </button>
                  )}
                </div>
                {pendingReset2FA && (
                  <div className="mt-3 rounded-lg bg-amber-50/80 px-3.5 py-3 ring-1 ring-inset ring-amber-200">
                    <p className="m-0 text-xs text-amber-900">They will sign in with a password only until they set up two-step sign-in again.</p>
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-amber-900">
                      <input type="checkbox" checked={ackReset2FA} onChange={(e) => setAckReset2FA(e.target.checked)} className="mt-0.5 h-4 w-4" />
                      <span>I have confirmed who asked for this and I am authorised to do it.</span>
                    </label>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button type="button" onClick={() => { setPendingReset2FA(false); setAckReset2FA(false); }} className="inline-flex h-8 items-center rounded-lg border border-solid border-amber-300 bg-white px-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-50">Cancel</button>
                      <button type="button" disabled={!ackReset2FA} onClick={() => { setReset2FA(true); setPendingReset2FA(false); }} className="inline-flex h-8 items-center gap-1 rounded-lg border-0 bg-amber-600 px-2.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"><Check className="h-3.5 w-3.5" /> Confirm reset</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Finance access, admins only */}
              {editing.role === "ADMIN" && (
                <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                  <p className={sectionLabel}>NRMS finance access</p>
                  <p className="m-0 mt-1 text-xs text-neutral-500">Separate from the admin role. High-risk finance actions need Approver.</p>
                  <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="NRMS finance access">
                    {FINANCE_ROLES.map((f) => {
                      const selected = financeRole === f.value;
                      return (
                        <button key={f.value} type="button" role="radio" aria-checked={selected} onClick={() => setFinanceRole(f.value)} className={`rounded-lg border border-solid px-3 py-2.5 text-left transition-colors ${selected ? "border-neutral-900 bg-neutral-50" : "border-neutral-300 bg-white hover:bg-neutral-50"}`}>
                          <span className="block text-sm font-semibold text-neutral-900">{f.label}</span>
                          <span className="block text-[11px] text-neutral-500">{f.hint}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Status */}
              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <p className={sectionLabel}>Access</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${disableUser ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-700"}`}>{disableUser ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">{disableUser ? "Access will be disabled" : "Account can sign in"}</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-500">{disableUser ? "They are refused at sign-in and on protected pages once you save." : "Disabling stops sign-in and access to protected areas."}</p>
                  </div>
                  {disableUser ? (
                    <button type="button" onClick={() => setDisableUser(false)} className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-700 hover:bg-neutral-50">
                      {editing.isDisabled ? "Restore access" : "Keep active"}
                    </button>
                  ) : (
                    <button type="button" onClick={() => { setPendingDisableUser(true); setAckDisableUser(false); }} disabled={pendingDisableUser} className="inline-flex h-8 items-center rounded-lg border border-solid border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                      Disable
                    </button>
                  )}
                </div>
                {pendingDisableUser && (
                  <div className="mt-3 rounded-lg bg-rose-50/80 px-3.5 py-3 ring-1 ring-inset ring-rose-200">
                    <p className="m-0 text-xs text-rose-900">They will be refused at sign-in and on protected pages. Sessions already open may stop working straight away.</p>
                    <label className="mt-2 flex cursor-pointer items-start gap-2 text-xs text-rose-900">
                      <input type="checkbox" checked={ackDisableUser} onChange={(e) => setAckDisableUser(e.target.checked)} className="mt-0.5 h-4 w-4" />
                      <span>I understand the impact and I am authorised to disable this account.</span>
                    </label>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button type="button" onClick={() => { setPendingDisableUser(false); setAckDisableUser(false); }} className="inline-flex h-8 items-center rounded-lg border border-solid border-rose-300 bg-white px-2.5 text-xs font-semibold text-rose-900 hover:bg-rose-50">Cancel</button>
                      <button type="button" disabled={!ackDisableUser} onClick={() => { setDisableUser(true); setPendingDisableUser(false); }} className="inline-flex h-8 items-center gap-1 rounded-lg border-0 bg-rose-600 px-2.5 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"><Check className="h-3.5 w-3.5" /> Confirm disable</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Audit history */}
              <div className="border-0 border-t border-solid border-neutral-200 px-5 py-4">
                <p className={sectionLabel}>History</p>
                {auditLoading ? (
                  <p className="m-0 mt-2 flex items-center gap-2 text-xs text-neutral-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading history</p>
                ) : auditRows.length === 0 ? (
                  <p className="m-0 mt-2 text-xs text-neutral-500">No access or security changes recorded for this account.</p>
                ) : (
                  <ol className="m-0 mt-2 list-none p-0">
                    {auditRows.map((row, i) => {
                      const actor = row.admin?.name || row.admin?.email || (row.admin?.id ? `Admin #${row.admin.id}` : "Admin");
                      return (
                        <li key={row.id} className={`flex items-start justify-between gap-3 py-2.5 ${i ? "border-0 border-t border-solid border-neutral-200" : ""}`}>
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-neutral-900">{auditLabel(row.action)}</span>
                            <span className="block text-xs text-neutral-500">By {actor}</span>
                          </span>
                          <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{row.createdAt ? eat(row.createdAt) : ""}</span>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/80 px-5 py-3">
              <span className="min-w-0 flex-1 truncate text-xs text-neutral-500">
                {hasPendingConfirmation ? "Confirm or cancel the action above first." : pendingChanges.length ? `Will save: ${pendingChanges.join(", ")}` : "No changes yet"}
              </span>
              <button type="button" onClick={closeEdit} disabled={saving} className="inline-flex h-9 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">Close</button>
              <button type="button" onClick={() => void saveEdit()} disabled={saving || hasPendingConfirmation || pendingChanges.length === 0} className="inline-flex h-9 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:opacity-50">
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
