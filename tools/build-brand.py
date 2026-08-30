#!/usr/bin/env python3
"""
Xacheus — brand plate builder.

The logo files at the repo root (`logo.png`, `logo1.png`) were exported with a
semi-transparent noise layer baked behind the artwork (~27 % alpha). That is why
the logo is hard to read on the app's dark chrome: dark navy ink sitting on a
dark, slightly-noisy rectangle.

This tool turns those sources into **plate-ready** assets, following one rule
that is applied everywhere the logo appears:

    the plate behind the logo is chosen by the logo's own colour
      · dark or saturated ink (black, navy, green, blue …) -> light plate (#ffffff)
      · light ink (white, pale grey)                       -> dark plate  (#05060a)

Outputs (all transparent-background, ink-only, trimmed):

    assets/logo-wordmark.png        dark ink  — for a light plate
    assets/logo-wordmark-dark.png   light ink — for a dark plate

`assets/icon.svg` / `assets/icon-dark.svg` already provide the same two
variants for the mark, so no mark PNGs are regenerated here.

The tool also prints the contrast arithmetic it used, so the chosen plate is
auditable rather than assumed:

    python3 tools/build-brand.py            # build
    python3 tools/build-brand.py --check     # measure only, write nothing

Pure standard library (struct + zlib) on purpose: the repo has no Python
dependencies, and PNG with 8-bit RGBA + filter 0 needs nothing else.
"""

from __future__ import annotations

import math
import struct
import datetime
import json
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# --- brand palette (matches assets/icon.svg) --------------------------------
NAVY = (14, 30, 51)          # #0e1e33  — the dark half of the mark / wordmark ink
LIGHT_INK = (233, 236, 245)  # #e9ecf5  — same artwork for a dark plate
PLATE_LIGHT = (255, 255, 255)
PLATE_DARK = (5, 6, 10)

# The baked wash in the sources sits at alpha 64-79 over ~86 % of the canvas;
# the ink is opaque. Anything under INK_ALPHA_MIN is that noise and is thrown
# away; alpha saturates at INK_ALPHA_FULL so thin strokes (the wordmark's
# small-caps tagline) keep solid weight instead of turning speckled.
INK_ALPHA_MIN = 130
INK_ALPHA_FULL = 200
TRIM_PAD_RATIO = 0.06

def prefer(*candidates: Path) -> Path:
    """
    Use the copy the site actually renders (assets/, sized for the job) and fall
    back to the repo-root originals if it is missing.
    """
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


SOURCES = {
    "wordmark": prefer(ROOT / "assets" / "logo1.png", ROOT / "logo1.png"),
    "mark": prefer(ROOT / "assets" / "logo.png", ROOT / "logo.png"),
}
OUT = {
    "wordmark-light-plate": ROOT / "assets" / "logo-wordmark.png",
    "wordmark-dark-plate": ROOT / "assets" / "logo-wordmark-dark.png",
}


# ---------------------------------------------------------------------------
# PNG I/O (8-bit RGBA, non-interlaced)
# ---------------------------------------------------------------------------
def read_png(path: Path):
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"{path.name}: not a PNG")
    pos = 8
    idat = b""
    width = height = depth = color = interlace = 0
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        kind = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            width, height, depth, color, _c, _f, interlace = struct.unpack(">IIBBBBB", body)
        elif kind == b"IDAT":
            idat += body
        elif kind == b"IEND":
            break
    if depth != 8 or color not in (2, 6) or interlace != 0:
        raise SystemExit(f"{path.name}: need 8-bit non-interlaced RGB/RGBA, got depth={depth} colour={color} interlace={interlace}")

    channels = 4 if color == 6 else 3
    raw = zlib.decompress(idat)
    stride = width * channels
    rows = []
    prev = bytearray(stride)
    p = 0
    for _y in range(height):
        filt = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if filt == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 255
        elif filt == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 255
        elif filt == 3:
            for i in range(stride):
                left = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 255
        elif filt == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pp = a + b - c
                pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 255
        elif filt != 0:
            raise SystemExit(f"{path.name}: unsupported filter {filt}")
        prev = line
        rows.append(bytes(line))

    pixels = [[0] * width for _ in range(height)]
    for y, row in enumerate(rows):
        for x in range(width):
            i = x * channels
            if channels == 4:
                pixels[y][x] = (row[i], row[i + 1], row[i + 2], row[i + 3])
            else:
                pixels[y][x] = (row[i], row[i + 1], row[i + 2], 255)
    return width, height, pixels


