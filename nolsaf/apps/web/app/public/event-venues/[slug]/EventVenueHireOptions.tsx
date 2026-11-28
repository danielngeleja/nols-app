import { Clock3, Moon, ShieldCheck, Sun } from "lucide-react";
import { tsh } from "@/components/events/eventHireTypes";
import { eventVenueCheckoutTotal, type PublicEventHire } from "@/lib/publicEventVenue";
import styles from "./event-venue-details.module.css";

const hireOptions = {
  HALF_DAY: { title: "Half day", duration: "Up to 5 hours", Icon: Clock3 },
  FULL_DAY: { title: "Full day", duration: "The whole event window", Icon: Sun },
  EVENING: { title: "Evening", duration: "From 5:00 PM, up to 6 hours", Icon: Moon },
};

export default function EventVenueHireOptions({ packages, cleaningFee }: Pick<PublicEventHire, "packages" | "cleaningFee">) {
  if (packages.length === 0) return null;

  const cleaning = cleaningFee ?? 0;
  return (
    <section aria-labelledby="venue-packages">
      <h2 id="venue-packages" className="m-0 text-2xl font-semibold tracking-tight text-slate-900">Hire options</h2>
      <p className="m-0 mt-1 text-sm leading-5 text-slate-600">Venue hire includes the NoLSAF service fee.</p>

      <ul className={styles.packageList}>
        {packages.map(({ key, clientPrice, deposit }) => {
          const { title, duration, Icon } = hireOptions[key];
          const total = eventVenueCheckoutTotal(clientPrice, cleaning, deposit);

          return (
            <li key={key} className={styles.packageCard}>
              <header className={styles.packageHeading}>
                <span className={styles.packageIcon}><Icon className="h-5 w-5" aria-hidden /></span>
                <div className="min-w-0">
                  <h3 className="m-0 text-base font-semibold leading-5 text-slate-900">{title}</h3>
                  <p className="m-0 mt-0.5 text-sm leading-5 text-slate-600">{duration}</p>
                </div>
              </header>

              <dl className={styles.packageCosts}>
                <div className={styles.packageCost}>
                  <dt>Venue hire</dt>
                  <dd>{tsh(clientPrice)}</dd>
                </div>
                {cleaning > 0 && (
                  <div className={styles.packageCost}>
                    <dt>Cleaning</dt>
                    <dd>{tsh(cleaning)}</dd>
                  </div>
                )}
                <div className={styles.packageCost}>
                  <dt>Refundable deposit</dt>
                  <dd>{deposit == null ? "To confirm" : deposit === 0 ? "None" : tsh(deposit)}</dd>
                </div>
                <div className={styles.packageTotal}>
                  <dt>Total at checkout</dt>
                  <dd>{total == null ? "To confirm" : tsh(total)}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      {packages.some(({ deposit }) => deposit != null && deposit > 0) && (
        <p className="m-0 mt-3 flex items-start gap-2 text-sm leading-5 text-slate-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
          NoLSAF holds the deposit and returns it after the event unless a damage claim is upheld.
        </p>
      )}
    </section>
  );
}
