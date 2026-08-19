"""Floorplan asset pipeline for the Toyosu classroom building 3D map.

Regenerates everything under public/floorplans/classroom/ and the geometry
JSON in src/lib/map/ from the campus diary PDF. See README.md in this
directory for inputs and usage.

Usage:
    python scripts/floorplan/build.py [--debug] [--stage render|register|crop|walls|emit]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline.common import load_config
from pipeline.crop import crop_floors
from pipeline.emit import emit
from pipeline.register import load_page, register_floors
from pipeline.render import render_pages, source_sha256
from pipeline.walls import extract_walls

STAGES = ["render", "register", "crop", "walls", "emit"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--debug", action="store_true", help="write verification images to debug/")
    parser.add_argument("--stage", choices=STAGES, help="stop after this stage")
    args = parser.parse_args()
    last = STAGES.index(args.stage) if args.stage else len(STAGES) - 1

    config = load_config()

    print("render")
    paths = render_pages(config)
    if last < 1:
        return

    print("register")
    pages = {floor: load_page(path) for floor, path in paths.items()}
    shifts = register_floors(config, pages, debug=args.debug)
    if last < 2:
        return

    print("crop")
    crops = crop_floors(config, pages, shifts, debug=args.debug)
    if last < 3:
        return

    walls = extract_walls(config, crops, debug=args.debug)
    if last < 4:
        return

    emit(config, crops, walls, shifts, source_sha256(config))


if __name__ == "__main__":
    main()
