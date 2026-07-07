export type Region = { id: string; name: string; districts: string[]; code?: string };
export type District = { name: string; code?: string; wards?: Ward[] };
export type Ward = { name: string; code?: string; postcode?: string; streets?: string[] };

// Type for full region data structure (with wards and streets)
export type RegionFullData = {
  name: string;
  code?: string;
  districts?: District[];
};

const RD: Record<string, string[]> = {
  "ARUSHA": ["ARUSHA CBD","ARUSHA","ARUMERU","MONDULI","LONGIDO","KARATU","NGORONGORO"],
  "DAR-ES-SALAAM": ["ILALA CBD","ILALA","KINONDONI","TEMEKE","UBUNGO","KIGAMBONI"],
  "DODOMA": ["DODOMA","BAHI","CHAMWINO","KONGWA","MPWAPWA","KONDOA","CHEMBA"],
  "GEITA": ["GEITA","NYANG'HWALE","CHATO","MBOGWE","BUKOMBE"],
  "IRINGA": ["IRINGA CBD","IRINGA","KILOLO","MUFINDI"],
  "KAGERA": ["BUKOBA CBD","BUKOBA","MISSENYI","KARAGWE","MULEBA","BIHARAMULO","NGARA","KYERWA"],
  "KATAVI": ["MPANDA -CBD","TANGANYIKA","MLELE"],
  "KIGOMA": ["KIGOMA","KASULU","KIBONDO","BUHIGWE","UVINZA","KAKONKO"],
  "KILIMANJARO": ["MOSHI CBD","MOSHI","HAI","SIHA","MWANGA","SAME","ROMBO"],
  "LINDI": ["LINDI  CBD","LINDI","NACHINGWEA","KILWA","LIWALE","RUANGWA"],
  "MANYARA": ["BABATI CBD","BABATI","HANANG'","MBULU","KITETO","SIMANJIRO"],
  "MARA": ["MUSOMA CBD","BUTIAMA","RORYA","TARIME","BUNDA","SERENGETI"],
  "MBEYA": ["MBEYA CBD","MBEYA","RUNGWE","MBARALI","KYELA","CHUNYA"],
  "MOROGORO": ["MOROGORO","MVOMERO","KILOSA","KILOMBERO","ULANGA","GAIRO","MALINYI"],
  "MTWARA": ["MTWARA CBD","MTWARA","TANDAHIMBA","NEWALA","MASASI","NANYUMBU"],
  "MWANZA": ["NYAMAGANA","ILEMELA","SENGEREMA","MAGU","MISUNGWI","UKEREWE","KWIMBA"],
  "NJOMBE": ["NJOMBE CBD","NJOMBE","LUDEWA","MAKETE"],
  "PWANI": ["KIBAHA CBD","KIBAHA","BAGAMOYO","KISARAWE","MKURANGA","RUFIJI","MAFIA","KIBITI"],
  "RUKWA": ["SUMBAWANGA","NKASI","KALAMBO"],
  "RUVUMA": ["SONGEA CBD","SONGEA","NAMTUMBO","MBINGA","NYASA","TUNDURU"],
  "SHINYANGA": ["SHINYANGA","KAHAMA","KISHAPU"],
  "SIMIYU": ["BARIADI","ITILIMA","MASWA","MEATU","BUSEGA"],
  "SINGIDA": ["SINGIDA CBD","SINGIDA","IRAMBA","MANYONI","MKALAMA","IKUNGI"],
  "SONGWE": ["SONGWE","MBOZI","ILEJE","MOMBA"],
  "TABORA": ["TABORA CBD","UYUI","SIKONGE","NZEGA","URAMBO","IGUNGA","KALIUA"],
  "TANGA": ["TANGA CBD","TANGA","PANGANI","MUHEZA","MKINGA","KOROGWE","LUSHOTO","HANDENI","KILINDI"],
  "MJINI MAGHARIBI": ["MJINI", "MAGHARIBI"],
  "PEMBA KASKAZINI": ["MICHEWENI", "WETE"],
  "PEMBA KUSINI": ["CHAKECHAKE", "MKOANI"],
  "UNGUJA KASKAZINI": ["KASKAZINI A", "KASKAZINI B"],
  "UNGUJA KUSINI": ["KATI", "KUSINI"],
};

const REGION_CODES: Record<string, string> = {
  "ARUSHA": "23",
  "DAR-ES-SALAAM": "11",
  "DODOMA": "41",
  "GEITA": "30",
  "IRINGA": "51",
  "KAGERA": "35",
  "KATAVI": "50",
  "KIGOMA": "47",
  "KILIMANJARO": "25",
  "LINDI": "65",
  "MANYARA": "27",
  "MARA": "31",
  "MBEYA": "53",
  "MOROGORO": "67",
  "MTWARA": "63",
  "MWANZA": "33",
  "NJOMBE": "59",
  "PWANI": "61",
  "RUKWA": "55",
  "RUVUMA": "57",
  "SHINYANGA": "37",
  "SIMIYU": "39",
  "SINGIDA": "43",
  "SONGWE": "54",
  "TABORA": "45",
  "TANGA": "21",
  "MJINI MAGHARIBI": "71",
  "PEMBA KASKAZINI": "75",
  "PEMBA KUSINI": "74",
  "UNGUJA KASKAZINI": "73",
  "UNGUJA KUSINI": "72",
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const REGIONS = Object.entries(RD).map(([name, districts]) => ({
  id: slug(name),
  name,
  districts,
  code: REGION_CODES[name] || undefined,
})) as Region[];

export const REGION_BY_ID: Record<string, Region> =
  Object.fromEntries(REGIONS.map(r => [r.id, r])) as Record<string, Region>;

// Full data structure with wards and streets (for future use)
// This contains complete hierarchical data: regions -> districts -> wards -> streets that can be used for more detailed location selective

// Note: REGIONS_FULL_DATA (with wards and streets) is NOT exported from this file
// To avoid conflicts, import REGIONS_FULL_DATA from the separate file:
// import { REGIONS_FULL_DATA } from '@/lib/tzRegionsFull'
