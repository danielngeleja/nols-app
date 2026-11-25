"use client";

import { Bath, BedDouble, BedSingle, ChevronRight, DoorOpen, House, Users } from "lucide-react";

type Home = {
  roomType: string;
  roomCode?: string;
  roomsCount: number | null;
  bookingMode: "ROOM" | "ENTIRE_UNIT";
  unitStyle: "UNIT" | null;
  bedrooms: Array<{ name: string; bedsSummary: string }>;
  bedsSummary: string;
  bathPrivate?: string;
  description: string;
  amenities: string[];
  bathItems: string[];
};

export function bedroomBedsLabel(summary: string): string {
  if (!summary || summary === "-") return "Beds not listed";
  return summary.split(",").map((part) => {
    const match = part.trim().match(/^(\d+)\s+(Twin|Full|Queen|King)$/i);
    if (!match) return part.trim();
    return `${match[1]} ${match[2].toLowerCase()} ${Number(match[1]) === 1 ? "bed" : "beds"}`;
  }).join(" · ");
}

function publicHomeDescription(description: string) {
  return description
    .replace(/Everything the tenant gets for the whole lease\.\s*Tick only what is really there:\s*NoLSAF checks it on the inspection\./gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[ \t]+|[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function BedroomBeds({ summary }: { summary: string }) {
  const beds = summary.split(",").map((item) => item.trim()).filter((item) => item && item !== "-");
  if (!beds.length) return <p className="m-0 py-1 text-[13px] text-slate-600">Beds not listed</p>;

  return (
    <ul className="m-0 list-none divide-y divide-[#e8eeeb] p-0">
      {beds.map((bed, index) => {
        const match = bed.match(/^(\d+)\s+(Twin|Full|Queen|King)$/i);
        const count = match?.[1];
        const type = match?.[2].toLowerCase();
        const Icon = type === "twin" ? BedSingle : BedDouble;
        return (
          <li key={index} className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 py-1 text-[13px] leading-5 text-slate-700">
            <Icon className="size-[17px] shrink-0 text-[#39796d]" aria-hidden />
            <span className="min-w-0 break-words">{type ? <><span className="capitalize">{type}</span> bed</> : bed}</span>
            {count ? (
              <span className="rounded-sm bg-[#edf5f1] px-1.5 text-xs font-semibold text-[#28645a] tabular-nums">
                <span aria-hidden>×{count}</span>
                <span className="sr-only">Quantity {count}</span>
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function LongStayHomeLayout({ homes, totalBedrooms, totalBathrooms, maxOccupants }: {
  homes: Home[];
  totalBedrooms: number | null;
  totalBathrooms: number | null;
  maxOccupants?: number;
}) {
  if (!homes.length) return null;

  return (
    <section id="roomsSection" aria-labelledby="home-layout-title" className="scroll-mt-24">
      <header className="mb-3 flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[#e4f1ec] text-[#28645a]"><House className="size-5" aria-hidden /></span>
        <h2 id="home-layout-title" className="m-0 text-2xl font-semibold tracking-tight text-slate-950">Home layout</h2>
      </header>
      <div className="space-y-3">
        {homes.map((home, index) => {
          const entireHome = home.bookingMode === "ENTIRE_UNIT" && home.unitStyle !== "UNIT";
          const title = entireHome && !/^entire\b/i.test(home.roomType) ? `Entire ${home.roomType}` : home.roomType;
          const singleHome = homes.length === 1;
          const bedrooms = home.bedrooms.length || (singleHome ? totalBedrooms : null);
          const bathrooms = singleHome ? totalBathrooms : null;
          const bathroomAccess = home.bathPrivate === "yes" ? "Private" : home.bathPrivate === "no" ? "Shared" : "";
          const specs = [
            bedrooms && bedrooms > 0 ? { label: "Bedrooms", value: bedrooms, Icon: BedDouble } : null,
            bathrooms && bathrooms > 0
              ? { label: "Bathrooms", value: bathrooms, detail: bathroomAccess, Icon: Bath }
              : bathroomAccess ? { label: "Bathroom access", value: bathroomAccess, Icon: Bath } : null,
            singleHome && maxOccupants && maxOccupants > 0 ? { label: "Lease occupancy", value: `Up to ${maxOccupants}`, Icon: Users } : null,
          ];
          const description = publicHomeDescription(home.description);
          const bedLayout = home.bedrooms.length > 0;
          const hasBeds = home.bedsSummary && home.bedsSummary !== "-";
          const hasAmenities = home.amenities.length > 0 || home.bathItems.length > 0;

          return (
            <article key={`${home.roomCode ?? home.roomType}-${index}`} className="overflow-hidden rounded-lg border border-solid border-[#d5e5df] bg-white">
              <div className="px-3 py-2.5 sm:px-4 sm:py-3">
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <h3 className="m-0 break-words text-xl font-semibold leading-snug tracking-tight text-slate-950">{title}</h3>
                    {home.unitStyle === "UNIT" && home.roomsCount && home.roomsCount > 1 ? (
                      <p className="m-0 mt-1 text-xs text-slate-600">{home.roomsCount} units with this layout</p>
                    ) : null}
                  </div>
                  {hasAmenities ? (
                    <a
                      href="#property-offers"
                      onClick={() => {
                        const unit = document.getElementById(`offers-unit-${index}`);
                        if (unit instanceof HTMLDetailsElement) unit.open = true;
                      }}
                      className="inline-flex min-h-9 items-center gap-1.5 rounded-md border border-solid border-[#c9ded6] bg-white px-3 text-[13px] font-semibold text-[#28645a] no-underline hover:bg-[#e7f2ed] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#39796d]"
                    >
                      View amenities <ChevronRight className="size-4" aria-hidden />
                    </a>
                  ) : null}
                </div>
                {specs.some(Boolean) ? (
                  <dl className="m-0 mt-2.5 flex flex-wrap gap-x-4 gap-y-2 border-0 border-t border-solid border-[#e5eeea] pt-2.5 sm:gap-x-5">
                    {specs.map((spec) => spec && (
                      <div key={spec.label} className="flex min-w-0 flex-col">
                        <dt className="order-2 mt-1 flex items-center gap-1.5 text-xs text-slate-600">
                          <spec.Icon className="size-3.5 shrink-0 text-[#39796d]" aria-hidden />{spec.label}
                        </dt>
                        <dd className="order-1 m-0 text-base font-semibold leading-none tabular-nums text-slate-950">
                          {spec.value}
                          {spec.detail ? <span className="ml-1 text-xs font-medium text-slate-600"> {spec.detail}</span> : null}
                        </dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
              {bedLayout || hasBeds ? (
                <div className="min-w-0 border-0 border-t border-solid border-[#dce7e3] bg-[#f6f9f7] px-3 py-2.5 sm:px-4 sm:py-3">
                  <h4 className="m-0 mb-2 text-[15px] font-semibold text-slate-950">{bedLayout ? "Bedroom layout" : "Beds in this home"}</h4>
                  {bedLayout ? (
                    <ul className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] items-start gap-2 p-0">
                      {home.bedrooms.map((bedroom, bedroomIndex) => (
                        <li key={bedroomIndex} className="min-w-0 rounded-md border border-solid border-[#d8e7e0] bg-white px-2.5 py-1.5 only:max-w-sm">
                          <div className="flex min-w-0 items-center gap-1.5 border-0 border-b border-solid border-[#e8eeeb] pb-1.5">
                            <span className="grid size-7 shrink-0 place-items-center rounded-sm bg-[#e9f3ee] text-[#28645a]"><DoorOpen className="size-4" aria-hidden /></span>
                            <h5 className="m-0 min-w-0 break-words text-sm font-semibold text-slate-950">{bedroom.name}</h5>
                          </div>
                          <BedroomBeds summary={bedroom.bedsSummary} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="max-w-sm rounded-md border border-solid border-[#d8e7e0] bg-white px-3">
                      <BedroomBeds summary={home.bedsSummary} />
                    </div>
                  )}
                </div>
              ) : null}
              {description ? (
                <div className="border-0 border-t border-solid border-[#dce7e3] px-3 py-2.5 sm:px-4">
                  <p className="m-0 whitespace-pre-line break-words text-sm leading-relaxed text-slate-700">{description}</p>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
