import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Cookie,
  CreditCard,
  ExternalLink,
  FileText,
  Globe,
  Headphones,
  Home,
  Mail,
  Phone,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TicketCheck,
  UserCog
} from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppButton, AppCard, AppStack, AppText, SafeScreen, ScreenHeader } from "../components";
import { apiRequest } from "../lib/apiClient";
import { webOrigin } from "../lib/webOrigin";
import { RootStackParamList } from "../navigation/types";
import { PolicyFeed, PolicySummary, fetchPolicies, isRecentlyUpdated, loadSavedPolicies, shortPolicyDate } from "../policies";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AccountResources">;
type IconType = typeof FileText;
type ReaderSection = { heading: string; body: string[] };
type ResourceItem = { Icon: IconType; title: string; text: string; path: string; updated?: string; sections: ReaderSection[] };

const HELP_ITEMS: ResourceItem[] = [
  {
    Icon: BookOpen,
    title: "Getting started",
    text: "First steps for using NoLSAF as a traveller.",
    path: "/help/getting-started",
    sections: [
      { heading: "Start with your account", body: ["Complete your profile, verify your contacts, and keep your account security enabled before booking."] },
      { heading: "Choose a service", body: ["Use NoLSAF for verified stays, N-SaT rides, tour packages, documents, payments, and support from one traveller account."] }
    ]
  },
  {
    Icon: UserCog,
    title: "Account setup",
    text: "Profile, login, security, and account setup help.",
    path: "/help/account-setup",
    sections: [
      { heading: "Profile details", body: ["Add your full name, email, phone number, profile photo, and required travel documents so operators and properties can identify you correctly."] },
      { heading: "Security", body: ["Use a strong password, enable 2FA or MFA where available, and review trusted sessions when you suspect account access risk."] }
    ]
  },
  {
    Icon: Home,
    title: "Stays and bookings",
    text: "Booking accommodation and managing stay details.",
    path: "/help",
    sections: [
      { heading: "Booking a stay", body: ["Search properties, review photos, rules, amenities, cancellation terms, dates, guests, and final payment details before confirming."] },
      { heading: "After booking", body: ["Keep your booking code, receipt, and support records available. Use NoLSAF support if the property differs from the confirmed details."] }
    ]
  },
  {
    Icon: TicketCheck,
    title: "Tours and event plans",
    text: "Tour packages, timelines, and event plan guidance.",
    path: "/help/event-manager",
    sections: [
      { heading: "Tour packages", body: ["Review package facts, inclusions, exclusions, accommodation choice, meeting point, traveller count, and travel date before booking."] },
      { heading: "Timeline tracking", body: ["Meetup validation unlocks the shared tour timeline, ratings, activity proof, and service quality tracking for the package."] }
    ]
  },
  {
    Icon: CreditCard,
    title: "Payments",
    text: "Mobile money, cards, bank payment, and secure checkout help.",
    path: "/help/payments",
    sections: [
      { heading: "Supported methods", body: ["NoLSAF supports approved local mobile money, bank, and card payment methods shown during checkout. Available methods can differ by booking type."] },
      { heading: "Payment safety", body: ["Use only the in-app or official web checkout. NoLSAF cannot protect payments made outside the approved payment flow."] }
    ]
  },
  {
    Icon: RefreshCcw,
    title: "Refunds",
    text: "Refund timing, cancellation outcomes, and support steps.",
    path: "/help/refunds",
    sections: [
      { heading: "Eligibility", body: ["Refund eligibility depends on the booking policy, timing, provider rules, service status, and supporting evidence."] },
      { heading: "Processing", body: ["Approved refunds are returned through the original payment route where possible, subject to provider timelines."] }
    ]
  },
  {
    Icon: CircleHelp,
    title: "Pricing",
    text: "How prices, package totals, and fees are shown.",
    path: "/help/pricing",
    sections: [
      { heading: "Displayed totals", body: ["Package and booking totals should show the traveller what is included, excluded, and payable before confirmation."] },
      { heading: "Changes", body: ["Final amounts may reflect selected dates, travellers, rooms, routes, taxes, provider rules, or approved adjustments."] }
    ]
  }
];

function openWeb(path: string) {
  WebBrowser.openBrowserAsync(`${webOrigin()}${path}`).catch(() => Alert.alert("NoLSAF", "Could not open this page right now."));
}

