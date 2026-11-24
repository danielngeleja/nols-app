"use client";

/**
 * Long-stay tenant ID check (docs/LONG_STAY_RENTALS.md, decision 10).
 * Passport (any country, ICAO 9303), national ID card (NIDA and East African
 * cards) or Tanzania residence permit, with the details as printed and a
 * selfie holding the document. The photos go to private storage; NoLSAF keeps
 * only the last 4 characters of the number. The server checks everything again.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, BookOpen, Camera, CalendarClock, Clock3, FileBadge, FileImage, IdCard, Loader2, Lock, ShieldAlert, ShieldCheck, Upload, XCircle } from "lucide-react";
import apiClient from "@/lib/apiClient";
import DatePickerField from "@/components/DatePickerField";
import { countryName, NATIONAL_ID_COUNTRIES, useIsoCountries } from "@/lib/isoCountries";

type IdType = "PASSPORT" | "NATIONAL_ID" | "RES_PERMIT";
type Side = "front" | "back" | "selfie";
type Identity = {
  status: "NONE" | "PENDING" | "APPROVED" | "REJECTED";
  idType: IdType | null;
  idNumberLast4: string | null;
  idCountry: string | null;
  idExpiresOn: string | null;
  expiring: boolean;
  submittedAt: string | null;
  rejectReason: string | null;
  barred: boolean;
  phoneVerified: boolean;
};

const DOCS: Array<{ key: IdType; title: string; text: string; Icon: typeof IdCard }> = [
  { key: "PASSPORT", title: "Passport", text: "Any country. The photo page.", Icon: BookOpen },
  { key: "NATIONAL_ID", title: "National ID card", text: "NIDA or an East African card. Front and back.", Icon: IdCard },
  { key: "RES_PERMIT", title: "Residence permit", text: "Foreigners living in Tanzania. Front and back.", Icon: FileBadge },
];
const MAX_BYTES = 2 * 1024 * 1024;
const FOLDER = "traveller-documents/long-stay-id";

function dateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 86_400_000);
}

function yearsAgo(date: Date, years: number) {
  const year = date.getUTCFullYear() - years;
  const month = date.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay)));
}
function day(value: string | null) {
  return value ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";
}

export default function LongStayIdPage() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [loadError, setLoadError] = useState("");
  const [idType, setIdType] = useState<IdType>("NATIONAL_ID");
  const [idCountry, setIdCountry] = useState("TZ");
  const [nationality, setNationality] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [holderName, setHolderName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [files, setFiles] = useState<Partial<Record<Side, File>>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const countries = useIsoCountries();
  const today = new Date(Date.now() + 3 * 3_600_000);

  useEffect(() => {
    apiClient.get<Identity>("/api/customer/long-stay/identity")
      .then((response) => setIdentity(response.data))
      .catch((requestError) => setLoadError(requestError?.response?.data?.error || "Could not load your ID check."));
  }, []);

  const chooseType = (next: IdType) => {
    setIdType(next);
    setError("");
    setIdNumber("");
    setFiles((f) => ({ front: f.front, selfie: f.selfie }));
    if (next === "NATIONAL_ID") setIdCountry("TZ");
    if (next === "PASSPORT") setIdCountry("");
    if (next === "RES_PERMIT") setIdCountry("TZ");
  };

  const card = NATIONAL_ID_COUNTRIES.find((c) => c.code === idCountry);
  const needsBack = idType !== "PASSPORT";
  const needsNationality = idType !== "NATIONAL_ID";

  const submit = async () => {
    setError("");
    const compact = idNumber.toUpperCase().replace(/[\s-]/g, "");
    if (idType === "PASSPORT" && !idCountry) return setError("Choose the country that issued the passport.");
    if (needsNationality && !nationality) return setError("Choose your nationality.");
    if (idType === "RES_PERMIT" && nationality === "TZ") return setError("Tanzanian citizens use their NIDA card or passport.");
    if (idType === "PASSPORT" && !/^[A-Z0-9]{6,9}$/.test(compact)) return setError("Enter the passport number as printed, 6 to 9 letters and digits.");
    if (idType === "NATIONAL_ID" && idCountry === "TZ" && !/^\d{20}$/.test(compact)) return setError("A NIDA number has 20 digits.");
    if (idType === "RES_PERMIT" && !/^[A-Z0-9]{6,20}$/.test(compact)) return setError("Enter the residence permit number as printed.");
    if (holderName.trim().length < 2) return setError("Enter your name exactly as printed on the document.");
    if (!dateOfBirth) return setError("Enter your date of birth.");
    if (!expiresOn) return setError("Enter the expiry date printed on the document.");
    if (!files.front) return setError(idType === "PASSPORT" ? "Add a photo of the passport photo page." : "Add a photo of the front of the card.");
    if (needsBack && !files.back) return setError("Add a photo of the back of the card.");
    if (!files.selfie) return setError("Add a selfie holding the document.");

    setBusy(true);
    try {
      const upload = async (file: File) => {
        const form = new FormData();
        form.append("file", file);
        form.append("folder", FOLDER);
        const data = (await apiClient.post(`/api/uploads/cloudinary/upload?folder=${encodeURIComponent(FOLDER)}`, form, { headers: { "Content-Type": "multipart/form-data" } })).data as { secure_url: string; public_id: string; resource_type: string };
        return { publicId: data.public_id, resourceType: data.resource_type === "raw" ? "raw" : "image", url: data.secure_url };
      };
      const front = await upload(files.front);
      const back = needsBack && files.back ? await upload(files.back) : null;
      const selfie = await upload(files.selfie);
      const response = await apiClient.put<Identity>("/api/customer/long-stay/identity", {
        idType,
        idNumber: compact,
        idCountry: idType === "RES_PERMIT" ? null : idCountry,
        nationality: needsNationality ? nationality : null,
        holderName: holderName.trim(),
        dateOfBirth,
        expiresOn,
        front,
        back,
        selfie,
      });
      setIdentity(response.data);
      setEditing(false);
      setIdNumber("");
      setFiles({});
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not send your ID. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const showForm = identity && !identity.barred && identity.phoneVerified && (
    identity.status === "NONE" || identity.status === "REJECTED" || ((identity.status === "PENDING" || (identity.status === "APPROVED" && identity.expiring)) && editing)
  );
  const field = "mt-1.5 h-10 w-full rounded-md border border-solid border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#02665e]";
  const labelCls = "block text-[13px] font-semibold text-slate-700";

  return (
    <div id="long-stay-id" className="w-full py-6 sm:py-8">
      <style>{`#long-stay-id, #long-stay-id * { box-sizing: border-box; }`}</style>
      <Link href="/account" className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-slate-600 no-underline hover:text-[#02665e]">
        <ArrowLeft className="h-4 w-4" /> Back to account
      </Link>

      <div className="max-w-2xl">
        <h1 className="m-0 text-2xl font-bold text-slate-900">Long-stay ID</h1>
        <p className="m-0 mt-1 text-sm text-slate-600">Landlords hand over their keys for months, so NoLSAF checks every long-stay tenant once, to international identity standards.</p>

        <section className="mt-5 overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
          {!identity && !loadError ? (
            <div className="grid min-h-32 place-items-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : loadError ? (
            <p className="m-0 p-5 text-sm text-red-700">{loadError}</p>
          ) : identity ? (
            <>
              <StatusRow identity={identity} />

              {identity.barred ? null : !identity.phoneVerified ? (
                <div className="border-0 border-t border-solid border-slate-100 p-5 text-sm text-slate-700">
                  Verify your phone number first. <Link href="/account/security" className="font-semibold text-[#02665e] no-underline hover:underline">Open Account security</Link>
                </div>
              ) : (identity.status === "PENDING" || (identity.status === "APPROVED" && identity.expiring)) && !editing ? (
                <div className="border-0 border-t border-solid border-slate-100 px-5 py-3 text-sm text-slate-600">
                  {identity.status === "PENDING" ? "Sent the wrong photo?" : "Your document expires soon."}{" "}
                  <button type="button" onClick={() => setEditing(true)} className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-[#02665e] hover:underline [font-family:inherit]">
                    {identity.status === "PENDING" ? "Send it again" : "Send a newer one"}
                  </button>
                </div>
              ) : null}

              {showForm ? (
                <div className="space-y-5 border-0 border-t border-solid border-slate-100 p-5">
                  <div>
                    <span className={labelCls}>Which document?</span>
                    <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
                      {DOCS.map(({ key, title, text, Icon }) => (
                        <button key={key} type="button" onClick={() => chooseType(key)} aria-pressed={idType === key}
                          className={`cursor-pointer rounded-md border border-solid p-3 text-left [font-family:inherit] ${idType === key ? "border-[#02665e] bg-[#02665e]/5" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
                          <Icon className={`h-5 w-5 ${idType === key ? "text-[#02665e]" : "text-slate-500"}`} />
                          <span className="mt-1 block text-sm font-semibold text-slate-900">{title}</span>
                          <span className="block text-xs text-slate-500">{text}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {idType === "NATIONAL_ID" ? (
                      <div>
                        <label htmlFor="id-country" className={labelCls}>Issued by</label>
                        <select id="id-country" value={idCountry} onChange={(e) => { setIdCountry(e.target.value); setError(""); }} className={field}>
                          {NATIONAL_ID_COUNTRIES.map((c) => <option key={c.code} value={c.code}>{countryName(c.code)} ({c.card})</option>)}
                        </select>
                        <p className="m-0 mt-1 text-xs text-slate-500">From another country? Use your passport.</p>
                      </div>
                    ) : idType === "PASSPORT" ? (
                      <div>
                        <label htmlFor="id-country" className={labelCls}>Issuing country</label>
                        <select id="id-country" value={idCountry} onChange={(e) => { setIdCountry(e.target.value); if (!nationality) setNationality(e.target.value); setError(""); }} className={field}>
                          <option value="">Choose a country</option>
                          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                      </div>
                    ) : (
                      <div>
                        <span className={labelCls}>Issued by</span>
                        <p className="m-0 mt-1.5 flex h-10 items-center rounded-md bg-slate-50 px-3 text-sm text-slate-700">Tanzania (Immigration)</p>
                      </div>
                    )}
                    {needsNationality ? (
                      <div>
                        <label htmlFor="nationality" className={labelCls}>Nationality</label>
                        <select id="nationality" value={nationality} onChange={(e) => { setNationality(e.target.value); setError(""); }} className={field}>
                          <option value="">Choose a country</option>
                          {countries.filter((c) => idType !== "RES_PERMIT" || c.code !== "TZ").map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                        </select>
                      </div>
                    ) : null}
                    <div className={needsNationality ? "sm:col-span-2" : ""}>
                      <label htmlFor="id-number" className={labelCls}>{idType === "PASSPORT" ? "Passport number" : idType === "RES_PERMIT" ? "Permit number" : `${card?.card ?? "ID"} number`}</label>
                      <input id="id-number" value={idNumber} onChange={(e) => { setIdNumber(e.target.value); setError(""); }} autoComplete="off" spellCheck={false}
                        placeholder={idType === "PASSPORT" ? "AB1234567" : idType === "RES_PERMIT" ? "As printed" : card?.placeholder} className={`${field} font-mono`} />
                      <p className="m-0 mt-1 text-xs text-slate-500">{idType === "PASSPORT" ? "Up to 9 letters and digits, as in the line at the bottom of the photo page." : idType === "RES_PERMIT" ? "6 to 20 letters and digits." : card?.hint}</p>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="holder-name" className={labelCls}>Full name, as printed</label>
                    <input id="holder-name" value={holderName} onChange={(e) => { setHolderName(e.target.value); setError(""); }} maxLength={120} autoComplete="name" className={field} />
                    <p className="m-0 mt-1 text-xs text-slate-500">Type it the way it appears on the document, including middle names.</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <label htmlFor="tenant-id-birth-date" className={labelCls}>Date of birth</label>
                      <div className="mt-1.5">
                        <DatePickerField id="tenant-id-birth-date" label={dateOfBirth ? `Date of birth, ${day(dateOfBirth)}` : "Date of birth"}
                          placeholder="Select birth date" value={dateOfBirth} allowPast twoMonths={false} squared strongBorder disabled={busy}
                          min={dateOnly(addDays(yearsAgo(today, 121), 1))} max={dateOnly(yearsAgo(today, 18))} size="sm" widthClassName="box-border w-full"
                          onChangeAction={(iso) => { setDateOfBirth(String(iso).slice(0, 10)); setError(""); }} />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="tenant-id-expiry-date" className={labelCls}>Document expiry date</label>
                      <div className="mt-1.5">
                        <DatePickerField id="tenant-id-expiry-date" label={expiresOn ? `Document expiry date, ${day(expiresOn)}` : "Document expiry date"}
                          placeholder="Select expiry date" value={expiresOn} allowPast={false} twoMonths={false} squared strongBorder disabled={busy}
                          min={dateOnly(addDays(today, 30))} max={dateOnly(addDays(today, 365 * 20))} size="sm" widthClassName="box-border w-full"
                          onChangeAction={(iso) => { setExpiresOn(String(iso).slice(0, 10)); setError(""); }} />
                      </div>
                    </div>
                  </div>

                  <div>
                    <span className={labelCls}>Photos</span>
                    <div className={`mt-1.5 grid gap-2 ${needsBack ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
                      <PhotoPick label={idType === "PASSPORT" ? "Photo page" : "Front"} file={files.front} onPick={(f) => setFiles((x) => ({ ...x, front: f }))} onError={setError} />
                      {needsBack ? <PhotoPick label="Back" file={files.back} onPick={(f) => setFiles((x) => ({ ...x, back: f }))} onError={setError} /> : null}
                      <PhotoPick label="Selfie holding it" file={files.selfie} onPick={(f) => setFiles((x) => ({ ...x, selfie: f }))} onError={setError} selfie />
                    </div>
                    <p className="m-0 mt-1.5 text-xs text-slate-500">All four corners in view, no glare. For the selfie, hold the document next to your face so both are clear.</p>
                  </div>

                  {error ? <p className="m-0 text-sm text-red-700">{error}</p> : null}

                  <div className="flex flex-wrap gap-2">
                    <button type="button" disabled={busy} onClick={submit}
                      className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-5 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-60 [font-family:inherit]">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {busy ? "Sending securely" : "Send for checking"}
                    </button>
                    {editing ? (
                      <button type="button" onClick={() => { setEditing(false); setError(""); }} className="inline-flex h-10 cursor-pointer items-center rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">Cancel</button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>

        <p className="m-0 mt-3 flex items-start gap-2 text-xs leading-5 text-slate-500">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Your photos are stored privately and seen only by the NoLSAF staff checking them. We keep the last 4 characters of the number, never the whole number, and never share your document with landlords.
        </p>
      </div>
    </div>
  );
}

function PhotoPick({ label, file, onPick, onError, selfie }: { label: string; file?: File; onPick: (file: File) => void; onError: (message: string) => void; selfie?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = (picked: File | undefined) => {
    onError("");
    if (!picked) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(picked.type)) return onError("Use a JPG, PNG or WebP photo.");
    if (picked.size > MAX_BYTES) return onError("Each photo must be 2MB or smaller.");
    onPick(picked);
  };
  return (
    <>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" capture={selfie ? "user" : undefined} className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <button type="button" onClick={() => ref.current?.click()}
        className={`flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-2 py-3 text-center text-xs [font-family:inherit] ${file ? "border-[#02665e] bg-[#02665e]/5 text-[#02665e]" : "border-slate-300 bg-slate-50 text-slate-600 hover:border-[#02665e]"}`}>
        {file ? <FileImage className="h-5 w-5" /> : selfie ? <Camera className="h-5 w-5 text-slate-400" /> : <Upload className="h-5 w-5 text-slate-400" />}
        <span className="font-semibold">{label}</span>
        <span className="max-w-full truncate text-[11px] text-slate-500">{file ? file.name : "Choose a photo"}</span>
      </button>
    </>
  );
}

function StatusRow({ identity }: { identity: Identity }) {
  const kind = identity.barred ? "barred" : identity.status === "APPROVED" && identity.expiring ? "expiring" : identity.status;
  const map = {
    NONE: { Icon: ShieldCheck, tone: "bg-slate-100 text-slate-600", title: "Not checked yet", text: "Send your passport, national ID card or residence permit below." },
    PENDING: { Icon: Clock3, tone: "bg-amber-50 text-amber-700", title: "NoLSAF is checking your ID", text: "This usually takes less than a working day. We will let you know." },
    APPROVED: { Icon: BadgeCheck, tone: "bg-emerald-50 text-emerald-700", title: "Your ID is verified", text: "You can book long stays." },
    expiring: { Icon: CalendarClock, tone: "bg-amber-50 text-amber-700", title: "Your ID expires soon", text: `It expires on ${day(identity.idExpiresOn)}. Send a newer document so you can keep booking.` },
    REJECTED: { Icon: XCircle, tone: "bg-red-50 text-red-700", title: "Your ID needs another try", text: identity.rejectReason || "Send clearer photos below." },
    barred: { Icon: ShieldAlert, tone: "bg-red-50 text-red-700", title: "Long stays are not available on this account", text: "Contact NoLSAF support if you think this is a mistake." },
  } as const;
  const { Icon, tone, title, text } = map[kind];
  const docName = identity.idType === "PASSPORT" ? "Passport" : identity.idType === "RES_PERMIT" ? "Residence permit" : "National ID";
  return (
    <div className="flex items-start gap-3 p-5">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-md ${tone}`}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0">
        <p className="m-0 text-[15px] font-semibold text-slate-900">{title}</p>
        <p className="m-0 mt-0.5 text-sm text-slate-600">{text}</p>
        {identity.idNumberLast4 && identity.status !== "NONE" ? (
          <p className="m-0 mt-1.5 text-xs text-slate-500">
            {docName}{identity.idCountry ? ` (${identity.idCountry})` : ""} ending {identity.idNumberLast4}{identity.idExpiresOn ? `, valid to ${day(identity.idExpiresOn)}` : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
