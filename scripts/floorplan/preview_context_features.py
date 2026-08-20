"""Overlay neighbouring-building massing annotations on the context crop.

The polygons are intentionally coarse: this gate checks that each mass sits on
the correct surrounding building without touching the classroom master rect.

Usage:
    python scripts/floorplan/preview_context_features.py [--floor N]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEBUG_DIR = ROOT / "scripts" / "floorplan" / "debug"
FEATURES_PATH = ROOT / "src" / "lib" / "map" / "toyosu-context.features.json"
COLORS = [(226, 116, 255), (255, 156, 84), (88, 214, 181), (255, 214, 92)]


def render(floor: str, features: dict) -> None:
    image = Image.open(DEBUG_DIR / f"context-{floor}.png").convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for index, neighbor in enumerate(features["neighbors"]):
        color = COLORS[index % len(COLORS)]
        points = [tuple(point) for point in neighbor["footprint"]]
        draw.polygon(points, fill=color + (40,), outline=color + (255,), width=5)
        x, y = points[0]
        draw.text((x + 10, y + 10), f'{neighbor["id"]} / {neighbor["levels"]}F', fill=color + (255,))
    output = DEBUG_DIR / f"context-features-{floor}.png"
    Image.alpha_composite(image, overlay).convert("RGB").save(output)
    print(f"wrote {output.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--floor", default="1", help="context crop to use (default: 1)")
    args = parser.parse_args()
    with open(FEATURES_PATH, encoding="utf-8") as handle:
        features = json.load(handle)
    render(args.floor, features)


if __name__ == "__main__":
    main()
