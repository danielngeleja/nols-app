import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  CreditCard,
  FileText,
  Flag,
  Headset,
  MapPin,
  MessageSquareText,
  ReceiptText,
  Send,
  Share2,
  ShieldCheck,
  Star,
  TicketCheck,
  UploadCloud,
  Users
} from "lucide-react-native";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Alert, Animated, Easing, Linking, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Line, Path, Stop, Text as SvgText } from "react-native-svg";

import { useAuth } from "../auth";
import { AmountText, AppButton, AppInput, AppText, SafeScreen, ShareTripButton, SheetModal, StateView, useSheetBottomInset } from "../components";
import { RootStackParamList } from "../navigation/types";
import {
  createTourTimelineInvite,
  CustomerTourBookingDetail,
  fetchCustomerTourBooking,
  fetchCustomerTourDocumentLink,
  saveTourBookingDocument,
  saveTravellerDocument,
  startTourPickupCheckIn,
  submitTourChangeRequest,
  submitTourIssueReport,
  uploadTravellerDocumentFile,
  validateTourPickup
} from "../tours";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TourDetail">;
type ActionMode = "change" | "issue" | null;
type RatingJourneyPoint = {
  key: string;
  label: string;
  title: string;
  rating: number;
  count: number;
  ratingLabel: string;
};
type TimelineSlot = {
  key: string;
  time: string;
  title: string;
  description: string;
  vibe: string;
  userRating: number;
  userRatingLabel: string;
  teamAverage: number;
  teamCount: number;
};
type TimelineDay = {
  day: number;
  title: string;
  description: string;
  slots: TimelineSlot[];
};
type RequiredDocumentSlot = {
  type: string;
  label: string;
  description: string;
  required?: boolean;
  accept?: string[];
  acceptLabel?: string;
};
type OperatorIssuedDocument = {
  id: string;
  type: string;
  label: string;
  url: string;
  status?: string;
  uploadedAt?: string;
};
type UploadedDocumentState = Record<string, { name: string; url?: string; status: "Uploaded" | "Pending" | "Failed" }>;
type DocumentResult =
  | {
      type: "documents";
      title: string;
      rows: Array<{ label: string; value: string }>;
      documents: RequiredDocumentSlot[];
      operatorDocuments: OperatorIssuedDocument[];
    };

function fmtDate(value?: string | null) {
  if (!value) return "Not set";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Not set" : d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(value?: string | null) {
  if (!value) return "Not recorded";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "Not recorded" : d.toLocaleString();
}

function operatorName(item: CustomerTourBookingDetail) {
  const snap = item.operatorSnapshot || {};
  return String(snap.companyName || snap.operatorName || snap.name || "NoLSAF tour operator");
}

