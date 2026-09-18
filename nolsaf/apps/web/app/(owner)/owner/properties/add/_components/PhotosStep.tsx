"use client";

import { useCallback, useRef, useState } from "react";
import { Armchair, Bath, BedDouble, Check, DoorOpen, Home, Plus, Star, Upload, UtensilsCrossed, X } from "lucide-react";
import Image from "next/image";
import { AddPropertySection } from "./AddPropertySection";
import { StepFooter } from "./StepFooter";

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const fileReader = new FileReader();
    fileReader.onload = () => {
      if (typeof fileReader.result === "string") {
        resolve(fileReader.result);
      } else {
        reject(new Error("Failed to convert file to data URL."));
      }
    };
    fileReader.onerror = () => reject(fileReader.error ?? new Error("Failed to read file."));
    fileReader.readAsDataURL(file);
  });

/** The shots a guest expects, in the order they look. The first three are required. */
const SHOTS = [
  { label: "The outside", Icon: Home },
  { label: "Entrance or reception", Icon: DoorOpen },
  { label: "Living area", Icon: Armchair },
  { label: "A bedroom", Icon: BedDouble },
  { label: "A bathroom", Icon: Bath },
  { label: "Dining or kitchen", Icon: UtensilsCrossed },
] as const;

export function PhotosStep({
  isVisible,
  photos,
  photosSaved,
  photosUploading,
  pickPropertyPhotos,
  setPhotos,
  setPhotosSaved,
  setPhotosUploading,
  goToPreviousStep,
  goToNextStep,
  currentStep,
}: {
  isVisible: boolean;
  photos: string[];
  photosSaved: boolean[];
  photosUploading: boolean[];
  pickPropertyPhotos?: (files: FileList | null) => void | Promise<void>;
  setPhotos: React.Dispatch<React.SetStateAction<string[]>>;
  setPhotosSaved: React.Dispatch<React.SetStateAction<boolean[]>>;
  setPhotosUploading: React.Dispatch<React.SetStateAction<boolean[]>>;
  goToPreviousStep: () => void;
  goToNextStep: () => void;
  currentStep: number;
}) {
  const handleSectionRef = useCallback((el: HTMLElement | null) => {
    if (!el) {
      return;
    }
  }, []);

  const [isDragging, setIsDragging] = useState(false);
  const dragDepth = useRef(0);

  const handleUpload = useCallback(
    async (files: FileList | null) => {
      if (!files?.length) {
        return;
      }

      if (pickPropertyPhotos) {
        await pickPropertyPhotos(files);
        return;
      }

      try {
        // Security: Validate file types and sizes
        const validFiles: File[] = [];
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        const ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

        for (const file of Array.from(files)) {
          if (!ALLOWED_TYPES.includes(file.type.toLowerCase())) {
            console.warn(`Skipping invalid file type: ${file.type}`);
            continue;
          }
          if (file.size > MAX_FILE_SIZE) {
            console.warn(`Skipping file too large: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
            continue;
          }
          const sanitizedName = file.name.replace(/[<>:"/\\|?*]/g, "");
          if (sanitizedName !== file.name) {
            console.warn(`File name sanitized: ${file.name} -> ${sanitizedName}`);
          }
          validFiles.push(file);
        }

        if (validFiles.length === 0) {
          return;
        }

        const dataUrls = await Promise.all(validFiles.map(readFileAsDataUrl));
        setPhotos([...photos, ...dataUrls]);
        setPhotosSaved([...photosSaved, ...dataUrls.map(() => false)]);
        setPhotosUploading([...photosUploading, ...dataUrls.map(() => false)]);
      } catch (error) {
        console.error("Failed to process selected photo files.", error);
      }
    },
    [photos, photosSaved, photosUploading, pickPropertyPhotos, setPhotos, setPhotosSaved, setPhotosUploading]
  );

  const removePhoto = (index: number) => {
    setPhotos(photos.filter((_, i) => i !== index));
    setPhotosSaved(photosSaved.filter((_, i) => i !== index));
    setPhotosUploading(photosUploading.filter((_, i) => i !== index));
  };

  /** Moves a photo to the front, where it becomes the cover */
  const makeCover = (index: number) => {
    if (index <= 0 || photosUploading[index]) return;
    const front = <T,>(list: T[]) => [list[index], ...list.filter((_, i) => i !== index)];
    setPhotos(front(photos));
    setPhotosSaved(front(photosSaved));
    setPhotosUploading(front(photosUploading));
  };

  // Drag and drop anywhere on the card. A depth counter keeps child elements from flickering the state.
  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current += 1;
    setIsDragging(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  };
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragDepth.current = 0;
    setIsDragging(false);
    if (e.dataTransfer.files?.length) void handleUpload(e.dataTransfer.files);
  };

  const minRequired = 3;
  const photosCount = photos.length;
  const photosOk = photosCount >= minRequired;
  const photosNeeded = Math.max(0, minRequired - photosCount);
  const anyUploading = photosUploading.some(Boolean);
  const emptySlots = SHOTS.slice(Math.min(photosCount, SHOTS.length));

  const checks = [
    { label: `${minRequired} photos or more`, done: photosOk },
    { label: "A cover photo", done: photosCount >= 1 },
    { label: "5 or more for a full tour", done: photosCount >= 5 },
    { label: "All uploaded", done: photosCount > 0 && !anyUploading },
  ];

  return (
    <AddPropertySection as="section" sectionRef={handleSectionRef} isVisible={isVisible} className="add-property-step-surface">
      {isVisible && (
        <div className="w-full">
          <div className="ap-step-ground">
            <input
              id="propertyPhotosInput"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="sr-only"
              aria-label="Upload property photos"
              onChange={(e) => {
                void handleUpload(e.target.files);
                e.target.value = "";
              }}
            />

            <section
              className={`ap-card${isDragging ? " is-dropping" : ""}`}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              <header className="ap-card-head">
                <span className="ap-card-head-no">1</span>
                <div className="ap-card-head-copy">
                  <h3 className="ap-card-title">Property photos</h3>
                  <p className="ap-card-sub">The first photo is your cover. Drag photos in, or tap a slot.</p>
                </div>
                {photosOk ? (
                  <span className="ap-card-tag">
                    <Check className="h-3.5 w-3.5" aria-hidden />
                    {photosCount} photos
                  </span>
                ) : (
                  <span className="ap-card-tag is-todo">{photosNeeded} more needed</span>
                )}
              </header>

              <div className="ap-split">
                <div className="ap-split-main">
                  <div className="ap-gallery">
                    {photos.map((photo, index) => (
                      <div key={`${photo.slice(-24)}-${index}`} className={`ap-shot${index === 0 ? " is-cover" : ""}`}>
                        {/^https?:\/\//i.test(photo) ? (
                          <Image
                            src={photo}
                            alt={`Property photo ${index + 1}`}
                            fill
                            className="object-cover"
                            sizes={index === 0 ? "(min-width: 1024px) 420px, 66vw" : "(min-width: 1024px) 200px, 33vw"}
                          />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={photo} alt={`Property photo ${index + 1}`} className="absolute inset-0 h-full w-full object-cover" />
                        )}

                        {photosUploading[index] ? (
                          <span className="ap-photo-busy">
                            <span className="h-5 w-5 animate-spin rounded-full border-2 border-solid border-white/70 border-t-transparent" />
                            Uploading
                          </span>
                        ) : null}

                        {index === 0 ? (
                          <span className="ap-shot-cover">
                            <Star className="h-3 w-3" aria-hidden />
                            Cover
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => makeCover(index)}
                            disabled={!!photosUploading[index]}
                            className="ap-shot-make"
                          >
                            <Star className="h-3 w-3" aria-hidden />
                            Make cover
                          </button>
                        )}

                        <span className="ap-shot-no">
                          {photosSaved[index] && !photosUploading[index] ? <Check className="h-3 w-3" aria-hidden /> : null}
                          {index + 1}
                        </span>

                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
                          className="ap-photo-remove"
                          aria-label={`Remove photo ${index + 1}`}
                          title="Remove photo"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}

                    {emptySlots.map(({ label, Icon }, i) => {
                      const position = photosCount + i;
                      const isNext = i === 0;
                      return (
                        <label
                          key={label}
                          htmlFor="propertyPhotosInput"
                          className={`ap-shot is-empty${position === 0 ? " is-cover" : ""}${isNext ? " is-next" : ""}`}
                        >
                          <span className="ap-shot-index">{position === 0 ? "CV" : String(position).padStart(2, "0")}</span>
                          {position < minRequired ? <span className="ap-shot-req" title="Required" aria-label="Required" /> : null}
                          <span className="ap-photo-ico">
                            {isNext ? <Upload className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                          </span>
                          <span className="ap-shot-title">{position === 0 ? "Cover photo" : label}</span>
                          <span className="ap-shot-hint">
                            {position === 0 ? "The outside works best" : isNext ? "Tap or drop" : position < minRequired ? "Required" : "Suggested"}
                          </span>
                        </label>
                      );
                    })}

                    {photosCount >= SHOTS.length ? (
                      <label htmlFor="propertyPhotosInput" className="ap-shot is-empty">
                        <span className="ap-photo-ico">
                          <Plus className="h-4 w-4" />
                        </span>
                        <span className="text-[12.5px] font-semibold text-white">Add more</span>
                        <span className="text-[11px] text-white/45">Tap or drop photos</span>
                      </label>
                    ) : null}
                  </div>

                  {isDragging ? (
                    <div className="ap-drop-veil" aria-hidden>
                      <Upload className="h-6 w-6" />
                      Drop to upload
                    </div>
                  ) : null}
                </div>

                <aside className="ap-split-side">
                  <div>
                    <span className="ap-stat-label">Uploaded</span>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="font-mono text-[30px] font-bold leading-none tabular-nums text-white">{photosCount}</span>
                      <span className="text-[12.5px] text-white/50">of {minRequired} required</span>
                    </div>
                    <span className="ap-photo-meter is-wide mt-2.5" aria-hidden>
                      {Array.from({ length: minRequired }, (_, i) => (
                        <span key={i} className={i < photosCount ? "is-done" : ""} />
                      ))}
                    </span>
                  </div>

                  <ul className="ap-checklist is-stacked">
                    {checks.map((c) => (
                      <li key={c.label} className={c.done ? "is-done" : ""}>
                        <span className="ap-checklist-dot">{c.done ? <Check className="h-3 w-3" /> : null}</span>
                        {c.label}
                      </li>
                    ))}
                  </ul>

                  <ul className="ap-tips">
                    <li>Daylight, with the lights on</li>
                    <li>Landscape, camera held level</li>
                    <li>JPG, PNG or WEBP, up to 10MB each</li>
                  </ul>

                  <label htmlFor="propertyPhotosInput" className="ap-btn is-primary is-block">
                    <Upload className="h-4 w-4" />
                    Add photos
                  </label>
                </aside>
              </div>
            </section>
          </div>
        </div>
      )}

      {isVisible && (
        <StepFooter
          onPrev={goToPreviousStep}
          onNext={goToNextStep}
          prevDisabled={currentStep <= 0}
          nextDisabled={currentStep >= 5}
        />
      )}
    </AddPropertySection>
  );
}
