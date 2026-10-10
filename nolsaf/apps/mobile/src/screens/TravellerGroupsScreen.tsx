import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useFocusEffect } from "@react-navigation/native";
import {
  AlertTriangle,
  Baby,
  BookOpen,
  Briefcase,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Heart,
  IdCard,
  MoreHorizontal,
  Paperclip,
  Smile,
  Trash2,
  User,
  UserPlus,
  Users,
  UsersRound,
  X
} from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../auth";
import { AppButton, AppInput, AppText, OptionPickerSheet, SafeScreen, ScreenHeader, StateView } from "../components";
import { RootStackParamList } from "../navigation/types";
import {
  CustomerTourBookingSummary,
  TourGroupMember,
  addTourGroupMember,
  deleteTourGroupMember,
  fetchCustomerTourBookings,
  fetchTourGroupMembers,
  updateTourGroupMember,
  uploadTourGroupMemberFile
} from "../tours";
import { colors, radius, shadows, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TravellerGroups">;
type IconType = typeof Heart;

const DOCUMENT_TYPES: { key: string; label: string; Icon: IconType }[] = [
  { key: "PASSPORT", label: "Passport", Icon: BookOpen },
  { key: "NATIONAL_ID", label: "National ID", Icon: IdCard },
  { key: "BIRTH_CERTIFICATE", label: "Birth certificate", Icon: FileText },
  { key: "OTHER", label: "Other", Icon: MoreHorizontal }
];

const RELATIONS: { key: string; label: string; Icon: IconType }[] = [
  { key: "SPOUSE", label: "Spouse", Icon: Heart },
  { key: "CHILD", label: "Child", Icon: Baby },
  { key: "PARENT", label: "Parent", Icon: User },
  { key: "SIBLING", label: "Sibling", Icon: Users },
  { key: "RELATIVE", label: "Relative", Icon: UsersRound },
  { key: "FRIEND", label: "Friend", Icon: Smile },
  { key: "COLLEAGUE", label: "Colleague", Icon: Briefcase },
  { key: "OTHER", label: "Other", Icon: MoreHorizontal }
];

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const FORM_STEPS = ["Who", "Document", "Contact"] as const;

function relationMeta(value?: string | null) {
  return RELATIONS.find((r) => r.key === value) || { key: "OTHER", label: "Traveller", Icon: User };
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0]?.[0] || "") + (parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "")).toUpperCase();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * What the operator's guest manifest needs before a traveller counts as complete
 * (agent-portal guests page: name, nationality, date of birth, document number, ID scan).
 */
function missingFor(member: Pick<TourGroupMember, "nationality" | "dateOfBirth" | "documentNumber" | "documentUrl">) {
  return [
    !member.nationality && "nationality",
    !member.dateOfBirth && "date of birth",
    !member.documentNumber && "document number",
    !member.documentUrl && "ID scan"
  ].filter(Boolean) as string[];
}

