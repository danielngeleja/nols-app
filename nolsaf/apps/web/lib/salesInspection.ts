export function salesInspectionPath(ref: string) {
  return `/sales/inspections?inspection=${encodeURIComponent(ref)}`;
}

export function inspectionDate(value: string | null) {
  if (!value) return "";
  return `${new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  })} EAT`;
}
