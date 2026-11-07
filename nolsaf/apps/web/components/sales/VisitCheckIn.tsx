"use client";

/**
 * Visit mode: "Check in at this property".
 *
 * Captures the phone's live GPS position and a new camera photo at the moment
 * the partner taps, and sends them to the API, which decides the official time
 * and works out any warning signs. Location is read only on that tap, never in
 * the background. With no signal, the check-in is kept on this device and
 * sent automatically when the connection returns (up to 48 hours).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, Loader2, MapPin, ShieldCheck, WifiOff } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Visit = {
  id: number;
  status: "VERIFIED" | "FLAGGED";
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  receivedAt: string;
  metWith: string;
  note: string | null;
  distanceMeters: number | null;
  referenceSource: "PROPERTY" | "FIRST_VISIT" | "NONE";
  flags: Array<{ code: string; text: string }>;
  photoUrl: string | null;
  reviewedAt: string | null;
};

type Fix = { latitude: number; longitude: number; accuracy: number; positionAt: number };

const MET_WITH = [
  ["OWNER", "Owner"],
  ["MANAGER", "Manager"],
  ["STAFF", "Staff"],
  ["NOBODY", "Nobody"],
] as const;

/** A photo older than this is not "taken now". */
const MAX_PHOTO_AGE_MS = 15 * 60_000;
const MAX_EDGE = 1600;

