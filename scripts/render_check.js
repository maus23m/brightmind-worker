// BrightMind V2 — build-time rasterizer check (CR-021a)
// Run: node scripts/render_check.js
// Runs during the Docker build (after npm install + COPY). It initializes the
// WASM rasterizer (@resvg/resvg-wasm) and confirms it can turn a text-bearing SVG
// into a NON-BLANK PNG using the vendored DejaVu fonts. A non-zero exit FAILS the
// Docker build, so a broken rasterizer never deploys (the old revision keeps
// serving) — turning what was a silent production no-op into a loud, pre-deploy
// failure. Mirrors the manual smoke test used when CR-021 was first built.
const fs = require("fs");
const path = require("path");

async function main() {
  const { initWasm, Resvg } = require("@resvg/resvg-wasm");
  const wasm = fs.readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm"));
  await initWasm(wasm);

  const root = path.join(__dirname, "..");
  const fonts = [
    fs.readFileSync(path.join(root, "assets", "DejaVuSans.ttf")),
    fs.readFileSync(path.join(root, "assets", "DejaVuSans-Bold.ttf")),
  ];
  const opts = {
    fitTo: { mode: "width", value: 1200 },
    font: { fontBuffers: fonts, defaultFontFamily: "DejaVu Sans", loadSystemFonts: false },
  };

  const head = '<svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="600" fill="white"/>';
  const blank = head + "</svg>";
  const withText = head + '<text x="400" y="300" font-size="48" text-anchor="middle" fill="black">Label 6 cm</text></svg>';

  const pngBlank = new Resvg(blank, opts).render().asPng();
  const pngText = new Resvg(withText, opts).render().asPng();

  if (!pngText || pngText.length < 100) {
    throw new Error(`rasterizer produced no/empty PNG (${pngText && pngText.length} bytes)`);
  }
  // If glyphs actually rasterized, the text render must differ from a blank-white
  // render of the same canvas. Equality means fonts didn't load → text is invisible.
  if (Buffer.compare(Buffer.from(pngBlank), Buffer.from(pngText)) === 0) {
    throw new Error("text render is identical to blank render — fonts did not rasterize");
  }
  console.log(`[render_check] OK — text PNG ${pngText.length} bytes, differs from blank (${pngBlank.length} bytes)`);
}

main().catch((e) => {
  console.error(`[render_check] FAILED: ${e.message}`);
  process.exit(1);
});
