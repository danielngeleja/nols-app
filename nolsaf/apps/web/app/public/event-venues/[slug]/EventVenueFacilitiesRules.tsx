import { Armchair, BedDouble, CircleAlert, CircleCheck, CookingPot, Droplet, Music2, PartyPopper, SquareParking, Table2, Toilet, Utensils, Wine, Zap, type LucideIcon } from "lucide-react";
import { ALLOWED } from "@/components/events/eventHireTypes";
import { formatClockTime } from "@/lib/propertyUtils";
import type { PublicEventHire } from "@/lib/publicEventVenue";
import styles from "./event-venue-details.module.css";

const ruleIcons: Record<string, LucideIcon> = {
  music: Music2,
  decorations: PartyPopper,
  outsideCatering: Utensils,
  cooking: CookingPot,
  alcohol: Wine,
  overnightGuests: BedDouble,
};

export default function EventVenueFacilitiesRules({ provided, allowed, noiseCutoff, capacitySeated }: Pick<PublicEventHire, "provided" | "allowed" | "noiseCutoff" | "capacitySeated">) {
  const inventory = [
    { label: "Chairs", count: provided.chairs, Icon: Armchair },
    { label: "Tables", count: provided.tables, Icon: Table2 },
    { label: "Parking spaces", count: provided.parkingSpaces, Icon: SquareParking },
    { label: "Toilets", count: provided.toilets, Icon: Toilet },
  ].filter(({ count }) => count != null && count > 0);
  const utilities = [
    { label: "Backup power", available: provided.powerBackup, Icon: Zap },
    { label: "Water", available: provided.water, Icon: Droplet },
  ].filter(({ available }) => available);
  const hasFacilities = inventory.length > 0 || utilities.length > 0;
  const chairsNeeded = provided.chairs && capacitySeated ? Math.max(0, capacitySeated - provided.chairs) : 0;

  const ruleGroups = [
    { title: "Restrictions", rules: ALLOWED.filter(({ key }) => !allowed[key]), Icon: CircleAlert, allowed: false },
    { title: "Allowed", rules: ALLOWED.filter(({ key }) => allowed[key]), Icon: CircleCheck, allowed: true },
  ].filter(({ rules }) => rules.length > 0);

  return (
    <section aria-labelledby="venue-essentials" className="min-w-0 lg:col-span-2">
      <h2 id="venue-essentials" className="m-0 mb-3 text-2xl font-semibold tracking-tight text-slate-900">Before you book</h2>
      <div className={`${styles.facilitiesRules} ${hasFacilities ? styles.facilitiesRulesSplit : ""}`}>
        {hasFacilities && (
          <section aria-labelledby="venue-facilities" className={styles.facilityPanel}>
            <h3 id="venue-facilities">What’s included</h3>
            {inventory.length > 0 && (
              <dl className={styles.facilityInventory}>
                {inventory.map(({ label, count, Icon }) => (
                  <div key={label} className={styles.facilityItem}>
                    <dt><Icon className="h-4 w-4 shrink-0" aria-hidden />{label}</dt>
                    <dd>{count?.toLocaleString("en-TZ")}</dd>
                  </div>
                ))}
              </dl>
            )}
            {utilities.length > 0 && (
              <ul className={styles.facilityUtilities}>
                {utilities.map(({ label, Icon }) => <li key={label}><Icon className="h-4 w-4 shrink-0" aria-hidden />{label}</li>)}
              </ul>
            )}
            {chairsNeeded > 0 && (
              <p className={styles.facilityNote}>
                For {capacitySeated} seated guests, plan for <strong>{chairsNeeded} extra {chairsNeeded === 1 ? "chair" : "chairs"}</strong>.
              </p>
            )}
          </section>
        )}

        <section aria-labelledby="venue-rules" className={styles.rulesPanel}>
          <h3 id="venue-rules">Venue rules</h3>
          <div className={styles.ruleGroups}>
            {ruleGroups.map(group => (
              <section key={group.title} aria-label={group.title} className={styles.ruleGroup} data-allowed={group.allowed}>
                <h4><group.Icon className="h-4 w-4 shrink-0" aria-hidden />{group.title}</h4>
                <ul>
                  {group.rules.map(({ key, label }) => {
                    const Icon = ruleIcons[key] ?? group.Icon;
                    return (
                      <li key={key} className={styles.ruleItem}>
                        <Icon className={styles.ruleIcon} aria-hidden />
                        <div className="min-w-0">
                          <span>{key === "overnightGuests" ? "Overnight stays" : label}</span>
                          {group.allowed && key === "music" && noiseCutoff && (
                            <p>Quiet hours start at <time dateTime={noiseCutoff}>{formatClockTime(noiseCutoff)}</time>.</p>
                          )}
                          {group.allowed && key === "overnightGuests" && <p>Book accommodation separately.</p>}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}
