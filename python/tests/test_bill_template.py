"""Check the generated template package and preserve its recording contracts."""
import contextlib
import io
import json
import posixpath
from pathlib import Path
import tempfile
import unittest
from xml.etree import ElementTree as ET
from zipfile import ZipFile

from scripts.datasets.build_bill_workbooks import ROOT, COLUMNS, EXAMPLE, NS, write_workbook

N = {"s": NS}
R = {"r": "http://schemas.openxmlformats.org/package/2006/relationships"}


class BillTemplateTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'template.xlsx'
        self.generate({'bills': [], 'items': []})

    def generate(self, dataset):
        with contextlib.redirect_stdout(io.StringIO()):
            write_workbook(self.path, dataset)

    def test_package_relationships_and_custom_styles_are_valid(self):
        with ZipFile(self.path) as archive:
            self.assertIsNone(archive.testzip())
            names = set(archive.namelist())
            for name in names:
                if name.endswith(('.xml', '.rels')):
                    root = ET.fromstring(archive.read(name))
                    if name.endswith('.rels'):
                        base = '' if name == '_rels/.rels' else posixpath.dirname(posixpath.dirname(name))
                        for relationship in root:
                            if relationship.get('TargetMode') == 'External':
                                continue
                            target = posixpath.normpath(posixpath.join(base, relationship.get('Target')))
                            self.assertIn(target, names, f'Missing target of {name}')
            styles = ET.fromstring(archive.read('xl/styles.xml'))
            for section in ['fonts', 'fills', 'borders', 'cellXfs', 'dxfs', 'tableStyles']:
                element = styles.find(f's:{section}', N)
                self.assertEqual(int(element.get('count')), len(element))
            self.assertEqual(styles.find('s:tableStyles/s:tableStyle', N).get('name'), 'PaperTable')

    def test_blank_tables_keep_headers_formats_and_validation(self):
        with ZipFile(self.path) as archive:
            for index, name in enumerate(['Bills', 'Bill Items'], 1):
                sheet = ET.fromstring(archive.read(f'xl/worksheets/sheet{index + 1}.xml'))
                rows = sheet.findall('s:sheetData/s:row', N)
                self.assertEqual(len(rows), 26)
                self.assertEqual([cell.find('s:is/s:t', N).text for cell in rows[0]], [column[1] for column in COLUMNS[name]])
                self.assertTrue(all(cell.find('s:v', N) is None and cell.find('s:is', N) is None for row in rows[1:] for cell in row))
                for column, cell in zip(COLUMNS[name], rows[1]):
                    if column[2] == 'text':
                        self.assertEqual(cell.get('s'), '5', column[0])
                    elif column[2] == 'amount':
                        self.assertEqual(cell.get('s'), '2', column[0])
                pane = sheet.find('s:sheetViews/s:sheetView/s:pane', N)
                self.assertEqual((pane.get('state'), pane.get('topLeftCell')), ('frozen', 'B2'))
                self.assertEqual(len(sheet.findall('s:conditionalFormatting/s:cfRule', N)), 2)
                self.assertTrue(sheet.findall('s:dataValidations/s:dataValidation', N))
                table = ET.fromstring(archive.read(f'xl/tables/table{index}.xml'))
                self.assertEqual(table.get('ref'), sheet.find('s:dimension', N).get('ref'))
                self.assertEqual(table.find('s:tableStyleInfo', N).get('showRowStripes'), '1')

    def test_instruction_cover_links_to_both_data_sheets(self):
        with ZipFile(self.path) as archive:
            sheet = ET.fromstring(archive.read('xl/worksheets/sheet1.xml'))
            text = [node.text for node in sheet.findall('.//s:t', N)]
            self.assertIn('Bill tracker', text)
            self.assertEqual({node.get('location') for node in sheet.findall('s:hyperlinks/s:hyperlink', N)}, {"'Bills'!A1", "'Bill Items'!A1"})
            self.assertEqual(sheet.find('s:sheetViews/s:sheetView', N).get('showGridLines'), '0')

    def test_populated_export_preserves_identifiers_and_navigation(self):
        dataset = json.loads(json.dumps(EXAMPLE))
        dataset['bills'][0]['billNumber'] = '000101'
        dataset['items'][0]['productCode'] = '=DO-NOT-EXECUTE'
        self.generate(dataset)
        with ZipFile(self.path) as archive:
            bills = ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
            items = ET.fromstring(archive.read('xl/worksheets/sheet3.xml'))
            self.assertTrue(bills.findall('s:hyperlinks/s:hyperlink', N))
            self.assertTrue(items.findall('s:hyperlinks/s:hyperlink', N))
            self.assertIn('000101', [node.text for node in bills.findall('.//s:t', N)])
            self.assertIn('=DO-NOT-EXECUTE', [node.text for node in items.findall('.//s:t', N)])
            self.assertFalse(items.findall('.//s:f', N))

    def test_distributed_template_matches_generator(self):
        # Compare package content, ignoring ZIP timestamps.
        with ZipFile(self.path) as generated, ZipFile(ROOT / 'public/templates/bills-template.xlsx') as distributed:
            self.assertEqual(set(generated.namelist()), set(distributed.namelist()))
            for name in generated.namelist():
                self.assertEqual(generated.read(name), distributed.read(name), name)
