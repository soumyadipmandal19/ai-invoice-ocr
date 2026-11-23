"""Build portable XLSX templates with the standard library; no runtime dependency.

Run from the project root: python3 scripts/datasets/build_bill_workbooks.py
Only creates local artifacts; never writes to Neo4j or imports example accounts.
"""
from datetime import date
from decimal import Decimal
import json
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[2]
COLUMNS = json.loads((ROOT / "data/bills/columns.json").read_text())
EXAMPLE = json.loads((ROOT / "data/bills/example.json").read_text())
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
# Shared palette: ink headers, green navigation, and quiet slate grid lines.
STYLES = f'''<styleSheet xmlns="{NS}">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red](#,##0.00);0.00"/></numFmts>
<fonts count="7">
<font><sz val="10"/><color rgb="FF334155"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
<font><u/><sz val="10"/><color rgb="FF15803D"/><name val="Calibri"/></font>
<font><b/><sz val="26"/><color rgb="FF17251D"/><name val="Calibri"/></font>
<font><sz val="11"/><color rgb="FF64748B"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FF166534"/><name val="Calibri"/></font>
<font><b/><sz val="10"/><color rgb="FF334155"/><name val="Calibri"/></font>
</fonts>
<fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243C30"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF0F7F1"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="hair"><color rgb="FFE2E8F0"/></left><right style="hair"><color rgb="FFE2E8F0"/></right><top style="hair"><color rgb="FFE2E8F0"/></top><bottom style="hair"><color rgb="FFE2E8F0"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" indent="1"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="6" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center" indent="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="5">
<dxf><font><b/><color rgb="FFFFFFFF"/></font><fill><patternFill patternType="solid"><fgColor rgb="FF243C30"/><bgColor rgb="FF243C30"/></patternFill></fill></dxf>
<dxf><fill><patternFill patternType="solid"><fgColor rgb="FFF3F7F4"/><bgColor rgb="FFF3F7F4"/></patternFill></fill></dxf>
<dxf><font><b/><color rgb="FF166534"/></font></dxf>
<dxf><font><color rgb="FF92400E"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/><bgColor rgb="FFFEF3C7"/></patternFill></fill></dxf>
<dxf><font><color rgb="FF166534"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFDCFCE7"/><bgColor rgb="FFDCFCE7"/></patternFill></fill></dxf>
</dxfs>
<tableStyles count="1" defaultTableStyle="PaperTable"><tableStyle name="PaperTable" pivot="0" table="1" count="3"><tableStyleElement type="headerRow" dxfId="0"/><tableStyleElement type="firstRowStripe" size="1" dxfId="1"/><tableStyleElement type="firstColumn" dxfId="2"/></tableStyle></tableStyles>
</styleSheet>'''


def col(number):
    result = ''
    while number:
        number, rem = divmod(number - 1, 26)
        result = chr(65 + rem) + result
    return result


def text_cell(address, value, style=0):
    return f'<c r="{address}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'


def column_width(key, kind):
    if key in ('description', 'notes', 'sourceFile'):
        return 38
    if key in ('vendorName', 'customerName', 'category'):
        return 26
    if key in ('billId', 'itemId', 'billNumber', 'productCode', 'orderId'):
        return 24
    if kind in ('number', 'integer') or key == 'currency':
        return 14
    return 20


def table_end(rows):
    return max(26, len(rows) + 1)


