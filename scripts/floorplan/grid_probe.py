"""Coordinate probe for hand-measuring feature rects on a floor crop.

The annotations in src/lib/map/toyosu-classroom.features.json are written in
master-rect pixels, read off debug/crop-{floor}.png by eye. Eyeballing is how
the 4F atrium ended up 80px too tall, so measure with this instead: it blows a
region up and rules a labelled 25px grid over it.

    python scripts/floorplan/grid_probe.py 4 300 640 500 1290 2

writes debug/grid-4.png. Read the four edges of the symbol straight off the
labels, and take the *centre* of a wall line, not its outer face.
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEBUG = ROOT / "scripts/floorplan/debug"
GRID_PX = 25


def main(argv: list[str]) -> int:
    if len(argv) not in (6, 7):
        print(__doc__)
        return 2
    floor = argv[1]
    x0, y0, x1, y1 = (int(v) for v in argv[2:6])
    scale = int(argv[6]) if len(argv) == 7 else 2

    crop = Image.open(DEBUG / f"crop-{floor}.png").convert("RGB")
    img = crop.crop((x0, y0, x1, y1)).resize(((x1 - x0) * scale, (y1 - y0) * scale), Image.LANCZOS)
    draw = ImageDraw.Draw(img)

    for px in range(x0 - x0 % GRID_PX, x1 + GRID_PX, GRID_PX):
        if px < x0:
            continue
        x = (px - x0) * scale
        draw.line([(x, 0), (x, img.height)], fill=(255, 120, 120), width=1)
        draw.text((x + 2, 2), str(px), fill=(210, 0, 0))
    for py in range(y0 - y0 % GRID_PX, y1 + GRID_PX, GRID_PX):
        if py < y0:
            continue
        y = (py - y0) * scale
        draw.line([(0, y), (img.width, y)], fill=(120, 160, 255), width=1)
        draw.text((2, y + 2), str(py), fill=(0, 0, 200))

    out = DEBUG / f"grid-{floor}.png"
    img.save(out)
    print(f"wrote {out} ({img.width}x{img.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
