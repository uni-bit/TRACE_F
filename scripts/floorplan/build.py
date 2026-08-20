"""Multi-building floorplan asset pipeline for the Toyosu campus 3D map.

Regenerates every building listed in config.json from the campus diary PDF.
See README.md in this directory for inputs and usage.

Usage:
    python scripts/floorplan/build.py [--debug] [--stage render|register|crop|context|walls|emit]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipeline.common import building_config, load_config
from pipeline.context import trace_context
from pipeline.crop import crop_floors
from pipeline.emit import emit
from pipeline.register import load_page, register_floors
from pipeline.render import render_pages, source_sha256
from pipeline.walls import extract_walls

STAGES = ["render", "register", "crop", "context", "walls", "emit"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--debug", action="store_true", help="write verification images to debug/")
    parser.add_argument("--stage", choices=STAGES, help="stop after this stage")
    args = parser.parse_args()
    last = STAGES.index(args.stage) if args.stage else len(STAGES) - 1

    config = load_config()

    source_hash = source_sha256(config)
    primary_id = config["buildings"][0]["id"]
    for building in config["buildings"]:
        scoped = building_config(config, building)
        print(f'[{building["id"]}] render')
        paths = render_pages(scoped)
        if last < 1:
            continue

        print(f'[{building["id"]}] register')
        pages = {floor: load_page(path) for floor, path in paths.items()}
        shifts = register_floors(scoped, pages, debug=args.debug)
        if last < 2:
            continue

        print(f'[{building["id"]}] crop')
        include_context = building["id"] == primary_id and "contextRect" in scoped
        crops, context_crop = crop_floors(
            scoped, pages, shifts, debug=args.debug, include_context=include_context
        )
        if last < 3:
            continue

        if context_crop is not None:
            print(f'[{building["id"]}] context')
            trace_context(scoped, context_crop, debug=args.debug)
        if last < 4:
            continue

        walls = extract_walls(scoped, crops, debug=args.debug)
        if last < 5:
            continue

        emit(scoped, crops, walls, shifts, source_hash)


if __name__ == "__main__":
    main()
