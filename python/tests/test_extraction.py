"""Exercise PDF extraction with actual generated native, scanned, and mixed PDFs."""

import os
from pathlib import Path
import shutil
import tempfile
import unittest

import pymupdf

from python.ocr.pdf_reader import ExtractionError, extract_pdf


class PdfExtractionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.pdf = Path(self.directory.name) / "input.pdf"

    def save_native(self, pages=1):
        with pymupdf.open() as document:
            for _ in range(pages):
                page = document.new_page(width=600, height=400)
                page.insert_text((40, 60), "Invoice total 12345", fontsize=24)
            document.save(self.pdf)

    def require_ocr(self):
        executable = shutil.which("tesseract")
        default = Path(executable).parent.parent / "share/tessdata" if executable else Path("/nonexistent")
        tessdata = os.environ.get("TESSDATA_PREFIX", str(default))
        if not (Path(tessdata) / "eng.traineddata").exists():
            self.skipTest("English Tesseract language data is not installed")
        previous = os.environ.get("TESSDATA_PREFIX")
        os.environ["TESSDATA_PREFIX"] = tessdata
        self.addCleanup(lambda: os.environ.pop("TESSDATA_PREFIX", None) if previous is None
                        else os.environ.__setitem__("TESSDATA_PREFIX", previous))

    def save_scan(self, mixed=False):
        with pymupdf.open() as source:
            page = source.new_page(width=600, height=200)
            page.insert_text((40, 90), "Scanned amount 98765", fontsize=28)
            image = page.get_pixmap(dpi=200)
            with pymupdf.open() as document:
                scan = document.new_page(width=600, height=400)
                scan.insert_image(pymupdf.Rect(0, 0, 600, 200), pixmap=image)
                if mixed:
                    scan.insert_text((40, 300), "Native heading", fontsize=24)
                document.save(self.pdf)

    def test_digital_pdf(self):
        self.save_native()
        result = extract_pdf(self.pdf)
        self.assertEqual(result["pageCount"], 1)
        self.assertEqual(result["pages"][0]["text"], "Invoice total 12345")
        self.assertEqual(result["pages"][0]["method"], "text")

    def test_scanned_pdf(self):
        self.require_ocr()
        self.save_scan()
        page = extract_pdf(self.pdf)["pages"][0]
        self.assertIn("Scanned amount 98765", page["text"])
        self.assertEqual(page["method"], "ocr")

    def test_mixed_page_preserves_both_sources(self):
        self.require_ocr()
        self.save_scan(mixed=True)
        page = extract_pdf(self.pdf)["pages"][0]
        self.assertIn("Native heading", page["text"])
        self.assertIn("Scanned amount 98765", page["text"])
        self.assertEqual(page["method"], "mixed")

    def test_force_ocr(self):
        self.require_ocr()
        self.save_native()
        page = extract_pdf(self.pdf, force_ocr=True)["pages"][0]
        self.assertIn("12345", page["text"])
        self.assertEqual(page["method"], "ocr")

    def test_blank_page(self):
        with pymupdf.open() as document:
            document.new_page()
            document.save(self.pdf)
        self.assertEqual(extract_pdf(self.pdf)["pages"][0], {"page": 1, "text": "", "method": "blank"})

    def test_password_protected(self):
        with pymupdf.open() as document:
            document.new_page()
            document.save(self.pdf, encryption=pymupdf.PDF_ENCRYPT_AES_256,
                          owner_pw="owner", user_pw="reader")
        with self.assertRaises(ExtractionError) as context:
            extract_pdf(self.pdf)
        self.assertEqual(context.exception.code, "PASSWORD")

    def test_page_limit(self):
        self.save_native(pages=21)
        with self.assertRaises(ExtractionError) as context:
            extract_pdf(self.pdf)
        self.assertEqual(context.exception.code, "PAGE_LIMIT")

    def test_corrupt_pdf(self):
        self.pdf.write_bytes(b"%PDF-1.7\nnot a real PDF")
        with self.assertRaises(ExtractionError) as context:
            extract_pdf(self.pdf)
        self.assertEqual(context.exception.code, "INVALID_PDF")

    def test_missing_ocr_data_reports_failure(self):
        self.save_scan()
        previous = os.environ.get("TESSDATA_PREFIX")
        os.environ["TESSDATA_PREFIX"] = self.directory.name
        try:
            with self.assertRaises(ExtractionError) as context:
                extract_pdf(self.pdf)
            self.assertEqual(context.exception.code, "OCR_FAILED")
        finally:
            if previous is None:
                os.environ.pop("TESSDATA_PREFIX", None)
            else:
                os.environ["TESSDATA_PREFIX"] = previous


if __name__ == "__main__":
    unittest.main()