function listify(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item).trim();
        const obj = safeObject(item);
        return firstText(obj.label, obj.name, obj.title, obj.value, obj.description);
      })
      .filter(Boolean);
  }
  if (typeof value === "string") return value.split(/[\n,;|]+/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

const PDF_FILE_TYPES = ["application/pdf"];
const IMAGE_FILE_TYPES = ["image/jpeg", "image/png"];
const DEFAULT_TRAVELLER_DOCUMENTS: RequiredDocumentSlot[] = [
  {
    type: "PASSPORT_SIZE_PHOTO",
    label: "Passport Size Photo",
    description: "Clear recent passport-size image for entry permit processing.",
    required: true,
    accept: IMAGE_FILE_TYPES,
    acceptLabel: "JPG or PNG only"
  },
  {
    type: "TRAVEL_PASSPORT",
    label: "Travel Passport",
    description: "Passport biodata page used for this trip.",
    required: true,
    accept: PDF_FILE_TYPES,
    acceptLabel: "PDF only"
  },
  {
    type: "MEDICAL_CLEARANCE",
    label: "Medical Clearance",
    description: "Medical letter or fitness note when needed for package activities.",
    accept: PDF_FILE_TYPES,
    acceptLabel: "PDF only"
  },
  {
    type: "SUPPORTING_DOCUMENT",
    label: "Other Supporting Documents",
    description: "Any other requested file from your tour operator.",
    accept: PDF_FILE_TYPES,
    acceptLabel: "PDF only"
  },
  {
    type: "VACCINATION_CARD",
    label: "Vaccination Card",
    description: "General immunization card or travel vaccination booklet.",
    accept: PDF_FILE_TYPES,
    acceptLabel: "PDF only"
  },
  {
    type: "VISA_DOCUMENT",
    label: "Visa Document",
    description: "Visa approval page when the destination requires one.",
    accept: PDF_FILE_TYPES,
    acceptLabel: "PDF only"
  },
  {
    type: "YELLOW_FEVER_CERTIFICATE",
    label: "Yellow Fever Certificate",
    description: "Yellow fever vaccination proof for destinations that require it.",
    accept: PDF_FILE_TYPES,
    acceptLabel: "PDF only"
  }
];

function normalizeDocumentType(label: string) {
  const normalized = label.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (/PHOTO/.test(normalized)) return "PASSPORT_SIZE_PHOTO";
  if (/PASSPORT/.test(normalized)) return "TRAVEL_PASSPORT";
  if (/VISA/.test(normalized)) return "VISA_DOCUMENT";
  if (/YELLOW/.test(normalized)) return "YELLOW_FEVER_CERTIFICATE";
  if (/VACCIN|HEALTH/.test(normalized)) return "VACCINATION_CARD";
  if (/MEDICAL/.test(normalized)) return "MEDICAL_CLEARANCE";
  if (/ID|IDENT/.test(normalized)) return "NATIONAL_ID";
  return normalized || "SUPPORTING_DOCUMENT";
}

function requiredDocumentSlots(item: CustomerTourBookingDetail): RequiredDocumentSlot[] {
  const pkg = item.packageSnapshot || {};
  const md = item.metadata || {};
  const declared = [
    ...listify((pkg as any).requiredDocuments || (pkg as any).documentsRequired || (pkg as any).documentChecklist),
    ...listify((md as any).requiredDocuments || (md as any).documentChecklist)
  ];
  const slots = [...DEFAULT_TRAVELLER_DOCUMENTS];
  declared.forEach((label) => {
    const type = normalizeDocumentType(label);
    if (slots.some((slot) => slot.type === type)) return;
    slots.push({
      type,
      label: label.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(),
      description: "Operator-requested support file for this package.",
      required: true,
      accept: PDF_FILE_TYPES,
      acceptLabel: "PDF only"
    });
  });

  const seen = new Set<string>();
  return slots.filter((slot) => {
      if (seen.has(slot.type)) return false;
      seen.add(slot.type);
      return true;
    });
}

function operatorIssuedDocuments(item: CustomerTourBookingDetail): OperatorIssuedDocument[] {
  const md = safeObject(item.metadata);
  const sources = [
    ...safeArray(md.operatorIssuedDocuments),
    ...safeArray(md.operatorDocuments),
    ...safeArray(md.completedDocuments),
    ...safeArray(md.entryPermits)
  ];
  return sources
    .map<OperatorIssuedDocument | null>((doc, index) => {
      const obj = safeObject(doc);
      const url = String(obj.url || obj.href || obj.documentUrl || "").trim();
      if (!url) return null;
      const type = String(obj.type || "ENTRY_PERMIT").toUpperCase();
      return {
        id: String(obj.id || `${type}-${index}`),
        type,
        label: String(obj.label || obj.title || (type === "ENTRY_PERMIT" ? "Completed Entry Permit" : type.replace(/_/g, " "))).trim(),
        url,
        status: String(obj.status || "Ready").trim(),
        uploadedAt: String(obj.uploadedAt || obj.createdAt || "").trim()
      };
    })
    .filter((doc): doc is OperatorIssuedDocument => Boolean(doc));
}

function pickupValidatedAt(item: CustomerTourBookingDetail): string | null {
  const md = safeObject(item.metadata);
  const shared = safeObject(item.pickupValidation || md.pickupValidation);
  const customer = safeObject(md.pickupValidationCustomer);
  const operator = safeObject(md.pickupValidationOperator);
  const timeline = safeObject(item.pickupTimeline);
  const raw =
    shared.validatedAt ||
    shared.firstMeetValidatedAt ||
    customer.validatedAt ||
    operator.validatedAt ||
    timeline.validatedAt ||
    (String(item.dashboardBucket || "").toUpperCase() === "COMPLETED" ? item.completedAt || item.updatedAt : null);
  return raw ? fmtDateTime(String(raw)) : null;
}

function timelineShareStatus(item: CustomerTourBookingDetail) {
  const team = item.timelineTeam || {};
  const share = item.timelineShare || {};
  const joined = Number(team.joinedTotal || 1);
  const total = Math.max(joined, Number(team.totalTravellers || item.travelerCount || 1));
  const invitedCapacity = Number(team.invitedCapacity || Math.max(0, total - 1));
  const remaining = Number.isFinite(Number(team.remainingTravellers)) ? Number(team.remainingTravellers) : Math.max(0, invitedCapacity - Math.max(0, joined - 1));
  return {
    hasInvite: Boolean(share.hasInvite || share.inviteUrl || share.invitePath),
    url: String(share.inviteUrl || share.invitePath || "").trim(),
    joined,
    total,
    remaining,
    expiresAt: share.expiresAt ? fmtDateTime(share.expiresAt) : null
  };
}

function statusDetailText(item: CustomerTourBookingDetail, paid: boolean, isCompleted: boolean) {
  if (isCompleted) return `Completed ${fmtDateTime(item.completedAt || item.updatedAt || item.endDate)}`;
  if (!paid) return "Complete payment to confirm the package.";
  const paidAt = fmtDateTime(item.paidAt);
  return paidAt === "Not recorded" ? "Package is ready for meetup validation." : `Payment confirmed ${paidAt}`;
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function packageList(source: Record<string, any>, keys: string[]): string[] {
  const values = keys.flatMap((key) => listify(source[key]));
  return Array.from(new Set(values));
}

function selectedMeetingPoint(item: CustomerTourBookingDetail, packageMeetingPoints: string[]): string {
  const md = safeObject(item.metadata);
  return firstText(
    md.selectedMeetingPoint,
    md.meetingPoint,
    md.pickupPoint,
    md.selectedAirport,
    safeObject(md.travelDetails).meetingPoint,
    packageMeetingPoints[0]
  );
}

function packageDayFacts(item: CustomerTourBookingDetail, days: TimelineDay[]): string[] {
  const pkg = safeObject(item.packageSnapshot);
  const md = safeObject(item.metadata);
  const duration = firstText(pkg.duration, pkg.days, md.duration, md.days);
  const nights = firstText(pkg.nights, md.nights);
  const facts = [
    duration ? `${duration} day${duration === "1" ? "" : "s"}` : "",
    nights ? `${nights} night${nights === "1" ? "" : "s"}` : "",
    days.length ? `${days.length} itinerary day${days.length === 1 ? "" : "s"}` : ""
  ].filter(Boolean);
  return Array.from(new Set(facts));
}

function smokeTimelineDays(): TimelineDay[] {
  return [
    {
      day: 1,
      title: "Meetup, Briefing And First Drive",
      description: "Smoke preview for timeline layout: validation, activity flow, ratings, and team averages.",
      slots: [
        {
          key: "smoke-1-0",
          time: "07:30-08:00",
          title: "Meetup validation",
          description: "Guide confirms travellers and unlocks the shared timeline.",
          vibe: "Arrival ready",
          userRating: 5,
          userRatingLabel: "Beyond expectations",
          teamAverage: 4.5,
          teamCount: 2
        },
        {
          key: "smoke-1-1",
          time: "08:00-10:30",
          title: "Route briefing",
          description: "Safety notes, park rules, and day plan before departure.",
          vibe: "Prepared",
          userRating: 4,
          userRatingLabel: "Excited",
          teamAverage: 4,
          teamCount: 2
        },
        {
          key: "smoke-1-2",
          time: "11:00-13:00",
          title: "First activity stop",
          description: "Timeline card preview with rating and experience details.",
          vibe: "Active",
          userRating: 0,
          userRatingLabel: "",
          teamAverage: 0,
          teamCount: 0
        }
      ]
    },
    {
      day: 2,
      title: "Main Experience Day",
      description: "Second smoke day to test horizontal sliding with multiple timeline cards.",
      slots: [
        {
          key: "smoke-2-0",
          time: "06:30-09:30",
          title: "Morning activity",
          description: "Early activity block with traveller rating state.",
          vibe: "Fresh",
          userRating: 3,
          userRatingLabel: "Good",
          teamAverage: 3.5,
          teamCount: 2
        },
        {
          key: "smoke-2-1",
          time: "12:30-14:00",
          title: "Lunch and rest",
          description: "Midday break shown inside the timetable card.",
          vibe: "Relaxed",
          userRating: 0,
          userRatingLabel: "",
          teamAverage: 0,
          teamCount: 0
        }
      ]
    }
  ];
}

function wordCount(value: string) {
  const text = value.trim();
  return text ? text.split(/\s+/).length : 0;
}

function statusMeta(item: CustomerTourBookingDetail) {
  const bucket = String(item.dashboardBucket || "").toUpperCase();
  const pay = String(item.paymentStatus || "").toUpperCase();
  if (bucket === "COMPLETED") return { label: "Completed", color: colors.success, tint: "#e9f7ef" };
  if (bucket === "ACTIVE_TIMELINE") return { label: "Timeline live", color: "#2563eb", tint: "#eaf2ff" };
  if (bucket === "PAID_PACKAGES" || pay === "PAID") return { label: "Ready", color: colors.primary, tint: colors.brand[50] };
  return { label: "Payment pending", color: colors.warning, tint: "#fff7ed" };
}

function buildTimeLabel(value: any): string {
  const direct = String(value?.timeRange || value?.time || "").trim();
  if (direct) return direct;
  const start = String(value?.startTime || value?.start || value?.from || "").trim();
  const end = String(value?.endTime || value?.end || value?.to || "").trim();
  if (start && end) return `${start}-${end}`;
  return start || end || "Schedule";
}

function slotVibe(value: any): string {
  if (typeof value === "string") return "";
  return String(
    value?.experienceVibe ||
    value?.experience_vibe ||
    value?.vibe ||
    value?.difficulty ||
    value?.mood ||
    value?.tone ||
    ""
  ).trim();
}

function rawTimelineRows(item: CustomerTourBookingDetail): any[] {
  const md = item.metadata || {};
  const pkg = item.packageSnapshot || {};
  return (
    Array.isArray((pkg as any).itinerary) ? (pkg as any).itinerary :
    Array.isArray((md as any).itinerary) ? (md as any).itinerary :
    Array.isArray((pkg as any).timelineDays) ? (pkg as any).timelineDays :
    Array.isArray((md as any).timelineDays) ? (md as any).timelineDays :
    []
  );
}

function normalizedTimeline(item: CustomerTourBookingDetail) {
  return rawTimelineRows(item)
    .map((row: any, index: number) => ({
      day: Number(row?.day || index + 1),
      title: String(row?.title || row?.name || `Day ${index + 1}`).trim(),
      description: String(row?.description || row?.notes || "").trim(),
      events: [...(Array.isArray(row?.events) ? row.events : []), ...(Array.isArray(row?.timeline) ? row.timeline : [])]
    }))
    .filter((row) => row.title || row.description || row.events.length)
    .slice(0, 5);
}

const RATING_LABELS: Record<number, string> = {
  1: "Bored",
  2: "Okay",
  3: "Good",
  4: "Excited",
  5: "Beyond expectations"
};

function safeObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function eventTitle(value: any) {
  if (typeof value === "string") return value.trim() || "Activity";
  return String(value?.activity || value?.label || value?.title || value?.name || value?.description || "Activity").trim();
}

function ratingValues(entry: unknown): number[] {
  const obj = safeObject(entry);
  const ratings = safeObject(obj.ratings);
  const values = Object.keys(ratings).length
    ? Object.values(ratings).map((rating) => Number(safeObject(rating).rating || rating || 0))
    : obj.rating
      ? [Number(obj.rating || 0)]
      : [];
  return values.filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
}

function userRatingValue(entry: unknown): number {
  const obj = safeObject(entry);
  const ratings = safeObject(obj.ratings);
  const first = Object.values(ratings)[0];
  return Number(safeObject(first).rating || obj.rating || first || 0);
}

function normalizeDetailedTimeline(item: CustomerTourBookingDetail): TimelineDay[] {
  const ratings = safeObject(safeObject(item.metadata).timelineEventRatings);
  return rawTimelineRows(item)
    .map((row: any, index: number) => {
      const day = Number(row?.day || index + 1);
      const rawSlots = [...(Array.isArray(row?.events) ? row.events : []), ...(Array.isArray(row?.timeline) ? row.timeline : [])];
      const slotsSource = rawSlots.length ? rawSlots : [{ title: row?.title, description: row?.description }];
      const slots = slotsSource
        .map((slot: any, slotIdx: number) => {
          const key = `${day}-${slotIdx}`;
          const values = ratingValues(ratings[key]);
          const teamAverage = values.length ? values.reduce((sum, rating) => sum + rating, 0) / values.length : 0;
          const userRating = userRatingValue(ratings[key]);
          const rounded = Math.max(1, Math.min(5, Math.round(userRating || teamAverage || 0)));
          return {
            key,
            time: buildTimeLabel(slot),
            title: eventTitle(slot),
            description: typeof slot === "string" ? "" : String(slot?.description || slot?.details || slot?.notes || "").trim(),
            vibe: slotVibe(slot),
            userRating,
            userRatingLabel: userRating ? RATING_LABELS[rounded] || `${userRating}/5` : "",
            teamAverage: Number(teamAverage.toFixed(1)),
            teamCount: values.length
          };
        })
        .filter((slot: TimelineSlot) => slot.time || slot.title || slot.description);

      return {
        day,
        title: String(row?.title || row?.name || `Day ${day}`).trim(),
        description: String(row?.description || row?.notes || "").trim(),
        slots
      };
    })
    .filter((day) => day.title || day.description || day.slots.length);
}

function buildRatingJourney(item: CustomerTourBookingDetail): RatingJourneyPoint[] {
  const ratings = safeObject(safeObject(item.metadata).timelineEventRatings);
  const days = normalizedTimeline(item);
  const points: RatingJourneyPoint[] = [];

  days.forEach((day) => {
    const slots = day.events.length ? day.events : [{ title: day.title }];
    slots.forEach((slot, slotIdx) => {
      const key = `${day.day}-${slotIdx}`;
      const values = ratingValues(ratings[key]);
      if (!values.length) return;
      const average = values.reduce((sum, rating) => sum + rating, 0) / values.length;
      const rounded = Math.max(1, Math.min(5, Math.round(average)));
      points.push({
        key,
        label: `D${day.day}.${slotIdx + 1}`,
        title: eventTitle(slot),
        rating: Number(average.toFixed(2)),
        count: values.length,
        ratingLabel: RATING_LABELS[rounded] || `${average.toFixed(1)}/5`
      });
    });
  });

  if (points.length) return points;

  return Object.entries(ratings)
    .map(([key, entry], index) => {
      const values = ratingValues(entry);
      if (!values.length) return null;
      const average = values.reduce((sum, rating) => sum + rating, 0) / values.length;
      const rounded = Math.max(1, Math.min(5, Math.round(average)));
      const obj = safeObject(entry);
      return {
        key,
        label: key.replace("-", ".") || `R${index + 1}`,
        title: String(obj.title || "Timeline event"),
        rating: Number(average.toFixed(2)),
        count: values.length,
        ratingLabel: RATING_LABELS[rounded] || `${average.toFixed(1)}/5`
      };
    })
    .filter((point): point is RatingJourneyPoint => Boolean(point));
}

export function TourDetailScreen({ route, navigation }: Props) {
  const { token } = useAuth();
  const bookingId = route.params.id;
  // API paths use the opaque tr_ reference; the numeric id stays for display codes and payment.
  const bookingKey = route.params.ref || bookingId;
  const [item, setItem] = useState<CustomerTourBookingDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionMode, setActionMode] = useState<ActionMode>(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionBody, setActionBody] = useState("");
  const [documentResult, setDocumentResult] = useState<DocumentResult | null>(null);
  const [documentUploads, setDocumentUploads] = useState<UploadedDocumentState>({});
  const [uploadingDocument, setUploadingDocument] = useState<string | null>(null);
  const [meetupSheetOpen, setMeetupSheetOpen] = useState(false);
  const [meetupCode, setMeetupCode] = useState("");
  const [createdTimelineUrl, setCreatedTimelineUrl] = useState("");
  const [timelineCopied, setTimelineCopied] = useState(false);
  const meetupPulse = useRef(new Animated.Value(0)).current;
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to view this tour package.");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setItem(await fetchCustomerTourBooking(token, bookingKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load this tour package.");
    } finally {
      setLoading(false);
    }
  }, [bookingId, bookingKey, token]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(meetupPulse, {
          toValue: 1,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        }),
        Animated.timing(meetupPulse, {
          toValue: 0,
          duration: 850,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [meetupPulse]);

  useEffect(() => () => {
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
  }, []);

  const back = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate("MyTours"));

  const showVoucher = async () => {
    if (!token) return;
    setActionLoading(true);
    try {
      const document = await fetchCustomerTourDocumentLink(token, bookingKey, "voucher");
      if (!document.url) throw new Error("The official voucher link is unavailable.");
      await Linking.openURL(document.url);
    } catch (err) {
      Alert.alert("Voucher", err instanceof Error ? err.message : "Voucher is not available yet.");
    } finally {
      setActionLoading(false);
    }
  };

  const showReceipt = async () => {
    if (!token) return;
    setActionLoading(true);
    try {
      const document = await fetchCustomerTourDocumentLink(token, bookingKey, "receipt");
      if (!document.url) throw new Error("The official receipt link is unavailable.");
      await Linking.openURL(document.url);
    } catch (err) {
      Alert.alert("Receipt", err instanceof Error ? err.message : "Receipt is available after successful payment.");
    } finally {
      setActionLoading(false);
    }
  };

  const showDocuments = () => {
    if (!item) return;
    setDocumentResult({
      type: "documents",
      title: "Required Documents",
      documents: requiredDocumentSlots(item),
      operatorDocuments: operatorIssuedDocuments(item),
      rows: [{ label: "Booking code", value: item.bookingCode || "Not recorded" }]
    });
  };

  const uploadRequiredDocument = async (slot: RequiredDocumentSlot) => {
    if (!token) {
      Alert.alert("Documents", "Please sign in to upload documents.");
      return;
    }
    setUploadingDocument(slot.type);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: slot.accept || PDF_FILE_TYPES
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.uri) throw new Error("Could not read the selected file.");
      const mimeType = asset.mimeType || "application/octet-stream";
      if (slot.accept?.length && !slot.accept.includes(mimeType)) {
        throw new Error(`This slot accepts ${slot.acceptLabel || "the specified file type"}.`);
      }
      const uploaded = await uploadTravellerDocumentFile(token, {
        uri: asset.uri,
        name: asset.name || `${slot.type.toLowerCase()}.pdf`,
        type: mimeType,
        file: (asset as any).file || null
      });
      const url = uploaded.secure_url || uploaded.url;
      if (!url) throw new Error("Upload completed without a document URL.");
      await saveTravellerDocument(token, {
        type: slot.type,
        url,
        metadata: {
          bookingId,
          bookingCode: item?.bookingCode || null,
          label: slot.label,
          source: "mobile_tour_package",
          uploadedAt: new Date().toISOString()
        }
      });
      await saveTourBookingDocument(token, bookingKey, {
        type: slot.type,
        label: slot.label,
        url,
        fileName: asset.name || slot.label
      });
      setDocumentUploads((current) => ({
        ...current,
        [slot.type]: { name: asset.name || slot.label, url, status: "Uploaded" }
      }));
      setMessage(`${slot.label} uploaded for operator review.`);
    } catch (err) {
      setDocumentUploads((current) => ({
        ...current,
        [slot.type]: { name: slot.label, status: "Failed" }
      }));
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload this document.");
    } finally {
      setUploadingDocument(null);
    }
  };

  const continuePayment = () => {
    const accessToken = String(item?.paymentResume?.paymentAccessToken || "");
    if (!accessToken) {
      Alert.alert("Payment", "Payment link is not active. Please request support from this booking.");
      return;
    }
    navigation.navigate("TourBookingPayment", { bookingId, accessToken });
  };

  const startMeetup = async () => {
    if (!token) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await startTourPickupCheckIn(token, bookingKey);
      setMeetupCode(String(res.bookingCodeSuffix || item?.bookingCodeSuffix || ""));
      setMessage(res.message || "Meetup check-in started.");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not start meetup check-in.");
    } finally {
      setActionLoading(false);
    }
  };

  const confirmMeetup = async () => {
    if (!token) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await validateTourPickup(token, bookingKey, meetupCode || item?.bookingCodeSuffix);
      if (res.bookingCodeSuffix) setMeetupCode(String(res.bookingCodeSuffix));
      if (res.pickupValidationCustomer || res.pickupTimeline) {
        setItem((current) => {
          if (!current) return current;
          return {
            ...current,
            metadata: {
              ...(current.metadata || {}),
              ...(res.pickupValidationCustomer ? { pickupValidationCustomer: res.pickupValidationCustomer } : {})
            },
            ...(res.pickupValidation ? { pickupValidation: res.pickupValidation } : {}),
            ...(res.pickupTimeline ? { pickupTimeline: res.pickupTimeline } : {})
          };
        });
      }
      setMessage(res.message || "Meetup confirmation recorded.");
      setMeetupSheetOpen(false);
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not confirm meetup.");
    } finally {
      setActionLoading(false);
    }
  };

  const openMeetupGuide = () => {
    setMeetupCode(String(item?.bookingCodeSuffix || ""));
    setMeetupSheetOpen(true);
  };

  const shareTimeline = async () => {
    if (!token) return;
    setActionLoading(true);
    setMessage(null);
    try {
      const res = await createTourTimelineInvite(token, bookingKey);
      const url = String(res.inviteUrl || res.invitePath || "");
      if (url) {
        setCreatedTimelineUrl(url);
        setItem((current) => current ? {
          ...current,
          timelineShare: {
            ...(current.timelineShare || {}),
            hasInvite: true,
            inviteUrl: url,
            invitePath: res.invitePath || current.timelineShare?.invitePath || null,
            expiresAt: String((res.invite as any)?.expiresAt || current.timelineShare?.expiresAt || "") || null
          }
        } : current);
        setMessage(res.reused ? "Timeline invite shared again." : "Timeline invite created.");
      } else {
        setMessage("Timeline invite is ready.");
      }
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Timeline invite is available after meetup validation.");
    } finally {
      setActionLoading(false);
    }
  };

  const copyTimelineLink = async (url: string) => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    setTimelineCopied(true);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => {
      setTimelineCopied(false);
      copyResetTimer.current = null;
    }, 4000);
    setMessage("Timeline link copied.");
  };

  const shareTimelineLink = async (url: string) => {
    if (!url) {
      await shareTimeline();
      return;
    }
    const message = `Join our NoLSAF tour timeline: ${url}`;
    const whatsappUrl = `whatsapp://send?text=${encodeURIComponent(message)}`;
    const canOpenWhatsapp = await Linking.canOpenURL(whatsappUrl);
    if (canOpenWhatsapp) {
      await Linking.openURL(whatsappUrl);
      return;
    }
    await Share.share({ message });
  };

  const submitAction = async () => {
    if (!token || !actionMode) return;
    const title = actionTitle.trim();
    const body = actionBody.trim();
    if (!title || !body) {
      setMessage("Add a title and short details first.");
      return;
    }
    if (wordCount(body) > 30) {
      setMessage("Keep details within 30 words.");
      return;
    }
    setActionLoading(true);
    setMessage(null);
    try {
      if (actionMode === "change") {
        await submitTourChangeRequest(token, bookingKey, { title, message: body });
        setMessage("Change request sent.");
      } else {
        await submitTourIssueReport(token, bookingKey, { title, message: body });
        setMessage("Issue report sent.");
      }
      setActionMode(null);
      setActionTitle("");
      setActionBody("");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not send this request.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <SafeScreen>
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="bodySmall" tone="muted">
            Loading tour package...
          </AppText>
        </View>
      </SafeScreen>
    );
  }

  if (error || !item) {
    return (
      <SafeScreen>
        <BackButton onPress={back} />
        <View style={styles.stateWrap}>
          <StateView title="Could not load tour" message={error || "Tour package not found."} actionLabel="Try again" onAction={load} />
        </View>
      </SafeScreen>
    );
  }

  const meta = statusMeta(item);
  const itinerary = normalizedTimeline(item);
  const detailedTimeline = normalizeDetailedTimeline(item);
  const timelineDays = detailedTimeline.length ? detailedTimeline : smokeTimelineDays();
  const isTimelineSmoke = detailedTimeline.length === 0;
  const pkg = item.packageSnapshot || {};
  const md = item.metadata || {};
  const inclusions = packageList(pkg as Record<string, any>, ["inclusions", "included", "includes", "includedItems", "includedInPackage"]);
  const exclusions = packageList(pkg as Record<string, any>, ["exclusions", "excluded", "excludes", "notIncluded", "excludedItems", "excludedFromPackage"]);
  const meetingPoints = [
    ...packageList(pkg as Record<string, any>, ["meetingPoints", "meetingPoint", "departurePoints", "departurePoint", "pickupPoints", "pickupPoint", "startPoints", "startPoint"]),
    ...packageList(md as Record<string, any>, ["selectedMeetingPoint", "meetingPoint", "pickupPoint", "selectedAirport"])
  ];
  const meetingPoint = selectedMeetingPoint(item, meetingPoints);
  const packageDays = packageDayFacts(item, timelineDays);
  const changeRequests = Array.isArray((md as any).changeRequests) ? (md as any).changeRequests : [];
  const issueReports = Array.isArray((md as any).issueReports) ? (md as any).issueReports : [];
  const bucket = String(item.dashboardBucket || "").toUpperCase();
  const isCompleted = bucket === "COMPLETED";
  const paid = isCompleted || bucket === "PAID_PACKAGES" || bucket === "ACTIVE_TIMELINE" || String(item.paymentStatus || "").toUpperCase() === "PAID" || Boolean(item.paidAt);
  const meetupValidatedAt = pickupValidatedAt(item);
  const meetupConfirmed = Boolean(meetupValidatedAt);
  const meetupProofCode = String(item.bookingCodeSuffix || item.bookingCode || bookingId).toUpperCase();
  const timelineUnlocked = bucket === "ACTIVE_TIMELINE" || isCompleted;
  const timelineShare = timelineShareStatus(item);
  const timelineLink = createdTimelineUrl || timelineShare.url;
  const amount = Number(item.grossAmount || 0);
  const startMeetupPulseStyle = {
    opacity: meetupPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.72] }),
    transform: [
      {
        scale: meetupPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] })
      }
    ]
  };
  const recommendTour = () => {
    const title = item.title || "this tour package";
    const destination = item.destination ? ` in ${item.destination}` : "";
    Share.share({
      message: `I completed ${title}${destination} with ${operatorName(item)} on NoLSAF. I recommend checking their approved tour packages.`
    }).catch(() => undefined);
  };

  return (
    <SafeScreen>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <BackButton onPress={back} />
          <View style={styles.flex}>
            <AppText variant="title" weight="extraBold">
              Tour package
            </AppText>
            <AppText variant="bodySmall" tone="muted">
              Manage booking, documents, payment, and timeline.
            </AppText>
          </View>
        </View>

        {paid && !isCompleted ? <ShareTripButton serviceKind="TOUR" serviceId={item.id} /> : null}

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <MapPin color={colors.white} size={24} />
            </View>
            <View style={styles.flex}>
              <AppText variant="title" weight="extraBold" tone="inverse" numberOfLines={2}>
                {item.title || "Tour package"}
              </AppText>
              <AppText variant="bodySmall" style={styles.heroSub} numberOfLines={1}>
                {operatorName(item)}
              </AppText>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.heroStats}>
            <HeroStat label="Code" value={item.bookingCode || "Pending"} />
            <HeroStat label="Status" value={meta.label} />
            <HeroStat label="Travel" value={fmtDate(item.startDate)} />
          </ScrollView>
        </View>

        <View style={styles.statusStrip}>
          <View style={[styles.statusIcon, { backgroundColor: meta.tint }]}>
            {paid ? <CheckCircle2 color={meta.color} size={20} /> : <Clock3 color={meta.color} size={20} />}
          </View>
          <View style={styles.flex}>
            <AppText variant="bodySmall" weight="bold">
              {meta.label}
            </AppText>
            <AppText variant="caption" tone="muted">
              {statusDetailText(item, paid, isCompleted)}
            </AppText>
          </View>
          {amount > 0 ? <AmountText amount={amount} currency={item.currency || "USD"} variant="titleSm" weight="extraBold" tone="primary" /> : null}
        </View>

        {!paid ? (
          <AppButton title="Continue payment" onPress={continuePayment} icon={<CreditCard color={colors.white} size={18} />} />
        ) : null}

        <View style={styles.grid}>
          <InfoTile Icon={MapPin} label="Destination" value={item.destination || "Not set"} />
          <InfoTile Icon={Users} label="Travellers" value={String(item.travelerCount || 1)} />
          <InfoTile Icon={CalendarDays} label="Start date" value={fmtDate(item.startDate)} />
          <InfoTile Icon={Flag} label="Nationality" value={item.nationality || "Not set"} />
        </View>

        <Section title="Package Documents" Icon={TicketCheck}>
          <View style={styles.actionGrid}>
            <ToolButton Icon={TicketCheck} title="Voucher" subtitle="Trip proof" onPress={showVoucher} />
            <ToolButton Icon={ReceiptText} title="Receipt" subtitle="After payment" onPress={showReceipt} />
            <ToolButton
              Icon={FileText}
              title="Documents"
              subtitle="Required files"
              onPress={showDocuments}
            />
            <ToolButton
              Icon={Users}
              title="Manage group"
              subtitle="Add travellers"
              onPress={() => navigation.navigate("TravellerGroups", { tourBookingId: bookingId, tourBookingRef: route.params.ref || item.tourReference, tourBookingTitle: item.title || undefined })}
            />
          </View>
        </Section>

        <Section title="Meetup And Timeline" Icon={ShieldCheck}>
          <View style={styles.timelineCard}>
            <View style={styles.timelineHeader}>
              <View style={styles.timelineIcon}>
                <ShieldCheck color={colors.primary} size={18} />
              </View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold">
                  Meetup validation
                </AppText>
                <AppText variant="caption" tone="muted">
                  {isCompleted ? "Validation confirmed before package completion." : "Validation unlocks the shared tour timeline."}
                </AppText>
              </View>
            </View>
            {isCompleted ? (
              <>
                <View style={styles.timelineSummaryCard}>
                  <View style={styles.timelineSummaryTop}>
                    <View style={styles.validationCheckIcon}>
                      <CheckCircle2 color={colors.success} size={20} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodySmall" weight="extraBold" tone="success">
                        Meetup validated
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {meetupValidatedAt || "Validation time recorded before completion."}
                      </AppText>
                    </View>
                    <View style={[styles.linkStatusPill, timelineShare.hasInvite && styles.linkStatusActive]}>
                      <AppText variant="caption" weight="extraBold" tone={timelineShare.hasInvite ? "success" : "soft"}>
                        {timelineShare.hasInvite ? "Link active" : "No link"}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.timelineProgressTrack}>
                    <View style={[styles.timelineProgressFill, { width: `${Math.min(100, Math.max(0, (timelineShare.joined / Math.max(1, timelineShare.total)) * 100))}%` }]} />
                  </View>

                  <View style={styles.timelineSummaryStats}>
                    <View style={styles.timelineSummaryStat}>
                      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                        Joined
                      </AppText>
                      <AppText variant="bodySmall" weight="extraBold">
                        {timelineShare.joined}/{timelineShare.total}
                      </AppText>
                    </View>
                    <View style={styles.timelineSummaryStat}>
                      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                        Waiting
                      </AppText>
                      <AppText variant="bodySmall" weight="extraBold">
                        {timelineShare.remaining}
                      </AppText>
                    </View>
                    <View style={styles.timelineSummaryStatWide}>
                      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                        Shared link
                      </AppText>
                      <AppText variant="bodySmall" weight="extraBold" tone={timelineShare.hasInvite ? "success" : "muted"} numberOfLines={1}>
                        {timelineShare.hasInvite ? "Ready for travellers" : "Not created"}
                      </AppText>
                    </View>
                  </View>
                </View>
                {timelineShare.expiresAt ? (
                  <View style={styles.linkExpiryRow}>
                    <Clock3 color={colors.softText} size={14} />
                    <AppText variant="caption" tone="muted" style={styles.flex}>
                      Link expires {timelineShare.expiresAt}
                    </AppText>
                  </View>
                ) : null}
                {timelineLink ? (
                  <TimelineLinkCard
                    url={timelineLink}
                    active={timelineShare.hasInvite || Boolean(createdTimelineUrl)}
                    joined={timelineShare.joined}
                    total={timelineShare.total}
                    waiting={timelineShare.remaining}
                    loading={actionLoading}
                    copied={timelineCopied}
                    onCreate={shareTimeline}
                    onCopy={copyTimelineLink}
                    onShare={shareTimelineLink}
                  />
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.timelineLandingCard}>
                  <View style={styles.timelineLandingTop}>
                    <View style={[styles.timelineSignalIcon, timelineUnlocked && styles.timelineSignalIconActive]}>
                      <ShieldCheck color={timelineUnlocked ? colors.success : colors.primary} size={21} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodySmall" weight="extraBold">
                        {timelineUnlocked ? "Tracking active" : meetupConfirmed ? "Meetup confirmation recorded" : "Tracking locked"}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        {timelineUnlocked
                          ? "Ratings, activity proof, and traveller updates are live."
                          : meetupConfirmed
                            ? "Waiting for operator validation to unlock the shared timeline."
                            : "Validate meetup to open ratings, activity proof, and shared traveller updates."}
                      </AppText>
                    </View>
                    <View style={[styles.timelineStatePill, (timelineUnlocked || meetupConfirmed) && styles.timelineStatePillActive]}>
                      <AppText variant="caption" weight="extraBold" tone={timelineUnlocked || meetupConfirmed ? "success" : "primary"}>
                        {timelineUnlocked ? "Active" : meetupConfirmed ? "Recorded" : "Validate"}
                      </AppText>
                    </View>
                  </View>

                  <View style={styles.timelineLandingNotice}>
                    <Star color={colors.primary} size={16} />
                    <AppText variant="caption" weight="bold" tone="primary" style={styles.flex}>
                      This is the signal NoLSAF uses to start service quality tracking.
                    </AppText>
                  </View>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timelineLandingSteps}>
                    <TimelineStep Icon={ShieldCheck} title="Validate" text="Confirm the first meetup." active={Boolean(meetupValidatedAt)} />
                    <TimelineStep Icon={Share2} title="Share" text={timelineShare.hasInvite ? "Link is active." : "Invite travellers."} active={timelineShare.hasInvite} />
                    <TimelineStep Icon={Star} title="Track" text="Rate each activity." active={timelineUnlocked} />
                  </ScrollView>

                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.timelineMetricsRail}>
                    <View style={styles.timelineSummaryStat}>
                      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                        Team
                      </AppText>
                      <AppText variant="bodySmall" weight="extraBold">
                        {timelineShare.joined}/{timelineShare.total}
                      </AppText>
                    </View>
                    <View style={styles.timelineSummaryStat}>
                      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                        Link
                      </AppText>
                      <AppText variant="bodySmall" weight="extraBold" tone={timelineShare.hasInvite ? "success" : "muted"}>
                        {timelineShare.hasInvite ? "Active" : "None"}
                      </AppText>
                    </View>
                    <View style={styles.timelineSummaryStat}>
                      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                        Waiting
                      </AppText>
                      <AppText variant="bodySmall" weight="extraBold">
                        {timelineShare.remaining}
                      </AppText>
                    </View>
                  </ScrollView>
                </View>

                {meetupConfirmed ? (
                  <View style={styles.meetupRecordedCard}>
                    <View style={styles.meetupRecordedTop}>
                      <View style={styles.meetupRecordedIcon}>
                        <CheckCircle2 color={colors.success} size={18} />
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodySmall" weight="extraBold" tone="success">
                          Traveller meetup confirmed
                        </AppText>
                        <AppText variant="caption" tone="muted">
                          I confirmed I met {operatorName(item)} at {meetupValidatedAt}.
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.meetupSignatureRow}>
                      <View style={styles.meetupSignatureMeta}>
                        <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
                          Verified proof
                        </AppText>
                        <AppText variant="bodySmall" weight="mono" numberOfLines={1}>
                          {meetupProofCode}
                        </AppText>
                        <AppText variant="caption" tone="muted" numberOfLines={1}>
                          Digital signature stored
                        </AppText>
                      </View>
                      <MeetupSignatureBarcode seed={`${item.bookingCode || bookingId}|${meetupValidatedAt || ""}`} />
                    </View>
                  </View>
                ) : (
                  <View style={styles.meetupActionRow}>
                    <Animated.View style={[styles.meetupActionSlot, styles.meetupPulseSlot, startMeetupPulseStyle]}>
                      <AppButton title="Start meetup" variant="secondary" loading={actionLoading} onPress={openMeetupGuide} style={styles.meetupActionButton} />
                    </Animated.View>
                  </View>
                )}
                <TimelineLinkCard
                  url={timelineLink}
                  active={timelineShare.hasInvite || Boolean(createdTimelineUrl)}
                  joined={timelineShare.joined}
                  total={timelineShare.total}
                  waiting={timelineShare.remaining}
                  loading={actionLoading}
                  copied={timelineCopied}
                  onCreate={shareTimeline}
                  onCopy={copyTimelineLink}
                  onShare={shareTimelineLink}
                />
              </>
            )}
          </View>
        </Section>

        {timelineUnlocked && (itinerary.length || isTimelineSmoke) ? (
          <Section title="Trip Timetable" Icon={Clock3}>
            <FinishedTimetable days={timelineDays} smoke={isTimelineSmoke} />
          </Section>
        ) : null}

        {isCompleted ? (
          <Section title="Completed Experience" Icon={CheckCircle2}>
            <CompletedExperience item={item} onRecommend={recommendTour} />
          </Section>
        ) : null}

        {(meetingPoint || packageDays.length || inclusions.length || exclusions.length) ? (
          <Section title="Package Setup" Icon={Star}>
            <PackageFacts meetingPoint={meetingPoint} days={packageDays} included={inclusions} excluded={exclusions} />
          </Section>
        ) : null}

        <Section title="Support Requests" Icon={Headset}>
          <View style={styles.actionGrid}>
            <ToolButton Icon={MessageSquareText} title="Request change" subtitle="Date, pickup, itinerary" onPress={() => setActionMode("change")} />
            <ToolButton Icon={AlertTriangle} title="Report issue" subtitle="Service or payment" danger onPress={() => setActionMode("issue")} />
          </View>
          {actionMode ? (
            <View style={styles.form}>
              <AppInput label={actionMode === "change" ? "Change title" : "Issue title"} value={actionTitle} onChangeText={setActionTitle} placeholder="Short title" />
              <AppInput
                label="Details"
                value={actionBody}
                onChangeText={setActionBody}
                placeholder="Max 30 words"
                multiline
                style={styles.textArea}
              />
              <View style={styles.formFooter}>
                <AppText variant="caption" tone={wordCount(actionBody) > 30 ? "danger" : "muted"}>
                  {wordCount(actionBody)}/30 words
                </AppText>
                <AppButton title="Send" loading={actionLoading} onPress={submitAction} icon={<Send color={colors.white} size={16} />} style={styles.sendButton} />
              </View>
            </View>
          ) : null}
          <AuditFlow changes={changeRequests} issues={issueReports} />
        </Section>

        {message ? (
          <View style={styles.messageBox}>
            <AppText variant="bodySmall" weight="bold" tone="primary">
              {message}
            </AppText>
          </View>
        ) : null}
      </ScrollView>
      <DocumentResultSheet
        result={documentResult}
        uploads={documentUploads}
        uploadingDocument={uploadingDocument}
        onUploadDocument={uploadRequiredDocument}
        onClose={() => setDocumentResult(null)}
      />
      <MeetupValidationSheet
        visible={meetupSheetOpen}
        code={meetupCode || item?.bookingCodeSuffix || ""}
        loading={actionLoading}
        onStart={startMeetup}
        onConfirm={confirmMeetup}
        onClose={() => setMeetupSheetOpen(false)}
      />
    </SafeScreen>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.backButton}>
      <ArrowLeft color={colors.ink} size={22} />
    </Pressable>
  );
}

