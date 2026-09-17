"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  MapPin,
  Calendar,
  Users,
  ChevronLeft,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Info,
  Car,
  Navigation,
  Edit2,
  Plane,
  Hotel,
  UserRound,
  Phone,
  Mail,
  Globe,
  ChevronRight,
} from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";
import DatePicker from "../../../../components/ui/DatePicker";
import LocationPickerModal from "../../../../components/ui/LocationPickerModal";
import { TANZANIA_LOCATIONS } from "../../../../lib/tanzania-locations";
import { 
  getPropertyCommission, 
  calculatePriceWithCommission 
} from "../../../../lib/priceUtils";
import {
  calculateTransportFare,
  type Location,
  type TransportVehicleType,
  getVehicleTypeLabel,
} from "../../../../lib/transportFareCalculator";
import { useCurrency } from "@/contexts/CurrencyContext";
import { convertFromTzs, formatMoney } from "@/lib/money";

// Tanzania locations are imported from lib/tanzania-locations.ts

/** Longest ride we price at checkout; anything further is treated as a wrong pickup or property pin. */
const MAX_RIDE_KM = 150;

/** Mapbox ids look like "poi.123", "address.9", "place.77". Whole cities, regions and countries are too vague for a pickup. */
function isVagueGeocodeId(id: unknown): boolean {
  const kind = String(id ?? "").split(".")[0];
  return kind === "place" || kind === "region" || kind === "country" || kind === "district" || kind === "postcode";
}

/** 95 min -> "1 h 35 min" */
function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Owners often type names in capitals; show "RRL HOTEL" as "Rrl Hotel" only when the whole value is uppercase. */
function softTitleCase(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || s !== s.toUpperCase()) return s;
  return s
    .split(/\s+/)
    .map((w) => (w.length <= 3 ? w : w.charAt(0) + w.slice(1).toLowerCase().replace(/-(\w)/g, (_m, c: string) => ` ${c.toUpperCase()}`)))
    .join(" ");
}

/** Nationality suggestions: Tanzania and the region first, then common visitor origins. Anything else is typed freely. */
const NATIONALITIES = [
  "Tanzanian", "Kenyan", "Ugandan", "Rwandan", "Burundian", "Congolese", "Zambian", "Malawian", "Mozambican",
  "South Sudanese", "Somali", "Ethiopian", "Comorian", "South African", "Zimbabwean", "Botswanan", "Namibian",
  "Nigerian", "Ghanaian", "Egyptian", "Moroccan", "Algerian", "Tunisian", "Sudanese", "Senegalese", "Cameroonian",
  "Ivorian", "Malagasy", "Mauritian", "Angolan",
  "British", "American", "Canadian", "German", "French", "Italian", "Spanish", "Dutch", "Belgian", "Swiss",
  "Swedish", "Norwegian", "Danish", "Finnish", "Irish", "Polish", "Portuguese", "Russian", "Ukrainian", "Czech",
  "Austrian", "Chinese", "Indian", "Pakistani", "Japanese", "Korean", "Emirati", "Saudi", "Omani", "Qatari",
  "Israeli", "Turkish", "Iranian", "Australian", "New Zealander", "Brazilian", "Mexican", "Argentine",
];

type Property = {
  id: number;
  slug: string;
  title: string;
  type: string;
  regionName: string | null;
  district: string | null;
  city: string | null;
  primaryImage: string | null;
  basePrice: number | null;
  currency: string | null;
  maxGuests: number | null;
  totalBedrooms: number | null;
  totalBathrooms: number | null;
  latitude: number | null;
  longitude: number | null;
  roomsSpec?: any; // Room specifications array
  services?: any; // Can include commissionPercent override
};

type BookingData = {
  propertyId: number;
  checkIn: string;
  checkOut: string | null;
  adults: number;
  children: number;
  pets: number;
  rooms: number;
};

