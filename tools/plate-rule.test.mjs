#!/usr/bin/env node
/**
 * Plate-rule test — run with `node tools/plate-rule.test.mjs`.
 *
 * Proves the visibility rule the brand system is built on:
 *
 *   dark ink (black, navy, green)  -> light plate
 *   light ink (white, pale grey)   -> dark plate
 *   and whichever plate the logo is on, it must stay legible (>= 3:1)
 *
 * It feeds js/brand.js synthetic pixel buffers, so it covers artwork that does
 * not exist yet — including the mid-tone cases where a naive luminance cutoff
 * would pick a plate the logo disappears into. Expected values here are the same
 * rule `plate_for()` implements in tools/build-brand.py; keep the two in sync.
 *
 * Structural checks for the slots themselves live in tools/check-brand.mjs, and
 * measurement of the shipped files in `python3 tools/build-brand.py --check`.
 */
import { analysePixels, plateForLuminance, MIN_PLATE_CONTRAST } from "../js/brand.js";

let fails = 0;
const ok = (cond, msg) => {
  if (!cond) {
    fails += 1;
    console.error(`  FAIL ${msg}`);
  }
};

/* --------------------------------------------------------------------------
 * 1. the rule itself, on luminance values
 * -------------------------------------------------------------------------- */
const LUM_CASES = [
  [0.0, "light", "black ink on white"],
  [0.013, "light", "brand navy on white"],
  [0.258, "light", "mid green on white (the stated example)"],
  [0.3, "light", "mid teal-green: white still gives exactly 3.0:1, so the stated rule holds"],
  [0.45, "dark", "mid-tone ink: white would only reach 2.1:1, so legibility overrides the cutoff"],
  [0.75, "dark", "yellow ink needs black, not white"],
  [1.0, "dark", "white ink on black"],
];
console.log("plateForLuminance()");
for (const [lum, want, why] of LUM_CASES) {
  const got = plateForLuminance(lum);
  console.log(`  L=${lum.toFixed(3).padStart(5)}  -> ${got.padEnd(5)}  ${why}${got === want ? "" : "   <-- EXPECTED " + want}`);
  ok(got === want, `L=${lum} should choose ${want}, got ${got}`);
  const onLight = (1.05) / (lum + 0.05);
  const onDark = (lum + 0.05) / 0.0712;
  const chosen = got === "light" ? onLight : onDark;
  ok(chosen >= MIN_PLATE_CONTRAST || onLight >= onDark, `L=${lum} lands on ${chosen.toFixed(2)}:1 while the other plate reads better`);
}

/* --------------------------------------------------------------------------
 * 2. ink/background separation, on synthetic images
 * -------------------------------------------------------------------------- */
const synth = (size, fn) => {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = fn(x, y);
      const i = (y * size + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return data;
};

/** ink square on a matte; `matte: null` = transparent artwork (how ours ships) */
const art = (ink, matte, box = [20, 20, 60, 60]) => (x, y) =>
  x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3] ? ink : matte === null ? [0, 0, 0, 0] : matte;

const IMAGE_CASES = [
  ["black ink, transparent matte", art([0, 0, 0, 255], null), "light"],
  ["black ink, white background", art([0, 0, 0, 255], [255, 255, 255, 255]), "light"],
  ["green ink, white background", art([46, 158, 91, 255], [255, 255, 255, 255]), "light"],
  ["green ink, transparent matte", art([46, 158, 91, 255], null), "light"],
  ["white ink, black background", art([255, 255, 255, 255], [0, 0, 0, 255]), "dark"],
  ["pale grey ink, navy background", art([233, 236, 245, 255], [10, 11, 18, 255]), "dark"],
  ["navy ink over a 27% noise wash", art([14, 30, 51, 255], [56, 56, 56, 70]), "light"],
  ["large navy mark on white", art([14, 30, 51, 255], [255, 255, 255, 255], [10, 10, 70, 70]), "light"],
];

console.log("\nanalysePixels() on synthetic artwork (80x80)");
for (const [name, fn, want] of IMAGE_CASES) {
  const got = analysePixels(synth(80, fn), 80, 80);
  if (!got) {
    ok(false, `${name}: no ink detected`);
    continue;
  }
  const chosenPlate = got.contrast[got.plate];
  const legible = chosenPlate >= MIN_PLATE_CONTRAST;
  console.log(
    `  ${name.padEnd(32)} L=${got.inkLum.toFixed(3)} -> ${got.plate.padEnd(5)} ` +
      `${chosenPlate.toFixed(1)}:1${legible ? "" : `  (below ${MIN_PLATE_CONTRAST}:1!)`}`
  );
  ok(got.plate === want, `${name}: expected ${want} plate, got ${got.plate} (L=${got.inkLum.toFixed(3)})`);
  ok(legible, `${name}: ${chosenPlate.toFixed(2)}:1 on the ${got.plate} plate is not clearly visible`);
  // the mark must not be measured as "the whole image" — that means the matte
  // was mistaken for ink and the plate decision would be meaningless
  ok(got.inkCount < 80 * 80 * 0.6, `${name}: ${got.inkCount} ink pixels — the matte was counted as artwork`);
}

/* The mark's own border must never be mistaken for ink. */
const framed = analysePixels(synth(80, art([14, 30, 51, 255], [255, 255, 255, 255])), 80, 80);
ok(framed && framed.background === "#ffffff", `white matte should be reported as the background, got ${framed && framed.background}`);

console.log(fails ? `\n${fails} FAILURE(S)` : "\nplate rule holds: dark ink -> white plate, light ink -> black plate, never below the legibility floor");
process.exit(fails ? 1 : 0);