def sheet(columns, rows, links=None, tab_color='22C55E'):
    links = links or {}
    styles = {'text': 5, 'date': 3, 'amount': 2, 'number': 0, 'integer': 0, 'review': 5, 'link': 4}
    widths = ''.join(f'<col min="{i}" max="{i}" width="{column_width(key, kind)}" customWidth="1" style="{styles[kind]}"/>' for i, (key, _, kind) in enumerate(columns, 1))
    output = [f'<row r="1" ht="36" customHeight="1">' + ''.join(text_cell(f'{col(i)}1', header, 1) for i, (_, header, _) in enumerate(columns, 1)) + '</row>']
    end = table_end(rows)
    for number in range(2, end + 1):
        row = rows[number - 2] if number - 2 < len(rows) else {}
        cells = []
        for index, (key, _, kind) in enumerate(columns, 1):
            address = f'{col(index)}{number}'
            value = row.get(key)
            style = styles[kind]
            if value is None:
                cells.append(f'<c r="{address}" s="{style}"/>')
            elif kind in ('amount', 'number', 'integer'):
                cells.append(f'<c r="{address}" s="{style}"><v>{value}</v></c>')
            elif kind == 'date':
                serial = (date.fromisoformat(value) - date(1899, 12, 30)).days
                cells.append(f'<c r="{address}" s="3"><v>{serial}</v></c>')
            else:
                # User-provided text is always a string, never an executable formula.
                cells.append(text_cell(address, value, style))
        output.append(f'<row r="{number}" ht="24" customHeight="1">' + ''.join(cells) + '</row>')
    validations, conditional = [], []
    for index, (_, _, kind) in enumerate(columns, 1):
        target = f'{col(index)}2:{col(index)}10000'
        if kind == 'review':
            validations.append(f'<dataValidation type="list" allowBlank="1" showErrorMessage="1" errorStyle="stop" sqref="{target}"><formula1>"Needs review,Reviewed"</formula1></dataValidation>')
            conditional.append(f'<conditionalFormatting sqref="{target}"><cfRule type="cellIs" dxfId="3" priority="1" operator="equal"><formula>"Needs review"</formula></cfRule><cfRule type="cellIs" dxfId="4" priority="2" operator="equal"><formula>"Reviewed"</formula></cfRule></conditionalFormatting>')
        elif kind == 'integer':
            validations.append(f'<dataValidation type="whole" operator="greaterThanOrEqual" allowBlank="1" showErrorMessage="1" errorStyle="stop" sqref="{target}"><formula1>1</formula1></dataValidation>')
    extra = f'<dataValidations count="{len(validations)}">' + ''.join(validations) + '</dataValidations>' if validations else ''
    hyperlinks = '<hyperlinks>' + ''.join(f'<hyperlink ref="{cell}" location={quoteattr(location)}/>' for cell, location in links.items()) + '</hyperlinks>' if links else ''
    return (f'<worksheet xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            f'<sheetPr><tabColor rgb="FF{tab_color}"/><pageSetUpPr fitToPage="1"/></sheetPr>'
            f'<dimension ref="A1:{col(len(columns))}{end}"/>'
            '<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="85"><pane xSplit="1" ySplit="1" topLeftCell="B2" activePane="bottomRight" state="frozen"/><selection pane="bottomRight" activeCell="B2" sqref="B2"/></sheetView></sheetViews>'
            f'<sheetFormatPr defaultRowHeight="24"/><cols>{widths}</cols><sheetData>' + ''.join(output) + '</sheetData>'
            + ''.join(conditional) + extra + hyperlinks
            + '<printOptions headings="0" gridLines="0"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
            + '<tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>')


def table_definition(columns, rows, table_id, name):
    reference = f'A1:{col(len(columns))}{table_end(rows)}'
    headers = ''.join(f'<tableColumn id="{index}" name={quoteattr(header)}/>' for index, (_, header, _) in enumerate(columns, 1))
    return (f'<table xmlns="{NS}" id="{table_id}" name="{name}" displayName="{name}" ref="{reference}" totalsRowShown="0">'
            f'<autoFilter ref="{reference}"/><tableColumns count="{len(columns)}">{headers}</tableColumns>'
            '<tableStyleInfo name="PaperTable" showFirstColumn="1" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>')


