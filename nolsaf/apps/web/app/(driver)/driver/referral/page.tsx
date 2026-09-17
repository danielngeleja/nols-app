"use client";

import React, { useEffect, useState, useRef, useCallback } from "react";
import { Share2, Copy, CheckCircle, Users, Gift, Mail, MessageCircle, Link as LinkIcon, TrendingUp, UserPlus, Bell, AlertCircle, X, Wallet, ArrowUpRight, Eye } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import ToastContainer from "@/components/ToastContainer";
import { io, Socket } from "socket.io-client";

const api = apiClient;

interface ReferralData {
  referralCode: string;
  referralLink: string;
  totalReferrals: number;
  activeReferrals: number;
  totalCredits: number;
  pendingCredits: number;
  referrals: Array<{
    id: string;
    name: string;
    email: string;
    status: 'pending' | 'active' | 'completed';
    joinedAt: string;
    creditsEarned: number;
  }>;
}

// Skeleton loader components
const StatCardSkeleton = () => (
  <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm animate-pulse">
    <div className="h-5 bg-slate-200 rounded w-1/3 mb-3"></div>
    <div className="h-8 bg-slate-200 rounded w-1/2"></div>
  </div>
);

const ReferralCardSkeleton = () => (
  <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm animate-pulse">
    <div className="h-6 bg-slate-200 rounded w-1/4 mb-4"></div>
    <div className="h-4 bg-slate-200 rounded w-full mb-2"></div>
    <div className="h-4 bg-slate-200 rounded w-3/4"></div>
  </div>
);

interface ReferralEarning {
  id: number;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID_AS_BONUS' | 'AVAILABLE_FOR_WITHDRAWAL' | 'WITHDRAWN';
  referredUser?: { id: number; name: string; email: string };
  createdAt: string;
  paidAsBonusAt?: string;
  availableAt?: string;
  withdrawnAt?: string;
}

interface ReferralWithdrawal {
  id: number;
  totalAmount: number;
  currency: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID';
  paymentMethod?: string;
  paymentRef?: string;
  rejectionReason?: string;
  createdAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  paidAt?: string;
}

interface ReferralNotification {
  type: 'withdrawal-approved' | 'withdrawal-rejected' | 'withdrawal-paid' | 'earnings-marked-as-bonus' | 'credit-earned';
  message: string;
  amount?: number;
  withdrawalId?: number;
  reason?: string;
  paymentRef?: string;
}

