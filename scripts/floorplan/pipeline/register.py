"""Stage 2: register every floor page against the reference floor.

The diary prints all six floors at the same scale with no rotation, but the
drawing block moves page to page (odd/even booklet margins; 1F/2F are merged
multi-building complexes laid out differently). Whole-page or whole-rect
correlation is unreliable: page furniture repeats at identical positions and
1F/2F share too little drawing with the reference floor.

What *is* invariant on every floor are the classroom building's stair cores —
though not all of them: 1F lacks the twin-stair core (entrance level) and 2F
has it at a different position. Registration therefore matches several small
stair-core templates (reference-page coordinates in config), keeps the top few
peaks of each, and looks for the best-scoring *cluster* of peaks from at least
two different templates that agree on one shift. Lookalike stairs of the other
buildings printed on the same page produce isolated peaks that never cluster.
A phase correlation over a window on the building's shared structure then
refines the winning shift.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from .common import building_debug_dir, cyan_mask, phase_correlate

Image.MAX_IMAGE_PIXELS = None

MAX_SHIFT_PX = 700
BLUR_SIGMA = 2.0
TEMPLATE_MIN_SCORE = 0.4
TEMPLATE_TOP_PEAKS = 5
NMS_RADIUS_PX = 80
CLUSTER_TOLERANCE_PX = 48  # residual is absorbed by the refine correlation
MAX_REFINE_PX = 48


def load_page(path) -> np.ndarray:
    return np.asarray(Image.open(path).convert("RGB"))


def register_floors(
    config: dict, pages: dict[str, np.ndarray], debug: bool = False
) -> dict[str, tuple[int, int]]:
    """Return floor id -> (dx, dy): content position on that page relative to the reference page."""
    ref_floor = config["referenceFloor"]
    win = config["refineWindow"]

    masks = {floor: cyan_mask(page, config["cyan"]) for floor, page in pages.items()}
    blurred = {
        floor: cv2.GaussianBlur(mask.astype(np.float32), (0, 0), BLUR_SIGMA)
        for floor, mask in masks.items()
    }
    ref_mask = masks[ref_floor]
    ref_win = ref_mask[win["y"] : win["y"] + win["h"], win["x"] : win["x"] + win["w"]]
    templates = [
        (t, blurred[ref_floor][t["y"] : t["y"] + t["h"], t["x"] : t["x"] + t["w"]].copy())
        for t in config["templates"]
    ]

    shifts: dict[str, tuple[int, int]] = {}
    overrides = config.get("manualShiftOverride", {})
    print(f"  registration (reference: {ref_floor}F)")
    for floor, mask in masks.items():
        if floor in overrides:
            dx, dy = overrides[floor]
            shifts[floor] = (dx, dy)
            print(f"    {floor}F: manual override dx={dx:+d} dy={dy:+d}")
            continue
        if floor == ref_floor:
            shifts[floor] = (0, 0)
            print(f"    {floor}F: reference")
            continue

        cdx, cdy, detail = _template_shift(blurred[floor], templates)
        tgt_win = mask[
            win["y"] + cdy : win["y"] + cdy + win["h"],
            win["x"] + cdx : win["x"] + cdx + win["w"],
        ]
        if tgt_win.shape != ref_win.shape:
            raise ValueError(
                f"floor {floor}: refine window leaves the page after template shift "
                f"({cdx:+d},{cdy:+d}) — check templates or set manualShiftOverride"
            )
        rdx, rdy, rpeak = phase_correlate(ref_win, tgt_win)
        if abs(rdx) > MAX_REFINE_PX or abs(rdy) > MAX_REFINE_PX:
            print(
                f"    {floor}F: WARNING refine ({rdx:+d},{rdy:+d}) exceeds "
                f"±{MAX_REFINE_PX}px; keeping the template-cluster shift"
            )
            rdx, rdy = 0, 0
        dx, dy = cdx + rdx, cdy + rdy
        shifts[floor] = (dx, dy)
        print(
            f"    {floor}F: templates [{detail}] -> ({cdx:+5d},{cdy:+5d})"
            f"  refine ({rdx:+3d},{rdy:+3d}) peak {rpeak:.3f}  -> dx={dx:+d} dy={dy:+d}"
        )

    if debug:
        _write_overlay(config, masks, shifts)
    return shifts


def _template_shift(
    tgt: np.ndarray, templates: list[tuple[dict, np.ndarray]]
) -> tuple[int, int, str]:
    """Find the shift where peaks from at least two different templates coincide."""
    peaks_per_template: list[list[tuple[int, int, float]]] = []
    for t, tpl in templates:
        res = _masked_match(tgt, tpl)
        peaks: list[tuple[int, int, float]] = []
        for _ in range(TEMPLATE_TOP_PEAKS):
            _, score, _, loc = cv2.minMaxLoc(res)
            if score < TEMPLATE_MIN_SCORE:
                break
            dx, dy = loc[0] - t["x"], loc[1] - t["y"]
            if abs(dx) <= MAX_SHIFT_PX and abs(dy) <= MAX_SHIFT_PX:
                peaks.append((dx, dy, float(score)))
            x0, y0 = max(loc[0] - NMS_RADIUS_PX, 0), max(loc[1] - NMS_RADIUS_PX, 0)
            res[y0 : loc[1] + NMS_RADIUS_PX, x0 : loc[0] + NMS_RADIUS_PX] = -1.0
        peaks_per_template.append(peaks)

    best: tuple[float, float, float, int] | None = None
    for i, seed_peaks in enumerate(peaks_per_template):
        for seed in seed_peaks:
            members = [seed]
            for j, other in enumerate(peaks_per_template):
                if j == i:
                    continue
                near = [
                    p
                    for p in other
                    if abs(p[0] - seed[0]) <= CLUSTER_TOLERANCE_PX
                    and abs(p[1] - seed[1]) <= CLUSTER_TOLERANCE_PX
                ]
                if near:
                    members.append(max(near, key=lambda p: p[2]))
            if len(members) < 2:
                continue
            total = sum(p[2] for p in members)
            if best is None or total > best[0]:
                dx = sum(p[0] * p[2] for p in members) / total
                dy = sum(p[1] * p[2] for p in members) / total
                best = (total, dx, dy, len(members))

    if best is None:
        flat = "; ".join(
            f"{templates[i][0]['name']}: " + " ".join(f"({p[0]:+d},{p[1]:+d} s={p[2]:.2f})" for p in peaks)
            for i, peaks in enumerate(peaks_per_template)
        )
        raise ValueError(
            f"no two stair-core templates agree on a shift — set manualShiftOverride. Peaks: {flat}"
        )
    total, dx, dy, size = best
    return int(round(dx)), int(round(dy)), f"cluster {size}/{len(templates)} score {total:.2f}"


def _masked_match(tgt: np.ndarray, tpl: np.ndarray) -> np.ndarray:
    """TM_CCOEFF_NORMED with degenerate windows suppressed.

    On near-empty (ink-free) windows the normalized coefficient is numerically
    unstable and spikes to ±1; require a window to hold at least a quarter of
    the template's ink before its score counts.
    """
    res = cv2.matchTemplate(tgt, tpl, cv2.TM_CCOEFF_NORMED)
    ink = cv2.boxFilter(
        tgt, -1, (tpl.shape[1], tpl.shape[0]), anchor=(0, 0), normalize=False
    )[: res.shape[0], : res.shape[1]]
    res = np.clip(res, -1.0, 1.0)
    res[ink < 0.25 * float(tpl.sum())] = -1.0
    return res


def _write_overlay(config, masks, shifts) -> None:
    """Stack all aligned floor masks (master rect region) into one color-coded image."""
    rect = config["masterRect"]
    colors = [
        (255, 80, 80), (255, 170, 40), (80, 220, 80), (60, 170, 255),
        (190, 110, 255), (255, 230, 60), (80, 230, 220), (255, 110, 190),
    ]
    canvas = np.zeros((rect["h"], rect["w"], 3), dtype=np.float32)
    for index, (floor, mask) in enumerate(masks.items()):
        dx, dy = shifts[floor]
        x, y = rect["x"] + dx, rect["y"] + dy
        win = np.zeros((rect["h"], rect["w"]), dtype=bool)
        x0, y0 = max(x, 0), max(y, 0)
        x1 = min(x + rect["w"], mask.shape[1])
        y1 = min(y + rect["h"], mask.shape[0])
        if x1 > x0 and y1 > y0:
            win[y0 - y : y1 - y, x0 - x : x1 - x] = mask[y0:y1, x0:x1]
        canvas[win] += np.array(colors[index % len(colors)], dtype=np.float32) * 0.45
    out = np.clip(canvas, 0, 255).astype(np.uint8)
    debug_dir = building_debug_dir(config)
    debug_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(out).save(debug_dir / "overlay-registration.png")
    print(f"    wrote {debug_dir / 'overlay-registration.png'}")
