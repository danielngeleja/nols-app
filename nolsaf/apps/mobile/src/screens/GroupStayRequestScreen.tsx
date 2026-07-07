import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Bus,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Coffee,
  Gavel,
  Info,
  MapPin,
  Megaphone,
  Minus,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Truck,
  Users,
  Wrench
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import {
  AppButton,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  BottomActionBar,
  CalendarRangeSheet,
  OptionPickerSheet,
  ResponsiveRow,
  SafeScreen,
  ScreenHeader,
  StateView
} from "../components";
import { ApiError } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import {
  ACCOMMODATION_TYPE_OPTIONS,
  ARRANGEMENT_OPTIONS,
  ArrangementKey,
  COUNTRY_OPTIONS,
  CreateGroupBookingInput,
  GENDER_OPTIONS,
  GROUP_TYPE_OPTIONS,
  HOTEL_STAR_OPTIONS,
  Passenger,
  REGION_OPTIONS,
  ROOM_SIZE_OPTIONS,
  createGroupBooking,
  getDistrictsFor,
  getStreetsFor,
  getWardsFor,
  recommendRoomSize
} from "../groupStays";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "GroupStayRequest">;

const STEP_LABELS = ["Details", "Accommodation", "Roster", "Review"];

const ARRANGEMENT_ICONS: Record<ArrangementKey, typeof Truck> = {
  pickup: Truck,
  transport: Bus,
  meals: Coffee,
  guide: Users,
  equipment: Wrench
};

type PickerKey =
  | "groupType"
  | "country"
  | "fromRegion"
  | "fromDistrict"
  | "fromWard"
  | "fromStreet"
  | "toRegion"
  | "toDistrict"
  | "toWard"
  | "toStreet"
  | "accommodationType"
  | "hotelStar"
  | "roomSize"
  | "gender";

function labelFor(options: { value: string; label: string }[], value: string) {
  return options.find((o) => o.value === value)?.label || "";
}

function prettyDate(ymd: string): string {
  if (!ymd) return "";
  const d = new Date(`${ymd}T00:00:00`);
  if (isNaN(d.getTime())) return ymd;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function Counter({ value, min = 0, max = 999, onChange }: { value: number; min?: number; max?: number; onChange: (next: number) => void }) {
  return (
    <View style={styles.counter}>
      <Pressable
        accessibilityRole="button"
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[styles.counterBtn, value <= min && styles.counterBtnOff]}
      >
        <Minus color={value <= min ? colors.softText : colors.primary} size={16} />
      </Pressable>
      <AppText variant="bodySmall" weight="bold" style={styles.counterValue}>
        {value}
      </AppText>
      <Pressable
        accessibilityRole="button"
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[styles.counterBtn, value >= max && styles.counterBtnOff]}
      >
        <Plus color={value >= max ? colors.softText : colors.primary} size={16} />
      </Pressable>
    </View>
  );
}

function SelectField({
  label,
  required,
  value,
  placeholder = "Select",
  disabled,
  onPress
}: {
  label: string;
  required?: boolean;
  value?: string;
  placeholder?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.fieldWrap}>
      <AppText variant="label" weight="semiBold" tone="muted">
        {label}
        {required ? (
          <AppText variant="label" weight="bold" tone="danger">
            {" *"}
          </AppText>
        ) : null}
      </AppText>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={[styles.selectInput, disabled && styles.selectInputDisabled]}
      >
        <AppText variant="bodySmall" tone={value ? "default" : "soft"} numberOfLines={1} style={styles.flex}>
          {value || placeholder}
        </AppText>
        <ChevronDown color={colors.softText} size={16} />
      </Pressable>
    </View>
  );
}

