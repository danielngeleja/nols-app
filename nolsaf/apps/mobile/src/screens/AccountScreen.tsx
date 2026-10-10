import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import {
  Ban,
  Bell,
  BookHeart,
  Bookmark,
  CalendarCheck,
  CarFront,
  ChevronRight,
  CircleHelp,
  Coffee,
  Coins,
  DatabaseZap,
  FileText,
  Fingerprint,
  Gift,
  HeartHandshake,
  History,
  KeyRound,
  LockKeyhole,
  LogOut,
  MessageCircleQuestion,
  MonitorSmartphone,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  TicketsPlane,
  UserRound,
  Users,
  UsersRound
} from "lucide-react-native";
import { useCallback, useState } from "react";
import { Image, Pressable, Share, StyleSheet, View } from "react-native";

import { AccountOverview, fetchAccountOverview } from "../accountPreferences";
import { useAuth } from "../auth";
import { fetchAccountPasskeys } from "../auth/authApi";
import { AppText, ConfirmSheet, CustomerBottomNav, SafeScreen } from "../components";
import { useCurrency } from "../currency";
import { RootStackParamList } from "../navigation/types";
import { fetchReferralInfo } from "../referrals";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Account">;
type IconType = typeof UserRound;

const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "Traveller"
};

const EMPTY_OVERVIEW: AccountOverview = { stays: null, rides: null, groupStays: null, tours: null, saved: null };

function roleLabel(role?: string | null) {
  const key = String(role || "CUSTOMER").toUpperCase();
  return ROLE_LABELS[key] || key;
}

