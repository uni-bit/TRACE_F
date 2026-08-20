"""Shared helpers for the floorplan asset pipeline."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
CONFIG_PATH = Path(__file__).resolve().parents[1] / "config.json"
DEBUG_DIR = Path(__file__).resolve().parents[1] / "debug"


def load_config() -> dict:
    with open(CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def building_config(config: dict, building: dict) -> dict:
    """Overlay one building's registration/output settings on shared params."""
    scoped = {key: value for key, value in config.items() if key != "buildings"}
    for key, value in building.items():
        if isinstance(value, dict) and isinstance(scoped.get(key), dict):
            scoped[key] = {**scoped[key], **value}
        else:
            scoped[key] = value
    scoped["output"] = {**building["output"], "buildingId": building["id"]}
    return scoped


def building_debug_dir(config: dict) -> Path:
    return DEBUG_DIR / config["id"]


def cyan_mask(rgb: np.ndarray, params: dict) -> np.ndarray:
    """Boolean mask of the cyan drawing ink used by the campus diary floor plans."""
    r = rgb[..., 0].astype(np.float32)
    g = rgb[..., 1]
    b = rgb[..., 2]
    return (
        (b >= params["bMin"])
        & (g >= params["gMin"])
        & (r <= params["rMax"])
        & (b.astype(np.float32) > r * params["bOverR"])
    )


def phase_correlate(ref: np.ndarray, tgt: np.ndarray) -> tuple[int, int, float]:
    """Return (dx, dy, peak) such that content in `tgt` sits at ref position + (dx, dy).

    Pure-translation registration via normalized cross-power spectrum.
    """
    a = ref.astype(np.float32)
    b = tgt.astype(np.float32)
    fa = np.fft.rfft2(a)
    fb = np.fft.rfft2(b)
    cross = fa * np.conj(fb)
    cross /= np.maximum(np.abs(cross), 1e-9)
    corr = np.fft.irfft2(cross, s=a.shape)
    peak_idx = np.unravel_index(int(np.argmax(corr)), corr.shape)
    peak = float(corr[peak_idx])

    def wrap(v: int, n: int) -> int:
        return v - n if v > n // 2 else v

    # For tgt(x) = ref(x - d), the correlation peaks at index (-d) mod N.
    dy = -wrap(int(peak_idx[0]), a.shape[0])
    dx = -wrap(int(peak_idx[1]), a.shape[1])
    return dx, dy, peak


def crop_padded(img: np.ndarray, x: int, y: int, w: int, h: int, fill: int = 255) -> np.ndarray:
    """Crop a rect from `img`, padding with `fill` where the rect leaves the image."""
    out_shape = (h, w) + img.shape[2:]
    out = np.full(out_shape, fill, dtype=img.dtype)
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, img.shape[1]), min(y + h, img.shape[0])
    if x1 > x0 and y1 > y0:
        out[y0 - y : y1 - y, x0 - x : x1 - x] = img[y0:y1, x0:x1]
    return out
