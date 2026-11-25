import BookingReceiptViewer from "@/components/BookingReceiptViewer";

export default async function LongStayReceiptPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const key = encodeURIComponent(ref);
  return (
    <BookingReceiptViewer
      reference={ref}
      backHref={`/account/bookings/long-stays/${key}`}
      apiBase={`/api/customer/long-stay/tenancies/${key}`}
      title="Long-stay receipt"
      subtitle="NoLSAF card payment"
    />
  );
}
