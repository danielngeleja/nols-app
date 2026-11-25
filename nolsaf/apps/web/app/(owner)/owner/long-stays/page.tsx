"use client";

import TenancyList from "@/components/longStay/TenancyList";

export default function OwnerLongStaysPage() {
  return (
    <TenancyList
      side="LANDLORD"
      detailBase="/owner/long-stays"
      intro="Reservations for your long-stay homes, at your listed terms. Confirm or decline each within 24 hours; tenant questions come through NoLSAF."
    />
  );
}
