"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { REGIONS } from "@/lib/tzRegions";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";
import DatePickerField from "@/components/DatePickerField";
import apiClient from "@/lib/apiClient";
import { validatePasswordAgainstPolicy } from "@/lib/passwordPolicy";
import { useServerPasswordPolicy } from "@/hooks/useServerPasswordPolicy";
import { readShareToken, clearShareToken } from "@/lib/propertyShareToken";
import * as Icons from 'lucide-react';
import { User, Mail, UserCircle, Globe, CreditCard, FileText, Upload, CheckCircle2, Truck, MapPin, Phone, ChevronDown, AlertCircle, ChevronLeft, ChevronRight, Loader2, Car, X, Clock, Building2, UserCircle2, ArrowLeft, Star, Shield, Lock, AlertTriangle, Calendar, Check } from 'lucide-react';

type CloudinarySig = {
  timestamp: number;
  signature: string;
  folder: string;
  cloudName: string;
  apiKey: string;
};

type DriverDocumentRecord = {
  id?: number;
  type: string;
  url?: string | null;
  status?: string | null;
  metadata?: Record<string, any> | null;
};

type DriverDocumentSpec = {
  type: string;
  label: string;
  required: boolean;
  requiresExpiry?: boolean;
};

const DRIVER_DOCUMENT_SPECS: readonly DriverDocumentSpec[] = [
  { type: 'DRIVER_LICENSE', label: 'Driving licence', required: true, requiresExpiry: true },
  { type: 'NATIONAL_ID', label: 'National ID', required: true },
  { type: 'VEHICLE_REGISTRATION', label: 'Vehicle registration (LATRA)', required: true },
  { type: 'INSURANCE', label: 'Insurance certificate', required: true },
];

const REQUIRED_DRIVER_DOCUMENT_TYPES = DRIVER_DOCUMENT_SPECS.filter((spec) => spec.required).map((spec) => spec.type);

