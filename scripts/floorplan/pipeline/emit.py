"""Stage 5: write floor textures and the generated geometry JSON."""

from __future__ import annotations

import json
from datetime import date

import numpy as np
from PIL import Image

from .common import ROOT

# Below this peak channel an ink pixel carries no usable hue.
NEUTRAL_INK_LEVEL = 8.0


def _blueprint_rgba(rgb: np.ndarray, params: dict) -> np.ndarray:
    """White paper -> transparent, ink -> a light tint whose weight is alpha.

    The 3D map renders floors on a dark stage, so an opaque white plan reads as
    a blank card and darkness has to become alpha. The ink's *colour* must not
    also follow its darkness: lightening each pixel by a fixed fraction of its
    own value (the previous rule) sent black room labels out darker than the
    grey pictogram tiles they sit next to, i.e. exactly the reverse of the
    drawing, where the labels are the densest mark on the sheet. So the value
    is discarded and only the hue kept -- cyan line work stays blue, neutral
    ink stays neutral -- and how strongly a mark reads is left entirely to
    alpha, which is what the drawing's own tone actually means.
    """
    rgb = rgb.astype(np.float32)
    lum = rgb.mean(axis=2) / 255.0
    alpha = np.clip((1.0 - lum) * params["alphaGain"], 0.0, 1.0) * 255.0
    # Near-black has no measurable hue to preserve; treat it as neutral.
    peak = rgb.max(axis=2, keepdims=True)
    hue = np.where(peak > NEUTRAL_INK_LEVEL, rgb * (255.0 / np.maximum(peak, 1.0)), 255.0)
    # ...and hue is only worth keeping in proportion to how coloured the ink
    # actually was. Normalising every pixel to full value turns the drawing's
    # warm-black label text into salmon, because the tiny cast in near-neutral
    # ink gets amplified along with everything else. Chroma decides how far a
    # pixel travels from white toward its own hue: the cyan line work nearly
    # all the way, body text almost not at all.
    chroma = np.where(peak > NEUTRAL_INK_LEVEL, (peak - rgb.min(axis=2, keepdims=True)) / np.maximum(peak, 1.0), 0.0)
    mix = np.clip(chroma * params["hueGain"], 0.0, 1.0)
    hue = 255.0 * (1.0 - mix) + hue * mix
    # One brightness for all ink, set below the viewer's bloom threshold. At
    # full white the filled pictogram tiles stop being drawing and start being
    # light sources, blooming over the rooms they label.
    out_rgb = hue * params["inkValue"]
    return np.dstack([np.clip(out_rgb, 0.0, 255.0), alpha]).astype(np.uint8)


def _fit_texture(img: Image.Image, params: dict) -> Image.Image:
    """Apply one shared master-pixel scale so every building has equal density."""
    scale = params.get("texelsPerMasterPx", 1.0)
    if scale <= 0:
        raise ValueError("texture.texelsPerMasterPx must be greater than zero")
    if scale == 1:
        return img
    size = tuple(max(1, int(dimension * scale + 0.5)) for dimension in img.size)
    return img.resize(size, Image.Resampling.LANCZOS)


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
        img = _fit_texture(img, config["texture"])
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
            "shifts": {floor: list(s) for floor, s in sorted(shifts.items(), key=lambda kv: int(kv[0]))},
            "wallParams": config["walls"],
            "textureParams": config["texture"],
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
