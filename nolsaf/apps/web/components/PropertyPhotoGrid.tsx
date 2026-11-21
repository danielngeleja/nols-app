"use client";

/**
 * The property photo gallery, shared by the public property page and the
 * admin review (PropertyPreview), so an admin sees the listing exactly as
 * guests will.
 * Desktop: one large photo with a 2x2 block beside it, all on one grid with
 * even gaps, and a clear "Show all photos" button. Fewer photos fill the
 * same frame without empty placeholders.
 * Phones: a full-width swipe carousel with a "1 / N" counter.
 */
import { useEffect, useState } from "react";
import Image from "next/image";
import { Image as ImageIcon, LayoutGrid } from "lucide-react";
import "@/styles/photo-tour.css";

function isCloudinaryImage(src: string) {
  try {
    return new URL(src).hostname === "res.cloudinary.com";
  } catch {
    return src.includes("res.cloudinary.com");
  }
}

export function cloudinaryPreviewUrl(src: string, sizes: string, className: string) {
  if (!isCloudinaryImage(src)) return src;
  const uploadMarker = "/image/upload/";
  const uploadIndex = src.indexOf(uploadMarker);
  if (uploadIndex === -1) return src;

  const beforeUpload = src.slice(0, uploadIndex + uploadMarker.length);
  const afterUpload = src.slice(uploadIndex + uploadMarker.length);
  const firstSegment = afterUpload.split("/")[0] || "";
  const alreadyTransformed = /^(c_|f_|g_|h_|q_|w_|ar_|e_)/.test(firstSegment) || firstSegment.includes(",");
  if (alreadyTransformed) return src;

  const isThumbnail = sizes.includes("120px") || sizes.includes("260px");
  const isSideGalleryTile = sizes.includes("22vw") || sizes.includes("50vw");
  const isCoverTile = className.includes("object-cover");
  const transform = isThumbnail
    ? "f_auto,q_auto,w_360,c_fill,g_auto"
    : isSideGalleryTile
      ? "f_auto,q_auto,w_600,c_fill,g_auto"
    : isCoverTile
      ? "f_auto,q_auto,w_900,c_fill,g_auto"
      : "f_auto,q_auto,w_1400";

  return `${beforeUpload}${transform}/${afterUpload}`;
}

export function PropertyGalleryImage({
  src,
  alt,
  sizes,
  priority = false,
  className = "object-cover",
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  // Keep a neutral background while the file arrives, but never hide the real
  // image behind a full-load gate. Remote property images load directly so the
  // visitor does not wait for a second server-side optimization request.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [src]);

  if (/^data:image\//i.test(src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} className={`h-full w-full ${className}`} loading={priority ? "eager" : "lazy"} />;
  }

  const imageSrc = cloudinaryPreviewUrl(src, sizes, className);
  const bypassNextOptimizer =
    /^https?:\/\//i.test(src) ||
    src.startsWith("http://localhost") ||
    src.startsWith("http://127.0.0.1");

  return (
    <>
      {!loaded && !failed ? (
        <span aria-hidden className="pv-skeleton absolute inset-0" />
      ) : null}
      {failed ? (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center bg-slate-100 text-slate-400">
          <ImageIcon className="h-6 w-6" />
        </span>
      ) : null}
      {!failed ? (
        <Image
          src={imageSrc}
          alt={alt}
          fill
          className={`${className} opacity-100`}
          sizes={sizes}
          priority={priority}
          unoptimized={bypassNextOptimizer}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </>
  );
}

export function PropertyPhotoGrid({
  photos,
  total,
  title,
  onOpenPhoto,
  onShowAll,
}: {
  photos: string[];
  total: number;
  title: string;
  onOpenPhoto: (index: number) => void;
  onShowAll: () => void;
}) {
  const [slide, setSlide] = useState(0);
  const tiles = photos.slice(1, 5);
  // Where each side tile sits for 1 to 4 side photos, so the frame is always full.
  const tileSpan = (i: number): string => {
    if (tiles.length === 1) return "col-span-2 row-span-2";
    if (tiles.length === 2) return "col-span-2";
    if (tiles.length === 3) return i === 0 ? "col-span-2" : "";
    return "";
  };
  const tileButton =
    "group relative block h-full w-full cursor-pointer overflow-hidden rounded-md border-0 bg-slate-100 p-0 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#02665e]";
  const dim = "pointer-events-none absolute inset-0 bg-black/0 transition-colors duration-200 group-hover:bg-black/10";
  const showAllButton = total > 1 ? (
    <button
      type="button"
      onClick={onShowAll}
      className="absolute bottom-3 right-3 z-[1] inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-solid border-slate-900/10 bg-white px-3 text-[13px] font-semibold text-slate-900 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e]"
    >
      <LayoutGrid className="h-3.5 w-3.5" aria-hidden />
      Show all {total} photos
    </button>
  ) : null;

  return (
    <>
      {/* Desktop and tablet */}
      <div className="relative hidden md:block">
        <div className={`grid h-[clamp(320px,38vw,480px)] gap-2 overflow-hidden rounded-lg ${tiles.length ? "grid-cols-4 grid-rows-2" : "grid-cols-1"}`}>
          <button
            type="button"
            onClick={() => onOpenPhoto(0)}
            aria-label={`Open photo 1 of ${total}`}
            className={`${tileButton} ${tiles.length ? "col-span-2 row-span-2" : ""}`}
          >
            <PropertyGalleryImage src={photos[0]} alt={`${title} photo 1`} sizes="(min-width: 768px) 50vw, 100vw" priority />
            <span className={dim} aria-hidden />
          </button>
          {tiles.map((src, i) => (
            <button
              key={`${i}-${src}`}
              type="button"
              onClick={() => onOpenPhoto(i + 1)}
              aria-label={`Open photo ${i + 2} of ${total}`}
              className={`${tileButton} ${tileSpan(i)}`}
            >
              <PropertyGalleryImage src={src} alt={`${title} photo ${i + 2}`} sizes="(min-width: 768px) 25vw, 50vw" priority={i < 2} />
              <span className={dim} aria-hidden />
            </button>
          ))}
        </div>
        {showAllButton}
      </div>

      {/* Phones: swipe through, tap to open */}
      <div className="relative md:hidden">
        <div
          className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onScroll={(e) => {
            const el = e.currentTarget;
            const next = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
            if (next !== slide) setSlide(next);
          }}
          aria-label="Photos"
        >
          {photos.map((src, i) => (
            <button
              key={`${i}-${src}`}
              type="button"
              onClick={() => onOpenPhoto(i)}
              aria-label={`Open photo ${i + 1} of ${total}`}
              className="relative aspect-[4/3] w-full flex-none cursor-pointer snap-center overflow-hidden border-0 bg-slate-100 p-0"
            >
              <PropertyGalleryImage src={src} alt={`${title} photo ${i + 1}`} sizes="100vw" priority={i === 0} />
            </button>
          ))}
        </div>
        {total > 1 ? (
          <button
            type="button"
            onClick={onShowAll}
            aria-label={`Show all ${total} photos`}
            className="absolute bottom-3 right-3 inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border-0 bg-black/60 px-2.5 text-[12px] font-semibold tabular-nums text-white backdrop-blur-sm"
          >
            <LayoutGrid className="h-3 w-3" aria-hidden />
            {Math.min(slide + 1, photos.length)} / {total}
          </button>
        ) : null}
      </div>
    </>
  );
}