export default function DriverReferral() {
  const [referralData, setReferralData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [userId, setUserId] = useState<string | number | undefined>(undefined);
  
  // New state for earnings and withdrawals
  const [earnings, setEarnings] = useState<ReferralEarning[]>([]);
  const [earningsSummary, setEarningsSummary] = useState({
    total: 0,
    pending: 0,
    paidAsBonus: 0,
    availableForWithdrawal: 0,
    withdrawn: 0,
  });
  const [withdrawals, setWithdrawals] = useState<ReferralWithdrawal[]>([]);
  const [loadingEarnings, setLoadingEarnings] = useState(false);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState<string>('');
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [notification, setNotification] = useState<ReferralNotification | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const earningsSummaryRef = useRef(earningsSummary);

  useEffect(() => {
    earningsSummaryRef.current = earningsSummary;
  }, [earningsSummary]);

  // Add custom animations
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes fade-in {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes fade-in-up {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
      .animate-fade-in {
        animation: fade-in 0.6s ease-out forwards;
      }
      .animate-fade-in-up {
        animation: fade-in-up 0.6s ease-out forwards;
        opacity: 0;
      }
      .delay-100 { animation-delay: 0.1s; }
      .delay-200 { animation-delay: 0.2s; }
      .delay-300 { animation-delay: 0.3s; }
      .delay-400 { animation-delay: 0.4s; }
      .delay-500 { animation-delay: 0.5s; }
      .delay-600 { animation-delay: 0.6s; }
      .delay-700 { animation-delay: 0.7s; }
    `;
    style.setAttribute('data-referral-animations', 'true');
    if (!document.head.querySelector('style[data-referral-animations]')) {
      document.head.appendChild(style);
    }
    return () => {
      const existingStyle = document.head.querySelector('style[data-referral-animations]');
      if (existingStyle) {
        document.head.removeChild(existingStyle);
      }
    };
  }, []);

  // Fetch user id from secure cookie session
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetchAccountSession();
        if (!mounted) return;
        if (!r.ok) return;
        if (r.data?.id) setUserId(r.data.id);
      } catch {
        // ignore
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Fetch referral data
  const fetchReferralData = useCallback(async () => {
    try {
      setLoading(true);
      // Fetch referral data from API
      const response = await api.get("/api/driver/referral");

      if (response.status === 200 && response.data) {
        setReferralData(response.data);
        setError(null);
      } else {
        setError("Failed to load referral data");
      }
    } catch (err: any) {
      console.error("Error fetching referral data:", err);
      if (err.response?.status === 401) {
        setError("Please log in to view your referral information");
      } else if (err.response?.status === 404) {
        // No referral data yet. Codes are issued by the server only (they are
        // opaque and cannot be derived here), so show an empty state, never a guess.
        setReferralData({
          referralCode: '',
          referralLink: '',
          totalReferrals: 0,
          activeReferrals: 0,
          totalCredits: 0,
          pendingCredits: 0,
          referrals: [],
        });
        setError(null);
      } else {
        setError("Failed to load referral data. Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Fetch referral earnings
  const fetchEarnings = useCallback(async () => {
    try {
      setLoadingEarnings(true);
      const response = await api.get("/api/driver/referral-earnings");

      if (response.data) {
        setEarnings(response.data.earnings || []);
        setEarningsSummary(response.data.summary || {
          total: 0,
          pending: 0,
          paidAsBonus: 0,
          availableForWithdrawal: 0,
          withdrawn: 0,
        });
      }
    } catch (err: any) {
      console.error("Error fetching earnings:", err);
    } finally {
      setLoadingEarnings(false);
    }
  }, []);

  // Fetch withdrawal history
  const fetchWithdrawals = useCallback(async () => {
    try {
      setLoadingWithdrawals(true);
      const response = await api.get("/api/driver/referral-earnings/withdrawals");

      if (response.data) {
        setWithdrawals(response.data.withdrawals || []);
      }
    } catch (err: any) {
      console.error("Error fetching withdrawals:", err);
    } finally {
      setLoadingWithdrawals(false);
    }
  }, []);

  useEffect(() => {
    fetchReferralData();
    fetchEarnings();
    fetchWithdrawals();
  }, [fetchReferralData, fetchEarnings, fetchWithdrawals]);

  // Apply for withdrawal
  const applyWithdrawal = async () => {
    try {
      setWithdrawLoading(true);
      const amount = withdrawAmount ? Number(withdrawAmount) : undefined;

      const response = await api.post("/api/driver/referral-earnings/apply-withdrawal", { amount });

      if (response.data.success) {
        setShowWithdrawModal(false);
        setWithdrawAmount('');
        fetchEarnings();
        fetchWithdrawals();
        window.dispatchEvent(new CustomEvent('nols:toast', {
          detail: {
            type: 'success',
            title: 'Withdrawal Applied',
            message: 'Your withdrawal request has been submitted successfully!',
            duration: 5000,
          }
        }));
      }
    } catch (err: any) {
      console.error("Error applying for withdrawal:", err);
      window.dispatchEvent(new CustomEvent('nols:toast', {
        detail: {
          type: 'error',
          title: 'Withdrawal Failed',
          message: err.response?.data?.error || 'Failed to apply for withdrawal',
          duration: 5000,
        }
      }));
    } finally {
      setWithdrawLoading(false);
    }
  };

  // Setup Socket.IO for real-time notifications
  useEffect(() => {
    if (typeof window === "undefined") return;

    const url = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:4000";
    
    const socket = io(url, {
      transports: ["websocket"],
      autoConnect: true,
      reconnection: true,
    });

    socketRef.current = socket;

    // Join driver room on connection
    socket.on("connect", async () => {
      try {
        const perfRes = await api.get("/api/driver/referral/performance").catch(() => null);
        if (perfRes?.data?.driver?.id) {
          socket.emit("join-driver-room", { driverId: perfRes.data.driver.id });
        } else {
          try {
            const meRes = await fetchAccountSession();
            if (meRes.ok && meRes.data?.id) {
              socket.emit("join-driver-room", { driverId: meRes.data.id });
            }
          } catch {}
        }
      } catch (e) {
        console.warn("Failed to join driver room", e);
      }
    });

    // Listen for referral updates
    const handleReferralUpdate = () => {
      fetchReferralData();
      fetchEarnings();
    };

    // Listen for referral notifications
    const handleReferralNotification = (notification: {
      type: 'new_referral' | 'referral_active' | 'credits_earned';
      message: string;
      referralData?: any;
    }) => {
      window.dispatchEvent(new CustomEvent('nols:toast', {
        detail: {
          type: 'success',
          title: 'New Referral!',
          message: notification.message,
          duration: 5000,
        }
      }));
      fetchReferralData();
      fetchEarnings();
    };

    // Listen for withdrawal approved
    const handleWithdrawalApproved = (data: { withdrawalId: number; amount: number; approvedAt: string }) => {
      setNotification({
        type: 'withdrawal-approved',
        message: `Your withdrawal of TZS ${data.amount.toLocaleString()} has been approved!`,
        amount: data.amount,
        withdrawalId: data.withdrawalId,
      });
      fetchEarnings();
      fetchWithdrawals();
      setTimeout(() => setNotification(null), 10000);
    };

    // Listen for withdrawal rejected
    const handleWithdrawalRejected = (data: { withdrawalId: number; reason: string }) => {
      setNotification({
        type: 'withdrawal-rejected',
        message: `Your withdrawal request was rejected: ${data.reason}`,
        withdrawalId: data.withdrawalId,
        reason: data.reason,
      });
      fetchEarnings();
      fetchWithdrawals();
      setTimeout(() => setNotification(null), 10000);
    };

    // Listen for withdrawal paid
    const handleWithdrawalPaid = (data: { withdrawalId: number; amount: number; paymentRef?: string }) => {
      setNotification({
        type: 'withdrawal-paid',
        message: `Your withdrawal of TZS ${data.amount.toLocaleString()} has been paid!`,
        amount: data.amount,
        withdrawalId: data.withdrawalId,
        paymentRef: data.paymentRef,
      });
      fetchEarnings();
      fetchWithdrawals();
      setTimeout(() => setNotification(null), 10000);
    };

    // Listen for earnings marked as bonus
    const handleEarningsMarkedAsBonus = (data: { earningIds: number[]; bonusPaymentRef: string; count: number }) => {
      setNotification({
        type: 'earnings-marked-as-bonus',
        message: `${data.count} referral credit(s) totaling TZS ${earningsSummaryRef.current.availableForWithdrawal.toLocaleString()} have been converted to bonus!`,
        paymentRef: data.bonusPaymentRef,
      });
      fetchEarnings();
      setTimeout(() => setNotification(null), 10000);
    };

    socket.on('referral-update', handleReferralUpdate);
    socket.on('referral-notification', handleReferralNotification);
    socket.on('referral-withdrawal-approved', handleWithdrawalApproved);
    socket.on('referral-withdrawal-rejected', handleWithdrawalRejected);
    socket.on('referral-withdrawal-paid', handleWithdrawalPaid);
    socket.on('referral-earnings-marked-as-bonus', handleEarningsMarkedAsBonus);

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }

    return () => {
      socket.off('referral-update', handleReferralUpdate);
      socket.off('referral-notification', handleReferralNotification);
      socket.off('referral-withdrawal-approved', handleWithdrawalApproved);
      socket.off('referral-withdrawal-rejected', handleWithdrawalRejected);
      socket.off('referral-withdrawal-paid', handleWithdrawalPaid);
      socket.off('referral-earnings-marked-as-bonus', handleEarningsMarkedAsBonus);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [fetchReferralData, fetchEarnings, fetchWithdrawals]);

  const copyToClipboard = async (text: string, isLink: boolean = false) => {
    try {
      await navigator.clipboard.writeText(text);
      if (isLink) {
        setCopiedLink(true);
        setTimeout(() => setCopiedLink(false), 2000);
      } else {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const shareViaEmail = () => {
    if (!referralData) return;
    const subject = encodeURIComponent("Join NoLSAF - Get Started Today!");
    const body = encodeURIComponent(
      `Hi! I'm using NoLSAF and thought you might like it too. Use my referral link to sign up:\n\n${referralData.referralLink}\n\nYou'll get great benefits and I'll earn credits too!`
    );
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  const shareViaWhatsApp = () => {
    if (!referralData) return;
    const text = encodeURIComponent(
      `Join NoLSAF using my referral link: ${referralData.referralLink}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const getStatusBadge = (status: string) => {
    const statusLower = status.toLowerCase();
    if (statusLower === 'active' || statusLower === 'completed') {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
          <CheckCircle className="w-3 h-3" />
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
        Pending
      </span>
    );
  };

  if (loading) {
    return (
      <div className="w-full max-w-full space-y-6 overflow-x-hidden">
        <div className="w-full text-center">
          <div className="flex flex-col items-center mb-6">
            <Share2 className="w-8 h-8 text-emerald-600 mb-2" />
            <h1 className="text-2xl font-bold text-slate-900">Referral Program</h1>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        <ReferralCardSkeleton />
      </div>
    );
  }

  if (error && !loading && !referralData) {
    return (
      <div className="w-full max-w-full space-y-6 overflow-x-hidden">
        <div className="w-full text-center">
          <div className="flex flex-col items-center mb-6">
            <Share2 className="w-8 h-8 text-emerald-600 mb-2" />
            <h1 className="text-2xl font-bold text-slate-900">Referral Program</h1>
          </div>
        </div>
        <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-center">
          <p className="text-red-800 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  if (!referralData) {
    return null;
  }

  return (
    <>
      <ToastContainer />
      <div className="w-full max-w-full space-y-6 overflow-x-hidden">
      {/* Header */}
      <div className="w-full text-center">
        <div className="flex flex-col items-center mb-6">
          <Share2 className="w-8 h-8 text-emerald-600 mb-2 animate-pulse" />
          <h1 className="text-2xl font-bold text-slate-900 animate-fade-in">Referral Program</h1>
          <p className="text-slate-600 mt-1 animate-fade-in-up delay-100 transition-all duration-500 hover:text-emerald-600">Invite others and earn credits for each successful referral</p>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-6">
        <div className="bg-white rounded-xl p-4 sm:p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-blue-300 animate-fade-in-up delay-200">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-600 flex-shrink-0 transition-transform duration-300 group-hover:scale-110" />
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 transition-colors duration-300 leading-tight">Total Referrals</h3>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 transition-all duration-500">{referralData.totalReferrals}</p>
          <p className="text-xs text-slate-500 mt-1 transition-colors duration-300">{referralData.activeReferrals} active</p>
        </div>

        <div className="bg-white rounded-xl p-4 sm:p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-emerald-300 animate-fade-in-up delay-300">
          <div className="flex items-center gap-2 mb-2">
            <Gift className="w-4 h-4 text-emerald-600 flex-shrink-0 transition-transform duration-300 group-hover:scale-110" />
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 transition-colors duration-300 leading-tight">Total Credits</h3>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 transition-all duration-500">{referralData.totalCredits.toLocaleString()}</p>
          <p className="text-xs text-slate-500 mt-1 transition-colors duration-300">{referralData.pendingCredits} pending</p>
        </div>

        <div className="col-span-2 md:col-span-1 bg-white rounded-xl p-4 sm:p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg hover:scale-105 hover:border-purple-300 animate-fade-in-up delay-400">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-4 h-4 text-purple-600 flex-shrink-0 transition-transform duration-300 group-hover:scale-110" />
            <h3 className="text-xs sm:text-sm font-semibold text-slate-900 transition-colors duration-300 leading-tight">Earnings</h3>
          </div>
          <p className="text-xl sm:text-2xl font-bold text-slate-900 transition-all duration-500">
            {referralData.totalCredits > 0 ? `TZS ${referralData.totalCredits.toLocaleString()}` : 'TZS 0'}
          </p>
          <p className="text-xs text-slate-500 mt-1 transition-colors duration-300">From referrals</p>
        </div>
      </div>

      {/* Referral Code Section */}
      <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg animate-fade-in-up delay-500">
        <div className="flex items-center gap-2 mb-6">
          <LinkIcon className="w-5 h-5 text-emerald-600 transition-transform duration-300 hover:scale-110" />
          <h2 className="text-xl font-semibold text-slate-900 transition-colors duration-300">Your Referral Code</h2>
        </div>
        
        {/* Referral Code */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-2">Referral Code</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex items-center gap-3 bg-gradient-to-r from-slate-50 to-emerald-50/30 border-2 border-slate-200 rounded-xl px-5 py-4 transition-all duration-300 hover:border-emerald-300 hover:shadow-md">
              <code className="text-lg font-mono font-bold text-slate-900 flex-1 transition-all duration-300 select-all">{referralData.referralCode}</code>
              <button
              onClick={() => copyToClipboard(referralData.referralCode, false)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 hover:shadow-lg active:scale-95 transition-all duration-200 no-underline font-medium min-w-[120px]"
            >
              {copied ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  <span>Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy</span>
                </>
              )}
            </button>
            </div>
          </div>
        </div>

        {/* Referral Link */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-2">Referral Link</label>
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1 flex items-center gap-3 bg-gradient-to-r from-slate-50 to-emerald-50/30 border-2 border-slate-200 rounded-xl px-5 py-4 transition-all duration-300 hover:border-emerald-300 hover:shadow-md">
              <input
                type="text"
                readOnly
                value={referralData.referralLink}
                className="flex-1 bg-transparent border-0 outline-none text-sm text-slate-700 font-mono select-all"
              />
              <button
                onClick={() => copyToClipboard(referralData.referralLink, true)}
                className="flex items-center justify-center gap-2 px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 hover:shadow-lg active:scale-95 transition-all duration-200 no-underline font-medium min-w-[120px]"
              >
                {copiedLink ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Share Buttons */}
        <div className="border-t border-slate-200 pt-6">
          <label className="block text-sm font-medium text-slate-700 mb-3">Share via</label>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={shareViaEmail}
              className="flex items-center justify-center gap-2.5 px-6 py-3 bg-white border-2 border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 hover:border-slate-300 hover:shadow-md active:scale-95 transition-all duration-200 no-underline font-medium"
            >
              <Mail className="w-5 h-5" />
              <span>Email</span>
            </button>
            <button
              onClick={shareViaWhatsApp}
              className="flex items-center justify-center gap-2.5 px-6 py-3 bg-white border-2 border-green-200 text-green-700 rounded-xl hover:bg-green-50 hover:border-green-300 hover:shadow-md active:scale-95 transition-all duration-200 no-underline font-medium"
            >
              <MessageCircle className="w-5 h-5" />
              <span>WhatsApp</span>
            </button>
          </div>
        </div>
      </div>

      {/* Referrals List */}
      <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg animate-fade-in-up delay-600">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-emerald-600 transition-transform duration-300 hover:scale-110" />
            <h2 className="text-xl font-semibold text-slate-900 transition-colors duration-300">Your Referrals</h2>
          </div>
          <span className="text-sm text-slate-600 transition-all duration-300">{referralData.referrals.length} total</span>
        </div>

        {referralData.referrals.length === 0 ? (
          <div className="text-center py-12 animate-fade-in delay-700">
            <Users className="w-16 h-16 text-slate-300 mx-auto mb-4 transition-all duration-500 hover:scale-110 hover:text-emerald-300" />
            <p className="text-slate-600 font-medium mb-2 transition-colors duration-300">No referrals yet</p>
            <p className="text-sm text-slate-500 transition-colors duration-300 hover:text-emerald-600">Share your referral link to start earning credits!</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                    Joined
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider border-b border-slate-200">
                    Credits Earned
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {referralData.referrals.map((referral) => (
                  <tr key={referral.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-slate-900">
                      {referral.name || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      {referral.email || 'N/A'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {getStatusBadge(referral.status)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">
                      {new Date(referral.joinedAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-semibold text-emerald-600">
                      {referral.creditsEarned > 0 ? `TZS ${referral.creditsEarned.toLocaleString()}` : 'TZS 0'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Notification Banner */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 max-w-md p-4 rounded-lg shadow-lg border-2 ${
          notification.type === 'withdrawal-approved' || notification.type === 'withdrawal-paid' || notification.type === 'earnings-marked-as-bonus'
            ? 'bg-emerald-50 border-emerald-300'
            : notification.type === 'withdrawal-rejected'
            ? 'bg-red-50 border-red-300'
            : 'bg-blue-50 border-blue-300'
        } animate-fade-in-up`}>
          <div className="flex items-start gap-3">
            <div className={`flex-shrink-0 ${
              notification.type === 'withdrawal-approved' || notification.type === 'withdrawal-paid' || notification.type === 'earnings-marked-as-bonus'
                ? 'text-emerald-600'
                : notification.type === 'withdrawal-rejected'
                ? 'text-red-600'
                : 'text-blue-600'
            }`}>
              {notification.type === 'withdrawal-approved' || notification.type === 'withdrawal-paid' || notification.type === 'earnings-marked-as-bonus' ? (
                <CheckCircle className="w-5 h-5" />
              ) : notification.type === 'withdrawal-rejected' ? (
                <AlertCircle className="w-5 h-5" />
              ) : (
                <Bell className="w-5 h-5" />
              )}
            </div>
            <div className="flex-1">
              <h4 className="font-semibold text-gray-900 mb-1">
                {notification.type === 'withdrawal-approved' ? 'Withdrawal Approved' :
                 notification.type === 'withdrawal-paid' ? 'Withdrawal Paid' :
                 notification.type === 'withdrawal-rejected' ? 'Withdrawal Rejected' :
                 notification.type === 'earnings-marked-as-bonus' ? 'Credits Converted to Bonus' :
                 'Referral Update'}
              </h4>
              <p className="text-sm text-gray-700">{notification.message}</p>
              {notification.paymentRef && (
                <p className="text-xs text-gray-500 mt-1">Payment Ref: {notification.paymentRef}</p>
              )}
            </div>
            <button
              onClick={() => setNotification(null)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Referral Earnings Section */}
      <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg animate-fade-in-up delay-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Wallet className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-semibold text-slate-900">Referral Earnings</h2>
          </div>
          {earningsSummary.availableForWithdrawal > 0 && (
            <button
              onClick={() => {
                setWithdrawAmount('');
                setShowWithdrawModal(true);
              }}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-all"
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>Apply for Withdrawal</span>
            </button>
          )}
        </div>

        {/* Earnings Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="text-xs font-medium text-blue-700 mb-1">Total</div>
            <div className="text-lg font-bold text-blue-900">{earningsSummary.total.toLocaleString()} TZS</div>
          </div>
          <div className="p-4 bg-amber-50 rounded-lg border border-amber-100">
            <div className="text-xs font-medium text-amber-700 mb-1">Pending</div>
            <div className="text-lg font-bold text-amber-900">{earningsSummary.pending.toLocaleString()} TZS</div>
          </div>
          <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-100">
            <div className="text-xs font-medium text-emerald-700 mb-1">Available</div>
            <div className="text-lg font-bold text-emerald-900">{earningsSummary.availableForWithdrawal.toLocaleString()} TZS</div>
          </div>
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
            <div className="text-xs font-medium text-purple-700 mb-1">Paid as Bonus</div>
            <div className="text-lg font-bold text-purple-900">{earningsSummary.paidAsBonus.toLocaleString()} TZS</div>
          </div>
          <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
            <div className="text-xs font-medium text-slate-700 mb-1">Withdrawn</div>
            <div className="text-lg font-bold text-slate-900">{earningsSummary.withdrawn.toLocaleString()} TZS</div>
          </div>
        </div>

        {/* Recent Earnings Table */}
        {loadingEarnings ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : earnings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Referred User</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {earnings.slice(0, 10).map((earning) => (
                  <tr key={earning.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(earning.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-900">
                      {earning.referredUser?.name || earning.referredUser?.email || 'N/A'}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-emerald-600">
                      {earning.amount.toLocaleString()} TZS
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        earning.status === 'AVAILABLE_FOR_WITHDRAWAL' ? 'bg-emerald-100 text-emerald-700' :
                        earning.status === 'PAID_AS_BONUS' ? 'bg-purple-100 text-purple-700' :
                        earning.status === 'WITHDRAWN' ? 'bg-slate-100 text-slate-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {earning.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <Wallet className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p>No earnings yet</p>
          </div>
        )}
      </div>

      {/* Withdrawal History Section */}
      <div className="bg-white rounded-xl p-6 border-2 border-slate-200 shadow-sm transition-all duration-300 hover:shadow-lg animate-fade-in-up delay-800">
        <div className="flex items-center gap-2 mb-6">
          <ArrowUpRight className="w-5 h-5 text-emerald-600" />
          <h2 className="text-xl font-semibold text-slate-900">Withdrawal History</h2>
        </div>

        {loadingWithdrawals ? (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
          </div>
        ) : withdrawals.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border border-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Amount</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Payment Ref</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-slate-700 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {withdrawals.map((withdrawal) => (
                  <tr key={withdrawal.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {new Date(withdrawal.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold text-emerald-600">
                      {withdrawal.totalAmount.toLocaleString()} TZS
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        withdrawal.status === 'APPROVED' ? 'bg-blue-100 text-blue-700' :
                        withdrawal.status === 'PAID' ? 'bg-emerald-100 text-emerald-700' :
                        withdrawal.status === 'REJECTED' ? 'bg-red-100 text-red-700' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {withdrawal.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-600">
                      {withdrawal.paymentRef || '-'}
                    </td>
                    <td className="px-4 py-3">
                      {withdrawal.rejectionReason && (
                        <button
                          onClick={() => {
                            window.dispatchEvent(new CustomEvent('nols:toast', {
                              detail: {
                                type: 'error',
                                title: 'Rejection Reason',
                                message: withdrawal.rejectionReason,
                                duration: 5000,
                              }
                            }));
                          }}
                          className="text-xs text-red-600 hover:text-red-700"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-center py-8 text-slate-500">
            <ArrowUpRight className="w-12 h-12 mx-auto mb-2 text-slate-300" />
            <p>No withdrawal history</p>
          </div>
        )}
      </div>

      {/* Withdrawal Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="bg-white rounded-xl p-6 max-w-md w-full mx-4 border-2 border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold text-slate-900">Apply for Withdrawal</h3>
              <button
                onClick={() => setShowWithdrawModal(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Available Amount: {earningsSummary.availableForWithdrawal.toLocaleString()} TZS
                </label>
                <input
                  type="number"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  placeholder="Enter amount (leave empty for all available)"
                  className="w-full px-4 py-2 border-2 border-slate-200 rounded-lg focus:border-emerald-500 focus:outline-none"
                  max={earningsSummary.availableForWithdrawal}
                />
                <p className="text-xs text-slate-500 mt-1">
                  Leave empty to withdraw all available earnings
                </p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowWithdrawModal(false)}
                  className="flex-1 px-4 py-2 border-2 border-slate-200 rounded-lg hover:bg-slate-50 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={applyWithdrawal}
                  disabled={withdrawLoading || (!!withdrawAmount && Number(withdrawAmount) > earningsSummary.availableForWithdrawal)}
                  className="flex-1 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                >
                  {withdrawLoading ? 'Applying...' : 'Apply'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* How It Works */}
      <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">How It Works</h3>
        <ul className="space-y-3 text-sm text-slate-700">
          <li className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
              1
            </div>
            <span>Share your unique referral code or link with friends, family, or on social media</span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
              2
            </div>
            <span>When someone signs up using your referral link, they become your referral</span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
              3
            </div>
            <span>Earn credits when your referrals complete their first trip or reach certain milestones</span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-xs flex-shrink-0 mt-0.5">
              4
            </div>
            <span>Credits are automatically added to your account and can be used for bonuses or payouts</span>
          </li>
        </ul>
      </div>
    </div>
    </>
  );
}

