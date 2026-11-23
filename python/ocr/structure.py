"""Conservative, local field and table extraction. All detections need review."""

import re
from statistics import median

FIELD = re.compile(r"^([A-Za-z][A-Za-z0-9 ._/#&()%\-]{0,59})\s*[:=]\s*(.*)$")
MAX_FIELDS = 1000
MAX_TABLE_CELLS = 5000
HASH_FIELD = re.compile(r"^([A-Za-z][A-Za-z ]{0,40}?)\s+#\s*(.+)$")
LABEL = re.compile(r"(?:number|date|reference|email|phone|name|address|amount|price|balance|due|total|tax|vat|currency|status|account)$", re.I)
GENERIC_LABEL = re.compile(r"^[A-Za-z][A-Za-z ._/#&()%\-]{0,59}$")


def extract_fields(text, page_number):
    lines = text.splitlines()
    fields = []
    for index, line in enumerate(lines):
        match = FIELD.match(line.strip()) or HASH_FIELD.match(line.strip())
        if not match or match[1].lower() in {"http", "https", "mailto"}:
            continue
        label, value = match[1].strip(), match[2].strip()
        if value.startswith("//"):
            continue
        source = line
        # Only use an immediately adjacent, non-label line for a standalone label.
        if not value and index + 1 < len(lines):
            following = lines[index + 1].strip()
            if following and not FIELD.match(following):
                value = following
                source += "\n" + lines[index + 1]
        fields.append({
            "id": f"p{page_number}-field-{len(fields) + 1}",
            "page": page_number,
            "key": re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_"),
            "label": label,
            "value": value,
            "sourceText": source,
            "sourceLine": index + 1,
            "reviewed": False,
        })
        if len(fields) >= MAX_FIELDS:
            break
    return fields


def _word_lines(words):
    lines = []
    for word in sorted(words, key=lambda word: ((word[1] + word[3]) / 2, word[0])):
        center = (word[1] + word[3]) / 2
        if not lines or abs(center - lines[-1][0]) > max(2, (word[3] - word[1]) * .45):
            lines.append((center, [word]))
        else:
            lines[-1][1].append(word)
    return lines


def _word_text(words):
    """Read words by physical lines without splitting angled stamps into cells."""
    return "\n".join(" ".join(str(word[4]) for word in sorted(row, key=lambda word: word[0]))
                     for _, row in _word_lines(words))


def _source_line(text, label, value=""):
    normalized_label = " ".join(label.split()).lower().rstrip(":=# ")
    pattern = re.compile(r"(?<!\w)" + re.escape(normalized_label) + r"(?!\w)")
    matches = [(index + 1, " ".join(line.split()).lower()) for index, line in enumerate(text.splitlines())
               if pattern.search(" ".join(line.split()).lower())]
    first_value_line = " ".join(value.splitlines()[0].split()).lower() if value else ""
    exact = re.compile(pattern.pattern + r"\s*[:=#]?\s+" + re.escape(first_value_line))
    return next((index for index, line in matches if first_value_line and exact.search(line)),
                matches[0][0] if matches else None)


