import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Bus,
  Calculator,
  Calendar,
  ChevronDown,
  CheckCircle2,
  CircleDollarSign,
  Car,
  Landmark,
  Plane,
  Globe,
  MapPin,
  RefreshCw,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Umbrella,
  Users
} from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";

import {
  AppButton,
  AppCard,
  AppInput,
  AppStack,
  AppText,
  CalendarRangeSheet,
  CustomerBottomNav,
  OptionPickerSheet,
  SafeScreen,
  ScreenHeader
} from "../components";
import { getErrorMessage } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import {
  createNolScopeEstimate,
  fetchNolScopeActivities,
  fetchNolScopeDestinations,
  NolScopeActivity,
  NolScopeDestination,
  NolScopeDestinationInput,
  NolScopeEstimateResult
} from "../nolscope/api";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "CostCalculator">;
type Tier = "budget" | "standard" | "luxury";

const NATIONALITIES = [
  { code: "XX", label: "Other" },
  { code: "US", label: "United States" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "IT", label: "Italy" },
  { code: "ES", label: "Spain" },
  { code: "NL", label: "Netherlands" },
  { code: "SE", label: "Sweden" },
  { code: "NO", label: "Norway" },
  { code: "DK", label: "Denmark" },
  { code: "CH", label: "Switzerland" },
  { code: "AT", label: "Austria" },
  { code: "BE", label: "Belgium" },
  { code: "PT", label: "Portugal" },
  { code: "PL", label: "Poland" },
  { code: "CZ", label: "Czech Republic" },
  { code: "AU", label: "Australia" },
  { code: "NZ", label: "New Zealand" },
  { code: "CA", label: "Canada" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "CN", label: "China" },
  { code: "IN", label: "India" },
  { code: "ZA", label: "South Africa" },
  { code: "NG", label: "Nigeria" },
  { code: "KE", label: "Kenya" },
  { code: "UG", label: "Uganda" },
  { code: "RW", label: "Rwanda" },
  { code: "TZ", label: "Tanzania" },
  { code: "IL", label: "Israel" },
  { code: "SA", label: "Saudi Arabia" },
  { code: "AE", label: "UAE" },
  { code: "BR", label: "Brazil" },
  { code: "AR", label: "Argentina" },
  { code: "MX", label: "Mexico" }
];

const TIERS: Array<{ key: Tier; label: string; hint: string }> = [
  { key: "budget", label: "Budget", hint: "Guesthouses, practical routing, essential comfort" },
  { key: "standard", label: "Standard", hint: "Mid-range stays, smoother transfers, balanced comfort" },
  { key: "luxury", label: "Luxury", hint: "Premium lodges, private comfort, elevated logistics" }
];

const TRANSPORT_OPTIONS = [
  { key: "any", label: "Best available", hint: "NoLSCOPE chooses the sensible route mix.", Icon: Sparkles },
  { key: "shared-taxi", label: "Shared / public", hint: "Lower cost, less privacy, more fixed schedules.", Icon: Users },
  { key: "private-car", label: "Private vehicle", hint: "Flexible timing and direct transfers.", Icon: Car },
  { key: "bus", label: "Bus / ferry", hint: "Budget intercity movement where practical.", Icon: Bus },
  { key: "flight", label: "Charter / flight", hint: "Fastest option for long-distance legs.", Icon: Plane }
];

const QUICK_NATIONALITIES = ["TZ", "KE", "UG", "RW", "US", "GB"];

