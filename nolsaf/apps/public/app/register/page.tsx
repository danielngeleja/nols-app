"use client";
import { useState } from "react";
import PasswordField from "./PasswordField";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [passwordValid, setPasswordValid] = useState(false);
  const [role, setRole] = useState<"CUSTOMER" | "OWNER" | "DRIVER">("CUSTOMER");
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
        body: JSON.stringify({ email, name, phone, password, role })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Registration failed');
      setMessage(`Registered: ${data.email} (role=${data.role}).` + (data.warning ? ' Note: ran in fallback mode.' : ''));
      setEmail(''); setName(''); setPhone(''); setPassword('');
    } catch (err: any) {
      setMessage(err?.message || 'Registration error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gray-50">
      <form onSubmit={onSubmit} className="card w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-semibold">Create an account</h1>
        <p className="text-sm text-gray-600">Choose the account type below. Admin accounts cannot be created here.</p>

        <div className="grid grid-cols-3 gap-3">
          <a href="/register" className="btn btn-outline">Customer</a>
          <a href="/register/owner" className="btn btn-outline">Owner</a>
          <a href="/register/driver" className="btn btn-outline">Driver</a>
        </div>
        <div className="h-3" />

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

        {message && <div className="text-sm text-gray-700">{message}</div>}

        <button className="btn btn-solid w-full" disabled={loading || !passwordValid}>{loading ? 'Creating…' : 'Create account'}</button>
      </form>
    </div>
  );
}
