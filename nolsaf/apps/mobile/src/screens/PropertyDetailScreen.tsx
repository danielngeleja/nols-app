import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowLeft,
  Beer,
  Bookmark,
  BadgeCheck,
  Bath,
  BedDouble,
  Building2,
  CalendarDays,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cigarette,
  Clock3,
  ConciergeBell,
  Coffee,
  CreditCard,
  Dumbbell,
  DoorClosed,
  ExternalLink,
  FireExtinguisher,
  Fuel,
  Gamepad2,
  Bus,
  Landmark,
  Layers,
  Lock,
  LucideIcon,
  MapPin,
  Navigation,
  PawPrint,
  Plane,
  QrCode,
  Route,
  Share2,
  ShoppingBag,
  ShieldCheck,
  Star,
  Stethoscope,
  Tags,
  Thermometer,
  Utensils,
  Users,
  WashingMachine,
  Waves,
  Wallet,
  Wind,
  XCircle
} from "lucide-react-native";
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ActivityIndicator,
  FlatList,
  Image,
  ImageSourcePropType,
  Linking,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { useAuth } from "../auth";
import {
  AmenityGrid,
  AmountText,
  AppButton,
  AppCard,
  AppStack,
  AppText,
  BottomActionBar,
  CalendarRangeSheet,
  LocationMapCard,
  ReviewSheet,
  StateView
} from "../components";
import airtelLogo from "../../assets/payments/airtel.png";
import halopesaLogo from "../../assets/payments/halopesa.png";
import mixxLogo from "../../assets/payments/mixx.png";
import mpesaLogo from "../../assets/payments/mpesa.png";
import visaLogo from "../../assets/payments/visa.png";
import { useReducedMotion } from "../lib/useReducedMotion";
import { RootStackParamList } from "../navigation/types";
import {
  createPropertyReview,
  fetchAvailabilityRange,
  fetchPropertyDetail,
  fetchPropertyReviews,
  normalizeRoom,
  NormalizedRoom,
  parsePropertyServices,
  PropertyReview,
  PropertyReviewsResponse,
  PublicPropertyDetail,
  useSavedProperties
} from "../properties";
import { fetchSystemCommission } from "../bookings/checkoutApi";
import { getPropertyCommission, priceWithCommission } from "../bookings/priceUtils";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "PropertyDetail">;

const HERO_ROTATE_MS = 4500;
const HERO_RESUME_MS = 6000;

function labelize(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Turns a "10:00 - 15:00" window into "10:00 to 15:00" (no dashes). */
function cleanTime(s: string): string {
  return s.replace(/\s*[-–—]\s*/g, " to ").trim();
}

const REVIEW_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "customerCare", label: "Customer care" },
  { key: "security", label: "Security" },
  { key: "reality", label: "Reality" },
  { key: "comfort", label: "Comfort" }
];

function facilityIcon(type: string): { Icon: LucideIcon; color: string; bg: string } {
  const t = (type || "").toLowerCase();
  if (t.includes("hospital") || t.includes("clinic") || t.includes("pharmac") || t.includes("health")) {
    return { Icon: Stethoscope, color: "#dc2626", bg: "#fee2e2" };
  }
  if (t.includes("petrol") || t.includes("fuel") || t.includes("gas")) {
    return { Icon: Fuel, color: "#b45309", bg: "#fff8e6" };
  }
  if (t.includes("airport")) return { Icon: Plane, color: "#1d4ed8", bg: "#eaf2ff" };
  if (t.includes("bus") || t.includes("station")) return { Icon: Bus, color: "#b45309", bg: "#fff8e6" };
  if (t.includes("road")) return { Icon: Route, color: colors.mutedText, bg: "#f1f5f9" };
  if (t.includes("police")) return { Icon: ShieldCheck, color: "#4f46e5", bg: "#eef2ff" };
  if (t.includes("center") || t.includes("centre") || t.includes("conference")) {
    return { Icon: Building2, color: colors.primary, bg: colors.brand[50] };
  }
  return { Icon: MapPin, color: colors.primary, bg: colors.brand[50] };
}

function ratingLabel(avg: number): string {
  if (avg >= 4.5) return "Excellent";
  if (avg >= 4) return "Very good";
  if (avg >= 3.5) return "Good";
  if (avg >= 3) return "Pleasant";
  if (avg > 0) return "Fair";
  return "Not rated yet";
}

/** Mastercard mark drawn with SVG so no extra asset is needed. */
function MastercardLogo() {
  return (
    <Svg width={36} height={22} viewBox="0 0 36 22">
      <Circle cx="14" cy="11" r="9" fill="#EB001B" />
      <Circle cx="22" cy="11" r="9" fill="#F79E1B" fillOpacity={0.9} />
    </Svg>
  );
}

type PaymentRow = { label: string; logos: ImageSourcePropType[]; icon: ReactNode | null };

/** One row per payment method, with brand logos. Cash is intentionally excluded. */
function buildPaymentRows(modes: string[]): PaymentRow[] {
  return modes
    .filter((m) => !m.toLowerCase().includes("cash"))
    .map((m) => {
      const lower = m.toLowerCase();
      if (lower.includes("mobile") || lower.includes("money")) {
        return { label: "Mobile money", logos: [mpesaLogo, mixxLogo, airtelLogo, halopesaLogo], icon: null };
      }
      if (lower.includes("card") || lower.includes("visa") || lower.includes("master")) {
        return { label: "Card", logos: [visaLogo], icon: <MastercardLogo /> };
      }
      if (lower.includes("bank")) {
        return { label: "Bank transfer", logos: [], icon: <Landmark color="#1d4ed8" size={20} /> };
      }
      return { label: labelize(m), logos: [], icon: <Wallet color={colors.primary} size={20} /> };
    });
}

function formatPretty(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return isNaN(d.getTime()) ? ymd : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatVerificationDate(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function firstText(record: Record<string, unknown> | null | undefined, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    const nested = asRecord(value);
    const nestedName = nested ? firstText(nested, ["name", "fullName", "email", "label", "value"]) : "";
    if (nestedName) return nestedName;
  }
  return "";
}

function firstRecord(record: Record<string, unknown> | null | undefined, keys: string[]): Record<string, unknown> | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8);
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return [];
}

function firstTextList(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const list = textList(record[key]);
    if (list.length) return list;
  }
  return [];
}

function normalizeVerificationRecord(detail: PublicPropertyDetail): PublicPropertyDetail["physicalVerification"] {
  const servicesObj = asRecord(detail.services);
  const detailObj = asRecord(detail);
  const raw =
    asRecord(detail.physicalVerification) ||
    firstRecord(servicesObj, ["physicalVerification", "physical_verification", "propertyVerification", "property_verification", "nolsafVerification", "nolsaf_verification", "trustCheck", "trust_check", "verification"]) ||
    firstRecord(detailObj, ["physicalVerification", "physical_verification", "propertyVerification", "property_verification", "nolsafVerification", "nolsaf_verification", "trustCheck", "trust_check", "verification"]);

  if (!raw) {
    return String(detail.status || "").toUpperCase() === "APPROVED"
      ? {
          status: "VERIFIED",
          verifiedAt: null,
          verifiedBy: null,
          verifiedByRole: null,
          method: "Site visit and listing review",
          note: "This stay has passed NoLSAF listing review and is available for booking.",
          checklist: []
        }
      : undefined;
  }
  const source = raw;

  const status = firstText(source, ["status", "verificationStatus", "verification_status", "trustStatus", "trust_status"]);
  const normalizedStatus = status.toUpperCase();
  if (normalizedStatus && normalizedStatus !== "VERIFIED" && normalizedStatus !== "PENDING") return undefined;
  const checklist = firstTextList(source, ["checklist", "checkedItems", "checked_items", "items"]);

  return {
    status: normalizedStatus === "PENDING" ? "PENDING" : "VERIFIED",
    verifiedAt:
      firstText(source, ["verifiedAt", "verifiedOn", "verified_at", "verified_on", "inspectionDate", "inspection_date", "inspectedAt", "inspected_at", "reviewedAt", "reviewed_at", "approvedAt", "approved_at"]) || null,
    verifiedBy:
      firstText(source, ["verifiedBy", "verified_by", "verifiedByName", "verified_by_name", "inspectedBy", "inspected_by", "inspector", "inspectorName", "inspector_name", "reviewedBy", "reviewed_by", "approvedBy", "approved_by", "approvedByName", "approved_by_name", "approvedByUser", "approved_by_user", "approvedByAdmin", "approved_by_admin", "admin", "verifier", "verifierName"]) || null,
    verifiedByRole: firstText(source, ["verifiedByRole", "verified_by_role", "role", "inspectorRole", "inspector_role", "approvedByRole", "approved_by_role", "adminRole", "admin_role"]) || null,
    method: firstText(source, ["method", "inspectionMethod", "inspection_method", "verificationMethod", "verification_method"]),
    note: firstText(source, ["note", "summary", "description", "message", "verificationNote", "verification_note"]) || null,
    checklist,
    verificationUrl: firstText(source, ["verificationUrl", "verification_url", "certificateUrl", "certificate_url", "publicUrl", "public_url"]) || null,
    qrCodeDataUrl: firstText(source, ["qrCodeDataUrl", "qrCodeUrl", "qr_code_data_url", "qr_code_url", "qr"]) || null
  };
}

