"use client";
import { useState } from "react";
import PasswordField from "../PasswordField";

export default function DriverRegisterPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordValid, setPasswordValid] = useState(false);
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [licenseNumber, setLicenseNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    try {
      const API = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
      const res = await fetch(`${API}/api/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name, phone, password, role: 'DRIVER', vehicleMake, vehiclePlate, licenseNumber })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Registration failed');
      setMessage(`Registered driver: ${data.email} (role=${data.role}).` + (data.warning ? ' Note: ran in fallback mode.' : ''));
      setEmail(''); setName(''); setPhone(''); setPassword(''); setVehicleMake(''); setVehiclePlate(''); setLicenseNumber('');
    } catch (err: any) {
      setMessage(err?.message || 'Registration error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form onSubmit={onSubmit} className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Create Driver account</h1>
        <p className="text-sm text-gray-600">Drivers will be assigned rides. We'll collect vehicle and license details here.</p>

        <label className="block text-sm">
          <span className="block mb-1">Full name</span>
          <input className="input w-full" value={name} onChange={(e)=>setName(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="block mb-1">Email</span>
          <input type="email" required className="input w-full" value={email} onChange={(e)=>setEmail(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="block mb-1">Phone</span>
          <input className="input w-full" value={phone} onChange={(e)=>setPhone(e.target.value)} />
        </label>

        <PasswordField value={password} onChange={setPassword} onValidityChange={setPasswordValid} />

        <label className="block text-sm">
          <span className="block mb-1">Vehicle make / model (optional)</span>
          <input className="input w-full" value={vehicleMake} onChange={(e)=>setVehicleMake(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="block mb-1">Vehicle plate (optional)</span>
          <input className="input w-full" value={vehiclePlate} onChange={(e)=>setVehiclePlate(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="block mb-1">Driver license number (optional)</span>
          <input className="input w-full" value={licenseNumber} onChange={(e)=>setLicenseNumber(e.target.value)} />
        </label>

        {message && <div className="text-sm text-gray-700">{message}</div>}

        <button className="btn btn-solid w-full" disabled={loading || !passwordValid}>{loading ? 'Creating…' : 'Create driver account'}</button>
      </form>
    </div>
  );
}