def _layout_fields(page, text, words, tables, page_number):
    fields = extract_fields(text, page_number)

    def put(label, value, source):
        key = re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_")
        line = _source_line(text, label, value)
        entry = {"id": "", "page": page_number, "key": key, "label": label,
                 "value": value, "sourceText": source, "sourceLine": line, "reviewed": False}
        # Replace flattened text with the value from the same physical source.
        for index, field in enumerate(fields):
            if field["key"] == key and field["sourceLine"] == line:
                fields[index] = entry
                return
        if len(fields) < MAX_FIELDS:
            fields.append(entry)

    blocks = {}
    for word in words:
        blocks.setdefault(word[5], []).append(word)
    for block in blocks.values():
        # Narrow blocks retain multiline addresses independently of adjacent columns.
        width = max(word[2] for word in block) - min(word[0] for word in block)
        if width > page.rect.width * .65:
            continue
        block_text = _word_text(block)
        lines = block_text.splitlines()
        first = FIELD.match(lines[0]) if lines else None
        if first and not first[2].strip() and len(lines) > 1 and not any(FIELD.match(line) for line in lines[1:]):
            put(first[1].strip(), "\n".join(lines[1:]), block_text)
        else:
            for field in extract_fields(block_text, page_number):
                put(field["label"], field["value"], field["sourceText"])

    # OCR often splits an address into many blocks or merges two page columns.
    # Follow a standalone label down its own column until a gap or another label.
    logical_lines = {}
    for word in words:
        logical_lines.setdefault((word[5], word[6]), []).append(word)
    height = median([max(1, word[3] - word[1]) for word in words]) if words else 1
    for label_words in logical_lines.values():
        label_text = _word_text(label_words)
        match = FIELD.match(label_text)
        if not match or match[2].strip():
            continue
        left = min(word[0] for word in label_words)
        bottom = max(word[3] for word in label_words)
        right = min(page.rect.width, left + page.rect.width * .45)
        following = [word for word in words if left - 3 <= word[0] < right and
                     bottom < word[1] < bottom + 140 and not any(_inside(word, table["bbox"]) for table in tables)]
        body, previous_y = [], bottom - height / 2
        for center, row in _word_lines(following):
            row_text = _word_text(row)
            if center - previous_y > height * 2.5 or FIELD.match(row_text) or HASH_FIELD.match(row_text):
                break
            body.extend(row)
            previous_y = center
        if body:
            value = _word_text(body)
            put(match[1].strip(), value, label_text + "\n" + value)

    # Formatted extraction preserves wide gaps even on unruled documents.
    for raw in text.splitlines():
        cells = [cell.strip() for cell in re.split(r"\s{2,}", raw.strip()) if cell.strip()]
        for index in range(len(cells) - 1):
            raw_label, value = cells[index], cells[index + 1]
            label = raw_label.rstrip(":=").strip()
            # Adjacent column headings are not values (e.g. Bill To / Ship To).
            if value.endswith((":", "=")):
                continue
            plausible_value = re.search(r"\d|@|[$€£¥]", value) or re.search(r"name|address|status", label, re.I)
            generic_pair = raw_label == label and len(cells) == 2 and GENERIC_LABEL.fullmatch(label) and len(label.split()) <= 6
            explicit_pair = (raw_label.endswith((":", "=")) and GENERIC_LABEL.fullmatch(label)
                             and ((LABEL.search(label) and plausible_value)
                                  or re.fullmatch(r"(?:ship(?:ping)?|delivery) (?:mode|method)|discount.*", label, re.I)))
            if explicit_pair or (len(label) <= 60 and LABEL.search(label) and not LABEL.search(value) and plausible_value) or generic_pair:
                put(label.rstrip(":="), value, f"{label}  {value}")

    # Prefer grid cells to flattened text when the same metadata occurs in both.
    for table in tables:
        if len(table["columns"]) == 2:
            for label, value in table["rows"]:
                if GENERIC_LABEL.fullmatch(label.strip()) and value.strip():
                    put(label.strip(), value.strip(), f"{label}  {value}")

    for index, field in enumerate(fields, 1):
        field["id"] = f"p{page_number}-field-{index}"
    return fields


def _inside(word, bbox):
    x, y = (word[0] + word[2]) / 2, (word[1] + word[3]) / 2
    return bbox[0] <= x <= bbox[2] and bbox[1] <= y <= bbox[3]


