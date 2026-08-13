"use client";
import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";import apiClient from "@/lib/apiClient";
import TableRow from "@/components/TableRow";
import { Users, ChevronLeft, ChevronRight, Eye, Search, X, Check, CheckCircle2 } from "lucide-react";

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

const api = apiClient;

type Notice = {
  tone: "success" | "error";
  title: string;
  message?: string;
};

type UserAuditRow = {
  id: number;
  action: string;
  details?: any;
  createdAt: string;
  admin?: { id: number; name?: string | null; email?: string | null };
};

const ROLE_CARDS: Array<{ role: string; title: string; subtitle: string }> = [
  { role: "ADMIN", title: "Admins", subtitle: "Platform administrators" },
  { role: "CUSTOMER", title: "Customers", subtitle: "Bookings and payments" },
  { role: "OWNER", title: "Owners", subtitle: "Property partners" },
  { role: "DRIVER", title: "Drivers", subtitle: "Transport operations" },
  // The persisted role remains AGENT for backward compatibility, but this
  // account type represents tour-company operators in the admin UI.
  { role: "AGENT", title: "Operators", subtitle: "Tour companies" },
];

function roleLabel(role: string): string {
  return String(role || "").toUpperCase() === "AGENT" ? "OPERATOR" : String(role || "").toUpperCase();
}