function shortDate(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* ------------------------------------------------------------------ trip list */

function TripPicker({ navigation }: { navigation: Props["navigation"] }) {
  const { token } = useAuth();
  const [items, setItems] = useState<CustomerTourBookingSummary[]>([]);
  const [added, setAdded] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to manage your traveller groups.");
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetchCustomerTourBookings(token, { page: 1, pageSize: 30 });
      const eligible = (res.items || []).filter((item) => {
        const bucket = String(item.dashboardBucket || "").toUpperCase();
        return bucket === "PAID_PACKAGES" || bucket === "ACTIVE_TIMELINE" || bucket === "COMPLETED";
      });
      setItems(eligible);
      // How far each group is, so the list shows progress without opening each trip.
      const counts = await Promise.allSettled(eligible.map((item) => fetchTourGroupMembers(token, item.tourReference || item.id)));
      const next: Record<number, number> = {};
      counts.forEach((r, i) => {
        if (r.status === "fulfilled") next[eligible[i].id] = (r.value.members || []).length;
      });
      setAdded(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your tour packages.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <AppText variant="title" weight="extraBold" tone="inverse">Travel together</AppText>
        <AppText variant="caption" style={styles.heroSub}>Add everyone on your tour so the operator can prepare permits, rooms and pickups.</AppText>
        <View style={styles.howRow}>
          <HowStep n={1} label="Pick a trip" />
          <View style={styles.howLine} />
          <HowStep n={2} label="Add travellers" />
          <View style={styles.howLine} />
          <HowStep n={3} label="Operator ready" />
        </View>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
      ) : error ? (
        <StateView title="Couldn't load your tours" message={error} actionLabel="Try again" onAction={() => { setLoading(true); void load(); }} />
      ) : items.length === 0 ? (
        <View style={[styles.card, styles.empty]}>
          <View style={styles.emptyIcon}><UsersRound color={colors.primary} size={24} /></View>
          <AppText variant="bodySmall" weight="extraBold">No tour packages yet</AppText>
          <AppText variant="caption" tone="soft" style={styles.centerText}>Once you've paid for a tour package, it shows up here so you can add your travel group.</AppText>
          <AppButton title="Browse tour packages" onPress={() => navigation.navigate("TourPackages")} />
        </View>
      ) : (
        <View style={styles.section}>
          <AppText variant="titleSm" weight="extraBold" style={styles.sectionTitle}>Your trips</AppText>
          {items.map((item) => {
            const total = Number(item.travelerCount || 0);
            const count = added[item.id];
            const known = typeof count === "number";
            const full = known && total > 0 && count >= total;
            const percent = known && total > 0 ? Math.min(100, Math.round((count / total) * 100)) : 0;
            const dates = [shortDate(item.startDate), shortDate(item.endDate)].filter(Boolean).join(" to ");
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => navigation.navigate("TravellerGroups", { tourBookingId: item.id, tourBookingRef: item.tourReference, tourBookingTitle: item.title || undefined })}
                style={({ pressed }) => [styles.card, styles.tripCard, pressed && styles.pressed]}
              >
                <View style={styles.tripTop}>
                  <View style={styles.tileIcon}><UsersRound color={colors.primary} size={18} /></View>
                  <View style={styles.flex}>
                    <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>{item.title || "Tour package"}</AppText>
                    <AppText variant="caption" tone="soft" numberOfLines={1}>{[item.destination, dates].filter(Boolean).join(" · ") || "Destination pending"}</AppText>
                  </View>
                  <ChevronRight color={colors.softText} size={18} />
                </View>
                <View style={styles.tripProgress}>
                  <View style={styles.progressHead}>
                    <AppText variant="caption" weight="bold" tone={full ? "success" : "default"}>
                      {known ? (total > 0 ? `${count} of ${total} travellers added` : plural(count, "traveller") + " added") : "Checking group"}
                    </AppText>
                    {full ? <CheckCircle2 color={colors.success} size={14} /> : null}
                  </View>
                  {total > 0 ? (
                    <View style={styles.track}><View style={[styles.fill, { width: `${percent}%` }, full && styles.fillDone]} /></View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function HowStep({ n, label }: { n: number; label: string }) {
  return (
    <View style={styles.howStep}>
      <View style={styles.howDot}><AppText variant="caption" weight="extraBold" tone="primary">{n}</AppText></View>
      <AppText variant="caption" weight="semiBold" style={styles.heroSub} numberOfLines={1}>{label}</AppText>
    </View>
  );
}

/* ----------------------------------------------------------------- roster */

type FormState = {
  fullName: string;
  relation: string;
  photoUrl: string;
  documentType: string;
  documentNumber: string;
  documentExpiry: string;
  nationality: string;
  dateOfBirth: string;
  documentUrl: string;
  documentFileName: string;
  phone: string;
  email: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  fullName: "", relation: "OTHER", photoUrl: "", documentType: "", documentNumber: "", documentExpiry: "", nationality: "",
  dateOfBirth: "", documentUrl: "", documentFileName: "", phone: "", email: "", notes: ""
};

function formFrom(member: TourGroupMember): FormState {
  return {
    fullName: member.fullName || "",
    relation: member.relation || "OTHER",
    photoUrl: member.photoUrl || "",
    documentType: member.documentType || "",
    documentNumber: member.documentNumber || "",
    documentExpiry: member.documentExpiry || "",
    nationality: member.nationality || "",
    dateOfBirth: member.dateOfBirth || "",
    documentUrl: member.documentUrl || "",
    documentFileName: member.documentFileName || "",
    phone: member.phone || "",
    email: member.email || "",
    notes: member.notes || ""
  };
}

function GroupRoster({ tourBookingId, tourBookingRef, tourBookingTitle }: { tourBookingId: number; tourBookingRef?: string | null; tourBookingTitle?: string }) {
  // API paths use the opaque tr_ reference when the list provided one.
  const tourKey = tourBookingRef || tourBookingId;
  const { token } = useAuth();
  const [members, setMembers] = useState<TourGroupMember[]>([]);
  const [bookingTitle, setBookingTitle] = useState(tourBookingTitle || "");
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [travelerCount, setTravelerCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string | null } | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) {
      setError("Please sign in to manage your traveller group.");
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await fetchTourGroupMembers(token, tourKey);
      setMembers(res.members || []);
      if (res.title) setBookingTitle(res.title);
      setBookingCode(res.bookingCode || null);
      setTravelerCount(res.travelerCount ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your traveller group.");
    } finally {
      setLoading(false);
    }
  }, [token, tourKey]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const confirmRemove = (member: TourGroupMember) => {
    Alert.alert("Remove traveller", `Remove ${member.fullName} from this group?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void handleRemove(member.id) }
    ]);
  };

  const handleRemove = async (memberId: string) => {
    if (!token) return;
    setRemovingId(memberId);
    try {
      const res = await deleteTourGroupMember(token, tourKey, memberId);
      setMembers(res.members || []);
      if (editing?.id === memberId) setEditing(null);
    } catch (err) {
      Alert.alert("Couldn't remove traveller", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setRemovingId(null);
    }
  };

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>;
  }
  if (error) {
    return <StateView title="Couldn't load this group" message={error} actionLabel="Try again" onAction={() => { setLoading(true); void load(); }} />;
  }

  const total = typeof travelerCount === "number" && travelerCount > 0 ? travelerCount : 0;
  const ready = members.filter((m) => missingFor(m).length === 0).length;
  const atCapacity = total > 0 && members.length >= total;
  const openSlots = total > 0 ? Math.max(0, total - members.length) : 0;
  const addedPercent = total > 0 ? Math.min(100, Math.round((members.length / total) * 100)) : 0;
  const readyPercent = members.length > 0 ? Math.round((ready / Math.max(total, members.length)) * 100) : 0;
  const editingMember = editing?.id ? members.find((m) => m.id === editing.id) || null : null;

  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <View>
          <AppText variant="titleSm" weight="extraBold" tone="inverse" numberOfLines={2}>{bookingTitle || "Tour package"}</AppText>
          {bookingCode ? <AppText variant="caption" style={styles.heroSub}>Booking {bookingCode}</AppText> : null}
        </View>
        <View style={styles.heroStats}>
          <HeroMeter label="Added" value={total > 0 ? `${members.length}/${total}` : String(members.length)} percent={total > 0 ? addedPercent : members.length ? 100 : 0} />
          <HeroMeter label="Ready for operator" value={`${ready}/${total || members.length || 0}`} percent={readyPercent} />
        </View>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <AppText variant="titleSm" weight="extraBold">Travellers</AppText>
          <AppText variant="caption" tone="soft">Tap a traveller to edit</AppText>
        </View>

        <View style={styles.card}>
          {members.map((member, index) => {
            const missing = missingFor(member);
            const rel = relationMeta(member.relation);
            return (
              <Pressable
                key={member.id}
                accessibilityRole="button"
                onPress={() => setEditing({ id: member.id })}
                style={({ pressed }) => [styles.memberRow, index > 0 && styles.divider, pressed && styles.rowPressed]}
              >
                {member.photoUrl ? (
                  <Image source={{ uri: member.photoUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatar}><AppText variant="caption" weight="extraBold" tone="primary">{initialsOf(member.fullName)}</AppText></View>
                )}
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>{member.fullName}</AppText>
                  <AppText variant="caption" tone="soft" numberOfLines={1}>{[rel.label, member.nationality].filter(Boolean).join(" · ")}</AppText>
                  {missing.length === 0 ? (
                    <View style={styles.statusLine}>
                      <CheckCircle2 color={colors.success} size={12} />
                      <AppText variant="caption" weight="bold" tone="success">Ready for the operator</AppText>
                    </View>
                  ) : (
                    <View style={styles.statusLine}>
                      <AlertTriangle color={colors.warning} size={12} />
                      <AppText variant="caption" weight="bold" tone="warning" numberOfLines={1} style={styles.flex}>Missing {missing.join(", ")}</AppText>
                    </View>
                  )}
                </View>
                {removingId === member.id ? (
                  <ActivityIndicator color={colors.danger} />
                ) : (
                  <ChevronRight color={colors.softText} size={17} />
                )}
              </Pressable>
            );
          })}

          {Array.from({ length: openSlots }, (_, i) => (
            <Pressable
              key={`slot-${i}`}
              accessibilityRole="button"
              onPress={() => setEditing({ id: null })}
              style={({ pressed }) => [styles.memberRow, (members.length > 0 || i > 0) && styles.divider, pressed && styles.rowPressed]}
            >
              <View style={[styles.avatar, styles.slotAvatar]}><UserPlus color={colors.softText} size={16} /></View>
              <View style={styles.flex}>
                <AppText variant="bodySmall" weight="bold" tone="soft">Traveller {members.length + i + 1}</AppText>
                <AppText variant="caption" tone="soft">Not added yet</AppText>
              </View>
              <AppText variant="caption" weight="extraBold" tone="primary">Add</AppText>
            </Pressable>
          ))}

          {members.length === 0 && openSlots === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><UsersRound color={colors.primary} size={22} /></View>
              <AppText variant="bodySmall" weight="extraBold">No travellers added yet</AppText>
              <AppText variant="caption" tone="soft" style={styles.centerText}>Add each person travelling with you so the operator can prepare permits and meetup details.</AppText>
            </View>
          ) : null}
        </View>

        {total === 0 ? (
          <AppButton title="Add traveller" onPress={() => setEditing({ id: null })} icon={<UserPlus color={colors.white} size={16} />} />
        ) : atCapacity ? (
          <View style={styles.noteBox}>
            <ClipboardCheck color={colors.primary} size={16} />
            <AppText variant="caption" tone="muted" style={styles.flex}>
              This trip is set up for {plural(total, "traveller")}. Update the traveller count on your booking to add more.
            </AppText>
          </View>
        ) : null}
      </View>

      <View style={styles.noteBox}>
        <ClipboardCheck color={colors.primary} size={16} />
        <AppText variant="caption" tone="muted" style={styles.flex}>
          Your operator sees this list for their guest manifest. A traveller is ready once their nationality, date of birth, document number and ID scan are added.
        </AppText>
      </View>

      {editing && token ? (
        <MemberSheet
          token={token}
          tourKey={tourKey}
          member={editingMember}
          removing={Boolean(editingMember && removingId === editingMember.id)}
          onClose={() => setEditing(null)}
          onSaved={(next) => {
            setMembers(next);
            setEditing(null);
          }}
          onRemove={editingMember ? () => confirmRemove(editingMember) : undefined}
        />
      ) : null}
    </View>
  );
}

function HeroMeter({ label, value, percent }: { label: string; value: string; percent: number }) {
  return (
    <View style={styles.heroMeter}>
      <View style={styles.progressHead}>
        <AppText variant="caption" style={styles.heroSub}>{label}</AppText>
        <AppText variant="caption" weight="extraBold" tone="inverse">{value}</AppText>
      </View>
      <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${percent}%` }]} /></View>
    </View>
  );
}

/* -------------------------------------------------------------- the form */

function MemberSheet({
  token,
  tourKey,
  member,
  removing,
  onClose,
  onSaved,
  onRemove
}: {
  token: string;
  tourKey: number | string;
  member: TourGroupMember | null;
  removing: boolean;
  onClose: () => void;
  onSaved: (members: TourGroupMember[]) => void;
  onRemove?: () => void;
}) {
  const [form, setForm] = useState<FormState>(member ? formFrom(member) : EMPTY_FORM);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"" | "photo" | "document">("");
  const [nameError, setNameError] = useState<string | null>(null);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));
  const missing = missingFor(form);

  async function pickPhoto() {
    setUploading("photo");
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png"], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.uri) throw new Error("Could not read the selected photo.");
      const mimeType = asset.mimeType || "";
      if (!["image/jpeg", "image/jpg", "image/png"].includes(mimeType)) throw new Error("Photos must be a JPG or PNG image.");
      const uploaded = await uploadTourGroupMemberFile(token, { uri: asset.uri, name: asset.name || "photo.jpg", type: mimeType, file: (asset as any).file || null });
      const url = uploaded.secure_url || uploaded.url;
      if (!url) throw new Error("Upload completed without a photo URL.");
      set({ photoUrl: url });
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload this photo.");
    } finally {
      setUploading("");
    }
  }

  async function pickDocument() {
    setUploading("document");
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: ["image/*", "application/pdf"], copyToCacheDirectory: true, multiple: false });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.uri) throw new Error("Could not read the selected document.");
      const uploaded = await uploadTourGroupMemberFile(token, { uri: asset.uri, name: asset.name || "document", type: asset.mimeType || "application/octet-stream", file: (asset as any).file || null });
      const url = uploaded.secure_url || uploaded.url;
      if (!url) throw new Error("Upload completed without a document URL.");
      set({ documentUrl: url, documentFileName: asset.name || "Document" });
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload this document.");
    } finally {
      setUploading("");
    }
  }

  function next() {
    if (step === 0 && !form.fullName.trim()) {
      setNameError("Enter the traveller's full name.");
      return;
    }
    setStep((s) => Math.min(s + 1, FORM_STEPS.length - 1));
  }

  async function save() {
    const name = form.fullName.trim();
    if (!name) {
      setStep(0);
      setNameError("Enter the traveller's full name.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        fullName: name,
        relation: form.relation,
        documentType: form.documentType || undefined,
        documentNumber: form.documentNumber.trim() || undefined,
        documentExpiry: form.documentExpiry || undefined,
        nationality: form.nationality.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        notes: form.notes.trim() || undefined,
        photoUrl: form.photoUrl || undefined,
        documentUrl: form.documentUrl || undefined,
        documentFileName: form.documentFileName || undefined
      };
      const res = member ? await updateTourGroupMember(token, tourKey, member.id, input) : await addTourGroupMember(token, tourKey, input);
      onSaved(res.members || []);
    } catch (err) {
      Alert.alert(member ? "Couldn't save changes" : "Couldn't add traveller", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const thisYear = new Date().getFullYear();

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <SafeAreaView style={styles.sheetRoot}>
        <View style={styles.sheetHead}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.iconBtn}>
            <X color={colors.ink} size={18} />
          </Pressable>
          <View style={styles.flex}>
            <AppText variant="titleSm" weight="extraBold" numberOfLines={1}>{member ? member.fullName : "Add a traveller"}</AppText>
            <AppText variant="caption" tone="soft">Step {step + 1} of {FORM_STEPS.length} · {FORM_STEPS[step]}</AppText>
          </View>
          {member && onRemove ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove traveller" onPress={onRemove} disabled={removing} style={[styles.iconBtn, styles.iconBtnDanger]}>
              {removing ? <ActivityIndicator color={colors.danger} size="small" /> : <Trash2 color={colors.danger} size={16} />}
            </Pressable>
          ) : null}
        </View>

        <View style={styles.stepper}>
          {FORM_STEPS.map((label, i) => (
            <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected: i === step }} onPress={() => (i <= step || form.fullName.trim() ? setStep(i) : next())} style={styles.stepItem}>
              <View style={[styles.stepBar, i <= step && styles.stepBarOn]} />
              <AppText variant="caption" weight={i === step ? "extraBold" : "semiBold"} tone={i <= step ? "primary" : "soft"}>{label}</AppText>
            </Pressable>
          ))}
        </View>

        <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
          {step === 0 ? (
            <>
              <View style={styles.photoRow}>
                <Pressable accessibilityRole="button" accessibilityLabel="Add a photo" onPress={() => void pickPhoto()} style={styles.photoWrap}>
                  {form.photoUrl ? (
                    <Image source={{ uri: form.photoUrl }} style={styles.photo} />
                  ) : (
                    <View style={styles.photo}>
                      {uploading === "photo" ? <ActivityIndicator color={colors.primary} /> : <Camera color={colors.primary} size={22} />}
                    </View>
                  )}
                </Pressable>
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="extraBold">Photo</AppText>
                  <AppText variant="caption" tone="soft">Optional. Helps the guide recognise them.</AppText>
                  {form.photoUrl ? (
                    <Pressable accessibilityRole="button" onPress={() => set({ photoUrl: "" })} hitSlop={6}>
                      <AppText variant="caption" weight="extraBold" tone="danger">Remove photo</AppText>
                    </Pressable>
                  ) : null}
                </View>
              </View>
              <AppInput
                label="Full name"
                required
                placeholder="As it appears on their ID"
                value={form.fullName}
                onChangeText={(t) => { set({ fullName: t }); setNameError(null); }}
                error={nameError || undefined}
              />
              <FieldLabel label="Relation to you" />
              <View style={styles.chipWrap}>
                {RELATIONS.map((r) => (
                  <Chip key={r.key} label={r.label} Icon={r.Icon} active={form.relation === r.key} onPress={() => set({ relation: r.key })} />
                ))}
              </View>
            </>
          ) : step === 1 ? (
            <>
              <FieldLabel label="Document type" />
              <View style={styles.chipWrap}>
                {DOCUMENT_TYPES.map((d) => (
                  <Chip key={d.key} label={d.label} Icon={d.Icon} active={form.documentType === d.key} onPress={() => set({ documentType: form.documentType === d.key ? "" : d.key })} />
                ))}
              </View>
              <AppInput label="Document number" placeholder="Passport or ID number" autoCapitalize="characters" value={form.documentNumber} onChangeText={(t) => set({ documentNumber: t })} />
              <AppInput label="Nationality" placeholder="e.g. Tanzanian" autoCapitalize="words" value={form.nationality} onChangeText={(t) => set({ nationality: t.replace(/\d+/g, "") })} />
              <DateParts label="Date of birth" value={form.dateOfBirth} years={[thisYear - 100, thisYear]} onChange={(v) => set({ dateOfBirth: v })} />
              <DateParts label="Document expiry (optional)" value={form.documentExpiry} years={[thisYear, thisYear + 15]} onChange={(v) => set({ documentExpiry: v })} />
              <FieldLabel label="ID scan" />
              <Pressable accessibilityRole="button" onPress={() => void pickDocument()} style={[styles.upload, form.documentUrl && styles.uploadDone]}>
                {uploading === "document" ? (
                  <ActivityIndicator color={colors.primary} />
                ) : form.documentUrl ? (
                  <CheckCircle2 color={colors.success} size={18} />
                ) : (
                  <Paperclip color={colors.primary} size={18} />
                )}
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>{form.documentUrl ? form.documentFileName || "Document uploaded" : "Upload passport or ID"}</AppText>
                  <AppText variant="caption" tone="soft">{form.documentUrl ? "Tap to replace" : "Photo or PDF"}</AppText>
                </View>
                {form.documentUrl ? (
                  <Pressable accessibilityRole="button" accessibilityLabel="Remove document" onPress={() => set({ documentUrl: "", documentFileName: "" })} hitSlop={8}>
                    <X color={colors.danger} size={16} />
                  </Pressable>
                ) : null}
              </Pressable>
            </>
          ) : (
            <>
              <AppInput label="Phone number" placeholder="Optional" keyboardType="phone-pad" value={form.phone} onChangeText={(t) => set({ phone: t })} />
              <AppInput label="Email" placeholder="Optional" keyboardType="email-address" autoCapitalize="none" value={form.email} onChangeText={(t) => set({ email: t })} />
              <AppInput
                label="Notes"
                placeholder="Optional, e.g. dietary needs"
                value={form.notes}
                onChangeText={(t) => set({ notes: t })}
                multiline
                numberOfLines={3}
                style={styles.notes}
              />
              <View style={[styles.readyBox, missing.length === 0 && styles.readyBoxDone]}>
                {missing.length === 0 ? <CheckCircle2 color={colors.success} size={18} /> : <AlertTriangle color={colors.warning} size={18} />}
                <View style={styles.flex}>
                  <AppText variant="bodySmall" weight="extraBold" tone={missing.length === 0 ? "success" : "warning"}>
                    {missing.length === 0 ? "Ready for the operator" : "You can save now and finish later"}
                  </AppText>
                  {missing.length ? <AppText variant="caption" tone="muted">Still missing: {missing.join(", ")}.</AppText> : null}
                </View>
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.sheetFoot}>
          {step > 0 ? (
            <AppButton title="Back" variant="ghost" onPress={() => setStep((s) => s - 1)} icon={<ChevronLeft color={colors.primary} size={16} />} style={styles.flex} />
          ) : null}
          {step < FORM_STEPS.length - 1 ? (
            <>
              {member ? <AppButton title="Save" variant="secondary" loading={saving} onPress={() => void save()} style={styles.flex} /> : null}
              <AppButton title="Next" onPress={next} style={styles.flex} />
            </>
          ) : (
            <AppButton title={member ? "Save changes" : "Save traveller"} loading={saving} onPress={() => void save()} icon={<Check color={colors.white} size={16} />} style={styles.flex} />
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <AppText variant="label" weight="semiBold" tone="muted">{label}</AppText>;
}

function Chip({ label, active, Icon, onPress }: { label: string; active: boolean; Icon?: IconType; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.chip, active && styles.chipOn]}>
      {Icon ? <Icon color={active ? colors.primary : colors.softText} size={14} /> : null}
      <AppText variant="caption" weight={active ? "extraBold" : "semiBold"} tone={active ? "primary" : "muted"}>{label}</AppText>
    </Pressable>
  );
}

