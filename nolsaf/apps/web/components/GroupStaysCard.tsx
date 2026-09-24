"use client";

import React, { useState, useEffect, useRef } from 'react';
import DatePicker from '@/components/ui/DatePicker';
import { REGIONS as TZ_REGIONS } from '@/lib/tzRegions';
import { REGIONS_FULL_DATA } from '@/lib/tzRegionsFull';
import Link from 'next/link';
import { Calendar, ChevronDown, ChevronLeft, ChevronRight, Check, Truck, Bus, Coffee, Users, Wrench, Download, ArrowLeft, CheckCircle, CheckCircle2, ArrowRight, Trash2, Lock, DoorOpen, Megaphone, MapPin, ShieldCheck, Gavel, Info } from 'lucide-react';
import Spinner from './Spinner';
import ComingSoonGate from './ComingSoonGate';

/** -- Service gate config --------------------------------------------------
 *  Set GATE_ENABLED to false when NoLSAF team is ready to open Group Stays.
 *  Nothing else needs to change — the modal simply won't appear.
 * ----------------------------------------------------------------------- */
// TEMP (testing): set back to `true` to restore the coming-soon gate before launch.
const GATE_ENABLED = false;
const GATE_LAUNCH_DATE = new Date('2026-06-25T00:00:00');

