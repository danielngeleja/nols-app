/* eslint-disable @next/next/no-img-element */
import fs from "node:fs";
import path from "node:path";
import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "NoLSAF traveller app for Android";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function AppOpenGraphImage() {
  const logo = fs.readFileSync(path.join(process.cwd(), "public", "assets", "NoLS2025-04.png")).toString("base64");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#012a26", color: "#ffffff", padding: 72, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 700 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div style={{ display: "flex", width: 84, height: 84, borderRadius: 22, background: "#ffffff", alignItems: "center", justifyContent: "center" }}>
              <img src={`data:image/png;base64,${logo}`} alt="NoLSAF" style={{ width: 64, height: 64, objectFit: "contain" }} />
            </div>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 700 }}>NoLSAF traveller app</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>Tanzania, booked from your pocket.</div>
            <div style={{ display: "flex", marginTop: 24, fontSize: 30, color: "#a4d7d0" }}>Verified stays, trips and your bookings in one app.</div>
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#76c2b7" }}>nolsaf.com/app</div>
        </div>
        <div style={{ display: "flex", flex: 1, alignItems: "center", justifyContent: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", width: 260, height: 486, borderRadius: 44, background: "#0b1f1c", border: "8px solid #1f3b37", padding: 18, gap: 14 }}>
            <div style={{ display: "flex", height: 40, borderRadius: 20, background: "#16302c", alignItems: "center", paddingLeft: 18, fontSize: 18, color: "#a4d7d0" }}>Where to next?</div>
            <div style={{ display: "flex", height: 170, borderRadius: 20, background: "linear-gradient(135deg, #028a7a 0%, #014e47 100%)" }} />
            <div style={{ display: "flex", height: 18, width: 170, borderRadius: 9, background: "#1f3b37" }} />
            <div style={{ display: "flex", height: 18, width: 120, borderRadius: 9, background: "#1f3b37" }} />
            <div style={{ display: "flex", marginTop: "auto", height: 54, borderRadius: 16, background: "#02665e", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 700 }}>Booking confirmed</div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
