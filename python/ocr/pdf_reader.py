"""Extract native PDF text and recognize scanned or mixed page content."""

from pathlib import Path

import pymupdf

from .recognition import recognize_page
from .structure import extract_structure

MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 20
MAX_TEXT_CHARACTERS = 500_000


class ExtractionError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def extract_pdf(file_path, *, force_ocr=False):
    if Path(file_path).stat().st_size > MAX_BYTES:
        raise ExtractionError("TOO_LARGE", "Choose a PDF smaller than 10 MB.")
    try:
        document = pymupdf.open(file_path)
    except (pymupdf.FileDataError, pymupdf.EmptyFileError) as error:
        raise ExtractionError("INVALID_PDF", "This PDF is damaged or cannot be read.") from error

    with document:
        return extract_pages(document, force_ocr=force_ocr)


def extract_pages(document, *, force_ocr=False):
    """Process an opened PDF, including an internally converted image document."""
    if not document.is_pdf:
        raise ExtractionError("INVALID_PDF", "Please upload a PDF document.")
    if document.needs_pass:
        raise ExtractionError("PASSWORD", "This PDF is password-protected. Upload an unlocked copy.")
    if not 0 < document.page_count <= MAX_PAGES:
        raise ExtractionError("PAGE_LIMIT", "Upload a PDF containing 1 to 20 pages.")

    pages = []
    characters = 0
    structured = {"schemaVersion": 1, "fields": [], "tables": [], "warnings": []}
    for number, page in enumerate(document, start=1):
        text = page.get_text("text", sort=True).strip()
        text_page = None
        has_images = bool(page.get_images())
        garbled = "\ufffd" in text
        needs_ocr = force_ocr or has_images or garbled or (
            not text and bool(page.get_drawings())
        )
        method = "text" if text else "blank"
        if needs_ocr:
            full = force_ocr or garbled or not text
            try:
                text_page = recognize_page(page, full=full)
                text = page.get_text("text", textpage=text_page, sort=True).strip()
            except Exception as error:
                # Do not silently return incomplete results when OCR fails.
                raise ExtractionError(
                    "OCR_FAILED", f"OCR failed on page {number}. {error}"
                ) from error
            method = "ocr" if full else "mixed"
        characters += len(text)
        if characters > MAX_TEXT_CHARACTERS:
            raise ExtractionError("OUTPUT_LIMIT", "This document contains too much text. Split it into smaller PDFs.")
        pages.append({"page": number, "text": text, "method": method})
        words = page.get_text("words", textpage=text_page, sort=True)
        detected = extract_structure(page, text, words, number, method)
        for key in ("fields", "tables", "warnings"):
            structured[key].extend(detected[key])

    return {"pageCount": len(pages), "pages": pages, "structured": structured}
