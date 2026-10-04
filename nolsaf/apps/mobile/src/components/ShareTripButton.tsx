import { Share2 } from "lucide-react-native";
import { useState } from "react";
import { Alert, Share } from "react-native";

import { useAuth } from "../auth";
import { createTripShare, type TripServiceKind } from "../tripSafety";
import { colors } from "../theme";
import { AppButton } from "./AppButton";

export function ShareTripButton({ serviceKind, serviceId, title = "Share my trip" }: { serviceKind: TripServiceKind; serviceId: number; title?: string }) {
  const { token } = useAuth();
  const [loading, setLoading] = useState(false);

  const share = async () => {
    if (!token || loading) return;
    setLoading(true);
    try {
      const result = await createTripShare(token, { serviceKind, serviceId });
      await Share.share({
        title: "My NoLSAF trip",
        message: `I am sharing my active NoLSAF trip for safety. Open the secure live link: ${result.url}`,
        url: result.url,
      });
    } catch (cause) {
      Alert.alert("Share my trip", cause instanceof Error ? cause.message : "Could not create a secure trip link.");
    } finally {
      setLoading(false);
    }
  };

  return <AppButton title={loading ? "Creating secure link…" : title} variant="secondary" loading={loading} disabled={loading} icon={<Share2 color={colors.primary} size={16} />} onPress={share} />;
}
