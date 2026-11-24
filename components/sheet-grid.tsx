"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useWorkspaceState, useWorkspaceScroll } from "@/components/workspace-provider";

const PAGE_SIZE = 100;

function columnLetter(index: number) {
  let label = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) {
    label = String.fromCharCode(65 + (number - 1) % 26) + label;
  }
  return label;
}

type Cell = { row: number; column: number };
type GridProps = {
  stateKey?: string;
  columnKeys?: readonly string[];
  rows: string[][];
  widths: number[];
  editable: (row: number, column: number) => boolean;
  onEdit: (row: number, column: number, value: string) => void;
  selected: Cell;
  onSelect: (cell: Cell) => void;
  bottomBar?: ReactNode;
  rowActions?: (row: number) => ReactNode;
  cellWarning?: (row: number, column: number) => string | undefined;
  emptyMessage?: string;
};

export function SheetGrid({ rows, widths, editable, onEdit, selected, onSelect, rowActions, bottomBar, cellWarning, emptyMessage, stateKey, columnKeys }: GridProps) {
  const instance = useId();
  const identity = stateKey || instance;
  const viewport = useRef<HTMLDivElement>(null);
  const [wrap, setWrap] = useWorkspaceState(`grid:${identity}:wrap`, false);
  const [zoom, setZoom] = useWorkspaceState(`grid:${identity}:zoom`, 100);
  const grid = useRef<HTMLTableElement>(null);
  const schema = (columnKeys || rows[0] || []).join("\u0000");
  const [editor, setEditing] = useState<(Cell & { value: string; schema: string }) | null>(null);
  // A removed/reordered column must never commit an editor to another field.
  const editing = editor?.schema === schema ? editor : null;
  const editActive = useRef(false);
  const [windowStart, setWindowStart] = useWorkspaceState(`grid:${identity}:window`, 0);
  const columns = rows[0]?.length || 1;
  const lastRow = Math.max(0, rows.length - 1);
  const safeSelected = {
    row: Math.min(selected.row, lastRow),
    column: Math.min(selected.column, columns - 1),
  };
  const value = rows[safeSelected.row]?.[safeSelected.column] || "";
  const canEdit = editable(safeSelected.row, safeSelected.column);
  const scale = zoom / 100;
  const gridWidth = widths.reduce((sum, width) => sum + width * scale, 48) + (rowActions ? 100 : 0);
  const totalDataRows = rows.length - 1;
  const safeStart = Math.min(windowStart, Math.max(0, Math.floor((totalDataRows - 1) / PAGE_SIZE) * PAGE_SIZE));
  useWorkspaceScroll(viewport, `grid:${identity}`, `${safeStart}:${totalDataRows}`);
  const visibleRows = [0, ...Array.from({ length: Math.min(PAGE_SIZE, totalDataRows - safeStart) }, (_, index) => safeStart + index + 1)];

  function focusCell(row: number, column: number) {
    const next = { row: Math.max(0, Math.min(row, lastRow)), column: Math.max(0, Math.min(column, columns - 1)) };
    if (next.row > 0) setWindowStart(Math.floor((next.row - 1) / PAGE_SIZE) * PAGE_SIZE);
    onSelect(next);
    requestAnimationFrame(() => {
      // A new edit may have started before this deferred navigation runs.
      if (editActive.current && editor?.schema === schema) return;
      const cell = grid.current?.querySelector<HTMLElement>(`[data-row="${next.row}"][data-column="${next.column}"]`);
      cell?.focus();
      cell?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  }

  function startEdit(initial?: string) {
    if (!canEdit) return;
    editActive.current = true;
    setEditing({ ...safeSelected, value: initial ?? value, schema });
  }

  function finishEdit(save: boolean) {
    if (!editing || !editActive.current) return;
    editActive.current = false;
    if (save && editing.value !== rows[editing.row]?.[editing.column]) onEdit(editing.row, editing.column, editing.value);
    setEditing(null);
  }

  function navigate(event: KeyboardEvent, row: number, column: number) {
    let nextRow = row;
    let nextColumn = column;
    if (event.key === "ArrowUp" || (event.key === "Enter" && event.shiftKey)) nextRow--;
    else if (event.key === "ArrowDown" || event.key === "Enter") nextRow++;
    else if (event.key === "ArrowLeft") nextColumn--;
    else if (event.key === "ArrowRight") nextColumn++;
    else if (event.key === "Home") { nextColumn = 0; if (event.ctrlKey || event.metaKey) nextRow = 0; }
    else if (event.key === "End") { nextColumn = columns - 1; if (event.ctrlKey || event.metaKey) nextRow = lastRow; }
    else if (event.key === "Tab") {
      nextColumn += event.shiftKey ? -1 : 1;
      if (nextColumn >= columns) { nextColumn = 0; nextRow++; }
      if (nextColumn < 0) { nextColumn = columns - 1; nextRow--; }
      // Let keyboard users leave the grid at either end.
      if (nextRow < 0 || nextRow > lastRow) return;
    } else return;
    event.preventDefault();
    focusCell(nextRow, nextColumn);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableCellElement>, row: number, column: number) {
    if (editing) return;
    if (event.key === "F2") { event.preventDefault(); startEdit(); }
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && editable(row, column)) {
      event.preventDefault(); startEdit(event.key);
    } else if ((event.key === "Delete" || event.key === "Backspace") && editable(row, column)) {
      event.preventDefault(); onEdit(row, column, "");
    } else navigate(event, row, column);
  }

  return (
    <>
      <div className="flex shrink-0 items-stretch border-b border-line bg-background">
        <label className="hidden items-center border-r border-line px-2 sm:flex"><span className="sr-only">Spreadsheet zoom</span><select value={zoom} onChange={(event) => setZoom(Number(event.target.value))} className="h-8 bg-background text-[11px] text-muted outline-accent"><option value={85}>85%</option><option value={100}>100%</option><option value={115}>115%</option></select></label>
        <div aria-label="Selected cell" className="flex w-14 shrink-0 items-center justify-center border-r border-line font-mono text-xs font-semibold text-accent">{columnLetter(safeSelected.column)}{safeSelected.row + 1}</div>
        <span aria-hidden="true" className="flex items-center px-3 font-serif text-sm italic text-subtle">fx</span>
        <textarea aria-label="Selected cell value" rows={1} value={value} readOnly={!canEdit} onChange={(event) => onEdit(safeSelected.row, safeSelected.column, event.target.value)} className="h-8 min-h-8 min-w-0 flex-1 resize-y bg-panel px-2 py-1.5 text-xs leading-5 text-body outline-accent read-only:bg-background" />
        <button type="button" aria-pressed={wrap} onClick={() => setWrap((current) => !current)} title="Wrap cell text" className={`shrink-0 border-l border-line px-3 text-[11px] focus-visible:outline-2 focus-visible:outline-accent ${wrap ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface"}`}>Wrap text</button>
      </div>
      <div ref={viewport} className="relative isolate min-h-0 flex-1 overflow-auto bg-background">
        <table ref={grid} role="grid" aria-label="Extracted data spreadsheet" aria-rowcount={rows.length + 1} aria-colcount={columns + 1 + (rowActions ? 1 : 0)} className="w-full table-fixed border-separate border-spacing-0 text-left" style={{ minWidth: gridWidth, fontSize: 14 * scale }}>
          <colgroup><col style={{ width: 48 }} />{widths.map((width, index) => <col key={columnKeys?.[index] ?? index} style={{ width: width * scale, minWidth: width * scale }} />)}{rowActions && <col style={{ width: 100, minWidth: 100 }} />}</colgroup>
          <thead><tr aria-rowindex={1} className="h-8 text-xs text-muted"><th className="sticky left-0 top-0 z-50 min-w-12 border-b border-r border-line-strong bg-surface text-center" aria-label="Row numbers" />{widths.map((_, index) => <th key={columnKeys?.[index] ?? index} scope="col" className={`sticky top-0 z-30 border-b border-r border-line-strong text-center font-medium ${safeSelected.column === index ? "bg-accent-selected text-accent-text" : "bg-surface"}`}>{columnLetter(index)}</th>)}{rowActions && <th scope="col" className="sticky right-0 top-0 z-50 border-b border-l border-line-strong bg-surface text-center font-medium">{columnLetter(columns)}</th>}</tr></thead>
          <tbody>{visibleRows.map((row) => (
            <tr key={row} aria-rowindex={row + 2}>
              <th scope="row" className={`sticky left-0 w-12 min-w-12 border-b border-r border-line text-center text-xs font-normal ${row === 0 ? "top-8 z-40 h-7 bg-raised" : `z-10 ${safeSelected.row === row ? "bg-accent-selected text-accent-text" : "bg-surface text-subtle"}`}`}>{row + 1}</th>
              {rows[row].map((cell, column) => {
                const active = safeSelected.row === row && safeSelected.column === column;
                const isEditing = editing?.row === row && editing.column === column;
                const warning = cellWarning?.(row, column);
                return <td key={columnKeys?.[column] ?? column} role="gridcell" aria-selected={active} aria-readonly={!editable(row, column)} aria-label={`${columnLetter(column)}${row + 1}: ${row === 0 ? cell : `${rows[0][column]}: ${cell}`}`} tabIndex={active ? 0 : -1} data-row={row} data-column={column}
                  onFocus={() => onSelect({ row, column })} onClick={(event) => { if (!isEditing) event.currentTarget.focus(); }} onDoubleClick={() => { if (!isEditing && editable(row, column)) { editActive.current = true; setEditing({ row, column, value: cell, schema }); } }} onKeyDown={(event) => onKeyDown(event, row, column)}
                  className={`max-w-[600px] border-b border-r border-line p-0 outline-none ${row === 0 ? "sticky top-8 z-20 bg-surface font-semibold text-body" : `relative ${editable(row, column) ? "bg-panel text-body" : "bg-background text-muted"}`} ${active ? "ring-2 ring-inset ring-accent" : ""}`}>
                  <div aria-hidden={isEditing || undefined} title={warning || cell || undefined} className={`min-h-7 px-2 py-1 leading-5 ${isEditing ? "invisible" : ""} ${warning ? "bg-amber-300/5 text-amber-200" : ""} ${wrap ? "whitespace-pre-wrap break-words" : "truncate"}`}>{warning && <span className="sr-only">Needs review: {warning} </span>}{cell || (warning ? "Missing" : "\u00a0")}</div>
                  {isEditing && <textarea autoFocus rows={1} aria-label={`Edit ${columnLetter(column)}${row + 1}`} value={editing.value} onChange={(event) => setEditing({ ...editing, value: event.target.value })} onBlur={() => finishEdit(true)}
                    onFocus={(event) => {
                      const editor = event.currentTarget;
                      editor.setSelectionRange(editor.value.length, editor.value.length);
                      editor.scrollTop = editor.scrollHeight;
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                      if (event.key === "Escape") { event.preventDefault(); finishEdit(false); focusCell(row, column); }
                      else if (event.key === "Tab" || (event.key === "Enter" && !event.altKey)) { finishEdit(true); navigate(event, row, column); }
                    }} style={{ fontSize: "inherit", outline: "none", outlineOffset: 0 }} className="absolute inset-0 block h-full min-h-0 w-full resize-none overflow-auto rounded-none border-0 bg-panel px-2 py-1 leading-5 text-body shadow-none outline-none ring-2 ring-inset ring-accent" />}
                </td>;
              })}
              {rowActions && <td role="gridcell" aria-readonly="true" className={`sticky right-0 border-b border-l border-line-strong px-2 py-0 text-center ${row === 0 ? "top-8 z-40 bg-surface font-semibold text-body" : "z-10 bg-panel"}`}>{row === 0 ? "Actions" : rowActions(row)}</td>}
            </tr>
          ))}
          </tbody>
        </table>
        {totalDataRows === 0 && <div role="status" className="sticky left-0 flex min-h-48 w-full flex-col items-center justify-center gap-2 px-6 py-10 text-center"><svg aria-hidden="true" className="mb-1 size-8 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M4 3h16v18H4zM4 9h16M10 9v12M4 15h16" /></svg><p className="text-sm font-medium text-body">No rows to display</p><p className="max-w-sm text-sm leading-6 text-subtle">{emptyMessage || "Rows will appear here when documents have been organized."}</p></div>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 border-t border-line bg-surface text-[10px] text-muted">
        {bottomBar}
        <span className="hidden px-3 py-2 sm:inline">{totalDataRows === 0 ? "No data rows" : `Rows ${safeStart + 1}–${Math.min(safeStart + PAGE_SIZE, totalDataRows)} of ${totalDataRows}`} · {columns} columns</span>
        {totalDataRows > PAGE_SIZE && <div className="flex gap-2"><button type="button" disabled={safeStart === 0} onClick={() => { const start = safeStart - PAGE_SIZE; setWindowStart(start); focusCell(start + 1, 0); }} className="result-button disabled:opacity-40">Previous rows</button><button type="button" disabled={safeStart + PAGE_SIZE >= totalDataRows} onClick={() => { const start = safeStart + PAGE_SIZE; setWindowStart(start); focusCell(start + 1, 0); }} className="result-button disabled:opacity-40">Next rows</button></div>}
      </div>
    </>
  );
}
