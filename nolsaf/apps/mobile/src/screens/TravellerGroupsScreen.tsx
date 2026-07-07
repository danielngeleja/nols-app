import { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Baby,
  BookOpen,
  Briefcase,
  Camera,
  FileText,
  Heart,
  IdCard,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Smile,
  Trash2,
  User,
  UserPlus,
  Users,
  UsersRound,
  X
} from "lucide-react-native";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, View, useWindowDimensions } from "react-native";

import { useAuth } from "../auth";
import { AppButton, AppCard, AppInput, AppStack, AppText, SafeScreen, ScreenHeader, StateView } from "../components";
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
import { colors, radius, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "TravellerGroups">;

const DOCUMENT_TYPES: { key: string; label: string; Icon: typeof Heart }[] = [
  { key: "PASSPORT", label: "Passport", Icon: BookOpen },
  { key: "NATIONAL_ID", label: "National ID", Icon: IdCard },
  { key: "BIRTH_CERTIFICATE", label: "Birth certificate", Icon: FileText },
  { key: "OTHER", label: "Other", Icon: MoreHorizontal }
];

const RELATIONS: { key: string; label: string; Icon: typeof Heart }[] = [
  { key: "SPOUSE", label: "Spouse", Icon: Heart },
  { key: "CHILD", label: "Child", Icon: Baby },
  { key: "PARENT", label: "Parent", Icon: User },
  { key: "SIBLING", label: "Sibling", Icon: Users },
  { key: "RELATIVE", label: "Relative", Icon: UsersRound },
  { key: "FRIEND", label: "Friend", Icon: Smile },
  { key: "COLLEAGUE", label: "Colleague", Icon: Briefcase },
  { key: "OTHER", label: "Other", Icon: MoreHorizontal }
];

function relationMeta(value?: string | null) {
  return RELATIONS.find((r) => r.key === value) || { key: "OTHER", label: "Traveller", Icon: User };
}

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] || "" : "";
  return (first + last).toUpperCase();
}

function chunk<T>(items: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size));
  return rows;
}

function Chip({ label, active, Icon, onPress }: { label: string; active: boolean; Icon?: typeof Heart; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing[1],
        paddingHorizontal: spacing[3],
        paddingVertical: spacing[2],
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        backgroundColor: active ? colors.brand[50] : colors.white
      }}
    >
      {Icon ? <Icon color={active ? colors.primary : colors.softText} size={14} /> : null}
      <AppText variant="caption" weight={active ? "bold" : "regular"} tone={active ? "primary" : "muted"}>
        {label}
      </AppText>
    </Pressable>
  );
}

function MemberCard({
  member,
  width,
  removing,
  onEdit,
  onDelete
}: {
  member: TourGroupMember;
  width: number;
  removing: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const relation = relationMeta(member.relation);
  const RelationIcon = relation.Icon;
  const document = DOCUMENT_TYPES.find((d) => d.key === member.documentType) || null;

  return (
    <Pressable onPress={onEdit} style={{ width }}>
      <AppCard style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing[3], padding: spacing[3] }}>
        {member.photoUrl ? (
          <Image source={{ uri: member.photoUrl }} style={{ width: 56, height: 56, borderRadius: radius.full }} />
        ) : (
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.brand[50],
              borderWidth: 1,
              borderColor: colors.brand[100]
            }}
          >
            <AppText variant="bodySmall" weight="extraBold" tone="primary">
              {initialsOf(member.fullName)}
            </AppText>
          </View>
        )}

        <View style={{ flex: 1, minWidth: 0, gap: spacing[2] }}>
          <AppText variant="bodySmall" weight="extraBold" numberOfLines={2}>
            {member.fullName}
          </AppText>

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing[1],
              alignSelf: "flex-start",
              paddingHorizontal: spacing[2],
              paddingVertical: spacing[1],
              borderRadius: radius.full,
              backgroundColor: colors.brand[50]
            }}
          >
            <RelationIcon color={colors.primary} size={12} />
            <AppText variant="caption" weight="bold" tone="primary">
              {relation.label}
            </AppText>
          </View>

          {document || member.documentNumber ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {[document?.label, member.documentNumber].filter(Boolean).join(" • ")}
            </AppText>
          ) : null}

          {member.nationality || member.phone ? (
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {[member.nationality, member.phone].filter(Boolean).join(" • ")}
            </AppText>
          ) : null}
        </View>

        <View style={{ gap: spacing[2] }}>
          <Pressable
            accessibilityRole="button"
            onPress={onEdit}
            style={{
              width: 32,
              height: 32,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.brand[50]
            }}
          >
            <Pencil color={colors.primary} size={14} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={removing}
            onPress={onDelete}
            style={{
              width: 32,
              height: 32,
              borderRadius: radius.full,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#fee2e2",
              opacity: removing ? 0.5 : 1
            }}
          >
            {removing ? <ActivityIndicator size="small" color={colors.danger} /> : <Trash2 color={colors.danger} size={14} />}
          </Pressable>
        </View>
      </AppCard>
    </Pressable>
  );
}

