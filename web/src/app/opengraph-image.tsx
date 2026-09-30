import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The share card for every page (SEC-25). Same ground, orange and faces as
// the app. Fonts are static cuts committed in web/assets/og (both SIL OFL),
// because the image renderer cannot read variable fonts.
export const alt = "Sectionary: every storefront, cut into blocks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const fonts = Promise.all([
  readFile(join(process.cwd(), "assets/og/bricolage-grotesque-600.ttf")),
  readFile(join(process.cwd(), "assets/og/geist-mono-400.ttf")),
]);

const INK = "#110f0e";
const SURFACE = "#1a1816";
const ORANGE = "#faa038";
const MUTED = "#a39d96";

// A page pulled apart at its seams, echoing the mark: [height, label, highlighted].
const PAGE: [number, string, boolean][] = [
  [36, "header", false],
  [150, "hero", false],
  [112, "buy box", true],
  [70, "reviews", false],
  [96, "faq", false],
  [36, "footer", false],
];

export default async function Image() {
  const [bricolage, mono] = await fonts;
  return new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: INK, padding: "64px 72px", color: "#fff" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: 640 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ display: "flex", width: 48, height: 48, borderRadius: 10, background: ORANGE, alignItems: "center", justifyContent: "center" }}>
              <svg viewBox="0 0 16 16" width="28" height="28" fill="#fff">
                <rect x="2" y="2" width="12" height="4.5" rx="1" />
                <rect x="2" y="8.25" width="7.5" height="5.75" rx="1" />
                <rect x="10.75" y="8.25" width="3.25" height="5.75" rx="1" />
              </svg>
            </div>
            <div style={{ fontFamily: "Bricolage", fontSize: 34 }}>Sectionary</div>
          </div>
          <div style={{ display: "flex", fontFamily: "Bricolage", fontSize: 84, lineHeight: 0.98, letterSpacing: "-0.03em" }}>
            Every storefront, cut into blocks.
          </div>
          <div style={{ display: "flex", fontFamily: "Mono", fontSize: 22, color: MUTED }}>
            Real stores / desktop and phone / theme and apps
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginLeft: "auto", width: 330, justifyContent: "center" }}>
          {PAGE.map(([h, label, on]) => (
            <div
              key={label}
              style={{
                display: "flex",
                height: h,
                borderRadius: 8,
                background: on ? ORANGE : SURFACE,
                border: on ? "none" : "1px solid rgba(255,255,255,0.09)",
                padding: "8px 10px",
                fontFamily: "Mono",
                fontSize: 15,
                color: on ? INK : MUTED,
                marginLeft: on ? -28 : 0,
                marginRight: on ? 28 : 0,
              }}
            >
              {label}
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Bricolage", data: bricolage, weight: 600, style: "normal" },
        { name: "Mono", data: mono, weight: 400, style: "normal" },
      ],
    },
  );
}
