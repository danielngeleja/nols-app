"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { humanize, placeName } from "@/components/owner-groups/GroupStaysChrome";
import { ArrowLeft, CircleAlert, Clock3, Compass, Bus, CheckCircle, Calendar, User, Phone, Mail, Building2, MapPin, Users, X, Search, MessageSquare, Send, CheckCircle2, Info, Sparkles, Car, UtensilsCrossed, UserCheck, Wrench, FileText, ShieldCheck, CalendarX, TrendingUp, HeartHandshake, Wallet } from "lucide-react";

const api = apiClient;

type Passenger = {
  id: number;
  firstName: string;
  lastName: string;
  phone?: string | null;
  age?: number | null;
  gender?: string | null;
  nationality?: string | null;
  sequenceNumber?: number | null;
};

type Message = {
  id: number;
  senderRole: string;
  senderName: string | null;
  messageType: string | null;
  body: string;
  createdAt: string;
};

type GroupStayDetail = {
  id: number;
  groupType: string;
  accommodationType: string;
  headcount: number;
  roomsNeeded: number;
  toRegion: string;
  toDistrict?: string | null;
  toWard?: string | null;
  toLocation?: string | null;
  checkIn: string | null;
  checkOut: string | null;
  status: string;
  user: { id: number; name: string; email: string; phone: string | null } | null;
  confirmedProperty: { id: number; title: string; type: string; status: string } | null;
  passengers?: Passenger[];
  messages?: Message[];
  createdAt: string;
  /** Opaque gs_ reference used in page URLs. */
  reference?: string;
  // Check-in milestone + earnings split
  checkedInAt?: string | null;
  totalAmount?: number | null;
  depositAmount?: number | null;
  currency?: string | null;
  // Arrangement fields
  arrPickup?: boolean;
  arrTransport?: boolean;
  arrMeals?: boolean;
  arrGuide?: boolean;
  arrEquipment?: boolean;
  pickupLocation?: string | null;
  pickupTime?: string | null;
  arrangementNotes?: string | null;
};

