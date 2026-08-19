"""Overlay the hand-maintained feature annotations onto the cropped floor plans.

Renders src/lib/map/toyosu-classroom.features.json (master-rect pixels) on top
of debug/crop-{floor}.png so annotation drift is caught in 2D before anything
reaches the 3D viewer. Not a build.py stage: features.json is hand-edited, not
generated, so re-running the pipeline neither breaks nor fixes it.

Usage:
    python scripts/floorplan/preview_features.py [--floor N]

Pass criteria (docs/floor-map-3d.md §10.5): magenta wash covering exactly the
floor's built area, yellow on stair hatches, orange on escalator lanes, red on
the chain-line X, blue on the EV box, green north edge on each classroom's top
wall — all within ±5px.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).resolve().parent))
from pipeline.common import DEBUG_DIR, ROOT

FEATURES_PATH = ROOT / "src" / "lib" / "map" / "toyosu-classroom.features.json"

COLORS = {
    "footprint": (200, 40, 220),
    "void": (235, 60, 60),
    "stairs": (240, 210, 40),
    "escalator": (250, 140, 40),
    "elevator": (70, 130, 250),
    "classroom": (60, 200, 90),
    "commons": (80, 200, 220),
}

ARROWS = {"+x": (1, 0), "-x": (-1, 0), "+z": (0, 1), "-z": (0, -1)}


def draw_arrow(draw: ImageDraw.ImageDraw, rect: list[int], axis: str, color) -> None:
    x0, y0, x1, y1 = rect
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    dx, dy = ARROWS[axis]
    length = min(x1 - x0, y1 - y0) * 0.35
    tip = (cx + dx * length, cy + dy * length)
    tail = (cx - dx * length, cy - dy * length)
    draw.line([tail, tip], fill=color, width=4)
    px, py = -dy, dx
    head = 7
    draw.polygon(
        [tip, (tip[0] - dx * head + px * head, tip[1] - dy * head + py * head),
         (tip[0] - dx * head - px * head, tip[1] - dy * head - py * head)],
        fill=color,
    )


def render_floor(floor_id: str, data: dict) -> None:
    crop_path = DEBUG_DIR / f"crop-{floor_id}.png"
    if not crop_path.exists():
        print(f"  {floor_id}F: {crop_path} not found — run build.py --debug first")
        return
    base = Image.open(crop_path).convert("RGB")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    footprint = data["footprints"].get(floor_id, data["footprints"]["default"])
    # Filled, not just stroked: a white hairline on white paper hides exactly the
    # errors this tool exists to catch (missing wings, phantom notches).
    draw.polygon(
        [tuple(p) for p in footprint],
        fill=COLORS["footprint"] + (36,),
        outline=COLORS["footprint"] + (255,),
        width=3,
    )

    floor = data["floors"].get(floor_id, {})

    for v in floor.get("voids", []):
        x0, y0, x1, y1 = v["rect"]
        draw.rectangle([x0, y0, x1, y1], fill=COLORS["void"] + (60,), outline=COLORS["void"] + (255,), width=3)
        draw.line([(x0, y0), (x1, y1)], fill=COLORS["void"] + (255,), width=2)
        draw.line([(x0, y1), (x1, y0)], fill=COLORS["void"] + (255,), width=2)

    for s in floor.get("stairs", []):
        draw.rectangle(s["rect"], fill=COLORS["stairs"] + (70,), outline=COLORS["stairs"] + (255,), width=3)
        draw_arrow(draw, s["rect"], s["up"], COLORS["stairs"] + (255,))

    for e in floor.get("escalators", []):
        x0, y0, x1, y1 = e["rect"]
        draw.rectangle(e["rect"], fill=COLORS["escalator"] + (70,), outline=COLORS["escalator"] + (255,), width=3)
        horizontal_run = e["up"] in ("+x", "-x")
        for lane in range(1, e["lanes"]):
            if horizontal_run:
                ly = y0 + (y1 - y0) * lane / e["lanes"]
                draw.line([(x0, ly), (x1, ly)], fill=COLORS["escalator"] + (255,), width=2)
            else:
                lx = x0 + (x1 - x0) * lane / e["lanes"]
                draw.line([(lx, y0), (lx, y1)], fill=COLORS["escalator"] + (255,), width=2)
        draw_arrow(draw, e["rect"], e["up"], COLORS["escalator"] + (255,))

    for band in floor.get("classrooms", []):
        x0, x1 = band["x"]
        facing = band.get("facing", "-z")
        for z0, z1 in band["rows"]:
            draw.rectangle([x0, z0, x1, z1], outline=COLORS["classroom"] + (230,), width=3)
            if facing == "-z":
                draw.line([(x0, z0), (x1, z0)], fill=COLORS["classroom"] + (255,), width=7)
            elif facing == "+z":
                draw.line([(x0, z1), (x1, z1)], fill=COLORS["classroom"] + (255,), width=7)
            elif facing == "-x":
                draw.line([(x0, z0), (x0, z1)], fill=COLORS["classroom"] + (255,), width=7)
            else:
                draw.line([(x1, z0), (x1, z1)], fill=COLORS["classroom"] + (255,), width=7)

    # Commons are invented zones, not plan symbols: the pass criterion is only
    # that they stay on walkable floor (inside the footprint, clear of voids,
    # cores and classroom rows), not that they match any drawn feature.
    for c in floor.get("commons", []):
        x0, y0, x1, y1 = c["rect"]
        draw.rectangle(c["rect"], fill=COLORS["commons"] + (44,), outline=COLORS["commons"] + (255,), width=3)
        draw.text(((x0 + x1) / 2 - 4, (y0 + y1) / 2 - 6), c["kind"][0].upper(), fill=COLORS["commons"] + (255,))

    for ev in data.get("elevators", []):
        lo, hi = ev["levels"]
        if lo <= int(floor_id) <= hi:
            draw.rectangle(ev["rect"], fill=COLORS["elevator"] + (70,), outline=COLORS["elevator"] + (255,), width=3)

    out = Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")
    out_path = DEBUG_DIR / f"features-{floor_id}.png"
    out.save(out_path)
    print(f"  wrote {out_path.relative_to(ROOT)}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--floor", help="render a single floor (1..6); default all")
    args = parser.parse_args()

    with open(FEATURES_PATH, encoding="utf-8") as f:
        data = json.load(f)

    floors = [args.floor] if args.floor else sorted(data["floors"].keys(), key=int)
    for floor_id in floors:
        render_floor(floor_id, data)


if __name__ == "__main__":
    main()
