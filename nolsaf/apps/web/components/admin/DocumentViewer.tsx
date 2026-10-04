"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronDown,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileCode2,
  FileDown,
  FileText,
  Loader2,
  Minus,
  Plus,
  Printer,
  Save,
  Search,
  X,
  ZoomIn,
} from "lucide-react";

/**
 * Document viewer with a reader toolbar (print, save, copy, find, pages, zoom,
 * page view). It shows server-rendered template HTML exactly as served, inside
 * a sandboxed frame with no scripts. Do not run that HTML through the
 * sanitizer: it strips the template's <style> block and data: images.
 *
 * Pages are the template's `.sheet` elements; without them the whole document
 * is one page.
 *
 *   <DocumentViewer
 *     open title="Booking receipt" subtitle="RCPT-2026-0055"
 *     html={html} loading={loading} error={error} filename="Receipt.pdf"
 *     tabs={[{ key: "receipt", label: "Receipt" }, { key: "invoice", label: "Invoice" }]}
 *     activeTab="receipt" onTabChange={...} onClose={...}
 *   />
 */

type ViewMode = "single" | "width" | "actual";
type PdfFormat = "a4" | "a5" | "letter";

export type DocumentViewerTab = { key: string; label: string };

export type DocumentViewerProps = {
  open: boolean;
  title: string;
  subtitle?: string;
  /** Extra facts shown in the title bar (amount, status...). */
  meta?: ReactNode;
  html: string;
  loading?: boolean;
  error?: string | null;
  /** Download name; ".pdf" / ".html" is applied per format. */
  filename?: string;
  pdfFormat?: PdfFormat;
  tabs?: DocumentViewerTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  onClose: () => void;
};

const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const VIEW_LABEL: Record<ViewMode, string> = { single: "Single page", width: "Page width", actual: "Actual size" };
const FRAME_STYLE =
  "@media screen{html,body{margin:0!important;padding:0!important;background:transparent!important;overflow:hidden!important}.sheet{margin:0 auto 24px!important;box-shadow:none!important}}";

function baseName(name: string) {
  return (name || "Document").replace(/\.(pdf|html?)$/i, "");
}

function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);
  return ref;
}