def write_png(path: Path, width: int, height: int, pixels) -> None:
    raw = bytearray()
    for y in range(height):
        raw.append(0)  # filter 0 — trivially decodable everywhere
        for x in range(width):
            r, g, b, a = pixels[y][x]
            raw += bytes((r, g, b, a))

    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")
    )


# ---------------------------------------------------------------------------
# colour maths
# ---------------------------------------------------------------------------
def srgb_luminance(rgb) -> float:
    """WCAG relative luminance, 0..1."""

    def channel(v: int) -> float:
        c = v / 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = rgb[:3]
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)


def contrast_ratio(lum_a: float, lum_b: float) -> float:
    hi, lo = max(lum_a, lum_b), min(lum_a, lum_b)
    return (hi + 0.05) / (lo + 0.05)


def is_blueish(rgb) -> bool:
    r, g, b = rgb[:3]
    return b > 110 and b > r + 25


def classify(rgb) -> str:
    """The artwork is two-tone: a brand-blue half and a near-black navy half."""
    return "blue" if is_blueish(rgb) else "navy"


# ---------------------------------------------------------------------------
# the actual job
# ---------------------------------------------------------------------------
def extract_ink(pixels, width: int, height: int):
    """
    Return (alpha-map, label-map, bbox, strategy) with the background removed.

    Two sources of truth, in order of preference:
      "alpha"    — the exported PNGs carry the artwork as near-opaque ink over a
                   ~27 % noise wash, so alpha alone separates them.
      "luminance"— a flattened export (opaque background) — the background colour
                   is the modal colour and ink is whatever deviates from it.
    """
    alpha = [[0] * width for _ in range(height)]
    label = [[None] * width for _ in range(height)]

    opaque = sum(1 for y in range(height) for x in range(width) if pixels[y][x][3] > 240)
    strategy = "luminance" if opaque > 0.95 * width * height else "alpha"

    if strategy == "alpha":
        span = max(1, INK_ALPHA_FULL - INK_ALPHA_MIN)
        for y in range(height):
            row = pixels[y]
            for x in range(width):
                r, g, b, a = row[x]
                if a < INK_ALPHA_MIN:
                    continue
                t = min(1.0, max(0.0, (a - INK_ALPHA_MIN) / span))
                # Gamma < 1 lifts thin/anti-aliased strokes (the tagline's small
                # caps) without letting the noise wash back in at a <= MIN.
                kept = int(round(255 * t**0.55))
                if kept < 12:
                    continue
                alpha[y][x] = kept
                label[y][x] = classify((r, g, b))
    else:
        # Modal colour (4 bits per channel) = the flattened background.
        bins: dict[tuple[int, int, int], int] = {}
        for y in range(height):
            row = pixels[y]
            for x in range(width):
                r, g, b, a = row[x]
                key = (r >> 4, g >> 4, b >> 4)
                bins[key] = bins.get(key, 0) + 1
        bg_key = max(bins, key=bins.get)
        bg = tuple(c * 16 + 8 for c in bg_key)
        bg_lum = srgb_luminance(bg)
        # Ink = anything far enough from the background in luminance.
        span = max(0.06, min(0.55, 0.62 - bg_lum if bg_lum > 0.5 else 0.38))
        for y in range(height):
            row = pixels[y]
            for x in range(width):
                r, g, b, a = row[x]
                if a < 8:
                    continue
                delta = abs(srgb_luminance((r, g, b)) - bg_lum)
                if delta < span * 0.35:
                    continue
                alpha[y][x] = max(0, min(255, int(round(255 * min(1.0, delta / span) ** 0.55))))
                label[y][x] = classify((r, g, b))

    bbox = [width, height, -1, -1]
    for y in range(height):
        for x in range(width):
            if alpha[y][x]:
                bbox[0] = min(bbox[0], x)
                bbox[1] = min(bbox[1], y)
                bbox[2] = max(bbox[2], x)
                bbox[3] = max(bbox[3], y)
    if bbox[2] < 0:
        raise SystemExit("no ink found — could not separate artwork from background")
    return alpha, label, bbox, strategy


