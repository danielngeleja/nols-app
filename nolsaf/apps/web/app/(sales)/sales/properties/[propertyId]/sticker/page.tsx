"use client";

import { useParams } from "next/navigation";
import SalesShell from "@/components/SalesShell";
import BookingStickerSheet from "@/components/BookingStickerSheet";

export default function SalesPropertyStickerPage() {
  const params = useParams<{ propertyId: string }>();
  // An opaque property reference (pp_…), never a row id.
  const ref = String(params?.propertyId || "");
  const valid = /^pp_[A-Za-z0-9_-]{22}$/.test(ref);
  return (
    <SalesShell>
      {valid ? (
        <BookingStickerSheet
          endpoint={`/api/sales/properties/${ref}/booking-sticker`}
          backHref={`/sales/properties/${ref}`}
          backLabel="Property"
        />
      ) : (
        <p className="m-0 rounded-xl border border-solid border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">Invalid property.</p>
      )}
    </SalesShell>
  );
}
