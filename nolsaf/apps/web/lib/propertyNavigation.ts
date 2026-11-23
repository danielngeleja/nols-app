const propertiesPath = "/public/properties";
const resultsParam = "returnTo";

type HistoryEntry = { key: string; index: number; url: string | null };
type BrowserNavigation = {
  currentEntry: HistoryEntry | null;
  entries(): HistoryEntry[];
  traverseTo(key: string): { committed: Promise<unknown>; finished: Promise<unknown> };
};

export function propertyDetailHref(slug: string, resultsHref?: string) {
  const path = `${propertiesPath}/${slug}`;
  return resultsHref ? `${path}?${new URLSearchParams({ [resultsParam]: resultsHref })}` : path;
}

export function propertyShareFallbackUrl(href: string) {
  const url = new URL(href);
  if (!url.searchParams.has(resultsParam)) return href;
  url.searchParams.delete(resultsParam);
  return url.href;
}

function previousPage(href: string | null, current: URL) {
  if (!href) return null;
  const url = new URL(href, current);
  if (url.origin !== current.origin || url.pathname.startsWith("//")) return null;
  if (url.pathname.replace(/\/$/, "") === current.pathname.replace(/\/$/, "")) return null;
  return url;
}

export function goBackFromProperty(replace: (href: string) => void) {
  const current = new URL(window.location.href);
  const results = new URL(propertiesPath, current);
  const returnTo = current.searchParams.get(resultsParam);
  // Only the browse route can supply a return URL.
  if (returnTo?.startsWith(`${propertiesPath}?`)) {
    results.search = returnTo.slice(propertiesPath.length);
  }
  const fallback = () => replace(results.pathname + results.search);

  const navigation = (window as Window & { navigation?: BrowserNavigation }).navigation;
  const entry = navigation?.currentEntry;
  if (navigation && entry && entry.index >= 0) {
    // Section links create history entries too. Skip entries for this listing.
    const previous = navigation.entries().slice(0, entry.index).reverse()
      .find(({ url }) => previousPage(url, current));
    if (previous) {
      const traversal = navigation.traverseTo(previous.key);
      void traversal.finished.catch(() => {});
      void traversal.committed.catch(() => {
        if (window.location.href === current.href) fallback();
      });
      return;
    }
  } else if (returnTo === null) {
    const referrer = previousPage(document.referrer, current);
    if (referrer) {
      replace(referrer.pathname + referrer.search + referrer.hash);
      return;
    }
  }

  fallback();
}
