"use client";

/**
 * Admin view of a sales partner's ID card: current status, how often owners
 * checked it, and an immediate cancel. A cancelled card tells any owner who
 * checks it not to deal with this person on NoLSAF's behalf.
 */
import { useState } from "react";
import { IdCard, Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type AdminIdCard = {
  id: number;
  cardNumber: string;
  status: string;
  issuedAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokeReason: string | null;
  verifyCount: number;
  lastVerifiedAt: string | null;
};

function day(value: string | null) {
  return value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "";
}

const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700",
  REPLACED: "bg-neutral-100 text-neutral-600",
  REVOKED: "bg-rose-50 text-rose-700",
};

export default function PartnerIdCardAdmin({ partnerId, cards, onChanged }: { partnerId: number; cards?: AdminIdCard[]; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = cards ?? [];
  const active = list.find((card) => card.status === "ACTIVE" && new Date(card.expiresAt).getTime() > Date.now());

  const revoke = async () => {
    if (reason.trim().length < 5) return setError("Give a reason of at least 5 characters.");
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/admin/sales/partners/${partnerId}/card/revoke`, { reason: reason.trim() });
      setOpen(false);
      setReason("");
      onChanged();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not cancel the card.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 className="m-0 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-neutral-500"><IdCard className="h-3.5 w-3.5" /> ID card</h3>
      <div className="mt-2 rounded-lg border border-solid border-neutral-200 p-3 text-xs">
        {list.length === 0 ? (
          <p className="m-0 text-neutral-500">No card issued yet. The partner issues it from their portal once they have a profile photo.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0">
            {list.map((card) => (
              <li key={card.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono font-semibold text-neutral-900">{card.cardNumber}</span>
                <span className={`rounded px-1.5 py-0.5 font-semibold ${TONE[card.status] ?? TONE.REPLACED}`}>{card.status === "ACTIVE" && new Date(card.expiresAt).getTime() <= Date.now() ? "Expired" : card.status.charAt(0) + card.status.slice(1).toLowerCase()}</span>
                <span className="text-neutral-500">Issued {day(card.issuedAt)} · until {day(card.expiresAt)}</span>
                <span className="text-neutral-500">Checked {card.verifyCount} {card.verifyCount === 1 ? "time" : "times"}{card.lastVerifiedAt ? `, last ${day(card.lastVerifiedAt)}` : ""}</span>
                {card.revokeReason && card.status === "REVOKED" && <span className="w-full text-rose-700">Cancelled: {card.revokeReason}</span>}
              </li>
            ))}
          </ul>
        )}

        {active && !open && (
          <button type="button" onClick={() => setOpen(true)} className="mt-3 inline-flex h-8 items-center rounded-md border border-solid border-rose-200 bg-white px-2.5 text-xs font-semibold text-rose-700 [font-family:inherit] hover:bg-rose-50">
            Cancel this card now
          </button>
        )}
        {active && open && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason (shown to the partner)"
              className="h-8 min-w-0 flex-1 rounded-md border border-solid border-neutral-200 px-2 text-xs outline-none focus:border-rose-300"
            />
            <button type="button" onClick={() => void revoke()} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-md border-0 bg-rose-600 px-2.5 text-xs font-semibold text-white [font-family:inherit] disabled:opacity-50">
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Cancel card
            </button>
            <button type="button" onClick={() => setOpen(false)} className="h-8 rounded-md border border-solid border-neutral-200 bg-white px-2.5 text-xs font-semibold text-neutral-700 [font-family:inherit]">Keep</button>
          </div>
        )}
        {error && <p className="m-0 mt-2 text-rose-700">{error}</p>}
      </div>
    </div>
  );
}
