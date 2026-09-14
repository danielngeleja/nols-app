export function slugifyProfile(name: string) {
  const base = String(name || "operator-profile")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return base || "operator-profile";
}
