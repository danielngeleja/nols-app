"use client";
// AdminPageHeader removed in favor of a centered, compact header for this page
import { Settings, ShieldCheck, Lock, AlertTriangle, CreditCard, Award, Crown, Bell, Flag, KeyRound, Globe, Gauge, Activity, FileText, CalendarClock, Gift, History, RefreshCw, ChevronRight, CheckCircle2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { sanitizeTrustedHtml } from "@/utils/html";
import { AnimatePresence, motion } from "framer-motion";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;

export default function SystemSettingsPage(){
  const toggleTrackClass =
    "relative h-6 w-11 shrink-0 rounded-full bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-[#02665e]/15 peer-checked:bg-[#02665e] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-slate-200 after:bg-white after:transition-all peer-checked:after:translate-x-full";

  // Sales-style pieces shared by the restyled sections: compact field, ruled section header, small caps label.
  const fieldClass =
    "box-border h-9 w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-2.5 text-sm font-medium tabular-nums text-neutral-900 outline-none transition-colors placeholder:text-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
  const sectionLabel = "m-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-400";
  const sectionHead = (icon: ReactNode, title: string, subtitle: ReactNode, aside?: ReactNode) => (
    <div className="flex flex-wrap items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-3 sm:px-5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#0b2420] text-emerald-300">{icon}</span>
      <div className="min-w-0 flex-1">
        <h2 className="m-0 text-sm font-bold text-neutral-900">{title}</h2>
        <p className="m-0 text-xs text-neutral-400">{subtitle}</p>
      </div>
      {aside ? <div className="flex flex-wrap items-center gap-2">{aside}</div> : null}
    </div>
  );

  const textareaClass =
    "box-border block w-full min-w-0 rounded-lg border border-solid border-neutral-300 bg-white px-3 py-2 font-mono text-xs text-neutral-800 outline-none transition-colors placeholder:text-neutral-300 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
  const btnGhost =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50";
  const btnDark =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:cursor-not-allowed disabled:opacity-50";
  const switchControl = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label className="group relative inline-flex shrink-0 cursor-pointer items-center">
      <input type="checkbox" aria-label={label} checked={checked} className="peer sr-only" onChange={(e) => onChange(e.target.checked)} />
      <div className={toggleTrackClass}><Lock className="pointer-events-none absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100" /></div>
    </label>
  );

  // One tap to switch currency; replaces the select, which showed two chevrons.
  const currencyPicker = (label: string, value: string, onChange: (c: string) => void) => (
    <div role="radiogroup" aria-label={label} className="inline-flex shrink-0 rounded-lg bg-neutral-100 p-0.5 ring-1 ring-inset ring-neutral-300/70">
      {["TZS", "USD", "EUR", "KSH", "AED"].map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          onClick={() => onChange(c)}
          className={`inline-flex h-8 min-w-[46px] items-center justify-center rounded-md border-0 px-2 text-xs font-semibold transition-colors ${value === c ? "bg-white text-neutral-900 shadow-sm ring-1 ring-neutral-300" : "bg-transparent text-neutral-500 hover:text-neutral-900"}`}
        >
          {c}
        </button>
      ))}
    </div>
  );

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
    minPasswordLength: 8,
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
    // Round away float noise (0.00239 * 100 = 0.23900000000000002).
    setReferralPercentInput(s.referralCreditPercent != null ? String(Number((Number(s.referralCreditPercent) * 100).toFixed(6))) : '');
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
        if (isNaN(minLen) || minLen < 8 || minLen > 128) {
          return 'Password length must be between 8 and 128 characters';
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
      minPasswordLength: s.minPasswordLength ?? 8,
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
      minPasswordLength: Number(s.minPasswordLength || 8),
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
  // Payout safeguards: only sent once the columns exist; blank means off.
  ...((s as any).payoutSafeguardsAvailable
    ? {
        payoutReviewThresholdTzs: (s as any).payoutReviewThresholdTzs ?? null,
        payoutDailyCapPerPayeeTzs: (s as any).payoutDailyCapPerPayeeTzs ?? null,
        payoutRecentChangeHours: (s as any).payoutRecentChangeHours ?? 72,
      }
    : {}),
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

      <div className="box-border w-full min-w-0 px-4 py-6 pb-6 sm:px-6 lg:px-8">
        <div className="space-y-5 flex flex-col">

          {/* Header: Sales band with headline numbers, then a track of setting groups that jump to their sections */}
          {(() => {
            const latest = sessionPolicyAudit[0];
            const latestActor = latest ? latest.actor?.name || latest.actor?.email || latest.actorRole || "Admin" : "";
            const sinceLabel = (date: Date) => {
              const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
              if (minutes < 1) return "Just now";
              if (minutes < 60) return `${minutes} min ago`;
              const hours = Math.floor(minutes / 60);
              if (hours < 24) return `${hours} h ago`;
              const days = Math.floor(hours / 24);
              if (days < 31) return days === 1 ? "Yesterday" : `${days} days ago`;
              const months = Math.floor(days / 30.4);
              return months < 12 ? `${months} month${months === 1 ? "" : "s"} ago` : `${Math.floor(days / 365)} year${days >= 730 ? "s" : ""} ago`;
            };
            const protections = [
              s?.enableIpAllowlist,
              s?.forceLogoutOnPasswordChange,
              s?.logFailedLoginAttempts,
              s?.alertOnSuspiciousActivity,
            ];
            const protectionsOn = protections.filter(Boolean).length;
            const channels = [s?.emailEnabled && "Email", s?.smsEnabled && "SMS"].filter(Boolean) as string[];
            const heroButton =
              "inline-flex h-9 items-center gap-1.5 rounded-lg border border-solid border-white/15 bg-white/[0.06] px-3 text-xs font-semibold text-white/85 no-underline transition-colors hover:bg-white/[0.12] hover:text-white hover:no-underline disabled:opacity-60";
            const groups: Array<{
              key: string;
              label: string;
              icon: ReactNode;
              text: string;
              bar: string;
              value: string;
              hint: string;
              share: number | null;
              links: Array<[string, string]>;
            }> = [
              {
                key: "money",
                label: "Money",
                icon: <CreditCard className="h-3.5 w-3.5" />,
                text: "text-emerald-700",
                bar: "bg-emerald-500",
                value: `${(s?.currency || "TZS").toUpperCase()} · tax ${s?.taxPercent ?? 0}%`,
                hint: `Driver ${s?.driverCommissionPercent ?? 0}% · tour agent ${s?.agentCommissionPercent ?? 0}% · invoices ${s?.invoicePrefix || "INV"}`,
                share: null,
                links: [["payments", "Payments"], ["payoutsafeguards", "Safeguards"], ["invoicing", "Invoicing"], ["bonuses", "Bonuses"]],
              },
              {
                key: "partners",
                label: "Partner levels",
                icon: <Award className="h-3.5 w-3.5" />,
                text: "text-sky-700",
                bar: "bg-sky-500",
                value: s?.driverLevelGoldThreshold ? `Gold at ${s.driverLevelGoldThreshold.toLocaleString()}` : "2 ladders",
                hint: s?.driverLevelDiamondThreshold ? `Driver Diamond at ${s.driverLevelDiamondThreshold.toLocaleString()}` : "Operator tiers and driver levels",
                share: null,
                links: [["operatortiers", "Operator tiers"], ["driverlevels", "Driver levels"]],
              },
              {
                key: "security",
                label: "Access and security",
                icon: <ShieldCheck className="h-3.5 w-3.5" />,
                text: protectionsOn === protections.length ? "text-emerald-700" : "text-amber-700",
                bar: protectionsOn === protections.length ? "bg-emerald-500" : "bg-amber-400",
                value: `${protectionsOn} of ${protections.length} on`,
                hint: `Admin 2FA always on · ${s?.maxLoginAttempts ?? 5} tries, ${s?.accountLockoutDurationMinutes ?? 30} min lock`,
                share: Math.round((protectionsOn / protections.length) * 100),
                links: [["security", "Sessions"], ["passwords", "Passwords"], ["network", "Network"], ["ratelimit", "Rate limits"], ["auditmon", "Monitoring"]],
              },
              {
                key: "platform",
                label: "Platform",
                icon: <Bell className="h-3.5 w-3.5" />,
                text: channels.length === 2 ? "text-emerald-700" : "text-amber-700",
                bar: channels.length === 2 ? "bg-emerald-500" : "bg-amber-400",
                value: channels.length ? channels.join(" and ") : "Alerts off",
                hint: payoutCron ? `Payout run ${payoutCron}` : "No payout schedule set",
                share: Math.round((channels.length / 2) * 100),
                links: [["notifications", "Notifications"], ["featureflags", "Feature flags"], ["scheduling", "Scheduling"]],
              },
            ];
            return (
              <>
                <section className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_140%_at_100%_0%,rgba(16,185,129,0.22)_0%,rgba(11,36,32,0)_55%)]" aria-hidden />
                  <div className="relative px-5 py-5 sm:px-6 sm:py-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80">Platform</p>
                        <h1 className="m-0 mt-1 text-xl font-bold tracking-tight text-white sm:text-2xl">System settings</h1>
                        <p className="m-0 mt-1 max-w-2xl text-sm text-white/60">Fees, security, notifications and schedules for the whole platform. Every save is audited.</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <a href="#settings-audit" className={heroButton}><History className="h-3.5 w-3.5" /> Audit trail</a>
                        <button type="button" onClick={() => { void load(); void loadSessionPolicyAudit(); }} disabled={loading} className={`${heroButton} w-9 justify-center px-0`} aria-label="Reload settings" title="Reload">
                          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                        </button>
                      </div>
                    </div>

                    {/* Headline numbers */}
                    <div className="mt-5 flex flex-wrap items-end gap-x-10 gap-y-3">
                      <div>
                        <p className="m-0 text-3xl font-bold tabular-nums leading-none text-white">{loading ? "..." : `${s?.commissionPercent ?? 0}%`}</p>
                        <p className="m-0 mt-1 text-xs text-white/55">Property commission</p>
                      </div>
                      <div>
                        <p className={`m-0 text-3xl font-bold tabular-nums leading-none ${protectionsOn === protections.length ? "text-emerald-300" : "text-amber-300"}`}>{loading ? "..." : `${protectionsOn}/${protections.length}`}</p>
                        <p className="m-0 mt-1 text-xs text-white/55">Security protections on</p>
                      </div>
                      <div>
                        <p className="m-0 text-3xl font-bold leading-none text-white">{lastSavedAt ? "Just now" : latest ? sinceLabel(new Date(latest.createdAt)) : loading ? "..." : "Never"}</p>
                        <p className="m-0 mt-1 text-xs text-white/55">
                          {lastSavedAt
                            ? `Saved ${lastSavedAt.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`
                            : latest ? `Last change by ${latestActor}` : "Last change"}
                        </p>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Setting groups: where each part of the platform stands, and a jump to its sections */}
                <section className="rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm p-2">
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {groups.map((group) => (
                      <div key={group.key} className="flex min-w-0 flex-col rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 p-3.5">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${group.text}`}>{group.icon} {group.label}</span>
                          <span className="text-[11px] tabular-nums text-neutral-400">{group.links.length} sections</span>
                        </span>
                        <span className="mt-2 block truncate text-2xl font-bold leading-none text-neutral-900">{loading ? "..." : group.value}</span>
                        <span className="mt-1 block truncate text-[11px] text-neutral-500">{loading ? " " : group.hint}</span>
                        {group.share !== null && (
                          <span className="mt-2.5 block h-1 w-full overflow-hidden rounded-full bg-neutral-200/70">
                            <span className={`block h-full rounded-full ${group.bar}`} style={{ width: `${loading ? 0 : group.share}%` }} />
                          </span>
                        )}
                        <span className="mt-auto flex flex-wrap gap-1 pt-3">
                          {group.links.map(([id, label]) => (
                            <a key={id} href={`#${id}`} className="inline-flex h-7 items-center gap-1 rounded-full border border-solid border-neutral-200 bg-white px-2.5 text-[11px] font-semibold text-neutral-600 no-underline transition-colors hover:border-neutral-900 hover:text-neutral-900 hover:no-underline">
                              {label} <ChevronRight className="h-3 w-3 text-neutral-400" />
                            </a>
                          ))}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            );
          })()}

          {/* Settings audit trail: pinned to the bottom via order-last, ruled rows with readable field changes */}
          {(() => {
            const fieldName = (key: string) => {
              const role = key.match(/^sessionMaxMinutes(\w+)$/);
              if (role) return `${role[1] === "Customer" ? "Traveller" : role[1]} idle timeout`;
              if (key === "sessionIdleMinutes") return "Default idle timeout";
              const words = key.replace(/([A-Z])/g, " $1").toLowerCase().trim();
              return words.charAt(0).toUpperCase() + words.slice(1);
            };
            const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "blank" : String(v));
            const ago = (iso: string) => {
              const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
              if (minutes < 60) return minutes < 1 ? "Just now" : `${minutes} min ago`;
              const hours = Math.floor(minutes / 60);
              if (hours < 24) return `${hours} h ago`;
              const days = Math.floor(hours / 24);
              return days === 1 ? "Yesterday" : days < 31 ? `${days} days ago` : `${Math.floor(days / 30.4)} mo ago`;
            };
            return (
              <section id="settings-audit" className="order-last scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <History className="h-4 w-4" />,
                  "Audit trail",
                  "Who changed what and when. Every save is recorded.",
                  <>
                    {sessionPolicyAudit.length > 0 && <span className="text-xs tabular-nums text-neutral-400">{sessionPolicyAudit.length} {sessionPolicyAudit.length === 1 ? "entry" : "entries"}</span>}
                    <button type="button" onClick={loadSessionPolicyAudit} className={btnGhost}><RefreshCw className="h-3.5 w-3.5" /> Refresh</button>
                  </>,
                )}
                {sessionPolicyAudit.length === 0 ? (
                  <p className="m-0 px-4 py-8 text-center text-sm text-neutral-400 sm:px-5">No changes recorded yet. Saving settings starts the trail.</p>
                ) : (
                  <div className="max-h-[440px] overflow-y-auto">
                    {sessionPolicyAudit.map((row, idx) => {
                      const isSession = (row as any).action === "ADMIN_SESSION_POLICY_UPDATE";
                      const actorName = row.actor?.name || row.actor?.email || row.actorRole || "Admin";
                      const changed = row.changes ? Object.entries(row.changes).filter(([, v]) => String(v?.from ?? "") !== String(v?.to ?? "")) : [];
                      return (
                        <div key={row.id} className={`flex items-start gap-3 px-4 py-3 sm:px-5 ${idx ? "border-0 border-t border-solid border-neutral-200" : ""}`}>
                          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${idx === 0 ? "bg-neutral-900 text-white ring-2 ring-emerald-500 ring-offset-2" : "bg-neutral-100 text-neutral-500"}`}>
                            {actorName.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                              <span className="font-semibold text-neutral-900">{actorName}</span>
                              <span className="text-neutral-400">{isSession ? "changed the session policy" : "saved settings"}</span>
                              {idx === 0 && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Latest</span>}
                            </p>
                            {changed.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {changed.slice(0, 4).map(([k, v]) => (
                                  <span key={k} className="inline-flex items-center gap-1.5 rounded-md bg-neutral-50 px-2 py-1 text-[11px] text-neutral-600 ring-1 ring-inset ring-neutral-200">
                                    <span className="font-semibold text-neutral-800">{fieldName(k)}</span>
                                    <span className="tabular-nums text-neutral-400 line-through">{shown(v?.from)}</span>
                                    <ChevronRight className="h-3 w-3 text-neutral-300" />
                                    <span className="font-semibold tabular-nums text-emerald-700">{shown(v?.to)}</span>
                                  </span>
                                ))}
                                {changed.length > 4 && <span className="inline-flex items-center rounded-md px-2 py-1 text-[11px] text-neutral-400">+{changed.length - 4} more</span>}
                              </div>
                            ) : (
                              <p className="m-0 mt-0.5 text-xs text-neutral-400">No field values changed.</p>
                            )}
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="m-0 text-xs font-semibold text-neutral-700">{ago(row.createdAt)}</p>
                            <p className="m-0 mt-0.5 text-[11px] tabular-nums text-neutral-400">
                              {new Date(row.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            );
          })()}

          {/* Payments: one ruled table of commissions with a worked example, then the display currency */}
          {(() => {
            const rows = [
              { id: "commissionPercent", label: "Property", applies: "Owners, on accommodation bookings", curKey: "commissionCurrency", fallback: "TZS" },
              { id: "driverCommissionPercent", label: "Driver", applies: "Drivers, on transport trip payouts", curKey: "driverCommissionCurrency", fallback: "TZS" },
              { id: "agentCommissionPercent", label: "Tour agent", applies: "Operators, on tour earnings", curKey: "agentCommissionCurrency", fallback: "USD" },
            ] as const;
            return (
              <section id="payments" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(<CreditCard className="h-4 w-4" />, "Payments", "What NoLSAF keeps from each booking, and the currency prices are shown in.")}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="text-[11px] text-neutral-400">
                        <th className="px-4 py-2.5 font-semibold sm:px-5">Commission</th>
                        <th className="w-36 px-3 py-2.5 font-semibold">Rate</th>
                        <th className="w-[1%] px-3 py-2.5 font-semibold">Currency</th>
                        <th className="px-4 py-2.5 text-right font-semibold sm:px-5">On a 100,000 booking</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const rate = Number((s as any)?.[row.id] ?? 0);
                        const cur = (s as any)?.[row.curKey] || row.fallback;
                        const kept = Math.round((100000 * (Number.isFinite(rate) ? rate : 0)) / 100);
                        return (
                          <tr key={row.id} className="border-0 border-t border-solid border-neutral-200">
                            <td className="px-4 py-3 sm:px-5">
                              <label htmlFor={row.id} className="block font-semibold text-neutral-900">{row.label}</label>
                              <span className="block text-xs text-neutral-400">{row.applies}</span>
                            </td>
                            <td className="px-3 py-3">
                              <div className="relative">
                                <input
                                  id={row.id}
                                  type="number" min={0} max={100} step="0.01" inputMode="decimal"
                                  value={(s as any)?.[row.id] ?? 0}
                                  onChange={(e) => setS((prev: any) => ({ ...(prev || {}), [row.id]: Number(e.target.value) }))}
                                  className={`${fieldClass} pr-7`}
                                />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">%</span>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              {currencyPicker(`${row.label} commission currency`, cur, (c) => setS((prev: any) => ({ ...(prev || {}), [row.curKey]: c })))}
                            </td>
                            <td className="px-4 py-3 text-right sm:px-5">
                              <span className="block font-semibold tabular-nums text-neutral-900">{kept.toLocaleString()} {cur} kept</span>
                              <span className="block text-xs tabular-nums text-neutral-400">{(100000 - kept).toLocaleString()} {cur} to the partner</span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-col gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Display currency</p>
                    <span className="block text-xs text-neutral-400">Prices and totals across the platform are shown in this currency.</span>
                  </div>
                  {currencyPicker("Display currency", s?.currency || "TZS", (c) => setS((prev: any) => ({ ...(prev || {}), currency: c })))}
                </div>
              </section>
            );
          })()}

          {/* Payout safeguards: hard limits that send a payout to security review before it can be batched */}
          {(() => {
            const available = Boolean((s as any)?.payoutSafeguardsAvailable);
            const fields = [
              {
                id: "payoutReviewThresholdTzs",
                label: "Review any payout from",
                suffix: "TZS",
                placeholder: "Off",
                hint: "One payout at or above this goes to security review, whatever the payee's history.",
              },
              {
                id: "payoutDailyCapPerPayeeTzs",
                label: "Daily limit per payee",
                suffix: "TZS",
                placeholder: "Off",
                hint: "Paid or in flight to one payee in 24 hours, including this payout.",
              },
              {
                id: "payoutRecentChangeHours",
                label: "Treat a new payout account as new for",
                suffix: "hours",
                placeholder: "72",
                hint: "24 to 336. An established payee paid to an account changed inside this window is held.",
              },
            ];
            const value = (id: string) => {
              const v = (s as any)?.[id];
              return v === null || v === undefined ? "" : String(v);
            };
            return (
              <section id="payoutsafeguards" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <ShieldCheck className="h-4 w-4" />,
                  "Payout safeguards",
                  "Limits that hold a payout for a second admin before it can be batched and sent.",
                  available ? (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 text-[11px] font-semibold text-neutral-600"><KeyRound className="h-3 w-3" /> Loosening asks for your finance code</span>
                  ) : (
                    <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Needs the database update</span>
                  ),
                )}
                <div className="grid grid-cols-1 sm:grid-cols-3">
                  {fields.map((f, i) => (
                    <div key={f.id} className={`min-w-0 px-4 py-3.5 sm:px-5 ${i ? "border-0 border-t border-solid border-neutral-200 sm:border-l sm:border-t-0" : ""}`}>
                      <label htmlFor={f.id} className={sectionLabel}>{f.label}</label>
                      <div className="relative mt-1.5">
                        <input
                          id={f.id}
                          type="number" min={0} step={f.suffix === "TZS" ? 1000 : 1} inputMode="numeric"
                          disabled={!available}
                          placeholder={f.placeholder}
                          value={value(f.id)}
                          onChange={(e) => setS((prev: any) => ({ ...(prev || {}), [f.id]: e.target.value === "" ? null : Number(e.target.value) }))}
                          className={`${fieldClass} pr-14 disabled:cursor-not-allowed disabled:bg-neutral-50 ${validationErrors[f.id] ? "border-rose-300" : ""}`}
                        />
                        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-neutral-400">{f.suffix}</span>
                      </div>
                      <p className={`m-0 mt-1 text-[11px] ${validationErrors[f.id] ? "font-medium text-rose-600" : "text-neutral-400"}`}>{validationErrors[f.id] || f.hint}</p>
                    </div>
                  ))}
                </div>
                <p className="m-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-2.5 text-xs text-neutral-500 sm:px-5">
                  Leave a limit blank to turn it off. A held payout is released from <a href="/admin/disbursements/security-review" className="font-semibold text-neutral-800">Security review</a> by an admin other than the one who approved it.
                </p>
              </section>
            );
          })()}

          {/* Operator tiers: the promotion ladder as one ruled table, saved on its own */}
          {(() => {
            const tiers = [
              { key: "SILVER", label: "Silver", text: "text-slate-600", dot: "bg-slate-400" },
              { key: "GOLD", label: "Gold", text: "text-amber-700", dot: "bg-amber-400" },
              { key: "PLATINUM", label: "Platinum", text: "text-indigo-700", dot: "bg-indigo-500" },
            ];
            const fields = [
              { key: "minTours", label: "Completed tours", step: "1", max: undefined as number | undefined, suffix: "" },
              { key: "minRevenue", label: "Revenue (USD)", step: "100", max: undefined as number | undefined, suffix: "$" },
              { key: "minRating", label: "Min rating", step: "0.1", max: 5 as number | undefined, suffix: "★" },
              { key: "minReviews", label: "Min reviews", step: "1", max: undefined as number | undefined, suffix: "" },
            ];
            const savedLadder = (s as any)?.agentTierLadder;
            const tiersDirty = Boolean(savedLadder) && JSON.stringify(savedLadder) !== JSON.stringify(tierLadder);
            return (
              <section id="operatortiers" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <Crown className="h-4 w-4" />,
                  "Operator tiers",
                  "A tour operator moves up when all four are met. Each tier must be at least the one below.",
                  <>
                    {tiersDirty && (
                      <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Unsaved changes
                      </span>
                    )}
                    <button type="button" onClick={() => { setTierLadder(tierDefaults); setTierErrors({}); }} className="inline-flex h-8 items-center rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-700 transition-colors hover:bg-neutral-50">
                      Reset to defaults
                    </button>
                    <button type="button" onClick={saveTierLadder} disabled={savingTiers} className="inline-flex h-8 items-center rounded-lg border-0 bg-[#0b2420] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#12342f] disabled:opacity-60">
                      {savingTiers ? "Saving..." : "Save tiers"}
                    </button>
                  </>,
                )}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                    <thead>
                      <tr className="text-[11px] text-neutral-400">
                        <th className="w-40 px-4 py-2.5 font-semibold sm:px-5">Tier</th>
                        {fields.map((f) => <th key={f.key} className="px-3 py-2.5 font-semibold">{f.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-0 border-t border-solid border-neutral-200 bg-neutral-50/50">
                        <td className="px-4 py-3 sm:px-5">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-orange-800"><span className="h-2 w-2 rounded-full bg-orange-300" /> Bronze</span>
                        </td>
                        <td colSpan={fields.length} className="px-3 py-3 text-xs text-neutral-400">Starting tier. Every approved operator begins here.</td>
                      </tr>
                      {tiers.map((tier) => (
                        <tr key={tier.key} className="border-0 border-t border-solid border-neutral-200 align-top">
                          <td className="px-4 py-3 sm:px-5">
                            <span className={`inline-flex h-9 items-center gap-1.5 font-semibold ${tier.text}`}><span className={`h-2 w-2 rounded-full ${tier.dot}`} /> {tier.label}</span>
                          </td>
                          {fields.map((f) => {
                            const err = tierErrors[`${tier.key}.${f.key}`];
                            return (
                              <td key={f.key} className="px-3 py-3">
                                <div className="relative">
                                  <input
                                    type="number" min={0} step={f.step} {...(f.max != null ? { max: f.max } : {})} inputMode="decimal"
                                    aria-label={`${tier.label} ${f.label}`}
                                    value={tierLadder?.[tier.key]?.[f.key] ?? ""}
                                    onChange={(e) => setTierField(tier.key, f.key, e.target.value)}
                                    className={`${fieldClass} ${f.suffix ? "pr-7" : ""} ${err ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : ""}`}
                                  />
                                  {f.suffix && <span className={`pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold ${f.suffix === "★" ? "text-amber-400" : "text-neutral-400"}`}>{f.suffix}</span>}
                                </div>
                                {err && <p className="m-0 mt-1 text-[11px] font-medium text-rose-600">{err}</p>}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="m-0 border-0 border-t border-solid border-neutral-200 px-4 py-2.5 text-xs text-neutral-400 sm:px-5">Saved on its own with Save tiers, not with the save bar.</p>
              </section>
            );
          })()}

          {/* Driver levels: the badge ladder left, the referral credit right, each with a worked example */}
          {(() => {
            const gold = Number(s?.driverLevelGoldThreshold ?? 0);
            const diamond = Number(s?.driverLevelDiamondThreshold ?? 0);
            const referral = Number(referralPercentInput);
            const referralExample = Number.isFinite(referral) ? Math.round((200000 * referral) / 100) : 0;
            const clearErrors = (...keys: string[]) => setValidationErrors((prev) => { const n = { ...prev }; keys.forEach((k) => delete n[k]); return n; });
            const steps = [
              { key: "standard", label: "Standard", dot: "bg-neutral-400", text: "text-neutral-600", hint: "Every new driver starts here." },
              { key: "driverLevelGoldThreshold", label: "Gold", dot: "bg-amber-400", text: "text-amber-700", hint: "Lifetime earnings to reach Gold." },
              { key: "driverLevelDiamondThreshold", label: "Diamond", dot: "bg-indigo-500", text: "text-indigo-700", hint: diamond > gold && gold > 0 ? `${(diamond - gold).toLocaleString()} TZS above Gold.` : "Must be at least the Gold amount." },
            ];
            return (
              <section id="driverlevels" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(<Award className="h-4 w-4" />, "Driver levels and referrals", "Earnings that move a driver's badge up, and the credit paid for a referral. Live as soon as you save.")}
                <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <div className="min-w-0 p-4 sm:p-5">
                    <p className={sectionLabel}>Badge ladder</p>
                    <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {steps.map((step, idx) => {
                        const err = validationErrors[step.key];
                        return (
                          <div key={step.key} className="relative min-w-0 rounded-xl bg-neutral-50 ring-1 ring-inset ring-neutral-200 p-3.5">
                            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${step.text}`}><span className={`h-2 w-2 rounded-full ${step.dot}`} /> {step.label}</span>
                            {step.key === "standard" ? (
                              <span className="mt-2 flex h-9 items-center text-sm font-semibold tabular-nums text-neutral-900">From 0 TZS</span>
                            ) : (
                              <div className="relative mt-2">
                                <input
                                  id={step.key}
                                  type="number" min={0} step="1000" inputMode="numeric"
                                  value={(s as any)?.[step.key] ?? ""}
                                  onChange={(e) => {
                                    setS((prev: any) => ({ ...(prev || {}), [step.key]: Number(e.target.value) }));
                                    clearErrors(step.key, "driverLevelDiamondThreshold");
                                  }}
                                  aria-label={`${step.label} threshold`}
                                  className={`${fieldClass} pr-11 ${err ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : ""}`}
                                />
                                <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-neutral-400">TZS</span>
                              </div>
                            )}
                            <span className={`mt-1.5 block text-[11px] ${err ? "font-medium text-rose-600" : "text-neutral-500"}`}>{err || step.hint}</span>
                            {idx < steps.length - 1 && (
                              <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 rounded-full bg-white p-0.5 text-neutral-300 ring-1 ring-neutral-200 sm:block" aria-hidden />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="min-w-0 border-0 border-t border-solid border-neutral-200 p-4 sm:p-5 lg:border-l lg:border-t-0">
                    <label htmlFor="referralCreditPercent" className={`block ${sectionLabel}`}>Referral credit</label>
                    <div className="relative mt-3">
                      <input
                        id="referralCreditPercent"
                        type="number" min={0} max={100} step="0.01" inputMode="decimal" placeholder="0.35"
                        value={referralPercentInput}
                        onChange={(e) => { setReferralPercentInput(e.target.value); clearErrors("referralCreditPercent"); }}
                        className={`${fieldClass} pr-7 ${validationErrors.referralCreditPercent ? "border-rose-300 focus:border-rose-400 focus:ring-rose-200" : ""}`}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">%</span>
                    </div>
                    {validationErrors.referralCreditPercent ? (
                      <p className="m-0 mt-1.5 text-[11px] font-medium text-rose-600">{validationErrors.referralCreditPercent}</p>
                    ) : (
                      <p className="m-0 mt-1.5 text-[11px] text-neutral-500">Share of the referred booking paid to the referrer.</p>
                    )}
                    <div className="mt-3 rounded-lg bg-emerald-50/70 px-3 py-2.5 text-xs text-emerald-900">
                      On a 200,000 TZS booking the referrer earns <span className="font-bold tabular-nums">{referralExample.toLocaleString()} TZS</span>.
                    </div>
                  </div>
                </div>
                <p className="m-0 border-0 border-t border-solid border-neutral-200 px-4 py-2.5 text-xs text-neutral-400 sm:px-5">Saved with the save bar.</p>
              </section>
            );
          })()}

          {/* Notifications: channel switches and the support contact on one ruled row */}
          <section id="notifications" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<Bell className="h-4 w-4" />, "Notifications", "Which channels the platform sends on, and the support contact shown to people.")}
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {[
                { key: "emailEnabled", label: "Email", hint: "Invoices, receipts and key account actions.", on: Boolean(s?.emailEnabled) },
                { key: "smsEnabled", label: "SMS alerts", hint: "Urgent events and operational alerts.", on: Boolean(s?.smsEnabled) },
              ].map((ch, i) => (
                <div key={ch.key} className={`flex min-w-0 items-center gap-4 px-4 py-3.5 sm:px-5 ${i ? "border-0 border-t border-solid border-neutral-200 sm:border-l sm:border-t-0" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">{ch.label}</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-400">{ch.hint}</p>
                  </div>
                  <span className={`text-xs font-semibold ${ch.on ? "text-emerald-700" : "text-neutral-400"}`}>{ch.on ? "On" : "Off"}</span>
                  {switchControl(ch.label, ch.on, (v) => setS((prev: any) => ({ ...(prev || {}), [ch.key]: v })))}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-3.5 sm:grid-cols-2 sm:px-5">
              <label className="block min-w-0">
                <span className={sectionLabel}>Support email</span>
                <input className={`${fieldClass} mt-1.5`} value={supportEmail} onChange={(e) => setSupportEmail(e.target.value)} placeholder="support@nolsaf.com" type="email" />
              </label>
              <label className="block min-w-0">
                <span className={sectionLabel}>Support phone</span>
                <input className={`${fieldClass} mt-1.5`} value={supportPhone} onChange={(e) => setSupportPhone(e.target.value)} placeholder="+255 736 766 726" type="tel" />
              </label>
            </div>
          </section>

          {/* Feature flags and templates: two editors side by side, clearly marked as not saved yet */}
          <section id="featureflags" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(
              <Flag className="h-4 w-4" />,
              "Feature flags and templates",
              "Edit as JSON. These are a preview for now; saving them needs backend support.",
              <>
                <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Not saved yet</span>
                <button onClick={saveFlagsAndTemplates} className={btnGhost} type="button" disabled>Save</button>
              </>,
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2">
              {[
                { id: "featureFlags", label: "Feature flags", value: featureFlags, set: setFeatureFlags, placeholder: '{"new_ui": true}' },
                { id: "notificationTemplates", label: "Notification templates", value: notificationTemplates, set: setNotificationTemplates, placeholder: '{"owner_payout": "Payout of {{amount}} processed"}' },
              ].map((ed, i) => {
                let valid = true;
                try { JSON.parse(ed.value || "{}"); } catch { valid = false; }
                return (
                  <div key={ed.id} className={`min-w-0 px-4 py-3.5 sm:px-5 ${i ? "border-0 border-t border-solid border-neutral-200 lg:border-l lg:border-t-0" : ""}`}>
                    <div className="flex items-center justify-between gap-2">
                      <label htmlFor={ed.id} className={sectionLabel}>{ed.label}</label>
                      <span className={`text-[11px] font-semibold ${valid ? "text-emerald-700" : "text-rose-600"}`}>{valid ? "Valid JSON" : "Invalid JSON"}</span>
                    </div>
                    <textarea id={ed.id} rows={5} className={`${textareaClass} mt-1.5`} value={ed.value} onChange={(e) => ed.set(e.target.value)} placeholder={ed.placeholder} />
                  </div>
                );
              })}
            </div>
          </section>

          {/* Sessions and sign-in: ruled rows, with idle timeouts by role and what each one means in practice */}
          {(() => {
            const asDuration = (minutes: number) => {
              if (!Number.isFinite(minutes) || minutes <= 0) return "Not set";
              if (minutes < 60) return `${minutes} min`;
              const h = Math.floor(minutes / 60);
              const m = minutes % 60;
              return m ? `${h} h ${m} min` : `${h} h`;
            };
            const fallback = Number(s?.sessionIdleMinutes ?? 60);
            const roles = [
              { id: "sessionTtlDefault", key: "sessionIdleMinutes", label: "Default", dot: "bg-neutral-400" },
              { id: "sessionTtlAdmin", key: "sessionMaxMinutesAdmin", label: "Admin", dot: "bg-emerald-500" },
              { id: "sessionTtlOwner", key: "sessionMaxMinutesOwner", label: "Owner", dot: "bg-indigo-500" },
              { id: "sessionTtlDriver", key: "sessionMaxMinutesDriver", label: "Driver", dot: "bg-amber-500" },
              { id: "sessionTtlCustomer", key: "sessionMaxMinutesCustomer", label: "Traveller", dot: "bg-sky-500" },
              { id: "sessionTtlAgent", key: "sessionMaxMinutesAgent", label: "Agent", dot: "bg-violet-500" },
            ];
            const toggle = (label: string, checked: boolean, onChange: (v: boolean) => void, id?: string) => (
              <label className="group relative inline-flex shrink-0 cursor-pointer items-center">
                <input id={id} type="checkbox" aria-label={label} checked={checked} className="peer sr-only" onChange={(e) => onChange(e.target.checked)} />
                <div className={toggleTrackClass}><Lock className="pointer-events-none absolute left-[6px] top-1/2 h-3 w-3 -translate-y-1/2 text-white opacity-0 transition-opacity duration-200 group-has-[:checked]:opacity-100" /></div>
              </label>
            );
            const row = "flex min-w-0 items-center gap-4 border-0 border-t border-solid border-neutral-200 px-4 py-3.5 sm:px-5";
            return (
              <section id="security" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <ShieldCheck className="h-4 w-4" />,
                  "Sessions and sign-in",
                  "How long people stay signed in. Enforced on the server and recorded in the audit trail.",
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 text-[11px] font-semibold text-neutral-600"><History className="h-3 w-3" /> Audited</span>,
                )}

                <div className={`${row} border-t-0`}>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Admin two-step sign-in</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-400">A password alone never opens the admin area. Every admin confirms with a passkey or authenticator code. This cannot be turned off.</p>
                  </div>
                  <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700"><Lock className="h-3 w-3" /> Always on</span>
                </div>

                <div className="border-0 border-t border-solid border-neutral-200 px-4 py-4 sm:px-5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Idle timeout by role</p>
                    <p className="m-0 text-xs text-neutral-400">Minutes. Leave a role blank to use Default. Lowering one signs those people out on their next request.</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                    {roles.map((role) => {
                      const raw = (s as any)?.[role.key];
                      const isDefault = role.key === "sessionIdleMinutes";
                      const effective = isDefault ? Number(raw ?? 60) : raw == null || raw === "" ? fallback : Number(raw);
                      return (
                        <div key={role.id} className={`min-w-0 rounded-xl p-3 ${isDefault ? "bg-[#0b2420]/[0.04] ring-1 ring-inset ring-[#0b2420]/10" : "bg-neutral-50 ring-1 ring-inset ring-neutral-200"}`}>
                          <label htmlFor={role.id} className="flex items-center gap-1.5 text-xs font-semibold text-neutral-700"><span className={`h-2 w-2 rounded-full ${role.dot}`} /> {role.label}</label>
                          <input
                            id={role.id}
                            type="number" min={5} inputMode="numeric"
                            placeholder={isDefault ? "60" : String(fallback)}
                            value={isDefault ? (raw ?? 60) : (raw ?? "")}
                            onChange={(e) => setS((prev: any) => ({ ...(prev || {}), [role.key]: isDefault ? Number(e.target.value) : e.target.value === "" ? null : Number(e.target.value) }))}
                            className={`${fieldClass} mt-2`}
                          />
                          <span className="mt-1.5 block truncate text-[11px] text-neutral-500">
                            {isDefault || (raw != null && raw !== "") ? asDuration(effective) : `Default, ${asDuration(effective)}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className={row}>
                  <div className="min-w-0 flex-1">
                    <label htmlFor="maxSessionDurationHours" className="block text-sm font-semibold text-neutral-900">Longest session</label>
                    <p className={`m-0 mt-0.5 text-xs ${validationErrors.maxSessionDurationHours ? "font-medium text-rose-600" : "text-neutral-400"}`}>
                      {validationErrors.maxSessionDurationHours || "Even an active session must sign in again after this long."}
                    </p>
                  </div>
                  <div className="relative w-28 shrink-0">
                    <input
                      id="maxSessionDurationHours"
                      type="number" min={1} max={720} inputMode="numeric"
                      value={(s?.maxSessionDurationHours ?? 24) as any}
                      onChange={(e) => setS((prev: any) => ({ ...(prev || {}), maxSessionDurationHours: Number(e.target.value) }))}
                      className={`${fieldClass} pr-7 ${validationErrors.maxSessionDurationHours ? "border-rose-300" : ""}`}
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">h</span>
                  </div>
                </div>

                <div className={row}>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Sign out everywhere on password change</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-400">Changing a password ends that account&apos;s other sessions.</p>
                  </div>
                  <span className={`hidden text-xs font-semibold sm:inline ${(s?.forceLogoutOnPasswordChange ?? true) ? "text-emerald-700" : "text-neutral-400"}`}>{(s?.forceLogoutOnPasswordChange ?? true) ? "On" : "Off"}</span>
                  {toggle("Force logout on password change", Boolean(s?.forceLogoutOnPasswordChange ?? true), (v) => setS((prev: any) => ({ ...(prev || {}), forceLogoutOnPasswordChange: v })))}
                </div>
              </section>
            );
          })()}

          {/* Passwords: the length and the four rules in one band, with the shortest password that passes */}
          {(() => {
            const rules = [
              { key: "requirePasswordUppercase", label: "Uppercase", hint: "A to Z", sample: "A" },
              { key: "requirePasswordLowercase", label: "Lowercase", hint: "a to z", sample: "a" },
              { key: "requirePasswordNumber", label: "Number", hint: "0 to 9", sample: "7" },
              { key: "requirePasswordSpecial", label: "Symbol", hint: "! @ # $ % and similar", sample: "!" },
            ];
            const min = Number(s?.minPasswordLength ?? 8);
            const active = rules.filter((r) => Boolean((s as any)?.[r.key]));
            const head = active.map((r) => r.sample).join("");
            const example = head + "x".repeat(Math.max(0, (Number.isFinite(min) ? min : 8) - head.length));
            return (
              <section id="passwords" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(<KeyRound className="h-4 w-4" />, "Passwords", "What every new or changed password must contain.", <span className="text-xs text-neutral-400">{active.length} of {rules.length} rules on</span>)}
                <div className="grid grid-cols-2 lg:grid-cols-5">
                  <div className="col-span-2 min-w-0 px-4 py-3.5 sm:px-5 lg:col-span-1">
                    <label htmlFor="minPasswordLength" className={sectionLabel}>Minimum length</label>
                    <div className="relative mt-1.5">
                      <input
                        id="minPasswordLength"
                        type="number" min={8} max={128} inputMode="numeric"
                        value={(s?.minPasswordLength ?? 8) as any}
                        onChange={(e) => setS((prev: any) => ({ ...(prev || {}), minPasswordLength: Number(e.target.value) }))}
                        className={`${fieldClass} pr-14 ${validationErrors.minPasswordLength ? "border-rose-300" : ""}`}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-neutral-400">chars</span>
                    </div>
                    {validationErrors.minPasswordLength && <p className="m-0 mt-1 text-[11px] font-medium text-rose-600">{validationErrors.minPasswordLength}</p>}
                  </div>
                  {rules.map((r, i) => {
                    const on = Boolean((s as any)?.[r.key]);
                    return (
                      <div key={r.key} className={`flex min-w-0 items-center gap-3 border-0 border-t border-solid border-neutral-200 px-4 py-3.5 sm:px-5 lg:border-l lg:border-t-0 ${i % 2 ? "border-l" : ""}`}>
                        <div className="min-w-0 flex-1">
                          <p className="m-0 text-sm font-semibold text-neutral-900">{r.label}</p>
                          <p className="m-0 mt-0.5 truncate text-xs text-neutral-400">{r.hint}</p>
                        </div>
                        {switchControl(`Require ${r.label.toLowerCase()}`, on, (v) => setS((prev: any) => ({ ...(prev || {}), [r.key]: v })))}
                      </div>
                    );
                  })}
                </div>
                <p className="m-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-2.5 text-xs text-neutral-500 sm:px-5">
                  Shortest password that passes: <code className="rounded bg-white px-1.5 py-0.5 font-mono text-[12px] text-neutral-800 ring-1 ring-inset ring-neutral-200">{example}</code>
                </p>
              </section>
            );
          })()}

          {/* Network: enforcement switch first, then the list it enforces */}
          {(() => {
            const entries = String(s?.ipAllowlist || "").split(/[\s,]+/).filter(Boolean);
            const on = Boolean(s?.enableIpAllowlist);
            return (
              <section id="network" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <Globe className="h-4 w-4" />,
                  "Network",
                  "Limit admin sign-in to trusted addresses.",
                  <a href="/admin/management/ip-allowlist" className={`${btnGhost} no-underline hover:no-underline`}>Open IP allowlist <ChevronRight className="h-3.5 w-3.5" /></a>,
                )}
                <div className="flex min-w-0 items-center gap-4 px-4 py-3.5 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">Enforce the allowlist</p>
                    <p className={`m-0 mt-0.5 text-xs ${on && entries.length === 0 ? "font-medium text-amber-700" : "text-neutral-400"}`}>
                      {on && entries.length === 0 ? "On, but the list is empty, so every address is allowed." : on ? `Admins can only sign in from ${entries.length} ${entries.length === 1 ? "entry" : "entries"} below.` : "Off. Admins can sign in from anywhere."}
                    </p>
                  </div>
                  <span className={`text-xs font-semibold ${on ? "text-emerald-700" : "text-neutral-400"}`}>{on ? "On" : "Off"}</span>
                  {switchControl("Enable IP allowlist enforcement", on, (v) => setS((prev: any) => ({ ...(prev || {}), enableIpAllowlist: v })))}
                </div>
                <div className="border-0 border-t border-solid border-neutral-200 px-4 py-3.5 sm:px-5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="ipAllowlist" className={sectionLabel}>Allowed addresses</label>
                    <span className="text-[11px] tabular-nums text-neutral-400">{entries.length} {entries.length === 1 ? "entry" : "entries"}</span>
                  </div>
                  <textarea
                    id="ipAllowlist"
                    rows={2}
                    className={`${textareaClass} mt-1.5 ${validationErrors.ipAllowlist ? "border-rose-300" : ""}`}
                    value={s?.ipAllowlist || ""}
                    onChange={(e) => setS((prev: any) => ({ ...(prev || {}), ipAllowlist: e.target.value }))}
                    onBlur={(e) => {
                      const result = validateIPAllowlist(e.target.value);
                      if (!result.valid && result.error) {
                        setValidationErrors((prev) => ({ ...prev, ipAllowlist: result.error || "Invalid IP allowlist format" }));
                      } else {
                        setValidationErrors((prev) => { const n = { ...prev }; delete n.ipAllowlist; return n; });
                      }
                    }}
                    placeholder="192.168.1.0/24, 10.0.0.0/8, 172.16.0.0/12"
                  />
                  <p className={`m-0 mt-1 text-[11px] ${validationErrors.ipAllowlist ? "font-medium text-rose-600" : "text-neutral-400"}`}>
                    {validationErrors.ipAllowlist || "Single addresses or CIDR ranges, separated by commas."}
                  </p>
                </div>
              </section>
            );
          })()}

          {/* Rate limits: three numbers side by side, with what they mean for an attacker */}
          <section id="ratelimit" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<Gauge className="h-4 w-4" />, "Rate limits", "Slow down abuse and password guessing.")}
            <div className="grid grid-cols-1 sm:grid-cols-3">
              {[
                { id: "apiRateLimitPerMinute", label: "API requests", suffix: "/ min", min: 10, max: 10000, value: s?.apiRateLimitPerMinute ?? 100, hint: "Per address, across the API." },
                { id: "maxLoginAttempts", label: "Sign-in attempts", suffix: "tries", min: 3, max: 20, value: s?.maxLoginAttempts ?? 5, hint: "Failed tries before the account locks." },
                { id: "accountLockoutDurationMinutes", label: "Lockout", suffix: "min", min: 5, max: 1440, value: s?.accountLockoutDurationMinutes ?? 30, hint: "How long a locked account waits." },
              ].map((f, i) => (
                <div key={f.id} className={`min-w-0 px-4 py-3.5 sm:px-5 ${i ? "border-0 border-t border-solid border-neutral-200 sm:border-l sm:border-t-0" : ""}`}>
                  <label htmlFor={f.id} className={sectionLabel}>{f.label}</label>
                  <div className="relative mt-1.5">
                    <input
                      id={f.id}
                      type="number" min={f.min} max={f.max} inputMode="numeric"
                      value={f.value as any}
                      onChange={(e) => setS((prev: any) => ({ ...(prev || {}), [f.id]: Number(e.target.value) }))}
                      className={`${fieldClass} pr-14 ${validationErrors[f.id] ? "border-rose-300" : ""}`}
                    />
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-neutral-400">{f.suffix}</span>
                  </div>
                  <p className={`m-0 mt-1 text-[11px] ${validationErrors[f.id] ? "font-medium text-rose-600" : "text-neutral-400"}`}>{validationErrors[f.id] || f.hint}</p>
                </div>
              ))}
            </div>
            <p className="m-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-2.5 text-xs text-neutral-500 sm:px-5">
              Someone guessing a password gets <span className="font-semibold text-neutral-800">{s?.maxLoginAttempts ?? 5} tries</span>, then waits <span className="font-semibold text-neutral-800">{s?.accountLockoutDurationMinutes ?? 30} min</span> before the next.
            </p>
          </section>

          {/* Monitoring: three switches, one per column */}
          <section id="auditmon" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(<Activity className="h-4 w-4" />, "Monitoring", "What gets recorded, and when admins are alerted.")}
            <div className="grid grid-cols-1 sm:grid-cols-3">
              {[
                { key: "audit", label: "Audit logging", hint: "Admin actions and security events. Cannot be turned off.", on: true, fixed: true },
                { key: "logFailedLoginAttempts", label: "Failed sign-ins", hint: "Write each failed attempt to the server log.", on: Boolean(s?.logFailedLoginAttempts ?? true), fixed: false },
                { key: "alertOnSuspiciousActivity", label: "Suspicious activity alerts", hint: "Admin inbox alert on lockouts, failed admin verification, blocked addresses and sign-in bursts.", on: Boolean(s?.alertOnSuspiciousActivity ?? false), fixed: false },
              ].map((t, i) => (
                <div key={t.key} className={`flex min-w-0 items-center gap-3 px-4 py-3.5 sm:px-5 ${i ? "border-0 border-t border-solid border-neutral-200 sm:border-l sm:border-t-0" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="m-0 text-sm font-semibold text-neutral-900">{t.label}</p>
                    <p className="m-0 mt-0.5 text-xs text-neutral-400">{t.hint}</p>
                  </div>
                  {t.fixed ? <span className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 text-[11px] font-semibold text-emerald-700"><Lock className="h-3 w-3" /> Always on</span> : switchControl(t.label, t.on, (v) => setS((prev: any) => ({ ...(prev || {}), [t.key]: v })))}
                </div>
              ))}
            </div>
          </section>

          {/* Security checklist: the old best-practice tips, now checked against the live values */}
          {(() => {
            const adminIdle = Number(s?.sessionMaxMinutesAdmin ?? s?.sessionIdleMinutes ?? 60);
            const strongPasswords =
              Number(s?.minPasswordLength ?? 8) >= 12 && Boolean(s?.requirePasswordUppercase && s?.requirePasswordLowercase && s?.requirePasswordNumber && s?.requirePasswordSpecial);
            const checks = [
              { ok: Boolean(s?.alertOnSuspiciousActivity), title: "Suspicious activity alerts", detail: s?.alertOnSuspiciousActivity ? "Admins are alerted to lockouts and attacks." : "Off. Attacks are only visible in server logs.", href: "#auditmon" },
              { ok: strongPasswords, title: "Strong passwords", detail: strongPasswords ? "12+ characters with all four rules." : `Now ${s?.minPasswordLength ?? 8} characters; 12 with all rules is advised.`, href: "#passwords" },
              { ok: Boolean(s?.enableIpAllowlist && String(s?.ipAllowlist || "").trim()), title: "Admin network limited", detail: s?.enableIpAllowlist ? "Allowlist is enforced." : "Admins can sign in from any address.", href: "#network" },
              { ok: adminIdle <= 60, title: "Short admin sessions", detail: `Admins are signed out after ${adminIdle} idle min.`, href: "#security" },
              { ok: Number(s?.maxLoginAttempts ?? 5) <= 5, title: "Guessing is locked out", detail: `${s?.maxLoginAttempts ?? 5} tries, then ${s?.accountLockoutDurationMinutes ?? 30} min wait.`, href: "#ratelimit" },
              { ok: Boolean(s?.logFailedLoginAttempts ?? true), title: "Failed sign-ins logged", detail: (s?.logFailedLoginAttempts ?? true) ? "Every failed attempt is written to the log." : "Failed attempts are not logged.", href: "#auditmon" },
            ];
            const met = checks.filter((c) => c.ok).length;
            return (
              <section className="overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <ShieldCheck className="h-4 w-4" />,
                  "Security checklist",
                  "Recommended settings, checked against what is set now.",
                  <span className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold ${met === checks.length ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                    {met} of {checks.length} met
                  </span>,
                )}
                <div className="grid grid-cols-1 gap-px bg-neutral-200 sm:grid-cols-2 lg:grid-cols-3">
                  {checks.map((c) => (
                    <a
                      key={c.title}
                      href={c.href}
                      className="flex min-w-0 items-start gap-3 bg-white px-4 py-3.5 text-left no-underline transition-colors hover:bg-neutral-50 hover:no-underline sm:px-5"
                    >
                      {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />}
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-neutral-900">{c.title}</span>
                        <span className={`block text-xs ${c.ok ? "text-neutral-400" : "text-amber-700"}`}>{c.detail}</span>
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            );
          })()}

          {/* Invoicing: tax and numbering on one row, the template below, preview only once generated */}
          <section id="invoicing" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
            {sectionHead(
              <FileText className="h-4 w-4" />,
              "Tax and invoicing",
              "The tax rate and invoice numbering. The template is a preview only.",
              <>
                <button onClick={previewInvoice} className={btnGhost} type="button">Preview</button>
                <button onClick={saveInvoicingSettings} className={btnDark} type="button">Save tax and prefix</button>
              </>,
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3">
              <div className="min-w-0 px-4 py-3.5 sm:px-5">
                <label htmlFor="taxRate" className={sectionLabel}>Tax rate</label>
                <div className="relative mt-1.5">
                  <input id="taxRate" type="number" min={0} step="0.01" inputMode="decimal" className={`${fieldClass} pr-7`} value={s?.taxPercent ?? 0} onChange={(e) => setS((prev: any) => ({ ...(prev || {}), taxPercent: Number(e.target.value) }))} />
                  <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">%</span>
                </div>
              </div>
              <div className="min-w-0 border-0 border-t border-solid border-neutral-200 px-4 py-3.5 sm:border-l sm:border-t-0 sm:px-5">
                <label htmlFor="invoicePrefix" className={sectionLabel}>Invoice prefix</label>
                <input id="invoicePrefix" className={`${fieldClass} mt-1.5 font-mono`} value={s?.invoicePrefix || "INV-"} onChange={(e) => setS((prev: any) => ({ ...(prev || {}), invoicePrefix: e.target.value }))} />
              </div>
              <div className="min-w-0 border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-3.5 sm:border-l sm:border-t-0 sm:px-5">
                <p className={sectionLabel}>On 100,000 {(s?.currency || "TZS").toUpperCase()}</p>
                <p className="m-0 mt-1.5 text-sm font-semibold tabular-nums text-neutral-900">{Math.round((100000 * Number(s?.taxPercent ?? 0)) / 100).toLocaleString()} tax</p>
                <p className="m-0 mt-0.5 text-[11px] text-neutral-400">Numbers start with <span className="font-mono text-neutral-600">{s?.invoicePrefix || "INV-"}</span></p>
              </div>
            </div>
            <div className="border-0 border-t border-solid border-neutral-200 px-4 py-3.5 sm:px-5">
              <label htmlFor="invoiceTemplate" className={sectionLabel}>Invoice template (HTML)</label>
              <textarea id="invoiceTemplate" rows={4} className={`${textareaClass} mt-1.5`} value={invoiceTemplate} onChange={(e) => setInvoiceTemplate(e.target.value)} placeholder="<h1>Invoice {{invoiceNumber}}</h1>" />
            </div>
            {invoicePreviewHtml && (
              <div
                id="invoicePreviewArea"
                className="max-h-64 max-w-full overflow-x-hidden overflow-y-auto border-0 border-t border-solid border-neutral-200 bg-neutral-50/60 px-4 py-3.5 text-sm text-neutral-700 sm:px-5 [&_*]:max-w-full [&_img]:h-auto [&_img]:max-w-full [&_pre]:whitespace-pre-wrap [&_code]:break-words [&_p]:break-words [&_span]:break-words [&_a]:break-words [&_table]:block [&_table]:w-full [&_table]:max-w-full [&_table]:table-fixed [&_th]:break-words [&_td]:break-words"
                dangerouslySetInnerHTML={{ __html: invoicePreviewHtml }}
              />
            )}
          </section>

          {/* Scheduling: the payout cron with a plain-language reading of it */}
          {(() => {
            const pad = (n: string) => n.padStart(2, "0");
            const readCron = (expr: string) => {
              const parts = expr.trim().split(/\s+/);
              if (parts.length !== 5) return expr.trim() ? "Not a five-part cron expression." : "Uses the default: 02:00 on the 1st of each month.";
              const [m, h, dom, mon, dow] = parts;
              if (!/^\d+$/.test(m) || !/^\d+$/.test(h)) return "Custom schedule.";
              const at = `${pad(h)}:${pad(m)}`;
              const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
              if (dom === "*" && mon === "*" && dow === "*") return `Every day at ${at}.`;
              if (/^\d+$/.test(dom) && mon === "*" && dow === "*") return `At ${at} on day ${dom} of every month.`;
              if (dom === "*" && mon === "*" && /^[0-6]$/.test(dow)) return `Every ${days[Number(dow)]} at ${at}.`;
              return "Custom schedule.";
            };
            return (
              <section id="scheduling" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <CalendarClock className="h-4 w-4" />,
                  "Scheduling",
                  "When automatic payouts run. Saving the schedule needs backend support.",
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-amber-50 px-2.5 text-[11px] font-semibold text-amber-700"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Coming soon</span>,
                )}
                <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-end sm:px-5">
                  <label className="block min-w-0 sm:w-72">
                    <span className={sectionLabel}>Payout cron</span>
                    <input id="payoutCron" className={`${fieldClass} mt-1.5 font-mono`} placeholder="0 2 1 * *" value={payoutCron} onChange={(e) => setPayoutCron(e.target.value)} />
                  </label>
                  <p className="m-0 flex h-9 min-w-0 flex-1 items-center rounded-lg bg-neutral-50 px-3 text-sm text-neutral-700">{readCron(payoutCron)}</p>
                  <button onClick={updatePayoutCron} className={`${btnGhost} h-9`} type="button">Save</button>
                </div>
              </section>
            );
          })()}

          {/* Bonuses: owner and percent on one row, the preview as a fact strip */}
          {(() => {
            const ownerIdValid = Boolean(bonusOwnerId) && Number.isFinite(Number(bonusOwnerId)) && Number(bonusOwnerId) > 0;
            const data = (bonusPreview as any)?.data;
            return (
              <section id="bonuses" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-neutral-300 bg-white shadow-sm">
                {sectionHead(
                  <Gift className="h-4 w-4" />,
                  "Owner bonus",
                  "Preview a bonus on an owner's paid invoices from the last 30 days, then grant it. Grants are audited.",
                  <>
                    <button onClick={previewBonus} className={btnGhost} type="button" disabled={!ownerIdValid}>Preview</button>
                    <button onClick={grantBonus} className={btnDark} type="button" disabled={!ownerIdValid}>Grant bonus</button>
                  </>,
                )}
                <div className="grid grid-cols-1 sm:grid-cols-2">
                  <div className="min-w-0 px-4 py-3.5 sm:px-5">
                    <label htmlFor="bonusOwnerId" className={sectionLabel}>Owner ID</label>
                    <div className="relative mt-1.5">
                      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">#</span>
                      <input id="bonusOwnerId" className={`${fieldClass} pl-6`} value={bonusOwnerId} onChange={(e) => setBonusOwnerId(String(e.target.value || "").replace(/\D+/g, ""))} placeholder="13" inputMode="numeric" />
                    </div>
                    <p className={`m-0 mt-1 truncate text-[11px] ${bonusOwnerLookupError || (bonusOwnerId && !ownerIdValid) ? "font-medium text-rose-600" : "text-neutral-400"}`}>
                      {!bonusOwnerId
                        ? "Type an owner ID to look the owner up."
                        : !ownerIdValid
                          ? "Enter a valid numeric owner ID."
                          : bonusOwnerLookupLoading
                            ? "Looking up owner..."
                            : bonusOwnerLookupError
                              ? bonusOwnerLookupError
                              : bonusOwnerLookup
                                ? <>Owner: <span className="font-semibold text-neutral-700">{bonusOwnerLookup.name || `#${bonusOwnerLookup.id}`}</span>{bonusOwnerLookup.email ? ` · ${bonusOwnerLookup.email}` : ""}</>
                                : "Owner receiving the bonus."}
                    </p>
                  </div>
                  <div className="min-w-0 border-0 border-t border-solid border-neutral-200 px-4 py-3.5 sm:border-l sm:border-t-0 sm:px-5">
                    <label htmlFor="bonusPercentInput" className={sectionLabel}>Bonus</label>
                    <div className="relative mt-1.5">
                      <input id="bonusPercentInput" type="number" min={0} step="0.01" inputMode="decimal" className={`${fieldClass} pr-7`} value={bonusPercentInput} onChange={(e) => setBonusPercentInput(Number(e.target.value))} placeholder="5" />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-neutral-400">%</span>
                    </div>
                    <p className="m-0 mt-1 text-[11px] text-neutral-400">Applied to eligible revenue in the preview window.</p>
                  </div>
                </div>
                {bonusPreview && (
                  <div className="border-0 border-t border-solid border-neutral-200 bg-neutral-50/60">
                    {data && (
                      <dl className="m-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                        {[
                          { label: "Owner", value: `#${String(data.ownerId ?? bonusOwnerId)}` },
                          { label: "Bonus", value: formatPercent(data.bonusPercent ?? bonusPercentInput) },
                          { label: "Eligible revenue", value: formatMoney(data.totalRevenue) },
                          { label: "Bonus amount", value: formatMoney(data.bonusAmount) },
                          { label: "Commission", value: formatPercent(data.commissionPercent) },
                          { label: "Reference", value: String(data.bonusPaymentRef ?? "None") },
                        ].map((f) => (
                          <div key={f.label} className="min-w-0 px-4 py-3 sm:px-5">
                            <dt className={sectionLabel}>{f.label}</dt>
                            <dd className="m-0 mt-1 truncate text-sm font-semibold tabular-nums text-neutral-900">{f.value}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    <details className="border-0 border-t border-solid border-neutral-200 px-4 py-2.5 sm:px-5">
                      <summary className="cursor-pointer select-none text-xs font-semibold text-neutral-500">Raw response</summary>
                      <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-white p-3 text-[12px] text-neutral-700 ring-1 ring-inset ring-neutral-200">{JSON.stringify(bonusPreview, null, 2)}</pre>
                    </details>
                  </div>
                )}
              </section>
            );
          })()}
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
