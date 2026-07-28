import type { ReactNode } from "react";
import { SalesWorkspaceProvider } from "@/components/sales/SalesWorkspaceContext";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Layout({ children }: { children: ReactNode }) {
  return <SalesWorkspaceProvider>{children}</SalesWorkspaceProvider>;
}
