"use client";
// AdminPageHeader removed in favor of a centered, compact header for this page
import { Settings, ShieldCheck, Lock, AlertTriangle, Clock, CreditCard, Award, Crown, Bell, Flag, KeyRound, Globe, Gauge, Activity, FileText, CalendarClock, Gift, History } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeTrustedHtml } from "@/utils/html";
import { AnimatePresence, motion } from "framer-motion";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function SystemSettingsPage(){
  const inputClass =
    "w-full rounded-lg border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-inset focus:ring-[#02665e]/18";
  const toggleTrackClass =
    "relative h-6 w-11 shrink-0 rounded-full bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#02665e]/15 peer-checked:bg-[#02665e] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-200 after:bg-white after:transition-all peer-checked:after:translate-x-full";
  // Canonical button styles — every button on this page uses one of these so
  // radius (rounded-xl), padding, and weight stay consistent.
  const btnPrimary =
    "inline-flex items-center justify-center gap-2 rounded-lg bg-[#02665e] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all duration-200 hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 disabled:cursor-not-allowed disabled:opacity-60";
  const btnSecondary =
    "inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all duration-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#02665e]/15 disabled:cursor-not-allowed disabled:opacity-60";

  const formatMoney = (value: unknown) => {
    const currency = (s?.currency || 'TZS').toUpperCase();
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number' && Number.isFinite(value)) return `${value.toLocaleString()} ${currency}`;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return `${parsed.toLocaleString()} ${currency}`;
      return value;
    }
    return String(value);
  };

  const formatPercent = (value: unknown) => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'number' && Number.isFinite(value)) return `${value}%`;
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return `${parsed}%`;
      return value;
    }
    return String(value);
  };

  interface SystemSettings {
    commissionPercent: number;
    commissionCurrency: string;
    driverCommissionPercent: number;
    driverCommissionCurrency: string;
    agentCommissionPercent: number;
    agentCommissionCurrency: string;
    driverLevelGoldThreshold?: number;
    driverLevelDiamondThreshold?: number;
    referralCreditPercent?: number;
    taxPercent: number;
    currency: string;
    invoicePrefix: string;
    receiptPrefix: string;
    emailEnabled: boolean;
    smsEnabled: boolean;
    requireAdmin2FA: boolean;
    minPasswordLength: number;
    requirePasswordUppercase?: boolean;
    requirePasswordLowercase?: boolean;
    requirePasswordNumber?: boolean;
    requirePasswordSpecial?: boolean;
    sessionIdleMinutes: number;
    maxSessionDurationHours?: number;
    forceLogoutOnPasswordChange?: boolean;
    sessionMaxMinutesAdmin?: number | null;
    sessionMaxMinutesOwner?: number | null;
    sessionMaxMinutesDriver?: number | null;
    sessionMaxMinutesCustomer?: number | null;
    sessionMaxMinutesAgent?: number | null;
    ipAllowlist?: string | null;
    enableIpAllowlist?: boolean;
    apiRateLimitPerMinute?: number;
    maxLoginAttempts?: number;
    accountLockoutDurationMinutes?: number;
    enableSecurityAuditLogging?: boolean;
    logFailedLoginAttempts?: boolean;
    alertOnSuspiciousActivity?: boolean;
    supportEmail?: string | null;
    supportPhone?: string | null;
    featureFlags?: any;
    notificationTemplates?: any;
    invoiceTemplate?: string;
    payoutCron?: string;
  }

  type SessionPolicyAuditEntry = {
    id: string;
    createdAt: string;
    actorId: number | null;
    actorRole: string | null;
    actor: { id: number; email?: string | null; name?: string | null; role?: string | null } | null;
    ip: string | null;
    changes: Record<string, { from: any; to: any }> | null;
  };

  const [s,setS] = useState<SystemSettings>({
    commissionPercent: 0,
    commissionCurrency: 'TZS',
    driverCommissionPercent: 0,
    driverCommissionCurrency: 'TZS',
    agentCommissionPercent: 0,
    agentCommissionCurrency: 'USD',
    driverLevelGoldThreshold: 500000,
    driverLevelDiamondThreshold: 2000000,
    referralCreditPercent: 0.0035,
    taxPercent: 0,
    currency: 'TZS',
    invoicePrefix: 'INV-',
    receiptPrefix: 'RCT-',
    emailEnabled: true,
    smsEnabled: false,
    requireAdmin2FA: true,
    minPasswordLength: 10,
    requirePasswordUppercase: false,
    requirePasswordLowercase: false,
    requirePasswordNumber: false,
    requirePasswordSpecial: false,
    sessionIdleMinutes: 60,
    maxSessionDurationHours: 24,
    forceLogoutOnPasswordChange: true,
    sessionMaxMinutesAdmin: null,
    sessionMaxMinutesOwner: null,
    sessionMaxMinutesDriver: null,
    sessionMaxMinutesCustomer: null,
    sessionMaxMinutesAgent: null,
    ipAllowlist: null,
    enableIpAllowlist: false,
    apiRateLimitPerMinute: 100,
    maxLoginAttempts: 5,
    accountLockoutDurationMinutes: 30,
    enableSecurityAuditLogging: true,
    logFailedLoginAttempts: true,
    alertOnSuspiciousActivity: false,
  });
  const [loading, setLoading] = useState<boolean>(true);
  // Local-only fields (feature flags / templates) kept in local state; backend integration can be added later
  const [featureFlags, setFeatureFlags] = useState<string>('{}');
  const [notificationTemplates, setNotificationTemplates] = useState<string>('{}');
  const [invoiceTemplate, setInvoiceTemplate] = useState<string>('');
  const [payoutCron, setPayoutCron] = useState<string>('');
  const [invoicePreviewHtml, setInvoicePreviewHtml] = useState<string>('');
  const [bonusOwnerId, setBonusOwnerId] = useState<string>('');
  const [bonusPercentInput, setBonusPercentInput] = useState<number>(0);
  const [bonusPreview, setBonusPreview] = useState<any>(null);
  const [bonusOwnerLookup, setBonusOwnerLookup] = useState<{ id: number; name?: string | null; email?: string | null } | null>(null);
  const [bonusOwnerLookupLoading, setBonusOwnerLookupLoading] = useState<boolean>(false);
  const [bonusOwnerLookupError, setBonusOwnerLookupError] = useState<string | null>(null);
  const lastAutoPreviewKeyRef = useRef<string>('');
  const autoPreviewTimerRef = useRef<number | null>(null);
  // support contact (editable by admin)
  const [supportEmail, setSupportEmail] = useState<string>('');
  const [supportPhone, setSupportPhone] = useState<string>('');
  // Referral credit is stored as a decimal fraction (0.0035), but shown to the admin
  // as a percentage (0.35) for readability.
  const [referralPercentInput, setReferralPercentInput] = useState<string>('');

  const [toast, setToast] = useState<string | null>(null);
  const [savedCard, setSavedCard] = useState<boolean>(false);
  const [sessionPolicyAudit, setSessionPolicyAudit] = useState<SessionPolicyAuditEntry[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<boolean>(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [tierLadder, setTierLadder] = useState<Record<string, Record<string, number>>>({});
  const [tierDefaults, setTierDefaults] = useState<Record<string, Record<string, number>>>({});
  const [tierErrors, setTierErrors] = useState<Record<string, string>>({});
  const [savingTiers, setSavingTiers] = useState<boolean>(false);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!savedCard) return;
    const t = window.setTimeout(() => setSavedCard(false), 5000);
    return () => window.clearTimeout(t);
  }, [savedCard]);

  const load = useCallback(async ()=>{
    try {
      setLoading(true);
      const r = await api.get('/api/admin/settings');
      if (r?.data) setS(r.data);
    } finally {
      setLoading(false);
    }
  },[]);

  const loadSessionPolicyAudit = useCallback(async ()=>{
    try {
      // Add cache-busting to ensure fresh audit data
      const r = await api.get('/api/admin/settings/audit/session-policy', {
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        params: {
          _t: Date.now(), // timestamp cache buster
        },
      });
      const items = Array.isArray(r?.data) ? r.data : [];
      setSessionPolicyAudit(items);
    } catch {
      // non-fatal
    }
  }, []);

  useEffect(()=>{ load(); },[load]);
  useEffect(()=>{ loadSessionPolicyAudit(); },[loadSessionPolicyAudit]);

  // sync some fields from s
  useEffect(()=>{
    if (!s) return;
    setFeatureFlags(JSON.stringify(s.featureFlags ?? {}, null, 2));
    setNotificationTemplates(JSON.stringify(s.notificationTemplates ?? {}, null, 2));
    setInvoiceTemplate(s.invoiceTemplate ?? '');
    setPayoutCron(s.payoutCron ?? '');
    setSupportEmail(s.supportEmail ?? '');
    setSupportPhone(s.supportPhone ?? '');
    setReferralPercentInput(s.referralCreditPercent != null ? String(Number(s.referralCreditPercent) * 100) : '');
    if ((s as any).agentTierLadder) setTierLadder((s as any).agentTierLadder);
    if ((s as any).agentTierLadderDefaults) setTierDefaults((s as any).agentTierLadderDefaults);
  }, [s]);

  const setTierField = (tier: string, field: string, value: string) => {
    setTierLadder((prev) => ({ ...prev, [tier]: { ...(prev[tier] || {}), [field]: Number(value) } }));
  };

  const saveTierLadder = async () => {
    setSavingTiers(true);
    setTierErrors({});
    try {
      await api.put('/api/admin/settings', { agentTierLadder: tierLadder });
      setToast('Operator tiers saved');
      setSavedCard(true);
      await load();
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (Array.isArray(details)) {
        const map: Record<string, string> = {};
        for (const d of details) map[d.field] = d.message;
        setTierErrors(map);
        setToast('Fix the highlighted tier values');
      } else {
        setToast(e?.response?.data?.message || 'Failed to save operator tiers');
      }
    } finally {
      setSavingTiers(false);
    }
  };

  // show a subtle loading hint while fetching but keep the form visible

  // CIDR validation helper
  function isValidCIDR(cidr: string): boolean {
    const cidrRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}\/([0-9]|[12][0-9]|3[0-2])$/;
    if (!cidrRegex.test(cidr.trim())) return false;
    const [ip, prefix] = cidr.split('/');
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4) return false;
    if (parts.some(p => p < 0 || p > 255)) return false;
    if (Number(prefix) < 0 || Number(prefix) > 32) return false;
    return true;
  }

  function validateIPAllowlist(value: string): { valid: boolean; error?: string } {
    if (!value || value.trim() === '') return { valid: true };
    const entries = value.split(',').map(s => s.trim()).filter(s => s);
    for (const entry of entries) {
      if (!isValidCIDR(entry)) {
        return { valid: false, error: `Invalid CIDR format: "${entry}". Use format like 192.168.1.0/24` };
      }
    }
    return { valid: true };
  }

  const validateField = (field: string, value: any): string | null => {
    // Skip validation for undefined/null values (they'll use defaults)
    if (value === undefined || value === null || value === '') {
      return null;
    }

    switch (field) {
      case 'ipAllowlist':
        const ipValidation = validateIPAllowlist(String(value || ''));
        if (!ipValidation.valid) return ipValidation.error || 'Invalid IP allowlist format';
        break;
      case 'minPasswordLength':
        const minLen = Number(value);
        if (isNaN(minLen) || minLen < 6 || minLen > 128) {
          return 'Password length must be between 6 and 128 characters';
        }
        break;
      case 'sessionIdleMinutes':
        const idle = Number(value);
        if (isNaN(idle) || idle < 5 || idle > 1440) {
          return 'Session idle timeout must be between 5 and 1440 minutes';
        }
        break;
      case 'maxSessionDurationHours':
        const duration = Number(value);
        if (isNaN(duration) || duration < 1 || duration > 720) {
          return 'Max session duration must be between 1 and 720 hours';
        }
        break;
      case 'apiRateLimitPerMinute':
        const rateLimit = Number(value);
        if (isNaN(rateLimit) || rateLimit < 10 || rateLimit > 10000) {
          return 'API rate limit must be between 10 and 10000 requests per minute';
        }
        break;
      case 'maxLoginAttempts':
        const attempts = Number(value);
        if (isNaN(attempts) || attempts < 3 || attempts > 20) {
          return 'Max login attempts must be between 3 and 20';
        }
        break;
      case 'accountLockoutDurationMinutes':
        const lockout = Number(value);
        if (isNaN(lockout) || lockout < 5 || lockout > 1440) {
          return 'Account lockout duration must be between 5 and 1440 minutes';
        }
        break;
    }
    return null;
  };

  const saveSystemSettings = async () => {
    // Validate all fields before saving - use actual values or defaults
    const errors: Record<string, string> = {};
    
    // Validate with actual values (using defaults if not set)
    const valuesToValidate = {
      ipAllowlist: s.ipAllowlist || '',
      minPasswordLength: s.minPasswordLength ?? 10,
      sessionIdleMinutes: s.sessionIdleMinutes ?? 60,
      maxSessionDurationHours: s.maxSessionDurationHours ?? 24,
      apiRateLimitPerMinute: s.apiRateLimitPerMinute ?? 100,
      maxLoginAttempts: s.maxLoginAttempts ?? 5,
      accountLockoutDurationMinutes: s.accountLockoutDurationMinutes ?? 30,
    };
    
    // Only validate ipAllowlist if it has a value (it's optional)
    if (valuesToValidate.ipAllowlist && valuesToValidate.ipAllowlist.trim() !== '') {
      const error = validateField('ipAllowlist', valuesToValidate.ipAllowlist);
      if (error) errors.ipAllowlist = error;
    }
    
    // Validate numeric fields
    const numericFields: Array<keyof typeof valuesToValidate> = [
      'minPasswordLength', 'sessionIdleMinutes', 'maxSessionDurationHours',
      'apiRateLimitPerMinute', 'maxLoginAttempts', 'accountLockoutDurationMinutes'
    ];
    
    numericFields.forEach(field => {
      const error = validateField(field, valuesToValidate[field]);
      if (error) errors[field] = error;
    });

    // Driver level + referral business config (mirrors server-side rules so the
    // admin sees the problem inline instead of bouncing off a 400).
    const goldVal = Number(s.driverLevelGoldThreshold ?? 0);
    const diamondVal = Number(s.driverLevelDiamondThreshold ?? 0);
    if (!Number.isFinite(goldVal) || goldVal < 0) {
      errors.driverLevelGoldThreshold = 'Enter a non-negative amount (TZS).';
    }
    if (!Number.isFinite(diamondVal) || diamondVal < 0) {
      errors.driverLevelDiamondThreshold = 'Enter a non-negative amount (TZS).';
    } else if (Number.isFinite(goldVal) && diamondVal < goldVal) {
      errors.driverLevelDiamondThreshold = 'Diamond threshold must be ≥ Gold threshold.';
    }
    if (referralPercentInput.trim() !== '') {
      const refPct = Number(referralPercentInput);
      if (!Number.isFinite(refPct) || refPct < 0 || refPct > 100) {
        errors.referralCreditPercent = 'Enter a percentage between 0 and 100.';
      }
    }

    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      const errorMessages = Object.values(errors);
      setToast(`Please fix validation errors: ${errorMessages[0]}${errorMessages.length > 1 ? ` (+${errorMessages.length - 1} more)` : ''}`);
      return;
    }
    
    setValidationErrors({});
    // only send fields that exist on SystemSetting model
  const payload: any = {
      commissionPercent: Number(s.commissionPercent ?? 0),
      commissionCurrency: s.commissionCurrency || 'TZS',
      driverCommissionPercent: Number(s.driverCommissionPercent ?? 0),
      driverCommissionCurrency: s.driverCommissionCurrency || 'TZS',
      agentCommissionPercent: Number(s.agentCommissionPercent ?? 0),
      agentCommissionCurrency: s.agentCommissionCurrency || 'USD',
      taxPercent: Number(s.taxPercent ?? 0),
      currency: s.currency || 'TZS',
      invoicePrefix: s.invoicePrefix || 'INV-',
      receiptPrefix: s.receiptPrefix || 'RCT-',
      emailEnabled: Boolean(s.emailEnabled),
      smsEnabled: Boolean(s.smsEnabled),
      requireAdmin2FA: Boolean(s.requireAdmin2FA),
      minPasswordLength: Number(s.minPasswordLength || 10),
      requirePasswordUppercase: Boolean(s.requirePasswordUppercase ?? false),
      requirePasswordLowercase: Boolean(s.requirePasswordLowercase ?? false),
      requirePasswordNumber: Boolean(s.requirePasswordNumber ?? false),
      requirePasswordSpecial: Boolean(s.requirePasswordSpecial ?? false),
  sessionIdleMinutes: Number(s.sessionIdleMinutes || 60),
  maxSessionDurationHours: Number(s.maxSessionDurationHours || 24),
  forceLogoutOnPasswordChange: Boolean(s.forceLogoutOnPasswordChange ?? true),
  sessionMaxMinutesAdmin: (s.sessionMaxMinutesAdmin == null || Number(s.sessionMaxMinutesAdmin) <= 0) ? null : Number(s.sessionMaxMinutesAdmin),
  sessionMaxMinutesOwner: (s.sessionMaxMinutesOwner == null || Number(s.sessionMaxMinutesOwner) <= 0) ? null : Number(s.sessionMaxMinutesOwner),
  sessionMaxMinutesDriver: (s.sessionMaxMinutesDriver == null || Number(s.sessionMaxMinutesDriver) <= 0) ? null : Number(s.sessionMaxMinutesDriver),
  sessionMaxMinutesCustomer: (s.sessionMaxMinutesCustomer == null || Number(s.sessionMaxMinutesCustomer) <= 0) ? null : Number(s.sessionMaxMinutesCustomer),
  sessionMaxMinutesAgent: (s.sessionMaxMinutesAgent == null || Number(s.sessionMaxMinutesAgent) <= 0) ? null : Number(s.sessionMaxMinutesAgent),
  ipAllowlist: s.ipAllowlist || null,
  enableIpAllowlist: Boolean(s.enableIpAllowlist ?? false),
  apiRateLimitPerMinute: Number(s.apiRateLimitPerMinute || 100),
  maxLoginAttempts: Number(s.maxLoginAttempts || 5),
  accountLockoutDurationMinutes: Number(s.accountLockoutDurationMinutes || 30),
  enableSecurityAuditLogging: Boolean(s.enableSecurityAuditLogging ?? true),
  logFailedLoginAttempts: Boolean(s.logFailedLoginAttempts ?? true),
  alertOnSuspiciousActivity: Boolean(s.alertOnSuspiciousActivity ?? false),
  supportEmail: supportEmail || s.supportEmail,
  supportPhone: supportPhone || s.supportPhone,
  driverLevelGoldThreshold: Number(s.driverLevelGoldThreshold ?? 500000),
  driverLevelDiamondThreshold: Number(s.driverLevelDiamondThreshold ?? 2000000),
  // Convert the percentage shown in the UI back to a decimal fraction for storage.
  referralCreditPercent: referralPercentInput.trim() === ''
    ? (s.referralCreditPercent ?? 0.0035)
    : Number(referralPercentInput) / 100,
    };
    setSaving(true);
    try {
      await api.put('/api/admin/settings', payload);
      setSavedCard(true);
      setLastSavedAt(new Date());
      await load();
      await loadSessionPolicyAudit();
    } catch (err: any) {
      console.error(err);
      const details = err?.response?.data?.details;
      if (Array.isArray(details) && details.length) {
        // Surface each field error inline next to its input.
        const map: Record<string, string> = {};
        for (const d of details) if (d?.field) map[d.field] = d.message;
        setValidationErrors(map);
        setToast(details[0]?.message || 'Please fix the highlighted fields');
      } else {
        setToast(err?.response?.data?.message || 'Failed to save system settings');
      }
    } finally {
      setSaving(false);
    }
  };

  const saveFlagsAndTemplates = async () => {
    // For now we don't persist feature flags/templates in SystemSetting; backend work needed
    setToast('Feature flags & templates saving needs backend support. This is a client-only preview.');
  };

  const saveInvoicingSettings = async () => {
    // Save taxPercent and invoicePrefix (persisted via SystemSetting) and keep invoiceTemplate client-side
    try {
      await api.put('/api/admin/settings', { taxPercent: Number(s.taxPercent || 0), invoicePrefix: s.invoicePrefix || 'INV-' });
      setToast('Invoicing settings saved');
    } catch (err) {
      console.error(err);
      setToast('Failed to save invoicing settings');
    }
  };

  const previewBonus = useCallback(async () => {
    const ownerId = Number(bonusOwnerId);
    if (!Number.isFinite(ownerId) || ownerId <= 0) {
      setToast('Valid Owner ID is required');
      return;
    }
    if (!Number.isFinite(bonusPercentInput) || bonusPercentInput < 0) {
      setToast('Valid Bonus (%) is required');
      return;
    }
    try {
      const r = await api.post('/admin/bonuses/grant', { ownerId, bonusPercent: Number(bonusPercentInput) });
      setBonusPreview(r.data);
    } catch (err) {
      console.error(err);
      setToast('Failed to preview bonus');
    }
  }, [bonusOwnerId, bonusPercentInput]);

  const grantBonus = async () => {
    const ownerId = Number(bonusOwnerId);
    if (!Number.isFinite(ownerId) || ownerId <= 0) {
      setToast('Valid Owner ID is required');
      return;
    }
    if (!Number.isFinite(bonusPercentInput) || bonusPercentInput < 0) {
      setToast('Valid Bonus (%) is required');
      return;
    }
    if (!confirm('Grant bonus to owner? This action will be recorded in the admin audit log.')) return;
    try {
      const r = await api.post('/admin/bonuses/grant', { ownerId, bonusPercent: Number(bonusPercentInput), reason: 'Manual grant from settings UI' });
      setBonusPreview(r.data);
      setToast('Bonus grant recorded (audit only)');
    } catch (err) {
      console.error(err);
      setToast('Failed to grant bonus');
    }
  };

  // Auto-detect owner from pasted/typed Owner ID
  useEffect(() => {
    const ownerId = Number(bonusOwnerId);
    setBonusOwnerLookup(null);
    setBonusOwnerLookupError(null);
    if (!Number.isFinite(ownerId) || ownerId <= 0) return;

    let cancelled = false;
    setBonusOwnerLookupLoading(true);

    (async () => {
      try {
        const r = await api.get<{ owner?: { id: number; name?: string | null; email?: string | null } }>(`/api/admin/owners/${ownerId}`);
        if (cancelled) return;
        const owner = (r.data as any)?.owner;
        if (!owner?.id) {
          setBonusOwnerLookup(null);
          setBonusOwnerLookupError('Owner not found');
          return;
        }
        setBonusOwnerLookup({ id: owner.id, name: owner.name ?? null, email: owner.email ?? null });
      } catch (err) {
        if (cancelled) return;
        setBonusOwnerLookup(null);
        setBonusOwnerLookupError('Owner not found');
      } finally {
        if (!cancelled) setBonusOwnerLookupLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [bonusOwnerId]);

  // Auto-preview bonus once we have a valid owner (debounced)
  useEffect(() => {
    const ownerId = Number(bonusOwnerId);
    if (!Number.isFinite(ownerId) || ownerId <= 0) return;
    if (!bonusOwnerLookup?.id || bonusOwnerLookup.id !== ownerId) return;
    if (!Number.isFinite(bonusPercentInput) || bonusPercentInput < 0) return;

    const key = `${ownerId}:${bonusPercentInput}`;
    if (key === lastAutoPreviewKeyRef.current) return;

    if (autoPreviewTimerRef.current) window.clearTimeout(autoPreviewTimerRef.current);
    autoPreviewTimerRef.current = window.setTimeout(() => {
      lastAutoPreviewKeyRef.current = key;
      void previewBonus();
    }, 450);

    return () => {
      if (autoPreviewTimerRef.current) window.clearTimeout(autoPreviewTimerRef.current);
    };
  }, [bonusOwnerId, bonusPercentInput, bonusOwnerLookup?.id, previewBonus]);

  const previewInvoice = async () => {
    try {
      const r = await api.post('/admin/settings/numbering/preview', { type: 'invoice' });
      const sample = r.data?.sample || '';
      // simple preview using invoiceTemplate + sample number
      const rawPreview = (invoiceTemplate || '<div>Invoice {{invoiceNumber}}</div>').replace(/{{\s*invoiceNumber\s*}}/g, sample);
      setInvoicePreviewHtml(sanitizeTrustedHtml(rawPreview));
      setToast('Invoice preview generated');
    } catch (err) {
      console.error(err);
      setToast('Failed to generate preview');
    }
  };

  const updatePayoutCron = async () => {
    setToast('Saving cron expressions requires backend support; not implemented yet.');
  };
  return (
    <div className="bg-slate-50 min-h-screen">
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className="fixed top-4 z-50 left-4 right-4 sm:left-auto sm:right-4 sm:w-[28rem]"
          >
            <div className="w-full max-w-full break-words rounded-2xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-xl ring-1 ring-white/10">
              {toast}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Centered save-success card */}
      <AnimatePresence>
        {savedCard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4"
            onClick={() => setSavedCard(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.92, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 16 }}
              transition={{ duration: 0.22, ease: "easeOut" }}
              className="w-full max-w-sm rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200/60 overflow-hidden"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex flex-col items-center gap-4 px-8 py-8 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[#02665e]/10">
                  <svg className="h-8 w-8 text-[#02665e]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <p className="text-lg font-bold text-slate-900">Settings Saved</p>
                  <p className="mt-1 text-sm text-slate-500">All changes have been applied and the audit record has been updated.</p>
                  {lastSavedAt && (
                    <p className="mt-2 text-xs text-slate-400">Saved at {lastSavedAt.toLocaleTimeString()}</p>
                  )}
                </div>
                <button
                  onClick={() => setSavedCard(false)}
                  className="mt-1 w-full rounded-lg bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#015b54] transition-colors"
                >
                  Done
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-auto w-full max-w-4xl px-4 py-6 pb-6 sm:px-6 lg:px-8">
        <div className="space-y-5 flex flex-col">

          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl border border-slate-200/60 bg-white/70 shadow-sm backdrop-blur">
            <div className="absolute inset-0 bg-gradient-to-br from-slate-50 via-white to-slate-50 pointer-events-none" />
            <div className="relative flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between sm:p-8">
              <div className="flex items-center gap-4">
                <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-[#02665e]/10 to-slate-50 border border-slate-200/60 flex items-center justify-center shrink-0 shadow-sm">
                  <Settings className="h-7 w-7 text-[#02665e]" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">System Settings</h1>
                  <p className="mt-0.5 text-sm text-slate-600">Platform configuration and security controls.</p>
                  {loading && <p className="mt-1 text-xs text-[#02665e] animate-pulse">Syncing latest settings...</p>}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {lastSavedAt && (
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#02665e]/20 bg-[#02665e]/[0.07] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" />
                    Saved {lastSavedAt.toLocaleTimeString()}
                  </span>
                )}
                <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-slate-400">
                  <Lock className="h-3.5 w-3.5" />
                  Save bar pinned below
                </span>
              </div>
            </div>
          </div>

          {/* Settings Audit Trail — pinned to the bottom via order-last */}
          <div className="order-last bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              {/* Header */}
              <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                    <History className="h-5 w-5 text-violet-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Settings Audit Trail</h3>
                    <p className="text-sm text-slate-500">Who changed what and when.</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {sessionPolicyAudit.length > 0 && (
                    <span className="inline-flex items-center rounded-xl bg-violet-50 border border-violet-200 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-violet-700">
                      {sessionPolicyAudit.length}
                    </span>
                  )}
                  <button onClick={loadSessionPolicyAudit} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold uppercase tracking-[0.10em] text-slate-600 shadow-sm transition hover:bg-slate-50 active:scale-95" type="button">
                    Refresh
                  </button>
                </div>
              </div>

              {sessionPolicyAudit.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-slate-200 bg-slate-50 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-400">No audit entries yet.</p>
                  <p className="mt-1 text-xs text-slate-300">Save settings above to start recording changes.</p>
                </div>
              ) : (
                <div className="rounded-[14px] border border-slate-100 overflow-hidden divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
                  {sessionPolicyAudit.map((row, idx) => {
                    const isLatest = idx === 0;
                    const isSession = (row as any).action === 'ADMIN_SESSION_POLICY_UPDATE';
                    const actorName = row.actor?.name || row.actor?.email || row.actorRole || 'Admin';
                    const changedEntries = row.changes ? Object.entries(row.changes).filter(([, v]) => String(v?.from ?? '') !== String(v?.to ?? '')) : [];
                    return (
                      <div key={row.id} className={`px-4 py-3 ${isLatest ? 'bg-violet-50/50' : 'bg-white hover:bg-slate-50/60'} transition-colors`}>
                        {/* Top row: timestamp + actor + badges */}
                        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                          <div className="flex flex-wrap items-center gap-2 min-w-0">
                            {isLatest && <span className="shrink-0 rounded bg-violet-500 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Latest</span>}
                            <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${isSession ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-500'}`}>
                              {isSession ? 'Session' : 'General'}
                            </span>
                            <span className="text-xs font-semibold text-slate-700 tabular-nums">
                              {new Date(row.createdAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-slate-500">{actorName}{row.actorId ? <span className="text-slate-400"> #{row.actorId}</span> : null}</span>
                            {row.ip && <span className="hidden sm:inline text-[10px] text-slate-300 tabular-nums">{row.ip}</span>}
                          </div>
                        </div>

                        {/* Changed fields — inline pills, max 4 shown then "+N more" */}
                        {changedEntries.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            {changedEntries.slice(0, 4).map(([k, v]) => (
                              <span key={k} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] text-slate-600">
                                <span className={`font-semibold ${isLatest ? 'text-violet-600' : 'text-[#02665e]'}`}>{k}</span>
                                <span className="text-slate-300 mx-0.5">·</span>
                                <span className="text-red-400 line-through">{String(v?.from ?? '—')}</span>
                                <span className="text-slate-300 mx-0.5">→</span>
                                <span className="text-emerald-600 font-semibold">{String(v?.to ?? '—')}</span>
                              </span>
                            ))}
                            {changedEntries.length > 4 && (
                              <span className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-400">
                                +{changedEntries.length - 4} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Payments */}
          <section id="payments" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center shrink-0">
                    <CreditCard className="h-5 w-5 text-[#02665e]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Payments</h3>
                    <p className="text-sm text-slate-500">Platform fee and currency formatting.</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Property Commission */}
                <div className="flex h-full min-w-0 flex-col rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
                  <div className="mb-4 min-h-[52px]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Property Commission</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">Charged to property owners on accommodation bookings.</p>
                  </div>
                  <div className="mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rate</p>
                      <div className="flex overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-sm focus-within:border-[#02665e]/50 focus-within:ring-2 focus-within:ring-[#02665e]/15">
                        <input
                          id="commissionPercent"
                          type="number" min={0} max={100} step="0.01" inputMode="decimal" placeholder="10"
                          value={s?.commissionPercent ?? 0}
                          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300"
                          onChange={e=>setS((prev: any)=>({...(prev||{}), commissionPercent: Number(e.target.value)}))}
                        />
                        <div className="flex shrink-0 items-center border-l border-slate-100 bg-[#02665e]/8 px-2.5 text-xs font-bold text-[#02665e]">%</div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Currency</p>
                      <select
                        aria-label="Property commission currency"
                        className="box-border w-full min-w-0 rounded-[10px] border border-slate-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-slate-800 outline-none focus:border-[#02665e]/50 focus:ring-2 focus:ring-[#02665e]/15"
                        value={s?.commissionCurrency || 'TZS'}
                        onChange={e=>setS((prev: any)=>({...(prev||{}), commissionCurrency: e.target.value}))}
                      >
                        <option value="TZS">TZS</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="KSH">KSH</option>
                        <option value="AED">AED</option>
                      </select>
                    </div>
                  </div>
                </div>
                {/* Driver Commission */}
                <div className="flex h-full min-w-0 flex-col rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
                  <div className="mb-4 min-h-[52px]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Driver Commission</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">Deducted from driver transport trip payouts.</p>
                  </div>
                  <div className="mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rate</p>
                      <div className="flex overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-sm focus-within:border-[#02665e]/50 focus-within:ring-2 focus-within:ring-[#02665e]/15">
                        <input
                          id="driverCommissionPercent"
                          type="number" min={0} max={100} step="0.01" inputMode="decimal" placeholder="10"
                          value={s?.driverCommissionPercent ?? 0}
                          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300"
                          onChange={e=>setS((prev: any)=>({...(prev||{}), driverCommissionPercent: Number(e.target.value)}))}
                        />
                        <div className="flex shrink-0 items-center border-l border-slate-100 bg-[#02665e]/8 px-2.5 text-xs font-bold text-[#02665e]">%</div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Currency</p>
                      <select
                        aria-label="Driver commission currency"
                        className="box-border w-full min-w-0 rounded-[10px] border border-slate-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-slate-800 outline-none focus:border-[#02665e]/50 focus:ring-2 focus:ring-[#02665e]/15"
                        value={s?.driverCommissionCurrency || 'TZS'}
                        onChange={e=>setS((prev: any)=>({...(prev||{}), driverCommissionCurrency: e.target.value}))}
                      >
                        <option value="TZS">TZS</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="KSH">KSH</option>
                        <option value="AED">AED</option>
                      </select>
                    </div>
                  </div>
                </div>
                {/* Tour Agent Commission */}
                <div className="flex h-full min-w-0 flex-col rounded-[14px] border border-slate-200 bg-slate-50/60 p-4 sm:col-span-2 lg:col-span-1">
                  <div className="mb-4 min-h-[52px]">
                    <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Tour Agent Commission</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">Platform fee deducted from agent tour earnings.</p>
                  </div>
                  <div className="mt-auto grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3">
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Rate</p>
                      <div className="flex overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-sm focus-within:border-[#02665e]/50 focus-within:ring-2 focus-within:ring-[#02665e]/15">
                        <input
                          id="agentCommissionPercent"
                          type="number" min={0} max={100} step="0.01" inputMode="decimal" placeholder="15"
                          value={s?.agentCommissionPercent ?? 0}
                          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300"
                          onChange={e=>setS((prev: any)=>({...(prev||{}), agentCommissionPercent: Number(e.target.value)}))}
                        />
                        <div className="flex shrink-0 items-center border-l border-slate-100 bg-[#02665e]/8 px-2.5 text-xs font-bold text-[#02665e]">%</div>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Currency</p>
                      <select
                        aria-label="Agent commission currency"
                        className="box-border w-full min-w-0 rounded-[10px] border border-slate-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-slate-800 outline-none focus:border-[#02665e]/50 focus:ring-2 focus:ring-[#02665e]/15"
                        value={s?.agentCommissionCurrency || 'USD'}
                        onChange={e=>setS((prev: any)=>({...(prev||{}), agentCommissionCurrency: e.target.value}))}
                      >
                        <option value="TZS">TZS</option>
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="KSH">KSH</option>
                        <option value="AED">AED</option>
                      </select>
                    </div>
                  </div>
                </div>
                {/* Display Currency (global formatting) */}
                <div className="flex min-w-0 flex-col gap-4 rounded-[14px] border border-[#02665e]/15 bg-[#02665e]/[0.035] p-4 sm:col-span-2 lg:col-span-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <label htmlFor="currency" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Display Currency</label>
                    <p className="mt-0.5 text-[11px] text-slate-400">Default currency for displaying monetary values platform-wide.</p>
                  </div>
                  <div className="relative w-full shrink-0 lg:w-64">
                    <select
                      id="currency"
                      className="box-border w-full min-w-0 rounded-[10px] border border-slate-200 bg-white py-2 pl-3 pr-3 text-sm font-medium text-slate-800 outline-none focus:border-[#02665e]/50 focus:ring-2 focus:ring-[#02665e]/15"
                      value={s?.currency||"TZS"}
                      onChange={e=>setS((prev: any)=>({...(prev||{}), currency: e.target.value}))}
                    >
                      <option value="TZS">TZS</option>
                      <option value="USD">USD</option>
                      <option value="EUR">EUR</option>
                      <option value="KSH">KSH</option>
                      <option value="AED">AED</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Operator Tiers */}
          <section id="operatortiers" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
                    <Crown className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Operator Tiers</h3>
                    <p className="text-sm text-slate-500">Promotion thresholds for tour operators. A tier needs all four met; each must be ≥ the tier below. Revenue is in <span className="font-semibold text-slate-600">USD</span>.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                {[
                  { key: 'SILVER', label: 'Silver', chip: 'border-slate-200 bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
                  { key: 'GOLD', label: 'Gold', chip: 'border-amber-200 bg-amber-50 text-amber-700', dot: 'bg-amber-400' },
                  { key: 'PLATINUM', label: 'Platinum', chip: 'border-indigo-200 bg-indigo-50 text-indigo-700', dot: 'bg-indigo-400' },
                ].map((tier) => (
                  <div key={tier.key} className="min-w-0 rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] ${tier.chip}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${tier.dot}`} />
                        {tier.label}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {[
                        { key: 'minTours', label: 'Completed tours', step: '1', max: undefined as number | undefined, prefix: undefined as string | undefined, suffix: undefined as string | undefined },
                        { key: 'minRevenue', label: 'NoLSAF revenue', step: '100', max: undefined as number | undefined, prefix: '$', suffix: undefined as string | undefined },
                        { key: 'minRating', label: 'Min rating', step: '0.1', max: 5 as number | undefined, prefix: undefined as string | undefined, suffix: '★' },
                        { key: 'minReviews', label: 'Min reviews', step: '1', max: undefined as number | undefined, prefix: undefined as string | undefined, suffix: undefined as string | undefined },
                      ].map((f) => {
                        const err = tierErrors[`${tier.key}.${f.key}`];
                        return (
                          <div key={f.key} className="flex min-w-0 grow basis-[140px] flex-col">
                            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{f.label}</p>
                            <div className={`flex overflow-hidden rounded-[10px] border bg-white shadow-sm focus-within:ring-2 ${err ? 'border-rose-300 focus-within:ring-rose-200' : 'border-slate-200 focus-within:border-[#02665e]/50 focus-within:ring-[#02665e]/15'}`}>
                              {f.prefix ? <div className="flex shrink-0 items-center border-r border-slate-100 bg-slate-50 px-2.5 text-xs font-bold text-slate-400">{f.prefix}</div> : null}
                              <input
                                type="number" min={0} step={f.step} {...(f.max != null ? { max: f.max } : {})} inputMode="decimal"
                                value={tierLadder?.[tier.key]?.[f.key] ?? ''}
                                onChange={(e) => setTierField(tier.key, f.key, e.target.value)}
                                className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                              />
                              {f.suffix ? <div className="flex shrink-0 items-center border-l border-slate-100 bg-slate-50 px-2.5 text-xs font-bold text-amber-400">{f.suffix}</div> : null}
                            </div>
                            {err ? <p className="mt-1 text-[10px] font-medium text-rose-600">{err}</p> : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button onClick={saveTierLadder} disabled={savingTiers} className={btnPrimary} type="button">
                  {savingTiers ? 'Saving…' : 'Save operator tiers'}
                </button>
                <button type="button" onClick={() => { setTierLadder(tierDefaults); setTierErrors({}); }} className={btnSecondary}>
                  Reset to defaults
                </button>
                <span className="text-xs text-slate-400">Saved separately from the main Save bar.</span>
              </div>
            </div>
          </section>

          {/* Driver Levels & Rewards */}
          <section id="driverlevels" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                    <Award className="h-5 w-5 text-amber-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Driver Levels &amp; Rewards</h3>
                    <p className="text-sm text-slate-500">Earnings thresholds that promote a driver&apos;s badge, plus the referral credit rate. Changes apply at runtime — no code deploy needed.</p>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* Gold threshold */}
                <div className="flex h-full min-w-0 flex-col rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-amber-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                      Gold
                    </span>
                  </div>
                  <p className="mb-3 text-[11px] text-slate-400">Lifetime earnings a driver must reach to become Gold.</p>
                  <div className="mt-auto">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Threshold</p>
                    <div className={`flex overflow-hidden rounded-[10px] border bg-white shadow-sm focus-within:ring-2 ${validationErrors.driverLevelGoldThreshold ? 'border-rose-300 focus-within:ring-rose-200' : 'border-slate-200 focus-within:border-[#02665e]/50 focus-within:ring-[#02665e]/15'}`}>
                      <input
                        id="driverLevelGoldThreshold"
                        type="number" min={0} step="1000" inputMode="numeric"
                        value={s?.driverLevelGoldThreshold ?? ''}
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        onChange={e=>{ setS((prev: any)=>({...(prev||{}), driverLevelGoldThreshold: Number(e.target.value)})); setValidationErrors(prev=>{ const n={...prev}; delete n.driverLevelGoldThreshold; delete n.driverLevelDiamondThreshold; return n; }); }}
                      />
                      <div className="flex shrink-0 items-center border-l border-slate-100 bg-[#02665e]/8 px-2.5 text-xs font-bold text-[#02665e]">TZS</div>
                    </div>
                    {validationErrors.driverLevelGoldThreshold && <p className="mt-1 text-[10px] font-medium text-rose-600">{validationErrors.driverLevelGoldThreshold}</p>}
                  </div>
                </div>
                {/* Diamond threshold */}
                <div className="flex h-full min-w-0 flex-col rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-indigo-700">
                      <span className="h-1.5 w-1.5 rounded-full bg-indigo-400" />
                      Diamond
                    </span>
                  </div>
                  <p className="mb-3 text-[11px] text-slate-400">Earnings for the top Diamond badge. Must be ≥ Gold.</p>
                  <div className="mt-auto">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Threshold</p>
                    <div className={`flex overflow-hidden rounded-[10px] border bg-white shadow-sm focus-within:ring-2 ${validationErrors.driverLevelDiamondThreshold ? 'border-rose-300 focus-within:ring-rose-200' : 'border-slate-200 focus-within:border-[#02665e]/50 focus-within:ring-[#02665e]/15'}`}>
                      <input
                        id="driverLevelDiamondThreshold"
                        type="number" min={0} step="1000" inputMode="numeric"
                        value={s?.driverLevelDiamondThreshold ?? ''}
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        onChange={e=>{ setS((prev: any)=>({...(prev||{}), driverLevelDiamondThreshold: Number(e.target.value)})); setValidationErrors(prev=>{ const n={...prev}; delete n.driverLevelDiamondThreshold; return n; }); }}
                      />
                      <div className="flex shrink-0 items-center border-l border-slate-100 bg-[#02665e]/8 px-2.5 text-xs font-bold text-[#02665e]">TZS</div>
                    </div>
                    {validationErrors.driverLevelDiamondThreshold && <p className="mt-1 text-[10px] font-medium text-rose-600">{validationErrors.driverLevelDiamondThreshold}</p>}
                  </div>
                </div>
                {/* Referral credit */}
                <div className="flex h-full min-w-0 flex-col rounded-[14px] border border-slate-200 bg-slate-50/60 p-4 sm:col-span-2 lg:col-span-1">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-slate-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                      Referral
                    </span>
                  </div>
                  <p className="mb-3 text-[11px] text-slate-400">Credit awarded to a referrer as a percentage of the referred booking.</p>
                  <div className="mt-auto">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Credit rate</p>
                    <div className={`flex overflow-hidden rounded-[10px] border bg-white shadow-sm focus-within:ring-2 ${validationErrors.referralCreditPercent ? 'border-rose-300 focus-within:ring-rose-200' : 'border-slate-200 focus-within:border-[#02665e]/50 focus-within:ring-[#02665e]/15'}`}>
                      <input
                        id="referralCreditPercent"
                        type="number" min={0} max={100} step="0.01" inputMode="decimal" placeholder="0.35"
                        value={referralPercentInput}
                        className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm font-medium text-slate-900 outline-none placeholder:text-slate-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        onChange={e=>{ setReferralPercentInput(e.target.value); setValidationErrors(prev=>{ const n={...prev}; delete n.referralCreditPercent; return n; }); }}
                      />
                      <div className="flex shrink-0 items-center border-l border-slate-100 bg-[#02665e]/8 px-2.5 text-xs font-bold text-[#02665e]">%</div>
                    </div>
                    {validationErrors.referralCreditPercent && <p className="mt-1 text-[10px] font-medium text-rose-600">{validationErrors.referralCreditPercent}</p>}
                  </div>
                </div>
              </div>
              <p className="mt-4 text-[11px] text-slate-400">Use the <span className="font-semibold text-slate-500">Save Settings</span> button at the top to apply these values.</p>
            </div>
          </section>

          {/* Notifications */}
          <section id="notifications" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
                    <Bell className="h-5 w-5 text-sky-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Notifications</h3>
                    <p className="text-sm text-slate-500">Channels and customer support contact.</p>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex min-w-0 items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Email notifications</div>
                    <div className="mt-0.5 text-xs text-slate-500">Send emails for invoices and key actions.</div>
                  </div>
                  <label className="group relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" aria-label="Email notifications" checked={Boolean(s.emailEnabled)} className="peer sr-only" onChange={e=>setS({...s, emailEnabled: e.target.checked})} />
                    <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                  </label>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">SMS alerts</div>
                    <div className="mt-0.5 text-xs text-slate-500">Urgent events and operational alerts.</div>
                  </div>
                  <label className="group relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" aria-label="SMS alerts" checked={Boolean(s.smsEnabled)} className="peer sr-only" onChange={e=>setS({...s, smsEnabled: e.target.checked})} />
                    <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                  </label>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 pt-2">
                  <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Support Email</label>
                    <input className={inputClass} value={supportEmail} onChange={e=>setSupportEmail(e.target.value)} placeholder="support@nolsaf.com" type="email" />
                  </div>
                  <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                    <label className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Support Phone</label>
                    <input className={inputClass} value={supportPhone} onChange={e=>setSupportPhone(e.target.value)} placeholder="+255 736 766 726" type="tel" />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Feature Flags & Templates */}
          <section id="featureflags" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <Flag className="h-5 w-5 text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Feature Flags &amp; Templates</h3>
                    <p className="text-sm text-slate-500">Client-side preview only, backend persistence is pending.</p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-amber-700">Not saved</span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="featureFlags" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Feature Flags (JSON)</label>
                  <textarea id="featureFlags" className={`${inputClass} h-28 font-mono text-[12px]`} value={featureFlags} onChange={e=>setFeatureFlags(e.target.value)} placeholder='{"new_ui": true}' />
                </div>
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="notificationTemplates" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Notification Templates (JSON)</label>
                  <textarea id="notificationTemplates" className={`${inputClass} h-28 font-mono text-[12px]`} value={notificationTemplates} onChange={e=>setNotificationTemplates(e.target.value)} placeholder='{"owner_payout": "Payout of {{amount}} processed"}' />
                </div>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <button onClick={saveFlagsAndTemplates} className={btnSecondary} type="button" disabled>Save (coming soon)</button>
                <span className="text-xs text-slate-400">These fields are not persisted yet.</span>
              </div>
            </div>
          </section>

          {/* Security & Sessions */}
          <section id="security" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-start justify-between gap-4 mb-6">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-xl bg-rose-50 flex items-center justify-center shrink-0">
                    <ShieldCheck className="h-5 w-5 text-rose-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Security & Sessions</h3>
                    <p className="text-sm text-slate-500">Role-based session TTL is enforced server-side and audited.</p>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-rose-700">Audited</span>
              </div>
              <div className="space-y-3">
                <div className="flex min-w-0 items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Require 2FA for admins</div>
                    <div className="mt-0.5 text-xs text-slate-500">Enforce two-factor authentication for all admin accounts.</div>
                  </div>
                  <label className="group relative inline-flex cursor-pointer items-center">
                    <input id="admin2fa" type="checkbox" aria-label="Require 2FA for admins" checked={Boolean(s?.requireAdmin2FA)} className="peer sr-only" onChange={e=>setS(prev=>({...(prev||{}), requireAdmin2FA: e.target.checked}))} />
                    <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                  </label>
                </div>

                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Session TTL by role (minutes)</div>
                      <div className="mt-0.5 text-xs text-slate-500">Blank role values fall back to Default.</div>
                    </div>
                    <span className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-slate-600">Audited</span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
                    <div className="rounded-[12px] border border-slate-200 bg-white p-3.5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full bg-slate-400" />
                        <label htmlFor="sessionTtlDefault" className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Default</label>
                      </div>
                      <input id="sessionTtlDefault" type="number" min={5} className={inputClass} value={(s?.sessionIdleMinutes ?? 60) as any} onChange={e=>setS(prev=>({...(prev||{}), sessionIdleMinutes: Number(e.target.value)}))} />
                    </div>
                    <div className="rounded-[12px] border border-[#02665e]/20 bg-[#02665e]/[0.04] p-3.5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full bg-[#02665e]" />
                        <label htmlFor="sessionTtlAdmin" className="text-xs font-bold uppercase tracking-[0.12em] text-[#02665e]">Admin</label>
                      </div>
                      <input id="sessionTtlAdmin" type="number" min={5} placeholder="(default)" className={inputClass} value={(s?.sessionMaxMinutesAdmin ?? "") as any} onChange={e=>setS(prev=>({...(prev||{}), sessionMaxMinutesAdmin: e.target.value === "" ? null : Number(e.target.value)}))} />
                    </div>
                    <div className="rounded-[12px] border border-indigo-200 bg-indigo-50/40 p-3.5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full bg-indigo-500" />
                        <label htmlFor="sessionTtlOwner" className="text-xs font-bold uppercase tracking-[0.12em] text-indigo-700">Owner</label>
                      </div>
                      <input id="sessionTtlOwner" type="number" min={5} placeholder="(default)" className={inputClass} value={(s?.sessionMaxMinutesOwner ?? "") as any} onChange={e=>setS(prev=>({...(prev||{}), sessionMaxMinutesOwner: e.target.value === "" ? null : Number(e.target.value)}))} />
                    </div>
                    <div className="rounded-[12px] border border-amber-200 bg-amber-50/40 p-3.5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full bg-amber-500" />
                        <label htmlFor="sessionTtlDriver" className="text-xs font-bold uppercase tracking-[0.12em] text-amber-700">Driver</label>
                      </div>
                      <input id="sessionTtlDriver" type="number" min={5} placeholder="(default)" className={inputClass} value={(s?.sessionMaxMinutesDriver ?? "") as any} onChange={e=>setS(prev=>({...(prev||{}), sessionMaxMinutesDriver: e.target.value === "" ? null : Number(e.target.value)}))} />
                    </div>
                    <div className="rounded-[12px] border border-sky-200 bg-sky-50/40 p-3.5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full bg-sky-500" />
                        <label htmlFor="sessionTtlCustomer" className="text-xs font-bold uppercase tracking-[0.12em] text-sky-700">Traveller</label>
                      </div>
                      <input id="sessionTtlCustomer" type="number" min={5} placeholder="(default)" className={inputClass} value={(s?.sessionMaxMinutesCustomer ?? "") as any} onChange={e=>setS(prev=>({...(prev||{}), sessionMaxMinutesCustomer: e.target.value === "" ? null : Number(e.target.value)}))} />
                    </div>
                    <div className="rounded-[12px] border border-violet-200 bg-violet-50/40 p-3.5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2 w-2 rounded-full bg-violet-500" />
                        <label htmlFor="sessionTtlAgent" className="text-xs font-bold uppercase tracking-[0.12em] text-violet-700">Agent</label>
                      </div>
                      <input id="sessionTtlAgent" type="number" min={5} placeholder="(default)" className={inputClass} value={(s?.sessionMaxMinutesAgent ?? "") as any} onChange={e=>setS(prev=>({...(prev||{}), sessionMaxMinutesAgent: e.target.value === "" ? null : Number(e.target.value)}))} />
                    </div>
                  </div>
                  <div className="mt-3 rounded-[12px] border border-slate-200 bg-white p-3 text-xs text-slate-500">
                    Reducing a role TTL forces re-login on the next request.
                  </div>
                </div>

                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Clock className="h-4 w-4 text-slate-500" />
                    <div className="text-sm font-semibold text-slate-900">Max session duration (hours)</div>
                  </div>
                  <input
                    id="maxSessionDurationHours"
                    type="number"
                    min={1}
                    max={720}
                    className={`${inputClass} ${validationErrors.maxSessionDurationHours ? "border-red-300" : ""}`}
                    value={(s?.maxSessionDurationHours ?? 24) as any}
                    onChange={e=>setS(prev=>({...(prev||{}), maxSessionDurationHours: Number(e.target.value)}))}
                  />
                  {validationErrors.maxSessionDurationHours && <p className="mt-1 text-xs text-red-600">{validationErrors.maxSessionDurationHours}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">Maximum session lifetime before requiring re-authentication.</p>
                </div>

                <div className="flex min-w-0 items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Force logout on password change</div>
                    <div className="mt-0.5 text-xs text-slate-500">Automatically logout all sessions when password is changed.</div>
                  </div>
                  <label className="group relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" aria-label="Force logout on password change" checked={Boolean(s?.forceLogoutOnPasswordChange ?? true)} className="peer sr-only" onChange={e=>setS(prev=>({...(prev||{}), forceLogoutOnPasswordChange: e.target.checked}))} />
                    <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Password Requirements */}
          <section id="passwords" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                  <KeyRound className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Password Requirements</h3>
                  <p className="text-sm text-slate-500">Configure password complexity and security policies.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 mb-4">
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="minPasswordLength" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Min password length</label>
                  <input
                    id="minPasswordLength"
                    type="number"
                    min={6}
                    max={128}
                    className={`${inputClass} ${validationErrors.minPasswordLength ? "border-red-300" : ""}`}
                    value={(s?.minPasswordLength ?? 10) as any}
                    onChange={e=>setS(prev=>({...(prev||{}), minPasswordLength: Number(e.target.value)}))}
                  />
                  {validationErrors.minPasswordLength && <p className="mt-1 text-xs text-red-600">{validationErrors.minPasswordLength}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">Minimum number of characters required.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { label: "Require uppercase letters", key: "requirePasswordUppercase", val: s?.requirePasswordUppercase, hint: "Must contain at least one uppercase letter." },
                  { label: "Require lowercase letters", key: "requirePasswordLowercase", val: s?.requirePasswordLowercase, hint: "Must contain at least one lowercase letter." },
                  { label: "Require numbers", key: "requirePasswordNumber", val: s?.requirePasswordNumber, hint: "Must contain at least one number." },
                  { label: "Require special characters", key: "requirePasswordSpecial", val: s?.requirePasswordSpecial, hint: "Must contain at least one special character (!@#$%^&*)." },
                ].map(({ label, key, val, hint }) => (
                  <div key={key} className="flex items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{label}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
                    </div>
                    <label className="group relative inline-flex cursor-pointer items-center">
                      <input type="checkbox" aria-label={label} checked={Boolean(val ?? false)} className="peer sr-only" onChange={e=>setS(prev=>({...(prev||{}), [key]: e.target.checked}))} />
                      <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Network Security */}
          <section id="network" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-orange-50 flex items-center justify-center shrink-0">
                  <Globe className="h-5 w-5 text-orange-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Network Security</h3>
                  <p className="text-sm text-slate-500">Restrict admin access by IP address and configure network policies.</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label htmlFor="ipAllowlist" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Admin IP Allowlist (CIDR format)</label>
                  <textarea
                    id="ipAllowlist"
                    className={`${inputClass} font-mono text-xs ${validationErrors.ipAllowlist ? "border-red-300" : ""}`}
                    value={s?.ipAllowlist || ""}
                    onChange={e=>setS(prev=>({...(prev||{}), ipAllowlist: e.target.value}))}
                    onBlur={(e) => {
                      const error = validateIPAllowlist(e.target.value);
                      if (!error.valid && error.error) {
                        setValidationErrors(prev => ({ ...prev, ipAllowlist: error.error || "Invalid IP allowlist format" }));
                      } else {
                        setValidationErrors(prev => { const n = { ...prev }; delete n.ipAllowlist; return n; });
                      }
                    }}
                    placeholder="192.168.1.0/24, 10.0.0.0/8, 172.16.0.0/12"
                    rows={4}
                  />
                  {validationErrors.ipAllowlist && <p className="mt-1 text-xs text-red-600">{validationErrors.ipAllowlist}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">Enter IP addresses or CIDR ranges separated by commas. Leave empty to allow all IPs.</p>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Enable IP allowlist enforcement</div>
                    <div className="mt-0.5 text-xs text-slate-500">Restrict admin access to trusted networks only.</div>
                  </div>
                  <label className="group relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" aria-label="Enable IP allowlist enforcement" checked={Boolean(s?.enableIpAllowlist ?? false)} className="peer sr-only" onChange={e=>setS(prev=>({...(prev||{}), enableIpAllowlist: e.target.checked}))} />
                    <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Rate Limiting */}
          <section id="ratelimit" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center shrink-0">
                  <Gauge className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Rate Limiting & DDoS Protection</h3>
                  <p className="text-sm text-slate-500">Configure API rate limits and protect against abuse.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="apiRateLimitPerMinute" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">API requests / minute</label>
                  <input id="apiRateLimitPerMinute" type="number" min={10} max={10000} className={`${inputClass} ${validationErrors.apiRateLimitPerMinute ? "border-red-300" : ""}`} value={(s?.apiRateLimitPerMinute ?? 100) as any} onChange={e=>setS(prev=>({...(prev||{}), apiRateLimitPerMinute: Number(e.target.value)}))} />
                  {validationErrors.apiRateLimitPerMinute && <p className="mt-1 text-xs text-red-600">{validationErrors.apiRateLimitPerMinute}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">Max API requests allowed per minute per IP.</p>
                </div>
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="maxLoginAttempts" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Login attempts before lockout</label>
                  <input id="maxLoginAttempts" type="number" min={3} max={20} className={`${inputClass} ${validationErrors.maxLoginAttempts ? "border-red-300" : ""}`} value={(s?.maxLoginAttempts ?? 5) as any} onChange={e=>setS(prev=>({...(prev||{}), maxLoginAttempts: Number(e.target.value)}))} />
                  {validationErrors.maxLoginAttempts && <p className="mt-1 text-xs text-red-600">{validationErrors.maxLoginAttempts}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">Failed attempts before account lockout.</p>
                </div>
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="accountLockoutDurationMinutes" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Lockout duration (minutes)</label>
                  <input id="accountLockoutDurationMinutes" type="number" min={5} max={1440} className={`${inputClass} ${validationErrors.accountLockoutDurationMinutes ? "border-red-300" : ""}`} value={(s?.accountLockoutDurationMinutes ?? 30) as any} onChange={e=>setS(prev=>({...(prev||{}), accountLockoutDurationMinutes: Number(e.target.value)}))} />
                  {validationErrors.accountLockoutDurationMinutes && <p className="mt-1 text-xs text-red-600">{validationErrors.accountLockoutDurationMinutes}</p>}
                  <p className="mt-1.5 text-xs text-slate-400">Duration of account lockout after max login attempts.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Security Audit & Monitoring */}
          <section id="auditmon" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                  <Activity className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Security Audit & Monitoring</h3>
                  <p className="text-sm text-slate-500">Configure security auditing and monitoring policies.</p>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { label: "Enable security audit logging", key: "enableSecurityAuditLogging", val: s?.enableSecurityAuditLogging ?? true, hint: "Log all security-related events and admin actions." },
                  { label: "Log failed login attempts", key: "logFailedLoginAttempts", val: s?.logFailedLoginAttempts ?? true, hint: "Record all failed login attempts for security analysis." },
                  { label: "Alert on suspicious activity", key: "alertOnSuspiciousActivity", val: s?.alertOnSuspiciousActivity ?? false, hint: "Send alerts when suspicious security events are detected." },
                ].map(({ label, key, val, hint }) => (
                  <div key={key} className="flex items-center justify-between gap-4 rounded-[14px] border border-slate-100 bg-slate-50/50 px-4 py-3.5">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900">{label}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{hint}</div>
                    </div>
                    <label className="group relative inline-flex cursor-pointer items-center">
                      <input type="checkbox" aria-label={label} checked={Boolean(val)} className="peer sr-only" onChange={e=>setS(prev=>({...(prev||{}), [key]: e.target.checked}))} />
                      <div className={toggleTrackClass}><Lock className="absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100 pointer-events-none" /></div>
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* Security Best Practices */}
          <div className="rounded-[20px] border-2 border-amber-200/80 bg-amber-50/60 p-6 sm:p-8">
            <div className="flex items-start gap-4">
              <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-base font-bold text-amber-900 mb-3">Security Best Practices</h4>
                <ul className="space-y-2">
                  {[
                    ["2FA", "Always require 2FA for admin accounts in production environments."],
                    ["Password Policy", "Minimum 12 characters with mixed case, numbers, and special characters recommended."],
                    ["IP Allowlist", "Configure IP allowlist to restrict admin access to trusted networks only."],
                    ["Session Mgmt", "Set appropriate session timeout based on your security requirements."],
                    ["Rate Limiting", "Enable rate limiting to protect against brute force and DDoS attacks."],
                    ["Audit Logging", "Keep security audit logging enabled to track all security events."],
                  ].map(([k, v]) => (
                    <li key={k} className="flex items-start gap-2.5 text-sm text-amber-800">
                      <span className="mt-1 h-4 w-4 rounded-full bg-amber-200 flex items-center justify-center shrink-0">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-700" />
                      </span>
                      <span><strong>{k}:</strong> {v}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Tax & Invoicing */}
          <section id="invoicing" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-[#02665e]/10 flex items-center justify-center shrink-0">
                  <FileText className="h-5 w-5 text-[#02665e]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Tax & Invoicing</h3>
                  <p className="text-sm text-slate-500">Numbering, tax rate, and invoice template preview.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 mb-4">
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="taxRate" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Tax Rate (%)</label>
                  <input id="taxRate" type="number" min={0} step="0.01" className={inputClass} value={s?.taxPercent ?? 0} onChange={e=>setS(prev=>({...(prev||{}), taxPercent: Number(e.target.value)}))} />
                </div>
                <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                  <label htmlFor="invoicePrefix" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Invoice Prefix</label>
                  <input id="invoicePrefix" className={inputClass} value={s?.invoicePrefix || "INV-"} onChange={e=>setS(prev=>({...(prev||{}), invoicePrefix: e.target.value}))} />
                </div>
              </div>
              <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4 mb-4">
                <label htmlFor="invoiceTemplate" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Invoice Template (HTML)</label>
                <textarea id="invoiceTemplate" className={`${inputClass} h-28 font-mono text-[12px]`} value={invoiceTemplate} onChange={e=>setInvoiceTemplate(e.target.value)} placeholder="<h1>Invoice {{invoiceNumber}}</h1>" />
              </div>
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <button onClick={saveInvoicingSettings} className={btnPrimary} type="button">Save tax &amp; prefix</button>
                <button onClick={previewInvoice} className={btnSecondary} type="button">Preview</button>
                <span className="text-xs text-slate-400">Template is preview-only.</span>
              </div>
              <div
                id="invoicePreviewArea"
                className="max-h-64 max-w-full overflow-x-hidden overflow-y-auto rounded-[14px] border border-slate-200 bg-white p-4 text-sm text-slate-700 [&_*]:max-w-full [&_img]:h-auto [&_img]:max-w-full [&_pre]:whitespace-pre-wrap [&_code]:break-words [&_p]:break-words [&_span]:break-words [&_a]:break-words [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:table-fixed [&_th]:break-words [&_td]:break-words"
                dangerouslySetInnerHTML={{__html: invoicePreviewHtml || ""}}
              />
            </div>
          </section>

          {/* Scheduling */}
          <section id="scheduling" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 mb-6">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-sky-50 flex items-center justify-center shrink-0">
                    <CalendarClock className="h-5 w-5 text-sky-600" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-900">Scheduling</h3>
                    <p className="text-sm text-slate-500">Operational automation (cron policy backend pending).</p>
                  </div>
                </div>
                <span className="inline-flex shrink-0 items-center rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-amber-700">Coming soon</span>
              </div>
              <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                <label htmlFor="payoutCron" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Cron Expression</label>
                <input id="payoutCron" className={`${inputClass} font-mono`} placeholder="e.g. 0 2 1 * *" value={payoutCron} onChange={e=>setPayoutCron(e.target.value)} />
                <p className="mt-1.5 text-xs text-slate-400">Default: 02:00 on the 1st of each month.</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button onClick={updatePayoutCron} className={btnSecondary} type="button">Save (pending)</button>
                  <button onClick={()=>alert("Preview not implemented")} className={btnSecondary} type="button">Run Preview</button>
                  <button onClick={()=>alert("Execute not implemented")} className={btnSecondary} type="button">Execute Now</button>
                </div>
                <pre id="payoutCronResult" className="mt-4 max-h-48 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[12px] border border-slate-200 bg-white p-4 text-[12px] text-slate-700" />
              </div>
            </div>
          </section>

          {/* Bonuses */}
          <section id="bonuses" className="bg-white rounded-[20px] border border-slate-200 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)] overflow-hidden">
            <div className="p-6 sm:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                  <Gift className="h-5 w-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Bonuses</h3>
                  <p className="text-sm text-slate-500">Manual owner bonus preview/grant (recorded via admin audit).</p>
                </div>
              </div>
              <div className="rounded-[14px] border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-900">Grant owner bonus</div>
                    <p className="mt-0.5 text-xs text-slate-500">Preview uses owner paid invoices (last 30 days). Grant writes an audit entry.</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button onClick={previewBonus} className={btnSecondary} type="button" disabled={!bonusOwnerId || !Number.isFinite(Number(bonusOwnerId)) || Number(bonusOwnerId) <= 0}>Preview</button>
                    <button onClick={grantBonus} className={btnPrimary} type="button" disabled={!bonusOwnerId || !Number.isFinite(Number(bonusOwnerId)) || Number(bonusOwnerId) <= 0}>Grant</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 items-stretch gap-4 border-t border-slate-200/70 pt-4 sm:grid-cols-2">
                  <div className="flex h-full min-w-0 flex-col rounded-[12px] border border-slate-200 bg-white p-4">
                    <label htmlFor="bonusOwnerId" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Owner ID</label>
                    <div className="flex overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50/50 shadow-sm transition-all focus-within:border-[#02665e]/40 focus-within:ring-2 focus-within:ring-[#02665e]/15">
                      <input id="bonusOwnerId" className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-300" value={bonusOwnerId} onChange={e=>setBonusOwnerId(String(e.target.value || "").replace(/\D+/g, ""))} placeholder="e.g. 13" inputMode="numeric" />
                      <div className="flex shrink-0 items-center border-l border-slate-200 bg-slate-100 px-3 text-xs font-bold text-slate-500">#</div>
                    </div>
                    {!bonusOwnerId ? (
                      <p className="mt-1.5 text-xs text-slate-400">Paste an Owner ID to auto-load the owner.</p>
                    ) : !Number.isFinite(Number(bonusOwnerId)) || Number(bonusOwnerId) <= 0 ? (
                      <p className="mt-1.5 text-xs font-medium text-rose-600">Enter a valid numeric owner ID.</p>
                    ) : bonusOwnerLookupLoading ? (
                      <p className="mt-1.5 text-xs text-slate-400">Looking up owner...</p>
                    ) : bonusOwnerLookupError ? (
                      <p className="mt-1.5 text-xs font-medium text-rose-600">{bonusOwnerLookupError}</p>
                    ) : bonusOwnerLookup ? (
                      <p className="mt-1.5 text-xs text-slate-500">Owner: <span className="font-semibold text-slate-700">{bonusOwnerLookup.name || `#${bonusOwnerLookup.id}`}</span>{bonusOwnerLookup.email ? <span className="text-slate-400"> &middot; {bonusOwnerLookup.email}</span> : null}</p>
                    ) : (
                      <p className="mt-1.5 text-xs text-slate-400">Owner receiving the bonus.</p>
                    )}
                  </div>
                  <div className="flex h-full min-w-0 flex-col rounded-[12px] border border-slate-200 bg-white p-4">
                    <label htmlFor="bonusPercentInput" className="block text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 mb-1.5">Bonus (%)</label>
                    <div className="flex overflow-hidden rounded-[10px] border border-slate-200 bg-slate-50/50 shadow-sm transition-all focus-within:border-[#02665e]/40 focus-within:ring-2 focus-within:ring-[#02665e]/15">
                      <input id="bonusPercentInput" type="number" min={0} step="0.01" inputMode="decimal" className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-300" value={bonusPercentInput} onChange={e=>setBonusPercentInput(Number(e.target.value))} placeholder="e.g. 5" />
                      <div className="flex shrink-0 items-center border-l border-slate-200 bg-slate-100 px-3 text-xs font-bold text-slate-500">%</div>
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400">Percent applied to eligible revenue for the preview window.</p>
                  </div>
                </div>
                {bonusPreview && (
                  <div className="mt-4 rounded-[14px] border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between mb-4">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-900">Preview result</div>
                        <p className="mt-0.5 text-xs text-slate-500">Review computed values before granting.</p>
                      </div>
                      <span className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.10em] text-slate-600">
                        {(bonusPreview as any)?.ok === true ? "OK" : "Result"}
                      </span>
                    </div>
                    {(bonusPreview as any)?.data && (
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 mb-4">
                        {[
                          { label: "Owner", value: `#${String((bonusPreview as any).data.ownerId ?? bonusOwnerId)}` },
                          { label: "Bonus", value: formatPercent((bonusPreview as any).data.bonusPercent ?? bonusPercentInput) },
                          { label: "Eligible revenue", value: formatMoney((bonusPreview as any).data.totalRevenue) },
                          { label: "Bonus amount", value: formatMoney((bonusPreview as any).data.bonusAmount) },
                          { label: "Commission %", value: formatPercent((bonusPreview as any).data.commissionPercent) },
                          { label: "Reference", value: String((bonusPreview as any).data.bonusPaymentRef ?? "\u2014") },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-[10px] border border-slate-100 bg-slate-50 p-3">
                            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</div>
                            <div className="mt-1 text-sm font-semibold text-slate-900 truncate font-mono">{value}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <details className="rounded-[12px] border border-slate-200 bg-slate-50 p-3">
                      <summary className="cursor-pointer select-none text-xs font-semibold text-slate-600">Raw response</summary>
                      <pre className="mt-3 max-h-64 max-w-full overflow-x-hidden overflow-y-auto whitespace-pre-wrap break-words rounded-[10px] border border-slate-200 bg-white p-4 text-[12px] text-slate-700">{JSON.stringify(bonusPreview, null, 2)}</pre>
                    </details>
                  </div>
                )}
              </div>
            </div>
          </section>

        </div>

        {/* Save bar — STICKY inside the content column (not viewport-fixed), so it
            aligns to the settings card width and scrolls within the admin workspace
            surface instead of spilling past the sidebar. */}
        <div className="sticky bottom-4 z-40 mt-5">
          <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 px-5 py-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.20)] backdrop-blur">
            <div>
              {lastSavedAt ? (
                <span className="text-xs text-slate-500">
                  Last saved: <span className="font-semibold text-slate-700">{lastSavedAt.toLocaleTimeString()}</span>
                </span>
              ) : (
                <span className="text-xs text-slate-400">Unsaved changes will be lost on reload.</span>
              )}
            </div>
            <button
              onClick={saveSystemSettings}
              disabled={loading || saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#02665e] px-5 py-2.5 text-sm font-bold text-white shadow-[0_4px_16px_-4px_rgba(2,102,94,0.45)] transition hover:brightness-95 focus:outline-none focus:ring-2 focus:ring-[#02665e]/30 disabled:opacity-60 disabled:cursor-not-allowed"
              type="button"
            >
              <Settings className="h-4 w-4" />
              {saving ? "Saving..." : "Save Settings"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