function eat(value: string) {
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function metres(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value} m`;
}

/** Smaller photo for slow networks. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 2_000_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    return blob ?? file;
  } catch {
    return file;
  }
}

function currentFix(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject(new Error("This device cannot share its location."));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy, positionAt: pos.timestamp }),
      (err) => reject(new Error(err.code === err.PERMISSION_DENIED ? "Allow location access to check in." : "Your location could not be found. Move outside and try again.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
  });
}

// ---- offline queue (IndexedDB: photos are too large for localStorage) -------

type Queued = { key: string; leadId: string; fields: Record<string, string>; photo: Blob };
const DB_NAME = "nolsaf-sales-visits";
const STORE = "pending";

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function queueOp<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openQueue();
  return new Promise<T>((resolve, reject) => {
    const req = run(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const queueAdd = (item: Queued) => queueOp("readwrite", (s) => s.put(item)).catch(() => undefined);
const queueRemove = (key: string) => queueOp("readwrite", (s) => s.delete(key)).catch(() => undefined);
const queueAll = () => queueOp<Queued[]>("readonly", (s) => s.getAll() as IDBRequest<Queued[]>).catch(() => [] as Queued[]);

function isNetworkError(cause: any) {
  return !cause?.response;
}

async function send(leadId: string, fields: Record<string, string>, photo: Blob) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append("photo", photo, "visit.jpg");
  const { data } = await apiClient.post(`/api/sales/leads/${leadId}/visits`, form, { timeout: 60_000 });
  return data.visit as Visit;
}

// ---- component --------------------------------------------------------------

export default function VisitCheckIn({ leadRef: leadId, closed, onRecorded }: { leadRef: string; closed: boolean; onRecorded?: () => void }) {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [open, setOpen] = useState(false);
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [photo, setPhoto] = useState<{ blob: Blob; preview: string; capturedAt: number } | null>(null);
  const [metWith, setMetWith] = useState<string>("OWNER");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(0);
  const cameraRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await apiClient.get(`/api/sales/leads/${leadId}/visits`);
      setVisits(data.visits ?? []);
    } catch {
      /* the timeline still works without visits */
    }
  }, [leadId]);

  // Send anything saved offline for this lead.
  const flush = useCallback(async () => {
    const items = (await queueAll()).filter((item) => item.leadId === leadId);
    setPending(items.length);
    for (const item of items) {
      try {
        await send(item.leadId, item.fields, item.photo);
        await queueRemove(item.key);
        setNotice("A check-in saved offline was sent.");
        onRecorded?.();
      } catch (cause: any) {
        if (isNetworkError(cause)) break;
        await queueRemove(item.key);
        setError(cause?.response?.data?.error || "A saved check-in was refused.");
      }
    }
    setPending((await queueAll()).filter((item) => item.leadId === leadId).length);
    void load();
  }, [leadId, load, onRecorded]);

  useEffect(() => {
    void load();
    void flush();
    const online = () => void flush();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [load, flush]);

  const start = async () => {
    setOpen(true);
    setError("");
    setNotice("");
    setLocating(true);
    try {
      setFix(await currentFix());
    } catch (cause: any) {
      setError(cause.message);
    } finally {
      setLocating(false);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (Date.now() - file.lastModified > MAX_PHOTO_AGE_MS) {
      setError("Use the camera to take a new photo now. Older pictures are not accepted.");
      return;
    }
    const blob = await shrink(file);
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto({ blob, preview: URL.createObjectURL(blob), capturedAt: Date.now() });
    setError("");
  };

  const reset = () => {
    if (photo) URL.revokeObjectURL(photo.preview);
    setPhoto(null);
    setFix(null);
    setNote("");
    setMetWith("OWNER");
    setOpen(false);
  };

  const submit = async () => {
    if (!fix || !photo) return;
    setBusy(true);
    setError("");
    const fields: Record<string, string> = {
      latitude: String(fix.latitude),
      longitude: String(fix.longitude),
      accuracy: String(Math.round(fix.accuracy)),
      positionAt: String(Math.round(fix.positionAt)),
      capturedAt: String(photo.capturedAt),
      metWith,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    try {
      const visit = await send(leadId, fields, photo.blob);
      setNotice(visit.status === "VERIFIED" ? "Visit recorded and verified." : "Visit recorded. It will be reviewed by NoLSAF.");
      reset();
      void load();
      onRecorded?.();
    } catch (cause: any) {
      if (isNetworkError(cause)) {
        await queueAdd({ key: `${leadId}-${photo.capturedAt}`, leadId, fields, photo: photo.blob });
        setPending((n) => n + 1);
        setNotice("No connection. The check-in is saved on this phone and will be sent when you are back online.");
        reset();
      } else {
        setError(cause?.response?.data?.error || "The check-in could not be sent.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section id="visit-mode" aria-labelledby="visit-mode-title" className="mt-5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <style>{`#visit-mode, #visit-mode * { box-sizing: border-box; }`}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><MapPin className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0">
            <h2 id="visit-mode-title" className="m-0 text-sm font-bold text-slate-900">Property visits</h2>
            <p className="m-0 mt-0.5 text-[12px] text-slate-500">
              {visits.length ? `${visits.filter((v) => v.status === "VERIFIED").length} verified of ${visits.length}` : "Check in while you are at the property"}
              {pending ? ` · ${pending} waiting to send` : ""}
            </p>
          </div>
        </div>
        {!closed && !open && (
          <button
            type="button"
            onClick={() => void start()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47]"
          >
            <MapPin className="h-4 w-4" aria-hidden /> Check in at this property
          </button>
        )}
      </div>

      {(error || notice) && (
        <div className="px-4 pt-3 sm:px-5">
          {error && <p className="m-0 flex items-start gap-2 rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p>}
          {notice && <p className="m-0 flex items-start gap-2 rounded-lg border border-solid border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">{pending ? <WifiOff className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}{notice}</p>}
        </div>
      )}

      {open && (
        <div className="grid gap-4 px-4 py-4 sm:px-5 lg:grid-cols-2">
          <div className="space-y-3">
            <div className="rounded-lg border border-solid border-slate-200 p-3">
              <p className="m-0 text-[12px] font-semibold text-slate-500">1. Your location</p>
              {locating ? (
                <p className="m-0 mt-1.5 flex items-center gap-2 text-sm text-slate-700"><Loader2 className="h-4 w-4 animate-spin" /> Finding your position</p>
              ) : fix ? (
                <p className="m-0 mt-1.5 text-sm text-slate-800">
                  Found, accurate to {metres(Math.round(fix.accuracy))}
                  {fix.accuracy > 150 ? <span className="block text-[12px] text-amber-700">Low accuracy. Step outside for a better signal, then retry.</span> : null}
                </p>
              ) : (
                <button type="button" onClick={() => void start()} className="mt-1.5 h-9 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 [font-family:inherit]">Try again</button>
              )}
            </div>

            <div className="rounded-lg border border-solid border-slate-200 p-3">
              <p className="m-0 text-[12px] font-semibold text-slate-500">2. Photo of the property, taken now</p>
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(event) => { void onPhoto(event.target.files?.[0]); event.target.value = ""; }} />
              {photo ? (
                <div className="mt-2 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={photo.preview} alt="Property photo to send" className="h-16 w-20 rounded-md object-cover" />
                  <button type="button" onClick={() => cameraRef.current?.click()} className="h-9 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 [font-family:inherit]">Retake</button>
                </div>
              ) : (
                <button type="button" onClick={() => cameraRef.current?.click()} className="mt-2 inline-flex h-10 items-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800 [font-family:inherit]">
                  <Camera className="h-4 w-4" aria-hidden /> Open camera
                </button>
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="rounded-lg border border-solid border-slate-200 p-3">
              <p className="m-0 text-[12px] font-semibold text-slate-500">3. Who did you meet?</p>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MET_WITH.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setMetWith(value)}
                    aria-pressed={metWith === value}
                    className={`h-9 rounded-lg border border-solid px-2 text-[13px] font-semibold [font-family:inherit] ${metWith === value ? "border-[#02665e] bg-[#02665e]/10 text-[#02665e]" : "border-slate-300 bg-white text-slate-700"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value.slice(0, 500))}
                rows={2}
                placeholder="What was discussed (optional)"
                className="mt-2 w-full rounded-lg border border-solid border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none [font-family:inherit] focus:border-[#02665e]"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!fix || !photo || busy}
                className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-4 text-sm font-semibold text-white [font-family:inherit] transition hover:bg-[#014d47] disabled:opacity-45"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Send check-in
              </button>
              <button type="button" onClick={reset} className="h-10 rounded-lg border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 [font-family:inherit]">Cancel</button>
            </div>
            <p className="m-0 text-[11.5px] text-slate-500">Your location is read only when you check in. NoLSAF records the official time on its own server.</p>
          </div>
        </div>
      )}

      {visits.length > 0 && (
        <ul className="m-0 list-none divide-y divide-slate-100 p-0">
          {visits.map((visit) => (
            <li key={visit.id} className="flex gap-3 px-4 py-3 sm:px-5">
              {visit.photoUrl ? (
                <a href={visit.photoUrl} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={visit.photoUrl} alt="Visit photo" className="h-14 w-16 rounded-md object-cover" />
                </a>
              ) : (
                <span className="grid h-14 w-16 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-400"><Camera className="h-4 w-4" /></span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${visit.status === "VERIFIED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                    {visit.status === "VERIFIED" ? "Verified" : visit.reviewedAt ? "Reviewed" : "Needs review"}
                  </span>
                  <span className="text-[12px] text-slate-500">{eat(visit.receivedAt)}</span>
                </div>
                <p className="m-0 mt-1 text-[13px] text-slate-700">
                  {visit.referenceSource === "NONE" || visit.distanceMeters == null
                    ? "First check-in, sets the property location"
                    : `${metres(visit.distanceMeters)} from ${visit.referenceSource === "PROPERTY" ? "the property" : "the first check-in"}`}
                  {" · "}Met {visit.metWith === "NOBODY" ? "nobody" : visit.metWith.toLowerCase()}
                  {" · "}
                  <a href={`https://www.google.com/maps?q=${visit.latitude},${visit.longitude}`} target="_blank" rel="noreferrer" className="text-[#02665e] no-underline hover:underline">Map</a>
                </p>
                {visit.flags.length > 0 && (
                  <ul className="m-0 mt-1 list-none p-0">
                    {visit.flags.map((flag) => (
                      <li key={flag.code} className="flex items-start gap-1.5 text-[12px] text-amber-800"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{flag.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