export default function GroupStayDetail() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const router = useRouter();
  const [groupStay, setGroupStay] = useState<GroupStayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPassengersModal, setShowPassengersModal] = useState(false);
  const [showPolicyModal, setShowPolicyModal] = useState(false);
  const [checkingIn, setCheckingIn] = useState(false);
  const [passengerSearch, setPassengerSearch] = useState("");
  const [modalRef, setModalRef] = useState<HTMLDivElement | null>(null);
  const [messageText, setMessageText] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [messageType, setMessageType] = useState("General");
  const [tab, setTab] = useState<"overview" | "members" | "messages">("overview");
  const MAX_MESSAGE_LENGTH = 5000;

  useEffect(() => {
    let mounted = true;
    api.get(`/api/owner/group-stays/${idParam}`)
      .then((response) => {
        if (!mounted) return;
        setGroupStay(response.data);
        setLoading(false);
        // An old numeric link: show the opaque reference in the address bar instead.
        if (/^\d+$/.test(String(idParam)) && response.data?.reference) {
          router.replace(`/owner/group-stays/${encodeURIComponent(response.data.reference)}`);
        }
      })
      .catch((err: any) => {
        if (!mounted) return;
        console.error("Failed to load group stay:", err);
        setError(err.response?.data?.error || "Failed to load group stay");
        setLoading(false);
      });

    return () => { mounted = false; };
  }, [idParam, router]);

  // Handle keyboard navigation for modal
  useEffect(() => {
    if (showPassengersModal) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShowPassengersModal(false);
          setPassengerSearch("");
        }
      };
      document.addEventListener("keydown", handleEscape);
      // Focus modal when it opens
      if (modalRef) {
        modalRef.focus();
      }
      return () => {
        document.removeEventListener("keydown", handleEscape);
      };
    }
  }, [showPassengersModal, modalRef]);

  // Close the policy modal on Escape
  useEffect(() => {
    if (!showPolicyModal) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowPolicyModal(false);
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [showPolicyModal]);

  // Filter passengers based on search
  const filteredPassengers = groupStay?.passengers
    ? groupStay.passengers.filter((passenger) => {
        if (!passengerSearch.trim()) return true;
        const searchLower = passengerSearch.toLowerCase();
        const fullName = `${passenger.firstName} ${passenger.lastName}`.toLowerCase();
        const phone = passenger.phone?.toLowerCase() || "";
        const nationality = passenger.nationality?.toLowerCase() || "";
        return (
          fullName.includes(searchLower) ||
          phone.includes(searchLower) ||
          nationality.includes(searchLower)
        );
      })
    : [];

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "-";
    try {
      return new Date(dateStr).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  // Message templates for automation
  const getMessageTemplate = (type: string): string => {
    const customerName = groupStay?.user?.name || "valued customer";
    const groupType = groupStay?.groupType ? groupStay.groupType.charAt(0).toUpperCase() + groupStay.groupType.slice(1) : "group";
    const headcountNum = groupStay?.headcount || 0;
    const headcount = String(headcountNum);
    const headcountText = headcountNum === 1 ? 'person' : 'people';
    const guestText = headcountNum === 1 ? 'guest' : 'guests';
    const checkIn = groupStay?.checkIn ? formatDate(groupStay.checkIn) : "your check-in date";
    const checkOut = groupStay?.checkOut ? formatDate(groupStay.checkOut) : "your check-out date";

    switch (type) {
      case "Provide Details":
        return `Dear ${customerName},\n\nWe're excited about hosting your group! Here are some details about what your group will enjoy during your stay:\n\n✨ **Amenities & Services:**\n• Complimentary WiFi throughout the property\n• Daily housekeeping service\n• 24/7 security and support\n• Flexible check-in/check-out times\n• Group dining arrangements available\n• Transportation assistance can be arranged\n\n📅 **Your Stay:**\n• Check-in: ${checkIn}\n• Check-out: ${checkOut}\n• Guests: ${headcount} ${headcountText}\n\nPlease let us know if you have any specific requirements or questions. We're here to make your stay memorable!\n\nWarm regards,\nProperty Owner`;

      case "Special Offers":
        return `Dear ${customerName},\n\nWe have some special offers and amenities available for your ${groupType} stay with ${headcount} ${guestText}:\n\n🎉 **Special Offers:**\n• Group discount: 15% off for bookings of 10+ people\n• Complimentary breakfast for all guests\n• Free airport/station pickup service\n• Early check-in and late check-out options\n• Special group activities and tours available\n\n📅 **Your Stay Dates:**\n• Check-in: ${checkIn}\n• Check-out: ${checkOut}\n\nLet us know if you'd like to take advantage of any of these offers! We're committed to making your group stay both comfortable and memorable.\n\nBest regards,\nProperty Owner`;

      case "Check-in Instructions":
        return `Dear ${customerName},\n\nWe're looking forward to welcoming you and your group soon! Here are the check-in instructions for your stay:\n\n📍 **Check-in Information:**\n• Check-in Date: ${checkIn}\n• Check-in Time: Flexible (please inform us of your expected arrival time)\n• Location: Our property address will be sent separately\n\n✅ **What to Bring:**\n• Valid identification for all guests\n• Booking confirmation details\n• Any special requirements or dietary needs\n\n🚗 **Getting Here:**\nIf you need assistance with transportation from the airport or station, please let us know in advance, and we'll be happy to arrange pickup service.\n\nIf you have any questions or need assistance, feel free to contact us anytime.\n\nSee you soon!\n\nWarm regards,\nProperty Owner`;

      case "Welcome Message":
        return `Dear ${customerName},\n\nWe're thrilled to welcome you and your ${headcount} ${guestText} to our property! We're committed to providing you with an exceptional ${groupType} stay experience.\n\n📋 **Your Stay Details:**\n• Group Type: ${groupType}\n• Number of Guests: ${headcount} ${headcountText}\n• Check-in: ${checkIn}\n• Check-out: ${checkOut}\n• Accommodation Type: ${groupStay?.accommodationType ? groupStay.accommodationType.charAt(0).toUpperCase() + groupStay.accommodationType.slice(1) : 'Standard'}\n\nOur team is preparing everything for your arrival and will ensure all your needs are met. We're here to make your stay comfortable, enjoyable, and memorable.\n\nIf you have any questions or special requirements, please don't hesitate to reach out. We look forward to hosting you!\n\nWarm regards,\nProperty Owner`;

      case "Amenities Information":
        return `Dear ${customerName},\n\nHere's detailed information about the amenities and services available at our property for your ${groupType} stay:\n\n🏨 **Property Amenities:**\n• Fully equipped rooms for your group\n• Complimentary WiFi throughout the property\n• Daily housekeeping and maintenance service\n• 24/7 security and on-site support staff\n• Common areas and lounges for group activities\n• Parking facilities\n\n🍽️ **Dining & Services:**\n• Group dining arrangements available\n• Catering options for special occasions\n• Room service (where applicable)\n\n🚗 **Additional Services:**\n• Airport/station pickup and drop-off (can be arranged)\n• Local transportation assistance\n• Tour and activity recommendations\n• Flexible check-in/check-out times\n\nPlease let us know if you need any specific amenities or services, and we'll do our best to accommodate your group's needs.\n\nBest regards,\nProperty Owner`;

      case "Other":
        return `Dear ${customerName},\n\nThank you for choosing our property for your ${groupType} stay.\n\n[Your message here]\n\nBest regards,\nProperty Owner`;

      default:
        return "";
    }
  };

  // Auto-update message when type changes - always replaces message with new template
  const handleMessageTypeChange = (newType: string) => {
    setMessageType(newType);
    // Always update message when type changes (except for "General" which has no template)
    if (newType !== "General") {
      const template = getMessageTemplate(newType);
      if (template) {
        // Ensure template doesn't exceed max length
        const truncatedTemplate = template.length > MAX_MESSAGE_LENGTH 
          ? template.substring(0, MAX_MESSAGE_LENGTH) 
          : template;
        setMessageText(truncatedTemplate);
      }
    } else {
      // Clear message when "General" is selected
      setMessageText("");
    }
  };

  // Auto-fill message when textarea is focused (if type is selected but message is empty)
  const handleTextareaFocus = () => {
    if (!messageText.trim() && messageType !== "General") {
      const template = getMessageTemplate(messageType);
      if (template) {
        // Ensure template doesn't exceed max length
        const truncatedTemplate = template.length > MAX_MESSAGE_LENGTH 
          ? template.substring(0, MAX_MESSAGE_LENGTH) 
          : template;
        setMessageText(truncatedTemplate);
      }
    }
  };


  const shell = "w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6";

  if (loading) {
    return (
      <div className={shell} aria-busy="true" aria-label="Loading group stay">
        <div className="h-52 rounded-3xl bg-[#012a26]" />
        <div className="grid gap-5 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="h-48 rounded-2xl border border-solid border-slate-200 bg-white" />)}</div>
      </div>
    );
  }

  if (error || !groupStay) {
    return (
      <div className={shell}>
        <div className="flex flex-col items-center rounded-3xl border border-solid border-slate-200 bg-white px-6 py-12 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600"><CircleAlert className="h-6 w-6" /></span>
          <p className="m-0 mt-3 text-base font-bold text-slate-900">This group stay could not be opened</p>
          <p className="m-0 mt-1 max-w-md text-sm text-slate-500">{error || "It does not exist or is not assigned to you."}</p>
          <Link href="/owner/group-stays" className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-[#02665e] px-4 text-sm font-bold text-white no-underline hover:bg-[#014d47]">
            <ArrowLeft className="h-4 w-4" /> Assigned to me
          </Link>
        </div>
      </div>
    );
  }

  const status = groupStay.status?.toUpperCase() || "";
  const isConfirmed = status === "CONFIRMED";
  const guestFirstName = groupStay.user?.name?.trim()?.split(/\s+/)[0] || "";
  const place = [groupStay.toLocation, groupStay.toWard, groupStay.toDistrict, groupStay.toRegion].filter(Boolean).map((part) => placeName(part as string)).join(", ") || placeName(groupStay.toRegion);
  const nights = groupStay.checkIn && groupStay.checkOut ? Math.max(1, Math.round((new Date(groupStay.checkOut).getTime() - new Date(groupStay.checkIn).getTime()) / 86_400_000)) : null;
  const arrivalPassed = groupStay.checkIn ? new Date(groupStay.checkIn).getTime() < Date.now() : false;
  const unpaidAndPast = arrivalPassed && (status === "AWAITING_DEPOSIT" || status === "PENDING");
  const daysToArrival = groupStay.checkIn ? Math.round((new Date(groupStay.checkIn).getTime() - Date.now()) / 86_400_000) : null;
  const hasRoster = Boolean(groupStay.passengers && groupStay.passengers.length > 0);

  const goToMessaging = () => {
    setTab("messages");
    setTimeout(() => {
      document.getElementById("owner-communication")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const isCheckedIn = !!groupStay.checkedInAt;
  const heroCurrency = groupStay.currency || "TZS";
  const ownerCollectsAmount = Math.max(0, Math.round(Number(groupStay.totalAmount || 0) - Number(groupStay.depositAmount || 0)));
  const ownerCollectsText = groupStay.totalAmount != null ? `${heroCurrency} ${ownerCollectsAmount.toLocaleString("en-US")}` : null;

  const handleCheckIn = async () => {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      const response = await api.post(`/api/owner/group-stays/${idParam}/check-in`, {});
      if (response.data?.success) {
        window.dispatchEvent(new CustomEvent("nols:toast", {
          detail: { type: "success", title: "Check-in recorded", message: "Remember to collect the stay balance from the guest at the property.", duration: 4000 },
        }));
        try {
          const updated = await api.get(`/api/owner/group-stays/${idParam}`);
          if (updated.data) setGroupStay(updated.data);
        } catch { /* ignore refresh error */ }
      }
    } catch (err: any) {
      const msg = err?.response?.data?.error || "Failed to record check-in. Please try again.";
      window.dispatchEvent(new CustomEvent("nols:toast", {
        detail: { type: "error", title: "Error", message: msg, duration: 5000 },
      }));
    } finally {
      setCheckingIn(false);
    }
  };

  const card = "rounded-2xl border border-solid border-slate-200 bg-white";
  const isCompleted = status === "COMPLETED";
  const isCancelled = status === "CANCELED" || status === "CANCELLED";

  // Pass colours and stamp follow where the stay stands.
  const pass = unpaidAndPast || isCancelled
    ? { stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#c0262d_0%,#7a141a_45%,#3d0a0e_100%)]", stamp: "border-rose-600 text-rose-600", stampText: isCancelled ? "Cancelled" : "Not paid" }
    : isCheckedIn
      ? { stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#0b7d6f_0%,#02665e_45%,#012a26_100%)]", stamp: "border-emerald-600 text-emerald-600", stampText: "In house" }
      : isCompleted
        ? { stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#475569_0%,#1e293b_45%,#0b1120_100%)]", stamp: "border-slate-500 text-slate-500", stampText: "Completed" }
        : isConfirmed
          ? { stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#0b7d6f_0%,#02665e_45%,#012a26_100%)]", stamp: "border-emerald-600 text-emerald-600", stampText: "Confirmed" }
          : { stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#d97706_0%,#92400e_45%,#451a03_100%)]", stamp: "border-amber-600 text-amber-600", stampText: "Deposit due" };

  const allExtras = [
    { on: Boolean(groupStay.arrPickup), label: "Pickup", Icon: Car },
    { on: Boolean(groupStay.arrTransport), label: "Transport", Icon: Bus },
    { on: Boolean(groupStay.arrMeals), label: "Meals", Icon: UtensilsCrossed },
    { on: Boolean(groupStay.arrGuide), label: "Guide", Icon: Compass },
    { on: Boolean(groupStay.arrEquipment), label: "Equipment", Icon: Wrench },
  ];

  const next = unpaidAndPast
    ? { tone: "bg-rose-50 ring-rose-200", icon: "bg-rose-600", Icon: CircleAlert, title: "Not going ahead", body: "The arrival date passed and the deposit was never paid. You do not need to hold rooms." }
    : isCancelled
      ? { tone: "bg-rose-50 ring-rose-200", icon: "bg-rose-600", Icon: CircleAlert, title: "Cancelled", body: "This group stay was cancelled. Nothing to prepare." }
      : isCompleted
        ? { tone: "bg-slate-50 ring-slate-200", icon: "bg-slate-500", Icon: CheckCircle, title: "Stay completed", body: "The group has left. Thank you for hosting." }
        : isCheckedIn
          ? { tone: "bg-emerald-50 ring-emerald-200", icon: "bg-emerald-600", Icon: CheckCircle, title: "Group in house", body: `Checked in ${groupStay.checkedInAt ? formatDate(groupStay.checkedInAt) : ""}. Collect the balance if you have not yet.` }
          : isConfirmed
            ? { tone: "bg-emerald-50 ring-emerald-200", icon: "bg-[#02665e]", Icon: UserCheck, title: "Check the group in on arrival", body: daysToArrival !== null && daysToArrival > 0 ? `They arrive in ${daysToArrival} day${daysToArrival === 1 ? "" : "s"}.` : "They are due now." }
            : { tone: "bg-amber-50 ring-amber-200", icon: "bg-amber-500", Icon: Clock3, title: "Waiting for the deposit", body: daysToArrival !== null && daysToArrival > 0 ? `The group arrives in ${daysToArrival} day${daysToArrival === 1 ? "" : "s"}. You are notified the moment they pay.` : "You are notified the moment they pay." };

  const steps = [
    { label: "Requested", date: groupStay.createdAt, done: true },
    { label: "Placed with you", date: null as string | null, done: true },
    { label: "Deposit paid", date: null, done: isConfirmed || isCheckedIn || isCompleted },
    { label: "Checked in", date: groupStay.checkedInAt ?? null, done: isCheckedIn || isCompleted },
    { label: "Completed", date: null, done: isCompleted },
  ];
  const currentStep = steps.findIndex((step) => !step.done);

  const sendMessage = async () => {
    const trimmedMessage = messageText.trim();

    if (!trimmedMessage) {
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { type: "error", title: "Error", message: "Please enter a message", duration: 3000 },
        })
      );
      return;
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
      window.dispatchEvent(
        new CustomEvent("nols:toast", {
          detail: { type: "error", title: "Error", message: `Message cannot exceed ${MAX_MESSAGE_LENGTH.toLocaleString()} characters`, duration: 4000 },
        })
      );
      return;
    }

    setSendingMessage(true);
    let retryCount = 0;
    const maxRetries = 2;

    while (retryCount <= maxRetries) {
      try {
        const response = await api.post(`/api/owner/group-stays/${idParam}/message`, {
          message: trimmedMessage,
          messageType,
        });

        if (response.data.success) {
          setMessageText("");
          setMessageType("General");
          window.dispatchEvent(
            new CustomEvent("nols:toast", {
              detail: { type: "success", title: "Message Sent", message: "Your message has been sent to the customer.", duration: 3000 },
            })
          );
          // Reload group stay data to get updated messages
          try {
            const updatedResponse = await api.get(`/api/owner/group-stays/${idParam}`);
            if (updatedResponse.data) {
              setGroupStay(updatedResponse.data);
            }
          } catch (refreshErr) {
            console.error("Failed to refresh group stay data:", refreshErr);
            // Don't show error for refresh failure
          }
          break; // Success, exit retry loop
        }
      } catch (err: any) {
        const status = err?.response?.status;
        const data = err?.response?.data;

        // Don't retry on client errors (4xx)
        if (status >= 400 && status < 500) {
          let errorMessage = "Failed to send message";

          if (data?.code === "ACCOUNT_SUSPENDED") {
            errorMessage = "Your account has been suspended. Please contact support for assistance.";
          } else if (data?.code === "NO_ACTIVE_PROPERTIES") {
            errorMessage = "You must have at least one active property to send messages to customers.";
          } else if (data?.error) {
            errorMessage = data.error;
          } else if (data?.details) {
            errorMessage = data.details;
          }

          window.dispatchEvent(
            new CustomEvent("nols:toast", {
              detail: { type: "error", title: "Error", message: errorMessage, duration: 5000 },
            })
          );
          break; // Exit retry loop for client errors
        }

        // Retry on server errors (5xx) or network errors
        if (retryCount < maxRetries) {
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
          continue;
        } else {
          // Max retries reached
          window.dispatchEvent(
            new CustomEvent("nols:toast", {
              detail: { type: "error", title: "Error", message: "Failed to send message. Please check your connection and try again.", duration: 5000 },
            })
          );
        }
      }
    }

    setSendingMessage(false);
  };

  const messages = groupStay.messages ?? [];
  const dayOf = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const timeOf = (iso: string) => `${new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit" })} EAT`;
  const STARTERS = [
    { type: "Welcome Message", label: "Welcome", Icon: CheckCircle2 },
    { type: "Check-in Instructions", label: "Check-in steps", Icon: Calendar },
    { type: "Provide Details", label: "Ask for details", Icon: Info },
    { type: "Amenities Information", label: "Amenities", Icon: Building2 },
    { type: "Special Offers", label: "Special offer", Icon: Sparkles },
  ];

  const rail = (
    <aside className="min-w-0 space-y-4 lg:sticky lg:top-24">
      <section className={`rounded-2xl p-5 ring-1 ring-inset ${next.tone}`}>
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-white ${next.icon}`}><next.Icon className="h-4 w-4" aria-hidden /></span>
          <div className="min-w-0">
            <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Next step</p>
            <p className="m-0 mt-0.5 text-base font-bold text-slate-900">{next.title}</p>
            <p className="m-0 mt-1 text-xs leading-5 text-slate-600">{next.body}</p>
          </div>
        </div>
        {isConfirmed && !isCheckedIn && (
          <button type="button" onClick={handleCheckIn} disabled={checkingIn} className="mt-4 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border-0 bg-[#02665e] text-sm font-bold text-white hover:bg-[#014d47] disabled:opacity-60">
            <UserCheck className="h-4 w-4" aria-hidden /> {checkingIn ? "Recording..." : "Mark group checked in"}
          </button>
        )}
        {(isConfirmed || isCheckedIn) && ownerCollectsText && (
          <p className="m-0 mt-3 flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-xs text-slate-600 ring-1 ring-inset ring-slate-200">
            <Wallet className="h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
            You collect <strong className="tabular-nums text-slate-900">{ownerCollectsText}</strong> at the property
          </p>
        )}
      </section>

      <section className={`${card} p-5`}>
        <p className="m-0 text-sm font-bold text-slate-900">Progress</p>
        <ol className="m-0 mt-3 list-none p-0">
          {steps.map((step, index) => {
            const current = index === currentStep && !unpaidAndPast && !isCancelled;
            return (
              <li key={step.label} className="relative flex gap-3 pb-3.5 last:pb-0">
                {index < steps.length - 1 && <span className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-0.5 rounded-full ${step.done ? "bg-[#02665e]" : "bg-slate-200"}`} aria-hidden />}
                <span className={`relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${step.done ? "bg-[#02665e] text-white" : current ? "bg-white ring-2 ring-[#02665e]" : "bg-slate-100"}`}>
                  {step.done ? <CheckCircle className="h-3 w-3" aria-hidden /> : null}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-semibold ${step.done ? "text-slate-900" : current ? "text-[#02665e]" : "text-slate-400"}`}>{step.label}</span>
                  {step.date ? <span className="block text-[11px] text-slate-500">{formatDate(step.date)}</span> : current ? <span className="block text-[11px] text-slate-500">Next</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      </section>

      <section className={`${card} p-5`}>
        <p className="m-0 text-sm font-bold text-slate-900">Reach {guestFirstName || "the guest"}</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <a href={groupStay.user?.phone ? `tel:${groupStay.user.phone}` : undefined} aria-disabled={!groupStay.user?.phone} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-semibold no-underline ring-1 ring-inset ${groupStay.user?.phone ? "bg-white text-slate-800 ring-slate-200 hover:bg-emerald-50" : "pointer-events-none bg-slate-50 text-slate-300 ring-slate-100"}`}><Phone className="h-4 w-4" aria-hidden />Call</a>
          <a href={groupStay.user?.email ? `mailto:${groupStay.user.email}` : undefined} aria-disabled={!groupStay.user?.email} className={`flex flex-col items-center gap-1 rounded-xl px-2 py-3 text-xs font-semibold no-underline ring-1 ring-inset ${groupStay.user?.email ? "bg-white text-slate-800 ring-slate-200 hover:bg-emerald-50" : "pointer-events-none bg-slate-50 text-slate-300 ring-slate-100"}`}><Mail className="h-4 w-4" aria-hidden />Email</a>
          <button type="button" onClick={goToMessaging} className="flex flex-col items-center gap-1 rounded-xl border-0 bg-[#012a26] px-2 py-3 text-xs font-semibold text-[#5eead4] hover:bg-[#033a34]"><MessageSquare className="h-4 w-4" aria-hidden />Message</button>
        </div>
        {groupStay.user?.phone ? <p className="m-0 mt-3 truncate text-xs text-slate-500">{groupStay.user.phone}{groupStay.user.email ? ` · ${groupStay.user.email}` : ""}</p> : null}
      </section>

      <button type="button" onClick={() => setShowPolicyModal(true)} className="flex w-full items-center gap-3 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3 text-left hover:bg-slate-50">
        <ShieldCheck className="h-5 w-5 shrink-0 text-[#02665e]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">Hosting policy</span>
          <span className="block text-xs text-slate-500">Deposits, balance, cancellations</span>
        </span>
      </button>
    </aside>
  );

  return (
    <div className={shell}>
      {/* Top line: back, reference, policy */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/owner/group-stays" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 no-underline hover:text-[#02665e]">
          <ArrowLeft className="h-4 w-4" aria-hidden /> Assigned to me
        </Link>
        <span className="text-xs text-slate-400">Requested {formatDate(groupStay.createdAt)}</span>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="min-w-0 space-y-5">
          {/* The stay pass */}
          <article className="flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_24px_60px_-40px_rgba(1,42,38,0.7)] ring-1 ring-slate-200 md:flex-row">
            <div className={`relative flex flex-col justify-between gap-5 p-6 text-white md:w-[260px] md:shrink-0 ${pass.stub}`}>
              <div>
                <p className="m-0 text-[11px] font-bold uppercase tracking-[0.16em] text-white/60">Group stay</p>
                <p className="m-0 mt-1 text-sm font-semibold text-white/80">{humanize(groupStay.groupType) || "Group"}</p>
              </div>
              <div className="space-y-3">
                <div>
                  <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55">Arrive</p>
                  <p className="m-0 text-[34px] font-extrabold leading-none tracking-tight tabular-nums">{groupStay.checkIn ? new Date(groupStay.checkIn).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short" }) : "?"}</p>
                  <p className="m-0 mt-0.5 text-xs text-white/60">{groupStay.checkIn ? new Date(groupStay.checkIn).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", weekday: "long", year: "numeric" }) : "Date not set"}</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-white/70">
                  <span className="h-px flex-1 bg-white/25" />
                  <span className="rounded-full bg-white/15 px-2 py-0.5 font-bold">{nights ? `${nights} night${nights === 1 ? "" : "s"}` : "?"}</span>
                  <span className="h-px flex-1 bg-white/25" />
                </div>
                <div>
                  <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/55">Leave</p>
                  <p className="m-0 text-2xl font-extrabold leading-none tracking-tight tabular-nums">{groupStay.checkOut ? new Date(groupStay.checkOut).toLocaleDateString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short" }) : "?"}</p>
                </div>
              </div>
              {/* Perforation between stub and body */}
              <span className="pointer-events-none absolute -right-3 top-1/2 hidden h-6 w-6 -translate-y-1/2 rounded-full bg-[#f4f6f5] md:block" aria-hidden />
            </div>

            <div className="relative min-w-0 flex-1 p-6">
              <span className={`pointer-events-none absolute right-5 top-5 rotate-[-8deg] rounded-md border-[2.5px] border-solid px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.18em] ${pass.stamp}`}>{pass.stampText}</span>
              <h1 className="m-0 max-w-[80%] text-[26px] font-bold leading-tight tracking-tight text-slate-900">{groupStay.headcount} {humanize(groupStay.groupType).toLowerCase() || "guests"}</h1>
              <p className="m-0 mt-1 flex items-center gap-1.5 text-sm text-slate-500"><MapPin className="h-4 w-4 shrink-0" aria-hidden />{place}</p>

              <dl className="m-0 mt-5 grid grid-cols-3 border-0 border-y border-dashed border-slate-200 py-4">
                {[
                  { label: "Guests", value: groupStay.headcount },
                  { label: "Rooms", value: groupStay.roomsNeeded },
                  { label: "Accommodation", value: humanize(groupStay.accommodationType) || "Any" },
                ].map((fact, index) => (
                  <div key={fact.label} className={index > 0 ? "border-0 border-l border-dashed border-slate-200 pl-4" : ""}>
                    <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{fact.label}</dt>
                    <dd className="m-0 mt-1 truncate text-xl font-extrabold text-slate-900">{fact.value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#012a26] text-sm font-bold text-[#5eead4]">
                  {(groupStay.user?.name || "G").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">Lead guest</p>
                  <p className="m-0 truncate text-sm font-bold text-slate-900">{groupStay.user?.name || "Not on record"}</p>
                </div>
                {groupStay.confirmedProperty && (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-xl bg-[#012a26] px-3 py-1.5 text-xs font-semibold text-[#5eead4]"><Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden /><span className="truncate">{groupStay.confirmedProperty.title}</span></span>
                )}
              </div>
            </div>
          </article>

          {/* Tabs */}
          <div className="flex gap-1 overflow-x-auto border-0 border-b border-solid border-slate-200" role="tablist">
            {([
              { key: "overview", label: "Overview", count: null as number | null },
              { key: "members", label: "Group members", count: groupStay.passengers?.length ?? 0 },
              { key: "messages", label: "Messages", count: groupStay.messages?.length ?? 0 },
            ] as const).map((item) => {
              const active = tab === item.key;
              return (
                <button key={item.key} type="button" role="tab" aria-selected={active} onClick={() => setTab(item.key)} className={`-mb-px inline-flex h-11 items-center gap-2 whitespace-nowrap border-0 border-b-2 border-solid bg-transparent px-3 text-sm font-semibold transition ${active ? "border-[#02665e] text-[#02665e]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
                  {item.label}
                  {item.count !== null && <span className={`rounded-full px-1.5 text-[11px] font-bold tabular-nums ${active ? "bg-[#02665e] text-white" : "bg-slate-100 text-slate-500"}`}>{item.count}</span>}
                </button>
              );
            })}
          </div>

          {tab === "overview" && (
            <section className={`${card} p-5`}>
              <h2 className="m-0 text-base font-bold text-slate-900">What the group asked for</h2>
              <p className="m-0 mt-0.5 text-xs text-slate-500">For awareness. NoLSAF arranges transport and pickups.</p>
              <ul className="m-0 mt-4 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 xl:grid-cols-5">
                {allExtras.map((extra) => (
                  <li key={extra.label} className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 ring-1 ring-inset ${extra.on ? "bg-emerald-50/60 ring-emerald-200" : "bg-slate-50 ring-slate-100"}`}>
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${extra.on ? "bg-[#012a26] text-[#5eead4]" : "bg-white text-slate-300 ring-1 ring-inset ring-slate-200"}`}><extra.Icon className="h-4 w-4" aria-hidden /></span>
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${extra.on ? "text-slate-900" : "text-slate-400"}`}>{extra.label}</span>
                      <span className={`block text-[11px] ${extra.on ? "text-emerald-700" : "text-slate-400"}`}>{extra.on ? "Requested" : "Not needed"}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {groupStay.arrPickup && (groupStay.pickupLocation || groupStay.pickupTime) && (
                <p className="m-0 mt-4 flex items-start gap-2 rounded-xl bg-sky-50 px-3.5 py-2.5 text-sm text-sky-900">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  Pickup{groupStay.pickupLocation ? ` from ${groupStay.pickupLocation}` : ""}{groupStay.pickupTime ? ` at ${groupStay.pickupTime}` : ""}
                </p>
              )}
              {groupStay.arrangementNotes && (
                <blockquote className="m-0 mt-4 rounded-xl bg-slate-50 px-4 py-3">
                  <p className="m-0 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-slate-400"><FileText className="h-3.5 w-3.5" aria-hidden /> Note from {guestFirstName || "the guest"}</p>
                  <p className="m-0 mt-1.5 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">{groupStay.arrangementNotes}</p>
                </blockquote>
              )}
            </section>
          )}

          {tab === "members" && (
            <section className={`${card} overflow-hidden`}>
              {hasRoster ? (
                <>
                  <div className="flex items-center justify-between gap-3 px-5 py-4">
                    <p className="m-0 text-sm text-slate-600"><strong className="text-slate-900">{groupStay.passengers!.length}</strong> of {groupStay.headcount} members shared</p>
                    <label className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                      <input value={passengerSearch} onChange={(e) => setPassengerSearch(e.target.value)} placeholder="Search name, phone, country" aria-label="Search group members" className="box-border h-9 w-56 rounded-xl border border-solid border-slate-300 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#02665e]" />
                    </label>
                  </div>
                  <ol className="m-0 list-none p-0">
                    {filteredPassengers.map((member, index) => (
                      <li key={member.id} className="flex items-center gap-3 border-0 border-t border-solid border-slate-100 px-5 py-3">
                        <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-slate-400">{member.sequenceNumber ?? index + 1}</span>
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">{`${member.firstName?.[0] ?? ""}${member.lastName?.[0] ?? ""}`.toUpperCase() || "G"}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">{member.firstName} {member.lastName}</span>
                          <span className="block truncate text-xs text-slate-500">{[member.gender ? humanize(member.gender) : null, member.age ? `${member.age} yrs` : null, member.nationality].filter(Boolean).join(" · ") || "No details"}</span>
                        </span>
                        {member.phone ? <a href={`tel:${member.phone}`} className="shrink-0 text-xs font-semibold text-[#02665e] no-underline">{member.phone}</a> : null}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <span className="grid h-11 w-11 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Users className="h-5 w-5" aria-hidden /></span>
                  <p className="m-0 mt-3 text-sm font-bold text-slate-900">No member list yet</p>
                  <p className="m-0 mt-1 max-w-sm text-xs text-slate-500">The group shares names before arrival. They appear here as soon as they do.</p>
                </div>
              )}
            </section>
          )}

          {tab === "messages" && (<>
      {/* Conversation */}
      <section id="owner-communication" className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white">
        <header className="flex items-center gap-3 border-0 border-b border-solid border-slate-100 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#012a26] text-sm font-bold text-[#5eead4]">
            {(groupStay.user?.name || "G").split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-bold text-slate-900">{groupStay.user?.name || "The guest"}</p>
            <p className="m-0 text-xs text-slate-500">Lead guest. The NoLSAF team can read and reply in this thread.</p>
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold tabular-nums text-slate-600">{messages.length} message{messages.length === 1 ? "" : "s"}</span>
        </header>

        <div className="max-h-[460px] space-y-3 overflow-y-auto bg-[#f6f8f7] px-4 py-5 sm:px-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center py-8 text-center">
              <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white text-[#02665e] ring-1 ring-inset ring-slate-200"><MessageSquare className="h-5 w-5" aria-hidden /></span>
              <p className="m-0 mt-3 text-sm font-bold text-slate-900">No messages yet</p>
              <p className="m-0 mt-1 max-w-xs text-xs text-slate-500">Say hello and share what the group should know before they arrive. A starter below fills the box for you.</p>
            </div>
          ) : (
            messages.map((msg, index) => {
              const mine = msg.senderRole === "OWNER";
              const team = msg.senderRole === "ADMIN";
              const day = dayOf(msg.createdAt);
              const showDay = index === 0 || dayOf(messages[index - 1].createdAt) !== day;
              const name = mine ? "You" : msg.senderName || (team ? "NoLSAF team" : "Guest");
              return (
                <div key={msg.id}>
                  {showDay && (
                    <div className="my-2 flex items-center gap-3 text-[11px] font-semibold text-slate-400">
                      <span className="h-px flex-1 bg-slate-200" />{day}<span className="h-px flex-1 bg-slate-200" />
                    </div>
                  )}
                  <div className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                    {!mine && (
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${team ? "bg-[#02665e] text-white" : "bg-white text-slate-600 ring-1 ring-inset ring-slate-200"}`}>
                        {team ? "N" : name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("")}
                      </span>
                    )}
                    <div className={`max-w-[82%] sm:max-w-[70%] ${mine ? "items-end" : "items-start"} flex flex-col`}>
                      <div className={`mb-1 flex items-center gap-1.5 text-[11px] ${mine ? "flex-row-reverse" : ""}`}>
                        <span className="font-bold text-slate-700">{name}</span>
                        {team && <span className="rounded-full bg-emerald-50 px-1.5 py-px font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">Team</span>}
                        {msg.messageType && msg.messageType !== "General" && <span className="text-slate-400">{msg.messageType}</span>}
                      </div>
                      <div className={`whitespace-pre-wrap break-words px-4 py-2.5 text-sm leading-6 ${mine ? "rounded-2xl rounded-br-md bg-[#02665e] text-white" : "rounded-2xl rounded-bl-md bg-white text-slate-800 ring-1 ring-inset ring-slate-200"}`}>
                        {msg.body}
                      </div>
                      <span className="mt-1 text-[10.5px] tabular-nums text-slate-400">{timeOf(msg.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Composer */}
        <div className="border-0 border-t border-solid border-slate-100 p-4 sm:p-5">
          <div className="flex gap-2 overflow-x-auto pb-3">
            {STARTERS.map((starter) => {
              const active = messageType === starter.type;
              return (
                <button
                  key={starter.type}
                  type="button"
                  onClick={() => handleMessageTypeChange(active ? "General" : starter.type)}
                  aria-pressed={active}
                  className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-solid px-3 text-xs font-semibold transition ${active ? "border-[#02665e] bg-[#02665e] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-[#02665e]/40 hover:text-[#02665e]"}`}
                >
                  <starter.Icon className="h-3.5 w-3.5" aria-hidden />{starter.label}
                </button>
              );
            })}
          </div>
          <div className={`rounded-2xl border border-solid bg-white transition focus-within:border-[#02665e] focus-within:ring-2 focus-within:ring-[#02665e]/15 ${messageText.length > MAX_MESSAGE_LENGTH * 0.9 ? "border-amber-300" : "border-slate-300"}`}>
            <textarea
              value={messageText}
              onChange={(e) => {
                if (e.target.value.length <= MAX_MESSAGE_LENGTH) setMessageText(e.target.value);
              }}
              onFocus={handleTextareaFocus}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !sendingMessage && messageText.trim()) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`Write to ${guestFirstName || "the guest"}...`}
              rows={4}
              maxLength={MAX_MESSAGE_LENGTH}
              aria-label="Message"
              className="box-border block w-full resize-none rounded-t-2xl border-0 bg-transparent px-4 pt-3 text-sm leading-6 text-slate-800 outline-none"
            />
            <div className="flex items-center justify-between gap-3 px-3 pb-3">
              <span className={`text-[11px] tabular-nums ${messageText.length > MAX_MESSAGE_LENGTH * 0.9 ? "font-semibold text-amber-600" : "text-slate-400"}`}>
                {messageText.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
                <span className="ml-2 hidden text-slate-400 sm:inline">Ctrl + Enter to send</span>
              </span>
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={sendingMessage || !messageText.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-bold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sendingMessage ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-white/30 border-t-white" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
                {sendingMessage ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </section>

          </>)}
        </div>

        {rail}
      </div>

      {/* Hosting Policy Modal */}
      {showPolicyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => setShowPolicyModal(false)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="policy-modal-title"
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-green-700 px-5 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                  <ShieldCheck className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 id="policy-modal-title" className="text-base sm:text-lg font-semibold text-white truncate">Hosting policy</h2>
                  <p className="text-xs text-white/80 mt-0.5">Please follow these for a confirmed group stay</p>
                </div>
              </div>
              <button
                onClick={() => setShowPolicyModal(false)}
                className="h-8 w-8 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all duration-200 flex items-center justify-center hover:scale-110 flex-shrink-0 ml-3"
                title="Close"
                aria-label="Close policy"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
              <PolicyItem
                icon={<Wallet className="h-5 w-5 text-teal-600" />}
                tone="teal"
                title="How you get paid"
                body="The guest pays the deposit online. You collect the stay balance directly from the guest at the property. NoLSAF does not collect anything further from that balance, so there is no separate payout to wait for."
              />
              <PolicyItem
                icon={<CalendarX className="h-5 w-5 text-rose-600" />}
                tone="rose"
                title="Block the selected dates"
                body={`Do not accept other guests for these rooms on the booked stay dates${groupStay.checkIn && groupStay.checkOut ? ` (${formatDate(groupStay.checkIn)} to ${formatDate(groupStay.checkOut)})` : ""}. Keep them reserved for this group so no one is turned away on arrival.`}
              />
              <PolicyItem
                icon={<TrendingUp className="h-5 w-5 text-amber-600" />}
                tone="amber"
                title="An opportunity that counts"
                body="NoLSAF reviews hosting trends across every group stay. Treat this booking as a chance to stand out and earn more group placements in the future."
              />
              <PolicyItem
                icon={<MessageSquare className="h-5 w-5 text-blue-600" />}
                tone="blue"
                title="Stay in close communication"
                body="Reach out to your guest early, share arrival and check in details, and reply to their questions promptly throughout the stay."
              />
              <PolicyItem
                icon={<HeartHandshake className="h-5 w-5 text-emerald-600" />}
                tone="emerald"
                title="Treat travellers well"
                body="Welcome the group warmly and make sure every traveller is cared for and comfortable from arrival to checkout."
              />
            </div>

            {/* Modal Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-slate-200 flex-shrink-0">
              <button
                onClick={() => setShowPolicyModal(false)}
                className="w-full px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 text-white font-semibold text-sm hover:from-emerald-700 hover:to-green-700 transition-all duration-200"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Passengers Modal */}
      {showPassengersModal && groupStay?.passengers && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200"
          onClick={() => {
            setShowPassengersModal(false);
            setPassengerSearch("");
          }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-title"
        >
          <div 
            ref={setModalRef}
            tabIndex={-1}
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300 focus:outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-4 sm:px-6 py-4 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3 min-w-0 flex-1">
                <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                  <Users className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0">
                  <h2 id="modal-title" className="text-base sm:text-lg font-semibold text-white truncate">Group Members</h2>
                  <p className="text-xs text-white/80 mt-0.5">
                    {filteredPassengers.length} of {groupStay.passengers.length} {groupStay.passengers.length === 1 ? 'person' : 'people'}
                    {passengerSearch && filteredPassengers.length !== groupStay.passengers.length && (
                      <span className="ml-1">(filtered)</span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowPassengersModal(false);
                  setPassengerSearch("");
                }}
                className="h-8 w-8 rounded-lg bg-white/20 hover:bg-white/30 text-white transition-all duration-200 flex items-center justify-center hover:scale-110 flex-shrink-0 ml-3"
                title="Close (Esc)"
                aria-label="Close modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search Bar */}
            {groupStay.passengers.length > 5 && (
              <div className="px-4 sm:px-6 py-3 border-b border-slate-200 flex-shrink-0 flex items-center justify-center">
                <div className="relative w-full max-w-md">
                  <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search by name, phone, or nationality..."
                    value={passengerSearch}
                    onChange={(e) => setPassengerSearch(e.target.value)}
                    className="w-full pl-8 pr-8 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand focus:border-brand outline-none transition-all duration-200 text-sm"
                    aria-label="Search passengers"
                  />
                  {passengerSearch && (
                    <button
                      onClick={() => setPassengerSearch("")}
                      className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                      aria-label="Clear search"
                      title="Clear search"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0">
              {filteredPassengers.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="h-16 w-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                    <Search className="h-8 w-8 text-slate-400" />
                  </div>
                  <h3 className="text-base font-semibold text-slate-900 mb-2">No passengers found</h3>
                  <p className="text-sm text-slate-600 max-w-sm">
                    {passengerSearch 
                      ? `No passengers match "${passengerSearch}". Try a different search term.`
                      : "No passenger details are available for this group stay."
                    }
                  </p>
                  {passengerSearch && (
                    <button
                      onClick={() => setPassengerSearch("")}
                      className="mt-4 inline-flex items-center justify-center h-10 w-10 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:border-brand transition-all duration-200 shadow-sm hover:shadow-md hover:scale-110"
                      title="Clear search"
                      aria-label="Clear search"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {filteredPassengers
                    .sort((a, b) => (a.sequenceNumber || 0) - (b.sequenceNumber || 0))
                    .map((passenger, index) => (
                      <div
                        key={passenger.id || index}
                        className="p-3 sm:p-4 rounded-xl border border-slate-200 bg-slate-50 hover:bg-white hover:border-brand/30 transition-all duration-200 hover:shadow-md"
                      >
                        <div className="flex items-start gap-3">
                          <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-lg bg-brand/10 flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4 sm:h-5 sm:w-5 text-brand" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1 flex-wrap">
                              <span className="text-xs font-semibold text-slate-500">#{passenger.sequenceNumber || index + 1}</span>
                              <h3 className="text-sm font-semibold text-slate-900 truncate">
                                {passenger.firstName} {passenger.lastName}
                              </h3>
                            </div>
                            <div className="space-y-1 mt-2">
                              {passenger.age && (
                                <div className="text-xs text-slate-600">
                                  <span className="font-medium">Age:</span> {passenger.age}
                                </div>
                              )}
                              {passenger.gender && (
                                <div className="text-xs text-slate-600">
                                  <span className="font-medium">Gender:</span> {passenger.gender}
                                </div>
                              )}
                              {passenger.nationality && (
                                <div className="text-xs text-slate-600">
                                  <span className="font-medium">Nationality:</span> {passenger.nationality}
                                </div>
                              )}
                              {passenger.phone && (
                                <div className="text-xs text-slate-600 flex items-center gap-1">
                                  <Phone className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{passenger.phone}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyItem({ icon, tone, title, body }: { icon: React.ReactNode; tone: "rose" | "amber" | "blue" | "emerald" | "teal"; title: string; body: string }) {
  const toneClasses: Record<string, string> = {
    rose: "bg-rose-50 border-rose-100",
    amber: "bg-amber-50 border-amber-100",
    blue: "bg-blue-50 border-blue-100",
    emerald: "bg-emerald-50 border-emerald-100",
    teal: "bg-teal-50 border-teal-100",
  };
  return (
    <div className="flex items-start gap-3.5">
      <div className={`h-10 w-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${toneClasses[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-bold text-slate-900">{title}</h3>
        <p className="text-sm text-slate-600 leading-relaxed mt-0.5">{body}</p>
      </div>
    </div>
  );
}



