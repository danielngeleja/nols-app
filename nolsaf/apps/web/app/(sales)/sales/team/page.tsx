"use client";

/**
 * My team: for team leads only (the server checks this on every request).
 * Rows and columns for quick management: each member is a row, their open
 * leads expand as a sub-table. Members and leads are addressed by opaque
 * references; no database id appears on screen or in a page address.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRightLeft, CheckCircle2, ChevronDown, Clock3, Loader2, Target, Trophy, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import TeamInvites from "@/components/sales/TeamInvites";
import TeamHealthCard from "@/components/sales/TeamHealthCard";

type Member = {
  ref: string;
  isLead: boolean;
  name: string;
  avatarUrl: string | null;
  agentCode: string;
  level: string;
  region: string | null;
  active: boolean;
  nationalRank: number | null;
  points: number;
  confirmed: number;
  visits: number;
  target: number;
  openLeads: number;
  staleLeads: number;
  flaggedVisits: number;
};
type Team = {
  team: { name: string; region: string | null; month: string; teamRank: number; teamCount: number };
  limits: { min: number; max: number; staleDays: number };
  totals: { points: number; confirmed: number; target: number; stale: number; flagged: number };
  members: Member[];
};
type Lead = { ref: string; mine: boolean; propertyName: string; area: string | null; status: string; lastActivityAt: string; visits: number; stale: boolean; canReassign: boolean };

const th = "px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const smallBtn = "inline-flex h-8 items-center gap-1 rounded-md border border-solid border-slate-300 bg-white px-2.5 text-[12px] font-semibold text-slate-700 [font-family:inherit] hover:bg-slate-50 disabled:opacity-50";
const primaryBtn = "inline-flex h-8 items-center rounded-md border-0 bg-[#02665e] px-3 text-[12px] font-semibold text-white [font-family:inherit] hover:bg-[#014d47] disabled:opacity-50";

function errorText(cause: any, fallback: string) {
  return cause?.response?.data?.error || fallback;
}
function label(value: string) {
  const v = String(value || "").replace(/_/g, " ").toLowerCase();
  return v.charAt(0).toUpperCase() + v.slice(1);
}
function ago(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago`;
}
function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0] || "").slice(0, 2).join("").toUpperCase();
}

export default function SalesTeamPage() {
  const [data, setData] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openMember, setOpenMember] = useState<string | null>(null);
  const [leads, setLeads] = useState<Record<string, Lead[]>>({});
  const [moving, setMoving] = useState<{ lead: string; to: string; reason: string } | null>(null);
  const [targetEdit, setTargetEdit] = useState<{ member: string; value: string; month: "current" | "next" } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get<Team>("/api/sales/team");
      setData(res.data);
    } catch (cause) {
      setError(errorText(cause, "Could not load your team."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadLeads = async (member: string) => {
    const res = await apiClient.get(`/api/sales/team/members/${encodeURIComponent(member)}/leads`);
    setLeads((current) => ({ ...current, [member]: res.data.leads ?? [] }));
  };

  const toggleMember = async (member: string) => {
    if (openMember === member) return setOpenMember(null);
    setOpenMember(member);
    setMoving(null);
    if (!leads[member]) {
      try {
        await loadLeads(member);
      } catch (cause) {
        setError(errorText(cause, "Could not load this member's leads."));
      }
    }
  };

  const move = async (from: string) => {
    if (!moving) return;
    if (!moving.to) return setError("Choose who should take this lead.");
    if (moving.reason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/team/leads/${encodeURIComponent(moving.lead)}/reassign`, { toPartner: moving.to, reason: moving.reason.trim() });
      setNotice("Lead moved. Both representatives were notified.");
      const to = moving.to;
      setMoving(null);
      setLeads((current) => {
        const next = { ...current };
        delete next[to];
        return next;
      });
      await loadLeads(from);
      void load();
    } catch (cause) {
      setError(errorText(cause, "The lead could not be moved."));
    } finally {
      setBusy(false);
    }
  };

  const saveTarget = async () => {
    if (!targetEdit || !data) return;
    const value = Number(targetEdit.value);
    if (!Number.isInteger(value) || value < data.limits.min || value > data.limits.max) {
      return setError(`A target must be between ${data.limits.min} and ${data.limits.max}.`);
    }
    setBusy(true);
    setError("");
    try {
      await apiClient.put(`/api/sales/team/members/${encodeURIComponent(targetEdit.member)}/target`, { target: value, month: targetEdit.month });
      setNotice(targetEdit.month === "next" ? "Next month's target saved." : "Target saved.");
      setTargetEdit(null);
      void load();
    } catch (cause) {
      setError(errorText(cause, "The target could not be saved."));
    } finally {
      setBusy(false);
    }
  };

  const t = data?.totals;
  const teamProgress = t ? Math.min(100, Math.round((t.confirmed / Math.max(1, t.target)) * 100)) : 0;

  return (
    <SalesShell>
      <div id="sales-team">
        <style>{`#sales-team, #sales-team * { box-sizing: border-box; }`}</style>
        <SalesPageHeader icon={Users} title={data?.team.name || "My team"} description="Coach your representatives, move stuck leads within the team, and set monthly targets. Money and approvals stay with NoLSAF." />

        {error && <p className="m-0 mt-4 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
        {notice && <p className="m-0 mt-4 flex items-start gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p>}

        {loading ? (
          <div className="mt-5 flex items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
        ) : data ? (
          <>
            <TeamHealthCard />
            <section className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 lg:grid-cols-4">
              <div className="bg-white p-4">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Trophy className="h-3.5 w-3.5" /> Team rank</p>
                <p className="m-0 mt-1 text-2xl font-bold text-slate-900">{data.team.teamRank}<span className="text-sm font-medium text-slate-400"> of {data.team.teamCount}</span></p>
                <p className="m-0 text-[12px] text-slate-500">{t!.points.toLocaleString("en-US")} points this month</p>
              </div>
              <div className="bg-white p-4">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Target className="h-3.5 w-3.5" /> Team target</p>
                <p className="m-0 mt-1 text-2xl font-bold text-slate-900">{t!.confirmed}<span className="text-sm font-medium text-slate-400"> / {t!.target}</span></p>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-[#02665e]" style={{ width: `${teamProgress}%` }} /></div>
              </div>
              <div className="bg-white p-4">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><Clock3 className="h-3.5 w-3.5" /> Stuck leads</p>
                <p className={`m-0 mt-1 text-2xl font-bold ${t!.stale ? "text-amber-700" : "text-slate-900"}`}>{t!.stale}</p>
                <p className="m-0 text-[12px] text-slate-500">No activity for {data.limits.staleDays}+ days</p>
              </div>
              <div className="bg-white p-4">
                <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><AlertTriangle className="h-3.5 w-3.5" /> Visits to discuss</p>
                <p className={`m-0 mt-1 text-2xl font-bold ${t!.flagged ? "text-rose-700" : "text-slate-900"}`}>{t!.flagged}</p>
                <p className="m-0 text-[12px] text-slate-500">Flagged, waiting for NoLSAF review</p>
              </div>
            </section>

            <section className="mt-4 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-left">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className={`${th} pl-4`}>Representative</th>
                      <th scope="col" className={th}>Level</th>
                      <th scope="col" className={`${th} text-right`}>Performance</th>
                      <th scope="col" className={`${th} w-[220px]`}>Target</th>
                      <th scope="col" className={`${th} text-right`}>Open</th>
                      <th scope="col" className={`${th} text-right`}>Stuck</th>
                      <th scope="col" className={`${th} text-right`}>Flagged</th>
                      <th scope="col" className={`${th} pr-4 text-right`}><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.members.map((m) => {
                      const progress = Math.min(100, Math.round((m.confirmed / Math.max(1, m.target)) * 100));
                      const open = openMember === m.ref;
                      const editing = targetEdit?.member === m.ref;
                      const memberLeads = leads[m.ref];
                      return (
                        <Fragment key={m.ref}>
                          <tr className="border-0 border-t border-solid border-slate-100 align-middle">
                            <td className="py-3 pl-4 pr-3">
                              <div className="flex min-w-0 items-center gap-3">
                                {m.avatarUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={m.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-lg object-cover" />
                                ) : (
                                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-[12px] font-bold text-slate-600">{initials(m.name)}</span>
                                )}
                                <div className="min-w-0">
                                  <p className="m-0 flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                                    {m.name}
                                    {m.isLead && <span className="rounded-md bg-[#02665e]/10 px-1.5 py-0.5 text-[11px] font-semibold text-[#02665e]">Lead</span>}
                                    {!m.active && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">Inactive</span>}
                                  </p>
                                  <p className="m-0 text-[12px] text-slate-500"><span className="font-mono">{m.agentCode}</span>{m.region ? ` · ${m.region}` : ""}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3 text-[13px] text-slate-700">{label(m.level)}</td>
                            <td className="whitespace-nowrap px-3 py-3 text-right">
                              <span className="block text-sm font-bold tabular-nums text-slate-900">{m.points.toLocaleString("en-US")} pts</span>
                              <span className="block text-[11px] tabular-nums text-slate-500">{m.nationalRank ? `#${m.nationalRank} in Tanzania` : "Not ranked yet"}</span>
                            </td>
                            <td className="px-3 py-3">
                              {editing ? (
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <input type="number" min={data.limits.min} max={data.limits.max} value={targetEdit.value} onChange={(e) => setTargetEdit({ ...targetEdit, value: e.target.value })} className="h-8 w-16 rounded-md border border-solid border-slate-300 px-2 text-sm outline-none focus:border-[#02665e]" aria-label="Target" />
                                  <select value={targetEdit.month} onChange={(e) => setTargetEdit({ ...targetEdit, month: e.target.value as "current" | "next" })} className="h-8 rounded-md border border-solid border-slate-300 bg-white px-1.5 text-[12px]" aria-label="Month">
                                    <option value="current">This month</option>
                                    <option value="next">Next month</option>
                                  </select>
                                  <button type="button" onClick={() => void saveTarget()} disabled={busy} className={primaryBtn}>Save</button>
                                  <button type="button" onClick={() => setTargetEdit(null)} className={smallBtn}>Cancel</button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => setTargetEdit({ member: m.ref, value: String(m.target), month: "current" })} className="block w-full border-0 bg-transparent p-0 text-left [font-family:inherit]" title="Set target">
                                  <span className="flex justify-between text-[12px] text-slate-600"><span>{m.confirmed} of {m.target}</span><span className="font-semibold text-[#02665e]">Set</span></span>
                                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-[#02665e]" style={{ width: `${progress}%` }} /></span>
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right text-[13px] tabular-nums text-slate-700">{m.openLeads}</td>
                            <td className={`px-3 py-3 text-right text-[13px] font-semibold tabular-nums ${m.staleLeads ? "text-amber-700" : "text-slate-400"}`}>{m.staleLeads}</td>
                            <td className={`px-3 py-3 text-right text-[13px] font-semibold tabular-nums ${m.flaggedVisits ? "text-rose-700" : "text-slate-400"}`}>{m.flaggedVisits}</td>
                            <td className="py-3 pl-3 pr-4 text-right">
                              <button type="button" onClick={() => void toggleMember(m.ref)} aria-expanded={open} className={smallBtn}>
                                Leads <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
                              </button>
                            </td>
                          </tr>

                          {open && (
                            <tr className="bg-slate-50/70">
                              <td colSpan={8} className="px-4 pb-4 pt-1">
                                {!memberLeads ? (
                                  <p className="m-0 flex items-center gap-2 py-2 text-[13px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading leads</p>
                                ) : memberLeads.length === 0 ? (
                                  <p className="m-0 py-2 text-[13px] text-slate-500">No open leads.</p>
                                ) : (
                                  <table className="w-full border-collapse overflow-hidden rounded-lg border border-solid border-slate-200 bg-white text-left">
                                    <thead className="bg-white">
                                      <tr className="border-0 border-b border-solid border-slate-100">
                                        <th scope="col" className={`${th} pl-3`}>Property</th>
                                        <th scope="col" className={th}>Area</th>
                                        <th scope="col" className={th}>Status</th>
                                        <th scope="col" className={`${th} text-right`}>Visits</th>
                                        <th scope="col" className={th}>Last activity</th>
                                        <th scope="col" className={`${th} pr-3 text-right`}><span className="sr-only">Move</span></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {memberLeads.map((lead) => {
                                        const isMoving = moving?.lead === lead.ref;
                                        return (
                                          <Fragment key={lead.ref}>
                                            <tr className="border-0 border-t border-solid border-slate-100 first:border-t-0">
                                              <td className="py-2.5 pl-3 pr-3 text-[13px] font-semibold text-slate-900">
                                                {lead.mine ? <Link href={`/sales/leads/${lead.ref}`} className="text-slate-900 no-underline hover:underline">{lead.propertyName}</Link> : lead.propertyName}
                                              </td>
                                              <td className="px-3 py-2.5 text-[12px] text-slate-600">{lead.area || "–"}</td>
                                              <td className="px-3 py-2.5 text-[12px] text-slate-600">{label(lead.status)}</td>
                                              <td className="px-3 py-2.5 text-right text-[12px] tabular-nums text-slate-600">{lead.visits}</td>
                                              <td className={`px-3 py-2.5 text-[12px] ${lead.stale ? "font-semibold text-amber-700" : "text-slate-600"}`}>{ago(lead.lastActivityAt)}</td>
                                              <td className="py-2.5 pl-3 pr-3 text-right">
                                                {lead.canReassign && !isMoving && data.members.length > 1 && (
                                                  <button type="button" onClick={() => setMoving({ lead: lead.ref, to: "", reason: "" })} className={smallBtn}>
                                                    <ArrowRightLeft className="h-3.5 w-3.5" /> Move
                                                  </button>
                                                )}
                                              </td>
                                            </tr>
                                            {isMoving && (
                                              <tr>
                                                <td colSpan={6} className="px-3 pb-3">
                                                  <div className="grid gap-1.5 sm:grid-cols-[200px_minmax(0,1fr)_auto_auto]">
                                                    <select value={moving.to} onChange={(e) => setMoving({ ...moving, to: e.target.value })} className="h-8 rounded-md border border-solid border-slate-300 bg-white px-2 text-[13px]" aria-label="Move to">
                                                      <option value="">Move to…</option>
                                                      {data.members.filter((x) => x.ref !== m.ref && x.active).map((x) => (
                                                        <option key={x.ref} value={x.ref}>{x.name}</option>
                                                      ))}
                                                    </select>
                                                    <input value={moving.reason} onChange={(e) => setMoving({ ...moving, reason: e.target.value })} placeholder="Reason, shown to both" className="h-8 min-w-0 rounded-md border border-solid border-slate-300 px-2 text-[13px] outline-none focus:border-[#02665e]" />
                                                    <button type="button" onClick={() => void move(m.ref)} disabled={busy} className={primaryBtn}>Move lead</button>
                                                    <button type="button" onClick={() => setMoving(null)} className={smallBtn}>Cancel</button>
                                                  </div>
                                                </td>
                                              </tr>
                                            )}
                                          </Fragment>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
            <TeamInvites onChanged={() => void load()} />
            <p className="m-0 mt-3 text-center text-[12px] text-slate-500">You can invite people to your team; NoLSAF approves every new member. Earnings and contact details are never shown here.</p>
          </>
        ) : null}
      </div>
    </SalesShell>
  );
}
