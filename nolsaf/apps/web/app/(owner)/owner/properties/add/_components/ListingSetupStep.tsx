import type { ReactNode } from "react";
import { ArrowRight, BedDouble, Building2, Check, ChevronLeft, House, Lock, Moon } from "lucide-react";
import { bookingModesForPropertyType, isRoomOnlyPropertyType, type PropertyBookingMode } from "@/lib/propertyBookingMode";
import { AddPropertySection } from "./AddPropertySection";

export function NightlyOffering() {
  return <div className="ap-setup-fixed inline-flex w-fit items-center gap-2.5" aria-label="Nightly stays, priced per night">
    <Moon className="h-4 w-4 shrink-0" aria-hidden /><strong>Nightly stays</strong><span className="ml-1 border-l border-solid border-white/15 pl-2.5">Per night</span>
  </div>;
}

export function ListingSetupStep({ isVisible, sectionRef, rentalModeSlot, eventModeSlot, monthly, propertyType, bookingMode, savedCount, onBookingModeChange, onPrev, onNext }: {
  isVisible: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  rentalModeSlot: ReactNode;
  eventModeSlot?: ReactNode;
  monthly: boolean;
  propertyType: string;
  bookingMode: PropertyBookingMode;
  savedCount: number;
  onBookingModeChange: (mode: PropertyBookingMode) => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const allowed = bookingModesForPropertyType(propertyType);
  const modes = allowed.includes(bookingMode) ? allowed : [...allowed, bookingMode];
  const labels = {
    ENTIRE_UNIT: { label: "Entire place", detail: "One booking reserves the whole home.", Icon: House },
    UNITS: { label: "Separate units", detail: "Each self-contained unit has its own booking.", Icon: Building2 },
    ROOM: { label: "Individual rooms", detail: "Guests choose a room, with its own price.", Icon: BedDouble },
  };
  return (
    <AddPropertySection as="section" sectionRef={sectionRef} isVisible={isVisible} className="add-property-step-surface">
      {isVisible ? <div className="ap-setup ap-setup-classic">
        <div className="ap-setup-row">
          <div className="ap-setup-heading"><h2>Rental mode</h2><p>How guests stay</p></div>
          <div className="ap-setup-control"><div className="ap-setup-offerings">{rentalModeSlot || <NightlyOffering />}</div></div>
        </div>
        <div className="ap-setup-row ap-setup-booking">
          <div className="ap-setup-heading">
            <h2>Booking style</h2><p>What guests reserve</p>
          </div>
          <div className="ap-setup-control">
          {!monthly ? modes.length === 1 ? <div className="ap-setup-fixed inline-flex w-fit items-center gap-2.5"><BedDouble className="h-4 w-4 shrink-0" aria-hidden /><strong>{labels[bookingMode].label}</strong></div> : <>
            <div className="ap-setup-booking-options" role="radiogroup" aria-label="What guests book">
              {modes.map((mode) => {
                const { label, Icon } = labels[mode];
                return <button key={mode} type="button" role="radio" aria-checked={bookingMode === mode} disabled={savedCount > 0 && bookingMode !== mode} className={`ap-setup-booking-choice${bookingMode === mode ? " is-selected" : ""}`} onClick={() => onBookingModeChange(mode)}>
                  <Icon className="ap-setup-booking-icon" aria-hidden />
                  <span><strong>{label}</strong></span>
                  <span className="ap-setup-radio" aria-hidden>{bookingMode === mode ? <Check /> : null}</span>
                </button>;
              })}
            </div>
            <p className="ap-setup-context">{isRoomOnlyPropertyType(propertyType) ? "This property type uses individually bookable rooms." : labels[bookingMode].detail}</p>
            {savedCount > 0 ? <p className="ap-setup-note"><Lock aria-hidden />Booking style is locked while rooms or units are saved. You can remove them in the next step.</p> : null}
          </> : <div className="ap-setup-monthly"><House aria-hidden /><span><strong>Entire home</strong><span>One tenant, one monthly rental. Add the home’s details next.</span></span><Check aria-hidden /></div>}
          </div>
        </div>
        {eventModeSlot}
        <div className="ap-setup-footer">
          <p className="ap-setup-summary"><span className="ap-setup-summary-mark"><Check aria-hidden /></span><span>{monthly ? "Monthly rental · Entire home" : `Nightly stays · ${labels[bookingMode].label}`}</span></p>
          <nav className="ap-setup-navigation" aria-label="Listing setup navigation">
            <button type="button" className="ap-setup-back" onClick={onPrev} aria-label="Back to basic details"><ChevronLeft aria-hidden />Back</button>
            <button type="button" className="ap-setup-next" onClick={onNext} aria-label="Continue to room and bathroom details">Continue<ArrowRight aria-hidden /></button>
          </nav>
        </div>
      </div> : null}
    </AddPropertySection>
  );
}
