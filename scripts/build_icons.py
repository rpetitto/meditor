#!/usr/bin/env python3
"""Build the extension icons from assets/logo-source.png.

Removes the flat grey backdrop around the shield (flood fill from the edges),
crops to the shield, pads to a square and writes 16/32/48/128 px icons plus a
256 px copy used in the popup / options header.

    python3 scripts/build_icons.py
"""
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "extension" / "icons"
SRC = ROOT / "assets" / "logo-source.png"


def remove_backdrop(img: Image.Image) -> Image.Image:
    a = np.asarray(img.convert("RGBA")).astype(np.int16)
    h, w = a.shape[:2]
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    neutral = (np.abs(r - g) < 14) & (np.abs(g - b) < 14)
    value = (r + g + b) / 3
    # Backdrop = neutral grey/black pixels that are clearly darker than the shield's white rim.
    candidate = neutral & (value < 238)

    bg = np.zeros((h, w), bool)
    q = deque()
    for x in range(w):
        q.append((0, x)); q.append((h - 1, x))
    for y in range(h):
        q.append((y, 0)); q.append((y, w - 1))
    while q:
        y, x = q.popleft()
        if bg[y, x] or not candidate[y, x]:
            continue
        bg[y, x] = True
        if y > 0: q.append((y - 1, x))
        if y < h - 1: q.append((y + 1, x))
        if x > 0: q.append((y, x - 1))
        if x < w - 1: q.append((y, x + 1))

    out = a.copy()
    out[..., 3] = np.where(bg, 0, 255)

    # Soften the anti-aliased seam: pixels next to the backdrop get alpha from how
    # close they are to white (the rim colour) versus the backdrop grey.
    grey = np.median(value[bg]) if bg.any() else 225
    edge = np.zeros_like(bg)
    edge[1:, :] |= bg[:-1, :]; edge[:-1, :] |= bg[1:, :]
    edge[:, 1:] |= bg[:, :-1]; edge[:, :-1] |= bg[:, 1:]
    edge &= ~bg
    t = np.clip((value - grey) / max(1, 255 - grey), 0, 1)
    out[..., 3] = np.where(edge & neutral, (t * 255).astype(np.int16), out[..., 3])
    out[..., :3] = np.where((edge & neutral)[..., None], 255, out[..., :3])
    return Image.fromarray(out.clip(0, 255).astype(np.uint8), "RGBA")


def square_crop(img: Image.Image, pad_ratio: float = 0.02) -> Image.Image:
    bbox = img.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox()
    img = img.crop(bbox)
    side = int(max(img.size) * (1 + 2 * pad_ratio))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
    return canvas


def main() -> None:
    logo = square_crop(remove_backdrop(Image.open(SRC)))
    for size in (16, 32, 48, 128, 256):
        icon = logo.resize((size, size), Image.Resampling.LANCZOS)
        name = "logo.png" if size == 256 else f"icon{size}.png"
        icon.save(ICONS / name, optimize=True)
        print("wrote", ICONS / name)


if __name__ == "__main__":
    main()