def instruction_sheet(instructions):
    rows = []
    merges = ['B2:G2', 'B3:G3', 'B5:C5', 'D5:E5', 'F5:G5', 'B6:C7', 'D6:E7', 'F6:G7', 'B9:G9']
    rows.append('<row r="2" ht="42" customHeight="1">' + text_cell('B2', 'Bill tracker', 7) + '</row>')
    rows.append('<row r="3" ht="30" customHeight="1">' + text_cell('B3', 'paper / text  ·  Keep every bill connected to its items.', 8) + '</row>')
    rows.append('<row r="5" ht="28" customHeight="1">' + text_cell('B5', '01  RECORD BILLS  →', 9) + text_cell('D5', '02  ADD ITEMS  →', 9) + text_cell('F5', '03  REVIEW', 9) + '</row>')
    rows.append('<row r="6" ht="28" customHeight="1">' + text_cell('B6', 'Open Bills. Add one row for each document and assign a unique Bill ID.', 6) + text_cell('D6', 'Open Bill Items. Repeat the parent Bill ID on every purchased item.', 6) + text_cell('F6', 'Check the source, amounts, and dates. Then change the review status.', 6) + '</row>')
    rows.append('<row r="7" ht="28" customHeight="1"/>')
    rows.append('<row r="9" ht="28" customHeight="1">' + text_cell('B9', 'RECORDING GUIDE', 9) + '</row>')
    for number, (topic, explanation) in enumerate(instructions, 10):
        merges.extend([f'B{number}:C{number}', f'D{number}:G{number}'])
        rows.append(f'<row r="{number}" ht="44" customHeight="1">' + text_cell(f'B{number}', topic, 10) + text_cell(f'D{number}', explanation, 11) + '</row>')
    return (f'<worksheet xmlns="{NS}"><sheetPr><tabColor rgb="FF64748B"/></sheetPr><dimension ref="A1:H{len(instructions) + 9}"/>'
            '<sheetViews><sheetView workbookViewId="0" showGridLines="0" zoomScale="90"/></sheetViews><sheetFormatPr defaultRowHeight="18"/>'
            '<cols><col min="1" max="1" width="3" customWidth="1"/><col min="2" max="7" width="18" customWidth="1"/><col min="8" max="8" width="3" customWidth="1"/></cols><sheetData>'
            + ''.join(rows) + '</sheetData>' + f'<mergeCells count="{len(merges)}">' + ''.join(f'<mergeCell ref="{ref}"/>' for ref in merges) + '</mergeCells>'
            + '<hyperlinks><hyperlink ref="B5" location="&apos;Bills&apos;!A1"/><hyperlink ref="D5" location="&apos;Bill Items&apos;!A1"/></hyperlinks>'
            + '<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>')


def validate(dataset):
    assert dataset['schemaVersion'] == 1
    bills = {bill['billId']: bill for bill in dataset['bills']}
    assert len(bills) == len(dataset['bills']), 'Duplicate Bill ID'
    ids, positions = set(), set()
    for item in dataset['items']:
        assert item['billId'] in bills, 'Item has no bill'
        assert item['itemId'] not in ids, 'Duplicate Item ID'
        ids.add(item['itemId'])
        position = (item['billId'], item['itemNumber'])
        assert position not in positions and item['itemNumber'] >= 1
        positions.add(position)
        assert item['sourcePage'] is None or item['sourcePage'] >= 1
    for bill in bills.values():
        if bill['billDate']:
            assert date.fromisoformat(bill['billDate']).isoformat() == bill['billDate']
        assert bill['reviewStatus'] in ('Needs review', 'Reviewed')
        # These checks apply to this explicit, tax-exclusive fictional example.
        amount = lambda field: Decimal(str(bill[field]))
        assert amount('subtotal') - amount('discountAmount') + amount('taxAmount') + amount('shippingAmount') == amount('totalAmount')
        assert amount('totalAmount') - amount('amountPaid') == amount('balanceDue')
        assert sum(Decimal(str(item['lineTotal'])) for item in dataset['items'] if item['billId'] == bill['billId']) == amount('totalAmount')


