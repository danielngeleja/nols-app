"use client";

import { LifeBuoy } from "lucide-react";
import SalesShell from "@/components/SalesShell";
import Support from "@/components/Support";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

export default function SalesSupportPage() {
  return (
    <SalesShell>
      <div className="mx-auto w-full max-w-5xl">
        <SalesPageHeader
          icon={LifeBuoy}
          title="Sales support"
          description="Practical guidance for agreements, lead handling, attribution, earnings and payout requests."
        />

        <div className="mt-5">
          <Support
            showHeader={false}
            showError={false}
            showHelpCenter={false}
            compact
            data={{
              helpCenterUrl: "/sales/materials",
              faqs: [
                { q: "How does my agreement become active?", a: "Review and accept the agreement from the Contract page. NoLSAF then countersigns it and activates your Sales workspace.", href: "/sales/contract" },
                { q: "How do I register a new lead?", a: "Open Leads, choose New lead, and enter the property and contact information. The system checks for possible duplicates before protecting the claim.", href: "/sales/leads/new" },
                { q: "When do earnings become available?", a: "Earnings are recorded only after an eligible attribution and transaction are verified. Approved entries appear in Earnings before they become available for payout.", href: "/sales/earnings" },
                { q: "How do I request a payout?", a: "Open Payouts after eligible earnings become available. Confirm the displayed destination before submitting your request.", href: "/sales/payouts" },
                { q: "Where can I find product guidance?", a: "Published guides, policies, and learning materials are available in Learning and materials.", href: "/sales/materials" },
                { q: "What should I do if an attribution is incorrect?", a: "Do not create repeated claims. Contact Sales support with the property name, lead reference, and a short explanation." },
              ],
              contact: {
                name: "NoLSAF Sales Support",
                email: process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@nolsaf.com",
                phone: process.env.NEXT_PUBLIC_SUPPORT_PHONE || "+255 736 766 726",
                whatsapp: "https://wa.me/255736766726",
                hours: "24/7",
              },
            }}
          />
        </div>
      </div>
    </SalesShell>
  );
}
