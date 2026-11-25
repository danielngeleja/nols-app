import type { Metadata } from "next";
import Link from "next/link";
import NotFoundNumerals from "@/components/NotFoundNumerals";

export const metadata: Metadata = {
  title: { absolute: "404" },
  description: "NoLSAF page not found",
};

// Large outline numerals that trace themselves in, one after another, hold,
// then redraw: the same line motion as the NRMS loader. Kept separate from the
// error screens (mark inside a status ring) because a wrong link is not a
// failure. Stay pages have their own key tag version (components/StayNotFound).
export default function NotFoundPage() {
  return (
    <main className="box-border flex min-h-[72vh] items-center justify-center bg-white px-4 py-14 text-neutral-900">
      <section className="flex w-full max-w-md flex-col items-center text-center">
        <NotFoundNumerals />

        <h1 className="mb-0 mt-10 text-2xl font-bold tracking-tight text-neutral-900 sm:text-[28px]">Page not found</h1>
        <p className="mb-0 mt-2.5 text-[15px] leading-6 text-neutral-500">The link may be broken, or the page has moved.</p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="inline-flex h-11 items-center rounded-full bg-[#02665e] px-6 text-sm font-semibold text-white no-underline transition hover:bg-[#02514b]">
            Go to homepage
          </Link>
          <Link href="/public/properties" className="inline-flex h-11 items-center rounded-full border border-solid border-neutral-300 bg-white px-6 text-sm font-semibold text-neutral-800 no-underline transition hover:border-[#02665e] hover:text-[#02665e]">
            Find a stay
          </Link>
        </div>
      </section>
    </main>
  );
}
