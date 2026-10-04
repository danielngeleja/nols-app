import { CalendarX2, type LucideIcon } from "lucide-react";

// Policy and legal surfaces use Trebuchet MS (see the brand font decision).
const DOC_FONT = '"Trebuchet MS", "Segoe UI", Arial, sans-serif';

/** One line under each title, so a reader knows what the document covers before scrolling. */
const POLICY_SUMMARIES: Record<string, string> = {
  "Cancellation Policy": "How cancellations, no-shows and refunds work for stays, group stays and tour packages booked on NoLSAF.",
  "Terms and Conditions": "The agreement between you and NoLSAF when you use the platform.",
  "Terms of Service": "The agreement between you and NoLSAF when you use the platform.",
  "Privacy Policy": "What personal data NoLSAF collects, why, and the choices you have.",
  "Cookies Policy": "Which cookies NoLSAF uses, what they do, and how to control them.",
  "Verification Policy": "How NoLSAF verifies the people and places listed on the platform.",
  "Disbursement Policy": "When and how NoLSAF pays out earnings.",
  "Driver Disbursement Policy": "When and how drivers are paid on NoLSAF.",
  "Property Owner Disbursement Policy": "When and how property owners are paid on NoLSAF.",
};

/** The few rules readers come looking for, shown up front (taken from the policy's own sections). */
const POLICY_KEY_POINTS: Record<string, string[]> = {
  "Cancellation Policy": ["24-hour cooling-off", "Partial refund window", "Non-refundable components", "No-show rules"],
};

/**
 * Plain document header for policy pages: no photo, dark title on white,
 * a one-line summary and, where it helps, the key points. Replaces the old
 * photo banner, which slowed the page and read as marketing, not a document.
 */
export default function PolicyDocumentHeader({
  title,
  Icon,
  variant = "public",
}: {
  title: string;
  Icon: LucideIcon;
  variant?: "public" | "admin";
}) {
  // A crossed circle reads as an error or a close button; a crossed-out date says "cancellation"
  const Mark = title === "Cancellation Policy" ? CalendarX2 : Icon;
  const summary = POLICY_SUMMARIES[title];
  const keyPoints = POLICY_KEY_POINTS[title] || [];
  const inner = (
    // Centred, to line up with the centred "Last updated" pill and document body below
    <div style={{ fontFamily: DOC_FONT }} className="border-0 border-b border-solid border-slate-200 pb-6 pt-8 text-center sm:pb-7 sm:pt-10">
      <div className="flex items-center justify-center gap-2.5">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
          <Mark className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
        </span>
        {/* No uppercase transform: it would turn the brand into "NOLSAF" */}
        <span className="text-[12.5px] font-bold tracking-[0.04em] text-[#02665e]">NoLSAF Policy</span>
      </div>
      <h1 className="m-0 mt-3 text-[28px] font-bold leading-tight tracking-tight text-[#0f2e2b] sm:text-[34px]">{title}</h1>
      {summary ? <p className="m-0 mx-auto mt-2 max-w-2xl text-[15px] leading-7 text-slate-600">{summary}</p> : null}
      {keyPoints.length ? (
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {keyPoints.map((point) => (
            <span key={point} className="rounded-md bg-[#02665e]/[0.07] px-2.5 py-1 text-[12.5px] font-semibold text-[#024d47]">{point}</span>
          ))}
        </div>
      ) : null}
    </div>
  );

  if (variant === "admin") return <section className="px-6">{inner}</section>;
  return (
    <section className="bg-white">
      <div className="public-container">
        <div className="mx-auto w-full max-w-[1200px] px-1 sm:px-2">{inner}</div>
      </div>
    </section>
  );
}
