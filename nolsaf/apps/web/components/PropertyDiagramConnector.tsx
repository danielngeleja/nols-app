export type DiagramConnection = { sx: number; sy: number; ex: number; ey: number };

export default function PropertyDiagramConnector({ connection: { sx, sy, ex, ey }, className = "", stroke = "#02665e" }: {
  connection: DiagramConnection;
  className?: string;
  stroke?: string;
}) {
  const mid = sx + Math.max(16, (ex - sx) * 0.55);
  const bend = Math.sign(ey - sy) * Math.min(8, Math.abs(ey - sy));
  const path = `M ${sx + 6} ${sy} L ${mid - 8} ${sy} Q ${mid} ${sy} ${mid} ${sy + bend} L ${mid} ${ey - bend} Q ${mid} ${ey} ${mid + 8} ${ey} L ${ex - 2} ${ey}`;
  return (
    <svg aria-hidden className={`pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible ${className}`}>
      <g className="motion-safe:transition-all motion-safe:duration-300">
        <path d={path} fill="none" stroke={stroke} strokeOpacity="0.18" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
        <path d={path} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" className="nols-connector-flow" />
        <circle cx={sx + 6} cy={sy} r="5" fill="#fff" stroke={stroke} strokeWidth="2" />
        <circle cx={sx + 6} cy={sy} r="2" fill={stroke} />
      </g>
    </svg>
  );
}
