import { DefaultTheme, NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { colors } from "@nolsaf/native-ui";

import { useAuth } from "../auth/AuthProvider";
import { getDriverGateState } from "../auth/driverGate";
import {
  ActionRequiredScreen,
  IncompleteOnboardingScreen,
  PendingReviewScreen,
  RejectedScreen,
  SuspendedScreen
} from "../screens/gate";
import { AccountScreen } from "../screens/AccountScreen";
import { BonusScreen } from "../screens/BonusScreen";
import { ChangePasswordScreen } from "../screens/ChangePasswordScreen";
import { ClaimPolicyScreen } from "../screens/ClaimPolicyScreen";
import { ContractScreen } from "../screens/ContractScreen";
import { DashboardScreen } from "../screens/DashboardScreen";
import { EarningsScreen } from "../screens/EarningsScreen";
import { HistoryScreen } from "../screens/HistoryScreen";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { InsuranceScreen } from "../screens/InsuranceScreen";
import { InvoiceDetailScreen } from "../screens/InvoiceDetailScreen";
import { InvoicesScreen } from "../screens/InvoicesScreen";
import { LevelScreen } from "../screens/LevelScreen";
import { LicenseScreen } from "../screens/LicenseScreen";
import { LoginHistoryScreen } from "../screens/LoginHistoryScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { ManagementScreen } from "../screens/ManagementScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { PasskeysScreen } from "../screens/PasskeysScreen";
import { PayoutsScreen } from "../screens/PayoutsScreen";
import { PoliciesScreen } from "../screens/PoliciesScreen";
import { ProfileScreen } from "../screens/ProfileScreen";
import { RatingScreen } from "../screens/RatingScreen";
import { ReferralScreen } from "../screens/ReferralScreen";
import { RemindersScreen } from "../screens/RemindersScreen";
import { SafetyScreen } from "../screens/SafetyScreen";
import { ScheduledTripsScreen } from "../screens/ScheduledTripsScreen";
import { SecurityScreen } from "../screens/SecurityScreen";
import { SupportScreen } from "../screens/SupportScreen";
import { TripOfferProvider } from "../components/TripOfferProvider";
import { TripDetailScreen } from "../screens/TripDetailScreen";
import { TripsScreen } from "../screens/TripsScreen";
import { TwoFactorScreen } from "../screens/TwoFactorScreen";
import { WebPageScreen } from "../screens/WebPageScreen";
import { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

const navigationTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: colors.surface,
    primary: colors.primary,
    card: colors.surface,
    text: colors.ink,
    border: colors.border
  }
};

export function AppNavigator() {
  const { status, user } = useAuth();
  const navigationRef = useNavigationContainerRef<RootStackParamList>();

  const gateState = status === "authenticated" && user ? getDriverGateState(user) : "ok";
  const ready = status === "authenticated" && gateState === "ok";

  return (
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      {ready ? <TripOfferProvider navigationRef={navigationRef} /> : null}
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surface }
        }}
      >
        {status === "authenticated" && gateState === "ok" ? (
          <>
            <Stack.Screen name="Home" component={DashboardScreen} />
            <Stack.Screen name="Trips" component={TripsScreen} />
            <Stack.Screen name="Earnings" component={EarningsScreen} />
            <Stack.Screen name="Account" component={AccountScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="TripDetail" component={TripDetailScreen} />
            <Stack.Screen name="ScheduledTrips" component={ScheduledTripsScreen} />
            <Stack.Screen name="History" component={HistoryScreen} />
            <Stack.Screen name="Reminders" component={RemindersScreen} />
            <Stack.Screen name="Rating" component={RatingScreen} />
            <Stack.Screen name="Payouts" component={PayoutsScreen} />
            <Stack.Screen name="Bonus" component={BonusScreen} />
            <Stack.Screen name="Level" component={LevelScreen} />
            <Stack.Screen name="Referral" component={ReferralScreen} />
            <Stack.Screen name="Invoices" component={InvoicesScreen} />
            <Stack.Screen name="InvoiceDetail" component={InvoiceDetailScreen} />
            <Stack.Screen name="Profile" component={ProfileScreen} />
            <Stack.Screen name="Management" component={ManagementScreen} />
            <Stack.Screen name="License" component={LicenseScreen} />
            <Stack.Screen name="Insurance" component={InsuranceScreen} />
            <Stack.Screen name="Contract" component={ContractScreen} />
            <Stack.Screen name="Security" component={SecurityScreen} />
            <Stack.Screen name="ChangePassword" component={ChangePasswordScreen} />
            <Stack.Screen name="Passkeys" component={PasskeysScreen} />
            <Stack.Screen name="TwoFactor" component={TwoFactorScreen} />
            <Stack.Screen name="LoginHistory" component={LoginHistoryScreen} />
            <Stack.Screen name="Policies" component={PoliciesScreen} />
            <Stack.Screen name="Support" component={SupportScreen} />
            <Stack.Screen name="ClaimPolicy" component={ClaimPolicyScreen} />
            <Stack.Screen name="Safety" component={SafetyScreen} />
            <Stack.Screen name="WebPage" component={WebPageScreen} />
          </>
        ) : status === "authenticated" ? (
          <>
            {gateState === "pending_kyc" ? <Stack.Screen name="Home" component={PendingReviewScreen} /> : null}
            {gateState === "action_required" ? <Stack.Screen name="Home" component={ActionRequiredScreen} /> : null}
            {gateState === "rejected" ? <Stack.Screen name="Home" component={RejectedScreen} /> : null}
            {gateState === "suspended" ? <Stack.Screen name="Home" component={SuspendedScreen} /> : null}
            {gateState === "incomplete_onboarding" ? (
              <Stack.Screen name="Home" component={IncompleteOnboardingScreen} />
            ) : null}
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
