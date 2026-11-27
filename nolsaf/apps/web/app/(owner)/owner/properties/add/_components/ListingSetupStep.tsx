import type { ReactNode } from "react";
import { BedDouble, Building2, Check, House, Lock, Moon } from "lucide-react";
import { bookingModesForPropertyType, isRoomOnlyPropertyType, type PropertyBookingMode } from "@/lib/propertyBookingMode";
import { AddPropertySection } from "./AddPropertySection";
import { StepFooter } from "./StepFooter";

export function NightlyOffering() {
  return <div className="ap-setup-choice is-selected" aria-label="Nightly stays selected">
    <span className="ap-setup-choice-top"><span className="ap-setup-icon"><Moon aria-hidden /></span><span className="ap-setup-selected"><Check aria-hidden />Selected</span></span>
    <strong>Nightly stays</strong><span className="ap-setup-description">Host guests for a night, a weekend or longer.</span><span className="ap-setup-choice-meta">Priced per night</span>
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
      {isVisible ? <div className="ap-setup">
        <div className="ap-setup-heading">
          <span className="ap-setup-eyebrow">01 / Offering</span>
          <h2>What would you like to offer?</h2>
          <p>Choose how you host. We’ll guide you through the details that fit.</p>
        </div>
        <div className="ap-setup-offerings">
          {rentalModeSlot || <NightlyOffering />}
          {eventModeSlot}
        </div>
        <div className="ap-setup-booking">
          <div className="ap-setup-heading">
            <span className="ap-setup-eyebrow">02 / Booking style</span>
            <h2>What does one booking include?</h2>
            <p>{monthly ? "Monthly tenants rent the whole home." : isRoomOnlyPropertyType(propertyType) ? "This property type uses individually bookable rooms." : "Choose the space each guest reserves."}</p>
          </div>
          {!monthly ? <>
            <div className="ap-setup-booking-options" role="radiogroup" aria-label="What guests book">
              {modes.map((mode) => {
                const { label, detail, Icon } = labels[mode];
                return <button key={mode} type="button" role="radio" aria-checked={bookingMode === mode} disabled={savedCount > 0 && bookingMode !== mode} className={`ap-setup-booking-choice${bookingMode === mode ? " is-selected" : ""}`} onClick={() => onBookingModeChange(mode)}>
                  <Icon className="ap-setup-booking-icon" aria-hidden />
                  <span><strong>{label}</strong><span>{detail}</span></span>
                  <span className="ap-setup-radio" aria-hidden>{bookingMode === mode ? <Check /> : null}</span>
                </button>;
              })}
            </div>
            {savedCount > 0 ? <p className="ap-setup-note"><Lock aria-hidden />Booking style is locked while rooms or units are saved. You can remove them in the next step.</p> : null}
          </> : <div className="ap-setup-monthly"><House aria-hidden /><span><strong>Entire home</strong><span>One tenant, one monthly rental. Add the home’s details next.</span></span><Check aria-hidden /></div>}
        </div>
        <div className="ap-setup-footer">
          <p><Check aria-hidden /><span>{monthly ? "Monthly rental · Entire home" : `Nightly stays · ${labels[bookingMode].label}`}</span></p>
          <StepFooter onPrev={onPrev} onNext={onNext} nextLabel="Continue to property details" />
        </div>
      </div> : null}
    </AddPropertySection>
  );
}