function HeroStat({ label, value }: { label: string; value: string }) {
  const wide = label === "Code" || label === "Travel";
  return (
    <View style={[styles.heroStat, wide && styles.heroStatWide]}>
      <AppText variant="caption" weight="bold" style={styles.heroStatLabel}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="extraBold" tone="inverse">
        {value}
      </AppText>
    </View>
  );
}

function Section({ title, Icon, children }: { title: string; Icon: typeof CalendarDays; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionTitle}>
        <View style={styles.sectionIcon}>
          <Icon color={colors.primary} size={16} />
        </View>
        <AppText variant="bodySmall" weight="extraBold">
          {title}
        </AppText>
      </View>
      {children}
    </View>
  );
}

function InfoTile({ Icon, label, value }: { Icon: typeof CalendarDays; label: string; value: string }) {
  return (
    <View style={styles.infoTile}>
      <View style={styles.infoIcon}>
        <Icon color={colors.primary} size={15} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
          {label}
        </AppText>
        <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
          {value}
        </AppText>
      </View>
    </View>
  );
}

function ToolButton({
  Icon,
  title,
  subtitle,
  danger,
  onPress
}: {
  Icon: typeof CalendarDays;
  title: string;
  subtitle: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.toolButton, danger && styles.toolDanger, pressed && styles.pressed]}>
      <View style={[styles.toolIcon, danger && styles.toolIconDanger]}>
        <Icon color={danger ? colors.danger : colors.primary} size={18} />
      </View>
      <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={2}>
        {subtitle}
      </AppText>
      <View style={[styles.toolCue, danger && styles.toolCueDanger]}>
        <AppText variant="caption" weight="extraBold" tone={danger ? "danger" : "primary"}>
          Open
        </AppText>
        <ChevronRight color={danger ? colors.danger : colors.primary} size={13} />
      </View>
    </Pressable>
  );
}

