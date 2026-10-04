import type { ReactNode } from "react";

/**
 * Heading for a step body.
 *
 * `tone` follows the surface the step is drawn on: "onDark" is the original
 * green panel, "onLight" is the white paper surface the steps are being moved
 * to one at a time.
 */
export function StepHeader({
  step,
  title,
  description,
  right,
  tone = "onDark",
}: {
  step: number;
  title: string;
  description?: string;
  right?: ReactNode;
  tone?: "onDark" | "onLight";
}) {
  const onLight = tone === "onLight";

  return (
    <div
      className={`flex items-start justify-between gap-4 pb-5 ${
        onLight ? "border-0 border-b border-solid border-slate-100" : ""
      }`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <span
            className={`inline-flex h-7 min-w-7 items-center justify-center rounded-full text-xs font-bold ${
              onLight ? "bg-[#02665e] text-white" : "bg-white text-emerald-700 shadow-sm"
            }`}
          >
            {step}
          </span>
          <h2 className={`truncate text-base font-bold sm:text-lg ${onLight ? "text-slate-950" : "text-white"}`}>
            {title}
          </h2>
        </div>
        {description ? (
          <p className={`mt-2 text-sm leading-relaxed ${onLight ? "max-w-2xl text-slate-600" : "text-white"}`}>
            {description}
          </p>
        ) : null}
      </div>
      {right ? <div className="flex-shrink-0">{right}</div> : null}
    </div>
  );
}