def render(alpha, label, bbox, variant: str, pad_ratio: float = TRIM_PAD_RATIO):
    """Trim to the ink box and recolour for the requested plate variant."""
    x0, y0, x1, y1 = bbox
    w = x1 - x0 + 1
    h = y1 - y0 + 1
    pad = max(2, int(round(h * pad_ratio)))
    out_w, out_h = w + pad * 2, h + pad * 2
    out = [[(0, 0, 0, 0) for _ in range(out_w)] for _ in range(out_h)]
    for y in range(h):
        sy = y0 + y
        for x in range(w):
            sx = x0 + x
            a = alpha[sy][sx]
            if not a:
                continue
            kind = label[sy][sx]
            if kind == "blue":
                rgb = (25, 144, 242)  # brand blue reads on both plates
            else:
                rgb = NAVY if variant == "dark-ink" else LIGHT_INK
            out[y + pad][x + pad] = (rgb[0], rgb[1], rgb[2], a)
    return out_w, out_h, out


def dominant_accent(ink_pixels) -> str:
    """Hex of the most saturated ink pixel — the colour that tints the plate."""
    best, best_score = None, -1
    for r, g, b in (tuple(px[:3]) for px in ink_pixels):
        score = max(r, g, b) - min(r, g, b)
        if score > best_score and srgb_luminance((r, g, b)) > 0.06:
            best_score, best = score, (r, g, b)
    if best is None:
        return None
    return "#{:02x}{:02x}{:02x}".format(*best)


def analyse(path: Path):
    width, height, pixels = read_png(path)
    alpha, label, bbox, strategy = extract_ink(pixels, width, height)
    counts = {"navy": 0, "blue": 0}
    lum_sum = 0.0
    total = 0
    for y in range(height):
        for x in range(width):
            a = alpha[y][x]
            if a < 200:
                continue
            r, g, b, _ = pixels[y][x]
            if strategy == "luminance":
                # Reconstruct what the ink actually looks like over its own
                # background, so luminance reflects the artwork, not the matte.
                lum_sum += srgb_luminance((r, g, b)) * (a / 255)
            else:
                # Alpha strategy: a pixel this opaque *is* the ink.
                lum_sum += srgb_luminance((r, g, b))
            counts[label[y][x]] += 1
            total += 1
    ink_lum = lum_sum / max(1, total)
    return {
        "path": path,
        "size": (width, height),
        "strategy": strategy,
        "ink_lum": ink_lum,
        "counts": counts,
        "bbox": bbox,
        "alpha": alpha,
        "label": label,
        "pixels": pixels,
    }


LIGHT_INK_CUTOFF = 0.55
MIN_PLATE_CONTRAST = 3.0


