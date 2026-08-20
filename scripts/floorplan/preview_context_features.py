"""Overlay traced neighbouring-building footprints on the reference context.

The polygons are intentionally coarse: this gate checks that each mass sits on
the correct surrounding building without touching the classroom master rect.

Usage:
    python scripts/floorplan/preview_context_features.py
"""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
DEBUG_DIR = ROOT / "scripts" / "floorplan" / "debug"
FEATURES_PATH = ROOT / "src" / "lib" / "map" / "toyosu-context.features.json"
GENERATED_PATH = ROOT / "src" / "lib" / "map" / "toyosu-context.generated.json"
COLORS = [(226, 116, 255), (255, 156, 84), (88, 214, 181), (255, 214, 92)]


def render(features: dict, generated: dict) -> None:
    image = Image.open(DEBUG_DIR / "context.png").convert("RGBA")
    overlay = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    generated_by_id = {neighbor["id"]: neighbor for neighbor in generated["neighbors"]}
    for index, neighbor in enumerate(features["neighbors"]):
        color = COLORS[index % len(COLORS)]
        points = [tuple(point) for point in generated_by_id[neighbor["id"]]["footprint"]]
        draw.polygon(points, fill=color + (40,), outline=color + (255,), width=5)
        x, y = points[0]
        draw.text((x + 10, y + 10), f'{neighbor["id"]} / {neighbor["levels"]}F', fill=color + (255,))
    output = DEBUG_DIR / "context-features.png"
    Image.alpha_composite(image, overlay).convert("RGB").save(output)
    print(f"wrote {output.relative_to(ROOT)}")


def main() -> None:
    with open(FEATURES_PATH, encoding="utf-8") as handle:
        features = json.load(handle)
    with open(GENERATED_PATH, encoding="utf-8") as handle:
        generated = json.load(handle)
    render(features, generated)


if __name__ == "__main__":
    main()