function TimelineStep({
  Icon,
  title,
  text,
  active
}: {
  Icon: typeof ShieldCheck;
  title: string;
  text: string;
  active?: boolean;
}) {
  return (
    <View style={[styles.timelineStep, active && styles.timelineStepActive]}>
      <View style={[styles.timelineStepIcon, active && styles.timelineStepIconActive]}>
        <Icon color={active ? colors.success : colors.primary} size={15} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" weight="extraBold" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {text}
        </AppText>
      </View>
    </View>
  );
}

function TimelineLinkCard({
  url,
  active,
  joined,
  total,
  waiting,
  loading,
  copied,
  onCreate,
  onCopy,
  onShare
}: {
  url: string;
  active: boolean;
  joined: number;
  total: number;
  waiting: number;
  loading: boolean;
  copied: boolean;
  onCreate: () => void;
  onCopy: (url: string) => void;
  onShare: (url: string) => void;
}) {
  if (!url) {
    return (
      <AppButton
        title="Create timeline link"
        variant="ghost"
        loading={loading}
        onPress={onCreate}
        icon={<Share2 color={colors.primary} size={17} />}
      />
    );
  }
  return (
    <View style={styles.timelineLinkCard}>
      <View style={styles.timelineLinkTop}>
        <View style={styles.timelineLinkIcon}>
          <Share2 color={colors.primary} size={18} />
        </View>
        <View style={styles.flex}>
          <View style={styles.timelineLinkTitleRow}>
            <AppText variant="bodySmall" weight="extraBold">
              Timeline link
            </AppText>
            <View style={[styles.linkStatusPill, active && styles.linkStatusActive]}>
              <AppText variant="caption" weight="extraBold" tone={active ? "success" : "soft"}>
                {active ? "Active" : "Ready"}
              </AppText>
            </View>
          </View>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {url}
          </AppText>
          <AppText variant="caption" tone="muted">
            Copy for any platform, or share through WhatsApp.
          </AppText>
        </View>
      </View>
      <View style={styles.timelineLinkStats}>
        <View style={styles.timelineLinkStat}>
          <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
            Joined
          </AppText>
          <AppText variant="bodySmall" weight="extraBold">
            {joined}/{total}
          </AppText>
        </View>
        <View style={styles.timelineLinkStat}>
          <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
            Waiting
          </AppText>
          <AppText variant="bodySmall" weight="extraBold">
            {waiting}
          </AppText>
        </View>
      </View>
      <View style={styles.timelineLinkActions}>
        <AppButton
          title={copied ? "Copied" : "Copy"}
          variant="secondary"
          onPress={() => onCopy(url)}
          icon={copied ? <CheckCircle2 color={colors.primary} size={16} /> : <Copy color={colors.primary} size={16} />}
          style={styles.flex}
        />
        <AppButton title="WhatsApp" onPress={() => onShare(url)} icon={<Share2 color={colors.white} size={16} />} style={styles.flex} />
      </View>
    </View>
  );
}

