import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  BookOpen,
  ChevronRight,
  CircleHelp,
  CreditCard,
  ExternalLink,
  FileText,
  Headphones,
  Home,
  Mail,
  Phone,
  RefreshCcw,
  ShieldCheck,
  TicketCheck,
  UserCog
} from "lucide-react-native";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, View } from "react-native";

import { AppButton, AppCard, AppStack, AppText, SafeScreen, ScreenHeader } from "../components";
import { apiRequest } from "../lib/apiClient";
import { env } from "../lib/env";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "AccountResources">;
type IconType = typeof FileText;
type ReaderSection = { heading: string; body: string[] };
type ResourceItem = { Icon: IconType; title: string; text: string; path: string; updated?: string; sections: ReaderSection[] };

const POLICY_ITEMS: ResourceItem[] = [
  {
    Icon: FileText,
    title: "Terms of service",
    text: "Core traveller agreement and platform rules.",
    path: "/terms",
    updated: "1 January 2026",
    sections: [
      {
        heading: "What NoLSAF provides",
        body: [
          "NoLSAF connects travellers with verified accommodations, tour packages, transport, logistics, and secure digital booking tools.",
          "The platform supports local and international travellers with booking discovery, package review, checkout, documents, and support flows."
        ]
      },
      {
        heading: "Bookings and validity",
        body: [
          "A booking becomes valid when the required booking steps are completed and the traveller receives a booking code, voucher, or package reference.",
          "Availability, price, dates, guest details, selected services, and package inclusions must be reviewed before confirmation."
        ]
      },
      {
        heading: "Payments",
        body: [
          "Payments must use NoLSAF approved digital payment methods shown during checkout, including supported mobile money, bank, and card channels.",
          "NoLSAF does not protect payments made outside the approved platform flow. Extra services after arrival are managed according to the relevant property, operator, or booking terms."
        ]
      },
      {
        heading: "Traveller responsibilities",
        body: [
          "Travellers must provide accurate identity, contact, travel, payment, and document information where required.",
          "Travellers must respect property rules, operator instructions, safety guidance, and lawful requirements connected to the service they book."
        ]
      }
    ]
  },
  {
    Icon: ShieldCheck,
    title: "Privacy policy",
    text: "How NoLSAF handles account and booking data.",
    path: "/privacy",
    updated: "1 January 2026",
    sections: [
      {
        heading: "Information collected",
        body: [
          "NoLSAF collects account details, contact details, profile photos, booking data, payment references, support messages, travel documents, and service activity required to operate the platform.",
          "For some services, location, device, verification, and document information may be used to protect travellers, operators, property owners, and drivers."
        ]
      },
      {
        heading: "How information is used",
        body: [
          "Data is used to create accounts, verify identity, process bookings, connect travellers to operators or properties, support payments, issue vouchers and receipts, and improve service quality.",
          "NoLSAF may use booking and activity records to handle support, disputes, fraud prevention, safety validation, and legal compliance."
        ]
      },
      {
        heading: "Sharing and protection",
        body: [
          "Information is shared only with trusted service providers, operators, properties, payment partners, or authorities where needed for the requested service or legal requirements.",
          "Sensitive records are protected using secure storage, access control, and encrypted transmission where supported."
        ]
      }
    ]
  },
  {
    Icon: RefreshCcw,
    title: "Cancellation policy",
    text: "Cancellation and refund rules for bookings.",
    path: "/cancellation-policy",
    updated: "1 January 2026",
    sections: [
      {
        heading: "Before check-in",
        body: [
          "Cancellation rules depend on the service booked, the provider policy, timing, and whether the booking is individual, group stay, tour package, or special arrangement.",
          "Some bookings may allow free cancellation within the stated window. Others may allow partial refunds or be non-refundable when clearly marked."
        ]
      },
      {
        heading: "After check-in or tour start",
        body: [
          "After check-in or after the booked service has started, refunds are generally limited and require strong supporting evidence.",
          "Exceptional cases may include verified medical emergencies, declared disasters, government restrictions, or serious provider failure."
        ]
      },
      {
        heading: "Refund processing",
        body: [
          "Eligible refunds are reviewed through the NoLSAF support and payment process, then returned to the original payment method where possible.",
          "Processing time depends on the payment provider, mobile money network, bank, card scheme, or international payment partner."
        ]
      }
    ]
  },
  {
    Icon: ShieldCheck,
    title: "Verification policy",
    text: "How NoLSAF verifies accounts, properties, and operators.",
    path: "/verification-policy",
    updated: "1 January 2026",
    sections: [
      {
        heading: "Why verification matters",
        body: [
          "Verification helps NoLSAF confirm that properties, operators, accounts, and travel services are authentic, safe, and accurately represented.",
          "Verified status gives travellers stronger confidence before they book and helps reduce fraud, misrepresentation, and unsafe experiences."
        ]
      },
      {
        heading: "Property and operator checks",
        body: [
          "NoLSAF may review ownership or operating documents, permits, location, photos, facilities, safety standards, and service details.",
          "For tour operators, declared parks, operating areas, vehicles, tools, team capacity, and service specializations may be reviewed."
        ]
      },
      {
        heading: "Traveller protection",
        body: [
          "Verification does not remove every travel risk, but it creates an accountable record that supports booking confidence, support handling, and quality tracking.",
          "Travellers should still review package facts, inclusions, exclusions, meeting point, documents, and payment confirmation before travel."
        ]
      }
    ]
  },
  {
    Icon: FileText,
    title: "Cookies policy",
    text: "Cookie and tracking policy for NoLSAF web services.",
    path: "/cookies-policy",
    updated: "1 January 2026",
    sections: [
      {
        heading: "Cookies and local storage",
        body: [
          "NoLSAF web services may use cookies, secure tokens, and local storage to keep users signed in, remember preferences, protect sessions, and improve platform performance.",
          "Some cookies are essential for authentication, booking flow, payment flow, and security."
        ]
      },
      {
        heading: "Analytics and improvements",
        body: [
          "Usage data may help NoLSAF understand performance, diagnose errors, and improve traveller experience.",
          "Users can manage browser cookie settings, but disabling essential cookies may prevent some web features from working correctly."
        ]
      }
    ]
  },
  {
    Icon: CreditCard,
    title: "Disbursement policy",
    text: "Payment release and payout policy references.",
    path: "/disbursement-policy",
    updated: "1 January 2026",
    sections: [
      {
        heading: "Payment release principles",
        body: [
          "Disbursement rules describe how approved funds are released to eligible property owners, operators, drivers, or service providers after service conditions are met.",
          "Traveller-facing records such as vouchers, receipts, booking codes, and payment status help confirm that the correct booking is being handled."
        ]
      },
      {
        heading: "Why travellers should care",
        body: [
          "A clear payout framework supports accountable service delivery and protects against unofficial payment requests.",
          "Travellers should keep payments, refunds, and booking changes inside the NoLSAF approved flow."
        ]
      }
    ]
  }
];

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

