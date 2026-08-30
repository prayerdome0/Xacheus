/**
 * Xacheus — brand contrast.
 *
 * The rule this app follows wherever its logo appears:
 *
 *   the plate behind the logo is chosen by the logo's own colour, never by the
 *   current theme — dark or saturated ink (black, navy, green, blue) gets a
 *   light plate; light ink (white, pale grey) gets a dark plate.
 *
 * So the decision is *measured*, not hardcoded: `measureInk()` draws the
 * artwork into a canvas, separates ink from background, and returns the ink's
 * WCAG relative luminance plus its dominant accent. `js/../tools/build-brand.py`
 * applies the identical rule offline when it generates the two ink variants:
 *
 *   mark      assets/icon.svg        (dark ink)  |  assets/icon-dark.svg       (light ink)
 *   wordmark  assets/logo-wordmark.png           |  assets/logo-wordmark-dark.png
 *
 * Both variants are always in the DOM and CSS shows the one that matches the
 * current `html[data-logo-plate]`, so a page never paints the wrong logo first
 * and switch later. The measurement is cached in localStorage (keyed by source +
 * intrinsic size, so replacing the logo file re-measures) and re-applied to any
 * slot that mounts later through `brandSlotHtml()`.
 */

const PLATE = {
  light: { key: "light", rgb: [255, 255, 255] },
  dark: { key: "dark", rgb: [5, 6, 10] },
};

/** Ink that reads lighter than this needs a dark plate. */
export const LIGHT_INK_CUTOFF = 0.55;

/**
 * The minimum contrast a plate must give the logo for the stated rule
 * ("dark logo on light, light logo on dark") to be followed literally. Below
 * this, legibility wins and whichever plate reads better is used — the point of
 * the rule is a logo you can see, not a swatch. 3:1 is WCAG 1.4.11's floor for
 * graphical objects.
 */
export const MIN_PLATE_CONTRAST = 3;

const CACHE_KEY = "xacheus.brand.plate.v1";

export const BRAND_ART = {
  mark: { onLight: "assets/icon.svg", onDark: "assets/icon-dark.svg" },
  wordmark: { onLight: "assets/logo-wordmark.png", onDark: "assets/logo-wordmark-dark.png" },
};

/** The file the plate is decided from (the canonical logo artwork). */
export const BRAND_SOURCE = "assets/logo.png";

/**
 * Written by tools/build-brand.py: the plate decision, as data.
 *
 * Reading it is the preferred path, because it makes the answer independent of a
 * canvas decode succeeding and, since `.json` is served network-first by sw.js,
 * independent of a cached bitmap from before a logo change. Measuring the
 * artwork stays as the fallback for anything this build does not know about
 * (`window.XacheusBrand.use("assets/somewhere-else.png")`).
 */
export const BRAND_MANIFEST = "assets/brand-manifest.json";

let current = {
  plate: cached()?.plate || "light",
  accent: cached()?.accent || "#0a63e8",
  origin: cached()?.origin || "default",
  inkLum: cached()?.inkLum ?? null,
  measured: false,
};

const listeners = new Set();

function cached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function store(meta) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(meta));
  } catch {
    /* private mode — the in-memory value still applies for this session */
  }
}

/* ------------------------------------------------------------------ */
/* colour maths (same definitions as the Python tool)                  */
/* ------------------------------------------------------------------ */

