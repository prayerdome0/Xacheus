#!/usr/bin/env python3
"""
Xacheus — brand asset builder.

Turns the two source artwork files committed at the repo root:

    logo.png   — the "X" app mark   (3264x3264, noisy translucent backdrop)
    logo1.png  — the full wordmark  (3264x1207, noisy translucent backdrop)

into the small, clean, correctly-sized PWA/icon set under assets/.

Both sources were exported with a semi-transparent noise/texture layer baked
behind the artwork (~27% alpha). The real artwork is fully opaque, so we
recover clean art by keeping only near-opaque pixels, then trimming.

The mark is two-tone: a bright blue half (#085AE6 -> #1990F2) and a dark navy
half (#0E1E33). The navy half disappears on the app's dark background, so we
also emit an "on-dark" variant where only the navy ink is lifted to the app's
foreground colour. Navy is separated from brand blue by HSL lightness, which
keeps the blue gradient intact (a flat fuzz-match on the navy destroys it).

Usage:  python3 tools/build-icons.py
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import trace_mark  # noqa: E402  (same-directory helper)

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"

MARK_SRC = ROOT / "logo.png"
WORD_SRC = ROOT / "logo1.png"

# --- brand constants -------------------------------------------------------
BG_DARK = (10, 11, 18)  # --bg  #0a0b12
INK_ON_DARK = (233, 236, 245)  # --text #e9ecf5
PLATE = (255, 255, 255)  # maskable/plate background

# Pixels with alpha below this are backdrop noise, not artwork.
OPAQUE_CUTOFF = 200
# HSL lightness below this is the navy ink (brand blue sits well above).
NAVY_LIGHTNESS = 0.30


def load_clean(path: Path) -> Image.Image:
    """Load a source logo, drop the baked noise layer, trim to the artwork."""
    if not path.exists():
        sys.exit(f"missing source artwork: {path}")

    img = Image.open(path).convert("RGBA")
    arr = np.array(img)

    # Keep only near-opaque pixels; everything else was the noise backdrop.
    solid = arr[:, :, 3] >= OPAQUE_CUTOFF
    arr[:, :, 3] = np.where(solid, 255, 0).astype(np.uint8)
    # Zero the colour of dropped pixels so resampling can't smear noise in.
    arr[:, :, :3][~solid] = 0

    out = Image.fromarray(arr, "RGBA")
    box = out.getbbox()
    return out.crop(box) if box else out


def navy_mask(img: Image.Image) -> np.ndarray:
    """Boolean mask of the dark navy ink (excludes the blue gradient)."""
    arr = np.array(img).astype(np.float32) / 255.0
    rgb, alpha = arr[:, :, :3], arr[:, :, 3]
    lightness = (rgb.max(axis=2) + rgb.min(axis=2)) / 2.0
    return (lightness < NAVY_LIGHTNESS) & (alpha > 0.5)


def recolour_navy(img: Image.Image, colour: tuple[int, int, int]) -> Image.Image:
    """Lift the navy half to `colour`, leaving the blue gradient untouched."""
    arr = np.array(img)
    mask = navy_mask(img)
    for i, channel in enumerate(colour):
        arr[:, :, i] = np.where(mask, channel, arr[:, :, i])
    return Image.fromarray(arr, "RGBA")


def fit(img: Image.Image, box: int, inset: float = 1.0) -> Image.Image:
    """Scale `img` to fit a `box`x`box` square, occupying `inset` of it."""
    target = max(1, int(box * inset))
    scale = min(target / img.width, target / img.height)
    size = (max(1, round(img.width * scale)), max(1, round(img.height * scale)))
    return img.resize(size, Image.LANCZOS)


def square(
    img: Image.Image,
    box: int,
    bg: tuple[int, int, int] | None,
    inset: float,
    radius: float = 0.0,
) -> Image.Image:
    """Centre `img` on a `box`x`box` canvas, optional background + rounding."""
    canvas = Image.new("RGBA", (box, box), (*bg, 255) if bg else (0, 0, 0, 0))
    art = fit(img, box, inset)
    canvas.alpha_composite(art, ((box - art.width) // 2, (box - art.height) // 2))

    if bg and radius > 0:
        # Supersampled rounded-rect mask for clean edges.
        ss, r = 4, int(box * radius)
        big = Image.new("L", (box * ss, box * ss), 0)
        from PIL import ImageDraw

        ImageDraw.Draw(big).rounded_rectangle(
            (0, 0, box * ss - 1, box * ss - 1), radius=r * ss, fill=255
        )
        canvas.putalpha(big.resize((box, box), Image.LANCZOS))

    return canvas


def save(img: Image.Image, name: str) -> None:
    path = ASSETS / name
    path.parent.mkdir(parents=True, exist_ok=True)
    # Quantise to a palette where possible — these are flat-ish brand marks,
    # so 8-bit palette output is visually lossless and far smaller.
    img.save(path, "PNG", optimize=True)
    print(f"  {name:<28} {img.width}x{img.height}  {path.stat().st_size / 1024:6.1f} KB")


def main() -> None:
    print("reading source artwork…")
    mark = load_clean(MARK_SRC)
    word = load_clean(WORD_SRC)
    print(f"  mark  {mark.width}x{mark.height}")
    print(f"  word  {word.width}x{word.height}")

    mark_on_dark = recolour_navy(mark, INK_ON_DARK)
    word_on_dark = recolour_navy(word, INK_ON_DARK)

    print("\nwriting assets/…")

    # Transparent mark, for use anywhere the surface is light.
    save(square(mark, 512, None, 1.0), "logo-mark.png")
    # Transparent mark tuned for the dark app chrome (navy -> light ink).
    save(square(mark_on_dark, 512, None, 1.0), "logo-mark-dark.png")

    # Wordmarks (kept at natural aspect ratio, not squared).
    save(fit(word, 1024), "logo-wordmark.png")
    save(fit(word_on_dark, 1024), "logo-wordmark-dark.png")

    # --- PWA icons ---------------------------------------------------------
    # "any" icons: the mark on a white plate so the navy half always reads,
    # on any launcher wallpaper and in both light and dark system themes.
    for size in (192, 512):
        save(square(mark, size, PLATE, 0.78, radius=0.18), f"icon-{size}.png")

    # Maskable icons: Android crops to a circle of ~80% of the canvas, so the
    # art has to sit inside a much tighter safe zone with a full-bleed plate.
    for size in (192, 512):
        save(square(mark, size, PLATE, 0.56), f"icon-maskable-{size}.png")

    # Apple touch icon: iOS applies its own rounding and does NOT honour
    # transparency, so this is a full-bleed opaque square.
    save(square(mark, 180, PLATE, 0.72), "apple-touch-icon.png")

    # Favicons.
    for size in (16, 32, 48):
        save(square(mark, size, PLATE, 0.86, radius=0.16), f"favicon-{size}.png")

    # Multi-resolution .ico for legacy/browser-tab use.
    ico = ASSETS / "favicon.ico"
    square(mark, 64, PLATE, 0.86).save(
        ico, format="ICO", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)]
    )
    print(f"  {'favicon.ico':<28} multi     {ico.stat().st_size / 1024:6.1f} KB")

    # Vector mark (traced from the same source) — used for the favicon and
    # all in-app chrome, so the logo stays crisp at any density.
    print()
    trace_mark.main()

    print("\ndone.")


if __name__ == "__main__":
    main()