def _aligned_tables(words):
    """Detect repeated wide column gaps; retain all rows with generic headers."""
    if not words:
        return []
    height = median(max(1, word[3] - word[1]) for word in words)
    lines = []
    for word in sorted(words, key=lambda word: ((word[1] + word[3]) / 2, word[0])):
        center = (word[1] + word[3]) / 2
        if not lines or abs(center - lines[-1][0]) > max(3, height * .45):
            lines.append((center, [word]))
        else:
            lines[-1][1].append(word)
    candidates = []
    for center, line_words in lines:
        cells = []
        for word in sorted(line_words, key=lambda word: word[0]):
            if not cells or word[0] - cells[-1]["right"] > max(18, height * 2):
                cells.append({"left": word[0], "right": word[2], "text": str(word[4])})
            else:
                cells[-1]["text"] += " " + str(word[4])
                cells[-1]["right"] = word[2]
        candidates.append((center, cells))

    groups, current = [], []
    for center, cells in candidates:
        valid = len(cells) >= 2 and not FIELD.match(cells[0]["text"])
        compatible = current and len(cells) == len(current[0][1]) and (
            center - current[-1][0] <= height * 3.5
        ) and all(abs(cell["left"] - prior["left"]) <= max(12, height)
                  for cell, prior in zip(cells, current[0][1]))
        if not valid or (current and not compatible):
            if current:
                groups.append(current)
            current = []
        if valid:
            current.append((center, cells))
    if current:
        groups.append(current)

    tables = []
    for group in groups:
        if len(group) < 3:
            continue
        rows = [[cell["text"] for cell in cells] for _, cells in group]
        # Two-column prose is too ambiguous unless repeated numeric values occur.
        if len(rows[0]) == 2 and sum(bool(re.search(r"\d", row[-1])) for row in rows) < 2:
            continue
        bbox = [min(c["left"] for _, cells in group for c in cells),
                group[0][0] - height / 2,
                max(c["right"] for _, cells in group for c in cells),
                group[-1][0] + height / 2]
        tables.append((rows, bbox))
    return tables


def extract_structure(page, text, words, page_number, method):
    tables, warnings = [], []
    typical_height = median([max(1, word[3] - word[1]) for word in words]) if words else 1
    ordinary_words = [word for word in words if word[3] - word[1] < typical_height * 4]

    def add_table(rows, bbox, source):
        width = max((len(row) for row in rows), default=0)
        if width < 2 or len(rows) < 2 or not any(any(cell for cell in row) for row in rows):
            return
        if sum(len(t["columns"]) * len(t["rows"]) for t in tables) + width * len(rows) > MAX_TABLE_CELLS:
            warnings.append(f"Page {page_number}: table cell limit reached; check the original text.")
            return
        tables.append({
            "id": f"p{page_number}-table-{len(tables) + 1}",
            "page": page_number,
            "columns": [f"Column {index + 1}" for index in range(width)],
            "rows": [[str(cell) if cell is not None else "" for cell in row] + [""] * (width - len(row)) for row in rows],
            "bbox": [round(float(value), 2) for value in bbox],
            "source": source,
            "reviewed": False,
        })

    # Ruled native PDF tables preserve cells better than flattened text.
    if method in {"text", "mixed"} and page.get_drawings():
        try:
            finder = page.find_tables(strategy="lines_strict")
            for table in finder.tables:
                # Word-centre containment keeps diagonal watermark fragments out
                # of otherwise valid cells and preserves multiline descriptions.
                rows = [[_word_text([word for word in ordinary_words if cell and _inside(word, cell)])
                         if cell else "" for cell in row.cells] for row in table.rows]
                add_table(rows, table.bbox, "pdf_layout")
        except Exception:
            warnings.append(f"Page {page_number}: ruled-table detection failed; use the original text to check this page.")

    # Reuse words from the OCR TextPage; never OCR a page a second time.
    remaining = [word for word in ordinary_words if not any(_inside(word, table["bbox"]) for table in tables)]
    for rows, bbox in _aligned_tables(remaining):
        add_table(rows, bbox, "aligned_text")
    fields = _layout_fields(page, text, ordinary_words, tables, page_number)
    if len(fields) == MAX_FIELDS:
        warnings.append(f"Page {page_number}: field limit reached; check the original text for additional fields.")
    return {"fields": fields, "tables": tables, "warnings": warnings}
