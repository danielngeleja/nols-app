"use client";

// Preferred URL for newly generated report verification links.
//
// The same view is still served from /verify when a `?t=` or `?token=` query is
// present, because report QR codes already printed on documents point there and
// must keep working. New QR codes should use this path.

import ReportVerificationView from "@/components/verify/ReportVerificationView";

export default function VerifyReportPage() {
  return <ReportVerificationView />;
}
