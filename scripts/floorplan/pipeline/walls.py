"""Stage 4: extract axis-aligned wall segments from each cropped floor plan.

Order matters: small connected components (room labels, dashed leader lines,
symbols) are removed *before* directional gap-closing, so dashes can never fuse
into fake walls. What survives is opened with a long directional kernel, and
each remaining component becomes one centerline segment — a thick wall stroke
yields exactly one segment instead of one per pixel row.
"""

from __future__ import annotations

import cv2
import numpy as np
from PIL import Image

from .common import DEBUG_DIR, cyan_mask

Segment = tuple[float, float, float, float]  # x1, z1, x2, z2 normalized to ±0.5


def extract_walls(config: dict, crops: dict[str, np.ndarray], debug: bool = False) -> dict[str, list[Segment]]:
    params = config["walls"]
    rect = config["masterRect"]
    min_seg_px = int(rect["w"] * params["minSegmentFrac"])
    results: dict[str, list[Segment]] = {}
    print("  wall extraction")
    for floor, crop in crops.items():
        mask = cyan_mask(crop, config["cyan"]).astype(np.uint8)
        cleaned = _remove_small_components(mask, params)
        segments: list[tuple[int, int, int, int]] = []
        for horizontal in (True, False):
            segments += _directional_segments(cleaned, params, min_seg_px, horizontal)
        segments = _merge_parallel(segments, params["mergeParallelPx"])
        results[floor] = [_normalize(s, rect) for s in segments]
        h_count = sum(1 for s in segments if s[3] == s[1])
        print(f"    {floor}F: {len(segments)} segments ({h_count} horizontal, {len(segments) - h_count} vertical)")
        if debug:
            _write_overlay(floor, crop, segments)
    return results


def _remove_small_components(mask: np.ndarray, params: dict) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    keep = np.zeros(count, dtype=bool)
    for i in range(1, count):
        w, h, area = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT], stats[i, cv2.CC_STAT_AREA]
        keep[i] = max(w, h) >= params["minComponentSide"] or area >= params["minComponentArea"]
    return keep[labels].astype(np.uint8)


def _directional_segments(
    mask: np.ndarray, params: dict, min_seg_px: int, horizontal: bool
) -> list[tuple[int, int, int, int]]:
    gap = params["closeGapPx"]
    run = params["minRunPx"]
    close_kernel = np.ones((1, gap) if horizontal else (gap, 1), np.uint8)
    open_kernel = np.ones((1, run) if horizontal else (run, 1), np.uint8)
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, close_kernel)
    opened = cv2.morphologyEx(closed, cv2.MORPH_OPEN, open_kernel)
    count, _, stats, _ = cv2.connectedComponentsWithStats(opened, connectivity=8)
    segments = []
    for i in range(1, count):
        x, y = stats[i, cv2.CC_STAT_LEFT], stats[i, cv2.CC_STAT_TOP]
        w, h = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
        if horizontal:
            if w < min_seg_px:
                continue
            cy = y + h // 2
            segments.append((x, cy, x + w, cy))
        else:
            if h < min_seg_px:
                continue
            cx = x + w // 2
            segments.append((cx, y, cx, y + h))
    return segments


def _merge_parallel(
    segments: list[tuple[int, int, int, int]], tolerance: int
) -> list[tuple[int, int, int, int]]:
    """Fuse pairs of near-identical parallel segments (double-stroked lines)."""
    merged: list[tuple[int, int, int, int]] = []
    used = [False] * len(segments)
    for i, seg in enumerate(segments):
        if used[i]:
            continue
        x1, y1, x2, y2 = seg
        horizontal = y1 == y2
        for j in range(i + 1, len(segments)):
            if used[j]:
                continue
            ox1, oy1, ox2, oy2 = segments[j]
            if horizontal != (oy1 == oy2):
                continue
            if horizontal:
                if abs(oy1 - y1) > tolerance:
                    continue
                overlap = min(x2, ox2) - max(x1, ox1)
                if overlap < 0.7 * min(x2 - x1, ox2 - ox1):
                    continue
                x1, x2 = min(x1, ox1), max(x2, ox2)
                y1 = y2 = (y1 + oy1) // 2
            else:
                if abs(ox1 - x1) > tolerance:
                    continue
                overlap = min(y2, oy2) - max(y1, oy1)
                if overlap < 0.7 * min(y2 - y1, oy2 - oy1):
                    continue
                y1, y2 = min(y1, oy1), max(y2, oy2)
                x1 = x2 = (x1 + ox1) // 2
            used[j] = True
        merged.append((x1, y1, x2, y2))
    return merged


def _normalize(seg: tuple[int, int, int, int], rect: dict) -> Segment:
    x1, y1, x2, y2 = seg
    return (
        round(x1 / rect["w"] - 0.5, 4),
        round(y1 / rect["h"] - 0.5, 4),
        round(x2 / rect["w"] - 0.5, 4),
        round(y2 / rect["h"] - 0.5, 4),
    )


def _write_overlay(floor: str, crop: np.ndarray, segments: list[tuple[int, int, int, int]]) -> None:
    canvas = crop.copy()
    for x1, y1, x2, y2 in segments:
        cv2.line(canvas, (x1, y1), (x2, y2), (230, 40, 40), thickness=3)
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas).save(DEBUG_DIR / f"walls-over-texture-{floor}.png")