export function AccountResourcesScreen({ route, navigation }: Props) {
  const mode = route.params.mode;
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<PolicySummary | null>(null);
  const title = mode === "policies" ? "NoLSAF Policies" : mode === "help" ? "Help Center" : "Contact support";
  const subtitle =
    mode === "policies"
      ? "Always the latest version from the NoLSAF website."
      : mode === "help"
        ? "Guides for rides, stays, tours, payments, accounts, and refunds."
        : "Use the official support channels connected to NoLSAF settings.";

  return (
    <SafeScreen contentStyle={styles.screen}>
      <AppStack gap={4}>
        <ScreenHeader
          title={selectedPolicy ? selectedPolicy.title : selected ? selected.title : title}
          subtitle={
            selectedPolicy
              ? selectedPolicy.lastUpdated
                ? `Last updated ${selectedPolicy.lastUpdated}`
                : "From the NoLSAF website"
              : selected
                ? "Read this NoLSAF resource inside the app."
                : subtitle
          }
          onBack={() => {
            if (selectedPolicy) setSelectedPolicy(null);
            else if (selected) setSelected(null);
            else navigation.goBack();
          }}
        />
        {selected ? <ResourceReader item={selected} /> : null}
        {selectedPolicy ? <PolicyReader policy={selectedPolicy} /> : null}
        {!selectedPolicy && mode === "policies" ? <PoliciesPanel onSelect={setSelectedPolicy} /> : null}
        {!selected && mode === "help" ? <ResourceList items={HELP_ITEMS} onSelect={setSelected} /> : null}
        {mode === "support" ? <SupportPanel /> : null}
      </AppStack>
    </SafeScreen>
  );
}

function ResourceList({ items, onSelect }: { items: ResourceItem[]; onSelect: (item: ResourceItem) => void }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <ResourceRow key={item.path} item={item} onSelect={onSelect} />
      ))}
    </View>
  );
}

function ResourceRow({ item, onSelect }: { item: ResourceItem; onSelect: (item: ResourceItem) => void }) {
  const { Icon, title, text } = item;
  return (
    <Pressable accessibilityRole="button" onPress={() => onSelect(item)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowIcon}>
        <Icon color={colors.primary} size={19} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="extraBold">
          {title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {text}
        </AppText>
      </View>
      <ChevronRight color={colors.softText} size={18} />
    </Pressable>
  );
}

function ResourceReader({ item }: { item: ResourceItem }) {
  const { Icon } = item;
  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.readerScroll}>
      <AppCard style={styles.readerHero}>
        <View style={styles.heroRow}>
          <View style={styles.heroIcon}>
            <Icon color={colors.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="titleSm" weight="extraBold">
              {item.title}
            </AppText>
            <AppText variant="bodySmall" tone="muted">
              {item.text}
            </AppText>
            {item.updated ? (
              <AppText variant="caption" tone="soft">
                Last updated {item.updated}
              </AppText>
            ) : null}
          </View>
        </View>
      </AppCard>

      {item.sections.map((section) => (
        <AppCard key={section.heading} style={styles.readerSection}>
          <AppText variant="bodySmall" weight="extraBold">
            {section.heading}
          </AppText>
          {section.body.map((paragraph) => (
            <AppText key={paragraph} variant="bodySmall" tone="muted" style={styles.readerParagraph}>
              {paragraph}
            </AppText>
          ))}
        </AppCard>
      ))}

      <AppButton title="Open web version" variant="secondary" onPress={() => openWeb(item.path)} icon={<ExternalLink color={colors.primary} size={16} />} />
    </ScrollView>
  );
}

const POLICY_ICONS: Record<string, IconType> = {
  privacy: ShieldCheck,
  terms: FileText,
  cancellation: RefreshCcw,
  verification: BadgeCheck,
  cookies: Cookie,
  disbursement: CreditCard
};

