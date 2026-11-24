import { redirect } from "next/navigation";

type LegacyDetailProps = {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyLongStayDetailPage({ params, searchParams }: LegacyDetailProps) {
  const [{ ref }, query] = await Promise.all([params, searchParams]);
  const suffix = new URLSearchParams();
  for (const [key, values] of Object.entries(query)) {
    for (const value of Array.isArray(values) ? values : values === undefined ? [] : [values]) {
      suffix.append(key, value);
    }
  }
  redirect(`/account/bookings/long-stays/${encodeURIComponent(ref)}${suffix.size ? `?${suffix}` : ""}`);
}