export function GroupStayRequestScreen({ navigation }: Props) {
  const { token } = useAuth();

  const [currentStep, setCurrentStep] = useState(1);
  const [activePicker, setActivePicker] = useState<PickerKey | null>(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);

  // Step 1: Details
  const [groupType, setGroupType] = useState("");
  const [fromCountry, setFromCountry] = useState("");
  const [fromRegion, setFromRegion] = useState("");
  const [fromDistrict, setFromDistrict] = useState("");
  const [fromWard, setFromWard] = useState("");
  const [fromLocation, setFromLocation] = useState("");
  const [toRegion, setToRegion] = useState("");
  const [toDistrict, setToDistrict] = useState("");
  const [toWard, setToWard] = useState("");
  const [toLocation, setToLocation] = useState("");

  // Step 2: Accommodation
  const [accommodationType, setAccommodationType] = useState("");
  const [minHotelStarLabel, setMinHotelStarLabel] = useState("");
  const [maleCount, setMaleCount] = useState(0);
  const [femaleCount, setFemaleCount] = useState(0);
  const [otherCount, setOtherCount] = useState(0);
  const [needsPrivateRoom, setNeedsPrivateRoom] = useState(false);
  const [privateRoomCount, setPrivateRoomCount] = useState(0);
  const [roomSize, setRoomSize] = useState(2);
  const [useDates, setUseDates] = useState(true);
  const [checkInIso, setCheckInIso] = useState("");
  const [checkOutIso, setCheckOutIso] = useState("");
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [arrPickup, setArrPickup] = useState(false);
  const [arrTransport, setArrTransport] = useState(false);
  const [arrMeals, setArrMeals] = useState(false);
  const [arrGuide, setArrGuide] = useState(false);
  const [arrEquipment, setArrEquipment] = useState(false);
  const [pickupLocation, setPickupLocation] = useState("");
  const [pickupTime, setPickupTime] = useState("");
  const [arrangementNotes, setArrangementNotes] = useState("");

  // Step 3: Roster
  const [roster, setRoster] = useState<Passenger[]>([]);
  const [showPassengerForm, setShowPassengerForm] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [pFirst, setPFirst] = useState("");
  const [pLast, setPLast] = useState("");
  const [pPhone, setPPhone] = useState("");
  const [pAge, setPAge] = useState("");
  const [pGender, setPGender] = useState("");
  const [pNationality, setPNationality] = useState("");

  // Submission
  const [errors, setErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);

  const arrangementValues: Record<ArrangementKey, [boolean, (v: boolean) => void]> = {
    pickup: [arrPickup, setArrPickup],
    transport: [arrTransport, setArrTransport],
    meals: [arrMeals, setArrMeals],
    guide: [arrGuide, setArrGuide],
    equipment: [arrEquipment, setArrEquipment]
  };

  const isTanzaniaSelected = fromCountry === "tanzania";
  const calculatedHeadcount = maleCount + femaleCount + otherCount;
  const roomsNeeded = Math.max(0, Math.ceil(calculatedHeadcount / (roomSize || 1)));
  const suggestedRoomSize = recommendRoomSize(groupType, accommodationType, calculatedHeadcount);

  const fromDistrictOptions = useMemo(() => getDistrictsFor(fromRegion).map((d) => ({ value: d, label: d })), [fromRegion]);
  const fromWardOptions = useMemo(
    () => getWardsFor(fromRegion, fromDistrict).map((w) => ({ value: w, label: w })),
    [fromRegion, fromDistrict]
  );
  const fromStreetOptions = useMemo(
    () => getStreetsFor(fromRegion, fromDistrict, fromWard).map((s) => ({ value: s, label: s })),
    [fromRegion, fromDistrict, fromWard]
  );
  const toDistrictOptions = useMemo(() => getDistrictsFor(toRegion).map((d) => ({ value: d, label: d })), [toRegion]);
  const toWardOptions = useMemo(() => getWardsFor(toRegion, toDistrict).map((w) => ({ value: w, label: w })), [toRegion, toDistrict]);
  const toStreetOptions = useMemo(
    () => getStreetsFor(toRegion, toDistrict, toWard).map((s) => ({ value: s, label: s })),
    [toRegion, toDistrict, toWard]
  );

  function validateStep(step: number): string[] {
    const e: string[] = [];
    if (step >= 1) {
      if (!groupType) e.push("Group type is required.");
      if (!fromCountry) e.push("Country is required.");
      if (!toRegion) e.push("Destination region is required.");
      if (!toDistrict) e.push("Destination district is required.");
      if (isTanzaniaSelected && !fromRegion) e.push("Region is required when Tanzania is selected.");
    }
    if (step >= 2) {
      if (!accommodationType) e.push("Accommodation type is required.");
      if (accommodationType === "hotel" && !minHotelStarLabel) e.push("Hotel rating is required when accommodation type is hotel.");
      if (calculatedHeadcount < 1) e.push("Headcount must be at least 1. Please specify at least one person in the gender breakdown.");
      if (needsPrivateRoom && privateRoomCount < 1) e.push("Please specify how many private rooms are needed.");
      if (useDates && (!checkInIso || !checkOutIso)) e.push("Please select check in and check out dates.");
      if (checkInIso && checkOutIso && checkInIso >= checkOutIso) e.push("Check out must be after check in.");
    }
    return e;
  }

  function goNext() {
    const e = validateStep(currentStep);
    setErrors(e);
    if (e.length > 0) return;
    setCurrentStep((s) => Math.min(4, s + 1));
  }

  function goBack() {
    setErrors([]);
    setCurrentStep((s) => Math.max(1, s - 1));
  }

  function resetPassengerForm() {
    setPFirst("");
    setPLast("");
    setPPhone("");
    setPAge("");
    setPGender("");
    setPNationality("");
    setEditingIndex(null);
    setShowPassengerForm(false);
  }

  function savePassenger() {
    if (!pFirst.trim() || !pLast.trim()) return;
    const passenger: Passenger = {
      firstname: pFirst.trim(),
      lastname: pLast.trim(),
      phone: pPhone.trim() || undefined,
      age: pAge.trim() || undefined,
      gender: pGender || undefined,
      nationality: pNationality.trim() || undefined
    };
    setRoster((prev) => {
      if (editingIndex != null) {
        const next = [...prev];
        next[editingIndex] = passenger;
        return next;
      }
      return [...prev, passenger];
    });
    resetPassengerForm();
  }

  function editPassenger(index: number) {
    const p = roster[index];
    setPFirst(p.firstname);
    setPLast(p.lastname);
    setPPhone(p.phone || "");
    setPAge(p.age || "");
    setPGender(p.gender || "");
    setPNationality(p.nationality || "");
    setEditingIndex(index);
    setShowPassengerForm(true);
  }

  function removePassenger(index: number) {
    setRoster((prev) => prev.filter((_, i) => i !== index));
  }

  async function submit() {
    const e = validateStep(2);
    setErrors(e);
    if (e.length > 0) {
      setCurrentStep(e.some((m) => m.includes("region") || m.includes("Region") || m.includes("Group") || m.includes("Country")) ? 1 : 2);
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload: CreateGroupBookingInput = {
        groupType: groupType as CreateGroupBookingInput["groupType"],
        fromCountry: fromCountry || null,
        fromRegion: isTanzaniaSelected ? fromRegion || null : null,
        fromDistrict: isTanzaniaSelected ? fromDistrict || null : null,
        fromWard: isTanzaniaSelected ? fromWard || null : null,
        fromLocation: isTanzaniaSelected ? fromLocation || null : null,
        toRegion,
        toDistrict: toDistrict || null,
        toWard: toWard || null,
        toLocation: toLocation || null,
        accommodationType,
        minHotelStarLabel: accommodationType === "hotel" ? (minHotelStarLabel as CreateGroupBookingInput["minHotelStarLabel"]) || null : null,
        headcount: calculatedHeadcount,
        maleCount: maleCount > 0 ? maleCount : null,
        femaleCount: femaleCount > 0 ? femaleCount : null,
        otherCount: otherCount > 0 ? otherCount : null,
        roomSize,
        roomsNeeded,
        needsPrivateRoom,
        privateRoomCount,
        checkin: useDates && checkInIso ? `${checkInIso}T00:00:00.000Z` : null,
        checkout: useDates && checkOutIso ? `${checkOutIso}T00:00:00.000Z` : null,
        useDates,
        arrangements: {
          pickup: arrPickup,
          transport: arrTransport,
          meals: arrMeals,
          guide: arrGuide,
          equipment: arrEquipment,
          pickupLocation: pickupLocation.trim() || null,
          pickupTime: pickupTime.trim() || null,
          notes: arrangementNotes.trim() || null
        },
        roster
      };

      await createGroupBooking(token, payload);
      setShowSuccess(true);
    } catch (err) {
      const api = err as ApiError;
      setErrors([api?.message || "Could not create your group stay request. Please try again."]);
    } finally {
      setSubmitting(false);
    }
  }

  const pickerConfig = useMemo(() => {
    switch (activePicker) {
      case "groupType":
        return { title: "Group type", options: GROUP_TYPE_OPTIONS, value: groupType, onSelect: setGroupType };
      case "country":
        return {
          title: "Country",
          options: COUNTRY_OPTIONS,
          value: fromCountry,
          onSelect: (v: string) => {
            setFromCountry(v);
            if (v !== "tanzania") {
              setFromRegion("");
              setFromDistrict("");
              setFromWard("");
              setFromLocation("");
            }
          }
        };
      case "fromRegion":
        return {
          title: "Region",
          options: REGION_OPTIONS,
          value: fromRegion,
          onSelect: (v: string) => {
            setFromRegion(v);
            setFromDistrict("");
            setFromWard("");
            setFromLocation("");
          }
        };
      case "fromDistrict":
        return {
          title: "District",
          options: fromDistrictOptions,
          value: fromDistrict,
          onSelect: (v: string) => {
            setFromDistrict(v);
            setFromWard("");
            setFromLocation("");
          }
        };
      case "fromWard":
        return {
          title: "Ward",
          options: fromWardOptions,
          value: fromWard,
          onSelect: (v: string) => {
            setFromWard(v);
            setFromLocation("");
          }
        };
      case "fromStreet":
        return { title: "Street", options: fromStreetOptions, value: fromLocation, onSelect: setFromLocation };
      case "toRegion":
        return {
          title: "Region",
          options: REGION_OPTIONS,
          value: toRegion,
          onSelect: (v: string) => {
            setToRegion(v);
            setToDistrict("");
            setToWard("");
            setToLocation("");
          }
        };
      case "toDistrict":
        return {
          title: "District",
          options: toDistrictOptions,
          value: toDistrict,
          onSelect: (v: string) => {
            setToDistrict(v);
            setToWard("");
            setToLocation("");
          }
        };
      case "toWard":
        return {
          title: "Ward",
          options: toWardOptions,
          value: toWard,
          onSelect: (v: string) => {
            setToWard(v);
            setToLocation("");
          }
        };
      case "toStreet":
        return { title: "Street", options: toStreetOptions, value: toLocation, onSelect: setToLocation };
      case "accommodationType":
        return {
          title: "Accommodation type",
          options: ACCOMMODATION_TYPE_OPTIONS,
          value: accommodationType,
          onSelect: (v: string) => {
            setAccommodationType(v);
            if (v !== "hotel") setMinHotelStarLabel("");
          }
        };
      case "hotelStar":
        return { title: "Hotel rating", options: HOTEL_STAR_OPTIONS, value: minHotelStarLabel, onSelect: setMinHotelStarLabel };
      case "roomSize":
        return { title: "Room size", options: ROOM_SIZE_OPTIONS, value: String(roomSize), onSelect: (v: string) => setRoomSize(Number(v)) };
      case "gender":
        return { title: "Gender", options: GENDER_OPTIONS, value: pGender, onSelect: setPGender };
      default:
        return null;
    }
  }, [
    activePicker,
    groupType,
    fromCountry,
    fromRegion,
    fromDistrict,
    fromWard,
    fromLocation,
    fromDistrictOptions,
    fromWardOptions,
    fromStreetOptions,
    toRegion,
    toDistrict,
    toWard,
    toLocation,
    toDistrictOptions,
    toWardOptions,
    toStreetOptions,
    accommodationType,
    minHotelStarLabel,
    roomSize,
    pGender
  ]);

  if (showSuccess) {
    return (
      <SafeScreen scroll={false}>
        <ScreenHeader title="Group stay request" onBack={() => navigation.goBack()} />
        <View style={styles.center}>
          <StateView
            title="Thank you for your group stay request"
            message="Our team will review your request and share suitable accommodation options. You can follow updates from My Group Stay."
            actionLabel="View my group stay"
            onAction={() => navigation.navigate("MyGroupStays")}
          />
          <AppButton title="Done" variant="ghost" onPress={() => navigation.goBack()} style={styles.doneButton} />
        </View>
      </SafeScreen>
    );
  }

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.body}>
        <ScreenHeader
          title="Request a group stay"
          subtitle="Share your group's details and let property owners bid for your stay with their best price. You pick the offer that excites you most."
          onBack={() => navigation.goBack()}
          action={
            currentStep === 1 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowHowItWorks((v) => !v)}
                style={[styles.infoButton, showHowItWorks && styles.infoButtonOn]}
              >
                <Info color={showHowItWorks ? colors.white : colors.primary} size={20} />
              </Pressable>
            ) : undefined
          }
        />

        {currentStep === 1 && showHowItWorks ? (
          <View style={styles.howItWorks}>
            <AppStack gap={3}>
              <View style={styles.howItWorksRow}>
                <Megaphone color={colors.primary} size={18} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  You post your group's trip details. No payment is needed to submit a request.
                </AppText>
              </View>
              <View style={styles.howItWorksRow}>
                <MapPin color={colors.primary} size={18} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  Only property owners in your chosen destination area see your request and can bid.
                </AppText>
              </View>
              <View style={styles.howItWorksRow}>
                <ShieldCheck color={colors.primary} size={18} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  NoLSAF screens every interested owner and shortlists only the best, most reliable offers for you.
                </AppText>
              </View>
              <View style={styles.howItWorksRow}>
                <Gavel color={colors.primary} size={18} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  Owners compete with their best price. You compare offers and pick the one that excites you most.
                </AppText>
              </View>
              <View style={styles.howItWorksRow}>
                <CheckCircle2 color={colors.primary} size={18} />
                <AppText variant="caption" tone="muted" style={styles.flex}>
                  To confirm your pick, pay a small non-refundable deposit. The remaining balance is settled on check-in day.
                </AppText>
              </View>
            </AppStack>
          </View>
        ) : null}

        <View style={styles.stepRow}>
          {STEP_LABELS.map((label, index) => {
            const step = index + 1;
            const active = step === currentStep;
            const done = step < currentStep;
            return (
              <View key={label} style={styles.stepItem}>
                <View style={[styles.stepDot, (active || done) && styles.stepDotOn]}>
                  <AppText variant="caption" weight="bold" tone={active || done ? "inverse" : "soft"}>
                    {step}
                  </AppText>
                </View>
                <AppText variant="caption" weight={active ? "bold" : "regular"} tone={active ? "primary" : "soft"} numberOfLines={1}>
                  {label}
                </AppText>
              </View>
            );
          })}
        </View>

        {currentStep === 1 ? (
          <AppStack gap={3}>
            <AppCard>
              <AppStack gap={3}>
                <AppText variant="label" weight="bold" tone="muted">
                  GROUP TYPE
                </AppText>
                <SelectField label="Group type" required value={labelFor(GROUP_TYPE_OPTIONS, groupType)} onPress={() => setActivePicker("groupType")} />
                <AppText variant="caption" tone="soft">
                  Students option is for school groups.
                </AppText>
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={3}>
                <AppText variant="label" weight="bold" tone="muted">
                  WHERE ARE YOU TRAVELLING FROM
                </AppText>
                <SelectField label="Country" required value={labelFor(COUNTRY_OPTIONS, fromCountry)} onPress={() => setActivePicker("country")} />
                {isTanzaniaSelected ? (
                  <>
                    <ResponsiveRow gap={3}>
                      <View style={styles.flex}>
                        <SelectField label="Region" required value={labelFor(REGION_OPTIONS, fromRegion)} onPress={() => setActivePicker("fromRegion")} />
                      </View>
                      <View style={styles.flex}>
                        <SelectField
                          label="District"
                          value={fromDistrict}
                          disabled={!fromRegion}
                          placeholder={fromRegion ? "Select" : "Select region first"}
                          onPress={() => setActivePicker("fromDistrict")}
                        />
                      </View>
                    </ResponsiveRow>
                    <ResponsiveRow gap={3}>
                      <View style={styles.flex}>
                        <SelectField
                          label="Ward"
                          value={fromWard}
                          disabled={!fromDistrict}
                          placeholder={fromDistrict ? "Select" : "Select district first"}
                          onPress={() => setActivePicker("fromWard")}
                        />
                      </View>
                      <View style={styles.flex}>
                        {fromStreetOptions.length === 0 ? (
                          <AppInput
                            label="Street"
                            value={fromLocation}
                            onChangeText={setFromLocation}
                            placeholder="e.g. Forodhani"
                            editable={!!fromWard}
                          />
                        ) : (
                          <SelectField label="Street" value={fromLocation} disabled={!fromWard} onPress={() => setActivePicker("fromStreet")} />
                        )}
                      </View>
                    </ResponsiveRow>
                  </>
                ) : null}
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={3}>
                <View>
                  <AppText variant="label" weight="bold" tone="muted">
                    WHERE ARE YOU GOING
                  </AppText>
                  <AppText variant="caption" tone="soft">
                    Region, district, ward and exact location of your stay.
                  </AppText>
                </View>
                <ResponsiveRow gap={3}>
                  <View style={styles.flex}>
                    <SelectField label="Region" required value={labelFor(REGION_OPTIONS, toRegion)} onPress={() => setActivePicker("toRegion")} />
                  </View>
                  <View style={styles.flex}>
                    <SelectField
                      label="District"
                      required
                      value={toDistrict}
                      disabled={!toRegion}
                      placeholder={toRegion ? "Select" : "Select region first"}
                      onPress={() => setActivePicker("toDistrict")}
                    />
                  </View>
                </ResponsiveRow>
                <ResponsiveRow gap={3}>
                  <View style={styles.flex}>
                    <SelectField
                      label="Ward"
                      value={toWard}
                      disabled={!toDistrict}
                      placeholder={toDistrict ? "Select" : "Select district first"}
                      onPress={() => setActivePicker("toWard")}
                    />
                  </View>
                  <View style={styles.flex}>
                    {toStreetOptions.length === 0 ? (
                      <AppInput label="Street" value={toLocation} onChangeText={setToLocation} placeholder="e.g. Nyerere Road" editable={!!toWard} />
                    ) : (
                      <SelectField label="Street" value={toLocation} disabled={!toWard} onPress={() => setActivePicker("toStreet")} />
                    )}
                  </View>
                </ResponsiveRow>
              </AppStack>
            </AppCard>
          </AppStack>
        ) : null}

        {currentStep === 2 ? (
          <AppStack gap={3}>
            <AppCard>
              <AppStack gap={3}>
                <AppText variant="label" weight="bold" tone="muted">
                  ACCOMMODATION
                </AppText>
                <AppText variant="caption" tone="soft">
                  Choose the style so we can recommend room sizes.
                </AppText>
                <SelectField
                  label="Accommodation type"
                  required
                  value={labelFor(ACCOMMODATION_TYPE_OPTIONS, accommodationType)}
                  onPress={() => setActivePicker("accommodationType")}
                />
                {accommodationType === "hotel" ? (
                  <SelectField
                    label="Hotel rating"
                    required
                    value={labelFor(HOTEL_STAR_OPTIONS, minHotelStarLabel)}
                    onPress={() => setActivePicker("hotelStar")}
                  />
                ) : null}
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={3}>
                <AppText variant="label" weight="bold" tone="muted">
                  HEADCOUNT
                </AppText>
                <View style={styles.counterRow}>
                  <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                    Male
                  </AppText>
                  <Counter value={maleCount} onChange={setMaleCount} />
                </View>
                <View style={styles.counterRow}>
                  <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                    Female
                  </AppText>
                  <Counter value={femaleCount} onChange={setFemaleCount} />
                </View>
                <View style={styles.counterRow}>
                  <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                    Other
                  </AppText>
                  <Counter value={otherCount} onChange={setOtherCount} />
                </View>
                <View style={styles.divider} />
                <View style={styles.counterRow}>
                  <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                    Total headcount
                  </AppText>
                  <AppText variant="titleSm" weight="extraBold" tone="primary">
                    {calculatedHeadcount}
                  </AppText>
                </View>
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={3}>
                <AppText variant="label" weight="bold" tone="muted">
                  ROOMS
                </AppText>
                <View>
                  <AppText variant="label" weight="semiBold" tone="muted" style={styles.toggleLabel}>
                    Do you need private rooms
                  </AppText>
                  <View style={styles.choiceRow}>
                    {[
                      { label: "Yes", value: true },
                      { label: "No", value: false }
                    ].map((option) => {
                      const active = needsPrivateRoom === option.value;
                      return (
                        <Pressable
                          key={option.label}
                          accessibilityRole="button"
                          onPress={() => setNeedsPrivateRoom(option.value)}
                          style={[styles.choiceCard, active && styles.choiceCardOn]}
                        >
                          <AppText variant="bodySmall" weight="bold" tone={active ? "inverse" : "default"}>
                            {option.label}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                {needsPrivateRoom ? (
                  <View style={styles.counterRow}>
                    <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                      Private rooms needed
                    </AppText>
                    <Counter value={privateRoomCount} min={0} onChange={setPrivateRoomCount} />
                  </View>
                ) : null}
                <SelectField label="Room size" required value={labelFor(ROOM_SIZE_OPTIONS, String(roomSize))} onPress={() => setActivePicker("roomSize")} />
                <AppText variant="caption" tone="soft">
                  Suggested room size for this group: {suggestedRoomSize} {suggestedRoomSize === 1 ? "person" : "people"} per room.
                </AppText>
                <View style={styles.counterRow}>
                  <AppText variant="bodySmall" weight="bold" style={styles.flex}>
                    Rooms needed
                  </AppText>
                  <AppText variant="titleSm" weight="extraBold" tone="primary">
                    {roomsNeeded}
                  </AppText>
                </View>
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={3}>
                <View style={styles.counterRow}>
                  <View style={styles.flex}>
                    <AppText variant="label" weight="bold" tone="muted">
                      DATES
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      Add your check in and check out dates.
                    </AppText>
                  </View>
                  <View style={styles.choiceRow}>
                    {[
                      { label: "Add dates", value: true },
                      { label: "Not yet", value: false }
                    ].map((option) => {
                      const active = useDates === option.value;
                      return (
                        <Pressable
                          key={option.label}
                          accessibilityRole="button"
                          onPress={() => setUseDates(option.value)}
                          style={[styles.choiceCardSm, active && styles.choiceCardOn]}
                        >
                          <AppText variant="caption" weight="bold" tone={active ? "inverse" : "default"}>
                            {option.label}
                          </AppText>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                {useDates ? (
                  <Pressable accessibilityRole="button" onPress={() => setCalendarVisible(true)} style={styles.dateButton}>
                    <View style={styles.rowIcon}>
                      <Calendar color={colors.primary} size={17} />
                    </View>
                    <View style={styles.flex}>
                      <AppText variant="bodySmall" weight="bold">
                        {checkInIso && checkOutIso ? `${prettyDate(checkInIso)} to ${prettyDate(checkOutIso)}` : "Choose check in and check out"}
                      </AppText>
                      <AppText variant="caption" tone="soft">
                        Tap to open calendar
                      </AppText>
                    </View>
                  </Pressable>
                ) : null}
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={3}>
                <View>
                  <AppText variant="label" weight="bold" tone="muted">
                    ARRANGEMENTS
                  </AppText>
                  <AppText variant="caption" tone="soft">
                    Optional add ons we can arrange for your group.
                  </AppText>
                </View>
                {ARRANGEMENT_OPTIONS.map((option) => {
                  const Icon = ARRANGEMENT_ICONS[option.key];
                  const [active, setActive] = arrangementValues[option.key];
                  return (
                    <Pressable
                      key={option.key}
                      accessibilityRole="button"
                      onPress={() => setActive(!active)}
                      style={[styles.arrangementRow, active && styles.arrangementRowOn]}
                    >
                      <View style={[styles.rowIcon, active && styles.rowIconOn]}>
                        <Icon color={active ? colors.white : colors.primary} size={17} />
                      </View>
                      <View style={styles.flex}>
                        <AppText variant="bodySmall" weight="bold">
                          {option.label}
                        </AppText>
                        <AppText variant="caption" tone="soft" numberOfLines={2}>
                          {option.description}
                        </AppText>
                      </View>
                      <View style={[styles.toggleDot, active && styles.toggleDotOn]} />
                    </Pressable>
                  );
                })}
                {arrPickup ? (
                  <ResponsiveRow gap={3}>
                    <View style={styles.flex}>
                      <AppInput label="Pickup location" value={pickupLocation} onChangeText={setPickupLocation} placeholder="e.g. JNIA airport" />
                    </View>
                    <View style={styles.flex}>
                      <AppInput label="Pickup time" value={pickupTime} onChangeText={setPickupTime} placeholder="e.g. Morning" />
                    </View>
                  </ResponsiveRow>
                ) : null}
                <AppInput
                  label="Notes (optional)"
                  value={arrangementNotes}
                  onChangeText={setArrangementNotes}
                  placeholder="Anything else we should know"
                  multiline
                  style={styles.notesInput}
                />
              </AppStack>
            </AppCard>
          </AppStack>
        ) : null}

        {currentStep === 3 ? (
          <AppStack gap={3}>
            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  PASSENGER ROSTER
                </AppText>
                <AppText variant="caption" tone="soft">
                  Optional. Add the people travelling in your group. You can add this information later.
                </AppText>
              </AppStack>
            </AppCard>

            {roster.map((p, index) => (
              <AppCard key={`${p.firstname}-${p.lastname}-${index}`}>
                <View style={styles.passengerRow}>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="bold">
                      {p.firstname} {p.lastname}
                    </AppText>
                    <AppText variant="caption" tone="soft" numberOfLines={1}>
                      {[p.phone, p.age ? `${p.age} years` : null, p.gender, p.nationality].filter(Boolean).join(" · ") || "No extra details"}
                    </AppText>
                  </View>
                  <Pressable accessibilityRole="button" onPress={() => editPassenger(index)} style={styles.iconButton}>
                    <Pencil color={colors.primary} size={16} />
                  </Pressable>
                  <Pressable accessibilityRole="button" onPress={() => removePassenger(index)} style={styles.iconButton}>
                    <Trash2 color={colors.danger} size={16} />
                  </Pressable>
                </View>
              </AppCard>
            ))}

            {showPassengerForm ? (
              <AppCard>
                <AppStack gap={3}>
                  <AppText variant="label" weight="bold" tone="muted">
                    {editingIndex != null ? "EDIT PASSENGER" : "ADD PASSENGER"}
                  </AppText>
                  <ResponsiveRow gap={3}>
                    <View style={styles.flex}>
                      <AppInput label="First name" required value={pFirst} onChangeText={setPFirst} placeholder="First name" autoCapitalize="words" />
                    </View>
                    <View style={styles.flex}>
                      <AppInput label="Last name" required value={pLast} onChangeText={setPLast} placeholder="Last name" autoCapitalize="words" />
                    </View>
                  </ResponsiveRow>
                  <ResponsiveRow gap={3}>
                    <View style={styles.flex}>
                      <AppInput label="Phone (optional)" value={pPhone} onChangeText={setPPhone} placeholder="07XXXXXXXX" keyboardType="phone-pad" />
                    </View>
                    <View style={styles.flex}>
                      <AppInput label="Age (optional)" value={pAge} onChangeText={setPAge} placeholder="Age" keyboardType="number-pad" />
                    </View>
                  </ResponsiveRow>
                  <ResponsiveRow gap={3}>
                    <View style={styles.flex}>
                      <SelectField label="Gender (optional)" value={pGender} onPress={() => setActivePicker("gender")} />
                    </View>
                    <View style={styles.flex}>
                      <AppInput label="Nationality (optional)" value={pNationality} onChangeText={setPNationality} placeholder="Tanzanian" autoCapitalize="words" />
                    </View>
                  </ResponsiveRow>
                  <View style={styles.choiceRow}>
                    <AppButton title="Cancel" variant="ghost" onPress={resetPassengerForm} style={styles.flex} />
                    <AppButton
                      title={editingIndex != null ? "Save changes" : "Add to roster"}
                      onPress={savePassenger}
                      disabled={!pFirst.trim() || !pLast.trim()}
                      style={styles.flex}
                    />
                  </View>
                </AppStack>
              </AppCard>
            ) : (
              <AppButton title="Add passenger" variant="secondary" onPress={() => setShowPassengerForm(true)} />
            )}
          </AppStack>
        ) : null}

        {currentStep === 4 ? (
          <AppStack gap={3}>
            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  GROUP DETAILS
                </AppText>
                <SummaryRow label="Group type" value={labelFor(GROUP_TYPE_OPTIONS, groupType)} />
                <SummaryRow label="Travelling from" value={labelFor(COUNTRY_OPTIONS, fromCountry)} />
                {isTanzaniaSelected ? (
                  <SummaryRow label="Origin" value={[labelFor(REGION_OPTIONS, fromRegion), fromDistrict, fromWard, fromLocation].filter(Boolean).join(", ")} />
                ) : null}
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  DESTINATION
                </AppText>
                <SummaryRow label="Region" value={labelFor(REGION_OPTIONS, toRegion)} />
                <SummaryRow label="District" value={toDistrict} />
                {toWard ? <SummaryRow label="Ward" value={toWard} /> : null}
                {toLocation ? <SummaryRow label="Street" value={toLocation} /> : null}
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  ACCOMMODATION AND ROOMS
                </AppText>
                <SummaryRow label="Accommodation type" value={labelFor(ACCOMMODATION_TYPE_OPTIONS, accommodationType)} />
                {accommodationType === "hotel" ? <SummaryRow label="Hotel rating" value={labelFor(HOTEL_STAR_OPTIONS, minHotelStarLabel)} /> : null}
                <SummaryRow label="Headcount" value={String(calculatedHeadcount)} />
                <SummaryRow label="Room size" value={labelFor(ROOM_SIZE_OPTIONS, String(roomSize))} />
                <SummaryRow label="Rooms needed" value={String(roomsNeeded)} />
                <SummaryRow label="Private rooms" value={needsPrivateRoom ? `Yes, ${privateRoomCount}` : "No"} />
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  DATES
                </AppText>
                <SummaryRow label="Check in" value={useDates && checkInIso ? prettyDate(checkInIso) : "Not set yet"} />
                <SummaryRow label="Check out" value={useDates && checkOutIso ? prettyDate(checkOutIso) : "Not set yet"} />
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  ARRANGEMENTS
                </AppText>
                {ARRANGEMENT_OPTIONS.map((option) => {
                  const [active] = arrangementValues[option.key];
                  return <SummaryRow key={option.key} label={option.label} value={active ? "Yes" : "No"} />;
                })}
                {arrPickup && pickupLocation ? <SummaryRow label="Pickup location" value={pickupLocation} /> : null}
                {arrPickup && pickupTime ? <SummaryRow label="Pickup time" value={pickupTime} /> : null}
                {arrangementNotes ? <SummaryRow label="Notes" value={arrangementNotes} /> : null}
              </AppStack>
            </AppCard>

            <AppCard>
              <AppStack gap={2}>
                <AppText variant="label" weight="bold" tone="muted">
                  PASSENGER ROSTER
                </AppText>
                {roster.length === 0 ? (
                  <AppText variant="caption" tone="soft">
                    No passengers added yet.
                  </AppText>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View>
                      <View style={styles.rosterRow}>
                        <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColName}>
                          Name
                        </AppText>
                        <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColGender}>
                          Gender
                        </AppText>
                        <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColAge}>
                          Age
                        </AppText>
                        <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColNationality}>
                          Nationality
                        </AppText>
                        <AppText variant="caption" weight="bold" tone="soft" style={styles.rosterColPhone}>
                          Phone
                        </AppText>
                      </View>
                      {roster.map((p, index) => (
                        <View key={`${p.firstname}-${index}`} style={[styles.rosterRow, styles.rosterRowData]}>
                          <AppText variant="bodySmall" weight="semiBold" numberOfLines={1} style={styles.rosterColName}>
                            {index + 1}. {p.firstname} {p.lastname}
                          </AppText>
                          <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColGender}>
                            {p.gender || "-"}
                          </AppText>
                          <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColAge}>
                            {p.age || "-"}
                          </AppText>
                          <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColNationality}>
                            {p.nationality || "-"}
                          </AppText>
                          <AppText variant="bodySmall" numberOfLines={1} style={styles.rosterColPhone}>
                            {p.phone || "-"}
                          </AppText>
                        </View>
                      ))}
                    </View>
                  </ScrollView>
                )}
              </AppStack>
            </AppCard>
          </AppStack>
        ) : null}

        {errors.length > 0 ? (
          <View style={styles.errorBox}>
            {errors.map((message) => (
              <AppText key={message} variant="caption" weight="semiBold" tone="danger">
                {message}
              </AppText>
            ))}
          </View>
        ) : null}
      </SafeScreen>

      <BottomActionBar>
        <View style={styles.barRow}>
          {currentStep > 1 ? <AppButton title="Back" variant="ghost" onPress={goBack} style={styles.flex} /> : null}
          {currentStep < 4 ? (
            <AppButton title="Next" onPress={goNext} style={styles.flex} />
          ) : (
            <AppButton title="Submit request" onPress={submit} loading={submitting} style={styles.flex} />
          )}
        </View>
      </BottomActionBar>

      <CalendarRangeSheet
        visible={calendarVisible}
        checkIn={checkInIso}
        checkOut={checkOutIso}
        onClose={() => setCalendarVisible(false)}
        onApply={(ci, co) => {
          setCheckInIso(ci);
          setCheckOutIso(co);
          setCalendarVisible(false);
        }}
      />

      {pickerConfig ? (
        <OptionPickerSheet
          visible={!!activePicker}
          title={pickerConfig.title}
          options={pickerConfig.options}
          value={pickerConfig.value}
          onSelect={pickerConfig.onSelect}
          onClose={() => setActivePicker(null)}
        />
      ) : null}
    </View>
  );
}

