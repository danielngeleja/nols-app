"use client";

import { useParams } from "next/navigation";
import BookingStickerSheet from "@/components/BookingStickerSheet";
import { useOwnerPropertyId } from "@/lib/ownerPropertyRefs";

export default function OwnerPropertyStickerPage() {
  const params = useParams<{ id: string }>();
  // The address bar carries the pp_ reference; an old numeric link is swapped for it.
  const { id, error } = useOwnerPropertyId(params?.id, (ref) => `/owner/properties/${encodeURIComponent(ref)}/sticker`);
  return (
    <div className="w-full min-w-0">
      {error ? (
        <p className="m-0 rounded-lg border border-solid border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>
      ) : (
        <BookingStickerSheet
          endpoint={id ? `/api/owner/properties/${id}/booking-sticker` : null}
          backHref="/owner/properties/approved"
          backLabel="My properties"
        />
      )}
    </div>
  );
}
