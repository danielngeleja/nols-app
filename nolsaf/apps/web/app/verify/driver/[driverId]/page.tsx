"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

type VerificationResult = {
  ok: boolean;
  error?: string;
  driver?: {
    id: string;
    name: string;
    avatarUrl: string | null;
    certification: string;
    status: "ACTIVE" | "NOT_ACTIVE";
    vehiclePlate: string | null;
    vehicleType: string | null;
    vehicleMake: string | null;
    operatingArea: string;
    validUntil: string | null;
    verifiedAt: string;
  };
};

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default function DriverVerificationPage({ params }: { params: { driverId: string } }) {
  const driverId = params.driverId;
  const [result, setResult] = useState<VerificationResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    fetch(`/api/public/driver-verification/${encodeURIComponent(driverId)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as VerificationResult | null;
        if (!mounted) return;
        setResult(data ?? { ok: false, error: "Could not read verification response." });
      })
      .catch((err) => {
        if (!mounted) return;
        setResult({ ok: false, error: err instanceof Error ? err.message : "Could not verify this driver." });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [driverId]);

  const driver = result?.driver;
  const active = driver?.status === "ACTIVE";

  return (
    <main className="min-h-screen bg-[#eef5f4] px-4 py-8 text-slate-950">
      <section className="mx-auto max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <div className="bg-slate-950 px-5 py-5 text-white">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-emerald-300" />
            <p className="text-xs font-black uppercase tracking-[0.24em] text-white/60">NoLSAF Verify</p>
          </div>
          <h1 className="mt-3 text-2xl font-black">Driver ID Check</h1>
          <p className="mt-1 text-sm text-white/60">Use this page to match the driver and vehicle before a trip.</p>
        </div>

        {loading ? (
          <div className="p-6 text-sm text-slate-600">Checking driver status...</div>
        ) : driver ? (
          <div className="p-5">
            <div className={`mb-5 rounded-xl border px-4 py-3 ${active ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
              <div className="flex items-center gap-2">
                {active ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : <AlertTriangle className="h-5 w-5 text-rose-600" />}
                <p className={`text-sm font-black ${active ? "text-emerald-800" : "text-rose-800"}`}>
                  {active ? "Active NoLSAF driver" : "Not active for trips"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative h-20 w-20 overflow-hidden rounded-full border-4 border-emerald-100 bg-slate-100">
                {driver.avatarUrl ? (
                  <Image src={driver.avatarUrl} alt={driver.name} fill sizes="80px" unoptimized={/^https?:\/\//i.test(driver.avatarUrl)} className="object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl font-black text-slate-500">
                    {(driver.name[0] || "D").toUpperCase()}
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xl font-black uppercase leading-tight text-slate-950">{driver.name}</p>
                <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-emerald-700">{driver.certification}</p>
                <p className="mt-1 text-xs font-mono text-slate-500">{driver.id}</p>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <Fact label="Plate" value={driver.vehiclePlate || "Not listed"} />
              <Fact label="Vehicle" value={[driver.vehicleMake, driver.vehicleType].filter(Boolean).join(" / ") || "Not listed"} />
              <Fact label="Area" value={driver.operatingArea} />
              <Fact label="Valid until" value={formatDate(driver.validUntil)} />
            </div>

            <p className="mt-6 rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
              The QR status is live. If the driver, vehicle plate, or active status does not match, do not continue the trip and contact NoLSAF support.
            </p>
          </div>
        ) : (
          <div className="p-6">
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
                <p className="text-sm font-black text-rose-800">Driver could not be verified</p>
              </div>
              <p className="mt-2 text-sm text-rose-700">{result?.error || "This driver ID is not valid."}</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-slate-900">{value}</p>
    </div>
  );
}
