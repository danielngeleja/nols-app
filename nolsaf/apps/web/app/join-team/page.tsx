"use client";

/**
 * A team lead's invite link. Outside /sales on purpose: the recruit may not
 * be signed in yet, so the page first says who invited them and only then
 * asks them to sign in (and returns here). Accepting grants nothing: NoLSAF
 * reviews, sends the agreement, and they join the team at activation.
 */
import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Circle, FileSignature, Loader2, LogIn, ShieldCheck, UserPlus, Users } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Preview = { inviteeFirstName: string; leadFirstName: string; teamName: string; region: string | null; expiresAt: string };
type Mine = { status: string; teamName: string; leadFirstName: string; acceptedAt: string | null; decidedAt: string | null; missing: string[] };

const STEPS = [
  { key: "apply", label: "You accept", Icon: UserPlus },
  { key: "review", label: "NoLSAF reviews", Icon: ShieldCheck },
  { key: "sign", label: "You sign", Icon: FileSignature },
  { key: "join", label: "You join the team", Icon: Users },
];

/** Where each missing item is filled in on the account page. */
const FIELD_LINK: Record<string, string> = {
  Address: "/account#profile-address",
  "National ID number": "/account#profile-nin",
};

function stepIndex(status: string | null) {
  if (status === "ACCEPTED") return 1;
  if (status === "APPROVED") return 2;
  if (status === "JOINED") return 4;
  return 0;
}

