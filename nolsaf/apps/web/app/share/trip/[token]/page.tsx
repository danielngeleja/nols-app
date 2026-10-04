"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, Headphones, Mail, MapPin, Phone, ShieldCheck, Siren } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

type TripShare = {
  travellerName: string;
  trip: {
    serviceKind: "STAY" | "TOUR" | "GROUP_STAY" | "RIDE";
    title: string;
    destination?: string | null;
    startAt?: string | null;
    endAt?: string | null;
    status: string;
    provider?: { name?: string | null; phone?: string | null; email?: string | null };
  };
  support: { name: string; phone?: string | null; email?: string | null };
  emergencyContacts: Array<{ country: string; label: string; phone: string }>;
  expiresAt: string;
  privacy: string;
};

function formatDate(value?: string | null) {
  if (!value) return "To be confirmed";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function kindLabel(kind: TripShare["trip"]["serviceKind"]) {
  return kind === "GROUP_STAY" ? "Group stay" : kind.charAt(0) + kind.slice(1).toLowerCase();
}

export default function SharedTripPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [data, setData] = useState<TripShare | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/public/trip-shares/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) throw new Error(payload?.error || "This trip link is unavailable.");
        setData(payload);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "This trip link is unavailable."));
  }, [token]);

  if (error) return <main className="min-h-screen bg-slate-50 px-4 py-12"><div className="mx-auto max-w-xl rounded-3xl border border-rose-200 bg-white p-8 text-center shadow-sm"><AlertTriangle className="mx-auto mb-4 h-10 w-10 text-rose-600" /><h1 className="text-2xl font-black text-slate-950">Trip link unavailable</h1><p className="mt-3 text-slate-600">{error}</p></div></main>;
  if (!data) return <main className="grid min-h-screen place-items-center bg-slate-50"><p className="font-semibold text-slate-600">Opening the secure trip link…</p></main>;

  const { trip } = data;
  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-950 to-slate-50 px-4 py-8 sm:py-14">
      <div className="mx-auto max-w-2xl space-y-4">
        <section className="overflow-hidden rounded-[2rem] bg-white shadow-2xl shadow-emerald-950/20">
          <div className="bg-emerald-900 p-6 text-white sm:p-8">
            <div className="flex items-center gap-3"><span className="grid h-12 w-12 place-items-center rounded-full bg-white/10"><ShieldCheck className="h-7 w-7" /></span><div><p className="text-xs font-black uppercase tracking-[0.2em] text-emerald-200">Secure NoLSAF trip link</p><h1 className="text-2xl font-black">{data.travellerName}&apos;s active trip</h1></div></div>
          </div>
          <div className="space-y-5 p-6 sm:p-8">
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-emerald-50 px-3 py-1 text-sm font-black text-emerald-800">{kindLabel(trip.serviceKind)}</span><span className="flex items-center gap-1.5 text-sm font-bold text-emerald-700"><CheckCircle2 className="h-4 w-4" />{trip.status.replaceAll("_", " ")}</span></div>
            <div><h2 className="text-3xl font-black tracking-tight text-slate-950">{trip.title}</h2>{trip.destination ? <p className="mt-2 flex items-start gap-2 text-slate-600"><MapPin className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />{trip.destination}</p> : null}</div>
            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2"><div><p className="text-xs font-black uppercase tracking-wider text-slate-500">Starts</p><p className="mt-1 font-bold text-slate-900">{formatDate(trip.startAt)}</p></div><div><p className="text-xs font-black uppercase tracking-wider text-slate-500">Ends</p><p className="mt-1 font-bold text-slate-900">{formatDate(trip.endAt)}</p></div></div>
            {trip.provider?.phone || trip.provider?.email ? <div className="rounded-2xl border border-emerald-100 p-4"><p className="mb-3 text-sm font-black text-slate-950">Service provider · {trip.provider.name || "Provider"}</p><div className="flex flex-wrap gap-2">{trip.provider.phone ? <a className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 font-bold text-white" href={`tel:${trip.provider.phone}`}><Phone className="h-4 w-4" />Call provider</a> : null}{trip.provider.email ? <a className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 font-bold text-slate-800" href={`mailto:${trip.provider.email}`}><Mail className="h-4 w-4" />Email</a> : null}</div></div> : <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">The provider has not published an emergency contact. Use NoLSAF support below.</div>}
            <p className="flex items-start gap-2 text-xs leading-5 text-slate-500"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />{data.privacy}</p>
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-lg">
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-950"><Siren className="h-5 w-5 text-rose-600" />Emergency contacts</h2>
          <p className="mt-1 text-sm text-slate-600">Call local emergency services first if anyone is in immediate danger.</p>
          <div className="mt-4 divide-y divide-slate-100">{data.emergencyContacts.map((contact) => <a key={`${contact.label}:${contact.phone}`} href={`tel:${contact.phone}`} className="flex items-center justify-between gap-4 py-3"><span><span className="block font-bold text-slate-900">{contact.label}</span><span className="text-sm text-slate-500">{contact.country}</span></span><span className="font-black text-emerald-800">{contact.phone}</span></a>)}</div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-lg"><h2 className="flex items-center gap-2 text-lg font-black text-slate-950"><Headphones className="h-5 w-5 text-emerald-700" />NoLSAF support</h2><div className="mt-4 flex flex-wrap gap-2">{data.support.phone ? <a href={`tel:${data.support.phone}`} className="inline-flex items-center gap-2 rounded-xl bg-emerald-800 px-4 py-2.5 font-bold text-white"><Phone className="h-4 w-4" />{data.support.phone}</a> : null}{data.support.email ? <a href={`mailto:${data.support.email}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 font-bold text-slate-800"><Mail className="h-4 w-4" />Email support</a> : null}</div></section>

        <p className="flex items-center justify-center gap-2 text-center text-xs font-semibold text-slate-500"><CalendarClock className="h-4 w-4" />This link expires {formatDate(data.expiresAt)}.</p>
      </div>
    </main>
  );
}
