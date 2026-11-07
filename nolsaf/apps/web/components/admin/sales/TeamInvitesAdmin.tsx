"use client";

/**
 * Admin: team invites waiting for NoLSAF. Approve = promote the recruit with
 * the invite (the normal agreement flow); they join the team at activation.
 * Reject can also pause the lead's withdrawals when the invite looks abusive.
 *
 * Each invite reads top to bottom: who, warning signs, readiness, decision.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, Ban, BadgeCheck, CheckCircle2, Circle, Loader2, Lock, ShieldAlert, ShieldCheck, UserPlus, Users,
} from "lucide-react";
import apiClient from "@/lib/apiClient";
import RegionSelect, { matchRegion } from "./RegionSelect";

type Flag = { code: string; severity: "SUSPICIOUS" | "REVIEW"; message: string };
type Invite = {
  reference: string;
  status: string;
  inviteeName: string;
  invitedPhone: string;
  acceptedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  flags: Flag[];
  team: { name: string; region: string | null };
  lead: { name: string; agentCode: string; paused: boolean; region: string | null; territory: string | null };
  recruit: { userId: number; name: string; email: string | null; phone: string | null; joinedNolsafAt: string; missing: string[] } | null;
};

const FILTERS = [
  { key: "ACCEPTED", label: "Waiting" },
  { key: "APPROVED", label: "Approved" },
  { key: "JOINED", label: "Joined" },
  { key: "REJECTED", label: "Not approved" },
] as const;

/** Same requirements the server checks before an agreement can be sent. */
const READINESS = ["Legal name", "Verified email address", "Verified phone number", "Address", "National ID number"];

const field = "h-9 w-full min-w-0 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-[13px] outline-none focus:border-emerald-400";

function when(value: string | null) {
  return value
    ? `${new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" })} EAT`
    : "–";
}

type Draft = { region: string; territory: string; reason: string; pauseLead: boolean; mode: "" | "approve" | "reject" };

