"use client";

import { useState, useMemo } from "react";
import { MapPin, ChevronUp, ChevronDown, BedDouble } from "lucide-react";
import { useRouter } from "next/navigation";

interface Room {
  code: string;
  floor: number;
  floorName: string;
  roomType: string;
  pricePerNight: number | null;
  amenities?: string[];
}

interface PropertyVisualizationProps {
  property: {
    id: number;
    slug: string;
    title: string;
    buildingType?: string | null;
    roomsSpec?: any;
    currency?: string | null;
  };
  onRoomSelect?: (roomCode: string, floor: number) => void;
}

function getOrdinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

function formatPrice(price: number | null, currency: string = "TZS"): string {
  if (!price) return "—";
  return new Intl.NumberFormat('en-TZ', {
    style: 'currency',
    currency: currency,
    maximumFractionDigits: 0,
  }).format(price);
}

function extractRoomsWithFloors(roomsSpec: any): Room[] {
  if (!roomsSpec) return [];
  
  let roomTypes: any[] = [];
  if (Array.isArray(roomsSpec)) {
    roomTypes = roomsSpec;
  } else if (roomsSpec.rooms && Array.isArray(roomsSpec.rooms)) {
    roomTypes = roomsSpec.rooms;
  }
  
  // Determine floors from building type or room codes
  const rooms: Room[] = roomTypes.map((rt: any, index: number) => {
    // Try to extract floor from code (e.g., "1-201" = floor 1, "G-101" = floor 0)
    let floor = 0;
    let floorName = "Ground";
    const code = rt.code || rt.roomCode || `G-${String(index + 1).padStart(3, '0')}`;
    
    // Parse floor from code
    if (code.includes('-')) {
      const floorPart = code.split('-')[0];
      if (floorPart === 'G' || floorPart === 'g') {
        floor = 0;
        floorName = "Ground";
      } else {
        const floorNum = parseInt(floorPart);
        if (!isNaN(floorNum)) {
          floor = floorNum;
          floorName = `${floorNum}${getOrdinal(floorNum)}`;
        }
      }
    }
    
    return {
      code,
      floor,
      floorName,
      roomType: rt.roomType || rt.name || rt.label || "Room",
      pricePerNight: rt.pricePerNight || rt.price || null,
      amenities: rt.amenities || rt.otherAmenities || [],
    };
  });
  
  return rooms;
}

