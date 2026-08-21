"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import apiClient from "@/lib/apiClient";
import { Building2, CheckCircle2, Clock, Handshake, Loader2, MapPin, Search, ShieldCheck, X } from "lucide-react";

type DiscoveryItem = {
  property: { id: number; title: string; type: string; summary: string | null; hotelStar: string | null; location: string; imageUrl: string | null };
  relationship: { linkId: number; status: string; initiatedBy: string; requestedAt: string } | null;
  acceptingRequests: boolean;
  requestAvailability: { code: "OPEN" | "SETUP_PENDING" | "NOT_ACCEPTING"; label: string };
};

const STATUS: Record<string, { label: string; cls: string }> = {
  INVITED: { label: "Hotel invitation", cls: "border-neutral-200 bg-white text-neutral-700" },
  REQUESTED: { label: "Request pending", cls: "border-neutral-200 bg-neutral-50 text-neutral-600" },
  AGENT_ACCEPTED: { label: "Awaiting activation", cls: "border-amber-200 bg-amber-50 text-amber-800" },
  ACTIVE: { label: "Active partner", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  SUSPENDED: { label: "Suspended", cls: "border-neutral-200 bg-neutral-100 text-neutral-600" },
  REJECTED: { label: "Previously declined", cls: "border-neutral-200 bg-neutral-100 text-neutral-600" },
  TERMINATED: { label: "Previously ended", cls: "border-neutral-200 bg-neutral-100 text-neutral-600" },
};

function propertyType(value: string) {
  return String(value || "Property").replace(/_/g, " ").toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function PropertyCardPhoto({ src, title }: { src: string | null; title: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <>
        <span className="absolute bottom-2.5 left-2.5 text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400">NRMS verified</span>
        <Building2 className="absolute bottom-2.5 right-2.5 h-7 w-7 text-neutral-300 sm:h-8 sm:w-8" />
      </>
    );
  }

  return (
    <Image
      src={src}
      alt={`${title} property photo`}
      fill
      sizes="(max-width: 639px) 50vw, (max-width: 1279px) 33vw, 20vw"
      unoptimized
      onError={() => setFailed(true)}
      className="object-cover object-center transition-transform duration-300 group-hover:scale-[1.025]"
    />
  );
}

export default function PartnerHotelsPage() {
  const [items, setItems] = useState<DiscoveryItem[]>([]);
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [applied, setApplied] = useState({ q: "", region: "" });
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requestFor, setRequestFor] = useState<DiscoveryItem | null>(null);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<any>("/api/agent-portal/partnerships/discover", {
        params: { q: applied.q || undefined, region: applied.region || undefined, page, pageSize: 10 },
      });
      setItems(response.data?.items ?? []);
      setTotalPages(Number(response.data?.totalPages ?? 0));
      setTotal(Number(response.data?.total ?? 0));
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Partner hotels could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [applied, page]);

  useEffect(() => { void load(); }, [load]);

  const applySearch = () => {
    setPage(1);
    setApplied({ q: query.trim(), region: region.trim() });
    setNotice(null);
  };

  const requestPartnership = async () => {
    if (!requestFor) return;
    setRequesting(true);
    setError(null);
    setNotice(null);
    try {
      await apiClient.post("/api/agent-portal/partnerships/requests", { propertyId: requestFor.property.id });
      setNotice(`Partnership request sent to ${requestFor.property.title}. The hotel must approve it before any booking access opens.`);
      setRequestFor(null);
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "The partnership request could not be sent.");
    } finally {
      setRequesting(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
      <header className="overflow-hidden rounded-2xl border border-solid border-neutral-200 bg-white shadow-sm">
        <div className="flex min-w-0 items-center gap-3 p-4 sm:gap-5 sm:p-5">
          <span className="hidden h-12 w-12 flex-shrink-0 place-items-center rounded-2xl border border-solid border-emerald-100 bg-emerald-50 text-emerald-700 sm:grid">
            <ShieldCheck className="h-5 w-5" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 flex-1">
            <span className="inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Partnership discovery</span>
            <h1 className="m-0 mt-1.5 text-xl font-extrabold tracking-[-0.02em] text-neutral-950 sm:text-2xl">Find partner hotels</h1>
            <p className="m-0 mt-1 max-w-2xl text-xs leading-5 text-neutral-500 sm:text-[13px]">Discover verified NRMS properties and request access using your approved agency identity. Private rates and inventory remain protected until the hotel accepts.</p>
          </div>
          <div className="flex min-w-[4.25rem] flex-shrink-0 flex-col items-center border-0 border-l border-solid border-neutral-200 pl-3 sm:min-w-[5.5rem] sm:pl-5">
            <strong className="text-2xl font-extrabold leading-none tracking-tight text-neutral-900">{total}</strong>
            <span className="mt-1 text-[8px] font-bold uppercase tracking-[0.12em] text-neutral-400">Eligible hotels</span>
          </div>
        </div>
      </header>

      <form onSubmit={(event) => { event.preventDefault(); applySearch(); }} className="grid min-w-0 gap-2 rounded-2xl border border-neutral-200 bg-white p-2.5 shadow-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_auto] sm:gap-3 sm:p-3">
        <label className="relative block"><span className="sr-only">Search hotels</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Hotel name or type" className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100" /></label>
        <label className="relative block"><span className="sr-only">Region or city</span><MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" /><input value={region} onChange={(event) => setRegion(event.target.value)} maxLength={100} placeholder="Region, city or country" className="min-h-11 w-full rounded-xl border border-neutral-200 bg-neutral-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-emerald-400 focus:bg-white focus:ring-2 focus:ring-emerald-100" /></label>
        <button type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-neutral-900 bg-neutral-900 px-5 text-sm font-bold text-white transition hover:bg-neutral-800"><Search className="h-4 w-4" /> Search</button>
      </form>

      {notice ? <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">{notice}</div> : null}
      {error ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-800">{error}</div> : null}

      {loading ? (
        <div className="grid w-full min-w-0 grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5" aria-label="Loading partner hotels">
          {Array.from({ length: 10 }, (_, index) => (
            <div key={index} className="animate-pulse overflow-hidden rounded-xl border border-neutral-200 bg-white">
              <div className="aspect-[16/10] bg-neutral-100 sm:aspect-video" />
              <div className="space-y-2 p-2.5 sm:p-3"><div className="h-3 w-2/3 rounded bg-neutral-100" /><div className="h-2.5 w-1/2 rounded bg-neutral-100" /><div className="h-8 rounded bg-neutral-50" /></div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-neutral-300 bg-white p-10 text-center"><Building2 className="mx-auto h-9 w-9 text-neutral-300" /><h2 className="m-0 mt-3 text-base font-bold text-neutral-800">No matching hotels</h2><p className="m-0 mt-1 text-sm text-neutral-500">Try a broader name or location.</p></div>
      ) : (
        <div className="grid w-full min-w-0 grid-cols-2 gap-2.5 sm:gap-3 xl:grid-cols-5">
          {items.map((item) => {
            const state = item.relationship ? (STATUS[item.relationship.status] ?? { label: item.relationship.status, cls: "border-neutral-200 bg-neutral-100 text-neutral-600" }) : null;
            const active = item.relationship?.status === "ACTIVE";
            const invited = item.relationship?.status === "INVITED";
            return <article key={item.property.id} className="group flex min-w-0 flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white transition duration-150 hover:border-neutral-300 hover:shadow-md">
              <div className="relative aspect-[16/10] overflow-hidden border-0 border-b border-solid border-neutral-100 bg-neutral-50 sm:aspect-video">
                <PropertyCardPhoto src={item.property.imageUrl} title={item.property.title} />
                <span className="absolute left-2 top-2 max-w-[calc(100%-1rem)] truncate rounded-md border border-white/70 bg-white/90 px-1.5 py-0.5 text-[8px] font-bold text-neutral-700 shadow-sm backdrop-blur-sm sm:text-[9px]">{propertyType(item.property.type)}</span>
              </div>
              <div className="flex min-w-0 flex-1 flex-col p-2.5 sm:p-3">
                <h2 className="m-0 truncate text-[11px] font-extrabold uppercase tracking-[0.01em] text-neutral-900 sm:text-[13px]" title={item.property.title}>{item.property.title}</h2>
                <p className="m-0 mt-1 flex min-w-0 items-center gap-1 text-[9px] text-neutral-500 sm:text-[10px]" title={item.property.location}><MapPin className="h-3 w-3 shrink-0" /><span className="truncate">{item.property.location}</span></p>
                {state ? <span className={`mt-2 w-fit max-w-full truncate rounded-full border px-1.5 py-0.5 text-[8px] font-bold sm:text-[9px] ${state.cls}`}>{state.label}</span> : null}
                <p className="m-0 mt-2 hidden min-h-10 text-[10px] leading-4 text-neutral-500 sm:line-clamp-2">{item.property.summary || "A verified NRMS accommodation partner open to professional travel trade relationships."}</p>
                <div className="mt-auto border-t border-neutral-100 pt-2.5 sm:mt-3">
                  {active ? <Link href="/agent-portal" className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-neutral-900 px-2 text-[10px] font-bold text-white no-underline transition hover:bg-neutral-800 sm:text-xs"><CheckCircle2 className="h-3.5 w-3.5 shrink-0" /><span className="sm:hidden">Book</span><span className="hidden sm:inline">Open booking</span></Link>
                    : invited ? <Link href="/agent-portal" className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-2 text-[10px] font-bold text-neutral-700 no-underline transition hover:bg-neutral-50 sm:text-xs"><Handshake className="h-3.5 w-3.5 shrink-0" /><span className="sm:hidden">Review</span><span className="hidden sm:inline">Review invitation</span></Link>
                    : item.acceptingRequests ? <button type="button" onClick={() => { setRequestFor(item); setNotice(null); setError(null); }} className="inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-700 px-2 text-[10px] font-bold text-white shadow-sm transition hover:border-emerald-800 hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/35 sm:text-xs"><Handshake className="h-3.5 w-3.5 shrink-0 text-white" /><span className="sm:hidden">{item.relationship ? "Retry" : "Request"}</span><span className="hidden truncate sm:inline">{item.relationship ? "Request again" : "Request partnership"}</span></button>
                    : item.relationship ? <div className="flex min-h-9 items-center justify-center gap-1 rounded-lg bg-neutral-50 px-1.5 text-center text-[9px] font-semibold leading-3 text-neutral-500 sm:text-[10px]"><Clock className="h-3 w-3 shrink-0" /><span className="line-clamp-2">{state?.label}</span></div>
                    : <div className="flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-1.5 text-center text-[9px] font-semibold leading-3 text-neutral-500 sm:text-[10px]"><Clock className="h-3 w-3 shrink-0" />{item.requestAvailability?.label || "Not accepting requests"}</div>}
                </div>
              </div>
            </article>;
          })}
        </div>
      )}

      {totalPages > 1 ? <nav aria-label="Hotel discovery pages" className="flex items-center justify-center gap-3"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">Previous</button><span className="text-xs font-semibold text-neutral-500">Page {page} of {totalPages}</span><button type="button" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)} className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-semibold text-neutral-700 disabled:opacity-40">Next</button></nav> : null}

      {requestFor ? <div className="fixed inset-0 z-[10020] flex items-start justify-center overflow-y-auto bg-neutral-950/50 p-4 pt-[10vh] backdrop-blur-sm"><div role="dialog" aria-modal="true" aria-labelledby="partnership-request-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-2xl"><div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4"><h2 id="partnership-request-title" className="m-0 text-base font-extrabold text-neutral-900">Request partnership</h2><button type="button" onClick={() => setRequestFor(null)} disabled={requesting} aria-label="Close" className="rounded-lg border-0 bg-neutral-100 p-1.5 text-neutral-500"><X className="h-4 w-4" /></button></div><div className="p-5"><div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-emerald-100 bg-emerald-50 text-emerald-700"><Handshake className="h-4 w-4" /></span><div><p className="m-0 text-sm font-bold text-neutral-900">{requestFor.property.title}</p><p className="m-0 mt-0.5 text-xs text-neutral-600">{requestFor.property.location}</p></div></div><p className="m-0 mt-4 text-sm leading-6 text-neutral-600">The hotel will see your verified agency identity and decide independently. No rates, rooms, contacts, or booking authority are granted by sending this request.</p><div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRequestFor(null)} disabled={requesting} className="min-h-10 rounded-xl border border-neutral-200 bg-white px-4 text-sm font-bold text-neutral-700 disabled:opacity-50">Cancel</button><button type="button" onClick={() => void requestPartnership()} disabled={requesting} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-neutral-900 px-4 text-sm font-bold text-white transition hover:bg-neutral-800 disabled:opacity-50">{requesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Handshake className="h-4 w-4" />} {requesting ? "Sending..." : "Send request"}</button></div></div></div></div> : null}
    </div>
  );
}
