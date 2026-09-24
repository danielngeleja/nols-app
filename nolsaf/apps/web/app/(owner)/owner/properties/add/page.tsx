"use client";
import type { ReactNode } from "react";
import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { twMerge } from "tailwind-merge";
import { Plus, Check, Home, Building, Building2, TreePine, Hotel, HelpCircle, Car, Shield, Bus, Bed, BedDouble, BedSingle, CheckCircle2, AlertCircle, MapPin,
  Navigation, Crosshair, Users, X, ArrowRight, ImageIcon, Loader2, Hospital, Pill, Plane, Fuel, Route, Building as BuildingIcon, Lock, ExternalLink, Edit2, Clock, Bell } from "lucide-react";
import axios from "axios";import apiClient from "@/lib/apiClient";
import { REGIONS, REGION_BY_ID } from "@/lib/tzRegions";
import { REGIONS_FULL_DATA } from "@/lib/tzRegionsFull";
import { TotalsStep } from "./_components/TotalsStep";
import { PhotosStep } from "./_components/PhotosStep";
import { ROOM_ITEMS, RoomsStep } from "./_components/RoomsStep";
import { cleanFloorUses, parseFloorUses, type FloorUses } from "./_components/floorUses";
import { ServicesStep } from "./_components/ServicesStep";
import { ReviewStep } from "./_components/ReviewStep";
import { BasicsStep } from "./_components/BasicsStep";
import { ResumeDraftScreen } from "./_components/ResumeDraftScreen";
import "@/styles/add-property.css";

const api = apiClient;
function authify() {}

type BedKey = "twin" | "full" | "queen" | "king";
const PROPERTY_TYPES = ["Villa","Apartment","Hotel","Lodge","Condo","Guest House","Bungalow","Cabin","Homestay","Townhouse","House","Other"] as const;

// Icon mapping for property types
const PROPERTY_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "Villa": Building2,
  "Apartment": Building,
  "Hotel": Hotel,
  "Lodge": TreePine,
  "Condo": Building2,
  "Guest House": Home,
  "Bungalow": Home,
  "Cabin": TreePine,
  "Homestay": Home,
  "Townhouse": Building2,
  "House": Home,
  "Other": HelpCircle,
};

// Border and color mapping for property types
const PROPERTY_TYPE_STYLES: Record<string, { border: string; leftBorder: string; text: string; bg: string; hoverBorder: string }> = {
  "Villa":       { border: "border-blue-400",    leftBorder: "border-l-blue-400",    text: "text-blue-400",    bg: "from-[#1c2128] to-blue-900/30",    hoverBorder: "hover:border-blue-400" },
  "Apartment":   { border: "border-purple-400",  leftBorder: "border-l-purple-400",  text: "text-purple-400",  bg: "from-[#1c2128] to-purple-900/30",  hoverBorder: "hover:border-purple-400" },
  "Hotel":       { border: "border-amber-400",   leftBorder: "border-l-amber-400",   text: "text-amber-400",   bg: "from-[#1c2128] to-amber-900/30",   hoverBorder: "hover:border-amber-400" },
  "Lodge":       { border: "border-green-400",   leftBorder: "border-l-green-400",   text: "text-green-400",   bg: "from-[#1c2128] to-green-900/30",   hoverBorder: "hover:border-green-400" },
  "Condo":       { border: "border-indigo-400",  leftBorder: "border-l-indigo-400",  text: "text-indigo-400",  bg: "from-[#1c2128] to-indigo-900/30",  hoverBorder: "hover:border-indigo-400" },
  "Guest House": { border: "border-pink-400",    leftBorder: "border-l-pink-400",    text: "text-pink-400",    bg: "from-[#1c2128] to-pink-900/30",    hoverBorder: "hover:border-pink-400" },
  "Bungalow":    { border: "border-orange-400",  leftBorder: "border-l-orange-400",  text: "text-orange-400",  bg: "from-[#1c2128] to-orange-900/30",  hoverBorder: "hover:border-orange-400" },
  "Cabin":       { border: "border-emerald-400", leftBorder: "border-l-emerald-400", text: "text-emerald-400", bg: "from-[#1c2128] to-emerald-900/30", hoverBorder: "hover:border-emerald-400" },
  "Homestay":    { border: "border-rose-400",    leftBorder: "border-l-rose-400",    text: "text-rose-400",    bg: "from-[#1c2128] to-rose-900/30",    hoverBorder: "hover:border-rose-400" },
  "Townhouse":   { border: "border-cyan-400",    leftBorder: "border-l-cyan-400",    text: "text-cyan-400",    bg: "from-[#1c2128] to-cyan-900/30",    hoverBorder: "hover:border-cyan-400" },
  "House":       { border: "border-teal-400",    leftBorder: "border-l-teal-400",    text: "text-teal-400",    bg: "from-[#1c2128] to-teal-900/30",    hoverBorder: "hover:border-teal-400" },
  "Other":       { border: "border-slate-400",   leftBorder: "border-l-slate-400",   text: "text-slate-400",   bg: "from-[#1c2128] to-slate-800/40",   hoverBorder: "hover:border-slate-400" },
};
const HOTEL_STAR_OPTIONS = [
  { value: "", label: "Select rating" },
  { value: "basic", label: "Basic accommodations" },
  { value: "simple", label: "Simple and affordable" },
  { value: "moderate", label: "Moderate quality" },
  { value: "high", label: "High-end comfort" },
  { value: "luxury", label: "Luxury and exceptional service" },
];

const BED_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "twin": BedSingle,
  "full": BedDouble,
  "queen": Bed,
  "king": BedDouble,
};

/** Facilities config */
type FacilityType =
  | "Hospital"
  | "Pharmacy"
  | "Polyclinic"
  | "Clinic"
  | "Police station"
  | "Airport"
  | "Bus station"
  | "Petrol station"
  | "Conference center"
  | "Stadium"
  | "Main road";
const REACH_MODES = ["Walking","Boda","Public Transport","Car/Taxi"] as const;
type ReachMode = typeof REACH_MODES[number];

/* Utility functions - moved up for use in components */
function numOrEmpty(v: string|number){ if (v === "" || v == null) return ""; const n = Number(v); return Number.isFinite(n) ? n : ""; }
function numOrNull(v: any){ return v==="" || v==null ? null : Number(v); }
function splitComma(s:string){ return s.split(",").map(x=>x.trim()).filter(Boolean); }
function inferBasePrice(rooms: any[]){ 
  const prices = rooms.map(r => {
    // Try multiple possible field names for price
    const price = r.pricePerNight || r.price || 0;
    const numPrice = Number(price);
    return numPrice > 0 ? numPrice : 0;
  }).filter(n => n > 0); 
  const result = prices.length ? Math.min(...prices) : null;
  // Debug logging
  console.log('[inferBasePrice]', { 
    roomsCount: rooms.length, 
    rooms: rooms.map(r => ({ pricePerNight: r.pricePerNight, price: r.price })), 
    prices, 
    result 
  });
  return result;
}
function toServerType(t: string){
  const map: Record<string, string> = { "Guest House":"GUEST_HOUSE", "Townhouse":"TOWNHOUSE", "Other":"OTHER" };
  const up = t.toUpperCase().replace(/\s+/g,"_");
  return (map[t] ?? up);
}

function normalizePhotoUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];
    } catch {
      return value.trim() ? [value.trim()] : [];
    }
  }
  return [];
}

type NearbyFacility = {
  id: string;
  type: FacilityType;
  name: string;
  ownership: "Public/Government" | "Private" | "";
  distanceKm: number | "";
  reachableBy: ReachMode[];
  url?: string;
};

/** Facilities mini-components - FacilityRow defined after type */
// Small inline SVGs for walking and motorbike when lucide doesn't expose those icons in this package version
const PAGE_WRAPPER_CLASS = "add-property-view" as const;
const PAGE_LAYOUT_CLASS = "add-property-layout" as const;
const PAGE_SHELL_CLASS = "add-property-shell" as const;
const STEPPER_WRAPPER_CLASS = "add-property-stepper" as const;
const SIDEBAR_CARD_CLASS = "add-property-sidebar-card" as const;
type RoomEntry = {
  roomType: string;
  beds: Record<BedKey, number>;
  roomsCount: number;
  /** Optional floor/location metadata used by visualization */
  floors?: number[];
  /** For multi-storey buildings: rooms count per floor (key = floor index; 0 = Ground) */
  floorDistribution?: Record<number, number>;
  smoking: "yes" | "no";
  bathPrivate: "yes" | "no";
  bathItems: string[];
  towelColor: string;
  otherAmenities: string[];
  roomDescription: string;
  roomImages: string[];
  pricePerNight: number;
};
type ServicesState = {
  parking: "no"|"free"|"paid";
  parkingPrice: number | "";
  breakfastIncluded: boolean;
  breakfastAvailable: boolean;
  restaurant: boolean;
  bar: boolean;
  pool: boolean;
  sauna: boolean;
  laundry: boolean;
  roomService: boolean;
  security24: boolean;
  firstAid: boolean;
  fireExtinguisher: boolean;
  onSiteShop: boolean;
  nearbyMall: boolean;
  socialHall: boolean;
  sportsGames: boolean;
  gym: boolean;
  distanceHospital: number | "";
  nearPetrolStation?: boolean;
  petrolStationName?: string;
  petrolStationDistance?: number | "";
  nearBusStation?: boolean;
  busStationName?: string;
  busStationDistance?: number | "";
};

// Helper function to normalize names for matching (handles special chars, case, whitespace)
function normalizeName(name: string): string {
  return name.toLowerCase()
    .replace(/[''""]/g, "'") // Normalize different quote types
    .replace(/\s+/g, " ") // Normalize whitespace
    .trim();
}

// Helper function to create region slug from name
function createRegionSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}