function channelLum(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance([r, g, b]) {
  return 0.2126 * channelLum(r) + 0.7152 * channelLum(g) + 0.0722 * channelLum(b);
}

export function contrastRatio(lumA, lumB) {
  const hi = Math.max(lumA, lumB);
  const lo = Math.min(lumA, lumB);
  return (hi + 0.05) / (lo + 0.05);
}

export function plateForLuminance(lum) {
  const ruled = lum < LIGHT_INK_CUTOFF ? "light" : "dark";
  const onLight = contrastRatio(lum, relativeLuminance(PLATE.light.rgb));
  const onDark = contrastRatio(lum, relativeLuminance(PLATE.dark.rgb));
  if ((ruled === "light" ? onLight : onDark) >= MIN_PLATE_CONTRAST) return ruled;
  return onLight >= onDark ? "light" : "dark";
}

function toHex(rgb) {
  const [r = 0, g = 0, b = 0] = rgb;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Separate ink from background and describe the ink.
 *
 * Handles both shapes the brand ships in: artwork on a transparent matte (only
 * the ink has alpha) and a flattened export (an opaque background that has to be
 * recognised as the modal colour and rejected).
 */
/** Median of a small numeric array — robust to antialiased fringe pixels. */
function median(list) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Separate ink from background and describe the ink.
 *
 * The background is taken from the artwork's own border (logos sit centred, so
 * the frame is the matte) using per-channel medians, which survives both a flat
 * export and a noisy one. Ink is then every painted pixel that is *visibly
 * different* from that matte, with the bar lowered until something qualifies —
 * so a pale mark on a pale background still gets measured instead of silently
 * returning "no ink".
 */
export function analysePixels(data, width, height) {
  const at = (x, y) => {
    const i = (y * width + x) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  };

  const ringRs = [];
  const ringGs = [];
  const ringBs = [];
  const ringLums = [];
  let ringPainted = 0;
  const walkRing = (x, y) => {
    const [r, g, b, a] = at(x, y);
    if (a > 140) {
      ringPainted += 1;
      ringRs.push(r);
      ringGs.push(g);
      ringBs.push(b);
      ringLums.push(relativeLuminance([r, g, b]));
    }
  };
  const band = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < band; y += 1) walkRing(x, y);
    for (let y = height - band; y < height; y += 1) walkRing(x, y);
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < band; x += 1) walkRing(x, y);
    for (let x = width - band; x < width; x += 1) walkRing(x, y);
  }

  // A border that is barely painted means the file is ink on a transparent
  // matte, which is the shape the brand assets ship in.
  const hasMatte = ringPainted > (width * 2 + height * 2) * band * 0.35;
  const bgRgb = hasMatte ? [median(ringRs), median(ringGs), median(ringBs)] : null;
  const bgLum = bgRgb ? relativeLuminance(bgRgb) : 0;

  let painted = 0;
  const lums = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [, , , a] = at(x, y);
      if (a < 140) continue;
      painted += 1;
      const [r, g, b] = at(x, y);
      lums.push([x, y, relativeLuminance([r, g, b])]);
    }
  }
  if (!painted) return null;

  const pick = (gapThreshold, chromaThreshold) => {
    const chosen = [];
    for (const [x, y, lum] of lums) {
      const [r, g, b] = at(x, y);
      if (!bgRgb) {
        chosen.push([x, y, lum, r, g, b]);
        continue;
      }
      const chroma = Math.max(Math.abs(r - bgRgb[0]), Math.abs(g - bgRgb[1]), Math.abs(b - bgRgb[2]));
      if (Math.abs(lum - bgLum) >= gapThreshold || chroma >= chromaThreshold) chosen.push([x, y, lum, r, g, b]);
    }
    return chosen;
  };

  let ink = pick(0.18, 44);
  if (ink.length < Math.max(4, painted * 0.005)) ink = pick(0.12, 34);
  if (ink.length < Math.max(4, painted * 0.005)) ink = pick(0.06, 24);
  if (ink.length < 1) ink = pick(0, 0);
  if (!ink.length) return null;

  let lumSum = 0;
  let sat = -1;
  let accentR = 0;
  let accentG = 0;
  let accentB = 0;
  for (const [, , lum, r, g, b] of ink) {
    lumSum += lum;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    // Accent = the most colourful ink pixel; it tints the plate's focus ring.
    if (chroma > sat && lum > 0.06) {
      sat = chroma;
      accentR = r;
      accentG = g;
      accentB = b;
    }
  }
  const inkLum = lumSum / ink.length;
  return {
    inkLum,
    inkCount: ink.length,
    painted,
    hasMatte,
    background: bgRgb ? toHex(bgRgb) : null,
    accent: sat > 0 ? toHex([accentR, accentG, accentB]) : null,
    plate: plateForLuminance(inkLum),
    contrast: {
      light: contrastRatio(inkLum, relativeLuminance(PLATE.light.rgb)),
      dark: contrastRatio(inkLum, relativeLuminance(PLATE.dark.rgb)),
    },
  };
}

let measuring = null;

