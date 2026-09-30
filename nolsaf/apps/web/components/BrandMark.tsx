// Vector NoLSAF "N" mark, traced from /assets/NoLS2025-04.png (which carries
// heavy white padding, so it renders small). `draw` traces the strokes in.
import type { CSSProperties } from "react";

type BrandMarkProps = {
  size?: number;
  draw?: boolean;
  className?: string;
};

export const BRAND_MARK_FRAME = "M 680 140 Q 640 51 480 51 L 240 51 Q 48 51 48 240 L 48 630 Q 48 820 240 820 L 520 820 Q 704 820 704 640 L 704 228";
export const BRAND_MARK_LETTER = "M 271 612 L 271 240 Q 330 228 400 310 L 560 540 Q 620 612 704 600";
const FRAME = BRAND_MARK_FRAME;
const LETTER = BRAND_MARK_LETTER;

export default function BrandMark({ size = 64, draw = false, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={Math.round(size * 1.13)}
      viewBox="-10 0 770 870"
      fill="none"
      stroke="#02665e"
      aria-hidden
      className={className}
    >
      <path d={FRAME} strokeWidth={86} pathLength={1} className={draw ? "nls-load-draw" : undefined} />
      <path
        d={LETTER}
        strokeWidth={84}
        pathLength={1}
        className={draw ? "nls-load-draw" : undefined}
        style={draw ? ({ "--nls-load-delay": "850ms" } as CSSProperties) : undefined}
      />
    </svg>
  );
}
