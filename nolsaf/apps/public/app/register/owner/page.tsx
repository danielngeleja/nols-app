"use client";
import { useState } from "react";
import PasswordField from "../PasswordField";

export default function OwnerRegisterPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordValid, setPasswordValid] = useState(false);
  const [tin, setTin] = useState("");
  const [address, setAddress] = useState("");
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
        body: JSON.stringify({ email, name, phone, password, role: 'OWNER', tin, address })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Registration failed');
      setMessage(`Registered owner: ${data.email} (role=${data.role}).` + (data.warning ? ' Note: ran in fallback mode.' : ''));
      setEmail(''); setName(''); setPhone(''); setPassword(''); setTin(''); setAddress('');
    } catch (err: any) {
      setMessage(err?.message || 'Registration error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form onSubmit={onSubmit} className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Create Owner account</h1>
        <p className="text-sm text-gray-600">Owners can list properties. We'll collect basic business info here.</p>

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
          <span className="block mb-1">Business TIN (optional)</span>
          <input className="input w-full" value={tin} onChange={(e)=>setTin(e.target.value)} />
        </label>

        <label className="block text-sm">
          <span className="block mb-1">Address (optional)</span>
          <input className="input w-full" value={address} onChange={(e)=>setAddress(e.target.value)} />
        </label>

        {message && <div className="text-sm text-gray-700">{message}</div>}

        <button className="btn btn-solid w-full" disabled={loading || !passwordValid}>{loading ? 'Creating…' : 'Create owner account'}</button>
      </form>
    </div>
  );
}
