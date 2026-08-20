"""Trace surrounding-building footprints from the reference-floor context crop."""

from __future__ import annotations

import json

import cv2
import numpy as np
from PIL import Image

from .common import ROOT, building_debug_dir, cyan_mask


def _load_mapping(config: dict) -> dict:
    path = ROOT / config["contextTrace"]["featuresJson"]
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _erase(mask: np.ndarray, rect: dict) -> None:
    x0 = max(int(rect["x"]), 0)
    y0 = max(int(rect["y"]), 0)
    x1 = min(x0 + int(rect["w"]), mask.shape[1])
    y1 = min(y0 + int(rect["h"]), mask.shape[0])
    if x1 > x0 and y1 > y0:
        mask[y0:y1, x0:x1] = 0


def _candidate_contours(mask: np.ndarray, params: dict) -> list[np.ndarray]:
    close_px = int(params["closePx"])
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (close_px, close_px))
    closed = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [contour for contour in contours if cv2.contourArea(contour) >= params["minContourAreaPx"]]


def _approximate(contour: np.ndarray, params: dict) -> list[list[int]]:
    perimeter = cv2.arcLength(contour, closed=True)
    epsilon = float(params["approxEpsilonFrac"])
    approximated = contour
    while True:
        approximated = cv2.approxPolyDP(contour, epsilon * perimeter, closed=True)
        if len(approximated) <= int(params["maxVertices"]):
            break
        epsilon *= 1.35
    return [[int(point[0][0]), int(point[0][1])] for point in approximated]


def trace_context(config: dict, crop: np.ndarray, debug: bool = False) -> dict:
    params = config["contextTrace"]
    mapping = _load_mapping(config)
    mask = cyan_mask(crop, config["cyan"]).astype(np.uint8) * 255

    master = config["masterRect"]
    context = config["contextRect"]
    _erase(
        mask,
        {
            "x": master["x"] - context["x"],
            "y": master["y"] - context["y"],
            "w": master["w"],
            "h": master["h"],
        },
    )
    for rect in config.get("contextEraserRects", []):
        _erase(mask, rect)

    contours = _candidate_contours(mask, params)
    selected: set[int] = set()
    neighbors = []
    for neighbor in mapping["neighbors"]:
        seed = tuple(neighbor["seed"])
        matches = [
            (index, contour)
            for index, contour in enumerate(contours)
            if cv2.pointPolygonTest(contour, seed, measureDist=False) >= 0
        ]
        if len(matches) != 1:
            boxes = [cv2.boundingRect(contour) for contour in contours]
            raise RuntimeError(
                f'context seed {neighbor["id"]} {seed} matched {len(matches)} contours; candidates={boxes}'
            )
        index, contour = matches[0]
        if index in selected:
            raise RuntimeError(f'context contour for {neighbor["id"]} was already assigned')
        selected.add(index)
        neighbors.append({"id": neighbor["id"], "footprint": _approximate(contour, params)})

    generated = {
        "schemaVersion": 1,
        "buildingId": mapping["buildingId"],
        "coordinateSpace": "context-rect-px",
        "contextRect": context,
        "neighbors": neighbors,
    }
    output = ROOT / params["geometryJson"]
    output.parent.mkdir(parents=True, exist_ok=True)
    with open(output, "w", encoding="utf-8") as handle:
        json.dump(generated, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"    {output.relative_to(ROOT)} ({len(neighbors)} surrounding buildings)")

    if debug:
        debug_dir = building_debug_dir(config)
        debug_dir.mkdir(parents=True, exist_ok=True)
        Image.fromarray(mask).save(debug_dir / "context-mask.png")
    return generated
