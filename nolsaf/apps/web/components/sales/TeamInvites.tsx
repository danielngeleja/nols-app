"use client";

/**
 * Team lead: invite people to the team. The lead proposes; NoLSAF approves.
 * A link is shown once (only its hash is stored); "New link" replaces it.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, Loader2, MessageCircle, Plus, RefreshCw, Send, Share2, UserPlus, X } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Invite = {
  reference: string;
  name: string;
  phone: string;
  status: "SENT" | "EXPIRED" | "ACCEPTED" | "APPROVED" | "JOINED" | "REJECTED" | "WITHDRAWN";
  expiresAt: string;
  openedAt: string | null;
  createdAt: string;
  acceptedAt: string | null;
  decidedAt: string | null;
  joinedAt: string | null;
  note: string | null;
};
type Data = {
  invites: Invite[];
  limits: { maxOpen: number; maxTeam: number; ttlDays: number };
  seats: { members: number; open: number };
  summary?: { waiting: number; notOpened: number; joinedThisMonth: number };
};

const STATUS: Record<Invite["status"], { label: string; tone: string; hint: string }> = {
  SENT: { label: "Link sent", tone: "bg-sky-50 text-sky-800", hint: "Waiting for them to open it" },
  EXPIRED: { label: "Expired", tone: "bg-slate-100 text-slate-600", hint: "Send a new link" },
  ACCEPTED: { label: "With NoLSAF", tone: "bg-amber-50 text-amber-800", hint: "Accepted, waiting for review" },
  APPROVED: { label: "Approved", tone: "bg-emerald-50 text-emerald-800", hint: "Joins after signing the agreement" },
  JOINED: { label: "Joined", tone: "bg-emerald-100 text-emerald-900", hint: "Now in your team" },
  REJECTED: { label: "Not approved", tone: "bg-rose-50 text-rose-700", hint: "Closed by NoLSAF" },
  WITHDRAWN: { label: "Withdrawn", tone: "bg-slate-100 text-slate-500", hint: "Closed by you" },
};

const th = "px-3 py-2.5 text-left text-[11px] font-semibold text-slate-500";

function eatDate(value: string | null) {
  if (!value) return "–";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function shareText(name: string, link: string) {
  const first = name.trim().split(/\s+/)[0] || "there";
  return `Hi ${first}, I would like you to join my NoLSAF sales team. Open this link, sign in and apply: ${link}`;
}

export default function TeamInvites({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "" });
  const [fresh, setFresh] = useState<{ name: string; link: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await apiClient.get("/api/sales/team/invites");
      setData(response.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load your invites.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (form.name.trim().length < 3) return setError("Enter the person's full name.");
    if (form.phone.replace(/\D/g, "").length < 9) return setError("Enter their mobile number, for example 0754 123 456.");
    setBusy("create");
    setError("");
    try {
      const response = await apiClient.post("/api/sales/team/invites", { name: form.name.trim(), phone: form.phone.trim() });
      setFresh({ name: response.data.invite.name, link: response.data.link, expiresAt: response.data.invite.expiresAt });
      setCopied(false);
      setForm({ name: "", phone: "" });
      setOpen(false);
      await load();
      onChanged?.();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not create the invite.");
    } finally {
      setBusy("");
    }
  };

  const renew = async (invite: Invite) => {
    setBusy(`renew-${invite.reference}`);
    setError("");
    try {
      const response = await apiClient.post(`/api/sales/team/invites/${invite.reference}/link`, {});
      setFresh({ name: invite.name, link: response.data.link, expiresAt: response.data.expiresAt });
      setCopied(false);
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not create a new link.");
    } finally {
      setBusy("");
    }
  };

  const withdraw = async (invite: Invite) => {
    setBusy(`withdraw-${invite.reference}`);
    setError("");
    try {
      await apiClient.post(`/api/sales/team/invites/${invite.reference}/withdraw`, {});
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not withdraw the invite.");
    } finally {
      setBusy("");
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh.link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy is blocked in this browser. Select the link and copy it.");
    }
  };

  const nativeShare = async () => {
    if (!fresh) return;
    try {
      await navigator.share({ title: "Join my NoLSAF sales team", text: shareText(fresh.name, fresh.link) });
    } catch { /* cancelled */ }
  };

  const seats = data?.seats;
  const limits = data?.limits;
  // Why "New invite" is off, said plainly instead of a silent grey button.
  const blockedReason = !seats || !limits
    ? ""
    : seats.members + seats.open >= limits.maxTeam
      ? `Team full: ${seats.members} members and ${seats.open} open invites of ${limits.maxTeam}.`
      : seats.open >= limits.maxOpen
        ? `${limits.maxOpen} open invites already. Withdraw one or wait for NoLSAF.`
        : "";
  const full = Boolean(blockedReason);
  const summary = data?.summary;

  return (
    <section className="mt-4 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h2 className="m-0 flex items-center gap-2 text-sm font-semibold text-slate-900"><UserPlus className="h-4 w-4 text-[#02665e]" aria-hidden /> Invite to my team</h2>
          <p className="m-0 mt-0.5 text-[12px] text-slate-500">
            {blockedReason || `Personal links for people you trust. Each link lasts ${limits?.ttlDays ?? 14} days; NoLSAF approves every new member.`}
          </p>
        </div>
        <button
          type="button"
          disabled={loading || full || busy === "create"}
          onClick={() => { setOpen((v) => !v); setError(""); }}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-[13px] font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
        >
          {open ? <X className="h-4 w-4" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />} {open ? "Close" : "New invite"}
        </button>
      </div>

      {seats && limits ? (
        <div className="grid grid-cols-2 gap-px border-0 border-b border-solid border-slate-100 bg-slate-100 sm:grid-cols-4">
          {[
            { label: "Open invites", value: `${seats.open} of ${limits.maxOpen}`, note: "Links not yet decided" },
            { label: "Not opened yet", value: String(summary?.notOpened ?? 0), note: "Worth a follow-up call" },
            { label: "With NoLSAF", value: String(summary?.waiting ?? 0), note: "Accepted, being reviewed" },
            { label: "Team size", value: `${seats.members} of ${limits.maxTeam}`, note: `${summary?.joinedThisMonth ?? 0} joined this month` },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-4 py-2.5">
              <p className="m-0 text-[11px] text-slate-500">{f.label}</p>
              <p className="m-0 text-lg font-bold tabular-nums text-slate-900">{f.value}</p>
              <p className="m-0 truncate text-[11px] text-slate-400">{f.note}</p>
            </div>
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="grid gap-2 border-0 border-b border-solid border-slate-100 bg-slate-50 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto]">
          <label className="min-w-0">
            <span className="block text-[11px] font-semibold text-slate-600">Full name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Juma Kassim" className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2.5 text-[13px] outline-none focus:border-[#02665e]" />
          </label>
          <label className="min-w-0">
            <span className="block text-[11px] font-semibold text-slate-600">Mobile number</span>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="0754 123 456" className="mt-1 h-9 w-full rounded-md border border-solid border-slate-300 bg-white px-2.5 text-[13px] outline-none focus:border-[#02665e]" />
          </label>
          <button type="button" onClick={() => void create()} disabled={busy === "create"} className="inline-flex h-9 items-center justify-center gap-1.5 self-end rounded-md border-0 bg-[#02665e] px-3 text-[13px] font-semibold text-white hover:bg-[#014d47] disabled:opacity-60">
            {busy === "create" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />} Create link
          </button>
          <p className="m-0 text-[11px] text-slate-500 sm:col-span-3">They sign in with their own NoLSAF account and apply. NoLSAF checks and approves every new member; you never approve anyone.</p>
        </div>
      ) : null}

      {fresh ? (
        <div className="border-0 border-b border-solid border-emerald-100 bg-emerald-50/60 px-4 py-3">
          <p className="m-0 text-[13px] font-semibold text-emerald-900">Link for {fresh.name} is ready</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input readOnly value={fresh.link} onFocus={(e) => e.currentTarget.select()} aria-label="Invite link" className="h-9 min-w-0 flex-1 rounded-md border border-solid border-emerald-200 bg-white px-2.5 font-mono text-[12px] text-slate-700" />
            <button type="button" onClick={() => void copy()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-emerald-300 bg-white px-3 text-[12px] font-semibold text-emerald-800 hover:bg-emerald-50">
              {copied ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={`https://wa.me/?text=${encodeURIComponent(shareText(fresh.name, fresh.link))}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border-0 bg-[#02665e] px-3 text-[12px] font-semibold text-white no-underline hover:bg-[#014d47] hover:no-underline"
            >
              <MessageCircle className="h-3.5 w-3.5" aria-hidden /> WhatsApp
            </a>
            {typeof navigator !== "undefined" && "share" in navigator ? (
              <button type="button" onClick={() => void nativeShare()} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-[12px] font-semibold text-slate-700 hover:bg-slate-50">
                <Share2 className="h-3.5 w-3.5" aria-hidden /> Share
              </button>
            ) : null}
            <button type="button" onClick={() => setFresh(null)} aria-label="Hide link" className="grid h-9 w-9 place-items-center rounded-md border-0 bg-transparent text-slate-500 hover:bg-white">
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          <p className="m-0 mt-1.5 text-[11px] text-emerald-900/80">
            Send it only to {fresh.name.split(/\s+/)[0]}. It works until {eatDate(fresh.expiresAt)} and is shown only now; if you lose it, use New link below.
          </p>
        </div>
      ) : null}

      {error ? <p className="m-0 border-0 border-b border-solid border-rose-100 bg-rose-50 px-4 py-2.5 text-[13px] text-rose-700" role="alert">{error}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 p-5 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading</div>
      ) : !data?.invites.length ? (
        <div className="grid gap-4 px-4 py-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div className="min-w-0">
            <p className="m-0 text-sm font-semibold text-slate-900">Grow your team</p>
            <p className="m-0 mt-1 text-[13px] text-slate-500">Create a personal link for someone you trust. NoLSAF reviews them before they join.</p>
            <ol className="m-0 mt-3 grid list-none gap-2 p-0 text-[12px] text-slate-600 sm:grid-cols-3">
              {["Create a link with their name and number", "Send it on WhatsApp", "They apply, NoLSAF approves"].map((step, index) => (
                <li key={step} className="flex items-center gap-2">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[11px] font-bold text-[#02665e]">{index + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
          {!full && !open ? (
            <button
              type="button"
              onClick={() => { setOpen(true); setError(""); }}
              className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47]"
            >
              <Plus className="h-4 w-4" aria-hidden /> Invite your first member
            </button>
          ) : null}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className={`${th} pl-4`}>Person</th>
                <th className={th}>Mobile</th>
                <th className={th}>Status</th>
                <th className={th}>Invited</th>
                <th className={th}>Link valid until</th>
                <th className={`${th} pr-4 text-right`}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {data.invites.map((invite) => {
                const s = STATUS[invite.status];
                const canRenew = invite.status === "SENT" || invite.status === "EXPIRED";
                const canWithdraw = invite.status === "SENT" || invite.status === "EXPIRED" || invite.status === "ACCEPTED";
                return (
                  <tr key={invite.reference} className="border-0 border-t border-solid border-slate-100 align-top">
                    <td className="py-3 pl-4 pr-3 text-[13px] font-semibold text-slate-900">{invite.name}</td>
                    <td className="px-3 py-3 font-mono text-[12px] text-slate-600">{invite.phone}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${s.tone}`}>
                        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />{s.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {invite.note || (invite.status === "SENT" ? (invite.openedAt ? `Opened ${eatDate(invite.openedAt)}` : "Not opened yet") : s.hint)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[12px] text-slate-600">{eatDate(invite.createdAt)}</td>
                    <td className="px-3 py-3 text-[12px] text-slate-600">{invite.status === "SENT" || invite.status === "EXPIRED" ? eatDate(invite.expiresAt) : "–"}</td>
                    <td className="py-3 pl-3 pr-4 text-right">
                      <div className="inline-flex gap-1.5">
                        {canRenew ? (
                          <button type="button" onClick={() => void renew(invite)} disabled={!!busy} className="inline-flex h-7 items-center gap-1 rounded-md border border-solid border-slate-300 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                            {busy === `renew-${invite.reference}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" aria-hidden />} New link
                          </button>
                        ) : null}
                        {canWithdraw ? (
                          <button type="button" onClick={() => void withdraw(invite)} disabled={!!busy} className="inline-flex h-7 items-center gap-1 rounded-md border border-solid border-rose-200 bg-white px-2 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50">
                            {busy === `withdraw-${invite.reference}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" aria-hidden />} Withdraw
                          </button>
                        ) : null}
                        {invite.status === "JOINED" ? <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700"><Send className="h-3 w-3" aria-hidden /> In team</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