export default function AddProperty() {
  useEffect(()=>{ authify(); },[]);

  const [propertyId, setPropertyId] = useState<number|null>(null);
  const [loadingProperty, setLoadingProperty] = useState(false);
  
  // Auto-save state
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const autoSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const checkAbortRef = useRef<AbortController | null>(null);
  const DRAFT_STORAGE_KEY = 'property_draft';
  const [showResumeDraft, setShowResumeDraft] = useState(false);
  const [localDraft, setLocalDraft] = useState<any | null>(null);
  const [serverDrafts, setServerDrafts] = useState<Array<{ id: number; title?: string; updatedAt?: string }>>([]);
  
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showSubmissionSuccess, setShowSubmissionSuccess] = useState(false);
  // Actionable card for the server-side pin↔address mismatch returned by /submit.
  const [submitMismatch, setSubmitMismatch] = useState<{ message: string; mismatches: string[]; detected: any } | null>(null);

  // Load existing property if ID is provided in query params
  useEffect(() => {
    const loadProperty = async () => {
      if (typeof window === 'undefined') return;
      
      const urlParams = new URLSearchParams(window.location.search);
      const idParam = urlParams.get('id');
      
      if (idParam && !propertyId) {
        const id = parseInt(idParam, 10);
        if (!isNaN(id)) {
          setLoadingProperty(true);
          try {
            const response = await api.get(`/api/owner/properties/${id}`);
            const property = response.data;
            
            if (property) {
              setPropertyId(property.id);
              
              // Load basic info
              if (property.title) setTitle(property.title);
              if (property.type) setType(property.type);
              if (property.hotelStar) setHotelStar(property.hotelStar);
              if (property.buildingType) setBuildingType(property.buildingType);
              if (typeof property.totalFloors === "number") setTotalFloors(property.totalFloors);
              if (property.regionId) setRegionId(property.regionId);
              if (property.district) setDistrict(property.district);
              if (property.ward) setWard(property.ward);
              if (property.street) setStreet(property.street);
              if (property.zip) setZip(property.zip);
              const _lat = parseFloat(String(property.latitude));
              const _lng = parseFloat(String(property.longitude));
              if (Number.isFinite(_lat)) setLatitude(_lat);
              if (Number.isFinite(_lng)) setLongitude(_lng);
              if (property.description) setDesc(property.description);
              if (property.totalBedrooms) setTotalBedrooms(property.totalBedrooms);
              if (property.totalBathrooms) setTotalBathrooms(property.totalBathrooms);
              if (property.maxGuests) setMaxGuests(property.maxGuests);

              // Load house rules (for public display: check-in/out, pets, smoking, etc.)
              if (property.houseRules) {
                try {
                  const hr =
                    typeof property.houseRules === "string"
                      ? JSON.parse(property.houseRules)
                      : property.houseRules;
                  if (hr && typeof hr === "object" && !Array.isArray(hr)) {
                    const hrObj = typeof hr === "object" && hr !== null ? hr : {};
                    setHouseRules((prev) => {
                      const prevObj = typeof prev === "object" && prev !== null ? prev : {
                        checkInFrom: "",
                        checkInTo: "",
                        checkOutFrom: "",
                        checkOutTo: "",
                        petsAllowed: null,
                        petsNote: "",
                        smokingNotAllowed: null,
                        other: "",
                      };
                      return {
                        ...prevObj,
                      // If backend stores a single string like "14:00 – 22:00", keep it in the "from" field.
                        checkInFrom: String((hrObj as any).checkIn || prevObj.checkInFrom || ""),
                        checkOutFrom: String((hrObj as any).checkOut || prevObj.checkOutFrom || ""),
                      petsAllowed:
                          typeof (hrObj as any).pets === "boolean" ? (hrObj as any).pets : prevObj.petsAllowed,
                        petsNote: String((hrObj as any).petsNote || prevObj.petsNote || ""),
                      // In public UI, houseRules.smoking is treated as "Smoking Not Allowed" when true.
                      smokingNotAllowed:
                          typeof (hrObj as any).smoking === "boolean"
                            ? (hrObj as any).smoking
                            : prevObj.smokingNotAllowed,
                        other: String((hrObj as any).other || prevObj.other || ""),
                      };
                    });
                  }
                } catch (e) {
                  console.error("Error parsing houseRules:", e);
                }
              }
              
              // Load photos
              const imageUrls = Array.isArray(property.images)
                ? property.images.map((img: any) => img.url || img).filter(Boolean)
                : [];
              const legacyPhotoUrls = normalizePhotoUrls((property as any).photos);
              // The saved photos list keeps the owner's order (cover first) and drops removed
              // photos; image rows are in upload order. Use the list whenever it holds web URLs.
              const orderedPhotoUrls = legacyPhotoUrls.filter((u) => /^https?:\/\//i.test(u));
              const nextPhotoUrls = orderedPhotoUrls.length ? orderedPhotoUrls : imageUrls.length ? imageUrls : legacyPhotoUrls;
              if (nextPhotoUrls.length) {
                applyLoadedPropertyPhotos(nextPhotoUrls);
              }
              
              // Load rooms
              if (property.roomsSpec) {
                try {
                  const rooms = typeof property.roomsSpec === 'string' 
                    ? JSON.parse(property.roomsSpec) 
                    : property.roomsSpec;
                  if (Array.isArray(rooms)) {
                    setDefinedRooms(rooms);
                  }
                } catch (e) {
                  console.error("Error parsing roomsSpec:", e);
                }
              }
              
              // Load services
              if (property.services) {
                try {
                  const services = typeof property.services === 'string' 
                    ? JSON.parse(property.services) 
                    : property.services;
                  if (services) {
                    setServices({
                      parking: services.parking || "no",
                      parkingPrice: services.parkingPrice || "",
                      breakfastIncluded: services.breakfastIncluded || false,
                      breakfastAvailable: services.breakfastAvailable || false,
                      restaurant: services.restaurant || false,
                      bar: services.bar || false,
                      pool: services.pool || false,
                      sauna: services.sauna || false,
                      laundry: services.laundry || false,
                      roomService: services.roomService || false,
                      security24: services.security24 || false,
                      firstAid: services.firstAid || false,
                      fireExtinguisher: services.fireExtinguisher || false,
                      onSiteShop: services.onSiteShop || false,
                      nearbyMall: services.nearbyMall || false,
                      socialHall: services.socialHall || false,
                      sportsGames: services.sportsGames || false,
                      gym: services.gym || false,
                      distanceHospital: services.distanceHospital || "",
                    });
                    // Restore top-level toggles stored inside services
                    if (services.acceptGroupBookings)
                      setAcceptGroupBooking(true);
                    else if (Array.isArray(services.tags) && services.tags.includes("Group stay"))
                      setAcceptGroupBooking(true);
                    if (services.freeCancellation) setFreeCancellation(true);
                  }
                } catch (e) {
                  console.error("Error parsing services:", e);
                }
              }
              
              // Load nearby facilities
              if (property.services) {
                try {
                  const services = typeof property.services === 'string' 
                    ? JSON.parse(property.services) 
                    : property.services;
                  if (services && services.nearbyFacilities && Array.isArray(services.nearbyFacilities)) {
                    setNearbyFacilities(services.nearbyFacilities);
                  }
                  setFloorUses(parseFloorUses(services));
                } catch (e) {
                  console.error("Error parsing nearbyFacilities:", e);
                }
              }
            }
          } catch (error) {
            console.error("Error loading property:", error);
            alert("Failed to load property. You can still create a new one.");
          } finally {
            setLoadingProperty(false);
          }
        }
      }
    };
    
    loadProperty();
  }, [propertyId]);

  // collapses — only the active step is expanded to keep focus.
  // By default show only the first step; others are hidden until navigated.
  const [showBasics, setShowBasics] = useState(true);
  const [showRooms, setShowRooms] = useState(false);
  const [showServices, setShowServices] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const [showTotals, setShowTotals] = useState(false);

  // basics / location
  const [title, setTitle] = useState("");
  const [type, setType] = useState<string>("");
  const [otherType, setOtherType] = useState<string>("");
  const isHotel = type === "Hotel";
  // default empty so placeholder "Select rating" is shown until user selects
  const [hotelStar, setHotelStar] = useState("");

  // ✅ Region/district now sourced from helper
  const [regionId, setRegionId] = useState<string>("");
  const [district, setDistrict] = useState<string>("");
  const [ward, setWard] = useState<string>("");
  const regionName = useMemo(() => REGION_BY_ID[regionId]?.name ?? "", [regionId]);
  
  // Get districts from REGIONS_FULL_DATA to ensure all regions work consistently
  const districts = useMemo(() => {
    if (!regionId) return [];
    
    // Find the region in full data
    const regionData = REGIONS_FULL_DATA.find((r: any) => {
      const regionSlug = createRegionSlug(r.name);
      return regionSlug === regionId;
    });
    
    if (!regionData || !regionData.districts) {
      return [];
    }
    
    // Return district names
    return regionData.districts.map((d: any) => d.name);
  }, [regionId]);
  
  const wards = useMemo(() => {
    // Get wards from REGIONS_FULL_DATA using actual Tanzania locations database
    if (!regionId || !district) return [];
    
    // Find the region in full data
    const regionData = REGIONS_FULL_DATA.find((r: any) => {
      const regionSlug = createRegionSlug(r.name);
      return regionSlug === regionId;
    });
    
    if (!regionData) {
      return [];
    }
    
    // Find the district using normalized matching
    const districtData = regionData.districts?.find((d: any) => 
      normalizeName(d.name) === normalizeName(district)
    );
    
    if (!districtData || !districtData.wards) {
      return [];
    }
    
    // Return ward names
    return districtData.wards.map((w: any) => w.name);
  }, [regionId, district]);

  // Get ward postcode when ward is selected
  const selectedWardPostcode = useMemo(() => {
    if (!regionId || !district || !ward) return null;
    
    // Try to find region - check both slug matching and direct name matching
    let regionData = REGIONS_FULL_DATA.find((r: any) => {
      const regionSlug = createRegionSlug(r.name);
      return regionSlug === regionId;
    });
    
    // Fallback: try direct name match (case-insensitive)
    if (!regionData) {
      regionData = REGIONS_FULL_DATA.find((r: any) => 
        normalizeName(r.name) === normalizeName(regionId) || 
        r.name.toUpperCase() === regionId.toUpperCase()
      );
    }
    
    if (!regionData) {
      return null;
    }
    
    const districtData = regionData.districts?.find((d: any) => 
      normalizeName(d.name) === normalizeName(district)
    );
    
    if (!districtData || !districtData.wards) {
      return null;
    }
    
    const wardData = districtData.wards.find((w: any) => 
      normalizeName(w.name) === normalizeName(ward)
    );
    
    if (!wardData) {
      return null;
    }
    
    // Get postcode - prefer postcode field, fallback to code; normalize to string|null
    const rawPostcode = wardData.postcode ?? wardData.code ?? null;
    const postcodeStr = rawPostcode && String(rawPostcode).trim() !== "" ? String(rawPostcode).trim() : null;
    return postcodeStr;
  }, [regionId, district, ward]);

  // Get streets for the selected ward
  const streets = useMemo(() => {
    if (!regionId || !district || !ward) return [];
    
    const regionData = REGIONS_FULL_DATA.find((r: any) => {
      const regionSlug = createRegionSlug(r.name);
      return regionSlug === regionId;
    });
    
    if (!regionData) return [];
    
    const districtData = regionData.districts?.find((d: any) => 
      normalizeName(d.name) === normalizeName(district)
    );
    
    if (!districtData || !districtData.wards) return [];
    
    const wardData = districtData.wards.find((w: any) => 
      normalizeName(w.name) === normalizeName(ward)
    );
    
    return wardData?.streets || [];
  }, [regionId, district, ward]);

  const [street, setStreet] = useState("");
  const [apartment] = useState("");
  const [city, setCity] = useState("");
  const [zip, setZip] = useState("");
  // Building layout (used for visualization + room placement)
  const [buildingType, setBuildingType] = useState<string>("");
  const [totalFloors, setTotalFloors] = useState<number | "">("");
  const [latitude, setLatitude] = useState<number | "">("");
  const [longitude, setLongitude] = useState<number | "">("");
  // pin/region consistency
  const [pinRegionMismatch, setPinRegionMismatch] = useState<string | null>(null);
  const [checkingPinLocation, setCheckingPinLocation] = useState(false);
  const [showMismatchModal, setShowMismatchModal] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");
  const [freeCancellation, setFreeCancellation] = useState<boolean>(false);
  const [paymentModes, setPaymentModes] = useState<string[]>([]);

  // Auto-fill zip code when ward is selected (if postcode is available)
  // Always update zip when ward changes to ensure it's synced with the selected ward
  useEffect(() => {
    if (selectedWardPostcode) {
      setZip(selectedWardPostcode);
    } else if (ward && !selectedWardPostcode) {
      // Clear zip if ward is selected but has no postcode
      setZip("");
    } else if (!ward) {
      // Clear zip when ward is cleared
      setZip("");
    }
  }, [selectedWardPostcode, ward]);




  // overall counts + description
  const [totalBedrooms, setTotalBedrooms] = useState<number | "">("");
  const [totalBathrooms, setTotalBathrooms] = useState<number | "">("");
  const [maxGuests, setMaxGuests] = useState<number | "">("");
  const [desc, setDesc] = useState("");
  const [acceptGroupBooking, setAcceptGroupBooking] = useState<boolean>(false);
  const [houseRules, setHouseRules] = useState<string | {
    checkInFrom: string;
    checkInTo: string;
    checkOutFrom: string;
    checkOutTo: string;
    petsAllowed: boolean | null;
    petsNote: string;
    smokingNotAllowed: boolean | null; // aligns with public property UI (true => Not Allowed)
    other: string;
  }>({
    checkInFrom: "",
    checkInTo: "",
    checkOutFrom: "",
    checkOutTo: "",
    petsAllowed: null,
    petsNote: "",
    smokingNotAllowed: null,
    other: "",
  });

  // property photos (controlled here)
  const [photos, setPhotos] = useState<string[]>([]);
  const [photosSaved, setPhotosSaved] = useState<boolean[]>([]);
  const [photosUploading, setPhotosUploading] = useState<boolean[]>([]);
  const photosRef = useRef<string[]>([]);
  useEffect(()=>{ photosRef.current = photos; }, [photos]);
  
  // Refs for progress bars to avoid inline styles
  const photosProgressBarRef = useRef<HTMLDivElement>(null);
  const stepProgressBarRef = useRef<HTMLDivElement>(null);

  // room-type mini form
  const [roomType, setRoomType] = useState("Single");
  const [beds, setBeds] = useState<Record<BedKey, number>>({ twin: 0, full: 0, queen: 0, king: 0 });
  const [roomsCount, setRoomsCount] = useState<number | "">("");
  // Room placement (only used when buildingType === "multi_storey")
  const [roomFloors, setRoomFloors] = useState<number[]>([]);
  const [roomFloorDistribution, setRoomFloorDistribution] = useState<Record<number, number>>({});
  const [floorUses, setFloorUses] = useState<FloorUses>({});
  const [smoking, setSmoking] = useState<"yes"|"no">("yes");
  const [bathPrivate, setBathPrivate] = useState<"yes"|"no">("yes");
  const [bathItems, setBathItems] = useState<string[]>([]);
  const [towelColor, setTowelColor] = useState("");
  const [otherAmenities, setOtherAmenities] = useState<string[]>([]);
  const [otherAmenitiesText, setOtherAmenitiesText] = useState("");
  const [roomDescription, setRoomDescription] = useState("");
  const [roomImages, setRoomImages] = useState<string[]>([]);
  const [roomImageSaved, setRoomImageSaved] = useState<boolean[]>([]);
  const [roomImageUploading, setRoomImageUploading] = useState<boolean[]>([]);
  const roomImagesRef = useRef<string[]>([]);
  useEffect(()=>{ roomImagesRef.current = roomImages; }, [roomImages]);
  // const roomImageInput = useRef<HTMLInputElement>(null);
  const [pricePerNight, setPricePerNight] = useState<number | "">("");
  const [definedRooms, setDefinedRooms] = useState<RoomEntry[]>([]);
  // Saved group loaded back into the room form for editing (null = a new group)
  const [editingRoomIndex, setEditingRoomIndex] = useState<number | null>(null);

  // Totals: auto-fill bedrooms from the saved room types (roomsCount per type).
  const autoTotalBedrooms = useMemo(() => {
    return (definedRooms || []).reduce((sum, r: any) => {
      const n = Number(r?.roomsCount);
      return sum + (Number.isFinite(n) ? Math.max(0, n) : 0);
    }, 0);
  }, [definedRooms]);

  useEffect(() => {
    setTotalBedrooms((prev) => (prev === autoTotalBedrooms ? prev : autoTotalBedrooms));
  }, [autoTotalBedrooms]);

  // Auto-calculate maxGuests from total beds across all room types
  const autoMaxGuests = useMemo(() => {
    const totalBeds = (definedRooms || []).reduce((sum, r: any) => {
      const roomsCount = Number(r?.roomsCount) || 0;
      const beds = r?.beds || {};
      const bedsPerRoom = (Number(beds?.twin) || 0) + (Number(beds?.full) || 0) + (Number(beds?.queen) || 0) + (Number(beds?.king) || 0);
      return sum + (bedsPerRoom * roomsCount);
    }, 0);
    // Ensure at least 1 guest (backend requirement: > 0)
    return Math.max(1, totalBeds);
  }, [definedRooms]);

  useEffect(() => {
    // Only auto-fill if user hasn't manually set a value (empty or 0)
    if (maxGuests === "" || maxGuests === 0) {
      setMaxGuests(autoMaxGuests);
    }
  }, [autoMaxGuests, maxGuests]);

  // Reset room placement state when building layout changes away from multi-storey
  useEffect(() => {
    if (buildingType !== "multi_storey") {
      setRoomFloors([]);
      setRoomFloorDistribution({});
    }
  }, [buildingType]);

  // services (added nearbyFacilities)
  const [services, setServices] = useState<ServicesState>({
    parking: "no",
    parkingPrice: "",
    breakfastIncluded: false, breakfastAvailable: false,
    restaurant: false, bar: false,
    pool: false, sauna: false,
    laundry: false, roomService: false,
    security24: false, firstAid: false, fireExtinguisher: false,
    onSiteShop: false, nearbyMall: false,
    socialHall: false, sportsGames: false,
    gym: false,
    distanceHospital: "", // legacy; can keep for compatibility
  });
  const [nearbyFacilities, setNearbyFacilities] = useState<NearbyFacility[]>([]);

  // helpers
  const changeBed = (k: BedKey, d: number)=> setBeds(b=>({ ...b, [k]: Math.max(0, (b[k]??0)+d) }));
  const toggleStr = (arr: string[], setArr:(v:string[])=>void, v: string)=> {
    const s = new Set(arr);
    if (s.has(v)) s.delete(v);
    else s.add(v);
    setArr(Array.from(s));
  };

  // Inline validation state for Basics
  const [touchedBasics, setTouchedBasics] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState<string>("");

  // Stepper refs + progress overlay (declared early so autosave can include step position)
  const stepperContainerRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef<Array<HTMLElement | null>>([]);
  const progressHeight = 0;
  const [currentStep, setCurrentStep] = useState(0);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([0])); // Start with step 0 visited
  
  // Auto-save to localStorage (debounced) - defined after all state variables
  const autoSaveDraft = useCallback(() => {
    if (autoSaveTimeoutRef.current) {
      clearTimeout(autoSaveTimeoutRef.current);
    }
    
    autoSaveTimeoutRef.current = setTimeout(() => {
      try {
        const draftData = {
          title, type, otherType, hotelStar,
          buildingType,
          totalFloors,
          regionId, district, ward, street, city, zip,
          latitude: typeof latitude === 'number' ? latitude : '',
          longitude: typeof longitude === 'number' ? longitude : '',
          desc, totalBedrooms, totalBathrooms, maxGuests,
          houseRules,
          photos: (photos || []).map((p: any) => {
            if (typeof p === 'string' && p.startsWith('data:')) return ''; // strip base64
            const { preview, ...rest } = p || {};
            if (typeof preview === 'string' && preview.startsWith('data:')) return rest;
            return p;
          }).filter(Boolean),
          definedRooms, services, nearbyFacilities,
          roomType, beds, roomsCount, smoking, bathPrivate,
          roomFloors,
          roomFloorDistribution,
          floorUses,
          acceptGroupBooking, freeCancellation, paymentModes,
          currentStep,
          visitedSteps: Array.from(visitedSteps),
          timestamp: new Date().toISOString(),
        };
        
        localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draftData));
        setAutoSaveStatus('saved');
        
        // Reset status after 2 seconds
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      } catch (error) {
        console.error('Auto-save failed:', error);
        setAutoSaveStatus('error');
        setTimeout(() => setAutoSaveStatus('idle'), 3000);
      }
    }, 2000); // Debounce: save 2 seconds after last change
  }, [
    title, type, otherType, hotelStar,
    buildingType, totalFloors,
    regionId, district, ward, street, city, zip,
    latitude, longitude, desc, totalBedrooms, totalBathrooms, maxGuests,
    photos, definedRooms, services, nearbyFacilities,
    roomType, beds, roomsCount, smoking, bathPrivate, roomFloors, roomFloorDistribution, floorUses,
    acceptGroupBooking, freeCancellation, paymentModes,
    houseRules,
    currentStep, visitedSteps,
  ]);
  
  // Trigger auto-save on form changes (and step changes so we can resume where user reached)
  useEffect(() => {
    // Don't auto-save if loading existing property
    if (loadingProperty) return;
    
    // Don't auto-save empty forms
    if (!title && !regionId && photos.length === 0 && !type && !buildingType) return;
    
    setAutoSaveStatus('saving');
    autoSaveDraft();
    
    return () => {
      if (autoSaveTimeoutRef.current) {
        clearTimeout(autoSaveTimeoutRef.current);
      }
    };
  }, [autoSaveDraft, loadingProperty, title, type, buildingType, totalFloors, regionId, photos.length, currentStep]);
  
  // Resume experience (no browser confirm): show a clean resume screen instead.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (propertyId || loadingProperty) return; // Skip if loading existing property

    const urlParams = new URLSearchParams(window.location.search);
    const idParam = urlParams.get("id");
    if (idParam) return; // editing a server draft
    
    try {
      const savedDraft = localStorage.getItem(DRAFT_STORAGE_KEY);
      if (savedDraft) {
        const draft = JSON.parse(savedDraft);
        const draftAge = new Date().getTime() - new Date(draft.timestamp).getTime();
        const daysOld = draftAge / (1000 * 60 * 60 * 24);
        
        // Only restore if draft is less than 7 days old
        if (daysOld < 7) {
          setLocalDraft(draft);
          setShowResumeDraft(true);
        } else {
          // Clear old drafts
          localStorage.removeItem(DRAFT_STORAGE_KEY);
        }
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    }
  }, [propertyId, loadingProperty]);

  // Fetch server drafts to show in the resume screen
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (propertyId || loadingProperty) return;
    const urlParams = new URLSearchParams(window.location.search);
    const idParam = urlParams.get("id");
    if (idParam) return;

    (async () => {
      try {
        const r = await api.get("/api/owner/properties/mine", { params: { status: "DRAFT", pageSize: 5 } });
        const items = ((r.data as any)?.items ?? []) as any[];
        const normalized = Array.isArray(items)
          ? items
              .map((it) => ({
                id: Number(it?.id),
                title: it?.title ?? it?.name ?? "",
                updatedAt: it?.updatedAt ?? it?.updated_at ?? it?.timestamp ?? it?.lastEdited ?? "",
              }))
              .filter((x) => Number.isFinite(x.id) && x.id > 0)
          : [];
        setServerDrafts(normalized);
        if (normalized.length > 0) setShowResumeDraft(true);
      } catch {
        // ignore (resume screen can still show local draft)
      }
    })();
  }, [propertyId, loadingProperty]);
  
  // Clear draft on successful submission
  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    setAutoSaveStatus('idle');
  }, []);

  const validateBasics = () => {
    const missing: string[] = [];
    if (title.trim().length < 3) missing.push('Property name');
    if (!type) missing.push('Property type');
    if (!buildingType) missing.push('Building layout');
    if (buildingType === "multi_storey") {
      const floorsNum = Number(totalFloors);
      if (!floorsNum || floorsNum < 2) missing.push('Total floors (min 2)');
    }
    if (!regionId) missing.push('Region');
    if (!district) missing.push('District');
    if (!ward) missing.push('Ward');
    if (street.trim().length === 0) missing.push('Street address');
    // Only require zip code if a postcode is available (some regions don't have postcodes in source data)
    // If selectedWardPostcode exists, zip must be filled; otherwise it's optional
    if (selectedWardPostcode && (!zip || zip.trim().length === 0)) {
      missing.push('Zip code');
    }
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      missing.push('Exact location pin (drag the map)');
    }

    if (missing.length) {
      // mark fields as touched so inline errors appear
      const touchedFields: Record<string, boolean> = { title: true, type: true, buildingType: true, regionId: true, district: true, ward: true, street: true };
      if (selectedWardPostcode) touchedFields.zip = true;
      if (buildingType === "multi_storey") touchedFields.totalFloors = true;
      setTouchedBasics((t) => ({ ...t, ...touchedFields }));
      setAnnouncement(`Please complete: ${missing.join(', ')}.`);
      return false;
    }
    return true;
  };


  // ── Reverse-geocoding pin-vs-region consistency check ─────────────────────
  // Called whenever the owner moves the map pin.  Calls Mapbox reverse-
  // geocoding and compares the returned region name to the selected regionId.
  // A mismatch sets a warning banner and also blocks final submission.
  async function checkPinConsistency(lat: number, lng: number): Promise<void> {
    if (!regionId) { setPinRegionMismatch(null); return; }

    // Cancel any previous in-flight request to avoid stale results
    if (checkAbortRef.current) checkAbortRef.current.abort();
    const controller = new AbortController();
    checkAbortRef.current = controller;

    const token =
      (process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string) ||
      (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN as string) ||
      '';
    if (!token) return;

    setCheckingPinLocation(true);
    setPinRegionMismatch(null);

    try {
      // Ask for "region" and "place" types so we get the administrative region back
      const url =
        'https://api.mapbox.com/geocoding/v5/mapbox.places/' +
        lng + ',' + lat +
        '.json?types=region,place&limit=1&access_token=' + token;
      const resp = await fetch(url, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (!resp.ok) { setCheckingPinLocation(false); return; }

      const data = await resp.json();
      const feature = data.features?.[0];
      if (!feature) { setCheckingPinLocation(false); return; }

      const contexts: Array<{ id: string; text: string }> = feature.context || [];
      // Collect all text labels (feature + all parent contexts)
      const allTexts: string[] = [
        feature.text || '',
        ...contexts.map((ctx: any) => String(ctx.text || '')),
      ];
      const combinedLower = allTexts.join(' ').toLowerCase();

      // Normalise selected regionId for word-level comparison
      // "DAR-ES-SALAAM" → ["dar", "es", "salaam"]; "ARUSHA" → ["arusha"]
      const selectedWords: string[] = regionId
        .toLowerCase()
        .replace(/-/g, ' ')
        .split(/\s+/)
        .filter((w: string) => w.length > 1);

      const mismatch =
        selectedWords.length > 0 &&
        !selectedWords.every((w: string) => combinedLower.includes(w));

      if (mismatch) {
        // Pick the most descriptive Mapbox label to show in the inline warning
        const regionCtxText: string =
          contexts.find((ctx) => ctx.id?.startsWith('region'))?.text ||
          contexts.find((ctx) => ctx.id?.startsWith('place'))?.text ||
          feature.text ||
          'an unknown area';
        // Pretty-format the selected region (e.g. "Dar Es Salaam")
        const selectedLabel: string = (regionName || regionId.replace(/-/g, ' '))
          .toLowerCase()
          .replace(/\b\w/g, (ch: string) => ch.toUpperCase());
        setPinRegionMismatch(
          'Your pin appears to be in "' + regionCtxText +
          '" \u2014 you selected region "' + selectedLabel + '". ' +
          'Please move the pin to match your selected region, or update your Region selection.'
        );
      } else {
        setPinRegionMismatch(null);
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return; // cancelled — ignore
      setPinRegionMismatch(null); // network failure — fail open (do not block)
    } finally {
      if (!controller.signal.aborted) setCheckingPinLocation(false);
    }
  }

  // Re-run whenever the pin or the selected Region changes
  useEffect(() => {
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      setPinRegionMismatch(null);
      return;
    }
    if (latitude === 0 && longitude === 0) { setPinRegionMismatch(null); return; }
    // checkPinConsistency reads regionId + regionName from its closure;
    // those are listed in deps so the effect re-runs when region selection changes.
    checkPinConsistency(latitude, longitude);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latitude, longitude, regionId]);

  const goToNextStep = () => {
    if (currentStep < 5) {
      if (currentStep === 0) {
        const ok = validateBasics();
        if (!ok) return;
      }
      if (currentStep === 1 && definedRooms.length < 1) {
        alert('Please add at least one room type before continuing.');
        return;
      }
      if (currentStep === 2 && !servicesCompleted) {
        alert('Please complete the Services section before continuing.');
        return;
      }
      if (currentStep === 3 && !totalsCompleted) {
        alert('Please complete the Totals & Description section before continuing.');
        return;
      }
      if (currentStep === 4 && photos.length < 3) {
        alert(`Please add at least 3 photos (${photos.length}/3 added).`);
        return;
      }
      const nextStep = currentStep + 1;
      setVisitedSteps(prev => new Set([...prev, nextStep]));
      setCurrentStep(nextStep);
      scrollToStep(nextStep, true);
    }
  };

  
  const goToPreviousStep = () => {
    if (currentStep > 0) {
      const prevStep = currentStep - 1;
      setCurrentStep(prevStep);
      scrollToStep(prevStep);
    }
  };

  const scrollToStep = (i: number, skipValidation = false) => {
    // Validate the current step before any forward jump
    if (!skipValidation && i > currentStep) {
      if (currentStep === 0) {
        const ok = validateBasics();
        if (!ok) return;
      } else if (currentStep === 1 && definedRooms.length < 1) {
        alert('Please add at least one room type before continuing.');
        return;
      } else if (currentStep === 2 && !servicesCompleted) {
        alert('Please complete the Services section before continuing.');
        return;
      } else if (currentStep === 3 && !totalsCompleted) {
        alert('Please complete the Totals & Description section before continuing.');
        return;
      } else if (currentStep === 4 && photos.length < 3) {
        alert(`Please add at least 3 photos (${photos.length}/3 added).`);
        return;
      }
    }
    // Mark step as visited
    setVisitedSteps(prev => new Set([...prev, i]));
    setCurrentStep(i);
    // Open only the target step
    setShowBasics(i === 0);
    setShowRooms(i === 1);
    setShowServices(i === 2);
    setShowTotals(i === 3);
    setShowPhotos(i === 4);
    setShowReview(i === 5);
    // Announce opened step for screen readers
    const stepNames = ['Basic details','Room & Bathroom','Services','Totals & Description','Property Photos','Review & Submit'];
    setAnnouncement(`Opened ${stepNames[i]}`);

    // small timeout to allow expand animation / layout before scrolling
    setTimeout(() => {
      const el = sectionRefs.current[i];
      if (el && 'scrollIntoView' in el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 60);
  };

  // Update current step when sections change
  useEffect(() => {
    if (showBasics) setCurrentStep(0);
    else if (showRooms) setCurrentStep(1);
    else if (showServices) setCurrentStep(2);
    else if (showTotals) setCurrentStep(3);
    else if (showPhotos) setCurrentStep(4);
    else if (showReview) setCurrentStep(5);
  }, [showBasics, showRooms, showServices, showTotals, showPhotos, showReview]);

  type CloudinarySig = {
    timestamp: number;
    apiKey: string;
    signature: string;
    folder: string;
    cloudName: string;
  };

  async function uploadToCloudinary(file: File, folder: string) {
    authify();
    // Step 1: Get a signed upload token from our API (uses cookie auth via GET)
    const signRes = await api.get(`/api/uploads/cloudinary/sign`, { params: { folder } });
    const { cloudName, apiKey, timestamp, signature } = signRes.data as {
      cloudName: string; apiKey: string; timestamp: number; folder: string; signature: string;
    };
    // Step 2: Upload directly to Cloudinary (no server auth needed)
    const fd = new FormData();
    fd.append("file", file);
    fd.append("folder", folder);
    fd.append("api_key", apiKey);
    fd.append("timestamp", String(timestamp));
    fd.append("signature", signature);
    fd.append("overwrite", "true");
    const cloudRes = await axios.post(
      `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      fd,
    );
    return (cloudRes.data as { secure_url: string }).secure_url;
  }

  const applyLoadedPropertyPhotos = useCallback((nextPhotos: string[]) => {
    setPhotos(nextPhotos);
    setPhotosSaved(nextPhotos.map(() => true));
    setPhotosUploading(nextPhotos.map(() => false));
  }, []);

  const onPickPropertyPhotos = async (files: FileList | null) => {
    if (!files) return;
    const chosen = Array.from(files);
    if (!chosen.length) return;

    const localBlobs = chosen.map((file) => URL.createObjectURL(file));
    setPhotos((prev) => [...prev, ...localBlobs]);
    setPhotosSaved((prev) => [...prev, ...Array(localBlobs.length).fill(false)]);
    setPhotosUploading((prev) => [...prev, ...Array(localBlobs.length).fill(true)]);

    chosen.forEach((file, i) => {
      const blobUrl = localBlobs[i];
      uploadToCloudinary(file, "properties").then((url) => {
        setPhotos((prev) => {
          const idx = prev.indexOf(blobUrl);
          if (idx === -1) return prev;
          const copy = [...prev];
          copy[idx] = url;
          return copy;
        });
        setPhotosSaved((prev) => {
          const idx = photosRef.current.indexOf(blobUrl);
          if (idx === -1) return prev;
          const copy = [...prev];
          copy[idx] = true;
          return copy;
        });
        setPhotosUploading((prev) => {
          const idx = photosRef.current.indexOf(blobUrl);
          if (idx === -1) return prev;
          const copy = [...prev];
          copy[idx] = false;
          return copy;
        });
      }).catch((err) => {
        console.error("Property photo upload failed", err);
        setPhotos((prev) => prev.filter((u) => u !== blobUrl));
        setPhotosSaved((prev) => {
          const idx = photosRef.current.indexOf(blobUrl);
          return idx === -1 ? prev : prev.filter((_, j) => j !== idx);
        });
        setPhotosUploading((prev) => {
          const idx = photosRef.current.indexOf(blobUrl);
          return idx === -1 ? prev : prev.filter((_, j) => j !== idx);
        });
        if (err?.response?.status === 401) {
          alert("Session expired. Please log in again to upload photos.");
        } else {
          alert("Property photo upload failed. Please try again.");
        }
      }).finally(() => {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      });
    });
  };

  const onPickRoomImages = async (files: FileList | null) => {
    if (!files) return;
    const chosen = Array.from(files).slice(0, 6);
    const localBlobs = chosen.map(f => URL.createObjectURL(f));
    setRoomImages(prev => [...prev, ...localBlobs]);
    setRoomImageSaved(prev => [...prev, ...Array(localBlobs.length).fill(false)]);
    setRoomImageUploading(prev => [...prev, ...Array(localBlobs.length).fill(true)]);

    chosen.forEach((file, i) => {
      const blobUrl = localBlobs[i];
      uploadToCloudinary(file, "properties/rooms").then(url => {
        const uploadedIndex = roomImagesRef.current.indexOf(blobUrl);
        setRoomImages(prev => {
          const idx = prev.indexOf(blobUrl);
          if (idx === -1) return prev;
          const copy = [...prev];
          copy[idx] = url;
          return copy;
        });
        setRoomImageUploading(prev => {
          if (uploadedIndex === -1) return prev;
          const copy = [...prev];
          copy[uploadedIndex] = false;
          return copy;
        });
        setRoomImageSaved(prev => {
          if (uploadedIndex === -1) return prev;
          const copy = [...prev];
          copy[uploadedIndex] = true;
          return copy;
        });
      }).catch(err => {
        console.error("Room image upload failed", err);
        // Remove the failed blob and clear its uploading state
        setRoomImages(prev => prev.filter(u => u !== blobUrl));
        setRoomImageSaved(prev => { const idx = roomImagesRef.current.indexOf(blobUrl); return idx === -1 ? prev : prev.filter((_, j) => j !== idx); });
        setRoomImageUploading(prev => { const idx = roomImagesRef.current.indexOf(blobUrl); return idx === -1 ? prev : prev.filter((_, j) => j !== idx); });
        if (err?.response?.status === 401) {
          alert("Session expired. Please log in again to upload photos.");
        } else {
          alert("Room image upload failed. Please try again.");
        }
      }).finally(() => {
        try { URL.revokeObjectURL(blobUrl); } catch {}
      });
    });
  };

  const addRoomType = () => {
    const errs: string[] = [];
    if (!roomsCount || Number(roomsCount) <= 0) errs.push("Rooms count is required.");
    if (roomImages.length === 0) errs.push("At least one room image is required.");
    if (buildingType === "multi_storey") {
      if (roomFloors.length === 0) errs.push("Select at least one floor for this room type.");
      const total = roomFloors.reduce((sum, f) => sum + (roomFloorDistribution[f] || 0), 0);
      if (Number(roomsCount) > 0 && total !== Number(roomsCount)) {
        errs.push("Floor distribution must add up to the total number of rooms.");
      }
    }
    if (errs.length) { alert(errs.join("\n")); return; }

    const entry: RoomEntry = {
      roomType, beds, roomsCount: Number(roomsCount),
      ...(buildingType === "multi_storey"
        ? { floors: roomFloors, floorDistribution: roomFloorDistribution }
        : buildingType === "single_storey"
          ? { floors: [0], floorDistribution: { 0: Number(roomsCount) } }
          : {}),
      smoking, bathPrivate, bathItems, towelColor,
      otherAmenities: Array.from(new Set([...otherAmenities, ...splitComma(otherAmenitiesText)])),
      roomDescription, roomImages, pricePerNight: Number(pricePerNight || 0)
    };
    // Editing replaces the group in place; otherwise it is a new group
    if (editingRoomIndex !== null && editingRoomIndex < definedRooms.length) {
      const at = editingRoomIndex;
      setDefinedRooms(list => list.map((r, i) => (i === at ? entry : r)));
    } else {
      setDefinedRooms(list => [...list, entry]);
    }
    setEditingRoomIndex(null);
    resetRoomForm();
  };

  const resetRoomForm = () => {
    setBeds({ twin:0, full:0, queen:0, king:0 });
    setRoomsCount(""); setSmoking("yes"); setBathPrivate("yes");
    setRoomFloors([]); setRoomFloorDistribution({});
    setBathItems([]); setTowelColor(""); setOtherAmenities([]);
    setOtherAmenitiesText(""); setRoomDescription(""); setRoomImages([]);
    setRoomImageSaved([]); setRoomImageUploading([]);
    setPricePerNight("");
  };

  const roomFormHasContent = () =>
    roomsCount !== "" || roomImages.length > 0 || pricePerNight !== "" ||
    Object.values(beds).some((n) => Number(n) > 0) || roomDescription.trim() !== "";

  /** Puts a saved group back into the room form, exactly as it was saved */
  const loadRoomIntoForm = (r: RoomEntry) => {
    setRoomType(r.roomType || "");
    setBeds({ twin: Number(r.beds?.twin) || 0, full: Number(r.beds?.full) || 0, queen: Number(r.beds?.queen) || 0, king: Number(r.beds?.king) || 0 });
    setRoomsCount(Number(r.roomsCount) || "");
    setSmoking(r.smoking === "no" ? "no" : "yes");
    setBathPrivate(r.bathPrivate === "no" ? "no" : "yes");
    if (buildingType === "multi_storey") {
      const dist: Record<number, number> = {};
      for (const [k, v] of Object.entries(r.floorDistribution || {})) {
        const f = Number(k);
        if (Number.isFinite(f) && Number(v) > 0) dist[f] = Number(v);
      }
      setRoomFloors(Object.keys(dist).map(Number).sort((a, b) => a - b));
      setRoomFloorDistribution(dist);
    } else {
      setRoomFloors([]); setRoomFloorDistribution({});
    }
    setBathItems(Array.isArray(r.bathItems) ? r.bathItems : []);
    setTowelColor(r.towelColor || "");
    const amenities = Array.isArray(r.otherAmenities) ? r.otherAmenities : [];
    setOtherAmenities(amenities.filter((a) => ROOM_ITEMS.includes(a)));
    setOtherAmenitiesText(amenities.filter((a) => !ROOM_ITEMS.includes(a)).join(", "));
    setRoomDescription(r.roomDescription || "");
    const imgs = Array.isArray(r.roomImages) ? r.roomImages : [];
    setRoomImages(imgs);
    setRoomImageSaved(imgs.map(() => true));
    setRoomImageUploading(imgs.map(() => false));
    setPricePerNight(Number(r.pricePerNight) || "");
    window.setTimeout(() => {
      document.getElementById("rooms-step-start")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  };

  const confirmReplaceRoomForm = () =>
    !roomFormHasContent() || window.confirm("Replace the room details you are typing with this group?");

  const editRoom = (index: number) => {
    const r = definedRooms[index];
    if (!r || !confirmReplaceRoomForm()) return;
    loadRoomIntoForm(r);
    setEditingRoomIndex(index);
  };

  const duplicateRoom = (index: number) => {
    const r = definedRooms[index];
    if (!r || !confirmReplaceRoomForm()) return;
    loadRoomIntoForm(r);
    setEditingRoomIndex(null);
  };

  const removeRoom = (index: number) => {
    const r = definedRooms[index];
    if (!r) return;
    if (!window.confirm(`Remove the ${r.roomsCount} × ${r.roomType} group? This cannot be undone.`)) return;
    setDefinedRooms(list => list.filter((_, i) => i !== index));
    if (editingRoomIndex === index) {
      setEditingRoomIndex(null);
      resetRoomForm();
    } else if (editingRoomIndex !== null && editingRoomIndex > index) {
      setEditingRoomIndex(editingRoomIndex - 1);
    }
  };

  const cancelRoomEdit = () => {
    setEditingRoomIndex(null);
    resetRoomForm();
  };

  const payload = () => {
    // Map hotelStar string values to numbers for backend validation
    const hotelStarMap: Record<string, number | null> = {
      "": null,
      "basic": 1,
      "simple": 2,
      "moderate": 3,
      "high": 4,
      "luxury": 5,
    };
    
    // Send regionId - prefer numeric code if available, otherwise use slug (string)
    // Database stores regionId as VARCHAR(50), so both formats work
    const regionData = REGION_BY_ID[regionId];
    const regionCode = regionData?.code ? Number(regionData.code) : undefined;
    
    const fmtWindow = (from: string, to: string) => {
      const f = String(from || "").trim();
      const t = String(to || "").trim();
      if (f && t) return `${f} – ${t}`;
      if (f) return `From ${f}`;
      if (t) return `Until ${t}`;
      return "";
    };

    const houseRulesObj = (() => {
      const hr = typeof houseRules === "object" && houseRules !== null ? houseRules : {
        checkInFrom: "",
        checkInTo: "",
        checkOutFrom: "",
        checkOutTo: "",
        petsAllowed: null,
        petsNote: "",
        smokingNotAllowed: null,
        other: "",
      };
      const checkIn = fmtWindow(hr.checkInFrom || "", hr.checkInTo || "");
      const checkOut = fmtWindow(hr.checkOutFrom || "", hr.checkOutTo || "");

      const out: any = {};
      if (checkIn) out.checkIn = checkIn;
      if (checkOut) out.checkOut = checkOut;
      if (typeof hr.petsAllowed === "boolean") out.pets = hr.petsAllowed;
      if (hr.petsNote && typeof hr.petsNote === "string" && hr.petsNote.trim()) out.petsNote = hr.petsNote.trim();
      // In public UI, houseRules.smoking === true means "Smoking Not Allowed"
      if (typeof hr.smokingNotAllowed === "boolean") out.smoking = hr.smokingNotAllowed;
      if (hr.other && typeof hr.other === "string" && hr.other.trim()) out.other = hr.other.trim();

      return Object.keys(out).length ? out : null;
    })();

    return {
      title,
      type: toServerType(type),
      buildingType: buildingType || null,
      totalFloors:
        buildingType === "multi_storey"
          ? (Number(totalFloors) >= 2 ? Number(totalFloors) : null)
          : buildingType === "single_storey"
            ? 1
            : null,
      description: desc || null,
      // location - send numeric code if available (for regions with codes), otherwise send slug
      ...(regionId ? { regionId: regionCode || regionId } : {}),
      regionName: regionName || undefined,
      district: district || undefined,
      ward: ward || null,
      street: street || null,
      apartment: apartment || null,
      city: city || undefined,
      zip: zip || undefined,
      latitude: latitude ? Number(latitude) : null,
      longitude: longitude ? Number(longitude) : null,

      photos,

      // hotelStar must be a number (1-5) or null, not a string
      hotelStar: isHotel && hotelStar && hotelStar !== "" ? (hotelStarMap[hotelStar] ?? null) : null,

      roomsSpec: definedRooms,

      totalBedrooms: numOrNull(totalBedrooms),
      totalBathrooms: totalBathrooms === "" || totalBathrooms == null ? 0 : Number(totalBathrooms),
      maxGuests: maxGuests === "" || maxGuests == null || Number(maxGuests) <= 0 ? Math.max(1, autoMaxGuests) : Number(maxGuests),
      houseRules: houseRulesObj,

      // Backend expects services as JSON: can be array of strings OR object with nearbyFacilities
      // Send as object to preserve full nearbyFacilities data (name, distance, etc.) AND all service properties
      services: (() => {
        const servicesObj: any = {
          // Include all service properties so they can be displayed in admin view
          // Only include properties that have been explicitly set (not default/empty values)
          ...(services.parking && services.parking !== 'no' ? { parking: services.parking } : {}),
          ...(services.parking === 'paid' && services.parkingPrice ? { parkingPrice: services.parkingPrice } : {}),
          ...(services.breakfastIncluded ? { breakfastIncluded: true } : {}),
          ...(services.breakfastAvailable ? { breakfastAvailable: true } : {}),
          ...(services.restaurant ? { restaurant: true } : {}),
          ...(services.bar ? { bar: true } : {}),
          ...(services.pool ? { pool: true } : {}),
          ...(services.sauna ? { sauna: true } : {}),
          ...(services.laundry ? { laundry: true } : {}),
          ...(services.roomService ? { roomService: true } : {}),
          ...(services.security24 ? { security24: true } : {}),
          ...(services.firstAid ? { firstAid: true } : {}),
          ...(services.fireExtinguisher ? { fireExtinguisher: true } : {}),
          ...(services.onSiteShop ? { onSiteShop: true } : {}),
          ...(services.nearbyMall ? { nearbyMall: true } : {}),
          ...(services.socialHall ? { socialHall: true } : {}),
          ...(services.sportsGames ? { sportsGames: true } : {}),
          ...(services.gym ? { gym: true } : {}),
          ...(acceptGroupBooking ? { acceptGroupBookings: true } : {}),
          ...(freeCancellation ? { freeCancellation: true } : {}),
        // Service tags array for filtering/searching
        tags: Array.from(
          new Set<string>([
            ...servicesToArray(services),
            ...nearbyFacilitiesToServiceTags(nearbyFacilities),
            ...(freeCancellation ? ["Free cancellation"] : []),
            ...(acceptGroupBooking ? ["Group stay"] : []),
            ...paymentModes.map((m) => `Payment: ${m}`),
          ])
        ),
        };
        
        // Full nearbyFacilities array with all details (name, distance, type, etc.)
        if (nearbyFacilities.length > 0) {
          servicesObj.nearbyFacilities = nearbyFacilities;
        }

        // What each floor holds besides rooms (reception, restaurant, offices...)
        const cleanedFloorUses = buildingType === "multi_storey" ? cleanFloorUses(floorUses, Number(totalFloors)) : {};
        if (Object.keys(cleanedFloorUses).length > 0) {
          servicesObj.floorUses = cleanedFloorUses;
        }
        
        return servicesObj;
      })(),

      basePrice: inferBasePrice(definedRooms),
      currency: "TZS",
    };
  };

  function nearbyFacilitiesToServiceTags(list: NearbyFacility[]): string[] {
    const map: Record<string, string> = {
      Hospital: "Near hospital",
      Pharmacy: "Near pharmacy",
      Polyclinic: "Near polyclinic",
      Clinic: "Near clinic",
      "Police station": "Near police station",
      Airport: "Near airport",
      "Bus station": "Near bus station",
      "Petrol station": "Near petrol station",
      "Main road": "Near main road",
    };
    const tags = new Set<string>();
    for (const f of list || []) {
      const t = map[String((f as any)?.type || "")];
      if (t) tags.add(t);
    }
    return Array.from(tags);
  }

  function servicesToArray(s: ServicesState): string[] {
    const out: string[] = [];
    if (s.parking === "free") out.push("Free parking");
    if (s.parking === "paid") out.push(`Paid parking (${numOrEmpty(s.parkingPrice)} TZS)`);
    if (s.breakfastIncluded) out.push("Breakfast included");
    if (s.breakfastAvailable) out.push("Breakfast available");
    if (s.restaurant) out.push("Restaurant");
    if (s.bar) out.push("Bar");
    if (s.pool) out.push("Pool");
    if (s.sauna) out.push("Sauna");
    if (s.laundry) out.push("Laundry");
    if (s.roomService) out.push("Room service");
    if (s.security24) out.push("24h security");
    if (s.firstAid) out.push("First aid");
    if (s.fireExtinguisher) out.push("Fire extinguisher");
    if (s.onSiteShop) out.push("On-site shop");
    if (s.nearbyMall) out.push("Nearby mall");
    if (s.socialHall) out.push("Social hall");
    if (s.sportsGames) out.push("Sports & games");
    if (s.gym) out.push("Gym");
    if (numOrEmpty(s.distanceHospital)) {
      out.push("Near hospital");
      out.push(`Hospital distance ${numOrEmpty(s.distanceHospital)} km`);
    }
    return out.filter(Boolean);
  }

  const completeEnough =
    title.trim().length >= 3 &&
    !!regionId &&
    !!district &&
    typeof latitude === 'number' &&
    typeof longitude === 'number' &&
    photos.length >= 3 &&
    definedRooms.length >= 1 &&
    // if this is a Hotel, ensure a star rating was chosen
    (!isHotel || (typeof hotelStar === "string" && hotelStar !== ""));


  function submitForReview() {
    if (!completeEnough) {
      const missing = [
        !(title.trim().length >= 3) ? "name" : null,
        !regionId ? "location" : null,
        (typeof latitude !== 'number' || typeof longitude !== 'number') ? "exact location pin" : null,
        !(photos.length >= 3) ? "≥3 photos" : null,
        !(definedRooms.length >= 1) ? "≥1 room type" : null,
        (isHotel && (!hotelStar || hotelStar === "")) ? "hotel star rating" : null,
      ].filter(Boolean);
      alert("Please complete: " + missing.join(", ") + ".");
      return;
    }
    // The owner-placed pin is authoritative — a region mismatch no longer blocks
    // submission (Mapbox's TZ admin data is unreliable). The inline banner still
    // surfaces the warning during editing, but it's advisory only.
    setShowSubmitConfirm(true);
  }

  async function executeSubmit() {
    setShowSubmitConfirm(false);
    try {
      let id: number | null = null;
      let createResponse: any = null;
      if (propertyId) {
        await api.put(`/api/owner/properties/${propertyId}`, payload());
        id = propertyId;
      } else {
        createResponse = await api.post("/api/owner/properties", payload());
        id = (createResponse.data as { id: number })?.id;
        if (id) {
          setPropertyId(id);
        } else {
          const fetchedId = await refetchLatestId();
          if (fetchedId) { id = fetchedId; setPropertyId(fetchedId); }
        }
      }
      if (!id || !Number.isFinite(id)) {
        alert("Error: Could not determine property ID. Please try again.");
        return;
      }
      const resp = await api.post(`/api/owner/properties/${id}/submit`);
      if (resp.status === 200 || resp.status === 204) {
        clearDraft();
        setShowSubmissionSuccess(true);
      } else {
        alert("Unexpected response: " + resp.status);
      }
    } catch (e:any) {
      const data = e?.response?.data;
      const url = e?.config?.url || "unknown";
      const method = e?.config?.method?.toUpperCase() || "unknown";
      const status = e?.response?.status;
      // Structured location-mismatch from /submit → show an actionable card
      // (which field is off + a jump to the location step) instead of an alert.
      if (status === 400 && data && (Array.isArray(data.mismatches) || data.detectedLocation)) {
        setSubmitMismatch({
          message: typeof data.error === "string" ? data.error : "The property pin does not match the selected address fields.",
          mismatches: Array.isArray(data.mismatches) ? data.mismatches : [],
          detected: data.detectedLocation ?? null,
        });
        return;
      }
      const err = data?.error ?? data ?? e?.message ?? "Submit failed";
      const errorMsg = typeof err === "string" ? err : JSON.stringify(err, null, 2);
      alert(`Submit failed (${status || "network error"}): ${errorMsg}\n\nURL: ${method} ${url}`);
    }
  }

  async function refetchLatestId(): Promise<number | undefined> {
    const r = await api.get("/api/owner/properties/mine", { params: { status: "DRAFT", pageSize: 1 } });
    const items = (r.data as any)?.items;
    return Array.isArray(items) ? items[0]?.id : undefined;
  }

  /* UI below */

  const restoreLocalDraft = () => {
    const draft = localDraft;
    if (!draft) return;
    // Apply values
    if (draft.title) setTitle(draft.title);
    if (draft.type) setType(draft.type);
    if (draft.otherType) setOtherType(draft.otherType);
    if (draft.hotelStar) setHotelStar(draft.hotelStar);
    if (draft.buildingType) setBuildingType(draft.buildingType);
    if (draft.totalFloors !== undefined && draft.totalFloors !== null && draft.totalFloors !== "") {
      const n = typeof draft.totalFloors === "number" ? draft.totalFloors : parseFloat(draft.totalFloors);
      setTotalFloors(Number.isFinite(n) ? n : "");
    }
    if (draft.roomType) setRoomType(draft.roomType);
    if (draft.beds) setBeds(draft.beds);
    if (draft.roomsCount !== undefined) setRoomsCount(draft.roomsCount);
    if (draft.smoking) setSmoking(draft.smoking);
    if (draft.bathPrivate) setBathPrivate(draft.bathPrivate);
    if (Array.isArray(draft.roomFloors)) setRoomFloors(draft.roomFloors);
    if (draft.roomFloorDistribution && typeof draft.roomFloorDistribution === "object") setRoomFloorDistribution(draft.roomFloorDistribution);
    if (draft.regionId) setRegionId(draft.regionId);
    if (draft.district) setDistrict(draft.district);
    if (draft.ward) setWard(draft.ward);
    if (draft.street) setStreet(draft.street);
    if (draft.city) setCity(draft.city);
    if (draft.zip) setZip(draft.zip);
    if (draft.latitude) setLatitude(typeof draft.latitude === "number" ? draft.latitude : parseFloat(draft.latitude) || "");
    if (draft.longitude) setLongitude(typeof draft.longitude === "number" ? draft.longitude : parseFloat(draft.longitude) || "");
    if (draft.desc) setDesc(draft.desc);
    if (draft.totalBedrooms) setTotalBedrooms(draft.totalBedrooms);
    if (draft.totalBathrooms) setTotalBathrooms(draft.totalBathrooms);
    if (draft.maxGuests) setMaxGuests(draft.maxGuests);
    if (draft.houseRules && typeof draft.houseRules === "object" && draft.houseRules !== null && !Array.isArray(draft.houseRules)) {
      setHouseRules((prev) => {
        const prevObj = typeof prev === "object" && prev !== null ? prev : {
          checkInFrom: "",
          checkInTo: "",
          checkOutFrom: "",
          checkOutTo: "",
          petsAllowed: null,
          petsNote: "",
          smokingNotAllowed: null,
          other: "",
        };
        return { ...prevObj, ...(draft.houseRules as Record<string, any>) };
      });
    }
    if (draft.photos) applyLoadedPropertyPhotos(normalizePhotoUrls(draft.photos));
    if (draft.definedRooms && Array.isArray(draft.definedRooms)) setDefinedRooms(draft.definedRooms);
    if (draft.services) setServices(draft.services);
    if (draft.nearbyFacilities && Array.isArray(draft.nearbyFacilities)) setNearbyFacilities(draft.nearbyFacilities);
    if (draft.floorUses && typeof draft.floorUses === "object") setFloorUses(parseFloorUses({ floorUses: draft.floorUses }));
    if (draft.acceptGroupBooking !== undefined) setAcceptGroupBooking(draft.acceptGroupBooking);
    if (draft.freeCancellation !== undefined) setFreeCancellation(draft.freeCancellation);
    if (draft.paymentModes && Array.isArray(draft.paymentModes)) setPaymentModes(draft.paymentModes);

    const step = typeof draft.currentStep === "number" ? Math.max(0, Math.min(5, draft.currentStep)) : 0;
    const visited = Array.isArray(draft.visitedSteps)
      ? new Set<number>(draft.visitedSteps.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)))
      : new Set<number>(Array.from({ length: step + 1 }, (_, i) => i));
    setVisitedSteps(visited);
    setShowResumeDraft(false);

    // flip into the last step smoothly; skip validation (draft may already be partially filled)
    setTimeout(() => scrollToStep(step, true), 50);
  };

  const continueServerDraft = useCallback((id: number) => {
    if (typeof window === "undefined") return;
    window.location.href = `/owner/properties/add?id=${id}`;
  }, []);

  const startNewListing = useCallback(() => {
    if (typeof window === "undefined") return;
    localStorage.removeItem(DRAFT_STORAGE_KEY);
    window.location.href = "/owner/properties/add";
  }, []);

  // The long form titles the page the owner is on. The short form labels the
  // stepper pill and the "Next" hint, so the thing they are told is coming is
  // spelled the same as the button they will click. Defined together because
  // these two drifted apart once already ("Rooms" against "Room & bathroom").
  const stepTitles = ["Basic details", "Room & bathroom", "Services", "Totals & description", "Property photos", "Review & submit"] as const;
  const stepShortTitles = ["Basic details", "Rooms", "Services", "Totals", "Photos", "Review"] as const;
  // One line of purpose per step. The header used to repeat the step name and
  // the word "Pending" six times and say nothing about the work itself.
  const stepBlurbs = [
    "Name the place and pin exactly where guests will find it.",
    "Set up the rooms, beds and bathrooms guests can book.",
    "Tell guests what you offer on the property and nearby.",
    "Confirm capacity, pricing and how you describe the place.",
    "Add the photos guests will judge this listing by.",
    "Check everything, then send it to NoLSAF for review.",
  ] as const;

  const servicesCompleted = useMemo(() => {
    const s: any = services || {};
    const anyNearby = (nearbyFacilities?.length ?? 0) > 0;

    // If parking is set to paid, require a valid price to consider the step complete.
    const parkingPaidOk = s.parking !== "paid" || Number(s.parkingPrice) > 0;

    const anyOnProperty =
      s.parking !== "no" ||
      !!s.breakfastIncluded ||
      !!s.breakfastAvailable ||
      !!s.restaurant ||
      !!s.bar ||
      !!s.pool ||
      !!s.sauna ||
      !!s.laundry ||
      !!s.roomService ||
      !!s.security24 ||
      !!s.firstAid ||
      !!s.fireExtinguisher ||
      !!s.onSiteShop ||
      !!s.nearbyMall ||
      !!s.socialHall ||
      !!s.sportsGames ||
      !!s.gym;

    return (anyNearby || anyOnProperty) && parkingPaidOk;
  }, [services, nearbyFacilities]);

  // Check if Totals step is completed
  const totalsCompleted = useMemo(() => {
    const bathroomsOk = typeof totalBathrooms === "number" && totalBathrooms > 0;
    const guestsOk = typeof maxGuests === "number" && maxGuests > 0;
    // Description is optional but nice to have
    return bathroomsOk && guestsOk;
  }, [totalBathrooms, maxGuests]);

  if (loadingProperty) {
    return (
      <div className="min-h-[400px] flex flex-col items-center justify-center text-center">
        <div className="dot-spinner mb-4">
          <span className="dot dot-blue" />
          <span className="dot dot-black" />
          <span className="dot dot-yellow" />
          <span className="dot dot-green" />
        </div>
        <h2 className="text-xl font-semibold text-gray-800">Loading property...</h2>
        <p className="text-sm text-gray-600 mt-2">Please wait while we load your property details.</p>
      </div>
    );
  }

  if (showResumeDraft) {
    return (
      <ResumeDraftScreen
        localDraft={localDraft}
        serverDrafts={serverDrafts}
        stepTitles={stepTitles}
        onContinueLocal={restoreLocalDraft}
        onContinueServer={continueServerDraft}
        onStartNew={startNewListing}
        onDismiss={() => setShowResumeDraft(false)}
      />
    );
  }

  const currentStepTitle = stepTitles[currentStep] || "Add property";

  const stepsMeta = [
    { index: 0, title: stepShortTitles[0], completed: title.trim().length >= 3 && !!regionId && !!district && typeof latitude === 'number' && typeof longitude === 'number' },
    { index: 1, title: stepShortTitles[1], completed: definedRooms.length >= 1 },
    { index: 2, title: stepShortTitles[2], completed: servicesCompleted },
    { index: 3, title: stepShortTitles[3], completed: totalsCompleted },
    { index: 4, title: stepShortTitles[4], completed: photos.length >= 3 },
    { index: 5, title: stepShortTitles[5], completed: false },
  ] as const;

  const totalDefinedRooms = definedRooms.reduce((sum, room) => sum + (Number(room?.roomsCount) || 0), 0);
  const totalBedsAcrossRooms = definedRooms.reduce((sum, room) => {
    const counts = room?.beds || {};
    const perRoomBeds = (Number(counts?.twin) || 0) + (Number(counts?.full) || 0) + (Number(counts?.queen) || 0) + (Number(counts?.king) || 0);
    return sum + perRoomBeds * (Number(room?.roomsCount) || 0);
  }, 0);
  const photosNeeded = Math.max(0, 5 - photos.length);
  const hasHotelStar = !isHotel || (typeof hotelStar === "string" && hotelStar !== "");


  return (
    <div id="addPropertyView" className={PAGE_WRAPPER_CLASS}>
      <div aria-live="polite" className="sr-only" role="status">{announcement}</div>
      <div className={PAGE_LAYOUT_CLASS}>
        <div className={PAGE_SHELL_CLASS}>
          <section className={STEPPER_WRAPPER_CLASS}>
            <div className="w-full relative space-y-4" ref={stepperContainerRef} data-progress={progressHeight}>
              <header className="ap-head">
                <div className="ap-head-inner">
                  {/* Identity and the save state, on one line */}
                  <div className="ap-head-top">
                    <span className="ap-eyebrow">
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Listing builder
                    </span>
                    {autoSaveStatus !== "idle" ? (
                      <span className={`ap-save${autoSaveStatus === "saved" ? " is-saved" : autoSaveStatus === "saving" ? "" : " is-error"}`}>
                        {autoSaveStatus === "saving" ? (<><span className="ap-save-spinner" />Saving</>)
                          : autoSaveStatus === "saved" ? (<><CheckCircle2 className="h-3.5 w-3.5" /> Saved</>)
                          : (<><AlertCircle className="h-3.5 w-3.5" /> Save failed</>)}
                      </span>
                    ) : null}
                  </div>

                  {/* What this step is, and where it sits in the six */}
                  <div className="ap-head-main">
                    <div className="ap-head-copy">
                      <h1 className="ap-title">{currentStepTitle}</h1>
                      <p className="ap-sub">{stepBlurbs[currentStep]}</p>
                    </div>
                    <div className="ap-count" aria-hidden>
                      <span className="ap-count-now">{currentStep + 1}</span>
                      <span className="ap-count-of">/ {stepTitles.length}</span>
                    </div>
                  </div>

                  {/* One segment per step: the bar and the rail now agree */}
                  <div
                    className="ap-track"
                    role="progressbar"
                    aria-valuemin={1}
                    aria-valuemax={stepTitles.length}
                    aria-valuenow={currentStep + 1}
                    aria-label={`Step ${currentStep + 1} of ${stepTitles.length}`}
                  >
                    {stepsMeta.map((s) => (
                      <span
                        key={s.index}
                        className={`ap-seg${currentStep > s.index ? " is-done" : currentStep === s.index ? " is-active" : ""}`}
                      />
                    ))}
                  </div>

                  {/* The rail. On phones it is numbers only, and the step you are
                      on is the one that shows its name. */}
                  <nav className="ap-rail" aria-label="Steps">
                    <ol>
                      {stepsMeta.map((s) => {
                        const isActive = currentStep === s.index;
                        const isPast = currentStep > s.index;
                        const isVisited = visitedSteps.has(s.index);
                        const isCompleted = s.completed && isPast;
                        const canJump = isVisited || s.index === currentStep;
                        const state = isActive ? " is-active" : isCompleted ? " is-done" : isVisited ? " is-visited" : "";
                        return (
                          <li key={s.index}>
                            <button
                              type="button"
                              disabled={!canJump}
                              onClick={() => scrollToStep(s.index)}
                              className={`ap-node${state}`}
                              aria-current={isActive ? "step" : undefined}
                              title={s.title}
                            >
                              <span className="ap-node-dot">
                                {isCompleted ? <Check className="h-3.5 w-3.5" aria-hidden /> : s.index + 1}
                              </span>
                              <span className="ap-node-name">{s.title}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                  </nav>

                  {/* A count only earns a chip once it has something to count. */}
                  {totalDefinedRooms > 0 || totalBedsAcrossRooms > 0 || photos.length > 0 ? (
                    <div className="ap-chips">
                      {totalDefinedRooms > 0 ? <span className="ap-chip"><Home className="h-3.5 w-3.5" aria-hidden />{totalDefinedRooms} rooms set</span> : null}
                      {totalBedsAcrossRooms > 0 ? <span className="ap-chip"><Bed className="h-3.5 w-3.5" aria-hidden />{totalBedsAcrossRooms} beds mapped</span> : null}
                      {photos.length > 0 ? <span className="ap-chip"><ImageIcon className="h-3.5 w-3.5" aria-hidden />{photos.length} photos added</span> : null}
                    </div>
                  ) : null}
                </div>
              </header>
              <div className="min-w-0">
                <main className="relative">
                  <div className="relative w-full space-y-4">
        {/* BASICS */}
        <BasicsStep
          isVisible={showBasics}
          ref={(el) => {
            sectionRefs.current[0] = el;
          }}
          currentStep={currentStep}
          goToPreviousStep={goToPreviousStep}
          goToNextStep={goToNextStep}
          title={title}
          setTitle={setTitle}
          type={type}
          setType={setType}
          otherType={otherType}
          setOtherType={setOtherType}
          hotelStar={hotelStar}
          setHotelStar={setHotelStar}
          buildingType={buildingType}
          setBuildingType={setBuildingType}
          totalFloors={totalFloors}
          setTotalFloors={setTotalFloors}
          touchedBasics={touchedBasics}
          setTouchedBasics={setTouchedBasics}
          PROPERTY_TYPES={PROPERTY_TYPES}
          PROPERTY_TYPE_ICONS={PROPERTY_TYPE_ICONS}
          PROPERTY_TYPE_STYLES={PROPERTY_TYPE_STYLES}
          HOTEL_STAR_OPTIONS={HOTEL_STAR_OPTIONS}
          regionId={regionId}
          setRegionId={setRegionId}
          district={district}
          setDistrict={setDistrict}
          ward={ward}
          setWard={setWard}
          street={street}
          setStreet={setStreet}
          city={city}
          setCity={setCity}
          zip={zip}
          setZip={setZip}
          selectedWardPostcode={selectedWardPostcode}
          latitude={latitude}
          setLatitude={setLatitude}
          longitude={longitude}
          setLongitude={setLongitude}
          districts={districts}
          wards={wards}
          streets={streets}
          REGIONS={REGIONS}
        />

        {/* ROOM TYPES */}
        <RoomsStep
          isVisible={showRooms}
          sectionRef={(el) => {
            sectionRefs.current[1] = el;
          }}
          currentStep={currentStep}
          goToPreviousStep={goToPreviousStep}
          goToNextStep={goToNextStep}
          buildingType={buildingType}
          totalFloors={totalFloors}
          roomType={roomType}
          setRoomType={setRoomType}
          beds={beds as any}
          changeBed={changeBed as any}
          roomsCount={roomsCount}
          setRoomsCount={setRoomsCount}
          roomFloors={roomFloors}
          setRoomFloors={setRoomFloors}
          roomFloorDistribution={roomFloorDistribution}
          setRoomFloorDistribution={setRoomFloorDistribution}
          floorUses={floorUses}
          setFloorUses={setFloorUses}
          smoking={smoking}
          setSmoking={setSmoking}
          bathPrivate={bathPrivate}
          setBathPrivate={setBathPrivate}
          bathItems={bathItems}
          setBathItems={setBathItems}
          towelColor={towelColor}
          setTowelColor={setTowelColor}
          otherAmenities={otherAmenities}
          setOtherAmenities={setOtherAmenities}
          otherAmenitiesText={otherAmenitiesText}
          setOtherAmenitiesText={setOtherAmenitiesText}
          roomDescription={roomDescription}
          setRoomDescription={setRoomDescription}
          roomImages={roomImages}
          onPickRoomImages={onPickRoomImages}
          setRoomImages={setRoomImages}
          roomImageSaved={roomImageSaved}
          setRoomImageSaved={setRoomImageSaved}
          roomImageUploading={roomImageUploading}
          setRoomImageUploading={setRoomImageUploading}
          pricePerNight={pricePerNight}
          setPricePerNight={setPricePerNight}
          addRoomType={addRoomType}
          editingRoomIndex={editingRoomIndex}
          onEditRoom={editRoom}
          onDuplicateRoom={duplicateRoom}
          onRemoveRoom={removeRoom}
          onCancelRoomEdit={cancelRoomEdit}
          definedRooms={definedRooms}
          setDefinedRooms={setDefinedRooms}
          numOrEmpty={numOrEmpty}
          toggleStr={toggleStr as any}
          BED_ICONS={BED_ICONS as any}
        />

        {/* SERVICES */}
        <ServicesStep
          isVisible={showServices}
          sectionRef={(el) => {
            sectionRefs.current[2] = el;
          }}
          currentStep={currentStep}
          goToPreviousStep={goToPreviousStep}
          goToNextStep={goToNextStep}
          services={services as any}
          setServices={setServices as any}
          numOrEmpty={numOrEmpty}
          nearbyFacilities={nearbyFacilities as any}
          setNearbyFacilities={setNearbyFacilities as any}
          servicesCompleted={servicesCompleted}
        />

        {/* totals + description */}
        <TotalsStep
          isVisible={showTotals}
          sectionRef={(el) => {
            sectionRefs.current[3] = el;
          }}
          totalBedrooms={totalBedrooms}
          totalBathrooms={totalBathrooms}
          setTotalBathrooms={setTotalBathrooms}
          maxGuests={maxGuests}
          setMaxGuests={setMaxGuests}
          desc={desc}
          setDesc={setDesc}
          acceptGroupBooking={acceptGroupBooking}
          setAcceptGroupBooking={setAcceptGroupBooking}
          houseRules={houseRules as any}
          setHouseRules={setHouseRules as any}
          goToPreviousStep={goToPreviousStep}
          goToNextStep={goToNextStep}
          currentStep={currentStep}
        />

        {/* PROPERTY PHOTOS */}
        <PhotosStep
          isVisible={showPhotos}
          photos={photos}
          photosSaved={photosSaved}
          photosUploading={photosUploading}
          pickPropertyPhotos={onPickPropertyPhotos}
          setPhotos={setPhotos}
          setPhotosSaved={setPhotosSaved}
          setPhotosUploading={setPhotosUploading}
          goToPreviousStep={goToPreviousStep}
          goToNextStep={goToNextStep}
          currentStep={currentStep}
        />

        {/* REVIEW */}
        <ReviewStep
          isVisible={showReview}
          sectionRef={(el) => {
            sectionRefs.current[5] = el;
          }}
          goToPreviousStep={goToPreviousStep}
          submitForReview={submitForReview}
          submitDisabled={!completeEnough}
          stepsMeta={stepsMeta}
          completeEnough={completeEnough}
          onStepClick={(stepIndex) => {
            scrollToStep(stepIndex, true);
          }}
          reviewData={{
            title: title || "",
            type: type || "",
            location: {
              district: district || undefined,
              regionName: regionName || undefined,
              street: street || undefined,
              city: city || undefined,
            },
            rooms: definedRooms.map((r) => ({
              roomType: r.roomType,
              roomsCount: r.roomsCount,
              pricePerNight: r.pricePerNight,
              floorDistribution: r.floorDistribution || undefined,
            })),
            buildingType: buildingType || "",
            totalFloors: totalFloors || "",
            floorUses: buildingType === "multi_storey" ? cleanFloorUses(floorUses, Number(totalFloors)) : {},
            currency: "TZS",
            coverPhoto: photos[0],
            photoCount: photos.length,
            description: desc,
            bedrooms: totalBedrooms,
            bathrooms: totalBathrooms,
            maxGuests: maxGuests,
          }}
        />
                  </div>
                </main>
              </div>
            </div>
          </section>

        </div>
      </div>

      {/* Submission Success Modal */}
      {showSubmissionSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowSubmissionSuccess(false);
              setTimeout(() => {
                window.location.href = `/owner/properties/pending?refresh=${Date.now()}`;
              }, 300);
            }
          }}
        >
          <div className="bg-[#02665e] rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
            {/* Header */}
            <div className="px-5 pt-5 pb-4 text-center">
              <div className="flex items-center justify-center w-12 h-12 mx-auto mb-3 rounded-xl bg-white/20">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-base font-bold text-white">Submitted for Review!</h2>
            </div>

            {/* Review Timeline */}
            <div className="mx-5 rounded-lg bg-white/10 border border-white/20 p-3 mb-2">
              <div className="flex items-start gap-2.5">
                <Clock className="w-4 h-4 text-white/70 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-white mb-0.5">Review Timeline</p>
                  <p className="text-[11px] text-white/80 leading-relaxed">
                    Your property will be reviewed within <strong className="text-white">3-5 business days</strong>. You&apos;ll receive a notification once complete.
                  </p>
                </div>
              </div>
            </div>

            {/* What Happens Next */}
            <div className="mx-5 rounded-lg bg-white/10 border border-white/20 p-3 mb-2">
              <div className="flex items-start gap-2.5">
                <Bell className="w-4 h-4 text-white/70 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-xs font-bold text-white mb-1">What Happens Next?</p>
                  <ul className="text-[11px] text-white/80 space-y-0.5 list-disc list-inside">
                    <li>Our team will verify all property details</li>
                    <li>We&apos;ll check photos and room specs</li>
                    <li>You&apos;ll be notified via email when approved</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Status note */}
            <div className="mx-5 rounded-lg bg-white/5 border border-white/10 p-2.5 mb-4">
              <p className="text-[10px] text-white/60 text-center">
                View your property status in the <strong className="text-white/80">Pending Properties</strong> section.
              </p>
            </div>

            {/* Action Button */}
            <div className="px-5 pb-5">
              <button
                onClick={() => {
                  setShowSubmissionSuccess(false);
                  setTimeout(() => {
                    window.location.href = `/owner/properties/pending?refresh=${Date.now()}`;
                  }, 300);
                }}
                className="w-full h-10 rounded-lg bg-white text-sm font-bold text-[#02665e] shadow-sm hover:bg-white/90 transition"
              >
                View Pending Properties
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Region Mismatch Modal ── */}
      {showMismatchModal && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-6 animate-in fade-in duration-200"
          onClick={() => setShowMismatchModal(false)}
        >
          <div
            className="bg-[#02665e] rounded-2xl shadow-2xl max-w-sm w-full p-5 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Location mismatch"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center">
                  <MapPin className="h-4 w-4 text-white" />
                </div>
                <h3 className="text-sm font-bold text-white">Location Mismatch</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowMismatchModal(false)}
                className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Mismatch details */}
            <div className="rounded-lg bg-white/10 border border-white/20 p-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-3.5 h-3.5 text-amber-300 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-white/90 leading-relaxed">{pinRegionMismatch}</p>
              </div>
            </div>

            {/* Manual coordinate entry */}
            <div className="rounded-lg bg-white/10 border border-white/20 p-3 mb-3">
              <h4 className="text-[11px] font-bold text-white mb-2 flex items-center gap-1.5">
                <Crosshair className="w-3 h-3 text-white/70" />
                Enter Coordinates Manually
              </h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-white/60 uppercase tracking-wide mb-1">Lat</label>
                  <input
                    type="number"
                    step="any"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    className="w-full h-8 rounded-lg border border-white/30 bg-white/10 px-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/50"
                    placeholder="-6.7924"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-white/60 uppercase tracking-wide mb-1">Lng</label>
                  <input
                    type="number"
                    step="any"
                    value={manualLng}
                    onChange={(e) => setManualLng(e.target.value)}
                    className="w-full h-8 rounded-lg border border-white/30 bg-white/10 px-2.5 text-xs text-white placeholder-white/40 focus:outline-none focus:ring-1 focus:ring-white/50 focus:border-white/50"
                    placeholder="39.2083"
                  />
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowMismatchModal(false);
                  scrollToStep(0);
                }}
                className="flex-1 h-9 rounded-lg border border-white/30 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                Move Pin on Map
              </button>
              <button
                type="button"
                onClick={() => {
                  const lat = parseFloat(manualLat);
                  const lng = parseFloat(manualLng);
                  if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
                    setLatitude(lat);
                    setLongitude(lng);
                    setPinRegionMismatch(null);
                    setShowMismatchModal(false);
                  } else {
                    alert("Please enter valid coordinates (Lat: -90 to 90, Lng: -180 to 180).");
                  }
                }}
                className="flex-1 h-9 rounded-lg bg-white text-xs font-semibold text-[#02665e] hover:bg-white/90 transition shadow-sm"
              >
                Apply Coordinates
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom submission confirmation modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowSubmitConfirm(false)} />
          <div
            className="relative w-full max-w-sm rounded-2xl bg-[#02665e] shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/20 mb-3">
                <CheckCircle2 className="h-4 w-4 text-white" />
              </div>
              <h2 className="text-sm font-bold text-white leading-tight">Submit for review?</h2>
              <p className="mt-1 text-xs text-white/70">You won&apos;t be able to edit while it&apos;s pending approval.</p>
            </div>
            {/* Body */}
            <div className="mx-5 rounded-lg bg-white/10 border border-white/20 p-3 mb-4 space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span className="text-xs text-white/90">Our team will verify your property details</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span className="text-xs text-white/90">You&apos;ll be notified by email once approved</span>
              </div>
            </div>
            {/* Actions */}
            <div className="flex gap-2 px-5 pb-5">
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 h-9 rounded-lg border border-white/30 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeSubmit}
                className="flex-1 h-9 rounded-lg bg-white text-xs font-bold text-[#02665e] shadow-sm hover:bg-white/90 transition"
              >
                Yes, submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Submit Location Mismatch Modal ── */}
      {submitMismatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={(e) => { if (e.target === e.currentTarget) setSubmitMismatch(null); }}
        >
          <div
            className="relative w-full max-w-md rounded-2xl bg-[#02665e] shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
            role="dialog"
            aria-modal="true"
            aria-label="Location mismatch"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/20">
                  <MapPin className="h-4 w-4 text-white" />
                </div>
                <h2 className="text-sm font-bold text-white">Location needs a quick fix</h2>
              </div>
              <button
                type="button"
                onClick={() => setSubmitMismatch(null)}
                className="p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-5 pb-5 space-y-3">
              <p className="text-xs leading-relaxed text-white/80">
                The map pin doesn&rsquo;t line up with the address you selected. Fix either the pin or the address fields, then submit again.
              </p>

              {/* Which fields are off */}
              {submitMismatch.mismatches.length > 0 ? (
                <div className="rounded-lg bg-white/10 border border-white/20 p-3 space-y-2">
                  {submitMismatch.mismatches.map((m, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                      <span className="text-[11px] leading-relaxed text-white/90">{m}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg bg-white/10 border border-white/20 p-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
                    <span className="text-[11px] leading-relaxed text-white/90">{submitMismatch.message}</span>
                  </div>
                </div>
              )}

              {/* Reassurance: nothing is lost */}
              <div className="flex items-start gap-2 rounded-lg bg-white/5 border border-white/10 p-2.5">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-300" />
                <span className="text-[11px] leading-relaxed text-white/70">
                  Everything you&rsquo;ve entered stays saved. You&rsquo;ll come straight back here to submit.
                </span>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setSubmitMismatch(null)}
                  className="flex-1 h-9 rounded-lg border border-white/30 bg-white/10 text-xs font-semibold text-white hover:bg-white/20 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { setSubmitMismatch(null); scrollToStep(0, true); }}
                  className="flex-1 h-9 rounded-lg bg-white text-xs font-bold text-[#02665e] shadow-sm hover:bg-white/90 transition"
                >
                  Edit location
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



/** Facilities mini-components */
