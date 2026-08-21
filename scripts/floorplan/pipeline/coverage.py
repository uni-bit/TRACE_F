"""Coverage gate for floor-plan source ink and modeled floor footprints."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

from .common import DEBUG_DIR, ROOT, cyan_mask
from .register import load_page


def floor_coverage_rows(config: dict, crops: dict[str, np.ndarray]) -> list[dict]:
    """Measure cyan ink outside each floor's modeled footprint."""
    with open(ROOT / config["featuresJson"], encoding="utf-8") as handle:
        footprints = json.load(handle)["footprints"]

    rows = []
    for floor, crop in sorted(crops.items(), key=lambda item: int(item[0])):
        points = footprints.get(floor, footprints["default"])
        footprint = np.zeros(crop.shape[:2], dtype=np.uint8)
        cv2.fillPoly(footprint, [np.asarray(points, dtype=np.int32)], 1)
        footprint_px = int(np.count_nonzero(footprint))
        footprint_pct = 100.0 * footprint_px / footprint.size
        # Footprints are deliberately measured on the wall centerline.  Count the
        # rendered stroke around that centerline as covered without inflating the
        # slab polygon itself to the wall's outer face.
        tolerance = int(config["coverage"].get("footprintBoundaryTolerancePx", 0))
        if tolerance < 0:
            raise ValueError("coverage.footprintBoundaryTolerancePx must be non-negative")
        if tolerance:
            size = tolerance * 2 + 1
            footprint = cv2.dilate(footprint, np.ones((size, size), dtype=np.uint8))
        ink = cyan_mask(crop, config["cyan"])
        cyan_px = int(np.count_nonzero(ink))
        outside_px = int(np.count_nonzero(ink & (footprint == 0)))
        outside_pct = 100.0 * outside_px / cyan_px if cyan_px else 0.0
        rows.append(
            {
                "building": config["name"],
                "buildingId": config["id"],
                "floor": floor,
                "cyanPx": cyan_px,
                "outsidePx": outside_px,
                "outsidePct": outside_pct,
                "footprintPx": footprint_px,
                "footprintPct": footprint_pct,
            }
        )
    return rows


def run_coverage_gate(
    config: dict,
    page_paths: dict[int, Path],
    placements: dict[int, list[dict]],
    floor_rows: list[dict],
) -> None:
    """Write both coverage tables, print them, and fail on uncovered page ink."""
    params = config["coverage"]
    page_rows = _page_coverage_rows(config, page_paths, placements)
    floor_limit = float(params["floorMaxOutsideFootprintPct"])
    area_limit = float(params["floorMaxFootprintAreaPct"])
    for row in floor_rows:
        warnings = []
        if row["outsidePct"] > floor_limit:
            warnings.append("outside")
        if row["footprintPct"] > area_limit:
            warnings.append("area")
        row["status"] = f"WARNING ({'+'.join(warnings)})" if warnings else "OK"

    page_table = _page_table(page_rows)
    floor_table = _floor_table(floor_rows, floor_limit, area_limit)
    report = (
        "# Floorplan coverage report\n\n"
        f"Page limit: {int(params['pageMaxUncoveredPx']):,} uncovered px, plus explicit accepted gaps.  "
        f"Floor warning limit: {floor_limit:g}%.  "
        f"Footprint area warning limit: {area_limit:g}% of its crop.  "
        f"Footprint boundary tolerance: {int(params.get('footprintBoundaryTolerancePx', 0))} px "
        "(measurement only; polygons remain on wall centerlines).\n\n"
        "## Page coverage\n\n"
        f"{page_table}\n\n"
        "## Floor footprint coverage\n\n"
        f"{floor_table}\n"
    )
    report_path = DEBUG_DIR / "coverage" / "report.md"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(report, encoding="utf-8")

    print("  page coverage")
    print(page_table)
    print("  floor footprint coverage")
    print(floor_table)
    print(f"    wrote {report_path}")

    failures = [row for row in page_rows if row["status"] == "FAIL"]
    if failures:
        pages = ", ".join(str(row["page"]) for row in failures)
        raise RuntimeError(
            f"coverage gate failed for page(s) {pages}; inspect {report_path} and "
            f"{report_path.parent / 'page-<n>.png'}"
        )


def _page_coverage_rows(
    config: dict, page_paths: dict[int, Path], placements: dict[int, list[dict]]
) -> list[dict]:
    limit = int(config["coverage"]["pageMaxUncoveredPx"])
    accepted = _accepted_gaps(config)
    rows = []
    for page_no, path in sorted(page_paths.items()):
        page = load_page(path)
        ink = cyan_mask(page, config["cyan"])
        furniture = _page_furniture_mask(page.shape[:2], page_no, config["pageFurniture"])
        covered = np.zeros(page.shape[:2], dtype=bool)
        for placement in placements.get(page_no, []):
            _fill_rect(covered, placement["rect"], True)

        relevant_ink = ink & ~furniture
        uncovered = relevant_ink & ~covered
        cyan_px = int(np.count_nonzero(relevant_ink))
        uncovered_px = int(np.count_nonzero(uncovered))
        gaps = accepted.get(page_no, [])
        accepted_px = sum(gap["px"] for gap in gaps)
        allowance = limit + accepted_px
        if uncovered_px <= limit:
            status = "PASS"
        elif uncovered_px <= allowance:
            status = "ACCEPTED"
        else:
            status = "FAIL"
            _write_page_debug(page, uncovered, placements.get(page_no, []), page_no)
        rows.append(
            {
                "page": page_no,
                "floor": _page_floor(placements.get(page_no, [])),
                "cyanPx": cyan_px,
                "uncoveredPx": uncovered_px,
                "uncoveredPct": 100.0 * uncovered_px / cyan_px if cyan_px else 0.0,
                "allowancePx": allowance,
                "status": status,
                "reason": "; ".join(gap["reason"] for gap in gaps) or "—",
            }
        )
    return rows