export default function GroupStaysCard({ onCloseAction }: { onCloseAction?: () => void }) {
  const DRAFT_KEY = 'groupStaysDraft.v1';
  const [groupType, setGroupType] = useState<string>('');
  const [accommodationType, setAccommodationType] = useState<string>('');
  const [minHotelStarLabel, setMinHotelStarLabel] = useState<string>('');
  const [headcount, setHeadcount] = useState<number>(4);
  const [maleCount, setMaleCount] = useState<number>(2);
  const [femaleCount, setFemaleCount] = useState<number>(2);
  const [otherCount, setOtherCount] = useState<number>(0);
  const [checkInIso, setCheckInIso] = useState<string>('');
  const [checkOutIso, setCheckOutIso] = useState<string>('');
  const [roomSize, setRoomSize] = useState<number>(2);
  const [errors, setErrors] = useState<string[]>([]);
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  const [draftNotice, setDraftNotice] = useState<string>('');
  // Bid-model explainer (parity with the mobile app's "How it works" panel).
  // Collapsed by default — opens only when the chip is tapped.
  const [showHowItWorks, setShowHowItWorks] = useState<boolean>(false);

  // Coming-soon gate — only the open/close state lives here now
  const [showComingSoon, setShowComingSoon] = useState(false);

  // Use canonical TZ region/district data from `lib/tzRegions.ts`
  // `TZ_REGIONS` is an array of { id, name, districts }
  // Use `id` values for selects (stable for URLs/storage) and look up names when needed
  const REGION_OPTIONS = TZ_REGIONS;
  const getDistrictsFor = (regionId: string) => TZ_REGIONS.find(r => r.id === regionId)?.districts ?? [];
  const getRegionName = (id?: string | null) => id ? (TZ_REGIONS.find(r => r.id === id)?.name ?? id) : '';
  
  // Helper functions for full data structure (wards and streets)
  const getFullRegionData = (regionId: string) => {
    const region = TZ_REGIONS.find(r => r.id === regionId);
    if (!region) return null;
    return REGIONS_FULL_DATA.find(r => r.name === region.name);
  };
  
  const getWardsFor = (regionId: string, districtName: string) => {
    const fullRegion = getFullRegionData(regionId);
    if (!fullRegion) return [];
    const district = fullRegion.districts?.find(d => d.name === districtName);
    return district?.wards ?? [];
  };
  
  const getStreetsFor = (regionId: string, districtName: string, wardName: string) => {
    const fullRegion = getFullRegionData(regionId);
    if (!fullRegion) return [];
    const district = fullRegion.districts?.find(d => d.name === districtName);
    if (!district) return [];
    const ward = district.wards?.find(w => w.name === wardName);
    return ward?.streets ?? [];
  };

  const [fromCountry, setFromCountry] = useState<string>('');
  const [fromRegion, setFromRegion] = useState<string>('');
  const [toRegion, setToRegion] = useState<string>('');
  const [toDistrict, setToDistrict] = useState<string>('');
  const [toWard, setToWard] = useState<string>('');
  const [toLocation, setToLocation] = useState<string>('');
  const [fromDistrict, setFromDistrict] = useState<string>('');
  const [fromWard, setFromWard] = useState<string>('');
  const [fromLocation, setFromLocation] = useState<string>('');

  // Countries list with EU as a special option
  const COUNTRIES = [
    { value: 'tanzania', label: 'Tanzania' },
    { value: 'eu', label: 'EU (European Union)' },
    { value: 'kenya', label: 'Kenya' },
    { value: 'uganda', label: 'Uganda' },
    { value: 'rwanda', label: 'Rwanda' },
    { value: 'burundi', label: 'Burundi' },
    { value: 'south-africa', label: 'South Africa' },
    { value: 'united-states', label: 'United States' },
    { value: 'united-kingdom', label: 'United Kingdom' },
    { value: 'canada', label: 'Canada' },
    { value: 'australia', label: 'Australia' },
    { value: 'india', label: 'India' },
    { value: 'china', label: 'China' },
    { value: 'japan', label: 'Japan' },
    { value: 'south-korea', label: 'South Korea' },
    { value: 'brazil', label: 'Brazil' },
    { value: 'mexico', label: 'Mexico' },
    { value: 'argentina', label: 'Argentina' },
    { value: 'egypt', label: 'Egypt' },
    { value: 'nigeria', label: 'Nigeria' },
    { value: 'ghana', label: 'Ghana' },
    { value: 'other', label: 'Other' },
  ];

  // Check if Tanzania is selected
  const isTanzaniaSelected = fromCountry === 'tanzania';

  const HOTEL_STAR_OPTIONS = [
    { value: '', label: 'Select rating' },
    { value: 'basic', label: 'Basic accommodations' },
    { value: 'simple', label: 'Simple and affordable' },
    { value: 'moderate', label: 'Moderate quality' },
    { value: 'high', label: 'High-end comfort' },
    { value: 'luxury', label: 'Luxury and exceptional service' },
  ] as const;

  const hotelStarLabelToNumber = (v: unknown): number | null => {
    const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
    if (s === 'basic') return 1;
    if (s === 'simple') return 2;
    if (s === 'moderate') return 3;
    if (s === 'high') return 4;
    if (s === 'luxury') return 5;
    return null;
  };

  const hotelStarNumberToLabel = (n: unknown): string => {
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    if (num <= 1) return 'basic';
    if (num === 2) return 'simple';
    if (num === 3) return 'moderate';
    if (num === 4) return 'high';
    if (num >= 5) return 'luxury';
    return '';
  };

  // Calculate headcount from gender breakdown
  const calculatedHeadcount = maleCount + femaleCount + otherCount;
  // Update headcount when gender breakdown changes
  useEffect(() => {
    if (calculatedHeadcount > 0) {
      setHeadcount(calculatedHeadcount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maleCount, femaleCount, otherCount]);
  
  const roomsNeeded = Math.max(0, Math.ceil(headcount / (roomSize || 1)));
  const [checkInPickerOpen, setCheckInPickerOpen] = useState(false);
  const [checkOutPickerOpen, setCheckOutPickerOpen] = useState(false);
  const [useDates, setUseDates] = useState<boolean>(true);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [needsPrivateRoom, setNeedsPrivateRoom] = useState<boolean>(false);
  const [privateRoomCount, setPrivateRoomCount] = useState<number>(0);
  // Arrangements (Step 2)
  const [arrPickup, setArrPickup] = useState<boolean>(false);
  const [arrTransport, setArrTransport] = useState<boolean>(false);
  const [arrMeals, setArrMeals] = useState<boolean>(false);
  const [arrGuide, setArrGuide] = useState<boolean>(false);
  const [arrEquipment, setArrEquipment] = useState<boolean>(false);
  const [pickupLocation, setPickupLocation] = useState<string>('');
  const [pickupTime, setPickupTime] = useState<string>('');
  const [arrangementNotes, setArrangementNotes] = useState<string>('');
  const [roster, setRoster] = useState<Array<Record<string, string>>>([]);
  const [rosterError, setRosterError] = useState<string>('');
  const [rosterFileName, setRosterFileName] = useState<string>('');
  const [showAllPassengers, setShowAllPassengers] = useState<boolean>(false);
  const [isCreating, setIsCreating] = useState<boolean>(false);
  const [showSuccess, setShowSuccess] = useState<boolean>(false);

  // Keep focus on the task: when the result screen replaces the form, scroll it
  // into view so the page doesn't appear to "jump to the footer".
  const successRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (showSuccess && successRef.current) {
      successRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showSuccess]);
  const templateColumns = ['First name','Last name','Phone','Age','Gender','Nationality'];

  const toIsoDate = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const addDaysIso = (iso: string, days: number) => {
    if (!iso) return '';
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return '';
    dt.setUTCDate(dt.getUTCDate() + days);
    return toIsoDate(dt);
  };

  const isoDateToApiDateTime = (iso: string) => {
    if (!iso) return null;
    return `${iso}T00:00:00.000Z`;
  };

  const clearSavedDraft = () => {
    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {}
    setHasSavedDraft(false);
    setDraftNotice('Saved draft cleared.');
    window.setTimeout(() => setDraftNotice(''), 2500);
  };

  // Restore Step 1 + Step 2 draft (never restores roster)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as any;
      if (!parsed || typeof parsed !== 'object') return;

      setGroupType(typeof parsed.groupType === 'string' ? parsed.groupType : '');
      setFromCountry(typeof parsed.fromCountry === 'string' ? parsed.fromCountry : '');
      setFromRegion(typeof parsed.fromRegion === 'string' ? parsed.fromRegion : '');
      setFromDistrict(typeof parsed.fromDistrict === 'string' ? parsed.fromDistrict : '');
      setFromWard(typeof parsed.fromWard === 'string' ? parsed.fromWard : '');
      setFromLocation(typeof parsed.fromLocation === 'string' ? parsed.fromLocation : '');
      setToRegion(typeof parsed.toRegion === 'string' ? parsed.toRegion : '');
      setToDistrict(typeof parsed.toDistrict === 'string' ? parsed.toDistrict : '');
      setToWard(typeof parsed.toWard === 'string' ? parsed.toWard : '');
      setToLocation(typeof parsed.toLocation === 'string' ? parsed.toLocation : '');

      setAccommodationType(typeof parsed.accommodationType === 'string' ? parsed.accommodationType : '');
      // Draft compatibility:
      // - new drafts store minHotelStarLabel (basic/simple/moderate/high/luxury)
      // - older drafts stored minHotelStar as a number (1-5)
      if (typeof parsed.minHotelStarLabel === 'string') {
        setMinHotelStarLabel(parsed.minHotelStarLabel);
      } else if (typeof parsed.minHotelStar === 'string') {
        setMinHotelStarLabel(parsed.minHotelStar);
      } else if (Number.isFinite(parsed.minHotelStar)) {
        setMinHotelStarLabel(hotelStarNumberToLabel(parsed.minHotelStar));
      } else {
        setMinHotelStarLabel('');
      }
      setMaleCount(Number.isFinite(parsed.maleCount) ? Math.max(0, Number(parsed.maleCount)) : 2);
      setFemaleCount(Number.isFinite(parsed.femaleCount) ? Math.max(0, Number(parsed.femaleCount)) : 2);
      setOtherCount(Number.isFinite(parsed.otherCount) ? Math.max(0, Number(parsed.otherCount)) : 0);
      setRoomSize(Number.isFinite(parsed.roomSize) ? Math.max(1, Number(parsed.roomSize)) : 2);
      setNeedsPrivateRoom(typeof parsed.needsPrivateRoom === 'boolean' ? parsed.needsPrivateRoom : false);
      setPrivateRoomCount(Number.isFinite(parsed.privateRoomCount) ? Math.max(0, Number(parsed.privateRoomCount)) : 0);
      setUseDates(typeof parsed.useDates === 'boolean' ? parsed.useDates : true);
      setCheckInIso(typeof parsed.checkInIso === 'string' ? parsed.checkInIso : '');
      setCheckOutIso(typeof parsed.checkOutIso === 'string' ? parsed.checkOutIso : '');

      setArrPickup(typeof parsed.arrPickup === 'boolean' ? parsed.arrPickup : false);
      setArrTransport(typeof parsed.arrTransport === 'boolean' ? parsed.arrTransport : false);
      setArrMeals(typeof parsed.arrMeals === 'boolean' ? parsed.arrMeals : false);
      setArrGuide(typeof parsed.arrGuide === 'boolean' ? parsed.arrGuide : false);
      setArrEquipment(typeof parsed.arrEquipment === 'boolean' ? parsed.arrEquipment : false);
      setPickupLocation(typeof parsed.pickupLocation === 'string' ? parsed.pickupLocation : '');
      setPickupTime(typeof parsed.pickupTime === 'string' ? parsed.pickupTime : '');
      setArrangementNotes(typeof parsed.arrangementNotes === 'string' ? parsed.arrangementNotes : '');

      const savedStep = Number.isFinite(parsed.currentStep) ? Number(parsed.currentStep) : 1;
      setCurrentStep(Math.min(2, Math.max(1, savedStep)));

      setHasSavedDraft(true);
      // "Book again" from the account page seeds this draft from the lapsed request
      setDraftNotice(parsed.rebook ? 'Filled from your earlier request. Pick new dates to continue.' : 'Draft restored (Steps 1–2).');
      window.setTimeout(() => setDraftNotice(''), parsed.rebook ? 6000 : 3000);
    } catch {
      // If draft is corrupted, ignore it
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Autosave Step 1 + Step 2 fields only (never saves roster)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = window.setTimeout(() => {
      try {
        const draft = {
          currentStep: Math.min(2, Math.max(1, currentStep)),

          // Step 1
          groupType,
          fromCountry,
          fromRegion,
          fromDistrict,
          fromWard,
          fromLocation,
          toRegion,
          toDistrict,
          toWard,
          toLocation,

          // Step 2
          accommodationType,
          minHotelStarLabel,
          maleCount,
          femaleCount,
          otherCount,
          roomSize,
          needsPrivateRoom,
          privateRoomCount,
          useDates,
          checkInIso,
          checkOutIso,
          arrPickup,
          arrTransport,
          arrMeals,
          arrGuide,
          arrEquipment,
          pickupLocation,
          pickupTime,
          arrangementNotes,
        };

        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        setHasSavedDraft(true);
      } catch {
        // ignore quota/unavailable storage
      }
    }, 450);

    return () => window.clearTimeout(t);
  }, [
    currentStep,
    groupType,
    fromCountry,
    fromRegion,
    fromDistrict,
    fromWard,
    fromLocation,
    toRegion,
    toDistrict,
    toWard,
    toLocation,
    accommodationType,
    minHotelStarLabel,
    maleCount,
    femaleCount,
    otherCount,
    roomSize,
    needsPrivateRoom,
    privateRoomCount,
    useDates,
    checkInIso,
    checkOutIso,
    arrPickup,
    arrTransport,
    arrMeals,
    arrGuide,
    arrEquipment,
    pickupLocation,
    pickupTime,
    arrangementNotes,
  ]);

  const collectValidationErrors = (opts?: { upToStep?: number }) => {
    const upToStep = opts?.upToStep ?? 4;
    const e: string[] = [];

    // Step 1 required fields
    if (upToStep >= 1) {
      if (!groupType) e.push('Group type is required.');
      if (!fromCountry) e.push('Country is required.');
      if (!toRegion) e.push('Destination region is required.');
      if (!toDistrict) e.push('Destination district is required.');

      // If Tanzania is selected, origin region is required
      if (isTanzaniaSelected && !fromRegion) e.push('Region is required when Tanzania is selected.');
    }

    // Step 2 required fields
    if (upToStep >= 2) {
      if (!accommodationType) e.push('Accommodation type is required.');
      if (accommodationType === 'hotel' && !hotelStarLabelToNumber(minHotelStarLabel)) e.push('Hotel rating is required when accommodation type is Hotel.');
      if (calculatedHeadcount < 1) e.push('Headcount must be at least 1. Please specify at least one person in the gender breakdown.');
      if (needsPrivateRoom && (!privateRoomCount || privateRoomCount < 1)) e.push('Please specify how many private rooms are needed.');
      if (useDates && (!checkInIso || !checkOutIso)) e.push('Please select check-in and check-out dates.');
      if (checkInIso && checkOutIso && new Date(checkInIso) >= new Date(checkOutIso)) e.push('Check-out must be after check-in.');
    }

    return e;
  };

  // Check if all required fields are filled
  const isFormComplete = () => {
    // Step 1: Required fields
    if (!groupType) return false;
    if (!fromCountry) return false;
    if (!toRegion) return false;
    if (!toDistrict) return false;
    
    // If Tanzania is selected, origin region is required
    if (isTanzaniaSelected && !fromRegion) return false;
    
    // Step 2: Accommodation type required
    if (!accommodationType) return false;

    // If Hotel is selected, rating is required
    if (accommodationType === 'hotel' && !hotelStarLabelToNumber(minHotelStarLabel)) return false;
    
    // Headcount must be at least 1 (default is 4, so this is usually satisfied)
    if (!headcount || headcount < 1) return false;
    
    // If private rooms are needed, count must be specified
    if (needsPrivateRoom && (!privateRoomCount || privateRoomCount < 1)) return false;
    
    // If using dates, both check-in and check-out must be selected
    if (useDates && (!checkInIso || !checkOutIso)) return false;
    
    return true;
  };

  const downloadTemplate = () => {
    const header = templateColumns.join(',') + '\n';
    const example = ['John','Doe','+255700000000','29','M','Tanzanian'].join(',') + '\n';
    const blob = new Blob([header, example], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'roster-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const parseCSV = (text: string) : Array<Array<string>> => {
    // Basic CSV parser supporting quoted fields
    const rows: Array<Array<string>> = [];
    const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
    for (const line of lines) {
      const row: string[] = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i+1] === '"') {
            cur += '"';
            i++; // skip escaped quote
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          row.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      row.push(cur);
      rows.push(row.map(r => r.trim()));
    }
    return rows;
  };

  const handleRosterFile = (file?: File) => {
    setRosterError('');
    setRosterFileName(file?.name ?? '');
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      try {
        const rows = parseCSV(text);
        if (!rows.length) {
          setRosterError('Empty CSV');
          return;
        }
        const headers = rows[0].map(h => h.replace(/\s+/g, '').toLowerCase());
        const data = rows.slice(1).map(r => {
          const obj: Record<string,string> = {};
          for (let i = 0; i < headers.length; i++) {
            obj[headers[i] || `col${i+1}`] = r[i] ?? '';
          }
          return obj;
        }).filter(d => Object.values(d).some(v => v && v.trim() !== ''));
        setRoster(data);
      } catch (e) {
        setRosterError('Failed to parse CSV');
      }
    };
    reader.readAsText(file);
  };


  const validate = () => {
    const e = collectValidationErrors();
    setErrors(e);
    return e.length === 0;
  };

  const validateUpToStep = (upToStep: number) => {
    const e = collectValidationErrors({ upToStep });
    setErrors(e);
    return e.length === 0;
  };

  const _handleCreate = async () => {
    if (!validate()) return;
    
    setIsCreating(true);
    setErrors([]);
    
    const payload = {
      groupType,
      fromCountry: fromCountry || null,
      fromRegion: isTanzaniaSelected ? fromRegion : null,
      fromDistrict: isTanzaniaSelected ? fromDistrict : null,
      fromWard: isTanzaniaSelected ? fromWard : null,
      fromLocation: isTanzaniaSelected ? fromLocation : null,
      toRegion,
      toDistrict,
      toWard,
      toLocation,
      accommodationType,
      minHotelStarLabel: accommodationType === 'hotel' ? (minHotelStarLabel || null) : null,
      headcount: calculatedHeadcount,
      maleCount: maleCount > 0 ? maleCount : null,
      femaleCount: femaleCount > 0 ? femaleCount : null,
      otherCount: otherCount > 0 ? otherCount : null,
      needsPrivateRoom,
      privateRoomCount,
      checkin: useDates ? isoDateToApiDateTime(checkInIso) : null,
      checkout: useDates ? isoDateToApiDateTime(checkOutIso) : null,
      useDates,
      roomSize,
      roomsNeeded,
      arrangements: {
        pickup: arrPickup,
        transport: arrTransport,
        meals: arrMeals,
        guide: arrGuide,
        equipment: arrEquipment,
        pickupLocation: pickupLocation || null,
        pickupTime: pickupTime ? formatTimeTo12(pickupTime) : null,
        notes: arrangementNotes || null,
      },
      roster,
    };
    
    try {
      // Make API request to create group booking
      const response = await fetch(`/api/group-bookings`, {
        method: 'POST',
        credentials: "include",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      // Parse response
      const data = await response.json();
      
      // Handle error responses
      if (!response.ok) {
        if (response.status === 401) {
          // Creating a group stay requires a signed-in customer (the booking is
          // tied to a user). Route to login and return to this form afterwards;
          // steps 1–2 are autosaved as a draft, so little is lost.
          if (typeof window !== 'undefined') {
            window.location.href = `/account/login?next=${encodeURIComponent('/public/group-stays')}`;
            return;
          }
          throw new Error('Please sign in to submit your group stay request.');
        } else if (response.status === 400 && data.details) {
          // Handle validation errors
          const validationErrors = data.details.map((err: any) => 
            `${err.field}: ${err.message}`
          );
          setErrors(validationErrors);
          return;
        } else {
          throw new Error(data.error || data.message || 'Failed to create group booking');
        }
      }
      
      // Success handling
      // eslint-disable-next-line no-console
      console.log('Group booking created successfully:', {
        bookingId: data.bookingId,
        status: data.booking?.status,
        destination: data.booking?.destination,
      });

      // Clear saved draft on successful submit
      try { localStorage.removeItem(DRAFT_KEY); } catch {}
      setHasSavedDraft(false);
      
      // Show success message
      setShowSuccess(true);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to create group booking:', error);
      
      // Display error message to user
      const errorMessage = error instanceof Error ? error.message : 'Failed to create group booking. Please try again.';
      setErrors([errorMessage]);
    } finally {
      setIsCreating(false);
    }
  };


  const recommendRoomSize = (type: string, count: number) => {
    // Simple heuristics for recommendations
    const c = Math.max(0, Number(count) || 0);
    // if accommodation is dorm-style prefer larger rooms
    if (accommodationType === 'dorm' || accommodationType === 'hostel') {
      if (c >= 40) return 6;
      if (c >= 20) return 4;
      return 3;
    }
    switch (type) {
      case 'students':
        if (c >= 40) return 4;
        if (c >= 12) return 3;
        return 2;
      case 'workers':
        if (c >= 20) return 4;
        if (c >= 8) return 3;
        return 2;
      case 'family':
        return 2;
      case 'event':
        if (c >= 50) return 4;
        if (c >= 20) return 3;
        return 2;
      default:
        return 2;
    }
  };

  /* RecommendationBadge removed per request: no automatic recommendations shown */

  const formatTimeTo12 = (t?: string) => {
    if (!t) return '';
    // t expected in "HH:MM" (24-hour) format from input[type=time]
    const [hh, mm] = t.split(':');
    const H = Number(hh || '0');
    const M = mm || '00';
    const meridiem = H >= 12 ? 'PM' : 'AM';
    const hour12 = H % 12 === 0 ? 12 : H % 12;
    return `${String(hour12).padStart(2, '0')}:${M} ${meridiem}`;
  };
  const formatDateSummary = () => {
    if (!useDates) return 'Not specified';
    if (!checkInIso && !checkOutIso) return 'Select dates';
    const from = checkInIso ? new Date(checkInIso) : null;
    const to = checkOutIso ? new Date(checkOutIso) : null;
    const formatDateShort = (d?: Date | null) => d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d) : '—';
    const f = formatDateShort(from);
    const t = to ? formatDateShort(to) : 'Any';
    if (from && to) {
      const nights = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
      const nightsLabel = nights === 1 ? '1 night' : `${nights} nights`;
      return `${f} to ${t} · ${nightsLabel}`;
    }
    return `${f} to ${t}`;
  };

  // Show success screen if booking was created successfully
  if (showSuccess) {
    return (
      <section ref={successRef} className="mt-4" aria-labelledby="group-stays-success">
        <div className="public-container">
          <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 shadow-sm">
            <style dangerouslySetInnerHTML={{ __html: `
              @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
              }
              @keyframes scaleIn {
                from { opacity: 0; transform: scale(0.8); }
                to { opacity: 1; transform: scale(1); }
              }
              @keyframes slideUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
              }
              .success-fade-in { animation: fadeIn 0.5s ease-out; }
              .success-scale-in { animation: scaleIn 0.6s ease-out; }
              .success-slide-up { animation: slideUp 0.6s ease-out 0.2s both; }
              .success-slide-up-delayed { animation: slideUp 0.6s ease-out 0.4s both; }
              .success-fade-in-delayed { animation: fadeIn 0.5s ease-out 0.6s both; }
            `}} />
            <div className="max-w-2xl mx-auto text-center space-y-6">
              {/* Animated success icon */}
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg success-scale-in">
                  <CheckCircle className="h-10 w-10 text-white transition-all duration-300" strokeWidth={2.5} />
                </div>
              </div>
              
              {/* Heading and description with slide-up animation */}
              <div className="space-y-3 success-slide-up">
                <h2 id="group-stays-success" className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                  Thank you for your group stay request
                </h2>
                <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
                  Eligible property owners in your destination can now bid for your stay with their best price.
                  NoLSAF shortlists the most reliable offers so you can compare and pick the one that excites you most.
                  Follow updates from My Group Stays.
                </p>
              </div>

              {/* Button with hover and transition effects */}
              <div className="pt-4 success-slide-up-delayed">
                <Link
                  href="/account/group-stays"
                  className="inline-flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-6 py-3 rounded-xl shadow-md hover:shadow-lg transition-all duration-300 active:scale-[0.98] no-underline group"
                  onClick={() => {
                    if (onCloseAction) onCloseAction();
                  }}
                >
                  <span>View My Group Stays</span>
                  <ArrowRight className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1" />
                </Link>
              </div>

              {/* Footer note */}
              <p className="text-sm text-slate-500 pt-2 success-fade-in-delayed">
                You can track your booking status and view all your group stays in your account.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-4" aria-labelledby="group-stays-heading">
      <div className="public-container">

        {/* -- Coming-Soon Gate -- */}
        <ComingSoonGate
          enabled={GATE_ENABLED}
          open={showComingSoon}
          onClose={() => setShowComingSoon(false)}
          serviceName="Group Stays"
          launchDate={GATE_LAUNCH_DATE}
        />

        {/* Premium Hero Header */}
        <div className="relative overflow-hidden rounded-2xl mb-6 shadow-[0_4px_32px_rgba(2,102,94,0.18)]"
          style={{ background: "linear-gradient(135deg, #02665e 0%, #034d47 60%, #023a35 100%)" }}>
          {/* Decorative background blobs */}
          <div className="pointer-events-none absolute inset-0">
            <div className="absolute -top-10 -right-10 h-48 w-48 rounded-full opacity-10"
              style={{ background: "radial-gradient(circle, #ffffff, transparent 70%)" }} />
            <div className="absolute -bottom-8 -left-8 h-40 w-40 rounded-full opacity-10"
              style={{ background: "radial-gradient(circle, #ffffff, transparent 70%)" }} />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-64 w-64 rounded-full opacity-5"
              style={{ background: "radial-gradient(circle, #7fffd4, transparent 70%)" }} />
          </div>

          <div className="relative px-6 py-8 sm:py-10 sm:px-10">
            {/* Return to public site — top right */}
            <div className="absolute top-4 right-4 sm:top-5 sm:right-6">
              <Link
                href="/public"
                onClick={() => { if (onCloseAction) onCloseAction(); }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white/70 hover:text-white hover:bg-white/10 transition-all duration-200 no-underline group"
              >
                <ArrowLeft className="w-3.5 h-3.5 group-hover:-translate-x-0.5 transition-transform" />
                <span>Return to public site</span>
              </Link>
            </div>

            {/* Icon + Title */}
            <div className="flex flex-col items-center text-center gap-4">
              {/* Glowing icon */}
              <div className="relative">
                <div className="absolute inset-0 rounded-2xl blur-lg scale-125 opacity-40"
                  style={{ background: "rgba(255,255,255,0.3)" }} />
                <div className="relative h-16 w-16 rounded-2xl flex items-center justify-center shadow-xl border border-white/20"
                  style={{ background: "rgba(255,255,255,0.15)", backdropFilter: "blur(8px)" }}>
                  <Users className="w-8 h-8 text-white drop-shadow-md" aria-hidden />
                </div>
              </div>

              <div>
                <h3 id="group-stays-heading"
                  className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight drop-shadow-md">
                  Request a group stay
                </h3>
                <p className="mt-2 text-sm sm:text-base text-white/70 font-medium max-w-md mx-auto leading-relaxed">
                  Share your group&apos;s details and let property owners bid for your stay with their best price. You pick the offer that excites you most.
                </p>
              </div>

              {/* Decorative divider */}
              <div className="flex items-center gap-2 mt-1">
                <div className="h-px w-10 rounded-full bg-white/30" />
                <div className="h-1.5 w-1.5 rounded-full bg-white/50" />
                <div className="h-px w-10 rounded-full bg-white/30" />
              </div>
            </div>
          </div>
        </div>

        <article className="rounded-xl border bg-gradient-to-b from-white via-slate-50 to-white p-6 shadow-lg">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
              </div>
            </div>
            <div className="ml-4">
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Stepper header */}
            <div className="sm:col-span-2">
              <div className="mb-3">
                <nav className="flex items-center justify-center gap-0">
                  {[1,2,3,4].map((s, i) => {
                    const done   = currentStep > s;
                    const active = currentStep === s;
                    return (
                      <div key={s} className="flex items-center">
                        {/* Step node */}
                        <div className="flex flex-col items-center">
                          <button
                            type="button"
                            onClick={() => {
                              if (s <= currentStep) { setErrors([]); setCurrentStep(s); return; }
                              const ok = validateUpToStep(s - 1);
                              if (ok) { setErrors([]); setCurrentStep(s); }
                            }}
                            aria-current={active ? 'step' : undefined}
                            aria-label={`Step ${s}`}
                            className={[
                              "flex items-center justify-center w-9 h-9 sm:w-11 sm:h-11 rounded-full text-xs sm:text-sm font-bold transition-all duration-300 focus:outline-none",
                              active
                                ? "bg-[#02665e] text-white shadow-[0_0_0_4px_rgba(2,102,94,0.18)] scale-110 border-2 border-[#02665e]"
                                : done
                                  ? "bg-white text-[#02665e] border-2 border-[#02665e]"
                                  : "bg-white text-slate-400 border-2 border-slate-200 hover:border-[#02665e]/40 hover:text-[#02665e]/60",
                            ].join(" ")}
                          >
                            {s}
                          </button>
                          <span className={[
                            "hidden sm:block mt-1.5 text-xs font-medium tracking-wide transition-colors duration-200",
                            active ? "text-[#02665e]" : done ? "text-[#02665e]/60" : "text-slate-400",
                          ].join(" ")}>
                            {s === 1 ? 'Details' : s === 2 ? 'Accommodation' : s === 3 ? 'Roster' : 'Review'}
                          </span>
                        </div>
                        {/* Connector */}
                        {i < 3 && (
                          <div className="relative mb-4 mx-1.5 sm:mx-2.5 h-0.5 w-8 sm:w-14 rounded-full bg-slate-200 overflow-hidden">
                            <div
                              className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                              style={{ width: done ? '100%' : '0%', background: 'linear-gradient(90deg,#02665e,#059669)' }}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </nav>
                <div className="mt-2 mx-auto max-w-xs h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: currentStep === 1 ? '0%' : currentStep === 2 ? '33%' : currentStep === 3 ? '66%' : '100%',
                      background: 'linear-gradient(90deg,#02665e,#059669)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Step content */}
            <div className="sm:col-span-2">
              <div key={currentStep} className="stepContentTransition">
              {currentStep === 1 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* How it works — bid-model explainer (parity with the app).
                      Compact chip; the panel opens only when tapped. */}
                  <div className="sm:col-span-2">
                    <button
                      type="button"
                      onClick={() => setShowHowItWorks((v) => !v)}
                      aria-expanded={showHowItWorks}
                      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 shadow-sm transition-colors hover:bg-emerald-100"
                    >
                      <Info className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                      How it works
                      <ChevronDown
                        className={`h-3.5 w-3.5 text-emerald-600 transition-transform ${showHowItWorks ? 'rotate-180' : ''}`}
                        aria-hidden
                      />
                    </button>

                    <div
                      className={`grid transition-all duration-300 ease-in-out ${showHowItWorks ? 'grid-rows-[1fr] opacity-100 mt-2' : 'grid-rows-[0fr] opacity-0'}`}
                    >
                      <div className="overflow-hidden">
                        <div className="rounded-2xl border border-emerald-100 bg-gradient-to-b from-emerald-50/80 to-white p-4 shadow-sm space-y-3.5">
                          {[
                            { Icon: Megaphone, text: "You post your group's trip details. No payment is needed to submit a request." },
                            { Icon: MapPin, text: "Only property owners in your chosen destination area see your request and can bid." },
                            { Icon: ShieldCheck, text: "NoLSAF screens every interested owner and shortlists only the best, most reliable offers for you." },
                            { Icon: Gavel, text: "Owners compete with their best price. You compare offers and pick the one that excites you most." },
                            { Icon: CheckCircle2, text: "To confirm your pick, pay a small non-refundable deposit. The remaining balance is settled on check-in day." },
                          ].map(({ Icon, text }, i) => (
                            <div key={i} className="flex items-start gap-3">
                              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100/70">
                                <Icon className="h-4 w-4 text-emerald-600" aria-hidden />
                              </span>
                              <p className="text-xs text-slate-600 leading-relaxed pt-1">{text}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <div className="text-slate-500">
                        {draftNotice ? (
                          <span className="text-emerald-700">{draftNotice}</span>
                        ) : (
                          <span>Saved automatically (Steps 1–2)</span>
                        )}
                      </div>
                      {hasSavedDraft ? (
                        <button
                          type="button"
                          onClick={clearSavedDraft}
                          aria-label="Clear saved draft"
                          title="Clear saved draft"
                          className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-slate-200 bg-white text-slate-600 hover:text-slate-900 hover:bg-slate-50"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white p-4 border border-slate-100 shadow-sm transform transition hover:-translate-y-0.5 hover:shadow-lg">
                    <label htmlFor="group-type" className="block text-sm font-medium text-slate-700">Group type <span className="text-red-500">*</span></label>
                    <p className="text-xs text-slate-500 mt-1">Select the group type. Students option added for school groups.</p>
                    <div className="mt-3">
                      <div className="relative">
                        <select id="group-type" name="groupType" value={groupType} onChange={(e) => setGroupType(e.target.value)} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9">
                          <option value="">Select</option>
                          <option value="family">Family</option>
                          <option value="workers">Workers</option>
                          <option value="event">Event</option>
                          <option value="students">Students</option>
                          <option value="team">Team</option>
                          <option value="safari_stay">Safari Stay</option>
                          <option value="other">Other</option>
                        </select>
                        <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                      </div>
                    </div>

                    <div className="mt-3">
                      <div>
                        <label htmlFor="from-country" className="block text-xs text-slate-600 mb-1">Country <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <select 
                            id="from-country" 
                            value={fromCountry} 
                            onChange={(e) => { 
                              const newCountry = e.target.value;
                              setFromCountry(newCountry);
                              // Clear region/district/ward/street if not Tanzania
                              if (newCountry !== 'tanzania') {
                                setFromRegion('');
                                setFromDistrict('');
                                setFromWard('');
                                setFromLocation('');
                              }
                            }} 
                            className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9"
                          >
                            <option value="">Select country</option>
                            {COUNTRIES.map((country) => (
                              <option key={country.value} value={country.value}>{country.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>
                    </div>

                    {isTanzaniaSelected && (
                      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label htmlFor="from-region" className="block text-xs text-slate-600">
                            Region <span className="text-red-500">*</span>
                          </label>
                          <div className="relative">
                            <select id="from-region" value={fromRegion} onChange={(e) => { setFromRegion(e.target.value); setFromDistrict(''); setFromWard(''); setFromLocation(''); }} required className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9">
                              <option value="">Select region</option>
                              {REGION_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                            </select>
                            <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="from-district" className="block text-xs text-slate-600">District</label>
                          <div className="relative">
                            <select id="from-district" value={fromDistrict} onChange={(e) => { setFromDistrict(e.target.value); setFromWard(''); setFromLocation(''); }} disabled={!fromRegion} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                              <option value="">Select district</option>
                              {getDistrictsFor(fromRegion).map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="from-ward" className="block text-xs text-slate-600">Ward</label>
                          <div className="relative">
                            <select id="from-ward" value={fromWard} onChange={(e) => { setFromWard(e.target.value); setFromLocation(''); }} disabled={!fromDistrict} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                              <option value="">Select ward</option>
                              {getWardsFor(fromRegion, fromDistrict).map((ward) => (
                                <option key={ward.name} value={ward.name}>{ward.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="from-location" className="block text-xs text-slate-600">Street</label>
                          <div className="relative">
                            {getStreetsFor(fromRegion, fromDistrict, fromWard).length === 0 && fromWard ? (
                              <input
                                id="from-location"
                                type="text"
                                value={fromLocation}
                                onChange={(e) => setFromLocation(e.target.value)}
                                placeholder="e.g. Forodhani"
                                className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                              />
                            ) : (
                              <>
                                <select id="from-location" value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} disabled={!fromWard} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                                  <option value="">Select street</option>
                                  {getStreetsFor(fromRegion, fromDistrict, fromWard).map((street) => (
                                    <option key={street} value={street}>{street}</option>
                                  ))}
                                </select>
                                <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg bg-white p-4 border border-slate-100 shadow-sm transform transition hover:-translate-y-0.5 hover:shadow-lg">
                    <div>
                      <label htmlFor="to-region" className="block text-sm font-medium text-slate-700">Where are you going? <span className="text-red-500">*</span></label>
                      <p className="text-xs text-slate-500 mt-1">Region, district, ward and exact location</p>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="to-region" className="block text-xs text-slate-600">Region <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <select id="to-region" value={toRegion} onChange={(e) => { setToRegion(e.target.value); setToDistrict(''); setToWard(''); setToLocation(''); }} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9">
                            <option value="">Select region</option>
                            {REGION_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="to-district" className="block text-xs text-slate-600">District <span className="text-red-500">*</span></label>
                        <div className="relative">
                          <select id="to-district" value={toDistrict} onChange={(e) => { setToDistrict(e.target.value); setToWard(''); setToLocation(''); }} disabled={!toRegion} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                            <option value="">Select district</option>
                            {getDistrictsFor(toRegion).map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="to-ward" className="block text-xs text-slate-600">Ward</label>
                        <div className="relative">
                          <select id="to-ward" value={toWard} onChange={(e) => { setToWard(e.target.value); setToLocation(''); }} disabled={!toDistrict} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                            <option value="">Select ward</option>
                            {getWardsFor(toRegion, toDistrict).map((ward) => (
                              <option key={ward.name} value={ward.name}>{ward.name}</option>
                            ))}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="to-location" className="block text-xs text-slate-600">Street</label>
                        <div className="relative">
                          {getStreetsFor(toRegion, toDistrict, toWard).length === 0 && toWard ? (
                            <input
                              id="to-location"
                              type="text"
                              value={toLocation}
                              onChange={(e) => setToLocation(e.target.value)}
                              placeholder="e.g. Forodhani"
                              className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200"
                            />
                          ) : (
                            <>
                              <select id="to-location" value={toLocation} onChange={(e) => setToLocation(e.target.value)} disabled={!toWard} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                                <option value="">Select street</option>
                                {getStreetsFor(toRegion, toDistrict, toWard).map((street) => (
                                  <option key={street} value={street}>{street}</option>
                                ))}
                              </select>
                              <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Accommodation, headcount and private-room controls moved to Step 2 */}
                </div>
              )}

              {currentStep === 2 && (
                <div>
                  <div className="mb-4 flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-[#02665e]/5 border border-[#02665e]/10">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-1.5 rounded-full bg-[#02665e] animate-pulse flex-shrink-0" />
                      <span className="text-xs font-medium text-[#02665e]">
                        {draftNotice ? draftNotice : 'Saved automatically (Steps 1–2)'}
                      </span>
                    </div>
                    {hasSavedDraft ? (
                      <button
                        type="button"
                        onClick={clearSavedDraft}
                        aria-label="Clear saved draft"
                        title="Clear saved draft"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md border border-[#02665e]/20 bg-white text-slate-400 hover:text-red-500 hover:border-red-200 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  {/* Accommodation, headcount and private-room controls moved to top of Step 2 */}
                  <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 mb-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-3 pb-2.5 border-b border-[#02665e]/10">
                      <div className="h-2 w-2 rounded-full bg-[#02665e] ring-[3px] ring-[#02665e]/15 flex-shrink-0" aria-hidden />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Accommodation</div>
                        <div className="text-xs text-slate-500">Choose style so we can recommend room sizes</div>
                      </div>
                    </div>
                    <div className="relative">
                      <label htmlFor="accommodation-type" className="sr-only">Accommodation type</label>
                        <select
                          id="accommodation-type"
                          value={accommodationType}
                          onChange={(e) => {
                            const next = e.target.value;
                            setAccommodationType(next);
                            if (next !== 'hotel') setMinHotelStarLabel('');
                          }}
                          className="groupstays-select mt-1 w-full rounded px-2 py-1 border appearance-none pr-9"
                        >
                        <option value="">Select</option>
                        <option value="villa">Villa</option>
                        <option value="apartment">Apartment</option>
                        <option value="hotel">Hotel</option>
                        <option value="hostel">Hostel</option>
                        <option value="lodge">Lodge</option>
                        <option value="condo">Condo</option>
                        <option value="guest_house">Guest House</option>
                        <option value="bungalow">Bungalow</option>
                        <option value="cabin">Cabin</option>
                        <option value="homestay">Homestay</option>
                        <option value="townhouse">Townhouse</option>
                        <option value="house">House</option>
                        <option value="other">Other</option>
                      </select>
                      <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Choose the accommodation style so we can recommend room sizes.</p>

                    {accommodationType === 'hotel' ? (
                      <div className="mt-3">
                        <label htmlFor="hotel-rating" className="block text-xs text-slate-600 mb-1">Hotel rating</label>
                        <div className="relative">
                          <select
                            id="hotel-rating"
                            value={minHotelStarLabel}
                            onChange={(e) => setMinHotelStarLabel(e.target.value)}
                            className="groupstays-select mt-1 w-full rounded px-2 py-1 border appearance-none pr-9"
                          >
                            {HOTEL_STAR_OPTIONS.map((o) => (
                              <option key={o.value} value={o.value}>{o.label}</option>
                            ))}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                        <p className="mt-2 text-xs text-slate-500">Required when you select Hotel.</p>
                      </div>
                    ) : null}
                  </div>

                  <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 mb-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-3 pb-2.5 border-b border-[#02665e]/10">
                      <div className="h-2 w-2 rounded-full bg-[#02665e] ring-[3px] ring-[#02665e]/15 flex-shrink-0" aria-hidden />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Headcount</div>
                        <div className="text-xs text-slate-500">Number of people in your group (separated by gender)</div>
                      </div>
                    </div>
                    {/* Gender-based headcount breakdown */}
                    <div className="mt-3 space-y-3">
                      <div className="grid grid-cols-3 gap-3">
                        <div className="rounded-lg bg-sky-50/60 border border-sky-100 p-2.5 text-center">
                          <label htmlFor="male-count" className="block text-xs font-semibold text-sky-700 mb-1.5">Male</label>
                          <input 
                            id="male-count" 
                            name="maleCount" 
                            value={maleCount} 
                            onChange={(e) => setMaleCount(Math.max(0, Number(e.target.value || 0)))} 
                            type="number" 
                            min={0} 
                            aria-label="Number of males" 
                            placeholder="0" 
                            className="w-full rounded-md px-2 py-1.5 border border-sky-200 text-sm text-center font-bold text-sky-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-200" 
                          />
                        </div>
                        <div className="rounded-lg bg-pink-50/60 border border-pink-100 p-2.5 text-center">
                          <label htmlFor="female-count" className="block text-xs font-semibold text-pink-700 mb-1.5">Female</label>
                          <input 
                            id="female-count" 
                            name="femaleCount" 
                            value={femaleCount} 
                            onChange={(e) => setFemaleCount(Math.max(0, Number(e.target.value || 0)))} 
                            type="number" 
                            min={0} 
                            aria-label="Number of females" 
                            placeholder="0" 
                            className="w-full rounded-md px-2 py-1.5 border border-pink-200 text-sm text-center font-bold text-pink-800 bg-white focus:outline-none focus:ring-2 focus:ring-pink-200" 
                          />
                        </div>
                        <div className="rounded-lg bg-slate-50/80 border border-slate-200 p-2.5 text-center">
                          <label htmlFor="other-count" className="block text-xs font-semibold text-slate-600 mb-1.5">Other</label>
                          <input 
                            id="other-count" 
                            name="otherCount" 
                            value={otherCount} 
                            onChange={(e) => setOtherCount(Math.max(0, Number(e.target.value || 0)))} 
                            type="number" 
                            min={0} 
                            aria-label="Number of other" 
                            placeholder="0" 
                            className="w-full rounded-md px-2 py-1.5 border border-slate-200 text-sm text-center font-bold text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-slate-200" 
                          />
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                        <span className="text-xs font-medium text-slate-700">Total Headcount:</span>
                        <span className="text-sm font-bold text-emerald-600">{calculatedHeadcount} {calculatedHeadcount === 1 ? 'person' : 'people'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 mb-4 shadow-sm">
                    {/* Header */}
                    <div className="flex items-start gap-3 pb-3 mb-4 border-b border-[#02665e]/10">
                      <div className="h-2 w-2 rounded-full bg-[#02665e] ring-[3px] ring-[#02665e]/15 flex-shrink-0 mt-1.5" aria-hidden />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Private rooms</div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                          Some guests prefer their own room. If any members of your group need privacy, tell us how many private rooms to reserve.
                        </p>
                      </div>
                    </div>

                    {/* Two option cards side by side */}
                    <div role="group" aria-label="Private room options" className="grid grid-cols-2 gap-3">
                      {/* Yes card */}
                      <button
                        type="button"
                        onClick={() => setNeedsPrivateRoom(true)}
                        aria-pressed={needsPrivateRoom}
                        className={[
                          "relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none overflow-hidden",
                          needsPrivateRoom
                            ? "border-[#02665e] bg-[#02665e] shadow-lg shadow-[#02665e]/20"
                            : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:shadow-md",
                        ].join(" ")}
                      >
                        {needsPrivateRoom && (
                          <div className="absolute top-2 right-2">
                            <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center">
                              <Check className="w-3 h-3 text-white stroke-[3]" />
                            </div>
                          </div>
                        )}
                        <div className={["h-9 w-9 rounded-lg flex items-center justify-center", needsPrivateRoom ? "bg-white/20" : "bg-[#02665e]/10"].join(" ")}>
                          <Lock className={["w-4 h-4", needsPrivateRoom ? "text-white" : "text-[#02665e]"].join(" ")} />
                        </div>
                        <div>
                          <p className={["text-sm font-bold", needsPrivateRoom ? "text-white" : "text-slate-800"].join(" ")}>Yes</p>
                          <p className={["text-xs mt-0.5 leading-tight", needsPrivateRoom ? "text-white/75" : "text-slate-500"].join(" ")}>Reserve private rooms for some guests</p>
                        </div>
                      </button>

                      {/* No card */}
                      <button
                        type="button"
                        onClick={() => { setNeedsPrivateRoom(false); setPrivateRoomCount(0); }}
                        aria-pressed={!needsPrivateRoom}
                        className={[
                          "relative flex flex-col items-start gap-2 rounded-xl border-2 p-4 text-left transition-all duration-200 focus:outline-none overflow-hidden",
                          !needsPrivateRoom
                            ? "border-[#02665e] bg-[#02665e] shadow-lg shadow-[#02665e]/20"
                            : "border-slate-200 bg-white hover:border-[#02665e]/40 hover:shadow-md",
                        ].join(" ")}
                      >
                        {!needsPrivateRoom && (
                          <div className="absolute top-2 right-2">
                            <div className="h-5 w-5 rounded-full bg-white/20 flex items-center justify-center">
                              <Check className="w-3 h-3 text-white stroke-[3]" />
                            </div>
                          </div>
                        )}
                        <div className={["h-9 w-9 rounded-lg flex items-center justify-center", !needsPrivateRoom ? "bg-white/20" : "bg-slate-100"].join(" ")}>
                          <DoorOpen className={["w-4 h-4", !needsPrivateRoom ? "text-white" : "text-slate-500"].join(" ")} />
                        </div>
                        <div>
                          <p className={["text-sm font-bold", !needsPrivateRoom ? "text-white" : "text-slate-800"].join(" ")}>No</p>
                          <p className={["text-xs mt-0.5 leading-tight", !needsPrivateRoom ? "text-white/75" : "text-slate-500"].join(" ")}>Shared rooms are fine for everyone</p>
                        </div>
                      </button>
                    </div>

                    {/* How many counter — shown only when Yes */}
                    {needsPrivateRoom && (
                      <div className="mt-4 pt-4 border-t border-[#02665e]/10">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-slate-800">How many private rooms?</p>
                            <p className="text-xs text-slate-500 mt-0.5">We'll guarantee this number in your quote.</p>
                          </div>
                          <div className="flex items-center gap-1 bg-slate-50 border border-slate-200 rounded-xl p-1">
                            <button
                              type="button"
                              onClick={() => setPrivateRoomCount((c) => Math.max(1, c - 1))}
                              className="h-8 w-8 rounded-lg bg-white border border-slate-200 text-slate-600 text-base font-bold hover:border-[#02665e]/40 hover:text-[#02665e] transition-colors flex items-center justify-center focus:outline-none shadow-sm"
                              aria-label="Decrease private room count"
                            >-</button>
                            <span className="w-10 text-center text-base font-extrabold text-[#02665e]">{privateRoomCount || 1}</span>
                            <button
                              type="button"
                              onClick={() => setPrivateRoomCount((c) => (c || 0) + 1)}
                              className="h-8 w-8 rounded-lg bg-white border border-slate-200 text-slate-600 text-base font-bold hover:border-[#02665e]/40 hover:text-[#02665e] transition-colors flex items-center justify-center focus:outline-none shadow-sm"
                              aria-label="Increase private room count"
                            >+</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 mb-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-3 pb-2.5 border-b border-[#02665e]/10">
                      <div className="h-2 w-2 rounded-full bg-[#02665e] ring-[3px] ring-[#02665e]/15 flex-shrink-0" aria-hidden />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Room configuration</div>
                        <div className="text-xs text-slate-500">Persons per room and estimated rooms needed</div>
                      </div>
                    </div>
                    <div>
                      <label htmlFor="room-size" className="block text-xs text-slate-600">Room size (persons per room)</label>
                      <div className="relative">
                        <select id="room-size" value={roomSize} onChange={(e) => setRoomSize(Number(e.target.value))} className="groupstays-select mt-1 w-full rounded px-2 py-1 border appearance-none pr-9">
                          <option value={1}>1</option>
                          <option value={2}>2</option>
                          <option value={3}>3</option>
                          <option value={4}>4</option>
                        </select>
                        <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                      </div>
                      <div className="mt-2 text-sm text-slate-600">Estimated rooms needed: <span className="font-medium">{roomsNeeded}</span></div>
                      <div className="mt-1 text-xs text-slate-500">Suggested room size: <span className="font-medium">{recommendRoomSize(groupType, headcount)}</span></div>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 mb-4 shadow-sm">
                    <div className="flex items-center gap-3 mb-3 pb-2.5 border-b border-[#02665e]/10">
                      <div className="h-2 w-2 rounded-full bg-[#02665e] ring-[3px] ring-[#02665e]/15 flex-shrink-0" aria-hidden />
                      <div>
                        <div className="text-sm font-semibold text-slate-800">Dates</div>
                        <div className="text-xs text-slate-500">Select check-in and check-out (nights shown when both set)</div>
                      </div>
                    </div>
                    <div className="mt-2">
                      {!useDates ? (
                        <div className="flex flex-col items-center gap-3 py-3">
                          <div className="flex items-center justify-center h-11 w-11 rounded-full bg-[#02665e]/10">
                            <Calendar className="w-5 h-5 text-[#02665e]" />
                          </div>
                          <p className="text-xs text-slate-500 text-center">No dates selected. Add them to help us plan your stay.</p>
                          <button
                            type="button"
                            onClick={() => setUseDates(true)}
                            className="px-5 py-2 rounded-lg border-2 border-[#02665e] bg-white text-sm font-semibold text-[#02665e] hover:bg-[#02665e] hover:text-white transition-all duration-200 shadow-sm"
                          >
                            + Add dates
                          </button>
                        </div>
                      ) : (
                        <div className="w-full">
                          <div className="grid grid-cols-2 gap-3">
                            {/* Check-in */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setCheckInPickerOpen(true)}
                                className={[
                                  "w-full text-left rounded-xl px-4 py-3 border-2 bg-white transition-all duration-200 group",
                                  checkInIso ? "border-[#02665e]/30 shadow-sm" : "border-slate-200 hover:border-[#02665e]/40",
                                ].join(" ")}
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#02665e]/70 mb-0.5">Check-in</div>
                                <div className={["text-base font-bold", checkInIso ? "text-slate-800" : "text-slate-400"].join(" ")}>
                                  {checkInIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(checkInIso)) : '—'}
                                </div>
                              </button>
                              {checkInPickerOpen && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setCheckInPickerOpen(false)} />
                                  <div className="absolute left-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)]">
                                    <DatePicker
                                      selected={checkInIso || undefined}
                                      onSelectAction={(s) => {
                                        const date = Array.isArray(s) ? s[0] : s;
                                        if (date) {
                                          setCheckInIso(date);
                                          if (checkOutIso && new Date(checkOutIso) <= new Date(date)) setCheckOutIso('');
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

                            {/* Check-out */}
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setCheckOutPickerOpen(true)}
                                disabled={!checkInIso}
                                className={[
                                  "w-full text-left rounded-xl px-4 py-3 border-2 bg-white transition-all duration-200",
                                  checkOutIso ? "border-[#02665e]/30 shadow-sm" : "border-slate-200 hover:border-[#02665e]/40",
                                  !checkInIso ? "opacity-40 cursor-not-allowed" : "",
                                ].join(" ")}
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#02665e]/70 mb-0.5">Check-out</div>
                                <div className={["text-base font-bold", checkOutIso ? "text-slate-800" : "text-slate-400"].join(" ")}>
                                  {checkOutIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(checkOutIso)) : '—'}
                                </div>
                              </button>
                              {checkOutPickerOpen && (
                                <>
                                  <div className="fixed inset-0 z-40" onClick={() => setCheckOutPickerOpen(false)} />
                                  <div className="absolute right-0 top-full z-50 mt-2 max-w-[calc(100vw-2rem)]">
                                    <DatePicker
                                      selected={checkOutIso || undefined}
                                      onSelectAction={(s) => {
                                        const date = Array.isArray(s) ? s[0] : s;
                                        if (date) setCheckOutIso(date);
                                        setCheckOutPickerOpen(false);
                                      }}
                                      onCloseAction={() => setCheckOutPickerOpen(false)}
                                      allowRange={false}
                                      minDate={checkInIso ? addDaysIso(checkInIso, 1) : undefined}
                                    />
                                  </div>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Summary pill + remove */}
                          <div className="mt-3 flex items-center justify-between gap-2">
                            {checkInIso && checkOutIso ? (
                              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#02665e]/8 border border-[#02665e]/15 text-xs font-medium text-[#02665e]">
                                <Calendar className="w-3.5 h-3.5" />
                                <span>{formatDateSummary()}</span>
                              </div>
                            ) : (
                              <span className="text-xs text-slate-400">Select both dates</span>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setUseDates(false);
                                setCheckInIso('');
                                setCheckOutIso('');
                                setCheckInPickerOpen(false);
                                setCheckOutPickerOpen(false);
                              }}
                              className="text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors"
                            >
                              Remove dates
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                    {/* Arrangements: group-level options for Step 2 */}
                    <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 mb-4 shadow-sm">
                      {/* Header with explanation */}
                      <div className="flex items-start gap-3 pb-3 mb-3 border-b border-[#02665e]/10">
                        <div className="h-2 w-2 rounded-full bg-[#02665e] ring-[3px] ring-[#02665e]/15 flex-shrink-0 mt-1.5" aria-hidden />
                        <div>
                          <div className="text-sm font-semibold text-slate-800">Add-on Arrangements</div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                            These are <span className="font-medium text-slate-700">optional extras</span> we can coordinate for your group, such as airport transfers, meals, a local guide, or equipment hire. Select everything you need so we can include it in your quote.
                          </p>
                        </div>
                      </div>

                      {/* Selected count pill */}
                      {[arrPickup, arrTransport, arrMeals, arrGuide, arrEquipment].filter(Boolean).length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {([['Pickup', arrPickup], ['Transport', arrTransport], ['Meals', arrMeals], ['Guide', arrGuide], ['Equipment', arrEquipment]] as [string, boolean][]).filter(s => s[1]).map((s) => (
                            <span key={s[0]} className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#02665e]/10 text-[#02665e] border border-[#02665e]/15">
                              <Check className="w-3 h-3 stroke-[2.5]" />{s[0]}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Toggle buttons grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {([
                          { key: 'pickup',    label: 'Airport pick-up',        desc: 'We arrange your airport transfer',   icon: <Truck className="w-4 h-4" />,  val: arrPickup,    set: setArrPickup },
                          { key: 'transport', label: 'Transport between sites', desc: 'Shuttles between locations',          icon: <Bus className="w-4 h-4" />,    val: arrTransport, set: setArrTransport },
                          { key: 'meals',     label: 'Meals included',          desc: 'Breakfast, lunch or dinner package',  icon: <Coffee className="w-4 h-4" />, val: arrMeals,     set: setArrMeals },
                          { key: 'guide',     label: 'On-site guide/staff',     desc: 'A dedicated local guide or host',     icon: <Users className="w-4 h-4" />,  val: arrGuide,     set: setArrGuide },
                          { key: 'equipment', label: 'Special equipment',       desc: 'Gear, tools or event equipment',      icon: <Wrench className="w-4 h-4" />, val: arrEquipment, set: setArrEquipment },
                        ] as { key: string; label: string; desc: string; icon: React.ReactNode; val: boolean; set: (fn: (v: boolean) => boolean) => void }[]).map(({ key, label, desc, icon, val, set }) => (
                          <button
                            key={key}
                            type="button"
                            onClick={() => set((v) => !v)}
                            aria-pressed={val}
                            className={[
                              "flex flex-col items-start gap-1 rounded-xl px-3 py-3 border-2 text-left transition-all duration-200 focus:outline-none",
                              val
                                ? "border-[#02665e] bg-[#02665e] text-white shadow-md"
                                : "border-slate-200 bg-white text-slate-700 hover:border-[#02665e]/40 hover:bg-emerald-50/40",
                            ].join(" ")}
                          >
                            <span className={val ? "text-white" : "text-[#02665e]"}>{icon}</span>
                            <span className="text-xs font-semibold leading-tight">{label}</span>
                            <span className={["text-[10px] leading-tight", val ? "text-white/75" : "text-slate-400"].join(" ")}>{desc}</span>
                          </button>
                        ))}
                      </div>

                      {/* Conditional detail fields */}
                      {(arrPickup || arrTransport || arrMeals || arrGuide || arrEquipment) && (
                        <div className="mt-4 pt-4 border-t border-[#02665e]/10 grid grid-cols-1 gap-3">
                          <p className="text-[11px] font-medium text-slate-500 uppercase tracking-wide">Details for selected arrangements</p>

                          {arrPickup && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              <div>
                                <label htmlFor="pickup-location" className="block text-xs font-semibold text-slate-600 mb-1">Pickup location</label>
                                <input id="pickup-location" type="text" value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="e.g. Julius Nyerere Airport" className="w-full rounded-lg px-3 py-2 border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e]/40" />
                              </div>
                              <div>
                                <label htmlFor="pickup-time" className="block text-xs font-semibold text-slate-600 mb-1">Pickup time <span className="text-slate-400 font-normal">(AM/PM)</span></label>
                                <input id="pickup-time" type="time" value={pickupTime} onChange={(e) => setPickupTime(e.target.value)} className="w-full rounded-lg px-3 py-2 border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e]/40" />
                              </div>
                            </div>
                          )}

                          <div>
                            <label htmlFor="arrangement-notes" className="block text-xs font-semibold text-slate-600 mb-1">Additional notes <span className="text-slate-400 font-normal">(optional)</span></label>
                            <textarea id="arrangement-notes" value={arrangementNotes} onChange={(e) => setArrangementNotes(e.target.value)} placeholder="Any special requests, dietary needs, equipment specifics, timing details…" className="w-full rounded-lg px-3 py-2 border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#02665e]/20 focus:border-[#02665e]/40 h-20 resize-y" />
                          </div>
                        </div>
                      )}
                    </div>

                  
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-4">
                  {/* Hero header */}
                  <div className="relative overflow-hidden rounded-2xl p-5 sm:p-6"
                    style={{ background: "linear-gradient(135deg, #02665e 0%, #034d47 100%)" }}>
                    <div className="pointer-events-none absolute -top-6 -right-6 h-32 w-32 rounded-full opacity-10"
                      style={{ background: "radial-gradient(circle, #fff, transparent 70%)" }} />
                    <div className="pointer-events-none absolute -bottom-4 -left-4 h-24 w-24 rounded-full opacity-10"
                      style={{ background: "radial-gradient(circle, #fff, transparent 70%)" }} />
                    <div className="relative flex items-start gap-4">
                      <div className="h-11 w-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center flex-shrink-0">
                        <Users className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-0.5">Step 3</p>
                        <h4 className="text-base sm:text-lg font-bold text-white leading-snug">Passenger Roster</h4>
                        <p className="mt-1.5 text-xs sm:text-sm text-white/70 leading-relaxed max-w-lg">
                          Upload your group passenger list so we can plan rooms and logistics. Download the template, fill it in Excel or Google Sheets, then upload the CSV.
                        </p>
                        <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-white/50">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Optional — you can continue without it
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 3-step mini guide */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[
                      { n: '1', title: 'Download template', desc: 'Get the correct columns & formatting' },
                      { n: '2', title: 'Fill in Excel',     desc: "One passenger per row. Don't rename columns" },
                      { n: '3', title: 'Upload CSV',        desc: 'Export as CSV then upload below' },
                    ].map(({ n, title, desc }) => (
                      <div key={n} className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-3 shadow-sm">
                        <div className="flex items-center gap-2 mb-1.5">
                          <div className="h-6 w-6 rounded-full bg-[#02665e] flex items-center justify-center text-xs font-bold text-white flex-shrink-0">{n}</div>
                          <p className="text-xs font-semibold text-slate-800 leading-tight">{title}</p>
                        </div>
                        <p className="text-[10px] text-slate-500 leading-relaxed">{desc}</p>
                      </div>
                    ))}
                  </div>

                  {/* Template + Upload side by side */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {/* Template card */}
                    <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3 mb-3 pb-3 border-b border-[#02665e]/10">
                        <div>
                          <p className="text-sm font-semibold text-slate-800">CSV Template</p>
                          <p className="text-xs text-slate-500 mt-0.5">Pre-formatted for Excel or Google Sheets</p>
                        </div>
                        <button
                          type="button"
                          onClick={downloadTemplate}
                          aria-label="Download roster template"
                          className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#02665e] text-white text-xs font-semibold hover:bg-[#034d47] transition-colors shadow-sm focus:outline-none animate-pulse hover:animate-none"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Download
                        </button>
                      </div>
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-2">Expected columns</p>
                      <div className="flex flex-wrap gap-1.5">
                        {templateColumns.map((c) => (
                          <span key={c} className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#02665e]/5 border border-[#02665e]/15 text-[#02665e]">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Upload card */}
                    <div className="rounded-xl border border-[#02665e]/10 bg-gradient-to-br from-white to-emerald-50/30 p-4 shadow-sm">
                      <p className="text-sm font-semibold text-slate-800 mb-0.5">Upload Roster</p>
                      <p className="text-xs text-slate-500 mb-3">Select your filled-in CSV file</p>

                      <label
                        htmlFor="roster-file"
                        className={[
                          "w-full cursor-pointer rounded-xl border-2 border-dashed flex flex-col items-center justify-center gap-2 py-6 transition-all duration-200",
                          rosterFileName
                            ? "border-[#02665e]/40 bg-[#02665e]/5"
                            : "border-slate-200 bg-slate-50 hover:border-[#02665e]/40 hover:bg-emerald-50/30",
                        ].join(" ")}
                      >
                        {rosterFileName ? (
                          <>
                            <div className="h-9 w-9 rounded-full bg-[#02665e]/10 flex items-center justify-center">
                              <Check className="w-5 h-5 text-[#02665e]" />
                            </div>
                            <span className="text-xs font-semibold text-[#02665e] text-center px-2 truncate max-w-full">{rosterFileName}</span>
                            <span className="text-[10px] text-slate-400">Click to replace</span>
                          </>
                        ) : (
                          <>
                            <div className="h-9 w-9 rounded-full bg-slate-100 flex items-center justify-center">
                              <Download className="w-4 h-4 text-slate-400 rotate-180" />
                            </div>
                            <span className="text-xs font-medium text-slate-500">Click to choose CSV file</span>
                            <span className="text-[10px] text-slate-400">or drag and drop</span>
                          </>
                        )}
                      </label>
                      <input
                        id="roster-file"
                        type="file"
                        accept=".csv,text/csv"
                        aria-label="Upload roster CSV"
                        onChange={(e) => handleRosterFile(e.target.files ? e.target.files[0] : undefined)}
                        className="sr-only"
                      />
                      <p className="mt-2 text-[10px] text-slate-400">In Excel: File ? Save As ? CSV (Comma delimited)</p>
                      {rosterError ? <p className="mt-2 text-xs text-rose-600">{rosterError}</p> : null}
                    </div>
                  </div>

                  {/* Imported roster preview */}
                  {roster.length ? (
                    <div className="rounded-xl border border-[#02665e]/15 bg-gradient-to-br from-white to-emerald-50/20 p-4 shadow-sm">
                      <div className="flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-[#02665e]/10">
                        <div className="flex items-center gap-2">
                          <div className="h-6 w-6 rounded-full bg-[#02665e] flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 text-white stroke-[2.5]" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-800">Roster imported</p>
                            <p className="text-xs text-slate-500">{roster.length} passengers · showing first 5</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setRoster([]); setRosterFileName(''); }}
                          className="text-xs text-slate-400 hover:text-red-500 underline underline-offset-2 transition-colors"
                        >
                          Clear
                        </button>
                      </div>
                      <div className="overflow-x-auto rounded-lg border border-slate-100">
                        <table className="min-w-full text-left text-xs">
                          <thead className="bg-slate-50 border-b border-slate-100">
                            <tr>
                              {templateColumns.map((col, idx) => (
                                <th key={col + idx} className="px-3 py-2 font-semibold text-slate-600 whitespace-nowrap">{col}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {roster.slice(0, 5).map((r, i) => (
                              <tr key={i} className="hover:bg-slate-50 transition-colors">
                                {templateColumns.map((col, ci) => {
                                  const key = col.replace(/\s+/g, '').toLowerCase();
                                  return <td key={ci} className="px-3 py-2 text-slate-700 whitespace-nowrap">{r[key] ?? '—'}</td>;
                                })}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {currentStep === 4 && (
                <div className="space-y-4">
                  {/* Header */}
                  <div className="bg-gradient-to-r from-emerald-50 to-teal-50 rounded-lg p-4 border border-emerald-100">
                    <h4 className="text-lg font-semibold text-emerald-900 flex items-center gap-2">
                      <Check className="w-5 h-5 text-emerald-600" />
                      Review Your Booking
                    </h4>
                    <p className="text-xs text-emerald-700 mt-1">Please verify all details before creating your block booking</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Group Details */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-emerald-700 uppercase mb-3 pb-2 border-b border-emerald-100 flex items-center gap-2">
                        <Users className="w-4 h-4" />
                        Group Details
                      </h5>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Type</span>
                          <span className="text-sm font-medium text-slate-900">{groupType || '—'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Headcount</span>
                          <span className="text-sm font-medium text-slate-900">{headcount}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Accommodation</span>
                          <span className="text-sm font-medium text-slate-900">{accommodationType || '—'}</span>
                        </div>
                        {accommodationType === 'hotel' ? (
                          <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                            <span className="text-xs text-slate-500">Hotel rating</span>
                            <span className="text-sm font-medium text-slate-900">{minHotelStarLabel || '—'}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Origin */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-blue-700 uppercase mb-3 pb-2 border-b border-blue-100">Origin</h5>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Country</span>
                          <span className="text-sm font-medium text-slate-900">
                            {fromCountry ? COUNTRIES.find(c => c.value === fromCountry)?.label || fromCountry : '—'}
                          </span>
                        </div>
                        {isTanzaniaSelected && (
                          <>
                            <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                              <span className="text-xs text-slate-500">Region</span>
                              <span className="text-sm font-medium text-slate-900">{fromRegion ? getRegionName(fromRegion) : '—'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs text-slate-500">District</span>
                              <span className="text-sm font-medium text-slate-900">{fromDistrict || '—'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                              <span className="text-xs text-slate-500">Ward</span>
                              <span className="text-sm font-medium text-slate-900">{fromWard || '—'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs text-slate-500">Location</span>
                              <span className="text-sm font-medium text-slate-900">{fromLocation || '—'}</span>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Destination */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-purple-700 uppercase mb-3 pb-2 border-b border-purple-100">Destination</h5>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Region</span>
                          <span className="text-sm font-medium text-slate-900">{toRegion ? getRegionName(toRegion) : '—'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">District</span>
                          <span className="text-sm font-medium text-slate-900">{toDistrict || '—'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Ward</span>
                          <span className="text-sm font-medium text-slate-900">{toWard || '—'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Location</span>
                          <span className="text-sm font-medium text-slate-900">{toLocation || '—'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Dates & Duration */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-amber-700 uppercase mb-3 pb-2 border-b border-amber-100 flex items-center gap-2">
                        <Calendar className="w-4 h-4" />
                        Dates & Duration
                      </h5>
                      <div className="space-y-2">
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Check-in</span>
                          <span className="text-sm font-medium text-slate-900">{checkInIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkInIso)) : '—'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Check-out</span>
                          <span className="text-sm font-medium text-slate-900">{checkOutIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkOutIso)) : '—'}</span>
                        </div>
                        {checkInIso && checkOutIso && (
                          <div className="flex justify-between items-center py-1">
                            <span className="text-xs text-slate-500">Duration</span>
                            <span className="text-sm font-medium text-slate-900">{Math.max(0, Math.round((new Date(checkOutIso).getTime() - new Date(checkInIso).getTime()) / 86400000))} night{Math.max(0, Math.round((new Date(checkOutIso).getTime() - new Date(checkInIso).getTime()) / 86400000)) !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Using dates</span>
                          <span className="text-sm font-medium text-slate-900">{useDates ? 'Yes' : 'Not specified'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Full-width sections */}
                  <div className="space-y-4">
                    {/* Rooms & Configuration */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-teal-700 uppercase mb-3 pb-2 border-b border-teal-100">Rooms & Configuration</h5>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-teal-50 rounded-lg p-3 text-center border border-teal-100">
                          <div className="text-xs text-teal-600 mb-1">Room Size</div>
                          <div className="text-lg font-bold text-teal-900">{roomSize}</div>
                          <div className="text-xs text-teal-600">person{roomSize !== 1 ? 's' : ''}</div>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3 text-center border border-blue-100">
                          <div className="text-xs text-blue-600 mb-1">Rooms Needed</div>
                          <div className="text-lg font-bold text-blue-900">{roomsNeeded}</div>
                          <div className="text-xs text-blue-600">rooms</div>
                        </div>
                        <div className="bg-purple-50 rounded-lg p-3 text-center border border-purple-100">
                          <div className="text-xs text-purple-600 mb-1">Private Rooms</div>
                          <div className="text-lg font-bold text-purple-900">{needsPrivateRoom ? privateRoomCount : '0'}</div>
                          <div className="text-xs text-purple-600">{needsPrivateRoom ? 'requested' : 'none'}</div>
                        </div>
                        <div className="bg-amber-50 rounded-lg p-3 text-center border border-amber-100">
                          <div className="text-xs text-amber-600 mb-1">Suggested Size</div>
                          <div className="text-lg font-bold text-amber-900">{recommendRoomSize(groupType, headcount)}</div>
                          <div className="text-xs text-amber-600">persons</div>
                        </div>
                      </div>
                    </div>

                    {/* Arrangements */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-indigo-700 uppercase mb-3 pb-2 border-b border-indigo-100">Arrangements</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                            <Truck className={`w-4 h-4 ${arrPickup ? 'text-emerald-600' : 'text-slate-300'}`} />
                            <span className="text-sm flex-1">Airport pick-up</span>
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${arrPickup ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {arrPickup ? 'Yes' : 'No'}
                            </span>
                          </div>
                          {arrPickup && pickupLocation && (
                            <div className="ml-6 text-xs text-slate-600 bg-emerald-50 p-2 rounded border-l-2 border-emerald-300">
                              <span className="font-medium">Location:</span> {pickupLocation}
                            </div>
                          )}
                          {arrPickup && pickupTime && (
                            <div className="ml-6 text-xs text-slate-600 bg-emerald-50 p-2 rounded border-l-2 border-emerald-300">
                              <span className="font-medium">Time:</span> {formatTimeTo12(pickupTime)}
                            </div>
                          )}

                          <div className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                            <Bus className={`w-4 h-4 ${arrTransport ? 'text-emerald-600' : 'text-slate-300'}`} />
                            <span className="text-sm flex-1">Transport between sites</span>
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${arrTransport ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {arrTransport ? 'Yes' : 'No'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                            <Coffee className={`w-4 h-4 ${arrMeals ? 'text-emerald-600' : 'text-slate-300'}`} />
                            <span className="text-sm flex-1">Meals included</span>
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${arrMeals ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {arrMeals ? 'Yes' : 'No'}
                            </span>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                            <Users className={`w-4 h-4 ${arrGuide ? 'text-emerald-600' : 'text-slate-300'}`} />
                            <span className="text-sm flex-1">On-site guide/staff</span>
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${arrGuide ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {arrGuide ? 'Yes' : 'No'}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 p-2 rounded hover:bg-slate-50">
                            <Wrench className={`w-4 h-4 ${arrEquipment ? 'text-emerald-600' : 'text-slate-300'}`} />
                            <span className="text-sm flex-1">Special equipment</span>
                            <span className={`text-xs font-medium px-2 py-1 rounded-full ${arrEquipment ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                              {arrEquipment ? 'Yes' : 'No'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {arrangementNotes && (
                        <div className="mt-4 pt-3 border-t border-slate-200">
                          <div className="text-xs font-medium text-slate-600 mb-2">Additional Notes:</div>
                          <div className="bg-indigo-50 p-3 rounded-lg text-sm text-slate-700 border border-indigo-100">
                            {arrangementNotes}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Roster */}
                    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm hover:shadow-md transition-shadow">
                      <h5 className="text-sm font-semibold text-rose-700 uppercase mb-3 pb-2 border-b border-rose-100">Passenger Roster</h5>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-rose-50 rounded-lg border border-rose-100">
                          <span className="text-sm font-medium text-rose-900">Total Passengers</span>
                          <span className="text-2xl font-bold text-rose-700">{roster.length > 0 ? roster.length : '0'}</span>
                        </div>
                        {roster.length > 0 && (
                          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                            <div className="text-sm text-slate-700 space-y-1">
                              {(showAllPassengers ? roster : roster.slice(0, 3)).map((r, i) => {
                                const name = `${r.firstname || ''} ${r.lastname || ''}`.trim() || `Passenger ${i + 1}`;
                                return (
                                  <div key={i} className="flex items-center gap-2 p-2 bg-white rounded border border-slate-100">
                                    <div className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-xs font-bold">
                                      {i + 1}
                                    </div>
                                    <span className="font-medium">{name}</span>
                                    {r.phone && <span className="text-xs text-slate-500">· {r.phone}</span>}
                                  </div>
                                );
                              })}
                              {roster.length > 3 && !showAllPassengers && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllPassengers(true)}
                                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-emerald-200"
                                >
                                  <span>
                                    Show {roster.length - 3} more passenger{roster.length - 3 !== 1 ? 's' : ''}
                                  </span>
                                  <ChevronDown className="h-4 w-4 text-slate-500" aria-hidden />
                                </button>
                              )}
                              {showAllPassengers && roster.length > 3 && (
                                <button
                                  type="button"
                                  onClick={() => setShowAllPassengers(false)}
                                  className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-emerald-200"
                                >
                                  <span>Show less</span>
                                  <ChevronDown className="h-4 w-4 rotate-180 text-slate-500" aria-hidden />
                                </button>
                              )}
                            </div>
                          </div>
                        )}
                        {roster.length === 0 && (
                          <div className="text-center py-6 text-slate-400">
                            <Users className="w-12 h-12 mx-auto mb-2 opacity-30" />
                            <p className="text-sm">No passengers added yet</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          </div>

          
          <div className="mt-4 flex items-center justify-end gap-2">
            {currentStep > 1 ? (
              <button type="button" onClick={() => setCurrentStep((s) => s - 1)} className="px-3 py-2 bg-white border rounded-lg shadow-sm transition transform hover:-translate-y-0.5 active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-emerald-200 inline-flex items-center gap-2">
                <ChevronLeft className="w-4 h-4 text-slate-700" aria-hidden />
                <span className="text-sm text-slate-700">Back</span>
              </button>
            ) : null}

            {currentStep < 4 ? (
              <button
                type="button"
                onClick={() => {
                  const ok = validateUpToStep(currentStep);
                  if (!ok) return;
                  setErrors([]);
                  setCurrentStep((s) => s + 1);
                }}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg shadow transition transform hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-emerald-300 inline-flex items-center gap-2"
              >
                <span className="text-sm">Next</span>
                <ChevronRight className="w-4 h-4" aria-hidden />
              </button>
            ) : (
              <>
                <button type="button" onClick={() => { /* save draft local */ }} disabled={isCreating || !isFormComplete()} className="px-3 py-2 bg-slate-50 border rounded-lg transition hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-200 disabled:opacity-50 disabled:cursor-not-allowed">Save draft</button>
                <button 
                  type="button" 
                  onClick={() => { if (GATE_ENABLED) { setShowComingSoon(true); } else { _handleCreate(); } }}
                  disabled={isCreating || !isFormComplete()}
                  className="px-4 py-2 bg-emerald-600 text-white rounded-lg shadow transition transform hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 focus:outline-none focus:ring-2 focus:ring-emerald-300 inline-flex items-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed disabled:transform-none"
                  title={!isFormComplete() ? 'Please fill all required fields' : ''}
                >
                  {isCreating ? (
                    <>
                      <Spinner size="sm" ariaLabel="Creating block booking" />
                      <span className="text-sm">Creating...</span>
                    </>
                  ) : showSuccess ? (
                    <>
                      <Check className="w-4 h-4" aria-hidden />
                      <span className="text-sm">Created!</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" aria-hidden />
                      <span className="text-sm">Create Block</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>

          
          {errors.length ? (
            <div role="alert" aria-live="assertive" className="mt-3 text-sm text-rose-600">
              {errors.map((er,i) => <div key={i}>{er}</div>)}
            </div>
          ) : null}

          <style jsx>{`
            .stepContentTransition {
              animation: stepContentIn 180ms ease-out;
              will-change: transform, opacity;
            }
            @keyframes stepContentIn {
              from {
                opacity: 0;
                transform: translateY(6px);
              }
              to {
                opacity: 1;
                transform: translateY(0);
              }
            }
            @media (prefers-reduced-motion: reduce) {
              .stepContentTransition {
                animation: none;
              }
            }
          `}</style>
        </article>
      </div>
    </section>
  );
}