export default function Page() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("ADMIN");
  const [countsByRole, setCountsByRole] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editingOriginalRole, setEditingOriginalRole] = useState<string | null>(null);
  const [financeRole, setFinanceRole] = useState("NONE");
  const [reset2FA, setReset2FA] = useState(false);
  const [pendingReset2FA, setPendingReset2FA] = useState(false);
  const [ackReset2FA, setAckReset2FA] = useState(false);
  const [disableUser, setDisableUser] = useState(false);
  const [pendingDisableUser, setPendingDisableUser] = useState(false);
  const [ackDisableUser, setAckDisableUser] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
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
      // Use /api/* to avoid colliding with Next pages under /admin/*.
      const res = await api.get('/api/admin/users', { params });
      setUsers(res.data.data || []);
      setTotal(res.data.meta?.total || 0);
      setCountsByRole(res.data.meta?.countsByRole || {});
    } catch (err) {
      console.error(err);
      setUsers([]);
      setTotal(0);
      setCountsByRole({});
      setNotice({
        tone: "error",
        title: "Failed to load users",
        message: "Please try again in a moment.",
      });
    } finally {
      setLoading(false);
    }
  }, [page, perPage, q, role]);

  useEffect(() => { load(); }, [load]);

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
        if (cancelled) return;
        setAuditRows(Array.isArray(r.data?.data) ? r.data.data : []);
      } catch (e) {
        if (cancelled) return;
        setAuditRows([]);
      } finally {
        if (cancelled) return;
        setAuditLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [editing?.id]);

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setEditingOriginalRole(u.role);
    setFinanceRole(String(u.nrmsFinanceRole || "NONE").toUpperCase());
    setReset2FA(false);
    setPendingReset2FA(false);
    setAckReset2FA(false);
    setDisableUser(Boolean(u.isDisabled));
    setPendingDisableUser(false);
    setAckDisableUser(false);
    setNotice(null);
  };

  const closeEdit = () => {
    setEditing(null);
    setEditingOriginalRole(null);
    setFinanceRole("NONE");
    setReset2FA(false);
    setPendingReset2FA(false);
    setAckReset2FA(false);
    setDisableUser(false);
    setPendingDisableUser(false);
    setAckDisableUser(false);
  };

  useEffect(() => {
    const requestedId = Number(new URLSearchParams(window.location.search).get("userId"));
    if (!Number.isInteger(requestedId) || requestedId <= 0 || deepLinkedUserIdRef.current === requestedId) return;
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
        if (cancelled) return;
        setNotice({
          tone: "error",
          title: "Account could not be opened",
          message: `User #${requestedId} is unavailable or you no longer have access.`,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  async function saveEdit() {
    if (!editing) return;
    if (hasPendingConfirmation) {
      setNotice({
        tone: "error",
        title: "Confirmation required",
        message: "Please confirm or cancel the pending security/status action before saving.",
      });
      return;
    }
    try {
      const body: any = {};
      // Only allow security/status actions here (role is pinned/read-only).
      if (reset2FA) body.reset2FA = true;

      const originalDisabled = Boolean(editing.isDisabled);
      if (disableUser !== originalDisabled) body.disable = disableUser;
      const originalFinanceRole = String(editing.nrmsFinanceRole || "NONE").toUpperCase();
      if (financeRole !== originalFinanceRole) body.nrmsFinanceRole = financeRole;

      if (Object.keys(body).length === 0) {
        setNotice({
          tone: "error",
          title: "No changes to save",
          message: "Update a setting (or confirm an action) before saving.",
        });
        return;
      }
      await api.patch(`/api/admin/users/${editing.id}`, body);
      await load();
      closeEdit();
      setNotice({ tone: "success", title: "User updated successfully", message: "The access and security changes have been saved." });
    } catch (err: unknown) {
      const apiMessage = axios.isAxiosError(err)
        ? (err.response?.data as any)?.error || (err.response?.data as any)?.message
        : undefined;
      const message = typeof apiMessage === "string" ? apiMessage : "Unable to save this user right now.";
      setNotice({
        tone: "error",
        title: message,
        message: typeof apiMessage === "string" ? "No changes were made." : "Please try again.",
      });
    }
  }

  function getRoleBadgeClass(role: string) {
    const roleLower = role.toLowerCase();
    if (roleLower === 'admin') {
      return "inline-flex items-center px-2 py-1 rounded-md bg-purple-50 text-purple-700 text-xs font-medium";
    }
    if (roleLower === 'owner') {
      return "inline-flex items-center px-2 py-1 rounded-md bg-blue-50 text-blue-700 text-xs font-medium";
    }
    if (roleLower === 'driver') {
      return "inline-flex items-center px-2 py-1 rounded-md bg-cyan-50 text-cyan-700 text-xs font-medium";
    }
    if (roleLower === 'agent') {
      return "inline-flex items-center px-2 py-1 rounded-md bg-amber-50 text-amber-800 text-xs font-medium";
    }
    if (roleLower === 'customer') {
      return "inline-flex items-center px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium";
    }
    return "inline-flex items-center px-2 py-1 rounded-md bg-gray-50 text-gray-700 text-xs font-medium";
  }

  function getTableTheme(activeRole: string) {
    if (activeRole === 'ADMIN') {
      return {
        wrapper: "border-purple-200/60 dark:border-purple-400/20",
        header: "bg-gradient-to-r from-purple-50/80 via-slate-50/60 to-white dark:from-purple-400/10 dark:via-slate-900/40 dark:to-slate-950/20",
        rowHover: "hover:bg-purple-50/50 dark:hover:bg-purple-400/5",
        actionHover: "hover:border-purple-300/70 hover:text-purple-700 dark:hover:border-purple-400/30 dark:hover:text-purple-200",
        accentBar: "from-purple-400/60 via-purple-300/30 to-transparent dark:from-purple-300/40 dark:via-purple-200/10",
      };
    }
    if (activeRole === 'OWNER') {
      return {
        wrapper: "border-blue-200/60 dark:border-blue-400/20",
        header: "bg-gradient-to-r from-blue-50/80 via-slate-50/60 to-white dark:from-blue-400/10 dark:via-slate-900/40 dark:to-slate-950/20",
        rowHover: "hover:bg-blue-50/45 dark:hover:bg-blue-400/5",
        actionHover: "hover:border-blue-300/70 hover:text-blue-700 dark:hover:border-blue-400/30 dark:hover:text-blue-200",
        accentBar: "from-blue-400/60 via-blue-300/30 to-transparent dark:from-blue-300/40 dark:via-blue-200/10",
      };
    }
    if (activeRole === 'DRIVER') {
      return {
        wrapper: "border-cyan-200/60 dark:border-cyan-400/20",
        header: "bg-gradient-to-r from-cyan-50/80 via-slate-50/60 to-white dark:from-cyan-400/10 dark:via-slate-900/40 dark:to-slate-950/20",
        rowHover: "hover:bg-cyan-50/45 dark:hover:bg-cyan-400/5",
        actionHover: "hover:border-cyan-300/70 hover:text-cyan-700 dark:hover:border-cyan-400/30 dark:hover:text-cyan-200",
        accentBar: "from-cyan-400/60 via-cyan-300/30 to-transparent dark:from-cyan-300/40 dark:via-cyan-200/10",
      };
    }
    if (activeRole === 'AGENT') {
      return {
        wrapper: "border-amber-200/70 dark:border-amber-400/20",
        header: "bg-gradient-to-r from-amber-50/80 via-slate-50/60 to-white dark:from-amber-400/10 dark:via-slate-900/40 dark:to-slate-950/20",
        rowHover: "hover:bg-amber-50/45 dark:hover:bg-amber-400/5",
        actionHover: "hover:border-amber-300/80 hover:text-amber-800 dark:hover:border-amber-400/30 dark:hover:text-amber-200",
        accentBar: "from-amber-400/60 via-amber-300/30 to-transparent dark:from-amber-300/40 dark:via-amber-200/10",
      };
    }
    // CUSTOMER (default) + ALL roles
    return {
      wrapper: activeRole === 'CUSTOMER' ? "border-emerald-200/60 dark:border-emerald-400/20" : "border-slate-200/60 dark:border-slate-700/60",
      header:
        activeRole === 'CUSTOMER'
          ? "bg-gradient-to-r from-emerald-50/80 via-slate-50/60 to-white dark:from-emerald-400/10 dark:via-slate-900/40 dark:to-slate-950/20"
          : "bg-slate-50/70 dark:bg-slate-900/40",
      rowHover: activeRole === 'CUSTOMER' ? "hover:bg-emerald-50/45 dark:hover:bg-emerald-400/5" : "hover:bg-slate-50/70 dark:hover:bg-slate-900/30",
      actionHover:
        activeRole === 'CUSTOMER'
          ? "hover:border-emerald-300/70 hover:text-[#02665e] dark:hover:border-emerald-400/30 dark:hover:text-emerald-200"
          : "hover:border-[#02665e]/40 hover:text-[#02665e] dark:hover:border-slate-600/60 dark:hover:text-slate-100",
      accentBar: activeRole === 'CUSTOMER' ? "from-emerald-400/60 via-emerald-300/30 to-transparent dark:from-emerald-300/40 dark:via-emerald-200/10" : "from-slate-400/40 via-slate-300/20 to-transparent dark:from-slate-300/20 dark:via-slate-200/5",
    };
  }

  const countsTotal = Object.values(countsByRole).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const tableTheme = getTableTheme(role);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white/70 shadow-sm backdrop-blur">
        <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50" />
        <div className="relative p-6">
          <div className="flex flex-col items-center text-center">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-emerald-50 to-slate-50 border border-slate-200/60 flex items-center justify-center shadow-sm">
              <Users className="h-7 w-7 text-[#02665e]" />
            </div>
            <h1 className="mt-4 text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
              Users
            </h1>
            <p className="mt-1 text-sm text-slate-600">Manage platform users</p>
          </div>
        </div>
      </div>

      {notice && !editing ? (
        <div
          className={
            notice.tone === "success"
              ? "rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 shadow-sm"
              : "rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 shadow-sm"
          }
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            {notice.tone === "success" ? <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700"><CheckCircle2 className="h-4 w-4" /></span> : null}
            <div>
              <div className="text-sm font-semibold">{notice.title}</div>
              {notice.message ? <div className="mt-0.5 text-sm opacity-90">{notice.message}</div> : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-3xl border border-slate-200/60 bg-white/70 p-4 shadow-sm backdrop-blur overflow-hidden">
        <div className="max-w-6xl mx-auto space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {ROLE_CARDS.map((c) => {
              const active = role === c.role;
              const count = Number(countsByRole?.[c.role] ?? 0);
              const pct = countsTotal > 0 ? Math.max(0, Math.min(100, (count / countsTotal) * 100)) : 0;
              return (
                <button
                  key={c.role}
                  type="button"
                  onClick={() => {
                    setRole((prev) => (prev === c.role ? "" : c.role));
                    setPage(1);
                  }}
                  className={
                    active
                      ? "group relative text-left rounded-3xl border border-[#02665e]/35 bg-gradient-to-br from-emerald-50/80 via-white/75 to-slate-50/60 p-4 shadow-sm ring-1 ring-[#02665e]/15 transition-all duration-300 ease-out hover:-translate-y-px hover:shadow-md dark:border-emerald-400/25 dark:bg-gradient-to-br dark:from-emerald-400/10 dark:via-slate-950/30 dark:to-slate-900/40 dark:ring-emerald-400/10"
                      : "group relative text-left rounded-3xl border border-slate-200/70 bg-white/60 p-4 shadow-sm transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#02665e]/25 hover:bg-white/75 hover:shadow-md dark:border-slate-700/60 dark:bg-slate-950/25 dark:hover:bg-slate-950/35"
                  }
                  aria-pressed={active}
                  title={active ? "Click to show all roles" : `Show ${c.title}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-50">{c.title}</div>
                    <div
                      className={
                        active
                          ? "text-sm font-semibold text-[#02665e] dark:text-emerald-300"
                          : "text-sm font-semibold text-slate-700 dark:text-slate-200"
                      }
                      aria-label={`${count} ${c.title}`}
                    >
                      {count}
                    </div>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{c.subtitle}</div>

                  <div
                    className="relative mt-3 h-2 w-full rounded-full bg-slate-200/70 overflow-hidden ring-1 ring-black/5 dark:bg-slate-800/70 dark:ring-white/10"
                    aria-hidden="true"
                  >
                    <div
                      className={
                        active
                          ? "h-full bg-gradient-to-r from-[#02665e] via-emerald-400 to-emerald-200 dark:from-emerald-400 dark:via-emerald-300 dark:to-emerald-200"
                          : "h-full bg-gradient-to-r from-slate-500/60 to-slate-300/40 dark:from-slate-400/60 dark:to-slate-200/20"
                      }
                      style={{ width: `${pct}%` }}
                    />
                    <div
                      className={
                        active
                          ? "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-[#02665e]/35 shadow-sm dark:bg-slate-950 dark:ring-emerald-300/35"
                          : "absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white ring-2 ring-slate-400/25 shadow-sm dark:bg-slate-950 dark:ring-slate-200/20"
                      }
                      style={{ left: `${pct}%` }}
                    />
                  </div>

                  {active ? (
                    <div className="pointer-events-none absolute inset-x-4 -bottom-1 h-[3px] rounded-full bg-gradient-to-r from-[#02665e]/70 via-emerald-300/60 to-transparent" />
                  ) : null}
                </button>
              );
            })}
          </div>

          <div className="relative w-full sm:max-w-2xl mx-auto">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="w-full pl-10 pr-10 py-2.5 border border-slate-200/70 rounded-2xl text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all duration-300 bg-white hover:border-slate-300"
              placeholder="Search name, email or phone"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
            {q ? (
              <button
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                onClick={() => {
                  setQ("");
                  setPage(1);
                }}
                title="Clear search"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className={`bg-white/70 dark:bg-slate-950/25 rounded-3xl border ${tableTheme.wrapper} shadow-sm overflow-hidden backdrop-blur transition-all duration-300 hover:shadow-md`}>
        <div className={`h-[3px] bg-gradient-to-r ${tableTheme.accentBar}`} aria-hidden="true" />
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className={tableTheme.header}>
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">ID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Email</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Phone</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">2FA</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Disabled</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-slate-500 dark:text-slate-300 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
            <tbody className="bg-white/60 dark:bg-slate-950/10 divide-y divide-slate-200 dark:divide-slate-800 transition-colors duration-300">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} hover={false} className="animate-pulse">
                    <td className="px-4 py-4" colSpan={8}>
                      <div className="grid grid-cols-8 gap-4 items-center">
                        <div className="col-span-1 h-3 rounded-full bg-slate-200/80 dark:bg-slate-800/70" />
                        <div className="col-span-2 h-3 rounded-full bg-slate-200/80 dark:bg-slate-800/70" />
                        <div className="col-span-2 h-3 rounded-full bg-slate-200/80 dark:bg-slate-800/70" />
                        <div className="col-span-1 h-3 rounded-full bg-slate-200/80 dark:bg-slate-800/70" />
                        <div className="col-span-1 h-6 rounded-xl bg-slate-200/80 dark:bg-slate-800/70" />
                        <div className="col-span-1 h-9 rounded-2xl bg-slate-200/80 dark:bg-slate-800/70" />
                      </div>
                    </td>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
                <TableRow hover={false}>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500 dark:text-slate-300 transition-opacity duration-300">
                    No users found
                  </td>
                </TableRow>
              ) : (
                users.map((u) => (
                  <TableRow
                    key={u.id}
                    hover={false}
                    className={`transition-colors duration-200 ${tableTheme.rowHover}`}
                  >
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-50 whitespace-nowrap">
                      {u.id}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900 dark:text-slate-50 font-medium">
                      {u.name || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                      {u.email || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-700 dark:text-slate-200">
                      {u.phone || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span className={getRoleBadgeClass(u.role)}>{roleLabel(u.role)}</span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {u.twoFactorEnabled ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium dark:bg-emerald-400/10 dark:text-emerald-200 dark:border dark:border-emerald-400/20">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-50 text-gray-700 text-xs font-medium dark:bg-slate-800/50 dark:text-slate-200 dark:border dark:border-slate-700/60">
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {u.isDisabled ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-red-50 text-red-700 text-xs font-medium dark:bg-red-400/10 dark:text-red-200 dark:border dark:border-red-400/20">
                          Yes
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-green-50 text-green-700 text-xs font-medium dark:bg-emerald-400/10 dark:text-emerald-200 dark:border dark:border-emerald-400/20">
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <button
                        type="button"
                        className={`h-9 w-9 inline-flex items-center justify-center border border-slate-200 rounded-2xl text-slate-600 bg-white/70 hover:bg-slate-50 transition-all duration-200 active:scale-[0.99] hover:scale-[1.03] touch-manipulation cursor-pointer dark:border-slate-700/60 dark:bg-slate-950/25 dark:text-slate-200 dark:hover:bg-slate-950/35 ${tableTheme.actionHover}`}
                        onClick={() => openEdit(u)}
                        aria-label={`View user ${u.id}`}
                        title="View"
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </TableRow>
                ))
              )}
            </tbody>
            </table>
        </div>
          </div>

      <div className="flex items-center justify-between bg-white rounded-3xl border border-slate-200/60 p-4 shadow-sm">
        <div className="text-sm text-gray-600">
          Total: <span className="font-semibold text-gray-900">{total}</span>
        </div>
            <div className="flex items-center gap-2">
          <button 
            className="p-2 border border-slate-200 rounded-2xl hover:border-[#02665e]/40 hover:text-[#02665e] transition-all duration-200 active:scale-[0.99] touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
            onClick={()=>setPage(p=>Math.max(1,p-1))} 
            disabled={page<=1 || loading}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="text-sm text-gray-600">
            Page <span className="font-semibold text-gray-900">{page}</span>
          </div>
          <button 
            className="p-2 border border-slate-200 rounded-2xl hover:border-[#02665e]/40 hover:text-[#02665e] transition-all duration-200 active:scale-[0.99] touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center cursor-pointer"
            onClick={()=>setPage(p=>p+1)} 
            disabled={page*perPage >= total || loading}
            aria-label="Next page"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="relative w-full max-w-2xl max-h-[85vh] rounded-3xl shadow-[0_18px_80px_-45px_rgba(2,102,94,0.45)] ring-1 ring-black/10">
            <div className="pointer-events-none absolute -inset-[1px] rounded-3xl bg-gradient-to-r from-[#02665e]/35 via-slate-200/45 to-emerald-200/35 opacity-90 blur-[1px]" />
            <div className="relative p-[2px] rounded-3xl bg-gradient-to-br from-[#02665e]/40 via-slate-200/80 to-slate-400/30">
              <div className="bg-white/80 backdrop-blur-xl rounded-3xl border border-white/50 overflow-hidden max-h-[85vh] flex flex-col">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-100" />
              <div className="relative px-5 py-4 border-b border-slate-200/80 bg-white/30 backdrop-blur">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-2xl border border-white/50 bg-gradient-to-br from-white via-white to-slate-100 shadow-sm flex items-center justify-center ring-1 ring-black/5">
                      <Users className="h-5 w-5 text-[#02665e]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="text-base sm:text-lg font-semibold text-slate-900 tracking-tight">
                        Edit user
                      </h3>
                      <p className="mt-0.5 text-sm text-slate-600">Update access, security, and account status</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={closeEdit}
                    className="h-10 w-10 rounded-2xl border border-white/50 bg-white/50 backdrop-blur text-slate-500 hover:text-slate-700 hover:bg-white/80 transition-all duration-200 active:scale-[0.99] flex items-center justify-center ring-1 ring-black/5"
                    aria-label="Close"
                    title="Close"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>
            </div>

            <div className="p-5 overflow-y-auto flex-1">
              {notice ? (
                <div
                  className={
                    notice.tone === "success"
                      ? "mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-800 shadow-sm"
                      : "mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 shadow-sm"
                  }
                  role={notice.tone === "error" ? "alert" : "status"}
                  aria-live="polite"
                >
                  <div className="text-sm font-semibold">{notice.title}</div>
                  {notice.message ? <div className="mt-0.5 text-sm opacity-90">{notice.message}</div> : null}
                </div>
              ) : null}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-4">
                  <div className="group rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white/85 to-slate-50/70 backdrop-blur shadow-sm overflow-hidden ring-1 ring-black/5 transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#02665e]/30 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-slate-200/70 bg-gradient-to-r from-[#02665e]/12 via-slate-50/70 to-white transition-colors duration-300">
                      <div className="text-sm font-semibold text-slate-900">Profile</div>
                      <div className="mt-0.5 text-xs text-slate-600">Read-only identity details</div>
                    </div>

                    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</div>
                        <div className="mt-2 text-sm text-slate-900 bg-gradient-to-br from-white/90 to-slate-50/60 px-3 py-2 rounded-2xl border border-slate-200/80 shadow-sm transition-all duration-300 ease-out hover:from-white hover:to-emerald-50/30 hover:border-[#02665e]/30">
                          {editing.name || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</div>
                        <div className="mt-2 text-sm text-slate-900 bg-gradient-to-br from-white/90 to-slate-50/60 px-3 py-2 rounded-2xl border border-slate-200/80 shadow-sm break-all transition-all duration-300 ease-out hover:from-white hover:to-emerald-50/30 hover:border-[#02665e]/30">
                          {editing.email || "—"}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</div>
                        <div className="mt-2 text-sm text-slate-900 bg-gradient-to-br from-white/90 to-slate-50/60 px-3 py-2 rounded-2xl border border-slate-200/80 shadow-sm transition-all duration-300 ease-out hover:from-white hover:to-emerald-50/30 hover:border-[#02665e]/30">
                          {editing.phone || "—"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">2FA</div>
                          <div className="mt-2">
                            {editing.twoFactorEnabled ? (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-semibold border border-emerald-200 transition-colors duration-300 hover:bg-emerald-100/60">
                                Enabled
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2.5 py-1 rounded-xl bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 transition-colors duration-300 hover:bg-slate-100/70">
                                Disabled
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="group rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white/85 to-slate-50/70 backdrop-blur shadow-sm overflow-hidden ring-1 ring-black/5 transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#02665e]/30 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-slate-200/70 bg-gradient-to-r from-[#02665e]/12 via-slate-50/70 to-white transition-colors duration-300">
                      <div className="text-sm font-semibold text-slate-900">Security</div>
                      <div className="mt-0.5 text-xs text-slate-600">Account protection actions</div>
                    </div>

                    <div className="p-4">
                      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white/90 to-slate-50/60 shadow-sm overflow-hidden">
                        <label className="flex items-center justify-between gap-4 cursor-pointer px-3.5 py-2.5 transition-all duration-300 ease-out hover:from-white hover:to-emerald-50/25">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">Reset 2FA</div>
                            <div className="mt-0.5 text-xs text-slate-600">Clear secret and disable two-factor authentication</div>
                          </div>
                          <div className="flex items-center flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={reset2FA}
                              onChange={(e) => {
                                const next = e.target.checked;
                                if (next) {
                                  setPendingReset2FA(true);
                                  setAckReset2FA(false);
                                  setReset2FA(false);
                                  return;
                                }
                                setPendingReset2FA(false);
                                setAckReset2FA(false);
                                setReset2FA(false);
                              }}
                              className="sr-only peer"
                              aria-label="Reset 2FA"
                            />
                            <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 transition-colors duration-300 ease-out ring-1 ring-black/10 after:content-[''] after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 after:ease-out peer-checked:bg-[#02665e] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[#02665e]/25" />
                          </div>
                        </label>

                        {pendingReset2FA ? (
                          <div className="border-t border-slate-200/70 bg-white/60 px-3.5 py-3">
                            <div className="text-xs font-semibold text-slate-800">Confirmation</div>
                            <div className="mt-1 text-xs text-slate-600">
                              This action follows the platform security policy. Resetting 2FA will require the user to re-enroll two-factor authentication before using 2FA again.
                            </div>
                            <label className="mt-2 flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ackReset2FA}
                                onChange={(e) => setAckReset2FA(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#02665e] focus:ring-[#02665e]/25"
                              />
                              <span className="leading-5">I understand the impact and confirm I’m authorized to perform this action.</span>
                            </label>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="h-10 w-10 inline-flex items-center justify-center border border-slate-200 rounded-2xl text-slate-700 bg-white/70 hover:bg-slate-50 hover:border-slate-300 transition-all duration-300 ease-out active:scale-[0.99] cursor-pointer"
                                onClick={() => {
                                  setPendingReset2FA(false);
                                  setAckReset2FA(false);
                                  setReset2FA(false);
                                }}
                                aria-label="Cancel 2FA reset"
                                title="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className={
                                  ackReset2FA
                                    ? "h-10 w-10 inline-flex items-center justify-center text-white bg-gradient-to-r from-[#02665e] to-[#015b54] rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 ease-out active:scale-[0.99] cursor-pointer"
                                    : "h-10 w-10 inline-flex items-center justify-center rounded-2xl bg-slate-200 text-slate-400 cursor-not-allowed"
                                }
                                onClick={() => {
                                  if (!ackReset2FA) return;
                                  setReset2FA(true);
                                  setPendingReset2FA(false);
                                }}
                                disabled={!ackReset2FA}
                                aria-label="Confirm 2FA reset"
                                title="Confirm"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="group rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white/85 to-slate-50/70 backdrop-blur shadow-sm overflow-hidden ring-1 ring-black/5 transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#02665e]/30 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-slate-200/70 bg-gradient-to-r from-[#02665e]/12 via-slate-50/70 to-white transition-colors duration-300">
                      <div className="text-sm font-semibold text-slate-900">Access</div>
                      <div className="mt-0.5 text-xs text-slate-600">Role and permissions</div>
                    </div>

                    <div className="p-4">
                      <label htmlFor="edit-role" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Role
                      </label>
                      <select
                        id="edit-role"
                        disabled
                        className="mt-2 w-full px-3 py-2 border border-slate-200/70 rounded-2xl text-sm shadow-sm bg-slate-50/70 text-slate-600 cursor-not-allowed"
                        value={editing.role}
                        onChange={(e) => {
                          e.preventDefault();
                        }}
                      >
                        {editing.role !== "ADMIN" && editing.role !== "OWNER" && editing.role !== "CUSTOMER" ? (
                          <option value={editing.role}>{roleLabel(editing.role)}</option>
                        ) : null}
                        <option value="ADMIN">Admin</option>
                        <option value="OWNER">Owner</option>
                        <option value="CUSTOMER">Customer</option>
                      </select>

                      <div className="mt-2 text-xs text-slate-600">
                        Role is pinned and can’t be edited here.
                        {editingOriginalRole ? (
                          <span className="ml-1">Original: <span className="font-semibold text-slate-700">{roleLabel(editingOriginalRole)}</span></span>
                        ) : null}
                      </div>
                      {editing.role === "ADMIN" ? (
                        <div className="mt-5 border-t border-slate-200/70 pt-4">
                          <label htmlFor="edit-nrms-finance-role" className="block text-xs font-semibold text-slate-500 uppercase tracking-wide">
                            NRMS finance access
                          </label>
                          <select
                            id="edit-nrms-finance-role"
                            value={financeRole}
                            onChange={(e) => setFinanceRole(e.target.value)}
                            className="mt-2 w-full px-3 py-2 border border-slate-200/70 rounded-2xl text-sm shadow-sm bg-white text-slate-800"
                          >
                            <option value="NONE">None (no finance actions)</option>
                            <option value="OPERATOR">Operator (OTP-gated operations)</option>
                            <option value="APPROVER">Approver (high-risk finance actions)</option>
                          </select>
                          <div className="mt-2 text-xs text-slate-600">Finance access is separate from the ADMIN role. High-risk actions require APPROVER.</div>
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="group rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white/85 to-slate-50/70 backdrop-blur shadow-sm overflow-hidden ring-1 ring-black/5 transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#02665e]/30 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-slate-200/70 bg-gradient-to-r from-[#02665e]/12 via-slate-50/70 to-white transition-colors duration-300">
                      <div className="text-sm font-semibold text-slate-900">Status</div>
                      <div className="mt-0.5 text-xs text-slate-600">Enable or disable account access</div>
                    </div>

                    <div className="p-4">
                      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-br from-white/90 to-slate-50/60 shadow-sm overflow-hidden">
                        <label className="flex items-center justify-between gap-4 cursor-pointer px-3.5 py-2.5 transition-all duration-300 ease-out hover:from-white hover:to-emerald-50/25">
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900">Disable user</div>
                            <div className="mt-0.5 text-xs text-slate-600">Prevents this user from accessing the platform</div>
                          </div>
                          <div className="flex items-center flex-shrink-0">
                            <input
                              type="checkbox"
                              checked={disableUser}
                              onChange={(e) => {
                                const next = e.target.checked;
                                if (next) {
                                  setPendingDisableUser(true);
                                  setAckDisableUser(false);
                                  setDisableUser(false);
                                  return;
                                }
                                setPendingDisableUser(false);
                                setAckDisableUser(false);
                                setDisableUser(false);
                              }}
                              className="sr-only peer"
                              aria-label="Disable user"
                            />
                            <span className="relative inline-flex h-6 w-11 items-center rounded-full bg-slate-200 transition-colors duration-300 ease-out ring-1 ring-black/10 after:content-[''] after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-300 after:ease-out peer-checked:bg-[#02665e] peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-[#02665e]/25" />
                          </div>
                        </label>

                        {pendingDisableUser ? (
                          <div className="border-t border-slate-200/70 bg-white/60 px-3.5 py-3">
                            <div className="text-xs font-semibold text-slate-800">Confirmation</div>
                            <div className="mt-1 text-xs text-slate-600">
                              By disabling this account, you confirm this action complies with the platform access policy and you understand the user will be denied access.
                            </div>
                            <div className="mt-2 text-xs text-slate-700">
                              Effect:
                              <span className="ml-1 text-slate-600">The user will be prevented from accessing the platform (sign-in and/or protected areas). Existing sessions may stop working depending on backend enforcement.</span>
                            </div>
                            <label className="mt-2 flex items-start gap-2 text-xs text-slate-700 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={ackDisableUser}
                                onChange={(e) => setAckDisableUser(e.target.checked)}
                                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-[#02665e] focus:ring-[#02665e]/25"
                              />
                              <span className="leading-5">I understand the impact and confirm I’m authorized to disable this account.</span>
                            </label>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="h-10 w-10 inline-flex items-center justify-center border border-slate-200 rounded-2xl text-slate-700 bg-white/70 hover:bg-slate-50 hover:border-slate-300 transition-all duration-300 ease-out active:scale-[0.99] cursor-pointer"
                                onClick={() => {
                                  setPendingDisableUser(false);
                                  setAckDisableUser(false);
                                  setDisableUser(false);
                                }}
                                aria-label="Cancel disabling user"
                                title="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                className={
                                  ackDisableUser
                                    ? "h-10 w-10 inline-flex items-center justify-center text-white bg-gradient-to-r from-[#02665e] to-[#015b54] rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 ease-out active:scale-[0.99] cursor-pointer"
                                    : "h-10 w-10 inline-flex items-center justify-center rounded-2xl bg-slate-200 text-slate-400 cursor-not-allowed"
                                }
                                onClick={() => {
                                  if (!ackDisableUser) return;
                                  setDisableUser(true);
                                  setPendingDisableUser(false);
                                }}
                                disabled={!ackDisableUser}
                                aria-label="Confirm disabling user"
                                title="Confirm"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="group rounded-3xl border border-slate-200/80 bg-gradient-to-b from-white/85 to-slate-50/70 backdrop-blur shadow-sm overflow-hidden ring-1 ring-black/5 transition-all duration-300 ease-out hover:-translate-y-px hover:border-[#02665e]/30 hover:shadow-md">
                    <div className="px-4 py-3 border-b border-slate-200/70 bg-gradient-to-r from-[#02665e]/12 via-slate-50/70 to-white transition-colors duration-300">
                      <div className="text-sm font-semibold text-slate-900">Audit history</div>
                      <div className="mt-0.5 text-xs text-slate-600">Access changes and security actions</div>
                    </div>

                    <div className="p-4">
                      {auditLoading ? (
                        <div className="text-sm text-slate-600">Loading history…</div>
                      ) : auditRows.length === 0 ? (
                        <div className="text-sm text-slate-600">No audit records yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {auditRows.map((row) => {
                            const when = row.createdAt ? new Date(row.createdAt).toLocaleString() : "";
                            const actor = row.admin?.name || row.admin?.email || (row.admin?.id ? `Admin #${row.admin.id}` : "Admin");
                            const label =
                              row.action === "DISABLE_USER"
                                ? "Disabled account access"
                                : row.action === "ENABLE_USER"
                                  ? "Enabled account access"
                                  : row.action === "RESET_2FA"
                                    ? "Reset 2FA"
                                    : row.action;

                            return (
                              <div key={row.id} className="rounded-2xl border border-slate-200/80 bg-white/70 px-3.5 py-2.5 shadow-sm">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <div className="text-sm font-semibold text-slate-900">{label}</div>
                                    <div className="mt-0.5 text-xs text-slate-600 break-words">By {actor}</div>
                                  </div>
                                  <div className="text-xs text-slate-500 whitespace-nowrap">{when}</div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3 border-t border-slate-200/70 pt-4">
                <button
                  className="h-11 w-11 inline-flex items-center justify-center border border-slate-200 rounded-2xl text-slate-700 bg-white/70 hover:bg-slate-50 hover:border-slate-300 transition-all duration-300 ease-out active:scale-[0.99] cursor-pointer"
                  onClick={closeEdit}
                  aria-label="Cancel"
                  title="Cancel"
                >
                  <X className="h-5 w-5" />
                </button>
                <button
                  className={
                    hasPendingConfirmation
                      ? "h-11 w-11 inline-flex items-center justify-center rounded-2xl bg-slate-200 text-slate-400 cursor-not-allowed"
                      : "h-11 w-11 inline-flex items-center justify-center text-white bg-gradient-to-r from-[#02665e] to-[#015b54] rounded-2xl shadow-sm hover:shadow-md transition-all duration-300 ease-out active:scale-[0.99] cursor-pointer"
                  }
                  onClick={saveEdit}
                  disabled={hasPendingConfirmation}
                  aria-label="Save"
                  title={hasPendingConfirmation ? "Confirm or cancel the pending action first" : "Save"}
                >
                  <Check className="h-5 w-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
      )}
    </div>
  );
}
