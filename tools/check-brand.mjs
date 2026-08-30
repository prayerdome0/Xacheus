#!/usr/bin/env node
/**
 * Brand plate guard — run with `node tools/check-brand.mjs`.
 *
 * The rule this repo now follows is: the logo always sits on a plate whose
 * contrast against the logo ink is high, and the plate is decided by measuring
 * the artwork (js/brand.js), not by the theme. These are the cheap structural
 * checks that keep that true:
 *
 *   1. every logo the app renders goes through brandSlotHtml() / .logo-plate,
 *      never a bare <img src="assets/logo…">
 *   2. each slot carries both ink variants, so CSS can pick the legible one
 *      without waiting for a measurement
 *   3. every .logo-plate--* class used in JS exists in styles.css (typo guard)
 *   4. the pre-paint plate script is still in index.html <head>
 *   5. the shell cache list covers every file the brand runtime loads
 *
 * Measurement itself (luminance, contrast, plate choice) is covered by
 * `python3 tools/build-brand.py --check`, which also fails if any artwork drops
 * below WCAG AA on its own plate.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const problems = [];
const note = (msg) => problems.push(msg);

const RUNTIME_JS = [
  "js/app.js",
  "js/auth.js",
  "js/views/components.js",
  "js/views/profile.js",
  "js/views/settings.js",
];

const brand = read("js/brand.js");
const styles = read("styles.css");
const html = read("index.html");
const sw = read("sw.js");

/* 1 + 2 — no bare logo tags in runtime files, and both variants present. */
for (const file of [...RUNTIME_JS, "index.html"]) {
  const src = read(file);
  const bare = src.match(/<img[^>]{0,200}assets\/logo(?:1)?\.png[^>]*>/g) || [];
  for (const tag of bare) note(`${file}: logo rendered outside a plate — ${tag.trim().slice(0, 70)}`);
  for (const tag of src.match(/<img[^>]{0,220}assets\/logo-wordmark[^>]*>/g) || []) {
    if (!/class="[^"]*logo-ink/.test(tag)) note(`${file}: wordmark <img> is missing .logo-ink, CSS cannot swap it`);
  }
}

/* The runtime's own slot builder must emit both inks and a plate wrapper. */
const slotFn = brand.slice(brand.indexOf("export function brandSlotHtml"));
for (const need of ["logo-plate", "logo-ink--light", "logo-ink--dark", "onLight", "onDark"]) {
  if (!slotFn.includes(need)) note(`brandSlotHtml() no longer emits ${need}`);
}

/* 3 — plate modifiers used in JS must be styled. */
const used = new Set();
for (const file of [...RUNTIME_JS, "index.html"]) {
  for (const m of read(file).matchAll(/logo-plate--[\w-]+/g)) used.add(m[0]);
}
for (const cls of [...used].sort()) {
  if (!styles.includes(`.${cls}`)) note(`styles.css has no rule for .${cls} used in the app`);
}

/* 4 — plate applied before first paint. */
if (!/data-logoPlate|dataset\.logoPlate/.test(html) || !/xacheus\.brand\.plate\.v1/.test(html)) {
  note("index.html lost its pre-paint plate script (FOUC: the logo would flash on the wrong background)");
}
if (!/xacheus\.brand\.plate\.v1/.test(brand)) note("js/brand.js and index.html disagree on the plate cache key");

/* 5 — offline shell covers the brand runtime. */
const shell = sw.slice(sw.indexOf("const SHELL"), sw.indexOf("];", sw.indexOf("const SHELL")));
for (const need of ["./js/brand.js", "./assets/logo.png", "./assets/logo-wordmark.png", "./assets/logo-wordmark-dark.png", "./assets/icon.svg", "./assets/icon-dark.svg"]) {
  if (!shell.includes(need)) note(`sw.js SHELL is missing ${need} — the logo breaks offline`);
}
for (const m of shell.matchAll(/"(\.\/assets\/[\w.-]+)"/g)) {
  try {
    read(m[1].replace("./", ""));
  } catch {
    note(`sw.js SHELL caches ${m[1]} which does not exist`);
  }
}
if (/logo1\.png/.test(shell)) note("sw.js caches assets/logo1.png, which nothing loads at runtime (281 KB)");

/* Ink colours baked into the assets must stay legible on their plate. */
const plateLight = (styles.match(/--logo-plate:\s*(#[0-9a-f]{3,8})/i) || [])[1];
const plateDark = (styles.match(/html\[data-logo-plate="dark"\][^}]*?--logo-plate:\s*(#[0-9a-f]{3,8})/is) || [])[1];
if (!plateLight || !plateDark) note("could not read --logo-plate from styles.css");
const lum = (hex) => {
  const v = hex.replace("#", "");
  const [r, g, b] = (v.length === 3 ? v.replace(/./g, (c) => c + c) : v.slice(0, 6))
    .match(/../g)
    .map((c) => Number.parseInt(c, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
const tool = read("tools/build-brand.py");
/** The ink colours are declared once, as decimal tuples in the build tool. */
const tupleHex = (name) => {
  const m = tool.match(new RegExp(`^${name}\\s*=\\s*\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)`, "m"));
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
};
const inkDark = tupleHex("NAVY");
const inkLight = tupleHex("LIGHT_INK");
if (!inkDark || !inkLight) note("could not read NAVY / LIGHT_INK from tools/build-brand.py");
for (const [label, ink, plate] of [
  ["dark ink", inkDark, plateLight],
  ["light ink", inkLight, plateDark],
]) {
  if (!ink || !plate) continue;
  const c = ratio(lum(ink), lum(plate));
  if (c < 4.5) note(`${label} ${ink} on plate ${plate} is only ${c.toFixed(2)}:1 — below WCAG AA (4.5:1)`);
  else console.log(`  ${label} ${ink} on ${plate}: ${c.toFixed(2)}:1`);
  // the other plate must be the worse one, or the swap logic is inverted
  const other = plate === plateLight ? plateDark : plateLight;
  if (other && c <= ratio(lum(ink), lum(other))) note(`${label} reads better on ${other} than on ${plate} — plate assignment is inverted`);
}

if (problems.length) {
  console.error(`brand plate check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log("brand plate check OK — every logo slot is plated, both inks ship, and each pairing clears AA");