function MeetupValidationSheet({
  visible,
  code,
  loading,
  onStart,
  onConfirm,
  onClose
}: {
  visible: boolean;
  code: string;
  loading?: boolean;
  onStart: () => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  // Bottom sheets clear the phone navigation bar (edge-to-edge Android).
  const bottomInset = useSheetBottomInset(spacing[6]);
  return (
    <SheetModal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.meetupSheet, { paddingBottom: bottomInset }]}>
          <View style={styles.resultHandle} />
          <View style={styles.meetupSheetHero}>
            <View style={styles.meetupSheetIcon}>
              <ShieldCheck color={colors.primary} size={24} />
            </View>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="extraBold">
                Meetup validation
              </AppText>
              <AppText variant="bodySmall" tone="muted">
                NoLSAF acts as your service representative once the first meetup is confirmed.
              </AppText>
            </View>
          </View>

          <View style={styles.meetupReasonBox}>
            <AppText variant="bodySmall" weight="extraBold" tone="primary">
              Why we insist on this
            </AppText>
            <AppText variant="caption" tone="muted">
              Validation tells NoLSAF that the paid package has started. Web or app confirmation updates the same booking record, while traveller and operator validation remain separate proof signals.
            </AppText>
          </View>

          <View style={styles.meetupCodeBox}>
            <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
              Validation code
            </AppText>
            <View style={styles.meetupCodeField}>
              <AppText variant="titleSm" weight="mono" tone={code ? "primary" : "muted"} numberOfLines={1}>
                {code || "Start meetup to generate code"}
              </AppText>
            </View>
          </View>

          <View style={styles.meetupSheetActions}>
            <AppButton title={code ? "Restart meetup" : "Start meetup"} variant="secondary" loading={loading} onPress={onStart} style={styles.flex} />
            <AppButton title="Confirm meetup" loading={loading} onPress={onConfirm} style={styles.flex} />
          </View>
        </View>
      </View>
    </SheetModal>
  );
}