export default function BookingConfirmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Currency display — presentation only. The actual charge is always in TZS.
  const { currency: displayCurrency, rates: fxRates } = useCurrency();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [property, setProperty] = useState<Property | null>(null);
  const [bookingData, setBookingData] = useState<BookingData | null>(null);
  const [systemCommission, setSystemCommission] = useState<number>(0);

  const availabilityAbortRef = useRef<AbortController | null>(null);
  const availabilityDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [availabilityState, setAvailabilityState] = useState<{
    status: "idle" | "checking" | "available" | "unavailable";
    message?: string;
  }>({ status: "idle" });
  
  // Guest information form
  const [guestName, setGuestName] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);
  const [nationality, setNationality] = useState("");
  const [sex, setSex] = useState<"Male" | "Female" | "Other" | "">("");
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [nationalityCursor, setNationalityCursor] = useState(0);
  const [ageGroup] = useState<"Adult" | "Child" | "">("Adult");
  const specialRequests = "";
  /** Set when details were prefilled from the signed-in account */
  const [prefilledFromAccount, setPrefilledFromAccount] = useState(false);

  // Signed-in guests: prefill name, phone, email (and nationality/gender when on file).
  // Only empty fields are filled, so nothing the guest typed is overwritten.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/account/me", { credentials: "include", cache: "no-store" });
        if (!res.ok) return; // not signed in: leave the form empty
        const json = await res.json().catch(() => null);
        const me = json?.data ?? json ?? null;
        if (!alive || !me || typeof me !== "object") return;
        const name = String(me.fullName || me.name || "").trim();
        const phone = String(me.phone || "").trim();
        const email = String(me.email || "").trim();
        const nat = String(me.nationality || "").trim();
        const g = String(me.gender || "").trim().toLowerCase();
        if (name) setGuestName((v) => v || name);
        if (phone) setGuestPhone((v) => v || normalizeTzPhoneForApi(phone) || sanitizePhoneInput(phone));
        if (email) setGuestEmail((v) => v || email);
        if (nat) setNationality((v) => (v ? v : sanitizeNationalityInput(nat)));
        if (g) setSex((v) => (v ? v : g.startsWith("m") ? "Male" : g.startsWith("f") ? "Female" : "Other"));
        if (name || phone || email) {
          setPhoneTouched(Boolean(phone));
          setEmailTouched(Boolean(email));
          setPrefilledFromAccount(true);
        }
      } catch {
        /* offline or signed out: the guest fills the form by hand */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  
  // Transportation
  const [includeTransport, setIncludeTransport] = useState(false);
  const [transportGate, setTransportGate] = useState<{ enabled: boolean; reason: string | null } | null>(null);
  const [transportVehicleType, setTransportVehicleType] = useState<TransportVehicleType>("CAR");
  const [pickupMode, setPickupMode] = useState<"current" | "arrival" | "manual">("current");
  const [pickupMethodChosen, setPickupMethodChosen] = useState(false);
  const [pickupPresetId, setPickupPresetId] = useState<string>("");
  const [locationPickerOpen, setLocationPickerOpen] = useState(false);
  const pickupAddressRef = useRef<HTMLInputElement | null>(null);
  const [currentPickupNeedsConfirm, setCurrentPickupNeedsConfirm] = useState(false);
  const [currentPickupConfirmed, setCurrentPickupConfirmed] = useState(false);
  const [transportOriginAddress, setTransportOriginAddress] = useState("");
  const [transportOriginLat, setTransportOriginLat] = useState<number | null>(null);
  const [transportOriginLng, setTransportOriginLng] = useState<number | null>(null);
  const [transportFare, setTransportFare] = useState<number | null>(null);
  const [calculatingFare, setCalculatingFare] = useState(false);
  const [transportPickupError, setTransportPickupError] = useState<string | null>(null);
  // Flexible arrival fields
  const [arrivalType, setArrivalType] = useState<"FLIGHT" | "BUS" | "TRAIN" | "FERRY" | "OTHER" | "">("");
  const [arrivalNumber, setArrivalNumber] = useState("");
  const [transportCompany, setTransportCompany] = useState("");
  const [pickupLocation, setPickupLocation] = useState("");
  const [arrivalDate, setArrivalDate] = useState<string>("");
  const [arrivalTimeHour, setArrivalTimeHour] = useState<string>("");
  const [arrivalTimeMinute, setArrivalTimeMinute] = useState<string>("");
  const [arrivalDatePickerOpen, setArrivalDatePickerOpen] = useState(false);
  const [isGuestSelectorOpen, setIsGuestSelectorOpen] = useState(false);
  const [checkInPickerOpen, setCheckInPickerOpen] = useState(false);
  const [checkOutPickerOpen, setCheckOutPickerOpen] = useState(false);


  const checkInBtnRef = useRef<HTMLButtonElement>(null);
  const checkOutBtnRef = useRef<HTMLButtonElement>(null);
  const arrivalDateBtnRef = useRef<HTMLButtonElement>(null);

  const [selectedRoomCode, setSelectedRoomCode] = useState<string | null>(null);
  const [selectedRoomIndex, setSelectedRoomIndex] = useState<number | null>(null);

  const requiresArrivalInfo = includeTransport && pickupMode === "arrival" && !!pickupPresetId;
  const arrivalTypeLocked = requiresArrivalInfo;

  function sanitizePhoneInput(value: string): string {
    const raw = String(value ?? "");
    const keep = raw.replace(/[^0-9+\s-]/g, "");
    const compact = keep.replace(/-/g, " ").replace(/\s+/g, " ");
    // Allow '+' only at the first character.
    return compact.replace(/\+/g, (m, offset) => (offset === 0 ? m : ""));
  }

  function normalizeTzPhoneForApi(value: string): string | null {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    // Keep only digits (+ allowed but removed for digit parsing)
    const compact = raw.replace(/\s+/g, "").replace(/-/g, "");
    const digits = compact.replace(/^\+/, "").replace(/\D+/g, "");

    // Accept: 9 digits => assume TZ local without leading 0
    if (digits.length === 9) return `+255${digits}`;

    // Accept: 0XXXXXXXXX
    if (digits.length === 10 && digits.startsWith("0")) return `+255${digits.slice(1)}`;

    // Accept: 255XXXXXXXXX or +255XXXXXXXXX
    if (digits.length === 12 && digits.startsWith("255")) return `+255${digits.slice(3)}`;

    return null;
  }

  function isValidEmail(value: string): boolean {
    const v = String(value ?? "").trim();
    if (!v) return true;
    // Simple, practical email validation (server still validates).
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function sanitizeNationalityInput(value: string): string {
    const raw = String(value ?? "");
    // Remove digits; keep letters/spaces/punctuation the user might reasonably type.
    const noDigits = raw.replace(/\d+/g, "");
    return noDigits.replace(/\s+/g, " ");
  }

  const normalizedPhoneForApi = normalizeTzPhoneForApi(guestPhone);
  const normalizedEmailForApi = guestEmail.trim().replace(/\s+/g, "");
  const phoneInlineError = phoneTouched && !normalizedPhoneForApi ? "Enter a valid phone (e.g., +2557XXXXXXXX, 07XXXXXXXX, or 7XXXXXXXX)." : null;
  const emailInlineError = emailTouched && normalizedEmailForApi && !isValidEmail(normalizedEmailForApi) ? "Enter a valid email address." : null;

  const getRoomCodeForAvailabilityCheck = useCallback((): string | null => {
    if (selectedRoomCode) return selectedRoomCode;
    if (selectedRoomIndex === null) return null;

    const spec: any = (property as any)?.roomsSpec;
    let roomTypes: any[] = [];
    if (spec && typeof spec === "object") {
      if (Array.isArray(spec)) roomTypes = spec;
      else if (Array.isArray((spec as any).rooms)) roomTypes = (spec as any).rooms;
    }

    const rt = roomTypes?.[selectedRoomIndex];
    const rawKey = String(rt?.code ?? rt?.roomCode ?? rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
    return rawKey || null;
  }, [property, selectedRoomCode, selectedRoomIndex]);

  const roomsSpecForDeps = (property as any)?.roomsSpec;

  // Load system commission settings (fallback when property has no override)
  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/support/system-settings`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (mounted && json?.commissionPercent !== undefined) {
            const commission = Number(json.commissionPercent);
            setSystemCommission(isNaN(commission) ? 0 : commission);
          }
        }
      } catch {
        // Silently fail - will use 0 as default
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  // Admin-controlled transport coverage gate for this property's area.
  useEffect(() => {
    if (!property?.id) return;
    let mounted = true;
    const load = async () => {
      try {
        const res = await fetch(`/api/public/service-availability/transport?propertyId=${property.id}`, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          if (mounted) setTransportGate({ enabled: !!json.enabled, reason: json.reason ?? null });
        }
      } catch {
        // Fail closed: leave transportGate null, which the toggle treats as locked.
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, [property?.id]);

  const transportLocked = transportGate === null || !transportGate.enabled;

  useEffect(() => {
    if (transportLocked) setIncludeTransport(false);
  }, [transportLocked]);

  useEffect(() => {
    // Get booking data from URL params
    const propertySlug = searchParams?.get("property");
    const checkIn = searchParams?.get("checkIn");
    const checkOut = searchParams?.get("checkOut");
    const adults = searchParams?.get("adults") || "1";
    const children = searchParams?.get("children") || "0";
    const pets = searchParams?.get("pets") || "0";
    const rooms = searchParams?.get("rooms") || "1";
    const roomCode = searchParams?.get("roomCode");
    const roomIndex = searchParams?.get("roomIndex");

    if (!propertySlug || propertySlug.length > 220) {
      setError("Missing or invalid property link");
      setLoading(false);
      return;
    }

    // Set selected room code or index if provided
    if (roomCode) {
      setSelectedRoomCode(roomCode);
      setSelectedRoomIndex(null);
    } else if (roomIndex) {
      const index = Number(roomIndex);
      if (!isNaN(index) && index >= 0) {
        setSelectedRoomIndex(index);
        setSelectedRoomCode(null);
      }
    }

    // Resolve the opaque public key first. The numeric ID remains internal and
    // is only used after the approved property has been returned by the API.
    fetchProperty(propertySlug, {
      checkIn: checkIn || "",
      checkOut: checkOut || "",
      adults: Number(adults) || 1,
      children: Number(children) || 0,
      pets: Number(pets) || 0,
      rooms: Math.max(1, Number(rooms) || 1),
    });
  }, [searchParams]);

  // Cleanup availability checks on unmount
  useEffect(() => {
    return () => {
      if (availabilityDebounceRef.current) clearTimeout(availabilityDebounceRef.current);
      if (availabilityAbortRef.current) availabilityAbortRef.current.abort();
    };
  }, []);

  // Re-check availability when dates/room selection changes (pre-payment validation)
  useEffect(() => {
    if (!bookingData?.propertyId) return;

    const checkInRaw = bookingData.checkIn;
    const checkOutRaw = bookingData.checkOut;

    if (!checkInRaw || !checkOutRaw) {
      setAvailabilityState({ status: "idle" });
      return;
    }

    const checkInDate = new Date(checkInRaw);
    const checkOutDate = new Date(checkOutRaw);
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime()) || checkOutDate <= checkInDate) {
      setAvailabilityState({ status: "idle" });
      return;
    }

    if (availabilityDebounceRef.current) clearTimeout(availabilityDebounceRef.current);
    if (availabilityAbortRef.current) availabilityAbortRef.current.abort();

    setAvailabilityState({ status: "checking" });
    availabilityDebounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      availabilityAbortRef.current = controller;

      try {
        const roomCode = getRoomCodeForAvailabilityCheck();
        const response = await fetch("/api/public/availability/check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            propertyId: bookingData.propertyId,
            checkIn: checkInRaw,
            checkOut: checkOutRaw,
            roomCode: roomCode || null,
          }),
        });

        const contentType = response.headers.get("content-type") || "";
        const payload = contentType.includes("application/json") ? await response.json() : null;

        if (!response.ok) {
          const msg =
            payload?.error ||
            payload?.message ||
            `Availability check failed (HTTP ${response.status})`;
          setAvailabilityState({ status: "unavailable", message: msg });
          return;
        }

        const available = !!payload?.available;
        if (available) {
          setAvailabilityState({ status: "available" });
        } else if (payload?.closed?.message) {
          // The property closed these dates. Say that, rather than implying the
          // rooms are taken when they are not.
          setAvailabilityState({ status: "unavailable", message: payload.closed.message });
        } else {
          const summary = payload?.summary;
          const msg =
            typeof summary?.totalAvailableRooms === "number" && typeof summary?.totalAvailableBeds === "number"
              ? summary.totalAvailableRooms === 0 && summary.totalAvailableBeds === 0
                ? "No availability for these dates (0 rooms, 0 beds)."
                : `Limited availability: ${summary.totalAvailableRooms} rooms, ${summary.totalAvailableBeds} beds.`
              : "No availability for these dates.";
          setAvailabilityState({ status: "unavailable", message: msg });
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setAvailabilityState({
          status: "unavailable",
          message: "Could not verify availability right now. Please try again.",
        });
      }
    }, 350);
  }, [
    bookingData?.propertyId,
    bookingData?.checkIn,
    bookingData?.checkOut,
    selectedRoomCode,
    selectedRoomIndex,
    roomsSpecForDeps,
    getRoomCodeForAvailabilityCheck,
  ]);

  async function fetchProperty(
    propertySlug: string,
    initialBooking: Omit<BookingData, "propertyId">,
  ) {
    try {
      // Add timeout to prevent hanging requests (15 seconds should be enough)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(`/api/public/properties/${encodeURIComponent(propertySlug)}`, {
        signal: controller.signal,
        cache: 'no-store', // Don't cache this request
        headers: {
          'Accept': 'application/json',
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 404) {
          throw new Error("Property not found or not approved for public viewing");
        } else if (response.status === 400) {
          throw new Error("Invalid property link");
        } else if (response.status >= 500) {
          throw new Error(`Server error: Please try again later`);
        } else {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || errorData.message || `Failed to fetch property (${response.status})`);
        }
      }

      const data = await response.json().catch((parseErr) => {
        throw new Error(`Invalid response from server: ${parseErr?.message || 'Unknown error'}`);
      });
      
      // API returns { property: {...} } so we need to extract the property object
      const propertyData = data.property || data;
      
      // Validate property data structure
      if (!propertyData || typeof propertyData !== 'object' || !propertyData.id) {
        throw new Error('Invalid property data received from server');
      }
      
      setProperty(propertyData);
      setBookingData({ ...initialBooking, propertyId: Number(propertyData.id) });
      setError(null);
    } catch (err: any) {
      // Handle AbortError (timeout)
      if (err.name === 'AbortError') {
        setError('Request timed out. Please check your connection and try again.');
      } else if (err?.message) {
        setError(err.message);
      } else {
        setError("Failed to load property. Please try again.");
      }
      
      setProperty(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    if (!bookingData || !property) {
      setError("Missing booking information");
      setSubmitting(false);
      return;
    }

    // Validate dates
    if (!bookingData.checkIn || !bookingData.checkOut) {
      setError("Please select check-in and check-out dates");
      setSubmitting(false);
      return;
    }

    // Validate dates are valid
    const checkInDate = new Date(bookingData.checkIn);
    const checkOutDate = new Date(bookingData.checkOut);
    if (isNaN(checkInDate.getTime()) || isNaN(checkOutDate.getTime())) {
      setError("Please enter valid dates");
      setSubmitting(false);
      return;
    }

    // Validate check-out is after check-in
    if (checkOutDate <= checkInDate) {
      setError("Check-out date must be after check-in date");
      setSubmitting(false);
      return;
    }

    // Pre-payment availability gate (server-side booking creation will still re-check under lock)
    if (availabilityState.status === "checking") {
      setError("Checking availability... please wait a moment.");
      setSubmitting(false);
      return;
    }
    if (availabilityState.status === "unavailable") {
      setError(availabilityState.message || "Selected dates are no longer available. Please choose different dates.");
      setSubmitting(false);
      return;
    }

    if (checkOutDate <= checkInDate) {
      setError("Check-out date must be after check-in date");
      setSubmitting(false);
      return;
    }

    const checkInRaw = bookingData.checkIn;
    const checkOutRaw = bookingData.checkOut;

    // Validate form
    if (!guestName.trim()) {
      setError("Please enter your full name");
      setSubmitting(false);
      return;
    }

    if (!guestPhone.trim()) {
      setError("Please enter your phone number");
      setSubmitting(false);
      return;
    }

    // Phone: normalize to TZ (+255XXXXXXXXX) and block invalid/short numbers before API
    const phoneForApi = normalizeTzPhoneForApi(guestPhone);
    if (!phoneForApi) {
      setError("Please enter a valid phone number. Example: +255 7XX XXX XXX or 07XX XXX XXX.");
      setSubmitting(false);
      return;
    }

    if (!sanitizeNationalityInput(nationality).trim()) {
      setError("Please enter your nationality");
      setSubmitting(false);
      return;
    }

    if (!sex) {
      setError("Please select your gender");
      setSubmitting(false);
      return;
    }

    // Email: optional, but if provided it must be valid
    const emailForApi = guestEmail.trim().replace(/\s+/g, "");
    if (emailForApi && !isValidEmail(emailForApi)) {
      setError("Please enter a valid email address.");
      setSubmitting(false);
      return;
    }

    if (includeTransport) {
      if (calculatingFare) {
        setError("Calculating transportation fare... please wait a moment.");
        setSubmitting(false);
        return;
      }

      if (pickupMode === "current" && currentPickupNeedsConfirm && !currentPickupConfirmed) {
        setError("Please confirm your detected pickup area before continuing.");
        setSubmitting(false);
        return;
      }

      if (transportOriginLat === null || transportOriginLng === null) {
        setError("Please select a pickup location for transportation (Current / Arrival / Type).");
        setSubmitting(false);
        return;
      }
      if (!transportOriginAddress.trim()) {
        setError("Please provide a pickup location name/address.");
        setSubmitting(false);
        return;
      }
      if (transportFare === null || !Number.isFinite(transportFare) || transportFare < 0) {
        setError("Transport fare is not ready yet. Please set a pickup location.");
        setSubmitting(false);
        return;
      }

      if (requiresArrivalInfo) {
        if (!arrivalType) {
          setError("Please confirm how you are arriving (Flight/Bus/etc).");
          setSubmitting(false);
          return;
        }
        if (!arrivalDate) {
          setError("Please select your arrival date.");
          setSubmitting(false);
          return;
        }
        if (!arrivalTimeHour) {
          setError("Please enter your arrival time (hour).");
          setSubmitting(false);
          return;
        }
        if (!arrivalTimeMinute) {
          setError("Please enter your arrival time (minute).");
          setSubmitting(false);
          return;
        }
        if (!pickupLocation.trim()) {
          setError("Please enter the specific pickup area/terminal (e.g., Terminal 1, Gate 3).");
          setSubmitting(false);
          return;
        }
      }
    }

    try {
      // Prepare request body with proper formatting
      const requestBody = {
        propertyId: bookingData.propertyId,
        checkIn: checkInRaw,
        checkOut: checkOutRaw,
        guestName: guestName.trim(),
        guestPhone: phoneForApi,
        guestEmail: emailForApi || null,
        nationality: sanitizeNationalityInput(nationality).trim() || null,
        sex: sex || null,
        ageGroup: ageGroup || null,
        adults: bookingData.adults || 1,
        children: bookingData.children || 0,
        pets: bookingData.pets || 0,
        rooms: Math.max(1, Number(bookingData.rooms ?? 1)),
        roomCode: selectedRoomCode || getRoomCodeForAvailabilityCheck(), // Keep consistent with live availability checks
        specialRequests: specialRequests.trim() || null,
        includeTransport: includeTransport || false,
        transportPickupMode: includeTransport ? pickupMode : null,
        transportOriginLat: includeTransport && transportOriginLat !== null ? transportOriginLat : null,
        transportOriginLng: includeTransport && transportOriginLng !== null ? transportOriginLng : null,
        transportOriginAddress: includeTransport && transportOriginAddress.trim() ? transportOriginAddress.trim() : null,
        transportFare: includeTransport && transportFare !== null ? transportFare : null,
        transportVehicleType: includeTransport ? transportVehicleType : null,
        // Flexible arrival fields
        arrivalType: requiresArrivalInfo && arrivalType ? arrivalType : null,
        arrivalNumber: requiresArrivalInfo && arrivalNumber.trim() ? arrivalNumber.trim() : null,
        transportCompany: requiresArrivalInfo && transportCompany.trim() ? transportCompany.trim() : null,
        arrivalTime:
          requiresArrivalInfo && arrivalDate && (arrivalTimeHour || arrivalTimeMinute)
            ? (() => {
                const date = new Date(arrivalDate);
                date.setHours(parseInt(arrivalTimeHour || "0") || 0);
                date.setMinutes(parseInt(arrivalTimeMinute || "0") || 0);
                return date.toISOString();
              })()
            : requiresArrivalInfo && arrivalDate
              ? new Date(arrivalDate).toISOString()
              : null,
        pickupLocation: requiresArrivalInfo && pickupLocation.trim() ? pickupLocation.trim() : null,
      };
      
      // Create booking
      const bookingResponse = await fetch(`/api/public/bookings`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      const isDev = process.env.NODE_ENV === "development";

      // Read body once as text, then try to parse JSON (more reliable for error handling).
      const bookingContentType = bookingResponse.headers.get("content-type") || "";
      const bookingBodyText = await bookingResponse.text();
      const bookingResult = (() => {
        if (!bookingBodyText) return null;
        if (!bookingContentType.includes("application/json")) return null;
        try {
          return JSON.parse(bookingBodyText);
        } catch {
          return null;
        }
      })();

      if (!bookingResponse.ok) {
        // Show detailed error message if available
        let errorMessage = (bookingResult as any)?.error || "Failed to create booking";
        
        // Add validation details if available
        if ((bookingResult as any)?.details && Array.isArray((bookingResult as any).details)) {
          const details = (bookingResult as any).details.map((d: any) => 
            `${d.path?.join('.') || 'field'}: ${d.message}`
          ).join(', ');
          errorMessage = `${errorMessage}. ${details}`;
        }
        
        // Add development message if available
        if ((bookingResult as any)?.message) {
          errorMessage = `${errorMessage}. ${(bookingResult as any).message}`;
        }

        // If server returned non-JSON or empty JSON, include HTTP status + raw body.
        if (!bookingResult) {
          const statusMsg = `HTTP ${bookingResponse.status}${bookingResponse.statusText ? ` ${bookingResponse.statusText}` : ""}`;
          const bodyMsg = bookingBodyText ? `Response: ${bookingBodyText}` : "";
          errorMessage = `${errorMessage}. ${statusMsg}${bodyMsg ? `. ${bodyMsg}` : ""}`;
        }
        
        if (isDev) {
          console.error("Booking creation failed:", {
            status: bookingResponse.status,
            statusText: bookingResponse.statusText,
            contentType: bookingContentType,
            error: bookingResult,
            bodyText: bookingBodyText,
            requestBody,
          });
        } else {
          console.error("Booking creation failed:", {
            status: bookingResponse.status,
            statusText: bookingResponse.statusText,
          });
        }
        
        throw new Error(errorMessage);
      }

      if (!bookingResult) {
        const statusMsg = `HTTP ${bookingResponse.status}${bookingResponse.statusText ? ` ${bookingResponse.statusText}` : ""}`;
        throw new Error(`Booking response was not valid JSON. ${statusMsg}${bookingBodyText ? ` Response: ${bookingBodyText}` : ""}`);
      }

      // Create invoice from booking
      const invoiceResponse = await fetch(`/api/public/invoices/from-booking`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookingId: bookingResult.bookingId,
          bookingAccessToken: bookingResult.bookingAccessToken,
        }),
      });

      // Read body once as text, then try to parse JSON.
      const invoiceContentType = invoiceResponse.headers.get("content-type") || "";
      const invoiceBodyText = await invoiceResponse.text();
      const invoiceResult = (() => {
        if (!invoiceBodyText) return null;
        if (!invoiceContentType.includes("application/json")) return null;
        try {
          return JSON.parse(invoiceBodyText);
        } catch {
          return null;
        }
      })();

      if (!invoiceResponse.ok) {
        // The room being unavailable is an ordinary outcome, not a failure to
        // report as one: the dates were taken, or the property closed them.
        // Surface the plain message the API already wrote for the guest,
        // without the HTTP noise appended below.
        if ((invoiceResult as any)?.code === "DRAFT_ROOM_UNAVAILABLE") {
          const availability = (invoiceResult as any)?.availability;
          throw new Error(
            (availability?.message as string)
              || (invoiceResult as any)?.message
              || "These dates are no longer available. Please choose different dates."
          );
        }

        // Show detailed error message if available
        let errorMessage = (invoiceResult as any)?.error || "Failed to create invoice";
        
        // Add validation details if available
        if ((invoiceResult as any)?.details && Array.isArray((invoiceResult as any).details)) {
          const details = (invoiceResult as any).details.map((d: any) => 
            `${d.path?.join('.') || 'field'}: ${d.message}`
          ).join(', ');
          errorMessage = `${errorMessage}. ${details}`;
        }
        
        // Add development message if available
        if ((invoiceResult as any)?.message) {
          errorMessage = `${errorMessage}. ${(invoiceResult as any).message}`;
        }

        if (!invoiceResult) {
          const statusMsg = `HTTP ${invoiceResponse.status}${invoiceResponse.statusText ? ` ${invoiceResponse.statusText}` : ""}`;
          const bodyMsg = invoiceBodyText ? `Response: ${invoiceBodyText}` : "";
          errorMessage = `${errorMessage}. ${statusMsg}${bodyMsg ? `. ${bodyMsg}` : ""}`;
        }
        
        // Log full error details for debugging
        if (isDev) {
          console.error("Invoice creation failed:", {
            status: invoiceResponse.status,
            statusText: invoiceResponse.statusText,
            contentType: invoiceContentType,
            error: invoiceResult,
            bodyText: invoiceBodyText,
            bookingId: bookingResult.bookingId,
          });
        } else {
          console.error("Invoice creation failed:", {
            status: invoiceResponse.status,
            statusText: invoiceResponse.statusText,
          });
        }
        
        throw new Error(errorMessage);
      }

      if (!invoiceResult) {
        const statusMsg = `HTTP ${invoiceResponse.status}${invoiceResponse.statusText ? ` ${invoiceResponse.statusText}` : ""}`;
        throw new Error(`Invoice response was not valid JSON. ${statusMsg}${invoiceBodyText ? ` Response: ${invoiceBodyText}` : ""}`);
      }

      if (!invoiceResult.accessToken) {
        throw new Error("Invoice access token was not returned. Please try again.");
      }

      // Redirect to payment page with invoice ID + access token
      const paymentParams = new URLSearchParams({
        invoiceId: String(invoiceResult.invoiceId),
        accessToken: String(invoiceResult.accessToken),
      });
      router.push(`/public/booking/payment?${paymentParams.toString()}`);
    } catch (err: any) {
      console.error("Booking submission error:", err);
      
      // Extract error message
      let errorMessage = "Failed to create booking. Please try again.";
      
      if (err?.message) {
        errorMessage = err.message;
      } else if (err instanceof Error) {
        errorMessage = err.message;
      } else if (typeof err === 'string') {
        errorMessage = err;
      }
      
      // Check for network errors
      if (err?.name === 'TypeError' && err?.message?.includes('fetch')) {
        errorMessage = "Network error. Please check your connection and try again.";
      }
      
      setError(errorMessage);
      setSubmitting(false);
    }
  }

  // Calculate pricing
  const nights = bookingData && bookingData.checkIn && bookingData.checkOut
    ? Math.max(
        1,
        Math.ceil(
          (new Date(bookingData.checkOut).getTime() -
            new Date(bookingData.checkIn).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : 0;

  const commissionPercent = getPropertyCommission(property, systemCommission);

  // Calculate price based on selected room or base price
  // Always show the room's price even when nights is 0, so users can see the price while selecting dates
  let basePricePerNight = property?.basePrice ? Number(property.basePrice) : 0;
  
  // If a room is selected, use that room's price (this takes priority over basePrice)
  if (property?.roomsSpec && (selectedRoomCode !== null || selectedRoomIndex !== null)) {
    let roomTypes: Array<any> = [];
    if (typeof property.roomsSpec === "object") {
      const spec = property.roomsSpec as any;
      if (Array.isArray(spec)) {
        roomTypes = spec;
      } else if (spec.rooms && Array.isArray(spec.rooms)) {
        roomTypes = spec.rooms;
      } else if (spec && typeof spec === 'object') {
        // Try to extract rooms from any object structure
        roomTypes = Object.values(spec).filter((item: any) => Array.isArray(item) ? item : null).flat();
      }
    }
    
    let selectedRoom: any = null;
    
    // Try to find room by code first, then fall back to name/type match.
    // buildBookingUrl() passes the bucket key (e.g. "Studio") which may match
    // rt.name or rt.roomType when the property has no explicit numeric room codes.
    if (selectedRoomCode) {
      for (let idx = 0; idx < roomTypes.length; idx++) {
        const rt = roomTypes[idx];
        const rtCode = rt?.code || rt?.roomCode;
        const rtType = String(rt?.roomType ?? rt?.type ?? rt?.name ?? rt?.label ?? "").trim();
        if (rtCode === selectedRoomCode || rtType === selectedRoomCode) {
          selectedRoom = rt;
          break;
        }
      }
    }
    
    // If not found by code, try by index
    if (!selectedRoom && selectedRoomIndex !== null && selectedRoomIndex >= 0 && selectedRoomIndex < roomTypes.length) {
      selectedRoom = roomTypes[selectedRoomIndex];
    }
    
    if (selectedRoom) {
      // Extract price using same logic as normalizeRoomSpec: r?.pricePerNight ?? r?.price
      const priceRaw = selectedRoom.pricePerNight ?? selectedRoom.price ?? null;
      if (priceRaw !== null && priceRaw !== undefined) {
        const numPrice = Number(priceRaw);
        // Check if price is valid and greater than 0
        if (Number.isFinite(numPrice) && numPrice > 0) {
          basePricePerNight = numPrice;
        } else if (Number.isFinite(numPrice) && numPrice === 0 && property?.basePrice) {
          // If room price is 0, fall back to basePrice
          basePricePerNight = Number(property.basePrice);
        }
      } else {
        // If no price found in room, fall back to basePrice
        if (property?.basePrice) {
          basePricePerNight = Number(property.basePrice);
        }
      }
    } else {
      if (property?.basePrice) {
        basePricePerNight = Number(property.basePrice);
      }
    }
  }

  const pricePerNight = calculatePriceWithCommission(basePricePerNight, commissionPercent);
  
  const roomsQty = Math.max(1, Number(bookingData?.rooms ?? 1));
  const subtotal = pricePerNight * nights * roomsQty;
  const totalAmount = subtotal;
  const currency = property?.currency || "TZS"; // always TZS — settlement currency

  // Calculate total including transport
  const finalTotal = totalAmount + (includeTransport && transportFare !== null ? transportFare : 0);

  // ── Display-currency conversion (presentation only — never changes what is charged) ──
  // If viewer has selected a non-TZS display currency, convert TZS amounts for display.
  // The actual charge remains in TZS; only the label changes.
  const isDisplayingForeign = displayCurrency !== "TZS";
  function fmtDisplay(amountTzs: number): { primary: string; note: string | null } {
    if (!isDisplayingForeign) {
      return { primary: `${amountTzs.toLocaleString()} TZS`, note: null };
    }
    const converted = convertFromTzs(amountTzs, displayCurrency, fxRates.tzsPerUnit);
    if (converted == null) return { primary: `${amountTzs.toLocaleString()} TZS`, note: null };
    return {
      primary: formatMoney(converted, displayCurrency),
      note: `~ ${amountTzs.toLocaleString()} TZS`,
    };
  }
  
  // Auto-calculate fare when transport is enabled and location is available
  useEffect(() => {
    const propertyLat = property?.latitude ?? null;
    const propertyLng = property?.longitude ?? null;
    const propertyCurrency = property?.currency || "TZS";
    const canCalculateFare =
      includeTransport &&
      transportOriginLat !== null &&
      transportOriginLng !== null &&
      propertyLat !== null &&
      propertyLng !== null &&
      (pickupMode !== "current" || currentPickupConfirmed);

    if (canCalculateFare) {
      const origin: Location = {
        latitude: transportOriginLat,
        longitude: transportOriginLng,
        address: transportOriginAddress,
      };

      const destination: Location = {
        latitude: propertyLat,
        longitude: propertyLng,
      };

      let fareAt: Date | undefined;
      if (requiresArrivalInfo && arrivalDate) {
        const d = new Date(arrivalDate);
        if (!isNaN(d.getTime())) {
          if (arrivalTimeHour) d.setHours(parseInt(arrivalTimeHour) || 0);
          if (arrivalTimeMinute) d.setMinutes(parseInt(arrivalTimeMinute) || 0);
          fareAt = d;
        }
      }

      try {
        const fare = calculateTransportFare(origin, destination, propertyCurrency, fareAt, transportVehicleType);
        // A ride to the property should be local. A very long route almost always means a wrong
        // pickup pin or a wrong property location, so never price it.
        if (fare.distance > MAX_RIDE_KM) {
          setTransportFare(null);
          setTransportPickupError(
            `That pickup is about ${Math.round(fare.distance)} km from the property, which is too far for a ride. Choose a pickup closer to the property, or check the address.`
          );
          return;
        }
        setTransportPickupError(null);
        setTransportFare(fare.total);
      } catch (err: any) {
        console.error("Fare calculation error:", err);
      }
    } else if (!includeTransport) {
      setTransportFare(null);
      setTransportOriginAddress("");
      setTransportOriginLat(null);
      setTransportOriginLng(null);
      setTransportVehicleType("CAR");
      setPickupMode("current");
      setPickupPresetId("");
      setCurrentPickupNeedsConfirm(false);
      setCurrentPickupConfirmed(false);
      setTransportPickupError(null);
    }
  }, [
    includeTransport,
    transportOriginLat,
    transportOriginLng,
    transportOriginAddress,
    transportVehicleType,
    property?.id,
    property?.latitude,
    property?.longitude,
    property?.currency,
    arrivalDate,
    arrivalTimeHour,
    arrivalTimeMinute,
    pickupMode,
    currentPickupConfirmed,
    requiresArrivalInfo,
  ]);

  // When switching pickup mode, reset coordinates so fare is recalculated from the chosen method
  useEffect(() => {
    if (!includeTransport) return;
    setTransportPickupError(null);
    setTransportFare(null);
    setTransportOriginLat(null);
    setTransportOriginLng(null);
    if (pickupMode !== "arrival") setPickupPresetId("");

    if (pickupMode !== "current") {
      setCurrentPickupNeedsConfirm(false);
      setCurrentPickupConfirmed(false);
    }

    // Leaving Arrival mode: clear arrival metadata so it doesn't force scheduling/validation.
    if (pickupMode !== "arrival") {
      setArrivalType("");
      setArrivalNumber("");
      setTransportCompany("");
      setPickupLocation("");
      setArrivalDate("");
      setArrivalTimeHour("");
      setArrivalTimeMinute("");
    }
  }, [pickupMode, includeTransport]);
  
  // Function to calculate transport fare manually (when user clicks calculate)
  // (manual fare calculation removed; fare is auto-calculated when location is available)

  // Handle location access
  function handleGetLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    setCalculatingFare(true);
    setTransportPickupError(null);
    setCurrentPickupNeedsConfirm(false);
    setCurrentPickupConfirmed(false);
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setTransportOriginLat(lat);
        setTransportOriginLng(lng);

        try {
          const resp = await fetch("/api/geocoding/public/reverse", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat, lng, limit: 1, types: ["address", "poi", "place"] }),
          });
          const contentType = resp.headers.get("content-type") || "";
          const payload = contentType.includes("application/json") ? await resp.json() : null;
          const best = payload?.features?.[0];
          const placeName = String(best?.placeName || best?.text || "").trim();

          if (resp.ok && placeName) {
            setTransportOriginAddress(placeName);
            setCurrentPickupNeedsConfirm(true);
            setCurrentPickupConfirmed(false);
          } else {
            // GPS coords are already set — address name is cosmetic. Never block on geocoding service failure.
            // Use coordinate string as address label so the fare calc and driver navigation both work.
            const coordLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            setTransportOriginAddress(coordLabel);
            setCurrentPickupNeedsConfirm(false);
            setCurrentPickupConfirmed(true);
            setTransportPickupError(null);
          }
        } catch {
          // GPS coords are still valid; use them directly.
          const coordLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
          setTransportOriginAddress(coordLabel);
          setCurrentPickupNeedsConfirm(false);
          setCurrentPickupConfirmed(true);
          setTransportPickupError(null);
        } finally {
          setCalculatingFare(false);
        }
      },
      () => {
        setTransportPickupError("Unable to get your current location. You can select an arrival point (airport) or type a pickup address.");
        setCalculatingFare(false);
      }
    );
  }

  async function handleGeocodePickupAddress() {
    const q = transportOriginAddress.trim();
    if (!q) {
      setTransportPickupError("Please enter a pickup address or place name.");
      return;
    }

    setCalculatingFare(true);
    setTransportPickupError(null);
    try {
      const resp = await fetch("/api/geocoding/public/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, country: "TZ", limit: 3 }),
      });

      const contentType = resp.headers.get("content-type") || "";
      const payload = contentType.includes("application/json") ? await resp.json() : null;

      if (!resp.ok) {
        // If the API geocoding service isn't configured (503), try calling Mapbox directly from the browser.
        if (resp.status === 503) {
          const browserToken =
            process.env.NEXT_PUBLIC_MAPBOX_TOKEN ||
            process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ||
            "";
          if (browserToken) {
            try {
              const mbResp = await fetch(
                `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?country=TZ&types=address,poi,place&limit=3&access_token=${browserToken}`
              );
              if (mbResp.ok) {
                const mbData = await mbResp.json();
                const mbFeatures: any[] = Array.isArray(mbData?.features) ? mbData.features : [];
                const mbBest = mbFeatures.find((f) => !isVagueGeocodeId(f?.id)) ?? null;
                if (!mbBest && mbFeatures.length > 0) {
                  setTransportPickupError("That is a whole area. Add a street, landmark or building so the driver knows where to meet you.");
                  return;
                }
                if (mbBest?.geometry?.coordinates) {
                  const [mbLng, mbLat] = mbBest.geometry.coordinates as [number, number];
                  if (Number.isFinite(mbLat) && Number.isFinite(mbLng)) {
                    setTransportOriginLat(mbLat);
                    setTransportOriginLng(mbLng);
                    const mbName = String(mbBest.place_name || mbBest.text || "").trim();
                    if (mbName) setTransportOriginAddress(mbName);
                    setTransportPickupError(null);
                    return;
                  }
                }
              }
            } catch {
              // browser fallback failed — fall through to error
            }
          }
        }
        const msg = payload?.error || payload?.message || `Geocoding failed (HTTP ${resp.status}). Try a more specific location name.`;
        setTransportPickupError(msg);
        return;
      }

      // Prefer a precise match (street, place of interest, neighbourhood) over a whole city or region,
      // whose centre point can be far from where the guest actually is.
      const features: any[] = Array.isArray(payload?.features) ? payload.features : [];
      const precise = features.find((f) => !isVagueGeocodeId(f?.id));
      const best = precise ?? features[0];
      if (best && !precise && isVagueGeocodeId(best?.id)) {
        setTransportPickupError(
          `"${String(best.placeName || q)}" is a whole area. Add a street, landmark or building so the driver knows where to meet you.`
        );
        return;
      }
      const coords = best?.coordinates;
      const lng = Array.isArray(coords) ? Number(coords[0]) : NaN;
      const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        setTransportPickupError("We couldn't find that pickup location. Try a more specific place (e.g., street + area + city).");
        return;
      }

      setTransportOriginLat(lat);
      setTransportOriginLng(lng);
      const placeName = String(best?.placeName || "").trim();
      if (placeName) setTransportOriginAddress(placeName);
    } catch (e) {
      setTransportPickupError("Unable to look up that pickup location right now. Please try again.");
    } finally {
      setCalculatingFare(false);
    }
  }

  function handleSelectPickupPreset(id: string) {
    setPickupPresetId(id);
    const preset = TANZANIA_LOCATIONS.find((p) => p.id === id);
    if (!preset) {
      setTransportOriginLat(null);
      setTransportOriginLng(null);
      setTransportOriginAddress("");
      setArrivalType("");
      return;
    }
    setTransportOriginLat(preset.lat);
    setTransportOriginLng(preset.lng);
    setTransportOriginAddress(preset.label);
    setTransportPickupError(null);

    // Auto-fill arrival type based on selected pickup point.
    setArrivalType(preset.arrivalType);
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50" style={{boxSizing:"border-box"}}>
        {/* Top accent bar */}
        <div style={{height:3, background:"linear-gradient(90deg,#02665e,#028a7a,#45aa99)", width:"100%"}} />
        <div className="max-w-2xl mx-auto px-4 py-10 space-y-5">

          {/* Header skeleton */}
          <div className="flex items-center gap-3">
            <div style={{width:36,height:36,borderRadius:10,background:"#e2e8f0"}} className="skeleton-pulse" />
            <div className="space-y-2">
              <div style={{width:180,height:14,borderRadius:6,background:"#e2e8f0"}} className="skeleton-pulse" />
              <div style={{width:120,height:11,borderRadius:6,background:"#f1f5f9"}} className="skeleton-pulse" />
            </div>
          </div>

          {/* Property card skeleton */}
          <div style={{background:"#fff",borderRadius:16,padding:20,boxShadow:"0 1px 8px rgba(0,0,0,0.07)",boxSizing:"border-box"}}>
            <div className="flex gap-3">
              <div style={{width:80,height:80,borderRadius:12,background:"#e2e8f0",flexShrink:0}} className="skeleton-pulse" />
              <div className="space-y-2 flex-1" style={{minWidth:0}}>
                <div style={{width:"70%",height:14,borderRadius:6,background:"#e2e8f0"}} className="skeleton-pulse" />
                <div style={{width:"50%",height:11,borderRadius:6,background:"#f1f5f9"}} className="skeleton-pulse" />
                <div style={{width:"40%",height:11,borderRadius:6,background:"#f1f5f9"}} className="skeleton-pulse" />
              </div>
            </div>
            <div style={{marginTop:16,height:1,background:"#f1f5f9"}} />
            <div className="flex gap-3 pt-4">
              {["60%","40%"].map((w,i) => (
                <div key={i} style={{width:w,height:12,borderRadius:6,background:"#e2e8f0"}} className="skeleton-pulse" />
              ))}
            </div>
          </div>

          {/* Form fields skeleton */}
          {[1,2,3].map((i) => (
            <div key={i} style={{background:"#fff",borderRadius:16,padding:20,boxShadow:"0 1px 8px rgba(0,0,0,0.07)",boxSizing:"border-box"}}>
              <div style={{width:100,height:11,borderRadius:6,background:"#e2e8f0",marginBottom:12}} className="skeleton-pulse" />
              <div style={{width:"100%",height:44,borderRadius:10,background:"#f8fafc",border:"2px solid #f1f5f9"}} className="skeleton-pulse" />
              {i < 3 && <div style={{width:"100%",height:44,borderRadius:10,background:"#f8fafc",border:"2px solid #f1f5f9",marginTop:10}} className="skeleton-pulse" />}
            </div>
          ))}

          {/* Spinner + label at bottom */}
          <div className="flex flex-col items-center gap-3 pt-4">
            <LogoSpinner size="md" ariaLabel="Loading booking details" />
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <p style={{fontSize:13,fontWeight:600,color:"#475569"}}>Fetching your booking details</p>
              <p style={{fontSize:11,color:"#94a3b8"}}>Just a moment…</p>
            </div>
          </div>
        </div>

        {/* Skeleton pulse keyframe — scoped */}
        <style>{`
          @keyframes _sk_pulse { 0%,100%{opacity:1} 50%{opacity:0.45} }
          .skeleton-pulse { animation: _sk_pulse 1.6s ease-in-out infinite; }
        `}</style>
      </div>
    );
  }

  if (error && !property) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 p-6">
        <div className="max-w-md w-full bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border-2 border-red-200/60 p-8 text-center animate-in fade-in slide-in-from-bottom-4 duration-300">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-3">Error</h2>
          <p className="text-slate-600 mb-6 leading-relaxed">{error}</p>
          <Link
            href="/public/properties"
            className="inline-flex items-center justify-center px-6 py-3 rounded-xl bg-gradient-to-r from-[#02665e] to-[#014e47] text-white font-semibold hover:from-[#014e47] hover:to-[#02665e] transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95"
          >
            Browse Properties
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50">
      {/* Header */}
      <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 shadow-sm sticky top-0 z-10">
        <div className="public-container flex items-center gap-4 py-3">
          <Link
            href={property ? `/public/properties/${property.slug}` : "/public/properties"}
            aria-label="Back to property"
            className="group inline-flex h-9 w-9 flex-none items-center justify-center rounded-lg text-slate-600 no-underline transition-colors hover:bg-slate-100 hover:text-[#02665e]"
          >
            <ChevronLeft className="h-5 w-5 transition-transform duration-200 group-hover:-translate-x-0.5" />
          </Link>
          {/* Where the guest is in the booking */}
          <ol className="m-0 flex min-w-0 flex-1 list-none items-center justify-center gap-2 p-0 text-[12.5px] sm:gap-3" aria-label="Booking steps">
            {[
              { label: "Your stay", state: "done" },
              { label: "Guest details", state: "current" },
              { label: "Payment", state: "next" },
            ].map((step, i) => (
              <li key={step.label} className="flex min-w-0 items-center gap-2 sm:gap-3" aria-current={step.state === "current" ? "step" : undefined}>
                {i > 0 && (
                  <span aria-hidden className={`h-px w-5 sm:w-10 ${step.state === "next" ? "bg-slate-200" : "bg-[#02665e]"}`} />
                )}
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className={`flex h-6 w-6 flex-none items-center justify-center rounded-full text-[11.5px] font-bold ${
                      step.state === "done"
                        ? "bg-[#02665e] text-white"
                        : step.state === "current"
                          ? "bg-white text-[#02665e] ring-2 ring-inset ring-[#02665e]"
                          : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {step.state === "done" ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : i + 1}
                  </span>
                  <span
                    className={`truncate ${step.state === "next" ? "text-slate-400" : "font-semibold text-slate-900"} ${step.state === "current" ? "" : "hidden sm:inline"}`}
                  >
                    {step.label}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          <span className="w-9 flex-none" aria-hidden />
        </div>
      </div>

      <div className="public-container py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Your stay: property, dates timeline, guests and live availability in one connected card */}
            <div className="box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(2,40,36,0.35)]">
              {property && (() => {
                const tidy = (s: unknown) => {
                  const v = String(s ?? "").trim();
                  if (!v || v !== v.toUpperCase()) return v;
                  return v.toLowerCase().replace(/-/g, " ").replace(/\b(\w)(\w*)/g, (_m, a: string, b: string) => (["es", "wa", "la", "ya", "na"].includes(a + b) ? a + b : a.toUpperCase() + b));
                };
                const seen = new Set<string>();
                const place = [property.city, property.district, property.regionName]
                  .map(tidy)
                  .filter((p) => {
                    const k = p.toLowerCase().replace(/[^a-z]/g, "");
                    if (!k || seen.has(k)) return false;
                    seen.add(k);
                    return true;
                  })
                  .join(", ");
                const dayParts = (iso: string | null | undefined) => {
                  if (!iso) return null;
                  const d = new Date(iso);
                  if (isNaN(d.getTime())) return null;
                  return {
                    weekday: d.toLocaleDateString("en-GB", { weekday: "short" }),
                    day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
                    year: d.getFullYear(),
                  };
                };
                const inDay = dayParts(bookingData?.checkIn);
                const outDay = dayParts(bookingData?.checkOut);
                const adults = bookingData?.adults || 1;
                const children = bookingData?.children || 0;
                const pets = bookingData?.pets || 0;
                const guestsLabel = [
                  `${adults} adult${adults !== 1 ? "s" : ""}`,
                  children ? `${children} child${children !== 1 ? "ren" : ""}` : "",
                  pets ? `${pets} pet${pets !== 1 ? "s" : ""}` : "",
                ]
                  .filter(Boolean)
                  .join(", ");
                const status = availabilityState.status;
                const hasDates = Boolean(bookingData?.checkIn && bookingData?.checkOut);

                const counter = (label: string, value: number, min: number, set: (n: number) => void) => (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <p className="m-0 text-[14px] font-semibold text-slate-900">{label}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => set(Math.max(min, value - 1))}
                        disabled={value <= min}
                        aria-label={`Fewer ${label.toLowerCase()}`}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-300 bg-white text-lg font-semibold text-slate-700 transition-colors hover:border-[#02665e] hover:text-[#02665e] disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-[15px] font-bold tabular-nums text-slate-900">{value}</span>
                      <button
                        type="button"
                        onClick={() => set(value + 1)}
                        aria-label={`More ${label.toLowerCase()}`}
                        className="flex h-9 w-9 items-center justify-center rounded-full border border-solid border-slate-300 bg-white text-lg font-semibold text-slate-700 transition-colors hover:border-[#02665e] hover:text-[#02665e]"
                      >
                        +
                      </button>
                    </div>
                  </div>
                );

                return (
                  <>
                    {/* Property */}
                    <div className="flex items-center gap-4 border-0 border-b border-solid border-slate-100 px-5 py-4 sm:px-6">
                      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                        <Hotel className="h-6 w-6" aria-hidden />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Your stay</p>
                        <h2 className="m-0 truncate text-[20px] font-bold leading-tight text-slate-900">{property.title}</h2>
                        <p className="m-0 mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-slate-500">
                          <MapPin className="h-3.5 w-3.5 flex-none text-slate-400" aria-hidden />
                          <span className="truncate">{place || "Location not specified"}</span>
                          {property.type && (
                            <span className="ml-1 flex-none rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold capitalize text-slate-600">
                              {String(property.type).toLowerCase().replace(/_/g, " ")}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Dates timeline: check-in, nights, check-out */}
                    <div className="px-5 pt-5 sm:px-6">
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 sm:gap-3">
                        {([
                          { key: "in", label: "Check-in", day: inDay, open: () => setCheckInPickerOpen(true), ref: checkInBtnRef, align: "text-left" },
                          { key: "out", label: "Check-out", day: outDay, open: () => setCheckOutPickerOpen(true), ref: checkOutBtnRef, align: "text-right" },
                        ] as const).map((cell, i) => {
                          const btn = (
                            <button
                              key={cell.key}
                              ref={cell.ref}
                              type="button"
                              onClick={cell.open}
                              className={`group box-border min-w-0 rounded-xl border border-solid border-slate-200 bg-slate-50/60 px-3.5 py-3 transition-colors hover:border-[#02665e]/50 hover:bg-white ${cell.align}`}
                            >
                              <span className={`flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 ${i === 1 ? "justify-end" : ""}`}>
                                <Calendar className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                                {cell.label}
                              </span>
                              {cell.day ? (
                                <>
                                  <span className="mt-1 block truncate text-[18px] font-bold leading-tight text-slate-900">{cell.day.day}</span>
                                  <span className="block text-[12px] text-slate-500">
                                    {cell.day.weekday} · {cell.day.year}
                                  </span>
                                </>
                              ) : (
                                <span className="mt-1 block text-[15px] font-semibold text-slate-400">Add date</span>
                              )}
                              <span className="mt-1 block text-[11.5px] font-semibold text-[#02665e] opacity-0 transition-opacity group-hover:opacity-100">Change</span>
                            </button>
                          );
                          if (i === 0) {
                            return [
                              btn,
                              <div key="nights" className="flex min-w-[64px] flex-col items-center justify-center" aria-hidden>
                                <span className="flex w-full items-center">
                                  <span className="h-px flex-1 border-0 border-t border-dashed border-[#02665e]/40" />
                                  <span className="mx-1 flex h-2 w-2 flex-none rounded-full bg-[#02665e]" />
                                  <span className="h-px flex-1 border-0 border-t border-dashed border-[#02665e]/40" />
                                </span>
                                <span className="mt-1.5 whitespace-nowrap rounded-full bg-[#02665e] px-2.5 py-0.5 text-[12px] font-bold text-white">
                                  {nights > 0 ? `${nights} night${nights !== 1 ? "s" : ""}` : "Nights"}
                                </span>
                              </div>,
                            ];
                          }
                          return btn;
                        })}
                      </div>

                      {checkInPickerOpen && (
                        <>
                          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCheckInPickerOpen(false)} />
                          <div className="fixed left-1/2 top-1/2 z-[200] -translate-x-1/2 -translate-y-1/2">
                            <DatePicker
                              selected={bookingData?.checkIn || undefined}
                              onSelectAction={(s) => {
                                const date = Array.isArray(s) ? s[0] : s;
                                if (bookingData && date) {
                                  let newCheckOut: string | null = bookingData.checkOut;
                                  if (newCheckOut && new Date(newCheckOut) <= new Date(date)) newCheckOut = null;
                                  setBookingData({ ...bookingData, checkIn: date, checkOut: newCheckOut ?? null });
                                }
                                setCheckInPickerOpen(false);
                              }}
                              onCloseAction={() => setCheckInPickerOpen(false)}
                              allowRange={false}
                            />
                          </div>
                        </>
                      )}
                      {checkOutPickerOpen && (
                        <>
                          <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCheckOutPickerOpen(false)} />
                          <div className="fixed left-1/2 top-1/2 z-[200] -translate-x-1/2 -translate-y-1/2">
                            <DatePicker
                              selected={bookingData?.checkOut || undefined}
                              onSelectAction={(s) => {
                                const date = Array.isArray(s) ? s[0] : s;
                                if (bookingData && date) {
                                  if (bookingData.checkIn && new Date(date) <= new Date(bookingData.checkIn)) {
                                    setError("Check-out date must be after check-in date");
                                    setCheckOutPickerOpen(false);
                                    return;
                                  }
                                  setError(null);
                                  setBookingData({ ...bookingData, checkOut: date });
                                }
                                setCheckOutPickerOpen(false);
                              }}
                              onCloseAction={() => setCheckOutPickerOpen(false)}
                              allowRange={false}
                              minDate={
                                bookingData?.checkIn
                                  ? (() => {
                                      const d = new Date(bookingData.checkIn);
                                      d.setDate(d.getDate() + 1);
                                      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
                                    })()
                                  : undefined
                              }
                            />
                          </div>
                        </>
                      )}
                    </div>

                    {/* Guests */}
                    <div className="px-5 pt-3 sm:px-6">
                      <div className="rounded-xl border border-solid border-slate-200">
                        <button
                          type="button"
                          onClick={() => setIsGuestSelectorOpen(!isGuestSelectorOpen)}
                          aria-expanded={isGuestSelectorOpen}
                          className="box-border flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-3.5 py-3 text-left transition-colors hover:bg-slate-50"
                        >
                          <Users className="h-4 w-4 flex-none text-[#02665e]" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="block text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">Guests</span>
                            <span className="block truncate text-[15px] font-semibold text-slate-900">{guestsLabel}</span>
                          </span>
                          <span className="flex-none text-[12.5px] font-semibold text-[#02665e]">{isGuestSelectorOpen ? "Done" : "Edit"}</span>
                        </button>
                        {isGuestSelectorOpen && bookingData && (
                          <div className="divide-y divide-slate-100 border-0 border-t border-solid border-slate-100 px-3.5">
                            {counter("Adults", adults, 1, (n) => setBookingData({ ...bookingData, adults: n }))}
                            {counter("Children", children, 0, (n) => setBookingData({ ...bookingData, children: n }))}
                            {counter("Pets", pets, 0, (n) => setBookingData({ ...bookingData, pets: n }))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Live availability, attached to the choices above */}
                    <div className="px-5 pb-5 pt-3 sm:px-6">
                      <div
                        className={`flex items-start gap-3 rounded-xl px-3.5 py-3 ${
                          status === "available"
                            ? "bg-emerald-50 text-emerald-900"
                            : status === "unavailable"
                              ? "bg-amber-50 text-amber-900"
                              : "bg-slate-50 text-slate-700"
                        }`}
                        aria-live="polite"
                      >
                        <span className="mt-0.5 flex-none">
                          {status === "available" ? (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                            </span>
                          ) : status === "checking" ? (
                            <LogoSpinner size="sm" ariaLabel="Checking availability" />
                          ) : status === "unavailable" ? (
                            <AlertCircle className="h-4 w-4 text-amber-600" />
                          ) : (
                            <Info className="h-4 w-4 text-slate-400" />
                          )}
                        </span>
                        <div className="min-w-0 text-[13px]">
                          <p className="m-0 font-semibold">
                            {status === "available"
                              ? "Available for your dates"
                              : status === "checking"
                                ? "Checking live availability"
                                : status === "unavailable"
                                  ? "Not available for these dates"
                                  : hasDates
                                    ? "Availability will show here"
                                    : "Add both dates to check availability"}
                          </p>
                          <p className="m-0 mt-0.5 opacity-80">
                            {status === "available"
                              ? "Rooms can go quickly. Finish your details below to hold it."
                              : status === "unavailable"
                                ? availabilityState.message || "Try different dates or another room type."
                                : status === "checking"
                                  ? "This takes a moment."
                                  : "We check the property in real time."}
                          </p>
                        </div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Guest details: who is checking in */}
            <div className="box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(2,40,36,0.35)]">
              <div className="flex items-center gap-4 border-0 border-b border-solid border-slate-100 px-5 py-4 sm:px-6">
                <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
                  <UserRound className="h-6 w-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.12em] text-[#02665e]">Guest details</p>
                  <h2 className="m-0 text-[20px] font-bold leading-tight text-slate-900">Who is checking in?</h2>
                  <p className="m-0 mt-0.5 text-[13px] text-slate-500">We use these details to confirm your booking.</p>
                </div>
                {prefilledFromAccount && (
                  <span
                    className="hidden flex-none items-center gap-1.5 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200 sm:inline-flex"
                    title="Taken from your NoLSAF account. You can edit anything for this booking."
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Filled from your account
                  </span>
                )}
              </div>
              {prefilledFromAccount && (
                <p className="m-0 flex items-center gap-1.5 border-0 border-b border-solid border-slate-100 bg-emerald-50/60 px-5 py-2 text-[12px] text-emerald-800 sm:hidden">
                  <CheckCircle2 className="h-3.5 w-3.5 flex-none" aria-hidden />
                  Filled from your account. Edit anything if needed.
                </p>
              )}

              <form onSubmit={handleSubmit} className="space-y-4 overflow-x-hidden px-5 py-5 sm:px-6">
                {(() => {
                  const phoneOk = Boolean(normalizedPhoneForApi);
                  const emailOk = Boolean(normalizedEmailForApi) && isValidEmail(normalizedEmailForApi);
                  const field = (invalid: boolean, ok: boolean) =>
                    `box-border h-12 w-full min-w-0 rounded-xl border border-solid bg-white pl-11 pr-10 text-[15px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-4 ${
                      invalid
                        ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100"
                        : ok
                          ? "border-emerald-300 focus:border-[#02665e] focus:ring-[#02665e]/10"
                          : "border-slate-300 hover:border-slate-400 focus:border-[#02665e] focus:ring-[#02665e]/10"
                    }`;
                  const label = (text: string, required: boolean) => (
                    <span className="mb-1.5 flex items-center justify-between text-[13px] font-semibold text-slate-700">
                      <span>
                        {text}
                        {required && <span className="ml-0.5 text-rose-500">*</span>}
                      </span>
                    </span>
                  );
                  const tick = (show: boolean) =>
                    show ? <CheckCircle2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-emerald-600" aria-hidden /> : null;
                  const nameOk = guestName.trim().length >= 3;

                  return (
                    <>
                      <label className="block min-w-0">
                        {label("Full name", true)}
                        <span className="relative block">
                          <UserRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                          <input
                            type="text"
                            value={guestName}
                            onChange={(e) => setGuestName(e.target.value)}
                            required
                            autoComplete="name"
                            className={field(false, nameOk)}
                            placeholder="As it appears on your ID"
                          />
                          {tick(nameOk)}
                        </span>
                      </label>

                      <div className="grid gap-4 sm:grid-cols-2">
                        <label className="block min-w-0">
                          {label("Phone number", true)}
                          <span className="relative block">
                            <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                            <input
                              type="tel"
                              value={guestPhone}
                              inputMode="tel"
                              autoComplete="tel"
                              onChange={(e) => {
                                setError(null);
                                setGuestPhone(sanitizePhoneInput(e.target.value));
                              }}
                              onBlur={() => {
                                setPhoneTouched(true);
                                const normalized = normalizeTzPhoneForApi(guestPhone);
                                if (normalized) setGuestPhone(normalized);
                              }}
                              required
                              aria-invalid={Boolean(phoneInlineError)}
                              className={field(Boolean(phoneInlineError), phoneOk)}
                              placeholder="+255 7XX XXX XXX"
                            />
                            {tick(phoneOk)}
                          </span>
                          {phoneInlineError ? (
                            <span className="mt-1 block text-[12px] font-medium text-rose-600">{phoneInlineError}</span>
                          ) : (
                            <span className="mt-1 block text-[12px] text-slate-400">So the property can reach you</span>
                          )}
                        </label>

                        <label className="block min-w-0">
                          {label("Email", false)}
                          <span className="relative block">
                            <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                            <input
                              type="email"
                              value={guestEmail}
                              inputMode="email"
                              autoComplete="email"
                              onChange={(e) => {
                                setError(null);
                                setGuestEmail(e.target.value.replace(/\s+/g, ""));
                              }}
                              onBlur={() => setEmailTouched(true)}
                              aria-invalid={Boolean(emailInlineError)}
                              className={field(Boolean(emailInlineError), emailOk)}
                              placeholder="you@example.com"
                            />
                            {tick(emailOk)}
                          </span>
                          {emailInlineError ? (
                            <span className="mt-1 block text-[12px] font-medium text-rose-600">{emailInlineError}</span>
                          ) : (
                            <span className="mt-1 block text-[12px] text-slate-400">For a copy of your booking</span>
                          )}
                        </label>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-2">
                        {(() => {
                          // Smart nationality: type to search a known list; anything else is kept as typed ("Other").
                          const q = nationality.trim().toLowerCase();
                          const known = NATIONALITIES.some((n) => n.toLowerCase() === q);
                          const matches = (q
                            ? NATIONALITIES.filter((n) => n.toLowerCase().startsWith(q)).concat(
                                NATIONALITIES.filter((n) => !n.toLowerCase().startsWith(q) && n.toLowerCase().includes(q))
                              )
                            : NATIONALITIES.slice(0, 8)
                          ).slice(0, 7);
                          const showOther = q.length >= 2 && !known;
                          const options = [...matches, ...(showOther ? [`__other__`] : [])];
                          const pick = (value: string) => {
                            setNationality(sanitizeNationalityInput(value));
                            setNationalityOpen(false);
                          };
                          return (
                            <div className="relative block min-w-0">
                              {label("Nationality", true)}
                              <span className="relative block">
                                <Globe className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                <input
                                  type="text"
                                  role="combobox"
                                  aria-expanded={nationalityOpen}
                                  aria-controls="nationality-options"
                                  aria-autocomplete="list"
                                  value={nationality}
                                  inputMode="text"
                                  autoComplete="off"
                                  onFocus={() => {
                                    setNationalityOpen(true);
                                    setNationalityCursor(0);
                                  }}
                                  onBlur={() => window.setTimeout(() => setNationalityOpen(false), 120)}
                                  onChange={(e) => {
                                    setError(null);
                                    setNationality(sanitizeNationalityInput(e.target.value));
                                    setNationalityOpen(true);
                                    setNationalityCursor(0);
                                  }}
                                  onKeyDown={(e) => {
                                    if (!nationalityOpen || options.length === 0) return;
                                    if (e.key === "ArrowDown") {
                                      e.preventDefault();
                                      setNationalityCursor((c) => Math.min(options.length - 1, c + 1));
                                    } else if (e.key === "ArrowUp") {
                                      e.preventDefault();
                                      setNationalityCursor((c) => Math.max(0, c - 1));
                                    } else if (e.key === "Enter") {
                                      e.preventDefault();
                                      const chosen = options[nationalityCursor];
                                      pick(chosen === "__other__" ? nationality : chosen);
                                    } else if (e.key === "Escape") {
                                      setNationalityOpen(false);
                                    }
                                  }}
                                  className={field(false, known)}
                                  placeholder="Search, e.g. Tanzanian"
                                />
                                {known ? (
                                  tick(true)
                                ) : nationality ? (
                                  <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 rounded bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-slate-500">
                                    Other
                                  </span>
                                ) : null}
                              </span>

                              {nationalityOpen && options.length > 0 && (
                                <ul
                                  id="nationality-options"
                                  role="listbox"
                                  className="absolute left-0 right-0 top-full z-30 m-0 mt-1 max-h-64 list-none overflow-y-auto rounded-xl border border-solid border-slate-200 bg-white p-1 shadow-[0_18px_40px_-16px_rgba(15,23,42,0.35)]"
                                >
                                  {options.map((opt, i) => {
                                    const active = i === nationalityCursor;
                                    const isOther = opt === "__other__";
                                    return (
                                      <li
                                        key={opt}
                                        role="option"
                                        aria-selected={active}
                                        onMouseDown={(e) => {
                                          e.preventDefault();
                                          pick(isOther ? nationality : opt);
                                        }}
                                        onMouseEnter={() => setNationalityCursor(i)}
                                        className={`flex cursor-pointer items-center justify-between gap-2 rounded-lg px-3 py-2 text-[14px] ${
                                          active ? "bg-[#02665e]/[0.07] text-[#02665e]" : "text-slate-700"
                                        } ${isOther ? "mt-1 border-0 border-t border-solid border-slate-100" : ""}`}
                                      >
                                        {isOther ? (
                                          <span className="min-w-0 truncate">
                                            Use <span className="font-semibold">&ldquo;{nationality.trim()}&rdquo;</span>
                                            <span className="ml-1.5 text-[12px] text-slate-400">Other</span>
                                          </span>
                                        ) : (
                                          <span className="min-w-0 truncate">{opt}</span>
                                        )}
                                        {!isOther && opt.toLowerCase() === q && <CheckCircle2 className="h-4 w-4 flex-none text-[#02665e]" aria-hidden />}
                                      </li>
                                    );
                                  })}
                                </ul>
                              )}
                            </div>
                          );
                        })()}

                        <div className="min-w-0">
                          {label("Gender", true)}
                          {/* Segmented choice: one tap, no dropdown */}
                          <div role="radiogroup" aria-label="Gender" className="grid h-12 grid-cols-3 gap-2">
                            {(["Male", "Female", "Other"] as const).map((option) => {
                              const on = sex === option;
                              return (
                                <button
                                  key={option}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  onClick={() => setSex(option)}
                                  
                                  className={`box-border flex items-center justify-center gap-2 rounded-xl border border-solid px-2 text-[14px] font-medium transition-all ${
                                    on
                                      ? "border-[#02665e] bg-[#02665e]/[0.06] font-semibold text-[#02665e] shadow-[0_6px_16px_-12px_rgba(2,102,94,0.7)]"
                                      : "border-slate-300 bg-white text-slate-700 hover:border-[#02665e]/40 hover:text-slate-900"
                                  }`}
                                >
                                  {/* Radio dot so it reads as a single choice */}
                                  <span
                                    aria-hidden
                                    className={`box-border flex h-4 w-4 flex-none items-center justify-center rounded-full border-2 border-solid ${
                                      on ? "border-[#02665e]" : "border-slate-300"
                                    }`}
                                  >
                                    {on && <span className="h-2 w-2 rounded-full bg-[#02665e]" />}
                                  </span>
                                  {option}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* Transportation Option */}
                <div className="border-0 border-t border-solid border-slate-100 pt-5">
                  {/* Whole card toggles the ride; the switch mirrors its state */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={includeTransport}
                    aria-disabled={transportLocked}
                    disabled={transportLocked}
                    onClick={() => {
                      if (transportLocked) return;
                      setError(null);
                      setIncludeTransport((value) => !value);
                    }}
                    className={`group box-border block w-full overflow-hidden rounded-xl border border-solid p-0 text-left transition-all disabled:cursor-not-allowed ${
                      transportLocked
                        ? "border-slate-200 bg-slate-50"
                        : includeTransport
                          ? "border-[#02665e] bg-[#02665e]/[0.04] shadow-[0_10px_24px_-18px_rgba(2,102,94,0.7)]"
                          : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:shadow-[0_10px_24px_-20px_rgba(15,23,42,0.4)]"
                    }`}
                  >
                    <span className="flex items-center gap-3.5 px-4 py-3.5">
                      <span
                        className={`relative flex h-11 w-11 flex-none items-center justify-center rounded-xl transition-colors ${
                          transportLocked ? "bg-slate-200 text-slate-400" : includeTransport ? "bg-[#02665e] text-white" : "bg-[#02665e]/10 text-[#02665e]"
                        }`}
                      >
                        <Car className="h-5 w-5" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-[15px] font-semibold text-slate-900">Need a ride to the property?</span>
                          {transportLocked ? (
                            <span className="rounded-md bg-slate-200 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-slate-500">Not here yet</span>
                          ) : includeTransport ? (
                            <span className="rounded-md bg-[#02665e] px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-white">Added</span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">
                          {transportLocked
                            ? transportGate?.reason || "We don't have drivers in this area yet. You can continue with the stay booking only."
                            : includeTransport
                              ? "Set your ride and pickup below. The fare is added to your total."
                              : "Book a driver with your stay, from your location or your arrival point."}
                        </span>
                      </span>
                      <span className="flex flex-none items-center gap-2">
                        <span className={`hidden text-[12px] font-semibold sm:inline ${includeTransport ? "text-[#02665e]" : "text-slate-400"}`}>
                          {includeTransport ? "On" : "Off"}
                        </span>
                        <span
                          aria-hidden
                          className={`relative block h-7 w-12 rounded-full transition-colors duration-200 ${
                            includeTransport ? "bg-[#02665e]" : transportLocked ? "bg-slate-200" : "bg-slate-300 group-hover:bg-slate-400"
                          }`}
                        >
                          <span className={`absolute top-1 block h-5 w-5 rounded-full bg-white shadow transition-all duration-200 ${includeTransport ? "left-6" : "left-1"}`} />
                        </span>
                      </span>
                    </span>

                    {/* What you get, shown before switching on */}
                    {!transportLocked && !includeTransport && (
                      <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-0 border-t border-dashed border-slate-200 bg-slate-50/60 px-4 py-2.5 text-[12px] text-slate-600">
                        <span className="inline-flex items-center gap-1" aria-hidden>
                          <span>🏍️</span>
                          <span>🛺</span>
                          <span>🚗</span>
                          <span>🚐</span>
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Navigation className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                          Pickup from your location
                        </span>
                        <span className="inline-flex items-center gap-1.5">
                          <Plane className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                          Airport, bus or ferry
                        </span>
                      </span>
                    )}
                  </button>

                  {includeTransport && !transportLocked && (
                    <div className="mt-3 box-border rounded-xl border border-solid border-slate-200 bg-white p-4 sm:p-5">
                      {(() => {
                        const vehicles = [
                          { value: "BODA" as TransportVehicleType, icon: "🏍️", label: "Boda", tier: "Budget" },
                          { value: "BAJAJI" as TransportVehicleType, icon: "🛺", label: "Bajaji", tier: "Economy" },
                          { value: "CAR" as TransportVehicleType, icon: "🚗", label: "Car", tier: "Standard" },
                          { value: "XL" as TransportVehicleType, icon: "🚐", label: "XL / Van", tier: "Roomy" },
                          { value: "PREMIUM" as TransportVehicleType, icon: "🚘", label: "Premium", tier: "Luxury" },
                        ];
                        const modes = [
                          { mode: "current" as const, icon: <Navigation className="h-4 w-4" />, title: "My location", desc: "Use GPS now" },
                          { mode: "arrival" as const, icon: <Plane className="h-4 w-4" />, title: "Arrival point", desc: "Airport, bus or ferry" },
                          { mode: "manual" as const, icon: <MapPin className="h-4 w-4" />, title: "An address", desc: "Search a place" },
                        ];
                        const resetPickup = () => {
                          setTransportOriginAddress("");
                          setTransportOriginLat(null);
                          setTransportOriginLng(null);
                          setTransportFare(null);
                          setCurrentPickupConfirmed(false);
                          setCurrentPickupNeedsConfirm(false);
                          setPickupPresetId("");
                        };
                        const pinSet = transportOriginLat !== null && transportOriginLng !== null;
                        const vehicle = vehicles.find((v) => v.value === transportVehicleType);
                        const step = (n: number, done: boolean, active: boolean) => (
                          <span
                            className={`relative z-10 hidden h-7 w-7 flex-none sm:flex items-center justify-center rounded-full text-[12px] font-bold ring-4 ring-white ${
                              done ? "bg-[#02665e] text-white" : active ? "bg-white text-[#02665e] ring-offset-0 [box-shadow:inset_0_0_0_2px_#02665e]" : "bg-slate-100 text-slate-400"
                            }`}
                          >
                            {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : n}
                          </span>
                        );

                        return (
                          <ol className="relative m-0 list-none space-y-5 p-0">
                            {/* Rail connecting the three steps */}
                            <span aria-hidden className="absolute bottom-3 left-[13px] top-3 hidden w-0.5 rounded-full bg-slate-100 sm:block" />

                            {/* 1. Vehicle */}
                            <li className="relative flex gap-3">
                              {step(1, Boolean(transportVehicleType), !transportVehicleType)}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                  <p className="m-0 text-[14px] font-semibold text-slate-900"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] align-[1px] text-[11px] font-bold text-white sm:hidden">1</span>Choose your ride</p>
                                  <p className="m-0 hidden text-[11.5px] text-slate-400 sm:block">Fare depends on the vehicle</p>
                                </div>
                                <div className="mt-2.5 grid grid-cols-5 gap-1 sm:gap-2" role="radiogroup" aria-label="Vehicle type">
                                  {vehicles.map((v) => {
                                    const on = transportVehicleType === v.value;
                                    return (
                                      <button
                                        key={v.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={on}
                                        onClick={() => setTransportVehicleType(v.value)}
                                        className={`box-border flex min-w-0 flex-col items-center gap-0.5 rounded-lg border border-solid px-0.5 py-2 transition-all sm:rounded-xl sm:px-1 sm:py-2.5 ${
                                          on
                                            ? "border-[#02665e] bg-[#02665e]/[0.06] shadow-[0_6px_16px_-10px_rgba(2,102,94,0.6)]"
                                            : "border-slate-200 bg-white hover:border-[#02665e]/40"
                                        }`}
                                      >
                                        <span className="text-[20px] leading-none sm:text-[22px]">{v.icon}</span>
                                        <span className={`mt-1 w-full truncate text-center text-[11px] font-semibold sm:text-[12px] ${on ? "text-[#02665e]" : "text-slate-800"}`}>{v.label}</span>
                                        <span className={`hidden w-full truncate text-center text-[10.5px] sm:block ${on ? "text-[#02665e]/80" : "text-slate-400"}`}>{v.tier}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </li>

                            {/* 2. Pickup */}
                            <li className={`relative flex gap-3 ${transportVehicleType ? "" : "opacity-50"}`}>
                              {step(2, pinSet, Boolean(transportVehicleType) && !pinSet)}
                              <div className="min-w-0 flex-1">
                                <p className="m-0 text-[14px] font-semibold text-slate-900"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] align-[1px] text-[11px] font-bold text-white sm:hidden">2</span>Where should we pick you up?</p>
                                {!transportVehicleType ? (
                                  <p className="m-0 mt-1 text-[12.5px] text-slate-500">Choose a ride first.</p>
                                ) : (
                                  <>
                                    {/* Method tabs */}
                                    <div className="mt-2.5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Pickup method">
                                      {modes.map((m) => {
                                        const on = pickupMethodChosen && pickupMode === m.mode;
                                        return (
                                          <button
                                            key={m.mode}
                                            type="button"
                                            role="radio"
                                            aria-checked={on}
                                            onClick={() => {
                                              if (pickupMode !== m.mode) resetPickup();
                                              setPickupMode(m.mode);
                                              setPickupMethodChosen(true);
                                            }}
                                            className={`group relative box-border flex min-w-0 flex-col items-center gap-1 rounded-lg border border-solid px-1 py-2.5 text-center sm:gap-1.5 sm:rounded-xl sm:px-2 sm:py-3 transition-all sm:flex-row sm:items-center sm:gap-2.5 sm:px-3 sm:text-left ${
                                              on
                                                ? "border-[#02665e] bg-[#02665e]/[0.06] shadow-[0_6px_16px_-10px_rgba(2,102,94,0.6)]"
                                                : "border-slate-200 bg-white hover:-translate-y-px hover:border-[#02665e]/40 hover:shadow-[0_6px_16px_-12px_rgba(15,23,42,0.3)]"
                                            }`}
                                          >
                                            <span
                                              className={`flex h-8 w-8 flex-none items-center justify-center rounded-lg transition-colors sm:h-9 sm:w-9 ${
                                                on ? "bg-[#02665e] text-white" : "bg-[#02665e]/10 text-[#02665e] group-hover:bg-[#02665e]/15"
                                              }`}
                                            >
                                              {m.icon}
                                            </span>
                                            <span className="min-w-0 sm:flex-1">
                                              <span className={`block truncate text-[12px] font-semibold sm:text-[13px] ${on ? "text-[#02665e]" : "text-slate-900"}`}>{m.title}</span>
                                              <span className="hidden truncate text-[11.5px] text-slate-500 sm:block">{m.desc}</span>
                                            </span>
                                            {on && (
                                              <CheckCircle2 className="absolute right-1.5 top-1.5 h-4 w-4 text-[#02665e] sm:static sm:flex-none" aria-hidden />
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    {!pickupMethodChosen && (
                                      <p className="m-0 mt-2 text-[12px] text-slate-500">Pick one to set where the driver meets you.</p>
                                    )}

                                    {pickupMethodChosen && (
                                      <div className="mt-3 space-y-2.5">
                                        {pickupMode === "current" && (
                                          <>
                                            {!currentPickupConfirmed && !currentPickupNeedsConfirm && (
                                              <button
                                                type="button"
                                                onClick={handleGetLocation}
                                                disabled={calculatingFare}
                                                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border-0 bg-[#02665e] text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-60"
                                              >
                                                <Navigation className="h-4 w-4" />
                                                {calculatingFare ? "Finding you" : "Use my current location"}
                                              </button>
                                            )}
                                            {currentPickupConfirmed && (
                                              <button
                                                type="button"
                                                onClick={resetPickup}
                                                className="inline-flex items-center gap-1.5 border-0 bg-transparent p-0 text-[12.5px] font-semibold text-[#02665e] hover:underline"
                                              >
                                                <Navigation className="h-3.5 w-3.5" />
                                                Detect my location again
                                              </button>
                                            )}
                                            {currentPickupNeedsConfirm && transportOriginAddress.trim() && (
                                              <div className="rounded-xl border border-solid border-slate-200 bg-slate-50 p-3">
                                                <p className="m-0 text-[12px] font-semibold text-slate-500">Is this where you are?</p>
                                                <p className="m-0 mt-0.5 break-words text-[14px] text-slate-900">{transportOriginAddress}</p>
                                                <div className="mt-2.5 grid grid-cols-2 gap-2">
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      setCurrentPickupConfirmed(true);
                                                      setCurrentPickupNeedsConfirm(false);
                                                    }}
                                                    className="h-10 rounded-lg border-0 bg-[#02665e] text-[13px] font-semibold text-white hover:bg-[#014e47]"
                                                  >
                                                    Yes, pick me up here
                                                  </button>
                                                  <button
                                                    type="button"
                                                    onClick={() => {
                                                      resetPickup();
                                                      setPickupMode("manual");
                                                      window.setTimeout(() => pickupAddressRef.current?.focus(), 0);
                                                    }}
                                                    className="h-10 rounded-lg border border-solid border-slate-300 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50"
                                                  >
                                                    Type it instead
                                                  </button>
                                                </div>
                                              </div>
                                            )}
                                          </>
                                        )}

                                        {pickupMode === "arrival" && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => setLocationPickerOpen(true)}
                                              className="group box-border flex w-full items-center gap-3 rounded-xl border border-solid border-slate-300 bg-white px-3.5 py-3 text-left transition-colors hover:border-[#02665e]/50"
                                            >
                                              {pickupPresetId && TANZANIA_LOCATIONS.find((p) => p.id === pickupPresetId) ? (
                                                (() => {
                                                  const preset = TANZANIA_LOCATIONS.find((p) => p.id === pickupPresetId)!;
                                                  const glyph = preset.category === "airport" ? "✈" : preset.category === "bus_terminal" ? "🚌" : "⛴";
                                                  return (
                                                    <>
                                                      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-[#02665e]/10 text-base">{glyph}</span>
                                                      <span className="min-w-0 flex-1">
                                                        <span className="line-clamp-2 block text-[14px] font-semibold leading-snug text-slate-900 sm:truncate">{preset.label}</span>
                                                        <span className="block text-[12px] text-slate-500">
                                                          {preset.city}
                                                          {preset.iataCode ? ` · ${preset.iataCode}` : ""}
                                                        </span>
                                                      </span>
                                                      <span className="text-[12.5px] font-semibold text-[#02665e]">Change</span>
                                                    </>
                                                  );
                                                })()
                                              ) : (
                                                <>
                                                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                                                    <Plane className="h-4 w-4" />
                                                  </span>
                                                  <span className="min-w-0 flex-1 text-[14px] text-slate-500">Choose airport, bus terminal or ferry port</span>
                                                  <span className="text-[12.5px] font-semibold text-[#02665e]">Browse</span>
                                                </>
                                              )}
                                            </button>
                                            <LocationPickerModal
                                              open={locationPickerOpen}
                                              selectedId={pickupPresetId}
                                              onSelectAction={(id) => handleSelectPickupPreset(id)}
                                              onCloseAction={() => setLocationPickerOpen(false)}
                                            />
                                          </>
                                        )}

                                        {pickupMode === "manual" && (
                                          <div className="flex gap-2">
                                            <span className="relative block min-w-0 flex-1">
                                              <MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                              <input
                                                type="text"
                                                ref={pickupAddressRef}
                                                value={transportOriginAddress}
                                                onChange={(e) => setTransportOriginAddress(e.target.value)}
                                                onKeyDown={(e) => {
                                                  if (e.key === "Enter") {
                                                    e.preventDefault();
                                                    handleGeocodePickupAddress();
                                                  }
                                                }}
                                                placeholder="e.g. Mlimani City Mall, Dar es Salaam"
                                                className="box-border h-11 w-full rounded-xl border border-solid border-slate-300 bg-white pl-10 pr-3 text-[14px] outline-none transition focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10"
                                                required={includeTransport}
                                              />
                                            </span>
                                            <button
                                              type="button"
                                              onClick={handleGeocodePickupAddress}
                                              disabled={calculatingFare || !transportOriginAddress.trim()}
                                              className="h-11 flex-none rounded-xl border-0 bg-[#02665e] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-not-allowed disabled:opacity-40"
                                            >
                                              {calculatingFare ? "Finding" : "Find"}
                                            </button>
                                          </div>
                                        )}

                                        {transportPickupError && (
                                          <p className="m-0 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-[12.5px] font-medium text-rose-700">
                                            <AlertCircle className="mt-px h-3.5 w-3.5 flex-none" />
                                            {transportPickupError}
                                          </p>
                                        )}
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            </li>

                            {/* 3. Route: pickup → property */}
                            <li className={`relative flex gap-3 ${pinSet ? "" : "opacity-50"}`}>
                              {step(3, false, pinSet)}
                              <div className="min-w-0 flex-1">
                                <p className="m-0 text-[14px] font-semibold text-slate-900"><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] align-[1px] text-[11px] font-bold text-white sm:hidden">3</span>Your route</p>
                                <div className="mt-2 box-border rounded-xl border border-solid border-slate-200 bg-slate-50/60 p-3">
                                  <div className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1">
                                    <span className="flex h-4 w-4 items-center justify-center">
                                      <span className="h-2.5 w-2.5 rounded-full border-2 border-solid border-[#02665e] bg-white" />
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Pickup</span>
                                      <span className={`block truncate text-[13.5px] ${pinSet ? "font-medium text-slate-900" : "text-slate-400"}`}>
                                        {pinSet ? transportOriginAddress || `${transportOriginLat!.toFixed(4)}, ${transportOriginLng!.toFixed(4)}` : "Not set yet"}
                                      </span>
                                    </span>
                                    {pinSet ? (
                                      <a
                                        href={`https://maps.google.com/?q=${transportOriginLat},${transportOriginLng}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[12px] font-semibold text-[#02665e] no-underline hover:underline"
                                      >
                                        Map
                                      </a>
                                    ) : (
                                      <span />
                                    )}
                                    <span className="flex h-5 w-4 justify-center" aria-hidden>
                                      <span className="h-full w-0 border-0 border-l-2 border-dotted border-slate-300" />
                                    </span>
                                    <span className="col-span-2 text-[11.5px] text-slate-400">{vehicle ? `${vehicle.label} · ${vehicle.tier}` : ""}</span>
                                    <span className="flex h-4 w-4 items-center justify-center">
                                      <MapPin className="h-4 w-4 text-[#02665e]" aria-hidden />
                                    </span>
                                    <span className="col-span-2 min-w-0">
                                      <span className="block text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Drop-off</span>
                                      <span className="block truncate text-[13.5px] font-medium text-slate-900">{property?.title || "Your stay"}</span>
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </li>
                          </ol>
                        );
                      })()}

                      {/* Arrival details: a boarding-pass style card */}
                      {pickupMode === "current" ? (
                        <p className="m-0 mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-[12.5px] text-slate-600">
                          <Info className="mt-px h-3.5 w-3.5 flex-none text-slate-400" />
                          <span>
                            Instant pickup needs no arrival details. Choose <span className="font-semibold text-slate-800">Arrival point</span> for a timed airport, bus or ferry pickup.
                          </span>
                        </p>
                      ) : (
                        (() => {
                          const kinds = [
                            { value: "FLIGHT", icon: "✈", label: "Flight", num: "Flight no.", numPh: "e.g. PW 715", co: "Airline", coPh: "e.g. Precision Air", spot: "Terminal or gate", spotPh: "e.g. Terminal 3, arrivals hall" },
                            { value: "BUS", icon: "🚌", label: "Bus", num: "Bus no.", numPh: "e.g. T 123 ABC", co: "Bus company", coPh: "e.g. Kilimanjaro Express", spot: "Station or platform", spotPh: "e.g. Magufuli Bus Terminal, bay 5" },
                            { value: "TRAIN", icon: "🚆", label: "Train", num: "Train no.", numPh: "e.g. SGR 102", co: "Operator", coPh: "e.g. TRC SGR", spot: "Station or platform", spotPh: "e.g. Dodoma SGR station, platform 2" },
                            { value: "FERRY", icon: "⛴", label: "Ferry", num: "Vessel", numPh: "e.g. Kilimanjaro VI", co: "Operator", coPh: "e.g. Azam Marine", spot: "Port or dock", spotPh: "e.g. Zanzibar port, gate B" },
                            { value: "OTHER", icon: "📍", label: "Other", num: "Reference", numPh: "Any reference number", co: "Company", coPh: "Company name", spot: "Pickup spot", spotPh: "Describe where to meet" },
                          ] as const;
                          const kind = kinds.find((k) => k.value === arrivalType);
                          const input =
                            "box-border h-11 w-full min-w-0 rounded-lg border border-solid border-slate-300 bg-white px-3 text-[14px] font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:ring-4 focus:ring-[#02665e]/10 disabled:cursor-not-allowed disabled:bg-slate-50";
                          const lbl = (text: string, required = false) => (
                            <span className="mb-1 block text-[11.5px] font-semibold uppercase tracking-[0.06em] text-slate-500">
                              {text}
                              {required && <span className="ml-0.5 text-rose-500">*</span>}
                            </span>
                          );
                          const time = arrivalTimeHour !== "" && arrivalTimeMinute !== "" ? `${arrivalTimeHour.padStart(2, "0")}:${arrivalTimeMinute.padStart(2, "0")}` : "";
                          const dateText = arrivalDate
                            ? new Date(arrivalDate).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
                            : "";

                          return (
                            <div className="mt-4 box-border overflow-hidden rounded-xl border border-solid border-slate-200">
                              {/* Header strip */}
                              <div className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3">
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#02665e] text-white">
                                    <Plane className="h-4 w-4" aria-hidden />
                                  </span>
                                  <div className="min-w-0">
                                    <p className="m-0 text-[14px] font-semibold text-slate-900">Arrival details</p>
                                    <p className="m-0 truncate text-[12px] text-slate-500">So your driver is there when you land or arrive</p>
                                  </div>
                                </div>
                                <span
                                  className={`flex-none rounded-md px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ${
                                    requiresArrivalInfo ? "bg-rose-50 text-rose-600" : "bg-slate-200/70 text-slate-500"
                                  }`}
                                >
                                  {requiresArrivalInfo ? "Required" : "Optional"}
                                </span>
                              </div>

                              <div className="space-y-4 px-4 py-4">
                                {/* Arriving by */}
                                <div>
                                  {lbl("Arriving by", requiresArrivalInfo)}
                                  {arrivalTypeLocked ? (
                                    <p className="m-0 inline-flex items-center gap-2 rounded-lg bg-[#02665e]/[0.07] px-3 py-2 text-[14px] font-semibold text-[#02665e]">
                                      <span aria-hidden>{kind?.icon ?? "📍"}</span>
                                      {kind?.label ?? "Other"}
                                      <span className="text-[11.5px] font-normal text-[#02665e]/70">set from your pickup point</span>
                                    </p>
                                  ) : (
                                    <div className="grid grid-cols-5 gap-1.5" role="radiogroup" aria-label="Arriving by">
                                      {kinds.map((k) => {
                                        const on = arrivalType === k.value;
                                        return (
                                          <button
                                            key={k.value}
                                            type="button"
                                            role="radio"
                                            aria-checked={on}
                                            onClick={() => setArrivalType(k.value)}
                                            className={`box-border flex min-w-0 flex-col items-center gap-0.5 rounded-lg border border-solid py-2 text-[12px] font-semibold transition ${
                                              on ? "border-[#02665e] bg-[#02665e]/[0.06] text-[#02665e]" : "border-slate-200 bg-white text-slate-600 hover:border-[#02665e]/40"
                                            }`}
                                          >
                                            <span className="text-[18px] leading-none" aria-hidden>
                                              {k.icon}
                                            </span>
                                            <span className="w-full truncate text-center">{k.label}</span>
                                          </button>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>

                                {/* Ticket row: number + company */}
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <label className="block min-w-0">
                                    {lbl(kind?.num ?? "Number")}
                                    <input
                                      type="text"
                                      value={arrivalNumber}
                                      onChange={(e) => setArrivalNumber(e.target.value.toUpperCase())}
                                      disabled={!arrivalType}
                                      placeholder={kind?.numPh ?? "Choose how you arrive first"}
                                      className={`${input} font-mono tracking-wide`}
                                    />
                                  </label>
                                  <label className="block min-w-0">
                                    {lbl(kind?.co ?? "Company")}
                                    <input
                                      type="text"
                                      value={transportCompany}
                                      onChange={(e) => setTransportCompany(e.target.value)}
                                      disabled={!arrivalType}
                                      placeholder={kind?.coPh ?? "Choose how you arrive first"}
                                      className={input}
                                    />
                                  </label>
                                </div>

                                {/* When */}
                                <div className="grid grid-cols-[minmax(0,1fr)_128px] gap-3">
                                  <div className="relative min-w-0">
                                    {lbl("Arrival date", requiresArrivalInfo)}
                                    <button
                                      ref={arrivalDateBtnRef}
                                      type="button"
                                      onClick={() => setArrivalDatePickerOpen(true)}
                                      className={`${input} flex items-center gap-2 text-left`}
                                    >
                                      <Calendar className="h-4 w-4 flex-none text-[#02665e]" aria-hidden />
                                      <span className={`truncate ${dateText ? "" : "font-normal text-slate-400"}`}>{dateText || "Pick a date"}</span>
                                    </button>
                                    {arrivalDatePickerOpen && (
                                      <>
                                        {/* Centred popup: the card clips overflow, so the calendar must not open inside it */}
                                        <div className="fixed inset-0 z-[190] bg-black/30" onClick={() => setArrivalDatePickerOpen(false)} />
                                        <div className="fixed left-1/2 top-1/2 z-[200] -translate-x-1/2 -translate-y-1/2">
                                          <DatePicker
                                            selected={arrivalDate}
                                            onSelectAction={(s) => {
                                              const date = Array.isArray(s) ? s[0] : s;
                                              setArrivalDate(date || "");
                                              setArrivalDatePickerOpen(false);
                                            }}
                                            onCloseAction={() => setArrivalDatePickerOpen(false)}
                                            allowRange={false}
                                            minDate={new Date().toISOString().split("T")[0]}
                                          />
                                        </div>
                                      </>
                                    )}
                                  </div>
                                  <label className="block min-w-0">
                                    {lbl("Time", requiresArrivalInfo)}
                                    {/* Native time picker, stored as hour and minute */}
                                    <input
                                      type="time"
                                      value={time}
                                      onChange={(e) => {
                                        const [h = "", m = ""] = e.target.value.split(":");
                                        setArrivalTimeHour(h);
                                        setArrivalTimeMinute(m);
                                      }}
                                      required={requiresArrivalInfo}
                                      className={`${input} tabular-nums`}
                                    />
                                  </label>
                                </div>

                                {/* Where exactly */}
                                <label className="block min-w-0">
                                  {lbl(kind?.spot ?? "Pickup spot", requiresArrivalInfo)}
                                  <span className="relative block">
                                    <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
                                    <input
                                      type="text"
                                      value={pickupLocation}
                                      onChange={(e) => setPickupLocation(e.target.value)}
                                      placeholder={kind?.spotPh ?? "Where should the driver meet you?"}
                                      required={requiresArrivalInfo}
                                      className={`${input} pl-9`}
                                    />
                                  </span>
                                  <span className="mt-1 block text-[12px] text-slate-400">The more exact, the faster your driver finds you.</span>
                                </label>

                                {/* Live recap */}
                                {(arrivalNumber || dateText || time) && (
                                  <p className="m-0 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#02665e]/[0.06] px-3 py-2 text-[12.5px] text-[#02665e]">
                                    <CheckCircle2 className="h-3.5 w-3.5 flex-none" aria-hidden />
                                    <span className="font-semibold">Driver will meet</span>
                                    {arrivalNumber && <span className="font-mono">{arrivalNumber}</span>}
                                    {dateText && <span>· {dateText}</span>}
                                    {time && <span>· {time}</span>}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })()
                      )}

                      {includeTransport && transportOriginLat !== null && transportOriginLng !== null && !!property && (!property.latitude || !property.longitude) && (
                        <div className="mt-4 flex items-start gap-3 rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-inset ring-amber-200">
                          <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                            <AlertCircle className="h-4 w-4" aria-hidden />
                          </span>
                          <div className="min-w-0 text-[12.5px] leading-snug text-amber-900">
                            <p className="m-0 font-semibold">Estimated fare</p>
                            <p className="m-0 mt-0.5 text-amber-800">
                              This property&apos;s map location isn&apos;t set yet, so the fare shown is the minimum base rate. Your driver confirms the final fare.
                            </p>
                          </div>
                        </div>
                      )}

                      {calculatingFare && transportFare === null && (
                        <div className="animate-in fade-in duration-200 rounded-2xl overflow-hidden border border-slate-200/80 bg-white shadow-sm">
                          {/* skeleton header */}
                          <div className="px-5 pt-5 pb-4 border-b border-slate-100">
                            <div className="flex items-center justify-between mb-5">
                              <div className="h-3 w-20 rounded-full bg-slate-200 animate-pulse" />
                              <div className="flex gap-1.5">
                                <div className="h-6 w-14 rounded-full bg-slate-100 animate-pulse" />
                                <div className="h-6 w-14 rounded-full bg-slate-100 animate-pulse" />
                              </div>
                            </div>
                            {/* route skeleton */}
                            <div className="flex gap-4">
                              <div className="flex flex-col items-center gap-0 pt-0.5">
                                <div className="w-3 h-3 rounded-full border-2 border-slate-300 bg-white animate-pulse" />
                                <div className="w-px flex-1 border-l-2 border-dashed border-slate-200 my-1.5" style={{minHeight: 36}} />
                                <div className="w-3 h-3 rounded-sm bg-slate-300 animate-pulse" />
                              </div>
                              <div className="flex-1 flex flex-col justify-between gap-5 min-w-0">
                                <div className="space-y-1.5">
                                  <div className="h-2.5 w-16 rounded-full bg-slate-100 animate-pulse" />
                                  <div className="h-3.5 w-44 rounded-full bg-slate-200 animate-pulse" />
                                </div>
                                <div className="space-y-1.5">
                                  <div className="h-2.5 w-14 rounded-full bg-slate-100 animate-pulse" />
                                  <div className="h-3.5 w-32 rounded-full bg-slate-200 animate-pulse" />
                                </div>
                              </div>
                            </div>
                            {/* chips skeleton */}
                            <div className="flex gap-2 mt-5">
                              <div className="h-7 w-20 rounded-full bg-slate-100 animate-pulse" />
                              <div className="h-7 w-20 rounded-full bg-slate-100 animate-pulse" />
                            </div>
                          </div>
                          {/* skeleton fare row */}
                          <div className="px-5 py-4 flex items-center justify-between gap-4">
                            <div className="space-y-1.5">
                              <div className="h-2.5 w-24 rounded-full bg-slate-100 animate-pulse" />
                              <div className="h-7 w-32 rounded-full bg-slate-200 animate-pulse" />
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="relative w-3 h-3">
                                <div className="absolute inset-0 rounded-full bg-[#02665e]/40 animate-ping" />
                                <div className="w-3 h-3 rounded-full bg-[#02665e]/60" />
                              </div>
                              <span className="text-xs font-semibold text-slate-400 tracking-wide">Calculating…</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {transportFare !== null && (() => {
                        const hasCoords =
                          transportOriginLat !== null &&
                          transportOriginLng !== null &&
                          !!property &&
                          property.latitude !== null &&
                          property.longitude !== null;
                        const fareAt = arrivalDate
                          ? (() => {
                              const d = new Date(arrivalDate);
                              if (isNaN(d.getTime())) return undefined;
                              if (arrivalTimeHour) d.setHours(parseInt(arrivalTimeHour) || 0);
                              if (arrivalTimeMinute) d.setMinutes(parseInt(arrivalTimeMinute) || 0);
                              return d;
                            })()
                          : undefined;
                        const fareDetail = hasCoords
                          ? calculateTransportFare(
                              { latitude: transportOriginLat!, longitude: transportOriginLng!, address: transportOriginAddress },
                              { latitude: property!.latitude!, longitude: property!.longitude! },
                              currency, fareAt, transportVehicleType
                            )
                          : null;
                        const distKm = fareDetail ? fareDetail.distance : null;
                        const etaMin = fareDetail ? fareDetail.estimatedTime : null;
                        const surgeAmount = fareDetail ? Math.max(0, fareDetail.total - fareDetail.subtotal) : 0;
                        return (
                          <div className="box-border overflow-hidden rounded-xl border border-solid border-slate-200 bg-white">
                            {/* Header */}
                            <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-4 py-3">
                              <p className="m-0 text-[14px] font-semibold text-slate-900">Your ride</p>
                              <div className="flex items-center gap-1.5">
                                <span className="inline-flex items-center gap-1 rounded-md bg-[#02665e]/10 px-2 py-1 text-[11.5px] font-semibold text-[#02665e]">
                                  <Car className="h-3.5 w-3.5" aria-hidden />
                                  {getVehicleTypeLabel(transportVehicleType)}
                                </span>
                                <span
                                  className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11.5px] font-semibold text-emerald-700"
                                  title="This fare is set now and won't change on the day"
                                >
                                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                                  Price locked
                                </span>
                              </div>
                            </div>

                            {/* Route */}
                            <div className="px-4 py-3.5">
                              <div className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-3">
                                <span className="flex justify-center pt-1">
                                  <span className="box-border block h-3.5 w-3.5 rounded-full border-[3px] border-solid border-[#02665e] bg-white" aria-hidden />
                                </span>
                                <div className="min-w-0 pb-3">
                                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Pickup</p>
                                  <p className="m-0 truncate text-[14px] font-semibold text-slate-900">{transportOriginAddress || "Your current location"}</p>
                                </div>
                                <span className="flex justify-center" aria-hidden>
                                  <span className="-mt-2 mb-1 block h-full w-0 border-0 border-l-2 border-dashed border-slate-300" />
                                </span>
                                <div className="min-w-0 pb-2">
                                  {(distKm !== null || etaMin !== null) && (
                                    <p className="m-0 inline-flex items-center gap-2 rounded-md bg-slate-100 px-2 py-0.5 text-[12px] font-medium text-slate-600">
                                      {distKm !== null && <span className="tabular-nums">{distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)} km</span>}
                                      {distKm !== null && etaMin !== null && <span className="text-slate-300">·</span>}
                                      {etaMin !== null && <span>about {formatDuration(etaMin)}</span>}
                                    </p>
                                  )}
                                </div>
                                <span className="flex justify-center pt-1">
                                  <MapPin className="h-4 w-4 text-[#02665e]" aria-hidden />
                                </span>
                                <div className="min-w-0">
                                  <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.06em] text-slate-400">Drop-off</p>
                                  <p className="m-0 truncate text-[14px] font-semibold text-slate-900">{softTitleCase(property?.title) || "Your stay"}</p>
                                  {property?.city && (
                                    <p className="m-0 truncate text-[12px] text-slate-500">
                                      {[property.city, property.district].map(softTitleCase).filter((v, i, a) => v && a.indexOf(v) === i).join(", ")}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* Fare */}
                            <div className="border-0 border-t border-solid border-slate-100 bg-slate-50/60 px-4 py-3.5">
                              {fareDetail && (
                                <dl className="m-0 space-y-1.5 text-[13px]">
                                  <div className="flex justify-between gap-3">
                                    <dt className="text-slate-500">Base fare</dt>
                                    <dd className="m-0 tabular-nums text-slate-700">{fareDetail.baseFare.toLocaleString()} {currency}</dd>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <dt className="text-slate-500">Distance</dt>
                                    <dd className="m-0 tabular-nums text-slate-700">{fareDetail.distanceFare.toLocaleString()} {currency}</dd>
                                  </div>
                                  <div className="flex justify-between gap-3">
                                    <dt className="text-slate-500">Travel time</dt>
                                    <dd className="m-0 tabular-nums text-slate-700">{fareDetail.timeFare.toLocaleString()} {currency}</dd>
                                  </div>
                                  {surgeAmount > 0 && (
                                    <div className="flex justify-between gap-3">
                                      <dt className="text-amber-700">Busy hours ×{fareDetail.surgeMultiplier.toFixed(1)}</dt>
                                      <dd className="m-0 tabular-nums text-amber-700">+{surgeAmount.toLocaleString()} {currency}</dd>
                                    </div>
                                  )}
                                </dl>
                              )}
                              <div className={`flex items-end justify-between gap-3 ${fareDetail ? "mt-3 border-0 border-t border-dashed border-slate-200 pt-3" : ""}`}>
                                <div>
                                  <p className="m-0 text-[13px] font-bold text-slate-900">Ride fare</p>
                                  <p className="m-0 text-[11.5px] text-slate-500">Added to your booking total</p>
                                </div>
                                <p className="m-0 text-[22px] font-extrabold leading-none tabular-nums text-[#02665e]">
                                  {transportFare.toLocaleString()}
                                  <span className="ml-1 text-[12px] font-bold">{currency}</span>
                                </p>
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-xl bg-rose-50 px-4 py-3 ring-1 ring-inset ring-rose-200" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-none text-rose-500" />
                    <p className="m-0 text-[13.5px] font-medium text-rose-700">{error}</p>
                  </div>
                )}

                {(() => {
                  const blocked =
                    submitting ||
                    availabilityState.status === "checking" ||
                    availabilityState.status === "unavailable" ||
                    (includeTransport && (calculatingFare || transportOriginLat === null || transportOriginLng === null || transportFare === null));
                  const d = fmtDisplay(finalTotal);
                  return (
                    <div className="border-0 border-t border-solid border-slate-100 pt-4">
                      <button
                        type="submit"
                        disabled={blocked}
                        className="group flex h-14 w-full items-center justify-between gap-3 rounded-xl border-0 bg-[#02665e] px-5 text-white shadow-[0_12px_28px_-14px_rgba(2,102,94,0.8)] transition-colors hover:bg-[#014e47] active:bg-[#013a35] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                      >
                        {submitting ? (
                          <span className="flex w-full items-center justify-center gap-2 text-[15px] font-semibold">
                            <LogoSpinner size="sm" ariaLabel="Creating booking" />
                            Creating your booking
                          </span>
                        ) : (
                          <>
                            <span className="text-left">
                              <span className="block text-[15px] font-bold leading-tight">Continue to payment</span>
                              <span className="block text-[12px] text-white/75">
                                {availabilityState.status === "unavailable"
                                  ? "Choose other dates to continue"
                                  : availabilityState.status === "checking"
                                    ? "Checking availability"
                                    : "Next: choose how to pay"}
                              </span>
                            </span>
                            <span className="flex items-center gap-2">
                              <span className="text-right text-[16px] font-extrabold tabular-nums">{d.primary}</span>
                              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 transition-transform group-hover:translate-x-0.5">
                                <ChevronRight className="h-4 w-4" aria-hidden />
                              </span>
                            </span>
                          </>
                        )}
                      </button>
                      <p className="m-0 mt-2.5 flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
                        <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                        You can review everything before paying
                      </p>
                    </div>
                  );
                })()}
              </form>
            </div>
          </div>

          {/* Sidebar: price details that mirror the stay on the left */}
          <div className="lg:col-span-1">
            {(() => {
              const titleCase = (s: string) =>
                s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()) : s;
              const name = titleCase(property?.title || "Your stay");
              const place = [property?.city, property?.regionName]
                .map((p) => titleCase(String(p || "").trim()))
                .filter((p, i, arr) => p && arr.findIndex((q) => q.toLowerCase() === p.toLowerCase()) === i)
                .join(", ");
              const inDate = bookingData?.checkIn ? new Date(bookingData.checkIn) : null;
              const outDate = bookingData?.checkOut ? new Date(bookingData.checkOut) : null;
              const short = (d: Date | null) => (d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "Add date");
              const guests = (bookingData?.adults || 1) + (bookingData?.children || 0);
              const roomName = (() => {
                if (!property?.roomsSpec || (!selectedRoomCode && selectedRoomIndex === null)) return "";
                const spec = property.roomsSpec as any;
                const list: any[] = Array.isArray(spec) ? spec : Array.isArray(spec?.rooms) ? spec.rooms : [];
                const room = selectedRoomCode
                  ? list.find((rt) => (rt.code || rt.roomCode) === selectedRoomCode)
                  : selectedRoomIndex !== null
                    ? list[selectedRoomIndex]
                    : null;
                return room ? String(room.roomType || room.name || room.label || "") : "";
              })();
              // Free cancellation deadline: 24 hours before check-in (matches the stated policy)
              const cancelBy = inDate && !isNaN(inDate.getTime()) ? new Date(inDate.getTime() - 24 * 60 * 60 * 1000) : null;
              const cancelOpen = cancelBy ? cancelBy.getTime() > Date.now() : false;
              const perNightAll = nights > 0 ? Math.round(finalTotal / nights) : null;
              const money = (n: number) => {
                const d = fmtDisplay(n);
                return (
                  <>
                    {d.primary}
                    {d.note && <span className="block text-[11px] font-normal text-slate-400">{d.note}</span>}
                  </>
                );
              };

              return (
                <div className="box-border overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(2,40,36,0.35)] lg:sticky lg:top-24">
                  {/* Photo header with the stay's name, so this card clearly belongs to that property */}
                  <div className="relative h-32 overflow-hidden" style={{ background: "linear-gradient(135deg, #013d38 0%, #02665e 70%, #037a70 100%)" }}>
                    {property?.primaryImage && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={property.primaryImage} alt="" className="absolute inset-0 h-full w-full object-cover" referrerPolicy="no-referrer" />
                    )}
                    <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-[#011a18]/90 via-[#011a18]/40 to-transparent" />
                    <div className="absolute inset-x-0 bottom-0 px-5 pb-3.5 text-white">
                      <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.14em] text-emerald-200">Price details</p>
                      <p className="m-0 mt-0.5 truncate text-[17px] font-bold leading-tight">{name}</p>
                      {place && (
                        <p className="m-0 mt-0.5 flex items-center gap-1 truncate text-[12px] text-white/75">
                          <MapPin className="h-3 w-3 flex-none" aria-hidden />
                          {place}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Stay strip */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-0 border-b border-solid border-slate-100 px-5 py-3">
                    <div className="min-w-0">
                      <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Check-in</p>
                      <p className="m-0 truncate text-[13px] font-semibold text-slate-900">{short(inDate)}</p>
                    </div>
                    <span className="rounded-full bg-[#02665e]/10 px-2 py-0.5 text-[11.5px] font-bold text-[#02665e]">
                      {nights > 0 ? `${nights}N` : "–"}
                    </span>
                    <div className="min-w-0 text-right">
                      <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.08em] text-slate-400">Check-out</p>
                      <p className="m-0 truncate text-[13px] font-semibold text-slate-900">{short(outDate)}</p>
                    </div>
                  </div>
                  <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 border-0 border-b border-solid border-slate-100 px-5 py-2 text-[12px] text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      {guests} guest{guests !== 1 ? "s" : ""}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Hotel className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                      {roomsQty} room{roomsQty !== 1 ? "s" : ""}
                      {roomName && <span className="font-medium text-slate-700">· {roomName}</span>}
                    </span>
                  </p>

                  {/* Breakdown */}
                  <div className="px-5 py-4">
                    <dl className="m-0 space-y-2.5 text-[13.5px]">
                      <div className="flex items-start justify-between gap-3">
                        <dt className="min-w-0 text-slate-600">
                          Stay
                          <span className="block text-[12px] text-slate-400">
                            {pricePerNight.toLocaleString()} TZS × {nights} night{nights !== 1 ? "s" : ""}
                            {roomsQty > 1 ? ` × ${roomsQty} rooms` : ""}
                          </span>
                        </dt>
                        <dd className="m-0 flex-none text-right font-semibold tabular-nums text-slate-900">{money(subtotal)}</dd>
                      </div>
                      {includeTransport && transportFare !== null && (
                        <div className="flex items-start justify-between gap-3">
                          <dt className="min-w-0 text-slate-600">
                            Transport
                            <span className="block text-[12px] text-slate-400">{getVehicleTypeLabel(transportVehicleType)} to the property</span>
                          </dt>
                          <dd className="m-0 flex-none text-right font-semibold tabular-nums text-slate-900">{money(transportFare)}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="mt-4 rounded-xl bg-[#02665e]/[0.06] px-4 py-3 ring-1 ring-inset ring-[#02665e]/15">
                      <div className="flex items-end justify-between gap-3">
                        <div>
                          <p className="m-0 text-[13px] font-bold text-slate-900">Total to pay</p>
                          {perNightAll !== null && (
                            <p className="m-0 text-[11.5px] text-slate-500">≈ {fmtDisplay(perNightAll).primary} per night</p>
                          )}
                        </div>
                        <div className="text-right">
                          {(() => {
                            const d = fmtDisplay(finalTotal);
                            return (
                              <>
                                <span className="block text-[24px] font-extrabold leading-none tracking-tight tabular-nums text-[#02665e]">{d.primary}</span>
                                {d.note && <span className="mt-1 block text-[11px] text-slate-400">{d.note}</span>}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Assurances, made specific */}
                  <div className="space-y-3 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-4">
                    <div className="flex items-start gap-2.5">
                      <span className={`mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full ${cancelOpen ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <p className="m-0 text-[12.5px] leading-snug text-slate-600">
                        {cancelBy ? (
                          cancelOpen ? (
                            <>
                              <span className="font-semibold text-slate-900">Free cancellation</span> until{" "}
                              {cancelBy.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })},{" "}
                              {cancelBy.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </>
                          ) : (
                            <>
                              <span className="font-semibold text-slate-900">Inside 24 hours of check-in.</span> Free cancellation no longer applies.
                            </>
                          )
                        ) : (
                          <>
                            <span className="font-semibold text-slate-900">Free cancellation</span> up to 24 hours before check-in
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <span className="mt-px flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      </span>
                      <div className="min-w-0">
                        <p className="m-0 text-[12.5px] leading-snug text-slate-600">
                          <span className="font-semibold text-slate-900">Secure payment</span> through NoLSAF payment partners
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {[
                            { src: "/assets/M-pesa.png", alt: "M-Pesa" },
                            { src: "/assets/airtel_money.png", alt: "Airtel Money" },
                            { src: "/assets/mix%20by%20yas.png", alt: "Mixx by Yas" },
                            { src: "/assets/halopesa.png", alt: "HaloPesa" },
                            { src: "/assets/NoLSAF_CRDB.png", alt: "CRDB Bank" },
                            { src: "/assets/NoLSAF_NMB.png", alt: "NMB Bank" },
                            { src: "/assets/visa_card.png", alt: "Visa" },
                            { src: "/assets/Mastercard_Logo.png", alt: "Mastercard" },
                          ].map((logo) => (
                            <span key={logo.alt} title={logo.alt} className="box-border flex h-7 w-10 items-center justify-center rounded-md border border-solid border-slate-200 bg-white p-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={logo.src} alt={logo.alt} className="max-h-full max-w-full object-contain" />
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}