export default function TeamInvitesAdmin({ onPromoted }: { onPromoted?: () => void }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]["key"]>("ACCEPTED");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/api/admin/sales/team-invites", { params: { status } });
      setInvites(response.data?.invites || []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load team invites.");
    } finally {
      setLoading(false);
    }
  }, [status]);
  useEffect(() => { void load(); }, [load]);

  const draft = (inv: Invite): Draft =>
    drafts[inv.reference] ?? { region: matchRegion(inv.lead.region || inv.team.region), territory: inv.lead.territory || "", reason: "", pauseLead: false, mode: "" };
  const set = (inv: Invite, patch: Partial<Draft>) => setDrafts((prev) => ({ ...prev, [inv.reference]: { ...draft(inv), ...patch } }));

  const approve = async (inv: Invite) => {
    const v = draft(inv);
    if (!inv.recruit) return;
    if (!v.region) return setError("Choose the region for the new partner.");
    if (v.reason.trim().length < 5) return setError("Enter an audit reason of at least 5 characters.");
    setBusy(`approve-${inv.reference}`);
    setError("");
    setNotice("");
    try {
      const response = await apiClient.post("/api/admin/sales/partners/promote", {
        userId: inv.recruit.userId,
        region: v.region,
        ...(v.territory.trim() ? { territory: v.territory.trim() } : {}),
        teamInvite: inv.reference,
        reason: v.reason.trim(),
      });
      setNotice(`${inv.recruit.name} was approved as ${response.data?.partner?.agentCode}. The agreement was sent; they join ${inv.team.name} once it is activated.`);
      await load();
      onPromoted?.();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not approve this invite.");
    } finally {
      setBusy("");
    }
  };

  const reject = async (inv: Invite) => {
    const v = draft(inv);
    if (v.reason.trim().length < 5) return setError("Enter an audit reason of at least 5 characters.");
    setBusy(`reject-${inv.reference}`);
    setError("");
    setNotice("");
    try {
      await apiClient.post(`/api/admin/sales/team-invites/${inv.reference}/reject`, { reason: v.reason.trim(), pauseLead: v.pauseLead });
      setNotice(`The invite for ${inv.inviteeName} was closed${v.pauseLead ? " and the lead's withdrawals are paused" : ""}.`);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not reject this invite.");
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="overflow-hidden rounded-lg border border-solid border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-neutral-100 px-4 py-3">
        <div>
          <h2 className="m-0 flex items-center gap-1.5 text-sm font-bold text-neutral-900"><Users className="h-4 w-4" /> Team invites</h2>
          <p className="m-0 mt-0.5 text-xs text-neutral-500">People a team lead invited. Approving sends the normal agreement; they join the team when it is activated.</p>
        </div>
        <div className="flex gap-1" role="tablist" aria-label="Invite status">
          {FILTERS.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={status === x.key} onClick={() => setStatus(x.key)}
              className={`h-8 rounded-md border-0 px-2.5 text-xs font-semibold ${status === x.key ? "bg-neutral-900 text-white" : "bg-transparent text-neutral-500 hover:bg-neutral-100"}`}>
              {x.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <p className="m-0 flex items-start gap-2 border-0 border-b border-solid border-rose-100 bg-rose-50 px-4 py-2.5 text-sm text-rose-800" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      {notice ? <p className="m-0 flex items-start gap-2 border-0 border-b border-solid border-emerald-100 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-900" role="status"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
      ) : invites.length === 0 ? (
        <div className="px-4 py-10 text-center">
          <ShieldCheck className="mx-auto h-7 w-7 text-neutral-300" />
          <p className="m-0 mt-2 text-sm font-medium text-neutral-700">{status === "ACCEPTED" ? "No invites are waiting for review" : "Nothing in this view"}</p>
        </div>
      ) : (
        <ul className="m-0 list-none p-0">
          {invites.map((inv) => {
            const v = draft(inv);
            const suspicious = inv.flags.filter((x) => x.severity === "SUSPICIOUS");
            const checks = inv.flags.filter((x) => x.severity === "REVIEW" && x.code !== "PROFILE_INCOMPLETE");
            const waiting = inv.status === "ACCEPTED";
            const missing = new Set(inv.recruit?.missing ?? []);
            const ready = missing.size === 0;
            return (
              <li key={inv.reference} className="border-0 border-t border-solid border-neutral-100 first:border-t-0">
                {/* Who */}
                <div className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
                  <div className="min-w-0">
                    <p className="m-0 text-sm font-semibold text-neutral-900">{inv.recruit?.name || inv.inviteeName}</p>
                    {inv.recruit ? <p className="m-0 mt-0.5 truncate text-xs text-neutral-600">{inv.recruit.email || "No email"} · {inv.recruit.phone || "No phone"}</p> : null}
                    <p className="m-0 mt-0.5 text-[11px] text-neutral-400">
                      Invited as {inv.inviteeName} ({inv.invitedPhone}) · accepted {when(inv.acceptedAt)}
                      {inv.recruit ? ` · on NoLSAF since ${new Date(inv.recruit.joinedNolsafAt).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}` : ""}
                    </p>
                  </div>
                  <p className="m-0 inline-flex items-center gap-1.5 rounded-md bg-neutral-50 px-2 py-1 text-xs text-neutral-700">
                    <UserPlus className="h-3.5 w-3.5 text-neutral-400" /> Invited by <span className="font-semibold">{inv.lead.name}</span>
                    <span className="font-mono text-neutral-400">{inv.lead.agentCode}</span> · {inv.team.name}
                    {inv.lead.paused ? <span className="inline-flex items-center gap-0.5 font-semibold text-rose-700"><Lock className="h-3 w-3" /> paused</span> : null}
                  </p>
                </div>

                {/* Warning signs first */}
                {suspicious.length || checks.length ? (
                  <div className="mx-4 mt-3 space-y-1.5">
                    {suspicious.length ? (
                      <div className="rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2">
                        <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-rose-800"><ShieldAlert className="h-3.5 w-3.5" /> {suspicious.length} warning sign{suspicious.length === 1 ? "" : "s"}</p>
                        {suspicious.map((x) => <p key={x.code} className="m-0 mt-0.5 text-xs text-rose-800">{x.message}</p>)}
                      </div>
                    ) : null}
                    {checks.length ? (
                      <div className="rounded-md border border-solid border-amber-200 bg-amber-50 px-3 py-2">
                        {checks.map((x) => <p key={x.code} className="m-0 text-xs text-amber-900">{x.message}</p>)}
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="m-0 mx-4 mt-3 inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><BadgeCheck className="h-3.5 w-3.5" /> No warning signs</p>
                )}

                {/* Readiness for an agreement */}
                {inv.recruit && waiting ? (
                  <ul className="m-0 mx-4 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1 p-0" aria-label="Agreement readiness">
                    {READINESS.map((item) => {
                      const done = !missing.has(item);
                      return (
                        <li key={item} className={`inline-flex items-center gap-1.5 text-xs ${done ? "text-neutral-600" : "font-semibold text-amber-800"}`}>
                          {done ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <Circle className="h-3.5 w-3.5" />} {item}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}

                {/* Decision */}
                <div className="mt-3 border-0 border-t border-solid border-neutral-100 bg-neutral-50/60 px-4 py-3">
                  {!waiting ? (
                    <p className="m-0 text-xs text-neutral-500">
                      {inv.status === "APPROVED" ? "Approved. Joins the team when the agreement is activated." : inv.status === "JOINED" ? "In the team." : `Closed ${when(inv.decidedAt)}${inv.decisionNote ? `: ${inv.decisionNote}` : ""}`}
                    </p>
                  ) : v.mode === "approve" ? (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,1.4fr)_auto_auto]">
                      <RegionSelect value={v.region} onChange={(region) => set(inv, { region })} className={field} />
                      <input className={field} value={v.territory} onChange={(e) => set(inv, { territory: e.target.value })} placeholder="Territory (optional)" aria-label="Territory" />
                      <input className={field} value={v.reason} onChange={(e) => set(inv, { reason: e.target.value })} placeholder="Audit reason (required)" aria-label="Audit reason" />
                      <button type="button" onClick={() => void approve(inv)} disabled={!!busy} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-50">
                        {busy === `approve-${inv.reference}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />} Approve and send agreement
                      </button>
                      <button type="button" onClick={() => set(inv, { mode: "" })} className="h-9 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-600">Back</button>
                    </div>
                  ) : v.mode === "reject" ? (
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1.6fr)_auto_auto_auto] md:items-center">
                      <input className={field} value={v.reason} onChange={(e) => set(inv, { reason: e.target.value })} placeholder="Reason (required, kept in the audit log)" aria-label="Reject reason" />
                      <label className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-neutral-700">
                        <input type="checkbox" checked={v.pauseLead} onChange={(e) => set(inv, { pauseLead: e.target.checked })} />
                        Also pause {inv.lead.name.split(" ")[0]}&apos;s withdrawals
                      </label>
                      <button type="button" onClick={() => void reject(inv)} disabled={!!busy} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md border-0 bg-rose-600 px-3 text-[13px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50">
                        {busy === `reject-${inv.reference}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Reject invite
                      </button>
                      <button type="button" onClick={() => set(inv, { mode: "" })} className="h-9 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[13px] font-medium text-neutral-600">Back</button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`m-0 text-xs ${ready ? "text-neutral-500" : "font-medium text-amber-800"}`}>
                        {ready
                          ? "Ready for an agreement."
                          : `Waiting for the recruit to add ${[...missing].map((item) => item.charAt(0).toLowerCase() + item.slice(1)).join(", ")}.`}
                      </p>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => set(inv, { mode: "reject", pauseLead: suspicious.length > 0 })}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-neutral-200 bg-white px-3 text-[13px] font-semibold text-neutral-700 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
                          <Ban className="h-4 w-4" /> Reject
                        </button>
                        <button type="button" onClick={() => set(inv, { mode: "approve" })} disabled={!ready}
                          title={ready ? undefined : "The recruit must complete their profile first"}
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-emerald-700 px-3 text-[13px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500">
                          <BadgeCheck className="h-4 w-4" /> Approve
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="m-0 flex items-center gap-1.5 border-0 border-t border-solid border-neutral-100 px-4 py-2.5 text-[11px] text-neutral-400">
        <Lock className="h-3 w-3" /> Team leads can only invite. Every approval, rejection and pause is audited.
      </p>
    </section>
  );
}