function ToolButton({
  label,
  icon,
  onClick,
  disabled,
  active,
  showLabel,
  trailing,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  showLabel?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border-0 px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? "bg-[#02665e]/10 text-[#02665e]" : "bg-transparent text-neutral-700 hover:bg-neutral-100"
      }`}
    >
      {icon}
      {showLabel ? <span className="hidden sm:inline">{label}</span> : null}
      {trailing}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px shrink-0 bg-neutral-200" aria-hidden="true" />;
}

function MenuItem({ children, onClick, selected }: { children: ReactNode; onClick: () => void; selected?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-left text-xs font-medium text-neutral-700 hover:bg-neutral-100"
    >
      <span className="grid h-3.5 w-3.5 place-items-center text-[#02665e]">{selected ? <Check className="h-3.5 w-3.5" /> : null}</span>
      {children}
    </button>
  );
}

export default function DocumentViewer({
  open,
  title,
  subtitle,
  meta,
  html,
  loading = false,
  error = null,
  filename = "Document.pdf",
  pdfFormat = "a5",
  tabs,
  activeTab,
  onTabChange,
  onClose,
}: DocumentViewerProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [pageTops, setPageTops] = useState<number[]>([0]);
  const [pageHeight, setPageHeight] = useState(0);
  const [page, setPage] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [mode, setMode] = useState<ViewMode>("single");
  const [zoom, setZoom] = useState(1);
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [saveOpen, setSaveOpen] = useState(false);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findText, setFindText] = useState("");
  const [findMiss, setFindMiss] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const saveRef = useDismiss(saveOpen, useCallback(() => setSaveOpen(false), []));
  const zoomRef = useDismiss(zoomOpen, useCallback(() => setZoomOpen(false), []));
  const viewRef = useDismiss(viewOpen, useCallback(() => setViewOpen(false), []));

  const ready = Boolean(html) && !loading && !error && size.width > 0;
  const pages = pageTops.length;

  const scale = useMemo(() => {
    if (!size.width) return 1;
    const room = Math.max(200, stageSize.width - 48);
    if (mode === "width") return room / size.width;
    if (mode === "single") {
      const fitWidth = room / size.width;
      const fitHeight = pageHeight ? Math.max(200, stageSize.height - 48) / pageHeight : fitWidth;
      return Math.min(fitWidth, fitHeight);
    }
    return zoom;
  }, [mode, zoom, size.width, pageHeight, stageSize]);

  // Reset when a new document arrives.
  useEffect(() => {
    setSize({ width: 0, height: 0 });
    setPageTops([0]);
    setPage(1);
    setPageInput("1");
    setFindMiss(false);
  }, [html]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!open || !stage) return;
    const measure = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [open, html, loading, error]);

  const measureDocument = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc?.documentElement) return;
    if (!doc.getElementById("nolsaf-viewer-style")) {
      const style = doc.createElement("style");
      style.id = "nolsaf-viewer-style";
      style.textContent = FRAME_STYLE;
      doc.head?.appendChild(style);
    }
    const sheets = Array.from(doc.querySelectorAll<HTMLElement>(".sheet"));
    if (sheets.length) {
      const width = Math.max(...sheets.map((sheet) => sheet.offsetWidth));
      setPageTops(sheets.map((sheet) => sheet.offsetTop));
      setPageHeight(Math.max(...sheets.map((sheet) => sheet.offsetHeight)));
      setSize({ width, height: doc.documentElement.scrollHeight });
    } else {
      const width = doc.documentElement.scrollWidth || 600;
      const height = doc.documentElement.scrollHeight || 800;
      setPageTops([0]);
      setPageHeight(height);
      setSize({ width, height });
    }
  }, []);

  const goTo = useCallback(
    (target: number) => {
      const next = Math.min(Math.max(1, target), pages);
      setPage(next);
      setPageInput(String(next));
      stageRef.current?.scrollTo({ top: (pageTops[next - 1] ?? 0) * scale, behavior: "smooth" });
    },
    [pages, pageTops, scale],
  );

  const onStageScroll = useCallback(() => {
    const stage = stageRef.current;
    if (!stage || pages < 2) return;
    const probe = stage.scrollTop / scale + 40;
    let current = 1;
    pageTops.forEach((top, index) => {
      if (probe >= top) current = index + 1;
    });
    setPage(current);
    setPageInput(String(current));
  }, [pages, pageTops, scale]);

  const print = useCallback(() => {
    const win = frameRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  }, []);

  const savePdf = useCallback(async () => {
    setSaveOpen(false);
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    const sheets = Array.from(doc.querySelectorAll<HTMLElement>(".sheet"));
    const source = sheets.length === 1 ? sheets[0] : doc.body;
    setPdfBusy(true);
    try {
      const mod: any = await import("html2pdf.js");
      const h2p = mod.default || mod;
      await h2p()
        .from(source)
        .set({
          filename: `${baseName(filename)}.pdf`,
          margin: 0,
          jsPDF: { unit: "mm", format: pdfFormat, orientation: "portrait" },
          html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: source.offsetWidth },
          pagebreak: { mode: sheets.length > 1 ? ["css"] : [] },
        })
        .save();
    } catch {
      // The browser's own "Save as PDF" is the fallback.
      print();
    } finally {
      setPdfBusy(false);
    }
  }, [filename, pdfFormat, print]);

  const saveHtml = useCallback(() => {
    setSaveOpen(false);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName(filename)}.html`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [html, filename]);

  const copyText = useCallback(async () => {
    const text = frameRef.current?.contentDocument?.body?.innerText?.trim();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, []);

  const find = useCallback(
    (backwards = false) => {
      const win = frameRef.current?.contentWindow as (Window & { find?: (...args: unknown[]) => boolean }) | null;
      const query = findText.trim();
      if (!win || !query || typeof win.find !== "function") return;
      // find(text, caseSensitive, backwards, wrapAround)
      setFindMiss(!win.find(query, false, backwards, true));
    },
    [findText],
  );

  const stepZoom = useCallback(
    (direction: 1 | -1) => {
      const current = scale;
      const next = direction > 0 ? ZOOM_STEPS.find((step) => step > current + 0.01) : [...ZOOM_STEPS].reverse().find((step) => step < current - 0.01);
      setZoom(next ?? current);
      setMode("actual");
    },
    [scale],
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (findOpen) setFindOpen(false);
        else onClose();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p" && ready) {
        event.preventDefault();
        print();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && ready) {
        event.preventDefault();
        setFindOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, findOpen, ready, onClose, print]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="flex h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
        {/* Title bar */}
        <div className="flex shrink-0 items-center gap-3 border-0 border-b border-solid border-neutral-200 px-4 py-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-sm font-bold text-neutral-900">{title}</p>
            {subtitle ? <p className="m-0 truncate font-mono text-[11px] text-neutral-500">{subtitle}</p> : null}
          </div>
          {meta ? <div className="hidden min-w-0 items-center gap-4 md:flex">{meta}</div> : null}
          {tabs && tabs.length > 1 ? (
            <div className="inline-flex shrink-0 rounded-lg bg-neutral-100 p-0.5" role="tablist" aria-label="Document">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={tab.key === activeTab}
                  onClick={() => tab.key !== activeTab && onTabChange?.(tab.key)}
                  className={`h-7 rounded-md border-0 px-3 text-xs font-semibold transition ${
                    tab.key === activeTab ? "bg-white text-neutral-900 shadow-sm" : "bg-transparent text-neutral-500 hover:text-neutral-800"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            title="Close"
            aria-label="Close"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Reader toolbar */}
        <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-0 border-b border-solid border-neutral-200 bg-neutral-50 px-2 py-1">
          <ToolButton label="Print" showLabel icon={<Printer className="h-4 w-4" />} onClick={print} disabled={!ready} />

          <div className="relative" ref={saveRef}>
            <ToolButton
              label="Save"
              showLabel
              icon={pdfBusy ? <Loader2 className="h-4 w-4 animate-spin text-[#02665e]" /> : <Save className="h-4 w-4 text-[#02665e]" />}
              trailing={<ChevronDown className="h-3 w-3 text-neutral-400" />}
              onClick={() => setSaveOpen((value) => !value)}
              disabled={!ready || pdfBusy}
              active={saveOpen}
            />
            {saveOpen ? (
              <div role="menu" className="absolute left-0 top-9 z-10 w-44 rounded-lg border border-solid border-neutral-200 bg-white p-1 shadow-lg">
                <MenuItem onClick={() => void savePdf()}><FileDown className="h-3.5 w-3.5 text-neutral-500" /> Save as PDF</MenuItem>
                <MenuItem onClick={saveHtml}><FileCode2 className="h-3.5 w-3.5 text-neutral-500" /> Save as HTML</MenuItem>
              </div>
            ) : null}
          </div>

          <Divider />
          <ToolButton label={copied ? "Text copied" : "Copy text"} icon={copied ? <Check className="h-4 w-4 text-[#02665e]" /> : <Copy className="h-4 w-4" />} onClick={() => void copyText()} disabled={!ready} />
          <ToolButton label="Find in document" icon={<Search className="h-4 w-4" />} onClick={() => setFindOpen((value) => !value)} disabled={!ready} active={findOpen} />

          <Divider />
          <ToolButton label="First page" icon={<ChevronFirst className="h-4 w-4" />} onClick={() => goTo(1)} disabled={!ready || page <= 1} />
          <ToolButton label="Previous page" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => goTo(page - 1)} disabled={!ready || page <= 1} />
          <label className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-neutral-500">
            Page
            <input
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => { if (event.key === "Enter") goTo(Number(pageInput) || 1); }}
              onBlur={() => setPageInput(String(page))}
              disabled={!ready}
              inputMode="numeric"
              aria-label="Page number"
              className="h-7 w-10 rounded-md border border-solid border-neutral-300 bg-white px-1 text-center text-xs tabular-nums text-neutral-900 outline-none focus:border-[#02665e]"
            />
            of {ready ? pages : 1}
          </label>
          <ToolButton label="Next page" icon={<ChevronRight className="h-4 w-4" />} onClick={() => goTo(page + 1)} disabled={!ready || page >= pages} />
          <ToolButton label="Last page" icon={<ChevronLast className="h-4 w-4" />} onClick={() => goTo(pages)} disabled={!ready || page >= pages} />

          <Divider />
          <ToolButton label="Zoom out" icon={<Minus className="h-4 w-4" />} onClick={() => stepZoom(-1)} disabled={!ready || scale <= ZOOM_STEPS[0] + 0.01} />
          <div className="relative" ref={zoomRef}>
            <ToolButton
              label="Zoom"
              icon={<ZoomIn className="h-4 w-4" />}
              trailing={<><span className="tabular-nums">{Math.round(scale * 100)}%</span><ChevronDown className="h-3 w-3 text-neutral-400" /></>}
              onClick={() => setZoomOpen((value) => !value)}
              disabled={!ready}
              active={zoomOpen}
            />
            {zoomOpen ? (
              <div role="menu" className="absolute left-0 top-9 z-10 w-36 rounded-lg border border-solid border-neutral-200 bg-white p-1 shadow-lg">
                {ZOOM_STEPS.map((step) => (
                  <MenuItem key={step} selected={mode === "actual" && Math.abs(zoom - step) < 0.01} onClick={() => { setZoom(step); setMode("actual"); setZoomOpen(false); }}>
                    {Math.round(step * 100)}%
                  </MenuItem>
                ))}
              </div>
            ) : null}
          </div>
          <ToolButton label="Zoom in" icon={<Plus className="h-4 w-4" />} onClick={() => stepZoom(1)} disabled={!ready || scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.01} />

          <Divider />
          <div className="relative" ref={viewRef}>
            <ToolButton
              label={VIEW_LABEL[mode]}
              showLabel
              icon={<FileText className="h-4 w-4 text-[#02665e]" />}
              trailing={<ChevronDown className="h-3 w-3 text-neutral-400" />}
              onClick={() => setViewOpen((value) => !value)}
              disabled={!ready}
              active={viewOpen}
            />
            {viewOpen ? (
              <div role="menu" className="absolute right-0 top-9 z-10 w-40 rounded-lg border border-solid border-neutral-200 bg-white p-1 shadow-lg">
                {(Object.keys(VIEW_LABEL) as ViewMode[]).map((key) => (
                  <MenuItem key={key} selected={mode === key} onClick={() => { if (key === "actual") setZoom(1); setMode(key); setViewOpen(false); }}>
                    {VIEW_LABEL[key]}
                  </MenuItem>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {findOpen && ready ? (
          <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-neutral-200 bg-white px-3 py-1.5">
            <Search className="h-3.5 w-3.5 text-neutral-400" />
            <input
              autoFocus
              value={findText}
              onChange={(event) => { setFindText(event.target.value); setFindMiss(false); }}
              onKeyDown={(event) => { if (event.key === "Enter") find(event.shiftKey); }}
              placeholder="Find in document"
              aria-label="Find in document"
              className="h-7 min-w-0 flex-1 border-0 bg-transparent text-xs text-neutral-900 outline-none"
            />
            {findMiss ? <span className="text-[11px] font-semibold text-rose-600">No match</span> : null}
            <ToolButton label="Previous match" icon={<ChevronLeft className="h-4 w-4" />} onClick={() => find(true)} disabled={!findText.trim()} />
            <ToolButton label="Next match" icon={<ChevronRight className="h-4 w-4" />} onClick={() => find(false)} disabled={!findText.trim()} />
            <ToolButton label="Close find" icon={<X className="h-4 w-4" />} onClick={() => setFindOpen(false)} />
          </div>
        ) : null}

        {/* Canvas */}
        <div ref={stageRef} onScroll={onStageScroll} className="min-h-0 flex-1 overflow-auto bg-neutral-200">
          {loading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-neutral-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading document</div>
          ) : error || !html ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
              <p className="m-0 text-sm font-semibold text-rose-600">Document unavailable</p>
              <p className="m-0 text-xs text-neutral-500">{error || "Please try again."}</p>
            </div>
          ) : (
            <div className="flex min-h-full justify-center px-6 py-6">
              <div
                className="shrink-0"
                style={size.width ? { width: size.width * scale, height: size.height * scale } : { width: "100%", height: "100%" }}
              >
                <iframe
                  ref={frameRef}
                  title={title}
                  srcDoc={html}
                  sandbox="allow-same-origin allow-modals"
                  onLoad={measureDocument}
                  className="block border-0 bg-transparent"
                  style={{
                    width: size.width || "100%",
                    height: size.height || "100%",
                    transform: `scale(${scale})`,
                    transformOrigin: "top left",
                    visibility: size.width ? "visible" : "hidden",
                    filter: "drop-shadow(0 12px 28px rgba(15,46,43,0.18))",
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
