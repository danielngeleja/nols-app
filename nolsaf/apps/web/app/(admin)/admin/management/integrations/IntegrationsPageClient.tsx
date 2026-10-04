"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, Cloud, CreditCard, ExternalLink, Info, Link2, Loader2, Lock, Mail, Map as MapIcon, MessageCircle, MessageSquare, RefreshCw, Send, Server, ShieldCheck, XCircle } from "lucide-react";

/**
 * Integrations: a read-only board of the outside services NoLSAF depends on.
 * Credentials live in the API's environment and are never shown or edited
 * here; the API reports only whether each variable is set, plus harmless
 * labels such as a domain or app name.
 */

type Check = { label: string; vars: string[]; ok: boolean; optional: boolean };
type Integration = { key: string; name: string; category: string; purpose: string; state: "ready" | "partial" | "missing"; checks: Check[]; provider?: string; details?: string; docs?: string };
type StatusResponse = { integrations?: Integration[]; environment?: string; checkedAt?: string };

const ICON: Record<string, typeof Mail> = { payments: CreditCard, email: Mail, sms: MessageSquare, meta: MessageCircle, media: Cloud, maps: MapIcon, redis: Server, links: Link2 };
const STATE = {
  ready: { label: "Ready", tag: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", Icon: CheckCircle2 },
  partial: { label: "Partly set up", tag: "bg-amber-50 text-amber-700 ring-amber-200", dot: "bg-amber-400", Icon: CircleDashed },
  missing: { label: "Not set up", tag: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500", Icon: XCircle },
} as const;

const card = "min-w-0 rounded-lg border border-solid border-slate-200 bg-white";
const when = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) : null);

