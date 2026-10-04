"use client";
// v2
import { AlertCircle, CheckCircle2, LocateFixed, LocateOff, MapPin, X } from "lucide-react";
import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

export type PropertyLocationDetectionMeta = {
  source?: "gps" | "pin";
  accuracy?: number | null;
};

type PropertyLocationMapProps = {
  latitude: number;
  longitude: number;
  onLocationDetected?: (lat: number, lng: number, meta?: PropertyLocationDetectionMeta) => void;
  /**
   * Address text (e.g. "Kawe, Kinondoni, Dar es Salaam, Tanzania") used to seed an
   * approximate starting pin via forward geocoding when no coordinates exist yet.
   * The owner then fine-tunes the pin — this is purely a soft starting point.
   */
  addressQuery?: string;
  /** Round number shown on the card header, matching the other cards in the step */
  stepNo?: number;
  /** Removes the saved pin */
  onClear?: () => void;
  /** Extra content rendered at the foot of the card, e.g. manual coordinate entry */
  footer?: ReactNode;
};

const COORD_EPSILON = 0.000001;
const DEFAULT_CENTER = { lat: -6.7924, lng: 39.2083 };

function readImmediateToken(): string {
  if (typeof window === "undefined") return "";
  return (
    (process.env.NEXT_PUBLIC_MAPBOX_TOKEN as string) ||
    (process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN as string) ||
    (window as any).__MAPBOX_TOKEN ||
    ""
  );
}

function coordsEqual(a: { lat: number; lng: number } | null, b: { lat: number; lng: number }): boolean {
  if (!a) return false;
  return Math.abs(a.lat - b.lat) < COORD_EPSILON && Math.abs(a.lng - b.lng) < COORD_EPSILON;
}

