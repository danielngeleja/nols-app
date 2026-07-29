"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import apiClient, { saveAuthToken } from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { AlertCircle, Check, UserPlus, Lock, LogIn, User, Truck, Building2, Mail, ArrowLeft, Phone, Eye, EyeOff, Shield, Fingerprint, ShieldX, AlertTriangle, ChevronDown } from 'lucide-react';
import { useRouter, useSearchParams } from "next/navigation";
import LogoSpinner from "@/components/LogoSpinner";

const COUNTRY_CODES = [
  // East Africa — primary markets
  { code: '+255', country: 'TZ', flag: '🇹🇿', label: 'Tanzania' },
  { code: '+254', country: 'KE', flag: '🇰🇪', label: 'Kenya' },
  { code: '+256', country: 'UG', flag: '🇺🇬', label: 'Uganda' },
  { code: '+250', country: 'RW', flag: '🇷🇼', label: 'Rwanda' },
  // East & Central Africa — expansion
  { code: '+251', country: 'ET', flag: '🇪🇹', label: 'Ethiopia' },
  { code: '+257', country: 'BI', flag: '🇧🇮', label: 'Burundi' },
  { code: '+243', country: 'CD', flag: '🇨🇩', label: 'DR Congo' },
  { code: '+252', country: 'SO', flag: '🇸🇴', label: 'Somalia' },
  { code: '+211', country: 'SS', flag: '🇸🇸', label: 'South Sudan' },
  // Southern Africa
  { code: '+265', country: 'MW', flag: '🇲🇼', label: 'Malawi' },
  { code: '+258', country: 'MZ', flag: '🇲🇿', label: 'Mozambique' },
  { code: '+260', country: 'ZM', flag: '🇿🇲', label: 'Zambia' },
  { code: '+263', country: 'ZW', flag: '🇿🇼', label: 'Zimbabwe' },
  { code: '+27',  country: 'ZA', flag: '🇿🇦', label: 'South Africa' },
  // Indian Ocean & safari circuit
  { code: '+269', country: 'KM', flag: '🇰🇲', label: 'Comoros' },
  { code: '+248', country: 'SC', flag: '🇸🇨', label: 'Seychelles' },
  { code: '+230', country: 'MU', flag: '🇲🇺', label: 'Mauritius' },
  { code: '+267', country: 'BW', flag: '🇧🇼', label: 'Botswana' },
  { code: '+264', country: 'NA', flag: '🇳🇦', label: 'Namibia' },
  { code: '+244', country: 'AO', flag: '🇦🇴', label: 'Angola' },
  // West & North Africa
  { code: '+234', country: 'NG', flag: '🇳🇬', label: 'Nigeria' },
  { code: '+233', country: 'GH', flag: '🇬🇭', label: 'Ghana' },
  { code: '+221', country: 'SN', flag: '🇸🇳', label: 'Senegal' },
  { code: '+237', country: 'CM', flag: '🇨🇲', label: 'Cameroon' },
  { code: '+225', country: 'CI', flag: '🇨🇮', label: "Côte d'Ivoire" },
  { code: '+249', country: 'SD', flag: '🇸🇩', label: 'Sudan' },
  { code: '+212', country: 'MA', flag: '🇲🇦', label: 'Morocco' },
  { code: '+213', country: 'DZ', flag: '🇩🇿', label: 'Algeria' },
  { code: '+216', country: 'TN', flag: '🇹🇳', label: 'Tunisia' },
  { code: '+20',  country: 'EG', flag: '🇪🇬', label: 'Egypt' },
  // Europe — top tourism sources for East Africa
  { code: '+44',  country: 'GB', flag: '🇬🇧', label: 'United Kingdom' },
  { code: '+49',  country: 'DE', flag: '🇩🇪', label: 'Germany' },
  { code: '+33',  country: 'FR', flag: '🇫🇷', label: 'France' },
  { code: '+39',  country: 'IT', flag: '🇮🇹', label: 'Italy' },
  { code: '+31',  country: 'NL', flag: '🇳🇱', label: 'Netherlands' },
  { code: '+34',  country: 'ES', flag: '🇪🇸', label: 'Spain' },
  { code: '+351', country: 'PT', flag: '🇵🇹', label: 'Portugal' },
  { code: '+32',  country: 'BE', flag: '🇧🇪', label: 'Belgium' },
  { code: '+41',  country: 'CH', flag: '🇨🇭', label: 'Switzerland' },
  { code: '+43',  country: 'AT', flag: '🇦🇹', label: 'Austria' },
  { code: '+48',  country: 'PL', flag: '🇵🇱', label: 'Poland' },
  { code: '+420', country: 'CZ', flag: '🇨🇿', label: 'Czechia' },
  { code: '+353', country: 'IE', flag: '🇮🇪', label: 'Ireland' },
  { code: '+46',  country: 'SE', flag: '🇸🇪', label: 'Sweden' },
  { code: '+47',  country: 'NO', flag: '🇳🇴', label: 'Norway' },
  { code: '+45',  country: 'DK', flag: '🇩🇰', label: 'Denmark' },
  { code: '+7',   country: 'RU', flag: '🇷🇺', label: 'Russia' },
  { code: '+380', country: 'UA', flag: '🇺🇦', label: 'Ukraine' },
  { code: '+90',  country: 'TR', flag: '🇹🇷', label: 'Turkey' },
  // Middle East
  { code: '+971', country: 'AE', flag: '🇦🇪', label: 'UAE' },
  { code: '+972', country: 'IL', flag: '🇮🇱', label: 'Israel' },
  { code: '+966', country: 'SA', flag: '🇸🇦', label: 'Saudi Arabia' },
  { code: '+974', country: 'QA', flag: '🇶🇦', label: 'Qatar' },
  { code: '+968', country: 'OM', flag: '🇴🇲', label: 'Oman' },
  { code: '+965', country: 'KW', flag: '🇰🇼', label: 'Kuwait' },
  // Asia-Pacific
  { code: '+91',  country: 'IN', flag: '🇮🇳', label: 'India' },
  { code: '+86',  country: 'CN', flag: '🇨🇳', label: 'China' },
  { code: '+81',  country: 'JP', flag: '🇯🇵', label: 'Japan' },
  { code: '+82',  country: 'KR', flag: '🇰🇷', label: 'South Korea' },
  { code: '+65',  country: 'SG', flag: '🇸🇬', label: 'Singapore' },
  { code: '+60',  country: 'MY', flag: '🇲🇾', label: 'Malaysia' },
  { code: '+62',  country: 'ID', flag: '🇮🇩', label: 'Indonesia' },
  { code: '+66',  country: 'TH', flag: '🇹🇭', label: 'Thailand' },
  { code: '+63',  country: 'PH', flag: '🇵🇭', label: 'Philippines' },
  { code: '+92',  country: 'PK', flag: '🇵🇰', label: 'Pakistan' },
  { code: '+61',  country: 'AU', flag: '🇦🇺', label: 'Australia' },
  { code: '+64',  country: 'NZ', flag: '🇳🇿', label: 'New Zealand' },
  // Americas
  { code: '+1',   country: 'US', flag: '🇺🇸', label: 'United States / Canada' },
  { code: '+52',  country: 'MX', flag: '🇲🇽', label: 'Mexico' },
  { code: '+55',  country: 'BR', flag: '🇧🇷', label: 'Brazil' },
  { code: '+54',  country: 'AR', flag: '🇦🇷', label: 'Argentina' },
] as const;

