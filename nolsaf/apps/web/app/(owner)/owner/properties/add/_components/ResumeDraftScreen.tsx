"use client";

import { ChevronRight, Clock, Cloud, Laptop, Plus } from "lucide-react";

type LocalDraft = {
  title?: string;
  type?: string;
  district?: string;
  timestamp?: string;
  currentStep?: number;
};

type ServerDraft = {
  id: number;
  title?: string;
  updatedAt?: string;
};

function formatTime(ts?: string) {
  if (!ts) return "—";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" }).format(d);
}

export function ResumeDraftScreen({
  localDraft,
  serverDrafts,
  stepTitles,
  onContinueLocal,
  onContinueServer,
  onStartNew,
  onDismiss,
}: {
  localDraft: LocalDraft | null;
  serverDrafts: ServerDraft[];
  stepTitles: readonly string[];
  onContinueLocal: () => void;
  onContinueServer: (id: number) => void;
  onStartNew: () => void;
  onDismiss: () => void;
}) {
  const hasAny = !!localDraft || serverDrafts.length > 0;
  if (!hasAny) return null;

  const localStep =
    typeof localDraft?.currentStep === "number" && localDraft.currentStep >= 0 ? localDraft.currentStep : 0;
  const localStepTitle = stepTitles[localStep] || "Basic details";
  const totalSteps = stepTitles.length || 6;
  const localPct = Math.round(((localStep + 1) / totalSteps) * 100);

  return (
    <div className="w-full bg-slate-50 py-10 sm:py-12">
      <div className="mx-auto max-w-4xl px-4">
        <div
          className="animate-in fade-in slide-in-from-bottom-4 duration-300 rounded-lg border border-slate-200 bg-white shadow-[0_1px_0_rgba(15,23,42,0.04),0_18px_50px_rgba(15,23,42,0.10)] overflow-hidden"
        >
          <div className="px-6 py-5 border-b border-slate-200 bg-white">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                  Continue
                </div>
                <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-slate-900">Continue your listing</h1>
                <p className="mt-1 text-sm text-slate-600">
                  Pick up where you left off, or start a new property listing.
                </p>
              </div>
              <button
                type="button"
                onClick={onDismiss}
                className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Skip
              </button>
            </div>
          </div>

          <div className="px-6 py-6 space-y-6">
            {localDraft ? (
              <div className="rounded-lg border border-slate-200 bg-white p-5 hover:shadow-sm transition-shadow">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex items-start gap-4 min-w-0">
                    <div className="h-10 w-10 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0">
                      <Laptop className="h-5 w-5 text-slate-700" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-500">This device</div>
                      <div className="mt-1 text-base sm:text-lg font-semibold text-slate-900 truncate">
                        {localDraft.title?.trim() ? localDraft.title : "Untitled property"}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                          {formatTime(localDraft.timestamp)}
                        </span>
                        <span className="inline-flex items-center rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                          Step {localStep + 1}/{totalSteps} · {localStepTitle}
                        </span>
                      </div>

                      <progress
                        value={localPct}
                        max={100}
                        className="mt-3 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100
                          [&::-webkit-progress-bar]:bg-slate-100
                          [&::-webkit-progress-value]:bg-gradient-to-r [&::-webkit-progress-value]:from-emerald-600 [&::-webkit-progress-value]:to-sky-500
                          [&::-moz-progress-bar]:bg-gradient-to-r [&::-moz-progress-bar]:from-emerald-600 [&::-moz-progress-bar]:to-sky-500"
                        aria-label="Draft progress"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onContinueLocal}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-colors shadow-sm"
                  >
                    Continue
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ) : null}

            {serverDrafts.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-600">Saved drafts</div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {serverDrafts.map((d) => (
                    <div
                      key={d.id}
                      className="rounded-lg border border-slate-200 bg-white p-4 hover:shadow-sm transition-shadow"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-md bg-slate-50 border border-slate-200 flex items-center justify-center flex-shrink-0">
                            <Cloud className="h-4.5 w-4.5 text-slate-700" aria-hidden />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-900 truncate">
                              {d.title?.trim() ? d.title : `Draft #${d.id}`}
                            </div>
                            <div className="mt-1 text-xs text-slate-600 inline-flex items-center gap-1.5">
                              <Clock className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                              {formatTime(d.updatedAt)}
                            </div>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onContinueServer(d.id)}
                          className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
                        >
                          Continue
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="pt-2 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onStartNew}
                className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Create new listing
              </button>
              <div className="text-xs text-slate-500">Drafts are kept for 7 days on this device.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


