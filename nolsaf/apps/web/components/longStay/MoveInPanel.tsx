"use client";

/**
 * Move-in day and after (docs/LONG_STAY_RENTALS.md section 3.3 steps 6 and 7,
 * milestone 7). Each side confirms once; a problem opens a dispute that
 * freezes the tenancy for NoLSAF. The server decides what counts as let.
 */
import { useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Clock3, Home, Loader2, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Side = "TENANT" | "LANDLORD";
export type MoveInView = {
  ref: string;
  status: string;
  money: { currency: string; balanceDue: number } | null;
  moveIn?: { landlordConfirmedAt: string | null; tenantConfirmedAt: string | null; landlordBalanceAmount: number | null; tenantBalanceAmount: number | null; confirmedAt: string | null; confirmedBy: string | null; balanceMismatch: boolean };
  payout?: { status: string; releasedAt: string | null } | null;
};

function money(value: number | null | undefined, currency: string) {
  return `${currency} ${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: currency === "TZS" ? 0 : 2 })}`;
}
function day(iso: string | null | undefined) {
  return iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "";
}

const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:opacity-50 [font-family:inherit]";
const primary = `${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`;
const outline = `${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`;

export default function MoveInPanel({ side, view, base, onChanged }: { side: Side; view: MoveInView; base: string; onChanged: () => Promise<void> | void }) {
  const m = view.money;
  const mi = view.moveIn;
  const ref = encodeURIComponent(view.ref);
  const [amount, setAmount] = useState(m ? String(m.balanceDue) : "");
  const [method, setMethod] = useState<"BANK" | "MOBILE_MONEY" | "">("");
  const [keys, setKeys] = useState(false);
  const [asListed, setAsListed] = useState(false);
  const [problem, setProblem] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!m || !mi) return null;
  const mine = side === "TENANT" ? mi.tenantConfirmedAt : mi.landlordConfirmedAt;
  const theirs = side === "TENANT" ? mi.landlordConfirmedAt : mi.tenantConfirmedAt;
  const canConfirm = view.status === "MOVE_IN" && !mine;
  const canDispute = ["RESERVED", "MOVE_IN", "ACTIVE", "ENDING", "OVERDUE"].includes(view.status);
  const canPhoto = ["MOVE_IN", "ACTIVE", "ENDING", "DISPUTED"].includes(view.status);

  const post = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`${base}/tenancies/${ref}/${path}`, body);
      await onChanged();
      return true;
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save. Try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const confirm = () => {
    if (!method) { setError("Choose how the balance was paid."); return; }
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) { setError("Enter the amount."); return; }
    if (side === "TENANT" && !(keys && asListed)) { setError("Tick both boxes, or report a problem instead."); return; }
    void post("confirm", "move-in/confirm", side === "TENANT" ? { balanceAmount: value, method, keysReceived: true, matchesListing: true } : { balanceAmount: value, method });
  };

  const uploadPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const picked = Array.from(files).slice(0, 12);
    if (picked.some((f) => !["image/jpeg", "image/png"].includes(f.type) || f.size > 2 * 1024 * 1024)) { setError("Use JPG or PNG photos up to 2MB each."); return; }
    setUploading(true);
    setError("");
    try {
      const urls: string[] = [];
      for (const file of picked) {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", "uploads");
        const uploaded = (await apiClient.post("/api/uploads/cloudinary/upload?folder=uploads", form, { headers: { "Content-Type": "multipart/form-data" } })).data as { secure_url: string };
        urls.push(uploaded.secure_url);
      }
      await post("photos", "photos", { urls });
    } catch {
      setError("Could not upload the photos. Try again.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      {/* Where it stands */}
      {view.status === "ACTIVE" || view.status === "ENDING" ? (
        <div className="rounded-md bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-900">
          <p className="m-0 flex items-center gap-2 font-semibold"><Home className="h-4 w-4" />Let since {day(mi.confirmedAt)}</p>
          <p className="m-0 mt-0.5 text-emerald-800">
            {mi.confirmedBy === "BOTH" ? "Both of you confirmed move-in." : mi.confirmedBy === "ADMIN" ? "NoLSAF confirmed move-in." : "Confirmed by one side after 72 hours with no reply."}
            {mi.balanceMismatch ? " The balance confirmed did not match the lease; NoLSAF is checking it." : ""}
          </p>
        </div>
      ) : view.status === "DISPUTED" ? (
        <p className="m-0 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />A problem was reported. Everything is on hold while NoLSAF talks to both of you.
        </p>
      ) : null}

      {/* Confirmation */}
      {view.status === "MOVE_IN" ? (
        mine ? (
          <p className="m-0 flex items-start gap-2 text-[13px] text-slate-700">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            You confirmed. {theirs ? "" : `Waiting for the ${side === "TENANT" ? "landlord" : "tenant"}. If they do not reply within 72 hours, move-in counts as confirmed.`}
          </p>
        ) : canConfirm && !problem ? (
          <div className="rounded-md border border-solid border-slate-200 p-3">
            <p className="m-0 text-[13px] font-semibold text-slate-900">{side === "TENANT" ? "Confirm your move-in" : "Confirm the balance you received"}</p>
            <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">The lease balance is {money(m.balanceDue, m.currency)}. Enter what was actually {side === "TENANT" ? "paid" : "received"}.</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-600">Amount ({m.currency})</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="h-9 w-full rounded-md border border-solid border-slate-300 px-3 text-sm outline-none focus:border-[#02665e]" />
              </label>
              <div>
                <span className="mb-1 block text-xs font-semibold text-slate-600">Paid by</span>
                <div className="grid grid-cols-2 gap-1.5">
                  {([["BANK", "Bank transfer"], ["MOBILE_MONEY", "Mobile money"]] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setMethod(key)}
                      className={`h-9 cursor-pointer rounded-md border border-solid text-[13px] font-semibold [font-family:inherit] ${method === key ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{label}</button>
                  ))}
                </div>
              </div>
            </div>
            {side === "TENANT" ? (
              <div className="mt-2 space-y-1.5 text-[13px] text-slate-700">
                <label className="flex items-start gap-2"><input type="checkbox" checked={keys} onChange={(e) => setKeys(e.target.checked)} className="mt-0.5 h-4 w-4" />I received the keys.</label>
                <label className="flex items-start gap-2"><input type="checkbox" checked={asListed} onChange={(e) => setAsListed(e.target.checked)} className="mt-0.5 h-4 w-4" />The home matches the listing.</label>
              </div>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy === "confirm"} onClick={confirm} className={primary}>
                {busy === "confirm" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Confirm move-in
              </button>
              <button type="button" onClick={() => setProblem(true)} className={`${btn} border-0 bg-transparent text-red-700 hover:bg-red-50`}>Report a problem</button>
            </div>
          </div>
        ) : null
      ) : null}

      {/* Problem */}
      {problem ? (
        <div className="rounded-md border border-solid border-red-200 bg-red-50/40 p-3">
          <label htmlFor="dispute-reason" className="block text-[13px] font-semibold text-red-800">What is wrong?</label>
          <textarea id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder={side === "TENANT" ? "e.g. no keys handed over, or the home is not the one listed" : "e.g. the tenant did not pay the balance"}
            className="mt-1.5 min-h-20 w-full resize-y rounded-md border border-solid border-red-200 bg-white px-3 py-2 text-sm outline-none focus:border-red-400 [font-family:inherit]" />
          <p className="m-0 mt-1 text-[12px] text-slate-500">This freezes the tenancy and the payout until NoLSAF has spoken to both of you.</p>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={reason.trim().length < 10 || busy === "dispute"} onClick={async () => { if (await post("dispute", "dispute", { reason: reason.trim() })) setProblem(false); }} className={`${btn} border-0 bg-red-600 text-white hover:bg-red-700`}>Report to NoLSAF</button>
            <button type="button" onClick={() => setProblem(false)} className={outline}>Back</button>
          </div>
        </div>
      ) : canDispute && view.status !== "MOVE_IN" ? (
        <button type="button" onClick={() => setProblem(true)} className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-red-700 hover:underline [font-family:inherit]">Report a problem</button>
      ) : null}

      {/* Condition photos */}
      {canPhoto ? (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(e) => void uploadPhotos(e.target.files)} />
          <button type="button" disabled={uploading || busy === "photos"} onClick={() => fileRef.current?.click()} className={outline}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Add condition photos
          </button>
          <span className="text-[12px] text-slate-500">Photos of each room on move-in day are your record if anything is disputed later.</span>
        </div>
      ) : null}

      {view.status === "ACTIVE" && mi.confirmedBy ? (
        <p className="m-0 flex items-center gap-1.5 text-[12px] text-slate-500"><CheckCircle2 className="h-3.5 w-3.5" />Balance confirmed: {mi.landlordBalanceAmount != null ? `landlord ${money(mi.landlordBalanceAmount, m.currency)}` : "landlord not confirmed"} · {mi.tenantBalanceAmount != null ? `tenant ${money(mi.tenantBalanceAmount, m.currency)}` : "tenant not confirmed"}</p>
      ) : null}

      {error ? <p className="m-0 text-[13px] text-red-700">{error}</p> : null}
    </div>
  );
}
