import type { ReactNode } from "react";
import PublicHeader from "@/components/PublicHeader";
import PublicFooter from "@/components/PublicFooter";

export default function UpdatesLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <PublicHeader />
      {children}
      <PublicFooter withRail={false} />
    </div>
  );
}
