"use client";

// A client confirming the group stay a NoLSAF sales partner prepared for them.
// The link only works for the signed-in account whose phone the partner used.
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, ShieldCheck, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Preview = {
  partnerCode: string | null;
  expiresAt: string;
  request: {
    groupType: string;
    destination: string;
    accommodationType: string;
    headcount: number;
    roomsNeeded: number;
    checkIn: string | null;
    checkOut: string | null;
    rosterCount: number;
  };
  payment: string;
};

const day = (v: string | null) =>
  v ? new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "Flexible";
const label = (v: string) => (v ? v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ") : "-");

function ConfirmInner() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("t") || "";
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "signin" | "verify" | "invalid" | "done">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.post("/api/agency-group/preview", { token });
        setPreview(res.data);
        setState("ready");
      } catch (cause: any) {
        const status = cause?.response?.status;
        if (status === 401) setState("signin");
        else if (cause?.response?.data?.code === "PHONE_NOT_VERIFIED") setState("verify");
        else {
          setError(cause?.response?.data?.error || "This link is not valid.");
          setState("invalid");
        }
      }
    })();
  }, [token]);

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post("/api/agency-group/confirm", { token });
      setState("done");
    } catch (cause: any) {
      if (cause?.response?.data?.code === "PHONE_NOT_VERIFIED") setState("verify");
      else setError(cause?.response?.data?.error || "Could not confirm this request.");
    } finally {
      setBusy(false);
    }
  };

  const card = "rounded-2xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.05)] sm:p-6";
  const next = typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/account/group-stays";

  return (
    <div className="mx-auto w-full max-w-xl space-y-4 [&_*]:box-border">
      <h1 className="m-0 text-[24px] font-bold text-slate-950">Confirm your group stay</h1>

      {state === "loading" ? (
        <div className={`${card} grid min-h-40 place-items-center text-slate-400`}><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : state === "signin" ? (
        <div className={card}>
          <p className="m-0 text-sm text-slate-700">Sign in with the phone number this request was sent to, then come back to this link.</p>
          <Link href={`/account/login?next=${encodeURIComponent(next)}`} className="mt-4 inline-flex h-10 items-center rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:no-underline">Sign in</Link>
        </div>
      ) : state === "verify" ? (
        <div className={card}>
          <p className="m-0 flex items-start gap-2 text-sm text-slate-700"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" />Your phone number needs to be verified before you can confirm. Sign out, then sign in again with the code we text to your phone, and open this link again.</p>
          <Link href={`/account/login?next=${encodeURIComponent(next)}`} className="mt-4 inline-flex h-10 items-center rounded-lg bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:no-underline">Sign in with a phone code</Link>
        </div>
      ) : state === "invalid" ? (
        <div className={card}>
          <p className="m-0 flex items-start gap-2 text-sm text-slate-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />{error}</p>
          <p className="m-0 mt-3 text-xs text-slate-500">If you did not ask for a group stay, you can ignore this. Nothing is booked and nothing is charged.</p>
        </div>
      ) : state === "done" ? (
        <div className={card}>
          <p className="m-0 flex items-center gap-2 text-sm font-semibold text-emerald-800"><CheckCircle2 className="h-5 w-5" />Your group stay request is confirmed.</p>
          <p className="m-0 mt-2 text-sm text-slate-600">Property owners can now send offers. You will be told when offers are ready to compare. You choose, and you pay NoLSAF directly.</p>
          <button type="button" onClick={() => router.push("/account/group-stays")} className="mt-4 inline-flex h-10 items-center rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white">Go to my group stays</button>
        </div>
      ) : preview ? (
        <div className={card}>
          <p className="m-0 text-sm text-slate-600">
            NoLSAF sales partner <span className="font-semibold text-slate-900">{preview.partnerCode || ""}</span> prepared this request for you. Check it before you confirm.
          </p>
          <dl className="m-0 mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            {[
              ["Destination", preview.request.destination || "-"],
              ["Group", label(preview.request.groupType)],
              ["People", String(preview.request.headcount)],
              ["Rooms", String(preview.request.roomsNeeded)],
              ["Accommodation", label(preview.request.accommodationType)],
              ["Guest list", preview.request.rosterCount ? `${preview.request.rosterCount} people` : "Not added"],
              ["Check-in", day(preview.request.checkIn)],
              ["Check-out", day(preview.request.checkOut)],
            ].map(([k, v]) => (
              <div key={k} className="min-w-0">
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="m-0 mt-0.5 truncate font-semibold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="m-0 mt-4 flex items-start gap-2 rounded-xl bg-[#02665e]/[0.06] px-3 py-2.5 text-[13px] text-[#02665e]"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{preview.payment}</p>
          {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
          <button type="button" onClick={() => void confirm()} disabled={busy} className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}Confirm this group stay
          </button>
          <p className="m-0 mt-2 text-center text-xs text-slate-500">Link valid until {day(preview.expiresAt)}.</p>
        </div>
      ) : null}
    </div>
  );
}

export default function AgencyGroupConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}
