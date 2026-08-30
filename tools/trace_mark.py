#!/usr/bin/env python3
"""
Trace the Xacheus "X" mark from logo.png into a compact, scalable SVG.

The raster mark is made of straight-edged polygonal shapes (plus one rounded
inner corner), so a marching-squares contour trace followed by Douglas-Peucker
simplification reproduces it almost exactly in a couple of hundred bytes of
path data — far better than embedding a PNG.

The artwork is two-tone: a bright blue gradient half and a dark navy half,
separated here by HSL lightness. A thin light outline stroke rings the navy
shape in the source; it is absorbed by taking the navy region as "everything
that is not clearly the blue gradient" inside the mark's right portion.

Writes assets/icon.svg (navy ink) and assets/icon-dark.svg (light ink).
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "logo.png"
OUT = ROOT / "assets" / "icon.svg"          # navy ink, for light surfaces
OUT_DARK = ROOT / "assets" / "icon-dark.svg"  # light ink, for dark surfaces

VIEW = 512.0          # SVG viewBox size
OPAQUE_CUTOFF = 200   # alpha below this is the baked noise backdrop
NAVY_LIGHTNESS = 0.30 # HSL lightness separating navy ink from brand blue
EPSILON = 0.9         # Douglas-Peucker tolerance, in viewBox units
TRACE_MAX = 1024      # trace at this max dimension (source is ~8 MP)


def clean_mark() -> Image.Image:
    img = Image.open(SRC).convert("RGBA")
    arr = np.array(img)
    solid = arr[:, :, 3] >= OPAQUE_CUTOFF
    arr[:, :, 3] = np.where(solid, 255, 0).astype(np.uint8)
    arr[:, :, :3][~solid] = 0
    out = Image.fromarray(arr, "RGBA")
    out = out.crop(out.getbbox())
    # Trace at ~1024px: plenty of precision for straight-edged art, and keeps
    # the pure-Python labelling/tracing fast (the source is ~8 megapixels).
    if max(out.size) > TRACE_MAX:
        scale = TRACE_MAX / max(out.size)
        out = out.resize(
            (max(1, round(out.width * scale)), max(1, round(out.height * scale))),
            Image.LANCZOS,
        )
    return out


def masks(img: Image.Image) -> tuple[np.ndarray, np.ndarray]:
    arr = np.array(img).astype(np.float32) / 255.0
    rgb, alpha = arr[:, :, :3], arr[:, :, 3]
    solid = alpha > 0.5
    lightness = (rgb.max(axis=2) + rgb.min(axis=2)) / 2.0
    # Saturated + mid-bright => the blue gradient. Everything else solid is ink.
    blue = solid & (lightness >= NAVY_LIGHTNESS) & (rgb[:, :, 2] > rgb[:, :, 0] + 0.12)
    navy = solid & ~blue
    return blue, navy


def largest_region(mask: np.ndarray) -> list[np.ndarray]:
    """Split a mask into connected components, largest first (4-connected)."""
    labels = np.zeros(mask.shape, dtype=np.int32)
    current = 0
    regions: list[np.ndarray] = []
    h, w = mask.shape
    for sy in range(h):
        for sx in range(w):
            if not mask[sy, sx] or labels[sy, sx]:
                continue
            current += 1
            stack = [(sy, sx)]
            labels[sy, sx] = current
            pixels = 0
            while stack:
                y, x = stack.pop()
                pixels += 1
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                        labels[ny, nx] = current
                        stack.append((ny, nx))
            if pixels > 64:
                regions.append(labels == current)
    regions.sort(key=lambda r: int(r.sum()), reverse=True)
    return regions


def trace(mask: np.ndarray) -> list[tuple[float, float]]:
    """Moore-neighbour boundary trace of a filled binary region."""
    ys, xs = np.nonzero(mask)
    start = (int(ys.min()), int(xs[ys == ys.min()].min()))
    h, w = mask.shape

    def solid(y: int, x: int) -> bool:
        return 0 <= y < h and 0 <= x < w and bool(mask[y, x])

    # 8-neighbourhood, clockwise from "west".
    nbrs = [(0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1)]
    contour = [start]
    cur, back = start, 0
    guard = 0
    while guard < 4_000_000:
        guard += 1
        found = False
        for k in range(8):
            i = (back + k) % 8
            dy, dx = nbrs[i]
            cand = (cur[0] + dy, cur[1] + dx)
            if solid(*cand):
                back = (i + 5) % 8
                cur = cand
                contour.append(cur)
                found = True
                break
        if not found or (len(contour) > 2 and cur == start):
            break
    return [(float(x), float(y)) for y, x in contour]


def rdp(points: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    """Douglas-Peucker polyline simplification."""
    if len(points) < 3:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    seg = b - a
    length = float(np.hypot(*seg))
    pts = np.array(points)
    if length == 0:
        dist = np.hypot(*(pts - a).T)
    else:
        rel = pts - a
        dist = np.abs(seg[0] * rel[:, 1] - seg[1] * rel[:, 0]) / length
    idx = int(dist.argmax())
    if dist[idx] > eps:
        left = rdp(points[: idx + 1], eps)
        right = rdp(points[idx:], eps)
        return left[:-1] + right
    return [points[0], points[-1]]


def to_path(points: list[tuple[float, float]], sx: float, sy: float, ox: float, oy: float) -> str:
    out = []
    for i, (x, y) in enumerate(points):
        px, py = x * sx + ox, y * sy + oy
        out.append(f"{'M' if i == 0 else 'L'}{px:.1f} {py:.1f}")
    return "".join(out) + "Z"


def main() -> None:
    sys.setrecursionlimit(50_000)
    img = clean_mark()
    blue, navy = masks(img)
    w, h = img.size

    # Fit the artwork into the square viewBox, centred, with a little padding.
    pad = 0.04 * VIEW
    scale = min((VIEW - 2 * pad) / w, (VIEW - 2 * pad) / h)
    ox = (VIEW - w * scale) / 2
    oy = (VIEW - h * scale) / 2

    def paths_for(mask: np.ndarray, limit: int) -> list[str]:
        out = []
        for region in largest_region(mask)[:limit]:
            pts = rdp(trace(region), EPSILON / scale)
            if len(pts) >= 3:
                out.append(to_path(pts, scale, scale, ox, oy))
        return out

    blue_paths = paths_for(blue, 2)   # two blue chevrons
    navy_paths = paths_for(navy, 1)   # one navy chevron

    def build(ink: str, grad_id: str) -> str:
        parts = [
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512"'
            ' height="512" role="img" aria-label="Xacheus">',
            "  <defs>",
            f'    <linearGradient id="{grad_id}" x1="0" y1="0" x2="1" y2="1">',
            '      <stop offset="0" stop-color="#1990f2"/>',
            '      <stop offset="1" stop-color="#0546e0"/>',
            "    </linearGradient>",
            "  </defs>",
            f'  <g fill="{ink}">',
        ]
        parts += [f'    <path d="{d}"/>' for d in navy_paths]
        parts.append("  </g>")
        parts.append(f'  <g fill="url(#{grad_id})">')
        parts += [f'    <path d="{d}"/>' for d in blue_paths]
        parts.append("  </g>")
        parts.append("</svg>")
        return "\n".join(parts) + "\n"

    # Two ink variants: the navy half is invisible on the app's dark chrome,
    # so the dark-surface build lifts it to the app foreground colour.
    OUT.write_text(build("#0e1e33", "xb"), encoding="utf-8")
    OUT_DARK.write_text(build("#e9ecf5", "xb"), encoding="utf-8")
    for f in (OUT, OUT_DARK):
        print(f"wrote {f.relative_to(ROOT)}  ({f.stat().st_size} bytes, "
              f"{len(navy_paths)} navy + {len(blue_paths)} blue paths)")


if __name__ == "__main__":
    main()
