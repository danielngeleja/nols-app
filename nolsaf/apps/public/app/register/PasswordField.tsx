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
  const [policyStatus, setPolicyStatus] = useState<"loading" | "ready" | "error">("loading");
  const [policyAttempt, setPolicyAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setPolicyStatus("loading");
    const api = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
    fetch(`${api}/api/auth/password-policy`, { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("policy unavailable")))
      .then((body) => {
        if (controller.signal.aborted) return;
        setPolicy({ ...fallbackPolicy, ...(body?.policy || {}) });
        setPolicyStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setPolicyStatus("error");
      });
    return () => controller.abort();
  }, [policyAttempt]);

  const requirements = useMemo(() => [
    { label: `At least ${policy.minLength} characters`, pass: value.length >= policy.minLength && value.length <= policy.maxLength },
    ...(policy.requireUpper ? [{ label: "Uppercase letter", pass: /[A-Z]/.test(value) }] : []),
    ...(policy.requireLower ? [{ label: "Lowercase letter", pass: /[a-z]/.test(value) }] : []),
    ...(policy.requireNumber ? [{ label: "Number", pass: /[0-9]/.test(value) }] : []),
    ...(policy.requireSpecial ? [{ label: "Accepted special character", pass: Array.from(value).some((character) => policy.specialCharacters.includes(character)) }] : []),
    ...(policy.noSpaces ? [{ label: "No spaces", pass: !/\s/.test(value) }] : []),
  ], [policy, value]);
  const valid = policyStatus === "ready" && value.length > 0 && requirements.every((requirement) => requirement.pass);

  useEffect(() => onValidityChange(valid), [onValidityChange, valid]);

  return (
    <label className="block text-sm">
      <span className="block mb-1">Password</span>
      {policyStatus !== "ready" && (
        <span className="mb-2 block text-xs text-amber-700">
          {policyStatus === "loading" ? "Loading password requirements…" : "Password requirements could not be loaded."}
          {policyStatus === "error" && (
            <button type="button" onClick={() => setPolicyAttempt((attempt) => attempt + 1)} className="ml-1 border-0 bg-transparent p-0 font-semibold underline">
              Retry
            </button>
          )}
        </span>
      )}
      <input type="password" required maxLength={policy.maxLength} disabled={policyStatus !== "ready"} className="input w-full disabled:cursor-not-allowed disabled:bg-gray-100" value={value} onChange={(event) => onChange(event.target.value)} />
      {policyStatus === "ready" && value && (
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
