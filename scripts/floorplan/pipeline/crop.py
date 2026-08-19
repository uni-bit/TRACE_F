"""Stage 3: crop every floor with the single master rect (shifted per floor).

The master rect is defined once in reference-page coordinates; each floor is
cropped at rect + that floor's registered shift. All floors therefore share one
coordinate system and one aspect ratio, and registration accuracy is never
baked into the output coordinates. Annotation text and neighbouring-building
fragments inside the rect are erased with white rects defined in master-rect
coordinates (shared or per floor).
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from .common import DEBUG_DIR, crop_padded


def crop_floors(
    config: dict,
    pages: dict[str, np.ndarray],
    shifts: dict[str, tuple[int, int]],
    debug: bool = False,
) -> dict[str, np.ndarray]:
    rect = config["masterRect"]
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
        if debug:
            DEBUG_DIR.mkdir(parents=True, exist_ok=True)
            Image.fromarray(crop).save(DEBUG_DIR / f"crop-{floor}.png")
    if debug:
        print(f"    wrote {DEBUG_DIR}\\crop-{{1..6}}.png")
    return crops
