"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Loader2, Save, ShieldCheck, Trash2 } from "lucide-react";
import apiClient from "@/lib/apiClient";

type DocumentRow = { type: string; url: string; uploadedAt?: string };
type Profile = {
  legalName: string; tradingName: string | null; registrationNo: string | null; tin: string | null; licenseNo: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null; address: string | null;
  countryCode: string; nationality: string | null; documents: DocumentRow[]; verificationStatus: string; verificationNote: string | null;
};

const empty: Profile = { legalName: "", tradingName: "", registrationNo: "", tin: "", licenseNo: "", contactName: "", contactEmail: "", contactPhone: "", address: "", countryCode: "TZ", nationality: "", documents: [], verificationStatus: "PENDING", verificationNote: null };
const documentTypes = ["TOURISM_LICENSE", "BUSINESS_LICENSE", "TIN_CERTIFICATE", "ID", "PASSPORT", "OTHER"];

export default function AgentProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [documentType, setDocumentType] = useState("BUSINESS_LICENSE");
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => { let live = true; void apiClient.get<any>("/api/agent-portal/profile").then((response) => { if (live) setProfile({ ...empty, ...(response.data?.profile || {}), documents: Array.isArray(response.data?.profile?.documents) ? response.data.profile.documents : [] }); }).catch((cause) => { if (live) setError(cause?.response?.data?.error || "Agency profile could not be loaded"); }); return () => { live = false; }; }, []);

  const field = (key: keyof Profile, value: string) => setProfile((current) => current ? { ...current, [key]: value } : current);
  const upload = async (file?: File) => {
    if (!file || !profile) return;
    if (file.size > 2 * 1024 * 1024) { setError("KYC files must be 2 MB or smaller."); return; }
    setUploading(true); setError(null); setNotice(null);
    try {
      const form = new FormData(); form.append("folder", "agent-documents"); form.append("file", file);
      const response = await apiClient.post<any>("/api/uploads/cloudinary/upload?folder=agent-documents", form);
      const url = response.data?.secure_url;
      if (!url) throw new Error("upload_failed");
      setProfile({ ...profile, documents: [...profile.documents, { type: documentType, url, uploadedAt: new Date().toISOString() }].slice(0, 10) });
      setNotice("Document uploaded. Save the profile to submit it for review.");
    } catch (cause: any) { setError(cause?.response?.data?.message || cause?.response?.data?.error || "Document upload failed"); }
    finally { setUploading(false); }
  };
  const save = async () => {
    if (!profile) return;
    setSaving(true); setError(null); setNotice(null);
    try {
      await apiClient.put("/api/agent-portal/profile", profile);
      setProfile({ ...profile, verificationStatus: "PENDING", verificationNote: null });
      setNotice("Agency details submitted to NoLSAF for verification.");
    } catch (cause: any) { setError(cause?.response?.data?.error || "Agency profile could not be saved"); }
    finally { setSaving(false); }
  };

  if (!profile) return <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-white p-8 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading profile…</div>;
  return <div className="flex flex-col gap-5">
    <div><h1 className="m-0 flex items-center gap-2 text-lg font-bold text-neutral-900"><ShieldCheck className="h-5 w-5 text-emerald-600" /> Agency profile &amp; KYC</h1><p className="m-0 mt-1 text-[13px] text-neutral-500">Keep your legal identity and evidence current. Only NoLSAF verification staff can open raw KYC documents.</p></div>
    <div className={`rounded-xl border p-3 text-sm ${profile.verificationStatus === "VERIFIED" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : profile.verificationStatus === "REJECTED" ? "border-red-200 bg-red-50 text-red-700" : "border-amber-200 bg-amber-50 text-amber-800"}`}>{profile.verificationStatus === "VERIFIED" ? "Verified by NoLSAF. Editing and saving identity evidence will return the profile to review." : profile.verificationStatus === "REJECTED" ? `Verification needs attention.${profile.verificationNote ? ` ${profile.verificationNote}` : ""}` : "Awaiting NoLSAF verification."}</div>
    {error && <div role="alert" className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
    {notice && <div className="flex gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"><CheckCircle2 className="h-4 w-4 shrink-0" />{notice}</div>}
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><div className="grid gap-3 sm:grid-cols-2">{[
      ["legalName", "Legal name *"], ["tradingName", "Trading name"], ["registrationNo", "Registration number"], ["tin", "TIN"], ["licenseNo", "Tourism / business licence"], ["contactName", "Contact person"], ["contactEmail", "Contact email"], ["contactPhone", "Contact phone"], ["countryCode", "Country code"], ["nationality", "Nationality"],
    ].map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-xs font-bold text-neutral-600">{label}<input value={String(profile[key as keyof Profile] || "")} maxLength={key === "countryCode" ? 2 : 200} onChange={(event) => field(key as keyof Profile, event.target.value)} className="rounded-lg border border-neutral-200 px-3 py-2.5 text-sm font-normal outline-none focus:border-emerald-400" /></label>)}<label className="flex flex-col gap-1 text-xs font-bold text-neutral-600 sm:col-span-2">Business address<textarea value={profile.address || ""} maxLength={500} rows={3} onChange={(event) => field("address", event.target.value)} className="rounded-lg border border-neutral-200 p-3 text-sm font-normal outline-none focus:border-emerald-400" /></label></div></section>
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"><h2 className="m-0 text-sm font-bold text-neutral-900">Verification documents</h2><p className="m-0 mt-1 text-xs text-neutral-500">PDF, image, or office document; maximum 2 MB each and 10 documents total.</p><div className="mt-3 flex flex-wrap gap-2"><select value={documentType} onChange={(event) => setDocumentType(event.target.value)} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs">{documentTypes.map((type) => <option key={type} value={type}>{type.replace(/_/g, " ")}</option>)}</select><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-2 text-xs font-bold text-white"><FileUp className="h-4 w-4" />{uploading ? "Uploading…" : "Upload evidence"}<input type="file" className="sr-only" disabled={uploading || profile.documents.length >= 10} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} /></label></div><ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">{profile.documents.map((document, index) => <li key={`${document.url}-${index}`} className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2"><span className="text-xs font-semibold text-neutral-700">{document.type.replace(/_/g, " ")} · uploaded</span><button type="button" aria-label="Remove document" onClick={() => setProfile({ ...profile, documents: profile.documents.filter((_, itemIndex) => itemIndex !== index) })} className="border-0 bg-transparent p-1 text-red-500"><Trash2 className="h-4 w-4" /></button></li>)}</ul></section>
    <button type="button" onClick={() => void save()} disabled={saving || profile.legalName.trim().length < 2 || profile.countryCode.trim().length !== 2} className="inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border border-emerald-700 bg-emerald-700 px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save and submit for review</button>
  </div>;
}
