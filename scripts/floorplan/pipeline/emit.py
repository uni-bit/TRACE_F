"""Stage 5: write floor textures and the generated geometry JSON."""

from __future__ import annotations

import json
from datetime import date

import numpy as np
from PIL import Image

from .common import ROOT


def _blueprint_rgba(rgb: np.ndarray, params: dict) -> np.ndarray:
    """White paper -> transparent, ink -> lightened color.

    The 3D map renders floors on a dark stage; an opaque white plan reads as a
    blank card. Alpha from darkness keeps only the drawn ink, and lightening
    keeps black label text legible against the dark background.
    """
    lum = rgb.astype(np.float32).mean(axis=2) / 255.0
    alpha = np.clip((1.0 - lum) * params["alphaGain"], 0.0, 1.0) * 255.0
    lighten = params["inkLighten"]
    out_rgb = 255.0 - (255.0 - rgb.astype(np.float32)) * (1.0 - lighten)
    rgba = np.dstack([out_rgb, alpha]).astype(np.uint8)
    return rgba


def emit(
    config: dict,
    crops: dict[str, np.ndarray],
    walls: dict[str, list],
    shifts: dict[str, tuple[int, int]],
    pdf_sha256: str | None,
) -> None:
    out = config["output"]
    texture_dir = ROOT / out["textureDir"]
    texture_dir.mkdir(parents=True, exist_ok=True)
    rect = config["masterRect"]

    floors = []
    print("  emit")
    for floor in sorted(crops, key=int):
        name = out["texturePattern"].format(floor=floor)
        img = Image.fromarray(_blueprint_rgba(crops[floor], config["texture"]))
        path = texture_dir / name
        img.save(path, optimize=True)
        print(f"    {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB, {len(walls[floor])} wall segments)")
        floors.append(
            {
                "id": floor,
                "level": int(floor),
                "texture": f"/{out['textureDir'].split('/', 1)[1]}/{name}"
                if out["textureDir"].startswith("public/")
                else f"/{name}",
                "walls": walls[floor],
            }
        )

    geometry = {
        "schemaVersion": 1,
        "buildingId": out["buildingId"],
        "generated": {
            "generator": "scripts/floorplan/build.py",
            "date": date.today().isoformat(),
            "sourcePdf": config["sourcePdf"],
            "sourcePdfSha256": pdf_sha256,
            "dpi": config["dpi"],
            "pages": config["pages"],
            "referenceFloor": config["referenceFloor"],
            "masterRect": rect,
            "contextRect": config.get("contextRect"),
            "shifts": {floor: list(s) for floor, s in sorted(shifts.items(), key=lambda kv: int(kv[0]))},
            "wallParams": config["walls"],
        },
        "plan": {"widthPx": rect["w"], "heightPx": rect["h"]},
        "floors": floors,
    }
    geometry_path = ROOT / out["geometryJson"]
    geometry_path.parent.mkdir(parents=True, exist_ok=True)
    with open(geometry_path, "w", encoding="utf-8") as f:
        json.dump(geometry, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print(f"    {geometry_path.relative_to(ROOT)}")
