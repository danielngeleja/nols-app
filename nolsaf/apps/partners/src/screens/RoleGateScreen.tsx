import { ApiError, AppButton, AppInput, AppText, SafeScreen, StateView, colors, getErrorMessage, spacing } from "@nolsaf/native-ui";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { completeOwnerSignupProfile, getAgentMe, useAuth } from "../auth";
import { OperatorHomeScreen } from "./OperatorHomeScreen";
import { OwnerHomeScreen } from "./OwnerHomeScreen";

type OperatorCheck = "checking" | "active" | "suspended" | "error";

// The role gate, the gateway that controls which dashboard renders. It runs
// after login (status "authenticated") and branches on the single account role,
// the same boundary the API enforces with requireRole("OWNER") and
// requireRole("AGENT"). v1 is one role per account: an OWNER sees the Owner
// dashboard, an AGENT sees the Operator dashboard (unless suspended), and any
// other role is refused. This is a user experience layer over an authorization
// boundary the server already enforces, not the boundary itself.
export function RoleGateScreen() {
  const { user, token, signOut, refreshProfile } = useAuth();

  const role = useMemo(() => {
    const raw = (user?.role ?? "").toString().toUpperCase();
    return raw === "CUSTOMER" ? "USER" : raw;
  }, [user?.role]);

  const [operatorCheck, setOperatorCheck] = useState<OperatorCheck>("checking");

  useEffect(() => {
    if (role !== "AGENT" || !token) return;
    let alive = true;
    setOperatorCheck("checking");
    (async () => {
      try {
        await getAgentMe(token);
        if (alive) setOperatorCheck("active");
      } catch (err) {
        const apiError = err as ApiError;
        const payload = apiError?.payload as { error?: string } | undefined;
        if (apiError?.status === 403 && payload?.error === "AGENT_SUSPENDED") {
          if (alive) setOperatorCheck("suspended");
        } else if (alive) {
          setOperatorCheck("error");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [role, token]);

  if (role === "OWNER") {
    const registrationComplete = user?.registrationStatus === "COMPLETE" || Boolean(
      String(user?.fullName || user?.name || "").trim() && String(user?.email || "").trim() && String(user?.phone || "").trim()
    );
    if (!registrationComplete) {
      return <OwnerRegistrationCompletion onComplete={refreshProfile} onSignOut={signOut} />;
    }
    return <OwnerHomeScreen />;
  }

  if (role === "AGENT") {
    if (operatorCheck === "active") return <OperatorHomeScreen />;

    if (operatorCheck === "suspended") {
      return (
        <GateMessage
          title="Account temporarily suspended"
          message="Your operator account is under review, so assignments are paused. If you believe this is an error, contact security@nolsaf.com or hr@nolsaf.com."
          onSignOut={signOut}
        />
      );
    }

    if (operatorCheck === "error") {
      return (
        <SafeScreen scroll={false} contentStyle={styles.center}>
          <StateView
            title="We could not load your operator access"
            message="Check your connection and try again."
            actionLabel="Retry"
            onAction={() => setOperatorCheck("checking")}
          />
        </SafeScreen>
      );
    }

    return (
      <SafeScreen scroll={false} contentStyle={styles.center}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="bodySmall" tone="muted">
            Preparing your operator dashboard
          </AppText>
        </View>
      </SafeScreen>
    );
  }

  // Any non partner role (customer, driver, admin). NoLSAF admin stays on the
  // secured web portal and must never appear here.
  return (
    <GateMessage
      title="This app is for NoLSAF partners"
      message="NoLSAF Partners is for property owners and tour operators. Your account does not have a partner role on this device."
      onSignOut={signOut}
    />
  );
}

function OwnerRegistrationCompletion({ onComplete, onSignOut }: { onComplete: () => Promise<void>; onSignOut: () => Promise<void> }) {
  const { user, token } = useAuth();
  const [name, setName] = useState(user?.fullName || user?.name || "");
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsPassword = user?.hasPassword === false;
  const passwordValid = !needsPassword || (password.length >= 8 && password.length <= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password) && password === confirmPassword);
  const valid = Boolean(token && user?.phone && name.trim().length >= 2 && /^\S+@\S+\.\S{2,}$/.test(email.trim()) && passwordValid);

  const submit = async () => {
    if (!token || !user?.phone || !valid) return;
    setLoading(true);
    setError(null);
    try {
      const response = await completeOwnerSignupProfile(token, {
        name: name.trim(), email: email.trim().toLowerCase(), phone: user.phone,
        ...(needsPassword ? { password } : {})
      });
      if (!response.user || response.user.registrationStatus !== "COMPLETE") throw new Error(response.message || response.error || "Registration is still incomplete.");
      await onComplete();
    } catch (err) {
      setError(getErrorMessage(err, "Could not complete owner registration."));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeScreen contentStyle={styles.completion}>
      <AppText variant="title" weight="bold">Complete owner registration</AppText>
      <AppText variant="bodySmall" tone="muted">Add the required identity and contact details before opening the dashboard.</AppText>
      <AppInput label="Full name" required value={name} onChangeText={setName} />
      <AppInput label="Email" required value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <AppInput label="Verified phone" value={user?.phone || "Missing"} editable={false} />
      {needsPassword ? <><AppInput label="Password" required value={password} onChangeText={setPassword} secureTextEntry /><AppInput label="Confirm password" required value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry /></> : null}
      {error ? <AppText variant="caption" tone="danger">{error}</AppText> : null}
      <AppButton title="Complete and open dashboard" loading={loading} disabled={!valid} onPress={() => void submit()} />
      <AppButton title="Sign out" variant="ghost" onPress={() => void onSignOut()} />
    </SafeScreen>
  );
}

function GateMessage({ title, message, onSignOut }: { title: string; message: string; onSignOut: () => Promise<void> }) {
  return (
    <SafeScreen scroll={false} contentStyle={styles.center}>
      <View style={styles.messageWrap}>
        <StateView title={title} message={message} />
        <AppButton title="Sign out" variant="ghost" onPress={() => void onSignOut()} />
      </View>
    </SafeScreen>
  );
}

const styles = StyleSheet.create({
  center: { justifyContent: "center" },
  completion: { justifyContent: "center", gap: spacing[4] },
  loading: { alignItems: "center", gap: spacing[3] },
  messageWrap: { gap: spacing[4] }
});