def write_workbook(path, dataset):
    bills = dataset['bills']
    bill_map = {bill['billId']: bill for bill in bills}
    items = sorted(dataset['items'], key=lambda item: (list(bill_map).index(item['billId']), item['itemNumber']))
    first_item = {}
    for index, item in enumerate(items, 2):
        first_item.setdefault(item['billId'], index)
    bill_rows, item_rows, bill_links, item_links = [], [], {}, {}
    bill_positions = {bill['billId']: index for index, bill in enumerate(bills, 2)}
    for index, bill in enumerate(bills, 2):
        target = first_item.get(bill['billId'])
        bill_rows.append({**bill, 'viewItems': 'View Items' if target else None})
        if target:
            bill_links[f'{col(len(COLUMNS["Bills"]))}{index}'] = f"'Bill Items'!A{target}"
    for index, item in enumerate(items, 2):
        bill = bill_map[item['billId']]
        item_rows.append({**{key: bill[key] for key in ('billNumber', 'vendorName', 'billDate', 'currency')}, **item, 'backToBill': 'Back to Bill'})
        item_links[f'{col(len(COLUMNS["Bill Items"]))}{index}'] = f"'Bills'!A{bill_positions[item['billId']]}"
    instructions = [
        ('Purpose', 'One row per bill in Bills; one row per purchased item in Bill Items.'),
        ('Find a bill', 'Use the filters on Bills to find a bill by date, vendor, or bill number.'),
        ('Find its items', 'Click View Items to jump to the first item. Filter Bill ID on Bill Items to see only that bill.'),
        ('Return to bill', 'Click Back to Bill on an item row.'),
        ('Bill ID', 'Use the same unique Bill ID in both sheets. Each Item ID is unique; Item Number starts at 1 within each bill.'),
        ('Navigation links', 'Populated exports link bills to their first item and back. After sorting or inserting rows, use Bill ID filters to find related records.'),
        ('Blank template', 'Add rows below the headers. Fill Bill ID on both sheets. Blank template navigation links are empty until records are exported.'),
        ('Ready to fill', 'Each data sheet starts with 25 formatted blank rows. Excel tables can expand as you enter more records; check the filter range in other spreadsheet apps.'),
        ('Unknown values', 'Leave unknown values blank. Zero means a confirmed zero.'),
        ('Amounts', 'Enter numeric amounts without currency symbols. Currency has its own column. Do not sum different currencies together.'),
        ('Tax and discounts', 'Keep bill-level totals on Bills. Item totals stay on Bill Items. Do not copy full bill totals to each item.'),
        ('Rate columns', 'Enter percentages as plain numbers: 18 means 18%, not 0.18.'),
        ('Dates and identifiers', 'Use YYYY-MM-DD dates. Identifier columns are text so leading zeros are preserved. Preserve ambiguous dates in Original Bill Date.'),
        ('Review', 'Use Needs review until you verify fields against the original bill; then choose Reviewed.'),
        ('Internal metadata', 'User ownership and save timestamps belong to the application dataset and are excluded from this export.'),
        ('Source', 'Source File identifies the original document; Source Page points to the item evidence.'),
    ]
    if not bills:
        instructions.insert(0, ('Workbook', 'Blank bill recording template. No real accounts or bills are included.'))
    sheets = [
        instruction_sheet(instructions),
        sheet(COLUMNS['Bills'], bill_rows, bill_links),
        sheet(COLUMNS['Bill Items'], item_rows, item_links, tab_color='84CC16'),
    ]
    names = ['Instructions', 'Bills', 'Bill Items']
    content_types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1, 4)) + '</Types>'
    content_types = content_types.replace('</Types>', '<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/><Override PartName="/xl/tables/table2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/></Types>')
    workbook = f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>' + ''.join(f'<sheet name={quoteattr(name)} sheetId="{i}" r:id="rId{i}"/>' for i, name in enumerate(names, 1)) + '</sheets></workbook>'
    relationships = f'<Relationships xmlns="{REL}">' + ''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1, 4)) + '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    path.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(path, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', content_types)
        archive.writestr('_rels/.rels', f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        archive.writestr('xl/workbook.xml', workbook)
        archive.writestr('xl/_rels/workbook.xml.rels', relationships)
        archive.writestr('xl/styles.xml', STYLES)
        for index, (name, rows) in enumerate([('Bills', bill_rows), ('Bill Items', item_rows)], 1):
            archive.writestr(f'xl/tables/table{index}.xml', table_definition(COLUMNS[name], rows, index, f'PaperTable{index}'))
            archive.writestr(f'xl/worksheets/_rels/sheet{index + 1}.xml.rels', f'<Relationships xmlns="{REL}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table{index}.xml"/></Relationships>')
        for i, contents in enumerate(sheets, 1):
            archive.writestr(f'xl/worksheets/sheet{i}.xml', contents)
    print(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)


if __name__ == '__main__':
    validate(EXAMPLE)
    write_workbook(ROOT / 'public/templates/bills-template.xlsx', {'bills': [], 'items': []})