function hasValidCoordinates(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export const PropertyLocationMap = memo(function PropertyLocationMap({
  latitude,
  longitude,
  onLocationDetected,
  addressQuery,
  stepNo,
  onClear,
  footer,
}: PropertyLocationMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any | null>(null);
  const onLocationDetectedRef = useRef(onLocationDetected);
  const lastAppliedCenterRef = useRef<{ lat: number; lng: number } | null>(null);
  const lastEmittedCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const initLatRef = useRef(latitude);
  const initLngRef = useRef(longitude);
  // Set true once the owner drags/zooms the map themselves, so a late
  // high-accuracy GPS refinement never clobbers a manually-placed pin.
  const userMovedRef = useRef(false);
  // Guards the forward-geocode seed so it only ever fires once.
  const seededRef = useRef(false);

  const [isDetectingLocation, setIsDetectingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  // "error" = hard/red (blocked, unsupported); "info" = soft/calm (timeout, retry hint).
  const [errorTone, setErrorTone] = useState<"error" | "info">("error");
  const [locationDenied, setLocationDenied] = useState(false);
  const [mapToken, setMapToken] = useState("");
  const [tokenResolved, setTokenResolved] = useState(false);

  // isOpen: whether the map panel is currently visible (toggles freely).
  // hasInitialized: sticky true once opened at least once. The map canvas stays
  // in the DOM after hasInitialized — only CSS display changes. This avoids
  // destroying/recreating the WebGL context on every open/close (the cause of
  // crashes and high CPU drain).
  // Always start closed — the map only opens when the user taps "Open map".
  const [isOpen, setIsOpen] = useState(false);
  const [hasInitialized, setHasInitialized] = useState(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapInitError, setMapInitError] = useState<string | null>(null);
  const [locationDetected, setLocationDetected] = useState<{ accuracy: number | null } | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onLocationDetectedRef.current = onLocationDetected;
  }, [onLocationDetected]);

  const emitLocation = useCallback((lat: number, lng: number, meta?: PropertyLocationDetectionMeta) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const next = {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    };
    if (coordsEqual(lastEmittedCoordsRef.current, next)) return;
    lastEmittedCoordsRef.current = next;
    onLocationDetectedRef.current?.(next.lat, next.lng, meta);
  }, []);

  const requestRuntimeToken = useCallback(() => {
    let disposed = false;
    const controller = new AbortController();

    const immediateToken = readImmediateToken();
    if (immediateToken) {
      setMapToken(immediateToken);
      setTokenResolved(true);
      return () => {
        disposed = true;
        controller.abort();
      };
    }

    setTokenResolved(false);
    fetch("/config/map-token", { cache: "no-store", signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (disposed) return;
        setMapToken(String(data?.token || ""));
      })
      .catch((error) => {
        if (disposed || error?.name === "AbortError") return;
        setMapToken("");
      })
      .finally(() => {
        if (!disposed) setTokenResolved(true);
      });

    return () => {
      disposed = true;
      controller.abort();
    };
  }, []);

  const setNotice = useCallback((text: string | null, tone: "error" | "info" = "error") => {
    setLocationError(text);
    setErrorTone(tone);
  }, []);

  const applyFix = useCallback(
    (lat: number, lng: number, accuracy: number | null, zoom: number) => {
      emitLocation(lat, lng, { source: "gps", accuracy });
      if (mapRef.current) {
        mapRef.current.easeTo({ center: [lng, lat], zoom, duration: 700, essential: true });
      }
      setLocationDetected({ accuracy });
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => setLocationDetected(null), 10000);
    },
    [emitLocation]
  );

  // Phase 2: silently refine the coarse fix with a high-accuracy reading.
  // Never overrides a pin the owner has dragged themselves.
  const refineHighAccuracy = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (userMovedRef.current) return; // owner took over — leave their pin alone
        const acc = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));
        applyFix(lat, lng, acc, 17);
      },
      () => {
        /* refinement failed — the coarse fix already stands, stay quiet */
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }, [applyFix]);

  const detectLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNotice("Geolocation isn't supported here. Use the map below to place the pin manually.", "error");
      return;
    }

    if (locationDenied) {
      setNotice("Location access is blocked. Enable it in your browser settings, then try again, or place the pin on the map yourself.", "error");
      return;
    }

    userMovedRef.current = false;
    setIsDetectingLocation(true);
    setNotice(null);

    // Phase 1: a fast, low-accuracy fix. High accuracy is slow (and on laptops
    // without GPS, usually times out), so we get a quick coarse position first
    // and refine afterwards.
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const acc = Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null;
        const lat = Number(position.coords.latitude.toFixed(6));
        const lng = Number(position.coords.longitude.toFixed(6));

        setLocationDenied(false);
        setIsDetectingLocation(false);
        setNotice(null);
        applyFix(lat, lng, acc, 16);

        // Refine in the background only if the coarse fix is loose.
        if (acc === null || acc > 50) refineHighAccuracy();
      },
      (error) => {
        setIsDetectingLocation(false);

        if (error.code === error.PERMISSION_DENIED) {
          setLocationDenied(true);
          setNotice("Location access was denied. Allow it in your browser site settings, or just place the pin manually on the map below.", "error");
          return;
        }

        // Fail soft: if we already have a coordinate (GPS earlier, an address
        // seed, or a saved draft), don't alarm — nudge them to fine-tune the pin.
        if (hasValidCoordinates(latitude, longitude)) {
          setNotice("Couldn't auto-detect precisely. Open the map and drag the pin to your property entrance.", "info");
          return;
        }

        if (error.code === error.TIMEOUT) {
          setNotice("Detection is taking too long. Place the pin manually on the map below, or tap to retry.", "info");
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setNotice("Your location is currently unavailable. Place the pin manually on the map below.", "info");
        } else {
          setNotice("Couldn't get your location. Place the pin manually on the map below, or tap to retry.", "info");
        }
      },
      {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60000,
      }
    );
  }, [applyFix, latitude, locationDenied, longitude, refineHighAccuracy, setNotice]);

  // Forward-geocode the entered address into an approximate starting pin so a
  // real coordinate always exists even when GPS is unavailable. Fires once and
  // never overrides an existing coordinate.
  const seedFromAddress = useCallback(
    async (query: string, token: string) => {
      if (seededRef.current) return;
      if (!query || !token) return;
      if (hasValidCoordinates(latitude, longitude)) return;
      seededRef.current = true;
      try {
        const url =
          "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
          encodeURIComponent(query) +
          ".json?country=tz&limit=1&access_token=" +
          token;
        const resp = await fetch(url);
        if (!resp.ok) return;
        const data = await resp.json();
        const center = data?.features?.[0]?.center;
        if (!Array.isArray(center) || center.length < 2) return;
        const lng = Number(center[0]);
        const lat = Number(center[1]);
        if (!hasValidCoordinates(lat, lng)) return;
        if (hasValidCoordinates(latitude, longitude)) return; // coords arrived meanwhile
        // Source "pin" + null accuracy => treated as approximate, not a GPS lock.
        emitLocation(Number(lat.toFixed(6)), Number(lng.toFixed(6)), { source: "pin", accuracy: null });
        if (mapRef.current) {
          mapRef.current.easeTo({ center: [lng, lat], zoom: 13, duration: 600, essential: true });
        }
        setNotice("Approximate location set from your address. Open the map to drag the pin onto the exact spot.", "info");
      } catch {
        /* geocoding is best-effort — ignore failures */
      }
    },
    [emitLocation, latitude, longitude, setNotice]
  );

  const openMap = useCallback(() => {
    setHasInitialized(true);
    setIsOpen(true);
  }, []);

  const closeMap = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Preload mapbox-gl in background so the dynamic import is already resolved
  // by the time the user taps "Open map".
  useEffect(() => {
    import("mapbox-gl").catch(() => {});
  }, []);

  // Resolve the map/geocoding token up front so the address seed can run even
  // before the map panel is opened.
  useEffect(() => {
    return requestRuntimeToken();
  }, [requestRuntimeToken]);

  // Seed an approximate pin from the entered address — once, and only if no
  // coordinate exists yet. We deliberately do NOT auto-fire a GPS prompt on
  // mount: that was what produced the unsolicited "timed out" error on laptops.
  useEffect(() => {
    if (!tokenResolved || !mapToken) return;
    if (!addressQuery) return;
    if (hasValidCoordinates(latitude, longitude)) return;
    void seedFromAddress(addressQuery, mapToken);
  }, [addressQuery, latitude, longitude, mapToken, seedFromAddress, tokenResolved]);

  // Map init — runs ONCE when hasInitialized becomes true and token is ready.
  // The map is NEVER removed on close; only the CSS display changes.
  // This is the same pattern used by the driver live map.
  useEffect(() => {
    if (!hasInitialized || !tokenResolved || !mapToken) return;
    if (typeof window === "undefined") return;

    const containerEl = containerRef.current;
    if (!containerEl || mapRef.current) return;

    let disposed = false;
    let map: any = null;
    let handleLoad: (() => void) | null = null;
    let handleMoveEnd: (() => void) | null = null;
    let handleError: ((event: any) => void) | null = null;

    setMapInitError(null);
    setMapReady(false);

    try { containerEl.innerHTML = ""; } catch { /* ignore */ }

    (async () => {
      try {
        const mod = await import("mapbox-gl");
        if (disposed || !containerEl.isConnected) return;

        const mapboxgl = (mod as any).default ?? mod;
        mapboxgl.accessToken = mapToken;

        const initial = hasValidCoordinates(initLatRef.current, initLngRef.current)
          ? { lat: Number(initLatRef.current), lng: Number(initLngRef.current) }
          : DEFAULT_CENTER;

        map = new mapboxgl.Map({
          container: containerEl,
          style: "mapbox://styles/mapbox/streets-v11",
          center: [initial.lng, initial.lat],
          zoom: hasValidCoordinates(initLatRef.current, initLngRef.current) ? 16 : 12,
          attributionControl: false,
          antialias: false,
          fadeDuration: 0,
          maxTileCacheSize: 40,
          trackResize: false,
          preserveDrawingBuffer: false,
          maxCanvasSize: [4096, 4096] as [number, number],
        });

        try {
          map.dragRotate?.disable?.();
          map.touchZoomRotate?.disableRotation?.();
          map.addControl(new mapboxgl.NavigationControl({ showCompass: false, visualizePitch: false }), "top-right");
        } catch { /* ignore */ }

        handleLoad = () => {
          if (disposed) return;
          setMapReady(true);
          setMapInitError(null);
          try { map.resize(); } catch { /* ignore */ }

          if (!hasValidCoordinates(initLatRef.current, initLngRef.current)) {
            if (typeof navigator !== "undefined" && navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  if (disposed || !map) return;
                  const lat = Number(pos.coords.latitude.toFixed(6));
                  const lng = Number(pos.coords.longitude.toFixed(6));
                  map.easeTo({ center: [lng, lat], zoom: 16, duration: 600, essential: true });
                  emitLocation(lat, lng, { source: "gps", accuracy: pos.coords.accuracy });
                },
                () => { emitLocation(initial.lat, initial.lng, { source: "pin" }); },
                { enableHighAccuracy: true, timeout: 6000, maximumAge: 120000 }
              );
            } else {
              emitLocation(initial.lat, initial.lng, { source: "pin" });
            }
          }
        };

        handleMoveEnd = () => {
          if (!map) return;
          const center = map.getCenter();
          emitLocation(center.lat, center.lng, { source: "pin" });
        };

        handleError = (event: any) => {
          if (disposed) return;
          setMapInitError(event?.error?.message || "Unable to initialize the map.");
        };

        const handleUserMove = (event: any) => {
          // originalEvent is present only for user-driven gestures, not easeTo().
          if (event && event.originalEvent) userMovedRef.current = true;
        };

        map.once("render", handleLoad);
        map.on("dragstart", handleUserMove);
        map.on("zoomstart", handleUserMove);
        map.on("moveend", handleMoveEnd);
        map.on("error", handleError);
        mapRef.current = map;
      } catch (error) {
        if (disposed) return;
        setMapInitError(error instanceof Error ? error.message : "Unable to initialize the map.");
        setMapReady(false);
      }
    })();

    // Do NOT call map.remove() here — the map stays alive when the panel closes.
    // Cleanup only on component unmount (see the effect below).
    return () => { disposed = true; };
    // latitude/longitude excluded — initLatRef/initLngRef capture the initial
    // values; subsequent updates use the easeTo effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emitLocation, hasInitialized, mapToken, tokenResolved]);

  // When the panel re-opens, the canvas had display:none — resize restores it.
  useEffect(() => {
    if (!isOpen || !mapReady || !mapRef.current) return;
    const raf = requestAnimationFrame(() => {
      try { mapRef.current?.resize(); } catch { /* ignore */ }
    });
    return () => cancelAnimationFrame(raf);
  }, [isOpen, mapReady]);

  // Sync external coord prop changes to the map center.
  useEffect(() => {
    if (!isOpen || !mapReady || !mapRef.current) return;
    if (!hasValidCoordinates(latitude, longitude)) return;

    const map = mapRef.current;
    const next = { lat: Number(latitude), lng: Number(longitude) };
    const current = map.getCenter();

    if (coordsEqual(lastAppliedCenterRef.current, next)) return;
    if (Math.abs(current.lat - next.lat) < COORD_EPSILON && Math.abs(current.lng - next.lng) < COORD_EPSILON) return;

    lastAppliedCenterRef.current = next;
    map.easeTo({ center: [next.lng, next.lat], duration: 500, essential: true });
  }, [isOpen, latitude, longitude, mapReady]);

  // Window resize -> map resize.
  useEffect(() => {
    if (!isOpen || !mapReady || !mapRef.current) return;

    const map = mapRef.current;
    const handleResize = () => {
      window.requestAnimationFrame(() => {
        try { map.resize(); } catch { /* ignore */ }
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isOpen, mapReady]);

  // Unmount cleanup — the ONLY place map.remove() is called.
  useEffect(() => {
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch { /* ignore */ }
        mapRef.current = null;
      }
    };
  }, []);

  const hasCoords = hasValidCoordinates(latitude, longitude);

  useEffect(() => {
    // Only dismiss hard errors once coords exist. Soft "info" hints (e.g. "drag
    // the pin to the exact spot") stay visible because they apply even with a
    // pin already set.
    if (hasCoords && locationError && errorTone === "error" && !locationDenied) {
      setLocationError(null);
    }
  }, [errorTone, hasCoords, locationDenied, locationError]);

  return (
    <div className={`h-full w-full${isOpen ? " ap-map-open" : ""}`}>
      {/* Closed card, shown when the map panel is not open */}
      {!isOpen && (
        <div className="ap-card ap-card-fill">
          <div className="ap-card-head">
            <span className="ap-card-head-no">
              {isDetectingLocation ? (
                <svg className="h-3.5 w-3.5 animate-spin" style={{ animationDuration: "0.75s" }} viewBox="0 0 48 48" fill="none">
                  <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.3)" strokeWidth="6" />
                  <path d="M24 4 a20 20 0 0 1 20 20" stroke="white" strokeWidth="6" strokeLinecap="round" />
                </svg>
              ) : stepNo ? (
                stepNo
              ) : (
                <LocateFixed className="h-3.5 w-3.5" />
              )}
            </span>

            <div className="ap-card-head-copy">
              <p className="ap-card-title">Exact pin</p>
              <p className="ap-card-sub">Where guests should arrive.</p>
            </div>

            {isDetectingLocation ? (
              <span className="ap-card-tag is-todo">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                Locating
              </span>
            ) : hasCoords ? (
              <span className="ap-card-tag">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Pinned
              </span>
            ) : locationDenied ? (
              <span className="ap-card-tag is-todo">
                <LocateOff className="h-3.5 w-3.5" />
                Blocked
              </span>
            ) : (
              <span className="ap-card-tag is-todo">Required</span>
            )}
          </div>

          <div className="ap-card-body ap-card-body-fill">
            {hasCoords ? (
              <dl className="ap-readout">
                <div>
                  <dt>Latitude</dt>
                  <dd>{Number(latitude).toFixed(6)}</dd>
                </div>
                <div>
                  <dt>Longitude</dt>
                  <dd>{Number(longitude).toFixed(6)}</dd>
                </div>
                <div>
                  <dt>Accuracy</dt>
                  <dd>
                    {locationDetected && locationDetected.accuracy !== null && locationDetected.accuracy !== undefined
                      ? `${Math.round(locationDetected.accuracy)} m`
                      : "By hand"}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="m-0 text-[13px] leading-5 text-white/60">
                Stand at the property and use your location, or drop the pin on the map yourself.
              </p>
            )}

            {locationDetected && locationDetected.accuracy !== null && locationDetected.accuracy !== undefined && locationDetected.accuracy > 100 ? (
              <p className="m-0 flex items-start gap-2 text-[12.5px] leading-5 text-white/80">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-white" />
                <span>
                  <span className="font-semibold text-white">Weak GPS signal.</span> Step outside or adjust the pin on the map.
                </span>
              </p>
            ) : null}

            {/* Soft hints stay visible with a pin, errors only without one */}
            {locationError && (errorTone === "info" || !hasCoords) ? (
              <p className={`m-0 flex items-start gap-2 text-[12.5px] leading-5 ${errorTone === "info" ? "text-white/75" : "text-red-300"}`}>
                {errorTone === "info" ? <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-white/70" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span>{locationError}</span>
              </p>
            ) : null}

            {footer}

            <div className="ap-card-actions">
              <button
                type="button"
                onClick={detectLocation}
                disabled={isDetectingLocation}
                className={`ap-btn${hasCoords || locationDenied ? "" : " is-primary"}`}
              >
                {isDetectingLocation ? (
                  <>
                    <LocateFixed className="h-4 w-4 animate-pulse" /> Locating
                  </>
                ) : locationDenied ? (
                  <>
                    <LocateOff className="h-4 w-4" /> Allow location
                  </>
                ) : hasCoords ? (
                  <>
                    <LocateFixed className="h-4 w-4" /> Re-detect
                  </>
                ) : (
                  <>
                    <LocateFixed className="h-4 w-4" /> Use my location
                  </>
                )}
              </button>

              <button type="button" onClick={openMap} className="ap-btn">
                <MapPin className="h-4 w-4" />
                {hasCoords ? "Adjust pin" : "Pin on map"}
              </button>

              {hasCoords && onClear ? (
                <button type="button" onClick={onClear} className="ap-btn-text">
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Map panel — kept in DOM once hasInitialized (display:none when closed).
          This preserves the WebGL context across open/close cycles. */}
      <div style={{ display: hasInitialized ? (isOpen ? "block" : "none") : "none" }}>
        <div className="ap-card">
          <div className="ap-card-head">
            <span className="ap-card-head-no">{stepNo ?? <MapPin className="h-3.5 w-3.5" />}</span>
            <div className="ap-card-head-copy">
              <p className="ap-card-title">Exact pin</p>
              <p className="ap-card-sub">Move the map until the green dot sits on the entrance, then close.</p>
            </div>
            {hasCoords ? (
              <span className="ap-card-tag">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">
                  {Number(latitude).toFixed(5)}, {Number(longitude).toFixed(5)}
                </span>
              </span>
            ) : (
              <span className="ap-card-tag is-todo">Not pinned</span>
            )}
          </div>

          <div className="relative overflow-hidden">
            <div
              ref={containerRef}
              className="w-full bg-[#151b1e]"
              style={{ height: 380, minHeight: 320, maxHeight: 460 }}
            />

            {/* Blue location indicator at map center */}
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
              <div className="relative flex items-center justify-center">
                <div className="absolute h-12 w-12 rounded-full bg-[#02665e]/25 ring-2 ring-[#02665e]/60" />
                <div className="relative h-4 w-4 rounded-full bg-[#02665e] shadow-md ring-2 ring-white" />
              </div>
            </div>

            {/* GPS detecting overlay */}
            {isDetectingLocation ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 backdrop-blur-[3px]">
                <div className="ap-block flex flex-col items-center gap-3 px-10 py-7">
                  <div className="relative h-12 w-12">
                    <svg className="absolute inset-0 animate-spin" style={{ animationDuration: "0.7s" }} viewBox="0 0 48 48" fill="none">
                      <circle cx="24" cy="24" r="20" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
                      <path d="M24 4 a20 20 0 0 1 20 20" stroke="#02665e" strokeWidth="4" strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <LocateFixed className="h-5 w-5 text-white" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-[13px] font-semibold tracking-tight text-white">Detecting location</p>
                    <p className="mt-0.5 text-[11px] text-white/55">Pinpointing your exact position...</p>
                  </div>
                  <div className="h-0.5 w-24 overflow-hidden rounded-full bg-white/15">
                    <div className="h-full w-8 animate-[shimmer_0.9s_ease-in-out_infinite] rounded-full bg-[#02665e]" />
                  </div>
                </div>
              </div>
            ) : null}

            {/* Controls — top-left */}
            <div className="absolute left-3 top-3 z-10 flex gap-2">
              <button
                type="button"
                onClick={detectLocation}
                disabled={isDetectingLocation}
                title={locationDenied ? "Location blocked, tap for instructions" : "Use my current location"}
                aria-label="Use current location"
                className={[
                  "box-border inline-flex items-center gap-1.5 rounded-lg border-0 py-1.5 pl-2 pr-3 text-[11.5px] font-semibold text-white shadow-md transition disabled:opacity-50",
                  locationDenied ? "bg-[#151b1e]/90 hover:bg-black" : "bg-[#02665e] hover:bg-[#03786f]",
                ].join(" ")}
              >
                {locationDenied
                  ? <LocateOff className="h-3.5 w-3.5 shrink-0" />
                  : <LocateFixed className={`h-3.5 w-3.5 shrink-0 ${isDetectingLocation ? "animate-spin" : ""}`} />}
                {isDetectingLocation ? "Locating..." : locationDenied ? "Enable location" : "My location"}
              </button>
              <button
                type="button"
                onClick={closeMap}
                title="Close map"
                aria-label="Close map"
                className="box-border inline-flex items-center gap-1.5 rounded-lg border border-solid border-white/25 bg-[#151b1e]/90 py-1.5 pl-2 pr-3 text-[11.5px] font-semibold text-white shadow-md transition hover:bg-black"
              >
                <X className="h-3.5 w-3.5 shrink-0" />
                Close
              </button>
            </div>

            {!hasCoords ? (
              <div className="absolute bottom-3 left-3 right-12 z-10">
                <div className="inline-flex items-center gap-2 rounded-lg bg-[#151b1e]/90 py-1.5 pl-2 pr-4 shadow-md">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-white/70" />
                  <span className="text-[11.5px] text-white/80">Drag the map or tap My location</span>
                </div>
              </div>
            ) : null}

            {/* Compact attribution */}
            <div className="group absolute bottom-2 right-2 z-10">
              <button
                type="button"
                aria-label="Map attribution"
                className="flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-[10px] font-bold text-slate-500 shadow-sm ring-1 ring-black/10 backdrop-blur transition hover:bg-white hover:text-slate-800"
              >
                ©
              </button>
              <div className="pointer-events-none absolute bottom-6 right-0 min-w-max rounded-xl border border-slate-200 bg-white px-3 py-2 text-[10px] leading-snug text-slate-600 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100">
                © <a href="https://www.mapbox.com/about/maps/" target="_blank" rel="noreferrer" className="underline hover:text-slate-900">Mapbox</a>
                {" · "}
                © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline hover:text-slate-900">OpenStreetMap</a>
                {" · "}
                <a href="https://www.mapbox.com/map-feedback/" target="_blank" rel="noreferrer" className="underline hover:text-slate-900">Improve this map</a>
              </div>
            </div>

            {/* Thin static loading bar — gone as soon as first frame paints */}
            {!mapReady && !mapInitError ? (
              <div className="pointer-events-none absolute inset-x-0 top-0 z-[11] h-0.5 bg-[#02665e]" />
            ) : null}

            {mapInitError ? (
              <div className="absolute inset-0 z-[11] flex flex-col items-center justify-center gap-2 bg-[#151b1e]/90 px-6 text-center">
                <AlertCircle className="h-6 w-6 text-red-300" />
                <p className="text-xs text-white/75">{mapInitError}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {/* Below-map messages (map panel only) */}
      <div className="mt-2 space-y-1">
        {hasInitialized && tokenResolved && !mapToken ? (
          <div className="flex items-center gap-1 text-xs text-white/70">
            <AlertCircle className="h-3.5 w-3.5" />
            <span>Map token is not configured, so live pinning is unavailable right now.</span>
          </div>
        ) : null}
      </div>
    </div>
  );
});
