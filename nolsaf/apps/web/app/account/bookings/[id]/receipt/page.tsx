import BookingReceiptViewer from "@/components/BookingReceiptViewer";

export default async function BookingReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = encodeURIComponent(id);
  return <BookingReceiptViewer reference={id} backHref={`/account/bookings/${key}`} apiBase={`/api/customer/bookings/${key}`} />;
}
