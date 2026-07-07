import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Ban,
  Bell,
  Bookmark,
  Camera,
  ChevronRight,
  CircleHelp,
  FileText,
  Fingerprint,
  Gift,
  HeartHandshake,
  Home,
  KeyRound,
  LockKeyhole,
  LogOut,
  Mail,
  Map,
  MessageCircleQuestion,
  Phone,
  Settings,
  ShieldCheck,
  TicketCheck,
  User,
  Users
} from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";

import { useAuth } from "../auth";
import { AppCard, AppText, ConfirmSheet, CustomerBottomNav, SafeScreen, ScreenHeader } from "../components";
import { apiUploadFile } from "../lib/apiClient";
import { RootStackParamList } from "../navigation/types";
import { fetchReferralInfo } from "../referrals";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Account">;
type IconType = typeof User;

const ROLE_LABELS: Record<string, string> = {
  CUSTOMER: "Traveller"
};

function roleLabel(role?: string | null) {
  const key = String(role || "CUSTOMER").toUpperCase();
  return ROLE_LABELS[key] || key;
}

export function AccountScreen({ navigation }: Props) {
  const { token, user, signOut, updateProfile } = useAuth();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [referralLink, setReferralLink] = useState<string | null>(null);
  const [referralTotal, setReferralTotal] = useState<number | null>(null);

  useEffect(() => {
    if (!token) return;
    fetchReferralInfo(token)
      .then((res) => {
        setReferralLink(res.link);
        setReferralTotal(res.total);
      })
      .catch(() => undefined);
  }, [token]);

  const displayName = user?.fullName || user?.name || user?.email || "NoLSAF customer";
  const initial = String(displayName).trim().charAt(0).toUpperCase() || "N";
  const verifiedCount = [user?.emailVerifiedAt, user?.phoneVerifiedAt, user?.twoFactorEnabled].filter(Boolean).length;

  async function logout() {
    setLoggingOut(true);
    await signOut();
    setLoggingOut(false);
  }

  async function uploadTravellerPhoto() {
    if (!token) {
      Alert.alert("Profile photo", "Please sign in to update your profile photo.");
      return;
    }
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png"],
        multiple: false,
        copyToCacheDirectory: true
      });
      if (picked.canceled || !picked.assets?.[0]) return;
      const asset = picked.assets[0];
      setUploadingPhoto(true);
      const uploaded = await apiUploadFile<{ secure_url?: string; url?: string }>("/api/uploads/cloudinary/upload", {
        token,
        file: {
          uri: asset.uri,
          name: asset.name || `traveller-${user?.id || "profile"}.jpg`,
          type: asset.mimeType || "image/jpeg",
          file: (asset as any).file || null
        },
        fields: { folder: "avatars" }
      });
      const avatarUrl = uploaded.secure_url || uploaded.url;
      if (!avatarUrl) throw new Error("Upload completed without a photo URL.");
      await updateProfile({ avatarUrl });
    } catch (err) {
      Alert.alert("Profile photo", err instanceof Error ? err.message : "Could not update your profile photo.");
    } finally {
      setUploadingPhoto(false);
    }
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
          <ScreenHeader
            title="Account"
            subtitle="Your NoLSAF profile, travel activity, security, policies, and support."
            onBack={() => navigation.goBack()}
            action={
              <Pressable accessibilityRole="button" onPress={() => navigation.navigate("Notifications")} style={styles.headerBell}>
                <Bell color={colors.ink} size={20} />
              </Pressable>
            }
          />

          <AppCard style={styles.profileHero}>
            <View style={styles.profileRow}>
              <Pressable accessibilityRole="button" onPress={uploadTravellerPhoto} style={styles.avatarWrap}>
                <View style={styles.avatar}>
                  {user?.avatarUrl ? (
                    <Image source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <AppText variant="title" weight="extraBold" tone="inverse">
                      {initial}
                    </AppText>
                  )}
                  {uploadingPhoto ? (
                    <View style={styles.avatarOverlay}>
                      <ActivityIndicator color={colors.white} />
                    </View>
                  ) : null}
                </View>
                <View style={styles.cameraBadge}>
                  <Camera color={colors.white} size={15} />
                </View>
              </Pressable>
              <View style={styles.profileText}>
                <AppText variant="title" weight="extraBold" numberOfLines={2}>
                  {displayName}
                </AppText>
                <AppText variant="bodySmall" tone="muted" numberOfLines={1}>
                  {roleLabel(user?.role)}
                </AppText>
              </View>
              <View style={styles.profileScore}>
                <ShieldCheck color={colors.primary} size={17} />
                <AppText variant="caption" weight="extraBold" tone="primary">
                  {verifiedCount}/3
                </AppText>
              </View>
            </View>
          </AppCard>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.identityRail}>
            <IdentityTile Icon={Mail} label="Email" value={user?.email || "Not added"} verified={Boolean(user?.emailVerifiedAt)} />
            <IdentityTile Icon={Phone} label="Phone" value={user?.phone || "Not added"} verified={Boolean(user?.phoneVerifiedAt)} />
            <IdentityTile Icon={ShieldCheck} label="2FA" value={user?.twoFactorEnabled ? "Enabled" : "Not enabled"} verified={Boolean(user?.twoFactorEnabled)} />
          </ScrollView>

          <AppCard style={styles.quickPanel}>
            <View style={styles.sectionHeader}>
              <View style={styles.sectionIcon}>
                <Map color={colors.primary} size={18} />
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="extraBold">
                  My NoLSAF
                </AppText>
                <AppText variant="caption" tone="muted">
                  Your active travel products in one account.
                </AppText>
              </View>
            </View>
            <View style={styles.serviceGrid}>
              <ServiceTile Icon={Home} title="My Group Stay" text="Stays and bookings" onPress={() => navigation.navigate("MyGroupStays")} />
              <ServiceTile Icon={TicketCheck} title="My Tour Packages" text="Tours and timelines" onPress={() => navigation.navigate("MyTours")} />
              <ServiceTile Icon={User} title="My Profile" text="Identity and contacts" onPress={() => navigation.navigate("ProfileCompletion")} />
            </View>
          </AppCard>

          <MenuSection title="Profile Tools">
            <MenuRow Icon={Bookmark} title="Saved" subtitle="Saved stays, tours, and useful places." onPress={() => navigation.navigate("SavedProperties")} />
            <MenuRow
              Icon={Gift}
              title="Invite friends"
              subtitle={
                referralTotal != null && referralTotal > 0
                  ? `${referralTotal} friend${referralTotal === 1 ? "" : "s"} joined using your invite.`
                  : "Share NoLSAF with other travellers."
              }
              onPress={inviteFriends}
            />
            <MenuRow Icon={Users} title="Traveller groups" subtitle="Manage people connected to your trips." onPress={() => navigation.navigate("TravellerGroups")} />
          </MenuSection>

          <AppCard style={styles.securityPanel}>
            <View style={styles.sectionHeader}>
              <View style={styles.passkeyIcon}>
                <Fingerprint color="#7c3aed" size={22} />
              </View>
              <View style={styles.flex}>
                <AppText variant="titleSm" weight="extraBold">
                  Account Settings
                </AppText>
                <AppText variant="caption" tone="muted">
                  Password, passkeys, 2FA, MFA, and trusted sessions.
                </AppText>
              </View>
            </View>
            <View style={styles.securityActions}>
              <SecurityPill Icon={KeyRound} label="Password" onPress={() => navigation.navigate("AccountSecurity", { mode: "password" })} />
              <SecurityPill Icon={Fingerprint} label="Passkeys" onPress={() => navigation.navigate("AccountSecurity", { mode: "passkeys" })} />
              <SecurityPill Icon={LockKeyhole} label="2FA / MFA" onPress={() => navigation.navigate("AccountSecurity", { mode: "2fa" })} />
            </View>
          </AppCard>

          <MenuSection title="Policies & Support">
            <MenuRow Icon={Ban} title="Cancellation claims" subtitle="Request a booking cancellation and track its status and messages." onPress={() => navigation.navigate("MyCancellations")} />
            <MenuRow Icon={FileText} title="NoLSAF Policies" subtitle="Traveller terms, privacy, payments, refunds, and safety policies." onPress={() => navigation.navigate("AccountResources", { mode: "policies" })} />
            <MenuRow Icon={CircleHelp} title="Help Center" subtitle="Get support for rides, stays, tours, payments, and documents." onPress={() => navigation.navigate("AccountResources", { mode: "help" })} />
            <MenuRow Icon={MessageCircleQuestion} title="Contact support" subtitle="Reach NoLSAF customer support from your account." onPress={() => navigation.navigate("AccountResources", { mode: "support" })} />
          </MenuSection>

          <MenuSection title="Session">
            <MenuRow Icon={Settings} title="Account preferences" subtitle="Notifications and account controls." onPress={() => navigation.navigate("AccountPreferences")} />
            <MenuRow Icon={HeartHandshake} title="Business access" subtitle="Operator, host, and partner tools open from web." onPress={() => navigation.navigate("BusinessAccess")} />
            <MenuRow Icon={LogOut} title="Sign out" subtitle="Remove this secure session from the device." danger onPress={() => setConfirmLogout(true)} />
          </MenuSection>
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