function PhysicalVerificationCard({ record }: { record?: PublicPropertyDetail["physicalVerification"] }) {
  const [checksExpanded, setChecksExpanded] = useState(false);
  const [certificateVisible, setCertificateVisible] = useState(false);
  const verifiedBy = record?.verifiedBy?.trim();
  const verifiedAt = formatVerificationDate(record?.verifiedAt);
  if (!record) return null;
  const checklist = record?.checklist?.length
    ? record.checklist
    : ["Location confirmed on-site", "Property photos reviewed", "Rooms and amenities checked", "Host details matched"];

  return (
    <View style={styles.trustCard}>
      <View style={styles.trustHero}>
        <View style={styles.trustIcon}>
          <ShieldCheck color={colors.primary} size={20} />
        </View>
        <AppText variant="caption" weight="bold" tone="primary" style={styles.trustEyebrow}>
          NoLSAF trust check
        </AppText>
        <AppText variant="titleSm" weight="bold" style={styles.trustTitle}>
          Physical verification
        </AppText>
        <View style={styles.trustSteps}>
          {["Reviewed", "Verified", "Approved"].map((label, index) => (
            <View key={label} style={styles.trustStepWrap}>
              <View style={styles.trustStep}>
                <CheckCircle2 color={colors.primary} size={13} />
                <AppText variant="caption" weight="bold" tone="primary">
                  {label}
                </AppText>
              </View>
              {index < 2 ? <View style={styles.trustStepLine} /> : null}
            </View>
          ))}
        </View>
      </View>

      <VerificationCertificateButton record={record} onPress={() => setCertificateVisible(true)} />

      <View style={styles.trustChecklist}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={checksExpanded ? "Hide NoLSAF checks" : "Show NoLSAF checks"}
          onPress={() => setChecksExpanded((value) => !value)}
          style={styles.trustChecklistToggle}
        >
          <AppText variant="body" weight="bold" style={styles.flex}>
            What NoLSAF checked
          </AppText>
          <View style={styles.trustChecklistChevron}>
            {checksExpanded ? <ChevronUp color={colors.ink} size={20} /> : <ChevronDown color={colors.ink} size={20} />}
          </View>
        </Pressable>

        {checksExpanded ? (
          <>
            <View style={styles.trustChecklistGrid}>
              {checklist.map((item) => (
                <View key={item} style={styles.trustChecklistItem}>
                  <CheckCircle2 color={colors.primary} size={17} />
                  <AppText variant="bodySmall" tone="muted" style={styles.flex}>
                    {item}
                  </AppText>
                </View>
              ))}
            </View>

            <View style={styles.trustFooter}>
              <CheckCircle2 color={colors.primary} size={17} />
              <AppText variant="caption" tone="muted" style={styles.flex}>
                Verification details are maintained by NoLSAF and refreshed when a property is inspected again.
              </AppText>
            </View>
          </>
        ) : null}
      </View>

      <VerificationCertificateModal
        visible={certificateVisible}
        record={record}
        verifiedBy={verifiedBy}
        verifiedAt={verifiedAt}
        onClose={() => setCertificateVisible(false)}
      />
    </View>
  );
}

function VerificationCertificateButton({
  record,
  onPress
}: {
  record: NonNullable<PublicPropertyDetail["physicalVerification"]>;
  onPress: () => void;
}) {
  if (!record.verificationUrl && !record.qrCodeDataUrl) return null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View property verification certificate"
      onPress={onPress}
      style={styles.certificateButton}
    >
      <View style={styles.certificateButtonIcon}>
        <QrCode color={colors.primary} size={20} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="bold">
          View verification certificate
        </AppText>
        <AppText variant="caption" tone="muted">
          Scan or open the public NoLSAF certificate.
        </AppText>
      </View>
      <ExternalLink color={colors.primary} size={18} />
    </Pressable>
  );
}

