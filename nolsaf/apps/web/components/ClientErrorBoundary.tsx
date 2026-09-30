"use client";
import React from "react";
import StatusMark from "@/components/StatusMark";

type Props = { children: React.ReactNode };

/**
 * Catches a crash in one part of the page (today: the legal modal in each site
 * header) so the rest of the page keeps working. The fallback is a small card
 * pinned to the bottom of the screen in the same style as the global error
 * screen, not a block dropped into the layout: this boundary sits inside the
 * header, and a tall card there pushed the whole page down.
 */
export default class ClientErrorBoundary extends React.Component<Props, { error: Error | null; dismissed: boolean }> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, dismissed: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { error, dismissed: false };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('ClientErrorBoundary caught', error, info);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nols:client-error", {
        detail: {
          message: error.message,
          source: "react-error-boundary",
          stack: error.stack,
          componentStack: typeof info?.componentStack === "string" ? info.componentStack : undefined,
        },
      }));
    }
  }

  handleReload = () => {
    // A full reload fetches fresh code, which is what fixes a stale chunk.
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (this.state.error) {
      if (this.state.dismissed) return null;
      return (
        <div role="alert" className="fixed inset-x-0 bottom-4 z-[9998] flex justify-center px-4">
          <div className="box-border flex w-full max-w-sm items-center gap-3 rounded-2xl border border-solid border-neutral-200 bg-white p-3 pr-2 shadow-[0_18px_40px_-20px_rgba(15,23,42,0.45)]">
            <StatusMark ring="retrying" size={44} />
            <div className="min-w-0 flex-1">
              <p className="m-0 text-sm font-bold text-neutral-900">Part of this page didn&apos;t load</p>
              <p className="m-0 mt-0.5 text-xs text-neutral-500">Reload to fix it. Nothing was lost.</p>
            </div>
            <button type="button" onClick={this.handleReload} className="h-9 flex-shrink-0 appearance-none rounded-lg border border-solid border-neutral-300 bg-white px-3 text-xs font-semibold text-neutral-800 transition hover:border-[#02665e] hover:text-[#02665e]">
              Reload
            </button>
            <button type="button" aria-label="Dismiss" onClick={() => this.setState({ dismissed: true })} className="grid h-9 w-8 flex-shrink-0 appearance-none place-items-center rounded-lg border-0 bg-transparent text-lg leading-none text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700">
              ×
            </button>
          </div>
        </div>
      );
    }

    return this.props.children as React.ReactElement;
  }
}
