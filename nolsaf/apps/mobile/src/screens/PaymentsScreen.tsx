import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { CreditCard, Landmark, ShieldCheck, Smartphone, Zap } from "lucide-react-native";
import { Image, ImageSourcePropType, StyleSheet, View } from "react-native";

import { AppCard, AppStack, AppText, SafeScreen, ScreenHeader } from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

import airtelLogo from "../../assets/payments/airtel.png";
import crdbLogo from "../../assets/payments/crdb.png";
import halopesaLogo from "../../assets/payments/halopesa.png";
import mastercardLogo from "../../assets/payments/mastercard.png";
import mixxLogo from "../../assets/payments/mixx.png";
import mpesaLogo from "../../assets/payments/mpesa.png";
import nmbLogo from "../../assets/payments/nmb.png";
import visaLogo from "../../assets/payments/visa.png";

type Props = NativeStackScreenProps<RootStackParamList, "Payments">;

type IconType = typeof Smartphone;

const MNO_PROVIDERS: Array<{ name: string; logo: ImageSourcePropType }> = [
  { name: "Mpesa", logo: mpesaLogo },
  { name: "Mixx by Yas", logo: mixxLogo },
  { name: "Airtel Money", logo: airtelLogo },
  { name: "HaloPesa", logo: halopesaLogo }
];

const BANKS: Array<{ name: string; logo: ImageSourcePropType }> = [
  { name: "CRDB Bank", logo: crdbLogo },
  { name: "NMB Bank", logo: nmbLogo }
];

const CARDS: Array<{ name: string; logo: ImageSourcePropType }> = [
  { name: "Visa", logo: visaLogo },
  { name: "Mastercard", logo: mastercardLogo }
];

export function PaymentsScreen({ navigation }: Props) {
  return (
    <SafeScreen contentStyle={styles.body}>
      <ScreenHeader title="Payments" subtitle="One secure checkout for every NoLSAF service." onBack={() => navigation.goBack()} />

      <AppCard tone="brand">
        <AppStack gap={2}>
          <View style={styles.introHead}>
            <Zap color={colors.white} size={18} />
            <AppText variant="titleSm" weight="extraBold" tone="inverse">
              One click, every service
            </AppText>
          </View>
          <AppText variant="bodySmall" tone="inverse">
            Stays, tours, group trips and rides all settle through the same checkout. Choose mobile money, bank or
            card, no need to leave the app or set up a separate account.
          </AppText>
        </AppStack>
      </AppCard>

      <PaymentMode
        Icon={Smartphone}
        iconColor="#dc2626"
        title="Mobile Money"
        description="Pay instantly from your mobile wallet. We send a USSD prompt to your phone, approve it to confirm payment in seconds."
        providers={MNO_PROVIDERS}
      />

      <PaymentMode
        Icon={Landmark}
        iconColor="#15803d"
        title="Bank"
        description="Pay from CRDB or NMB by generating a bank OTP first, then submit the OTP, account number, and bank-registered phone to confirm."
        providers={BANKS}
      />

      <PaymentMode
        Icon={CreditCard}
        iconColor="#6d28d9"
        title="Card"
        description="Pay with Visa or Mastercard through a secure hosted checkout page, then return to NoLSAF automatically. We never see or store your card number."
        providers={CARDS}
      />

      <View style={styles.secureRow}>
        <ShieldCheck color={colors.primary} size={15} />
        <AppText variant="caption" tone="soft" style={styles.flex}>
          All payments are processed securely through our payment partner.
        </AppText>
      </View>
    </SafeScreen>
  );
}

function PaymentMode({
  Icon,
  iconColor,
  title,
  description,
  providers
}: {
  Icon: IconType;
  iconColor: string;
  title: string;
  description: string;
  providers: Array<{ name: string; logo: ImageSourcePropType }>;
}) {
  return (
    <AppCard>
      <AppStack gap={3}>
        <View style={styles.modeHead}>
          <View style={styles.modeIcon}>
            <Icon color={iconColor} size={18} />
          </View>
          <AppText variant="titleSm" weight="extraBold" style={styles.flex}>
            {title}
          </AppText>
        </View>
        <AppText variant="bodySmall" tone="muted">
          {description}
        </AppText>
        <View style={styles.providerGrid}>
          {providers.map((p) => (
            <View key={p.name} style={styles.providerTile}>
              <Image source={p.logo} style={styles.providerLogo} resizeMode="contain" />
              <AppText variant="caption" weight="semiBold" tone="muted" numberOfLines={1}>
                {p.name}
              </AppText>
            </View>
          ))}
        </View>
      </AppStack>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing[4], paddingBottom: spacing[6] },
  flex: { flex: 1, minWidth: 0 },
  introHead: { flexDirection: "row", alignItems: "center", gap: spacing[2] },
  modeHead: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  modeIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50]
  },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2] },
  providerTile: {
    width: "48%",
    minWidth: 0,
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[2]
  },
  providerLogo: { width: 64, height: 28 },
  secureRow: { flexDirection: "row", alignItems: "center", gap: spacing[2], minWidth: 0 }
});
