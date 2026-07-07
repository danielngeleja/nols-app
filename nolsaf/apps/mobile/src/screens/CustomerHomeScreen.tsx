import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { ArrowRight, CreditCard, Home, MapPinned, ShieldCheck } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import {
  AmountText,
  AppButton,
  AppCard,
  AppStack,
  AppText,
  CodeText,
  CustomerBottomNav,
  InfoGrid,
  SafeScreen,
  StatusBadge
} from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "CustomerHome">;

export function CustomerHomeScreen({ navigation }: Props) {
  const { user } = useAuth();
  const displayName = user?.fullName || user?.name || user?.email || "Traveler";

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <AppStack gap={6}>
          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroIcon}>
                <ShieldCheck color={colors.brand[300]} size={26} />
              </View>
            </View>
            <AppStack gap={3}>
              <AppText variant="caption" weight="bold" tone="primary" style={styles.eyebrow}>
                NOLSAF CUSTOMER APP
              </AppText>
              <AppText variant="headline" weight="extraBold" tone="inverse">
                Welcome, {displayName}.
              </AppText>
              <AppText variant="body" tone="inverse" style={styles.heroCopy}>
                Travel, stay, ride and pay with verified support.
              </AppText>
            </AppStack>
          </View>

          <AppCard>
            <AppStack gap={4}>
              <View style={styles.rowBetween}>
                <AppText variant="titleSm" weight="bold">
                  Booking foundation
                </AppText>
                <StatusBadge status="requested" />
              </View>
              <InfoGrid
                items={[
                  { label: "Stay", value: "Verified accommodation" },
                  { label: "Trip", value: "Scheduled or auto-dispatched" },
                  { label: "Payment", value: "MNO, bank and cards" }
                ]}
              />
            </AppStack>
          </AppCard>

          <AppCard tone="success">
            <AppStack gap={3}>
              <View style={styles.rowStart}>
                <CreditCard color={colors.primary} size={22} />
                <AppText variant="titleSm" weight="bold">
                  Payment-safe layout
                </AppText>
              </View>
              <AmountText amount={125000} tone="primary" />
              <CodeText value="NOLSAF-PAYMENT-REFERENCE-SAMPLE-0001" />
            </AppStack>
          </AppCard>

          <AppCard>
            <AppStack gap={4}>
              <View style={styles.rowStart}>
                <MapPinned color={colors.primary} size={22} />
                <AppText variant="titleSm" weight="bold">
                  Route and trip proof
                </AppText>
              </View>
              <InfoGrid
                items={[
                  { label: "Pickup", value: "Julius Nyerere International Airport, Dar es Salaam" },
                  { label: "Dropoff", value: "Masaki, Dar es Salaam" }
                ]}
              />
            </AppStack>
          </AppCard>

          <AppCard>
            <AppStack gap={3}>
              <View style={styles.rowStart}>
                <Home color={colors.primary} size={22} />
                <AppText variant="titleSm" weight="bold">
                  Overflow test card
                </AppText>
              </View>
              <AppText variant="bodySmall" tone="muted">
                This card intentionally uses reusable text, amount and grid components so long real data does not break the mobile layout.
              </AppText>
              <AppButton title="Explore verified stays" icon={<ArrowRight color={colors.white} size={18} />} onPress={() => navigation.navigate("VerifiedStays")} />
            </AppStack>
          </AppCard>
        </AppStack>
      </SafeScreen>

      <CustomerBottomNav active="Onboarding" />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    paddingBottom: spacing[8]
  },
  hero: {
    overflow: "hidden",
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    padding: spacing[5],
    gap: spacing[4]
  },
  heroTop: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)"
  },
  heroCopy: {
    color: "#d8e7e4"
  },
  eyebrow: {
    letterSpacing: 2
  },
  rowBetween: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[3]
  },
  rowStart: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  }
});