def plate_for(ink_lum: float) -> str:
    """
    The rule the app follows everywhere (kept identical to plateForLuminance()
    in js/brand.js):

      ink that reads dark or saturated (black, navy, green, blue…)  -> light plate
      ink that reads light (white, pale grey)                        -> dark plate

    0.55 relative luminance is the split: it puts mid green (~0.36) and brand
    navy (~0.03) on white, and white (1.0) on black. If the ruled plate would
    leave the logo under 3:1 — e.g. a mid-tone teal whose luminance sits between
    the two plates — the more legible plate wins instead, because the point of
    the rule is a logo you can actually see.
    """
    on_light = contrast_ratio(ink_lum, srgb_luminance(PLATE_LIGHT))
    on_dark = contrast_ratio(ink_lum, srgb_luminance(PLATE_DARK))
    ruled = "light" if ink_lum < LIGHT_INK_CUTOFF else "dark"
    if (on_light if ruled == "light" else on_dark) >= MIN_PLATE_CONTRAST:
        return ruled
    return "light" if on_light >= on_dark else "dark"


def build_manifest(entries: dict, plate: str, accent: str) -> None:
    """
    assets/brand-manifest.json — the decided plate, as data.

    Without this the browser has to download the source artwork and measure it on
    a canvas before it knows which background the logo needs. That works, but it
    means the answer depends on a decode succeeding, on a same-origin canvas not
    being tainted, and on a cache that can lag behind a replaced logo. The app
    reads this file first (it is small and served network-first) and only falls
    back to measuring when someone points it at an art file this build does not
    know about.
    """
    target = ROOT / "assets" / "brand-manifest.json"
    wordmark, mark = entries.get("wordmark"), entries.get("mark")
    payload = {
        "version": 1,
        "generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "plate": plate,
        "accent": accent,
        "source": SOURCES["mark"].name if mark else SOURCES["wordmark"].name,
        "inkLum": round(wordmark["ink_lum"], 4) if wordmark else None,
        "contrast": {
            "light": round(wordmark["on_light"], 2) if wordmark else None,
            "dark": round(wordmark["on_dark"], 2) if wordmark else None,
        },
        "art": {
            "mark": {"onLight": "assets/icon.svg", "onDark": "assets/icon-dark.svg"},
            "wordmark": {
                "onLight": "assets/logo-wordmark.png",
                "onDark": "assets/logo-wordmark-dark.png",
            },
        },
    }
    target.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"wrote {target.relative_to(ROOT)}  plate={plate} accent={accent}")


def build_social_card(entry: dict, plate: str) -> None:
    """
    1200x630 social card: the wordmark on the plate the rule chose.

    Link previews are the one place we cannot run CSS, so the plate has to be
    baked into the image.
    """
    target = ROOT / "assets" / "brand-card.png"
    card_w, card_h = 1200, 630
    variant = "dark-ink" if plate == "light" else "light-ink"
    art_w, art_h, art = render(entry["alpha"], entry["label"], entry["bbox"], variant)
    plate_rgb = PLATE_LIGHT if plate == "light" else PLATE_DARK

    # Fit the artwork to ~72 % of the card width, nearest-neighbour (crisp at
    # these ratios; the wordmark is already at a similar scale).
    scale = min(1.0, (card_w * 0.72) / art_w)
    dw, dh = max(1, int(art_w * scale)), max(1, int(art_h * scale))
    ox, oy = (card_w - dw) // 2, (card_h - dh) // 2

    bg = (plate_rgb[0], plate_rgb[1], plate_rgb[2])
    pixels = [[bg + (255,) for _ in range(card_w)] for _ in range(card_h)]
    for y in range(dh):
        sy = min(art_h - 1, int(y / scale))
        for x in range(dw):
            r, g, b, a = art[sy][min(art_w - 1, int(x / scale))]
            if not a:
                continue
            f = a / 255
            px, py = ox + x, oy + y
            if not (0 <= px < card_w and 0 <= py < card_h):
                continue
            br, bg2, bb = pixels[py][px][:3]
            pixels[py][px] = (round(r * f + br * (1 - f)), round(g * f + bg2 * (1 - f)), round(b * f + bb * (1 - f)), 255)
    write_png(target, card_w, card_h, pixels)
    print(f"wrote {target.relative_to(ROOT)}  {card_w}x{card_h}  {target.stat().st_size // 1024} KB  ({variant} on {plate} plate)")


