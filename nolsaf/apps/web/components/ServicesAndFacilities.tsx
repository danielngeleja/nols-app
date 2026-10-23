"use client";

import {
  Car,
  Coffee,
  UtensilsCrossed,
  Beer,
  Waves,
  Thermometer,
  WashingMachine,
  ConciergeBell,
  Shield,
  Bandage,
  FireExtinguisher,
  ShoppingBag,
  Store,
  PartyPopper,
  Gamepad2,
  Dumbbell,
  Wifi,
  Sparkles,
} from "lucide-react";

// Helper function to get semantic colors for service icons
function getServiceIconColor(serviceType: string): { bg: string; icon: string } {
  const colors: Record<string, { bg: string; icon: string }> = {
    parking: { bg: "bg-slate-50", icon: "text-slate-700" },
    restaurant: { bg: "bg-orange-50", icon: "text-orange-600" },
    bar: { bg: "bg-amber-50", icon: "text-amber-600" },
    pool: { bg: "bg-cyan-50", icon: "text-cyan-600" },
    roomService: { bg: "bg-amber-50", icon: "text-amber-600" },
    privateChef: { bg: "bg-orange-50", icon: "text-orange-600" },
    wifi: { bg: "bg-blue-50", icon: "text-blue-600" },
    laundry: { bg: "bg-blue-50", icon: "text-blue-600" },
    security: { bg: "bg-indigo-50", icon: "text-indigo-600" },
    sauna: { bg: "bg-orange-50", icon: "text-orange-600" },
    firstAid: { bg: "bg-red-50", icon: "text-red-600" },
    fireExtinguisher: { bg: "bg-red-50", icon: "text-red-600" },
    onSiteShop: { bg: "bg-purple-50", icon: "text-purple-600" },
    nearbyMall: { bg: "bg-purple-50", icon: "text-purple-600" },
    socialHall: { bg: "bg-pink-50", icon: "text-pink-600" },
    sportsGames: { bg: "bg-indigo-50", icon: "text-indigo-600" },
    gym: { bg: "bg-orange-50", icon: "text-orange-600" },
    breakfast: { bg: "bg-amber-50", icon: "text-amber-600" },
  };
  
  // Match service type to color
  const lowerType = serviceType.toLowerCase();
  if (lowerType.includes('parking')) return colors.parking;
  if (lowerType.includes('restaurant')) return colors.restaurant;
  if (lowerType.includes('bar')) return colors.bar;
  if (lowerType.includes('pool')) return colors.pool;
  if (lowerType.includes('room service')) return colors.roomService;
  if (lowerType.includes('private chef')) return colors.privateChef;
  if (lowerType.includes('wifi')) return colors.wifi;
  if (lowerType.includes('laundry')) return colors.laundry;
  if (lowerType.includes('security')) return colors.security;
  if (lowerType.includes('sauna')) return colors.sauna;
  if (lowerType.includes('first aid')) return colors.firstAid;
  if (lowerType.includes('fire')) return colors.fireExtinguisher;
  if (lowerType.includes('shop')) return colors.onSiteShop;
  if (lowerType.includes('mall')) return colors.nearbyMall;
  if (lowerType.includes('social')) return colors.socialHall;
  if (lowerType.includes('sports') || lowerType.includes('games')) return colors.sportsGames;
  if (lowerType.includes('gym') || lowerType.includes('fitness')) return colors.gym;
  if (lowerType.includes('breakfast')) return colors.breakfast;
  
  return { bg: "bg-slate-50", icon: "text-slate-700" };
}

type NormalizedServicesObj = {
  parking?: string;
  parkingPrice?: string;
  breakfastIncluded?: boolean;
  breakfastAvailable?: boolean;
  restaurant?: boolean;
  bar?: boolean;
  pool?: boolean;
  sauna?: boolean;
  laundry?: boolean;
  roomService?: boolean;
  privateChef?: boolean;
  security24?: boolean;
  firstAid?: boolean;
  fireExtinguisher?: boolean;
  onSiteShop?: boolean;
  nearbyMall?: boolean;
  socialHall?: boolean;
  sportsGames?: boolean;
  gym?: boolean;
  wifi?: boolean;
  nearbyFacilities?: any[];
  tags?: any[];
};

