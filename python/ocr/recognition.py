"""Recognize scanned content using PyMuPDF's Tesseract integration."""

import os
from pathlib import Path


def recognize_page(page, *, full):
    tessdata = os.environ.get("TESSDATA_PREFIX")
    if not tessdata or not (Path(tessdata) / "eng.traineddata").is_file():
        raise RuntimeError(
            "English OCR language data is missing. Configure TESSDATA_PREFIX on the server."
        )

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
