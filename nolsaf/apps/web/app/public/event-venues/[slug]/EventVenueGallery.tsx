"use client";

import { useState } from "react";
import { Dialog, DialogPanel, DialogTitle } from "@headlessui/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { PropertyGalleryImage, PropertyPhotoGrid } from "@/components/PropertyPhotoGrid";

const iconButton = "grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-solid border-white/20 bg-white/10 p-0 text-white hover:bg-white/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white";

export default function EventVenueGallery({ photos, title }: { photos: string[]; title: string }) {
  const [active, setActive] = useState<number | null>(null);
  if (!photos.length) return null;

  const move = (offset: number) => setActive(current => current === null ? null : (current + offset + photos.length) % photos.length);

  return (
    <section className="overflow-hidden rounded-2xl" aria-label="Event venue photos">
      <PropertyPhotoGrid photos={photos} total={photos.length} title={title} onOpenPhoto={setActive} onShowAll={() => setActive(0)} />
      <Dialog open={active !== null} onClose={() => setActive(null)} className="relative z-[2147483000]">
        <div className="fixed inset-0 grid place-items-center bg-slate-950/90 p-3 sm:p-6">
          <DialogPanel className="w-full max-w-5xl rounded-2xl bg-slate-950 p-3 text-white sm:p-4"
            onKeyDown={event => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                move(event.key === "ArrowLeft" ? -1 : 1);
              }
            }}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <DialogTitle className="m-0 truncate text-base font-semibold text-white">{title} photos</DialogTitle>
              <button type="button" data-autofocus onClick={() => setActive(null)} className={iconButton} aria-label="Close photos">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            {active !== null && (
              <>
                <div className="relative h-[min(62dvh,42rem)] overflow-hidden rounded-xl bg-slate-900">
                  <PropertyGalleryImage key={active} src={photos[active]} alt={`${title}, event venue photo ${active + 1}`} sizes="(min-width: 1024px) 960px, 100vw" className="object-contain" priority />
                </div>
                {photos.length > 1 && (
                  <div className="mt-3 flex items-center justify-center gap-4">
                    <button type="button" onClick={() => move(-1)} className={iconButton} aria-label="Previous photo"><ChevronLeft className="h-5 w-5" aria-hidden /></button>
                    <p role="status" className="m-0 min-w-16 text-center text-sm tabular-nums text-slate-200">{active + 1} / {photos.length}</p>
                    <button type="button" onClick={() => move(1)} className={iconButton} aria-label="Next photo"><ChevronRight className="h-5 w-5" aria-hidden /></button>
                  </div>
                )}
              </>
            )}
          </DialogPanel>
        </div>
      </Dialog>
    </section>
  );
}
