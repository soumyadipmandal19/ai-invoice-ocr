"""Verify structured values and table geometry using generated real PDFs."""

import os
from pathlib import Path
import shutil
import tempfile
import unittest

import pymupdf

from python.ocr.pdf_reader import extract_pdf
from python.ocr.structure import extract_fields, _layout_fields


class FieldTests(unittest.TestCase):
    def test_preserves_identifiers_dates_and_repeated_labels(self):
        fields = extract_fields("Reference: 00042\nDate: 03/04/2026\nTotal: INR 1,234.50\nReference: 00043", 2)
        self.assertEqual([field["value"] for field in fields], ["00042", "03/04/2026", "INR 1,234.50", "00043"])
        self.assertEqual([field["key"] for field in fields], ["reference", "date", "total", "reference"])
        self.assertEqual(len({field["id"] for field in fields}), 4)
        self.assertTrue(all(field["page"] == 2 and not field["reviewed"] for field in fields))

    def test_standalone_label_and_source(self):
        field = extract_fields("Customer name:\nAlice Example", 1)[0]
        self.assertEqual(field["value"], "Alice Example")
        self.assertEqual(field["sourceText"], "Customer name:\nAlice Example")
        self.assertEqual(field["sourceLine"], 1)

    def test_empty_label_does_not_consume_next_field(self):
        fields = extract_fields("Customer:\nInvoice: INV-001", 1)
        self.assertEqual(fields[0]["value"], "")
        self.assertEqual(fields[1]["value"], "INV-001")

    def test_does_not_invent_fields_from_prose_or_urls(self):
        self.assertEqual(extract_fields("Invoice total 500\nhttps://example.com\nThe amount is unknown.", 1), [])

    def test_labeled_url_remains_a_value(self):
        fields = extract_fields("Website: https://example.com\nAccount=00019", 1)
        self.assertEqual([field["value"] for field in fields], ["https://example.com", "00019"])


class StructuredPdfTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.pdf = Path(self.directory.name) / "structured.pdf"

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

    def save_table(self, *, ruled=False, scanned=False):
        with pymupdf.open() as document:
            page = document.new_page(width=600, height=260)
            for y, row in zip([80, 120, 160], [["Item", "Qty", "Amount"], ["Paper", "2", "10.00"], ["Pens", "3", "15.00"]]):
                for x, value in zip([40, 240, 400], row):
                    page.insert_text((x, y), value, fontsize=14)
            if ruled:
                for x in [30, 220, 380, 560]:
                    page.draw_line((x, 55), (x, 175))
                for y in [55, 95, 135, 175]:
                    page.draw_line((30, y), (560, y))
            if scanned:
                image = page.get_pixmap(dpi=200)
                with pymupdf.open() as scan:
                    target = scan.new_page(width=600, height=260)
                    target.insert_image(target.rect, pixmap=image)
                    scan.save(self.pdf)
            else:
                document.save(self.pdf)

    def test_native_grid_preserves_all_rows(self):
        self.save_table(ruled=True)
        result = extract_pdf(self.pdf)
        table = result["structured"]["tables"][0]
        self.assertEqual(table["source"], "pdf_layout")
        self.assertEqual(table["columns"], ["Column 1", "Column 2", "Column 3"])
        self.assertEqual(table["rows"], [["Item", "Qty", "Amount"], ["Paper", "2", "10.00"], ["Pens", "3", "15.00"]])
        self.assertEqual(len(result["structured"]["tables"]), 1)
        self.assertFalse(table["reviewed"])

    def test_unruled_aligned_columns(self):
        self.save_table()
        table = extract_pdf(self.pdf)["structured"]["tables"][0]
        self.assertEqual(table["source"], "aligned_text")
        self.assertEqual(table["rows"][1], ["Paper", "2", "10.00"])
        self.assertEqual(table["page"], 1)

    def test_scanned_table_reuses_ocr_word_positions(self):
        self.require_ocr()
        self.save_table(scanned=True)
        result = extract_pdf(self.pdf)
        self.assertEqual(result["pages"][0]["method"], "ocr")
        table = result["structured"]["tables"][0]
        self.assertEqual(table["source"], "aligned_text")
        self.assertEqual(len(table["columns"]), 3)
        self.assertIn("Paper", " ".join(table["rows"][1]))
        self.assertIn("10.00", " ".join(table["rows"][1]))

    def test_scanned_fields_have_page_and_source(self):
        self.require_ocr()
        with pymupdf.open() as document:
            page = document.new_page(width=600, height=200)
            page.insert_text((40, 80), "Customer: Alice Example", fontsize=24)
            page.insert_text((40, 130), "Total: 500", fontsize=24)
            image = page.get_pixmap(dpi=200)
            with pymupdf.open() as scan:
                target = scan.new_page(width=600, height=200)
                target.insert_image(target.rect, pixmap=image)
                scan.save(self.pdf)
        fields = extract_pdf(self.pdf)["structured"]["fields"]
        total = next(field for field in fields if field["key"] == "total")
        self.assertEqual(total["value"], "500")
        self.assertEqual(total["page"], 1)
        self.assertIn("Total", total["sourceText"])
        self.assertFalse(total["reviewed"])

    def test_prose_does_not_become_a_table(self):
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((40, 80), "This is an ordinary paragraph without explicit fields.")
            document.save(self.pdf)
        structure = extract_pdf(self.pdf)["structured"]
        self.assertEqual(structure["fields"], [])
        self.assertEqual(structure["tables"], [])
        self.assertEqual(structure["schemaVersion"], 1)

    def test_multiline_address_stays_separate_from_right_column(self):
        with pymupdf.open() as document:
            page = document.new_page(width=600, height=400)
            page.insert_text((40, 60), "From:\nExample Labs\nSuite 7\n42 Example Road\ncontact@example.test", fontsize=12)
            for y, label, value in [(60, "Invoice Number", "INV-0042"), (80, "Order Number", "00019"), (100, "Total Due", "$93.50")]:
                page.insert_text((320, y), label, fontsize=12)
                page.insert_text((450, y), value, fontsize=12)
            page.insert_text((40, 200), "To:\nTest Business\n24 Another Street\nbuyer@example.test", fontsize=12)
            document.save(self.pdf)
        fields = extract_pdf(self.pdf)["structured"]["fields"]
        sender = next(field for field in fields if field["key"] == "from")
        recipient = next(field for field in fields if field["key"] == "to")
        self.assertIn("42 Example Road", sender["value"])
        self.assertIn("contact@example.test", sender["value"])
        self.assertNotIn("Order", sender["value"])
        self.assertIn("buyer@example.test", recipient["value"])
        self.assertEqual(len([field for field in fields if field["key"] == "to"]), 1)
        self.assertEqual(next(field["value"] for field in fields if field["key"] == "invoice_number"), "INV-0042")

    def test_formatted_colon_values_override_misaligned_block_fields(self):
        with pymupdf.open() as document:
            page = document.new_page()
            rows = [(60, "Date:", "Jun 12 2012"), (100, "Ship Mode:", "Same Day"),
                    (140, "Subtotal:", "$1,895.74"), (180, "Discount (0.2%):", "$3.79")]
            for y, label, value in rows:
                page.insert_text((300, y), label, fontsize=10)
                page.insert_text((450, y), value, fontsize=10)
            text = "\n".join(f"{label}          {value}" for _, label, value in rows)
            fields = {field["key"]: field["value"] for field in _layout_fields(page, text, page.get_text("words"), [], 1)}
        self.assertEqual(fields["date"], "Jun 12 2012")
        self.assertEqual(fields["ship_mode"], "Same Day")
        self.assertEqual(fields["subtotal"], "$1,895.74")
        self.assertEqual(fields["discount_0_2"], "$3.79")

    def test_arbitrary_labels_without_colons(self):
        with pymupdf.open() as document:
            page = document.new_page()
            page.insert_text((40, 60), "Department", fontsize=12)
            page.insert_text((300, 60), "Engineering", fontsize=12)
            page.insert_text((40, 100), "ACC # 001234 0056", fontsize=12)
            document.save(self.pdf)
        fields = extract_pdf(self.pdf)["structured"]["fields"]
        self.assertEqual(next(field["value"] for field in fields if field["key"] == "department"), "Engineering")
        self.assertEqual(next(field["value"] for field in fields if field["key"] == "acc"), "001234 0056")

    @unittest.skipUnless(os.environ.get("OCR_SAMPLE_PDF"), "Set OCR_SAMPLE_PDF to run the supplied invoice regression")
    def test_supplied_invoice(self):
        self.require_ocr()
        result = extract_pdf(os.environ["OCR_SAMPLE_PDF"])
        fields = {field["key"]: field["value"] for field in result["structured"]["fields"]}
        expected = {"invoice_number": "INV-3337", "order_number": "12345", "invoice_date": "January 25, 2016",
                    "due_date": "January 31, 2016", "total_due": "$93.50", "sub_total": "$85.00",
                    "tax": "$8.50", "total": "$93.50", "acc": "1234 1234", "bsb": "4321 432"}
        for key, value in expected.items():
            self.assertEqual(fields[key], value, key)
        self.assertIn("admin@slicedinvoices.com", fields["from"])
        self.assertIn("Melbourne, VIC 3000", fields["to"])
        tables = result["structured"]["tables"]
        items = next(table for table in tables if len(table["columns"]) == 5)
        self.assertEqual(items["rows"][0], ["Hrs/Qty", "Service", "Rate/Price", "Adjust", "Sub Total"])
        self.assertEqual(items["rows"][1], ["1.00", "Web Design\nThis is a sample description...", "$85.00", "0.00%", "$85.00"])
        self.assertIn("Payment is due within 30 days", result["pages"][0]["text"])
        self.assertIn("Paid", result["pages"][0]["text"])


if __name__ == "__main__":
    unittest.main()
