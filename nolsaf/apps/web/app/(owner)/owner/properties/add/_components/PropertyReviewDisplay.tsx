"use client";

import { CheckCircle2, MapPin } from "lucide-react";
import { fmtMoney } from "@/lib/propertyUtils";

interface PropertyReviewDisplayProps {
  title: string;
  type: string;
  location: {
    district?: string;
    regionName?: string;
    street?: string;
    city?: string;
  };
  rooms: Array<{
    roomType: string;
    roomsCount: number;
    pricePerNight: number;
  }>;
  currency?: string | null;
}

export function PropertyReviewDisplay({
  title,
  type,
  location,
  rooms,
  currency = "TZS",
}: PropertyReviewDisplayProps) {
  // Match the exact location format from public view: city, district, regionName
  const locationString = [
    location.city,
    location.district,
    location.regionName,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6">
      {/* Property Basics Section - Matches Approved Property View */}
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Property Basics</h3>
        </div>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-600">Name:</span>
            <span className="text-sm font-semibold text-emerald-700">{title || "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-600">Type:</span>
            <span className="text-sm font-semibold text-slate-900">{type || "—"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-slate-600 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              Location:
            </span>
            <span className="text-sm font-semibold text-emerald-700">{locationString || "—"}</span>
          </div>
          {location.street && (
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium text-slate-600">Street:</span>
              <span className="text-sm font-semibold text-slate-900">{location.street}</span>
            </div>
          )}
        </div>
      </div>

      {/* Room Types Section - Matches Approved Property View */}
      <div className="rounded-md border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Room Types</h3>
        </div>
        <div className="space-y-3">
          {rooms.length > 0 ? (
            rooms.map((room, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between gap-4"
              >
                <span className="text-sm font-semibold text-slate-900">{room.roomType}</span>
                <div className="flex items-center gap-3 text-right">
                  <span className="text-xs text-slate-600">
                    {room.roomsCount} room{room.roomsCount !== 1 ? "s" : ""}
                  </span>
                  <span className="text-sm font-bold text-emerald-700">
                    {fmtMoney(room.pricePerNight, currency)}/night
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-6 text-sm text-slate-500">
              No room types added yet
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