const fmtUSD = (value: number | null | undefined) =>
  `$${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const todayIso = () => new Date().toISOString().slice(0, 10);

function parsePositiveInt(value: string, fallback: number, min = 0, max = 30) {
  const n = Number.parseInt(value.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function CostCalculatorScreen({ navigation }: Props) {
  const [step, setStep] = useState(0);
  const [nationality, setNationality] = useState("TZ");
  const [nationalityOpen, setNationalityOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [startDate, setStartDate] = useState(todayIso());
  const [adults, setAdults] = useState("2");
  const [children, setChildren] = useState("0");
  const [destinationQuery, setDestinationQuery] = useState("");
  const [destinations, setDestinations] = useState<NolScopeDestination[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<NolScopeDestinationInput[]>([]);
  const [activities, setActivities] = useState<NolScopeActivity[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<string[]>([]);
  const [tier, setTier] = useState<Tier>("standard");
  const [transportPreference, setTransportPreference] = useState("any");
  const [result, setResult] = useState<NolScopeEstimateResult | null>(null);
  const [loadingDests, setLoadingDests] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;
    setLoadingDests(true);
    fetchNolScopeDestinations()
      .then((items) => {
        if (mounted) setDestinations(items);
      })
      .catch((err) => {
        if (mounted) setError(getErrorMessage(err, "Could not load NoLSCOPE destinations."));
      })
      .finally(() => {
        if (mounted) setLoadingDests(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!selectedDestinations.length) {
      setActivities([]);
      setSelectedActivities([]);
      return;
    }

    setLoadingActivities(true);
    Promise.all(selectedDestinations.map((item) => fetchNolScopeActivities(item.code).catch((): NolScopeActivity[] => [])))
      .then((groups) => {
        if (!mounted) return;
        const seen = new Map<string, NolScopeActivity>();
        groups.flat().forEach((item) => {
          const existing = seen.get(item.code);
          if (existing) {
            existing.destinationCodes = [...new Set([...(existing.destinationCodes ?? []), ...(item.destinationCodes ?? [])])];
          } else {
            seen.set(item.code, item);
          }
        });
        setActivities([...seen.values()]);
        setSelectedActivities((current) => current.filter((code) => seen.has(code)));
      })
      .finally(() => {
        if (mounted) setLoadingActivities(false);
      });
    return () => {
      mounted = false;
    };
  }, [selectedDestinations]);

  const totalDays = selectedDestinations.reduce((sum, item) => sum + item.days, 0);
  const adultCount = parsePositiveInt(adults, 1, 1, 20);
  const childCount = parsePositiveInt(children, 0, 0, 10);

  const destinationNames = useMemo(() => {
    const map = new Map(destinations.map((item) => [item.code, item.name]));
    return selectedDestinations.map((item) => map.get(item.code) ?? item.code);
  }, [destinations, selectedDestinations]);

  const selectedDestinationDetails = useMemo(() => {
    const map = new Map(destinations.map((item) => [item.code, item]));
    return selectedDestinations.map((item) => ({ ...item, destination: map.get(item.code) }));
  }, [destinations, selectedDestinations]);

  const activitiesByDestination = useMemo(() => {
    return selectedDestinationDetails.map((entry) => {
      const destinationActivities = activities.filter((activity) =>
        (activity.destinationCodes ?? (activity.destinationCode ? [activity.destinationCode] : [])).some(
          (code) => code.toUpperCase() === entry.code.toUpperCase()
        )
      );
      return { ...entry, activities: destinationActivities };
    });
  }, [activities, selectedDestinationDetails]);

  const filteredDestinations = useMemo(() => {
    const query = destinationQuery.trim().toLowerCase();
    const selectedCodes = new Set(selectedDestinations.map((item) => item.code));
    const list = destinations.filter((item) => !selectedCodes.has(item.code)).slice(0, 18);
    if (!query) return list;
    return list.filter((item) =>
      [item.name, item.country, item.destinationType, item.description ?? ""].some((value) =>
        String(value).toLowerCase().includes(query)
      )
    );
  }, [destinationQuery, destinations, selectedDestinations]);

  const canGoNext =
    step === 0
      ? Boolean(nationality && startDate && adultCount >= 1)
      : step === 1
        ? selectedDestinations.length > 0 && selectedDestinations.every((item) => item.days >= 1)
        : true;

  const selectedDestinationName = destinationNames[0] ?? "";
  const selectedNationality = NATIONALITIES.find((item) => item.code === nationality) ?? NATIONALITIES[0];
  const nationalityOptions = useMemo(
    () =>
      NATIONALITIES.map((item) => ({
        value: item.code,
        label: item.label,
        description: item.code === "XX" ? "Default NoLSCOPE visitor rate" : `Visa nationality code ${item.code}`
      })),
    []
  );

  const toggleDestination = (destination: NolScopeDestination) => {
    setSelectedDestinations((current) => {
      const exists = current.some((item) => item.code === destination.code);
      if (exists) return current.filter((item) => item.code !== destination.code);
      return [...current, { code: destination.code, days: Math.max(1, Number(destination.avgStayDays ?? 2) || 2) }];
    });
  };

  const updateDestinationDays = (code: string, next: number) => {
    setSelectedDestinations((current) =>
      current.map((item) => (item.code === code ? { ...item, days: Math.max(1, Math.min(30, next)) } : item))
    );
  };

  const toggleActivity = (code: string) => {
    setSelectedActivities((current) => (current.includes(code) ? current.filter((item) => item !== code) : [...current, code]));
  };

  const runEstimate = useCallback(async () => {
    setError("");
    setSubmitting(true);
    setResult(null);
    setStep(4);
    try {
      const estimate = await createNolScopeEstimate({
        nationality,
        destinations: selectedDestinations,
        startDate,
        travelers: { adults: adultCount, children: childCount },
        transportPreference,
        activities: selectedActivities,
        tier
      });
      setResult(estimate);
    } catch (err) {
      setError(getErrorMessage(err, "Could not prepare this NoLSCOPE cost calculation."));
      setStep(3);
    } finally {
      setSubmitting(false);
    }
  }, [adultCount, childCount, nationality, selectedActivities, selectedDestinations, startDate, tier, transportPreference]);

  const next = () => {
    if (step === 3) {
      runEstimate();
      return;
    }
    setStep((current) => Math.min(4, current + 1));
  };

  const restart = () => {
    setStep(0);
    setResult(null);
    setSelectedActivities([]);
    setSelectedDestinations([]);
    setTier("standard");
    setTransportPreference("any");
    setError("");
  };

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={5}>
          <ScreenHeader centered title="Cost calculator" subtitle="NoLSCOPE calculates verified stays, routes, activities and travel costs." />

          <View style={styles.hero}>
            <View style={styles.heroIcon}>
              <Calculator color={colors.white} size={26} />
            </View>
            <AppStack gap={2} style={styles.heroText}>
              <AppText variant="title" weight="extraBold" tone="inverse">
                Clear cost before you commit.
              </AppText>
              <AppText variant="bodySmall" tone="inverse" style={styles.heroCopy}>
                Powered by verified NoLSCOPE travel data.
              </AppText>
            </AppStack>
          </View>

          <StepIndicator step={step} />

          {error ? (
            <View style={styles.errorBox}>
              <AppText variant="caption" weight="semiBold" tone="danger">
                {error}
              </AppText>
            </View>
          ) : null}

          {step === 0 ? (
            <AppCard>
              <AppStack gap={4}>
                <SectionTitle icon={<Calendar color={colors.primary} size={20} />} title="Trip basics" />
                <View style={styles.labelBlock}>
                  <AppText variant="label" weight="semiBold" tone="muted">
                    Start date <AppText variant="label" weight="bold" tone="danger">*</AppText>
                  </AppText>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setDatePickerOpen(true)} style={styles.dateSelect}>
                  <View style={styles.nationalityIcon}>
                    <Calendar color={colors.primary} size={20} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="bold">
                      {formatPrettyDate(startDate)}
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      Travel start date
                    </AppText>
                  </View>
                  <View style={styles.selectCue}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      Pick
                    </AppText>
                    <ChevronDown color={colors.primary} size={17} />
                  </View>
                </Pressable>
                <View style={styles.twoColumns}>
                  <View style={styles.numberField}>
                    <AppInput label="Adults" required value={adults} onChangeText={setAdults} keyboardType="number-pad" />
                  </View>
                  <View style={styles.numberField}>
                    <AppInput label="Children" value={children} onChangeText={setChildren} keyboardType="number-pad" />
                  </View>
                </View>
                <View style={styles.labelBlock}>
                  <AppText variant="label" weight="semiBold" tone="muted">
                    Nationality <AppText variant="label" weight="bold" tone="danger">*</AppText>
                  </AppText>
                  <AppText variant="caption" tone="soft">
                    Used for visa and visitor-rate calculations.
                  </AppText>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setNationalityOpen(true)} style={styles.nationalitySelect}>
                  <View style={styles.nationalityIcon}>
                    <Globe color={colors.primary} size={20} />
                  </View>
                  <View style={styles.flex}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      Select nationality
                    </AppText>
                    <AppText variant="bodySmall" weight="bold">
                      {selectedNationality.label}
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      {selectedNationality.code === "XX" ? "Default visitor rate" : `Nationality code ${selectedNationality.code}`}
                    </AppText>
                  </View>
                  <View style={styles.selectCue}>
                    <AppText variant="caption" weight="bold" tone="primary">
                      Change
                    </AppText>
                    <ChevronDown color={colors.primary} size={17} />
                  </View>
                </Pressable>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.quickStrip}
                  style={styles.quickStripScroll}
                >
                  {QUICK_NATIONALITIES.map((code) => {
                    const item = NATIONALITIES.find((candidate) => candidate.code === code);
                    if (!item) return null;
                    return (
                      <ChoicePill
                        key={item.code}
                        active={nationality === item.code}
                        label={item.label}
                        onPress={() => setNationality(item.code)}
                      />
                    );
                  })}
                </ScrollView>
              </AppStack>
            </AppCard>
          ) : null}

          {step === 1 ? (
            <AppCard>
              <AppStack gap={4}>
                <SectionTitle icon={<MapPin color={colors.primary} size={20} />} title="Destinations" />
                <AppText variant="bodySmall" tone="muted">
                  Build your route, then adjust how many days you want in each place.
                </AppText>
                {selectedDestinationDetails.length ? (
                  <View style={styles.routePanel}>
                    <View style={styles.routeHeader}>
                      <View style={styles.flex}>
                        <AppText variant="caption" weight="bold" tone="primary">
                          SELECTED ROUTE
                        </AppText>
                        <AppText variant="caption" tone="soft">
                          Places move here after you add them.
                        </AppText>
                      </View>
                      <View style={styles.routeSummaryPill}>
                        <MapPin color={colors.primary} size={13} />
                        <AppText variant="caption" weight="bold" tone="primary">
                          {selectedDestinationDetails.length} place{selectedDestinationDetails.length === 1 ? "" : "s"}
                        </AppText>
                        <View style={styles.summaryDivider} />
                        <Calendar color={colors.primary} size={13} />
                        <AppText variant="caption" weight="bold" tone="primary">
                          {totalDays} day{totalDays === 1 ? "" : "s"}
                        </AppText>
                      </View>
                    </View>
                    <View style={styles.routeList}>
                      {selectedDestinationDetails.map((item, index) => (
                        <View key={item.code} style={styles.routeItem}>
                          <View style={styles.routePlaceRow}>
                            <View style={styles.routeIndex}>
                              <AppText variant="caption" weight="bold" tone="inverse">
                                {index + 1}
                              </AppText>
                            </View>
                            <View style={styles.flex}>
                              <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                                {item.destination?.name ?? item.code}
                              </AppText>
                              <AppText variant="caption" tone="soft" numberOfLines={1}>
                                {[item.destination?.country, item.destination?.destinationType ? cleanType(item.destination.destinationType) : ""]
                                  .filter(Boolean)
                                  .join(" - ")}
                              </AppText>
                            </View>
                          </View>
                          <View style={styles.durationPanel}>
                            <View style={styles.durationText}>
                              <AppText variant="caption" weight="bold" tone="primary">
                                Stay duration
                              </AppText>
                              <AppText variant="caption" tone="soft" numberOfLines={1}>
                                {item.destination?.avgStayDays
                                  ? `Recommended ${item.destination.avgStayDays} day${item.destination.avgStayDays === 1 ? "" : "s"}`
                                  : "Adjust days for this place"}
                              </AppText>
                            </View>
                            <View style={styles.durationStepper}>
                              <SmallButton label="-" onPress={() => updateDestinationDays(item.code, item.days - 1)} />
                              <View style={styles.durationValue}>
                                <AppText variant="bodySmall" weight="extraBold" tone="primary">
                                  {item.days}
                                </AppText>
                                <AppText variant="caption" weight="bold" tone="primary">
                                  days
                                </AppText>
                              </View>
                              <SmallButton label="+" onPress={() => updateDestinationDays(item.code, item.days + 1)} />
                            </View>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : (
                  <View style={styles.emptyRoute}>
                    <MapPin color={colors.primary} size={18} />
                    <AppText variant="caption" tone="muted" style={styles.flex}>
                      Add at least one destination to continue.
                    </AppText>
                  </View>
                )}
                <AppInput
                  label="Find a place"
                  value={destinationQuery}
                  onChangeText={setDestinationQuery}
                  placeholder="Search destination, region or type"
                />
                {loadingDests ? (
                  <LoadingRow label="Loading NoLSCOPE destinations..." />
                ) : filteredDestinations.length === 0 ? (
                  <AppText variant="bodySmall" tone="soft">
                    {destinationQuery.trim() ? "No destinations match that search." : "All visible destinations are already in your selected route."}
                  </AppText>
                ) : (
                  filteredDestinations.map((item) => {
                    const selected = selectedDestinations.find((dest) => dest.code === item.code);
                    return (
                      <Pressable key={item.code} onPress={() => toggleDestination(item)} style={[styles.destinationOption, selected && styles.destinationOptionActive]}>
                        <View style={[styles.placeMark, selected && styles.placeMarkActive]}>
                          {selected ? <CheckCircle2 color={colors.white} size={16} /> : <MapPin color={colors.primary} size={16} />}
                        </View>
                        <View style={styles.flex}>
                          <AppText variant="bodySmall" weight="bold" numberOfLines={1}>
                            {item.name}
                          </AppText>
                          <AppText variant="caption" tone="soft" numberOfLines={1}>
                            {[item.country, cleanType(item.destinationType)].filter(Boolean).join(" - ")}
                          </AppText>
                          {item.avgStayDays ? (
                            <DurationBadge label={`Typical ${item.avgStayDays} day${item.avgStayDays === 1 ? "" : "s"}`} />
                          ) : null}
                        </View>
                        <View style={[styles.addPill, selected && styles.addPillActive]}>
                          <AppText variant="caption" weight="bold" tone={selected ? "primary" : "soft"}>
                            {selected ? "Added" : "Add"}
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  })
                )}
              </AppStack>
            </AppCard>
          ) : null}

          {step === 2 ? (
            <AppCard>
              <AppStack gap={4}>
                <SectionTitle icon={<Sparkles color={colors.primary} size={20} />} title="Activities" />
                <AppText variant="bodySmall" tone="muted">
                  Optional. Select activities to include in the verified cost.
                </AppText>
                {loadingActivities ? (
                  <LoadingRow label="Loading destination activities..." />
                ) : activities.length ? (
                  <View style={styles.activityGroups}>
                    {activitiesByDestination.map((group) => (
                      <View key={group.code} style={styles.activityGroup}>
                        <View style={styles.activityGroupHeader}>
                          <View style={styles.activityGroupIcon}>
                            <MapPin color={colors.white} size={16} />
                          </View>
                          <View style={styles.flex}>
                            <AppText variant="bodySmall" weight="bold" tone="inverse" numberOfLines={1}>
                              {group.destination?.name ?? group.code}
                            </AppText>
                            <AppText variant="caption" tone="inverse" style={styles.activityGroupMeta} numberOfLines={1}>
                              {group.activities.length} activit{group.activities.length === 1 ? "y" : "ies"} available
                            </AppText>
                            <AppText variant="caption" tone="inverse" style={styles.activityGroupHelp} numberOfLines={2}>
                              Select what you plan to do here so NoLSCOPE includes those activity costs.
                            </AppText>
                          </View>
                        </View>
                        {group.activities.length ? (
                          <View style={styles.activityList}>
                            {group.activities.map((activity) => (
                              <ActivityOption
                                key={`${group.code}-${activity.code}`}
                                activity={activity}
                                active={selectedActivities.includes(activity.code)}
                                onPress={() => toggleActivity(activity.code)}
                              />
                            ))}
                          </View>
                        ) : (
                          <View style={styles.noActivities}>
                            <AppText variant="caption" tone="soft">
                              No optional activities are listed for this destination yet.
                            </AppText>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                ) : (
                  <AppText variant="bodySmall" tone="soft">
                    Select at least one destination to load activity options.
                  </AppText>
                )}
              </AppStack>
            </AppCard>
          ) : null}

          {step === 3 ? (
            <AppCard>
              <AppStack gap={4}>
                <SectionTitle icon={<ShieldCheck color={colors.primary} size={20} />} title="Style and transport" />
                <AppText variant="bodySmall" tone="muted">
                  This profile changes accommodation assumptions, transfer comfort and the verified cost calculation.
                </AppText>

                <View style={styles.profileSection}>
                  <View style={styles.profileSectionHeader}>
                    <AppText variant="caption" weight="extraBold" tone="primary">
                      TRAVEL STYLE
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      Choose the comfort level for stays and services.
                    </AppText>
                  </View>
                  <View style={styles.styleGrid}>
                    {TIERS.map((item) => (
                      <TravelStyleCard
                        key={item.key}
                        active={tier === item.key}
                        title={item.label}
                        subtitle={item.hint}
                        onPress={() => setTier(item.key)}
                      />
                    ))}
                  </View>
                </View>

                <View style={styles.profileSection}>
                  <View style={styles.profileSectionHeader}>
                    <AppText variant="caption" weight="extraBold" tone="primary">
                      MOVEMENT BETWEEN DESTINATIONS
                    </AppText>
                    <AppText variant="caption" tone="soft">
                      Select how transport should be priced between route stops.
                    </AppText>
                  </View>
                  <View style={styles.transportList}>
                    {TRANSPORT_OPTIONS.map((item) => (
                      <TransportPreferenceCard
                        key={item.key}
                        active={transportPreference === item.key}
                        title={item.label}
                        subtitle={item.hint}
                        Icon={item.Icon}
                        onPress={() => setTransportPreference(item.key)}
                      />
                    ))}
                  </View>
                </View>
              </AppStack>
            </AppCard>
          ) : null}

          {step === 4 && submitting && !result ? (
            <CalculatingPanel />
          ) : null}

          {step === 4 && result ? (
            <AppStack gap={4}>
              <View style={styles.resultHero}>
                <View style={styles.resultHeroIcon}>
                  <ReceiptText color={colors.white} size={24} />
                </View>
                <AppText variant="caption" weight="extraBold" tone="inverse" style={styles.resultEyebrow}>
                  VERIFIED NOLSCOPE COST
                </AppText>
                <AppText variant="display" weight="extraBold" tone="inverse" style={styles.resultTotal}>
                  {fmtUSD(result.totalAvg)}
                </AppText>
                <AppText variant="bodySmall" tone="inverse" style={styles.resultRange}>
                  Verified range {fmtUSD(result.totalMin)} - {fmtUSD(result.totalMax)}
                </AppText>
                <View style={styles.resultStats}>
                  <ResultStat label="Travelers" value={`${result.travelers.total}`} />
                  <ResultStat label="Days" value={`${result.totalDays}`} />
                  <ResultStat label="Per adult" value={fmtUSD(result.perAdultAvg)} />
                </View>
              </View>

              <AppCard>
                <AppStack gap={4}>
                  <SectionTitle icon={<Sparkles color={colors.primary} size={20} />} title="Cost breakdown" />
                  <AppText variant="bodySmall" tone="muted">
                    Organized by what usually drives the trip cost first.
                  </AppText>
                  <View style={styles.breakdownGrid}>
                    <BreakdownTile label="Accommodation" amount={result.breakdown.accommodation.total} Icon={BedDouble} featured />
                    <BreakdownTile label="Transport" amount={result.breakdown.transport.total} Icon={Car} featured />
                    <BreakdownTile label="Activities" amount={result.breakdown.activities.total} Icon={Sparkles} />
                    <BreakdownTile label="Park fees" amount={result.breakdown.parkFees.total} Icon={Landmark} />
                    <BreakdownTile label="Visa fees" amount={result.breakdown.visa.total} Icon={ReceiptText} />
                    <BreakdownTile label="Insurance" amount={result.breakdown.travelInsurance.total} Icon={Umbrella} />
                    <BreakdownTile label="Tips" amount={result.breakdown.tips.total} Icon={Users} />
                    <BreakdownTile label="Service charge" amount={result.breakdown.serviceCharge.total} Icon={CircleDollarSign} />
                  </View>
                </AppStack>
              </AppCard>

              <AppCard tone="warning">
                <AppStack gap={3}>
                  <View style={styles.rowStart}>
                    <ShieldCheck color={colors.warning} size={18} />
                    <AppText variant="bodySmall" weight="bold">
                      Verified cost calculation
                    </AppText>
                  </View>
                  <AppText variant="caption" tone="muted">
                    Rates are sourced from official and operator-verified data maintained by the NoLSAF Research Team.
                    You can move forward with price confidence because this is the cost basis used for booking, subject only
                    to live availability and exchange-rate changes.
                  </AppText>
                  <View style={styles.trustFacts}>
                    <TrustFact label="Confidence" value={`${Math.round((result.confidence ?? 0) * 100)}%`} />
                    <TrustFact label="Last updated" value={formatFreshDate(result.dataFreshness?.lastUpdatedAt)} />
                  </View>
                  {result.estimateId ? (
                    <AppText variant="caption" weight="semiBold" tone="primary">
                      Ref: EST-{result.estimateId}
                    </AppText>
                  ) : null}
                </AppStack>
              </AppCard>

              <AppCard>
                <AppStack gap={3}>
                  <SectionTitle icon={<ArrowRight color={colors.primary} size={20} />} title="Continue with NoLSAF" />
                  <AppText variant="bodySmall" tone="muted">
                    Your route can connect stays, tours, group stay requests and rides into the booking flow, then payment
                    continues through the invoice.
                  </AppText>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.serviceRail}>
                    <ServiceCard
                      title="Verified stays"
                      subtitle="Hotels, lodges and approved properties"
                      Icon={BedDouble}
                      onPress={() => navigation.navigate("VerifiedStays", undefined)}
                    />
                    <ServiceCard
                      title="Tour packages"
                      subtitle="Operators and guided experiences"
                      Icon={Sparkles}
                      onPress={() => navigation.navigate("TourPackages")}
                    />
                    <ServiceCard
                      title="Group stays"
                      subtitle="Create a request and let properties bid"
                      Icon={Users}
                      onPress={() => navigation.navigate("GroupStayRequest")}
                    />
                    <ServiceCard
                      title="Ride"
                      subtitle="Attach transport to the same route"
                      Icon={Car}
                      onPress={() => navigation.navigate("MyRides")}
                    />
                  </ScrollView>
                </AppStack>
              </AppCard>

              <View style={styles.actions}>
                <AppButton title="Browse stays near this route" icon={<ArrowRight color={colors.white} size={18} />} onPress={() => navigation.navigate("Search", { destination: selectedDestinationName, filter: "stays" })} />
                <AppButton title="New calculation" variant="ghost" icon={<RefreshCw color={colors.primary} size={18} />} onPress={restart} />
              </View>
            </AppStack>
          ) : null}

          {step < 4 ? (
            <View style={styles.actions}>
              {step > 0 ? (
                <AppButton title="Back" variant="ghost" icon={<ArrowLeft color={colors.primary} size={18} />} onPress={() => setStep((current) => Math.max(0, current - 1))} />
              ) : null}
              <AppButton
                title={step === 3 ? "Calculate cost" : "Continue"}
                loading={submitting}
                disabled={!canGoNext || loadingDests}
                icon={<ArrowRight color={colors.white} size={18} />}
                onPress={next}
              />
            </View>
          ) : null}

          <AppText variant="caption" tone="soft" style={styles.footerNote}>
            NoLSCOPE provides verified travel cost calculations from official and operator-confirmed sources. Booking and payment continue through NoLSAF booking flows.
          </AppText>
        </AppStack>
      </SafeScreen>

      <OptionPickerSheet
        visible={nationalityOpen}
        title="Select nationality"
        subtitle="Matches the NoLSCOPE web estimator nationality list."
        options={nationalityOptions}
        value={nationality}
        onSelect={setNationality}
        onClose={() => setNationalityOpen(false)}
      />
      <CalendarRangeSheet
        visible={datePickerOpen}
        checkIn={startDate}
        checkOut={startDate}
        mode="single"
        title="Select start date"
        onClose={() => setDatePickerOpen(false)}
        onApply={(date) => {
          setStartDate(date);
          setDatePickerOpen(false);
        }}
      />

      <CustomerBottomNav active="CostCalculator" />
    </View>
  );
}

function cleanType(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatPrettyDate(value: string) {
  if (!value) return "Select date";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function formatFreshDate(value: string | null | undefined) {
  if (!value) return "Verified source";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Verified source";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <View style={styles.rowStart}>
      {icon}
      <AppText variant="titleSm" weight="bold">
        {title}
      </AppText>
    </View>
  );
}

function TrustFact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.trustFact}>
      <AppText variant="caption" weight="bold" tone="warning">
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="extraBold">
        {value}
      </AppText>
    </View>
  );
}

function ServiceCard({
  title,
  subtitle,
  Icon,
  onPress
}: {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.serviceCard}>
      <View style={styles.serviceIcon}>
        <Icon color={colors.white} size={20} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
          {title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
      <View style={styles.serviceArrow}>
        <ArrowRight color={colors.primary} size={16} />
      </View>
    </Pressable>
  );
}

function LoadingRow({ label }: { label: string }) {
  return (
    <View style={styles.loadingRow}>
      <ActivityIndicator color={colors.primary} />
      <AppText variant="bodySmall" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

function StepIndicator({ step }: { step: number }) {
  const labels = ["Basics", "Places", "Activities", "Style", "Estimate"];
  return (
    <View style={styles.stepRow}>
      {labels.map((label, index) => (
        <View key={label} style={[styles.stepPill, index === step && styles.stepPillActive, index < step && styles.stepPillDone]}>
          <AppText variant="caption" weight="bold" tone={index === step ? "inverse" : index < step ? "primary" : "soft"}>
            {index + 1}. {label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function ChoicePill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.choicePill, active && styles.choicePillActive]}>
      <AppText variant="caption" weight="semiBold" tone={active ? "primary" : "muted"} numberOfLines={2}>
        {label}
      </AppText>
    </Pressable>
  );
}

function OptionCard({ title, subtitle, active, onPress }: { title: string; subtitle: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.optionCard, active && styles.activeCard]}>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="bold">
          {title}
        </AppText>
        <AppText variant="caption" tone="soft">
          {subtitle}
        </AppText>
      </View>
      {active ? <CheckCircle2 color={colors.primary} size={20} /> : null}
    </Pressable>
  );
}

function TravelStyleCard({ title, subtitle, active, onPress }: { title: string; subtitle: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.travelStyleCard, active && styles.travelStyleCardActive]}>
      <View style={styles.travelStyleTop}>
        <View style={[styles.travelStyleMark, active && styles.travelStyleMarkActive]}>
          {active ? <CheckCircle2 color={colors.white} size={16} /> : <ShieldCheck color={colors.primary} size={16} />}
        </View>
        {active ? (
          <View style={styles.activeChoicePill}>
            <AppText variant="caption" weight="extraBold" tone="primary">
              SELECTED
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="bodySmall" weight="extraBold">
        {title}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={3}>
        {subtitle}
      </AppText>
    </Pressable>
  );
}

function TransportPreferenceCard({
  title,
  subtitle,
  Icon,
  active,
  onPress
}: {
  title: string;
  subtitle: string;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.transportCard, active && styles.transportCardActive]}>
      <View style={[styles.transportRadio, active && styles.transportRadioActive]}>
        {active ? <CheckCircle2 color={colors.white} size={15} /> : <Icon color={colors.primary} size={16} />}
      </View>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="bold">
          {title}
        </AppText>
        <AppText variant="caption" tone="soft" numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
    </Pressable>
  );
}

function SmallButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.smallButton}>
      <AppText variant="bodySmall" weight="bold" tone="primary">
        {label}
      </AppText>
    </Pressable>
  );
}

function DurationBadge({ label }: { label: string }) {
  return (
    <View style={styles.durationBadge}>
      <Calendar color={colors.primary} size={12} />
      <AppText variant="caption" weight="bold" tone="primary" numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

function ActivityOption({
  activity,
  active,
  onPress
}: {
  activity: NolScopeActivity;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.activityOption, active && styles.activityOptionActive]}>
      <View style={[styles.activityCheck, active && styles.activityCheckActive]}>
        {active ? <CheckCircle2 color={colors.white} size={15} /> : <Sparkles color={colors.primary} size={15} />}
      </View>
      <View style={styles.flex}>
        {active ? (
          <View style={styles.selectedMiniBadge}>
            <AppText variant="caption" weight="extraBold" tone="primary">
              SELECTED
            </AppText>
          </View>
        ) : null}
        <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
          {activity.name}
        </AppText>
        {activity.category ? (
          <AppText variant="caption" tone="soft" numberOfLines={1}>
            {cleanType(activity.category)}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.activityPrice, active && styles.activityPriceActive]}>
        <AppText variant="caption" weight="extraBold" tone="primary">
          {activity.basePrice ? fmtUSD(activity.basePrice) : "Included"}
        </AppText>
        {!active ? (
          <AppText variant="caption" weight="bold" tone="soft">
            Add
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

function CalculatingPanel() {
  return (
    <AppCard tone="brand">
      <AppStack gap={4}>
        <View style={styles.calculatingIcon}>
          <Calculator color={colors.white} size={26} />
        </View>
        <AppText variant="title" weight="extraBold" tone="inverse" style={styles.centerText}>
          Calculating verified cost
        </AppText>
        <AppText variant="bodySmall" tone="inverse" style={[styles.centerText, styles.calculatingCopy]}>
          NoLSCOPE is matching your route, travel style, activities, accommodation assumptions and official rate data.
        </AppText>
        <View style={styles.calculationSteps}>
          <CalculationStep label="Checking destination route" />
          <CalculationStep label="Applying activity and park rates" />
          <CalculationStep label="Preparing final cost basis" />
        </View>
      </AppStack>
    </AppCard>
  );
}

function CalculationStep({ label }: { label: string }) {
  return (
    <View style={styles.calculationStep}>
      <View style={styles.calculationDot} />
      <AppText variant="caption" weight="semiBold" tone="inverse" style={styles.calculationStepText}>
        {label}
      </AppText>
    </View>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.resultStat}>
      <AppText variant="caption" tone="inverse" style={styles.resultStatLabel}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="extraBold" tone="inverse">
        {value}
      </AppText>
    </View>
  );
}

function BreakdownTile({
  label,
  amount,
  Icon,
  featured
}: {
  label: string;
  amount: number;
  Icon: React.ComponentType<{ color?: string; size?: number }>;
  featured?: boolean;
}) {
  return (
    <View style={[styles.breakdownTile, featured && styles.breakdownTileFeatured]}>
      <View style={[styles.breakdownIcon, featured && styles.breakdownIconFeatured]}>
        <Icon color={featured ? colors.white : colors.primary} size={18} />
      </View>
      <View style={styles.flex}>
        <AppText variant="caption" weight="bold" tone={featured ? "primary" : "muted"} numberOfLines={1}>
          {label}
        </AppText>
        <AppText variant="bodySmall" weight="extraBold">
        {fmtUSD(amount)}
      </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    paddingBottom: spacing[4]
  },
  hero: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    padding: spacing[5],
    overflow: "hidden"
  },
  heroIcon: {
    width: 58,
    height: 58,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  heroText: {
    flex: 1
  },
  heroCopy: {
    color: "#d8e7e4"
  },
  rowStart: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  centerText: {
    textAlign: "center"
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  twoColumns: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3],
    minWidth: 0
  },
  numberField: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 150,
    minWidth: 0
  },
  wrapRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  labelBlock: {
    gap: spacing[1]
  },
  nationalitySelect: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  dateSelect: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  nationalityIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  selectCue: {
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
  quickStripScroll: {
    marginHorizontal: -spacing[1]
  },
  quickStrip: {
    flexDirection: "row",
    gap: spacing[2],
    paddingHorizontal: spacing[1],
    paddingRight: spacing[5]
  },
  choicePill: {
    maxWidth: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.full,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  choicePillActive: {
    borderColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  stepRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  stepPill: {
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  stepPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  stepPillDone: {
    backgroundColor: colors.brand[50],
    borderColor: colors.brand[100]
  },
  routePanel: {
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    borderRadius: radius.lg,
    padding: spacing[3],
    gap: spacing[3]
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  routeSummaryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    flexShrink: 0
  },
  summaryDivider: {
    width: 1,
    height: 14,
    backgroundColor: colors.brand[100],
    marginHorizontal: spacing[1]
  },
  routeList: {
    gap: spacing[2]
  },
  routeItem: {
    minWidth: 0,
    gap: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[3]
  },
  routePlaceRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  routeIndex: {
    width: 28,
    height: 28,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  durationPanel: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[2]
  },
  durationText: {
    flex: 1,
    minWidth: 0,
    gap: 1
  },
  durationStepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing[1],
    flexShrink: 0
  },
  durationValue: {
    minWidth: 42,
    alignItems: "center",
    justifyContent: "center"
  },
  emptyRoute: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    padding: spacing[3]
  },
  destinationOption: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing[3]
  },
  destinationOptionActive: {
    borderColor: colors.brand[200],
    backgroundColor: colors.brand[50]
  },
  activeCard: {
    borderColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  placeMark: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  placeMarkActive: {
    backgroundColor: colors.primary
  },
  addPill: {
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1]
  },
  addPillActive: {
    backgroundColor: colors.white,
    borderColor: colors.brand[100]
  },
  dayControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: radius.md,
    backgroundColor: colors.white,
    padding: spacing[2]
  },
  smallButton: {
    width: 38,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  durationBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[200],
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    marginTop: spacing[1]
  },
  activityGroups: {
    gap: spacing[4]
  },
  activityGroup: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  activityGroupHeader: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    backgroundColor: colors.primaryDeep,
    borderBottomWidth: 1,
    borderBottomColor: colors.primary,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[4]
  },
  activityGroupIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)"
  },
  activityGroupMeta: {
    color: "rgba(255,255,255,0.72)"
  },
  activityGroupHelp: {
    color: "rgba(255,255,255,0.62)",
    marginTop: spacing[1]
  },
  activityList: {
    padding: spacing[2],
    gap: spacing[2]
  },
  activityOption: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    borderLeftWidth: 4,
    borderLeftColor: colors.border
  },
  activityOptionActive: {
    borderColor: colors.primary,
    borderLeftColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  activityCheck: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  activityCheckActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  activityPrice: {
    flexShrink: 0,
    alignItems: "center",
    gap: 1,
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  activityPriceActive: {
    backgroundColor: colors.white,
    borderColor: colors.primary
  },
  selectedMiniBadge: {
    alignSelf: "flex-start",
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    marginBottom: spacing[1]
  },
  noActivities: {
    padding: spacing[3]
  },
  profileSection: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  profileSectionHeader: {
    gap: spacing[1]
  },
  styleGrid: {
    gap: spacing[3]
  },
  travelStyleCard: {
    minWidth: 0,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderLeftWidth: 4,
    borderColor: colors.border,
    borderLeftColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3],
    gap: spacing[2]
  },
  travelStyleCardActive: {
    borderColor: colors.primary,
    borderLeftColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  travelStyleTop: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2]
  },
  travelStyleMark: {
    width: 34,
    height: 34,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  travelStyleMarkActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  activeChoicePill: {
    borderRadius: radius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  transportList: {
    gap: spacing[2]
  },
  transportCard: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  transportCardActive: {
    borderColor: colors.primary,
    backgroundColor: colors.brand[50]
  },
  transportRadio: {
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  transportRadioActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary
  },
  optionCard: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    backgroundColor: colors.brand[50],
    padding: spacing[3]
  },
  errorBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fef2f2",
    padding: spacing[3]
  },
  calculatingIcon: {
    alignSelf: "center",
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.24)"
  },
  calculatingCopy: {
    color: "rgba(255,255,255,0.78)"
  },
  calculationSteps: {
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: spacing[3]
  },
  calculationStep: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  calculationDot: {
    width: 8,
    height: 8,
    borderRadius: radius.full,
    backgroundColor: colors.brand[300]
  },
  calculationStepText: {
    color: "rgba(255,255,255,0.78)"
  },
  resultHero: {
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    borderWidth: 1,
    borderColor: colors.primaryDark,
    padding: spacing[5],
    overflow: "hidden",
    ...shadows.card
  },
  resultHeroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)"
  },
  resultEyebrow: {
    letterSpacing: 0
  },
  resultTotal: {
    textAlign: "center"
  },
  resultRange: {
    color: "rgba(255,255,255,0.72)",
    textAlign: "center"
  },
  resultStats: {
    alignSelf: "stretch",
    flexDirection: "row",
    gap: spacing[2]
  },
  resultStat: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: spacing[3]
  },
  resultStatLabel: {
    color: "rgba(255,255,255,0.65)"
  },
  breakdownGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[3]
  },
  breakdownTile: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 145,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing[3]
  },
  breakdownTileFeatured: {
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50]
  },
  breakdownIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  breakdownIconFeatured: {
    backgroundColor: colors.primary,
    borderColor: colors.primary
  },
  trustFacts: {
    flexDirection: "row",
    gap: spacing[3],
    minWidth: 0
  },
  trustFact: {
    flex: 1,
    minWidth: 0,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#fde68a",
    padding: spacing[3],
    gap: spacing[1]
  },
  serviceRail: {
    gap: spacing[3],
    paddingRight: spacing[4]
  },
  serviceCard: {
    width: 220,
    minHeight: 128,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    padding: spacing[3],
    gap: spacing[3],
    ...shadows.card
  },
  serviceIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary
  },
  serviceArrow: {
    position: "absolute",
    right: spacing[3],
    top: spacing[3],
    width: 30,
    height: 30,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  actions: {
    gap: spacing[3]
  },
  footerNote: {
    textAlign: "center"
  }
});