function DocumentResultSheet({
  result,
  uploads,
  uploadingDocument,
  onUploadDocument,
  onClose
}: {
  result: DocumentResult | null;
  uploads: UploadedDocumentState;
  uploadingDocument: string | null;
  onUploadDocument: (slot: RequiredDocumentSlot) => void;
  onClose: () => void;
}) {
  // Bottom sheets clear the phone navigation bar (edge-to-edge Android).
  const bottomInset = useSheetBottomInset(spacing[6]);
  return (
    <SheetModal visible={Boolean(result)} animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <Pressable style={styles.modalBackdrop} onPress={onClose} />
        <View style={[styles.resultSheet, { paddingBottom: bottomInset }]}>
          <View style={styles.resultHandle} />
          <View style={styles.resultHeader}>
            <View style={styles.resultIcon}>
              <FileText color={colors.primary} size={20} />
            </View>
            <View style={styles.flex}>
              <AppText variant="titleSm" weight="extraBold">
                {result?.title || "Document"}
              </AppText>
              <AppText variant="caption" tone="muted">
                Document status and next steps.
              </AppText>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.resultScroll}>
            {result?.type === "documents" ? (
              <DocumentsProof result={result} uploads={uploads} uploadingDocument={uploadingDocument} onUpload={onUploadDocument} />
            ) : (
              null
            )}
          </ScrollView>
          <AppButton title="Done" onPress={onClose} />
        </View>
      </View>
    </SheetModal>
  );
}

