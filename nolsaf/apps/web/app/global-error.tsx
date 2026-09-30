"use client";

// Last-resort screen when the app itself fails. It replaces the root layout, so
// the app stylesheet may not be loaded: everything here is styled inline.
//
// Three states, told apart by the ring around the NoLSAF mark (the mark itself
// always stays brand green):
//   blue, dashed   offline. Only when the device truly has no connection: the
//                  browser reports offline, or a no-cache request to this site's
//                  own origin also fails. If the site answers, it is our server.
//   amber, timer   our server. Retries by itself after a countdown.
//   red            still failing after 3 automatic tries in a short window.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { BRAND_MARK_FRAME, BRAND_MARK_LETTER } from "@/components/BrandMark";

const RETRY_SECONDS = 8;
const MAX_TRIES = 3;
// Attempts survive the reload a retry performs, but only within this window,
// so an error days later starts fresh at attempt one.
const TRIES_KEY = "nls-global-error-tries";
const TRIES_WINDOW_MS = 3 * 60_000;

type Tries = { count: number; since: number };

function readTries(): Tries {
  try {
    const raw = JSON.parse(sessionStorage.getItem(TRIES_KEY) || "null") as Tries | null;
    if (raw && Date.now() - raw.since < TRIES_WINDOW_MS) return raw;
  } catch { /* storage blocked: every error is attempt one */ }
  return { count: 0, since: Date.now() };
}
function writeTries(tries: Tries) {
  try { sessionStorage.setItem(TRIES_KEY, JSON.stringify(tries)); } catch { /* ignore */ }
}

/** True only when the device genuinely cannot reach the internet. */
async function reallyOffline(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    // Any HTTP answer, even an error status, proves the device is online; only
    // a network failure rejects. /icon is the app's generated favicon route.
    await fetch(`/icon?online=${Date.now()}`, { method: "HEAD", cache: "no-store", signal: controller.signal });
    clearTimeout(timer);
    return false;
  } catch {
    return true;
  }
}

function eatTime(date: Date) {
  return date.toLocaleTimeString("en-GB", { timeZone: "Africa/Dar_es_Salaam", hour: "2-digit", minute: "2-digit", hour12: false });
}

const GREEN = "#02665e";
const button: CSSProperties = { height: 40, padding: "0 18px", borderRadius: 10, border: "1px solid #d4d4d4", background: "#fff", color: "#171717", fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" };

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [state, setState] = useState<"checking" | "offline" | "retrying" | "down">("checking");
  const [seconds, setSeconds] = useState(RETRY_SECONDS);
  const [failedAt] = useState(() => new Date());

  const retry = useCallback(() => {
    const tries = readTries();
    writeTries({ count: tries.count + 1, since: tries.since });
    // A full reload, not reset(): when the root layout itself failed, a
    // re-render of the same tree usually fails the same way.
    window.location.reload();
  }, []);

  // Decide which state this is.
  useEffect(() => {
    let cancelled = false;
    void reallyOffline().then((offline) => {
      if (cancelled) return;
      if (offline) setState("offline");
      else setState(readTries().count >= MAX_TRIES ? "down" : "retrying");
    });
    return () => { cancelled = true; };
  }, []);

  // Offline: carry on by itself the moment the connection returns.
  useEffect(() => {
    if (state !== "offline") return;
    const back = () => window.location.reload();
    window.addEventListener("online", back);
    const poll = setInterval(() => { void reallyOffline().then((offline) => { if (!offline) back(); }); }, 5000);
    return () => { window.removeEventListener("online", back); clearInterval(poll); };
  }, [state]);

  // Server issue: count down, then retry.
  useEffect(() => {
    if (state !== "retrying") return;
    if (seconds <= 0) { retry(); return; }
    const timer = setTimeout(() => setSeconds((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [state, seconds, retry]);

  const ring = state === "offline" ? "#378ADD" : state === "down" ? "#E24B4A" : "#EF9F27";
  const title = state === "offline" ? "You're offline" : state === "down" ? "Service unavailable" : state === "checking" ? "Checking connection" : "Server not responding";
  const detail = state === "offline"
    ? "Reconnecting automatically"
    : state === "down"
      ? `${error.digest ? `Ref ${error.digest.slice(0, 10)} · ` : ""}${eatTime(failedAt)} EAT`
      : state === "retrying" ? `Retrying in ${seconds}s` : " ";

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#f5f5f5", fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", color: "#171717" }}>
        <style>{`
          @keyframes nls-err-count { from { stroke-dashoffset: 0; } to { stroke-dashoffset: 1; } }
          @keyframes nls-err-spin { to { transform: rotate(360deg); } }
          @media (prefers-reduced-motion: reduce) { .nls-err-anim { animation: none !important; } }
        `}</style>
        <main role="alert" aria-live="assertive" style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, boxSizing: "border-box" }}>
          <section style={{ width: "100%", maxWidth: 380, boxSizing: "border-box", background: "#fff", border: "1px solid #e5e5e5", borderRadius: 20, padding: "40px 24px", textAlign: "center", boxShadow: "0 18px 40px -30px rgba(15,23,42,0.45)" }}>
            <div style={{ position: "relative", width: 76, height: 76, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width={76} height={76} viewBox="0 0 76 76" style={{ position: "absolute", inset: 0 }} aria-hidden>
                {state === "offline" && <circle cx="38" cy="38" r="35" fill="none" stroke={ring} strokeWidth="2.5" strokeDasharray="5 6" className="nls-err-anim" style={{ transformOrigin: "center", animation: "nls-err-spin 12s linear infinite" }} />}
                {(state === "retrying" || state === "checking") && <>
                  <circle cx="38" cy="38" r="35" fill="none" stroke="#e5e5e5" strokeWidth="2.5" />
                  {state === "retrying" && <circle key="count" cx="38" cy="38" r="35" fill="none" stroke={ring} strokeWidth="2.5" strokeLinecap="round" pathLength={1} strokeDasharray="1" transform="rotate(-90 38 38)" className="nls-err-anim" style={{ animation: `nls-err-count ${RETRY_SECONDS}s linear forwards` }} />}
                </>}
                {state === "down" && <circle cx="38" cy="38" r="35" fill="none" stroke={ring} strokeWidth="2.5" />}
              </svg>
              <svg width={34} height={38} viewBox="-10 0 770 870" fill="none" stroke={GREEN} aria-hidden>
                <path d={BRAND_MARK_FRAME} strokeWidth={86} />
                <path d={BRAND_MARK_LETTER} strokeWidth={84} />
              </svg>
            </div>

            <h1 style={{ margin: "22px 0 6px", fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</h1>
            <p style={{ margin: 0, fontSize: 14, color: "#525252", fontVariantNumeric: "tabular-nums" }}>{detail}</p>

            {state === "retrying" && (
              <button type="button" onClick={retry} style={{ ...button, marginTop: 22 }}>Retry now</button>
            )}
            {state === "down" && (
              <div style={{ marginTop: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
                <button type="button" onClick={retry} style={button}>Try again</button>
                <a href="mailto:support@nolsaf.com" style={{ fontSize: 14, color: "#525252", textDecoration: "none" }}>Contact support</a>
              </div>
            )}

            {process.env.NODE_ENV === "development" && error?.message ? (
              <p style={{ margin: "22px 0 0", padding: "8px 10px", borderRadius: 8, background: "#fef2f2", color: "#b91c1c", fontSize: 12, textAlign: "left", wordBreak: "break-word" }}>{error.message}</p>
            ) : null}
          </section>
        </main>
      </body>
    </html>
  );
}
