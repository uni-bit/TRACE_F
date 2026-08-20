"""Stage 3: crop every floor master plus one reference-floor context.

The master rect is defined once in reference-page coordinates; each floor is
cropped at rect + that floor's registered shift. All floors therefore share one
coordinate system and one aspect ratio, and registration accuracy is never
baked into the output coordinates. A larger context rect is cropped only from
the registered reference floor for surrounding-building tracing; it is never
fed to wall extraction. Annotation text and neighbouring-building fragments
inside the master rect are erased with white rects defined in master-rect
coordinates (shared or per floor).
"""

from __future__ import annotations

import numpy as np
from PIL import Image

from .common import building_debug_dir, crop_padded, cyan_mask


def crop_floors(
    config: dict,
    pages: dict[str, np.ndarray],
    shifts: dict[str, tuple[int, int]],
    debug: bool = False,
    include_context: bool = False,
) -> tuple[dict[str, np.ndarray], np.ndarray | None]:
    rect = config["masterRect"]
    context_rect = config.get("contextRect") if include_context else None
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
        if edge[0, :].any() or edge[-1, :].any() or edge[:, 0].any() or edge[:, -1].any():
            print(f"    WARNING {floor}F: cyan ink touches masterRect edge; expand the rect")
        if debug:
            debug_dir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(crop).save(debug_dir / f"crop-{floor}.png")
    if debug:
        print(f"    wrote {debug_dir}\\crop-*.png")
    context_crop = None
    if context_rect is not None:
        reference_floor = config["referenceFloor"]
        dx, dy = shifts[reference_floor]
        context_crop = crop_padded(
            pages[reference_floor],
            context_rect["x"] + dx,
            context_rect["y"] + dy,
            context_rect["w"],
            context_rect["h"],
        )
        if debug:
            Image.fromarray(context_crop).save(debug_dir / "context.png")
            print(f"    wrote {debug_dir}\\context.png ({reference_floor}F reference only)")
    return crops, context_crop
