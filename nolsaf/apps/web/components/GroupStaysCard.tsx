"use client";

import React, { useState, useEffect, useRef } from 'react';
import DatePicker from '@/components/ui/DatePicker';
import { REGIONS as TZ_REGIONS } from '@/lib/tzRegions';
import { REGIONS_FULL_DATA } from '@/lib/tzRegionsFull';
import Link from 'next/link';
import { Calendar, ChevronDown, Check, Truck, Bus, Coffee, Users, Wrench, Download, ArrowLeft, ArrowDown, CheckCircle, CheckCircle2, ArrowRight, Trash2, Lock,Megaphone, Gavel, House, Briefcase, PartyPopper, GraduationCap, Trophy, Binoculars, Shapes, TriangleAlert, Hotel, TreePine, TreePalm, Building, BedSingle, HeartHandshake, Sun, TentTree, HousePlus, Building2, BedDouble, Minus, Plus, Star, Sparkles } from 'lucide-react';

const BRAND = '#02665e';

const STEPS = [
  { label: 'Your group', title: 'Who is travelling, and where to?', sub: 'Only owners in your destination area will see this request.' },
  { label: 'The stay', title: 'Shape the stay', sub: 'Accommodation, people, rooms and dates, plus any extras.' },
  { label: 'Passenger list', title: 'Add your passenger list', sub: 'Optional. You can send the request without it.' },
  { label: 'Review and send', title: 'Review and send', sub: 'Check the brief, then send it to owners.' },
] as const;

const GROUP_TYPES = [
  { value: 'family', label: 'Family', Icon: House },
  { value: 'workers', label: 'Workers', Icon: Briefcase },
  { value: 'event', label: 'Event', Icon: PartyPopper },
  { value: 'students', label: 'Students', Icon: GraduationCap },
  { value: 'team', label: 'Team', Icon: Trophy },
  { value: 'safari_stay', label: 'Safari stay', Icon: Binoculars },
  { value: 'other', label: 'Other', Icon: Shapes },
] as const;

// Owners bid on the request, so the hero explains the three moves of a bid.
const BID_FLOW = [
  { Icon: Megaphone, title: 'Post your brief', text: 'Group, place and dates. Free to send.' },
  { Icon: Gavel, title: 'Owners bid', text: 'Only owners in that area, screened by NoLSAF.' },
  { Icon: CheckCircle2, title: 'You choose', text: 'A small deposit confirms it. The rest at check-in.' },
] as const;

// Every select and text field in the builder gets the same tall, rounded field look.
const BUILDER_CSS = `
#group-stay-builder, #group-stay-builder * { box-sizing: border-box; }
#group-stay-builder .groupstays-select {
  height: 3rem; min-height: 3rem; margin-top: 0.375rem; padding-left: 0.875rem;
  border: 1px solid #e2e8f0 !important; border-radius: 0.75rem !important; background: #fff !important;
  font-size: 0.875rem; color: #0f172a; box-shadow: 0 1px 2px rgba(15,23,42,0.04);
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
#group-stay-builder .groupstays-select:hover:not(:disabled) { border-color: rgba(2,102,94,0.45) !important; }
#group-stay-builder .groupstays-select:focus { outline: none; border-color: ${BRAND} !important; box-shadow: 0 0 0 3px rgba(2,102,94,0.15); }
#group-stay-builder .groupstays-select:disabled { background: #f8fafc !important; color: #94a3b8; cursor: not-allowed; }
#group-stay-builder .groupstays-chevron { right: 0.875rem; margin-top: 0.1875rem; }
`;

