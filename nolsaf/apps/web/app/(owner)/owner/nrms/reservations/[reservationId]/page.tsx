import { redirect } from "next/navigation";

// Only the opaque rs_ reference opens a reservation from a URL; a numeric id
// lands on the list so row ids never travel in links.
const RESERVATION_REFERENCE = /^rs_[A-Za-z0-9_-]{22}$/;

export default async function NrmsReservationRedirect({ params }: { params: Promise<{ reservationId: string }> }) {
  const { reservationId } = await params;
  const reference = decodeURIComponent(reservationId);
  redirect(RESERVATION_REFERENCE.test(reference) ? `/owner/nrms/reservations?reservation=${encodeURIComponent(reference)}` : "/owner/nrms/reservations");
}
