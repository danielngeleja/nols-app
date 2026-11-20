"use client";
import PropertyListingWizard from "./_components/PropertyListingWizard";

/**
 * The owner's listing wizard. The wizard itself lives in
 * _components/PropertyListingWizard.tsx so the sales partner's assisted
 * listing (/sales/leads/[ref]/listing) runs the very same steps.
 */
export default function AddPropertyPage() {
  return <PropertyListingWizard />;
}
