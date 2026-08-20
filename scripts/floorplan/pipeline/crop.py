"""Stage 3: crop every floor into its building's registered master rectangle.

The master rect is defined once in reference-page coordinates; each floor is
cropped at rect + that floor's registered shift. All floors therefore share one
coordinate system and one aspect ratio, and registration accuracy is never
baked into the output coordinates. Annotation text and neighbouring-building
fragments inside the master rect are erased with white rects defined in
master-rect coordinates (shared or per floor).
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from .common import building_debug_dir, crop_padded, cyan_mask


def _has_long_edge_run(mask: np.ndarray, minimum: int = 40) -> bool:
    """Ignore clipped labels/dashes; warn only for a sustained building line."""
    for edge in (mask[0, :], mask[-1, :], mask[:, 0], mask[:, -1]):
        padded = np.pad(edge.astype(np.int8), (1, 1))
        changes = np.flatnonzero(np.diff(padded))
        if changes.size and int(np.max(changes[1::2] - changes[::2])) >= minimum:
            return True
    return False


def crop_floors(
    config: dict,
    pages: dict[str, np.ndarray],
    shifts: dict[str, tuple[int, int]],
    debug: bool = False,
) -> dict[str, np.ndarray]:
    rect = config["masterRect"]
    debug_dir = building_debug_dir(config)
    erasers = config.get("eraserRects", {})
    crops: dict[str, np.ndarray] = {}
    for floor, page in pages.items():
        dx, dy = shifts[floor]
        crop = crop_padded(page, rect["x"] + dx, rect["y"] + dy, rect["w"], rect["h"]).copy()
        for er in list(erasers.get("global", [])) + list(erasers.get("perFloor", {}).get(floor, [])):
            x0, y0 = max(er["x"], 0), max(er["y"], 0)
            x1, y1 = min(er["x"] + er["w"], rect["w"]), min(er["y"] + er["h"], rect["h"])
            if x1 > x0 and y1 > y0:
                crop[y0:y1, x0:x1] = 255
        crops[floor] = crop
        edge = cyan_mask(crop, config["cyan"])
        if _has_long_edge_run(edge):
            print(f"    WARNING {floor}F: cyan ink touches masterRect edge; expand the rect")
        if debug:
            debug_dir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(crop).save(debug_dir / f"crop-{floor}.png")
    if debug:
        print(f"    wrote {debug_dir}\\crop-*.png")
    return crops
