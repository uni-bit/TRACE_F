"""Stage 1: render the campus diary PDF pages to high-resolution PNGs."""

from __future__ import annotations

import hashlib
from pathlib import Path

from .common import ROOT


def source_sha256(config: dict) -> str | None:
    pdf_path = ROOT / config["sourcePdf"]
    if not pdf_path.exists():
        return None
    digest = hashlib.sha256()
    with open(pdf_path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def render_pages(config: dict, skip_existing: bool = True) -> dict[str, Path]:
    """Render each floor's page at config dpi. Returns floor id -> PNG path."""
    render_dir = ROOT / config["renderDir"]
    render_dir.mkdir(parents=True, exist_ok=True)
    dpi = config["dpi"]

    paths: dict[str, Path] = {}
    missing: list[tuple[str, int, Path]] = []
    for floor, page_no in config["pages"].items():
        out = render_dir / f"page-{page_no}-{dpi}dpi.png"
        paths[floor] = out
        if not (skip_existing and out.exists()):
            missing.append((floor, page_no, out))

    if missing:
        pdf_path = ROOT / config["sourcePdf"]
        if not pdf_path.exists():
            raise FileNotFoundError(
                f"{pdf_path} not found and renders are missing: "
                + ", ".join(str(m[2]) for m in missing)
            )
        import fitz  # PyMuPDF

        with fitz.open(pdf_path) as doc:
            for floor, page_no, out in missing:
                page = doc[page_no - 1]
                pix = page.get_pixmap(dpi=dpi, colorspace=fitz.csRGB)
                pix.save(out)
                print(f"  rendered page {page_no} (floor {floor}F) -> {out.relative_to(ROOT)}")
    return paths