function SummaryRow({ label, value }: { label: string; value?: string }) {
  return (
    <View style={styles.summaryRow}>
      <AppText variant="caption" tone="soft" style={styles.flex}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="semiBold" numberOfLines={2} style={styles.summaryValue}>
        {value || "Not set"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface },
  body: { gap: spacing[3] },
  flex: { flex: 1, minWidth: 0 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing[3], padding: spacing[4] },
  doneButton: { alignSelf: "stretch" },
  howItWorks: {
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  howItWorksRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  infoButton: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  infoButtonOn: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  stepRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing[1] },
  stepItem: { flex: 1, alignItems: "center", gap: spacing[1] },
  stepDot: {
    width: 26,
    height: 26,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  stepDotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  fieldWrap: { gap: spacing[2], minWidth: 0 },
  selectInput: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  selectInputDisabled: { backgroundColor: colors.surface },
  counter: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  counterBtn: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  counterBtnOff: { backgroundColor: colors.surface, borderColor: colors.border },
  counterValue: { minWidth: 24, textAlign: "center" },
  counterRow: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  divider: { height: 1, backgroundColor: colors.border },
  toggleLabel: { marginBottom: spacing[2] },
  choiceRow: { flexDirection: "row", gap: spacing[2] },
  choiceCard: {
    flex: 1,
    alignItems: "center",
    paddingVertical: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  choiceCardSm: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  choiceCardOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  rowIconOn: { backgroundColor: colors.primary },
  arrangementRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  arrangementRowOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  toggleDot: { width: 14, height: 14, borderRadius: radius.full, borderWidth: 2, borderColor: colors.border },
  toggleDotOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  notesInput: { minHeight: 88, textAlignVertical: "top", paddingTop: spacing[3] },
  passengerRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border
  },
  summaryRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3] },
  summaryValue: { flex: 1, minWidth: 0, textAlign: "right" },
  rosterRow: { flexDirection: "row", alignItems: "center", gap: spacing[4], paddingVertical: spacing[2] },
  rosterRowData: { borderTopWidth: 1, borderTopColor: colors.border },
  rosterColName: { width: 160 },
  rosterColGender: { width: 70 },
  rosterColAge: { width: 50 },
  rosterColNationality: { width: 110 },
  rosterColPhone: { width: 120 },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.danger,
    backgroundColor: "#fef2f2",
    padding: spacing[3],
    gap: spacing[1]
  },
  barRow: { flexDirection: "row", gap: spacing[2] }
});
