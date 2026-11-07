"use client";

/**
 * Admin: a partner's team role and monthly target, inside the partner detail.
 * Appoint or remove them as team lead, manage their members, or see which
 * team they belong to. Every action needs a reason and is audited.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesPartnerPicker, { type PickedPartner } from "@/components/admin/sales/SalesPartnerPicker";
import TargetSetter from "./TargetSetter";

type TeamMember = { partnerId: number; name: string; agentCode: string; region: string | null; status: string; points: number };
type Team = { id: number; name: string; region: string | null; rank: number; points: number; lead: { partnerId: number; name: string; agentCode: string }; members: TeamMember[] };

const input = "h-8 min-w-0 rounded-md border border-solid border-neutral-200 px-2 text-xs outline-none focus:border-emerald-400";
const btn = "inline-flex h-8 items-center gap-1 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 [font-family:inherit] hover:bg-neutral-50 disabled:opacity-50";
const primary = "inline-flex h-8 items-center gap-1 rounded-md border-0 bg-emerald-700 px-2.5 text-xs font-semibold text-white [font-family:inherit] hover:bg-emerald-800 disabled:opacity-50";

export default function PartnerTeamAdmin({ partnerId, partnerActive }: { partnerId: number; partnerActive: boolean }) {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [reason, setReason] = useState("");
  const [teamName, setTeamName] = useState("");
  const [member, setMember] = useState<PickedPartner | null>(null);
  const [mode, setMode] = useState<"" | "appoint" | "remove" | "add">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get("/api/admin/sales/teams");
      setTeams(data.teams ?? []);
    } catch {
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const led = teams?.find((t) => t.lead.partnerId === partnerId) ?? null;
  const memberOf = teams?.find((t) => t.members.some((m) => m.partnerId === partnerId)) ?? null;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    if (reason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setNotice(done);
      setMode("");
      setReason("");
      setMember(null);
      setTeamName("");
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "That did not work.");
    } finally {
      setBusy(false);
    }
  };

  const reasonBox = (
    <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (recorded)" className={`${input} flex-1`} />
  );

  return (
    <div>
      <h3 className="m-0 flex items-center gap-1.5 text-sm font-semibold text-neutral-900"><Users className="h-4 w-4 text-emerald-700" /> Team</h3>
      <div className="mt-2 space-y-3 rounded-lg border border-solid border-neutral-200 p-3 text-xs">
        {teams === null ? (
          <p className="m-0 flex items-center gap-2 text-neutral-500"><Loader2 className="h-3 w-3 animate-spin" /> Loading</p>
        ) : led ? (
          <div>
            <p className="m-0 text-neutral-800">
              Leads <b>{led.name}</b> · team rank {led.rank} · {led.points.toLocaleString("en-US")} points this month
            </p>
            {led.members.length ? (
              <ul className="m-0 mt-2 list-none divide-y divide-neutral-100 rounded-md border border-solid border-neutral-100 p-0">
                {led.members.map((m) => (
                  <li key={m.partnerId} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <span className="min-w-0 truncate text-neutral-800">{m.name} <span className="font-mono text-neutral-500">{m.agentCode}</span> · {m.points} pts</span>
                    <button
                      type="button"
                      className={btn}
                      disabled={busy}
                      onClick={() => {
                        const r = window.prompt(`Reason for removing ${m.name} from the team`);
                        if (!r || r.trim().length < 5) return setError("Give a reason of at least 5 characters.");
                        setBusy(true);
                        apiClient
                          .post(`/api/admin/sales/teams/${led.id}/members/${m.partnerId}/remove`, { reason: r.trim() })
                          .then(() => { setNotice(`${m.name} left the team.`); return load(); })
                          .catch((cause: any) => setError(cause?.response?.data?.error || "Could not remove the member."))
                          .finally(() => setBusy(false));
                      }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="m-0 mt-1 text-neutral-500">No members yet.</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button type="button" className={btn} onClick={() => setMode(mode === "add" ? "" : "add")}>Add member</button>
              <button type="button" className={`${btn} text-rose-700`} onClick={() => setMode(mode === "remove" ? "" : "remove")}>Remove as team lead</button>
            </div>
            {mode === "add" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <SalesPartnerPicker className="w-56" value={member} onChange={setMember} excludeIds={[partnerId, ...led.members.map((m) => m.partnerId)]} />
                {reasonBox}
                <button type="button" className={primary} disabled={busy} onClick={() => void run(() => (member ? apiClient.post(`/api/admin/sales/teams/${led.id}/members`, { salesPartnerId: member.id, reason: reason.trim() }) : Promise.reject({ response: { data: { error: "Choose a partner to add." } } })), "Member added and notified.")}>Add</button>
              </div>
            )}
            {mode === "remove" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reasonBox}
                <button type="button" className="inline-flex h-8 items-center rounded-md border-0 bg-rose-600 px-2.5 text-xs font-semibold text-white [font-family:inherit] disabled:opacity-50" disabled={busy} onClick={() => void run(() => apiClient.post(`/api/admin/sales/partners/${partnerId}/team-lead/remove`, { reason: reason.trim() }), "Team lead removed. Members are now solo partners.")}>Remove lead</button>
              </div>
            )}
          </div>
        ) : (
          <div>
            <p className="m-0 text-neutral-700">
              {memberOf ? <>Member of <b>{memberOf.name}</b>, led by {memberOf.lead.name}.</> : "Not in a team."}
            </p>
            {!memberOf && partnerActive && (
              <>
                <button type="button" className={`${btn} mt-2`} onClick={() => setMode(mode === "appoint" ? "" : "appoint")}>Make team lead</button>
                {mode === "appoint" && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team name (optional)" className={`${input} w-44`} />
                    {reasonBox}
                    <button type="button" className={primary} disabled={busy} onClick={() => void run(() => apiClient.post(`/api/admin/sales/partners/${partnerId}/team-lead`, { reason: reason.trim(), ...(teamName.trim() ? { name: teamName.trim() } : {}) }), "Appointed team lead and notified.")}>Appoint</button>
                  </div>
                )}
              </>
            )}
            {memberOf && <p className="m-0 mt-1 text-neutral-500">To lead a team, remove them from {memberOf.name} first.</p>}
          </div>
        )}

        {error && <p className="m-0 text-rose-700">{error}</p>}
        {notice && <p className="m-0 text-emerald-700">{notice}</p>}
      </div>
      <div className="mt-4">
        <TargetSetter partnerId={partnerId} />
      </div>
    </div>
  );
}