export default function IntegrationsPage() {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/integrations/status", { credentials: "include", cache: "no-store" });
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch {
      setError("Could not read the integration status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const items = useMemo(() => data?.integrations ?? [], [data]);
  const counts = items.reduce((acc, i) => { acc[i.state] += 1; return acc; }, { ready: 0, partial: 0, missing: 0 } as Record<Integration["state"], number>);
  const categories = useMemo(() => [...new Set(items.map((i) => i.category))], [items]);

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/integrations/test-email", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: testTo.trim() }) });
      const json = await res.json().catch(() => ({}));
      setTestResult(res.ok && json.success ? { ok: true, text: `Sent through ${json.provider || json.configuredProvider} from ${json.from}. Check ${json.to}.` } : { ok: false, text: json.hint || json.error || "The test email was not sent." });
    } catch {
      setTestResult({ ok: false, text: "The test email was not sent." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div id="integrations-page" className="w-full min-w-0 space-y-4">
      <style>{`#integrations-page, #integrations-page * { box-sizing: border-box; }`}</style>

      {/* Header */}
      <header className={card}>
        <div className="flex flex-wrap items-start gap-4 px-5 py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e] text-white"><Link2 className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 text-xl font-bold tracking-tight text-slate-900">Integrations</h1>
              <span className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600"><Lock className="h-3 w-3" /> Read only</span>
              {data?.environment ? <span className="rounded bg-[#02665e]/10 px-2 py-0.5 text-[11px] font-semibold text-[#02665e]">{data.environment}</span> : null}
            </div>
            <p className="m-0 mt-1 max-w-3xl text-sm text-slate-500">The outside services NoLSAF runs on. Keys and secrets live in the API server&apos;s environment and are never shown or changed here; this page only reports whether each one is set.</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-solid border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Check again
          </button>
        </div>
        <div className="grid grid-cols-2 gap-px border-0 border-t border-solid border-slate-200 bg-slate-200 md:grid-cols-4">
          {[
            { label: "Ready", value: counts.ready, tone: "text-emerald-700" },
            { label: "Partly set up", value: counts.partial, tone: counts.partial ? "text-amber-700" : "text-slate-900" },
            { label: "Not set up", value: counts.missing, tone: counts.missing ? "text-rose-700" : "text-slate-900" },
            { label: "Last checked", value: when(data?.checkedAt) ?? "...", tone: "text-slate-900", suffix: data?.checkedAt ? " EAT" : "" },
          ].map((f) => (
            <div key={f.label} className="min-w-0 bg-white px-5 py-3.5">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{f.label}</p>
              <p className={`m-0 mt-1 text-lg font-bold tabular-nums ${f.tone}`}>{loading && !data ? "..." : f.value}<span className="text-xs font-semibold text-slate-400">{"suffix" in f ? f.suffix : ""}</span></p>
            </div>
          ))}
        </div>
      </header>

      {error ? <div className="rounded-md border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      {loading && !data ? (
        <div className={`${card} flex items-center gap-2 px-5 py-8 text-sm text-slate-500`}><Loader2 className="h-4 w-4 animate-spin" /> Checking the integrations</div>
      ) : (
        categories.map((cat) => (
          <section key={cat}>
            <p className="m-0 mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{cat}</p>
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
              {items.filter((i) => i.category === cat).map((i) => {
                const st = STATE[i.state];
                const Icon = ICON[i.key] ?? Link2;
                const required = i.checks.filter((c) => !c.optional);
                return (
                  <article key={i.key} className={`${card} flex flex-col`}>
                    <div className="flex items-start gap-3 px-4 pt-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/[0.08] text-[#02665e]"><Icon className="h-4 w-4" /></span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-bold text-slate-900">
                          {i.name}
                          {i.provider && i.provider !== i.name ? <span className="text-xs font-medium text-slate-500">via {i.provider}</span> : null}
                        </p>
                        <p className="m-0 mt-0.5 text-xs text-slate-500">{i.purpose}</p>
                      </div>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${st.tag}`}><st.Icon className="h-3 w-3" />{st.label}</span>
                    </div>

                    <div className="px-4 pt-3">
                      <span className="flex h-1 gap-0.5">
                        {required.map((c) => <span key={c.label} className={`h-full flex-1 ${c.ok ? "bg-emerald-500" : "bg-slate-200"}`} />)}
                      </span>
                      {i.details ? <p className="m-0 mt-2 rounded-md bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">{i.details}</p> : null}
                    </div>

                    <ul className="m-0 mt-3 flex-1 list-none border-0 border-t border-solid border-slate-100 p-0">
                      {i.checks.map((c) => (
                        <li key={c.label} className="flex items-start gap-2.5 border-0 border-b border-solid border-slate-100 px-4 py-2 last:border-b-0">
                          {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : c.optional ? <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />}
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-slate-800">{c.label}{c.optional ? <span className="ml-1 font-normal text-slate-400">optional</span> : null}</span>
                            <span className="mt-0.5 flex flex-wrap gap-1">
                              {c.vars.map((v) => <code key={v} className="rounded bg-slate-100 px-1.5 py-px font-mono text-[10px] text-slate-600">{v}</code>)}
                            </span>
                          </span>
                          <span className={`shrink-0 text-[10px] font-semibold ${c.ok ? "text-emerald-700" : c.optional ? "text-slate-400" : "text-rose-600"}`}>{c.ok ? "Set" : "Missing"}</span>
                        </li>
                      ))}
                    </ul>

                    {i.key === "email" && i.state !== "missing" ? (
                      <div className="border-0 border-t border-solid border-slate-100 px-4 py-3">
                        <p className="m-0 text-[11px] font-semibold text-slate-600">Send a test email</p>
                        <div className="mt-1.5 flex gap-2">
                          <input value={testTo} onChange={(e) => setTestTo(e.target.value)} type="email" placeholder="you@nolsaf.com" aria-label="Test email address" className="h-8 min-w-0 flex-1 rounded-md border border-solid border-slate-300 px-2.5 text-xs outline-none focus:border-[#02665e]" />
                          <button type="button" onClick={() => void sendTest()} disabled={testing || !testTo.includes("@")} className="inline-flex h-8 items-center gap-1 rounded-md border-0 bg-[#02665e] px-2.5 text-xs font-semibold text-white hover:bg-[#014e47] disabled:opacity-50">{testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Send</button>
                        </div>
                        {testResult ? <p className={`m-0 mt-1.5 text-[11px] ${testResult.ok ? "text-emerald-700" : "text-rose-700"}`}>{testResult.text}</p> : null}
                      </div>
                    ) : null}

                    {i.docs ? (
                      <a href={i.docs} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[11px] font-semibold text-[#02665e] no-underline hover:underline">Provider documentation <ExternalLink className="h-3 w-3" /></a>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}

      <section className={`${card} flex items-start gap-3 px-5 py-4`}>
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
        <div className="min-w-0 text-xs leading-relaxed text-slate-600">
          <p className="m-0 font-semibold text-slate-900">Changing an integration</p>
          <p className="m-0 mt-1">Set or rotate the variable on the API host, <b>Elastic Beanstalk</b> for production or <b>Render</b> for staging, then redeploy or restart the API and press <b>Check again</b>. Never paste secrets into tickets, chats or this panel.</p>
          <p className="m-0 mt-1.5 flex items-center gap-1 text-[11px] text-slate-400"><ShieldCheck className="h-3 w-3" /> Values are never sent to the browser, only whether they are set.</p>
        </div>
      </section>
    </div>
  );
}
