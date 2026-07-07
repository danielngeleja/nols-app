import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { CalendarCheck, Calculator, CarFront, Home, UserCircle } from "lucide-react-native";
import { ReactNode } from "react";

import { RootStackParamList } from "../navigation/types";
import { AppBottomNav, AppBottomNavItem } from "./AppBottomNav";

type CustomerNavRoute = "Onboarding" | "CostCalculator" | "MyRides" | "MyBookings" | "Account";

type CustomerBottomNavProps = {
  active: CustomerNavRoute;
};

type NavItem = {
  route: CustomerNavRoute;
  label: string;
  icon: (color: string) => ReactNode;
};

const navItems: NavItem[] = [
  {
    route: "Onboarding",
    label: "Home",
    icon: (color) => <Home color={color} size={21} strokeWidth={2.4} />
  },
  {
    route: "CostCalculator",
    label: "Costs",
    icon: (color) => <Calculator color={color} size={21} strokeWidth={2.4} />
  },
  {
    route: "MyRides",
    label: "My Rides",
    icon: (color) => <CarFront color={color} size={21} strokeWidth={2.4} />
  },
  {
    route: "MyBookings",
    label: "My Stay",
    icon: (color) => <CalendarCheck color={color} size={21} strokeWidth={2.4} />
  },
  {
    route: "Account",
    label: "Account",
    icon: (color) => <UserCircle color={color} size={21} strokeWidth={2.4} />
  }
];

export function CustomerBottomNav({ active }: CustomerBottomNavProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  function openRoute(route: CustomerNavRoute) {
    if (route === active) return;

    switch (route) {
      case "Onboarding":
        navigation.navigate("Onboarding");
        break;
      case "CostCalculator":
        navigation.navigate("CostCalculator");
        break;
      case "MyRides":
        navigation.navigate("MyRides");
        break;
      case "MyBookings":
        navigation.navigate("MyBookings");
        break;
      case "Account":
        navigation.navigate("Account");
        break;
    }
  }

  const items: Array<AppBottomNavItem<CustomerNavRoute>> = navItems.map((item) => ({
    key: item.route,
    label: item.label,
    icon: item.icon,
    onPress: () => openRoute(item.route)
  }));

  return <AppBottomNav activeKey={active} items={items} />;
}