export function AccountScreen({ navigation }: Props) {
  const { token, user, signOut } = useAuth();
  const { currency } = useCurrency();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralTotal, setReferralTotal] = useState<number | null>(null);
  const [overview, setOverview] = useState<AccountOverview>(EMPTY_OVERVIEW);
  const [passkeyCount, setPasskeyCount] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!token) return;
      fetchAccountOverview(token)
        .then((next) => setOverview((prev) => ({
          stays: next.stays ?? prev.stays,
          rides: next.rides ?? prev.rides,
          groupStays: next.groupStays ?? prev.groupStays,
          tours: next.tours ?? prev.tours,
          saved: next.saved ?? prev.saved
        })))
        .catch(() => undefined);
      fetchAccountPasskeys(token)
        .then((res) => setPasskeyCount((res.items || []).length))
        .catch(() => undefined);
      fetchReferralInfo(token)
        .then((res) => {
          setReferralLink(res.link);
          setReferralTotal(res.total);
        })
        .catch(() => undefined);
    }, [token])
  );

  const displayName = user?.fullName || user?.name || user?.email || "NoLSAF customer";
  const initial = String(displayName).trim().charAt(0).toUpperCase() || "N";
  const twoFactorOn = Boolean(user?.twoFactorEnabled);

  // Same checks as the web account security card: two-step, passkey, verified email and phone.
  const securityChecks = [twoFactorOn, (passkeyCount ?? 0) > 0, Boolean(user?.emailVerifiedAt), Boolean(user?.phoneVerifiedAt)];
  const securityDone = securityChecks.filter(Boolean).length;
  const securityPercent = Math.round((securityDone / securityChecks.length) * 100);
  const security =
    !twoFactorOn && securityDone < 3
      ? { label: "Needs attention", color: colors.warning, bg: "#fffbeb", border: "#fde68a", onDark: "#fcd34d" }
      : securityDone === securityChecks.length
        ? { label: "Strong", color: colors.success, bg: "#ecfdf5", border: "#a7f3d0", onDark: "#6ee7b7" }
        : { label: "Good", color: colors.primary, bg: colors.brand[50], border: colors.brand[100], onDark: colors.brand[200] };

  async function logout() {
    setLoggingOut(true);
    await signOut();
    setLoggingOut(false);
  }

  async function inviteFriends() {
    let link = referralLink;
    if (!link && token) {
      try {
        const res = await fetchReferralInfo(token);
        link = res.link;
        setReferralLink(res.link);
        setReferralTotal(res.total);
      } catch {
        // ignore - fall back to a linkless share
      }
    }
    const message = link
      ? `Join me on NoLSAF for verified stays, rides, and approved tour packages: ${link}`
      : "Join me on NoLSAF for verified stays, rides, and approved tour packages.";
    Share.share({ message }).catch(() => undefined);
  }

  return (
    <View style={styles.root}>
      <SafeScreen contentStyle={styles.screen}>
        <View style={styles.content}>
          <View style={styles.topBar}>
            <AppText variant="headline" weight="extraBold">
              Account
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              onPress={() => navigation.navigate("Notifications")}
              style={({ pressed }) => [styles.headerBell, pressed && styles.pressed]}
            >
              <Bell color={colors.ink} size={20} />
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open my profile"
            onPress={() => navigation.navigate("ProfileCompletion")}
            style={({ pressed }) => [styles.profileCard, pressed && styles.pressed]}
          >
            <View style={styles.profileRow}>
              <View style={styles.avatar}>
                {user?.avatarUrl ? (
                  <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <AppText variant="title" weight="extraBold" tone="inverse">
                    {initial}
                  </AppText>
                )}
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="extraBold" tone="inverse" numberOfLines={1}>
                  {displayName}
                </AppText>
                <AppText variant="caption" style={styles.profileMeta} numberOfLines={1}>
                  {roleLabel(user?.role)}
                </AppText>
              </View>
              <ChevronRight color={colors.brand[200]} size={20} />
            </View>

            <View style={styles.securityMeter}>
              <View style={styles.securityMeterTop}>
                <AppText variant="caption" weight="semiBold" style={styles.profileMeta}>
                  Account security
                </AppText>
                <AppText variant="caption" weight="extraBold" style={{ color: security.onDark }}>
                  {security.label}
                </AppText>
              </View>
              <View style={styles.meterTrack}>
                <View style={[styles.meterFill, { width: `${securityPercent}%`, backgroundColor: security.onDark }]} />
              </View>
            </View>
          </Pressable>

          <Section title="Your travel">
            <View style={styles.travelGrid}>
              <TravelTile Icon={CalendarCheck} label="Stays" count={overview.stays} onPress={() => navigation.navigate("MyBookings")} />
              <TravelTile Icon={CarFront} label="Rides" count={overview.rides} onPress={() => navigation.navigate("MyRides")} />
              <TravelTile Icon={TicketsPlane} label="Tours" count={overview.tours} onPress={() => navigation.navigate("MyTours")} />
              <TravelTile Icon={UsersRound} label="Group stays" count={overview.groupStays} onPress={() => navigation.navigate("MyGroupStays")} />
              <TravelTile Icon={Bookmark} label="Saved" count={overview.saved} onPress={() => navigation.navigate("SavedProperties")} />
              <TravelTile Icon={Ban} label="Cancellations" onPress={() => navigation.navigate("MyCancellations")} />
            </View>
            <ListGroup>
              <ListRow Icon={BookHeart} title="My story" value="Karibu by NoLSAF" last onPress={() => navigation.navigate("KaribuStory")} />
            </ListGroup>
          </Section>

          <Section
            title="Security"
            aside={
              <View style={[styles.scoreChip, { backgroundColor: security.bg, borderColor: security.border }]}>
                <ShieldCheck color={security.color} size={13} strokeWidth={2.5} />
                <AppText variant="caption" weight="extraBold" style={{ color: security.color }}>
                  {security.label}
                </AppText>
              </View>
            }
          >
            <ListGroup>
              <ListRow Icon={KeyRound} title="Password" onPress={() => navigation.navigate("AccountSecurity", { mode: "password" })} />
              <ListRow
                Icon={LockKeyhole}
                title="Two-step verification"
                value={twoFactorOn ? "On" : "Turn on"}
                valueTone={twoFactorOn ? "success" : "warning"}
                onPress={() => navigation.navigate("AccountSecurity", { mode: "2fa" })}
              />
              <ListRow
                Icon={Fingerprint}
                title="Passkeys"
                value={passkeyCount == null ? undefined : passkeyCount > 0 ? `${passkeyCount} added` : "Add one"}
                valueTone={passkeyCount ? "success" : "soft"}
                onPress={() => navigation.navigate("AccountSecurity", { mode: "passkeys" })}
              />
              <ListRow Icon={ShieldCheck} title="App Lock" onPress={() => navigation.navigate("AccountSecurity", { mode: "applock" })} />
              <ListRow Icon={MonitorSmartphone} title="Active sessions" onPress={() => navigation.navigate("AccountSecurity", { mode: "sessions" })} />
              <ListRow Icon={History} title="Login history" onPress={() => navigation.navigate("AccountSecurity", { mode: "logins" })} />
              <ListRow Icon={DatabaseZap} title="Privacy and your data" last onPress={() => navigation.navigate("PrivacyData")} />
            </ListGroup>
          </Section>

          <Section title="Preferences">
            <ListGroup>
              <ListRow Icon={Coins} title="Currency" value={currency} onPress={() => navigation.navigate("AccountPreferences")} />
              <ListRow Icon={Coffee} title="Welcome preferences" onPress={() => navigation.navigate("KaribuStory", { focus: "preferences" })} />
              <ListRow Icon={SlidersHorizontal} title="Notifications and privacy" last onPress={() => navigation.navigate("AccountPreferences")} />
            </ListGroup>
          </Section>

          <Section title="Community">
            <ListGroup>
              <ListRow
                Icon={Gift}
                title="Invite friends"
                value={referralTotal ? `${referralTotal} joined` : undefined}
                valueTone="success"
                onPress={inviteFriends}
              />
              <ListRow Icon={Users} title="Traveller groups" onPress={() => navigation.navigate("TravellerGroups")} />
              <ListRow Icon={HeartHandshake} title="Business access" last onPress={() => navigation.navigate("BusinessAccess")} />
            </ListGroup>
          </Section>

          <Section title="Help and policies">
            <ListGroup>
              <ListRow Icon={Siren} title="Safety and emergency" tone="danger" onPress={() => navigation.navigate("SafetyCenter")} />
              <ListRow Icon={CircleHelp} title="Help Center" onPress={() => navigation.navigate("AccountResources", { mode: "help" })} />
              <ListRow Icon={MessageCircleQuestion} title="Contact support" onPress={() => navigation.navigate("AccountResources", { mode: "support" })} />
              <ListRow Icon={FileText} title="NoLSAF policies" last onPress={() => navigation.navigate("AccountResources", { mode: "policies" })} />
            </ListGroup>
          </Section>

          <Pressable
            accessibilityRole="button"
            onPress={() => setConfirmLogout(true)}
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}
          >
            <LogOut color={colors.danger} size={17} />
            <AppText variant="bodySmall" weight="extraBold" tone="danger">
              Sign out
            </AppText>
          </Pressable>
        </View>
      </SafeScreen>

      <CustomerBottomNav active="Account" />

      <ConfirmSheet
        visible={confirmLogout}
        title="Sign out?"
        message="Your secure session will be removed from this device."
        confirmLabel="Sign out"
        destructive
        loading={loggingOut}
        onCancel={() => setConfirmLogout(false)}
        onConfirm={logout}
      />
    </View>
  );
}

