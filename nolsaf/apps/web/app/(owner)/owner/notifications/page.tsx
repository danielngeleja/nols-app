import OwnerInbox from "./OwnerInbox";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <OwnerInbox initialTab={tab === "viewed" ? "viewed" : "unread"} />;
}
