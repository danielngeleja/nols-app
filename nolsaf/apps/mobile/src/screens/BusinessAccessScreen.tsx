import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Building2, Car, ExternalLink, Headset } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";

import { apiRequest } from "../lib/apiClient";
import { webOrigin } from "../lib/webOrigin";
import { AppCard, AppText, SafeScreen, ScreenHeader } from "../components";
import { RootStackParamList } from "../navigation/types";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "BusinessAccess">;
type IconType = typeof Building2;

function openWeb(path: string) {
  Linking.openURL(`${webOrigin()}${path}`).catch(() => {
    Alert.alert("NoLSAF web", "Could not open this web page right now.");
  });
}

export function BusinessAccessScreen({ navigation }: Props) {
  const [supportEmail, setSupportEmail] = useState("support@nolsaf.com");

  useEffect(() => {
    apiRequest<{ supportEmail?: string | null }>("/api/public/support")
      .then((res) => {
        if (res.supportEmail) setSupportEmail(res.supportEmail);
      })
      .catch(() => undefined);
  }, []);

  function contactForAgentAccess() {
    const subject = encodeURIComponent("Tour operator / agent access on NoLSAF");
    const body = encodeURIComponent("Hi NoLSAF team,\n\nI'd like to apply for tour operator / agent access on the platform.\n\n");
    Linking.openURL(`mailto:${supportEmail}?subject=${subject}&body=${body}`).catch(() => {
      Alert.alert("Contact support", `Email us at ${supportEmail} to apply for agent access.`);
    });
  }

  return (
    <SafeScreen contentStyle={styles.screen}>
      <View style={styles.content}>
        <ScreenHeader
          title="Business access"
          subtitle="List a property, drive with NoLSAF, or apply as a tour operator partner."
          onBack={() => navigation.goBack()}
        />

        <BusinessOption
          Icon={Building2}
          title="List your property"
          description="Become a verified host and manage stays, pricing, and bookings from the web dashboard."
          actionLabel="Continue on web"
          onPress={() => openWeb("/account/onboard/owner")}
        />

        <BusinessOption
          Icon={Car}
          title="Drive with NoLSAF"
          description="Apply as a driver to accept ride and transport requests through the web dashboard."
          actionLabel="Continue on web"
          onPress={() => openWeb("/account/onboard/driver")}
        />

        <BusinessOption
          Icon={Headset}
          title="Tour operator / agent"
          description="Apply to list tour packages as a verified operator. Our team reviews each request."
          actionLabel="Contact our team"
          onPress={contactForAgentAccess}
        />
      </View>
    </SafeScreen>
  );
}

function BusinessOption({
  Icon,
  title,
  description,
  actionLabel,
  onPress
}: {
  Icon: IconType;
  title: string;
  description: string;
  actionLabel: string;
  onPress: () => void;
}) {
  return (
    <AppCard style={styles.option}>
      <View style={styles.optionHeader}>
        <View style={styles.optionIcon}>
          <Icon color={colors.primary} size={20} />
        </View>
        <View style={styles.flex}>
          <AppText variant="titleSm" weight="extraBold">
            {title}
          </AppText>
          <AppText variant="caption" tone="muted">
            {description}
          </AppText>
        </View>
      </View>
      <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}>
        <AppText variant="bodySmall" weight="extraBold" tone="primary">
          {actionLabel}
        </AppText>
        <ExternalLink color={colors.primary} size={16} />
      </Pressable>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: spacing[10]
  },
  content: {
    gap: spacing[4]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  option: {
    gap: spacing[3]
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  optionIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingVertical: spacing[2]
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});
