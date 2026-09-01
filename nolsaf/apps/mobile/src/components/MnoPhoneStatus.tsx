import { Check, TriangleAlert } from "lucide-react-native";
import { StyleSheet, View } from "react-native";

import type { MnoProvider } from "../bookings";
import { MNO_PROVIDER_LABELS, type TanzaniaMnoInputState } from "../payments";
import { colors, spacing } from "../theme";
import { AppText } from "./AppText";

type Props = {
  state: TanzaniaMnoInputState;
  selectedProvider: MnoProvider | null;
};

export function MnoPhoneStatus({ state, selectedProvider }: Props) {
  if (state.level === "success") {
    const providerName = selectedProvider ? MNO_PROVIDER_LABELS[selectedProvider] : "This wallet";
    return (
      <StatusRow
        color={colors.success}
        icon="check"
        title="Number accepted"
        detail={`${providerName} will be verified when you continue.`}
      />
    );
  }

  if (state.level === "warning") {
    const detail = state.detectedProvider
      ? `Select ${MNO_PROVIDER_LABELS[state.detectedProvider]} if this number was not ported.`
      : state.message;
    return <StatusRow color={colors.warning} icon="warning" title="Check selected network" detail={detail} />;
  }

  if (state.level === "error") {
    return <StatusRow color={colors.danger} icon="warning" title="Check phone number" detail={state.message} />;
  }

  return (
    <AppText variant="caption" tone="soft">
      {state.message}
    </AppText>
  );
}

function StatusRow({
  color,
  icon,
  title,
  detail
}: {
  color: string;
  icon: "check" | "warning";
  title: string;
  detail: string;
}) {
  const Icon = icon === "check" ? Check : TriangleAlert;
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.row}>
      <Icon color={color} size={19} strokeWidth={2.4} />
      <View style={styles.copy}>
        <AppText variant="caption" weight="bold" style={{ color }}>
          {title}
        </AppText>
        <AppText variant="caption" tone="soft">
          {detail}
        </AppText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    minWidth: 0
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 1
  }
});