function eatDate(value: string) {
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

async function getJson(url: string): Promise<{ status: number; body: any }> {
  const response = await fetch(url, { credentials: "include", cache: "no-store" });
  let body: any = null;
  try { body = await response.json(); } catch { /* empty */ }
  return { status: response.status, body };
}

export default function JoinTeamPage() {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mine, setMine] = useState<Mine | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (t: string) => {
    setLoading(true);
    try {
      const [p, m] = await Promise.all([
        t ? getJson(`/api/sales-join/preview?t=${encodeURIComponent(t)}`) : Promise.resolve({ status: 200, body: { valid: false } }),
        getJson("/api/sales-join/mine"),
      ]);
      setPreview(p.body?.valid ? p.body.invite : null);
      setSignedIn(m.status !== 401 && m.status !== 403);
      setMine(m.status === 200 ? m.body?.invite ?? null : null);
    } catch {
      setError("The invite could not be checked. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = String(new URLSearchParams(window.location.search).get("t") || "").trim();
    setToken(t);
    void load(t);
  }, [load]);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post("/api/sales-join/accept", { token });
      await load(token);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not accept this invite.");
    } finally {
      setBusy(false);
    }
  };

  // A fresh valid link wins over an earlier application that was not approved.
  const fresh = Boolean(preview) && (!mine || mine.status === "REJECTED");
  const shown = fresh ? null : mine;
  const status = shown?.status ?? null;
  const current = stepIndex(status);
  const back = encodeURIComponent(`/join-team?t=${token}`);

  return (
    <main id="join-team" className="min-h-screen bg-slate-50 px-4 py-8 sm:py-12">
      <style>{`#join-team, #join-team * { box-sizing: border-box; }`}</style>
      <section className="mx-auto w-full max-w-lg overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        <header className="flex items-center gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-solid border-slate-200 bg-white">
            <Image src="/assets/NoLS2025-04.png" alt="NoLSAF" width={36} height={36} className="h-8 w-8 scale-[1.9] object-contain" />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-slate-900">NoLSAF sales team invite</p>
            <p className="m-0 text-[12px] text-slate-500">A personal invitation from a NoLSAF team lead</p>
          </div>
        </header>

        <div className="px-5 py-5">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Checking the invite</div>
          ) : shown ? (
            <>
              <h1 className="m-0 text-lg font-bold text-slate-900">
                {status === "JOINED" ? `You are in ${shown.teamName}` : status === "REJECTED" ? "Application not approved" : `Your application to ${shown.teamName}`}
              </h1>
              <p className="m-0 mt-1 text-[13px] leading-5 text-slate-600">
                {status === "ACCEPTED" && `${shown.leadFirstName} invited you. NoLSAF is reviewing your application and will contact you.`}
                {status === "APPROVED" && "NoLSAF approved you. Sign the agreement sent to your email; you join the team as soon as it is activated."}
                {status === "JOINED" && "Welcome to the team. Open your sales workspace to start."}
                {status === "REJECTED" && "NoLSAF did not approve this application. Contact NoLSAF support if you have questions."}
              </p>
            </>
          ) : preview ? (
            <>
              <h1 className="m-0 text-lg font-bold text-slate-900">Hi {preview.inviteeFirstName}, {preview.leadFirstName} invited you</h1>
              <p className="m-0 mt-1 text-[13px] leading-5 text-slate-600">
                Join <span className="font-semibold text-slate-800">{preview.teamName}</span>{preview.region ? ` in ${preview.region}` : ""} as a NoLSAF sales representative.
              </p>
            </>
          ) : (
            <div className="py-4 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-amber-500" aria-hidden />
              <h1 className="m-0 mt-3 text-lg font-bold text-slate-900">This invite link is not valid</h1>
              <p className="m-0 mt-1 text-[13px] text-slate-600">It may have expired, been replaced or already been used. Ask your team lead for a new link.</p>
            </div>
          )}

          {!loading && (preview || shown) && status !== "REJECTED" ? (
            <ol className="m-0 mt-5 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-4" aria-label="Steps">
              {STEPS.map((s, i) => {
                const done = current > i;
                const active = current === i;
                return (
                  <li key={s.key} className={`flex items-center gap-2 rounded-md px-2.5 py-2 sm:flex-col sm:gap-1.5 sm:text-center ${active ? "bg-slate-50" : ""}`}>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ${done ? "bg-[#02665e] text-white" : active ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-400"}`}>
                      {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : <s.Icon className="h-4 w-4" aria-hidden />}
                    </span>
                    <span className={`text-[12px] font-semibold leading-tight ${done ? "text-[#02665e]" : active ? "text-slate-900" : "text-slate-400"}`}>{s.label}</span>
                  </li>
                );
              })}
            </ol>
          ) : null}

          {shown && status === "ACCEPTED" && shown.missing.length ? (
            <div className="mt-5 rounded-md border border-solid border-amber-200 bg-amber-50 px-4 py-3">
              <p className="m-0 text-[13px] font-semibold text-amber-900">Complete your profile so NoLSAF can send your agreement</p>
              <ul className="m-0 mt-2 list-none space-y-1.5 p-0">
                {shown.missing.map((item) => (
                  <li key={item}>
                    <Link href={FIELD_LINK[item] || "/account#profile-heading"} className="inline-flex items-center gap-2 text-[13px] font-medium text-amber-900 no-underline hover:underline">
                      <Circle className="h-3 w-3" aria-hidden /> {item} <ArrowRight className="h-3 w-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {!loading && preview && fresh ? (
            <>
              <ul className="m-0 mt-5 list-none space-y-2 p-0 text-[13px] text-slate-600">
                <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden /> NoLSAF checks every application before anyone joins.</li>
                <li className="flex gap-2"><FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden /> If approved, you sign your own NoLSAF agreement and earn from your own work.</li>
                <li className="flex gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden /> Your team lead coaches you; they never see your earnings or payout details.</li>
              </ul>
              {signedIn ? (
                <button type="button" onClick={() => void accept()} disabled={busy} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:opacity-60">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <UserPlus className="h-4 w-4" aria-hidden />} Accept and apply
                </button>
              ) : (
                <div className="mt-5 grid gap-2">
                  <Link href={`/account/login?next=${back}`} className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014d47] hover:no-underline">
                    <LogIn className="h-4 w-4" aria-hidden /> Sign in to accept {preview.leadFirstName}&apos;s invite
                  </Link>
                  <Link href={`/account/register?next=${back}`} className="inline-flex h-11 items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50 hover:no-underline">
                    New to NoLSAF? Create your account
                  </Link>
                </div>
              )}
              <p className="m-0 mt-2 text-center text-[11px] text-slate-500">Valid until {eatDate(preview.expiresAt)}. Accepting does not make you a partner yet.</p>
            </>
          ) : null}

          {status === "JOINED" ? (
            <Link href="/sales" className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-md bg-[#02665e] text-sm font-semibold text-white no-underline hover:bg-[#014d47] hover:no-underline">Open my sales workspace</Link>
          ) : null}

          {error ? <p className="m-0 mt-3 flex items-start gap-2 text-[13px] text-rose-700" role="alert"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        </div>
      </section>
    </main>
  );
}
