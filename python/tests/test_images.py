"""Verify image OCR, image decoding, and EXIF orientation with real inputs."""

from io import BytesIO
import os
from pathlib import Path
import shutil
import tempfile
import unittest

from PIL import Image
import pymupdf

from python.ocr.document_reader import extract_document
from python.ocr.pdf_reader import ExtractionError


class ImageExtractionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def require_ocr(self):
        executable = shutil.which("tesseract")
        default = Path(executable).parent.parent / "share/tessdata" if executable else Path("/nonexistent")
        path = os.environ.get("TESSDATA_PREFIX", str(default))
        if not (Path(path) / "eng.traineddata").is_file():
            self.skipTest("English Tesseract language data is not installed")
        original = os.environ.get("TESSDATA_PREFIX")
        os.environ["TESSDATA_PREFIX"] = path
        self.addCleanup(lambda: os.environ.pop("TESSDATA_PREFIX", None) if original is None
                        else os.environ.__setitem__("TESSDATA_PREFIX", original))

    def image(self):
        with pymupdf.open() as document:
            page = document.new_page(width=600, height=220)
            page.insert_text((40, 80), "Invoice: IMG-0042", fontsize=24)
            page.insert_text((40, 140), "Total: 500", fontsize=24)
            return Image.open(BytesIO(page.get_pixmap(dpi=200).tobytes("png")))

    def assert_ocr(self, path):
        result = extract_document(path)
        self.assertEqual(result["pageCount"], 1)
        self.assertEqual(result["pages"][0]["method"], "ocr")
        fields = {field["key"]: field["value"] for field in result["structured"]["fields"]}
        self.assertEqual(fields["invoice"], "IMG-0042")
        self.assertEqual(fields["total"], "500")

    def test_supported_images(self):
        self.require_ocr()
        with self.image() as image:
            for suffix, format_name in [("png", "PNG"), ("jpg", "JPEG"), ("webp", "WEBP"), ("bmp", "BMP")]:
                with self.subTest(format=format_name):
                    path = self.root / f"image.{suffix}"
                    image.save(path, format=format_name)
                    self.assert_ocr(path)

    def test_exif_photo_orientation(self):
        self.require_ocr()
        with self.image() as image:
            rotated = image.rotate(90, expand=True)
            exif = Image.Exif()
            exif[274] = 6
            path = self.root / "rotated.jpg"
            rotated.save(path, exif=exif, quality=95)
            self.assert_ocr(path)

    def test_transparent_image(self):
        self.require_ocr()
        with self.image() as image:
            rgba = image.convert("RGBA")
            # Make the white background transparent; OCR should composite it white.
            rgba.putalpha(image.convert("L").point(lambda pixel: 0 if pixel > 245 else 255))
            path = self.root / "transparent.png"
            rgba.save(path)
            self.assert_ocr(path)

    def test_corrupt_image(self):
        path = self.root / "broken.png"
        path.write_bytes(b"\x89PNG\r\n\x1a\ninvalid image")
        with self.assertRaises(ExtractionError) as context:
            extract_document(path)
        self.assertEqual(context.exception.code, "INVALID_IMAGE")

    def test_pixel_limit(self):
        path = self.root / "large.png"
        with Image.new("L", (5000, 4001), "white") as image:
            image.save(path)
        with self.assertRaises(ExtractionError) as context:
            extract_document(path)
        self.assertEqual(context.exception.code, "IMAGE_LIMIT")

    def test_animated_webp_rejected(self):
        path = self.root / "animated.webp"
        with Image.new("RGB", (50, 50), "white") as first, Image.new("RGB", (50, 50), "black") as second:
            first.save(path, save_all=True, append_images=[second], duration=100, loop=0)
        with self.assertRaises(ExtractionError) as context:
            extract_document(path)
        self.assertEqual(context.exception.code, "INVALID_IMAGE")

    def test_pdf_still_supported(self):
        path = self.root / "document.pdf"
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((40, 80), "Reference: PDF-0042")
            document.save(path)
        result = extract_document(path)
        self.assertEqual(result["pages"][0]["method"], "text")
        self.assertEqual(result["structured"]["fields"][0]["value"], "PDF-0042")


if __name__ == "__main__":
    unittest.main()