function DocumentsProof({
  result,
  uploads,
  uploadingDocument,
  onUpload
}: {
  result: Extract<DocumentResult, { type: "documents" }>;
  uploads: UploadedDocumentState;
  uploadingDocument: string | null;
  onUpload: (slot: RequiredDocumentSlot) => void;
}) {
  return (
    <View style={styles.documentsProof}>
      <View style={styles.documentsIntro}>
        <AppText variant="bodySmall" weight="bold">
          Send each required file to the operator.
        </AppText>
        <AppText variant="caption" tone="muted">
          Uploads are saved per document type, so passport, visa, and permits stay separated.
        </AppText>
      </View>
      <View style={styles.operatorDocumentsBox}>
        <View style={styles.documentTitleRow}>
          <View style={styles.documentUploadIcon}>
            <ShieldCheck color={colors.primary} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodySmall" weight="extraBold">
              Operator Issued Documents
            </AppText>
            <AppText variant="caption" tone="muted">
              Completed entry permits and returned files appear here.
            </AppText>
          </View>
        </View>
        {result.operatorDocuments.length ? (
          result.operatorDocuments.map((doc) => (
            <Pressable
              key={doc.id}
              accessibilityRole="button"
              onPress={() => Linking.openURL(doc.url).catch(() => Alert.alert("Document", "Could not open this document."))}
              style={({ pressed }) => [styles.operatorDocumentCard, pressed && styles.pressed]}
            >
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                  {doc.label}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {doc.uploadedAt ? fmtDateTime(doc.uploadedAt) : "Ready from operator"}
                </AppText>
              </View>
              <View style={styles.liveChip}>
                <AppText variant="caption" weight="extraBold" tone="success">
                  {doc.status || "Ready"}
                </AppText>
              </View>
            </Pressable>
          ))
        ) : (
          <View style={styles.operatorDocumentEmpty}>
            <AppText variant="caption" tone="muted">
              No completed entry permit yet. Your operator can upload it after processing.
            </AppText>
          </View>
        )}
      </View>
      {result.documents.map((slot) => {
        const upload = uploads[slot.type];
        const busy = uploadingDocument === slot.type;
        const uploaded = upload?.status === "Uploaded";
        const failed = upload?.status === "Failed";
        return (
          <View key={slot.type} style={[styles.documentUploadCard, uploaded && styles.documentUploadDone, failed && styles.documentUploadFailed]}>
            <View style={styles.documentUploadTop}>
              <View style={[styles.documentUploadIcon, uploaded && styles.documentUploadIconDone]}>
                {uploaded ? <CheckCircle2 color={colors.success} size={18} /> : <FileText color={failed ? colors.danger : colors.primary} size={18} />}
              </View>
              <View style={styles.flex}>
                <View style={styles.documentTitleRow}>
                  <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
                    {slot.label}
                  </AppText>
                  {slot.required ? (
                    <View style={styles.requiredPill}>
                      <AppText variant="caption" weight="extraBold" tone="primary">
                        Required
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <AppText variant="caption" tone="muted" numberOfLines={2}>
                  {slot.description}
                </AppText>
                <View style={styles.fileTypePill}>
                  <AppText variant="caption" weight="extraBold" tone="soft">
                    {slot.acceptLabel || "PDF only"}
                  </AppText>
                </View>
              </View>
            </View>
            {upload?.name ? (
              <View style={styles.uploadedFileRow}>
                <AppText variant="caption" weight="bold" tone={uploaded ? "success" : failed ? "danger" : "soft"} numberOfLines={1}>
                  {upload.status}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.flex}>
                  {upload.name}
                </AppText>
              </View>
            ) : null}
            <AppButton
              title={uploaded ? "Replace file" : "Upload file"}
              variant={uploaded ? "secondary" : "primary"}
              loading={busy}
              onPress={() => onUpload(slot)}
              icon={<UploadCloud color={uploaded ? colors.primary : colors.white} size={16} />}
            />
          </View>
        );
      })}
      <View style={styles.resultRows}>
        {result.rows.map((row) => (
          <View key={row.label} style={styles.documentCodeRow}>
            <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
              {row.label}
            </AppText>
            <AppText variant="caption" weight="mono" numberOfLines={2}>
              {row.value}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function MeetupSignatureBarcode({ seed }: { seed: string }) {
  const bars = Array.from({ length: 42 }).map((_, index) => {
    const code = seed.charCodeAt(index % Math.max(seed.length, 1)) || 41;
    return {
      width: 1 + ((code + index * 2) % 4),
      dark: (code + index) % 5 !== 0
    };
  });
  return (
    <View style={styles.signatureBarcodeFrame}>
      <View style={styles.signatureBarcode}>
        {bars.map((bar, index) => (
          <View
            key={`${index}-${bar.width}`}
            style={[
              styles.signatureBarcodeBar,
              {
                width: bar.width,
                opacity: bar.dark ? 1 : 0.2
              }
            ]}
          />
        ))}
      </View>
    </View>
  );
}

function CompletedExperience({ item, onRecommend }: { item: CustomerTourBookingDetail; onRecommend: () => void }) {
  const journey = buildRatingJourney(item);
  const ratingCount = journey.reduce((sum, point) => sum + point.count, 0) || Number(item.timelineRatingSummary?.totalRatings || 0);
  const ratingAverage = journey.length
    ? journey.reduce((sum, point) => sum + point.rating, 0) / journey.length
    : Number(item.timelineRatingSummary?.averageRating || 0);
  const completion = item.timelineCompletion || {};
  const totalEvents = Number(completion.totalEvents || 0);
  const ratedEvents = Number(completion.ratedEvents || 0);
  const meetupValidated = Boolean(
    item.pickupValidation?.validated ||
    item.pickupValidation?.validatedAt ||
    item.metadata?.pickupValidationOperator ||
    item.pickupTimeline?.validatedAt
  );
  const highest = journey.reduce<RatingJourneyPoint | null>((best, point) => (!best || point.rating > best.rating ? point : best), null);
  const lowest = journey.reduce<RatingJourneyPoint | null>((low, point) => (!low || point.rating < low.rating ? point : low), null);
  const topFeeling = highest?.ratingLabel || "Waiting";

  return (
    <View style={styles.completedExperience}>
      <View style={styles.ratingJourney}>
        <View style={styles.graphHeader}>
          <View style={styles.flex}>
            <AppText variant="caption" weight="bold" tone="primary" style={styles.infoLabel}>
              Rating journey
            </AppText>
            <AppText variant="bodySmall" tone="muted">
              Event ratings across the tour timetable.
            </AppText>
          </View>
        </View>

        <View style={styles.ratingSummaryGrid}>
          <RatingStat label="Rated" value={String(ratingCount)} />
          <RatingStat label="Average" value={ratingCount ? `${ratingAverage.toFixed(1)}/5` : "Waiting"} />
          <RatingStat label="Top feeling" value={topFeeling} />
          <RatingStat label="Team coverage" value={totalEvents ? `${ratedEvents}/${totalEvents}` : meetupValidated ? "Validated" : "Pending"} />
        </View>

        {journey.length ? (
          <>
            <RatingJourneyChart points={journey} />
            <View style={styles.ratingHighlights}>
              <View style={styles.highestBox}>
                <AppText variant="caption" weight="bold" tone="success" style={styles.infoLabel}>
                  Highest rated
                </AppText>
                <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
                  {highest?.title || "Not available"}
                </AppText>
                <AppText variant="caption" tone="success">
                  {highest ? `${highest.rating.toFixed(1)}/5 - ${highest.ratingLabel}` : "No rating yet"}
                </AppText>
              </View>
              <View style={styles.lowestBox}>
                <AppText variant="caption" weight="bold" tone="warning" style={styles.infoLabel}>
                  Lowest rated
                </AppText>
                <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
                  {lowest?.title || "Not available"}
                </AppText>
                <AppText variant="caption" tone="warning">
                  {lowest ? `${lowest.rating.toFixed(1)}/5 - ${lowest.ratingLabel}` : "No rating yet"}
                </AppText>
              </View>
            </View>
          </>
        ) : (
          <View style={styles.ratingEmpty}>
            <Star color={colors.softText} size={18} />
            <AppText variant="bodySmall" weight="extraBold">
              Ratings not synced yet
            </AppText>
            <AppText variant="caption" tone="muted">
              The journey appears after timeline events receive ratings.
            </AppText>
          </View>
        )}
      </View>

      <Pressable accessibilityRole="button" onPress={onRecommend} style={({ pressed }) => [styles.recommendTourCard, pressed && styles.pressed]}>
        <View style={styles.recommendTourIcon}>
          <Share2 color={colors.primary} size={18} />
        </View>
        <View style={styles.flex}>
          <AppText variant="bodySmall" weight="extraBold">
            Recommend This Tour
          </AppText>
          <AppText variant="caption" tone="muted">
            Share this completed experience with another traveller.
          </AppText>
        </View>
        <ChevronRight color={colors.primary} size={18} />
      </Pressable>
    </View>
  );
}

function RatingStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.ratingStat}>
      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

function FinishedTimetable({ days, smoke }: { days: TimelineDay[]; smoke?: boolean }) {
  if (!days.length) {
    return (
      <View style={styles.auditEmpty}>
        <AppText variant="caption" tone="muted">
          No timetable has been uploaded for this package yet.
        </AppText>
      </View>
    );
  }

  return (
    <View style={styles.finishedWrap}>
      {smoke ? (
        <View style={styles.smokeBanner}>
          <Clock3 color={colors.primary} size={16} />
          <AppText variant="caption" weight="bold" tone="primary" style={styles.flex}>
            Smoke preview for timeline layout. Real package timetable will replace this data.
          </AppText>
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.finishedRail}>
        {days.map((day) => (
          <View key={`${day.day}-${day.title}`} style={styles.finishedDay}>
            <View style={styles.finishedDayHead}>
              <View style={styles.dayBadge}>
                <AppText variant="caption" weight="extraBold" tone="primary">
                  Day {day.day}
                </AppText>
              </View>
              <View style={styles.stopPill}>
                <AppText variant="caption" weight="extraBold" tone="muted">
                  {day.slots.length} stop{day.slots.length === 1 ? "" : "s"}
                </AppText>
              </View>
            </View>
            <AppText variant="titleSm" weight="extraBold" numberOfLines={2}>
              {day.title}
            </AppText>
            {day.description ? (
              <AppText variant="bodySmall" tone="muted" numberOfLines={3}>
                {day.description}
              </AppText>
            ) : null}

            <View style={styles.eventList}>
              {day.slots.map((slot) => (
                <View key={slot.key} style={styles.eventCard}>
                  <View style={styles.eventTopRow}>
                    <View style={styles.timeBadge}>
                      <Clock3 color={colors.primary} size={13} />
                      <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1}>
                        {slot.time}
                      </AppText>
                    </View>
                    {slot.userRating ? (
                      <View style={styles.ratingChip}>
                        <Star color={colors.primary} fill={colors.primary} size={12} />
                        <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1}>
                          Your {slot.userRating}/5
                        </AppText>
                      </View>
                    ) : (
                      <View style={styles.ratingMuted}>
                        <AppText variant="caption" weight="bold" tone="muted">
                          Not rated
                        </AppText>
                      </View>
                    )}
                  </View>

                  <View style={styles.eventBody}>
                    <AppText variant="bodySmall" weight="extraBold" numberOfLines={2}>
                      {slot.title}
                    </AppText>
                    {slot.description ? (
                      <AppText variant="caption" tone="muted" numberOfLines={2}>
                        {slot.description}
                      </AppText>
                    ) : null}
                  </View>

                  <View style={styles.eventMetaRow}>
                    <View style={styles.vibePill}>
                      <AppText variant="caption" weight="bold" tone={slot.vibe ? "warning" : "soft"} numberOfLines={1}>
                        {slot.vibe || "Vibe not set"}
                      </AppText>
                    </View>
                    {slot.teamCount ? (
                      <AppText variant="caption" tone="muted" style={styles.teamRating} numberOfLines={1}>
                        Team avg {slot.teamAverage}/5 - {slot.teamCount}
                      </AppText>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
function RatingJourneyChart({ points }: { points: RatingJourneyPoint[] }) {
  const chartWidth = Math.max(336, points.length * 68 + 76);
  const chartHeight = 190;
  const padLeft = 34;
  const padRight = 38;
  const top = 20;
  const bottom = 42;
  const plotHeight = chartHeight - top - bottom;
  const plotWidth = chartWidth - padLeft - padRight;
  const step = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const xy = (point: RatingJourneyPoint, index: number) => {
    const x = points.length > 1 ? padLeft + index * step : chartWidth / 2;
    const y = top + (5 - point.rating) * (plotHeight / 4);
    return { x, y };
  };
  const coords = points.map(xy);
  const linePath = coords
    .map((pos, index) => {
      if (index === 0) return `M${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`;
      const prev = coords[index - 1];
      const midX = (prev.x + pos.x) / 2;
      return `C${midX.toFixed(1)} ${prev.y.toFixed(1)} ${midX.toFixed(1)} ${pos.y.toFixed(1)} ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`;
    })
    .join(" ");
  const areaPath = coords.length
    ? `${linePath} L${coords[coords.length - 1].x.toFixed(1)} ${(chartHeight - bottom).toFixed(1)} L${coords[0].x.toFixed(1)} ${(chartHeight - bottom).toFixed(1)} Z`
    : "";

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chartScroll}>
      <Svg width={chartWidth} height={chartHeight}>
        <Defs>
          <LinearGradient id="ratingFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.primary} stopOpacity="0.22" />
            <Stop offset="1" stopColor={colors.primary} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        {[1, 2, 3, 4, 5].map((rating) => {
          const y = top + (5 - rating) * (plotHeight / 4);
          return (
            <Fragment key={`grid-${rating}`}>
              <SvgText x={8} y={y + 4} fill={colors.softText} fontSize="10" textAnchor="start">
                {rating}
              </SvgText>
              <Line
                x1={padLeft}
                x2={chartWidth - padRight}
                y1={y}
                y2={y}
                stroke="#dbe7e5"
                strokeWidth={1}
                strokeDasharray="5 7"
              />
            </Fragment>
          );
        })}
        {areaPath ? <Path d={areaPath} fill="url(#ratingFill)" /> : null}
        <Path d={linePath} stroke={colors.primary} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point, index) => {
          const pos = coords[index];
          return (
            <Fragment key={point.key}>
              <Circle cx={pos.x} cy={pos.y} r={7} fill={colors.white} stroke={colors.primary} strokeWidth={3} />
              <Circle cx={pos.x} cy={pos.y} r={3} fill={colors.primary} />
              {index === 0 || index === points.length - 1 ? (
                <SvgText x={pos.x} y={Math.max(12, pos.y - 12)} fill={colors.primary} fontSize="11" fontWeight="700" textAnchor="middle">
                  {point.rating.toFixed(1)}
                </SvgText>
              ) : null}
              <SvgText x={pos.x} y={chartHeight - 12} fill={colors.mutedText} fontSize="11" textAnchor="middle">
                {point.label}
              </SvgText>
            </Fragment>
          );
        })}
      </Svg>
    </ScrollView>
  );
}

function ChipGroup({ label, values, danger }: { label: string; values: string[]; danger?: boolean }) {
  return (
    <View style={styles.chipBlock}>
      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
        {label}
      </AppText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRail}>
        {values.map((value) => (
          <View key={value} style={[styles.chip, danger && styles.chipExcluded]}>
            <AppText variant="caption" weight="bold" tone={danger ? "warning" : "primary"}>
              {value}
            </AppText>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function PackageFacts({
  meetingPoint,
  days,
  included,
  excluded
}: {
  meetingPoint: string;
  days: string[];
  included: string[];
  excluded: string[];
}) {
  return (
    <View style={styles.packageFacts}>
      <View style={styles.setupGrid}>
        <SetupBox label="Inclusions" tone="include" values={included.length ? included : ["Not specified"]} />
        <SetupBox label="Exclusions" tone="exclude" values={excluded.length ? excluded : ["Not specified"]} />
        <SetupBox label="Meeting points" tone="meet" values={[meetingPoint || "Not selected"]} Icon={MapPin} />
        <SetupBox label="Package days" tone="days" values={[days.length ? days.join(" / ") : "Not specified"]} Icon={CalendarDays} />
      </View>
    </View>
  );
}

function SetupBox({
  label,
  values,
  tone,
  Icon
}: {
  label: string;
  values: string[];
  tone: "include" | "exclude" | "meet" | "days";
  Icon?: typeof CalendarDays;
}) {
  const toneStyle =
    tone === "include" ? styles.setupInclude :
    tone === "exclude" ? styles.setupExclude :
    tone === "meet" ? styles.setupMeet :
    styles.setupDays;
  const marker = tone === "include" ? "+" : tone === "exclude" ? "-" : null;
  const markerTone = tone === "exclude" ? "warning" : "primary";
  return (
    <View style={[styles.setupBox, toneStyle]}>
      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
        {label}
      </AppText>
      <View style={styles.setupValues}>
        {values.map((value, index) => (
          <View key={`${label}-${value}-${index}`} style={styles.setupLine}>
            {Icon ? <Icon color={tone === "days" ? "#4f46e5" : colors.primary} size={16} /> : null}
            {marker ? (
              <AppText variant="bodySmall" weight="extraBold" tone={markerTone}>
                {marker}
              </AppText>
            ) : null}
            <AppText variant="bodySmall" weight="medium" numberOfLines={2} style={styles.flex}>
              {value}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function AuditFlow({ changes, issues }: { changes: any[]; issues: any[] }) {
  const entries = [
    ...changes.map((item) => ({ ...item, kind: "Change" })),
    ...issues.map((item) => ({ ...item, kind: "Issue" }))
  ].slice(-5).reverse();
  if (!entries.length) {
    return (
      <View style={styles.auditEmpty}>
        <AppText variant="caption" tone="muted">
          No change requests or issue reports yet.
        </AppText>
      </View>
    );
  }
  return (
    <View style={styles.auditList}>
      {entries.map((entry, index) => (
        <View key={`${entry.kind}-${entry.id || index}`} style={styles.auditItem}>
          <View style={styles.auditDot} />
          <View style={styles.flex}>
            <AppText variant="caption" weight="bold" tone="soft">
              {entry.kind} - {String(entry.status || "OPEN").toUpperCase()}
            </AppText>
            <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
              {entry.title || "Untitled request"}
            </AppText>
            <AppText variant="caption" tone="muted" numberOfLines={2}>
              {entry.message || "No details"}
            </AppText>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing[4], paddingBottom: spacing[8] },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[6] },
  stateWrap: { paddingTop: spacing[5] },
  header: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  hero: { gap: spacing[4], borderRadius: radius.lg, backgroundColor: colors.primaryDeep, padding: spacing[4], ...shadows.sheet },
  heroTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  heroIcon: {
    width: 54,
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)"
  },
  heroSub: { color: "rgba(255,255,255,0.72)" },
  heroStats: { gap: spacing[2], paddingRight: spacing[1] },
  heroStat: {
    width: 164,
    minHeight: 72,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.09)",
    padding: spacing[3]
  },
  heroStatWide: { width: 224 },
  heroStatLabel: { color: "rgba(255,255,255,0.5)", textTransform: "uppercase", letterSpacing: 0.8 },
  statusStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4]
  },
  statusIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.full },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: spacing[2] },
  infoTile: {
    width: "48%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  infoIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.brand[50] },
  infoLabel: { textTransform: "uppercase", letterSpacing: 0.8 },
  section: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4],
    ...shadows.card
  },
  sectionTitle: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  sectionIcon: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.brand[50] },
  actionGrid: { flexDirection: "row", gap: spacing[2] },
  meetupActionRow: {
    flexDirection: "row",
    gap: spacing[2],
    alignItems: "stretch"
  },
  meetupActionSlot: {
    flex: 1,
    minWidth: 0
  },
  meetupPulseSlot: {
    borderRadius: radius.md
  },
  meetupActionButton: {
    width: "100%",
    minHeight: 50,
    paddingHorizontal: spacing[2]
  },
  meetupRecordedCard: {
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.brand[100],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  meetupRecordedTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    minWidth: 0
  },
  meetupRecordedIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#bbf7d0",
    borderRadius: radius.full,
    backgroundColor: "#f0fdf4"
  },
  meetupSignatureRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.brand[100],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    padding: spacing[2],
    minWidth: 0
  },
  meetupSignatureMeta: {
    flex: 1,
    minWidth: 0
  },
  signatureBarcodeFrame: {
    width: 148,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.brand[100],
    borderRadius: radius.sm,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  signatureBarcode: {
    width: "100%",
    height: 34,
    flexDirection: "row",
    alignItems: "stretch",
    justifyContent: "center",
    gap: 2,
    overflow: "hidden"
  },
  signatureBarcodeBar: {
    height: "100%",
    borderRadius: 1,
    backgroundColor: colors.primary
  },
  meetupSheet: {
    gap: spacing[4],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.white,
    padding: spacing[4],
    paddingBottom: spacing[6],
    ...shadows.sheet
  },
  meetupSheetHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  meetupSheetIcon: {
    width: 50,
    height: 50,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  meetupReasonBox: {
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc",
    padding: spacing[3]
  },
  meetupCodeBox: {
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  meetupCodeField: {
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3]
  },
  meetupSheetActions: {
    flexDirection: "row",
    gap: spacing[2]
  },
  toolButton: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  toolDanger: { backgroundColor: "#fff7f7", borderColor: "#fecaca" },
  toolIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.white },
  toolIconDanger: { backgroundColor: "#fee2e2" },
  toolCue: {
    marginTop: spacing[1],
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  toolCueDanger: {
    backgroundColor: "#fee2e2"
  },
  modalRoot: {
    flex: 1,
    justifyContent: "flex-end"
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(2,6,23,0.42)"
  },
  resultSheet: {
    gap: spacing[4],
    maxHeight: "92%",
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.white,
    padding: spacing[4],
    paddingBottom: spacing[6],
    ...shadows.sheet
  },
  resultHandle: {
    alignSelf: "center",
    width: 44,
    height: 5,
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  resultIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  resultScroll: {
    gap: spacing[3],
    paddingBottom: spacing[1]
  },
  resultRows: {
    gap: spacing[2]
  },
  resultRow: {
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  documentsProof: {
    gap: spacing[3]
  },
  documentsIntro: {
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[3]
  },
  operatorDocumentsBox: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc",
    padding: spacing[3]
  },
  operatorDocumentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[3]
  },
  operatorDocumentEmpty: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  documentUploadCard: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  documentUploadDone: {
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc"
  },
  documentUploadFailed: {
    borderColor: "#fecaca",
    backgroundColor: "#fff7f7"
  },
  documentUploadTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    minWidth: 0
  },
  documentUploadIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  documentUploadIconDone: {
    backgroundColor: "#e9f7ef",
    borderColor: colors.brand[100]
  },
  documentTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minWidth: 0
  },
  requiredPill: {
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  fileTypePill: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  uploadedFileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  documentCodeRow: {
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  liveChip: {
    borderRadius: radius.full,
    backgroundColor: "#e9f7ef",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  completedExperience: {
    gap: spacing[3]
  },
  ratingJourney: {
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f8fbfa",
    padding: spacing[3]
  },
  graphHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    minWidth: 0
  },
  ratingSummaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing[2]
  },
  ratingStat: {
    width: "48%",
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  chartScroll: {
    paddingVertical: spacing[1],
    paddingRight: spacing[4]
  },
  ratingHighlights: {
    flexDirection: "row",
    gap: spacing[2],
    minWidth: 0
  },
  highestBox: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: "#e9f7ef",
    padding: spacing[3]
  },
  lowestBox: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: "#fff7ed",
    padding: spacing[3]
  },
  ratingEmpty: {
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[4]
  },
  recommendTourCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  recommendTourIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  pressed: { transform: [{ scale: 0.99 }] },
  timelineCard: { gap: spacing[3], borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing[3] },
  timelineHeader: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  timelineIcon: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.full, backgroundColor: colors.white },
  timelineLandingCard: {
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  timelineLandingTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  timelineSignalIcon: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  timelineSignalIconActive: {
    backgroundColor: "#e9f7ef"
  },
  timelineStatePill: {
    maxWidth: 98,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  timelineStatePillActive: {
    backgroundColor: "#e9f7ef"
  },
  timelineLandingNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  timelineLandingSteps: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  timelineStep: {
    width: 190,
    minHeight: 76,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  timelineStepActive: {
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc"
  },
  timelineStepIcon: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  timelineStepIconActive: {
    borderColor: colors.brand[100],
    backgroundColor: "#e9f7ef"
  },
  timelineLinkCard: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  timelineLinkTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  timelineLinkIcon: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  timelineLinkTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    minWidth: 0
  },
  timelineLinkStats: {
    flexDirection: "row",
    gap: spacing[2]
  },
  timelineLinkStat: {
    flex: 1,
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2]
  },
  timelineLinkActions: {
    flexDirection: "row",
    gap: spacing[2]
  },
  timelineSummaryCard: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc",
    padding: spacing[3]
  },
  timelineSummaryTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  validationCheckIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  linkStatusPill: {
    maxWidth: 104,
    borderRadius: radius.full,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  linkStatusActive: {
    backgroundColor: "#e9f7ef",
    borderColor: colors.brand[100]
  },
  timelineProgressTrack: {
    height: 8,
    overflow: "hidden",
    borderRadius: radius.full,
    backgroundColor: "#dbe7e5"
  },
  timelineProgressFill: {
    height: "100%",
    borderRadius: radius.full,
    backgroundColor: colors.success
  },
  timelineSummaryStats: {
    flexDirection: "row",
    gap: spacing[2],
    minWidth: 0
  },
  timelineMetricsRail: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  timelineSummaryStat: {
    width: 116,
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2]
  },
  timelineSummaryStatWide: {
    flex: 1.3,
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2]
  },
  linkExpiryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[1]
  },
  finishedWrap: {
    gap: spacing[3]
  },
  smokeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  finishedRail: {
    gap: spacing[3],
    paddingVertical: spacing[1],
    paddingRight: spacing[4]
  },
  finishedDay: {
    width: 320,
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  finishedDayHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  dayBadge: { alignSelf: "flex-start", borderRadius: radius.full, backgroundColor: colors.brand[50], paddingHorizontal: spacing[2], paddingVertical: 3 },
  stopPill: {
    borderRadius: radius.full,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  eventList: {
    gap: spacing[2]
  },
  eventCard: {
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#edf2f7",
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  eventTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    minWidth: 0
  },
  timeBadge: {
    flex: 1,
    minWidth: 0,
    maxWidth: 150,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  eventBody: {
    gap: spacing[1],
    minWidth: 0
  },
  eventMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    minWidth: 0
  },
  vibePill: {
    alignSelf: "flex-start",
    maxWidth: 132,
    borderRadius: radius.full,
    backgroundColor: "#fff7ed",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  ratingChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  ratingMuted: {
    borderRadius: radius.full,
    backgroundColor: "#f8fafc",
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  teamRating: {
    flex: 1,
    minWidth: 0,
    textAlign: "right"
  },
  chipBlock: { gap: spacing[2] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  chipRail: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  chip: { borderRadius: radius.full, borderWidth: 1, borderColor: colors.brand[100], backgroundColor: colors.brand[50], paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  chipExcluded: {
    borderColor: "#fed7aa",
    backgroundColor: "#fff7ed"
  },
  packageFacts: {
    gap: spacing[3]
  },
  setupGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing[2]
  },
  setupBox: {
    width: "49%",
    minHeight: 102,
    gap: spacing[2],
    borderRadius: radius.md,
    padding: spacing[3]
  },
  setupInclude: {
    backgroundColor: "#f0fbf6"
  },
  setupExclude: {
    backgroundColor: "#fff7f7"
  },
  setupMeet: {
    backgroundColor: "#f0fbfc"
  },
  setupDays: {
    backgroundColor: "#f3f5ff"
  },
  setupValues: {
    gap: spacing[2]
  },
  setupLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    minWidth: 0
  },
  factSummaryGrid: {
    flexDirection: "row",
    gap: spacing[2],
    minWidth: 0
  },
  factSummaryRail: {
    gap: spacing[3],
    paddingRight: spacing[4]
  },
  factSummaryCard: {
    width: 260,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[3]
  },
  form: { gap: spacing[3], borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing[3] },
  textArea: { minHeight: 92, textAlignVertical: "top", paddingTop: spacing[3] },
  formFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[3] },
  sendButton: { minHeight: 44, paddingVertical: spacing[2] },
  auditEmpty: { borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing[3] },
  auditList: { gap: spacing[2] },
  auditItem: { flexDirection: "row", gap: spacing[2], borderRadius: radius.md, backgroundColor: "#f8fafc", padding: spacing[3] },
  auditDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: colors.primary, marginTop: 7 },
  messageBox: { borderRadius: radius.md, borderWidth: 1, borderColor: colors.brand[100], backgroundColor: colors.brand[50], padding: spacing[3] }
});