function webOrigin() {
  const raw = env.apiUrl.trim().replace(/\/+$/, "");
  if (!raw) return "http://localhost:3000";
  try {
    const url = new URL(raw);
    if (/^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/i.test(url.hostname) && url.port === "4000") url.port = "3000";
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/api.*$/i, "");
  }
}

function openWeb(path: string) {
  WebBrowser.openBrowserAsync(`${webOrigin()}${path}`).catch(() => Alert.alert("NoLSAF", "Could not open this page right now."));
}

export function AccountResourcesScreen({ route, navigation }: Props) {
  const mode = route.params.mode;
  const [selected, setSelected] = useState<ResourceItem | null>(null);
  const title = mode === "policies" ? "NoLSAF Policies" : mode === "help" ? "Help Center" : "Contact support";
  const subtitle =
    mode === "policies"
      ? "Traveller policy references from the NoLSAF web platform."
      : mode === "help"
        ? "Guides for rides, stays, tours, payments, accounts, and refunds."
        : "Use the official support channels connected to NoLSAF settings.";

  return (
    <SafeScreen contentStyle={styles.screen}>
      <AppStack gap={4}>
        <ScreenHeader
          title={selected ? selected.title : title}
          subtitle={selected ? "Read this NoLSAF resource inside the app." : subtitle}
          onBack={() => {
            if (selected) setSelected(null);
            else navigation.goBack();
          }}
        />
        {selected ? <ResourceReader item={selected} /> : null}
        {!selected && mode === "policies" ? <ResourceList items={POLICY_ITEMS} onSelect={setSelected} /> : null}
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
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});