export default function PropertyVisualization({ property, onRoomSelect }: PropertyVisualizationProps) {
  const router = useRouter();
  const [currentFloor, setCurrentFloor] = useState(0);
  
  const rooms = useMemo(() => extractRoomsWithFloors(property.roomsSpec), [property.roomsSpec]);
  
  // Group rooms by floor
  const roomsByFloor = useMemo(() => {
    return rooms.reduce((acc, room) => {
      if (!acc[room.floor]) acc[room.floor] = [];
      acc[room.floor].push(room);
      return acc;
    }, {} as Record<number, Room[]>);
  }, [rooms]);
  
  const floors = useMemo(() => {
    return Object.keys(roomsByFloor).map(Number).sort((a, b) => a - b);
  }, [roomsByFloor]);
  
  const currentRooms = roomsByFloor[currentFloor] || [];
  const currency = property.currency || "TZS";
  
  // Auto-set to first available floor
  if (floors.length > 0 && currentFloor === 0 && !roomsByFloor[currentFloor]) {
    setCurrentFloor(floors[0]);
  }
  
  const handleRoomClick = (room: Room) => {
    if (onRoomSelect) {
      onRoomSelect(room.code, room.floor);
    } else {
      // Default: navigate to booking
      router.push(`/public/booking/confirm?property=${encodeURIComponent(property.slug)}&roomCode=${room.code}&floor=${room.floor}`);
    }
  };
  
  if (rooms.length === 0) {
    return (
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8 text-center">
        <BedDouble className="w-12 h-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-600">Room information not available</p>
      </div>
    );
  }
  
  return (
    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#02665e] to-[#014e47] p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold mb-1">{property.title}</h3>
            <p className="text-sm text-white/80">Interactive Floor Plan</p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white/20 backdrop-blur-sm rounded-xl">
            <MapPin className="w-5 h-5" />
            <span className="font-semibold">
              {floors.length} {floors.length === 1 ? 'Floor' : 'Floors'}
            </span>
          </div>
        </div>
      </div>
      
      {/* Floor Selector */}
      {floors.length > 1 && (
        <div className="px-6 pt-6 pb-4 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {floors.map((floor) => (
              <button
                key={floor}
                onClick={() => setCurrentFloor(floor)}
                className={`px-4 py-2.5 rounded-xl font-semibold text-sm transition-all whitespace-nowrap flex-shrink-0 ${
                  currentFloor === floor
                    ? 'bg-[#02665e] text-white shadow-lg transform scale-105'
                    : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {floor === 0 ? 'Ground' : `${floor}${getOrdinal(floor)}`} Floor
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Floor Plan */}
      <div className="p-6">
        {/* Floor Title */}
        <div className="text-center mb-6">
          <h4 className="text-xl font-bold text-slate-900 mb-1">
            {currentFloor === 0 ? 'Ground' : `${currentFloor}${getOrdinal(currentFloor)}`} Floor
          </h4>
          <p className="text-sm text-slate-600">
            {currentRooms.length} {currentRooms.length === 1 ? 'room' : 'rooms'} available
          </p>
        </div>
        
        {/* Room Grid */}
        {currentRooms.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {currentRooms.map((room) => (
              <button
                key={room.code}
                onClick={() => handleRoomClick(room)}
                className="group relative bg-gradient-to-br from-white to-slate-50 rounded-xl border-2 border-slate-200 p-5 hover:border-[#02665e] hover:shadow-xl transition-all duration-300 text-left transform hover:scale-105"
              >
                {/* Room Code Badge */}
                <div className="absolute -top-2 -right-2 bg-gradient-to-r from-[#02665e] to-[#014e47] text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-lg z-10">
                  {room.code}
                </div>
                
                {/* Room Icon */}
                <div className="mb-3">
                  <div className="w-12 h-12 bg-[#02665e]/10 rounded-xl flex items-center justify-center group-hover:bg-[#02665e]/20 transition-colors">
                    <BedDouble className="w-6 h-6 text-[#02665e]" />
                  </div>
                </div>
                
                {/* Room Type */}
                <div className="text-base font-bold text-slate-900 mb-2">
                  {room.roomType}
                </div>
                
                {/* Price */}
                <div className="text-2xl font-extrabold text-[#02665e] mb-1">
                  {formatPrice(room.pricePerNight, currency)}
                </div>
                <div className="text-xs text-slate-500 mb-3">per night</div>
                
                {/* Quick Amenities */}
                {room.amenities && room.amenities.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap mt-3 pt-3 border-t border-slate-200">
                    {room.amenities.slice(0, 3).map((amenity, idx) => (
                      <span
                        key={idx}
                        className="text-xs px-2 py-1 bg-slate-100 text-slate-600 rounded-md"
                      >
                        {amenity}
                      </span>
                    ))}
                    {room.amenities.length > 3 && (
                      <span className="text-xs text-slate-500">+{room.amenities.length - 3} more</span>
                    )}
                  </div>
                )}
                
                {/* Hover Overlay */}
                <div className="absolute inset-0 bg-[#02665e]/5 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                
                {/* Click Indicator */}
                <div className="absolute bottom-3 right-3 text-xs text-slate-400 group-hover:text-[#02665e] transition-colors font-medium">
                  Click to book →
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <BedDouble className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-600 font-medium">No rooms available on this floor</p>
          </div>
        )}
        
        {/* Navigation */}
        {floors.length > 1 && (
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-slate-200">
            <button
              onClick={() => {
                const prevIndex = floors.indexOf(currentFloor);
                if (prevIndex > 0) setCurrentFloor(floors[prevIndex - 1]);
              }}
              disabled={floors.indexOf(currentFloor) === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
            >
              <ChevronDown className="w-4 h-4" />
              Previous Floor
            </button>
            
            <div className="text-sm text-slate-600 font-medium px-4 py-2 bg-slate-100 rounded-lg">
              Floor {floors.indexOf(currentFloor) + 1} of {floors.length}
            </div>
            
            <button
              onClick={() => {
                const nextIndex = floors.indexOf(currentFloor);
                if (nextIndex < floors.length - 1) setCurrentFloor(floors[nextIndex + 1]);
              }}
              disabled={floors.indexOf(currentFloor) === floors.length - 1}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all font-medium"
            >
              Next Floor
              <ChevronUp className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