function VerificationCertificateModal({
  visible,
  record,
  verifiedBy,
  verifiedAt,
  onClose
}: {
  visible: boolean;
  record: NonNullable<PublicPropertyDetail["physicalVerification"]>;
  verifiedBy?: string;
  verifiedAt: string;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { height, width } = useWindowDimensions();
  const sheetMaxHeight = Math.max(360, height - Math.max(insets.top, spacing[3]) - spacing[3]);
  const qrSize = Math.min(210, Math.max(150, width - spacing[10]));

  const openCertificate = () => {
    if (!record.verificationUrl) return;
    Linking.openURL(record.verificationUrl).catch(() => {
      Alert.alert("NoLSAF verification", "Could not open this certificate right now.");
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.certificateSheet, { maxHeight: sheetMaxHeight, paddingBottom: Math.max(insets.bottom + spacing[4], spacing[5]) }]}>
          <View style={styles.certificateSheetHeader}>
            <View style={styles.certificateTitleRow}>
              <View style={styles.certificateSheetIcon}>
                <ShieldCheck color={colors.primary} size={20} />
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="bold">
                  Verification certificate
                </AppText>
                <AppText variant="caption" tone="muted">
                  Public NoLSAF property check
                </AppText>
              </View>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close certificate" onPress={onClose} style={styles.modalCloseButton}>
              <XCircle color={colors.ink} size={22} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.certificateContent}
          >
            {record.qrCodeDataUrl ? (
              <View style={[styles.qrFrame, { width: qrSize, height: qrSize }]}>
                <Image source={{ uri: record.qrCodeDataUrl }} style={styles.qrImage} resizeMode="contain" />
              </View>
            ) : null}

            <View style={styles.certificateFacts}>
              <VerificationInfo label="Status" value={record.status === "PENDING" ? "Review pending" : "Verified"} wide />
              {verifiedAt ? <VerificationInfo label="Verified on" value={verifiedAt} /> : null}
              {verifiedBy ? <VerificationInfo label="Verified by" value={verifiedBy} /> : null}
            </View>

            <AppText variant="caption" tone="muted" style={styles.certificateNote}>
              Scan this code to check this stay's NoLSAF certificate anytime. You do not need to sign in.
            </AppText>

            {record.verificationUrl ? (
              <AppButton title="Open certificate" icon={<ExternalLink color={colors.white} size={18} />} onPress={openCertificate} />
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function VerificationInfo({
  label,
  value,
  wide
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View style={[styles.trustInfoTile, wide && styles.trustInfoTileWide]}>
      <View style={styles.trustInfoLabel}>
        <ShieldCheck color={colors.primary} size={14} />
        <AppText variant="caption" weight="bold" tone="muted" style={styles.trustInfoLabelText}>
          {label}
        </AppText>
      </View>
      <AppText variant="bodySmall" weight="bold">
        {value}
      </AppText>
    </View>
  );
}

function ServiceTile({ item, scroll }: { item: string; scroll?: boolean }) {
  const { Icon, color } = serviceIcon(item);

  return (
    <View style={[styles.includedTile, scroll && styles.includedTileScroll]}>
      <Icon color={color} size={16} />
      <AppText variant="caption" weight="bold" numberOfLines={1} style={styles.flex}>
        {labelize(item)}
      </AppText>
    </View>
  );
}

function serviceIcon(label: string): { Icon: LucideIcon; color: string } {
  const n = label.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (n.includes("restaurant")) return { Icon: Utensils, color: "#e11d48" };
  if (n.includes("bar")) return { Icon: Beer, color: "#7c3aed" };
  if (n.includes("pool") || n.includes("swim")) return { Icon: Waves, color: "#0891b2" };
  if (n.includes("sauna")) return { Icon: Thermometer, color: "#ea580c" };
  if (n.includes("laundry") || n.includes("washing") || n.includes("washer")) return { Icon: WashingMachine, color: "#4f46e5" };
  if (n.includes("roomservice")) return { Icon: ConciergeBell, color: "#047857" };
  if (n.includes("security")) return { Icon: ShieldCheck, color: "#0f766e" };
  if (n.includes("firstaid") || n.includes("clinic") || n.includes("medical")) return { Icon: Stethoscope, color: "#dc2626" };
  if (n.includes("fireextinguisher") || n.includes("fire")) return { Icon: FireExtinguisher, color: "#dc2626" };
  if (n.includes("onsiteshop") || n.includes("shop")) return { Icon: ShoppingBag, color: "#9333ea" };
  if (n.includes("sport") || n.includes("game")) return { Icon: Gamepad2, color: "#4f46e5" };
  if (n.includes("gym") || n.includes("fitness")) return { Icon: Dumbbell, color: "#334155" };
  if (n.includes("parking") || n.includes("garage")) return { Icon: Car, color: colors.primary };
  if (n.includes("breakfast") || n.includes("coffee")) return { Icon: Coffee, color: colors.warning };
  if (n.includes("wifi") || n.includes("internet")) return { Icon: Tags, color: colors.primary };
  if (n.includes("airconditioning") || n.includes("aircondition") || n.includes("aircon")) return { Icon: Wind, color: "#2563eb" };
  return { Icon: CheckCircle2, color: colors.primary };
}

function IncludedServicesCard({ items }: { items: string[] }) {
  if (!items.length) return null;
  const scrollable = items.length > 2;

  return (
    <AppCard>
      <View style={styles.includedHeader}>
        <View style={styles.includedIcon}>
          <BadgeCheck color={colors.primary} size={20} />
        </View>
        <View style={styles.flex}>
          <AppText variant="body" weight="bold">
            What's included
          </AppText>
          <AppText variant="caption" tone="muted">
            {items.length} {items.length === 1 ? "service" : "services"} included in the listed price
          </AppText>
        </View>
        {scrollable ? (
          <View style={styles.includedHint}>
            <AppText variant="caption" weight="bold" tone="primary">
              Swipe
            </AppText>
          </View>
        ) : null}
      </View>
      {scrollable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.includedScrollContent}
        >
          {items.map((item) => (
            <ServiceTile key={item} item={item} scroll />
          ))}
        </ScrollView>
      ) : (
        <View style={styles.includedGrid}>
          {items.map((item) => (
            <ServiceTile key={item} item={item} />
          ))}
        </View>
      )}
    </AppCard>
  );
}

function AvailableServicesCard({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!items.length) return null;

  return (
    <AppCard>
      <View style={styles.includedHeader}>
        <View style={styles.includedIcon}>
          <BadgeCheck color={colors.primary} size={20} />
        </View>
        <View style={styles.flex}>
          <AppText variant="body" weight="bold">
            Other services available
          </AppText>
          <AppText variant="caption" tone="muted">
            {items.length} {items.length === 1 ? "service" : "services"} available during your stay
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Hide available services" : "Show available services"}
          onPress={() => setExpanded((value) => !value)}
          style={styles.includedChevron}
        >
          {expanded ? <ChevronUp color={colors.ink} size={20} /> : <ChevronDown color={colors.ink} size={20} />}
        </Pressable>
      </View>
      {expanded ? (
        <View style={styles.includedGrid}>
          {items.map((item) => (
            <ServiceTile key={item} item={item} />
          ))}
        </View>
      ) : null}
    </AppCard>
  );
}

export function PropertyDetailScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const { savedIds, toggleSave } = useSavedProperties(token);
  const { id } = route.params;
  const [detail, setDetail] = useState<PublicPropertyDetail | null>(null);
  const [commission, setCommission] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [availRooms, setAvailRooms] = useState<number | null | undefined>(undefined);
  const [availLoading, setAvailLoading] = useState(false);
  const [reviews, setReviews] = useState<PropertyReviewsResponse | null>(null);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [reviewSheetVisible, setReviewSheetVisible] = useState(false);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const goToBooking = useCallback(
    (roomCode: string | null) => {
      if (!token) {
        navigation.navigate("Login");
        return;
      }
      navigation.navigate("BookingReview", {
        propertyId: id,
        propertyTitle: detail?.title,
        roomCode: roomCode ?? null,
        checkIn: checkIn || null,
        checkOut: checkOut || null
      });
    },
    [token, navigation, id, detail?.title, checkIn, checkOut]
  );

  const loadReviews = useCallback(() => {
    setReviewsLoading(true);
    fetchPropertyReviews(id)
      .then((data) => setReviews(data))
      .catch(() => setReviews(null))
      .finally(() => setReviewsLoading(false));
  }, [id]);

  async function submitReview(rating: number, title: string, comment: string, categoryRatings: Record<string, number>) {
    if (!token) {
      setReviewSheetVisible(false);
      navigation.navigate("Login");
      return;
    }
    const cats = Object.fromEntries(Object.entries(categoryRatings).filter(([, v]) => v > 0));
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      await createPropertyReview(token, {
        propertyId: id,
        rating,
        title: title || undefined,
        comment: comment || undefined,
        categoryRatings: Object.keys(cats).length ? cats : undefined
      });
      setReviewSheetVisible(false);
      loadReviews();
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "Could not submit your review.");
    } finally {
      setReviewSubmitting(false);
    }
  }

  async function applyDates(ci: string, co: string) {
    setCheckIn(ci);
    setCheckOut(co);
    setCalendarVisible(false);
    setAvailLoading(true);
    setAvailRooms(undefined);
    try {
      const res = await fetchAvailabilityRange(id, ci, co);
      setAvailRooms(res.items[0]?.roomsAvailable ?? null);
    } catch {
      setAvailRooms(null);
    } finally {
      setAvailLoading(false);
    }
  }

  function nightsBetween(ci: string, co: string): number {
    const a = new Date(`${ci}T00:00:00`).getTime();
    const b = new Date(`${co}T00:00:00`).getTime();
    return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)));
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, sysCommission] = await Promise.all([fetchPropertyDetail(id), fetchSystemCommission()]);
      setDetail(data);
      setCommission(getPropertyCommission(data.services, sysCommission));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load this stay.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <AppText variant="bodySmall" tone="muted">
          Loading stay...
        </AppText>
      </View>
    );
  }

  if (error || !detail) {
    return (
      <View style={styles.root}>
        <FloatingBack onPress={() => navigation.goBack()} top={insets.top} />
        <View style={styles.center}>
          <StateView title="Could not load stay" message={error ?? "Unknown error"} actionLabel="Try again" onAction={load} />
        </View>
      </View>
    );
  }

  const location = [detail.street, detail.ward, detail.district, detail.regionName, detail.country].filter(Boolean).join(", ");
  const parsed = parsePropertyServices(detail.services);
  const verificationRecord = normalizeVerificationRecord(detail);
  const houseRules = parsed.houseRules;
  const amenities = parsed.amenities;
  const includedServices = parsed.included;
  const includedKeys = new Set(includedServices.map((item) => item.trim().toLowerCase()));
  const otherServices = amenities.filter((item) => !includedKeys.has(item.trim().toLowerCase()));
  const reviewAvg = reviews?.stats.averageRating ?? 0;
  const reviewCount = reviews?.stats.totalReviews ?? 0;
  const catAvgs = reviews?.stats.categoryAverages ?? null;
  const rooms = detail.roomsSpec || [];
  const grossBasePrice = detail.basePrice != null ? priceWithCommission(Number(detail.basePrice), commission) : null;

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        <HeroGallery
          images={detail.images}
          title={detail.title}
          location={location}
          topInset={insets.top}
          onBack={() => navigation.goBack()}
          saved={savedIds.has(id)}
          onToggleSave={token ? () => toggleSave(id) : undefined}
        />

        <View style={styles.body}>
          <AppStack gap={6}>
            <View style={styles.metaRow}>
              <View style={styles.typePill}>
                <AppText variant="caption" weight="bold" tone="primary">
                  {labelize(detail.type || "Stay").toUpperCase()}
                </AppText>
              </View>
              <View style={styles.verifiedRow}>
                <BadgeCheck color={colors.primary} size={16} />
                <AppText variant="caption" weight="bold" tone="primary">
                  Verified listing
                </AppText>
              </View>
            </View>

            {/* About */}
            {detail.description ? (
              <View style={styles.aboutCard}>
                <View style={styles.aboutHeader}>
                  <View style={styles.aboutTitleWrap}>
                    <View style={styles.aboutIcon}>
                      <DoorClosed color={colors.primary} size={18} />
                    </View>
                    <AppText variant="titleSm" weight="bold" style={styles.flex}>
                      About this stay
                    </AppText>
                  </View>
                  {detail.description.length > 180 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={descExpanded ? "Collapse stay description" : "Expand stay description"}
                      onPress={() => setDescExpanded((v) => !v)}
                      hitSlop={8}
                      style={styles.chevronButton}
                    >
                      {descExpanded ? <ChevronUp color={colors.ink} size={20} /> : <ChevronDown color={colors.ink} size={20} />}
                    </Pressable>
                  ) : null}
                </View>
                <View style={styles.aboutDivider} />
                <AppText variant="body" tone="muted" numberOfLines={descExpanded ? undefined : 5} style={styles.aboutText}>
                  {detail.description}
                </AppText>
              </View>
            ) : null}

            <PhysicalVerificationCard record={verificationRecord} />

            <IncludedServicesCard items={includedServices} />

            <AvailableServicesCard items={otherServices} />

            {/* Payment methods */}
            <Section title="Payment methods" icon={<CreditCard color={colors.primary} size={18} />}>
              <AppCard>
                {buildPaymentRows(parsed.paymentModes).map((row, i) => (
                  <View key={i} style={[styles.payRow, i > 0 && styles.payRowBorder]}>
                    <AppText variant="bodySmall" weight="semiBold" style={styles.flex} numberOfLines={1}>
                      {row.label}
                    </AppText>
                    <View style={styles.payLogos}>
                      {row.logos.map((src, j) => (
                        <View key={j} style={styles.logoBadge}>
                          <Image source={src} style={styles.logoImg} resizeMode="contain" />
                        </View>
                      ))}
                      {row.icon ? <View style={styles.logoBadge}>{row.icon}</View> : null}
                    </View>
                  </View>
                ))}
              </AppCard>
              {parsed.freeCancellation ? (
                <View style={styles.inlineNote}>
                  <CheckCircle2 color={colors.success} size={15} />
                  <AppText variant="caption" weight="semiBold" tone="success">
                    Free cancellation
                  </AppText>
                </View>
              ) : null}
            </Section>

            {/* Starting from */}
            <AppCard>
              <AppStack gap={3}>
                <AppText variant="caption" weight="bold" tone="muted" style={styles.startingLabel}>
                  STARTING FROM
                </AppText>
                {grossBasePrice != null ? (
                  <AmountText amount={grossBasePrice} currency={detail.currency || "TZS"} variant="headline" weight="extraBold" />
                ) : (
                  <AppText variant="titleSm" weight="bold" tone="muted">
                    Price on request
                  </AppText>
                )}
                <AppText variant="caption" tone="soft">
                  per night
                </AppText>
                <AppButton title="Request booking" onPress={() => goToBooking(null)} />
                <View style={styles.startingNote}>
                  <ShieldCheck color={colors.success} size={15} />
                  <AppText variant="caption" tone="muted" style={styles.flex}>
                    Approved listings only. Secure workflows and host verification are in progress.
                  </AppText>
                </View>
              </AppStack>
            </AppCard>

            {/* Availability live updates */}
            <Section title="Availability live updates" icon={<CalendarDays color={colors.primary} size={18} />}>
              <AppText variant="caption" tone="muted">
                Choose your dates to see rooms that can be booked now.
              </AppText>
              <View style={styles.dateFields}>
                <Pressable accessibilityRole="button" onPress={() => setCalendarVisible(true)} style={styles.dateField}>
                  <AppText variant="caption" weight="bold" tone="muted">
                    Check in
                  </AppText>
                  <AppText variant="bodySmall" weight="bold" tone={checkIn ? "default" : "soft"} numberOfLines={1}>
                    {checkIn ? formatPretty(checkIn) : "Select date"}
                  </AppText>
                </Pressable>
                <Pressable accessibilityRole="button" onPress={() => setCalendarVisible(true)} style={styles.dateField}>
                  <AppText variant="caption" weight="bold" tone="muted">
                    Check out
                  </AppText>
                  <AppText variant="bodySmall" weight="bold" tone={checkOut ? "default" : "soft"} numberOfLines={1}>
                    {checkOut ? formatPretty(checkOut) : "Select date"}
                  </AppText>
                </Pressable>
              </View>
              {availLoading ? (
                <View style={styles.availResult}>
                  <ActivityIndicator color={colors.primary} />
                  <AppText variant="bodySmall" tone="muted">
                    Checking availability...
                  </AppText>
                </View>
              ) : checkIn && checkOut && availRooms !== undefined ? (
                <View style={[styles.availResult, availRooms && availRooms > 0 ? styles.availOk : styles.availNone]}>
                  <View style={[styles.availIcon, availRooms && availRooms > 0 ? styles.availIconOk : styles.availIconNone]}>
                    {availRooms && availRooms > 0 ? (
                      <CheckCircle2 color={colors.white} size={18} />
                    ) : (
                      <XCircle color={colors.white} size={18} />
                    )}
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="bold">
                      {availRooms && availRooms > 0
                        ? `${availRooms} ${availRooms === 1 ? "room" : "rooms"} available`
                        : "No rooms available"}
                    </AppText>
                    <AppText variant="caption" tone="muted">
                      {formatPretty(checkIn)} to {formatPretty(checkOut)} · {nightsBetween(checkIn, checkOut)}{" "}
                      {nightsBetween(checkIn, checkOut) === 1 ? "night" : "nights"}
                    </AppText>
                  </View>
                </View>
              ) : null}
            </Section>

            {/* Property structure */}
            <BuildingLayout detail={detail} />

            {/* Rooms */}
            {rooms.length > 0 ? (
              <Section
                title="Rooms"
                icon={<Layers color={colors.primary} size={18} />}
                trailing={
                  <View style={styles.chip}>
                    <AppText variant="caption" weight="bold" tone="muted">
                      {rooms.length} {rooms.length === 1 ? "type" : "types"}
                    </AppText>
                  </View>
                }
              >
                {rooms.map((room, i) => {
                  const nr = normalizeRoom(room, i, detail.currency, detail.basePrice);
                  return (
                    <RoomCard
                      key={i}
                      index={i}
                      room={nr}
                      commission={commission}
                      currency={detail.currency || "TZS"}
                      propertyId={detail.id}
                      checkIn={checkIn}
                      checkOut={checkOut}
                      onPickDates={() => setCalendarVisible(true)}
                      onBook={() => goToBooking(nr.roomType)}
                    />
                  );
                })}
              </Section>
            ) : null}

            {/* Amenities */}
            {amenities.length > 0 ? (
              <Section
                title="What this place offers"
                icon={<Star color={colors.primary} size={18} />}
                trailing={
                  <View style={styles.chip}>
                    <AppText variant="caption" weight="bold" tone="muted">
                      {amenities.length}
                    </AppText>
                  </View>
                }
              >
                <AmenityGrid items={amenities.slice(0, 24).map(labelize)} />
              </Section>
            ) : null}

            {/* House rules */}
            {houseRules ? (
              <Section title="House rules" icon={<ShieldCheck color={colors.primary} size={18} />}>
                {houseRules.checkIn || houseRules.checkOut ? (
                  <View style={styles.timesRow}>
                    {houseRules.checkIn ? (
                      <View style={styles.timeTile}>
                        <Clock3 color={colors.primary} size={16} />
                        <View style={styles.flex}>
                          <AppText variant="caption" tone="muted">
                            Check in
                          </AppText>
                          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                            {cleanTime(houseRules.checkIn)}
                          </AppText>
                        </View>
                      </View>
                    ) : null}
                    {houseRules.checkOut ? (
                      <View style={styles.timeTile}>
                        <Clock3 color={colors.primary} size={16} />
                        <View style={styles.flex}>
                          <AppText variant="caption" tone="muted">
                            Check out
                          </AppText>
                          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                            {cleanTime(houseRules.checkOut)}
                          </AppText>
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {typeof houseRules.pets === "boolean" || typeof houseRules.smoking === "boolean" || houseRules.other ? (
                  <AppCard>
                    <AppStack gap={3}>
                      {typeof houseRules.pets === "boolean" ? (
                        <View style={styles.ruleStatusRow}>
                          <View style={styles.rowStart}>
                            <PawPrint color={colors.softText} size={16} />
                            <AppText variant="bodySmall" weight="semiBold">
                              Pets
                            </AppText>
                          </View>
                          <View style={[styles.ruleBadge, houseRules.pets ? styles.ruleBadgeYes : styles.ruleBadgeNo]}>
                            <AppText variant="caption" weight="bold" tone={houseRules.pets ? "success" : "danger"}>
                              {houseRules.pets ? "Allowed" : "Not allowed"}
                            </AppText>
                          </View>
                        </View>
                      ) : null}
                      {typeof houseRules.smoking === "boolean" ? (
                        <View style={styles.ruleStatusRow}>
                          <View style={styles.rowStart}>
                            <Cigarette color={colors.softText} size={16} />
                            <AppText variant="bodySmall" weight="semiBold">
                              Smoking
                            </AppText>
                          </View>
                          <View style={[styles.ruleBadge, houseRules.smoking ? styles.ruleBadgeNo : styles.ruleBadgeYes]}>
                            <AppText variant="caption" weight="bold" tone={houseRules.smoking ? "danger" : "success"}>
                              {houseRules.smoking ? "Not allowed" : "Allowed"}
                            </AppText>
                          </View>
                        </View>
                      ) : null}
                      {houseRules.other ? (
                        <View style={styles.ruleStatusRow}>
                          <View style={styles.rowStart}>
                            <ShieldCheck color={colors.softText} size={16} />
                            <AppText variant="bodySmall" weight="semiBold">
                              Other
                            </AppText>
                          </View>
                          <AppText variant="bodySmall" tone="muted" style={styles.ruleOther} numberOfLines={3}>
                            {houseRules.other}
                          </AppText>
                        </View>
                      ) : null}
                    </AppStack>
                  </AppCard>
                ) : null}

                {houseRules.safetyMeasures && houseRules.safetyMeasures.length > 0 ? (
                  <AppStack gap={2}>
                    <AppText variant="caption" weight="bold" tone="muted" style={styles.layoutEyebrow}>
                      SAFETY MEASURES
                    </AppText>
                    <View style={styles.chipWrap}>
                      {houseRules.safetyMeasures.map((s, i) => (
                        <View key={i} style={styles.chip}>
                          <AppText variant="caption" tone="default">
                            {labelize(s)}
                          </AppText>
                        </View>
                      ))}
                    </View>
                  </AppStack>
                ) : null}
              </Section>
            ) : null}

            {/* Guest reviews */}
            <Section
              title="Guest reviews"
              icon={<Star color={colors.primary} size={18} />}
              trailing={
                reviewCount > 0 ? (
                  <View style={styles.chip}>
                    <AppText variant="caption" weight="bold" tone="muted">
                      {reviewCount}
                    </AppText>
                  </View>
                ) : undefined
              }
            >
              {reviewsLoading ? (
                <AppText variant="bodySmall" tone="muted">
                  Loading reviews...
                </AppText>
              ) : (
                <AppStack gap={4}>
                  <AppCard>
                    <AppStack gap={4}>
                      <View style={styles.ratingHeader}>
                        <View style={styles.ratingScore}>
                          <AppText variant="title" weight="extraBold" tone="inverse">
                            {reviewAvg.toFixed(1)}
                          </AppText>
                        </View>
                        <View style={styles.flex}>
                          <View style={styles.ratingLabelRow}>
                            <AppText variant="bodySmall" weight="bold">
                              {ratingLabel(reviewAvg)}
                            </AppText>
                            <AppText variant="caption" tone="muted">
                              {reviewCount} {reviewCount === 1 ? "review" : "reviews"}
                            </AppText>
                          </View>
                          <ProgressBar percent={(reviewAvg / 5) * 100} />
                        </View>
                      </View>

                      <AppStack gap={3}>
                        <AppText variant="bodySmall" weight="bold">
                          Categories
                        </AppText>
                        {REVIEW_CATEGORIES.map(({ key, label }) => {
                          const v = (catAvgs?.[key] as number | undefined) ?? 0;
                          return (
                            <View key={key} style={styles.catResultRow}>
                              <AppText variant="caption" tone="muted" numberOfLines={1} style={styles.catResultLabel}>
                                {label}
                              </AppText>
                              <View style={styles.flex}>
                                <ProgressBar percent={(v / 5) * 100} />
                              </View>
                              <AppText variant="caption" weight="bold" style={styles.catResultValue}>
                                {v.toFixed(1)}
                              </AppText>
                            </View>
                          );
                        })}
                      </AppStack>
                    </AppStack>
                  </AppCard>

                  {reviews && reviews.reviews.length > 0 ? (
                    <ReviewsCarousel items={reviews.reviews.slice(0, 12)} />
                  ) : (
                    <AppText variant="bodySmall" tone="muted">
                      No reviews yet. Be the first to review after your stay.
                    </AppText>
                  )}

                  <AppButton title="Write a review" variant="secondary" onPress={() => setReviewSheetVisible(true)} />
                </AppStack>
              )}
            </Section>

            {/* Location */}
            <Section title="Location" icon={<MapPin color={colors.primary} size={18} />}>
              <LocationMapCard latitude={detail.latitude} longitude={detail.longitude} address={location} />
            </Section>

            {/* Nearby services */}
            {parsed.nearby.length > 0 || parsed.nearbyFacilities.length > 0 ? (
              <Section
                title="Nearby services"
                icon={<Navigation color={colors.primary} size={18} />}
                trailing={
                  <View style={styles.chip}>
                    <AppText variant="caption" weight="bold" tone="muted">
                      {parsed.nearby.length + parsed.nearbyFacilities.length}
                    </AppText>
                  </View>
                }
              >
                <AppStack gap={3}>
                  {parsed.nearbyFacilities.map((f, i) => {
                    const fi = facilityIcon(f.type || "");
                    const Icon = fi.Icon;
                    return (
                      <View key={i} style={styles.facilityCard}>
                        <View style={[styles.facilityIcon, { backgroundColor: fi.bg }]}>
                          <Icon color={fi.color} size={20} />
                        </View>
                        <View style={styles.flex}>
                          {f.name ? (
                            <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
                              {f.name}
                            </AppText>
                          ) : null}
                          {f.type || f.ownership ? (
                            <View style={styles.facilityTags}>
                              {f.type ? (
                                <View style={styles.facilityTag}>
                                  <AppText variant="caption" weight="semiBold" tone="primary">
                                    {labelize(f.type)}
                                  </AppText>
                                </View>
                              ) : null}
                              {f.ownership ? (
                                <View style={styles.facilityTagMuted}>
                                  <AppText variant="caption" weight="semiBold" tone="muted">
                                    {labelize(f.ownership)}
                                  </AppText>
                                </View>
                              ) : null}
                            </View>
                          ) : null}
                          {f.distanceKm != null ? (
                            <AppText variant="caption" tone="soft">
                              {f.distanceKm} km away
                            </AppText>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                  {parsed.nearby.length > 0 ? <AmenityGrid items={parsed.nearby.map(labelize)} rows={2} /> : null}
                </AppStack>
              </Section>
            ) : null}
          </AppStack>
        </View>
      </ScrollView>

      <BottomActionBar>
        <View style={styles.reserveRow}>
          <View style={styles.flex}>
            {grossBasePrice != null ? (
              <AmountText amount={grossBasePrice} currency={detail.currency || "TZS"} variant="titleSm" weight="bold" tone="primary" />
            ) : (
              <AppText variant="bodySmall" weight="semiBold" tone="muted">
                Price on request
              </AppText>
            )}
            <AppText variant="caption" tone="soft">
              per night
            </AppText>
          </View>
          <View style={styles.reserveBtn}>
            <AppButton title="Request booking" onPress={() => goToBooking(null)} />
          </View>
        </View>
      </BottomActionBar>

      <CalendarRangeSheet
        visible={calendarVisible}
        checkIn={checkIn}
        checkOut={checkOut}
        onClose={() => setCalendarVisible(false)}
        onApply={applyDates}
      />

      <ReviewSheet
        visible={reviewSheetVisible}
        submitting={reviewSubmitting}
        error={reviewError}
        onClose={() => setReviewSheetVisible(false)}
        onSubmit={submitReview}
      />
    </View>
  );
}

function HeroGallery({
  images,
  title,
  location,
  topInset,
  onBack,
  saved,
  onToggleSave
}: {
  images: string[];
  title: string;
  location: string;
  topInset: number;
  onBack: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
}) {
  const { width } = useWindowDimensions();
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlatList<string>>(null);
  const indexRef = useRef(0);
  const pausedRef = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [index, setIndex] = useState(0);

  const cardWidth = width - spacing[4] * 2;
  const cardHeight = Math.round(cardWidth * 1.12);

  useEffect(() => {
    if (reducedMotion || images.length <= 1 || cardWidth <= 0) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const next = (indexRef.current + 1) % images.length;
      indexRef.current = next;
      setIndex(next);
      listRef.current?.scrollToOffset({ offset: next * cardWidth, animated: true });
    }, HERO_ROTATE_MS);
    return () => clearInterval(id);
  }, [images.length, cardWidth, reducedMotion]);

  useEffect(() => {
    return () => {
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const i = cardWidth > 0 ? Math.round(e.nativeEvent.contentOffset.x / cardWidth) : 0;
    indexRef.current = i;
    setIndex(i);
  }

  function pause() {
    pausedRef.current = true;
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }
  function resumeSoon() {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      pausedRef.current = false;
    }, HERO_RESUME_MS);
  }

  return (
    <View style={[styles.heroCard, { marginTop: topInset + spacing[2], height: cardHeight }]}>
      {images.length > 0 ? (
        <FlatList
          ref={listRef}
          data={images}
          keyExtractor={(item, i) => `${i}-${item}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScroll}
          onScrollBeginDrag={pause}
          onScrollEndDrag={resumeSoon}
          renderItem={({ item }) => <Image source={{ uri: item }} style={{ width: cardWidth, height: cardHeight }} resizeMode="cover" />}
        />
      ) : (
        <View style={[styles.heroPlaceholder, { width: cardWidth, height: cardHeight }]}>
          <AppText variant="bodySmall" tone="muted">
            Photos coming soon
          </AppText>
        </View>
      )}

      {/* Scrim so the overlaid title stays readable */}
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <LinearGradient id="heroScrim" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.4" stopColor="#000000" stopOpacity="0" />
            <Stop offset="1" stopColor="#000000" stopOpacity="0.72" />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#heroScrim)" />
      </Svg>

      <Pressable accessibilityRole="button" onPress={onBack} style={styles.heroBack}>
        <ArrowLeft color={colors.ink} size={22} />
      </Pressable>

      <View style={styles.heroTopRight}>
        {images.length > 0 ? (
          <View style={styles.heroCounter}>
            <AppText variant="caption" weight="bold" tone="inverse">
              {index + 1} / {images.length}
            </AppText>
          </View>
        ) : null}

        {onToggleSave ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={saved ? "Remove from saved" : "Save"}
            onPress={onToggleSave}
            style={[styles.heroSaveButton, saved && styles.heroSaveButtonOn]}
          >
            <Bookmark color={saved ? colors.white : colors.ink} size={18} fill={saved ? colors.white : "transparent"} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.heroOverlay}>
        {images.length > 1 ? (
          <View style={styles.heroDots}>
            {images.slice(0, 8).map((_, i) => (
              <View key={i} style={[styles.heroDot, i === index && styles.heroDotActive]} />
            ))}
          </View>
        ) : null}
        <AppText variant="headline" weight="extraBold" tone="inverse" numberOfLines={2}>
          {title}
        </AppText>
        {location ? (
          <View style={styles.heroLocation}>
            <MapPin color={colors.white} size={15} />
            <AppText variant="bodySmall" tone="inverse" numberOfLines={1} style={styles.flex}>
              {location}
            </AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function Section({ title, icon, trailing, children }: { title: string; icon?: ReactNode; trailing?: ReactNode; children: ReactNode }) {
  return (
    <AppStack gap={3}>
      <View style={styles.sectionTitleRow}>
        <View style={styles.sectionTitleLeft}>
          {icon}
          <AppText variant="titleSm" weight="bold">
            {title}
          </AppText>
        </View>
        {trailing}
      </View>
      {children}
    </AppStack>
  );
}

function floorName(n: number): string {
  if (n <= 0) return "Ground floor";
  const suffixes = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]} floor`;
}

function floorLevel(n: number): string {
  return n <= 0 ? "G" : String(n);
}

/**
 * Turns the floors a room type sits on into a compact chip label.
 * One floor reads "Ground floor"; several read "Floors G, 1, 2".
 */
function formatFloors(floors: number[]): string | null {
  if (!floors.length) return null;
  if (floors.length === 1) return floorName(floors[0]);
  return `Floors ${floors.map(floorLevel).join(", ")}`;
}

function RoomCard({
  index,
  room,
  commission,
  currency,
  propertyId,
  checkIn,
  checkOut,
  onPickDates,
  onBook
}: {
  index: number;
  room: NormalizedRoom;
  commission: number;
  currency: string;
  propertyId: number;
  checkIn: string;
  checkOut: string;
  onPickDates: () => void;
  onBook: () => void;
}) {
  const [roomAvail, setRoomAvail] = useState<number | null | undefined>(undefined);
  const [roomAvailLoading, setRoomAvailLoading] = useState(false);

  useEffect(() => {
    if (!checkIn || !checkOut) {
      setRoomAvail(undefined);
      return;
    }
    let cancelled = false;
    setRoomAvailLoading(true);
    fetchAvailabilityRange(propertyId, checkIn, checkOut, room.roomType)
      .then((res) => {
        if (!cancelled) setRoomAvail(res.items[0]?.roomsAvailable ?? null);
      })
      .catch(() => {
        if (!cancelled) setRoomAvail(null);
      })
      .finally(() => {
        if (!cancelled) setRoomAvailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [propertyId, checkIn, checkOut, room.roomType]);

  const soldOut = roomAvail === 0;
  const floorChip = formatFloors(room.floors);

  return (
    <AppCard>
      <AppStack gap={3}>
        <View style={styles.roomHead}>
          <AppText variant="title" weight="extraBold" style={styles.roomIndex}>
            {String(index + 1).padStart(2, "0")}
          </AppText>
          <View style={styles.flex}>
            <View style={styles.roomTitleRow}>
              <DoorClosed color={colors.softText} size={16} />
              <AppText variant="titleSm" weight="bold" numberOfLines={2} style={styles.flex}>
                {labelize(room.roomType)}
              </AppText>
            </View>
            {room.floors.length > 0 ? (
              <View style={styles.floorRow} accessible accessibilityLabel={floorChip || ""}>
                <View style={styles.floorPin}>
                  <MapPin color={colors.primary} size={11} />
                </View>
                <AppText variant="caption" tone="soft" weight="semiBold">
                  {room.floors.length === 1 ? "Floor" : "Floors"}
                </AppText>
                {room.floors.map((f) => (
                  <View key={f} style={styles.floorToken}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      {floorLevel(f)}
                    </AppText>
                  </View>
                ))}
              </View>
            ) : null}
          </View>
          {room.roomsCount ? (
            <View style={styles.chip}>
              <AppText variant="caption" weight="bold" tone="muted">
                {room.roomsCount} {room.roomsCount === 1 ? "room" : "rooms"}
              </AppText>
            </View>
          ) : null}
        </View>

        {room.bedsSummary ? (
          <View style={styles.roomBeds}>
            <BedDouble color={colors.softText} size={16} />
            <View style={styles.flex}>
              <AppText variant="bodySmall">{room.bedsSummary}</AppText>
              {room.bedDimensions ? (
                <AppText variant="caption" tone="soft">
                  {room.bedDimensions}
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}

        {room.description ? (
          <View style={styles.roomDesc}>
            <AppText variant="bodySmall" tone="muted">
              {room.description}
            </AppText>
          </View>
        ) : null}

        {room.amenities.length > 0 ? (
          <AmenityGrid items={room.amenities.slice(0, 10).map(labelize)} />
        ) : null}

        {room.bathItems.length > 0 || room.bathPrivate ? (
          <View style={styles.roomBath}>
            <View style={styles.roomBathHead}>
              <Bath color={colors.softText} size={15} />
              <AppText variant="bodySmall" weight="semiBold">
                Bathroom
              </AppText>
              {room.bathPrivate === "yes" ? (
                <View style={styles.bathBadgePrivate}>
                  <Lock color={colors.success} size={12} />
                  <AppText variant="caption" weight="bold" tone="success">
                    Private
                  </AppText>
                </View>
              ) : room.bathPrivate === "no" ? (
                <View style={styles.bathBadgeShared}>
                  <Share2 color={colors.info} size={12} />
                  <AppText variant="caption" weight="bold" style={styles.sharedText}>
                    Shared
                  </AppText>
                </View>
              ) : null}
            </View>
            {room.bathItems.length > 0 ? <AmenityGrid items={room.bathItems.map(labelize)} rows={2} /> : null}
          </View>
        ) : null}

        {room.smoking ? (
          <View style={styles.rowStart}>
            {room.smoking === "yes" ? (
              <CheckCircle2 color={colors.success} size={15} />
            ) : (
              <Cigarette color={colors.danger} size={15} />
            )}
            <AppText variant="caption" tone="muted">
              {room.smoking === "yes" ? "Smoking allowed" : "No smoking"}
            </AppText>
          </View>
        ) : null}

        <View style={styles.bookStrip}>
          {!checkIn || !checkOut ? (
            <Pressable accessibilityRole="button" onPress={onPickDates} style={[styles.statusPill, styles.statusHint]}>
              <CalendarDays color={colors.primary} size={13} />
              <AppText variant="caption" weight="bold" tone="primary">
                Pick dates for availability
              </AppText>
            </Pressable>
          ) : roomAvailLoading ? (
            <View style={[styles.statusPill, styles.statusHint]}>
              <AppText variant="caption" weight="semiBold" tone="muted">
                Checking availability...
              </AppText>
            </View>
          ) : roomAvail != null ? (
            <View style={[styles.statusPill, roomAvail > 0 ? styles.statusOk : styles.statusNone]}>
              {roomAvail > 0 ? (
                <CheckCircle2 color={colors.success} size={13} />
              ) : (
                <XCircle color={colors.mutedText} size={13} />
              )}
              <AppText variant="caption" weight="bold" tone={roomAvail > 0 ? "success" : "muted"}>
                {roomAvail > 0 ? `${roomAvail} available for your dates` : "Sold out for your dates"}
              </AppText>
            </View>
          ) : null}

          <View style={styles.bookRow}>
            <View style={styles.flex}>
              {room.pricePerNight != null ? (
                <AmountText amount={priceWithCommission(room.pricePerNight, commission)} currency={currency} variant="title" weight="extraBold" tone="primary" />
              ) : (
                <AppText variant="bodySmall" weight="semiBold" tone="muted">
                  Price on request
                </AppText>
              )}
              <View style={styles.roomPriceMeta}>
                <AppText variant="caption" tone="soft">
                  per night
                </AppText>
                {room.discountLabel ? (
                  <View style={styles.discountChip}>
                    <Tags color={colors.success} size={11} />
                    <AppText variant="caption" weight="bold" tone="success">
                      {room.discountLabel}
                    </AppText>
                  </View>
                ) : null}
              </View>
            </View>
            <View style={styles.payBtn}>
              <AppButton title={soldOut ? "Sold out" : "Pay now"} disabled={soldOut} onPress={onBook} />
            </View>
          </View>
        </View>
      </AppStack>
    </AppCard>
  );
}

function BuildingLayout({ detail }: { detail: PublicPropertyDetail }) {
  const floorCount = useMemo(() => {
    const set = new Set<number>();
    (detail.roomsSpec || []).forEach((r, i) => {
      for (const f of normalizeRoom(r, i, detail.currency, detail.basePrice).floors) set.add(f);
    });
    return set.size;
  }, [detail.roomsSpec, detail.currency, detail.basePrice]);

  const buildingType = detail.buildingType
    ? labelize(String(detail.buildingType))
    : (detail.totalFloors || floorCount) > 1
      ? "Multi storey"
      : "Single storey";

  const summary: Array<{ icon: ReactNode; label: string; value: string }> = [
    { icon: <Building2 color={colors.primary} size={18} />, label: "Building", value: buildingType },
    { icon: <Layers color={colors.primary} size={18} />, label: "Floors", value: String(detail.totalFloors || floorCount || 1) }
  ];
  if (detail.totalBedrooms) summary.push({ icon: <BedDouble color={colors.primary} size={18} />, label: "Bedrooms", value: String(detail.totalBedrooms) });
  if (detail.totalBathrooms) summary.push({ icon: <Bath color={colors.primary} size={18} />, label: "Bathrooms", value: String(detail.totalBathrooms) });
  if (detail.maxGuests) summary.push({ icon: <Users color={colors.primary} size={18} />, label: "Max guests", value: String(detail.maxGuests) });

  return (
    <AppCard>
      <AppStack gap={4}>
        <View style={styles.layoutHeader}>
          <View style={styles.layoutIconWrap}>
            <Building2 color={colors.primary} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" weight="bold" tone="primary" style={styles.layoutEyebrow}>
              PROPERTY STRUCTURE
            </AppText>
            <AppText variant="titleSm" weight="bold">
              Building Layout
            </AppText>
          </View>
          <View style={styles.ownerBadge}>
            <View style={styles.ownerDot} />
            <AppText variant="caption" weight="semiBold" tone="success">
              Owner declared
            </AppText>
          </View>
        </View>

        <View style={styles.statGrid}>
          {summary.map((s) => (
            <View key={s.label} style={styles.statTile}>
              <View style={styles.statIcon}>{s.icon}</View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                  {s.value}
                </AppText>
                <AppText variant="caption" tone="muted" numberOfLines={1}>
                  {s.label}
                </AppText>
              </View>
            </View>
          ))}
        </View>

        <AppText variant="caption" tone="muted">
          Each room below shows the floor it sits on.
        </AppText>
      </AppStack>
    </AppCard>
  );
}

function ReviewItemCard({ review }: { review: PropertyReview }) {
  return (
    <AppCard>
      <AppStack gap={2}>
        <View style={styles.reviewHead}>
          <View style={styles.flex}>
            <View style={styles.reviewerRow}>
              <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                {review.user?.name || "Guest"}
              </AppText>
              {review.isVerified ? <BadgeCheck color={colors.primary} size={14} /> : null}
            </View>
            <AppText variant="caption" tone="soft">
              {new Date(review.createdAt).toLocaleDateString()}
            </AppText>
          </View>
          <Stars value={review.rating} size={14} />
        </View>
        {review.title ? (
          <AppText variant="bodySmall" weight="semiBold">
            {review.title}
          </AppText>
        ) : null}
        {review.comment ? (
          <AppText variant="bodySmall" tone="muted">
            {review.comment}
          </AppText>
        ) : null}
        {review.ownerResponse ? (
          <View style={styles.ownerResponse}>
            <AppText variant="caption" weight="bold" tone="primary">
              Owner response
            </AppText>
            <AppText variant="caption" tone="muted">
              {review.ownerResponse}
            </AppText>
          </View>
        ) : null}
      </AppStack>
    </AppCard>
  );
}

function ReviewsCarousel({ items }: { items: PropertyReview[] }) {
  const { width } = useWindowDimensions();
  const cardWidth = width - spacing[4] * 2;
  const [index, setIndex] = useState(0);

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    setIndex(cardWidth > 0 ? Math.round(e.nativeEvent.contentOffset.x / cardWidth) : 0);
  }

  if (items.length === 1) {
    return <ReviewItemCard review={items[0]} />;
  }

  return (
    <View>
      <ScrollView
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={cardWidth}
        onMomentumScrollEnd={onScroll}
        scrollEventThrottle={16}
      >
        {items.map((r) => (
          <View key={r.id} style={{ width: cardWidth }}>
            <ReviewItemCard review={r} />
          </View>
        ))}
      </ScrollView>
      <View style={styles.reviewDots}>
        {items.map((_, i) => (
          <View key={i} style={[styles.reviewDot, i === index && styles.reviewDotActive]} />
        ))}
      </View>
    </View>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${p}%` }]} />
    </View>
  );
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  const rounded = Math.round(value);
  return (
    <View style={styles.starsRow}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={size}
          color="#f59e0b"
          fill={i < rounded ? "#f59e0b" : "transparent"}
        />
      ))}
    </View>
  );
}

function FloatingBack({ onPress, top }: { onPress: () => void; top: number }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.back, { top: top + spacing[2] }]}>
      <ArrowLeft color={colors.ink} size={22} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  scroll: {
    paddingBottom: 120
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[3],
    padding: spacing[5]
  },
  body: {
    padding: spacing[4]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  heroCard: {
    marginHorizontal: spacing[4],
    borderRadius: radius.xl,
    overflow: "hidden",
    backgroundColor: colors.brand[50],
    ...shadows.sheet
  },
  heroPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  heroBack: {
    position: "absolute",
    top: spacing[3],
    left: spacing[3],
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)"
  },
  heroTopRight: {
    position: "absolute",
    top: spacing[3],
    right: spacing[3],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  heroCounter: {
    borderRadius: radius.full,
    backgroundColor: "rgba(2,6,23,0.55)",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  heroSaveButton: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)"
  },
  heroSaveButtonOn: {
    backgroundColor: colors.primary
  },
  heroOverlay: {
    position: "absolute",
    left: spacing[4],
    right: spacing[4],
    bottom: spacing[4],
    gap: spacing[2]
  },
  heroDots: {
    flexDirection: "row",
    gap: spacing[1],
    marginBottom: spacing[1]
  },
  heroDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.5)"
  },
  heroDotActive: {
    width: 18,
    backgroundColor: colors.white
  },
  heroLocation: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  typePill: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  verifiedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  sectionTitleLeft: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  aboutCard: {
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    ...shadows.card
  },
  aboutHeader: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.surface
  },
  aboutTitleWrap: {
    minWidth: 0,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  aboutIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  aboutDivider: {
    height: 1,
    backgroundColor: colors.border
  },
  aboutText: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    lineHeight: 25
  },
  dayWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  dateFields: {
    flexDirection: "row",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[2]
  },
  dateField: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    ...shadows.card
  },
  dayChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  dayChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  availResult: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  availIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center"
  },
  availIconOk: {
    backgroundColor: colors.success
  },
  availIconNone: {
    backgroundColor: colors.mutedText
  },
  availOk: {
    borderColor: "#86efac",
    backgroundColor: "#dcfce7"
  },
  availNone: {
    borderColor: colors.border,
    backgroundColor: "#f1f5f9"
  },
  statGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: spacing[2]
  },
  statTile: {
    width: "48.5%",
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  layoutHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  layoutIconWrap: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  layoutEyebrow: {
    letterSpacing: 1.2
  },
  ownerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 4
  },
  ownerDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.success
  },
  floorRow: {
    marginTop: spacing[2],
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing[1]
  },
  floorPin: {
    width: 18,
    height: 18,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  floorToken: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: spacing[1],
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  chip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  chevronButton: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  trustCard: {
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    ...shadows.card
  },
  trustHero: {
    alignItems: "center",
    gap: spacing[2],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[5]
  },
  trustIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  trustEyebrow: {
    letterSpacing: 1.1
  },
  trustTitle: {
    textAlign: "center"
  },
  trustSteps: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: spacing[1],
    marginTop: spacing[1]
  },
  trustStepWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  trustStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: 5
  },
  trustStepLine: {
    width: 14,
    height: 1,
    backgroundColor: colors.brand[200]
  },
  trustInfoTile: {
    flexGrow: 1,
    flexBasis: "47%",
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  trustInfoTileWide: {
    flexBasis: "100%"
  },
  trustInfoLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  trustInfoLabelText: {
    textTransform: "uppercase",
    letterSpacing: 0.7
  },
  trustChecklist: {
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[4]
  },
  trustChecklistToggle: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  trustChecklistChevron: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  trustChecklistGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  trustChecklistItem: {
    width: "48.5%",
    minWidth: 0,
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  trustFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingTop: spacing[1]
  },
  certificateButton: {
    marginHorizontal: spacing[4],
    marginBottom: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[200],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  certificateButtonIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[200],
    alignItems: "center",
    justifyContent: "center"
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.42)"
  },
  certificateSheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing[5],
    gap: spacing[3]
  },
  certificateSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  certificateTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  certificateSheetIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[200],
    alignItems: "center",
    justifyContent: "center"
  },
  certificateContent: {
    gap: spacing[4],
    paddingTop: spacing[1]
  },
  modalCloseButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  qrFrame: {
    alignSelf: "center",
    width: 210,
    height: 210,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  qrImage: {
    width: "100%",
    height: "100%"
  },
  certificateFacts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3]
  },
  certificateNote: {
    textAlign: "center",
    lineHeight: 18
  },
  includedHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    marginBottom: spacing[3]
  },
  includedIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  includedChevron: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  includedHint: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 5
  },
  includedScrollContent: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  includedGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  includedTile: {
    width: "48.5%",
    minHeight: 46,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  includedTileScroll: {
    width: 210
  },
  payRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    paddingVertical: spacing[3]
  },
  payRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border
  },
  payLogos: {
    flexShrink: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: spacing[2]
  },
  logoBadge: {
    height: 34,
    minWidth: 48,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing[2]
  },
  logoImg: {
    width: 40,
    height: 22
  },
  inlineNote: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  startingLabel: {
    letterSpacing: 1
  },
  startingNote: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2]
  },
  ruleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  ruleLabel: {
    width: 84
  },
  timesRow: {
    flexDirection: "row",
    gap: spacing[3]
  },
  timeTile: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  ruleStatusRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  ruleBadge: {
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  ruleBadgeYes: {
    backgroundColor: "#dcfce7"
  },
  ruleBadgeNo: {
    backgroundColor: "#fee2e2"
  },
  ruleOther: {
    flex: 1,
    minWidth: 0,
    textAlign: "right"
  },
  starsRow: {
    flexDirection: "row",
    gap: 2
  },
  ratingHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  ratingHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  ratingScore: {
    minWidth: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  ratingLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    marginBottom: spacing[2]
  },
  progressTrack: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: "#e2e8f0",
    overflow: "hidden"
  },
  progressFill: {
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.primary
  },
  categoryDisplayRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  catResultRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  catResultLabel: {
    width: 92
  },
  catResultValue: {
    minWidth: 28,
    textAlign: "right"
  },
  categoriesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: spacing[3]
  },
  categoryCell: {
    width: "50%",
    minWidth: 0,
    gap: spacing[1],
    paddingRight: spacing[3]
  },
  categoryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  categoryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing[3]
  },
  categoryItem: {
    width: "50%",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing[1],
    paddingRight: spacing[3]
  },
  reviewHead: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2]
  },
  reviewDots: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing[1],
    marginTop: spacing[3]
  },
  reviewDot: {
    width: 6,
    height: 6,
    borderRadius: radius.full,
    backgroundColor: colors.border
  },
  reviewDotActive: {
    width: 18,
    backgroundColor: colors.primary
  },
  reviewerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  ownerResponse: {
    gap: spacing[1],
    borderLeftWidth: 2,
    borderLeftColor: colors.brand[200],
    paddingLeft: spacing[3],
    marginTop: spacing[1]
  },
  roomRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  roomHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2]
  },
  roomIndex: {
    color: colors.border
  },
  roomTitleRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  roomBeds: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2]
  },
  roomDesc: {
    borderRadius: radius.md,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[3]
  },
  roomBath: {
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  },
  roomBathHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap"
  },
  bathBadgePrivate: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.sm,
    backgroundColor: "#dcfce7",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  bathBadgeShared: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.sm,
    backgroundColor: "#eaf2ff",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  sharedText: {
    color: colors.info
  },
  rowStart: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  roomFooter: {
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing[3]
  },
  bookStrip: {
    gap: spacing[3],
    marginTop: spacing[1],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#f8fafc",
    padding: spacing[4]
  },
  bookRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  statusPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  statusHint: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  statusOk: {
    backgroundColor: "#dcfce7"
  },
  statusNone: {
    backgroundColor: "#e2e8f0"
  },
  roomFooterRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  roomPriceMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    flexWrap: "wrap"
  },
  roomAvailHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  roomAvailChip: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  roomAvailOk: {
    backgroundColor: "#dcfce7"
  },
  roomAvailNone: {
    backgroundColor: "#f1f5f9"
  },
  discountChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "#dcfce7",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  noDiscountChip: {
    alignSelf: "flex-start",
    marginTop: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  payBtn: {
    width: 132
  },
  amenityWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  amenityChip: {
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  locationCard: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  facilityCard: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  facilityIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center"
  },
  facilityTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2],
    marginTop: spacing[1]
  },
  facilityTag: {
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  facilityTagMuted: {
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  back: {
    position: "absolute",
    left: spacing[4],
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)"
  },
  reserveRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  reserveBtn: {
    flex: 1,
    maxWidth: 200
  }
});