function TripPicker({ navigation }: { navigation: Props["navigation"] }) {
  const { token } = useAuth();
  const [items, setItems] = useState<CustomerTourBookingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (!token) {
      setError("Please sign in to manage your traveller groups.");
      setLoading(false);
      return;
    }
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchCustomerTourBookings(token, { page: 1, pageSize: 30 });
      const eligible = (res.items || []).filter((item) => {
        const bucket = String(item.dashboardBucket || "").toUpperCase();
        return bucket === "PAID_PACKAGES" || bucket === "ACTIVE_TIMELINE" || bucket === "COMPLETED";
      });
      setItems(eligible);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your tour packages.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: spacing[8], gap: spacing[4] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
    >
      <AppCard style={{ alignItems: "center", gap: spacing[3], paddingVertical: spacing[6] }}>
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: colors.brand[50],
            borderWidth: 1,
            borderColor: colors.brand[100]
          }}
        >
          <Users color={colors.primary} size={28} />
        </View>
        <AppText variant="titleSm" weight="extraBold" style={{ textAlign: "center" }}>
          Pick a trip to manage its group
        </AppText>
        <AppText variant="bodySmall" tone="muted" style={{ textAlign: "center" }}>
          Add the people travelling with you on a tour package, so the operator has everyone&apos;s details.
        </AppText>
      </AppCard>

      {loading ? (
        <View style={{ paddingVertical: spacing[6], alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <StateView title="Couldn't load your tours" message={error} actionLabel="Try again" onAction={() => load()} />
      ) : items.length === 0 ? (
        <StateView
          title="No tour packages yet"
          message="Once you've paid for a tour package, it will show up here so you can add your travel group."
          actionLabel="Browse tour packages"
          onAction={() => navigation.navigate("TourPackages")}
        />
      ) : (
        items.map((item) => (
          <AppCard key={item.id} style={{ gap: spacing[3] }}>
            <AppStack gap={1}>
              <AppText variant="bodySmall" weight="extraBold" numberOfLines={1}>
                {item.title || "Tour package"}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {item.destination || "Destination pending"} • {item.travelerCount || 1} traveller(s)
              </AppText>
            </AppStack>
            <AppButton
              title="Manage group"
              variant="secondary"
              icon={<Users color={colors.primary} size={16} />}
              onPress={() => navigation.navigate("TravellerGroups", { tourBookingId: item.id, tourBookingTitle: item.title || undefined })}
            />
          </AppCard>
        ))
      )}
    </ScrollView>
  );
}

