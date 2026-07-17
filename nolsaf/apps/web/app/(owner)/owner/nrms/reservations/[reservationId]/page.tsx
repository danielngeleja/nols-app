import { redirect } from "next/navigation";

export default async function NrmsReservationRedirect({ params }: { params: Promise<{ reservationId: string }> }) {
  const { reservationId } = await params;
  const id = Number(reservationId);
  redirect(Number.isInteger(id) && id > 0 ? `/owner/nrms/reservations?reservationId=${id}` : "/owner/nrms/reservations");
}
