"use client";

import type { StructuredData, StructuredField, StructuredTable } from "@/types/extraction/result";

type Props = {
  data: StructuredData;
  onChange: (data: StructuredData) => void;
  pages: number[];
  defaultPage: number;
};

const inputClass = "w-full min-w-28 rounded-md border border-line bg-panel px-2.5 py-2 text-sm text-foreground focus:border-accent/60 focus:outline-accent";

export default function StructuredReview({ data, onChange, pages, defaultPage }: Props) {
  const fields = data.fields.filter((field) => pages.includes(field.page));
  const tables = data.tables.filter((table) => pages.includes(table.page));
  const pending = fields.filter((field) => !field.reviewed).length + tables.filter((table) => !table.reviewed).length;

  function updateField(id: string, patch: Partial<StructuredField>) {
    onChange({ ...data, fields: data.fields.map((field) => field.id === id ? { ...field, ...patch } : field) });
  }

  function updateTable(id: string, patch: Partial<StructuredTable>) {
    onChange({ ...data, tables: data.tables.map((table) => table.id === id ? { ...table, ...patch } : table) });
  }

  function addField() {
    const field: StructuredField = {
      id: `manual-${crypto.randomUUID()}`, page: defaultPage, key: "new_field", label: "New field",
      value: "", sourceText: "", sourceLine: null, reviewed: false,
    };
    onChange({ ...data, fields: [...data.fields, field] });
  }

  function markVisibleReviewed() {
    onChange({ ...data,
      fields: data.fields.map((field) => pages.includes(field.page) ? { ...field, reviewed: true } : field),
      tables: data.tables.map((table) => pages.includes(table.page) ? { ...table, reviewed: true } : table),
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-accent/20 bg-accent-soft p-4">
        <h3 className="text-sm font-semibold text-accent-text">Check your data</h3>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span role="status" className="text-xs font-medium text-accent-text">{pending} items need review in this view</span>
          <button type="button" onClick={markVisibleReviewed} disabled={pending === 0} className="result-button bg-panel disabled:opacity-40">Mark visible items reviewed</button>
        </div>
        <details className="mt-3 text-xs leading-6 text-accent-text"><summary className="w-fit cursor-pointer font-medium">How to review</summary><p className="mt-2">Compare values with the source, correct any mistakes, and mark them reviewed. Dates and identifiers stay as text. Changes are included in JSON downloads.</p><a href="#structured-source-content" className="mt-2 inline-block font-medium text-accent underline underline-offset-4">View full document content</a></details>
      </div>
      {data.warnings.length > 0 && <details className="rounded-lg border border-line-strong bg-surface p-3 text-xs text-foreground"><summary className="cursor-pointer font-medium">Extraction notes ({data.warnings.length})</summary><ul className="mt-2 list-disc space-y-2 pl-5">{data.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}

      <section aria-labelledby="fields-title" className="overflow-hidden rounded-xl border border-line bg-panel">
        <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-4">
          <h3 id="fields-title" className="font-semibold text-foreground">Fields <span className="ml-1 font-normal text-subtle">({fields.length})</span></h3>
          <button type="button" onClick={addField} className="result-button">Add field · page {defaultPage}</button>
        </div>
        {fields.length === 0 ? <p className="p-5 text-sm leading-6 text-muted">No fields identified in these pages. Full formatted content is included below; you can also add a field manually.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-background text-xs text-muted"><tr><th scope="col" className="px-4 py-3">Source</th><th scope="col" className="px-3 py-3">Field</th><th scope="col" className="px-3 py-3">Value</th><th scope="col" className="px-3 py-3">Review</th></tr></thead>
              <tbody>{fields.map((field) => (
                <tr key={field.id} className="border-t border-line-soft align-top">
                  <td className="min-w-28 px-4 py-4 text-xs text-muted">
                    <span className="font-medium text-body">Page {field.page}</span>
                    <details className="mt-2"><summary className="cursor-pointer text-accent">{field.sourceLine ? `Line ${field.sourceLine}` : field.sourceText ? "Source text" : "Manual entry"}</summary><p className="mt-2 max-w-48 whitespace-pre-wrap break-words leading-5">{field.sourceText || "Added during review."}</p></details>
                  </td>
                  <td className="min-w-40 px-3 py-3"><input aria-label={`Field label, page ${field.page}`} value={field.label} onChange={(event) => updateField(field.id, { label: event.target.value, key: event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""), reviewed: false })} className={inputClass} /></td>
                  <td className="min-w-48 px-3 py-3"><textarea aria-label={`${field.label} value, page ${field.page}`} value={field.value} rows={2} onChange={(event) => updateField(field.id, { value: event.target.value, reviewed: false })} className={inputClass} /></td>
                  <td className="min-w-36 px-3 py-4">
                    <label className={`flex cursor-pointer items-center gap-2 text-xs ${field.reviewed ? "text-accent" : "text-muted"}`}><input type="checkbox" checked={field.reviewed} onChange={(event) => updateField(field.id, { reviewed: event.target.checked })} className="accent-accent" />{field.reviewed ? "Reviewed" : "Needs review"}</label>
                    <button type="button" aria-label={`Remove ${field.label} field, page ${field.page}`} onClick={() => onChange({ ...data, fields: data.fields.filter((entry) => entry.id !== field.id) })} className="mt-3 text-xs text-subtle hover:text-foreground">Remove</button>
                  </td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="tables-title" className="space-y-4">
        <h3 id="tables-title" className="font-semibold text-foreground">Tables <span className="ml-1 font-normal text-subtle">({tables.length})</span></h3>
        {tables.length === 0 && <p className="rounded-xl border border-dashed border-line bg-panel p-5 text-sm leading-6 text-muted">No reliable grid or repeated columns detected in these pages. Table content may still be present in the original text.</p>}
        {tables.map((table, tableIndex) => (
          <section key={table.id} aria-label={`Table ${tableIndex + 1}, page ${table.page}`} className="overflow-hidden rounded-xl border border-line bg-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line-soft p-4">
              <div><h4 className="text-sm font-semibold text-foreground">Table {tableIndex + 1} · Page {table.page}</h4><p className="mt-1 text-xs text-muted">{table.source === "pdf_layout" ? "PDF grid" : "Inferred column alignment"} · {table.rows.length} rows · {table.columns.length} columns</p></div>
              <label className={`flex cursor-pointer items-center gap-2 text-xs ${table.reviewed ? "text-accent" : "text-muted"}`}><input type="checkbox" checked={table.reviewed} onChange={(event) => updateTable(table.id, { reviewed: event.target.checked })} className="accent-accent" />{table.reviewed ? "Reviewed" : "Needs review"}</label>
            </div>
            <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-background"><tr>{table.columns.map((column, columnIndex) => <th key={columnIndex} scope="col" className="min-w-40 p-3"><input aria-label={`Table ${tableIndex + 1} column ${columnIndex + 1} name`} value={column} onChange={(event) => updateTable(table.id, { columns: table.columns.map((entry, index) => index === columnIndex ? event.target.value : entry), reviewed: false })} className={inputClass} /></th>)}<th scope="col" className="px-3 text-xs font-normal text-subtle">Row</th></tr></thead>
              <tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex} className="border-t border-line-soft">{row.map((cell, columnIndex) => <td key={columnIndex} className="p-3"><textarea aria-label={`Table ${tableIndex + 1}, row ${rowIndex + 1}, ${table.columns[columnIndex]}`} value={cell} rows={2} onChange={(event) => updateTable(table.id, { rows: table.rows.map((entry, index) => index === rowIndex ? entry.map((value, column) => column === columnIndex ? event.target.value : value) : entry), reviewed: false })} className={inputClass} /></td>)}<td className="px-3"><button type="button" aria-label={`Remove row ${rowIndex + 1} from table ${tableIndex + 1}`} onClick={() => updateTable(table.id, { rows: table.rows.filter((_, index) => index !== rowIndex), reviewed: false })} className="text-xs text-subtle hover:text-foreground">Remove</button></td></tr>)}</tbody>
            </table></div>
            <div className="flex flex-wrap gap-2 border-t border-line-soft p-3">
              <button type="button" disabled={table.rows.length === 0} onClick={() => updateTable(table.id, { columns: table.rows[0].map((cell, index) => cell || `Column ${index + 1}`), rows: table.rows.slice(1), reviewed: false })} className="result-button disabled:opacity-40">Use first row as headers</button>
              <button type="button" onClick={() => updateTable(table.id, { rows: [...table.rows, table.columns.map(() => "")], reviewed: false })} className="result-button">Add row</button>
              <button type="button" onClick={() => onChange({ ...data, tables: data.tables.filter((entry) => entry.id !== table.id) })} className="result-button">Remove table</button>
            </div>
          </section>
        ))}
      </section>
    </div>
  );
}
