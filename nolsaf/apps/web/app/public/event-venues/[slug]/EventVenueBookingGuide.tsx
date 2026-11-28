import Link from "next/link";
import { CalendarRange, MessageSquareText, ReceiptText, ShieldCheck, Wallet, WalletCards } from "lucide-react";
import styles from "./event-venue-details.module.css";

const bookingDetails = [
  {
    Icon: WalletCards,
    title: "Pay after confirmation",
    description: <>Once the owner confirms your slot, review the total, including any cleaning fee and refundable deposit. <strong>Pay in TSh</strong> using the options shown at checkout.</>,
  },
  {
    Icon: Wallet,
    title: "Your deposit stays separate",
    description: <>NoLSAF holds any deposit separately. The owner has <strong>48 hours after the event</strong> to report damage. You can respond to a claim before NoLSAF reviews it and returns the refundable balance.</>,
  },
  {
    Icon: MessageSquareText,
    title: "Help if plans change",
    description: <>Request a cancellation or report a concern from your booking. NoLSAF reviews the case. Track approved refunds under <strong>Payments &amp; deposits</strong>.</>,
  },
];

export default function EventVenueBookingGuide({ hasMultiDayRates }: { hasMultiDayRates: boolean }) {
  return (
    <section aria-labelledby="nolsaf-booking-guide" className="min-w-0 lg:col-span-2">
      <h2 id="nolsaf-booking-guide" className="m-0 mb-3 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
        <ShieldCheck className="h-5 w-5 shrink-0 text-[#02665e]" aria-hidden />
        What NoLSAF offers
      </h2>
      <div className={styles.bookingGuide}>
        <dl className={styles.bookingGuideDetails}>
          {bookingDetails.map(({ Icon, title, description }) => (
            <div key={title}>
              <dt><span className={styles.bookingGuideDetailIcon}><Icon className="h-4 w-4" aria-hidden /></span>{title}</dt>
              <dd>{description}</dd>
            </div>
          ))}
        </dl>
        {hasMultiDayRates && (
          <p className={styles.bookingGuideMultiDay}>
            <CalendarRange className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span><strong>Booking consecutive days?</strong> Use the published total above and confirm your dates with NoLSAF.</span>
          </p>
        )}
        <div className={styles.bookingGuideFooter}>
          <div className="flex min-w-0 items-start gap-2.5">
            <ReceiptText className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
            <div>
              <p className="m-0 text-sm font-semibold leading-5 text-slate-900">Payment confirmation</p>
              <p className="m-0 mt-0.5 text-sm leading-5 text-slate-600">Print it from your booking once NoLSAF verifies your payment.</p>
            </div>
          </div>
          <Link href="/account/event-requests?tab=bookings" className={styles.bookingGuideLink}>My event bookings</Link>
        </div>
      </div>
    </section>
  );
}
