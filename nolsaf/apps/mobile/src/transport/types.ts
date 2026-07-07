import { ArrivalType } from "./tanzaniaLocations";
import { TransportVehicleType } from "./fare";

/** Mode A = scheduled arrival transfer, Mode B = instant pickup. Both end at
 *  the customer's booked property. */
export type TransportMode = "scheduled" | "instant";

export type CreateTransportInput = {
  userId?: number;
  propertyId?: number;
  vehicleType: TransportVehicleType;
  scheduledDate: string; // ISO
  fromLatitude: number;
  fromLongitude: number;
  fromAddress: string;
  toLatitude: number;
  toLongitude: number;
  toAddress: string;
  arrivalType?: ArrivalType;
  arrivalNumber?: string;
  transportCompany?: string;
  arrivalTime?: string; // ISO
  pickupLocation?: string;
  numberOfPassengers?: number;
  notes?: string;
};

/** Server response after creating a transport booking. The server computes the
 *  authoritative `amount`; the client preview is only an estimate. */
export type CreateTransportResult = {
  id: number;
  status: string;
  vehicleType: TransportVehicleType;
  scheduledDate: string;
  amount: number;
  currency: string;
  estimatedDistance?: number;
  estimatedDuration?: number;
};

export type RideListItem = {
  id: number;
  scheduledDate: string | null;
  fromAddress: string | null;
  toAddress: string | null;
  toRegion: string | null;
  status: string;
  amount: number | null;
  rating: number | null;
  isValid: boolean;
  driver: { id: number; name: string | null; phone: string | null } | null;
  property: { id: number; title: string | null } | null;
};

export type RideListResponse = {
  items: RideListItem[];
  total: number;
  page: number;
  pageSize: number;
};

/** Full driver record returned on the ride detail (kept even after the trip ends). */
export type RideDriverDetail = {
  id: number;
  name: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  plateNumber?: string | null;
  vehiclePlate?: string | null;
  vehicleType?: string | null;
  vehicleMake?: string | null;
  rating?: number | null;
  isVipDriver?: boolean;
  operationArea?: string | null;
  district?: string | null;
  region?: string | null;
};

/** GET /api/transport-bookings/:id — the complete trip record for one ride. */
export type RideDetail = {
  id: number;
  status: string;
  vehicleType?: string | null;
  scheduledDate: string | null;
  pickupTime?: string | null;
  dropoffTime?: string | null;
  fromAddress?: string | null;
  fromLatitude?: number | null;
  fromLongitude?: number | null;
  toAddress?: string | null;
  toLatitude?: number | null;
  toLongitude?: number | null;
  amount?: number | null;
  currency?: string | null;
  arrivalType?: string | null;
  arrivalNumber?: string | null;
  transportCompany?: string | null;
  arrivalTime?: string | null;
  pickupLocation?: string | null;
  numberOfPassengers?: number | null;
  notes?: string | null;
  driver?: RideDriverDetail | null;
  property?: { id: number; title: string | null; regionName?: string | null; district?: string | null } | null;
  paymentStatus?: string | null;
  createdAt: string;
  updatedAt?: string | null;
};
