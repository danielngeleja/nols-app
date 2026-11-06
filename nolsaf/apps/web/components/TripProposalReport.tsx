import {
  Eye, Mail, MapPin, Printer,
  Plane, Users, Target, Car, Calendar, Clock, Star,
  BarChart3, Gift, Building2, Utensils, User, FileText, Ticket,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Shared data shape (union of admin + customer request types)
// ─────────────────────────────────────────────────────────────────────────────
export type TripReportData = {
  id: number;
  role: string;
  tripType: string;
  destinations: string;
  dateFrom?: string | null;
  dateTo?: string | null;
  groupSize?: number | null;
  budget?: string | null;
  notes?: string | null;
  transportRequired?: boolean;
  suggestedItineraries?: string | null;
  requiredPermits?: string | null;
  estimatedTimeline?: string | null;
  assignedAgent?: string | null;
  respondedAt?: string | null;
  customer: {
    name: string;
    email: string;
    phone?: string | null;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Itinerary text → structured option blocks
// ─────────────────────────────────────────────────────────────────────────────
type ParsedOption = {
  name: string;
  pricingLines: string[];
  inclCats: { label: string; items: string; details: string[] }[];
  itineraryLines: string[];
};

export function parseOptions(raw: string): ParsedOption[] {
  const blocks = raw.split(/(?=^===\s)/m).filter(s => s.trim());
  return blocks.map(block => {
    const lines = block.split("\n");
    const name = (lines[0] ?? "").replace(/^===\s*/, "").replace(/\s*===\s*$/, "").trim();
    const pricingLines: string[] = [];
    const inclusionLines: string[] = [];
    const itineraryLines: string[] = [];
    let section: "pricing" | "inclusions" | "itinerary" = "pricing";
    for (let i = 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^---\s*WHAT[''&#x27;]?S INCLUDED/i.test(l) || /^---\s*WHAT/i.test(l)) { section = "inclusions"; continue; }
      if (/^Itinerary:/i.test(l)) { section = "itinerary"; continue; }
      if (section === "pricing" && l.trim()) pricingLines.push(l.trim());
      if (section === "inclusions") inclusionLines.push(l);
      if (section === "itinerary") itineraryLines.push(l);
    }
    const inclCats: { label: string; items: string; details: string[] }[] = [];
    let currentCat: { label: string; items: string; details: string[] } | null = null;
    for (const l of inclusionLines) {
      if (!l.trim()) continue;
      if (/^\s{2,}/.test(l)) { currentCat?.details.push(l.trim()); }
      else {
        const m = l.match(/^(.+?):\s*(.*)$/);
        if (m) { currentCat = { label: m[1].trim(), items: m[2].trim(), details: [] }; inclCats.push(currentCat); }
      }
    }
    return { name, pricingLines, inclCats, itineraryLines: itineraryLines.filter(l => l.trim()) };
  });
}

const fmtDate = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : null;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────
type Props = {
  request: TripReportData;
  /** Optional label shown above the A4 sheet. Pass false to hide. */
  label?: string | false;
};

export default function TripProposalReport({ request, label }: Props) {
  const options = parseOptions(request.suggestedItineraries || "");
  const permits = (request.requiredPermits || "")
    .split("\n").map(l => l.replace(/^\d+\.\s*/, "").trim()).filter(Boolean);

  const sentDate = request.respondedAt
    ? new Date(request.respondedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Inclusion category → Lucide icon + colour config
  type CatCfg = { Icon: typeof Building2; bg: string; border: string; iconColor: string; labelColor: string };
  const catCfg: Record<string, CatCfg> = {
    accommodation: { Icon: Building2, bg: "#eff6ff", border: "#bfdbfe", iconColor: "#3b82f6",  labelColor: "#1d4ed8" },
    meal:          { Icon: Utensils,  bg: "#fef9c3", border: "#fde047", iconColor: "#ca8a04",  labelColor: "#a16207" },
    food:          { Icon: Utensils,  bg: "#fef9c3", border: "#fde047", iconColor: "#ca8a04",  labelColor: "#a16207" },
    transport:     { Icon: Car,       bg: "#fff7ed", border: "#fed7aa", iconColor: "#f97316",  labelColor: "#c2410c" },
    guide:         { Icon: User,      bg: "#f0fdf4", border: "#bbf7d0", iconColor: "#22c55e",  labelColor: "#15803d" },
    park:          { Icon: MapPin,    bg: "#f0fdfa", border: "#99f6e4", iconColor: "#14b8a6",  labelColor: "#0f766e" },
    permit:        { Icon: FileText,  bg: "#fdf4ff", border: "#e9d5ff", iconColor: "#a855f7",  labelColor: "#7e22ce" },
    activity:      { Icon: Target,    bg: "#fefce8", border: "#fef08a", iconColor: "#eab308",  labelColor: "#a16207" },
    ticket:        { Icon: Ticket,    bg: "#fefce8", border: "#fef08a", iconColor: "#eab308",  labelColor: "#a16207" },
  };
  const fallbackCfg: CatCfg = { Icon: Star, bg: "#f8fafc", border: "#e2e8f0", iconColor: "#94a3b8", labelColor: "#475569" };
  const getCfg = (lbl: string): CatCfg => {
    const key = Object.keys(catCfg).find(k => lbl.toLowerCase().includes(k));
    return key ? catCfg[key] : fallbackCfg;
  };

  return (
    <div className="space-y-3">

      {/* Preview label bar */}
      {label !== false && (
        <div className="flex items-center gap-2 px-1">
          <Eye className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider">
            {label ?? `Trip Planning Report — sent ${sentDate}`}
          </span>
          <span className="ml-auto text-[10px] text-gray-400">A4 Preview</span>
        </div>
      )}

      {/* ════ A4 PAPER ════ */}
      <div
        className="mx-auto bg-white shadow-2xl border border-gray-200 rounded-sm overflow-hidden"
        style={{ maxWidth: 794, minHeight: 400, fontFamily: "'Inter', 'Segoe UI', sans-serif" }}
      >
        {/* ── Company Header — NoLSAF visa card ── */}
        <div
          className="relative overflow-hidden"
          style={{
            background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)",
            minHeight: 110,
            boxShadow: "0 8px 32px -8px rgba(2,102,94,0.45), 0 2px 12px -4px rgba(14,42,122,0.40)",
          }}
        >
          {/* Decorative SVG — arcs + sparkline + NFC */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 794 110" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <circle cx="760" cy="28"  r="160" stroke="white" strokeOpacity="0.07" strokeWidth="1" fill="none" />
            <circle cx="760" cy="28"  r="118" stroke="white" strokeOpacity="0.06" strokeWidth="1" fill="none" />
            <circle cx="725" cy="8"   r="90"  stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
            <circle cx="18"  cy="98"  r="90"  stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
            <polyline points="0,95 80,78 160,86 240,64 320,72 400,52 480,60 560,40 640,50 720,30 794,38" stroke="white" strokeOpacity="0.14" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <polygon  points="0,95 80,78 160,86 240,64 320,72 400,52 480,60 560,40 640,50 720,30 794,38 794,110 0,110" fill="white" fillOpacity="0.025" />
            {([[80,78],[240,64],[400,52],[560,40],[720,30]] as [number,number][]).map(([cx,cy],i) => (
              <circle key={i} cx={cx} cy={cy} r="2.5" fill="white" fillOpacity="0.22" />
            ))}
            <path d="M757 12 Q768 28 757 44" stroke="white" strokeOpacity="0.55" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M750 6  Q767 28 750 50" stroke="white" strokeOpacity="0.30" strokeWidth="2" fill="none" strokeLinecap="round" />
            <path d="M743 0  Q766 28 743 56" stroke="white" strokeOpacity="0.15" strokeWidth="2" fill="none" strokeLinecap="round" />
          </svg>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/35 to-transparent pointer-events-none" />

          <div className="relative px-8 py-5 flex items-center justify-between gap-6">
            {/* Left: logo + brand */}
            <div className="flex items-center gap-4 min-w-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/assets/NoLS2025-04.png" alt="NoLSAF" className="w-14 h-14 object-contain flex-shrink-0 drop-shadow" />
              <div className="min-w-0">
                <p className="text-[10px] font-black text-white/50">NoLSAF</p>
                <div className="text-white font-black text-[17px] tracking-tight leading-tight">NoLS Africa Co Ltd</div>
                <div className="text-[11px] font-bold text-teal-300 mt-0.5 tracking-wide">Quality Stay For Every Wallet</div>
                <div className="text-[10px] text-white/40 mt-0.5">P.O BOX 23091 · Dar es Salaam, Tanzania</div>
              </div>
            </div>

            {/* Center: EMV chip */}
            <svg width="36" height="28" viewBox="0 0 38 30" fill="none" className="opacity-75 flex-shrink-0 hidden sm:block" aria-hidden="true">
              <rect x="1" y="1" width="36" height="28" rx="4" fill="#c8a84b" stroke="#a07830" strokeWidth="0.8" />
              <rect x="1" y="10" width="36" height="10" fill="#b8983a" />
              <rect x="13" y="1" width="12" height="28" fill="#b8983a" />
              <rect x="13" y="10" width="12" height="10" fill="#a07830" />
              <rect x="1"  y="10" width="36" height="0.8" fill="#8a6820" />
              <rect x="1"  y="19.2" width="36" height="0.8" fill="#8a6820" />
              <rect x="13" y="1" width="0.8" height="28" fill="#8a6820" />
              <rect x="24.2" y="1" width="0.8" height="28" fill="#8a6820" />
            </svg>

            {/* Right: contact + dual circles */}
            <div className="flex items-center gap-5 flex-shrink-0">
              <div className="space-y-1.5 text-right">
                <div className="flex items-center justify-end gap-1.5">
                  <Mail className="w-3 h-3 text-teal-300 flex-shrink-0" />
                  <span className="text-[11px] text-white/75">sales@nolsaf.com</span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <MapPin className="w-3 h-3 text-teal-300 flex-shrink-0" />
                  <span className="text-[11px] text-white/75">Dar es Salaam, Tanzania</span>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                  <Printer className="w-3 h-3 text-teal-300 flex-shrink-0" />
                  <span className="text-[11px] text-white/75">Fax: +255 736 766 726</span>
                </div>
              </div>
              {/* Mastercard-style dual circles */}
              <div className="-space-x-3 flex-shrink-0 hidden sm:flex">
                <div className="w-9 h-9 rounded-full" style={{ background: "radial-gradient(circle at 38% 38%, #2563eb, #0e2a7a)", opacity: 0.9 }} />
                <div className="w-9 h-9 rounded-full" style={{ background: "radial-gradient(circle at 62% 38%, #02665e, #013f3a)", opacity: 0.8 }} />
              </div>
            </div>
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent pointer-events-none" />
        </div>

        {/* ── Report Title Band ── */}
        <div className="px-8 py-5 border-b border-gray-100 bg-gradient-to-r from-blue-50/60 to-teal-50/40">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-teal-600 mb-1">Official Trip Planning Feedback Report</div>
              <h1 className="text-xl font-black text-gray-900 leading-tight">Dear {request.customer.name},</h1>
              <p className="text-sm text-gray-500 mt-0.5">Prepared exclusively for your upcoming {request.tripType} experience</p>
            </div>
            <div className="flex-shrink-0 text-right space-y-1">
              <div className="text-[10px] text-gray-400 uppercase tracking-wider">Ref No.</div>
              <div className="text-sm font-bold text-indigo-700 font-mono">NLS-{String(request.id).padStart(5, "0")}</div>
              <div className="text-[10px] text-gray-400">{sentDate}</div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-blue-100 flex flex-wrap gap-x-5 gap-y-1">
            {[
              { l: "Email", v: request.customer.email },
              { l: "Phone", v: request.customer.phone || "—" },
              { l: "Role",  v: request.role },
            ].map(c => (
              <div key={c.l} className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{c.l}:</span>
                <span className="text-xs font-semibold text-gray-700">{c.v}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Opening Statement ── */}
        <div className="px-8 py-5 border-b border-gray-100">
          <div className="bg-gradient-to-br from-teal-50 to-blue-50 rounded-xl border border-teal-100 px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-1 h-4 bg-teal-500 rounded-full" />
              <span className="text-[10px] font-black text-teal-700">A Message from NoLSAF</span>
            </div>
            <p className="text-sm text-gray-800 leading-relaxed font-medium">
              Every journey you take is a story waiting to be told. At <strong>NoLSAF</strong>, we don&apos;t just plan trips — we craft experiences that stay with you long after you return home.
            </p>
            <p className="text-sm text-gray-600 leading-relaxed mt-2">
              This proposal was built around <strong>you</strong>. Review it, dream about it — then let&apos;s make it real.
            </p>
          </div>
        </div>

        {/* ── Section 1: Request Summary ── */}
        <div className="px-8 py-6 border-b border-gray-100">
          <div className="flex items-center gap-3 mb-5">
            <div className="flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-black flex-shrink-0" style={{ background: "linear-gradient(135deg,#0e2a7a,#0a5c82)" }}>1</div>
            <span className="text-[11px] font-black text-gray-900 uppercase tracking-[0.18em]">Your Request Summary</span>
            <div className="flex-1 h-px" style={{ background: "linear-gradient(90deg,#0a5c82 0%,transparent 100%)" }} />
          </div>

          {/* Row 1 — Trip Type · Group Size · Budget */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#dbeafe,#eff6ff)" }}>
                <Plane className="w-4 h-4 text-blue-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Trip Type</div>
                <div className="text-[13px] font-black text-gray-900 mt-0.5 leading-tight truncate">{request.tripType}</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#cffafe,#ecfeff)" }}>
                <Users className="w-4 h-4 text-cyan-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Group Size</div>
                <div className="text-[13px] font-black text-gray-900 mt-0.5 leading-tight">
                  {request.groupSize ? `${request.groupSize} ${Number(request.groupSize) === 1 ? "person" : "people"}` : "—"}
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#d1fae5,#ecfdf5)" }}>
                <Target className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Budget</div>
                <div className="text-[13px] font-black text-gray-900 mt-0.5 leading-tight">
                  {request.budget ? `TZS ${Number(request.budget).toLocaleString()}` : "Not specified"}
                </div>
              </div>
            </div>
          </div>

          {/* Row 2 — Transport · Travel Window */}
          <div className={`grid gap-3 mb-3 ${request.dateFrom && request.dateTo ? "grid-cols-2" : "grid-cols-1 max-w-xs"}`}>
            <div className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: request.transportRequired ? "linear-gradient(135deg,#ffedd5,#fff7ed)" : "linear-gradient(135deg,#f3f4f6,#f9fafb)" }}>
                <Car className={`w-4 h-4 ${request.transportRequired ? "text-orange-500" : "text-gray-400"}`} />
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Transport</div>
                <div className={`text-[13px] font-black mt-0.5 leading-tight ${request.transportRequired ? "text-orange-600" : "text-gray-500"}`}>
                  {request.transportRequired ? "Required" : "Not required"}
                </div>
              </div>
            </div>
            {request.dateFrom && request.dateTo && (
              <div className="bg-white rounded-xl border border-gray-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: "linear-gradient(135deg,#ede9fe,#f5f3ff)" }}>
                  <Calendar className="w-4 h-4 text-violet-600" />
                </div>
                <div className="min-w-0">
                  <div className="text-[9px] font-black uppercase tracking-widest text-gray-400">Travel Window</div>
                  <div className="text-[13px] font-black text-gray-900 mt-0.5 leading-tight">
                    {fmtDate(request.dateFrom)} – {fmtDate(request.dateTo)}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Destinations */}
          {request.destinations && (() => {
            const raw = request.destinations;
            const stops: { name: string; nights: string | null }[] = [];
            raw.split(/(?=\d+\))/).forEach(p => {
              const m = p.match(/^\d+\)\s*(.+?)(?:\s*[—–-]+\s*(\d+\s*nights?))?\s*$/i);
              if (m) stops.push({ name: m[1].trim(), nights: m[2] ? m[2].trim() : null });
            });
            const items = stops.length > 0 ? stops : [{ name: raw, nights: null }];
            return (
              <div className="rounded-xl border border-teal-200 overflow-hidden shadow-sm mb-3">
                <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: "linear-gradient(90deg,#0e2a7a,#0a5c82)" }}>
                  <MapPin className="w-3.5 h-3.5 text-teal-300 flex-shrink-0" />
                  <span className="text-[9px] font-black uppercase tracking-widest text-white">Destination{items.length > 1 ? `s · ${items.length} stops` : ""}</span>
                </div>
                <div className="bg-white divide-y divide-teal-50">
                  {items.map((stop, idx) => (
                    <div key={idx} className="flex items-center gap-3 px-4 py-3">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black text-white flex-shrink-0" style={{ background: "linear-gradient(135deg,#0a5c82,#02665e)" }}>
                        {idx + 1}
                      </div>
                      <span className="flex-1 text-[13px] font-bold text-gray-900 leading-snug">{stop.name}</span>
                      {stop.nights && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black text-teal-700 border border-teal-200 bg-teal-50 flex-shrink-0 whitespace-nowrap">
                          <Clock className="w-3 h-3" />{stop.nights}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Client Notes */}
          {request.notes?.trim() && (
            <div className="rounded-xl border border-amber-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2" style={{ background: "linear-gradient(90deg,#f59e0b,#d97706)" }}>
                <Star className="w-3 h-3 text-white flex-shrink-0" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white">Client Notes</span>
              </div>
              <div className="bg-amber-50 px-4 py-3">
                <p className="text-sm text-amber-900 leading-relaxed italic">&ldquo;{request.notes}&rdquo;</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 2: Itinerary Options ── */}
        <div className="px-8 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2 mb-4">
            <div className="flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-black" style={{ background: "linear-gradient(135deg,#0f766e,#0d9488)" }}>2</div>
            <span className="text-sm font-black text-gray-900 uppercase tracking-wide">
              {options.length > 1 ? `Proposed Itinerary Options (${options.length})` : "Proposed Itinerary"}
            </span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          {options.length === 0 && request.suggestedItineraries && (
            <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
              {request.suggestedItineraries}
            </div>
          )}

          <div className="space-y-5">
            {options.map((opt, oi) => (
              <div key={oi} className="rounded-2xl border border-gray-200 overflow-hidden shadow-md">

                {/* Option header */}
                <div className="relative overflow-hidden flex items-center justify-between px-5 py-4" style={{ background: "linear-gradient(135deg,#0e2a7a 0%,#0a5c82 50%,#02665e 100%)" }}>
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 700 60" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                    <circle cx="660" cy="10" r="80" stroke="white" strokeOpacity="0.07" strokeWidth="1" fill="none" />
                    <circle cx="660" cy="10" r="55" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
                    <polyline points="0,50 120,38 240,44 360,28 480,34 600,16 700,22" stroke="white" strokeOpacity="0.10" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
                  </svg>
                  <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                  <div className="relative flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white/15 border border-white/30 flex items-center justify-center text-white font-black text-base flex-shrink-0">
                      {String.fromCharCode(65 + oi)}
                    </div>
                    <div>
                      <div className="text-white font-black text-[15px] leading-tight">{opt.name || `Option ${String.fromCharCode(65 + oi)}`}</div>
                      {options.length > 1 && <div className="text-[9px] text-white/55 font-bold uppercase tracking-[0.2em] mt-0.5">Option {oi + 1} of {options.length}</div>}
                    </div>
                  </div>
                  <div className="relative hidden sm:flex -space-x-3 flex-shrink-0">
                    <div className="w-7 h-7 rounded-full" style={{ background: "radial-gradient(circle at 38% 38%,#2563eb,#0e2a7a)", opacity: 0.85 }} />
                    <div className="w-7 h-7 rounded-full" style={{ background: "radial-gradient(circle at 62% 38%,#02665e,#013f3a)", opacity: 0.75 }} />
                  </div>
                </div>

                <div className="bg-gray-50/60 p-4 space-y-4">

                  {/* Pricing */}
                  {opt.pricingLines.length > 0 && (() => {
                    const rows = opt.pricingLines.map(l => {
                      const ci = l.lastIndexOf(":");
                      const isTotal = /total for group/i.test(l);
                      return { label: ci > -1 ? l.slice(0, ci).trim() : l.trim(), value: ci > -1 ? l.slice(ci + 1).trim() : "", isTotal };
                    });
                    return (
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                          <BarChart3 className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                          <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600">Pricing Breakdown</span>
                        </div>
                        <div className="divide-y divide-gray-50">
                          {rows.map((row, ri) => row.isTotal ? (
                            <div key={ri} className="flex items-center justify-between px-4 py-3" style={{ background: "linear-gradient(90deg,#ecfdf5,#d1fae5)" }}>
                              <span className="flex items-center gap-2 text-[12px] font-black text-emerald-800">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />{row.label}
                              </span>
                              <span className="text-[14px] font-black text-emerald-700 tabular-nums">{row.value}</span>
                            </div>
                          ) : (
                            <div key={ri} className="flex items-center justify-between px-4 py-2.5">
                              <span className="text-[11px] text-gray-500">{row.label}</span>
                              <span className="text-[12px] font-bold text-gray-800 tabular-nums">{row.value}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Inclusions */}
                  {opt.inclCats.length > 0 && (
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                        <Gift className="w-3.5 h-3.5 text-teal-600 flex-shrink-0" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-teal-700">What&apos;s Included</span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-gray-100">
                        {opt.inclCats.map((cat, ci) => {
                          const cfg = getCfg(cat.label);
                          const { Icon: CatIcon } = cfg;
                          const catName = cat.label.replace(/^[\p{Emoji}\s]+/u, "").split(":")[0].trim();
                          const linkedDetail = cat.details.find(d => /linked listings:/i.test(d));
                          const otherDetails = cat.details.filter(d => !/linked listings:/i.test(d));
                          return (
                            <div key={ci} className="bg-white p-3.5 flex items-start gap-3">
                              <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: `linear-gradient(135deg,${cfg.bg},#fff)`, border: `1px solid ${cfg.border}` }}>
                                <CatIcon className="w-4 h-4" style={{ color: cfg.iconColor }} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-[9px] font-black uppercase tracking-widest mb-0.5" style={{ color: cfg.labelColor }}>{catName}</div>
                                <div className="text-[12px] font-bold text-gray-900 leading-snug">{cat.items}</div>
                                {otherDetails.map((d, di) => (
                                  <p key={di} className="text-[10px] text-gray-400 italic mt-0.5 leading-snug">{d}</p>
                                ))}
                                {linkedDetail && (
                                  <div className="mt-1.5 inline-flex items-center gap-1.5 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5">
                                    <span className="text-[9px]">🔗</span>
                                    <span className="text-[10px] font-bold text-teal-700 truncate">{linkedDetail.replace(/linked listings:\s*/i, "")}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Day-by-day timeline */}
                  {opt.itineraryLines.length > 0 && (() => {
                    type DayBlock = { day: string; desc: string; notes: string[] };
                    const days: DayBlock[] = [];
                    opt.itineraryLines.forEach(l => {
                      const m = l.match(/^(Day\s+\d+[:\-\s]?)/i);
                      if (m) { days.push({ day: m[1].trim().replace(/[:–-]+$/, ""), desc: l.replace(m[0], "").trim(), notes: [] }); }
                      else if (days.length > 0) { days[days.length - 1].notes.push(l); }
                      else { days.push({ day: "", desc: l, notes: [] }); }
                    });
                    return (
                      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-100">
                          <Calendar className="w-3.5 h-3.5 text-violet-600 flex-shrink-0" />
                          <span className="text-[9px] font-black uppercase tracking-widest text-violet-700">Day-by-Day Itinerary</span>
                        </div>
                        <div className="px-4 py-3 space-y-0">
                          {days.map((d, di) => (
                            <div key={di} className="flex gap-3 relative">
                              {di < days.length - 1 && (
                                <div className="absolute left-[14px] top-7 bottom-0 w-px bg-gradient-to-b from-indigo-200 to-transparent z-0" />
                              )}
                              <div className="flex-shrink-0 z-10 mt-1">
                                {d.day ? (
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[9px] font-black" style={{ background: "linear-gradient(135deg,#4f46e5,#6366f1)" }}>
                                    {d.day.replace(/Day\s*/i, "").trim() || (di + 1)}
                                  </div>
                                ) : (
                                  <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#f3f4f6" }}>
                                    <span className="text-gray-400 text-[10px]">↳</span>
                                  </div>
                                )}
                              </div>
                              <div className="flex-1 pb-3.5">
                                {d.day && <div className="text-[9px] font-black uppercase tracking-widest text-indigo-500 mb-0.5">{d.day}</div>}
                                <p className="text-[12px] font-semibold text-gray-800 leading-snug">{d.desc}</p>
                                {d.notes.map((n, ni) => (
                                  <p key={ni} className="text-[10px] text-gray-400 italic mt-0.5 leading-snug">{n}</p>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Section 3: Permits ── */}
        {permits.length > 0 && (
          <div className="px-8 py-5 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-black" style={{ background: "linear-gradient(135deg,#d97706,#f59e0b)" }}>3</div>
              <span className="text-sm font-black text-gray-900 uppercase tracking-wide">Required Permits &amp; Documents</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {permits.map((p, i) => (
                <div key={i} className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-amber-200 text-amber-800 text-[9px] font-black flex items-center justify-center">{i + 1}</span>
                  <span className="text-xs text-gray-700">{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Section 4: Timeline ── */}
        {request.estimatedTimeline && (
          <div className="px-8 py-5 border-b border-gray-100">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex items-center justify-center w-6 h-6 rounded-full text-white text-[11px] font-black" style={{ background: "linear-gradient(135deg,#0f766e,#14b8a6)" }}>
                {permits.length > 0 ? "4" : "3"}
              </div>
              <span className="text-sm font-black text-gray-900 uppercase tracking-wide">Booking Timeline &amp; Payment Terms</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>
            <div className="bg-teal-50 border border-teal-100 rounded-xl px-4 py-3">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{request.estimatedTimeline}</p>
            </div>
          </div>
        )}

        {/* ── Assigned Agent ── */}
        {request.assignedAgent && (
          <div className="px-8 py-5 border-b border-gray-100">
            <div className="flex items-center gap-3 bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
              <div className="w-9 h-9 rounded-full bg-indigo-200 flex items-center justify-center text-indigo-800 font-black text-sm flex-shrink-0">
                {request.assignedAgent.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-500">Your Dedicated Travel Agent</div>
                <div className="text-sm font-bold text-indigo-900">{request.assignedAgent}</div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="inline-flex items-center gap-1 bg-indigo-50 border border-indigo-200 text-indigo-700 text-[9px] font-black uppercase tracking-widest rounded-full px-2 py-0.5">✦ Top-Rated</span>
                  <span className="text-[10px] text-indigo-500 font-semibold">Ranked by NoLSAF Intelligence Score™</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="relative overflow-hidden px-8 py-4" style={{ background: "linear-gradient(135deg, #0e2a7a 0%, #0a5c82 38%, #02665e 100%)" }}>
          <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent pointer-events-none" />
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40" viewBox="0 0 794 72" fill="none" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
            <polyline points="0,60 160,48 320,52 480,36 640,42 794,28" stroke="white" strokeOpacity="0.10" strokeWidth="1.4" fill="none" strokeLinecap="round" />
            <circle cx="680" cy="15" r="80" stroke="white" strokeOpacity="0.05" strokeWidth="1" fill="none" />
          </svg>
          <div className="relative flex items-center justify-between gap-4">
            <div>
              <div className="text-white font-black text-sm tracking-tight">NoLS Africa Co Ltd</div>
              <div className="text-teal-300 text-[10px] mt-0.5">Authorised Trip Planning Report · Ref NLS-{String(request.id).padStart(5, "0")}</div>
            </div>
            <div className="text-center">
              <span className="text-teal-300/80 text-[10px] italic font-semibold tracking-wide">&ldquo;Quality Stay For Every Wallet&rdquo;</span>
            </div>
            <div className="text-right">
              <div className="text-white/60 text-[10px]">Issued: {sentDate}</div>
              <div className="text-white/35 text-[9px] mt-0.5">Confidential · For named recipient only</div>
            </div>
          </div>
          <div className="relative mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-3 text-[9px] text-white/35">
            <span>sales@nolsaf.com</span>
            <span>Dar es Salaam, Tanzania</span>
            <span>Fax: +255 736 766 726</span>
            <span className="ml-auto">© {new Date().getFullYear()} NoLS Africa Co Ltd · NoLSAF TripEngine™ · Precision-Crafted Travel Technology</span>
          </div>
        </div>

      </div>
    </div>
  );
}