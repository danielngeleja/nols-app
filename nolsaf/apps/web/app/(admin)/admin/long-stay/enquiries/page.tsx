"use client";

/**
 * Ask NoLSAF (docs/LONG_STAY_RENTALS.md section 13). Tenants' questions about
 * long-stay homes, and requests to visit one with a Sales Partner. NoLSAF is
 * the bridge: staff may call the landlord for an answer, but the tenant only
 * ever hears from NoLSAF until the booking is paid.
 */
import { useCallback, useEffect, useState } from "react";
import { CalendarClock, CheckCircle2, Inbox, Loader2, MessageCircleQuestion, Phone } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesAdminHeader from "@/components/admin/sales/SalesAdminHeader";

type View = "open" | "answered" | "closed";
type Item = {
  ref: string;
  kind: "QUESTION" | "VISIT";
  text: string;
  slots: string[];
  status: "OPEN" | "ANSWERED" | "CLOSED";
  answer: string | null;
  answeredAt: string | null;
  visitAt: string | null;
  partnerCode: string | null;
  home: { title: string | null; area: string };
  landlord: { name: string | null; phone: string | null };
  tenant: { name: string | null; phone: string | null };
  createdAt: string;
};

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}

export default function LongStayEnquiriesPage() {
  const [view, setView] = useState<View>("open");
  const [items, setItems] = useState<Item[] | null>(null);
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await apiClient.get<{ items: Item[]; openCount: number }>(`/api/admin/long-stay/enquiries?view=${view}`);
      setItems(r.data.items);
      setOpenCount(r.data.openCount);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load questions.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div id="ls-enquiries" className="w-full">
      <style>{`#ls-enquiries, #ls-enquiries * { box-sizing: border-box; }`}</style>
      <SalesAdminHeader<View>
        kicker="Long stays"
        title="Ask NoLSAF"
        description="Tenants ask NoLSAF, never the landlord, before they pay. Answer from what you know, or call the landlord and answer for them."
        metrics={[{ label: "Waiting for an answer", value: openCount ?? "-", tone: openCount ? "warn" : "default" }]}
        onRefresh={load}
        loading={loading}
        tabs={[
          { key: "open", label: "Waiting", Icon: Inbox, count: openCount ?? undefined },
          { key: "answered", label: "Answered", Icon: CheckCircle2 },
          { key: "closed", label: "Closed", Icon: MessageCircleQuestion },
        ]}
        activeTab={view}
        onTab={setView}
      />
      {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 space-y-3">
        {items === null ? (
          <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-solid border-slate-200 bg-white px-5 py-10 text-center text-sm text-slate-500">{view === "open" ? "All answered." : "Nothing here yet."}</div>
        ) : (
          items.map((item) => <EnquiryCard key={item.ref} item={item} onChanged={load} />)
        )}
      </div>
    </div>
  );
}

function EnquiryCard({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [answer, setAnswer] = useState(item.answer ?? "");
  const [visitSlot, setVisitSlot] = useState(item.visitAt ?? "");
  const [partnerCode, setPartnerCode] = useState(item.partnerCode ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const post = async (key: string, path: string, body: unknown) => {
    setBusy(key);
    setError("");
    try {
      await apiClient.post(`/api/admin/long-stay/enquiries/${encodeURIComponent(item.ref)}/${path}`, body);
      onChanged();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not save.");
    } finally {
      setBusy(null);
    }
  };

  const btn = "inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 [font-family:inherit]";
  const Icon = item.kind === "VISIT" ? CalendarClock : MessageCircleQuestion;

  return (
    <article className="rounded-lg border border-solid border-slate-200 bg-white">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15px] font-bold text-slate-900">{item.kind === "VISIT" ? "Visit request" : "Question"}: {item.home.title} <span className="text-[13px] font-normal text-slate-500">{item.home.area}</span></p>
          <p className="m-0 mt-1 whitespace-pre-wrap text-sm text-slate-800">{item.text}</p>
          {item.slots.length ? <p className="m-0 mt-1.5 text-[12.5px] text-slate-600">Suits the tenant: {item.slots.map(eat).join("; ")}</p> : null}
          <p className="m-0 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12.5px] text-slate-500">
            <span>Tenant: {item.tenant.name || "-"}{item.tenant.phone ? <> · <a href={`tel:${item.tenant.phone}`} className="text-[#02665e] no-underline">{item.tenant.phone}</a></> : null}</span>
            <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />Landlord, for NoLSAF only: {item.landlord.name || "-"}{item.landlord.phone ? <> · <a href={`tel:${item.landlord.phone}`} className="text-[#02665e] no-underline">{item.landlord.phone}</a></> : null}</span>
            <span>Asked {eat(item.createdAt)}</span>
          </p>
        </div>
      </div>
      {item.status !== "CLOSED" ? (
        <div className="space-y-2 border-0 border-t border-solid border-slate-100 px-4 py-3">
          <label htmlFor={`a-${item.ref}`} className="block text-xs font-semibold text-slate-700">Answer (the tenant sees this; never share the landlord's contacts)</label>
          <textarea id={`a-${item.ref}`} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000}
            className="min-h-16 w-full resize-y rounded-md border border-solid border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-[#02665e] [font-family:inherit]" />
          {item.kind === "VISIT" ? (
            <div className="flex flex-wrap items-end gap-2">
              <label className="block text-xs font-semibold text-slate-700">Agreed time
                <select value={visitSlot} onChange={(e) => setVisitSlot(e.target.value)} className="mt-1 block h-9 rounded-md border border-solid border-slate-300 bg-white px-2 text-sm font-normal">
                  <option value="">Choose one the tenant suggested</option>
                  {item.slots.map((s) => <option key={s} value={s}>{eat(s)}</option>)}
                </select>
              </label>
              <label className="block text-xs font-semibold text-slate-700">Partner who goes
                <input value={partnerCode} onChange={(e) => setPartnerCode(e.target.value.toUpperCase())} placeholder="NSA-DAR-0042" maxLength={30}
                  className="mt-1 block h-9 w-44 rounded-md border border-solid border-slate-300 px-2.5 font-mono text-sm font-normal outline-none focus:border-[#02665e]" />
              </label>
            </div>
          ) : null}
          {error ? <p className="m-0 text-xs text-red-700">{error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={answer.trim().length < 5 || busy !== null || (item.kind === "VISIT" && Boolean(visitSlot) !== Boolean(partnerCode.trim()))}
              onClick={() => post("answer", "answer", { answer: answer.trim(), visitAt: item.kind === "VISIT" && visitSlot ? visitSlot : null, partnerCode: item.kind === "VISIT" && partnerCode.trim() ? partnerCode.trim() : null })}
              className={`${btn} border-0 bg-[#02665e] text-white hover:bg-[#014e47]`}>
              {busy === "answer" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}{item.status === "ANSWERED" ? "Update answer" : "Send answer"}
            </button>
            <button type="button" disabled={busy !== null} onClick={() => post("close", "close", {})} className={`${btn} border border-solid border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>Close</button>
          </div>
        </div>
      ) : item.answer ? (
        <p className="m-0 border-0 border-t border-solid border-slate-100 px-4 py-2.5 text-[13px] text-slate-700"><b>Answered:</b> {item.answer}</p>
      ) : null}
    </article>
  );
}