def main(argv) -> int:
    check_only = "--check" in argv
    assets = {}
    for name, src in SOURCES.items():
        if not src.exists():
            print(f"!! {src.name} missing — skipping {name}")
            continue
        assets[name] = analyse(src)

    if "wordmark" not in assets:
        print("Nothing to do.")
        return 1

    w = assets["wordmark"]
    m = assets.get("mark")
    plate = plate_for(w["ink_lum"])
    gate_failures = 0
    on_light = contrast_ratio(w["ink_lum"], srgb_luminance(PLATE_LIGHT))
    on_dark = contrast_ratio(w["ink_lum"], srgb_luminance(PLATE_DARK))
    print("measured ink (relative luminance, 0 = black, 1 = white)")
    for key, entry in (("wordmark", w), ("mark", m)):
        if not entry:
            continue
        on_light = contrast_ratio(entry["ink_lum"], srgb_luminance(PLATE_LIGHT))
        on_dark = contrast_ratio(entry["ink_lum"], srgb_luminance(PLATE_DARK))
        entry["plate"] = plate_for(entry["ink_lum"])
        entry["on_light"], entry["on_dark"] = on_light, on_dark
        entry["accent"] = dominant_accent(
            px[:3] for rows in entry["pixels"] for px in rows if px[3] >= 200
        )
        print(
            f"  {key:9s} {entry['path'].name:16s} {entry['size'][0]}x{entry['size'][1]} [{entry['strategy']}] L={entry['ink_lum']:.3f}  navy={entry['counts']['navy']:>7}px  blue={entry['counts']['blue']:>6}px"
            f"  contrast on white={on_light:5.2f}:1  on near-black={on_dark:5.2f}:1  -> {plate_for(entry['ink_lum'])} plate"
        )
    if m and plate_for(m["ink_lum"]) != plate:
        print("  ! mark and wordmark disagree on plate; each slot decides for itself (brand.js does this per image)")

    worst = 99.0
    for entry in (w, m):
        if not entry:
            continue
        chosen = entry["on_light"] if entry["plate"] == "light" else entry["on_dark"]
        rejected = entry["on_dark"] if entry["plate"] == "light" else entry["on_light"]
        worst = min(worst, chosen)
        if chosen < 4.5:
            print(f"  !! {entry['path'].name}: {chosen:.2f}:1 on the chosen plate — below WCAG AA (4.5:1)")
            gate_failures += 1
        if chosen <= rejected:
            print(f"  !! {entry['path'].name}: the other plate reads better ({rejected:.2f}:1) — plate logic is wrong")
            gate_failures += 1
    if gate_failures:
        print("\nFAILED: the logo would not be clearly visible on its plate.")
        return 1

    if check_only:
        print(f"--check: OK — every artwork clears 4.5:1 on its plate (worst {worst:.2f}:1); nothing written")
        return 0

    for variant, target in (("dark-ink", OUT["wordmark-light-plate"]), ("light-ink", OUT["wordmark-dark-plate"])):
        out_w, out_h, px = render(w["alpha"], w["label"], w["bbox"], variant)
        print(f"  ({variant}: background removed via the {w['strategy']} strategy)")
        target.parent.mkdir(exist_ok=True)
        write_png(target, out_w, out_h, px)
        print(f"wrote {target.relative_to(ROOT)}  {out_w}x{out_h}  {target.stat().st_size // 1024} KB")

    print(f"\nchosen plate for this artwork: {plate} (data-logo-plate=\"{plate}\")")

    build_manifest({"wordmark": w, "mark": m}, plate, w.get("accent") or m.get("accent") if m else None)
    build_social_card(w, plate)
    print("the runtime reads assets/brand-manifest.json first, then measures as a fallback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
