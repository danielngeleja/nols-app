import { LinkingOptions, NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { useAuth } from "../auth";
import { webOrigin } from "../lib/webOrigin";
import { AccountScreen } from "../screens/AccountScreen";
import { AccountPreferencesScreen } from "../screens/AccountPreferencesScreen";
import { AccountResourcesScreen } from "../screens/AccountResourcesScreen";
import { AccountSecurityScreen } from "../screens/AccountSecurityScreen";
import { BusinessAccessScreen } from "../screens/BusinessAccessScreen";
import { AddTransportScreen } from "../screens/AddTransportScreen";
import { BookingPaymentScreen } from "../screens/BookingPaymentScreen";
import { BookingReviewScreen } from "../screens/BookingReviewScreen";
import { CancelBookingScreen } from "../screens/CancelBookingScreen";
import { CancellationDetailScreen } from "../screens/CancellationDetailScreen";
import { MyCancellationsScreen } from "../screens/MyCancellationsScreen";
import { CostCalculatorScreen } from "../screens/CostCalculatorScreen";
import { CustomerHomeScreen } from "../screens/CustomerHomeScreen";
import { ForgotPasswordScreen } from "../screens/ForgotPasswordScreen";
import { LoginScreen } from "../screens/LoginScreen";
import { MyBookingsScreen } from "../screens/MyBookingsScreen";
import { MyRidesScreen } from "../screens/MyRidesScreen";
import { MyToursScreen } from "../screens/MyToursScreen";
import { NotificationsScreen } from "../screens/NotificationsScreen";
import { OnboardingScreen } from "../screens/OnboardingScreen";
import { PaymentsScreen } from "../screens/PaymentsScreen";
import { ProfileCompletionScreen } from "../screens/ProfileCompletionScreen";
import { PropertyDetailScreen } from "../screens/PropertyDetailScreen";
import { RegisterScreen } from "../screens/RegisterScreen";
import { RideDetailScreen } from "../screens/RideDetailScreen";
import { SavedPropertiesScreen } from "../screens/SavedPropertiesScreen";
import { SearchScreen } from "../screens/SearchScreen";
import { TourDetailScreen } from "../screens/TourDetailScreen";
import { TourOperatorScreen } from "../screens/TourOperatorScreen";
import { TourBookingPaymentScreen } from "../screens/TourBookingPaymentScreen";
import { TourBookingReviewScreen } from "../screens/TourBookingReviewScreen";
import { TourPackageDetailScreen } from "../screens/TourPackageDetailScreen";
import { TourPackagesScreen } from "../screens/TourPackagesScreen";
import { TravellerGroupsScreen } from "../screens/TravellerGroupsScreen";
import { GroupStayDepositPaymentScreen } from "../screens/GroupStayDepositPaymentScreen";
import { GroupStayDetailScreen } from "../screens/GroupStayDetailScreen";
import { GroupStayRequestScreen } from "../screens/GroupStayRequestScreen";
import { MyGroupStaysScreen } from "../screens/MyGroupStaysScreen";
import { VerifiedStaysScreen } from "../screens/VerifiedStaysScreen";
import { colors } from "../theme";
import { RootStackParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();

// Lets a shared invite link (https://<web-origin>/register?ref=CUSTOMER-123 or
// nolsaf://register?ref=CUSTOMER-123) open the app straight to the Register
// screen with the referral code attached.
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["nolsaf://", webOrigin()],
  config: {
    screens: {
      Register: "register"
    }
  }
};

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
  const { status } = useAuth();

  return (
    <NavigationContainer theme={navigationTheme} linking={linking}>
      <Stack.Navigator
        initialRouteName="Onboarding"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.surface }
        }}
      >
        {status === "authenticated" ? (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="CustomerHome" component={CustomerHomeScreen} />
            <Stack.Screen name="CostCalculator" component={CostCalculatorScreen} />
            <Stack.Screen name="MyRides" component={MyRidesScreen} />
            <Stack.Screen name="RideDetail" component={RideDetailScreen} />
            <Stack.Screen name="MyBookings" component={MyBookingsScreen} />
            <Stack.Screen name="CancelBooking" component={CancelBookingScreen} />
            <Stack.Screen name="MyCancellations" component={MyCancellationsScreen} />
            <Stack.Screen name="CancellationDetail" component={CancellationDetailScreen} />
            <Stack.Screen name="MyTours" component={MyToursScreen} />
            <Stack.Screen name="TourDetail" component={TourDetailScreen} />
            <Stack.Screen name="AddTransport" component={AddTransportScreen} />
            <Stack.Screen name="Account" component={AccountScreen} />
            <Stack.Screen name="AccountPreferences" component={AccountPreferencesScreen} />
            <Stack.Screen name="BusinessAccess" component={BusinessAccessScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
            <Stack.Screen name="SavedProperties" component={SavedPropertiesScreen} />
            <Stack.Screen name="AccountResources" component={AccountResourcesScreen} />
            <Stack.Screen name="TravellerGroups" component={TravellerGroupsScreen} />
            <Stack.Screen name="GroupStayRequest" component={GroupStayRequestScreen} />
            <Stack.Screen name="MyGroupStays" component={MyGroupStaysScreen} />
            <Stack.Screen name="GroupStayDetail" component={GroupStayDetailScreen} />
            <Stack.Screen name="GroupStayDeposit" component={GroupStayDepositPaymentScreen} />
            <Stack.Screen name="AccountSecurity" component={AccountSecurityScreen} />
            <Stack.Screen name="ProfileCompletion" component={ProfileCompletionScreen} />
            <Stack.Screen name="VerifiedStays" component={VerifiedStaysScreen} />
            <Stack.Screen name="TourPackages" component={TourPackagesScreen} />
            <Stack.Screen name="TourOperator" component={TourOperatorScreen} />
            <Stack.Screen name="TourPackageDetail" component={TourPackageDetailScreen} />
            <Stack.Screen name="TourBookingReview" component={TourBookingReviewScreen} />
            <Stack.Screen name="TourBookingPayment" component={TourBookingPaymentScreen} />
            <Stack.Screen name="PropertyDetail" component={PropertyDetailScreen} />
            <Stack.Screen name="BookingReview" component={BookingReviewScreen} />
            <Stack.Screen name="BookingPayment" component={BookingPaymentScreen} />
            <Stack.Screen name="Payments" component={PaymentsScreen} />
            <Stack.Screen name="Search" component={SearchScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
            <Stack.Screen name="VerifiedStays" component={VerifiedStaysScreen} />
            <Stack.Screen name="TourPackages" component={TourPackagesScreen} />
            <Stack.Screen name="TourOperator" component={TourOperatorScreen} />
            <Stack.Screen name="TourPackageDetail" component={TourPackageDetailScreen} />
            <Stack.Screen name="PropertyDetail" component={PropertyDetailScreen} />
            <Stack.Screen name="Payments" component={PaymentsScreen} />
            <Stack.Screen name="Search" component={SearchScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
