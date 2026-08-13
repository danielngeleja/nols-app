import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { AlertTriangle, BadgeCheck, CalendarCheck, Lock, MapPin, ShieldCheck, UserCheck } from "lucide-react-native";

import { AppButton, AppCard, AppStack, AppText, NolsafLogoMark, SafeScreen, ScreenHeader } from "../components";
import { RootStackParamList } from "../navigation/types";
import { fetchPropertyVerification, PropertyVerificationCertificate } from "../properties";
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "PropertyVerification">;

type State =
  | { status: "loading" }
  | { status: "valid"; certificate: PropertyVerificationCertificate }
  | { status: "invalid"; reason: string };

const GOLD = "#c8b46b";
const GOLD_SOFT = "#d8c886";
const PARCHMENT = "#fffdf7";

const INVALID_REASON =
  "This property certificate could not be verified. The link may be altered, expired, or the property is no longer publicly approved.";

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function PropertyVerificationScreen({ navigation, route }: Props) {
  const token = String(route.params?.token || "").trim();
  const [state, setState] = useState<State>({ status: "loading" });

  const load = useCallback(() => {
    if (!token) {
      setState({ status: "invalid", reason: "No property verification token was provided." });
      return () => {};
    }

    let alive = true;
    setState({ status: "loading" });
    fetchPropertyVerification(token)
      .then((data) => {
        if (!alive) return;
        if (data?.ok && data?.valid && data?.certificate) {
          setState({ status: "valid", certificate: data.certificate });
        } else {
          setState({ status: "invalid", reason: INVALID_REASON });
        }
      })
      .catch(() => {
        if (!alive) return;
        setState({ status: "invalid", reason: "We could not reach the verification service. Please try again." });
      });

    return () => {
      alive = false;
    };
  }, [token]);

  useEffect(() => load(), [load]);

  return (
    <SafeScreen>
      <AppStack gap={4}>
        <ScreenHeader
          title="Property certificate"
          subtitle="Public NoLSAF property check"
          onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
        />

        <View style={styles.brandBar}>
          <View style={styles.brandMark}>
            <NolsafLogoMark color={colors.primary} width={26} height={26} />
          </View>
          <View style={styles.flex}>
            <AppText variant="caption" weight="extraBold" tone="inverse" style={styles.brandEyebrow}>
              NOLSAF VERIFY
            </AppText>
            <AppText variant="titleSm" weight="extraBold" tone="inverse">
              Property certificate
            </AppText>
          </View>
        </View>

        {state.status === "loading" ? (
          <AppCard style={styles.centerCard}>
            <ActivityIndicator color={colors.primary} />
            <AppText variant="bodySmall" weight="bold" tone="muted">
              Verifying property certificate
            </AppText>
          </AppCard>
        ) : state.status === "invalid" ? (
          <InvalidView reason={state.reason} onRetry={token ? load : undefined} />
        ) : (
          <ValidView certificate={state.certificate} />
        )}

        <View style={styles.footerNote}>
          <Lock color={colors.softText} size={12} />
          <AppText variant="caption" tone="soft" style={styles.footerText}>
            Verification by NoLS Africa Co Ltd. No login is required to view this page.
          </AppText>
        </View>
      </AppStack>
    </SafeScreen>
  );
}

