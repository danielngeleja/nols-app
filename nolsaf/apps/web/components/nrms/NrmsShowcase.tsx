// Shared visual content for "what NRMS is": the module grid and the
// illustrative workspace preview. Used by the owner's pre-activation screen
// (app/(owner)/owner/nrms/_components/NrmsActivationScreen.tsx) and the public
// marketing page (app/public/nrms) so the two never quietly drift apart —
// a prospective owner sees the same pitch logged out that an enrolled owner
// sees before activating their first property.
import type { ComponentType } from "react";
import {
  BedDouble,
  CalendarDays,
  CheckCircle2,
  FileText,
  Hotel,
  Link2,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Users,
  UsersRound,
} from "lucide-react";

export const NRMS_MODULES: Array<{
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    title: "Unified room calendar",
    description: "See NoLSAF bookings, external stays and room blocks together without double-selling inventory.",
    icon: CalendarDays,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    title: "Front desk operations",
    description: "Record arrivals, assign rooms, check guests in and complete checkout from one workspace.",
    icon: Hotel,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    title: "Restaurant, bar and QR ordering",
    description: "Run outlet menus and stock, take table and room orders, and let guests order by scanning a QR code.",
    icon: ShoppingBasket,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    title: "OTA channel sync",
    description: "Keep availability and rates in step with Booking.com, Airbnb and Expedia from the same inventory.",
    icon: Link2,
    tone: "bg-sky-50 text-sky-700",
  },
  {
    title: "Housekeeping",
    description: "Track room status and cleaning tasks so a room is never sold before it is actually ready.",
    icon: Sparkles,
    tone: "bg-teal-50 text-teal-700",
  },
  {
    title: "Guest and stay records",
    description: "Keep guest details, reservation history, payments and balances organized for your team.",
    icon: Users,
    tone: "bg-amber-50 text-amber-700",
  },
  {
    title: "Financial reports and Night Audit",
    description: "Close the business date into a balanced ledger, then export USALI-standard reports with a profit and loss.",
    icon: FileText,
    tone: "bg-rose-50 text-rose-700",
  },
  {
    title: "Staff, shifts and tips",
    description: "Assign roles, reconcile cashier shifts and record who served, settled and was tipped for every order.",
    icon: UsersRound,
    tone: "bg-indigo-50 text-indigo-700",
  },
];

/**
 * The module grid, as its own component rather than an inline `.map()` in
 * each screen. Cards are explicit flex columns with `h-full` and `min-w-0` so
 * a longer description (the last card ran noticeably longer than the rest)
 * can never overlap the card below it in the grid row — CSS grid stretches
 * row height to the tallest cell automatically, but only once every cell
 * actually participates in that stretch, which a bare block-level article
 * does not guarantee on its own.
 */
export function NrmsModuleGrid({ modules = NRMS_MODULES }: { modules?: typeof NRMS_MODULES }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {modules.map(({ title, description, icon: Icon, tone }) => (
        <article
          key={title}
          className="group flex h-full min-w-0 flex-col rounded-2xl border border-neutral-200/80 bg-white p-5 transition-all duration-300 ease-out hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_16px_35px_-24px_rgba(6,78,59,0.5)]"
        >
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-300 ease-out group-hover:scale-105 ${tone}`}><Icon className="h-5 w-5" /></span>
          <h3 className="mt-4 text-sm font-bold text-neutral-900">{title}</h3>
          <p className="mt-2 flex-1 break-words text-xs leading-5 text-neutral-500">{description}</p>
        </article>
      ))}
    </div>
  );
}

export function NrmsWorkspacePreview() {
  const days = ["Mon 14", "Tue 15", "Wed 16", "Thu 17", "Fri 18"];
  return (
    <div className="relative mx-auto w-full max-w-[580px] lg:mr-0">
      <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-emerald-300/30 via-white/20 to-teal-200/30 blur-2xl" />
      <div className="relative overflow-hidden rounded-[26px] border border-white/70 bg-[#0b2926] p-2 shadow-[0_35px_80px_-35px_rgba(4,47,46,0.8)]">
        <div className="rounded-[20px] bg-[#f8faf9] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white"><BedDouble className="h-4 w-4" /></span>
              <div><p className="text-xs font-bold text-neutral-900">NRMS workspace</p><p className="text-[10px] text-neutral-400">Workspace preview · illustrative data</p></div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live inventory</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <PreviewMetric label="Arrivals" value="06" accent="text-blue-700" />
            <PreviewMetric label="In house" value="18" accent="text-emerald-700" />
            <PreviewMetric label="Departures" value="04" accent="text-violet-700" />
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <div className="grid grid-cols-[72px_repeat(5,minmax(42px,1fr))] border-b border-neutral-100 bg-neutral-50 text-[8px] font-semibold text-neutral-400">
              <div className="px-2 py-2">ROOM</div>{days.map((day) => <div key={day} className="border-l border-neutral-100 px-1 py-2 text-center">{day}</div>)}
            </div>
            <PreviewRow room="A-101" cells={[null, "nolsaf", "nolsaf", null, "block"]} />
            <PreviewRow room="A-102" cells={["external", "external", null, "nolsaf", "nolsaf"]} />
            <PreviewRow room="B-201" cells={[null, "block", null, "external", "external"]} />
            <PreviewRow room="B-202" cells={["nolsaf", "nolsaf", "nolsaf", null, null]} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-neutral-800">Today&apos;s front desk</p><span className="text-[9px] text-emerald-700">View all</span></div>
              <div className="mt-2 space-y-2">
                <GuestLine initials="AM" name="Amina M." detail="Arriving · A-101" color="bg-blue-100 text-blue-700" />
                <GuestLine initials="JK" name="Joseph K." detail="In house · B-202" color="bg-emerald-100 text-emerald-700" />
              </div>
            </div>
            <div className="rounded-xl bg-emerald-600 p-3 text-white">
              <div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold text-emerald-100">Availability health</p><p className="mt-1 text-xl font-bold">Synced</p></div><ShieldCheck className="h-5 w-5 text-emerald-200" /></div>
              <p className="mt-3 text-[9px] leading-4 text-emerald-50/80">NoLSAF bookings and external stays are sharing one inventory view.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-4 -left-3 hidden items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 shadow-xl sm:flex"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></span><div><p className="text-[9px] text-neutral-400">Inventory update</p><p className="text-[10px] font-bold text-neutral-800">Duplicate booking prevented</p></div></div>
    </div>
  );
}

function PreviewMetric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5"><p className="text-[9px] text-neutral-400">{label}</p><p className={`mt-1 text-lg font-bold ${accent}`}>{value}</p></div>;
}

function PreviewRow({ room, cells }: { room: string; cells: Array<"nolsaf" | "external" | "block" | null> }) {
  const colors = { nolsaf: "bg-blue-100 border-blue-200", external: "bg-emerald-100 border-emerald-200", block: "bg-neutral-200 border-neutral-300" };
  return <div className="grid grid-cols-[72px_repeat(5,minmax(42px,1fr))] border-b border-neutral-100 last:border-b-0"><div className="px-2 py-2 text-[9px] font-bold text-neutral-600">{room}</div>{cells.map((cell, index) => <div key={index} className="border-l border-neutral-100 p-1.5">{cell && <span className={`block h-4 rounded border ${colors[cell]}`} />}</div>)}</div>;
}

function GuestLine({ initials, name, detail, color }: { initials: string; name: string; detail: string; color: string }) {
  return <div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-bold ${color}`}>{initials}</span><div><p className="text-[9px] font-bold text-neutral-800">{name}</p><p className="text-[8px] text-neutral-400">{detail}</p></div></div>;
}