/** Policies come live from the website (/policies.json); the last good copy covers offline use. */
function PoliciesPanel({ onSelect }: { onSelect: (policy: PolicySummary) => void }) {
  const [feed, setFeed] = useState<PolicyFeed | null>(null);
  const [refreshing, setRefreshing] = useState(true);

  const load = useCallback(async () => {
    setRefreshing(true);
    const saved = await loadSavedPolicies();
    setFeed((current) => current ?? saved);
    try {
      setFeed(await fetchPolicies());
    } catch {
      // Keep the saved or basic list; the note below says it may not be the latest.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!feed) {
    return (
      <View style={styles.policyLoading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const recent = feed.policies
    .filter((p) => isRecentlyUpdated(p))
    .sort((a, b) => b.lastUpdatedIso.localeCompare(a.lastUpdatedIso))[0];

  return (
    <AppStack gap={4}>
      {recent ? (
        <Pressable accessibilityRole="button" onPress={() => onSelect(recent)} style={({ pressed }) => [styles.updateBanner, pressed && styles.pressed]}>
          <View style={styles.updateIcon}>
            <Sparkles color={colors.brand[200]} size={18} />
          </View>
          <View style={styles.flex}>
            <AppText variant="bodySmall" weight="extraBold" tone="inverse">
              {recent.title} updated
            </AppText>
            <AppText variant="caption" style={styles.updateSub}>
              {shortPolicyDate(recent)} · See what changed
            </AppText>
          </View>
          <ChevronRight color={colors.brand[200]} size={18} />
        </Pressable>
      ) : null}

      <View style={styles.policyGroup}>
        {feed.policies.map((policy, index) => {
          const Icon = POLICY_ICONS[policy.key] ?? FileText;
          const fresh = isRecentlyUpdated(policy);
          return (
            <Pressable
              key={policy.key}
              accessibilityRole="button"
              accessibilityLabel={`${policy.title}${policy.lastUpdated ? `, updated ${policy.lastUpdated}` : ""}`}
              onPress={() => onSelect(policy)}
              style={({ pressed }) => [styles.policyRow, index > 0 && styles.policyDivider, pressed && styles.policyRowPressed]}
            >
              <View style={styles.policyIcon}>
                <Icon color={colors.primary} size={17} />
              </View>
              <View style={styles.flex}>
                <View style={styles.policyTitleRow}>
                  <AppText variant="bodySmall" weight="extraBold" numberOfLines={1} style={styles.flexShrink}>
                    {policy.title}
                  </AppText>
                  {fresh ? (
                    <View style={styles.freshTag}>
                      <AppText variant="caption" weight="extraBold" tone="primary">
                        Updated
                      </AppText>
                    </View>
                  ) : null}
                </View>
                <AppText variant="caption" tone="soft" numberOfLines={1}>
                  {policy.lastUpdated ? `Last updated ${shortPolicyDate(policy)}` : policy.summary}
                </AppText>
              </View>
              <ChevronRight color={colors.softText} size={17} />
            </Pressable>
          );
        })}
      </View>

      <View style={styles.policyNote}>
        {refreshing ? <ActivityIndicator color={colors.primary} size="small" /> : <Globe color={colors.softText} size={14} />}
        <AppText variant="caption" tone="soft" style={styles.flex}>
          {refreshing
            ? "Checking nolsaf.com for the latest versions"
            : feed.source === "live"
              ? "Up to date with nolsaf.com. The full legal text is always on the website."
              : "Could not reach nolsaf.com. Showing the last version saved on this phone."}
        </AppText>
        {!refreshing && feed.source !== "live" ? (
          <Pressable accessibilityRole="button" onPress={() => void load()} hitSlop={8}>
            <AppText variant="caption" weight="extraBold" tone="primary">
              Retry
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </AppStack>
  );
}

function PolicyReader({ policy }: { policy: PolicySummary }) {
  const Icon = POLICY_ICONS[policy.key] ?? FileText;
  return (
    <AppStack gap={4}>
      <View style={styles.policyHero}>
        <View style={styles.policyHeroTop}>
          <View style={styles.updateIcon}>
            <Icon color={colors.brand[200]} size={20} />
          </View>
          <View style={styles.flex}>
            <AppText variant="titleSm" weight="extraBold" tone="inverse">
              {policy.title}
            </AppText>
            <AppText variant="caption" style={styles.updateSub}>
              {policy.lastUpdated ? `Last updated ${policy.lastUpdated}` : "Latest version on nolsaf.com"}
            </AppText>
          </View>
        </View>
        <AppText variant="bodySmall" style={styles.updateSub}>
          {policy.summary}
        </AppText>
      </View>

      {policy.latestChanges.length ? (
        <View style={styles.changesCard}>
          <View style={styles.policyTitleRow}>
            <Sparkles color={colors.warning} size={15} />
            <AppText variant="bodySmall" weight="extraBold">
              What changed in this update
            </AppText>
          </View>
          {policy.latestChanges.map((change) => (
            <View key={change} style={styles.pointRow}>
              <View style={styles.changeDot} />
              <AppText variant="caption" tone="muted" style={styles.flex}>
                {change}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      {policy.keyPoints.length ? (
        <View style={styles.pointsCard}>
          <AppText variant="bodySmall" weight="extraBold">
            Key points
          </AppText>
          {policy.keyPoints.map((point) => (
            <View key={point} style={styles.pointRow}>
              <CheckCircle2 color={colors.primary} size={15} style={styles.pointIcon} />
              <AppText variant="caption" tone="muted" style={styles.flex}>
                {point}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}

      <AppButton title="Read the full policy" onPress={() => openWeb(policy.path)} icon={<ExternalLink color={colors.white} size={16} />} />
      <AppText variant="caption" tone="soft" style={styles.centerText}>
        This is a summary. The full policy on nolsaf.com is the one that applies.
      </AppText>
    </AppStack>
  );
}

function SupportPanel() {
  const [loading, setLoading] = useState(true);
  const [support, setSupport] = useState<{ supportEmail?: string | null; supportPhone?: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSupport(await apiRequest<{ supportEmail?: string | null; supportPhone?: string | null }>("/api/public/support"));
    } catch {
      setSupport({ supportEmail: "support@nolsaf.com", supportPhone: "+255736766726" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const email = support?.supportEmail || "support@nolsaf.com";
  const phone = support?.supportPhone || "+255736766726";
  const cleanPhone = phone.replace(/[^\d+]/g, "");
  const whatsappNumber = cleanPhone.replace(/^\+/, "");

  return (
    <AppStack gap={4}>
      <AppCard style={styles.supportHero}>
        <View style={styles.heroRow}>
          <View style={styles.heroIcon}>
            <Headphones color={colors.primary} size={22} />
          </View>
          <View style={styles.flex}>
            <AppText variant="titleSm" weight="extraBold">
              NoLSAF customer support
            </AppText>
            <AppText variant="bodySmall" tone="muted">
              Contact details are loaded from NoLSAF system settings.
            </AppText>
          </View>
          {loading ? <ActivityIndicator color={colors.primary} /> : null}
        </View>
      </AppCard>

      <ResourceContact Icon={Mail} title="Email support" value={email} onPress={() => Linking.openURL(`mailto:${email}`)} />
      <ResourceContact Icon={Phone} title="Call support" value={phone} onPress={() => Linking.openURL(`tel:${cleanPhone}`)} />
      <ResourceContact Icon={CircleHelp} title="WhatsApp support" value={phone} onPress={() => Linking.openURL(`https://wa.me/${whatsappNumber}`)} />

      <AppButton title="Open Help Center" variant="secondary" onPress={() => openWeb("/help")} icon={<BookOpen color={colors.primary} size={16} />} />
    </AppStack>
  );
}

function ResourceContact({ Icon, title, value, onPress }: { Icon: IconType; title: string; value: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.contactRow, pressed && styles.pressed]}>
      <View style={styles.rowIcon}>
        <Icon color={colors.primary} size={19} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="extraBold">
          {title}
        </AppText>
        <AppText variant="caption" tone="muted">
          {value}
        </AppText>
      </View>
      <ChevronRight color={colors.softText} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: spacing[8]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  list: {
    gap: spacing[2]
  },
  readerScroll: {
    gap: spacing[3],
    paddingBottom: spacing[8]
  },
  readerHero: {
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc"
  },
  readerSection: {
    gap: spacing[2]
  },
  readerParagraph: {
    lineHeight: 21
  },
  row: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  rowIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  supportHero: {
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc"
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  heroIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  contactRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  flexShrink: { flexShrink: 1, minWidth: 0 },
  centerText: { textAlign: "center" },
  policyLoading: { alignItems: "center", paddingVertical: spacing[8] },
  updateBanner: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: radius.lg, backgroundColor: colors.primaryDeep, padding: spacing[4] },
  updateIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.1)" },
  updateSub: { color: colors.brand[200] },
  policyGroup: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: "hidden", ...shadows.card },
  policyRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  policyDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  policyRowPressed: { backgroundColor: colors.surface },
  policyIcon: { width: 36, height: 36, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  policyTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  freshTag: { borderRadius: radius.sm, backgroundColor: colors.brand[50], paddingHorizontal: 6, paddingVertical: 1 },
  policyNote: { flexDirection: "row", alignItems: "center", gap: spacing[2], paddingHorizontal: 2 },
  policyHero: { gap: spacing[3], borderRadius: radius.xl, backgroundColor: colors.primaryDeep, padding: spacing[5] },
  policyHeroTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  changesCard: { gap: spacing[2], borderRadius: radius.lg, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing[4] },
  changeDot: { width: 6, height: 6, borderRadius: radius.full, backgroundColor: colors.warning, marginTop: 6 },
  pointsCard: { gap: spacing[2], borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, padding: spacing[4], ...shadows.card },
  pointRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2] },
  pointIcon: { marginTop: 1 },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});
