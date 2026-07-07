import { REGIONS, REGIONS as TZ_REGIONS } from "./tzRegions";
import { REGIONS_FULL_DATA } from "./tzRegionsFull";
import type { Option } from "./options";

export const REGION_OPTIONS: Option[] = TZ_REGIONS.map((r) => ({ value: r.id, label: r.name }));

export function getDistrictsFor(regionId: string): string[] {
  return TZ_REGIONS.find((r) => r.id === regionId)?.districts ?? [];
}

function getFullRegionData(regionId: string) {
  const region = REGIONS.find((r) => r.id === regionId);
  if (!region) return undefined;
  return REGIONS_FULL_DATA.find((r) => r.name === region.name);
}

export function getWardsFor(regionId: string, districtName: string): string[] {
  const fullRegion = getFullRegionData(regionId);
  if (!fullRegion) return [];
  const district = fullRegion.districts?.find((d) => d.name === districtName);
  return (district?.wards ?? []).map((w) => w.name);
}

export function getStreetsFor(regionId: string, districtName: string, wardName: string): string[] {
  const fullRegion = getFullRegionData(regionId);
  if (!fullRegion) return [];
  const district = fullRegion.districts?.find((d) => d.name === districtName);
  if (!district) return [];
  const ward = district.wards?.find((w) => w.name === wardName);
  return ward?.streets ?? [];
}
