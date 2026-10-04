"use client";

import Image from "next/image";
import { Bath, BedDouble, Check, Plus, Sofa, X } from "lucide-react";

/** The three shots every room group needs, in the order guests look for them */
const REQUIRED_SHOTS = [
  { label: "The bed", Icon: BedDouble },
  { label: "The room", Icon: Sofa },
  { label: "The bathroom", Icon: Bath },
] as const;

/**
 * Room photos as named slots instead of an empty drop zone: the owner sees
 * exactly which three pictures are expected, and each slot fills in place.
 */
export function RoomPhotoSlots({
  images,
  saved,
  uploading,
  onUpload,
  onRemove,
  inputId = "roomPhotoSlotsInput",
}: {
  images: string[];
  saved?: boolean[];
  uploading?: boolean[];
  onUpload: (files: FileList | null) => void;
  onRemove: (index: number) => void;
  inputId?: string;
}) {
  const count = images.length;
  const min = REQUIRED_SHOTS.length;

  return (
    <div className="min-w-0">
      <div className="ap-label-row">
        <span className="ap-label">
          Room photos <span className="text-red-300">*</span>
        </span>
        <span className="ap-photo-count">
          <span className="ap-photo-meter" aria-hidden>
            {REQUIRED_SHOTS.map((s, i) => (
              <span key={s.label} className={i < count ? "is-done" : ""} />
            ))}
          </span>
          {Math.min(count, min)} of {min}
        </span>
      </div>

      <input
        id={inputId}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        aria-label="Upload room photos"
        onChange={(e) => {
          onUpload(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="ap-photos">
        {images.map((u, i) => (
          <div key={`${u}-${i}`} className="ap-photo">
            {/^https?:\/\//i.test(u) ? (
              <Image src={u} alt={`Room photo ${i + 1}`} fill sizes="(min-width: 1024px) 240px, 33vw" className="object-cover" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={u} alt={`Room photo ${i + 1}`} className="absolute inset-0 h-full w-full object-cover" />
            )}
            {uploading?.[i] ? (
              <span className="ap-photo-busy">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-solid border-white/70 border-t-transparent" />
                Uploading
              </span>
            ) : null}
            <span className="ap-photo-tag">
              {saved?.[i] && !uploading?.[i] ? <Check className="h-3 w-3" aria-hidden /> : null}
              {i < min ? REQUIRED_SHOTS[i].label : `Photo ${i + 1}`}
            </span>
            <button type="button" onClick={() => onRemove(i)} className="ap-photo-remove" aria-label={`Remove photo ${i + 1}`}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}

        {/* Empty required slots; the next one to fill is marked */}
        {REQUIRED_SHOTS.slice(count).map(({ label, Icon }, i) => (
          <label key={label} htmlFor={inputId} className={`ap-photo is-empty${i === 0 ? " is-next" : ""}`}>
            <span className="ap-photo-ico">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-[12.5px] font-semibold text-white">{label}</span>
            <span className="text-[11px] text-white/45">{i === 0 ? "Tap to add" : "Required"}</span>
          </label>
        ))}

        {count >= min ? (
          <label htmlFor={inputId} className="ap-photo is-empty">
            <span className="ap-photo-ico">
              <Plus className="h-4 w-4" />
            </span>
            <span className="text-[12.5px] font-semibold text-white">Add more</span>
            <span className="text-[11px] text-white/45">Optional</span>
          </label>
        ) : null}
      </div>
    </div>
  );
}
