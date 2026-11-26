"use client";

/**
 * The full lease a tenant would sign for a long-stay listing, while the
 * landlord is still writing it. The server builds the text with the same code
 * as the real lease, with sample names and dates; nothing is saved. Shown as a
 * printable A4 document (print, save as PDF) marked SAMPLE.
 */
import { useEffect, useMemo, useState } from "react";
import apiClient from "@/lib/apiClient";
import DocumentViewer from "@/components/admin/DocumentViewer";
import { useLongStayApiBase } from "@/components/longStay/longStayApiBase";
import { LEASE_PDF_FLOW, leaseDocumentHtml } from "@/lib/leaseDocument";

/** The listing's living rules, in the shape the lease reads them. */
export function leaseRulesPayload(hr: any) {
  if (!hr || typeof hr !== "object") return null;
  const window = (a?: string, b?: string) => (a && b ? `${a} to ${b}` : a || b || "");
  return {
    smokingPolicy: hr.smokingPolicy || "",
    overnightGuests: hr.overnightGuests || "",
    overnightNights: Number(hr.overnightNights) || 7,
    quietHours: window(hr.quietFrom, hr.quietTo),
    other: hr.other || "",
  };
}

/** The listing's living rules as short lines for summaries (the lease words them in full). */
export function livingRuleLines(p: ReturnType<typeof leaseRulesPayload>): string[] {
  if (!p) return [];
  const out: string[] = [];
  if (p.smokingPolicy === "outside") out.push("No smoking inside; outside is fine");
  else if (p.smokingPolicy === "none") out.push("No smoking anywhere");
  else if (p.smokingPolicy === "allowed") out.push("Smoking allowed");
  if (p.overnightGuests === "allowed") out.push("Overnight visitors welcome");
  else if (p.overnightGuests === "limited") out.push(`Overnight visitors up to ${p.overnightNights} nights a month`);
  else if (p.overnightGuests === "none") out.push("No overnight visitors");
  if (p.quietHours) out.push(`Quiet hours ${p.quietHours}`);
  if (p.other.trim()) out.push(p.other.trim());
  return out;
}

export default function LeasePreviewDialog({ open, onClose, terms, houseRules, homeTitle }: {
  open: boolean;
  onClose: () => void;
  terms: unknown;
  houseRules: unknown;
  homeTitle?: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");
  const apiBase = useLongStayApiBase();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setText(null);
    setError("");
    apiClient.post<{ text: string; version: string }>(`${apiBase}/lease-preview`, { terms, houseRules, homeTitle: homeTitle || null })
      .then((r) => { if (active) { setText(r.data.text); setVersion(r.data.version); } })
      .catch((e) => { if (active) setError(e?.response?.data?.error || "Could not build the lease. Finish the monthly terms and try again."); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const html = useMemo(() => (text ? leaseDocumentHtml({ text, version, reference: "SAMPLE", sample: true }) : ""), [text, version]);

  if (!open) return null;

  return (
    <DocumentViewer
      open
      title="The lease your tenant signs"
      subtitle={version ? `Sample · version ${version}` : "Sample built from your terms"}
      html={html}
      loading={!text && !error}
      error={error || null}
      filename="NoLSAF lease sample.pdf"
      pdfFormat="a4"
      pdfFlow={LEASE_PDF_FLOW}
      onClose={onClose}
    />
  );
}