/**
 * Measure an image and resolve its ink description. Cached per source + size.
 * Never rejects: if the canvas can't be read (blocked by `crossOrigin`, or a
 * decoder quirk) it resolves `null` and the caller keeps the previous plate.
 */
export function measureImage(src = BRAND_SOURCE) {
  const hit = cached();
  if (hit && hit.src === src && hit.inkLum != null) {
    return Promise.resolve({ ...hit, fromCache: true });
  }
  if (measuring && measuring.src === src) return measuring.promise;

  const promise = new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const max = 160;
        const scale = Math.min(1, max / Math.max(img.naturalWidth || max, img.naturalHeight || max));
        const w = Math.max(1, Math.round((img.naturalWidth || max) * scale));
        const h = Math.max(1, Math.round((img.naturalHeight || max) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const c2d = canvas.getContext("2d", { willReadFrequently: true });
        c2d.clearRect(0, 0, w, h);
        c2d.drawImage(img, 0, 0, w, h);
        const { data } = c2d.getImageData(0, 0, w, h);
        const result = analysePixels(data, w, h);
        if (!result) {
          resolve(null);
          return;
        }
        const meta = { src, w: img.naturalWidth, h: img.naturalHeight, ...result };
        store(meta);
        resolve(meta);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  measuring = { src, promise };
  return promise;
}

/* ------------------------------------------------------------------ */
/* applying the plate                                                  */
/* ------------------------------------------------------------------ */

export function brandPlate() {
  return { ...current };
}

export function onBrandPlate(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function applyPlate({
  plate = current.plate,
  accent = current.accent,
  measured = current.measured,
  inkLum = current.inkLum,
  origin = current.origin,
} = {}) {
  const root = document.documentElement;
  const next = plate === "dark" ? "dark" : "light";
  current = { plate: next, accent, inkLum, measured, origin };

  root.dataset.logoPlate = next;
  root.style.setProperty("--logo-plate", toHex(PLATE[next].rgb));
  root.style.setProperty(
    "--logo-plate-line",
    next === "light" ? "rgba(8, 10, 16, 0.14)" : "rgba(255, 255, 255, 0.18)"
  );
  root.style.setProperty(
    "--logo-plate-shadow",
    next === "light" ? "0 1px 0 rgba(255, 255, 255, 0.7) inset, 0 8px 22px rgba(0, 0, 0, 0.16)" : "0 1px 0 rgba(255, 255, 255, 0.08) inset, 0 10px 26px rgba(0, 0, 0, 0.5)"
  );
  const accentHex = accent || "#0a63e8";
  root.style.setProperty("--logo-accent", accentHex);
  // Safari tints its monochrome tab icon from this attribute, so keep it in step
  // with the measured ink instead of a value frozen in index.html.
  const mask = document.querySelector('link[rel="mask-icon"]');
  if (mask) mask.setAttribute("color", accentHex);

  for (const fn of listeners) {
    try {
      fn(brandPlate());
    } catch {
      /* a listener must never break the brand pass */
    }
  }
  return brandPlate();
}

/**
 * Point every `data-brand` image in `scope` at the variant that matches the
 * current plate. Only needed for markup written by hand (the boot screen);
 * `brandSlotHtml()` already ships both variants and lets CSS choose.
 */
export function syncBrandSlots(scope = document) {
  const { plate } = current;
  for (const img of scope.querySelectorAll("[data-brand]")) {
    const role = img.dataset.brand || "mark";
    const art = BRAND_ART[role];
    if (!art) continue;
    const want = art[plate === "light" ? "onLight" : "onDark"];
    if (img.getAttribute("src") !== want) img.setAttribute("src", want);
  }
}

/**
 * The one way a logo should be written into the page.
 *
 * @param {"mark"|"wordmark"} role       which artwork
 * @param {string} size                   sm | md | lg | xl (CSS sizes the plate)
 * @param {boolean} linked                wrap in the home link
 * @param {string} extraClass             slot-specific hook (topbar, auth, …)
 */
export function brandSlotHtml({ role = "mark", size = "md", linked = true, extraClass = "", ariaLabel = "Xacheus home" } = {}) {
  const art = BRAND_ART[role] || BRAND_ART.mark;
  const inner = `
    <span class="logo-plate logo-plate--${role} logo-plate--${size} ${extraClass}" data-brand-slot="${role}">
      <img class="logo-ink logo-ink--dark" src="${art.onLight}" alt="" width="${role === "wordmark" ? 702 : 512}" height="${role === "wordmark" ? 149 : 512}" decoding="async" />
      <img class="logo-ink logo-ink--light" src="${art.onDark}" alt="" width="${role === "wordmark" ? 702 : 512}" height="${role === "wordmark" ? 149 : 512}" decoding="async" aria-hidden="true" />
      ${linked ? "" : `<span class="sr-only">Xacheus</span>`}
    </span>`;
  return linked
    ? `<a class="brand brand--${role} brand--${size}" href="#/home" aria-label="${ariaLabel}">${inner}</a>`
    : `<span class="brand brand--${role} brand--${size}">${inner}</span>`;
}

/** Fetch the build-time plate decision, or null if it is unavailable/unusable. */
export async function readManifest(url = BRAND_MANIFEST) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || (data.plate !== "light" && data.plate !== "dark")) return null;
    return data;
  } catch {
    return null; // offline with nothing cached, hosting that rewrites 404s to
    // index.html, a blocked request — all mean "fall back to measuring"
  }
}