type ServicesAndFacilitiesProps = {
  normalizedServicesObj: NormalizedServicesObj;
  effectiveServicesArray: string[];
  servicesArray: string[];
};

export default function ServicesAndFacilities({
  normalizedServicesObj,
  effectiveServicesArray,
  servicesArray,
}: ServicesAndFacilitiesProps) {
  // Check if there are any services to display using normalized values
  const hasServices = 
    (normalizedServicesObj.parking && normalizedServicesObj.parking !== 'no') ||
    normalizedServicesObj.breakfastIncluded ||
    normalizedServicesObj.breakfastAvailable ||
    normalizedServicesObj.restaurant ||
    normalizedServicesObj.bar ||
    normalizedServicesObj.pool ||
    normalizedServicesObj.sauna ||
    normalizedServicesObj.laundry ||
    normalizedServicesObj.roomService ||
    normalizedServicesObj.privateChef ||
    normalizedServicesObj.security24 ||
    normalizedServicesObj.firstAid ||
    normalizedServicesObj.fireExtinguisher ||
    normalizedServicesObj.onSiteShop ||
    normalizedServicesObj.nearbyMall ||
    normalizedServicesObj.socialHall ||
    normalizedServicesObj.sportsGames ||
    normalizedServicesObj.gym ||
    normalizedServicesObj.wifi ||
    (Array.isArray(normalizedServicesObj.nearbyFacilities) && normalizedServicesObj.nearbyFacilities.length > 0) ||
    servicesArray.length > 0 ||
    (Array.isArray(normalizedServicesObj.tags) && normalizedServicesObj.tags.length > 0);

  if (!hasServices) return null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2 mb-6">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
          <Sparkles className="w-5 h-5" aria-hidden />
        </span>
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Services & Facilities</h2>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {/* Parking */}
        {((normalizedServicesObj.parking && normalizedServicesObj.parking !== 'no') || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('parking'))) && (() => {
          const colors = getServiceIconColor('parking');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Car className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">
                {normalizedServicesObj.parking === 'free' ? 'Free Parking' : normalizedServicesObj.parking === 'paid' ? `Paid Parking${normalizedServicesObj.parkingPrice ? ` (${normalizedServicesObj.parkingPrice})` : ''}` : effectiveServicesArray.some((s: string) => s.toLowerCase().includes('free parking')) ? 'Free Parking' : effectiveServicesArray.some((s: string) => s.toLowerCase().includes('paid parking')) ? 'Paid Parking' : 'Parking'}
              </span>
            </div>
          );
        })()}

        {/* Restaurant */}
        {(normalizedServicesObj.restaurant || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('restaurant'))) && (() => {
          const colors = getServiceIconColor('restaurant');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <UtensilsCrossed className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Restaurant</span>
            </div>
          );
        })()}

        {/* Bar */}
        {(normalizedServicesObj.bar || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('bar'))) && (() => {
          const colors = getServiceIconColor('bar');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Beer className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Bar</span>
            </div>
          );
        })()}

        {/* Pool */}
        {(normalizedServicesObj.pool || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('pool'))) && (() => {
          const colors = getServiceIconColor('pool');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Waves className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Swimming Pool</span>
            </div>
          );
        })()}

        {/* Room Service */}
        {(normalizedServicesObj.roomService || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('room service'))) && (() => {
          const colors = getServiceIconColor('room service');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <ConciergeBell className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Room Service</span>
            </div>
          );
        })()}

        {/* Private chef */}
        {(normalizedServicesObj.privateChef || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('private chef'))) && (() => {
          const colors = getServiceIconColor('private chef');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}><UtensilsCrossed className={`h-4 w-4 ${colors.icon}`} /></div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Private Chef</span>
            </div>
          );
        })()}

        {/* WiFi */}
        {(normalizedServicesObj.wifi || effectiveServicesArray.some((s: string) => s.toLowerCase().includes("wifi")) || servicesArray.some((s: string) => s.toLowerCase().includes("wifi"))) && (() => {
          const colors = getServiceIconColor('wifi');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Wifi className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Free WiFi</span>
            </div>
          );
        })()}

        {/* Laundry */}
        {(normalizedServicesObj.laundry || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('laundry'))) && (() => {
          const colors = getServiceIconColor('laundry');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <WashingMachine className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Laundry</span>
            </div>
          );
        })()}

        {/* Security */}
        {(normalizedServicesObj.security24 || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('24h security') || s.toLowerCase().includes('24-hour security'))) && (() => {
          const colors = getServiceIconColor('security');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Shield className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">24/7 Security</span>
            </div>
          );
        })()}

        {/* Sauna */}
        {(normalizedServicesObj.sauna || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('sauna'))) && (() => {
          const colors = getServiceIconColor('sauna');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Thermometer className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Sauna</span>
            </div>
          );
        })()}

        {/* First Aid */}
        {(normalizedServicesObj.firstAid || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('first aid'))) && (() => {
          const colors = getServiceIconColor('first aid');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Bandage className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">First Aid</span>
            </div>
          );
        })()}

        {/* Fire Extinguisher */}
        {(normalizedServicesObj.fireExtinguisher || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('fire extinguisher'))) && (() => {
          const colors = getServiceIconColor('fire extinguisher');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <FireExtinguisher className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Fire Extinguisher</span>
            </div>
          );
        })()}

        {/* On-site Shop */}
        {(normalizedServicesObj.onSiteShop || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('on-site shop'))) && (() => {
          const colors = getServiceIconColor('shop');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <ShoppingBag className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">On-site Shop</span>
            </div>
          );
        })()}

        {/* Nearby Mall */}
        {(normalizedServicesObj.nearbyMall || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('nearby mall'))) && (() => {
          const colors = getServiceIconColor('mall');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Store className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Nearby Mall</span>
            </div>
          );
        })()}

        {/* Social Hall */}
        {(normalizedServicesObj.socialHall || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('social hall'))) && (() => {
          const colors = getServiceIconColor('social');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <PartyPopper className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Social Hall</span>
            </div>
          );
        })()}

        {/* Sports & Games */}
        {(normalizedServicesObj.sportsGames || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('sports') || s.toLowerCase().includes('games'))) && (() => {
          const colors = getServiceIconColor('sports');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Gamepad2 className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Sports & Games</span>
            </div>
          );
        })()}

        {/* Gym */}
        {(normalizedServicesObj.gym || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('gym'))) && (() => {
          const colors = getServiceIconColor('gym');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Dumbbell className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Gym / Fitness Center</span>
            </div>
          );
        })()}

        {/* Breakfast Included */}
        {(normalizedServicesObj.breakfastIncluded || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('breakfast included'))) && (() => {
          const colors = getServiceIconColor('breakfast');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Coffee className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Breakfast Included</span>
            </div>
          );
        })()}

        {/* Breakfast Available */}
        {(normalizedServicesObj.breakfastAvailable || effectiveServicesArray.some((s: string) => s.toLowerCase().includes('breakfast available'))) && (() => {
          const colors = getServiceIconColor('breakfast');
          return (
            <div className="group relative inline-flex items-center gap-2.5 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-3 py-2.5 hover:border-[#02665e]/40 hover:bg-gradient-to-br hover:from-emerald-50/30 hover:to-white motion-safe:transition-all motion-safe:duration-200">
              <div className={`flex items-center justify-center w-8 h-8 rounded-lg ${colors.bg} flex-shrink-0 motion-safe:transition-colors`}>
                <Coffee className={`h-4 w-4 ${colors.icon}`} />
              </div>
              <span className="text-sm font-medium text-slate-800 leading-tight">Breakfast Available</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
