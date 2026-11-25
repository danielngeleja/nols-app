/**
 * SHARED ICON MAPPINGS FOR AMENITIES AND BATHROOM ITEMS
 * 
 * This is the SINGLE SOURCE OF TRUTH for icon mappings.
 * All views (owner, public, admin) MUST use these exact mappings
 * to ensure consistency with what owners submit.
 * 
 * PRINCIPLE: Public and admin views are PROHIBITED from using
 * different icons than those defined here (which match owner submissions).
 */

import type { ComponentType } from "react";
import {
  Sparkles,
  ScrollText,
  ShowerHead,
  Flame,
  Toilet as ToiletIcon,
  Wind,
  Trash2,
  Brush,
  ScanFace,
  FootprintsIcon,
  Shirt,
  RectangleHorizontal,
  Waves,
  Wifi,
  Table2,
  Armchair,
  CircleDot,
  Tv,
  MonitorPlay,
  Gamepad2,
  AirVent,
  Refrigerator,
  Coffee,
  Phone,
  LampDesk,
  Heater,
  LockKeyhole,
  Eclipse,
  Sofa,
  AlarmClock,
  Archive,
  BatteryCharging,
  BedDouble,
  Bus,
  Cctv,
  CookingPot,
  DoorOpen,
  Droplet,
  Fan,
  Fence,
  Gauge,
  Grid2X2,
  House,
  KeyRound,
  Microwave,
  ParkingSquare,
  Route,
  ShieldUser,
  Snowflake,
  Store,
  Sun,
  Trees,
  UtensilsCrossed,
  WashingMachine,
  Zap,
} from "lucide-react";

/**
 * Icon mapping for bathroom items.
 * These icons are what owners see and select when adding properties.
 * Public and admin views MUST use these exact same icons.
 */
export const BATHROOM_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "Free toiletries": Sparkles,
  "Toilet paper": ScrollText,
  "Shower": ShowerHead,
  "Water Heater": Flame,
  "Toilet": ToiletIcon,
  "Hairdryer": Wind,
  "Trash Bin": Trash2,
  "Toilet Brush": Brush,
  "Mirror": ScanFace,
  "Slippers": FootprintsIcon,
  "Bathrobe": Shirt,
  "Bath Mat": RectangleHorizontal,
  "Towel": Waves,
};

/**
 * Icon mapping for other room amenities.
 * These icons are what owners see and select when adding properties.
 * Public and admin views MUST use these exact same icons.
 */
export const OTHER_AMENITIES_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "Free Wi-Fi": Wifi,
  "Table": Table2,
  "Chair": Armchair,
  "Iron": CircleDot,
  "TV": Tv,
  "Flat Screen TV": MonitorPlay,
  "PS Station": Gamepad2,
  "Wardrobe": Shirt,
  "Air Conditioning": AirVent,
  "Mini Fridge": Refrigerator,
  "Coffee Maker": Coffee,
  "Phone": Phone,
  "Mirror": ScanFace,
  "Bedside Lamps": LampDesk,
  "Heating": Heater,
  "Desk": Table2,
  "Safe": LockKeyhole,
  "Clothes Rack": Shirt,
  "Blackout Curtains": Eclipse,
  "Couches": Sofa,
};

/** Icons for whole-home features listed in the unit editor. */
export const HOME_AMENITIES_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  "Private kitchen": CookingPot,
  "Kitchenette": CookingPot,
  "Shared kitchen": CookingPot,
  "Cooking allowed": CookingPot,
  "Stove": Flame,
  "Oven": Flame,
  "Refrigerator": Refrigerator,
  "Freezer": Snowflake,
  "Cookware": CookingPot,
  "Dishes and cutlery": UtensilsCrossed,
  "Dining area": UtensilsCrossed,
  "Dining table": Table2,
  "Microwave": Microwave,
  "Electric kettle": Coffee,
  "Kitchen cupboards": Archive,
  "Sink and worktop": Droplet,
  "Sitting room": Armchair,
  "Balcony": Fence,
  "Store room": Archive,
  "Laundry area": WashingMachine,
  "Servant quarter (DSQ)": House,
  "Private entrance": DoorOpen,
  "Garden or courtyard": Trees,
  "Barbecue area": Flame,
  "Beds and mattresses": BedDouble,
  "Sofa set": Sofa,
  "Wardrobes": Shirt,
  "Curtains": Eclipse,
  "Washing machine": WashingMachine,
  "Ceiling fans": Fan,
  "Mosquito nets": Grid2X2,
  "Running water": Droplet,
  "Water tank": Droplet,
  "Borehole": Droplet,
  "Own water meter": Gauge,
  "Own LUKU meter": Gauge,
  "Backup generator": BatteryCharging,
  "Solar power": Sun,
  "Fibre internet ready": Wifi,
  "Gated compound": KeyRound,
  "Security guard": ShieldUser,
  "CCTV": Cctv,
  "Burglar bars": Grid2X2,
  "Electric fence": Zap,
  "Alarm system": AlarmClock,
  "Parking": ParkingSquare,
  "All-weather road": Route,
  "Near public transport": Bus,
  "Near shops": Store,
  "Rubbish collection": Trash2,
};
