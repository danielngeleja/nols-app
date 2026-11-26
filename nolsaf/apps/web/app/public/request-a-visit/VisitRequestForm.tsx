"use client";

/**
 * Owner "Request a NoLSAF visit" form (docs/SALES_VISIT_REQUESTS.md).
 * No partner is listed here: NoLSAF routes the request to a verified Sales
 * Partner, who calls the owner. The `website` field is a hidden bot trap.
 */
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { BadgeCheck, CheckCircle2, Loader2, MapPin, PhoneCall, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Region = { code: string; name: string };

const INTERESTS: Array<{ value: string; label: string; hint: string }> = [
  { value: "MARKETPLACE", label: "Get bookings on NoLSAF", hint: "List my property so guests can book and pay online" },
  { value: "NRMS", label: "Run my property with NRMS", hint: "Rooms, front desk, restaurant and reports in one system" },
  { value: "NRMS_AND_MARKETPLACE", label: "Both", hint: "Bookings on NoLSAF and NRMS to run the place" },
  { value: "NOT_SURE", label: "Not sure yet", hint: "Explain the options to me" },
];

const TYPES = ["Hotel", "Lodge", "Guest house", "Apartment", "Villa", "Home", "Camp", "Other"];

const field =
  "box-border block w-full rounded-lg border border-solid border-slate-300 bg-white px-3.5 py-2.5 text-[15px] text-slate-900 outline-none transition [font-family:inherit] focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15";
const label = "mb-1.5 block text-sm font-semibold text-slate-800";

export default function VisitRequestForm() {
  const [regions, setRegions] = useState<Region[]>([]);
  const [form, setForm] = useState({
    contactName: "",
    contactPhone: "",
    contactEmail: "",
    propertyName: "",
    propertyType: "",
    estimatedRooms: "",
    regionCode: "",
    location: "",
    interest: "NOT_SURE",
    message: "",
    consent: false,
    website: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ ref: string; repeat: boolean } | null>(null);

  useEffect(() => {
    apiClient
      .get<{ regions?: Region[] }>("/api/public/visit-requests/regions")
      .then((res) => setRegions(res.data?.regions ?? []))
      .catch(() => setRegions([]));
  }, []);

  const set = (key: keyof typeof form, value: string | boolean) => setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    if (!form.consent) {
      setError("Please agree that NoLSAF may contact you about this visit.");
      return;
    }
    setBusy(true);
    try {
      const res = await apiClient.post<{ ref: string; repeat?: boolean }>("/api/public/visit-requests", {
        ...form,
        estimatedRooms: form.estimatedRooms ? Number(form.estimatedRooms) : null,
        regionCode: form.regionCode || null,
      });
      setDone({ ref: res.data.ref, repeat: Boolean(res.data.repeat) });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not send your request. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="w-full px-4 py-10 sm:py-14">
      <style>{`#visit-request, #visit-request * { box-sizing: border-box; }`}</style>
      <div id="visit-request" className="mx-auto grid w-full max-w-5xl grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <section className="min-w-0">
          <p className="m-0 text-sm font-semibold text-[#02665e]">For property owners</p>
          <h1 className="m-0 mt-2 text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">Request a NoLSAF visit</h1>
          <p className="m-0 mt-3 text-[15px] leading-7 text-slate-600">
            Tell us about your property. A verified NoLSAF Sales Partner near you will call you, visit, and help you get listed or set up NRMS. The visit is free.
          </p>

          <ul className="m-0 mt-6 list-none space-y-4 p-0">
            {[
              { Icon: PhoneCall, title: "We call you first", body: "Usually within two working days, to agree a time that suits you." },
              { Icon: BadgeCheck, title: "Check their ID card", body: "Every partner carries a NoLSAF ID card. Scan its QR code, or type the card code at nolsaf.com/verify/sales, before you share anything." },
              { Icon: ShieldCheck, title: "Your details stay with NoLSAF", body: "Only NoLSAF and the one partner we assign see your phone number." },
            ].map(({ Icon, title, body }) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
                  <Icon className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-bold text-slate-900">{title}</p>
                  <p className="m-0 mt-0.5 text-sm leading-6 text-slate-600">{body}</p>
                </div>
              </li>
            ))}
          </ul>

          <p className="m-0 mt-6 text-sm text-slate-500">
            Prefer to do it yourself? <Link href="/account/register?role=owner" className="font-semibold text-[#02665e] no-underline hover:underline">Create an owner account</Link> and list your property online.
          </p>
        </section>

        <section className="min-w-0 rounded-xl border border-solid border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          {done ? (
            <div className="py-6 text-center" role="status">
              <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" aria-hidden />
              </span>
              <h2 className="m-0 mt-4 text-xl font-bold text-slate-950">{done.repeat ? "We already have your request" : "Request received"}</h2>
              <p className="m-0 mt-2 text-[15px] leading-7 text-slate-600">
                Your request number is <span className="font-bold text-slate-900">{done.ref}</span>. Keep it in case you contact NoLSAF.
                {done.repeat ? " Your earlier request is still open, so we did not create a second one." : " A NoLSAF Sales Partner will call you soon."}
              </p>
              <p className="m-0 mt-4 text-sm text-slate-500">When they arrive, ask to see their NoLSAF ID card and scan its QR code.</p>
            </div>
          ) : (
            <form onSubmit={submit} noValidate className="space-y-5">
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="vr-name" className={label}>Your name</label>
                  <input id="vr-name" required maxLength={160} autoComplete="name" className={field} value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="vr-phone" className={label}>Phone number</label>
                  <input id="vr-phone" required type="tel" inputMode="tel" maxLength={40} autoComplete="tel" placeholder="07XX XXX XXX" className={field} value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
                </div>
              </div>

              <div>
                <label htmlFor="vr-email" className={label}>Email <span className="font-normal text-slate-500">(optional)</span></label>
                <input id="vr-email" type="email" maxLength={190} autoComplete="email" className={field} value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div>
                  <label htmlFor="vr-property" className={label}>Property name</label>
                  <input id="vr-property" required maxLength={200} className={field} value={form.propertyName} onChange={(e) => set("propertyName", e.target.value)} />
                </div>
                <div>
                  <label htmlFor="vr-rooms" className={label}>Rooms <span className="font-normal text-slate-500">(about)</span></label>
                  <input id="vr-rooms" type="number" min={1} max={5000} inputMode="numeric" className={field} value={form.estimatedRooms} onChange={(e) => set("estimatedRooms", e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="vr-type" className={label}>Type of property</label>
                  <select id="vr-type" className={field} value={form.propertyType} onChange={(e) => set("propertyType", e.target.value)}>
                    <option value="">Choose one</option>
                    {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="vr-region" className={label}>Region</label>
                  <select id="vr-region" className={field} value={form.regionCode} onChange={(e) => set("regionCode", e.target.value)}>
                    <option value="">{regions.length ? "Choose your region" : "Not sure"}</option>
                    {regions.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label htmlFor="vr-location" className={label}>Town or area</label>
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                  <input id="vr-location" required maxLength={200} placeholder="For example Mikocheni, Dar es Salaam" className={`${field} pl-9`} value={form.location} onChange={(e) => set("location", e.target.value)} />
                </div>
              </div>

              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className={`${label} p-0`}>What would help you most?</legend>
                <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2">
                  {INTERESTS.map((option) => {
                    const active = form.interest === option.value;
                    return (
                      <label
                        key={option.value}
                        className={`flex cursor-pointer gap-2.5 rounded-lg border border-solid p-3 transition ${active ? "border-[#02665e] bg-[#02665e]/[0.05]" : "border-slate-200 bg-white hover:border-slate-300"}`}
                      >
                        <input type="radio" name="interest" value={option.value} checked={active} onChange={() => set("interest", option.value)} className="mt-1 accent-[#02665e]" />
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                          <span className="block text-xs leading-5 text-slate-500">{option.hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>

              <div>
                <label htmlFor="vr-message" className={label}>Anything we should know? <span className="font-normal text-slate-500">(optional)</span></label>
                <textarea id="vr-message" rows={3} maxLength={1000} className={`${field} resize-y`} value={form.message} onChange={(e) => set("message", e.target.value)} />
              </div>

              {/* Hidden from people. Bots that fill every field are ignored. */}
              <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
                <label htmlFor="vr-website">Website</label>
                <input id="vr-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={(e) => set("website", e.target.value)} />
              </div>

              <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-6 text-slate-700">
                <input type="checkbox" checked={form.consent} onChange={(e) => set("consent", e.target.checked)} className="mt-1 accent-[#02665e]" />
                <span>
                  I agree that NoLSAF and one NoLSAF Sales Partner may contact me about this visit. See the{" "}
                  <Link href="/privacy" className="font-semibold text-[#02665e] no-underline hover:underline">privacy policy</Link>.
                </span>
              </label>

              {error ? <p className="m-0 rounded-lg border border-solid border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700" role="alert">{error}</p> : null}

              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-0 bg-[#02665e] px-5 text-[15px] font-bold text-white transition [font-family:inherit] hover:bg-[#014d47] disabled:cursor-wait disabled:opacity-70"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                {busy ? "Sending" : "Request a visit"}
              </button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
