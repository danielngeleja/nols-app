import Link from "next/link";
import { BedDouble, CalendarRange } from "lucide-react";

const bookingTypes = [
  { key: "nightly", label: "Short stays", href: "/account/bookings", Icon: BedDouble },
  { key: "long", label: "Long stays", href: "/account/bookings/long-stays", Icon: CalendarRange },
] as const;

export default function BookingTypeNav({ current }: { current: typeof bookingTypes[number]["key"] }) {
  return (
    <nav aria-label="Booking type" className="inline-flex max-w-full gap-1 rounded-md border border-solid border-slate-200 bg-slate-50 p-1">
      {bookingTypes.map(({ key, label, href, Icon }) => (
        <Link key={key} href={href} aria-current={current === key ? "page" : undefined}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded px-3 text-sm font-semibold no-underline transition-colors hover:no-underline ${current === key ? "bg-[#02665e] text-white" : "text-slate-600 hover:bg-white hover:text-[#02665e]"}`}>
          <Icon className="size-4 shrink-0" aria-hidden />{label}
        </Link>
      ))}
    </nav>
  );
}