const PHONE_RULES: Record<string, { min: number; max: number; example: string }> = {
  '+255': { min: 9, max: 9, example: '712345678' },
  '+254': { min: 9, max: 9, example: '712345678' },
  '+256': { min: 9, max: 9, example: '712345678' },
  '+250': { min: 9, max: 9, example: '788123456' },
  '+251': { min: 9, max: 9, example: '911234567' },
  '+257': { min: 8, max: 8, example: '79123456' },
  '+243': { min: 9, max: 9, example: '991234567' },
  '+252': { min: 8, max: 9, example: '612345678' },
  '+211': { min: 9, max: 9, example: '912345678' },
  '+265': { min: 9, max: 9, example: '991234567' },
  '+258': { min: 9, max: 9, example: '841234567' },
  '+260': { min: 9, max: 9, example: '971234567' },
  '+263': { min: 9, max: 9, example: '771234567' },
  '+27': { min: 9, max: 9, example: '821234567' },
  '+234': { min: 10, max: 10, example: '8012345678' },
  '+233': { min: 9, max: 9, example: '241234567' },
  '+212': { min: 9, max: 9, example: '612345678' },
  '+20': { min: 10, max: 10, example: '1012345678' },
  '+269': { min: 7, max: 7, example: '3212345' },
  '+248': { min: 7, max: 7, example: '2510123' },
  '+230': { min: 8, max: 8, example: '52512345' },
  '+267': { min: 8, max: 8, example: '71123456' },
  '+264': { min: 9, max: 9, example: '811234567' },
  '+244': { min: 9, max: 9, example: '923123456' },
  '+221': { min: 9, max: 9, example: '701234567' },
  '+237': { min: 9, max: 9, example: '671234567' },
  '+225': { min: 10, max: 10, example: '0123456789' },
  '+249': { min: 9, max: 9, example: '911231234' },
  '+213': { min: 9, max: 9, example: '551234567' },
  '+216': { min: 8, max: 8, example: '20123456' },
  '+44': { min: 10, max: 10, example: '7400123456' },
  '+49': { min: 10, max: 11, example: '15123456789' },
  '+33': { min: 9, max: 9, example: '612345678' },
  '+39': { min: 9, max: 10, example: '3123456789' },
  '+31': { min: 9, max: 9, example: '612345678' },
  '+34': { min: 9, max: 9, example: '612345678' },
  '+351': { min: 9, max: 9, example: '912345678' },
  '+32': { min: 8, max: 9, example: '470123456' },
  '+41': { min: 9, max: 9, example: '781234567' },
  '+43': { min: 10, max: 11, example: '6641234567' },
  '+48': { min: 9, max: 9, example: '512345678' },
  '+420': { min: 9, max: 9, example: '601123456' },
  '+353': { min: 9, max: 9, example: '851234567' },
  '+46': { min: 9, max: 9, example: '701234567' },
  '+47': { min: 8, max: 8, example: '40612345' },
  '+45': { min: 8, max: 8, example: '20123456' },
  '+7': { min: 10, max: 10, example: '9123456789' },
  '+380': { min: 9, max: 9, example: '501234567' },
  '+90': { min: 10, max: 10, example: '5012345678' },
  '+971': { min: 9, max: 9, example: '501234567' },
  '+972': { min: 9, max: 9, example: '501234567' },
  '+966': { min: 9, max: 9, example: '512345678' },
  '+974': { min: 8, max: 8, example: '33123456' },
  '+968': { min: 8, max: 8, example: '92123456' },
  '+965': { min: 8, max: 8, example: '50012345' },
  '+91': { min: 10, max: 10, example: '9876543210' },
  '+86': { min: 11, max: 11, example: '13800138000' },
  '+81': { min: 10, max: 10, example: '9012345678' },
  '+82': { min: 9, max: 10, example: '1012345678' },
  '+65': { min: 8, max: 8, example: '81234567' },
  '+60': { min: 9, max: 10, example: '123456789' },
  '+62': { min: 9, max: 12, example: '81234567890' },
  '+66': { min: 9, max: 9, example: '812345678' },
  '+63': { min: 10, max: 10, example: '9171234567' },
  '+92': { min: 10, max: 10, example: '3001234567' },
  '+61': { min: 9, max: 9, example: '412345678' },
  '+64': { min: 8, max: 10, example: '211234567' },
  '+1': { min: 10, max: 10, example: '2015550123' },
  '+52': { min: 10, max: 10, example: '5512345678' },
  '+55': { min: 10, max: 11, example: '11912345678' },
  '+54': { min: 10, max: 11, example: '91123456789' },
};

const getPhoneRule = (code: string) => PHONE_RULES[code] || { min: 6, max: 12, example: '123456789' };
const getPhonePlaceholder = (code: string) => getPhoneRule(code).example;
const getCountryLabel = (code: string) => COUNTRY_CODES.find((c) => c.code === code)?.label || 'selected country';
const getPhoneMaxLength = (code: string) => getPhoneRule(code).max;
const sanitizePhoneInput = (value: string, code: string) => value.replace(/[^0-9]/g, '').slice(0, getPhoneMaxLength(code));
const isPhoneLengthValid = (value: string, code: string) => {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  const { min, max } = getPhoneRule(code);
  return digits.length >= min && digits.length <= max;
};
const getPhoneLengthHint = (code: string) => {
  const { min, max } = getPhoneRule(code);
  return min === max ? `Enter ${min} digits for ${getCountryLabel(code)}` : `Enter ${min}-${max} digits for ${getCountryLabel(code)}`;
};

function CountryCodePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = COUNTRY_CODES.find((c) => c.code === value) ?? COUNTRY_CODES[0];

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  return (
    <div ref={ref} className="relative w-[122px] min-w-[122px] flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-1.5 rounded-xl border-2 border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 transition-all hover:border-[#02665e]/40 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] shadow-sm"
      >
        <span className="text-base leading-none">{selected.flag}</span>
        <span>{selected.code}</span>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1.5 z-50 rounded-xl border border-slate-200 bg-white ring-1 ring-black/5 shadow-xl overflow-hidden">
          <div className="max-h-[260px] overflow-y-auto overscroll-contain">
            {COUNTRY_CODES.map((c) => (
              <button
                key={c.code}
                type="button"
                onClick={() => { onChange(c.code); close(); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-sm transition-colors whitespace-nowrap ${
                  c.code === value
                    ? 'bg-[#02665e]/10 text-[#02665e] font-semibold'
                    : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="text-base leading-none">{c.flag}</span>
                <span className="font-medium">{c.code}</span>
                {c.code === value && <Check className="w-3.5 h-3.5 text-[#02665e] flex-shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RegisterPage() {
  const searchParams = useSearchParams();
  const referralCode = searchParams?.get('ref') || null;
  const roleParam = (searchParams?.get('role') || '').toLowerCase();
  const modeParam = (searchParams?.get('mode') || '').toLowerCase();
  const nextParamRaw = searchParams?.get('next');
  const api = apiClient;

  // This page is the shared web login gate for every account role. The role
  // query parameter controls registration presentation and redirect context;
  // it must never be sent as a native-app login restriction.
  const safeNextPath = (raw: unknown): string | undefined => {
    if (typeof raw !== 'string') return undefined;
    const v = raw.trim();
    if (!v) return undefined;
    if (!v.startsWith('/') || v.startsWith('//')) return undefined;
    return v;
  };

  // Register state
  const [role, setRole] = useState<'traveller' | 'driver' | 'owner'>('traveller');
  const [registerMethod, setRegisterMethod] = useState<'phone' | 'email'>('phone');
  const [countryCode, setCountryCode] = useState<string>('+255');
  const [phone, setPhone] = useState<string>('');
  const [registerEmail, setRegisterEmail] = useState<string>('');
  const [otp, setOtp] = useState<string>('');
  const [step, setStep] = useState<'phone' | 'otp' | 'done'>('phone');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [countdown, setCountdown] = useState<number>(0);
  const otpRef = useRef<HTMLInputElement | null>(null);
  
  // Login state
  const [authMode, setAuthMode] = useState<'register' | 'login' | 'forgot'>('register');
  const [loginPhone, setLoginPhone] = useState<string>('');
  const [loginCountryCode, setLoginCountryCode] = useState<string>('+255');
  const [loginIdentifier, setLoginIdentifier] = useState<string>('');
  const [loginPassword, setLoginPassword] = useState<string>('');
  const [loginOtp, setLoginOtp] = useState<string>('');
  const [loginSent, setLoginSent] = useState<boolean>(false);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [loginMethod, setLoginMethod] = useState<'phone' | 'credentials'>('phone');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [lockoutUntil, setLockoutUntil] = useState<number | null>(null);
  const [lockoutTotalSeconds, setLockoutTotalSeconds] = useState<number>(0);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState<number>(0);
  const [lockoutMessage, setLockoutMessage] = useState<string | null>(null);
  const [passkeyLoading, setPasskeyLoading] = useState<boolean>(false);
  const [blockedAccount, setBlockedAccount] = useState<null | { name: string; email?: string | null; caseRef?: string | null; reason: string; nextSteps: string; payoutMessage: string }>(null);
  
  // Passkey sign-in helper
  const handlePasskeySignIn = async () => {
    setPasskeyLoading(true);
    setError(null);
    try {
      if (typeof PublicKeyCredential === 'undefined') {
        throw new Error('Passkeys are not supported in this browser. Try Chrome, Edge, or Safari.');
      }

      const optRes = await fetch('/api/auth/passkeys/options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        credentials: 'include',
      });
      if (!optRes.ok) {
        const d = await optRes.json().catch(() => ({}));
        throw new Error((d as any)?.error || 'Failed to get passkey options');
      }
      const { sessionId, publicKey } = await optRes.json();

      const b64urlToUint8 = (s: string): Uint8Array<ArrayBuffer> => {
        let str = s.replace(/-/g, '+').replace(/_/g, '/');
        const pad = (4 - (str.length % 4)) % 4;
        if (pad) str += '='.repeat(pad);
        const bin = atob(str);
        const buf = new ArrayBuffer(bin.length);
        const bytes = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
      };

      const arrToB64Url = (buf: ArrayBuffer): string => {
        const bytes = new Uint8Array(buf);
        let str = '';
        for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
        return btoa(str).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
      };

      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: b64urlToUint8(publicKey.challenge),
          rpId: publicKey.rpId,
          timeout: publicKey.timeout ?? 60000,
          userVerification: publicKey.userVerification ?? 'preferred',
          allowCredentials: (publicKey.allowCredentials ?? []).map((c: any) => ({
            ...c,
            id: b64urlToUint8(c.id),
          })),
        },
      });

      if (!credential) throw new Error('No credential returned');
      const credAny = credential as any;

      const assertion = {
        id: credAny.id,
        rawId: arrToB64Url(credAny.rawId),
        type: credAny.type,
        response: {
          authenticatorData: arrToB64Url(credAny.response.authenticatorData),
          clientDataJSON: arrToB64Url(credAny.response.clientDataJSON),
          signature: arrToB64Url(credAny.response.signature),
          userHandle: credAny.response.userHandle ? arrToB64Url(credAny.response.userHandle) : null,
        },
        clientExtensionResults: credAny.getClientExtensionResults ? credAny.getClientExtensionResults() : {},
      };

      const verifyRes = await fetch('/api/auth/passkeys/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, response: assertion }),
        credentials: 'include',
      });
      if (!verifyRes.ok) {
        const d = await verifyRes.json().catch(() => ({}));
        const serverError = (d as any)?.error;
        const serverDetails = (d as any)?.details;
        const composed = [serverError, serverDetails].filter(Boolean).join(': ');
        throw new Error(composed || 'Passkey verification failed');
      }

      await redirectAfterAuth();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        setError('You dont have the Passkey try signing with another option and add passkey after login');
      } else {
        setError(e?.message || 'Passkey sign-in failed');
      }
    } finally {
      setPasskeyLoading(false);
    }
  };

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState<string>('');
  const [forgotPhone, setForgotPhone] = useState<string>('');
  const [forgotCountryCode, setForgotCountryCode] = useState<string>('+255');
  const [forgotOtp, setForgotOtp] = useState<string>('');
  const [forgotMethod, setForgotMethod] = useState<'email' | 'otp'>('email');
  const [forgotStep, setForgotStep] = useState<'input' | 'otp' | 'sent'>('input');
  const [forgotLoading, setForgotLoading] = useState<boolean>(false);
  const [forgotSent, setForgotSent] = useState<boolean>(false);
  const [forgotCountdown, setForgotCountdown] = useState<number>(0);
  const [, setForgotResetToken] = useState<string | null>(null);
  const forgotOtpRef = useRef<HTMLInputElement | null>(null);
  
  const router = useRouter();
  const [visible, setVisible] = useState<boolean>(true);

  const normalizeLoginPhone = (raw: string, code: string = '+255') => {
    const v = String(raw || '').trim().replace(/[^0-9]/g, '');
    if (!v) return '';
    if (String(raw || '').trim().startsWith('+')) return String(raw || '').trim();
    if (v.startsWith('0')) return `${code}${v.slice(1)}`;
    return `${code}${v}`;
  };

  const isLockedOut = lockoutRemainingSeconds > 0;

  const formatRemaining = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const secs = s % 60;
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    if (hrs > 0) return `${hrs}:${mm}:${ss}`;
    return `${mm}:${ss}`;
  };

  const resolveRoleHome = async () => {
    try {
      const me = await fetchAccountSession();
      const role = String(me.data?.role || '').toUpperCase();
      if (role === 'ADMIN') return '/admin/home';
      if (role === 'OWNER') return '/owner';
      if (role === 'DRIVER') return '/driver';
      if (role === 'AGENT') return '/account/agent';
      // Preserve the existing NRMS staff chooser for accounts assigned to one
      // or more property workspaces.
      try {
        const nrms = await apiClient.get<any>('/api/nrms/operations/me');
        if (Array.isArray(nrms.data?.properties) && nrms.data.properties.length > 0) return '/nrms/choose';
      } catch {
        // Not NRMS staff or the check failed.
      }
      return '/account';
    } catch {
      return '/account';
    }
  };

  const resolvePostAuthDestination = async () => {
    const safeNext = safeNextPath(nextParamRaw);
    if (safeNext) return safeNext;
    try {
      const workspaces = await apiClient.get('/api/me/workspaces');
      if (workspaces.data?.requiresSelection) return '/workspace/select';
    } catch {
      // Preserve the existing role-based login destination if discovery fails.
    }
    return await resolveRoleHome();
  };

  const redirectAfterAuth = async () => {
    // Give the browser a moment to persist the httpOnly cookie
    await new Promise((r) => setTimeout(r, 100));
    const dest = await resolvePostAuthDestination();
    window.location.href = dest;
  };

  useEffect(() => {
    if (modeParam === 'login') setAuthMode('login');
    else if (modeParam === 'forgot') setAuthMode('forgot');
    else if (modeParam === 'register') setAuthMode('register');
  }, [modeParam]);

  useEffect(() => {
    setBlockedAccount(null);
  }, [authMode, loginMethod]);

  useEffect(() => {
    if (!lockoutUntil) {
      setLockoutRemainingSeconds(0);
      return;
    }

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((lockoutUntil - Date.now()) / 1000));
      setLockoutRemainingSeconds(remaining);
      if (remaining <= 0) {
        setLockoutUntil(null);
        setLockoutTotalSeconds(0);
        setLockoutMessage(null);
      }
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  useEffect(() => {
    if (roleParam === 'driver') setRole('driver');
    else if (roleParam === 'owner') setRole('owner');
    else if (roleParam === 'traveller' || roleParam === 'customer' || roleParam === 'user') setRole('traveller');
  }, [roleParam]);

  const sendOtp = async () => {
    setError(null);
    setSuccess(null);
    if (registerMethod === 'phone' && !isPhoneLengthValid(phone, countryCode)) {
      setError(getPhoneLengthHint(countryCode));
      return;
    }
    if (registerMethod === 'email' && !isValidEmail(registerEmail)) {
      setError('Please enter a valid email address');
      return;
    }
    setLoading(true);
    try {
      const destination =
        registerMethod === 'phone'
          ? { phone: `${countryCode}${phone}` }
          : { email: registerEmail.trim().toLowerCase() };
      const resp = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...destination, role }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(data?.message || 'Failed to send OTP');
      }
      setSuccess(
        registerMethod === 'phone'
          ? 'Verification code sent to your phone.'
          : 'Verification code sent to your email.'
      );
      setStep('otp');
      setCountdown(60);
      const iv = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) {
            clearInterval(iv);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
    } catch (err: any) {
      setError(err?.message || 'Failed to send OTP');
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    setError(null);
    if (!otp || otp.trim().length < 3) {
      setError('Enter the OTP you received');
      return;
    }
    if (!agreed) {
      setError('You must agree to the terms and conditions');
      return;
    }
    setLoading(true);
    try {
      const destination =
        registerMethod === 'phone'
          ? { phone: `${countryCode}${phone}` }
          : { email: registerEmail.trim().toLowerCase() };
      // Verify OTP with API
      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...destination, otp, role }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'OTP verification failed');
      }
      const data = await resp.json().catch(() => ({}));
      saveAuthToken(data.token);
      setStep('done');
      const nextPath = safeNextPath(nextParamRaw);
      if (nextPath?.startsWith('/public/booking/payment')) {
        setTimeout(() => {
          window.location.href = nextPath;
        }, 900);
        return;
      }
      // Include referral code in URL if present
      const onboardUrl = referralCode 
        ? `/account/onboard/${role}?ref=${encodeURIComponent(referralCode)}`
        : `/account/onboard/${role}`;
      setTimeout(() => router.push(onboardUrl), 900);
    } catch (err: any) {
      setError(err?.message || 'OTP verification failed');
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    if (countdown > 0) return;
    await sendOtp();
  };

  useEffect(() => {
    setVisible(false);
    const t = setTimeout(() => {
      setVisible(true);
      if (step === 'otp' && otpRef.current) {
        try { otpRef.current.focus(); } catch (e) {}
      }
    }, 20);
    return () => clearTimeout(t);
  }, [step]);

  // Register Page
  const renderRegisterPage = () => {
    return (
      <div className="w-full flex flex-col bg-white relative box-border">
        <div className="sticky top-0 z-10 bg-[#02665e] shadow-md">
          <div className="px-6 py-4">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1">
                <h1 className="text-xl font-bold text-white">Create Account</h1>
                <p className="text-xs text-white/70 mt-0.5">Sign up to get started</p>
              </div>
              {step !== 'phone' && (
                <div className="px-2.5 py-1 rounded-md bg-white/15 text-xs font-semibold text-white border border-white/20">
                  {step === 'otp' ? 'Step 2' : 'Done ✓'}
                </div>
              )}
            </div>
          </div>
          <div className="px-6 pb-3">
            <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
              <div 
                className={`h-full bg-white rounded-full transition-all duration-500 ${step === 'phone' ? 'w-1/3' : step === 'otp' ? 'w-2/3' : 'w-full'}`} 
              />
            </div>
          </div>
        </div>

        <div className="px-6 py-5">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
              <span className="flex-1">{error}</span>
            </div>
          )}

          {success && (
            <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-sm text-emerald-700">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-500" />
              <span className="flex-1">{success}</span>
            </div>
          )}

          <div className={`space-y-3 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
            {step === 'phone' && (
              <>
                <div
                  className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1"
                  aria-label="Choose where to receive your verification code"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterMethod('phone');
                      setError(null);
                      setSuccess(null);
                    }}
                    aria-pressed={registerMethod === 'phone'}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      registerMethod === 'phone'
                        ? 'bg-[#02665e] text-white shadow-sm'
                        : 'bg-transparent text-slate-600 hover:bg-white'
                    }`}
                  >
                    <Phone className="h-4 w-4" />
                    Phone
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRegisterMethod('email');
                      setError(null);
                      setSuccess(null);
                    }}
                    aria-pressed={registerMethod === 'email'}
                    className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
                      registerMethod === 'email'
                        ? 'bg-[#02665e] text-white shadow-sm'
                        : 'bg-transparent text-slate-600 hover:bg-white'
                    }`}
                  >
                    <Mail className="h-4 w-4" />
                    Email
                  </button>
                </div>

                {registerMethod === 'phone' ? (
                <div className="space-y-3 min-w-0">
                  <label className="block text-sm font-semibold text-slate-700">Phone Number</label>
                  <div className="flex items-center gap-2 w-full">
                    <CountryCodePicker value={countryCode} onChange={setCountryCode} />
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(sanitizePhoneInput(e.target.value, countryCode))}
                      placeholder={getPhonePlaceholder(countryCode)}
                      maxLength={getPhoneMaxLength(countryCode)}
                      className="flex-1 min-w-0 px-4 py-2.5 text-sm bg-white text-slate-900 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all duration-200 placeholder:text-slate-400 shadow-sm hover:border-slate-300 box-border"
                    />
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span className="w-1 h-1 bg-[#02665e] rounded-full flex-shrink-0" />
                    <span>We&apos;ll send you a verification code</span>
                  </p>
                  {phone.length > 0 && !isPhoneLengthValid(phone, countryCode) ? (
                    <p className="text-[11px] text-amber-600 font-medium">{getPhoneLengthHint(countryCode)}</p>
                  ) : null}
                </div>
                ) : (
                  <div className="space-y-3 min-w-0">
                    <label className="block text-sm font-semibold text-slate-700">Email Address</label>
                    <input
                      type="email"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="w-full max-w-full px-4 py-2.5 text-sm bg-white text-slate-900 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] transition-all duration-200 placeholder:text-slate-400 shadow-sm hover:border-slate-300 box-border"
                    />
                    <p className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="w-1 h-1 bg-[#02665e] rounded-full flex-shrink-0" />
                      <span>We&apos;ll email you a verification code</span>
                    </p>
                    {registerEmail.length > 0 && !isValidEmail(registerEmail) ? (
                      <p className="text-[11px] text-amber-600 font-medium">Enter a valid email address</p>
                    ) : null}
                  </div>
                )}

                <div className="space-y-3">
                  <label className="block text-sm font-semibold text-slate-700">I am a</label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {/* Traveller card */}
                    <button
                      type="button"
                      onClick={() => setRole('traveller')}
                      aria-pressed={role === 'traveller'}
                      style={role === 'traveller' ? {
                        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.18) 1.5px, transparent 1.5px)`,
                        backgroundSize: '16px 16px'
                      } : undefined}
                      className={[
                        "relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none overflow-hidden",
                        role === 'traveller'
                          ? "border-[#02665e] bg-[#02665e] shadow-lg shadow-[#02665e]/20"
                          : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:shadow-md",
                      ].join(" ")}
                    >
                      {role === 'traveller' && (
                        <div className="absolute top-2 right-2">
                          <div className="h-5 w-5 rounded-full bg-white/25 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </div>
                        </div>
                      )}
                      <div className={["h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0", role === 'traveller' ? "bg-white/20" : "bg-[#02665e]/10"].join(" ")}>
                        <User className={["w-4 h-4", role === 'traveller' ? "text-white" : "text-[#02665e]"].join(" ")} />
                      </div>
                      <div>
                        <p className={["text-sm font-bold", role === 'traveller' ? "text-white" : "text-slate-800"].join(" ")}>Traveller</p>
                        <p className={["text-xs mt-0.5 leading-tight", role === 'traveller' ? "text-white/75" : "text-slate-500"].join(" ")}>Book stays &amp; tours</p>
                      </div>
                    </button>

                    {/* Driver card */}
                    <button
                      type="button"
                      onClick={() => setRole('driver')}
                      aria-pressed={role === 'driver'}
                      style={role === 'driver' ? {
                        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.18) 1.5px, transparent 1.5px)`,
                        backgroundSize: '16px 16px'
                      } : undefined}
                      className={[
                        "relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none overflow-hidden",
                        role === 'driver'
                          ? "border-[#02665e] bg-[#02665e] shadow-lg shadow-[#02665e]/20"
                          : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:shadow-md",
                      ].join(" ")}
                    >
                      {role === 'driver' && (
                        <div className="absolute top-2 right-2">
                          <div className="h-5 w-5 rounded-full bg-white/25 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </div>
                        </div>
                      )}
                      <div className={["h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0", role === 'driver' ? "bg-white/20" : "bg-[#02665e]/10"].join(" ")}>
                        <Truck className={["w-4 h-4", role === 'driver' ? "text-white" : "text-[#02665e]"].join(" ")} />
                      </div>
                      <div>
                        <p className={["text-sm font-bold", role === 'driver' ? "text-white" : "text-slate-800"].join(" ")}>Driver</p>
                        <p className={["text-xs mt-0.5 leading-tight", role === 'driver' ? "text-white/75" : "text-slate-500"].join(" ")}>Drive and earn</p>
                      </div>
                    </button>

                    {/* Owner card */}
                    <button
                      type="button"
                      onClick={() => setRole('owner')}
                      aria-pressed={role === 'owner'}
                      style={role === 'owner' ? {
                        backgroundImage: `radial-gradient(circle, rgba(255,255,255,0.18) 1.5px, transparent 1.5px)`,
                        backgroundSize: '16px 16px'
                      } : undefined}
                      className={[
                        "relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none overflow-hidden",
                        role === 'owner'
                          ? "border-[#02665e] bg-[#02665e] shadow-lg shadow-[#02665e]/20"
                          : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:shadow-md",
                      ].join(" ")}
                    >
                      {role === 'owner' && (
                        <div className="absolute top-2 right-2">
                          <div className="h-5 w-5 rounded-full bg-white/25 flex items-center justify-center">
                            <Check className="w-3 h-3 text-white" strokeWidth={3} />
                          </div>
                        </div>
                      )}
                      <div className={["h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0", role === 'owner' ? "bg-white/20" : "bg-[#02665e]/10"].join(" ")}>
                        <Building2 className={["w-4 h-4", role === 'owner' ? "text-white" : "text-[#02665e]"].join(" ")} />
                      </div>
                      <div>
                        <p className={["text-sm font-bold", role === 'owner' ? "text-white" : "text-slate-800"].join(" ")}>Owner</p>
                        <p className={["text-xs mt-0.5 leading-tight", role === 'owner' ? "text-white/75" : "text-slate-500"].join(" ")}>List property</p>
                      </div>
                    </button>
                  </div>
                </div>

                <button
                  onClick={sendOtp}
                  disabled={
                    loading ||
                    (registerMethod === 'phone'
                      ? !isPhoneLengthValid(phone, countryCode)
                      : !isValidEmail(registerEmail))
                  }
                  className="w-full mt-5 px-4 py-2.5 bg-[#02665e] text-white text-sm font-medium rounded-lg hover:bg-[#014e47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <LogoSpinner size="xs" ariaLabel="Sending" className="text-white/90" />
                      <span>Sending...</span>
                    </>
                  ) : (
                    registerMethod === 'phone' ? 'Send code by phone' : 'Send code by email'
                  )}
                </button>
              </>
            )}

            {step === 'done' && (
              <div className="flex flex-col items-center justify-center py-12 gap-6 text-center">
                <div className="relative flex items-center justify-center">
                  <div className="absolute w-24 h-24 rounded-full bg-[#02665e]/10 animate-ping" style={{ animationDuration: '1.5s' }} />
                  <div className="relative w-20 h-20 rounded-full bg-[#02665e]/15 flex items-center justify-center">
                    <div className="w-14 h-14 rounded-full bg-[#02665e]/25 flex items-center justify-center">
                      <Check className="w-8 h-8 text-[#02665e]" strokeWidth={2.5} />
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Account Created!</h2>
                  <p className="text-sm text-slate-500">Redirecting you to profile setup…</p>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#02665e] animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[#02665e] animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 rounded-full bg-[#02665e] animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {step === 'otp' && (
              <>
                <div className="space-y-2 min-w-0">
                  <label className="block text-sm font-semibold text-slate-700">
                    Enter the code sent to your {registerMethod}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ''))}
                    ref={otpRef}
                    placeholder="123456"
                    maxLength={6}
                    className="w-full max-w-full px-4 py-3 text-xl tracking-[0.35em] text-center font-mono bg-white text-slate-900 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] box-border placeholder:text-slate-300 shadow-sm"
                  />
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 hover:border-[#02665e]/30 transition-colors min-w-0">
                  <label className="flex items-center gap-3 cursor-pointer min-w-0">
                    <div className="relative flex-shrink-0">
                      <input
                        type="checkbox"
                        checked={agreed}
                        onChange={(e) => setAgreed(e.target.checked)}
                        className="sr-only peer"
                      />
                      {/* Toggle switch */}
                      <div className={`w-10 h-6 rounded-full transition-colors duration-200 ${agreed ? 'bg-[#02665e]' : 'bg-slate-300'}`}>
                        <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${agreed ? 'translate-x-4' : 'translate-x-0'}`} />
                      </div>
                    </div>
                    <span className="text-xs text-slate-700 leading-relaxed min-w-0 break-words flex-1">
                      I agree to the{' '}
                      <a
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[#02665e] hover:underline font-semibold transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Terms and Conditions
                      </a>
                    </span>
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 min-w-0">
                  <div className="text-xs text-slate-500 min-w-0 flex-shrink-0">
                    {countdown > 0 ? (
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse flex-shrink-0" />
                        <span className="whitespace-nowrap">Resend in {countdown}s</span>
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={resend}
                        className="text-[#02665e] hover:underline font-medium whitespace-nowrap"
                      >
                        Resend OTP
                      </button>
                    )}
                  </div>
                  <button
                    onClick={verifyOtp}
                    disabled={loading || !agreed}
                    className="px-4 py-2.5 bg-[#02665e] text-white text-sm font-semibold rounded-lg hover:bg-[#014e47] transition-colors shadow-[0_0_0_1px_rgba(20,184,166,0.18)] disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0 box-border"
                  >
                    {loading ? 'Verifying...' : 'Continue'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    );
  };

  const renderBlockedAccountCard = () => {
    if (!blockedAccount) return null;

    return (
      <div className="mb-4 overflow-hidden rounded-2xl border border-red-200 bg-white shadow-lg">
        <div className="bg-gradient-to-r from-red-600 to-red-500 px-6 py-5 text-center">
          <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white/20">
            <ShieldX className="h-9 w-9 text-white" />
          </div>
          <h2 className="text-xl font-bold text-white">Driver Access Revoked</h2>
          <p className="mt-1 text-sm text-red-100">This account cannot access the NoLSAF driver portal right now.</p>
        </div>
        <div className="space-y-4 p-6">
          <div className="rounded-xl border border-red-100 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-red-500">Account holder</p>
            <p className="mt-1 text-base font-bold text-slate-900">{blockedAccount.name}</p>
            {blockedAccount.email ? <p className="mt-1 text-xs text-slate-500">{blockedAccount.email}</p> : null}
            {blockedAccount.caseRef ? (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-red-500">Reference Number</p>
                <p className="mt-1 font-mono text-xs font-bold text-red-800">{blockedAccount.caseRef}</p>
              </div>
            ) : null}
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
            <div>
              <p className="mb-1 text-sm font-medium text-red-800">Why you cannot access this account</p>
              <p className="text-xs leading-relaxed text-red-700">{blockedAccount.reason}</p>
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="mb-2 text-sm font-medium text-slate-800">What to do next</p>
            <p className="text-xs leading-relaxed text-slate-600">
              {blockedAccount.nextSteps}
              {blockedAccount.caseRef ? ` Use reference number ${blockedAccount.caseRef} when contacting support.` : ''}
            </p>
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="mb-1 text-sm font-medium text-amber-900">Payout handling</p>
            <p className="text-xs leading-relaxed text-amber-800">{blockedAccount.payoutMessage}</p>
          </div>
          <a
            href="mailto:support@nolsaf.com"
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-600 py-2.5 text-sm font-medium text-white no-underline transition-colors hover:bg-red-700 animate-pulse hover:animate-none"
          >
            Contact Support
          </a>
        </div>
      </div>
    );
  };

  // Login Page
  const renderLoginPage = () => {
    return (
      <div className="relative flex w-full flex-col bg-white">
        <div className="border-b border-slate-100 bg-white px-5 pb-4 pt-5 sm:px-6">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-emerald-50 text-[#02665e] ring-1 ring-emerald-100">
                <LogIn className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#02776c]">NoLSAF account</p>
                <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-950">Welcome back</h1>
                <p className="mt-0.5 text-xs text-slate-500">Sign in securely to continue.</p>
              </div>
              {loginSent && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-[#02665e] ring-1 ring-emerald-100">
                  Verify code
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-[#028577]" />
                Protected sign-in
              </span>
              {!!roleParam && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2 py-1 font-semibold text-slate-600 ring-1 ring-slate-200">
                  {roleParam === 'driver' ? (
                    <Truck className="h-3.5 w-3.5" />
                  ) : roleParam === 'owner' ? (
                    <Building2 className="h-3.5 w-3.5" />
                  ) : (
                    <User className="h-3.5 w-3.5" />
                  )}
                  <span className="capitalize">{roleParam}</span>
                </span>
              )}
            </div>
        </div>

        <div className="min-w-0 px-5 py-4 sm:px-6">
          {renderBlockedAccountCard()}

          {isLockedOut && (
            <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Lock className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800">Account temporarily locked</div>
                  <div className="mt-1 text-xs text-slate-600 leading-relaxed">
                    {lockoutMessage ?? 'Too many failed login attempts. Please wait before trying again.'}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="text-xs text-slate-500">Time remaining</div>
                    <div className="font-mono text-sm font-semibold text-amber-600 tabular-nums">
                      {formatRemaining(lockoutRemainingSeconds)}
                    </div>
                  </div>

                  <div className="mt-2 h-2 rounded-full bg-amber-200 overflow-hidden">
                    <div
                      className="h-full bg-amber-500 transition-all duration-500"
                      style={{
                        width:
                          lockoutTotalSeconds > 0
                            ? `${Math.max(0, Math.min(100, (lockoutRemainingSeconds / lockoutTotalSeconds) * 100))}%`
                            : '100%',
                      }}
                    />
                  </div>

                  <div className="mt-2 text-[11px] text-slate-400">
                    Tip: If you forgot your password, use “Forgot password?” below.
                  </div>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
              <span className="flex-1 min-w-0 break-words">{error}</span>
            </div>
          )}

          <div className={`min-w-0 space-y-3.5 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`}>
            {!loginSent ? (
              <>
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setLoginSent(false);
                      setLoginMethod('phone');
                    }}
                    disabled={isLockedOut}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 ${
                      loginMethod === 'phone'
                        ? 'bg-[#02665e] text-white shadow-sm'
                        : 'bg-transparent text-slate-600 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    <Phone className="h-3.5 w-3.5" />
                    Phone
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setLoginSent(false);
                      setLoginMethod('credentials');
                    }}
                    disabled={isLockedOut}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 ${
                      loginMethod === 'credentials'
                        ? 'bg-[#02665e] text-white shadow-sm'
                        : 'bg-transparent text-slate-600 hover:bg-white hover:text-slate-900'
                    }`}
                  >
                    <Mail className="h-3.5 w-3.5" />
                    Email
                  </button>
                </div>

                {loginMethod === 'phone' ? (
                  <>
                    <div className="min-w-0 space-y-2">
                      <label className="block text-xs font-semibold text-slate-700">Phone number</label>
                      <div className="flex items-center gap-2 min-w-0">
                        <CountryCodePicker value={loginCountryCode} onChange={setLoginCountryCode} />
                        <input
                          type="tel"
                          value={loginPhone}
                          onChange={(e) => setLoginPhone(sanitizePhoneInput(e.target.value, loginCountryCode))}
                          placeholder={getPhonePlaceholder(loginCountryCode)}
                          maxLength={getPhoneMaxLength(loginCountryCode)}
                          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                        />
                      </div>
                      <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <span className="w-1 h-1 bg-[#02665e] rounded-full flex-shrink-0" />
                        <span>We&apos;ll send you a verification code</span>
                      </p>
                      {loginPhone.length > 0 && !isPhoneLengthValid(loginPhone, loginCountryCode) ? (
                        <p className="text-[11px] text-amber-600 font-medium">{getPhoneLengthHint(loginCountryCode)}</p>
                      ) : null}
                    </div>

                    <button
                      onClick={async () => {
                        setLoginLoading(true);
                        try {
                          if (!isPhoneLengthValid(loginPhone, loginCountryCode)) {
                            setError(getPhoneLengthHint(loginCountryCode));
                            return;
                          }

                          const response = await api.post('/api/auth/send-otp', {
                            phone: normalizeLoginPhone(loginPhone, loginCountryCode),
                          });
                          if (response.status === 200) {
                            setSuccess('OTP sent to your phone. Please check and enter the code.');
                            setLoginSent(true);
                          }
                        } catch (err: any) {
                          setError(err?.response?.data?.message || err?.response?.data?.error || 'Failed to send OTP. Please try again.');
                        } finally {
                          setLoginLoading(false);
                        }
                      }}
                      disabled={loginLoading || !isPhoneLengthValid(loginPhone, loginCountryCode)}
                      className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {loginLoading ? 'Sending...' : 'Send OTP'}
                    </button>
                  </>
                ) : (
                  <>
                    <div className="space-y-3 min-w-0">
                      <div className="space-y-2 min-w-0">
                        <label className="block text-xs font-semibold text-slate-700">Email address</label>
                        <input
                          type="email"
                          value={loginIdentifier}
                          onChange={(e) => setLoginIdentifier(e.target.value)}
                          placeholder="you@example.com"
                          disabled={isLockedOut}
                          className="w-full max-w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                        />
                      </div>
                      <div className="space-y-2 min-w-0">
                        <label className="block text-xs font-semibold text-slate-700">Password</label>
                        <div className="relative">
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={loginPassword}
                            onChange={(e) => setLoginPassword(e.target.value)}
                            placeholder="••••••••"
                            disabled={isLockedOut}
                            className="w-full max-w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 pr-11 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={isLockedOut}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 rounded-md border-none bg-transparent p-1"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                          >
                            {showPassword ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={async () => {
                        if (isLockedOut) return;
                        setLoginLoading(true);
                        setError(null);
                        setBlockedAccount(null);
                        try {
                          const email = loginIdentifier.trim();
                          if (!email || !loginPassword) {
                            setError('Please enter your email and password');
                            return;
                          }

                          const r = await fetch('/api/auth/login-password', {
                            method: 'POST',
                            credentials: 'include',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ email, password: loginPassword }),
                          });
                          const data = await r.json().catch(() => ({}));
                          if (!r.ok) {
                            const lockedUntil = Number((data as any)?.lockedUntil);
                            const code = String((data as any)?.code || '');
                            if (r.status === 423 || code === 'ACCOUNT_LOCKED' || (Number.isFinite(lockedUntil) && lockedUntil > Date.now())) {
                              const until = Number.isFinite(lockedUntil) ? lockedUntil : Date.now() + 5 * 60 * 1000;
                              const remaining = Math.max(0, Math.ceil((until - Date.now()) / 1000));
                              setLockoutUntil(until);
                              setLockoutTotalSeconds(remaining);
                              setLockoutMessage(String((data as any)?.message || (data as any)?.error || 'Too many failed login attempts.'));
                              setError(null);
                              return;
                            }

                            if (r.status === 403 && code === 'ACCOUNT_SUSPENDED' && (data as any)?.blockedAccount) {
                              setBlockedAccount((data as any).blockedAccount);
                              setError(null);
                              return;
                            }

                            const errorCode = String((data as any)?.error || '');
                            const errorMsg = String((data as any)?.message || '');

                            // DB / service unavailable
                            if (r.status === 503 || errorCode === 'database_unavailable' || (data as any)?.code === 'DATABASE_UNAVAILABLE') {
                              setError('Service temporarily unavailable. Please try again in a moment.');
                              return;
                            }

                            const remainingAttempts = (data as any)?.remainingAttempts;
                            if (r.status === 401 && typeof remainingAttempts === 'number') {
                              const attemptsText = remainingAttempts > 0
                                ? ` ${remainingAttempts} attempt${remainingAttempts !== 1 ? 's' : ''} remaining before temporary lock.`
                                : '';
                              setError(`Incorrect email or password.${attemptsText}`);
                              return;
                            }

                            // Always prefer human message over error code
                            const msg = errorMsg || (errorCode.includes(' ') ? errorCode : null) || `Login failed. Please try again.`;
                            setError(msg);
                            return;
                          }
                          setLockoutUntil(null);
                          setLockoutTotalSeconds(0);
                          setLockoutMessage(null);
                          saveAuthToken(data.token);
                          await redirectAfterAuth();
                        } catch (e: any) {
                          setError(e?.message || 'Failed to sign in');
                        } finally {
                          setLoginLoading(false);
                        }
                      }}
                      disabled={loginLoading || isLockedOut}
                      className="flex min-h-11 w-full items-center justify-center rounded-xl bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      {isLockedOut ? `Locked (${formatRemaining(lockoutRemainingSeconds)})` : loginLoading ? 'Signing in...' : 'Sign In'}
                    </button>
                  </>
                )}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setAuthMode('forgot')}
                    className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-xs font-semibold text-[#02665e] outline-none hover:underline"
                  >
                    <Lock className="h-3.5 w-3.5 flex-shrink-0" />
                    <span>Forgot password?</span>
                  </button>
                </div>

                <div className="relative flex items-center gap-3 py-0.5">
                  <div className="h-px flex-1 bg-slate-200" />
                  <span className="text-[11px] font-medium text-slate-400">or</span>
                  <div className="h-px flex-1 bg-slate-200" />
                </div>

                <div>
                  <button
                    type="button"
                    onClick={handlePasskeySignIn}
                    disabled={passkeyLoading || isLockedOut}
                    className="group flex min-h-[62px] w-full items-center gap-3 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left outline-none transition-[border-color,background-color,box-shadow,transform] hover:border-emerald-300 hover:bg-emerald-50/20 hover:shadow-sm focus-visible:border-[#02776c] focus-visible:ring-2 focus-visible:ring-[#02776c]/15 active:scale-[0.995] disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Sign in with a passkey"
                  >
                    {passkeyLoading ? (
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-emerald-100 bg-emerald-50/70 text-[#02665e]">
                        <LogoSpinner size="xs" ariaLabel="Authenticating" />
                      </span>
                    ) : (
                      <span className="grid h-9 w-9 flex-none place-items-center rounded-full border border-emerald-100 bg-emerald-50/70 text-[#02776c] transition-colors group-hover:bg-emerald-50 group-hover:text-[#014e47]">
                        <Fingerprint className="h-5 w-5" strokeWidth={1.8} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold leading-5 text-slate-900">
                        {passkeyLoading ? 'Authenticating...' : 'Sign in with passkey'}
                      </span>
                      <span className="block truncate text-[11px] leading-4 text-slate-500">
                        Face, fingerprint or screen lock
                      </span>
                    </span>
                    <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-slate-50 text-slate-400 transition-colors group-hover:bg-white group-hover:text-[#02665e]">
                      <ChevronDown className="h-3 w-3 -rotate-90" strokeWidth={2} />
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2 min-w-0">
                  <label className="block text-sm font-semibold text-slate-700">Enter OTP</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={loginOtp}
                    onChange={(e) => setLoginOtp(e.target.value.replace(/[^0-9]/g, ''))}
                    placeholder="123456"
                    maxLength={6}
                    className="w-full max-w-full px-4 py-3 text-lg tracking-widest text-center font-mono bg-white text-slate-900 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] box-border placeholder:text-slate-300"
                  />
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setLoginSent(false)}
                    className="flex-1 min-w-0 px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors box-border"
                  >
                    Edit phone
                  </button>
                    <button
                      onClick={async () => {
                        setLoginLoading(true);
                        setBlockedAccount(null);
                        // Verify login OTP with API
                        try {
                          const response = await api.post('/api/auth/verify-otp', {
                            phone: normalizeLoginPhone(loginPhone, loginCountryCode),
                            otp: loginOtp.trim(),
                          });
                          
                          if (response.status === 200) {
                            saveAuthToken(response.data?.token);
                            // Auth cookie is set httpOnly by the API; redirect to authenticated area.
                            await redirectAfterAuth();
                          }
                        } catch (err: any) {
                          const data = err?.response?.data;
                          if (err?.response?.status === 403 && data?.code === 'ACCOUNT_SUSPENDED' && data?.blockedAccount) {
                            setBlockedAccount(data.blockedAccount);
                            setError(null);
                          } else {
                            setError(data?.error || 'Invalid OTP. Please try again.');
                          }
                      } finally {
                        setLoginLoading(false);
                      }
                      }}
                      disabled={loginLoading || !loginOtp}
                      className="flex-1 min-w-0 px-4 py-2.5 bg-[#02665e] text-white text-sm font-medium rounded-lg hover:bg-[#014e47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed box-border"
                    >
                      {loginLoading ? 'Verifying...' : 'Verify & Sign in'}
                    </button>
                </div>
              </>
            )}
          </div>
        </div>

      </div>
    );
  };

  const renderModeToggleFooter = () => {
    if (authMode === 'register') {
      if (step !== 'phone') return null;
      return (
        <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4">
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-slate-700">
            <span className="font-medium text-slate-600">Already have an account?</span>
            <button
              type="button"
              onClick={() => setAuthMode('login')}
              className="inline-flex items-center gap-1 rounded-lg border border-[#02665e]/20 bg-[#02665e]/5 px-3 py-1.5 font-semibold text-[#02665e] shadow-sm transition-colors hover:bg-[#02665e]/10"
            >
              <span>Sign in</span>
              <LogIn className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      );
    }

    if (authMode === 'login') {
      return (
        <div className="shrink-0 border-t border-slate-100 bg-slate-50/70 px-5 py-3.5 sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-slate-600">
            <span>New to NoLSAF?</span>
            <button
              type="button"
              onClick={() => setAuthMode('register')}
              className="inline-flex items-center gap-1 border-0 bg-transparent p-0 font-bold text-[#02665e] outline-none hover:underline"
            >
              <span>Create an account</span>
              <UserPlus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      );
    }

    return null;
  };

  // Email validation helper
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isValidEmail = (email: string) => {
    return email.trim().length > 0 && email.includes('@') && emailRe.test(email.trim());
  };

  // Forgot Password Helper Functions
  const sendForgotOtp = async () => {
    setError(null);
    if (!isPhoneLengthValid(forgotPhone, forgotCountryCode)) {
      setError(getPhoneLengthHint(forgotCountryCode));
      return;
    }
    setForgotLoading(true);
    try {
      // Send OTP code (not reset link) for phone-based password reset
      const resp = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `${forgotCountryCode}${forgotPhone}`, role: 'RESET' }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'Failed to send OTP');
      }
      setSuccess('OTP sent to your phone. Please check and enter the code.');
      setForgotStep('otp');
      setForgotCountdown(60);
      const iv = setInterval(() => {
        setForgotCountdown(c => {
          if (c <= 1) {
            clearInterval(iv);
            return 0;
          }
          return c - 1;
        });
      }, 1000);
      setTimeout(() => {
        if (forgotOtpRef.current) {
          try { forgotOtpRef.current.focus(); } catch (e) {}
        }
      }, 200);
    } catch (err: any) {
      setError(err?.message || 'Failed to send OTP');
    } finally {
      setForgotLoading(false);
    }
  };

  const verifyForgotOtp = async () => {
    setError(null);
    if (!forgotOtp || forgotOtp.trim().length < 3) {
      setError('Enter the OTP you received');
      return;
    }
    setForgotLoading(true);
    try {

      const resp = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: `${forgotCountryCode}${forgotPhone}`, otp: forgotOtp, role: 'RESET' }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'Invalid OTP');
      }
      const data = await resp.json();
      // The API returns a link with both token and id, or we can extract from the response
      if (data.link) {
        setForgotResetToken(data.resetToken || '');
        setForgotStep('sent');
        // Use the link from API which includes both token and id
        router.push(data.link);
      } else if (data.resetToken && data.user && data.user.id) {
        // Fallback: construct the link ourselves if API doesn't provide it
        router.push(`/account/reset-password?token=${data.resetToken}&id=${data.user.id}&method=otp`);
      } else {
        throw new Error('Failed to get reset token');
      }
    } catch (err: any) {
      setError(err?.message || 'Invalid OTP');
    } finally {
      setForgotLoading(false);
    }
  };

  const sendForgotEmail = async () => {
    setError(null);
    if (!isValidEmail(forgotEmail)) {
      setError('Please enter a valid email address');
      return;
    }
    setForgotLoading(true);
    try {
      const resp = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail }),
      });
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data?.message || 'Failed to send reset email');
      }
      const data = await resp.json().catch(() => ({}));
      const msg = data?.message || 'If an account exists, an email has been sent.';
      setForgotSent(true);
      setForgotStep('sent');
      setSuccess(msg);
    } catch (err: any) {
      setError(err?.message || 'Failed to send reset email');
    } finally {
      setForgotLoading(false);
    }
  };

  // Forgot Password Page
  const renderForgotPasswordPage = () => {
    return (
      <div className="w-full flex flex-col bg-white relative box-border">
        <div className="sticky top-0 z-10 bg-[#02665e] shadow-md">
          <div className="px-6 py-4">
            <div className="flex items-center gap-4">
              <button
                onClick={() => {
                  setAuthMode('login');
                  setForgotStep('input');
                  setForgotMethod('email');
                  setForgotEmail('');
                  setForgotPhone('');
                  setForgotOtp('');
                  setForgotSent(false);
                }}
                className="w-10 h-10 rounded-xl bg-white/15 flex items-center justify-center hover:bg-white/25 transition-colors flex-shrink-0"
              >
                <ArrowLeft className="w-5 h-5 text-white" />
              </button>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-white">Reset Password</h1>
                <p className="text-xs text-white/70 mt-0.5">
                  {forgotMethod === 'email' ? 'Enter your email to reset' : 'Enter your phone to reset'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 min-w-0">
          {error && (
            <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-500" />
              <span className="flex-1 min-w-0 break-words">{error}</span>
            </div>
          )}

          {success && !error && (
            <div className="mb-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-2.5 text-sm text-emerald-700">
              <Check className="w-4 h-4 mt-0.5 flex-shrink-0 text-emerald-500" />
              <span className="flex-1 min-w-0 break-words">{success}</span>
            </div>
          )}

          {/* Method Selection */}
          {forgotStep === 'input' && !forgotSent && (
            <div className="mb-4 flex gap-1.5 p-1.5 bg-slate-100 ring-1 ring-slate-200 rounded-xl">
              <button
                type="button"
                onClick={() => setForgotMethod('email')}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 ${
                  forgotMethod === 'email'
                    ? 'bg-[#02665e] text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                }`}
              >
                <Mail className="w-3.5 h-3.5 inline-block mr-1.5" />
                Email
              </button>
              <button
                type="button"
                onClick={() => setForgotMethod('otp')}
                className={`flex-1 px-3 py-2 text-xs font-semibold rounded-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]/20 ${
                  forgotMethod === 'otp'
                    ? 'bg-[#02665e] text-white shadow-sm'
                    : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
                }`}
              >
                <Phone className="w-3.5 h-3.5 inline-block mr-1.5" />
                OTP
              </button>
            </div>
          )}

          {forgotStep === 'sent' && forgotMethod === 'email' ? (
            <div className="space-y-3 min-w-0">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center min-w-0">
                <Mail className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                <h3 className="text-sm font-semibold text-emerald-800 mb-1">Check your email</h3>
                <p className="text-xs text-emerald-700 break-words">
                  A reset link has been sent to <span className="font-semibold">{forgotEmail}</span>.
                </p>
              </div>
              <button
                onClick={() => {
                  setForgotSent(false);
                  setForgotEmail('');
                  setForgotStep('input');
                }}
                className="w-full max-w-full px-4 py-2.5 bg-[#02665e] text-white text-sm font-medium rounded-lg hover:bg-[#014e47] transition-colors box-border"
              >
                Resend Email
              </button>
            </div>
          ) : forgotStep === 'otp' ? (
            <div className="space-y-3 min-w-0">
              <div className="space-y-2 min-w-0">
                <label className="block text-sm font-semibold text-slate-700">Enter OTP</label>
                <input
                  ref={forgotOtpRef}
                  type="text"
                  inputMode="numeric"
                  value={forgotOtp}
                  onChange={(e) => setForgotOtp(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="123456"
                  maxLength={6}
                  className="w-full max-w-full px-4 py-3 text-lg tracking-widest text-center font-mono bg-white text-slate-900 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] box-border placeholder:text-slate-300"
                />
                <p className="text-xs text-slate-500 text-center">
                  Code sent to <span className="font-semibold text-slate-700">{forgotCountryCode}{forgotPhone}</span>
                </p>
              </div>
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => {
                    setForgotStep('input');
                    setForgotOtp('');
                  }}
                  className="flex-1 min-w-0 px-3 py-2 text-sm font-semibold text-slate-700 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors box-border"
                >
                  Edit phone
                </button>
                <button
                  onClick={verifyForgotOtp}
                  disabled={forgotLoading || !forgotOtp || forgotOtp.length < 6}
                  className="flex-1 min-w-0 px-4 py-2.5 bg-[#02665e] text-white text-sm font-medium rounded-lg hover:bg-[#014e47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed box-border"
                >
                  {forgotLoading ? 'Verifying...' : 'Verify OTP'}
                </button>
              </div>
              {forgotCountdown > 0 && (
                <button
                  type="button"
                  disabled={true}
                  className="w-full text-xs text-slate-400 py-1"
                >
                  Resend OTP in {forgotCountdown}s
                </button>
              )}
              {forgotCountdown === 0 && forgotStep === 'otp' && (
                <button
                  type="button"
                  onClick={sendForgotOtp}
                  className="w-full text-xs font-semibold text-[#02665e] hover:underline py-1"
                >
                  Resend OTP
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-3 min-w-0">
              {forgotMethod === 'email' ? (
                <>
                  <div className="space-y-2 min-w-0">
                    <label className="block text-sm font-semibold text-slate-700">Email Address</label>
                    <input
                      type="email"
                      value={forgotEmail}
                      onChange={(e) => {
                        setForgotEmail(e.target.value);
                        setError(null); // Clear error on input change
                      }}
                      placeholder="your@email.com"
                        className={`w-full max-w-full px-4 py-2.5 text-sm bg-white text-slate-900 border-2 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 box-border transition-all shadow-sm placeholder:text-slate-400 ${
                        forgotEmail && !isValidEmail(forgotEmail)
                            ? 'border-red-300 focus:border-red-500'
                            : 'border-slate-200 focus:border-[#02665e] hover:border-slate-300'
                      }`}
                    />
                    {forgotEmail && !isValidEmail(forgotEmail) && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        Please enter a valid email address
                      </p>
                    )}
                  </div>
                  <button
                    onClick={sendForgotEmail}
                    disabled={forgotLoading || !isValidEmail(forgotEmail)}
                    className={`w-full max-w-full px-4 py-2.5 text-white text-sm font-medium rounded-lg transition-colors box-border ${
                      forgotLoading || !isValidEmail(forgotEmail)
                        ? 'bg-slate-300 cursor-not-allowed opacity-60'
                        : 'bg-[#02665e] hover:bg-[#014e47]'
                    }`}
                  >
                    {forgotLoading ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </>
              ) : (
                <>
                  <div className="space-y-2.5 min-w-0">
                    <label className="block text-sm font-semibold text-slate-700">Phone Number</label>
                    <div className="flex items-center gap-2 min-w-0">
                      <CountryCodePicker value={forgotCountryCode} onChange={setForgotCountryCode} />
                      <input
                        type="tel"
                        value={forgotPhone}
                        onChange={(e) => setForgotPhone(sanitizePhoneInput(e.target.value, forgotCountryCode))}
                        placeholder={getPhonePlaceholder(forgotCountryCode)}
                        maxLength={getPhoneMaxLength(forgotCountryCode)}
                        className="flex-1 min-w-0 px-4 py-2.5 text-sm bg-white text-slate-900 border-2 border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] shadow-sm hover:border-slate-300 placeholder:text-slate-400 box-border"
                      />
                    </div>
                    {forgotPhone.length > 0 && !isPhoneLengthValid(forgotPhone, forgotCountryCode) ? (
                      <p className="text-[11px] text-amber-600 font-medium">{getPhoneLengthHint(forgotCountryCode)}</p>
                    ) : null}
                  </div>
                  <button
                    onClick={sendForgotOtp}
                    disabled={forgotLoading || !isPhoneLengthValid(forgotPhone, forgotCountryCode)}
                    className="w-full max-w-full px-4 py-2.5 bg-[#02665e] text-white text-sm font-medium rounded-lg hover:bg-[#014e47] transition-colors disabled:opacity-50 disabled:cursor-not-allowed box-border"
                  >
                    {forgotLoading ? 'Sending...' : 'Send OTP'}
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setForgotStep('input');
                  setForgotMethod('email');
                  setForgotEmail('');
                  setForgotPhone('');
                  setForgotOtp('');
                  setForgotSent(false);
                }}
                className="w-full max-w-full text-sm font-semibold text-slate-500 hover:text-slate-700 py-2.5 flex items-center justify-center gap-2 transition-colors box-border"
              >
                <ArrowLeft className="w-4 h-4 flex-shrink-0" />
                <span>Back to Sign In</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

    return (
    <main
      className="relative flex min-h-screen items-center justify-center overflow-hidden px-3 py-4 sm:px-4 sm:py-8"
      style={{ background: 'radial-gradient(ellipse at 50% 40%, #038a80 0%, #02665e 50%, #014e47 100%)' }}
    >
      <style>{`
        #nolsaf-auth-card,
        #nolsaf-auth-card * {
          box-sizing: border-box;
        }
      `}</style>
      {/* ── Compass rose — large ornamental mandala behind card ── */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
        <svg
          viewBox="0 0 520 520"
          fill="none"
          className="w-[min(90vw,640px)] h-[min(90vw,640px)] opacity-[0.22]"
          style={{ color: '#fff' }}
        >
          {/* concentric rings */}
          <circle cx="260" cy="260" r="250" stroke="currentColor" strokeWidth="0.6" strokeDasharray="10 6"/>
          <circle cx="260" cy="260" r="218" stroke="currentColor" strokeWidth="1"/>
          <circle cx="260" cy="260" r="185" stroke="currentColor" strokeWidth="0.4" strokeDasharray="4 9"/>
          <circle cx="260" cy="260" r="150" stroke="currentColor" strokeWidth="0.8"/>
          <circle cx="260" cy="260" r="115" stroke="currentColor" strokeWidth="0.4" strokeDasharray="3 8"/>
          <circle cx="260" cy="260" r="82"  stroke="currentColor" strokeWidth="0.7"/>
          <circle cx="260" cy="260" r="50"  stroke="currentColor" strokeWidth="0.4" strokeDasharray="2 6"/>
          <circle cx="260" cy="260" r="22"  stroke="currentColor" strokeWidth="0.8"/>
          {/* 16 radial tick lines */}
          {Array.from({ length: 16 }).map((_, i) => {
            const angle = (i * 22.5 * Math.PI) / 180;
            const x1 = 260 + 50 * Math.cos(angle);
            const y1 = 260 + 50 * Math.sin(angle);
            const x2 = 260 + 218 * Math.cos(angle);
            const y2 = 260 + 218 * Math.sin(angle);
            return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth={i % 4 === 0 ? 0.9 : 0.3}/>;
          })}
          {/* rounded N petal */}
          <path d="M260 240 C248 200 248 60 260 20 C272 60 272 200 260 240Z" fill="currentColor" fillOpacity="0.55"/>
          {/* rounded S petal */}
          <path d="M260 280 C248 320 248 460 260 500 C272 460 272 320 260 280Z" fill="currentColor" fillOpacity="0.28"/>
          {/* rounded E petal */}
          <path d="M280 260 C320 248 460 248 500 260 C460 272 320 272 280 260Z" fill="currentColor" fillOpacity="0.28"/>
          {/* rounded W petal */}
          <path d="M240 260 C200 248 60 248 20 260 C60 272 200 272 240 260Z" fill="currentColor" fillOpacity="0.28"/>
          {/* diagonal minor petals */}
          <path d="M260 240 C270 235 320 205 338 188 C321 206 291 256 280 260Z" fill="currentColor" fillOpacity="0.15"/>
          <path d="M260 240 C250 235 200 205 182 188 C199 206 229 256 240 260Z" fill="currentColor" fillOpacity="0.15"/>
          <path d="M260 280 C270 285 320 315 338 332 C321 314 291 264 280 260Z" fill="currentColor" fillOpacity="0.15"/>
          <path d="M260 280 C250 285 200 315 182 332 C199 314 229 264 240 260Z" fill="currentColor" fillOpacity="0.15"/>
          {/* center circle */}
          <circle cx="260" cy="260" r="8" fill="currentColor" fillOpacity="0.6"/>
          <circle cx="260" cy="260" r="4" fill="currentColor" fillOpacity="0.9"/>
        </svg>
      </div>

      {/* ── Corner arc ornaments ── */}
      <svg className="pointer-events-none absolute top-0 left-0 w-64 h-64 opacity-[0.08]" viewBox="0 0 256 256" fill="none" aria-hidden="true">
        <path d="M0 200 Q0 0 200 0" stroke="white" strokeWidth="1" strokeDasharray="6 6"/>
        <path d="M0 140 Q0 0 140 0" stroke="white" strokeWidth="0.7" strokeDasharray="4 8"/>
        <path d="M0 80  Q0 0 80  0" stroke="white" strokeWidth="0.5" strokeDasharray="3 10"/>
      </svg>
      <svg className="pointer-events-none absolute bottom-0 right-0 w-64 h-64 opacity-[0.08]" viewBox="0 0 256 256" fill="none" aria-hidden="true">
        <path d="M256 56 Q256 256 56 256" stroke="white" strokeWidth="1" strokeDasharray="6 6"/>
        <path d="M256 116 Q256 256 116 256" stroke="white" strokeWidth="0.7" strokeDasharray="4 8"/>
        <path d="M256 176 Q256 256 176 256" stroke="white" strokeWidth="0.5" strokeDasharray="3 10"/>
      </svg>
      <svg className="pointer-events-none absolute top-0 right-0 w-48 h-48 opacity-[0.05]" viewBox="0 0 192 192" fill="none" aria-hidden="true">
        <path d="M192 160 Q192 0 32 0" stroke="white" strokeWidth="1" strokeDasharray="5 7"/>
        <path d="M192 100 Q192 0 92 0" stroke="white" strokeWidth="0.6" strokeDasharray="3 9"/>
      </svg>
      <svg className="pointer-events-none absolute bottom-0 left-0 w-48 h-48 opacity-[0.05]" viewBox="0 0 192 192" fill="none" aria-hidden="true">
        <path d="M0 32 Q0 192 160 192" stroke="white" strokeWidth="1" strokeDasharray="5 7"/>
        <path d="M0 92  Q0 192 100 192" stroke="white" strokeWidth="0.6" strokeDasharray="3 9"/>
      </svg>

      {/* ── Card ── */}
      <div id="nolsaf-auth-card" className="relative z-10 w-full max-w-[440px]">
        <div className="overflow-hidden rounded-[26px] bg-white shadow-[0_28px_80px_rgba(0,30,27,0.34)] ring-1 ring-white/40">
          <div className="flex flex-col bg-white">
            <div className="flex-1">
              {authMode === 'register'
                ? renderRegisterPage()
                : authMode === 'login'
                  ? renderLoginPage()
                  : renderForgotPasswordPage()}
            </div>
            {renderModeToggleFooter()}
          </div>
        </div>
      </div>
    </main>
  );
}
