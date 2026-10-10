import { PropsWithChildren, useEffect, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Modal, ModalProps, Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

type SheetModalProps = PropsWithChildren<{
  visible: boolean;
  onRequestClose: () => void;
  animationType?: ModalProps["animationType"];
}>;

/**
 * The frame every bottom sheet sits in. The modal draws edge to edge (under the
 * status and navigation bars) so the backdrop covers the whole screen, and the
 * sheet lifts above the keyboard on both platforms: Expo SDK 56 runs Android
 * edge to edge, where the system no longer resizes the window for the keyboard.
 * Pair it with useSheetBottomInset so the sheet's last button clears the phone's
 * navigation bar.
 */
export function SheetModal({ visible, onRequestClose, animationType = "slide", children }: SheetModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType={animationType}
      onRequestClose={onRequestClose}
    >
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        {children}
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** True while the on-screen keyboard is up. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    // iOS reports the keyboard before it animates in; Android only once it is shown.
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => setOpen(true));
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/**
 * Bottom padding for a sheet: its own spacing plus the navigation bar or home
 * indicator. While the keyboard is up it covers that bar, so only the sheet's
 * own spacing is kept and the last button sits right on top of the keyboard.
 */
export function useSheetBottomInset(base: number) {
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardOpen();
  return keyboardOpen ? base : base + insets.bottom;
}

const styles = StyleSheet.create({
  fill: { flex: 1 }
});