function IdentityTile({ Icon, label, value, verified }: { Icon: IconType; label: string; value: string; verified: boolean }) {
  return (
    <View style={styles.identityTile}>
      <View style={styles.identityTop}>
        <View style={[styles.identityMiniIcon, verified && styles.identityMiniIconVerified]}>
          <Icon color={verified ? colors.success : colors.softText} size={14} />
        </View>
        {verified ? (
          <View style={styles.verifiedMini}>
            <ShieldCheck color={colors.success} size={12} />
            <AppText variant="caption" weight="extraBold" tone="success">
              Verified
            </AppText>
          </View>
        ) : null}
      </View>
      <AppText variant="caption" weight="bold" tone="soft" style={styles.infoLabel}>
        {label}
      </AppText>
      <AppText variant="bodySmall" weight="extraBold" numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

function ServiceTile({ Icon, title, text, onPress }: { Icon: IconType; title: string; text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.serviceTile, pressed && styles.pressed]}>
      <View style={styles.serviceIcon}>
        <Icon color={colors.primary} size={18} />
      </View>
      <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
        {title}
      </AppText>
      <AppText variant="caption" tone="muted" numberOfLines={2}>
        {text}
      </AppText>
    </Pressable>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <AppCard style={styles.menuSection}>
      <AppText variant="caption" weight="bold" tone="soft" style={styles.sectionLabel}>
        {title}
      </AppText>
      <View style={styles.menuList}>{children}</View>
    </AppCard>
  );
}

