import { Suspense, type ReactNode } from "react";

export default function LongStayAdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p role="status" className="p-4 text-sm text-slate-600">Loading long stays</p>}>{children}</Suspense>;
}