/** Day, month and year pickers for a YYYY-MM-DD value; no native date input. */
function DateParts({ label, value, years, onChange }: { label: string; value: string; years: [number, number]; onChange: (value: string) => void }) {
  const [picker, setPicker] = useState<"day" | "month" | "year" | null>(null);
  // Parts are held here while incomplete; only a full date (or "") ever reaches the form.
  const initial = value ? value.split("-").map(Number) : [0, 0, 0];
  const [parts, setParts] = useState<[number, number, number]>([initial[0] || 0, initial[1] || 0, initial[2] || 0]);
  const [y, m, d] = parts;
  const daysIn = m ? new Date(y || 2024, m, 0).getDate() : 31;
  const emit = (ny: number, nm: number, nd: number) => {
    const day = ny && nm && nd ? Math.min(nd, new Date(ny, nm, 0).getDate()) : nd;
    setParts([ny, nm, day]);
    onChange(ny && nm && day ? `${ny}-${String(nm).padStart(2, "0")}-${String(day).padStart(2, "0")}` : "");
  };
  const started = Boolean(y || m || d);
  const complete = Boolean(y && m && d);
  const yearOptions = Array.from({ length: years[1] - years[0] + 1 }, (_, i) => years[1] - i);

  return (
    <View style={styles.dateBlock}>
      <View style={styles.dateHead}>
        <FieldLabel label={label} />
        {started ? (
          <Pressable accessibilityRole="button" onPress={() => emit(0, 0, 0)} hitSlop={6}>
            <AppText variant="caption" weight="bold" tone="soft">Clear</AppText>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.dateRow}>
        <SelectBox text={d ? String(d) : "Day"} placeholder={!d} onPress={() => setPicker("day")} style={styles.dateDay} />
        <SelectBox text={m ? MONTHS[m - 1] : "Month"} placeholder={!m} onPress={() => setPicker("month")} style={styles.flex} />
        <SelectBox text={y ? String(y) : "Year"} placeholder={!y} onPress={() => setPicker("year")} style={styles.dateYear} />
      </View>
      {started && !complete ? <AppText variant="caption" tone="warning">Pick the day, month and year.</AppText> : null}
      <OptionPickerSheet
        visible={picker === "day"}
        title={`${label}: day`}
        options={Array.from({ length: daysIn }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
        value={d ? String(d) : undefined}
        onSelect={(v) => { emit(y, m, Number(v)); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerSheet
        visible={picker === "month"}
        title={`${label}: month`}
        options={MONTHS.map((name, i) => ({ value: String(i + 1), label: name }))}
        value={m ? String(m) : undefined}
        onSelect={(v) => { emit(y, Number(v), d); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
      <OptionPickerSheet
        visible={picker === "year"}
        title={`${label}: year`}
        options={yearOptions.map((yr) => ({ value: String(yr), label: String(yr) }))}
        value={y ? String(y) : undefined}
        onSelect={(v) => { emit(Number(v), m, d); setPicker(null); }}
        onClose={() => setPicker(null)}
      />
    </View>
  );
}

function SelectBox({ text, placeholder, onPress, style }: { text: string; placeholder: boolean; onPress: () => void; style?: object }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.select, style]}>
      <AppText variant="bodySmall" weight="semiBold" tone={placeholder ? "soft" : "default"} numberOfLines={1} style={styles.flex}>{text}</AppText>
      <ChevronDown color={colors.softText} size={15} />
    </Pressable>
  );
}

/* ----------------------------------------------------------------- screen */

export function TravellerGroupsScreen({ navigation, route }: Props) {
  const tourBookingId = route.params?.tourBookingId;
  const tourBookingTitle = route.params?.tourBookingTitle;
  const tourBookingRef = route.params?.tourBookingRef;

  return (
    <SafeScreen contentStyle={styles.screen}>
      <View style={styles.content}>
        <ScreenHeader title={tourBookingId ? "Travel group" : "Traveller groups"} onBack={() => navigation.goBack()} />
        {tourBookingId ? (
          <GroupRoster tourBookingId={tourBookingId} tourBookingRef={tourBookingRef} tourBookingTitle={tourBookingTitle} />
        ) : (
          <TripPicker navigation={navigation} />
        )}
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  screen: { paddingBottom: spacing[10] },
  content: { gap: spacing[5] },
  stack: { gap: spacing[5] },
  flex: { flex: 1, minWidth: 0 },
  centerText: { textAlign: "center" },
  pressed: { opacity: 0.85 },
  loading: { alignItems: "center", paddingVertical: spacing[8] },
  hero: { gap: spacing[4], borderRadius: radius.xl, backgroundColor: colors.primaryDeep, padding: spacing[5] },
  heroSub: { color: colors.brand[200], marginTop: 2 },
  howRow: { flexDirection: "row", alignItems: "center", gap: spacing[1] },
  howStep: { alignItems: "center", gap: 4, flexShrink: 1 },
  howDot: { width: 26, height: 26, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  howLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.2)", marginBottom: 18 },
  heroStats: { gap: spacing[2] },
  heroMeter: { gap: spacing[2], borderRadius: radius.lg, backgroundColor: "rgba(255,255,255,0.07)", padding: spacing[3] },
  heroTrack: { height: 6, borderRadius: radius.full, backgroundColor: "rgba(255,255,255,0.14)", overflow: "hidden" },
  heroFill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.brand[200] },
  section: { gap: spacing[3] },
  sectionTitle: { paddingHorizontal: 2 },
  sectionHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 2 },
  card: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, overflow: "hidden", ...shadows.card },
  empty: { alignItems: "center", gap: spacing[2], padding: spacing[6] },
  emptyIcon: { width: 48, height: 48, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  tripCard: { gap: spacing[3], padding: spacing[4] },
  tripTop: { flexDirection: "row", alignItems: "center", gap: spacing[3] },
  tileIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  tripProgress: { gap: spacing[2] },
  progressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing[2] },
  track: { height: 6, borderRadius: radius.full, backgroundColor: colors.brand[50], overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.full, backgroundColor: colors.primary },
  fillDone: { backgroundColor: colors.success },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing[3], padding: spacing[4] },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surface },
  avatar: { width: 44, height: 44, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50] },
  slotAvatar: { backgroundColor: colors.white, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  noteBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing[2], borderRadius: radius.md, backgroundColor: colors.brand[50], padding: spacing[3] },
  sheetRoot: { flex: 1, backgroundColor: colors.surface },
  sheetHead: { flexDirection: "row", alignItems: "center", gap: spacing[3], paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[2] },
  iconBtn: { width: 38, height: 38, borderRadius: radius.full, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white },
  iconBtnDanger: { borderColor: "#fecaca", backgroundColor: "#fef2f2" },
  stepper: { flexDirection: "row", gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[3] },
  stepItem: { flex: 1, gap: 6 },
  stepBar: { height: 4, borderRadius: radius.full, backgroundColor: colors.border },
  stepBarOn: { backgroundColor: colors.primary },
  sheetBody: { gap: spacing[4], padding: spacing[4], paddingBottom: spacing[8] },
  sheetFoot: { flexDirection: "row", gap: spacing[2], borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.white, padding: spacing[4] },
  photoRow: { flexDirection: "row", alignItems: "center", gap: spacing[4] },
  photoWrap: { borderRadius: radius.full },
  photo: { width: 72, height: 72, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: colors.brand[50], borderWidth: 1, borderColor: colors.brand[100] },
  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing[2], marginTop: -spacing[2] },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 36, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing[3] },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.brand[50] },
  dateBlock: { gap: spacing[2] },
  dateHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  dateRow: { flexDirection: "row", gap: spacing[2] },
  dateDay: { width: 76 },
  dateYear: { width: 92 },
  select: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing[1], borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.white, paddingHorizontal: spacing[3] },
  upload: { flexDirection: "row", alignItems: "center", gap: spacing[3], borderRadius: radius.md, borderWidth: 1, borderStyle: "dashed", borderColor: colors.brand[100], backgroundColor: colors.white, padding: spacing[4], marginTop: -spacing[2] },
  uploadDone: { borderStyle: "solid", borderColor: "#a7f3d0", backgroundColor: "#ecfdf5" },
  notes: { minHeight: 80, textAlignVertical: "top" },
  readyBox: { flexDirection: "row", alignItems: "flex-start", gap: spacing[3], borderRadius: radius.md, borderWidth: 1, borderColor: "#fde68a", backgroundColor: "#fffbeb", padding: spacing[3] },
  readyBoxDone: { borderColor: "#a7f3d0", backgroundColor: "#ecfdf5" }
});
