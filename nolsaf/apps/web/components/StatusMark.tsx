// The NoLSAF mark inside a status ring, shared by every fallback screen
// (global error, section error boundary, 404). The mark always stays brand
// green; only the ring carries the state. Inline styles only, because the
// global error screen renders without the app stylesheet.
import { BRAND_MARK_FRAME, BRAND_MARK_LETTER } from "@/components/BrandMark";

export type StatusRing = "offline" | "retrying" | "down" | "idle";

const RING_COLOR: Record<StatusRing, string> = {
  offline: "#378ADD",
  retrying: "#EF9F27",
  down: "#E24B4A",
  idle: "#d4d4d4",
};

export const STATUS_MARK_KEYFRAMES = `
  @keyframes nls-status-count { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 1; } }
  @keyframes nls-status-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .nls-status-anim { animation: none !important; } }
`;

export default function StatusMark({ ring, size = 76, countdownSeconds }: { ring: StatusRing; size?: number; countdownSeconds?: number }) {
  const color = RING_COLOR[ring];
  const markWidth = Math.round(size * 0.45);
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <style>{STATUS_MARK_KEYFRAMES}</style>
      <svg width={size} height={size} viewBox="0 0 76 76" style={{ position: "absolute", inset: 0 }} aria-hidden>
        {ring === "offline" && (
          <circle cx="38" cy="38" r="35" fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="5 6" className="nls-status-anim" style={{ transformOrigin: "center", animation: "nls-status-spin 12s linear infinite" }} />
        )}
        {ring === "retrying" && <>
          <circle cx="38" cy="38" r="35" fill="none" stroke="#e5e5e5" strokeWidth="2.5" />
          {countdownSeconds ? (
            <circle cx="38" cy="38" r="35" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" transform="rotate(-90 38 38)" className="nls-status-anim" style={{ animation: `nls-status-count ${countdownSeconds}s linear forwards` }} />
          ) : (
            <circle cx="38" cy="38" r="35" fill="none" stroke={color} strokeWidth="2.5" />
          )}
        </>}
        {(ring === "down" || ring === "idle") && <circle cx="38" cy="38" r="35" fill="none" stroke={color} strokeWidth="2.5" />}
      </svg>
      <svg width={markWidth} height={Math.round(markWidth * 1.13)} viewBox="-10 0 770 870" fill="none" stroke="#02665e" aria-hidden>
        <path d={BRAND_MARK_FRAME} strokeWidth={86} />
        <path d={BRAND_MARK_LETTER} strokeWidth={84} />
      </svg>
    </div>
  );
}
