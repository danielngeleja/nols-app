import { ArrowLeft, Bookmark } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { FlatList, Image, Modal, Pressable, StatusBar, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { buildPhotoTourSections } from "../properties/photoTour";
import type { RoomSpec } from "../properties/types";
import { ImmersivePhotoViewer } from "./ImmersivePhotoViewer";

const PHOTO_GAP = 6;

type AlbumRow =
  | { kind: "title"; key: string; title: string }
  | { kind: "photos"; key: string; imageIndexes: number[] };

function buildAlbumRows(sections: ReturnType<typeof buildPhotoTourSections>): AlbumRow[] {
  const rows: AlbumRow[] = [];
  sections.forEach((section, sectionIndex) => {
    rows.push({ kind: "title", key: `title-${sectionIndex}`, title: section.title });
    let position = 0;
    while (position < section.imageIndexes.length) {
      const pair = position % 4 === 1 && position + 1 < section.imageIndexes.length;
      const imageIndexes = section.imageIndexes.slice(position, position + (pair ? 2 : 1));
      rows.push({ kind: "photos", key: `photos-${sectionIndex}-${position}`, imageIndexes });
      position += imageIndexes.length;
    }
  });
  return rows;
}

export function PhotoTour({
  images,
  roomsSpec,
  initialIndex,
  title,
  saved,
  onToggleSave,
  onClose
}: {
  images: string[];
  roomsSpec: RoomSpec[];
  initialIndex: number;
  title: string;
  saved?: boolean;
  onToggleSave?: () => void;
  onClose: (index: number) => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sections = useMemo(() => buildPhotoTourSections(images, roomsSpec), [images, roomsSpec]);
  const rows = useMemo(() => buildAlbumRows(sections), [sections]);
  const orderedIndexes = useMemo(() => sections.flatMap((section) => section.imageIndexes), [sections]);
  const viewerImages = useMemo(() => orderedIndexes.map((index) => images[index]), [images, orderedIndexes]);
  const selectedSourceIndex = useRef(initialIndex);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const contentWidth = width - 32;
  const halfWidth = (contentWidth - PHOTO_GAP) / 2;

  function openPhoto(sourceIndex: number) {
    selectedSourceIndex.current = sourceIndex;
    const next = orderedIndexes.indexOf(sourceIndex);
    if (next >= 0) setViewerIndex(next);
  }

  function closeViewer(index: number) {
    selectedSourceIndex.current = orderedIndexes[index] ?? selectedSourceIndex.current;
    setViewerIndex(null);
  }

  function closeTour() {
    if (viewerIndex !== null) {
      closeViewer(viewerIndex);
    } else {
      onClose(selectedSourceIndex.current);
    }
  }

  function photoTile(sourceIndex: number, tileWidth: number, tileHeight: number) {
    return (
      <Pressable
        key={`${sourceIndex}-${images[sourceIndex]}`}
        accessibilityRole="button"
        accessibilityLabel={`Open photo ${sourceIndex + 1} of ${images.length} full screen`}
        onPress={() => openPhoto(sourceIndex)}
        style={[styles.photoTile, { width: tileWidth, height: tileHeight }]}
      >
        <Image source={{ uri: images[sourceIndex] }} resizeMode="cover" style={styles.photoImage} />
      </Pressable>
    );
  }

  function renderRow({ item }: { item: AlbumRow }) {
    if (item.kind === "title") {
      return <Text style={[styles.sectionTitle, item.key === "title-0" && styles.firstSectionTitle]}>{item.title}</Text>;
    }
    if (item.imageIndexes.length === 2) {
      return (
        <View style={[styles.pair, styles.photoRow]}>
          {item.imageIndexes.map((sourceIndex) => photoTile(sourceIndex, halfWidth, Math.round(halfWidth * 0.68)))}
        </View>
      );
    }
    return <View style={styles.photoRow}>{photoTile(item.imageIndexes[0], contentWidth, Math.round(contentWidth * 0.63))}</View>;
  }

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={closeTour}
    >
      <StatusBar hidden={viewerIndex !== null} barStyle="dark-content" backgroundColor="#ffffff" />
      <View style={styles.root}>
        <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close photo tour" onPress={closeTour} hitSlop={8} style={styles.headerButton}>
            <ArrowLeft size={24} color="#17191c" />
          </Pressable>
          <Text style={styles.headerTitle}>Photo tour</Text>
          {onToggleSave ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={saved ? "Remove from saved" : "Save stay"}
              onPress={onToggleSave}
              hitSlop={8}
              style={styles.headerButton}
            >
              <Bookmark size={23} color="#17191c" fill={saved ? "#17191c" : "transparent"} />
            </Pressable>
          ) : <View style={styles.headerButton} />}
        </View>
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          renderItem={renderRow}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 48 }]}
          initialNumToRender={7}
          maxToRenderPerBatch={6}
          windowSize={5}
        />
        {viewerIndex !== null ? (
          <ImmersivePhotoViewer
            images={viewerImages}
            initialIndex={viewerIndex}
            title={title}
            onIndexChange={setViewerIndex}
            onClose={closeViewer}
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#ffffff" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingBottom: 10, backgroundColor: "#ffffff" },
  headerButton: { width: 46, height: 46, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "600", color: "#17191c" },
  scrollContent: { paddingHorizontal: 16, paddingTop: 30 },
  sectionTitle: { marginBottom: 22, marginTop: 46, fontSize: 26, fontWeight: "700", color: "#17191c" },
  firstSectionTitle: { marginTop: 0 },
  photoRow: { marginBottom: PHOTO_GAP },
  pair: { flexDirection: "row", gap: PHOTO_GAP },
  photoTile: { overflow: "hidden", borderRadius: 18, backgroundColor: "#edf1f0" },
  photoImage: { width: "100%", height: "100%" }
});