function getLatestDriverDoc(docs: DriverDocumentRecord[], type: string): DriverDocumentRecord | null {
  const normalizedType = String(type).toUpperCase();
  for (const doc of docs) {
    if (String(doc?.type ?? '').toUpperCase() === normalizedType && doc?.url) return doc;
  }
  return null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function OnboardRole() {
  const routeParams = useParams<{ role?: string | string[] }>();
  const roleParam = Array.isArray(routeParams?.role) ? routeParams?.role?.[0] : routeParams?.role;
  const role = String(roleParam || '').toLowerCase();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const { policy: passwordPolicy, policyReady: passwordPolicyReady, policyStatus: passwordPolicyStatus, retryPolicy } = useServerPasswordPolicy();
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  
  // Get referral code from URL
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const referralCode = searchParams?.get('ref') || null;
  const rawNextPath = searchParams?.get('next') || null;
  const nextPath = rawNextPath && rawNextPath.startsWith('/') && !rawNextPath.startsWith('//')
    ? rawNextPath
    : null;
  // driver fields
  
  const [plateNumber, setPlateNumber] = useState('');
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  // new driver onboarding fields
  const [gender, setGender] = useState('');
  const [nationality, setNationality] = useState('Tanzanian');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nin, setNin] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [vehicleType, setVehicleType] = useState<string>(''); // single pick: Bajaji, Bodaboda, Vehicle
  const [isVipDriver, setIsVipDriver] = useState(false); // VIP vehicle declaration
  const [operationArea, setOperationArea] = useState(''); // ward
  const [driverRegion, setDriverRegion] = useState(''); // region name
  const [driverDistrict, setDriverDistrict] = useState(''); // district name
  const [paymentPhone, setPaymentPhone] = useState('');
  // OTP verification state for payment phone
  const [paymentOtp, setPaymentOtp] = useState('');
  const [paymentSent, setPaymentSent] = useState(false);
  const [paymentVerified, setPaymentVerified] = useState(false);
  const [paymentCountdown, setPaymentCountdown] = useState<number>(0);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentMessage, setPaymentMessage] = useState<string | null>(null);
  const [accountPhone, setAccountPhone] = useState<string>(''); // set from /api/account/me, used for auto-verify
  const [accountEmailLocked, setAccountEmailLocked] = useState(false);
  const [accountPhoneLocked, setAccountPhoneLocked] = useState(false);
  const [accountPhoneVerified, setAccountPhoneVerified] = useState(false);
  const [checkingAccountPhone, setCheckingAccountPhone] = useState(false);
  const [kycFieldApprovals, setKycFieldApprovals] = useState<Record<string, 'approved' | 'flagged'>>({});
  const [uploadedDriverDocs, setUploadedDriverDocs] = useState<DriverDocumentRecord[]>([]);
  const [docUploadState, setDocUploadState] = useState<{ type: string; label: string } | null>(null);

  const isApproved = (key: string) => kycFieldApprovals[key] === 'approved';
  const fieldBorderClass = (key: string, hasError: boolean) => {
    if (kycFieldApprovals[key] === 'approved') return 'border-emerald-300 bg-emerald-50/60 cursor-not-allowed';
    if (kycFieldApprovals[key] === 'flagged') return 'border-orange-400 focus:border-orange-500 focus:ring-2 focus:ring-orange-100';
    if (hasError) return 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-100';
    return 'border-slate-200 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10';
  };
  const FieldBadge = ({ fk }: { fk: string }) => {
    if (kycFieldApprovals[fk] === 'approved') return <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[10px] font-semibold"><Lock className="w-2.5 h-2.5" /> Locked</span>;
    if (kycFieldApprovals[fk] === 'flagged') return <span className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded text-[10px] font-semibold"><AlertTriangle className="w-2.5 h-2.5" /> Update required</span>;
    return null;
  };
  const [idFile, setIdFile] = useState<File | null>(null);
  const [latraFile, setLatraFile] = useState<File | null>(null);
  const [insuranceFile, setInsuranceFile] = useState<File | null>(null);
  const [licenseExpiresOn, setLicenseExpiresOn] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [stepIndex, setStepIndex] = useState<number>(1); // 1..5 for driver onboarding steps
  // owner fields removed: owner uses existing owner dashboard for property creation
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorReasons, setErrorReasons] = useState<string[] | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const router = useRouter();
  const requestedRole = role === 'driver' ? 'DRIVER' : role === 'owner' ? 'OWNER' : 'TRAVELLER';

  const normalizeAccountRole = (value: unknown) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'CUSTOMER' || normalized === 'USER' || normalized === 'TRAVELLER' || normalized === 'TRAVELER') return 'TRAVELLER';
    if (normalized === 'OWNER') return 'OWNER';
    if (normalized === 'DRIVER') return 'DRIVER';
    return normalized;
  };

  const getDefaultRouteForRole = (normalizedRole: string) => {
    if (normalizedRole === 'OWNER') return '/owner';
    if (normalizedRole === 'DRIVER') return '/driver';
    return '/account';
  };

  const computePasswordStrength = (pwd: string) => validatePasswordAgainstPolicy(pwd, passwordPolicy);
  const passwordValidation = computePasswordStrength(password);
  const passwordIsValid = passwordPolicyReady && passwordValidation.valid;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await apiClient.get('/api/account/me');
        const me = r.data?.data ?? r.data;
        if (!alive) return;

        const actualRole = normalizeAccountRole(me?.role);
        if (actualRole && requestedRole !== actualRole) {
          router.replace(getDefaultRouteForRole(actualRole));
          return;
        }

        const hasDisplayName = Boolean(String(me?.fullName ?? me?.name ?? '').trim());
        const hasEmail = Boolean(String(me?.email ?? '').trim());
        const hasPhone = Boolean(String(me?.phone ?? '').trim());
        if (requestedRole !== 'DRIVER' && hasDisplayName && hasEmail && hasPhone) {
          router.replace(requestedRole === 'TRAVELLER' && nextPath ? nextPath : getDefaultRouteForRole(requestedRole));
          return;
        }

        setCheckingAuth(false);
        setNeedsPasswordSetup(me?.hasPassword === false);
        if (me?.phone) {
          setAccountPhone(me.phone);
        }
        setAccountEmailLocked(Boolean(me?.email && me?.emailVerifiedAt));
        setAccountPhoneLocked(Boolean(me?.phone && me?.phoneVerifiedAt));
        setAccountPhoneVerified(Boolean(me?.phoneVerifiedAt));
        if (me?.kycFieldApprovals && typeof me.kycFieldApprovals === 'object') {
          setKycFieldApprovals(me.kycFieldApprovals as Record<string, 'approved' | 'flagged'>);
        }
        // Pre-fill all form fields with existing user data so locked fields show their values
        if (me?.name || me?.fullName)   setName(me.fullName ?? me.name ?? '');
        if (me?.email)                  setEmail(me.email);
        if (me?.dateOfBirth)            setDateOfBirth(String(me.dateOfBirth).split('T')[0]);
        if (me?.nin)                    setNin(me.nin);
        if (me?.licenseNumber)          setLicenseNumber(me.licenseNumber);
        if (me?.gender)                 setGender(me.gender);
        if (me?.nationality)            setNationality(me.nationality);
        if (me?.plateNumber)            setPlateNumber(me.plateNumber);
        if (me?.vehicleType)            setVehicleType(me.vehicleType);
        if (me?.operationArea)          setOperationArea(me.operationArea);
        if (me?.region)                 setDriverRegion(me.region);
        if (me?.district)               setDriverDistrict(me.district);
        if (me?.paymentPhone)           setPaymentPhone(me.paymentPhone);
        if (Array.isArray(me?.documents)) {
          const docs = me.documents as DriverDocumentRecord[];
          setUploadedDriverDocs(docs);
          const currentLicense = getLatestDriverDoc(docs, 'DRIVER_LICENSE');
          const licenseMeta = currentLicense?.metadata && typeof currentLicense.metadata === 'object' ? currentLicense.metadata : null;
          if (typeof licenseMeta?.expiresOn === 'string') setLicenseExpiresOn(licenseMeta.expiresOn);
        }
      } catch {
        // ignore
      } finally {
        if (alive) setCheckingAuth(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [requestedRole, router, nextPath]);

  const IdIcon: any = (props: any) => (
    <svg suppressHydrationWarning viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="M16 8v6" />
      <path d="M13 14h6" />
    </svg>
  );

  const title = role === 'driver' ? 'Welcome, Driver' : role === 'owner' ? 'Welcome, Property Owner' : 'Welcome, Traveller';
  // Normalise phone numbers so +255712345678 and 0712345678 compare equal
  const normalizePhone = (p: string) => p.replace(/[\s\-]/g, '').replace(/^0(\d{9})$/, '+255$1');

  // Auto-verify payment phone when it matches the account registration phone
  // (that phone was already OTP-verified at sign-up, so no second code is needed)
  useEffect(() => {
    if (!accountPhoneVerified || !accountPhone || !paymentPhone.trim()) return;
    if (normalizePhone(paymentPhone.trim()) === normalizePhone(accountPhone)) {
      setPaymentVerified(true);
      setPaymentSent(false);
      setPaymentMessage(null);
    }
    // Note: we do NOT reset to false here — resetting happens only in onChange
  }, [paymentPhone, accountPhone, accountPhoneVerified]);
  const help = role === 'driver'
    ? 'Please provide driver details, vehicle information, and verification documents.'
    : role === 'owner'
      ? 'Add your property details, rates, and availability to start receiving bookings.'
      : 'Update your profile and start searching for stays.';
  const nonDriverSteps = [
    { num: 1, label: 'Profile', detail: 'Personal details' },
    { num: 2, label: 'Review', detail: 'Confirm and finish' },
  ] as const;
  const nonDriverHighlights = role === 'owner'
    ? ['Professional property identity', 'Faster approval workflow', 'Secure account controls']
    : ['Trusted guest identity', 'Faster booking checkout', 'Secure account controls'];
  const nonDriverCompletion = Math.round((stepIndex / nonDriverSteps.length) * 100);

  const getSavedDriverDoc = (type: string) => getLatestDriverDoc(uploadedDriverDocs, type);
  const hasDriverDocument = (type: string, file: File | null) => Boolean(file || getSavedDriverDoc(type)?.url);
  const getDocumentDisplayName = (type: string, file: File | null) => {
    if (file?.name) return file.name;
    const saved = getSavedDriverDoc(type);
    const metadata = saved?.metadata && typeof saved.metadata === 'object' ? saved.metadata : null;
    const fileName = typeof metadata?.fileName === 'string' ? metadata.fileName : null;
    if (fileName) return fileName;
    if (saved?.url) {
      const parts = String(saved.url).split('/');
      return decodeURIComponent(parts[parts.length - 1] || 'Uploaded document');
    }
    return null;
  };

  const uploadToCloudinary = async (file: File, folder: string) => {
    const sigResp = await apiClient.get('/api/uploads/cloudinary/sign', { params: { folder } }).catch((err: any) => {
      const msg = err?.response?.data?.message || err?.response?.data?.error;
      throw new Error(msg || 'Failed to prepare secure document upload.');
    });
    const sig = sigResp.data as CloudinarySig;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('timestamp', String(sig.timestamp));
    fd.append('api_key', sig.apiKey);
    fd.append('signature', sig.signature);
    fd.append('folder', sig.folder);
    fd.append('overwrite', 'true');

    const uploadResp = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/auto/upload`, {
      method: 'POST',
      body: fd,
    });
    if (!uploadResp.ok) {
      throw new Error('Document upload failed while sending the file to secure storage.');
    }

    const uploadData: any = await uploadResp.json().catch(() => null);
    const secureUrl = String(uploadData?.secure_url ?? '').trim();
    if (!secureUrl) throw new Error('Document upload finished, but no secure file URL was returned.');
    return secureUrl;
  };

  const persistDriverDocument = async (type: string, file: File) => {
    const spec = DRIVER_DOCUMENT_SPECS.find((item) => item.type === type);
    const label = spec?.label ?? type;
    const requiresExpiry = type === 'DRIVER_LICENSE';
    if (requiresExpiry) {
      if (!licenseExpiresOn) {
        throw new Error('Enter the licence expiry date before uploading the driving licence.');
      }
      if (!Number.isFinite(new Date(`${licenseExpiresOn}T23:59:59.999Z`).getTime())) {
        throw new Error('Enter a valid licence expiry date.');
      }
      if (licenseExpiresOn < todayIso()) {
        throw new Error('Licence expiry date must be today or later.');
      }
    }
    setDocUploadState({ type, label });
    const url = await uploadToCloudinary(file, 'driver-documents');
    const expiresAtIso = requiresExpiry ? new Date(`${licenseExpiresOn}T23:59:59.999Z`).toISOString() : null;
    const resp = await apiClient.put('/api/account/documents', {
      type,
      url,
      metadata: {
        fileName: file.name,
        contentType: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString(),
        source: 'driver-onboarding',
        ...(expiresAtIso ? { expiresAt: expiresAtIso, expiresOn: licenseExpiresOn } : null),
      },
    }).catch((err: any) => {
      const msg = err?.response?.data?.message || err?.response?.data?.error;
      throw new Error(msg || `Failed to save the ${label.toLowerCase()} record.`);
    });
    const data: any = resp.data;
    const saved = data?.data?.doc ?? data?.doc ?? null;
    if (saved) {
      setUploadedDriverDocs((prev) => [saved, ...prev.filter((doc) => String(doc?.type ?? '').toUpperCase() !== String(type).toUpperCase())]);
    }
  };

  const uploadSelectedDriverDocuments = async () => {
    const uploads = [
      { type: 'DRIVER_LICENSE', file: licenseFile, clear: () => setLicenseFile(null) },
      { type: 'NATIONAL_ID', file: idFile, clear: () => setIdFile(null) },
      { type: 'VEHICLE_REGISTRATION', file: latraFile, clear: () => setLatraFile(null) },
      { type: 'INSURANCE', file: insuranceFile, clear: () => setInsuranceFile(null) },
    ] as const;

    for (const upload of uploads) {
      if (!upload.file) continue;
      await persistDriverDocument(upload.type, upload.file);
      upload.clear();
    }
  };

  const submitProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setErrorReasons(null);
    setSuccess(null);
    // Every completed profile must carry both contact identifiers. Accounts
    // created by email add their phone here; phone-created accounts are prefilled.
    if (!name || !email || !accountPhone.trim()) {
      setError('Please provide your name, email, and phone number');
      return;
    }
    // First-time onboarding: require setting a password before redirecting.
    if (needsPasswordSetup) {
      if (!passwordPolicyReady) {
        setError('Password requirements are unavailable. Reload them before continuing.');
        return;
      }
      if (!password.trim()) {
        setError('Please set a password');
        return;
      }
      if (!passwordIsValid) {
        setError('Your password does not meet all requirements.');
        setErrorReasons(passwordValidation.reasons);
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
    }
    // Additional driver required fields validation
    if (role === 'driver') {
      if (!dateOfBirth.trim() || !licenseNumber.trim() || !vehicleType.trim() || !plateNumber.trim() || !driverRegion.trim() || !driverDistrict.trim() || !operationArea.trim() || !paymentPhone.trim()) {
        setError('Complete every required driver detail before submitting for review.');
        return;
      }
      if (!paymentVerified) {
        setError('Verify the payment phone before submitting for review.');
        return;
      }
      const missingRequiredDocs = REQUIRED_DRIVER_DOCUMENT_TYPES.filter((type) => !hasDriverDocument(type, type === 'DRIVER_LICENSE' ? licenseFile : type === 'NATIONAL_ID' ? idFile : type === 'VEHICLE_REGISTRATION' ? latraFile : insuranceFile));
      if (missingRequiredDocs.length > 0) {
        setError('Upload every required verification document before submitting for review.');
        return;
      }
    }
    setLoading(true);
    try {
      if (role === 'driver') {
        await uploadSelectedDriverDocuments();
      }

      // Build FormData to include files and all driver fields
      const fd = new FormData();
      fd.append('role', role);
      fd.append('name', name);
      fd.append('email', email);
      fd.append('phone', accountPhone);
      fd.append('registrationSource', 'WEB');
      if (needsPasswordSetup && password.trim()) fd.append('password', password);
      if (referralCode) {
        fd.append('referralCode', referralCode);
      }
      // A shared property listing is tracked separately from a referral invite,
      // so both can travel with the same signup without competing.
      const shareToken = readShareToken();
      if (shareToken) {
        fd.append('shareToken', shareToken);
      }
      if (role === 'driver') {
      fd.append('gender', gender || '');
      fd.append('nationality', nationality || '');
      fd.append('dateOfBirth', dateOfBirth || '');
      fd.append('nin', nin || '');
      fd.append('licenseNumber', licenseNumber || '');
      fd.append('plateNumber', plateNumber || '');
      fd.append('vehicleType', vehicleType || '');
      fd.append('region', driverRegion || '');
      fd.append('district', driverDistrict || '');
      fd.append('operationArea', operationArea || '');
      fd.append('paymentPhone', paymentPhone || '');
      fd.append('paymentVerified', paymentVerified ? '1' : '0');
      fd.append('isVipDriver', isVipDriver ? 'true' : 'false');
      // Explicit submit-for-review flag — only set on final step submission
      fd.append('submitForReview', 'true');
      }

      const saveResponse = await apiClient.post('/api/auth/profile', fd);

      // Never leave onboarding based only on a 2xx response. Older API
      // processes accepted the form while silently ignoring the new phone
      // field, which caused /account to redirect straight back here.
      let persistedPhone = String(saveResponse.data?.user?.phone || '').trim();
      let persistedEmail = String(saveResponse.data?.user?.email || '').trim().toLowerCase();
      let persistedRegistrationStatus = String(saveResponse.data?.user?.registrationStatus || '').toUpperCase();
      if (
        !persistedPhone ||
        normalizePhone(persistedPhone) !== normalizePhone(accountPhone.trim()) ||
        !persistedEmail ||
        persistedEmail !== email.trim().toLowerCase()
      ) {
        try {
          const meResponse = await apiClient.get('/api/account/me');
          const savedAccount = meResponse.data?.data ?? meResponse.data;
          persistedPhone = String(savedAccount?.phone || '').trim();
          persistedEmail = String(savedAccount?.email || '').trim().toLowerCase();
          persistedRegistrationStatus = String(savedAccount?.registrationStatus || '').toUpperCase();
        } catch {
          persistedPhone = '';
          persistedEmail = '';
          persistedRegistrationStatus = '';
        }
      }

      if (!persistedPhone || normalizePhone(persistedPhone) !== normalizePhone(accountPhone.trim())) {
        const message = 'Your phone number was not saved. Please remain on this page and try again.';
        setStepIndex(1);
        setTouched(prev => ({ ...prev, accountPhone: true }));
        setFieldErrors(prev => ({ ...prev, accountPhone: message }));
        setError(message);
        window.setTimeout(() => accountPhoneRef.current?.focus(), 80);
        return;
      }
      if (!persistedEmail || persistedEmail !== email.trim().toLowerCase()) {
        const message = 'Your email address was not saved. Please remain on this page and try again.';
        setStepIndex(1);
        setTouched(prev => ({ ...prev, email: true }));
        setFieldErrors(prev => ({ ...prev, email: message }));
        setError(message);
        window.setTimeout(() => emailRef.current?.focus(), 80);
        return;
      }
      if (persistedRegistrationStatus !== 'COMPLETE') {
        setError('Your registration is not complete yet. Confirm your full name, email, and phone, then try again.');
        setStepIndex(1);
        return;
      }

      // The token has now been handed to the server. Clearing it stops a later
      // signup on the same browser from being credited to the same share.
      clearShareToken();

      setSuccess(role === 'driver' ? 'Application submitted for professional review.' : 'Profile saved');
      // navigate to role dashboard or public account area
      setTimeout(() => {
        if (role === 'driver') router.push('/driver');
        else if (role === 'owner') router.push('/owner');
        else router.push(nextPath || '/account');
      }, 800);
    } catch (err: any) {
      const apiErr = (err as any)?.response?.data;
      if (apiErr?.error === 'weak_password') {
        const reasons = Array.isArray(apiErr?.reasons) ? apiErr.reasons.filter((x: any) => typeof x === 'string' && x.trim()) : [];
        setError('Your password is too weak. Please make it stronger and try again.');
        setErrorReasons(reasons.length ? reasons : null);
        return;
      }
      if (apiErr?.error === 'role_mismatch') {
        setError(apiErr?.message || `You're signed in with a different account role and can't complete onboarding for “${role}”. Please sign in with the correct role account.`);
        return;
      }
      if (apiErr?.error === 'phone_already_registered') {
        const message = apiErr?.message || 'This phone number already has an account. Please login or use forgot password to access it.';
        setStepIndex(1);
        setTouched(prev => ({ ...prev, accountPhone: true }));
        setFieldErrors(prev => ({ ...prev, accountPhone: message }));
        setError(message);
        window.setTimeout(() => accountPhoneRef.current?.focus(), 80);
        return;
      }
      if (apiErr?.error === 'email_already_registered') {
        const message = apiErr?.message || 'This email address already has an account. Please login or use forgot password to access it.';
        setStepIndex(1);
        setTouched(prev => ({ ...prev, email: true }));
        setFieldErrors(prev => ({ ...prev, email: message }));
        setError(message);
        window.setTimeout(() => emailRef.current?.focus(), 80);
        return;
      }
      if (apiErr?.error === 'email_change_requires_verification' || apiErr?.error === 'phone_change_requires_verification') {
        setStepIndex(1);
        setError(apiErr?.message || 'Verified contact details cannot be changed during onboarding.');
        return;
      }
      setError(apiErr?.message || apiErr?.error || err?.message || 'Failed to save profile');
    } finally {
      setDocUploadState(null);
      setLoading(false);
    }
  };

  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // small transition on step change
    setVisible(false);
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, [stepIndex]);

  // Basic per-step validation to gate advancing
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const isStepValid = () => {
    if (role !== 'driver') {
      if (stepIndex === 1) {
        const baseValid = name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5;
        if (needsPasswordSetup) return baseValid && passwordIsValid && confirmPassword === password;
        return baseValid;
      }
      if (stepIndex === 2) {
        const baseValid = name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5;
        if (needsPasswordSetup) return baseValid && passwordIsValid && confirmPassword === password;
        return baseValid;
      }
      return true;
    }
    switch (stepIndex) {
      case 1:
        if (needsPasswordSetup) {
          return name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5 && dateOfBirth.trim().length > 0 && passwordIsValid && confirmPassword === password;
        }
        return name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5 && dateOfBirth.trim().length > 0;
      case 2:
        return licenseNumber.trim().length > 0 && vehicleType.trim().length > 0 && plateNumber.trim().length > 0 && driverRegion.trim().length > 0 && driverDistrict.trim().length > 0 && operationArea.trim().length > 0;
      case 3:
        // require the payment phone to have been OTP-verified
        return paymentVerified === true;
      case 4:
        return REQUIRED_DRIVER_DOCUMENT_TYPES.every((type) => hasDriverDocument(type, type === 'DRIVER_LICENSE' ? licenseFile : type === 'NATIONAL_ID' ? idFile : type === 'VEHICLE_REGISTRATION' ? latraFile : insuranceFile));
      default:
        return true;
    }
  };

  const isDriverStepComplete = (step: number) => {
    if (role !== 'driver') return true;
    if (step === 1) {
      return needsPasswordSetup
        ? name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5 && dateOfBirth.trim().length > 0 && passwordIsValid && confirmPassword === password
        : name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5 && dateOfBirth.trim().length > 0;
    }
    if (step === 2) {
      return licenseNumber.trim().length > 0 && vehicleType.trim().length > 0 && plateNumber.trim().length > 0 && driverRegion.trim().length > 0 && driverDistrict.trim().length > 0 && operationArea.trim().length > 0;
    }
    if (step === 3) return paymentPhone.trim().length > 0 && paymentVerified === true;
    if (step === 4) {
      return REQUIRED_DRIVER_DOCUMENT_TYPES.every((type) => hasDriverDocument(type, type === 'DRIVER_LICENSE' ? licenseFile : type === 'NATIONAL_ID' ? idFile : type === 'VEHICLE_REGISTRATION' ? latraFile : insuranceFile));
    }
    if (step === 5) return agreedToTerms && agreedToPrivacy;
    return true;
  };

  const isDriverStepUnlocked = (step: number) => {
    if (role !== 'driver') return true;
    for (let idx = 1; idx < step; idx += 1) {
      if (!isDriverStepComplete(idx)) return false;
    }
    return true;
  };

  // Comprehensive validation for all required driver steps before submission
  const isAllDriverStepsValid = () => {
    if (role !== 'driver') return true;
    
    // Step 1: Personal Details
    const step1Valid = name.trim().length > 0 && emailRe.test(email.trim()) && accountPhone.trim().length >= 5 && dateOfBirth.trim().length > 0;
    
    // Step 2: Driving Details
    const step2Valid = licenseNumber.trim().length > 0 && 
                       vehicleType.trim().length > 0 && 
                       plateNumber.trim().length > 0 &&
                       driverRegion.trim().length > 0 &&
                       driverDistrict.trim().length > 0 &&
                       operationArea.trim().length > 0;
    
    // Step 3: Payment Details
    const step3Valid = paymentPhone.trim().length > 0 && paymentVerified === true;
    
    // Step 4: Uploads (all required documents must exist before review)
    const step4Valid = REQUIRED_DRIVER_DOCUMENT_TYPES.every((type) => hasDriverDocument(type, type === 'DRIVER_LICENSE' ? licenseFile : type === 'NATIONAL_ID' ? idFile : type === 'VEHICLE_REGISTRATION' ? latraFile : insuranceFile));
    // Step 5: Terms & privacy agreement
    const step5Valid = agreedToTerms && agreedToPrivacy;
    
    return step1Valid && step2Valid && step3Valid && step4Valid && step5Valid;
  };

  // Per-field touched/errors to show inline messages
  const [touched, setTouched] = useState<Record<string, boolean>>({
    name: false,
    email: false,
    accountPhone: false,
    dateOfBirth: false,
    password: false,
    confirmPassword: false,
    licenseNumber: false,
    vehicleType: false,
    plateNumber: false,
    driverRegion: false,
    driverDistrict: false,
    operationArea: false,
    paymentPhone: false,
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Refs to focus the first invalid input when progressing
  const nameRef = useRef<HTMLInputElement | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const accountPhoneRef = useRef<HTMLInputElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null);
  const licenseRef = useRef<HTMLInputElement | null>(null);
  const vehicleTypeRef = useRef<HTMLDivElement | null>(null);
  const plateRef = useRef<HTMLInputElement | null>(null);
  const regionRef = useRef<HTMLSelectElement | null>(null);
  const districtRef = useRef<HTMLSelectElement | null>(null);
  const operationAreaRef = useRef<HTMLSelectElement | null>(null);
  const paymentRef = useRef<HTMLInputElement | null>(null);
  const paymentOtpRef = useRef<HTMLInputElement | null>(null);

  const validateField = (field: string) => {
    switch (field) {
      case 'name':
        return name.trim() ? '' : 'Full name is required';
      case 'email':
        return email.trim() ? (emailRe.test(email.trim()) ? '' : 'Enter a valid email') : 'Email is required';
      case 'accountPhone':
        return accountPhone.trim().length >= 5 ? '' : 'Phone number is required';
      case 'dateOfBirth':
        return dateOfBirth.trim() ? '' : 'Date of birth is required';
      case 'password':
        if (!needsPasswordSetup) return '';
        if (!password.trim()) return 'Password is required';
        if (!passwordPolicyReady) return 'Password requirements are still loading';
        return passwordIsValid ? '' : passwordValidation.reasons[0] || 'Password does not meet all requirements';
      case 'confirmPassword':
        if (!needsPasswordSetup) return '';
        return confirmPassword.trim() ? (confirmPassword === password ? '' : 'Passwords do not match') : 'Please confirm your password';
      case 'licenseNumber':
        return licenseNumber.trim() ? '' : 'License number is required';
      case 'vehicleType':
        return vehicleType.trim() ? '' : 'Select a vehicle type';
      case 'plateNumber':
        return plateNumber.trim() ? '' : 'Plate number is required';
      case 'driverRegion':
        return driverRegion.trim() ? '' : 'Region is required';
      case 'driverDistrict':
        return driverDistrict.trim() ? '' : 'District is required';
      case 'operationArea':
        return operationArea.trim() ? '' : 'Operation area is required';
      case 'paymentPhone':
        return paymentPhone.trim() ? '' : 'Payment phone is required';
      default:
        return '';
    }
  };

  // validateStepFields replaced by inline validation in handleNext (keeps single-source focus behavior)

  const maxSteps = role === 'driver' ? 5 : 2; // Traveller and owner have 2 steps

  const handleNext = async () => {
    if (isStepValid()) {
      if (stepIndex === 1) {
        setCheckingAccountPhone(true);
        setError(null);
        try {
          const response = await apiClient.post('/api/auth/onboarding-contact-check', {
            phone: accountPhone.trim(),
            email: email.trim(),
          });
          if (response.data?.available !== true) {
            throw new Error('These contact details are not available.');
          }
          setFieldErrors(prev => ({ ...prev, accountPhone: '', email: '' }));
        } catch (err: any) {
          const apiError = err?.response?.data;
          const phoneTaken = apiError?.error === 'phone_already_registered';
          const emailTaken = apiError?.error === 'email_already_registered';
          const invalidPhone = apiError?.error === 'invalid_phone';
          const invalidEmail = apiError?.error === 'invalid_email';
          const message = phoneTaken
            ? 'This phone number already has an account. Please login or use forgot password to access it.'
            : emailTaken
              ? 'This email address already has an account. Please login or use forgot password to access it.'
              : invalidPhone || invalidEmail
              ? apiError?.message || 'Enter a valid phone number.'
              : 'The account service is unavailable. Please try again.';

          setFieldErrors(prev => ({
            ...prev,
            accountPhone: phoneTaken || invalidPhone ? message : '',
            email: emailTaken || invalidEmail ? message : '',
          }));
          if (phoneTaken || invalidPhone) setTouched(prev => ({ ...prev, accountPhone: true }));
          if (emailTaken || invalidEmail) setTouched(prev => ({ ...prev, email: true }));
          setError(message);
          if (phoneTaken || invalidPhone) accountPhoneRef.current?.focus();
          else if (emailTaken || invalidEmail) emailRef.current?.focus();
          return;
        } finally {
          setCheckingAccountPhone(false);
        }
      }
      setStepIndex(i => Math.min(maxSteps, i + 1));
      return;
    }

    // Validate fields for the current step and focus the first invalid one
    if (stepIndex === 1) {
      const nameErr = validateField('name');
      const emailErr = validateField('email');
      const accountPhoneErr = validateField('accountPhone');
      const dobErr = validateField('dateOfBirth');
      const pwErr = needsPasswordSetup ? validateField('password') : '';
      const cpwErr = needsPasswordSetup ? validateField('confirmPassword') : '';
      setTouched(prev => ({ ...prev, name: true, email: true, accountPhone: true, dateOfBirth: true, ...(needsPasswordSetup ? { password: true, confirmPassword: true } : {}) }));
      setFieldErrors(prev => ({ ...prev, name: nameErr, email: emailErr, accountPhone: accountPhoneErr, dateOfBirth: dobErr, ...(needsPasswordSetup ? { password: pwErr, confirmPassword: cpwErr } : {}) }));
      if (nameErr) { nameRef.current?.focus(); return; }
      if (emailErr) { emailRef.current?.focus(); return; }
      if (accountPhoneErr) { accountPhoneRef.current?.focus(); return; }
      if (dobErr) { return; }
      if (needsPasswordSetup) {
        if (pwErr) { passwordRef.current?.focus(); return; }
        if (cpwErr) { confirmPasswordRef.current?.focus(); return; }
      }
    }

    if (stepIndex === 2) {
      const licErr = validateField('licenseNumber');
      const vehErr = validateField('vehicleType');
      const plateErr = validateField('plateNumber');
      const regionErr = validateField('driverRegion');
      const districtErr = validateField('driverDistrict');
      const areaErr = validateField('operationArea');
      setTouched(prev => ({ ...prev, licenseNumber: true, vehicleType: true, plateNumber: true, driverRegion: true, driverDistrict: true, operationArea: true }));
      setFieldErrors(prev => ({ ...prev, licenseNumber: licErr, vehicleType: vehErr, plateNumber: plateErr, driverRegion: regionErr, driverDistrict: districtErr, operationArea: areaErr }));
      if (licErr) { licenseRef.current?.focus(); return; }
      if (vehErr) { vehicleTypeRef.current?.focus(); return; }
      if (plateErr) { plateRef.current?.focus(); return; }
      if (regionErr) { regionRef.current?.focus(); return; }
      if (districtErr) { districtRef.current?.focus(); return; }
      if (areaErr) { operationAreaRef.current?.focus(); return; }
    }

    if (stepIndex === 3) {
      // If payment phone is not yet verified, prompt user to verify
      if (!paymentVerified) {
        const payErr = validateField('paymentPhone');
        setTouched(prev => ({ ...prev, paymentPhone: true }));
        setFieldErrors(prev => ({ ...prev, paymentPhone: payErr }));
        if (payErr) { paymentRef.current?.focus(); return; }
        // otherwise, focus the OTP input or send button so user can verify
        if (paymentSent) { paymentOtpRef.current?.focus(); } else { paymentRef.current?.focus(); }
        return;
      }
    }

    if (stepIndex === 4) {
      setError('Upload every required document before moving to the final review.');
      return;
    }
  };

  const sendPaymentOtp = async () => {
    setPaymentMessage(null);
    // If the entered phone matches the account phone, auto-verify without sending a code
    if (accountPhoneVerified && accountPhone && normalizePhone(paymentPhone.trim()) === normalizePhone(accountPhone)) {
      setPaymentVerified(true);
      setPaymentSent(false);
      return;
    }
    if (!paymentPhone || paymentPhone.trim().length < 5) {
      setFieldErrors(prev => ({ ...prev, paymentPhone: 'Please enter a valid phone number' }));
      setTouched(prev => ({ ...prev, paymentPhone: true }));
      paymentRef.current?.focus();
      return;
    }
    
    setPaymentLoading(true);
    try {
      // Call API to send payment verification OTP
      await apiClient.post('/api/auth/send-otp', { phone: paymentPhone, role: 'driver' });
      setPaymentSent(true);
      setPaymentMessage('OTP sent. Enter the code you received.');
      setPaymentCountdown(60);
      const iv = setInterval(() => {
        setPaymentCountdown(c => {
          if (c <= 1) { clearInterval(iv); return 0; }
          return c - 1;
        });
      }, 1000);
      // focus OTP input shortly
      setTimeout(() => paymentOtpRef.current?.focus(), 200);
    } catch (err: any) {
      setPaymentMessage((err as any)?.response?.data?.message || err?.message || 'Failed to send OTP');
    } finally {
      setPaymentLoading(false);
    }
  };

  const verifyPaymentOtp = async () => {
    setPaymentMessage(null);
    if (!paymentOtp || paymentOtp.trim().length < 3) {
      setPaymentMessage('Enter the OTP you received');
      paymentOtpRef.current?.focus();
      return;
    }
    
    setPaymentLoading(true);
    try {
      // Verify payment OTP with API
      await apiClient.post('/api/auth/verify-otp', { phone: paymentPhone, otp: paymentOtp, role: 'driver' });
      setPaymentVerified(true);
      // don't show textual 'verified' message; the icon indicates verification
      setPaymentMessage(null);
    } catch (err: any) {
      setPaymentMessage((err as any)?.response?.data?.message || err?.message || 'OTP verification failed');
    } finally {
      setPaymentLoading(false);
    }
  };

  const resendPaymentOtp = async () => {
    if (paymentCountdown > 0) return;
    await sendPaymentOtp();
  };

  

  if (checkingAuth) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[radial-gradient(ellipse_at_60%_0%,_rgba(2,102,94,0.08),_transparent_55%),linear-gradient(180deg,_#f0faf9_0%,_#f8fafc_40%,_#ffffff_100%)]">
        <Loader2 className="w-9 h-9 text-[#02665e] animate-spin" />
      </main>
    );
  }

  return (
    <main className={`min-h-screen flex items-center justify-center py-6 px-4 ${role === 'driver' ? 'bg-[#04080f]' : 'bg-[radial-gradient(ellipse_at_60%_0%,_rgba(2,102,94,0.08),_transparent_55%),linear-gradient(180deg,_#f0faf9_0%,_#f8fafc_40%,_#ffffff_100%)]'}`}>
      <div className={`${role !== 'driver' ? 'max-w-6xl' : 'max-w-4xl'} w-full ${role === 'driver' ? 'bg-white rounded-2xl overflow-hidden ring-1 ring-amber-400/15 shadow-[0_32px_80px_rgba(0,0,0,0.65)]' : 'overflow-hidden rounded-[32px] border border-white/70 bg-white/95 shadow-[0_32px_120px_-24px_rgba(2,102,94,0.24),0_16px_40px_-20px_rgba(15,23,42,0.16)] backdrop-blur'}`}>
        {/* Header */}
        {role === 'driver' ? (
          <div className="relative bg-gradient-to-br from-[#0a1628] via-[#0d1f3c] to-[#071424] border-b border-white/[0.07] overflow-hidden">
            {/* Decorative blobs */}
            <div className="absolute -top-12 -right-12 w-56 h-56 bg-amber-400/[0.04] rounded-full blur-3xl pointer-events-none" />
            <div className="absolute -bottom-8 left-1/2 w-64 h-32 bg-[#02665e]/[0.06] rounded-full blur-3xl pointer-events-none" />

            {/* Title row */}
            <div className="relative px-7 pt-7 pb-6 flex items-center gap-5">
              {/* Icon */}
              <div className="w-[60px] h-[60px] rounded-2xl flex-shrink-0 flex items-center justify-center"
                style={{ background: "linear-gradient(135deg, rgba(251,191,36,0.18) 0%, rgba(251,191,36,0.06) 100%)", border: "1px solid rgba(251,191,36,0.28)", boxShadow: "0 8px 32px rgba(251,191,36,0.10)" }}>
                <Truck className="w-7 h-7 text-amber-400" />
              </div>

              <div className="flex-1 min-w-0">
                {/* Badge */}
                <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 mb-2">
                  <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400" />
                  <span className="text-[9px] font-black tracking-[0.15em] text-amber-400 uppercase">Professional Driver Registration</span>
                </div>
                <h1 className="text-[26px] font-extrabold text-white tracking-tight leading-none">{title}</h1>
                <p className="text-slate-400 text-[13px] mt-1.5 leading-relaxed">{help}</p>
              </div>

              {/* Step counter pill */}
              <div className="flex-shrink-0 hidden sm:flex flex-col items-center gap-0.5 px-4 py-2.5 rounded-2xl bg-white/[0.04] border border-white/[0.07]">
                <span className="text-2xl font-black text-amber-400 leading-none">{stepIndex}</span>
                <span className="text-[10px] text-slate-500 font-semibold">of 5</span>
              </div>
            </div>

            {/* Step tab bar */}
            <div className="relative flex border-t border-white/[0.06]">
              {([
                { num: 1, label: 'Personal', icon: User },
                { num: 2, label: 'Driving', icon: Truck },
                { num: 3, label: 'Payment', icon: CreditCard },
                { num: 4, label: 'Uploads', icon: Upload },
                { num: 5, label: 'Review', icon: CheckCircle2 },
              ] as { num: number; label: string; icon: any }[]).map((step) => {
                const Icon = step.icon;
                const isActive = stepIndex === step.num;
                const isCompleted = stepIndex > step.num;
                const isUnlocked = isDriverStepUnlocked(step.num);
                return (
                  <button
                    key={step.num}
                    type="button"
                    onClick={() => {
                      if (!isUnlocked) return;
                      setStepIndex(step.num);
                    }}
                    disabled={!isUnlocked}
                    aria-current={isActive ? 'step' : undefined}
                    className={`flex-1 flex flex-col items-center gap-1.5 py-3 transition-all duration-200 relative ${
                      !isUnlocked
                        ? 'cursor-not-allowed text-slate-700/40'
                        : isActive
                        ? 'text-amber-400'
                        : isCompleted
                        ? 'text-amber-400/40 hover:text-amber-400/60'
                        : 'text-slate-600 hover:text-slate-400'
                    }`}
                  >
                    {/* Active underline */}
                    {isActive && (
                      <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-amber-400" />
                    )}
                    {isCompleted && (
                      <span className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-amber-400/20" />
                    )}
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all ${
                      !isUnlocked
                        ? 'bg-white/[0.02] opacity-60'
                        : isActive
                        ? 'bg-amber-400/15 ring-1 ring-amber-400/40'
                        : isCompleted
                        ? 'bg-amber-400/8'
                        : 'bg-white/[0.03]'
                    }`}>
                      {isCompleted
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-amber-400/60" />
                        : <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />}
                    </div>
                    <span className={`text-[10px] font-bold tracking-wide`}>{step.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="relative overflow-hidden bg-[linear-gradient(145deg,#025c55_0%,#02665e_42%,#014d46_100%)] px-5 py-6 text-white sm:px-8 sm:py-8 lg:px-10 lg:py-9">
            <div className="pointer-events-none absolute inset-0 opacity-[0.06]" style={{ backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
            <div className="pointer-events-none absolute -top-20 right-[-36px] h-56 w-56 rounded-full bg-white/10 blur-3xl" />
            <div className="pointer-events-none absolute -bottom-16 left-[-18px] h-44 w-44 rounded-full bg-[#6ee7b7]/12 blur-3xl" />

            <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_320px] lg:items-end">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3.5 py-1.5 backdrop-blur-sm">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#6ee7b7]" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-white/82">
                    {role === 'owner' ? 'Property owner onboarding' : 'Traveller onboarding'}
                  </span>
                </div>

                <div className="mt-5 flex items-start gap-4">
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-[22px] border border-white/15 bg-white/12 shadow-[0_14px_36px_rgba(0,0,0,0.18)] backdrop-blur-sm">
                    {role === 'owner' ? <Building2 className="h-7 w-7 text-white" /> : <UserCircle2 className="h-7 w-7 text-white" />}
                  </div>
                  <div className="min-w-0">
                    <h1 className="text-[1.9rem] font-black tracking-tight text-white sm:text-[2.4rem] lg:text-[2.7rem]">{title}</h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-white/76 sm:text-[15px] sm:leading-7">{help}</p>
                  </div>
                </div>

                <div className="mt-6 flex flex-wrap gap-2.5">
                  {nonDriverHighlights.map((item) => (
                    <div key={item} className="inline-flex items-center gap-2 rounded-full border border-white/14 bg-white/[0.08] px-3 py-2 text-xs font-medium text-white/88 backdrop-blur-sm">
                      <CheckCircle2 className="h-3.5 w-3.5 text-[#6ee7b7]" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[26px] border border-white/12 bg-white/[0.10] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.18)] backdrop-blur-md sm:p-5">
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/58">Profile setup</p>
                    <p className="mt-2 text-3xl font-black text-white">{String(nonDriverCompletion).padStart(2, '0')}%</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/10 px-3 py-2 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/50">Current</p>
                    <p className="mt-1 text-sm font-semibold text-white">{nonDriverSteps[Math.max(0, stepIndex - 1)]?.detail}</p>
                  </div>
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-[linear-gradient(90deg,#6ee7b7_0%,#ffffff_100%)] transition-all duration-500" style={{ width: `${nonDriverCompletion}%` }} />
                </div>

                <div className="mt-5 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
                  {nonDriverSteps.map((step) => {
                    const isActive = stepIndex === step.num;
                    const isCompleted = stepIndex > step.num;
                    return (
                      <button
                        key={step.num}
                        type="button"
                        onClick={() => setStepIndex(step.num)}
                        aria-current={isActive ? 'step' : undefined}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition-all duration-200 ${
                          isActive
                            ? 'border-white/70 bg-white text-[#02665e] shadow-[0_12px_30px_rgba(0,0,0,0.14)]'
                            : isCompleted
                            ? 'border-[#6ee7b7]/40 bg-[#6ee7b7]/12 text-white hover:border-[#6ee7b7]/60'
                            : 'border-white/12 bg-black/10 text-white/78 hover:border-white/20 hover:bg-white/[0.08]'
                        }`}
                      >
                        <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl border text-sm font-black ${
                          isActive
                            ? 'border-[#02665e]/12 bg-[#02665e]/8 text-[#02665e]'
                            : isCompleted
                            ? 'border-[#6ee7b7]/30 bg-[#6ee7b7]/14 text-[#6ee7b7]'
                            : 'border-white/12 bg-white/5 text-white/60'
                        }`}>
                          {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : step.num}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={`block text-[10px] font-semibold uppercase tracking-[0.22em] ${isActive ? 'text-[#02665e]/65' : isCompleted ? 'text-[#6ee7b7]' : 'text-white/45'}`}>
                            Step {step.num}
                          </span>
                          <span className={`mt-1 block text-sm font-semibold ${isActive ? 'text-slate-900' : 'text-white'}`}>{step.label}</span>
                          <span className={`mt-0.5 block text-xs ${isActive ? 'text-slate-500' : 'text-white/60'}`}>{step.detail}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className={role !== 'driver' ? 'bg-[linear-gradient(180deg,#ffffff_0%,#fbfefd_100%)] px-4 py-5 sm:px-6 sm:py-6 lg:px-10 lg:py-8' : 'p-6 bg-gradient-to-b from-slate-50/80 to-white'}>
          {error && !(error === 'Please provide both name and email' && role === 'driver' && stepIndex !== 5) && (
            <div className={`mb-4 ${role !== 'driver' ? 'p-2.5' : 'p-3'} bg-red-50 border-l-4 border-red-500 rounded-r-lg flex items-start gap-2`}>
              <AlertCircle className={`${role !== 'driver' ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-red-500 flex-shrink-0 mt-0.5`} />
              <div className="flex-1">
                <p className={`${role !== 'driver' ? 'text-xs' : 'text-sm'} text-red-700`}>{error}</p>
                {Array.isArray(errorReasons) && errorReasons.length > 0 && (
                  <ul className={`mt-1.5 ${role !== 'driver' ? 'text-[10px]' : 'text-xs'} text-red-700 list-disc pl-4 space-y-0.5`}>
                    {errorReasons.map((r, idx) => (
                      <li key={`${idx}-${r}`}>{r}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {success && (
            <div className={`mb-4 ${role !== 'driver' ? 'p-2.5' : 'p-3'} bg-emerald-50 border-l-4 border-emerald-500 rounded-r-lg flex items-start gap-2`}>
              <CheckCircle2 className={`${role !== 'driver' ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-emerald-500 flex-shrink-0 mt-0.5`} />
              <p className={`${role !== 'driver' ? 'text-xs' : 'text-sm'} text-emerald-700 flex-1`}>{success}</p>
            </div>
          )}

          {role === 'driver' && (
            <div className="mb-5 rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#fff_0%,#f8fafc_45%,#eefbf7_100%)] px-4 py-3.5 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <Shield className="h-4.5 w-4.5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-slate-900">Complete submission required</p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    NoLSAF reviews the full driver application in one pass. Finish all required details, operation area, payment verification, and every mandatory document before submitting for approval.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Content area */}
          {role !== 'driver' ? (
            <form onSubmit={submitProfile} className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_290px] lg:items-start">
              <div className="min-w-0 rounded-[26px] border border-slate-200/75 bg-white p-4 shadow-[0_14px_40px_-24px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/5 sm:p-6 lg:p-7">
              {/* Step contents for traveller/owner */}
              {stepIndex === 1 && (
                <div className={`transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  {/* Section header */}
                  <div className="mb-6 rounded-[24px] border border-slate-200/70 bg-[linear-gradient(180deg,#ffffff_0%,#f7faf9_100%)] px-4 py-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.22)] sm:px-5">
                    <div className="flex items-start gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[#02665e]/15 to-[#6ee7b7]/10 ring-1 ring-[#02665e]/10">
                      <User className="h-4.5 w-4.5 text-[#02665e]" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h3 className="text-lg font-bold text-slate-900">Personal details</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">Set up the identity details people will see when they interact with your profile.</p>
                    </div>
                    </div>
                  </div>

                  <div className="mx-auto grid max-w-4xl gap-4 lg:grid-cols-2 lg:gap-5">
                    {/* Full name */}
                    <div className="rounded-lg bg-white p-4 border border-slate-100 shadow-sm transform transition hover:-translate-y-0.5 hover:shadow-lg">
                      <label htmlFor="onboard-name" className="block text-sm font-medium text-slate-700">
                        Full name <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="onboard-name"
                        ref={nameRef}
                        value={name}
                        onChange={e => setName(e.target.value)}
                        onBlur={() => { setTouched(prev => ({ ...prev, name: true })); setFieldErrors(prev => ({ ...prev, name: validateField('name') })); }}
                        className={`mt-1 w-full rounded-md px-3 py-2 border bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-colors ${
                          touched.name && fieldErrors.name
                            ? 'border-red-300'
                            : 'border-slate-200 hover:border-slate-300 focus:border-[#02665e]'
                        }`}
                        placeholder="e.g. Jane Doe"
                      />
                      {touched.name && fieldErrors.name && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-600">
                          <AlertCircle className="h-3 w-3" />{fieldErrors.name}
                        </p>
                      )}
                    </div>

                    {/* Email */}
                    <div className="rounded-lg bg-white p-4 border border-slate-100 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="onboard-email" className="block text-sm font-medium text-slate-700">
                          Email address <span className="text-red-500">*</span>
                        </label>
                        {accountEmailLocked && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#02665e]">
                            <Lock className="h-3 w-3" />
                            Verified contact
                          </span>
                        )}
                      </div>
                      <input
                        id="onboard-email"
                        ref={emailRef}
                        type="email"
                        value={email}
                        onChange={(event) => {
                          if (!accountEmailLocked) {
                            setEmail(event.target.value);
                            setFieldErrors(prev => ({ ...prev, email: '' }));
                            setError(null);
                          }
                        }}
                        onBlur={() => { setTouched(prev => ({ ...prev, email: true })); setFieldErrors(prev => ({ ...prev, email: validateField('email') })); }}
                        readOnly={accountEmailLocked}
                        aria-readonly={accountEmailLocked}
                        className={`mt-1 w-full rounded-md px-3 py-2 border text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none transition-colors ${
                          touched.email && fieldErrors.email
                            ? 'border-red-300 bg-white focus:ring-2 focus:ring-red-100'
                            : accountEmailLocked
                              ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-600'
                              : 'border-slate-200 bg-white hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-emerald-200'
                        }`}
                        placeholder="you@example.com"
                      />
                      {touched.email && fieldErrors.email && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-600">
                          <AlertCircle className="h-3 w-3" />{fieldErrors.email}
                        </p>
                      )}
                      {accountEmailLocked && !fieldErrors.email && (
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          Verified during registration. Change it later from Account Security.
                        </p>
                      )}
                    </div>

                    {/* Phone is collected during registration even when email receives the OTP. */}
                    <div className="rounded-lg border border-slate-100 bg-white p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-2">
                        <label htmlFor="onboard-phone" className="block text-sm font-medium text-slate-700">
                          Phone number <span className="text-red-500">*</span>
                        </label>
                        {accountPhoneLocked && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#02665e]">
                            <Lock className="h-3 w-3" />
                            Verified contact
                          </span>
                        )}
                      </div>
                      <input
                        id="onboard-phone"
                        ref={accountPhoneRef}
                        type="tel"
                        value={accountPhone}
                        onChange={(event) => {
                          if (!accountPhoneLocked) {
                            setAccountPhone(event.target.value);
                            setFieldErrors(prev => ({ ...prev, accountPhone: '' }));
                            setError(null);
                          }
                        }}
                        onBlur={() => {
                          setTouched(prev => ({ ...prev, accountPhone: true }));
                          setFieldErrors(prev => ({ ...prev, accountPhone: validateField('accountPhone') }));
                        }}
                        readOnly={accountPhoneLocked}
                        aria-readonly={accountPhoneLocked}
                        placeholder="+255 712 345 678"
                        className={`mt-1 w-full rounded-md border px-3 py-2 text-sm text-slate-700 outline-none ${
                          touched.accountPhone && fieldErrors.accountPhone
                            ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-100'
                            : accountPhoneLocked
                              ? 'border-slate-200 bg-slate-50'
                              : 'border-slate-200 bg-white hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-emerald-200'
                        }`}
                      />
                      {touched.accountPhone && fieldErrors.accountPhone ? (
                        <div
                          role="alert"
                          className="mt-3 flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
                        >
                          <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-500" />
                          <span className="min-w-0 flex-1 break-words">{fieldErrors.accountPhone}</span>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          {accountPhoneLocked
                            ? 'Change this later from Account security with verification.'
                            : 'Required because this account was created with email.'}
                        </p>
                      )}
                    </div>

                    {needsPasswordSetup && (
                      <>
                        <div className="rounded-lg bg-white p-4 border border-slate-100 shadow-sm transform transition hover:-translate-y-0.5 hover:shadow-lg">
                          <label htmlFor="onboard-password" className="block text-sm font-medium text-slate-700">
                            Password <span className="text-red-500">*</span>
                          </label>
                          {passwordPolicyStatus !== 'ready' && (
                            <p className="mt-1.5 text-[11px] text-amber-700">
                              {passwordPolicyStatus === 'loading' ? 'Loading password requirements…' : 'Password requirements could not be loaded.'}
                              {passwordPolicyStatus === 'error' && <button type="button" onClick={retryPolicy} className="ml-1 border-0 bg-transparent p-0 font-semibold underline">Retry</button>}
                            </p>
                          )}
                          <input
                            id="onboard-password"
                            ref={passwordRef}
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            maxLength={passwordPolicy.maxLength}
                            disabled={!passwordPolicyReady}
                            onBlur={() => { setTouched(prev => ({ ...prev, password: true })); setFieldErrors(prev => ({ ...prev, password: validateField('password') })); }}
                            className={`mt-1 w-full rounded-md px-3 py-2 border bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-colors ${
                              touched.password && fieldErrors.password
                                ? 'border-red-300'
                                : 'border-slate-200 hover:border-slate-300 focus:border-[#02665e]'
                            }`}
                            placeholder="Create a strong password"
                          />
                          {touched.password && fieldErrors.password && (
                            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-600">
                              <AlertCircle className="h-3 w-3" />{fieldErrors.password}
                            </p>
                          )}
                          {passwordPolicyReady && password.trim().length > 0 && (() => {
                            const s = computePasswordStrength(password);
                            const checks = s.requirements;
                            const label = s.strength === 'strong' ? 'Strong' : s.strength === 'medium' ? 'Medium' : 'Weak';
                            const barWidth = s.strength === 'strong' ? 'w-full' : s.strength === 'medium' ? 'w-2/3' : 'w-1/3';
                            const barColor = s.strength === 'strong' ? 'bg-emerald-500' : s.strength === 'medium' ? 'bg-amber-400' : 'bg-red-500';
                            const labelColor = s.strength === 'strong' ? 'text-emerald-600' : s.strength === 'medium' ? 'text-amber-500' : 'text-red-500';
                            return (
                              <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <div className="flex items-center justify-between mb-2">
                                  <span className="text-[11px] font-semibold text-slate-600">Password strength</span>
                                  <span className={`text-[11px] font-bold ${labelColor}`}>{label}</span>
                                </div>
                                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 mb-3">
                                  <div className={`h-full ${barWidth} ${barColor} rounded-full transition-all duration-500`} />
                                </div>
                                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                  {checks.map((c) => (
                                    <div key={c.label} className="flex items-center gap-1.5">
                                      <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                                        c.pass ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'
                                      }`}>
                                        {c.pass
                                          ? <Check className="h-2.5 w-2.5" strokeWidth={3} />
                                          : <span className="text-[9px] font-black leading-none">×</span>
                                        }
                                      </div>
                                      <span className={`text-[11px] leading-tight ${
                                        c.pass ? 'text-emerald-700 font-medium' : 'text-slate-400'
                                      }`}>{c.label}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()}
                        </div>

                        <div className="rounded-lg bg-white p-4 border border-slate-100 shadow-sm transform transition hover:-translate-y-0.5 hover:shadow-lg">
                          <label htmlFor="onboard-confirm-password" className="block text-sm font-medium text-slate-700">
                            Confirm password <span className="text-red-500">*</span>
                          </label>
                          <input
                            id="onboard-confirm-password"
                            ref={confirmPasswordRef}
                            type="password"
                            value={confirmPassword}
                            onChange={e => setConfirmPassword(e.target.value)}
                            maxLength={passwordPolicy.maxLength}
                            disabled={!passwordPolicyReady}
                            onBlur={() => { setTouched(prev => ({ ...prev, confirmPassword: true })); setFieldErrors(prev => ({ ...prev, confirmPassword: validateField('confirmPassword') })); }}
                            className={`mt-1 w-full rounded-md px-3 py-2 border bg-white text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 transition-colors ${
                              touched.confirmPassword && fieldErrors.confirmPassword
                                ? 'border-red-300 focus:ring-red-100'
                                : confirmPassword && confirmPassword === password
                                ? 'border-emerald-300 focus:ring-emerald-100'
                                : 'border-slate-200 hover:border-slate-300 focus:border-[#02665e] focus:ring-emerald-200'
                            }`}
                            placeholder="Re-enter your password"
                          />
                          {confirmPassword.length > 0 && (
                            <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${
                              confirmPassword === password ? 'text-emerald-600' : 'text-red-500'
                            }`}>
                              {confirmPassword === password
                                ? <><Check className="h-3 w-3" strokeWidth={3} /> Passwords match</>
                                : <><X className="h-3 w-3" strokeWidth={3} /> Passwords don&apos;t match</>
                              }
                            </p>
                          )}
                          {touched.confirmPassword && fieldErrors.confirmPassword && (
                            <p className="mt-1.5 flex items-center gap-1 text-[11px] text-red-600">
                              <AlertCircle className="h-3 w-3" />{fieldErrors.confirmPassword}
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Trust strip */}
                  <div className="mt-5 flex flex-col items-start gap-3 rounded-[22px] border border-[#02665e]/10 bg-[linear-gradient(180deg,#f7fcfb_0%,#f9fbfb_100%)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-center sm:gap-4">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Shield className="h-3.5 w-3.5 text-[#02665e]" />
                      Secure &amp; encrypted
                    </div>
                    <div className="hidden h-3 w-px bg-slate-200 sm:block" />
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Lock className="h-3.5 w-3.5 text-[#02665e]" />
                      Private by default
                    </div>
                  </div>
                </div>
              )}

              {stepIndex === 2 && (
                <div className={`transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  {/* Section header */}
                  <div className="mb-6 rounded-[24px] border border-slate-200/70 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbfa_100%)] px-4 py-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.22)] sm:px-5">
                    <div className="flex items-start gap-3.5">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-50 to-teal-50 ring-1 ring-emerald-200/60">
                      <CheckCircle2 className="h-4.5 w-4.5 text-[#02665e]" />
                    </div>
                    <div className="min-w-0 pt-0.5">
                      <h3 className="text-lg font-bold text-slate-900">Review your details</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-500">Check the essentials before your profile goes live and becomes ready to use.</p>
                    </div>
                    </div>
                  </div>

                  <div className="mx-auto max-w-2xl space-y-3">
                    {/* Name card */}
                    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/8 ring-1 ring-[#02665e]/10">
                          <User className="h-3.5 w-3.5 text-[#02665e]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Full name</p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{name || <span className="italic text-slate-400">Not provided</span>}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setStepIndex(1)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#02665e] transition-all hover:border-[#02665e]/30 hover:bg-[#02665e]/5 sm:w-auto">
                        Edit
                      </button>
                    </div>

                    {/* Email card */}
                    <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/8 ring-1 ring-[#02665e]/10">
                          <Mail className="h-3.5 w-3.5 text-[#02665e]" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Email address</p>
                          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">{email || <span className="italic text-slate-400">Not provided</span>}</p>
                        </div>
                      </div>
                      <button type="button" onClick={() => setStepIndex(1)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#02665e] transition-all hover:border-[#02665e]/30 hover:bg-[#02665e]/5 sm:w-auto">
                        Edit
                      </button>
                    </div>

                    {needsPasswordSetup && (
                      <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-slate-50/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#02665e]/8 ring-1 ring-[#02665e]/10">
                            <Lock className="h-3.5 w-3.5 text-[#02665e]" />
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Password</p>
                            <p className="mt-0.5 text-sm font-semibold text-slate-900">{password ? '••••••••' : <span className="italic text-slate-400">Not set</span>}</p>
                          </div>
                        </div>
                        <button type="button" onClick={() => setStepIndex(1)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-[#02665e] transition-all hover:border-[#02665e]/30 hover:bg-[#02665e]/5 sm:w-auto">
                          Edit
                        </button>
                      </div>
                    )}

                    {/* Ready banner */}
                    <div className="mt-2 flex items-start gap-3 rounded-2xl border border-[#02665e]/15 bg-gradient-to-r from-[#02665e]/5 to-transparent px-4 py-3.5">
                      <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-[#02665e]" />
                      <p className="text-xs font-medium text-slate-700">Everything looks good. Hit <span className="font-bold text-[#02665e]">Save &amp; continue</span> to finish setting up your profile.</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  {stepIndex > 1 && (
                    <button
                      type="button"
                      onClick={() => setStepIndex(i => Math.max(1, i-1))}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 transition-all hover:border-slate-300 hover:bg-slate-50 active:scale-[0.97] sm:w-auto"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      Back
                    </button>
                  )}
                  <Link
                    href="/public"
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-xs font-medium text-slate-500 transition-all hover:text-[#02665e] hover:bg-[#02665e]/5 no-underline sm:w-auto"
                  >
                    <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                    Return to public site
                  </Link>
                </div>
                <div className="w-full sm:w-auto">
                  {stepIndex < 2 ? (
                    <button
                      type="button"
                      onClick={handleNext}
                      disabled={!isStepValid() || checkingAccountPhone}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold transition-all active:scale-[0.97] sm:w-auto ${
                        isStepValid() && !checkingAccountPhone
                          ? 'bg-[#02665e] text-white shadow-[0_4px_20px_rgba(2,102,94,0.35)] hover:bg-[#014e47] hover:shadow-[0_6px_24px_rgba(2,102,94,0.45)]'
                          : 'cursor-not-allowed bg-slate-100 text-slate-400'
                      }`}
                    >
                      {checkingAccountPhone ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Checking details...
                        </>
                      ) : (
                        <>
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={loading || !isStepValid()}
                      className={`flex w-full items-center justify-center gap-2 rounded-xl px-6 py-2.5 text-sm font-bold transition-all active:scale-[0.97] sm:w-auto ${
                        loading || !isStepValid()
                          ? 'cursor-not-allowed bg-slate-100 text-slate-400'
                          : 'bg-[#02665e] text-white shadow-[0_4px_20px_rgba(2,102,94,0.35)] hover:bg-[#014e47] hover:shadow-[0_6px_24px_rgba(2,102,94,0.45)]'
                      }`}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Save &amp; continue
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>
              </div>

              <aside className="hidden space-y-4 lg:block">
                <div className="rounded-[26px] border border-slate-200/80 bg-[linear-gradient(180deg,#ffffff_0%,#f7faf9_100%)] p-5 shadow-[0_12px_36px_-26px_rgba(15,23,42,0.3)] ring-1 ring-slate-900/5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#02665e]/8 text-[#02665e]">
                      <Shield className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Why this matters</p>
                      <p className="text-xs text-slate-500">A polished profile improves trust and access.</p>
                    </div>
                  </div>

                  <div className="mt-5 space-y-3">
                    {nonDriverHighlights.map((item) => (
                      <div key={item} className="flex items-start gap-2.5 rounded-2xl border border-slate-100 bg-white px-3.5 py-3">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#02665e]" />
                        <p className="text-sm text-slate-600">{item}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-[#0f172a] p-5 text-white shadow-[0_18px_46px_-28px_rgba(15,23,42,0.5)]">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/50">Step {stepIndex} of {nonDriverSteps.length}</p>
                  <p className="mt-3 text-xl font-bold">{nonDriverSteps[Math.max(0, stepIndex - 1)]?.detail}</p>
                  <p className="mt-2 text-sm leading-6 text-white/70">
                    {stepIndex === 1
                      ? 'Use accurate account details so future bookings, messages, and approvals match your identity.'
                      : 'Review carefully before finishing. You can still go back and adjust anything that looks wrong.'}
                  </p>

                  <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-center justify-between text-xs text-white/60">
                      <span>Progress</span>
                      <span>{nonDriverCompletion}%</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                      <div className="h-full rounded-full bg-[linear-gradient(90deg,#6ee7b7_0%,#34d399_100%)] transition-all duration-500" style={{ width: `${nonDriverCompletion}%` }} />
                    </div>
                  </div>
                </div>
              </aside>
            </form>
          ) : (
            <form onSubmit={submitProfile} className="space-y-6">
              {/* Step contents with small animation */}
              {stepIndex === 1 && (
                <div className={`space-y-5 rounded-2xl p-6 border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/60 shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 flex items-center justify-center ring-1 ring-[#02665e]/10">
                      <User className="w-5 h-5 text-[#02665e]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Personal Details</h3>
                      <p className="text-xs text-slate-500">Your identity and contact information</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                  <div>
                      <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                        <UserCircle className="w-3.5 h-3.5 text-slate-500" />
                        Full name
                        <span className="text-red-500">*</span>
                        <FieldBadge fk="name" />
                      </label>
                      <input 
                        ref={nameRef} 
                        value={name} 
                        disabled={isApproved('name')}
                        onChange={e => setName(e.target.value)} 
                        onBlur={() => { setTouched(prev => ({ ...prev, name: true })); setFieldErrors(prev => ({ ...prev, name: validateField('name') })); }} 
                        className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 ${fieldBorderClass('name', Boolean(touched.name && fieldErrors.name))} bg-white shadow-sm hover:shadow-md text-sm`}
                        placeholder="Enter your full name"
                      />
                      {touched.name && fieldErrors.name && (
                        <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {fieldErrors.name}
                        </div>
                      )}
                    </div>

                  {needsPasswordSetup && (
                    <>
                      <div>
                        <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                          Password
                          <span className="text-red-500">*</span>
                        </label>
                        {passwordPolicyStatus !== 'ready' && (
                          <p className="mb-2 text-[11px] text-amber-700">
                            {passwordPolicyStatus === 'loading' ? 'Loading password requirements…' : 'Password requirements could not be loaded.'}
                            {passwordPolicyStatus === 'error' && <button type="button" onClick={retryPolicy} className="ml-1 border-0 bg-transparent p-0 font-semibold underline">Retry</button>}
                          </p>
                        )}
                        <input
                          ref={passwordRef}
                          type="password"
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          maxLength={passwordPolicy.maxLength}
                          disabled={!passwordPolicyReady}
                          onBlur={() => { setTouched(prev => ({ ...prev, password: true })); setFieldErrors(prev => ({ ...prev, password: validateField('password') })); }}
                          className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 ${
                            touched.password && fieldErrors.password
                              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                              : 'border-slate-200 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10'
                          } bg-white shadow-sm hover:shadow-md text-sm`}
                          placeholder="Create a password"
                        />
                        {touched.password && fieldErrors.password && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.password}
                          </div>
                        )}

                        {passwordPolicyReady && password.trim().length > 0 && (() => {
                          const s = computePasswordStrength(password);
                          const checks = s.requirements;
                          const label = s.strength === 'strong' ? 'Strong' : s.strength === 'medium' ? 'Medium' : 'Weak';
                          const barWidth = s.strength === 'strong' ? 'w-full' : s.strength === 'medium' ? 'w-2/3' : 'w-1/3';
                          const barColor = s.strength === 'strong' ? 'bg-emerald-500' : s.strength === 'medium' ? 'bg-amber-400' : 'bg-red-500';
                          const labelColor = s.strength === 'strong' ? 'text-emerald-600' : s.strength === 'medium' ? 'text-amber-500' : 'text-red-500';
                          return (
                            <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                              <div className="flex items-center justify-between mb-2">
                                <span className="text-xs font-semibold text-slate-700">Password strength</span>
                                <span className={`text-xs font-bold ${labelColor}`}>{label}</span>
                              </div>
                              <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden mb-3">
                                <div className={`h-full ${barWidth} ${barColor} rounded-full transition-all duration-500`} />
                              </div>
                              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {checks.map((c) => (
                                  <div key={c.label} className="flex items-center gap-1.5">
                                    <div className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full transition-colors ${
                                      c.pass ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-300'
                                    }`}>
                                      {c.pass
                                        ? <Check className="h-2.5 w-2.5" strokeWidth={3} />
                                        : <span className="text-[9px] font-black leading-none">×</span>
                                      }
                                    </div>
                                    <span className={`text-[11px] leading-tight ${
                                      c.pass ? 'text-emerald-700 font-medium' : 'text-slate-400'
                                    }`}>{c.label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>

                      <div>
                        <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                          Confirm password
                          <span className="text-red-500">*</span>
                        </label>
                        <input
                          ref={confirmPasswordRef}
                          type="password"
                          value={confirmPassword}
                          onChange={e => setConfirmPassword(e.target.value)}
                          maxLength={passwordPolicy.maxLength}
                          disabled={!passwordPolicyReady}
                          onBlur={() => { setTouched(prev => ({ ...prev, confirmPassword: true })); setFieldErrors(prev => ({ ...prev, confirmPassword: validateField('confirmPassword') })); }}
                          className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 ${
                            touched.confirmPassword && fieldErrors.confirmPassword
                              ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                              : 'border-slate-200 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10'
                          } bg-white shadow-sm hover:shadow-md text-sm`}
                          placeholder="Re-enter your password"
                        />
                        {confirmPassword.length > 0 && (
                          <p className={`mt-1.5 flex items-center gap-1 text-[11px] font-medium ${
                            confirmPassword === password ? 'text-emerald-600' : 'text-red-500'
                          }`}>
                            {confirmPassword === password
                              ? <><Check className="h-3 w-3" strokeWidth={3} /> Passwords match</>
                              : <><X className="h-3 w-3" strokeWidth={3} /> Passwords don&apos;t match</>
                            }
                          </p>
                        )}
                        {touched.confirmPassword && fieldErrors.confirmPassword && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.confirmPassword}
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  <div>
                      <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                        <Mail className="w-3.5 h-3.5 text-slate-500" />
                        Email
                        <span className="text-red-500">*</span>
                        <FieldBadge fk="email" />
                        {accountEmailLocked && (
                          <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-[#02665e]">
                            <Lock className="h-3 w-3" />
                            Verified
                          </span>
                        )}
                      </label>
                      <input 
                        ref={emailRef} 
                        type="email" 
                        value={email} 
                        disabled={isApproved('email') || accountEmailLocked}
                        onChange={(event) => {
                          if (!accountEmailLocked) {
                            setEmail(event.target.value);
                            setFieldErrors(prev => ({ ...prev, email: '' }));
                            setError(null);
                          }
                        }}
                        onBlur={() => { setTouched(prev => ({ ...prev, email: true })); setFieldErrors(prev => ({ ...prev, email: validateField('email') })); }} 
                        className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 ${
                          accountEmailLocked
                            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-600'
                            : `${fieldBorderClass('email', Boolean(touched.email && fieldErrors.email))} bg-white shadow-sm hover:shadow-md`
                        } text-sm`}
                        placeholder="you@example.com"
                      />
                      {touched.email && fieldErrors.email && (
                        <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {fieldErrors.email}
                        </div>
                      )}
                      {accountEmailLocked && !fieldErrors.email && (
                        <p className="mt-1.5 text-[11px] text-slate-500">
                          Verified during registration. Change it later from Account Security.
                        </p>
                      )}
                  </div>

                  <div>
                    <label className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-900">
                      <Phone className="h-3.5 w-3.5 text-slate-500" />
                      Phone number
                      <span className="text-red-500">*</span>
                      {accountPhoneLocked && (
                        <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-semibold text-[#02665e]">
                          <Lock className="h-3 w-3" />
                          Verified
                        </span>
                      )}
                    </label>
                    <input
                      ref={accountPhoneRef}
                      type="tel"
                      value={accountPhone}
                      onChange={(event) => {
                        if (!accountPhoneLocked) {
                          setAccountPhone(event.target.value);
                          setFieldErrors(prev => ({ ...prev, accountPhone: '' }));
                          setError(null);
                        }
                      }}
                      onBlur={() => {
                        setTouched(prev => ({ ...prev, accountPhone: true }));
                        setFieldErrors(prev => ({ ...prev, accountPhone: validateField('accountPhone') }));
                      }}
                      readOnly={accountPhoneLocked}
                      aria-readonly={accountPhoneLocked}
                      placeholder="+255 712 345 678"
                      className={`w-full rounded-lg border-2 px-3 py-2.5 text-sm outline-none transition ${
                        touched.accountPhone && fieldErrors.accountPhone
                          ? 'border-red-300 bg-white focus:border-red-500 focus:ring-2 focus:ring-red-100'
                          : accountPhoneLocked
                            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-600'
                            : 'border-slate-200 bg-white hover:border-slate-300 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10'
                      }`}
                    />
                    {touched.accountPhone && fieldErrors.accountPhone ? (
                      <div className="mt-2 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none text-red-500" />
                        <span>{fieldErrors.accountPhone}</span>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-slate-500">
                        {accountPhoneLocked
                          ? 'Verified during registration. Change it later from Account Security.'
                          : 'Required when registration was completed by email.'}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      Date of birth
                      <span className="text-red-500">*</span>
                    </label>
                    <DatePickerField
                      label="Date of birth"
                      value={dateOfBirth}
                      onChangeAction={(nextIso) => {
                        setDateOfBirth(String(nextIso).split('T')[0]);
                        setTouched((prev) => ({ ...prev, dateOfBirth: true }));
                        setFieldErrors((prev) => ({ ...prev, dateOfBirth: '' }));
                      }}
                      max={todayIso()}
                      allowPast={true}
                      twoMonths={false}
                      widthClassName="w-full"
                      size="sm"
                    />
                    {touched.dateOfBirth && fieldErrors.dateOfBirth && (
                      <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                        <AlertCircle className="w-3 h-3" />
                        {fieldErrors.dateOfBirth}
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label htmlFor="gender-select" className="block text-sm font-semibold text-slate-900 mb-1.5">
                          Gender
                        </label>
                        <div className="relative">
                          <select 
                            id="gender-select" 
                            value={gender} 
                            onChange={e => setGender(e.target.value)} 
                            className="onboard-select w-full px-3 pr-10 py-2.5 border-2 border-slate-200 rounded-lg bg-white shadow-sm hover:shadow-md focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 transition-all duration-200 cursor-pointer text-sm"
                          >
                            <option value="">Select gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    <div>
                        <label htmlFor="nationality-select" className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                          <Globe className="w-3.5 h-3.5 text-slate-500" />
                          Nationality
                        </label>
                        <div className="relative">
                          <select 
                            id="nationality-select" 
                            value={nationality} 
                            onChange={e => setNationality(e.target.value)} 
                            className="onboard-select w-full px-3 pr-10 py-2.5 border-2 border-slate-200 rounded-lg bg-white shadow-sm hover:shadow-md focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 transition-all duration-200 cursor-pointer text-sm"
                          >
                        <option value="Tanzanian">Tanzanian</option>
                        <option value="Kenyan">Kenyan</option>
                        <option value="Ugandan">Ugandan</option>
                        <option value="Rwandese">Rwandese</option>
                        <option value="Burundian">Burundian</option>
                        <option value="Other">Other</option>
                      </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-slate-900 mb-1.5">
                          NIN <span className="text-slate-500 font-normal">(optional)</span>
                          <FieldBadge fk="nin" />
                        </label>
                        <input 
                          value={nin} 
                          disabled={isApproved('nin')}
                          onChange={e => setNin(e.target.value)} 
                          className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 ${fieldBorderClass('nin', false)} bg-white shadow-sm hover:shadow-md text-sm`}
                          placeholder="National ID number"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {stepIndex === 2 && (
                <div className={`space-y-5 rounded-2xl p-6 border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/60 shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 flex items-center justify-center ring-1 ring-[#02665e]/10">
                      <Truck className="w-5 h-5 text-[#02665e]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Driving Details</h3>
                      <p className="text-xs text-slate-500">Vehicle, licence, and operation information</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                  <div>
                      <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        License number
                        <span className="text-red-500">*</span>
                        <FieldBadge fk="licenseNumber" />
                      </label>
                      <input 
                        ref={licenseRef} 
                        value={licenseNumber} 
                        disabled={isApproved('licenseNumber')}
                        onChange={e => setLicenseNumber(e.target.value)} 
                        onBlur={() => { setTouched(prev => ({ ...prev, licenseNumber: true })); setFieldErrors(prev => ({ ...prev, licenseNumber: validateField('licenseNumber') })); }} 
                        className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 text-sm ${fieldBorderClass('licenseNumber', Boolean(touched.licenseNumber && fieldErrors.licenseNumber))} bg-white shadow-sm hover:shadow-md`}
                        placeholder="e.g., DL-12345"
                      />
                      {touched.licenseNumber && fieldErrors.licenseNumber && (
                        <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {fieldErrors.licenseNumber}
                        </div>
                      )}
                  </div>

                    <div>
                      <label className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <Truck className="w-3.5 h-3.5 text-slate-500" />
                        Type of vehicle
                        <span className="text-red-500">*</span>
                        <FieldBadge fk="vehicleType" />
                      </label>
                      <div ref={vehicleTypeRef} tabIndex={-1} className={`grid grid-cols-1 sm:grid-cols-3 gap-2 ${isApproved('vehicleType') ? 'pointer-events-none opacity-70' : ''}`}>
                        {[
                          { label: 'Bajaji', icon: Car },
                          { label: 'Bodaboda', icon: Icons.Bike },
                          { label: 'Vehicle', icon: Truck }
                        ].map(({ label, icon: Icon }) => (
                          <label 
                            key={label} 
                            className={`group relative flex items-center justify-center gap-2 px-4 py-3 rounded-lg cursor-pointer border-2 transition-all duration-200 ${
                              vehicleType === label 
                                ? 'bg-[#02665e] text-white border-[#02665e] shadow-md scale-105' 
                                : 'bg-white text-slate-700 border-slate-200 hover:border-[#02665e]/50 hover:shadow-md'
                            }`}
                          >
                            <input 
                              type="radio" 
                              name="vehicleType" 
                              checked={vehicleType === label} 
                              onChange={() => { setVehicleType(label); setTouched(prev => ({ ...prev, vehicleType: true })); setFieldErrors(prev => ({ ...prev, vehicleType: '' })); }} 
                              className="sr-only" 
                            />
                            <Icon className={`w-4 h-4 ${vehicleType === label ? 'text-white' : 'text-slate-400'}`} />
                            <span className="font-medium text-xs sm:text-sm">{label}</span>
                        </label>
                      ))}
                    </div>
                      {touched.vehicleType && fieldErrors.vehicleType && (
                        <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          {fieldErrors.vehicleType}
                        </div>
                      )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                          <FileText className="w-3.5 h-3.5 text-slate-500" />
                          Plate number
                          <span className="text-red-500">*</span>
                          <FieldBadge fk="plateNumber" />
                        </label>
                        <input 
                          ref={plateRef} 
                          value={plateNumber} 
                          disabled={isApproved('plateNumber')}
                          onChange={e => setPlateNumber(e.target.value)} 
                          onBlur={() => { setTouched(prev => ({ ...prev, plateNumber: true })); setFieldErrors(prev => ({ ...prev, plateNumber: validateField('plateNumber') })); }} 
                          className={`w-full px-3 py-2.5 border-2 rounded-lg transition-all duration-200 text-sm ${fieldBorderClass('plateNumber', Boolean(touched.plateNumber && fieldErrors.plateNumber))} bg-white shadow-sm hover:shadow-md`}
                          placeholder="Plate number"
                        />
                        {touched.plateNumber && fieldErrors.plateNumber && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.plateNumber}
                          </div>
                        )}
                    </div>
                    </div>

                  {/* Operation area — region / district / ward cascading dropdowns */}
                  <div className="space-y-3">
                    <label className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                      <MapPin className="w-3.5 h-3.5 text-slate-500" />
                      Operation / Parking area
                      <span className="text-red-500">*</span>
                    </label>
                    <p className="mt-1 text-xs text-slate-500">This is mandatory and is used for dispatching, compliance review, and location-based driver matching.</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      {/* Region */}
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Region</label>
                        <select
                          ref={regionRef}
                          value={driverRegion}
                          onChange={e => { setDriverRegion(e.target.value); setDriverDistrict(''); setOperationArea(''); setTouched(prev => ({ ...prev, driverRegion: true })); setFieldErrors(prev => ({ ...prev, driverRegion: '', driverDistrict: '', operationArea: '' })); }}
                          onBlur={() => { setTouched(prev => ({ ...prev, driverRegion: true })); setFieldErrors(prev => ({ ...prev, driverRegion: validateField('driverRegion') })); }}
                          className={`w-full px-3 py-2.5 border-2 rounded-lg bg-white text-sm focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 transition-all duration-200 cursor-pointer ${touched.driverRegion && fieldErrors.driverRegion ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200'}`}
                        >
                          <option value="">— Select region —</option>
                          {REGIONS.sort((a, b) => a.name.localeCompare(b.name)).map(r => (
                            <option key={r.id} value={r.name}>{r.name.charAt(0) + r.name.slice(1).toLowerCase().replace(/-/g, '-')}</option>
                          ))}
                        </select>
                        {touched.driverRegion && fieldErrors.driverRegion && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.driverRegion}
                          </div>
                        )}
                      </div>
                      {/* District */}
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">District</label>
                        <select
                          ref={districtRef}
                          value={driverDistrict}
                          onChange={e => { setDriverDistrict(e.target.value); setOperationArea(''); setTouched(prev => ({ ...prev, driverDistrict: true })); setFieldErrors(prev => ({ ...prev, driverDistrict: '', operationArea: '' })); }}
                          onBlur={() => { setTouched(prev => ({ ...prev, driverDistrict: true })); setFieldErrors(prev => ({ ...prev, driverDistrict: validateField('driverDistrict') })); }}
                          disabled={!driverRegion}
                          className={`w-full px-3 py-2.5 border-2 rounded-lg bg-white text-sm focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${touched.driverDistrict && fieldErrors.driverDistrict ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200'}`}
                        >
                          <option value="">— Select district —</option>
                          {driverRegion && (() => {
                            const region = REGIONS.find(r => r.name === driverRegion);
                            return (region?.districts ?? []).map((d: string) => (
                              <option key={d} value={d}>{d.charAt(0) + d.slice(1).toLowerCase()}</option>
                            ));
                          })()}
                        </select>
                        {touched.driverDistrict && fieldErrors.driverDistrict && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.driverDistrict}
                          </div>
                        )}
                      </div>
                      {/* Ward */}
                      <div>
                        <label className="text-xs font-medium text-slate-600 mb-1 block">Ward / Area</label>
                        <select
                          ref={operationAreaRef}
                          value={operationArea}
                          onChange={e => { setOperationArea(e.target.value); setTouched(prev => ({ ...prev, operationArea: true })); setFieldErrors(prev => ({ ...prev, operationArea: '' })); }}
                          onBlur={() => { setTouched(prev => ({ ...prev, operationArea: true })); setFieldErrors(prev => ({ ...prev, operationArea: validateField('operationArea') })); }}
                          disabled={!driverDistrict}
                          className={`w-full px-3 py-2.5 border-2 rounded-lg bg-white text-sm focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 transition-all duration-200 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${touched.operationArea && fieldErrors.operationArea ? 'border-red-300 focus:border-red-500 focus:ring-red-100' : 'border-slate-200'}`}
                        >
                          <option value="">— Select ward —</option>
                          {driverRegion && driverDistrict && (() => {
                            const rSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
                            const rd = REGIONS_FULL_DATA.find((r: any) => rSlug(r.name) === rSlug(driverRegion));
                            const dist = rd?.districts?.find((d: any) => d.name?.toUpperCase() === driverDistrict?.toUpperCase());
                            return (dist?.wards ?? []).map((w: any) => (
                              <option key={w.name} value={w.name}>{w.name.charAt(0) + w.name.slice(1).toLowerCase()}</option>
                            ));
                          })()}
                        </select>
                        {touched.operationArea && fieldErrors.operationArea && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.operationArea}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                    {/* VIP Vehicle Declaration */}
                    <div>
                      <label className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <Star className="w-3.5 h-3.5 text-amber-500" />
                        VIP Vehicle Class
                        <span className="text-xs font-normal text-slate-500">(optional)</span>
                      </label>
                      <label className={`flex items-start gap-4 p-4 rounded-xl cursor-pointer border-2 transition-all duration-200 ${
                        isVipDriver
                          ? 'bg-amber-50 border-amber-400 shadow-sm shadow-amber-100'
                          : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-sm'
                      }`}>
                        <input
                          type="checkbox"
                          checked={isVipDriver}
                          onChange={e => setIsVipDriver(e.target.checked)}
                          className="mt-0.5 w-4 h-4 rounded border-slate-300 accent-amber-500 cursor-pointer"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`text-sm font-semibold ${isVipDriver ? 'text-amber-800' : 'text-slate-900'}`}>
                              I declare this as a VIP class vehicle
                            </span>
                            {isVipDriver && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-700 text-xs font-semibold border border-amber-400/30">
                                <Star className="w-3 h-3 fill-amber-500" />
                                VIP
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-500 mt-1.5">
                            VIP vehicles are eligible for premium and first-class booking requests. Your VIP status will be reviewed and confirmed by our team.
                          </p>
                        </div>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {stepIndex === 3 && (
                <div className={`space-y-5 rounded-2xl p-6 border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/60 shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 flex items-center justify-center ring-1 ring-[#02665e]/10">
                      <CreditCard className="w-5 h-5 text-[#02665e]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-slate-900">Payment Details</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Provide a phone number used to receive payments (any supported mobile-money provider).</p>
                    </div>
                  </div>

                  <div className="space-y-4">
                  <div>
                      <label className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                        Payment phone
                        <span className="text-red-500">*</span>
                      </label>
                      <div className="relative min-w-0">
                        <div className="flex gap-2 items-stretch min-w-0">
                          <div className="relative flex-1 min-w-0">
                            <input 
                              ref={paymentRef} 
                              value={paymentPhone} 
                              onChange={e => { 
                              const val = e.target.value;
                              setPaymentPhone(val);
                              // Reset verification unless the new value already matches the account phone
                              // (the auto-verify useEffect will re-set it to true if they match)
                              if (!accountPhoneVerified || !accountPhone || normalizePhone(val.trim()) !== normalizePhone(accountPhone)) {
                                setPaymentVerified(false);
                                setPaymentSent(false);
                              }
                            }} 
                              onBlur={() => { setTouched(prev => ({ ...prev, paymentPhone: true })); setFieldErrors(prev => ({ ...prev, paymentPhone: validateField('paymentPhone') })); }} 
                              readOnly={paymentVerified} 
                              aria-readonly={paymentVerified} 
                              className={`w-full max-w-full px-3 py-2.5 text-sm border-2 rounded-lg transition-all duration-200 box-border ${
                                paymentVerified 
                                  ? 'bg-slate-50 text-slate-700 border-slate-200 pr-10' 
                                  : touched.paymentPhone && fieldErrors.paymentPhone
                                  ? 'border-red-300 focus:border-red-500 focus:ring-2 focus:ring-red-100'
                                  : 'border-slate-200 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10'
                              } bg-white shadow-sm hover:shadow-md focus:outline-none`}
                              placeholder="e.g., +255712345678"
                            />
                            {paymentVerified && (
                              <div className="absolute right-3 top-1/2 -translate-y-1/2 flex-shrink-0">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                              </div>
                            )}
                          </div>
                        {!paymentVerified && (
                            <button 
                              type="button" 
                              onClick={sendPaymentOtp} 
                              disabled={paymentLoading || !paymentPhone.trim()} 
                              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 flex-shrink-0 whitespace-nowrap ${
                                paymentSent 
                                  ? 'bg-slate-100 text-slate-700 cursor-not-allowed' 
                                  : paymentLoading || !paymentPhone.trim()
                                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  : 'bg-[#02665e] text-white hover:bg-[#02665e]/90 hover:shadow-md active:scale-95'
                              }`}
                            >
                              {paymentLoading ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                                  <span className="hidden sm:inline">Sending...</span>
                                </>
                              ) : paymentSent ? (
                                <>
                                  <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
                                  <span className="hidden sm:inline">Sent</span>
                                </>
                              ) : (
                                <>
                                  <Phone className="w-4 h-4 flex-shrink-0" />
                                  <span className="hidden sm:inline">Send code</span>
                                </>
                              )}
                            </button>
                        )}
                      </div>
                        {touched.paymentPhone && fieldErrors.paymentPhone && (
                          <div className="text-xs text-red-600 mt-2 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.paymentPhone}
                          </div>
                      )}
                    </div>
                    </div>

                    {paymentSent && !paymentVerified && (
                      <div className="p-4 bg-slate-50 border-2 border-slate-200 rounded-lg space-y-3">
                        <label className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                          <CreditCard className="w-3.5 h-3.5 text-slate-500" />
                          Enter verification code
                        </label>
                        <div className="flex gap-2 items-center flex-wrap">
                          <input 
                            ref={paymentOtpRef} 
                            inputMode="numeric" 
                            maxLength={6}
                            value={paymentOtp} 
                            onChange={e => setPaymentOtp(e.target.value.replace(/[^0-9]/g, ''))} 
                            className="flex-1 min-w-[140px] px-3 py-2.5 text-sm font-medium border-2 border-slate-200 rounded-lg bg-white shadow-sm hover:shadow-md focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 transition-all duration-200" 
                            placeholder="123456"
                          />
                          <button 
                            type="button" 
                            onClick={verifyPaymentOtp} 
                            disabled={paymentLoading || !paymentOtp.trim()} 
                            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 ${
                              paymentLoading || !paymentOtp.trim()
                                ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                : 'bg-[#02665e] text-white hover:bg-[#02665e]/90 hover:shadow-md active:scale-95'
                            }`}
                          >
                            {paymentLoading ? (
                              <>
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Verifying...</span>
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="w-4 h-4" />
                                <span>Verify</span>
                              </>
                            )}
                          </button>
                        </div>
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="text-xs text-slate-600 flex items-center gap-1">
                            {paymentCountdown > 0 ? (
                              <>
                                <Clock className="w-3.5 h-3.5" />
                                <span>Resend code in {paymentCountdown}s</span>
                              </>
                            ) : (
                              <button 
                                type="button" 
                                onClick={resendPaymentOtp} 
                                disabled={paymentLoading} 
                                className="text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium flex items-center gap-1"
                              >
                                <Phone className="w-3.5 h-3.5" />
                                <span>Resend code</span>
                              </button>
                            )}
                      </div>
                        </div>
                        {paymentMessage && (
                          <div className={`text-xs p-2 rounded-lg flex items-start gap-2 ${
                            paymentMessage.toLowerCase().includes('success') || paymentMessage.toLowerCase().includes('verified')
                              ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                              : 'bg-red-50 border border-red-200 text-red-700'
                          }`}>
                            {paymentMessage.toLowerCase().includes('success') || paymentMessage.toLowerCase().includes('verified') ? (
                              <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                            )}
                            <span className="flex-1">{paymentMessage}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {paymentVerified && (
                      accountPhoneVerified && accountPhone && normalizePhone(paymentPhone.trim()) === normalizePhone(accountPhone) ? (
                        <div className="p-3 bg-sky-50 border border-sky-200 rounded-lg flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-sky-700">Already verified. No code needed</p>
                            <p className="text-xs text-sky-600 mt-0.5">This is the same phone you used to create your account. It was already verified during registration.</p>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-emerald-700">Payment phone verified</p>
                            <p className="text-xs text-emerald-600">{paymentPhone}</p>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}

              {stepIndex === 4 && (
                <div className={`space-y-5 rounded-2xl p-6 border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/60 shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 flex items-center justify-center ring-1 ring-[#02665e]/10">
                      <Upload className="w-5 h-5 text-[#02665e]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-slate-900">Verification Documents</h3>
                      <p className="text-xs text-slate-500">Upload the complete verification pack that the admin team must review before approval.</p>
                    </div>
                  </div>

                  {/* Top-level flagged docs summary banner */}
                  {(['drivingLicense', 'nationalId', 'latra', 'insurance'] as const).some(k => kycFieldApprovals[k] === 'flagged') && (
                    <div className="flex items-start gap-3 px-4 py-3 bg-orange-50 border border-orange-300 rounded-xl">
                      <AlertTriangle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-sm font-bold text-orange-900">Some documents need to be re-uploaded</p>
                        <p className="text-xs text-orange-700 mt-0.5 leading-relaxed">
                          Our team reviewed your application and flagged the documents marked <span className="font-semibold">Update required</span> below. Please re-upload genuine, legible copies to continue.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-4">
                  <div className="rounded-xl border border-[#02665e]/15 bg-[#02665e]/[0.03] px-4 py-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <CheckCircle2 className="h-4.5 w-4.5" />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-slate-900">Documents required before admin review</p>
                        <p className="mt-1 text-xs leading-relaxed text-slate-600">
                          Driving licence, National ID, vehicle registration, and insurance must all be uploaded here. Admin approval is blocked until the full pack is available.
                        </p>
                      </div>
                    </div>
                  </div>
                  <div>
                      <label htmlFor="license-upload" className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-slate-500" />
                        Upload driving license
                        <span className="text-red-500">*</span>
                        <span className="text-xs font-normal text-slate-500">(jpg, png, pdf)</span>
                        <FieldBadge fk="drivingLicense" />
                      </label>
                      {kycFieldApprovals['drivingLicense'] === 'flagged' && (
                        <div className="mb-2 flex items-start gap-2 px-3 py-2.5 bg-orange-50 border border-orange-300 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-orange-800 font-medium leading-relaxed">
                            <span className="font-bold">Action required:</span> Our team reviewed your driving licence and found an issue — the image may be blurry, incomplete, or unreadable. Please re-upload a clear, fully visible copy.
                          </p>
                        </div>
                      )}
                      <div className="mb-3">
                        <label className="text-sm font-semibold text-slate-900 mb-1.5 flex items-center gap-2">
                          <Calendar className="w-3.5 h-3.5 text-slate-500" />
                          Licence expiry date
                          <span className="text-red-500">*</span>
                        </label>
                        <DatePickerField
                          label="Licence expiry date"
                          value={licenseExpiresOn}
                          onChangeAction={(nextIso) => setLicenseExpiresOn(String(nextIso).split('T')[0])}
                          min={todayIso()}
                          allowPast={false}
                          twoMonths={false}
                          widthClassName="w-full"
                          size="sm"
                        />
                        <p className="mt-2 text-xs text-slate-500">
                          This expiry date is stored with your licence for admin review.
                        </p>
                      </div>
                      <label htmlFor="license-upload" className={`flex flex-col items-center justify-center w-full px-4 py-6 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 group ${
                        kycFieldApprovals['drivingLicense'] === 'flagged'
                          ? 'border-orange-400 bg-orange-50/60 hover:bg-orange-50 hover:border-orange-500'
                          : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-[#02665e]'
                      }`}>
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Upload className="w-6 h-6 text-slate-400 group-hover:text-[#02665e] transition-colors" />
                          <p className="text-sm text-slate-600 group-hover:text-slate-900">
                            <span className="font-medium text-[#02665e]">Click to upload</span> or drag and drop
                          </p>
                          <p className="text-xs text-slate-500">JPG, PNG or PDF (MAX. 5MB)</p>
                  </div>
                        <input 
                          id="license-upload" 
                          type="file" 
                          accept="image/*,.pdf" 
                          onChange={e => setLicenseFile(e.target.files?.[0] ?? null)} 
                          className="hidden"
                        />
                      </label>
                      {(licenseFile || getSavedDriverDoc('DRIVER_LICENSE')?.url) && (
                        <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <span className="text-xs text-emerald-700 font-medium truncate">{getDocumentDisplayName('DRIVER_LICENSE', licenseFile) || 'Driving licence uploaded'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLicenseFile(null)}
                            className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"
                            aria-label="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                  <div>
                      <label htmlFor="id-upload" className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <IdIcon className="w-3.5 h-3.5 text-slate-500" />
                        Upload national ID
                        <span className="text-red-500">*</span>
                        <span className="text-xs font-normal text-slate-500">(jpg, png, pdf)</span>
                        <FieldBadge fk="nationalId" />
                      </label>
                      {kycFieldApprovals['nationalId'] === 'flagged' && (
                        <div className="mb-2 flex items-start gap-2 px-3 py-2.5 bg-orange-50 border border-orange-300 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-orange-800 font-medium leading-relaxed">
                            <span className="font-bold">Action required:</span> There is an issue with your National ID — it may be expired, unclear, or not matching our records. Please re-upload a valid, legible copy of your National ID.
                          </p>
                        </div>
                      )}
                      <label htmlFor="id-upload" className={`flex flex-col items-center justify-center w-full px-4 py-6 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 group ${
                        kycFieldApprovals['nationalId'] === 'flagged'
                          ? 'border-orange-400 bg-orange-50/60 hover:bg-orange-50 hover:border-orange-500'
                          : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-[#02665e]'
                      }`}>
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Upload className="w-6 h-6 text-slate-400 group-hover:text-[#02665e] transition-colors" />
                          <p className="text-sm text-slate-600 group-hover:text-slate-900">
                            <span className="font-medium text-[#02665e]">Click to upload</span> or drag and drop
                          </p>
                          <p className="text-xs text-slate-500">JPG, PNG or PDF (MAX. 5MB)</p>
                  </div>
                        <input 
                          id="id-upload" 
                          type="file" 
                          accept="image/*,.pdf" 
                          onChange={e => setIdFile(e.target.files?.[0] ?? null)} 
                          className="hidden"
                        />
                      </label>
                      {(idFile || getSavedDriverDoc('NATIONAL_ID')?.url) && (
                        <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <span className="text-xs text-emerald-700 font-medium truncate">{getDocumentDisplayName('NATIONAL_ID', idFile) || 'National ID uploaded'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIdFile(null)}
                            className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"
                            aria-label="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                  <div>
                      <label htmlFor="latra-upload" className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <Truck className="w-3.5 h-3.5 text-slate-500" />
                        Upload LATRA certificate
                        <span className="text-red-500">*</span>
                        <FieldBadge fk="latra" />
                      </label>
                      {kycFieldApprovals['latra'] === 'flagged' && (
                        <div className="mb-2 flex items-start gap-2 px-3 py-2.5 bg-orange-50 border border-orange-300 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-orange-800 font-medium leading-relaxed">
                            <span className="font-bold">Action required:</span> We could not verify your LATRA certificate — it may be missing, expired, or unreadable. Please upload a valid, in-date LATRA certificate to continue.
                          </p>
                        </div>
                      )}
                      <label htmlFor="latra-upload" className={`flex flex-col items-center justify-center w-full px-4 py-6 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 group ${
                        kycFieldApprovals['latra'] === 'flagged'
                          ? 'border-orange-400 bg-orange-50/60 hover:bg-orange-50 hover:border-orange-500'
                          : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-[#02665e]'
                      }`}>
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Upload className="w-6 h-6 text-slate-400 group-hover:text-[#02665e] transition-colors" />
                          <p className="text-sm text-slate-600 group-hover:text-slate-900">
                            <span className="font-medium text-[#02665e]">Click to upload</span> or drag and drop
                          </p>
                          <p className="text-xs text-slate-500">JPG, PNG or PDF (MAX. 5MB)</p>
                        </div>
                        <input 
                          id="latra-upload" 
                          type="file" 
                          accept="image/*,.pdf" 
                          onChange={e => setLatraFile(e.target.files?.[0] ?? null)} 
                          className="hidden"
                        />
                      </label>
                      {(latraFile || getSavedDriverDoc('VEHICLE_REGISTRATION')?.url) && (
                        <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <span className="text-xs text-emerald-700 font-medium truncate">{getDocumentDisplayName('VEHICLE_REGISTRATION', latraFile) || 'Vehicle registration uploaded'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLatraFile(null)}
                            className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"
                            aria-label="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>

                  <div>
                      <label htmlFor="insurance-upload" className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                        <Shield className="w-3.5 h-3.5 text-slate-500" />
                        Upload insurance certificate
                        <span className="text-red-500">*</span>
                        <FieldBadge fk="insurance" />
                      </label>
                      {kycFieldApprovals['insurance'] === 'flagged' && (
                        <div className="mb-2 flex items-start gap-2 px-3 py-2.5 bg-orange-50 border border-orange-300 rounded-lg">
                          <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-orange-800 font-medium leading-relaxed">
                            <span className="font-bold">Action required:</span> Your insurance certificate could not be verified — it may be expired, unclear, or the wrong document. Please re-upload a valid, current insurance certificate.
                          </p>
                        </div>
                      )}
                      <label htmlFor="insurance-upload" className={`flex flex-col items-center justify-center w-full px-4 py-6 border-2 border-dashed rounded-lg cursor-pointer transition-all duration-200 group ${
                        kycFieldApprovals['insurance'] === 'flagged'
                          ? 'border-orange-400 bg-orange-50/60 hover:bg-orange-50 hover:border-orange-500'
                          : 'border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-[#02665e]'
                      }`}>
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Upload className="w-6 h-6 text-slate-400 group-hover:text-[#02665e] transition-colors" />
                          <p className="text-sm text-slate-600 group-hover:text-slate-900">
                            <span className="font-medium text-[#02665e]">Click to upload</span> or drag and drop
                          </p>
                          <p className="text-xs text-slate-500">JPG, PNG or PDF (MAX. 5MB)</p>
                        </div>
                        <input
                          id="insurance-upload"
                          type="file"
                          accept="image/*,.pdf"
                          onChange={e => setInsuranceFile(e.target.files?.[0] ?? null)}
                          className="hidden"
                        />
                      </label>
                      {(insuranceFile || getSavedDriverDoc('INSURANCE')?.url) && (
                        <div className="mt-2 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            <span className="text-xs text-emerald-700 font-medium truncate">{getDocumentDisplayName('INSURANCE', insuranceFile) || 'Insurance certificate uploaded'}</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setInsuranceFile(null)}
                            className="text-emerald-600 hover:text-emerald-700 flex-shrink-0"
                            aria-label="Remove file"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {stepIndex === 5 && (
                <div className={`space-y-5 rounded-2xl p-6 border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/60 shadow-sm ring-1 ring-slate-900/5 transition-all duration-300 ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'}`}>
                  <div className="flex items-center gap-3 pb-4 border-b-2 border-slate-100">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#02665e]/10 to-[#02665e]/5 flex items-center justify-center ring-1 ring-[#02665e]/10">
                      <CheckCircle2 className="w-5 h-5 text-[#02665e]" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-lg font-bold text-slate-900">Review your details</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Confirm the information below before submitting your professional profile.</p>
                    </div>
                    <div className="hidden sm:flex items-center">
                      <span className="inline-flex items-center px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-semibold gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Ready to submit
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {/* Personal Details Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                        <User className="w-4 h-4 text-slate-500" />
                        <h4 className="text-sm font-semibold text-slate-900">Personal Details</h4>
                            </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <User className="w-3 h-3 text-slate-400" />
                              Full name
                              <span className="text-red-500">*</span>
                            </label>
                            <button type="button" onClick={() => setStepIndex(1)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                      </div>
                          <div className="text-sm text-slate-900 font-medium">{name || <span className="text-slate-400 italic">Not provided</span>}</div>
                          {touched.name && fieldErrors.name && (
                            <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {fieldErrors.name}
                            </div>
                          )}
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <Mail className="w-3 h-3 text-slate-400" />
                              Email
                              <span className="text-red-500">*</span>
                            </label>
                            <button type="button" onClick={() => setStepIndex(1)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                          </div>
                          <div className="text-sm text-slate-900 font-medium">{email || <span className="text-slate-400 italic">Not provided</span>}</div>
                          {touched.email && fieldErrors.email && (
                            <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {fieldErrors.email}
                      </div>
                          )}
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              Date of birth
                              <span className="text-red-500">*</span>
                            </label>
                            <button type="button" onClick={() => setStepIndex(1)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                          </div>
                          <div className="text-sm text-slate-900 font-medium">{dateOfBirth || <span className="text-slate-400 italic">Not provided</span>}</div>
                          {touched.dateOfBirth && fieldErrors.dateOfBirth && (
                            <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {fieldErrors.dateOfBirth}
                            </div>
                          )}
                        </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <UserCircle className="w-3 h-3 text-slate-400" />
                              Gender
                            </label>
                            <button type="button" onClick={() => setStepIndex(1)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                      </div>
                          <div className="text-sm text-slate-900 font-medium capitalize">{gender || <span className="text-slate-400 italic">—</span>}</div>
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <Globe className="w-3 h-3 text-slate-400" />
                              Nationality
                            </label>
                            <button type="button" onClick={() => setStepIndex(1)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                      </div>
                          <div className="text-sm text-slate-900 font-medium">{nationality || <span className="text-slate-400 italic">—</span>}</div>
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <CreditCard className="w-3 h-3 text-slate-400" />
                              NIN
                            </label>
                            <button type="button" onClick={() => setStepIndex(1)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                          </div>
                          <div className="text-sm text-slate-900 font-medium">{nin || <span className="text-slate-400 italic">—</span>}</div>
                        </div>
                      </div>
                    </div>

                    {/* Driving Details Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                        <Truck className="w-4 h-4 text-slate-500" />
                        <h4 className="text-sm font-semibold text-slate-900">Driving Details</h4>
                          </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <FileText className="w-3 h-3 text-slate-400" />
                              License number
                              <span className="text-red-500">*</span>
                            </label>
                            <button type="button" onClick={() => setStepIndex(2)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                      </div>
                          <div className="text-sm text-slate-900 font-medium">{licenseNumber || <span className="text-slate-400 italic">Not provided</span>}</div>
                          {touched.licenseNumber && fieldErrors.licenseNumber && (
                            <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {fieldErrors.licenseNumber}
                            </div>
                          )}
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <Car className="w-3 h-3 text-slate-400" />
                              Vehicle type
                              <span className="text-red-500">*</span>
                            </label>
                            <button type="button" onClick={() => setStepIndex(2)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                        </div>
                          <div className="text-sm text-slate-900 font-medium capitalize">{vehicleType || <span className="text-slate-400 italic">Not selected</span>}</div>
                          {touched.vehicleType && fieldErrors.vehicleType && (
                            <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {fieldErrors.vehicleType}
                      </div>
                          )}
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <Truck className="w-3 h-3 text-slate-400" />
                              Plate number
                              <span className="text-red-500">*</span>
                            </label>
                            <button type="button" onClick={() => setStepIndex(2)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                        </div>
                          <div className="text-sm text-slate-900 font-medium">{plateNumber || <span className="text-slate-400 italic">Not provided</span>}</div>
                          {touched.plateNumber && fieldErrors.plateNumber && (
                            <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {fieldErrors.plateNumber}
                      </div>
                          )}
                    </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <MapPin className="w-3 h-3 text-slate-400" />
                              Operation / Parking area
                            </label>
                            <button type="button" onClick={() => setStepIndex(2)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                          </div>
                          <div className="text-sm text-slate-900 font-medium">
                            {driverRegion ? (
                              <span>{driverRegion}{driverDistrict ? ` › ${driverDistrict}` : ''}{operationArea ? ` › ${operationArea}` : ''}</span>
                            ) : <span className="text-slate-400 italic">—</span>}
                          </div>
                        </div>

                        <div className={`p-3 border-2 rounded-lg transition-colors ${isVipDriver ? 'bg-amber-50 border-amber-300' : 'bg-white border-slate-200 hover:border-slate-300'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                              <Star className="w-3 h-3 text-amber-500" />
                              VIP Vehicle Class
                            </label>
                            <button type="button" onClick={() => setStepIndex(2)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                          </div>
                          <div className="flex items-center gap-1.5">
                            {isVipDriver ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-700 text-xs font-semibold border border-amber-400/30">
                                <Star className="w-3 h-3 fill-amber-500" />
                                VIP Declared
                              </span>
                            ) : (
                              <span className="text-sm text-slate-500 italic">Standard vehicle</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Payment Details Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                        <CreditCard className="w-4 h-4 text-slate-500" />
                        <h4 className="text-sm font-semibold text-slate-900">Payment Details</h4>
                        </div>
                      <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                            <Phone className="w-3 h-3 text-slate-400" />
                            Payment phone
                            <span className="text-red-500">*</span>
                          </label>
                          <div className="flex items-center gap-2">
                            {paymentVerified ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
                                <CheckCircle2 className="w-3 h-3" />
                                Verified
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-yellow-50 border border-yellow-200 text-yellow-700 text-xs font-medium">
                                <AlertCircle className="w-3 h-3" />
                                Not verified
                              </span>
                            )}
                            <button type="button" onClick={() => setStepIndex(3)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium">Edit</button>
                        </div>
                      </div>
                        <div className="text-sm text-slate-900 font-medium">{paymentPhone || <span className="text-slate-400 italic">Not provided</span>}</div>
                        {touched.paymentPhone && fieldErrors.paymentPhone && (
                          <div className="text-xs text-red-600 mt-1 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3" />
                            {fieldErrors.paymentPhone}
                          </div>
                        )}
                    </div>
                  </div>

                    {/* Uploaded Files Section */}
                    <div className="space-y-3">
                      <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                        <Upload className="w-4 h-4 text-slate-500" />
                        <h4 className="text-sm font-semibold text-slate-900">Uploaded Files</h4>
                        </div>
                      <div className="space-y-2">
                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                              <FileText className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-900">Driving license</div>
                              <div className="text-xs text-slate-500 truncate">{getDocumentDisplayName('DRIVER_LICENSE', licenseFile) || <span className="text-slate-400 italic">Not uploaded</span>}</div>
                              <div className="text-xs text-slate-500 mt-1">
                                Expiry: {licenseExpiresOn || getSavedDriverDoc('DRIVER_LICENSE')?.metadata?.expiresOn || <span className="text-slate-400 italic">Not provided</span>}
                              </div>
                            </div>
                          </div>
                          <button type="button" onClick={() => setStepIndex(4)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium flex-shrink-0 ml-2">Edit</button>
                      </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                              <IdIcon className="w-5 h-5 text-emerald-600" />
                        </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-900">National ID</div>
                              <div className="text-xs text-slate-500 truncate">{getDocumentDisplayName('NATIONAL_ID', idFile) || <span className="text-slate-400 italic">Not uploaded</span>}</div>
                            </div>
                          </div>
                          <button type="button" onClick={() => setStepIndex(4)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium flex-shrink-0 ml-2">Edit</button>
                      </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center flex-shrink-0">
                              <Truck className="w-5 h-5 text-amber-600" />
                        </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-900">LATRA certificate</div>
                              <div className="text-xs text-slate-500 truncate">{getDocumentDisplayName('VEHICLE_REGISTRATION', latraFile) || <span className="text-slate-400 italic">Not uploaded</span>}</div>
                            </div>
                          </div>
                          <button type="button" onClick={() => setStepIndex(4)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium flex-shrink-0 ml-2">Edit</button>
                        </div>

                        <div className="p-3 bg-white border-2 border-slate-200 rounded-lg hover:border-slate-300 transition-colors flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                              <Shield className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-semibold text-slate-900">Insurance certificate</div>
                              <div className="text-xs text-slate-500 truncate">{getDocumentDisplayName('INSURANCE', insuranceFile) || <span className="text-slate-400 italic">Not uploaded</span>}</div>
                            </div>
                          </div>
                          <button type="button" onClick={() => setStepIndex(4)} className="text-xs text-[#02665e] hover:text-[#02665e]/80 hover:underline font-medium flex-shrink-0 ml-2">Edit</button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Terms & Privacy Agreement — shown only on final review step */}
              {role === 'driver' && stepIndex === 5 && (
                <div className={`rounded-2xl border-2 p-5 transition-all duration-300 ${
                  agreedToTerms && agreedToPrivacy ? 'border-emerald-300 bg-emerald-50/60' : 'border-amber-300/60 bg-amber-50/40'
                }`}>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 rounded-lg bg-amber-400/15 flex items-center justify-center">
                      <CheckCircle2 className="w-4 h-4 text-amber-600" />
                    </div>
                    <h4 className="text-sm font-bold text-slate-900">Agreement required before submitting</h4>
                  </div>
                  <div className="space-y-3">

                    {/* Terms of Service */}
                    <div className={`rounded-xl border-2 px-4 py-3 transition-all duration-200 ${
                      agreedToTerms ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'
                    }`}>
                      <p className="text-sm text-slate-700 leading-relaxed mb-3">
                        I have read and agree to the{' '}
                        <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-[#02665e] font-semibold underline hover:text-[#02665e]/80">Terms of Service</a>.
                        {' '}I understand the driver responsibilities, conduct policies, and platform rules.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAgreedToTerms(v => !v)}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all duration-200 border-2 ${
                          agreedToTerms
                            ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600'
                            : 'bg-white border-[#02665e] text-[#02665e] hover:bg-[#02665e]/5'
                        }`}
                      >
                        {agreedToTerms
                          ? <><CheckCircle2 className="w-4 h-4" /> Agreed — Terms of Service</>
                          : <><CheckCircle2 className="w-4 h-4 opacity-40" /> Tap to agree — Terms of Service</>
                        }
                      </button>
                    </div>

                    {/* Privacy Policy */}
                    <div className={`rounded-xl border-2 px-4 py-3 transition-all duration-200 ${
                      agreedToPrivacy ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'
                    }`}>
                      <p className="text-sm text-slate-700 leading-relaxed mb-3">
                        I have read and accept the{' '}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-[#02665e] font-semibold underline hover:text-[#02665e]/80">Privacy Policy</a>.
                        {' '}I consent to my personal data and documents being processed for driver vetting.
                      </p>
                      <button
                        type="button"
                        onClick={() => setAgreedToPrivacy(v => !v)}
                        className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all duration-200 border-2 ${
                          agreedToPrivacy
                            ? 'bg-emerald-500 border-emerald-500 text-white hover:bg-emerald-600 hover:border-emerald-600'
                            : 'bg-white border-[#02665e] text-[#02665e] hover:bg-[#02665e]/5'
                        }`}
                      >
                        {agreedToPrivacy
                          ? <><CheckCircle2 className="w-4 h-4" /> Agreed — Privacy Policy</>
                          : <><CheckCircle2 className="w-4 h-4 opacity-40" /> Tap to agree — Privacy Policy</>
                        }
                      </button>
                    </div>

                  </div>
                  {(!agreedToTerms || !agreedToPrivacy) && (
                    <p className="mt-3 text-xs text-amber-700 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      You must agree to both before your application can be submitted for review.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  {stepIndex > 1 && (
                    <button 
                      type="button" 
                      onClick={() => setStepIndex(i => Math.max(1, i-1))} 
                      className="px-4 py-2 border-2 border-slate-300 rounded-lg bg-white text-slate-700 font-medium hover:bg-slate-50 hover:border-slate-400 transition-all duration-200 shadow-sm hover:shadow-md text-sm"
                    >
                      <span className="flex items-center gap-1.5">
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Back
                      </span>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {stepIndex < maxSteps ? (
                      <button
                        type="button"
                        onClick={handleNext}
                      disabled={!isStepValid() || checkingAccountPhone}
                      className={`px-6 py-2.5 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 text-sm ${
                        isStepValid() && !checkingAccountPhone
                          ? 'bg-[#02665e] hover:bg-[#014e47] text-white' 
                          : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                      }`}
                    >
                      <span className="flex items-center gap-1.5">
                        {checkingAccountPhone ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Checking details...
                          </>
                        ) : (
                          <>
                            Next
                            <ChevronRight className="w-3.5 h-3.5" />
                          </>
                        )}
                      </span>
                      </button>
                    ) : (
                    <button 
                      type="submit" 
                      disabled={loading || !isAllDriverStepsValid()} 
                      className={`px-6 py-2.5 rounded-lg font-semibold transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 disabled:transform-none disabled:hover:shadow-md text-sm ${
                        loading || !isAllDriverStepsValid()
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed opacity-60'
                          : 'bg-[#02665e] hover:bg-[#014e47] text-white'
                      }`}
                    >
                      {loading ? (
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {docUploadState ? `Uploading ${docUploadState.label.toLowerCase()}...` : 'Submitting application...'}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Submit for Review
                        </span>
                      )}
                    </button>
                    )}
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
