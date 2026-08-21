import type { ReactNode } from "react";
import AgentShell from "@/components/AgentShell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AgentLayout({ children }: { children: ReactNode }) {
  return <AgentShell>{children}</AgentShell>;
}
