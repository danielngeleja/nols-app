"use client";

import { useState } from "react";
import { Bandage, Beer, Car, CheckCircle2, Coffee, ConciergeBell, Dumbbell, FireExtinguisher, Gamepad2, PartyPopper, Shield, ShieldCheck, ShoppingBag, Store, Tag, Tags, Thermometer, UtensilsCrossed, WashingMachine, Waves, Wifi } from "lucide-react";

const safetyPattern = /security|guard|first aid|fire|extinguisher|smoke|alarm|cctv|emergency|safe\b/i;
const serviceIcons = new Map([
  ["breakfast included", Coffee], ["breakfast available", Coffee],
  ["restaurant", UtensilsCrossed], ["bar", Beer], ["pool", Waves],
  ["sauna", Thermometer], ["laundry", WashingMachine], ["room service", ConciergeBell],
  ["24h security", Shield], ["first aid", Bandage], ["fire extinguisher", FireExtinguisher],
  ["on-site shop", ShoppingBag], ["nearby mall", Store], ["social hall", PartyPopper],
  ["sports & games", Gamepad2], ["gym", Dumbbell], ["free wi-fi", Wifi], ["air conditioning", Thermometer],
]);
const previewLimit = 8;

export default function ShortStayServices({ included, available }: { included: string[]; available: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const safety = available.filter((item) => safetyPattern.test(item));
  const onSite = available.filter((item) => !safetyPattern.test(item));
  const hidden = onSite.length - previewLimit;
  const groups = [
    { title: "Included", Icon: CheckCircle2, color: "bg-emerald-50 text-emerald-700 ring-emerald-200", items: included },
    { title: "On site", Icon: Tags, color: "bg-amber-50 text-amber-800 ring-amber-200", items: expanded ? onSite : onSite.slice(0, previewLimit) },
    { title: "Safety", Icon: ShieldCheck, color: "bg-sky-50 text-sky-800 ring-sky-200", items: safety },
  ];
  if (!included.length && !available.length) return null;

  return (
    <section className="rounded-2xl border border-solid border-slate-200 bg-white px-4 py-3.5 sm:px-5" aria-labelledby="short-stay-services-title">
      <h3 id="short-stay-services-title" className="m-0 text-[15px] font-bold text-slate-900">What this place offers</h3>
      <dl className="m-0 mt-1.5">
        {groups.map(({ title, Icon, color, items }) => items.length ? (
          <div key={title} className="grid items-center gap-x-3 gap-y-1 py-1 sm:grid-cols-[96px_minmax(0,1fr)]">
            <dt>
              <span className={`inline-flex w-fit items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${color}`}>
                <Icon className="size-3" aria-hidden />{title}
              </span>
            </dt>
            <dd className="m-0 flex flex-wrap items-center gap-x-3.5 gap-y-1">
              {items.map((item) => {
                const ItemIcon = /\bparking\b/i.test(item) ? Car : serviceIcons.get(item.toLowerCase()) ?? Tag;
                const isIncluded = title === "Included";
                const shortLabel = item.replace(/\b(free|included|inclusive|complimentary)\b/gi, "").replace(/\s{2,}/g, " ").trim();
                const label = isIncluded && shortLabel ? shortLabel.replace(/^./, (first) => first.toUpperCase()) : item;
                return (
                  <span key={item} title={isIncluded ? item : undefined} className={`inline-flex items-center gap-1.5 text-[12.5px] ${isIncluded ? "font-medium text-slate-800" : "text-slate-700"}`}>
                    <ItemIcon className={`size-4 flex-none ${isIncluded ? "text-emerald-600" : "text-slate-400"}`} aria-hidden />{label}
                  </span>
                );
              })}
              {title === "On site" && hidden > 0 ? (
                <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}
                  className="cursor-pointer border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e]">
                  {expanded ? "Show less" : `+${hidden} more`}
                </button>
              ) : null}
            </dd>
          </div>
        ) : null)}
      </dl>
    </section>
  );
}