function MenuRow({
  Icon,
  title,
  subtitle,
  danger,
  onPress
}: {
  Icon: IconType;
  title: string;
  subtitle: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.menuRow, pressed && styles.pressed]}>
      <View style={[styles.menuIcon, danger && styles.menuIconDanger]}>
        <Icon color={danger ? colors.danger : colors.primary} size={19} />
      </View>
      <View style={styles.flex}>
        <AppText variant="bodySmall" weight="extraBold" tone={danger ? "danger" : "default"}>
          {title}
        </AppText>
        <AppText variant="caption" tone="muted" numberOfLines={2}>
          {subtitle}
        </AppText>
      </View>
      <ChevronRight color={colors.softText} size={18} />
    </Pressable>
  );
}

function SecurityPill({ Icon, label, onPress }: { Icon: IconType; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.securityPill, pressed && styles.pressed]}>
      <Icon color={colors.primary} size={16} />
      <AppText variant="caption" weight="extraBold" tone="primary" numberOfLines={1}>
        {label}
      </AppText>
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
    gap: spacing[4]
  },
  flex: {
    flex: 1,
    minWidth: 0
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
  profileHero: {
    padding: spacing[4],
    borderColor: colors.brand[100],
    backgroundColor: "#f7fffc"
  },
  profileRow: {
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing[3]
  },
  avatarWrap: {
    position: "relative"
  },
  avatar: {
    width: 86,
    height: 86,
    borderRadius: radius.full,
    backgroundColor: colors.primaryDeep,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  avatarImage: {
    width: "100%",
    height: "100%"
  },
  avatarOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(2,6,23,0.42)"
  },
  cameraBadge: {
    position: "absolute",
    right: 0,
    bottom: 2,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.white
  },
  profileText: {
    flex: 1,
    minWidth: 0,
    gap: spacing[2],
    paddingTop: spacing[1]
  },
  profileScore: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1]
  },
  identityRail: {
    gap: spacing[2],
    paddingRight: spacing[4]
  },
  identityTile: {
    width: 176,
    minHeight: 92,
    minWidth: 0,
    gap: spacing[1],
    borderRadius: radius.md,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing[2]
  },
  identityTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing[1]
  },
  identityMiniIcon: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border
  },
  identityMiniIconVerified: {
    backgroundColor: "#e9f7ef",
    borderColor: colors.brand[100]
  },
  verifiedMini: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[1],
    borderRadius: radius.full,
    backgroundColor: "#e9f7ef",
    paddingHorizontal: spacing[2],
    paddingVertical: 2
  },
  infoLabel: {
    textTransform: "uppercase",
    letterSpacing: 1
  },
  quickPanel: {
    gap: spacing[4]
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    minWidth: 0
  },
  sectionIcon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  serviceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  serviceTile: {
    width: "48.5%",
    minHeight: 118,
    gap: spacing[2],
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
    padding: spacing[3]
  },
  serviceIcon: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50]
  },
  menuSection: {
    gap: spacing[3],
    paddingVertical: spacing[3]
  },
  sectionLabel: {
    textTransform: "uppercase",
    letterSpacing: 1.1,
    paddingHorizontal: spacing[1]
  },
  menuList: {
    gap: spacing[1]
  },
  menuRow: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing[3],
    borderRadius: radius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2]
  },
  menuIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.full,
    backgroundColor: colors.brand[50],
    borderWidth: 1,
    borderColor: colors.brand[100]
  },
  menuIconDanger: {
    backgroundColor: "#fef2f2",
    borderColor: "#fecaca"
  },
  securityPanel: {
    gap: spacing[4],
    backgroundColor: "#fbfaff",
    borderColor: "#ede9fe"
  },
  passkeyIcon: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: "#ede9fe",
    ...shadows.card
  },
  securityActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing[2]
  },
  securityPill: {
    flexGrow: 1,
    minWidth: 104,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing[2],
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.brand[100],
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2]
  },
  pressed: {
    opacity: 0.78,
    transform: [{ scale: 0.99 }]
  }
});
