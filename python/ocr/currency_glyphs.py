"""Recover verified legacy-font currency glyphs without guessing from an address."""

import hashlib
import re

import pymupdf

from .recognition import recognize_region

# The RonBscRg glyph used by the verified statement draws ₹ at U+0060.
# Match its rendered shape, not just the font name: a real grave accent, an
# unrelated font with the same name, or a Markdown backtick must remain intact.
_RUPEE_GRAVE_SIGNATURES = {
    "295302bae72fa7625162dfc42fac2ff29c36acb517be306a63865fb7d855ba88",
}
_PRICE_AFTER_MARKER = re.compile(r"`[ \t]*[+\-−]?[ \t]*\d")
_AMOUNT = r"[+\-−]?\s*\d+(?:[.,]\d+)*"
_PRINTED_AMOUNT = re.compile(r"^" + _AMOUNT + r"$")
_VISUAL_PRICE = re.compile(r"^\s*([₹$€£¥₩₽฿₺₫₴₦₱])\s*(" + _AMOUNT + r")\s*$")


def _glyph_signature(buffer):
    font = pymupdf.Font(fontbuffer=buffer)
    if not font.has_glyph(ord("`")):
        return None
    with pymupdf.open() as sample:
        page = sample.new_page(width=64, height=64)
        writer = pymupdf.TextWriter(page.rect)
        writer.append((8, 48), "`", font=font, fontsize=32)
        writer.write_text(page, color=(0, 0, 0))
        pixmap = page.get_pixmap(colorspace=pymupdf.csGRAY, alpha=False)
        return hashlib.sha256(pixmap.samples).hexdigest()


def normalize_currency_glyphs(page, text, words, *, text_page=None):
    """Return corrected text/words and count; the original PDF is never changed."""
    if "`" not in text:
        return text, words, 0
    fonts = page.get_fonts(full=True)
    verified = {}

    def is_rupee_font(name):
        if name not in verified:
            verified[name] = False
            for entry in fonts:
                if entry[3].split("+")[-1] != name.split("+")[-1]:
                    continue
                try:
                    buffer = page.parent.extract_font(entry[0])[3]
                    if buffer and _glyph_signature(buffer) in _RUPEE_GRAVE_SIGNATURES:
                        verified[name] = True
                        break
                except Exception:
                    # An unavailable/unrecognized font never establishes INR.
                    continue
        return verified[name]

    blocks = page.get_text("dict", textpage=text_page, sort=True)["blocks"]
    marker_spans = [span for block in blocks for line in block.get("lines", [])
                    for span in line.get("spans", []) if "`" in span["text"]]
    # Native text sorting can merge columns differently from span sorting.
    # If every marker on this page is a verified glyph, all occurrences are
    # unambiguous, including standalone symbols and merged financial rows.
    if marker_spans and all(is_rupee_font(span["font"]) for span in marker_spans):
        return (text.replace("`", "₹"),
                [(*word[:4], word[4].replace("`", "₹"), *word[5:]) for word in words],
                text.count("`"))

    cursor = 0
    boxes = []
    replacements = []
    for block in blocks:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                value = span["text"]
                if not value:
                    continue
                start = text.find(value, cursor)
                if start < 0:
                    continue
                cursor = start + len(value)
                if "`" not in value or not is_rupee_font(span["font"]):
                    continue
                for index, character in enumerate(value):
                    if character == "`" and _PRICE_AFTER_MARKER.match(text, start + index):
                        replacements.append(start + index)
                        boxes.append(pymupdf.Rect(span["bbox"]))
    if not replacements:
        return text, words, 0
    characters = list(text)
    for index in replacements:
        characters[index] = "₹"
    corrected_words = []
    for word in words:
        if "`" in word[4] and any(pymupdf.Rect(word[:4]).intersects(box) for box in boxes):
            word = (*word[:4], word[4].replace("`", "₹"), *word[5:])
        corrected_words.append(word)
    return "".join(characters), corrected_words, len(replacements)


def recover_currency_regions(page, text, words, *, text_page=None):
    """Try unknown standalone markers, retaining native amounts and text.

    Both render resolutions must agree on the symbol AND the original amount.
    Limit attempts per page; unsupported encodings remain explicit review cases.
    """
    if "`" not in text:
        return text, words, 0, False
    blocks = page.get_text("dict", textpage=text_page, sort=True)["blocks"]
    spans = [span for block in blocks for line in block.get("lines", [])
             for span in line.get("spans", []) if span["text"].strip() == "`"]
    corrected_words = list(words)
    recovered = 0
    attempts = 0
    # Rotated-page crop coordinates need a separate transform. Retain uncertainty
    # rather than examining a different region of the page.
    if page.rotation:
        return text, words, 0, bool(_PRICE_AFTER_MARKER.search(text))
    for index, word in enumerate(words):
        if attempts >= 4:
            break
        if word[4] != "`" or not any(pymupdf.Rect(word[:4]).intersects(pymupdf.Rect(span["bbox"])) for span in spans):
            continue
        attempts += 1
        box = pymupdf.Rect(word[:4])
        candidates = [other for other in words if other[0] >= box.x1
                      and other[0] - box.x1 <= max(20, box.height * 3)
                      and abs((other[1] + other[3]) / 2 - (box.y0 + box.y1) / 2) <= box.height / 2
                      and _PRINTED_AMOUNT.fullmatch(other[4])]
        if not candidates:
            continue
        amount_word = min(candidates, key=lambda other: other[0])
        amount = amount_word[4]
        pattern = re.compile(r"`[ \t]*" + re.escape(amount) + r"(?![\d.,])")
        matches = list(pattern.finditer(text))
        if len(matches) != 1:
            continue  # Do not guess the correspondence between repeated columns.
        region = box | pymupdf.Rect(amount_word[:4])
        region = pymupdf.Rect(region.x0 - 4, region.y0 - 4, region.x1 + 4, region.y1 + 4)
        try:
            readings = [_VISUAL_PRICE.fullmatch(recognize_region(page, region, dpi=dpi))
                        for dpi in (300, 400)]
        except Exception:
            continue  # Supplementary OCR failure must not discard good native text.
        def normalize(value):
            return re.sub(r"\s+", "", value).replace("−", "-")
        if not all(reading and normalize(reading[2]) == normalize(amount) for reading in readings):
            continue
        if readings[0][1] != readings[1][1]:
            continue
        symbol = readings[0][1]
        position = matches[0].start()
        text = text[:position] + symbol + text[position + 1:]
        corrected_words[index] = (*word[:4], symbol, *word[5:])
        recovered += 1
    return text, corrected_words, recovered, bool(_PRICE_AFTER_MARKER.search(text))
