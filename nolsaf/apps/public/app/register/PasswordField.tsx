"use client";

import { useEffect, useMemo, useState } from "react";

const fallbackPolicy = {
  minLength: 8,
  maxLength: 128,
  requireUpper: true,
  requireLower: true,
  requireNumber: true,
  requireSpecial: true,
  noSpaces: true,
  specialCharacters: "!@#$%^&*()-_=+[]{};:'\"\\|,<.>/?`~",
};

export default function PasswordField({
  value,
  onChange,
  onValidityChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [policy, setPolicy] = useState(fallbackPolicy);

  useEffect(() => {
    const controller = new AbortController();
    const api = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
    fetch(`${api}/api/auth/password-policy`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("policy unavailable")))
      .then((body) => setPolicy({ ...fallbackPolicy, ...(body?.policy || {}) }))
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const requirements = useMemo(() => [
    { label: `At least ${policy.minLength} characters`, pass: value.length >= policy.minLength && value.length <= policy.maxLength },
    ...(policy.requireUpper ? [{ label: "Uppercase letter", pass: /[A-Z]/.test(value) }] : []),
    ...(policy.requireLower ? [{ label: "Lowercase letter", pass: /[a-z]/.test(value) }] : []),
    ...(policy.requireNumber ? [{ label: "Number", pass: /[0-9]/.test(value) }] : []),
    ...(policy.requireSpecial ? [{ label: "Accepted special character", pass: Array.from(value).some((character) => policy.specialCharacters.includes(character)) }] : []),
    ...(policy.noSpaces ? [{ label: "No spaces", pass: !/\s/.test(value) }] : []),
  ], [policy, value]);
  const valid = value.length > 0 && requirements.every((requirement) => requirement.pass);

  useEffect(() => onValidityChange(valid), [onValidityChange, valid]);

  return (
    <label className="block text-sm">
      <span className="block mb-1">Password</span>
      <input type="password" required maxLength={policy.maxLength} className="input w-full" value={value} onChange={(event) => onChange(event.target.value)} />
      {value && (
        <span className="mt-2 grid grid-cols-2 gap-1 text-xs">
          {requirements.map((requirement) => (
            <span key={requirement.label} className={requirement.pass ? "text-emerald-700" : "text-gray-500"}>
              {requirement.pass ? "✓" : "○"} {requirement.label}
            </span>
          ))}
        </span>
      )}
    </label>
  );
}