/** Vertical step rail: finished steps show what was filled in, so the brief builds up as you go. */
function BriefRail({ current, summaries, onJump }: { current: number; summaries: string[][]; onJump: (step: number) => void }) {
  return (
    <ol className="m-0 list-none p-0">
      {STEPS.map(({ label }, i) => {
        const step = i + 1;
        const done = step < current;
        const active = step === current;
        const lines = summaries[i] ?? [];
        return (
          <li key={label} className="relative pb-6 last:pb-0">
            {i < STEPS.length - 1 ? (
              <span className={`absolute bottom-0 left-[15px] top-9 w-0.5 rounded-full ${done ? 'bg-[#02665e]' : 'bg-slate-200'}`} aria-hidden />
            ) : null}
            <button
              type="button"
              onClick={() => onJump(step)}
              aria-current={active ? 'step' : undefined}
              className="group flex w-full cursor-pointer items-start gap-3 border-0 bg-transparent p-0 text-left"
            >
              <span
                className={[
                  'relative z-10 inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-bold transition',
                  done ? 'bg-[#02665e] text-white' : active ? 'bg-[#02665e] text-white ring-4 ring-[#02665e]/15' : 'border-2 border-solid border-slate-200 bg-white text-slate-400 group-hover:border-slate-300',
                ].join(' ')}
              >
                {done ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden /> : step}
              </span>
              <span className="min-w-0 flex-1 pt-1">
                <span className={`block text-[14px] font-bold leading-tight ${active || done ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
                {done && lines.length ? (
                  lines.map((line) => (
                    <span key={line} className="mt-1 block truncate text-[12.5px] text-slate-500">{line}</span>
                  ))
                ) : (
                  <span className={`mt-1 block text-[12px] font-semibold ${active ? 'text-[#02665e]' : 'text-slate-400'}`}>
                    {active ? 'Filling in now' : done ? 'Done' : 'Up next'}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

// The six most requested styles get a card that says what staying there is like.
const FEATURED_STAYS = [
  { value: 'hotel', label: 'Hotel', text: 'Reception, daily service, en-suite rooms', Icon: Hotel },
  { value: 'lodge', label: 'Lodge', text: 'Nature and safari settings, meals on site', Icon: TreePine },
  { value: 'guest_house', label: 'Guest house', text: 'Small, local and easy on the budget', Icon: House },
  { value: 'apartment', label: 'Apartment', text: 'Kitchens and living space, good for families', Icon: Building },
  { value: 'villa', label: 'Villa', text: 'A private house for the whole group', Icon: TreePalm },
  { value: 'hostel', label: 'Hostel', text: 'Shared dorms at the lowest price', Icon: BedSingle },
] as const;

// The less common styles: compact tiles in the same family as the featured cards.
const MORE_STAYS = [
  { value: 'homestay', label: 'Homestay', Icon: HeartHandshake },
  { value: 'bungalow', label: 'Bungalow', Icon: Sun },
  { value: 'cabin', label: 'Cabin', Icon: TentTree },
  { value: 'condo', label: 'Condo', Icon: Building2 },
  { value: 'townhouse', label: 'Townhouse', Icon: HousePlus },
  { value: 'house', label: 'House', Icon: House },
  { value: 'other', label: 'Other', Icon: Shapes },
] as const;

// Same values the API already stores; shown as a quality scale instead of a dropdown.
const HOTEL_TIERS = [
  { value: 'basic', label: 'Basic', stars: 1, text: 'Clean, simple rooms. Shared bathrooms are possible.' },
  { value: 'simple', label: 'Simple', stars: 2, text: 'Affordable private rooms with the basics covered.' },
  { value: 'moderate', label: 'Moderate', stars: 3, text: 'Comfortable en-suite rooms and reliable service.' },
  { value: 'high', label: 'High-end', stars: 4, text: 'Upscale rooms, good dining and extra amenities.' },
  { value: 'luxury', label: 'Luxury', stars: 5, text: 'Top-tier comfort, service and facilities.' },
] as const;

function SectionHeader({ Icon, title, hint, aside }: { Icon: typeof Users; title: string; hint?: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/[0.08] text-[#02665e]">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="m-0 text-[15px] font-bold leading-tight text-slate-900">{title}</p>
          {hint ? <p className="m-0 mt-1 text-[12.5px] leading-snug text-slate-500">{hint}</p> : null}
        </div>
      </div>
      {aside}
    </div>
  );
}

function CountStepper({ id, label, hint, value, min = 0, max = 999, dot, onChange }: {
  id: string; label: string; hint?: string; value: number; min?: number; max?: number; dot?: string; onChange: (n: number) => void;
}) {
  const set = (n: number) => onChange(Math.min(max, Math.max(min, n)));
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-solid border-slate-200 bg-white px-3.5 py-2.5 transition focus-within:border-[#02665e]/50">
      <div className="min-w-0 leading-tight">
        <label htmlFor={id} className="flex items-center gap-2 text-[13.5px] font-semibold text-slate-800">
          {dot ? <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dot}`} aria-hidden /> : null}
          {label}
        </label>
        {hint ? <span className="mt-0.5 block text-[11.5px] text-slate-400">{hint}</span> : null}
      </div>
      <div className="inline-flex flex-shrink-0 items-center rounded-full bg-slate-50 p-0.5 ring-1 ring-slate-200">
        <button
          type="button"
          onClick={() => set(value - 1)}
          suppressHydrationWarning disabled={value <= min}
          aria-label={`Fewer: ${label}`}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-white text-slate-700 shadow-sm transition hover:text-[#02665e] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300 disabled:shadow-none"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </button>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/\D/g, ''), 10);
            set(Number.isFinite(n) ? n : min);
          }}
          className="h-8 w-10 border-0 bg-transparent p-0 text-center text-[15px] font-bold tabular-nums text-slate-900 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => set(value + 1)}
          suppressHydrationWarning disabled={value >= max}
          aria-label={`More: ${label}`}
          className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-white text-slate-700 shadow-sm transition hover:text-[#02665e] disabled:cursor-not-allowed disabled:bg-transparent disabled:text-slate-300 disabled:shadow-none"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

const titleCase = (v: string) => v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
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
  const [showMoreStays, setShowMoreStays] = useState<boolean>(false);
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
      setDraftNotice(parsed.rebook ? 'Filled from your earlier request. Pick new dates to continue.' : 'Your saved draft was restored.');
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
    const formatDateShort = (d?: Date | null) => d ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(d) : '';
    const f = formatDateShort(from);
    const t = to ? formatDateShort(to) : 'Any';
    if (from && to) {
      const nights = Math.max(0, Math.round((to.getTime() - from.getTime()) / 86400000));
      const nightsLabel = nights === 1 ? '1 night' : `${nights} nights`;
      return `${f} to ${t} · ${nightsLabel}`;
    }
    return `${f} to ${t}`;
  };

  const pickStay = (value: string) => {
    setAccommodationType(value);
    if (value !== 'hotel') setMinHotelStarLabel('');
  };
  // A restored draft with a less common style opens the "more types" row.
  useEffect(() => {
    if (accommodationType && !FEATURED_STAYS.some((f) => f.value === accommodationType)) setShowMoreStays(true);
  }, [accommodationType]);

  // Steps differ in height, so after a step change bring the new step's heading
  // into view; otherwise the page stays at the old scroll position (often the footer).
  // Only user navigation scrolls: restoring a draft on load must not move the page.
  const stepHeadingRef = useRef<HTMLDivElement | null>(null);
  const scrollOnStepChange = useRef(false);
  useEffect(() => {
    if (!scrollOnStepChange.current) return;
    scrollOnStepChange.current = false;
    const el = stepHeadingRef.current;
    if (!el) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }, [currentStep]);

  const goToStep = (step: number) => {
    setErrors([]);
    scrollOnStepChange.current = true;
    setCurrentStep(step);
  };

  // Going back is always allowed; going forward validates the steps in between.
  const jumpTo = (step: number) => {
    if (step === currentStep) return;
    if (step < currentStep || validateUpToStep(step - 1)) goToStep(step);
  };

  const groupTypeLabel = GROUP_TYPES.find((g) => g.value === groupType)?.label ?? '';
  const countryLabel = COUNTRIES.find((c) => c.value === fromCountry)?.label ?? '';
  const hotelLabel = HOTEL_STAR_OPTIONS.find((o) => o.value === minHotelStarLabel && o.value)?.label ?? '';
  // One or two short lines per finished step, shown under it in the rail.
  const accommodationLabel = accommodationType ? `${titleCase(accommodationType)}${hotelLabel ? `, ${hotelLabel.toLowerCase()}` : ''}` : '';
  const railSummaries: string[][] = [
    [
      groupTypeLabel ? `${groupTypeLabel}${countryLabel ? ` from ${countryLabel}` : ''}` : '',
      toRegion ? [toDistrict, getRegionName(toRegion)].filter(Boolean).join(', ') : '',
    ].filter(Boolean),
    [
      accommodationLabel,
      `${calculatedHeadcount} ${calculatedHeadcount === 1 ? 'person' : 'people'}, about ${roomsNeeded} room${roomsNeeded === 1 ? '' : 's'}`,
      useDates ? (checkInIso && checkOutIso ? formatDateSummary() : '') : 'Flexible dates',
    ].filter(Boolean),
    [roster.length ? `${roster.length} passenger${roster.length === 1 ? '' : 's'}` : 'Skipped, optional'],
    [],
  ];

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

        {/* Hero: a light brief header; the three moves of a bid carry the explanation */}
        <div className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white">
          <div className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-100 px-5 py-3 sm:px-8">
            <span className="inline-flex items-center gap-2 text-[12.5px] font-bold text-[#02665e]">
              <Users className="h-4 w-4" aria-hidden />
              Group Stays
            </span>
            <Link
              href="/public"
              onClick={() => { if (onCloseAction) onCloseAction(); }}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-slate-500 no-underline transition hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Public site
            </Link>
          </div>

          <div className="grid gap-8 px-5 py-8 sm:px-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-center">
            <div>
              <h1 id="group-stays-heading" className="m-0 text-[30px] font-extrabold leading-[1.1] tracking-tight text-slate-950 sm:text-[40px]">
                Request a group stay
              </h1>
              <p className="m-0 mt-3 max-w-md text-[15px] leading-7 text-slate-600">
                Describe your group once. Owners in your destination send you offers, and you choose the one that fits.
              </p>
              <a
                href="#group-stay-builder"
                className="mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-[#02665e] px-5 text-[14px] font-bold text-white no-underline transition hover:bg-[#014d47]"
              >
                Start your brief
                <ArrowDown className="h-4 w-4" aria-hidden />
              </a>
            </div>

            <ol className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-3 sm:gap-0">
              {BID_FLOW.map(({ Icon, title, text }, i) => (
                <li key={title} className="relative flex gap-3 rounded-2xl bg-[#f3f7f6] p-4 sm:flex-col sm:bg-transparent sm:p-0 sm:px-3 sm:text-center">
                  {i < BID_FLOW.length - 1 ? (
                    <span className="absolute left-[calc(50%+28px)] right-[calc(-50%+28px)] top-[22px] hidden border-0 border-t-2 border-dashed border-[#02665e]/25 sm:block" aria-hidden />
                  ) : null}
                  <span className="relative inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/[0.08] text-[#02665e] sm:mx-auto">
                    <Icon className="h-5 w-5" aria-hidden />
                    <span className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-[#02665e] text-[10.5px] font-bold text-white ring-2 ring-white">{i + 1}</span>
                  </span>
                  <span className="min-w-0 sm:mt-3">
                    <span className="block text-[14px] font-bold text-slate-900">{title}</span>
                    <span className="mt-0.5 block text-[12.5px] leading-snug text-slate-500">{text}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Builder: step rail on the left, the current step on the right */}
        <div id="group-stay-builder" ref={stepHeadingRef} className="scroll-mt-20 pb-16 pt-8">
          <style>{BUILDER_CSS}</style>

          {/* Phones: compact progress instead of the rail */}
          <div className="mb-5 lg:hidden">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[12px] font-bold text-[#02665e]">Step {currentStep} of 4</span>
              <span className="text-[12px] font-semibold text-slate-500">{STEPS[currentStep - 1].label}</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden>
              {STEPS.map((step, i) => (
                <span key={step.label} className={`h-1.5 rounded-full ${i < currentStep ? 'bg-[#02665e]' : 'bg-slate-200'}`} />
              ))}
            </div>
          </div>

          <div className="grid gap-8 lg:grid-cols-[250px_minmax(0,1fr)]">
            <nav aria-label="Request steps" className="hidden lg:block">
              <div className="sticky top-24 rounded-2xl border border-solid border-slate-200 bg-white p-5">
                <p className="m-0 mb-5 text-[12px] font-bold text-slate-500">Your brief</p>
                <BriefRail current={currentStep} summaries={railSummaries} onJump={jumpTo} />
              </div>
            </nav>

            <div className="min-w-0">
              <header className="mb-5">
                <h2 className="m-0 text-[22px] font-bold leading-tight tracking-tight text-slate-950 sm:text-[26px]">{STEPS[currentStep - 1].title}</h2>
                <p className="m-0 mt-1 text-[14px] text-slate-500">{STEPS[currentStep - 1].sub}</p>
              </header>

              {draftNotice ? (
                <div className="mb-5 flex items-center gap-2 rounded-xl border border-solid border-[#02665e]/20 bg-white px-3.5 py-2.5 text-[13px] font-medium text-[#02665e]">
                  <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden />
                  {draftNotice}
                </div>
              ) : null}
              <div key={currentStep} className="stepContentTransition">
              {currentStep === 1 && (
                <div className="flex flex-col gap-5">
                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-4 sm:p-5">
                    <p id="group-type-label" className="m-0 text-[14px] font-bold text-slate-900">What kind of group? <span className="text-rose-500">*</span></p>
                    <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Owners tailor their offers to your group type.</p>
                    <div role="group" aria-labelledby="group-type-label" className="mt-3 flex flex-wrap gap-2">
                      {GROUP_TYPES.map(({ value, label, Icon }) => {
                        const on = groupType === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            aria-pressed={on}
                            onClick={() => setGroupType(value)}
                            className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-full border border-solid pl-1.5 pr-4 transition ${on ? 'border-[#02665e] bg-[#02665e] text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-[#02665e]/40'}`}
                          >
                            <span className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full ${on ? 'bg-white/20 text-white' : 'bg-[#02665e]/[0.08] text-[#02665e]'}`}>
                              <Icon className="h-4 w-4" aria-hidden />
                            </span>
                            <span className="text-[13px] font-semibold">{label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-5 border-0 border-t border-solid border-slate-100 pt-5">
                      <div>
                        <label htmlFor="from-country" className="block text-[12.5px] font-semibold text-slate-600">Travelling from <span className="text-rose-500">*</span></label>
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
                          <label htmlFor="from-region" className="block text-[12.5px] font-semibold text-slate-600">
                            Region <span className="text-rose-500">*</span>
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
                          <label htmlFor="from-district" className="block text-[12.5px] font-semibold text-slate-600">District</label>
                          <div className="relative">
                            <select id="from-district" value={fromDistrict} onChange={(e) => { setFromDistrict(e.target.value); setFromWard(''); setFromLocation(''); }} suppressHydrationWarning disabled={!fromRegion} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                              <option value="">Select district</option>
                              {getDistrictsFor(fromRegion).map((d) => <option key={d} value={d}>{d}</option>)}
                            </select>
                            <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="from-ward" className="block text-[12.5px] font-semibold text-slate-600">Ward</label>
                          <div className="relative">
                            <select id="from-ward" value={fromWard} onChange={(e) => { setFromWard(e.target.value); setFromLocation(''); }} suppressHydrationWarning disabled={!fromDistrict} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                              <option value="">Select ward</option>
                              {getWardsFor(fromRegion, fromDistrict).map((ward) => (
                                <option key={ward.name} value={ward.name}>{ward.name}</option>
                              ))}
                            </select>
                            <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                          </div>
                        </div>

                        <div>
                          <label htmlFor="from-location" className="block text-[12.5px] font-semibold text-slate-600">Street</label>
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
                                <select id="from-location" value={fromLocation} onChange={(e) => setFromLocation(e.target.value)} suppressHydrationWarning disabled={!fromWard} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
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

                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-4 sm:p-5">
                    <div>
                      <p className="m-0 text-[14px] font-bold text-slate-900">Where are you going? <span className="text-rose-500">*</span></p>
                      <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">Region and district are required. Ward and street help owners nearby find you.</p>
                    </div>

                    <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="to-region" className="block text-[12.5px] font-semibold text-slate-600">Region <span className="text-rose-500">*</span></label>
                        <div className="relative">
                          <select id="to-region" value={toRegion} onChange={(e) => { setToRegion(e.target.value); setToDistrict(''); setToWard(''); setToLocation(''); }} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9">
                            <option value="">Select region</option>
                            {REGION_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="to-district" className="block text-[12.5px] font-semibold text-slate-600">District <span className="text-rose-500">*</span></label>
                        <div className="relative">
                          <select id="to-district" value={toDistrict} onChange={(e) => { setToDistrict(e.target.value); setToWard(''); setToLocation(''); }} suppressHydrationWarning disabled={!toRegion} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                            <option value="">Select district</option>
                            {getDistrictsFor(toRegion).map((d) => <option key={d} value={d}>{d}</option>)}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="to-ward" className="block text-[12.5px] font-semibold text-slate-600">Ward</label>
                        <div className="relative">
                          <select id="to-ward" value={toWard} onChange={(e) => { setToWard(e.target.value); setToLocation(''); }} suppressHydrationWarning disabled={!toDistrict} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
                            <option value="">Select ward</option>
                            {getWardsFor(toRegion, toDistrict).map((ward) => (
                              <option key={ward.name} value={ward.name}>{ward.name}</option>
                            ))}
                          </select>
                          <ChevronDown className="groupstays-chevron pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden />
                        </div>
                      </div>

                      <div>
                        <label htmlFor="to-location" className="block text-[12.5px] font-semibold text-slate-600">Street</label>
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
                              <select id="to-location" value={toLocation} onChange={(e) => setToLocation(e.target.value)} suppressHydrationWarning disabled={!toWard} className="groupstays-select mt-1 w-full rounded-md px-3 py-2 border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-200 pr-9 disabled:bg-slate-50 disabled:text-slate-400">
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
                  {/* Accommodation */}
                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 mb-4">
                    <SectionHeader Icon={Building2} title="Where would you like to stay?" hint="Owners of this kind of place will send you offers." />

                    <div role="radiogroup" aria-label="Accommodation type" className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                      {FEATURED_STAYS.map(({ value, label, text, Icon }) => {
                        const on = accommodationType === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => pickStay(value)}
                            className={`group relative flex cursor-pointer items-start gap-3 rounded-2xl border border-solid p-3.5 text-left transition duration-200 ${on ? 'border-[#02665e] bg-[#02665e]/[0.04] shadow-[0_10px_24px_-16px_rgba(2,102,94,0.6)]' : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_10px_24px_-18px_rgba(15,23,42,0.35)]'}`}
                          >
                            <span className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl transition ${on ? 'bg-[#02665e] text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200 group-hover:text-[#02665e]'}`}>
                              <Icon className="h-5 w-5" aria-hidden />
                            </span>
                            <span className="min-w-0 flex-1 pr-5">
                              <span className={`block text-[14px] font-bold ${on ? 'text-[#02665e]' : 'text-slate-900'}`}>{label}</span>
                              <span className="mt-0.5 block text-[12px] leading-snug text-slate-500">{text}</span>
                            </span>
                            <span className={`absolute right-3 top-3 inline-flex h-5 w-5 items-center justify-center rounded-full transition ${on ? 'bg-[#02665e] text-white' : 'border-2 border-solid border-slate-200 bg-white'}`} aria-hidden>
                              {on ? <Check className="h-3 w-3" strokeWidth={3.5} /> : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    {/* The less common styles stay one tap away */}
                    <div className="mt-3">
                      {showMoreStays ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 p-3 sm:p-3.5">
                          <div className="mb-2.5 flex items-center justify-between gap-3 px-0.5">
                            <span className="text-[12.5px] font-bold text-slate-700">More stay types</span>
                            {MORE_STAYS.some((t) => t.value === accommodationType) ? null : (
                              <button
                                type="button"
                                onClick={() => setShowMoreStays(false)}
                                className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[12px] font-semibold text-slate-500 hover:text-slate-900"
                              >
                                Show fewer
                                <ChevronDown className="h-3.5 w-3.5 rotate-180" aria-hidden />
                              </button>
                            )}
                          </div>
                          <div role="radiogroup" aria-label="More stay types" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            {MORE_STAYS.map(({ value, label, Icon }) => {
                              const on = accommodationType === value;
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  role="radio"
                                  aria-checked={on}
                                  onClick={() => pickStay(value)}
                                  className={`group flex cursor-pointer items-center gap-2.5 rounded-xl border border-solid px-2.5 py-2 text-left transition ${on ? 'border-[#02665e] bg-[#02665e]/[0.04]' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                >
                                  <span className={`inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg transition ${on ? 'bg-[#02665e] text-white' : 'bg-slate-50 text-slate-500 ring-1 ring-slate-200 group-hover:text-[#02665e]'}`}>
                                    <Icon className="h-4 w-4" aria-hidden />
                                  </span>
                                  <span className={`min-w-0 flex-1 truncate text-[13px] font-semibold ${on ? 'text-[#02665e]' : 'text-slate-700'}`}>{label}</span>
                                  {on ? <Check className="h-3.5 w-3.5 flex-shrink-0 text-[#02665e]" strokeWidth={3.5} aria-hidden /> : null}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowMoreStays(true)}
                          className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline"
                        >
                          More types: homestay, bungalow, cabin and others
                          <ChevronDown className="h-4 w-4" aria-hidden />
                        </button>
                      )}
                    </div>

                    {accommodationType === 'hotel' ? (() => {
                      const idx = HOTEL_TIERS.findIndex((t) => t.value === minHotelStarLabel);
                      const tier = idx >= 0 ? HOTEL_TIERS[idx] : null;
                      return (
                        <div className="mt-5 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200 sm:p-5">
                          <div className="flex flex-wrap items-baseline justify-between gap-2">
                            <p id="hotel-rating-label" className="m-0 text-[13.5px] font-bold text-slate-900">
                              Lowest hotel standard you&apos;d accept <span className="text-rose-500">*</span>
                            </p>
                            {tier ? <span className="text-[12px] font-semibold text-[#02665e]">{tier.label} or better</span> : null}
                          </div>

                          {/* A scale: the track fills up to the chosen level */}
                          <div role="radiogroup" aria-labelledby="hotel-rating-label" className="relative mt-5">
                            <span className="absolute left-[10%] right-[10%] top-[13px] h-1 rounded-full bg-slate-200" aria-hidden />
                            <span
                              className="absolute left-[10%] top-[13px] h-1 rounded-full bg-[#02665e] transition-all duration-300"
                              style={{ width: `${Math.max(0, idx) * 20}%` }}
                              aria-hidden
                            />
                            <div className="relative grid grid-cols-5">
                              {HOTEL_TIERS.map((t, i) => {
                                const reached = idx >= 0 && i <= idx;
                                const on = i === idx;
                                return (
                                  <button
                                    key={t.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={on}
                                    onClick={() => setMinHotelStarLabel(t.value)}
                                    className="group flex cursor-pointer flex-col items-center gap-2 border-0 bg-transparent p-0"
                                  >
                                    <span
                                      className={[
                                        'inline-flex h-[30px] w-[30px] items-center justify-center rounded-full transition',
                                        on ? 'bg-[#02665e] text-white ring-4 ring-[#02665e]/15' : reached ? 'bg-[#02665e] text-white' : 'border-2 border-solid border-slate-300 bg-white text-slate-400 group-hover:border-[#02665e]/50',
                                      ].join(' ')}
                                    >
                                      <span className="text-[11px] font-bold tabular-nums">{t.stars}</span>
                                    </span>
                                    <span className={`text-[11.5px] font-bold sm:text-[12.5px] ${on ? 'text-[#02665e]' : 'text-slate-500'}`}>{t.label}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-white px-3.5 py-3 ring-1 ring-slate-200">
                            <span className="flex flex-shrink-0 gap-px pt-0.5" aria-hidden>
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star key={i} className={`h-3.5 w-3.5 ${tier && i < tier.stars ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200'}`} />
                              ))}
                            </span>
                            <p className="m-0 text-[12.5px] leading-snug text-slate-600">
                              {tier ? tier.text : 'Pick a level. Hotels at that standard or above can bid.'}
                            </p>
                          </div>
                        </div>
                      );
                    })() : null}
                  </div>

                  {/* Headcount */}
                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 mb-4">
                    <SectionHeader
                      Icon={Users}
                      title="How many people?"
                      hint="Owners use the mix to plan shared rooms."
                      aside={
                        <span className="flex-shrink-0 rounded-full bg-[#02665e]/[0.08] px-3 py-1 text-[13px] font-bold tabular-nums text-[#02665e]">
                          {calculatedHeadcount} {calculatedHeadcount === 1 ? 'person' : 'people'}
                        </span>
                      }
                    />
                    <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                      <CountStepper id="male-count" label="Male" dot="bg-sky-500" value={maleCount} onChange={setMaleCount} />
                      <CountStepper id="female-count" label="Female" dot="bg-rose-400" value={femaleCount} onChange={setFemaleCount} />
                      <CountStepper id="other-count" label="Other" dot="bg-slate-400" value={otherCount} onChange={setOtherCount} />
                    </div>
                    {calculatedHeadcount > 0 ? (
                      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                        <span className="bg-sky-500 transition-all duration-300" style={{ width: `${(maleCount / calculatedHeadcount) * 100}%` }} />
                        <span className="bg-rose-400 transition-all duration-300" style={{ width: `${calculatedHeadcount ? (femaleCount / calculatedHeadcount) * 100 : 0}%` }} />
                        <span className="bg-slate-400 transition-all duration-300" style={{ width: `${(otherCount / calculatedHeadcount) * 100}%` }} />
                      </div>
                    ) : (
                      <p className="m-0 mt-3 text-[12.5px] font-medium text-rose-600">Add at least one person to continue.</p>
                    )}
                  </div>

                  {/* Private rooms */}
                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 mb-4">
                    <SectionHeader
                      Icon={Lock}
                      title="Private rooms"
                      hint="Turn on if some guests need a room to themselves."
                      aside={
                        <button
                          type="button"
                          role="switch"
                          aria-checked={needsPrivateRoom}
                          aria-label="Some guests need a private room"
                          onClick={() => {
                            const next = !needsPrivateRoom;
                            setNeedsPrivateRoom(next);
                            setPrivateRoomCount(next ? Math.max(1, privateRoomCount) : 0);
                          }}
                          className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center rounded-full border-0 p-0 transition-colors ${needsPrivateRoom ? 'bg-[#02665e]' : 'bg-slate-300'}`}
                        >
                          <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${needsPrivateRoom ? 'translate-x-6' : 'translate-x-1'}`} />
                        </button>
                      }
                    />
                    {needsPrivateRoom ? (
                      <div className="mt-4">
                        <CountStepper
                          id="private-room-count"
                          label="How many private rooms?"
                          hint="Offers must include at least this many."
                          min={1}
                          max={Math.max(1, calculatedHeadcount)}
                          value={privateRoomCount || 1}
                          onChange={setPrivateRoomCount}
                        />
                      </div>
                    ) : null}
                  </div>

                  {/* Room sharing */}
                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 mb-4">
                    <SectionHeader
                      Icon={BedDouble}
                      title="How many share a room?"
                      hint={`Suggested for this group: ${recommendRoomSize(groupType, headcount)} per room.`}
                      aside={
                        <span className="flex-shrink-0 rounded-full bg-slate-100 px-3 py-1 text-[13px] font-bold tabular-nums text-slate-700">
                          About {roomsNeeded} room{roomsNeeded === 1 ? '' : 's'}
                        </span>
                      }
                    />
                    <div role="radiogroup" aria-label="People per room" className="mt-4 grid grid-cols-4 gap-1.5 rounded-2xl bg-slate-50 p-1.5 ring-1 ring-slate-200">
                      {[1, 2, 3, 4].map((n) => {
                        const on = roomSize === n;
                        return (
                          <button
                            key={n}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            onClick={() => setRoomSize(n)}
                            className={`flex cursor-pointer flex-col items-center rounded-xl border-0 py-2.5 transition ${on ? 'bg-white text-[#02665e] shadow-sm ring-1 ring-[#02665e]/30' : 'bg-transparent text-slate-500 hover:bg-white/70'}`}
                          >
                            <span className="text-[17px] font-bold tabular-nums leading-none">{n}</span>
                            <span className="mt-1 text-[11px] font-semibold">{n === 1 ? 'person' : 'people'}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 mb-4">
                    <SectionHeader Icon={Calendar} title="When are you staying?" hint="Nights are counted once both dates are set." />
                    <div className="mt-4">
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
                                  {checkInIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(checkInIso)) : 'Add date'}
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
                                suppressHydrationWarning disabled={!checkInIso}
                                className={[
                                  "w-full text-left rounded-xl px-4 py-3 border-2 bg-white transition-all duration-200",
                                  checkOutIso ? "border-[#02665e]/30 shadow-sm" : "border-slate-200 hover:border-[#02665e]/40",
                                  !checkInIso ? "opacity-40 cursor-not-allowed" : "",
                                ].join(" ")}
                              >
                                <div className="text-[10px] font-semibold uppercase tracking-widest text-[#02665e]/70 mb-0.5">Check-out</div>
                                <div className={["text-base font-bold", checkOutIso ? "text-slate-800" : "text-slate-400"].join(" ")}>
                                  {checkOutIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(checkOutIso)) : 'Add date'}
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
                    <div className="rounded-2xl border border-solid border-slate-200 bg-white p-5 sm:p-6 mb-4">
                      <div className="mb-4">
                        <SectionHeader Icon={Sparkles} title="Extras" hint="Optional. Pick anything you want owners to include in their offer." />
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
                  {/* 3-step mini guide */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {[
                      { n: '1', title: 'Download template', desc: 'Get the correct columns & formatting' },
                      { n: '2', title: 'Fill in Excel',     desc: "One passenger per row. Don't rename columns" },
                      { n: '3', title: 'Upload CSV',        desc: 'Export as CSV then upload below' },
                    ].map(({ n, title, desc }) => (
                      <div key={n} className="rounded-xl border border-solid border-slate-200 bg-white p-3 shadow-sm">
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
                    <div className="rounded-xl border border-solid border-slate-200 bg-white p-4 shadow-sm">
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
                    <div className="rounded-xl border border-solid border-slate-200 bg-white p-4 shadow-sm">
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
                    <div className="rounded-xl border border-solid border-slate-200 bg-white p-4 shadow-sm">
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
                                  return <td key={ci} className="px-3 py-2 text-slate-700 whitespace-nowrap">{r[key] ?? ''}</td>;
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
                          <span className="text-sm font-medium text-slate-900">{groupType || 'Not set'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Headcount</span>
                          <span className="text-sm font-medium text-slate-900">{headcount}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Accommodation</span>
                          <span className="text-sm font-medium text-slate-900">{accommodationType || 'Not set'}</span>
                        </div>
                        {accommodationType === 'hotel' ? (
                          <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                            <span className="text-xs text-slate-500">Hotel rating</span>
                            <span className="text-sm font-medium text-slate-900">{minHotelStarLabel || 'Not set'}</span>
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
                            {fromCountry ? COUNTRIES.find(c => c.value === fromCountry)?.label || fromCountry : 'Not set'}
                          </span>
                        </div>
                        {isTanzaniaSelected && (
                          <>
                            <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                              <span className="text-xs text-slate-500">Region</span>
                              <span className="text-sm font-medium text-slate-900">{fromRegion ? getRegionName(fromRegion) : 'Not set'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs text-slate-500">District</span>
                              <span className="text-sm font-medium text-slate-900">{fromDistrict || 'Not set'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                              <span className="text-xs text-slate-500">Ward</span>
                              <span className="text-sm font-medium text-slate-900">{fromWard || 'Not set'}</span>
                            </div>
                            <div className="flex justify-between items-center py-1">
                              <span className="text-xs text-slate-500">Location</span>
                              <span className="text-sm font-medium text-slate-900">{fromLocation || 'Not set'}</span>
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
                          <span className="text-sm font-medium text-slate-900">{toRegion ? getRegionName(toRegion) : 'Not set'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">District</span>
                          <span className="text-sm font-medium text-slate-900">{toDistrict || 'Not set'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1">
                          <span className="text-xs text-slate-500">Ward</span>
                          <span className="text-sm font-medium text-slate-900">{toWard || 'Not set'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Location</span>
                          <span className="text-sm font-medium text-slate-900">{toLocation || 'Not set'}</span>
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
                          <span className="text-sm font-medium text-slate-900">{checkInIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkInIso)) : 'Not set'}</span>
                        </div>
                        <div className="flex justify-between items-center py-1 bg-slate-50 px-2 rounded">
                          <span className="text-xs text-slate-500">Check-out</span>
                          <span className="text-sm font-medium text-slate-900">{checkOutIso ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(checkOutIso)) : 'Not set'}</span>
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

              {errors.length ? (
                <div role="alert" aria-live="assertive" className="mt-5 flex items-start gap-2.5 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-700">
                  <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
                  <div className="space-y-0.5">
                    {errors.map((er, i) => <div key={i}>{er}</div>)}
                  </div>
                </div>
              ) : null}

              {/* Action bar */}
              <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3 sm:px-5">
                <button
                  type="button"
                  onClick={() => goToStep(Math.max(1, currentStep - 1))}
                  suppressHydrationWarning disabled={currentStep === 1}
                  className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-transparent px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Back
                </button>

                {hasSavedDraft ? (
                  <span className="hidden items-center gap-2 text-[12px] text-slate-400 sm:inline-flex">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#02665e]" aria-hidden />
                    Draft saved on this device
                    <button
                      type="button"
                      onClick={clearSavedDraft}
                      aria-label="Clear saved draft"
                      title="Clear saved draft"
                      className="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-slate-400 transition hover:bg-rose-50 hover:text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </span>
                ) : null}

                {currentStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (!validateUpToStep(currentStep)) return;
                      goToStep(currentStep + 1);
                    }}
                    className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-full border-0 bg-[#02665e] px-6 text-sm font-bold text-white transition hover:bg-[#014d47]"
                  >
                    {currentStep === 3 && roster.length === 0 ? 'Skip for now' : 'Continue'}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { if (GATE_ENABLED) { setShowComingSoon(true); } else { _handleCreate(); } }}
                    suppressHydrationWarning disabled={isCreating || !isFormComplete()}
                    title={!isFormComplete() ? 'Fill in all required fields first' : ''}
                    className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full border-0 bg-[#02665e] px-6 text-sm font-bold text-white transition hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    {isCreating ? (
                      <>
                        <Spinner size="sm" ariaLabel="Sending your request" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Megaphone className="h-4 w-4" aria-hidden /> Send to owners
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

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
        </div>
      </div>
    </section>
  );
}
