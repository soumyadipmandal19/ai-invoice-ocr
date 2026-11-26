"""Recognize scanned content using PyMuPDF's Tesseract integration."""

import os
from pathlib import Path

import pymupdf


def _tessdata():
    path = os.environ.get("TESSDATA_PREFIX")
    if not path or not (Path(path) / "eng.traineddata").is_file():
        raise RuntimeError(
            "English OCR language data is missing. Configure TESSDATA_PREFIX on the server."
        )
    return path


def recognize_region(page, region, *, dpi=300):
    """OCR a bounded crop without changing the page or its native text layer."""
    region = pymupdf.Rect(region) & page.rect
    if region.is_empty or region.width * region.height * (dpi / 72) ** 2 > 1_000_000:
        raise ValueError("Currency OCR region is empty or too large.")
    pixmap = page.get_pixmap(clip=region, dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
    data = pixmap.pdfocr_tobytes(language="eng", tessdata=_tessdata())
    with pymupdf.open("pdf", data) as document:
        return document[0].get_text("text").strip()


def recognize_page(page, *, full):
    tessdata = _tessdata()

    # Bound the rendered page size, including unusually large PDF dimensions.
    area = page.rect.width * page.rect.height
    if area <= 0:
        raise RuntimeError("The PDF contains a page with invalid dimensions.")
    dpi = min(200, int(72 * (20_000_000 / area) ** 0.5))
    if dpi < 36:
        raise RuntimeError("This PDF page is too large to process. Resize it and try again.")

    return page.get_textpage_ocr(
        language="eng", dpi=dpi, full=full, tessdata=tessdata
    )
