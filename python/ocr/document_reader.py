"""Read PDF and raster-image uploads through the same OCR pipeline."""

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError
import pymupdf

from .pdf_reader import ExtractionError, MAX_BYTES, extract_pages, extract_pdf

IMAGE_FORMATS = {"PNG", "JPEG", "WEBP", "BMP"}
MAX_IMAGE_PIXELS = 20_000_000


def extract_document(file_path, *, force_ocr=False):
    path = Path(file_path)
    if path.suffix.lower() == ".pdf":
        return extract_pdf(path, force_ocr=force_ocr)
    if path.stat().st_size > MAX_BYTES:
        raise ExtractionError("TOO_LARGE", "Choose a file smaller than 10 MB.")
    try:
        with Image.open(path) as original:
            if original.format not in IMAGE_FORMATS:
                raise ExtractionError("INVALID_IMAGE", "Choose a PNG, JPG, WebP, or BMP image.")
            if original.width * original.height > MAX_IMAGE_PIXELS:
                raise ExtractionError("IMAGE_LIMIT", "Choose an image with at most 20 million pixels.")
            if getattr(original, "n_frames", 1) > 1:
                raise ExtractionError("INVALID_IMAGE", "Choose a still image instead of an animated image.")
            oriented = ImageOps.exif_transpose(original)
            rgba = oriented.convert("RGBA")
            image = Image.new("RGB", rgba.size, "white")
            image.paste(rgba, mask=rgba.getchannel("A"))
            stream = BytesIO()
            image.save(stream, format="PNG")
            with pymupdf.open() as document:
                # Use a 200-DPI page so the OCR render preserves image resolution.
                page = document.new_page(width=image.width * 72 / 200, height=image.height * 72 / 200)
                page.insert_image(page.rect, stream=stream.getvalue())
                return extract_pages(document, force_ocr=True)
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as error:
        raise ExtractionError("IMAGE_LIMIT", "This image is too large to process safely. Resize it and try again.") from error
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise ExtractionError("INVALID_IMAGE", "This image is damaged or cannot be read.") from error
