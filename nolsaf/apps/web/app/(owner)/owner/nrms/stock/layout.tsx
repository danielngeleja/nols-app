// Every Stock page (goods on hand, operations, purchasing, counts, payables,
// insights, items) renders inside this wrapper. The scoped rules below step
// each text size down a notch so these data-heavy screens read denser without
// editing every page. Tune the whole section here in one place.

import type { ReactNode } from "react";

const STOCK_TYPE_SCALE = `
.nrms-stock-scale .text-3xl { font-size: 1.625rem; line-height: 2rem; }
.nrms-stock-scale .text-2xl { font-size: 1.3125rem; line-height: 1.75rem; }
.nrms-stock-scale .text-xl { font-size: 1.125rem; line-height: 1.5rem; }
.nrms-stock-scale .text-lg { font-size: 1.0625rem; line-height: 1.5rem; }
.nrms-stock-scale .text-base { font-size: 0.9375rem; line-height: 1.375rem; }
.nrms-stock-scale .text-\\[15px\\] { font-size: 14px; }
.nrms-stock-scale .text-sm { font-size: 0.8125rem; line-height: 1.25rem; }
.nrms-stock-scale .text-\\[13px\\] { font-size: 12.5px; }
.nrms-stock-scale .text-xs { font-size: 0.71875rem; line-height: 1rem; }
.nrms-stock-scale .text-\\[11px\\] { font-size: 10.5px; }
`;

export default function StockLayout({ children }: { children: ReactNode }) {
  return (
    <div className="nrms-stock-scale">
      <style>{STOCK_TYPE_SCALE}</style>
      {children}
    </div>
  );
}
