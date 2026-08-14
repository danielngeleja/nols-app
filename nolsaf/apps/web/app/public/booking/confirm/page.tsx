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

type Property = {
  id: number;
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
  const [ageGroup] = useState<"Adult" | "Child" | "">("Adult");
  const specialRequests = "";
  
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
    const propertyId = searchParams?.get("property");
    const checkIn = searchParams?.get("checkIn");
    const checkOut = searchParams?.get("checkOut");
    const adults = searchParams?.get("adults") || "1";
    const children = searchParams?.get("children") || "0";
    const pets = searchParams?.get("pets") || "0";
    const rooms = searchParams?.get("rooms") || "1";
    const roomCode = searchParams?.get("roomCode");
    const roomIndex = searchParams?.get("roomIndex");

    // Property ID is required and must be a valid number
    const numericPropertyId = propertyId ? Number(propertyId) : null;
    if (!propertyId || !numericPropertyId || isNaN(numericPropertyId) || numericPropertyId <= 0) {
      setError("Missing or invalid property ID");
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

    // Set booking data - dates can be empty initially, user can select them on this page
    setBookingData({
      propertyId: numericPropertyId,
      checkIn: checkIn || "",
      checkOut: checkOut || "",
      adults: Number(adults) || 1,
      children: Number(children) || 0,
      pets: Number(pets) || 0,
      rooms: Math.max(1, Number(rooms) || 1),
    });

    // Fetch property details
    fetchProperty(numericPropertyId);
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

  async function fetchProperty(propertyId: number) {
    // Validate propertyId is a valid number
    if (!propertyId || isNaN(propertyId) || propertyId <= 0) {
      setError("Invalid property ID");
      setLoading(false);
      return;
    }

    try {
      // Add timeout to prevent hanging requests (15 seconds should be enough)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(`/api/public/properties/${propertyId}`, {
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
          throw new Error(`Property #${propertyId} not found or not approved for public viewing`);
        } else if (response.status === 400) {
          throw new Error(`Invalid property ID: ${propertyId}`);
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
                const mbBest = mbData?.features?.[0];
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

      const best = payload?.features?.[0];
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
        <div className="public-container py-4">
          <Link
            href={property ? `/public/properties/${property.id}` : "/public/properties"}
            className="inline-flex items-center text-slate-600 hover:text-[#02665e] transition-all duration-200 group"
          >
            <ChevronLeft className="w-5 h-5 group-hover:-translate-x-1 transition-transform duration-200" />
          </Link>
        </div>
      </div>

      <div className="public-container py-8 lg:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Booking Summary */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/60 p-4 sm:p-6 lg:p-8 transition-all duration-300 hover:shadow-xl overflow-hidden">
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 mb-4 sm:mb-6 lg:mb-8">
                Booking Summary
              </h2>

              {property && (
                <div className="space-y-4 overflow-x-hidden">
                  {/* Property Details Card - Name & Location */}
                  <div className="p-4 bg-white rounded-xl border border-slate-200/60 shadow-sm mb-4">
                    <h3 className="text-base font-bold text-slate-900 truncate mb-2">
                      {property.title}
                    </h3>
                    {/* Property Location */}
                    <div className="flex items-center gap-1.5 text-xs text-slate-600">
                      <MapPin className="w-3.5 h-3.5 flex-shrink-0 text-[#02665e]" />
                      <span className="truncate">
                        {[
                          property.city,
                          property.district,
                          property.regionName,
                        ]
                          .filter(Boolean)
                          .join(", ") || "Location not specified"}
                      </span>
                    </div>
                  </div>
                  
                  {/* Property Label Section */}
                  <div className="pb-4 border-b border-slate-200/60">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                      PROPERTY
                    </div>
                    <h3 className="text-lg font-bold text-slate-900 truncate">
                      {property.title}
                    </h3>
                    <div className="text-sm text-slate-500 mt-1">
                      {property.type || "Property"}
                    </div>
                  </div>

                  {/* Dates & Guests */}
                  <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4 pt-6 border-t border-slate-200/60">
                    <div className="space-y-1.5 sm:space-y-2 min-w-0 w-full">
                      <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1 sm:gap-1.5">
                        <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#02665e] flex-shrink-0" />
                        <span className="whitespace-nowrap">Check-in</span>
                      </label>
                      <div className="relative">
                        <button
                          ref={checkInBtnRef}
                          type="button"
                          onClick={() => {
                            setCheckInPickerOpen(true);
                          }}
                          className="w-full min-w-0 px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 pl-8 sm:pl-10 md:pl-11 pr-8 sm:pr-10 md:pr-11 border-2 border-slate-300 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-gradient-to-r from-slate-50 to-blue-50/50 shadow-sm max-w-full box-border flex items-center justify-between group"
                        >
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#02665e] flex-shrink-0" />
                            <span className="text-slate-900 truncate text-xs sm:text-sm">
                              {bookingData?.checkIn
                                ? (() => {
                                    const date = new Date(bookingData.checkIn);
                                    const day = String(date.getDate()).padStart(2, "0");
                                    const month = String(date.getMonth() + 1).padStart(2, "0");
                                    const year = date.getFullYear();
                                    return `${day} / ${month} / ${year}`;
                                  })()
                                : "Select"}
                            </span>
                          </div>
                          <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 group-hover:text-[#02665e] transition-colors flex-shrink-0" />
                        </button>
                        {checkInPickerOpen && (
                          <>
                            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCheckInPickerOpen(false)} />
                            <div className="fixed z-[200] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                              <DatePicker
                                selected={bookingData?.checkIn || undefined}
                                onSelectAction={(s) => {
                                  const date = Array.isArray(s) ? s[0] : s;
                                  if (bookingData && date) {
                                    const newCheckIn = date;
                                    // If check-out is before new check-in, reset check-out
                                    let newCheckOut: string | null = bookingData.checkOut;
                                    if (newCheckOut && new Date(newCheckOut) <= new Date(newCheckIn)) {
                                      newCheckOut = null;
                                    }
                                    setBookingData({ ...bookingData, checkIn: newCheckIn, checkOut: newCheckOut ?? null });
                                  }
                                  setCheckInPickerOpen(false);
                                }}
                                onCloseAction={() => setCheckInPickerOpen(false)}
                                allowRange={false}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="space-y-1.5 sm:space-y-2 min-w-0 w-full">
                      <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1 sm:gap-1.5">
                        <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#02665e] flex-shrink-0" />
                        <span className="whitespace-nowrap">Check-out</span>
                      </label>
                      <div className="relative">
                        <button
                          ref={checkOutBtnRef}
                          type="button"
                          onClick={() => {
                            setCheckOutPickerOpen(true);
                          }}
                          className="w-full min-w-0 px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 pl-8 sm:pl-10 md:pl-11 pr-8 sm:pr-10 md:pr-11 border-2 border-slate-300 rounded-lg sm:rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-gradient-to-r from-slate-50 to-blue-50/50 shadow-sm max-w-full box-border flex items-center justify-between group"
                        >
                          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                            <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#02665e] flex-shrink-0" />
                            <span className="text-slate-900 truncate text-xs sm:text-sm">
                              {bookingData?.checkOut
                                ? (() => {
                                    const date = new Date(bookingData.checkOut);
                                    const day = String(date.getDate()).padStart(2, "0");
                                    const month = String(date.getMonth() + 1).padStart(2, "0");
                                    const year = date.getFullYear();
                                    return `${day} / ${month} / ${year}`;
                                  })()
                                : "Select"}
                            </span>
                          </div>
                          <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 group-hover:text-[#02665e] transition-colors flex-shrink-0" />
                        </button>
                        {checkOutPickerOpen && (
                          <>
                            <div className="fixed inset-0 z-40 bg-black/30" onClick={() => setCheckOutPickerOpen(false)} />
                            <div className="fixed z-[200] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
                              <DatePicker
                                selected={bookingData?.checkOut || undefined}
                                onSelectAction={(s) => {
                                  const date = Array.isArray(s) ? s[0] : s;
                                  if (bookingData && date) {
                                    // Validate that check-out is after check-in
                                    if (bookingData.checkIn && new Date(date) <= new Date(bookingData.checkIn)) {
                                      // Show error message
                                      setError("Check-out date must be after check-in date");
                                      setCheckOutPickerOpen(false);
                                      return;
                                    }
                                    setError(null); // Clear any previous errors
                                    setBookingData({ ...bookingData, checkOut: date });
                                  }
                                  setCheckOutPickerOpen(false);
                                }}
                                onCloseAction={() => setCheckOutPickerOpen(false)}
                                allowRange={false}
                                minDate={bookingData?.checkIn ? (() => {
                                  // Set minimum date to check-in date + 1 day
                                  const checkInDate = new Date(bookingData.checkIn);
                                  checkInDate.setDate(checkInDate.getDate() + 1);
                                  const year = checkInDate.getFullYear();
                                  const month = String(checkInDate.getMonth() + 1).padStart(2, "0");
                                  const day = String(checkInDate.getDate()).padStart(2, "0");
                                  return `${year}-${month}-${day}`;
                                })() : undefined}
                              />
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Guests & Duration - Two Column Layout */}
                  <div className="pt-4 sm:pt-6 border-t border-slate-200/60">
                    <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4 lg:gap-6">
                      {/* Guests Section - Collapsible Editable */}
                      <div className="space-y-1.5 sm:space-y-2 min-w-0 w-full">
                        <label className="text-xs sm:text-sm font-semibold text-slate-700 flex items-center gap-1 sm:gap-1.5">
                          <Users className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#02665e] flex-shrink-0" />
                          <span className="whitespace-nowrap">Guests</span>
                        </label>
                        
                        {!isGuestSelectorOpen ? (
                          // Summary View (Collapsed)
                          <button
                            type="button"
                            onClick={() => setIsGuestSelectorOpen(true)}
                            className="w-full flex items-center justify-between gap-1.5 sm:gap-2 px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-lg sm:rounded-xl border border-slate-200/60 shadow-sm hover:shadow-md transition-all duration-200 hover:border-[#02665e]/40 group"
                          >
                            <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                              <Users className="w-4 h-4 sm:w-5 sm:h-5 text-[#02665e] flex-shrink-0" />
                              <span className="text-slate-900 font-semibold text-xs sm:text-sm md:text-base truncate">
                                {bookingData?.adults || 1} adult{(bookingData?.adults || 1) !== 1 ? "s" : ""}
                                {bookingData?.children ? `, ${bookingData.children} child${bookingData.children !== 1 ? "ren" : ""}` : ""}
                                {bookingData?.pets ? `, ${bookingData.pets} pet${bookingData.pets !== 1 ? "s" : ""}` : ""}
                              </span>
                            </div>
                            <Edit2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 group-hover:text-[#02665e] transition-colors flex-shrink-0" />
                          </button>
                        ) : (
                          // Editable View (Expanded)
                          <div className="space-y-3 sm:space-y-4 p-3 sm:p-4 bg-gradient-to-r from-slate-50 to-blue-50/50 rounded-xl border border-slate-200/60 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                            <div className="flex items-center justify-between mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-slate-200/60">
                              <span className="text-sm sm:text-base font-semibold text-slate-700">Select Guests</span>
                              <button
                                type="button"
                                onClick={() => setIsGuestSelectorOpen(false)}
                                className="px-3 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-[#02665e] text-white hover:bg-[#014e47] font-medium transition-all duration-200 flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm shadow-sm hover:shadow-md"
                              >
                                Done
                                <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                              </button>
                            </div>
                            
                            <div className="space-y-3 sm:space-y-4">
                              {/* Adults */}
                              <div className="flex items-center justify-between gap-2 sm:gap-3">
                                <label className="text-sm sm:text-base font-medium text-slate-700 min-w-[80px] sm:min-w-[100px]">
                                  Adults <span className="text-red-500">*</span>
                                </label>
                                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (bookingData) {
                                        const newAdults = Math.max(1, (bookingData.adults || 1) - 1);
                                        setBookingData({ ...bookingData, adults: newAdults });
                                      }
                                    }}
                                    className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg border-2 border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 hover:border-[#02665e] active:border-[#02665e] transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-[#02665e] active:text-[#02665e] font-bold text-lg sm:text-lg touch-manipulation"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min="1"
                                    value={bookingData?.adults || 1}
                                    aria-label="Adults"
                                    title="Adults"
                                    onChange={(e) => {
                                      if (bookingData) {
                                        const value = Math.max(1, parseInt(e.target.value) || 1);
                                        setBookingData({ ...bookingData, adults: value });
                                      }
                                    }}
                                    className="w-14 sm:w-16 text-center px-2 py-1.5 sm:py-2 border-2 border-slate-300 rounded-lg text-sm sm:text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (bookingData) {
                                        const newAdults = (bookingData.adults || 1) + 1;
                                        setBookingData({ ...bookingData, adults: newAdults });
                                      }
                                    }}
                                    className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg border-2 border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 hover:border-[#02665e] active:border-[#02665e] transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-[#02665e] active:text-[#02665e] font-bold text-lg sm:text-lg touch-manipulation"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                              
                              {/* Child */}
                              <div className="flex items-center justify-between gap-2 sm:gap-3">
                                <label className="text-sm sm:text-base font-medium text-slate-700 min-w-[80px] sm:min-w-[100px]">
                                  Child
                                </label>
                                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (bookingData) {
                                        const newChildren = Math.max(0, (bookingData.children || 0) - 1);
                                        setBookingData({ ...bookingData, children: newChildren });
                                      }
                                    }}
                                    className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg border-2 border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 hover:border-[#02665e] active:border-[#02665e] transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-[#02665e] active:text-[#02665e] font-bold text-lg sm:text-lg touch-manipulation"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    value={bookingData?.children || 0}
                                    aria-label="Children"
                                    title="Children"
                                    onChange={(e) => {
                                      if (bookingData) {
                                        const value = Math.max(0, parseInt(e.target.value) || 0);
                                        setBookingData({ ...bookingData, children: value });
                                      }
                                    }}
                                    className="w-14 sm:w-16 text-center px-2 py-1.5 sm:py-2 border-2 border-slate-300 rounded-lg text-sm sm:text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (bookingData) {
                                        const newChildren = (bookingData.children || 0) + 1;
                                        setBookingData({ ...bookingData, children: newChildren });
                                      }
                                    }}
                                    className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg border-2 border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 hover:border-[#02665e] active:border-[#02665e] transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-[#02665e] active:text-[#02665e] font-bold text-lg sm:text-lg touch-manipulation"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>

                              {/* Pets */}
                              <div className="flex items-center justify-between gap-2 sm:gap-3">
                                <label className="text-sm sm:text-base font-medium text-slate-700 min-w-[80px] sm:min-w-[100px]">
                                  Pets
                                </label>
                                <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (bookingData) {
                                        const newPets = Math.max(0, (bookingData.pets || 0) - 1);
                                        setBookingData({ ...bookingData, pets: newPets });
                                      }
                                    }}
                                    className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg border-2 border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 hover:border-[#02665e] active:border-[#02665e] transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-[#02665e] active:text-[#02665e] font-bold text-lg sm:text-lg touch-manipulation"
                                  >
                                    −
                                  </button>
                                  <input
                                    type="number"
                                    min="0"
                                    value={bookingData?.pets || 0}
                                    aria-label="Pets"
                                    title="Pets"
                                    onChange={(e) => {
                                      if (bookingData) {
                                        const value = Math.max(0, parseInt(e.target.value) || 0);
                                        setBookingData({ ...bookingData, pets: value });
                                      }
                                    }}
                                    className="w-14 sm:w-16 text-center px-2 py-1.5 sm:py-2 border-2 border-slate-300 rounded-lg text-sm sm:text-base font-semibold focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] bg-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (bookingData) {
                                        const newPets = (bookingData.pets || 0) + 1;
                                        setBookingData({ ...bookingData, pets: newPets });
                                      }
                                    }}
                                    className="w-11 h-11 sm:w-9 sm:h-9 rounded-lg border-2 border-slate-300 bg-white hover:bg-slate-50 active:bg-slate-100 hover:border-[#02665e] active:border-[#02665e] transition-all duration-200 flex items-center justify-center text-slate-600 hover:text-[#02665e] active:text-[#02665e] font-bold text-lg sm:text-lg touch-manipulation"
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Duration Section */}
                      <div className="space-y-1.5 sm:space-y-2 min-w-0 w-full">
                        <label className="text-xs sm:text-sm font-semibold text-slate-700 mb-1.5 sm:mb-2 block whitespace-nowrap">Duration</label>
                        <div className="text-slate-900 font-bold text-sm sm:text-base md:text-lg px-2 sm:px-3 md:px-4 py-2 sm:py-2.5 md:py-3 bg-gradient-to-r from-[#02665e]/10 to-blue-50/50 rounded-lg sm:rounded-xl border border-[#02665e]/20">
                          {nights > 0 ? `${nights} night${nights !== 1 ? "s" : ""}` : "Select dates"}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Availability status card (near date + guest selection) */}
                  {bookingData?.checkIn && bookingData?.checkOut && (
                    <div
                      className={[
                        "mt-4 rounded-2xl border p-4 shadow-sm",
                        availabilityState.status === "available"
                          ? "bg-emerald-50/70 border-emerald-200"
                          : availabilityState.status === "checking"
                          ? "bg-slate-50 border-slate-200"
                          : availabilityState.status === "unavailable"
                          ? "bg-amber-50/70 border-amber-200"
                          : "bg-white border-slate-200",
                      ].join(" ")}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={[
                            "h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0",
                            availabilityState.status === "available"
                              ? "bg-emerald-100 text-emerald-700"
                              : availabilityState.status === "checking"
                              ? "bg-slate-100 text-slate-700"
                              : availabilityState.status === "unavailable"
                              ? "bg-amber-100 text-amber-800"
                              : "bg-slate-100 text-slate-700",
                          ].join(" ")}
                        >
                          {availabilityState.status === "available" ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : availabilityState.status === "checking" ? (
                            <LogoSpinner size="sm" ariaLabel="Checking availability" />
                          ) : availabilityState.status === "unavailable" ? (
                            <AlertCircle className="w-5 h-5" />
                          ) : (
                            <Info className="w-5 h-5" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="text-sm font-semibold text-slate-900">Availability status</div>
                            <span
                              className={[
                                "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold border",
                                availabilityState.status === "available"
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                                  : availabilityState.status === "checking"
                                  ? "bg-slate-100 text-slate-700 border-slate-200"
                                  : availabilityState.status === "unavailable"
                                  ? "bg-amber-100 text-amber-800 border-amber-200"
                                  : "bg-slate-100 text-slate-700 border-slate-200",
                              ].join(" ")}
                            >
                              {availabilityState.status === "available"
                                ? "Available"
                                : availabilityState.status === "checking"
                                ? "Checking"
                                : availabilityState.status === "unavailable"
                                ? "Not available"
                                : "Select dates"}
                            </span>
                          </div>

                          <div className="mt-1 text-sm text-slate-700">
                            {availabilityState.status === "available"
                              ? "Your selected dates look open right now. To secure it, continue to payment as soon as possible."
                              : availabilityState.status === "checking"
                              ? "Verifying your dates in real-time…"
                              : availabilityState.status === "unavailable"
                              ? availabilityState.message || "No availability for these dates."
                              : "Select check-in and check-out to verify availability."}
                          </div>

                          {availabilityState.status === "unavailable" && (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-white/70 p-3">
                              <div className="text-xs font-semibold text-amber-900 uppercase tracking-wide">Recommendation</div>
                              <ul className="mt-2 space-y-1 text-sm text-amber-900/90">
                                <li>Select different dates, then re-check availability.</li>
                                <li>If this property has multiple room options, try another room type if available.</li>
                                <li>Browse similar properties nearby and compare availability.</li>
                                <li>When it shows “Available”, continue immediately to secure it.</li>
                              </ul>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Guest Information Form */}
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-lg border border-slate-200/60 p-4 sm:p-6 lg:p-8 transition-all duration-300 hover:shadow-xl overflow-hidden">
              <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold text-slate-900 mb-4 sm:mb-6 lg:mb-8">
                Guest Information
              </h2>

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 lg:space-y-6 overflow-x-hidden">
                {/* Full Name — full width */}
                <div className="space-y-2 min-w-0 w-full">
                  <label className="block text-sm font-semibold text-slate-700">
                    Full Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    required
                    className="w-full min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm max-w-full box-border"
                    placeholder="Enter your full name"
                  />
                </div>

                {/* Phone + Email */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:gap-5 w-full">
                  <div className="space-y-2 min-w-0 w-full">
                    <label className="block text-sm font-semibold text-slate-700">
                      Phone Number <span className="text-red-500">*</span>
                    </label>
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
                      className="w-full min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm max-w-full box-border"
                      placeholder="+255 XXX XXX XXX"
                    />
                    {phoneInlineError && (
                      <p className="text-xs font-semibold text-red-600">{phoneInlineError}</p>
                    )}
                  </div>

                  <div className="space-y-2 min-w-0 w-full">
                    <label className="block text-sm font-semibold text-slate-700">
                      Email <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                    </label>
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
                      className="w-full min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm max-w-full box-border"
                      placeholder="your.email@example.com"
                    />
                    {emailInlineError && (
                      <p className="text-xs font-semibold text-red-600">{emailInlineError}</p>
                    )}
                  </div>
                </div>

                {/* Nationality + Gender */}
                <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:gap-5 w-full">
                  <div className="space-y-2 min-w-0 w-full">
                    <label className="block text-sm font-semibold text-slate-700">
                      Nationality <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={nationality}
                      inputMode="text"
                      autoComplete="country-name"
                      onChange={(e) => {
                        setError(null);
                        setNationality(sanitizeNationalityInput(e.target.value));
                      }}
                      className="w-full min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm max-w-full box-border"
                      placeholder="e.g., Tanzanian"
                    />
                  </div>

                  <div className="space-y-2 min-w-0 w-full">
                    <label className="block text-sm font-semibold text-slate-700">
                      Gender <span className="text-slate-400 text-xs font-normal">(Optional)</span>
                    </label>
                    <select
                      value={sex}
                      onChange={(e) => setSex(e.target.value as any)}
                      aria-label="Gender"
                      title="Gender"
                      className="w-full min-w-0 px-3 sm:px-4 py-2.5 sm:py-3 border-2 border-slate-300 rounded-xl text-sm font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e] hover:border-slate-400 bg-white shadow-sm max-w-full box-border cursor-pointer"
                    >
                      <option value="">Select</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>

                {/* Transportation Option */}
                <div className="pt-6 border-t border-slate-200/60">
                  {/* Transport card header */}
                  <div
                    className={`relative overflow-hidden rounded-2xl mb-4 ${transportLocked ? "opacity-60" : ""}`}
                    style={{ background: transportLocked ? "linear-gradient(135deg, #64748b 0%, #94a3b8 100%)" : "linear-gradient(135deg, #02665e 0%, #028570 100%)" }}
                  >
                    <div className="pointer-events-none absolute inset-0 opacity-[0.05]"
                      style={{ backgroundImage: "repeating-linear-gradient(-55deg, rgba(255,255,255,1) 0px, rgba(255,255,255,1) 1.5px, transparent 1.5px, transparent 24px)" }} />

                    <div className="relative z-10 p-5 flex items-center gap-4">
                      {/* Icon */}
                      <div className="w-9 h-9 rounded-lg bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
                        <Car className="w-4 h-4 text-white" />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[15px] font-bold text-white leading-snug">Include Transportation</p>
                        <p className="text-[12px] text-white/65 leading-snug mt-0.5">
                          {transportLocked
                            ? (transportGate?.reason || "We don't have drivers in this area yet. Continue with the stay booking only.")
                            : "Add transportation to your booking. We pick you up as you plan."}
                        </p>
                      </div>

                      {/* Toggle */}
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
                        className={`flex-shrink-0 focus:outline-none transition-transform duration-150 ${transportLocked ? "cursor-not-allowed" : "active:scale-95"}`}
                      >
                        <div className={`relative w-14 h-7 rounded-full transition-colors duration-200 ${includeTransport ? "bg-white/90" : "bg-black/30"}`}>
                          <div
                            className={`absolute top-1 w-5 h-5 rounded-full shadow transition-all duration-200 ${
                              includeTransport ? "left-8 bg-[#02665e]" : "left-1 bg-white/70"
                            }`}
                          />
                        </div>
                      </button>
                    </div>
                  </div>

                  {includeTransport && !transportLocked && (
                    <div className="space-y-5 mt-4 p-5 bg-white rounded-2xl border border-slate-200/80 shadow-md animate-in fade-in slide-in-from-top-2 duration-300">
                      {/* Vehicle Type */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Vehicle Type</span>
                          <span className="text-[11px] text-slate-400">Price varies per type</span>
                        </div>
                        <div className="overflow-x-auto -mx-5 px-5 pb-1">
                          <div className="flex gap-2">
                          {(
                            [
                              { value: "BODA" as TransportVehicleType, icon: "🏍️", label: "Boda", tier: "Budget" },
                              { value: "BAJAJI" as TransportVehicleType, icon: "🛺", label: "Bajaji", tier: "Economy" },
                              { value: "CAR" as TransportVehicleType, icon: "🚗", label: "Car", tier: "Standard" },
                              { value: "XL" as TransportVehicleType, icon: "🚐", label: "XL / Van", tier: "Roomy" },
                              { value: "PREMIUM" as TransportVehicleType, icon: "🚘", label: "Premium", tier: "Luxury" },
                            ]
                          ).map((v) => {
                            const active = transportVehicleType === v.value;
                            return (
                              <button
                                key={v.value}
                                type="button"
                                onClick={() => setTransportVehicleType(v.value)}
                                className={[
                                  "relative flex-shrink-0 w-[90px] flex flex-col items-center justify-center gap-1.5 px-1 py-3 rounded-2xl border-2 transition-all duration-200 focus:outline-none",
                                  active
                                    ? "border-[#02665e] bg-gradient-to-b from-[#02665e]/8 to-[#02665e]/4 shadow-md"
                                    : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:bg-slate-50",
                                ].join(" ")}
                              >
                                {active && (
                                  <div className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#02665e]" />
                                )}
                                <span className="text-2xl leading-none">{v.icon}</span>
                                <span className={`text-[11px] font-bold leading-tight text-center ${active ? "text-[#02665e]" : "text-slate-700"}`}>
                                  {v.label}
                                </span>
                                <span className={[
                                  "text-[9px] font-semibold px-1.5 py-0.5 rounded-full tracking-wide leading-none",
                                  active ? "bg-[#02665e]/15 text-[#02665e]" : "bg-slate-100 text-slate-400",
                                ].join(" ")}>
                                  {v.tier}
                                </span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                      </div>

                      {/* separator */}
                      <div className="border-t border-slate-100" />

                      {/* Pickup Method — locked until vehicle is chosen */}
                      {!transportVehicleType ? (
                        <div className="flex items-center gap-3 px-4 py-3.5 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50">
                          <div className="w-9 h-9 rounded-xl bg-slate-200 flex items-center justify-center flex-shrink-0">
                            <MapPin className="w-4 h-4 text-slate-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-slate-400">Pickup Method</div>
                            <div className="text-xs text-slate-400 mt-0.5">Select a vehicle type above to continue</div>
                          </div>
                          <div className="w-5 h-5 rounded-full border-2 border-slate-200 flex-shrink-0" />
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                        <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Pickup Method</span>
                        <div className="space-y-2">
                          {(
                            [
                              {
                                mode: "current" as const,
                                icon: <Navigation className="w-4 h-4" />,
                                title: "Current Location",
                                desc: "Detect my GPS position now",
                                accent: { ring: "border-sky-400", bg: "bg-sky-50", iconBg: "bg-sky-100", iconColor: "text-sky-600", dot: "bg-sky-500", text: "text-sky-700", btn: "bg-sky-600 hover:bg-sky-700" },
                              },
                              {
                                mode: "arrival" as const,
                                icon: <Plane className="w-4 h-4" />,
                                title: "Scheduled Arrival",
                                desc: "Airport, bus terminal, or ferry port",
                                accent: { ring: "border-violet-400", bg: "bg-violet-50", iconBg: "bg-violet-100", iconColor: "text-violet-600", dot: "bg-violet-500", text: "text-violet-700", btn: "bg-violet-600 hover:bg-violet-700" },
                              },
                              {
                                mode: "manual" as const,
                                icon: <MapPin className="w-4 h-4" />,
                                title: "Enter an Address",
                                desc: "Search any location in Tanzania",
                                accent: { ring: "border-amber-400", bg: "bg-amber-50", iconBg: "bg-amber-100", iconColor: "text-amber-600", dot: "bg-amber-500", text: "text-amber-700", btn: "bg-amber-500 hover:bg-amber-600" },
                              },
                            ]
                          ).map((opt) => {
                            const active = pickupMode === opt.mode;
                            if (pickupMethodChosen && !active) return null;
                            return (
                              <div key={opt.mode} className="overflow-hidden rounded-2xl">
                                {/* selector row */}
                                <button
                                  type="button"
                                  onClick={() => { setPickupMode(opt.mode); setPickupMethodChosen(true); }}
                                  aria-pressed={active}
                                  className={[
                                    "w-full flex items-center gap-3 py-3 px-4 border-2 transition-all duration-200 focus:outline-none text-left",
                                    active
                                      ? `${opt.accent.bg} ${opt.accent.ring} rounded-t-2xl rounded-b-none border-b-transparent`
                                      : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 rounded-2xl",
                                  ].join(" ")}
                                >
                                  <div className={[
                                    "w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors",
                                    active ? `${opt.accent.iconBg} ${opt.accent.iconColor}` : "bg-slate-100 text-slate-400",
                                  ].join(" ")}>
                                    {opt.icon}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className={`text-sm font-semibold leading-tight ${active ? opt.accent.text : "text-slate-700"}`}>
                                      {opt.title}
                                    </div>
                                    {!active && (
                                      <div className="text-xs text-slate-400 mt-0.5">{opt.desc}</div>
                                    )}
                                  </div>
                                  <div className={[
                                    "w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all",
                                    active ? `${opt.accent.ring} bg-white` : "border-slate-300",
                                  ].join(" ")}>
                                    {active && <div className={`w-2.5 h-2.5 rounded-full ${opt.accent.dot}`} />}
                                  </div>
                                </button>

                                {/* expanded body */}
                                {active && (
                                  <div className={[
                                    "border-2 border-t-0 rounded-b-2xl px-4 pb-4 pt-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-200",
                                    opt.accent.ring, opt.accent.bg,
                                  ].join(" ")}>

                                    {/* ── Current Location ── */}
                                    {opt.mode === "current" && (
                                      <>
                                        {!currentPickupConfirmed && (
                                          <button type="button" onClick={handleGetLocation} disabled={calculatingFare}
                                            className={`w-full flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-white text-sm font-semibold transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm active:scale-[0.98] ${opt.accent.btn}`}>
                                            <Navigation className="w-4 h-4 flex-shrink-0" />
                                            {calculatingFare ? "Detecting location…" : "Detect my current location"}
                                          </button>
                                        )}
                                        {currentPickupConfirmed && transportOriginLat !== null && (
                                          <button type="button" onClick={() => { setCurrentPickupConfirmed(false); setTransportOriginAddress(""); setTransportOriginLat(null); setTransportOriginLng(null); setTransportFare(null); }}
                                            className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl border border-sky-300 bg-white/70 text-sky-700 text-xs font-semibold hover:bg-white transition-all">
                                            <Navigation className="w-3.5 h-3.5 flex-shrink-0" />
                                            Re-detect location
                                          </button>
                                        )}
                                        {currentPickupNeedsConfirm && transportOriginAddress.trim() && (
                                          <div className="bg-white rounded-xl p-3 border border-sky-200 space-y-2">
                                            <div className="text-xs font-semibold text-sky-700">We detected your area:</div>
                                            <div className="text-sm text-slate-700 break-words">{transportOriginAddress}</div>
                                            <div className="flex gap-2 pt-1">
                                              <button type="button" onClick={() => { setCurrentPickupConfirmed(true); setCurrentPickupNeedsConfirm(false); }}
                                                className="flex-1 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-semibold hover:bg-sky-700 transition">
                                                Yes, looks right
                                              </button>
                                              <button type="button" onClick={() => {
                                                setCurrentPickupConfirmed(false); setCurrentPickupNeedsConfirm(false);
                                                setTransportOriginAddress(""); setTransportOriginLat(null); setTransportOriginLng(null); setTransportFare(null);
                                                setPickupMode("manual"); window.setTimeout(() => pickupAddressRef.current?.focus(), 0);
                                              }} className="flex-1 py-2.5 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-semibold hover:bg-slate-50 transition">
                                                No, type it instead
                                              </button>
                                            </div>
                                          </div>
                                        )}
                                        <p className="text-xs text-sky-600/80 flex items-center gap-1.5">
                                          <Info className="w-3.5 h-3.5 flex-shrink-0" />
                                          We use your GPS to calculate the exact fare.
                                        </p>
                                      </>
                                    )}

                                    {/* ── Scheduled Arrival ── */}
                                    {opt.mode === "arrival" && (
                                      <>
                                        {/* Picker trigger button */}
                                        <button
                                          type="button"
                                          onClick={() => setLocationPickerOpen(true)}
                                          className="w-full flex items-center gap-3 px-4 py-3 border-2 border-violet-200 rounded-xl bg-white hover:border-violet-400 hover:bg-violet-50/40 transition-all text-left group"
                                        >
                                          {pickupPresetId ? (() => {
                                            const preset = TANZANIA_LOCATIONS.find(p => p.id === pickupPresetId);
                                            if (!preset) return null;
                                            const icons: Record<string, React.ReactNode> = {
                                              airport:      <span className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center flex-shrink-0 text-base">✈</span>,
                                              bus_terminal: <span className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0 text-base">🚌</span>,
                                              ferry_port:   <span className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0 text-base">⛴</span>,
                                            };
                                            return (
                                              <>
                                                {icons[preset.category]}
                                                <span className="flex-1 min-w-0">
                                                  <span className="block text-sm font-semibold text-slate-800 truncate">{preset.label}</span>
                                                  <span className="block text-xs text-slate-500">{preset.city}{preset.iataCode ? ` · ${preset.iataCode}` : ""}</span>
                                                </span>
                                                <span className="text-xs text-violet-500 font-medium group-hover:text-violet-700">Change</span>
                                              </>
                                            );
                                          })() : (
                                            <>
                                              <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-400 flex items-center justify-center flex-shrink-0 text-base">📍</span>
                                              <span className="flex-1 text-sm font-medium text-slate-400">Choose airport, bus terminal or ferry…</span>
                                              <span className="text-xs text-violet-500 font-medium">Browse</span>
                                            </>
                                          )}
                                        </button>
                                        <p className="text-xs text-violet-600/80 flex items-start gap-1.5">
                                          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                          Arriving from abroad? Pick your terminal and we'll schedule a timed pickup.
                                        </p>
                                        {/* Picker modal */}
                                        <LocationPickerModal
                                          open={locationPickerOpen}
                                          selectedId={pickupPresetId}
                                          onSelectAction={(id) => handleSelectPickupPreset(id)}
                                          onCloseAction={() => setLocationPickerOpen(false)}
                                        />
                                      </>
                                    )}

                                    {/* ── Enter Address ── */}
                                    {opt.mode === "manual" && (
                                      <>
                                        <div className="flex gap-2">
                                          <input type="text" ref={pickupAddressRef} value={transportOriginAddress}
                                            onChange={(e) => setTransportOriginAddress(e.target.value)}
                                            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleGeocodePickupAddress(); } }}
                                            placeholder="e.g. Mlimani City Mall, Dar es Salaam"
                                            className="flex-1 px-4 py-3 border border-amber-200 rounded-xl text-sm font-medium bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 focus:border-amber-400 transition-all"
                                            required={includeTransport} />
                                          <button type="button" onClick={handleGeocodePickupAddress}
                                            disabled={calculatingFare || !transportOriginAddress.trim()}
                                            className={`px-4 py-3 rounded-xl text-white font-semibold text-sm flex items-center gap-1.5 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm active:scale-95 ${opt.accent.btn}`}>
                                            <MapPin className="w-4 h-4" />Find
                                          </button>
                                        </div>
                                        <p className="text-xs text-amber-600/80 flex items-start gap-1.5">
                                          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                                          Type a place or landmark in Tanzania, then tap Find.
                                        </p>
                                      </>
                                    )}

                                    {/* shared: error */}
                                    {transportPickupError && (
                                      <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl animate-in fade-in">
                                        <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                                        <p className="text-xs font-semibold text-red-700">{transportPickupError}</p>
                                      </div>
                                    )}

                                    {/* shared: confirmed pin */}
                                    {transportOriginLat !== null && transportOriginLng !== null && (
                                      <div className="flex items-center gap-3 bg-white border border-emerald-200 rounded-xl px-3 py-2.5 animate-in fade-in duration-200">
                                        <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-bold text-emerald-700">Pickup set</div>
                                          <div className="text-xs text-slate-500 truncate mt-0.5">
                                            {transportOriginAddress || `${transportOriginLat.toFixed(4)}, ${transportOriginLng.toFixed(4)}`}
                                          </div>
                                        </div>
                                        <a href={`https://maps.google.com/?q=${transportOriginLat},${transportOriginLng}`}
                                          target="_blank" rel="noopener noreferrer"
                                          className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-800 underline underline-offset-2 whitespace-nowrap flex-shrink-0">
                                          Maps ↗
                                        </a>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {pickupMethodChosen && (
                          <div className="flex items-center justify-center pt-3 pb-1">
                            <button
                              type="button"
                              onClick={() => { setPickupMethodChosen(false); setTransportOriginAddress(""); setTransportOriginLat(null); setTransportOriginLng(null); setTransportFare(null); setCurrentPickupConfirmed(false); setCurrentPickupNeedsConfirm(false); setPickupPresetId(""); }}
                              className="group inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold tracking-wide uppercase transition-all duration-200 active:scale-95 select-none"
                              style={{
                                background: "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)",
                                border: "1.5px solid #cbd5e1",
                                color: "#475569",
                                boxShadow: "0 1px 4px rgba(0,0,0,0.08), 0 0 0 0 #6366f1",
                              }}
                              onMouseEnter={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, #eef2ff 0%, #e0e7ff 100%)";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "#a5b4fc";
                                (e.currentTarget as HTMLButtonElement).style.color = "#4338ca";
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 2px 8px rgba(99,102,241,0.18)";
                              }}
                              onMouseLeave={e => {
                                (e.currentTarget as HTMLButtonElement).style.background = "linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)";
                                (e.currentTarget as HTMLButtonElement).style.borderColor = "#cbd5e1";
                                (e.currentTarget as HTMLButtonElement).style.color = "#475569";
                                (e.currentTarget as HTMLButtonElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.08)";
                              }}
                            >
                              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{flexShrink:0}} xmlns="http://www.w3.org/2000/svg">
                                <path d="M2 8C2 4.686 4.686 2 8 2c1.87 0 3.55.81 4.72 2.1L11 6h4V2l-1.44 1.44A7 7 0 1 0 15 8h-2a5 5 0 1 1-5-5 4.99 4.99 0 0 1 3.54 1.46L9.5 6.5 8 5v4h4l-1.5-1.5L12 6h.72A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="0" />
                                <path d="M13.5 2.5v3h-3M2.5 8a5.5 5.5 0 1 0 5.5-5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              Switch pickup method
                            </button>
                          </div>
                        )}
                        </div>
                      )}

                      {/* Arrival Information Section */}
                      {pickupMode === "current" ? (
                        <div className="pt-4 mt-4 border-t border-slate-200/60">
                          <div className="rounded-xl border border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-600 flex items-start gap-2">
                            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-slate-400" />
                            <p>
                              For <span className="font-semibold text-slate-700">instant pickup</span>, arrival details are not needed. Switch to <span className="font-semibold text-violet-600">Scheduled Arrival</span> if you want a timed airport or terminal pickup.
                            </p>
                          </div>
                        </div>
                      ) : (
                      <div className="mt-5">
                        {/* Section header */}
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:"linear-gradient(135deg,#02665e,#028a7a)"}}>
                            <Plane className="w-4 h-4 text-white" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-bold text-slate-800">Arrival Information</span>
                              {requiresArrivalInfo
                                ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200 uppercase tracking-wide">Required</span>
                                : <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-400 border border-slate-200 uppercase tracking-wide">Optional</span>
                              }
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5">Help us coordinate your pickup with your arrival details</p>
                          </div>
                        </div>

                        <div className="space-y-4" style={{boxSizing:"border-box"}}>

                          {/* ── Arrival type chips ── */}
                          <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
                              How are you arriving?{requiresArrivalInfo && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            {arrivalTypeLocked ? (
                              /* Locked — show as read-only badge */
                              <div className="flex items-center gap-2">
                                {(() => {
                                  const map: Record<string, {icon:string; label:string; bg:string; text:string; border:string}> = {
                                    FLIGHT: {icon:"✈", label:"Flight",  bg:"#eff6ff", text:"#1d4ed8", border:"#bfdbfe"},
                                    BUS:    {icon:"🚌",label:"Bus",     bg:"#f0fdf4", text:"#15803d", border:"#bbf7d0"},
                                    TRAIN:  {icon:"🚆",label:"Train",   bg:"#fffbeb", text:"#b45309", border:"#fde68a"},
                                    FERRY:  {icon:"⛴", label:"Ferry",  bg:"#f5f3ff", text:"#6d28d9", border:"#ddd6fe"},
                                    OTHER:  {icon:"📍",label:"Other",   bg:"#f8fafc", text:"#475569", border:"#e2e8f0"},
                                  };
                                  const t = map[arrivalType] ?? map.OTHER;
                                  return (
                                    <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border-2" style={{background:t.bg, color:t.text, borderColor:t.border}}>
                                      <span>{t.icon}</span>
                                      <span>{t.label}</span>
                                      <span className="ml-1 text-[10px] font-normal opacity-60">auto-selected</span>
                                      <Info className="w-3 h-3 opacity-40" />
                                    </div>
                                  );
                                })()}
                              </div>
                            ) : (
                              /* Unlocked — clickable chips */
                              <div className="flex flex-wrap gap-2">
                                {([
                                  {value:"FLIGHT", icon:"✈",  label:"Flight"},
                                  {value:"BUS",    icon:"🚌", label:"Bus"},
                                  {value:"TRAIN",  icon:"🚆", label:"Train"},
                                  {value:"FERRY",  icon:"⛴",  label:"Ferry"},
                                  {value:"OTHER",  icon:"📍", label:"Other"},
                                ] as const).map((t) => {
                                  const active = arrivalType === t.value;
                                  return (
                                    <button
                                      key={t.value}
                                      type="button"
                                      onClick={() => setArrivalType(t.value)}
                                      className={[
                                        "inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border-2 transition-all duration-150 active:scale-95 select-none",
                                        active
                                          ? "bg-[#02665e] text-white border-[#02665e] shadow-md"
                                          : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50",
                                      ].join(" ")}
                                    >
                                      <span>{t.icon}</span>
                                      <span>{t.label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* ── Number + Company row ── */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Transport Number */}
                            <div className="space-y-1.5">
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                                {arrivalType === "FLIGHT" ? "Flight Number" :
                                 arrivalType === "BUS"    ? "Bus Number" :
                                 arrivalType === "TRAIN"  ? "Train Number" :
                                 arrivalType === "FERRY"  ? "Ferry Number" :
                                 arrivalType === "OTHER"  ? "Transport Number" :
                                 "Number"}
                              </label>
                              <input
                                type="text"
                                value={arrivalNumber}
                                onChange={(e) => setArrivalNumber(e.target.value)}
                                disabled={!arrivalType}
                                placeholder={
                                  !arrivalType           ? "Select type first" :
                                  arrivalType === "FLIGHT" ? "e.g., JN123" :
                                  arrivalType === "BUS"    ? "e.g., BUS-456" :
                                  arrivalType === "TRAIN"  ? "e.g., TR-789" :
                                  arrivalType === "FERRY"  ? "e.g., FR-012" :
                                  "Transport number"
                                }
                                style={{boxSizing:"border-box"}}
                                className="w-full px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 hover:border-slate-300 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed placeholder:font-normal placeholder:text-slate-400"
                              />
                            </div>

                            {/* Company */}
                            <div className="space-y-1.5">
                              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                                {arrivalType === "FLIGHT" ? "Airline" :
                                 arrivalType === "BUS"    ? "Bus Company" :
                                 arrivalType === "TRAIN"  ? "Train Operator" :
                                 arrivalType === "FERRY"  ? "Ferry Operator" :
                                 arrivalType === "OTHER"  ? "Transport Company" :
                                 "Company"}
                              </label>
                              <input
                                type="text"
                                value={transportCompany}
                                onChange={(e) => setTransportCompany(e.target.value)}
                                disabled={!arrivalType}
                                placeholder={
                                  !arrivalType             ? "Select type first" :
                                  arrivalType === "FLIGHT" ? "e.g., Precision Air" :
                                  arrivalType === "BUS"    ? "e.g., Scania" :
                                  arrivalType === "TRAIN"  ? "e.g., TAZARA" :
                                  arrivalType === "FERRY"  ? "e.g., Azam Marine" :
                                  "Company name"
                                }
                                style={{boxSizing:"border-box"}}
                                className="w-full px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 hover:border-slate-300 bg-white transition-all disabled:opacity-40 disabled:cursor-not-allowed placeholder:font-normal placeholder:text-slate-400"
                              />
                            </div>
                          </div>

                          {/* ── Arrival Date + Time combined ── */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                              Arrival Date &amp; Time{requiresArrivalInfo && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            <div className="flex items-stretch gap-2" style={{boxSizing:"border-box"}}>
                              {/* Date picker button */}
                              <div className="relative flex-1 min-w-0">
                                <button
                                  ref={arrivalDateBtnRef}
                                  type="button"
                                  onClick={() => setArrivalDatePickerOpen(true)}
                                  style={{boxSizing:"border-box"}}
                                  className="w-full flex items-center gap-2 px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold hover:border-[#02665e]/40 focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 bg-white transition-all group"
                                >
                                  <Calendar className="w-4 h-4 text-[#02665e] flex-shrink-0" />
                                  <span className={arrivalDate ? "text-slate-800 truncate" : "text-slate-400 font-normal"}>
                                    {arrivalDate ? (() => {
                                      const d = new Date(arrivalDate);
                                      return `${String(d.getDate()).padStart(2,"0")} / ${String(d.getMonth()+1).padStart(2,"0")} / ${d.getFullYear()}`;
                                    })() : "dd / mm / yyyy"}
                                  </span>
                                </button>
                                {arrivalDatePickerOpen && (
                                  <>
                                    <div className="fixed inset-0 z-[100]" onClick={() => setArrivalDatePickerOpen(false)} />
                                    <div className="absolute z-[101] top-full left-0 mt-1">
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
                              {/* Time HH:MM */}
                              <div className="flex items-center gap-1 flex-shrink-0" style={{boxSizing:"border-box"}}>
                                <input
                                  type="number" min="0" max="23"
                                  value={arrivalTimeHour}
                                  onChange={(e) => { const v=e.target.value; if(v===""||( +v>=0&&+v<=23)) setArrivalTimeHour(v); }}
                                  placeholder="HH"
                                  required={requiresArrivalInfo}
                                  style={{boxSizing:"border-box", width:"3.5rem"}}
                                  className="px-2 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold text-center focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 hover:border-slate-300 bg-white transition-all placeholder:font-normal placeholder:text-slate-400"
                                />
                                <span className="text-slate-500 font-bold text-base select-none">:</span>
                                <input
                                  type="number" min="0" max="59"
                                  value={arrivalTimeMinute}
                                  onChange={(e) => { const v=e.target.value; if(v===""||( +v>=0&&+v<=59)) setArrivalTimeMinute(v); }}
                                  placeholder="MM"
                                  required={requiresArrivalInfo}
                                  style={{boxSizing:"border-box", width:"3.5rem"}}
                                  className="px-2 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold text-center focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 hover:border-slate-300 bg-white transition-all placeholder:font-normal placeholder:text-slate-400"
                                />
                              </div>
                            </div>
                          </div>

                          {/* ── Specific pickup area ── */}
                          <div className="space-y-1.5">
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                              Specific Pickup Area / Terminal{requiresArrivalInfo && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            <input
                              type="text"
                              value={pickupLocation}
                              onChange={(e) => setPickupLocation(e.target.value)}
                              placeholder={
                                arrivalType === "FLIGHT" ? "e.g., Terminal 1, Gate 3" :
                                arrivalType === "BUS"    ? "e.g., Ubungo Bus Terminal, Platform 5" :
                                arrivalType === "TRAIN"  ? "e.g., Central Station, Platform 2" :
                                arrivalType === "FERRY"  ? "e.g., Kivukoni Ferry, Dock A" :
                                "Specific pickup spot"
                              }
                              required={requiresArrivalInfo}
                              style={{boxSizing:"border-box"}}
                              className="w-full px-3 py-2.5 border-2 border-slate-200 rounded-xl text-sm font-semibold focus:outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10 hover:border-slate-300 bg-white transition-all placeholder:font-normal placeholder:text-slate-400"
                            />
                            <p className="text-xs text-slate-400 flex items-center gap-1">
                              <Info className="w-3 h-3 flex-shrink-0" />
                              Terminal, gate, platform, dock — be as specific as possible
                            </p>
                          </div>

                        </div>
                      </div>
                      )}

                      {includeTransport && transportOriginLat !== null && transportOriginLng !== null && !!property && (!property.latitude || !property.longitude) && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-300 rounded-xl animate-in fade-in">
                          <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-amber-800 font-medium">
                            This property’s coordinates are not yet registered. Distance is calculated as 0 km and the fare shown is the minimum base rate only. The actual fare will be confirmed by your driver.
                          </p>
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
                          <div className="animate-in fade-in slide-in-from-bottom-3 duration-400 rounded-2xl overflow-hidden border border-slate-200/80 bg-white shadow-lg">
                            {/* ── Route card header ── */}
                            <div className="px-5 pt-5 pb-4 border-b border-slate-100">
                              {/* top bar */}
                              <div className="flex items-center justify-between mb-5">
                                <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Your Ride</span>
                                <div className="flex items-center gap-1.5">
                                  <span className="inline-flex items-center gap-1 bg-[#02665e]/8 text-[#02665e] border border-[#02665e]/20 text-[11px] font-semibold rounded-full px-2.5 py-1">
                                    <Car className="w-3 h-3" />
                                    {getVehicleTypeLabel(transportVehicleType)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold rounded-full px-2.5 py-1">
                                    <ShieldCheck className="w-3 h-3" />
                                    Fixed
                                  </span>
                                </div>
                              </div>

                              {/* ── vertical route timeline ── */}
                              <div className="flex gap-4">
                                {/* timeline spine */}
                                <div className="flex flex-col items-center flex-shrink-0 pt-0.5">
                                  {/* origin dot */}
                                  <div className="w-3 h-3 rounded-full border-[2.5px] border-[#02665e] bg-white shadow-sm" />
                                  {/* dashed connector */}
                                  <div className="flex-1 flex flex-col items-center gap-[3px] py-1.5" style={{minHeight: 40}}>
                                    {Array.from({length: 5}).map((_, i) => (
                                      <div key={i} className="w-px h-1.5 rounded-full bg-slate-300" />
                                    ))}
                                  </div>
                                  {/* destination diamond */}
                                  <div className="w-3 h-3 rounded-sm bg-[#02665e] shadow-sm rotate-45" />
                                </div>

                                {/* labels */}
                                <div className="flex-1 flex flex-col justify-between gap-4 min-w-0">
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Pickup</div>
                                    <div className="text-sm font-semibold text-slate-800 truncate leading-snug">
                                      {transportOriginAddress || "Your current location"}
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Drop-off</div>
                                    <div className="text-sm font-semibold text-slate-800 truncate leading-snug">
                                      {property?.title || "Property"}
                                    </div>
                                    {property?.city && (
                                      <div className="text-xs text-slate-400 truncate mt-0.5">{[property.city, property.district].filter(Boolean).join(", ")}</div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* ── stats chips ── */}
                              {(distKm !== null || etaMin !== null) && (
                                <div className="flex items-center gap-2 mt-5 flex-wrap">
                                  {distKm !== null && (
                                    <span className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold rounded-full px-3 py-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                                      {distKm.toFixed(1)} km
                                    </span>
                                  )}
                                  {etaMin !== null && (
                                    <span className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-600 text-xs font-semibold rounded-full px-3 py-1.5">
                                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400 flex-shrink-0" />
                                      ~{etaMin} min
                                    </span>
                                  )}
                                  {fareDetail && fareDetail.surgeMultiplier > 1 && (
                                    <span className="inline-flex items-center gap-1.5 bg-orange-50 border border-orange-200 text-orange-700 text-xs font-semibold rounded-full px-3 py-1.5">
                                      ×{fareDetail.surgeMultiplier.toFixed(1)} surge
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* ── fare row ── */}
                            <div className="px-5 py-4 bg-[#02665e]/[0.03]">
                              <div className="flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Total fare</div>
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-2xl font-black text-slate-900 leading-none tabular-nums">
                                      {transportFare.toLocaleString()}
                                    </span>
                                    <span className="text-sm font-semibold text-slate-400">{currency}</span>
                                  </div>
                                </div>
                                {fareDetail && (
                                  <div className="hidden sm:flex flex-col items-end gap-1 text-[11px] text-slate-400 text-right">
                                    <span>Base {fareDetail.baseFare.toLocaleString()}</span>
                                    <span>Distance {fareDetail.distanceFare.toLocaleString()}</span>
                                    <span>Time {fareDetail.timeFare.toLocaleString()}</span>
                                    {surgeAmount > 0 && (
                                      <span className="font-semibold text-orange-600">
                                        Surge +{surgeAmount.toLocaleString()}
                                      </span>
                                    )}
                                    <span className="mt-1 border-t border-slate-200 pt-1 font-bold text-slate-700">
                                      Total {fareDetail.total.toLocaleString()}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* ── footer ── */}
                            <div className="px-5 py-3 bg-emerald-50/60 border-t border-emerald-100 flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                              <span className="text-xs text-emerald-800 font-medium">
                                Fare is calculated from pickup distance, estimated time, and vehicle type.
                              </span>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>

                {error && (
                  <div className="bg-gradient-to-r from-red-50 to-red-100/50 border-2 border-red-200 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2 duration-300 shadow-sm">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <p className="text-sm font-medium text-red-700">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={
                    submitting ||
                    availabilityState.status === "checking" ||
                    availabilityState.status === "unavailable" ||
                    (includeTransport && (
                      calculatingFare ||
                      transportOriginLat === null ||
                      transportOriginLng === null ||
                      transportFare === null
                    ))
                  }
                  className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-[#02665e] to-[#014e47] text-white font-bold text-base hover:from-[#014e47] hover:to-[#02665e] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg hover:shadow-xl transform hover:scale-[1.02] active:scale-[0.98]"
                >
                  {submitting ? (
                    <>
                      <LogoSpinner size="sm" ariaLabel="Creating booking" />
                      <span>Creating booking...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Confirm &amp; Continue to Payment</span>
                    </>
                  )}
                </button>
              </form>
            </div>
          </div>

          {/* Sidebar - Price Summary */}
          <div className="lg:col-span-1">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-slate-200/60 p-6 lg:p-8 sticky top-8 transition-all duration-300 hover:shadow-2xl">
              <h2 className="text-xl lg:text-2xl font-bold text-slate-900 mb-6 lg:mb-8">
                Price Summary
              </h2>

              <div className="space-y-4 lg:space-y-5">
                {/* Accommodation line */}
                <div className="flex justify-between items-start p-3 bg-slate-50 rounded-xl border border-slate-200/60">
                  <span className="text-sm font-medium text-slate-700">
                    {pricePerNight.toLocaleString()} TZS × {nights} night{nights !== 1 ? "s" : ""} × {roomsQty} room{roomsQty !== 1 ? "s" : ""}
                    {(selectedRoomCode || selectedRoomIndex !== null) && (
                      <span className="block text-xs text-slate-500 mt-0.5">
                        {(() => {
                          if (!property?.roomsSpec) return "";
                          let roomTypes: Array<{ code?: string; roomCode?: string; roomType?: string; name?: string; label?: string }> = [];
                          if (typeof property.roomsSpec === "object") {
                            const spec = property.roomsSpec as any;
                            if (Array.isArray(spec)) {
                              roomTypes = spec;
                            } else if (spec.rooms && Array.isArray(spec.rooms)) {
                              roomTypes = spec.rooms;
                            }
                          }
                          let room: any = null;
                          if (selectedRoomCode) {
                            room = roomTypes.find((rt) => (rt.code || rt.roomCode) === selectedRoomCode);
                          } else if (selectedRoomIndex !== null && selectedRoomIndex >= 0 && selectedRoomIndex < roomTypes.length) {
                            room = roomTypes[selectedRoomIndex];
                          }
                          return room ? `(${room.roomType || room.name || room.label || "Selected Room"})` : "";
                        })()}
                      </span>
                    )}
                  </span>
                  <span className="font-bold text-slate-900 text-base text-right">
                    {(() => { const d = fmtDisplay(subtotal); return (<><span>{d.primary}</span>{d.note && <span className="block text-xs font-normal text-slate-500 mt-0.5">{d.note}</span>}</>); })()}
                  </span>
                </div>

                {includeTransport && transportFare !== null && (
                  <div className="flex justify-between items-start text-slate-600 text-sm pt-2 p-3 bg-blue-50/50 rounded-xl border border-blue-200/60">
                    <span className="flex items-center gap-2 font-medium">
                      <Car className="w-4 h-4 text-[#02665e]" />
                      Transportation ({getVehicleTypeLabel(transportVehicleType)})
                    </span>
                    <span className="font-bold text-[#02665e] text-right">
                      {(() => {
                        const d = fmtDisplay(transportFare);
                        return (
                          <>
                            <span>{d.primary}</span>
                            {d.note && <span className="block text-xs font-normal text-slate-500 mt-0.5">{d.note}</span>}
                          </>
                        );
                      })()}
                    </span>
                  </div>
                )}

                <div className="pt-4 border-t-2 border-slate-200">
                  <div className="flex justify-between items-start p-4 bg-gradient-to-r from-[#02665e]/10 to-blue-50/50 rounded-xl border border-[#02665e]/20">
                    <span className="text-lg font-bold text-slate-900">Total</span>
                    <span className="text-right">
                      {(() => {
                        const d = fmtDisplay(finalTotal);
                        return (
                          <>
                            <span className="text-2xl lg:text-3xl font-extrabold text-[#02665e]">{d.primary}</span>
                            {d.note && <span className="block text-xs font-normal text-slate-500 mt-0.5">{d.note}</span>}
                          </>
                        );
                      })()}
                    </span>
                  </div>
                </div>

                <div className="pt-4 border-t border-slate-200/60">
                  <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-emerald-50/50 to-slate-50 rounded-xl border border-emerald-200/40">
                    <ShieldCheck className="w-5 h-5 text-[#02665e] flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 mb-1 text-sm">
                        Secure Payment
                      </div>
                      <div className="text-xs text-slate-600 leading-relaxed">
                        Your payment is processed securely through our payment partners.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60">
                  <div className="flex items-start gap-3 p-4 bg-gradient-to-br from-blue-50/30 to-slate-50 rounded-xl border border-blue-200/40">
                    <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-slate-900 mb-1 text-sm">
                        Cancellation Policy
                      </div>
                      <div className="text-xs text-slate-600 leading-relaxed">
                        Free cancellation up to 24 hours before check-in. Review full policy on property page.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

