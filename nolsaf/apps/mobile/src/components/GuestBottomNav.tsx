import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Home, LogIn, Search } from "lucide-react-native";
import { ReactNode } from "react";

import { RootStackParamList } from "../navigation/types";
import { AppBottomNav, AppBottomNavItem } from "./AppBottomNav";

type GuestNavRoute = "Onboarding" | "Search" | "Login";

type GuestBottomNavProps = {
  active: GuestNavRoute;
};

type GuestNavItem = {
  route: GuestNavRoute;
  label: string;
  icon: (color: string) => ReactNode;
};

const guestNavItems: GuestNavItem[] = [
  {
    route: "Onboarding",
    label: "Home",
    icon: (color) => <Home color={color} size={22} strokeWidth={2.4} />
  },
  {
    route: "Search",
    label: "Explore",
    icon: (color) => <Search color={color} size={23} strokeWidth={2.35} />
  },
  {
    route: "Login",
    label: "Login",
    icon: (color) => <LogIn color={color} size={22} strokeWidth={2.4} />
  }
];

export function GuestBottomNav({ active }: GuestBottomNavProps) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  function openRoute(route: GuestNavRoute) {
    if (route === active) return;

    if (route === "Search") {
      navigation.navigate("Search");
      return;
    }

    navigation.navigate(route);
  }

  const items: Array<AppBottomNavItem<GuestNavRoute>> = guestNavItems.map((item) => ({
    key: item.route,
    label: item.label,
    icon: item.icon,
    onPress: () => openRoute(item.route)
  }));

  return <AppBottomNav activeKey={active} items={items} />;
}