def _accepted_gaps(config: dict) -> dict[int, list[dict]]:
    result: dict[int, list[dict]] = {}
    for index, gap in enumerate(config["coverage"].get("acceptedGaps", [])):
        reason = str(gap.get("reason", "")).strip()
        if not reason:
            raise ValueError(f"coverage.acceptedGaps[{index}] requires a non-empty reason")
        px = gap.get("px")
        if not isinstance(px, int) or px < 0:
            raise ValueError(f"coverage.acceptedGaps[{index}].px must be a non-negative integer")
        page = gap.get("page")
        if not isinstance(page, int):
            raise ValueError(f"coverage.acceptedGaps[{index}].page must be an integer")
        result.setdefault(page, []).append({"px": px, "reason": reason})
    return result


def _page_furniture_mask(shape: tuple[int, int], page_no: int, entries: list[dict]) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    parity = "even" if page_no % 2 == 0 else "odd"
    for entry in entries:
        if entry.get("pageParity", parity) != parity:
            continue
        _fill_rect(mask, entry["rect"], True)
    return mask


def _fill_rect(mask: np.ndarray, rect: list[int] | dict, value: bool) -> None:
    if isinstance(rect, dict):
        x0, y0 = int(rect["x"]), int(rect["y"])
        x1, y1 = x0 + int(rect["w"]), y0 + int(rect["h"])
    else:
        x0, y0, x1, y1 = (int(value) for value in rect)
    x0, y0 = max(x0, 0), max(y0, 0)
    x1, y1 = min(x1, mask.shape[1]), min(y1, mask.shape[0])
    if x1 > x0 and y1 > y0:
        mask[y0:y1, x0:x1] = value


def _page_floor(placements: list[dict]) -> str:
    floors = sorted({placement["floor"] for placement in placements}, key=int)
    return "/".join(f"{floor}F" for floor in floors) or "—"


def _write_page_debug(
    page: np.ndarray, uncovered: np.ndarray, placements: list[dict], page_no: int
) -> None:
    canvas = (page.astype(np.float32) * 0.22 + 255.0 * 0.78).astype(np.uint8)
    canvas[uncovered] = (235, 35, 35)
    image = Image.fromarray(canvas)
    draw = ImageDraw.Draw(image)
    for placement in placements:
        rect = placement["rect"]
        x0, y0 = rect["x"], rect["y"]
        draw.rectangle((x0, y0, x0 + rect["w"], y0 + rect["h"]), outline=(35, 90, 235), width=6)
    out = DEBUG_DIR / "coverage" / f"page-{page_no}.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    print(f"    wrote {out}")


def _page_table(rows: list[dict]) -> str:
    lines = [
        "| Page | Floor | Cyan px | Uncovered px | Uncovered | Allowance px | Status | Accepted-gap reason |",
        "| ---: | :--- | ---: | ---: | ---: | ---: | :--- | :--- |",
    ]
    lines += [
        f"| {row['page']} | {row['floor']} | {row['cyanPx']:,} | {row['uncoveredPx']:,} | "
        f"{row['uncoveredPct']:.1f}% | {row['allowancePx']:,} | {row['status']} | {row['reason']} |"
        for row in rows
    ]
    return "\n".join(lines)


def _floor_table(rows: list[dict], outside_limit: float, area_limit: float) -> str:
    lines = [
        "| Building | Floor | Cyan px | Outside footprint px | Outside footprint | Footprint area | Status |",
        "| :--- | ---: | ---: | ---: | ---: | ---: | :--- |",
    ]
    for row in rows:
        lines.append(
            f"| {row['building']} | {row['floor']}F | {row['cyanPx']:,} | {row['outsidePx']:,} | "
            f"{row['outsidePct']:.1f}% | {row['footprintPct']:.1f}% | {row['status']} |"
        )
    building_ids = list(dict.fromkeys(row["buildingId"] for row in rows))
    for building_id in building_ids:
        building_rows = [row for row in rows if row["buildingId"] == building_id]
        outside_average = sum(row["outsidePct"] for row in building_rows) / len(building_rows)
        area_average = sum(row["footprintPct"] for row in building_rows) / len(building_rows)
        warnings = []
        if outside_average > outside_limit:
            warnings.append("outside")
        if area_average > area_limit:
            warnings.append("area")
        status = f"WARNING ({'+'.join(warnings)})" if warnings else "OK"
        lines.append(
            f"| {building_rows[0]['building']} | avg | — | — | {outside_average:.1f}% | "
            f"{area_average:.1f}% | {status} |"
        )
    return "\n".join(lines)