function GroupRoster({ tourBookingId, tourBookingTitle }: { tourBookingId: number; tourBookingTitle?: string }) {
  const { token } = useAuth();
  const { width: windowWidth } = useWindowDimensions();
  const [members, setMembers] = useState<TourGroupMember[]>([]);
  const [bookingTitle, setBookingTitle] = useState(tourBookingTitle || "");
  const [bookingCode, setBookingCode] = useState<string | null>(null);
  const [travelerCount, setTravelerCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [documentType, setDocumentType] = useState<string>("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [nationality, setNationality] = useState("");
  const [phone, setPhone] = useState("");
  const [relation, setRelation] = useState<string>("OTHER");
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [documentFileName, setDocumentFileName] = useState("");
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);

  const load = useCallback(async (mode: "initial" | "refresh" = "initial") => {
    if (!token) {
      setError("Please sign in to manage your traveller group.");
      setLoading(false);
      return;
    }
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await fetchTourGroupMembers(token, tourBookingId);
      setMembers(res.members || []);
      if (res.title) setBookingTitle(res.title);
      setBookingCode(res.bookingCode || null);
      setTravelerCount(res.travelerCount ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load your traveller group.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token, tourBookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const resetForm = () => {
    setFullName("");
    setDocumentType("");
    setDocumentNumber("");
    setNationality("");
    setPhone("");
    setRelation("OTHER");
    setNotes("");
    setPhotoUrl("");
    setDocumentUrl("");
    setDocumentFileName("");
    setEditingId(null);
  };

  const startAdd = () => {
    resetForm();
    setShowForm(true);
  };

  const startEdit = (member: TourGroupMember) => {
    setEditingId(member.id);
    setFullName(member.fullName || "");
    setDocumentType(member.documentType || "");
    setDocumentNumber(member.documentNumber || "");
    setNationality(member.nationality || "");
    setPhone(member.phone || "");
    setRelation(member.relation || "OTHER");
    setNotes(member.notes || "");
    setPhotoUrl(member.photoUrl || "");
    setDocumentUrl(member.documentUrl || "");
    setDocumentFileName(member.documentFileName || "");
    setShowForm(true);
  };

  const atCapacity = useMemo(() => {
    if (editingId) return false;
    return typeof travelerCount === "number" && travelerCount > 0 && members.length >= travelerCount;
  }, [editingId, members.length, travelerCount]);

  const pickPhoto = async () => {
    if (!token) return;
    setUploadingPhoto(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/jpeg", "image/png"],
        copyToCacheDirectory: true,
        multiple: false
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.uri) throw new Error("Could not read the selected photo.");
      const mimeType = asset.mimeType || "";
      if (!["image/jpeg", "image/jpg", "image/png"].includes(mimeType)) {
        throw new Error("Photos must be a JPG or PNG image.");
      }
      const uploaded = await uploadTourGroupMemberFile(token, {
        uri: asset.uri,
        name: asset.name || "photo.jpg",
        type: mimeType,
        file: (asset as any).file || null
      });
      const url = uploaded.secure_url || uploaded.url;
      if (!url) throw new Error("Upload completed without a photo URL.");
      setPhotoUrl(url);
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload this photo.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const pickDocument = async () => {
    if (!token) return;
    setUploadingDocument(true);
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["image/*", "application/pdf"],
        copyToCacheDirectory: true,
        multiple: false
      });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      if (!asset?.uri) throw new Error("Could not read the selected document.");
      const uploaded = await uploadTourGroupMemberFile(token, {
        uri: asset.uri,
        name: asset.name || "document",
        type: asset.mimeType || "application/octet-stream",
        file: (asset as any).file || null
      });
      const url = uploaded.secure_url || uploaded.url;
      if (!url) throw new Error("Upload completed without a document URL.");
      setDocumentUrl(url);
      setDocumentFileName(asset.name || "Document");
    } catch (err) {
      Alert.alert("Upload failed", err instanceof Error ? err.message : "Could not upload this document.");
    } finally {
      setUploadingDocument(false);
    }
  };

  const handleSave = async () => {
    if (!token) return;
    const name = fullName.trim();
    if (!name) {
      Alert.alert("Name required", "Please enter the traveller's full name.");
      return;
    }
    setSaving(true);
    try {
      const input = {
        fullName: name,
        documentType: documentType || undefined,
        documentNumber: documentNumber.trim() || undefined,
        nationality: nationality.trim() || undefined,
        phone: phone.trim() || undefined,
        relation,
        notes: notes.trim() || undefined,
        photoUrl: photoUrl || undefined,
        documentUrl: documentUrl || undefined,
        documentFileName: documentFileName || undefined
      };
      const res = editingId
        ? await updateTourGroupMember(token, tourBookingId, editingId, input)
        : await addTourGroupMember(token, tourBookingId, input);
      setMembers(res.members || []);
      resetForm();
      setShowForm(false);
    } catch (err) {
      Alert.alert(editingId ? "Couldn't save changes" : "Couldn't add traveller", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const confirmRemove = (member: TourGroupMember) => {
    Alert.alert("Remove traveller", `Remove ${member.fullName} from this group?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => void handleRemove(member.id)
      }
    ]);
  };

  const handleRemove = async (memberId: string) => {
    if (!token) return;
    setRemovingId(memberId);
    try {
      const res = await deleteTourGroupMember(token, tourBookingId, memberId);
      setMembers(res.members || []);
      if (editingId === memberId) {
        resetForm();
        setShowForm(false);
      }
    } catch (err) {
      Alert.alert("Couldn't remove traveller", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setRemovingId(null);
    }
  };

  const memberRows = useMemo(() => chunk(members, 1), [members]);

  if (loading) {
    return (
      <View style={{ paddingVertical: spacing[8], alignItems: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (error) {
    return <StateView title="Couldn't load this group" message={error} actionLabel="Try again" onAction={() => load()} />;
  }

  const cardGap = spacing[2];
  const gridWidth = windowWidth - spacing[4] * 2;
  const cardWidth = gridWidth;

  return (
    <ScrollView
      contentContainerStyle={{ paddingBottom: spacing[8], gap: spacing[4] }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load("refresh")} tintColor={colors.primary} />}
    >
      <AppCard style={{ gap: spacing[1] }}>
        <AppText variant="bodySmall" weight="extraBold" numberOfLines={2}>
          {bookingTitle || "Tour package"}
        </AppText>
        <AppText variant="caption" tone="muted">
          {bookingCode ? `Booking ${bookingCode} • ` : ""}
          {typeof travelerCount === "number" && travelerCount > 0
            ? `${members.length}/${travelerCount} traveller(s) added`
            : `${members.length} traveller(s) added`}
        </AppText>
      </AppCard>

      {members.length === 0 ? (
        <AppCard style={{ alignItems: "center", gap: spacing[2], paddingVertical: spacing[6] }}>
          <Users color={colors.primary} size={28} />
          <AppText variant="bodySmall" weight="bold" style={{ textAlign: "center" }}>
            No travellers added yet
          </AppText>
          <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
            Add each person travelling with you so the operator can prepare permits and meetup details.
          </AppText>
        </AppCard>
      ) : (
        <ScrollView
          horizontal
          pagingEnabled={memberRows.length > 1}
          showsHorizontalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={memberRows.length > 1 ? gridWidth : undefined}
        >
          {memberRows.map((row, idx) => (
            <View key={idx} style={{ width: gridWidth, flexDirection: "row", gap: cardGap }}>
              {row.map((member) => (
                <MemberCard
                  key={member.id}
                  member={member}
                  width={cardWidth}
                  removing={removingId === member.id}
                  onEdit={() => startEdit(member)}
                  onDelete={() => confirmRemove(member)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      )}

      {showForm ? (
        <AppCard style={{ gap: spacing[3] }}>
          <AppText variant="bodySmall" weight="extraBold">
            {editingId ? "Edit traveller details" : "Add a traveller"}
          </AppText>
          <AppInput label="Full name" required placeholder="As it appears on their ID" value={fullName} onChangeText={setFullName} />
          <AppStack gap={2}>
            <AppText variant="label" weight="semiBold" tone="muted">
              Relation to you
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing[2], paddingRight: spacing[2] }}>
              {RELATIONS.map((r) => (
                <Chip key={r.key} label={r.label} Icon={r.Icon} active={relation === r.key} onPress={() => setRelation(r.key)} />
              ))}
            </ScrollView>
          </AppStack>
          <AppStack gap={2}>
            <AppText variant="label" weight="semiBold" tone="muted">
              Document type
            </AppText>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing[2], paddingRight: spacing[2] }}>
              {DOCUMENT_TYPES.map((d) => (
                <Chip key={d.key} label={d.label} Icon={d.Icon} active={documentType === d.key} onPress={() => setDocumentType(documentType === d.key ? "" : d.key)} />
              ))}
            </ScrollView>
          </AppStack>
          <AppInput label="Document number" placeholder="Passport or ID number" value={documentNumber} onChangeText={setDocumentNumber} />
          <AppInput label="Nationality" placeholder="e.g. Tanzanian" value={nationality} onChangeText={setNationality} />
          <AppInput label="Phone number" placeholder="Optional" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />
          <AppInput label="Notes" placeholder="Optional, e.g. dietary needs" value={notes} onChangeText={setNotes} multiline numberOfLines={3} style={{ minHeight: 80, textAlignVertical: "top" }} />

          <AppStack gap={2}>
            <AppText variant="label" weight="semiBold" tone="muted">
              Photo (optional)
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={{ width: 56, height: 56, borderRadius: radius.full }} />
              ) : (
                <View
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: radius.full,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: colors.brand[50],
                    borderWidth: 1,
                    borderColor: colors.brand[100]
                  }}
                >
                  <Camera color={colors.primary} size={20} />
                </View>
              )}
              <AppButton
                title={photoUrl ? "Change photo" : "Upload photo"}
                variant="secondary"
                loading={uploadingPhoto}
                onPress={() => void pickPhoto()}
                style={{ flex: 1 }}
              />
              {photoUrl ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setPhotoUrl("")}
                  style={{ width: 32, height: 32, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: "#fee2e2" }}
                >
                  <X color={colors.danger} size={14} />
                </Pressable>
              ) : null}
            </View>
          </AppStack>

          <AppStack gap={2}>
            <AppText variant="label" weight="semiBold" tone="muted">
              ID document (optional)
            </AppText>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing[3] }}>
              <AppButton
                title={documentUrl ? documentFileName || "Document uploaded" : "Upload passport / ID scan"}
                variant="secondary"
                loading={uploadingDocument}
                icon={<Paperclip color={colors.primary} size={16} />}
                onPress={() => void pickDocument()}
                style={{ flex: 1 }}
              />
              {documentUrl ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    setDocumentUrl("");
                    setDocumentFileName("");
                  }}
                  style={{ width: 32, height: 32, borderRadius: radius.full, alignItems: "center", justifyContent: "center", backgroundColor: "#fee2e2" }}
                >
                  <X color={colors.danger} size={14} />
                </Pressable>
              ) : null}
            </View>
          </AppStack>

          <AppStack gap={2}>
            <AppButton title={editingId ? "Save changes" : "Save traveller"} loading={saving} onPress={() => void handleSave()} />
            <AppButton title="Cancel" variant="ghost" onPress={() => { resetForm(); setShowForm(false); }} />
          </AppStack>
        </AppCard>
      ) : (
        <AppButton
          title={atCapacity ? "Traveller count reached" : "Add traveller"}
          variant="secondary"
          disabled={atCapacity}
          icon={<UserPlus color={atCapacity ? colors.softText : colors.primary} size={16} />}
          onPress={startAdd}
        />
      )}

      {atCapacity ? (
        <AppText variant="caption" tone="muted" style={{ textAlign: "center" }}>
          This trip is set up for {travelerCount} traveller(s). Update the traveller count on your booking to add more.
        </AppText>
      ) : null}
    </ScrollView>
  );
}

export function TravellerGroupsScreen({ navigation, route }: Props) {
  const tourBookingId = route.params?.tourBookingId;
  const tourBookingTitle = route.params?.tourBookingTitle;

  return (
    <SafeScreen contentStyle={{ paddingBottom: 0, flex: 1 }}>
      <AppStack gap={4} style={{ flex: 1 }}>
        <ScreenHeader
          title="Traveller groups"
          subtitle={tourBookingId ? "Manage who's travelling on this trip." : "Manage people connected to your trips."}
          onBack={() => navigation.goBack()}
        />
        {tourBookingId ? (
          <GroupRoster tourBookingId={tourBookingId} tourBookingTitle={tourBookingTitle} />
        ) : (
          <TripPicker navigation={navigation} />
        )}
      </AppStack>
    </SafeScreen>
  );
}