function Section({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <AppText variant="titleSm" weight="extraBold">
          {title}
        </AppText>
        {aside}
      </View>
      {children}
    </View>
  );
}

function TravelTile({ Icon, label, count, onPress }: { Icon: IconType; label: string; count?: number | null; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.travelTile, pressed && styles.pressed]}>
      <View style={styles.travelIcon}>
        <Icon color={colors.primary} size={17} />
      </View>
      <View style={styles.travelText}>
        {count !== undefined ? (
          <AppText variant="titleSm" weight="extraBold">
            {count == null ? "-" : count}
          </AppText>
        ) : null}
        <AppText variant="caption" weight="semiBold" tone="soft" numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </Pressable>
  );
}

function ListGroup({ children }: { children: React.ReactNode }) {
  return <View style={styles.listGroup}>{children}</View>;
}

function ListRow({
  Icon,
  title,
  value,
  valueTone = "soft",
  tone,
  last,
  onPress
}: {
  Icon: IconType;
  title: string;
  value?: string;
  valueTone?: "soft" | "success" | "warning";
  tone?: "danger";
  last?: boolean;
  onPress: () => void;
}) {
  const danger = tone === "danger";
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.listRow, pressed && styles.listRowPressed]}>
      <View style={[styles.listIcon, danger && styles.listIconDanger]}>
        <Icon color={danger ? colors.danger : colors.primary} size={17} />
      </View>
      <View style={[styles.listBody, !last && styles.listDivider]}>
        <AppText variant="bodySmall" weight="bold" numberOfLines={1} style={styles.flex}>
          {title}
        </AppText>
        {value ? (
          <AppText variant="caption" weight="bold" tone={valueTone}>
            {value}
          </AppText>
        ) : null}
        <ChevronRight color={colors.softText} size={17} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface
  },
  screen: {
    paddingBottom: spacing[10]
  },
  content: {
    gap: spacing[6]
  },
  flex: {
    flex: 1,
    minWidth: 0
  },
  pressed: {
    opacity: 0.8
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: -spacing[2]
  },
  headerBell: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border
  },
  profileCard: {
    gap: spacing[4],
    borderRadius: radius.xl,
    backgroundColor: colors.primaryDeep,
    padding: spacing[5]
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3]
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.18)"
  },
  avatarImage: {
    width: "100%",
    height: "100%"
  },
  profileMeta: {
    color: colors.brand[200],
    marginTop: 2
  },
  securityMeter: {
    gap: spacing[2],
    borderRadius: radius.lg,
    backgroundColor: "rgba(255,255,255,0.07)",
    padding: spacing[3]
  },
  securityMeterTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  meterTrack: {
    height: 6,
    borderRadius: radius.full,
    backgroundColor: "rgba(255,255,255,0.14)",
    overflow: "hidden"
  },
  meterFill: {
    height: "100%",
    borderRadius: radius.full
  },
  section: {
    gap: spacing[3]
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[2],
    paddingHorizontal: 2
  },
  travelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  travelTile: {
    flexGrow: 1,
    flexBasis: "30%",
    minWidth: 96,
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3],
    ...shadows.card
  },
  travelIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  travelText: {
    minHeight: 40,
    justifyContent: "flex-end"
  },
  scoreChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing[2],
    paddingVertical: 3
  },
  listGroup: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    overflow: "hidden",
    ...shadows.card
  },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    paddingLeft: spacing[4]
  },
  listRowPressed: {
    backgroundColor: colors.surface
  },
  listIcon: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brand[50]
  },
  listIconDanger: {
    backgroundColor: "#fef2f2"
  },
  listBody: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[2],
    paddingRight: spacing[3]
  },
  listDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border
  },
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: colors.white,
    paddingVertical: spacing[4]
  }
});
