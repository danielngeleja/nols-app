/**
 * ISO 3166-1 alpha-2 countries (the 249 assigned codes, plus XK for Kosovo,
 * which issues passports). The list is fixed so the server and the browser
 * agree; names come from the browser's region names after the page mounts.
 * The API holds the same list (apps/api/src/lib/longStay/tenantIdentity.ts).
 */
import { useEffect, useState } from "react";

export const ISO_COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ " +
  "NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW"
).split(" ");

let names: Intl.DisplayNames | null = null;

export function countryName(code: string | null | undefined): string {
  if (!code) return "";
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region", fallback: "code" });
    return names.of(code) || code;
  } catch {
    return code;
  }
}

/** Every country sorted by name, East Africa first. Call in the browser only. */
export function isoCountries(): Array<{ code: string; name: string }> {
  const first = ["TZ", "KE", "UG", "RW", "BI"];
  return ISO_COUNTRY_CODES.map((code) => ({ code, name: countryName(code) })).sort((x, y) => {
    const fx = first.indexOf(x.code);
    const fy = first.indexOf(y.code);
    if (fx !== -1 || fy !== -1) return (fx === -1 ? 99 : fx) - (fy === -1 ? 99 : fy);
    return x.name.localeCompare(y.name);
  });
}

/**
 * The country list, filled after mount. Names differ between Node and
 * browsers, so rendering them on the server breaks hydration.
 */
export function useIsoCountries(): Array<{ code: string; name: string }> {
  const [list, setList] = useState<Array<{ code: string; name: string }>>([]);
  useEffect(() => { setList(isoCountries()); }, []);
  return list;
}

/** National ID cards NoLSAF can check (same rules as the API). */
export const NATIONAL_ID_COUNTRIES: Array<{ code: string; card: string; placeholder: string; hint: string }> = [
  { code: "TZ", card: "NIDA card", placeholder: "19900101-12345-00001-12", hint: "20 digits" },
  { code: "KE", card: "Kenya national ID", placeholder: "12345678", hint: "7 to 9 digits" },
  { code: "UG", card: "Uganda national ID", placeholder: "CM1234567890AB", hint: "14 characters, starts CM or CF" },
  { code: "RW", card: "Rwanda national ID", placeholder: "1199080012345678", hint: "16 digits" },
  { code: "BI", card: "Burundi national ID", placeholder: "As printed", hint: "6 to 20 letters and digits" },
];

export const ID_TYPE_LABEL: Record<string, string> = {
  PASSPORT: "Passport",
  NATIONAL_ID: "National ID",
  RES_PERMIT: "Residence permit",
};

export function idDocumentLabel(idType: string | null | undefined, country: string | null | undefined): string {
  if (idType === "NATIONAL_ID") return NATIONAL_ID_COUNTRIES.find((c) => c.code === country)?.card ?? "National ID";
  return ID_TYPE_LABEL[String(idType)] ?? "ID";
}
