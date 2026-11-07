"use client";

/**
 * Visit evidence on a conversion request: how many times the partner checked
 * in at the property, which check-ins carry warning signs, and the photos.
 * A flagged visit can be marked reviewed with a short note (recorded in audit).
 */
import { useState } from "react";
import { AlertTriangle, ChevronDown, Loader2, MapPin } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Visit = {
  id: number;
  status: "VERIFIED" | "FLAGGED";
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  receivedAt: string;
  metWith: string;
  note: string | null;
  distanceMeters: number | null;
  referenceSource: "PROPERTY" | "FIRST_VISIT" | "NONE";
  flags: Array<{ code: string; text: string }>;
  photoUrl: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
};

function eat(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function metres(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value} m`;
}

export default function LeadVisitEvidence({ leadId, summary }: { leadId: number; summary?: { verified: number; flagged: number } }) {
  const [open, setOpen] = useState(false);
  const [visits, setVisits] = useState<Visit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);

  const verified = summary?.verified ?? 0;
  const flagged = summary?.flagged ?? 0;
  const total = verified + flagged;

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const { data } = await apiClient.get(`/api/admin/sales/leads/${leadId}/visits`);
      setVisits(data.visits ?? []);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load visits.");
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && !visits) void load();
  };

  const review = async (visit: Visit) => {
    const note = (notes[visit.id] || "").trim();
    if (note.length < 5) return setError("Write at least 5 characters on what you checked.");
    setBusy(visit.id);
    setError("");
    try {
      await apiClient.post(`/api/admin/sales/visits/${visit.id}/review`, { reason: note });
      await load();
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save the review.");
    } finally {
      setBusy(null);
    }
  };

  const tone = total === 0 ? "border-amber-200 bg-amber-50 text-amber-900" : flagged ? "border-amber-200 bg-amber-50 text-amber-900" : "border-emerald-200 bg-emerald-50 text-emerald-800";

  return (
    <div className={`mt-3 rounded-lg border border-solid ${tone}`}>
      <button
        type="button"
        onClick={toggle}
        disabled={total === 0}
        className="flex w-full items-center justify-between gap-2 border-0 bg-transparent px-3 py-2 text-left text-xs [font-family:inherit] disabled:cursor-default"
        aria-expanded={open}
      >
        <span className="inline-flex items-center gap-1.5 font-semibold">
          <MapPin className="h-3.5 w-3.5" />
          {total === 0
            ? "No property visits: the partner never checked in on site"
            : `${verified} verified visit${verified === 1 ? "" : "s"}${flagged ? `, ${flagged} with warning signs` : ""}`}
        </span>
        {total > 0 && <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />}
      </button>

      {open && (
        <div className="border-0 border-t border-solid border-neutral-100 bg-white text-neutral-800">
          {loading && <p className="m-0 flex items-center gap-2 px-3 py-3 text-xs text-neutral-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading visits</p>}
          {error && <p className="m-0 px-3 py-2 text-xs text-rose-700">{error}</p>}
          {visits && (
            <ul className="m-0 list-none divide-y divide-neutral-100 p-0">
              {visits.map((visit) => (
                <li key={visit.id} className="flex gap-3 px-3 py-3">
                  {visit.photoUrl ? (
                    <a href={visit.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={visit.photoUrl} alt="Visit photo" className="h-16 w-20 rounded-md object-cover" />
                    </a>
                  ) : null}
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="m-0 flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 font-semibold ${visit.status === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : visit.reviewedAt ? "bg-neutral-100 text-neutral-700" : "bg-amber-50 text-amber-800"}`}>
                        {visit.status === "VERIFIED" ? "Verified" : visit.reviewedAt ? "Reviewed" : "Needs review"}
                      </span>
                      <span className="text-neutral-500">{eat(visit.receivedAt)}</span>
                    </p>
                    <p className="m-0 mt-1 text-neutral-700">
                      {visit.referenceSource === "NONE" || visit.distanceMeters == null
                        ? "First check-in"
                        : `${metres(visit.distanceMeters)} from ${visit.referenceSource === "PROPERTY" ? "the property pin" : "the first check-in"}`}
                      {` · GPS ±${metres(visit.accuracyMeters)} · Met ${visit.metWith === "NOBODY" ? "nobody" : visit.metWith.toLowerCase()} · `}
                      <a href={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}`} target="_blank" rel="noreferrer" className="text-emerald-700 no-underline hover:underline">Map</a>
                    </p>
                    {visit.note && <p className="m-0 mt-1 text-neutral-600">&ldquo;{visit.note}&rdquo;</p>}
                    {visit.flags.map((flag) => (
                      <p key={flag.code} className="m-0 mt-1 flex items-start gap-1.5 text-amber-800"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{flag.text}</p>
                    ))}
                    {visit.reviewedAt && <p className="m-0 mt-1 text-neutral-500">Reviewed: {visit.reviewNote}</p>}
                    {visit.status === "FLAGGED" && !visit.reviewedAt && (
                      <div className="mt-2 flex gap-1.5">
                        <input
                          value={notes[visit.id] || ""}
                          onChange={(event) => setNotes((current) => ({ ...current, [visit.id]: event.target.value }))}
                          placeholder="What you checked and decided"
                          className="h-8 min-w-0 flex-1 rounded-md border border-solid border-neutral-200 px-2 text-xs outline-none focus:border-emerald-400"
                        />
                        <button
                          type="button"
                          onClick={() => void review(visit)}
                          disabled={busy === visit.id}
                          className="h-8 rounded-md border border-solid border-neutral-300 bg-white px-2.5 text-xs font-semibold text-neutral-800 [font-family:inherit] disabled:opacity-50"
                        >
                          {busy === visit.id ? "Saving" : "Mark reviewed"}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