function InvalidView({ reason, onRetry }: { reason: string; onRetry?: () => void }) {
  return (
    <View style={styles.invalidCard}>
      <View style={styles.invalidHead}>
        <AlertTriangle color={colors.danger} size={20} />
        <AppText variant="bodySmall" weight="extraBold" style={styles.invalidTitle}>
          Property could not be verified
        </AppText>
      </View>
      <AppText variant="bodySmall" style={styles.invalidBody}>
        {reason}
      </AppText>
      {onRetry ? <AppButton title="Try again" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

function ValidView({ certificate }: { certificate: PropertyVerificationCertificate }) {
  const { property, verification } = certificate;

  return (
    <AppStack gap={4}>
      <View style={styles.certificate}>
        <View style={styles.certificateInnerBorder} pointerEvents="none" />

        <View style={styles.sealWrap}>
          <View style={styles.sealOuter}>
            <View style={styles.sealInner}>
              <ShieldCheck color={colors.white} size={28} />
            </View>
          </View>
          <AppText variant="caption" weight="extraBold" style={styles.certificateEyebrow}>
            CERTIFICATE OF VERIFICATION
          </AppText>
          <AppText variant="title" weight="extraBold" style={styles.certificateHeading}>
            Awarded to this property
          </AppText>
          <AppText variant="bodySmall" tone="muted" style={styles.certificateNote}>
            {verification.note}
          </AppText>
        </View>

        <View style={styles.propertyPanel}>
          <AppText variant="caption" weight="extraBold" tone="soft" style={styles.propertyType}>
            {String(property.type || "").toUpperCase()}
          </AppText>
          <AppText variant="title" weight="extraBold" style={styles.propertyTitle}>
            {property.title}
          </AppText>
          <View style={styles.propertyLocation}>
            <MapPin color={colors.primary} size={16} />
            <AppText variant="bodySmall" tone="muted" style={styles.flex}>
              {property.location || "Location not listed"}
            </AppText>
          </View>
        </View>

        <View style={styles.factGrid}>
          <Fact icon={<BadgeCheck color={colors.primary} size={16} />} label="Status" value="Verified" />
          <Fact icon={<CalendarCheck color={colors.primary} size={16} />} label="Checked on" value={formatDate(verification.verifiedAt)} />
          <Fact icon={<UserCheck color={colors.primary} size={16} />} label="Checked by" value={verification.verifiedBy || "NoLSAF Admin"} />
        </View>

        <View style={styles.marksPanel}>
          <View style={styles.marksHead}>
            <View style={styles.marksIcon}>
              <ShieldCheck color={colors.primary} size={20} />
            </View>
            <View style={styles.flex}>
              <AppText variant="bodySmall" weight="extraBold">
                Verification marks
              </AppText>
              <AppText variant="caption" weight="semiBold" tone="soft">
                Official NoLSAF property review record
              </AppText>
            </View>
          </View>

          <View style={styles.methodRow}>
            <AppText variant="caption" weight="extraBold" style={styles.methodLabel}>
              REVIEW METHOD
            </AppText>
            <AppText variant="bodySmall" weight="extraBold" style={styles.methodValue}>
              {verification.method || "Site visit and listing review"}
            </AppText>
          </View>

          <View style={styles.checklist}>
            {verification.checklist.map((item, index) => (
              <View
                key={item}
                style={[styles.checklistRow, index === verification.checklist.length - 1 && styles.checklistRowLast]}
              >
                <View style={styles.checklistTick}>
                  <BadgeCheck color={colors.primary} size={16} />
                </View>
                <AppText variant="bodySmall" weight="bold" tone="muted" style={styles.flex}>
                  {item}
                </AppText>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.issuerRow}>
          <View style={styles.issuerCell}>
            <AppText variant="caption" weight="extraBold" tone="soft" style={styles.issuerLabel}>
              ISSUED BY
            </AppText>
            <AppText variant="bodySmall" weight="extraBold" numberOfLines={2}>
              {certificate.issuer}
            </AppText>
          </View>
          <View style={[styles.issuerCell, styles.issuerCellRight]}>
            <AppText variant="caption" weight="extraBold" tone="soft" style={styles.issuerLabel}>
              CERTIFICATE ID
            </AppText>
            <AppText variant="bodySmall" weight="mono">
              NLS-P-{property.id}
            </AppText>
          </View>
        </View>
      </View>

      <AppText variant="caption" tone="muted" style={styles.warning}>
        If the property details do not match what you are booking, contact NoLSAF support before making payment.
      </AppText>
    </AppStack>
  );
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <View style={styles.factTile}>
      <View style={styles.factHead}>
        {icon}
        <AppText variant="caption" weight="extraBold" tone="soft" style={styles.factLabel}>
          {label.toUpperCase()}
        </AppText>
      </View>
      <AppText variant="bodySmall" weight="bold" numberOfLines={2}>
        {value || "Not available"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    minWidth: 0
  },
  brandBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.xl,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4]
  },
  brandMark: {
    width: 46,
    height: 46,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  brandEyebrow: {
    letterSpacing: 2,
    opacity: 0.7
  },
  centerCard: {
    alignItems: "center",
    gap: spacing[3],
    paddingVertical: spacing[10]
  },
  invalidCard: {
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#fecdd3",
    backgroundColor: "#fff1f2",
    padding: spacing[4]
  },
  invalidHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2]
  },
  invalidTitle: {
    color: "#9f1239"
  },
  invalidBody: {
    color: "#be123c"
  },
  certificate: {
    position: "relative",
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: GOLD,
    backgroundColor: PARCHMENT,
    padding: spacing[5],
    gap: spacing[5]
  },
  certificateInnerBorder: {
    position: "absolute",
    top: spacing[2],
    right: spacing[2],
    bottom: spacing[2],
    left: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: GOLD_SOFT
  },
  sealWrap: {
    alignItems: "center",
    gap: spacing[2]
  },
  sealOuter: {
    width: 78,
    height: 78,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: GOLD,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  sealInner: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center"
  },
  certificateEyebrow: {
    marginTop: spacing[2],
    letterSpacing: 2,
    color: "#8a7a36",
    textAlign: "center"
  },
  certificateHeading: {
    textAlign: "center"
  },
  certificateNote: {
    textAlign: "center"
  },
  propertyPanel: {
    alignItems: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4]
  },
  propertyType: {
    letterSpacing: 1.6
  },
  propertyTitle: {
    textAlign: "center"
  },
  propertyLocation: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[2],
    minWidth: 0
  },
  factGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  factTile: {
    flexGrow: 1,
    flexBasis: "45%",
    minWidth: 0,
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  factHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1]
  },
  factLabel: {
    letterSpacing: 1.2
  },
  marksPanel: {
    gap: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: GOLD_SOFT,
    backgroundColor: PARCHMENT,
    padding: spacing[4]
  },
  marksHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  marksIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center"
  },
  methodRow: {
    gap: spacing[1],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: GOLD_SOFT,
    backgroundColor: "#fff8dd",
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3]
  },
  methodLabel: {
    letterSpacing: 1.6,
    color: "#7a6826"
  },
  methodValue: {
    minWidth: 0
  },
  checklist: {
    overflow: "hidden",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white
  },
  checklistRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
    borderStyle: "solid",
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3]
  },
  checklistRowLast: {
    borderBottomWidth: 0
  },
  checklistTick: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.brand[50],
    alignItems: "center",
    justifyContent: "center"
  },
  issuerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3],
    borderTopWidth: 1,
    borderTopColor: GOLD_SOFT,
    borderStyle: "solid",
    paddingTop: spacing[4]
  },
  issuerCell: {
    flex: 1,
    minWidth: 0,
    gap: spacing[1]
  },
  issuerCellRight: {
    alignItems: "flex-end"
  },
  issuerLabel: {
    letterSpacing: 1.4
  },
  warning: {
    textAlign: "center"
  },
  footerNote: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    paddingHorizontal: spacing[4]
  },
  footerText: {
    textAlign: "center",
    flexShrink: 1
  }
});
