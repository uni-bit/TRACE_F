"""Trace modeled slab footprints from the cyan outlines in registered crops."""

from __future__ import annotations

import json

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .common import ROOT, building_debug_dir, cyan_mask


def _closed_cyan_mask(crop: np.ndarray, config: dict) -> np.ndarray:
    """Close gaps in every direction without letting crop edges inflate the mask."""
    params = config["footprintTrace"]
    close_px = int(params["closePx"])
    if close_px < 1:
        raise ValueError("footprintTrace.closePx must be positive")
    mask = cyan_mask(crop, config["cyan"]).astype(np.uint8) * 255
    padded = cv2.copyMakeBorder(
        mask,
        close_px,
        close_px,
        close_px,
        close_px,
        cv2.BORDER_CONSTANT,
        value=0,
    )
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (close_px, close_px))
    closed = cv2.morphologyEx(padded, cv2.MORPH_CLOSE, kernel)
    return closed[close_px:-close_px, close_px:-close_px]


def _candidate_contours(mask: np.ndarray, params: dict) -> list[np.ndarray]:
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    minimum = float(params["minContourAreaPx"])
    return sorted(
        (contour for contour in contours if cv2.contourArea(contour) >= minimum),
        key=cv2.contourArea,
        reverse=True,
    )


def _approximate(contour: np.ndarray, params: dict) -> list[list[int]]:
    perimeter = cv2.arcLength(contour, closed=True)
    epsilon = float(params["approxEpsilonFrac"])
    if epsilon <= 0:
        raise ValueError("footprintTrace.approxEpsilonFrac must be positive")
    maximum = int(params["maxVertices"])
    if maximum < 3:
        raise ValueError("footprintTrace.maxVertices must be at least 3")
    while True:
        approximated = cv2.approxPolyDP(contour, epsilon * perimeter, closed=True)
        if len(approximated) <= maximum:
            break
        epsilon *= 1.35
    return [[int(point[0][0]), int(point[0][1])] for point in approximated]


def trace_floor_footprints(
    config: dict,
    crops: dict[str, np.ndarray],
    debug: bool = False,
) -> dict[str, list[list[int]]]:
    """Trace every configured floor and replace only this target's footprints."""
    params = config["footprintTrace"]
    traced: dict[str, list[list[int]]] = {}
    closed_masks: dict[str, np.ndarray] = {}
    for floor, crop in sorted(crops.items(), key=lambda item: int(item[0])):
        closed = _closed_cyan_mask(crop, config)
        candidates = _candidate_contours(closed, params)
        if not candidates:
            raise RuntimeError(
                f'{config["id"]} {floor}F: no footprint contour reaches '
                f'{int(params["minContourAreaPx"]):,} px'
            )
        # These targets are already split spatially (including shared-west and
        # shared-east). Refuse to silently discard another slab-sized island.
        if len(candidates) > 1 and cv2.contourArea(candidates[1]) >= cv2.contourArea(candidates[0]) * 0.25:
            boxes = [cv2.boundingRect(contour) for contour in candidates]
            raise RuntimeError(
                f'{config["id"]} {floor}F: multiple footprint-sized contours remain; '
                f"split the target or add multi-polygon support: {boxes}"
            )
        traced[floor] = _approximate(candidates[0], params)
        closed_masks[floor] = closed

    feature_path = ROOT / config["featuresJson"]
    with open(feature_path, encoding="utf-8") as handle:
        features = json.load(handle)
    reference = config["referenceFloor"]
    footprints = {"default": traced[reference]}
    footprints.update({floor: points for floor, points in traced.items() if floor != reference})
    features["footprints"] = footprints
    with open(feature_path, "w", encoding="utf-8") as handle:
        json.dump(features, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(f"  footprint trace ({feature_path.relative_to(ROOT)})")
    for floor, points in traced.items():
        xs = [point[0] for point in points]
        ys = [point[1] for point in points]
        print(
            f"    {floor}F: {len(points)} vertices, "
            f"bbox {min(xs)},{min(ys)} - {max(xs)},{max(ys)}"
        )

    if debug:
        debug_dir = building_debug_dir(config)
        debug_dir.mkdir(parents=True, exist_ok=True)
        for floor, closed in closed_masks.items():
            canvas = Image.fromarray(np.where(closed[..., None] > 0, 215, 255).astype(np.uint8).repeat(3, axis=2))
            draw = ImageDraw.Draw(canvas)
            draw.line([tuple(point) for point in traced[floor]] + [tuple(traced[floor][0])], fill=(225, 35, 35), width=3)
            canvas.save(debug_dir / f"footprint-trace-{floor}.png")
        print(f"    wrote {debug_dir}\\footprint-trace-*.png")
    return traced
