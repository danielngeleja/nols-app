"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import AdminRecordGate from "@/components/admin/AdminRecordGate";
import DocumentViewer from "@/components/admin/DocumentViewer";

/**
 * Stand-alone receipt or invoice for an owner invoice, addressed by its iv_
 * reference, shown in the shared document viewer.
 */
export default function AdminReceiptPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  return (
    <AdminRecordGate kind="owner-invoice" param={routeParams?.id} backHref="/admin/management/invoices">
      {(invoiceId) => <AdminReceipt invoiceId={invoiceId} />}
    </AdminRecordGate>
  );
}

function AdminReceipt({ invoiceId }: { invoiceId: number }) {
  const router = useRouter();
  const [kind, setKind] = useState<"receipt" | "invoice">("receipt");
  const [html, setHtml] = useState("");
  const [filename, setFilename] = useState("Booking receipt");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHtml("");
    fetch(`/api/admin/revenue/invoices/${invoiceId}/${kind}.html`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const text = await r.text();
        if (!r.ok) throw new Error(`Could not load the ${kind} (${r.status}).`);
        if (cancelled) return;
        setFilename(r.headers.get("x-nolsaf-filename") || (kind === "invoice" ? "Invoice" : "Booking receipt"));
        setHtml(text);
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || `Could not load the ${kind}.`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoiceId, kind]);

  return (
    <DocumentViewer
      open
      title={kind === "invoice" ? "Invoice" : "Booking receipt"}
      subtitle={filename.replace(/\.pdf$/i, "")}
      html={html}
      loading={loading}
      error={error}
      filename={filename}
      tabs={[{ key: "receipt", label: "Receipt" }, { key: "invoice", label: "Invoice" }]}
      activeTab={kind}
      onTabChange={(key) => setKind(key as "receipt" | "invoice")}
      onClose={() => router.push("/admin/management/invoices")}
    />
  );
}
