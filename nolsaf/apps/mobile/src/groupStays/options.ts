import {
  Bed,
  BedDouble,
  BedSingle,
  Briefcase,
  Building,
  Building2,
  Castle,
  CircleDot,
  Coffee,
  Compass,
  Crown,
  GraduationCap,
  Home,
  House,
  Hotel as HotelIcon,
  Landmark,
  Leaf,
  Mars,
  PartyPopper,
  Sparkle,
  Star,
  Tent,
  TreePine,
  UserRound,
  Users,
  UsersRound,
  Venus,
  type LucideIcon
} from "lucide-react-native";

import { AccommodationType, GroupType, HotelStarLabel } from "./types";

export type Option<T extends string = string> = { value: T; label: string; description?: string; icon?: LucideIcon };

export const GROUP_TYPE_OPTIONS: Option<GroupType>[] = [
  { value: "family", label: "Family", icon: Users },
  { value: "workers", label: "Workers", icon: Briefcase },
  { value: "event", label: "Event", icon: PartyPopper },
  { value: "students", label: "Students", icon: GraduationCap },
  { value: "team", label: "Team", icon: UsersRound },
  { value: "safari_stay", label: "Safari stay", icon: Compass },
  { value: "other", label: "Other", icon: Bed }
];

export const ACCOMMODATION_TYPE_OPTIONS: Option<AccommodationType>[] = [
  { value: "villa", label: "Villa", icon: Castle },
  { value: "apartment", label: "Apartment", icon: Building },
  { value: "hotel", label: "Hotel", icon: HotelIcon },
  { value: "hostel", label: "Hostel", icon: BedDouble },
  { value: "lodge", label: "Lodge", icon: TreePine },
  { value: "condo", label: "Condo", icon: Building2 },
  { value: "guest_house", label: "Guest house", icon: Home },
  { value: "bungalow", label: "Bungalow", icon: House },
  { value: "cabin", label: "Cabin", icon: Tent },
  { value: "homestay", label: "Homestay", icon: Leaf },
  { value: "townhouse", label: "Townhouse", icon: Landmark },
  { value: "house", label: "House", icon: House },
  { value: "dorm", label: "Dorm", icon: BedSingle },
  { value: "other", label: "Other", icon: Bed }
];

export const HOTEL_STAR_OPTIONS: Option<HotelStarLabel>[] = [
  { value: "basic", label: "Basic accommodations", icon: CircleDot },
  { value: "simple", label: "Simple and affordable", icon: Coffee },
  { value: "moderate", label: "Moderate quality", icon: Star },
  { value: "high", label: "High end comfort", icon: Sparkle },
  { value: "luxury", label: "Luxury and exceptional service", icon: Crown }
];

export const COUNTRY_OPTIONS: Option[] = [
  { value: "tanzania", label: "Tanzania" },
  { value: "eu", label: "EU (European Union)" },
  { value: "kenya", label: "Kenya" },
  { value: "uganda", label: "Uganda" },
  { value: "rwanda", label: "Rwanda" },
  { value: "burundi", label: "Burundi" },
  { value: "south-africa", label: "South Africa" },
  { value: "united-states", label: "United States" },
  { value: "united-kingdom", label: "United Kingdom" },
  { value: "canada", label: "Canada" },
  { value: "australia", label: "Australia" },
  { value: "india", label: "India" },
  { value: "china", label: "China" },
  { value: "japan", label: "Japan" },
  { value: "south-korea", label: "South Korea" },
  { value: "brazil", label: "Brazil" },
  { value: "mexico", label: "Mexico" },
  { value: "argentina", label: "Argentina" },
  { value: "egypt", label: "Egypt" },
  { value: "nigeria", label: "Nigeria" },
  { value: "ghana", label: "Ghana" },
  { value: "other", label: "Other" }
];

export const ROOM_SIZE_OPTIONS: Option[] = [
  { value: "1", label: "1 person per room" },
  { value: "2", label: "2 people per room" },
  { value: "3", label: "3 people per room" },
  { value: "4", label: "4 people per room" }
];

export const GENDER_OPTIONS: Option[] = [
  { value: "Male", label: "Male", icon: Mars },
  { value: "Female", label: "Female", icon: Venus },
  { value: "Other", label: "Other", icon: UserRound }
];

export type ArrangementKey = "pickup" | "transport" | "meals" | "guide" | "equipment";

export const ARRANGEMENT_OPTIONS: { key: ArrangementKey; label: string; description: string }[] = [
  { key: "pickup", label: "Airport pick up", description: "We arrange your airport transfer" },
  { key: "transport", label: "Transport between sites", description: "Shuttles between locations" },
  { key: "meals", label: "Meals included", description: "Breakfast, lunch or dinner package" },
  { key: "guide", label: "On site guide or staff", description: "A dedicated local guide or host" },
  { key: "equipment", label: "Special equipment", description: "Gear, tools or event equipment" }
];

export function recommendRoomSize(groupType: string, accommodationType: string, headcount: number): number {
  const c = Math.max(0, Number(headcount) || 0);

  if (accommodationType === "dorm" || accommodationType === "hostel") {
    if (c >= 40) return 6;
    if (c >= 20) return 4;
    return 3;
  }

  switch (groupType) {
    case "students":
      if (c >= 40) return 4;
      if (c >= 12) return 3;
      return 2;
    case "workers":
      if (c >= 20) return 4;
      if (c >= 8) return 3;
      return 2;
    case "family":
      return 2;
    case "event":
      if (c >= 50) return 4;
      if (c >= 20) return 3;
      return 2;
    default:
      return 2;
  }
}
