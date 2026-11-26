"use client";

import { useEffect } from "react";
import { CONSENT_EVENT, syncFirstTouch } from "@/lib/acquisitionSource";

/**
 * Notes where the visitor first came from, and saves it only with Marketing
 * consent (lib/acquisitionSource.ts). Renders nothing.
 */
export default function AcquisitionTracker() {
  useEffect(() => {
    syncFirstTouch();
    const onConsent = () => syncFirstTouch();
    window.addEventListener(CONSENT_EVENT, onConsent);
    return () => window.removeEventListener(CONSENT_EVENT, onConsent);
  }, []);
  return null;
}