/**
 * Adopt the artwork mapping the build produced, so a regenerated logo with new
 * filenames is followed without touching this file.
 */
function adoptArt(art) {
  if (!art || typeof art !== "object") return;
  for (const role of Object.keys(BRAND_ART)) {
    const next = art[role];
    if (!next || typeof next.onLight !== "string" || typeof next.onDark !== "string") continue;
    BRAND_ART[role].onLight = next.onLight;
    BRAND_ART[role].onDark = next.onDark;
  }
}

/**
 * Measure once per session and apply.
 *
 * The cached plate is applied immediately (no wrong-variant flash), then the
 * build's measurement — `assets/brand-manifest.json` — overrides it, and a
 * canvas measurement of `BRAND_SOURCE` covers the case where that file is
 * missing or stale. Replacing `assets/logo.png` with, say, a white mark and
 * re-running the build flips every plate on the next load without a code change.
 */
export async function initBrand({ src = BRAND_SOURCE } = {}) {
  const hit = cached();
  if (hit?.plate) applyPlate({ plate: hit.plate, accent: hit.accent, inkLum: hit.inkLum });

  const manifest = await readManifest();
  if (manifest) {
    adoptArt(manifest.art);
    const meta = {
      src: manifest.source || src,
      plate: manifest.plate,
      accent: manifest.accent || null,
      inkLum: typeof manifest.inkLum === "number" ? manifest.inkLum : null,
      origin: "manifest",
      contrast: manifest.contrast || null,
    };
    store(meta);
    applyPlate({ plate: meta.plate, accent: meta.accent, inkLum: meta.inkLum, measured: true, origin: "manifest" });
    syncBrandSlots();
    document.dispatchEvent(new CustomEvent("xacheus:brand-plate", { detail: brandPlate() }));
    return brandPlate();
  }

  const meta = await measureImage(src);
  if (!meta) {
    applyPlate({ measured: false });
    return brandPlate();
  }
  applyPlate({ plate: meta.plate, accent: meta.accent, inkLum: meta.inkLum, measured: true, origin: "measured" });
  syncBrandSlots();
  document.dispatchEvent(new CustomEvent("xacheus:brand-plate", { detail: brandPlate() }));
  return brandPlate();
}

/** Small dev helper: `XacheusBrand.report()` in the console. */
export function report() {
  return { ...current, cache: cached() };
}

if (typeof window !== "undefined") {
  window.XacheusBrand = {
    report,
    apply: applyPlate,
    measure: measureImage,
    init: initBrand,
    /** Re-point the slots at a different logo file and decide its plate afresh. */
    async use(src) {
      try {
        localStorage.removeItem(CACHE_KEY);
      } catch {
        /* ignore */
      }
      measuring = null;
      const meta = await measureImage(src);
      if (meta) applyPlate({ plate: meta.plate, accent: meta.accent, inkLum: meta.inkLum, measured: true });
      syncBrandSlots();
      return brandPlate();
    },
  };
}
