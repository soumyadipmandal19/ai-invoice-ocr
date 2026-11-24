"use client";

import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import { sessionColumnLabel } from "@/lib/bills/session-workbook";

type Props = {
  columns: string[];
  selected: readonly string[];
  onToggle: (column: string) => void;
  onEssential: () => void;
  onShowAll: () => void;
};

/** The top layer keeps controls outside the sticky spreadsheet's paint layers. */
export default function ColumnPicker({ columns, selected, onToggle, onEssential, onShowAll }: Props) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const place = useCallback(() => {
    const anchor = trigger.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = Math.min(256, window.innerWidth - 24);
    const height = popup.current?.getBoundingClientRect().height || 320;
    const below = anchor.bottom + 8;
    const top = Math.max(12, Math.min(below + height <= window.innerHeight - 12 ? below : anchor.top - height - 8, window.innerHeight - height - 12));
    const left = Math.max(12, Math.min(anchor.right - width, window.innerWidth - width - 12));
    setPosition((current) => current.top === top && current.left === left ? current : { top, left });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    const element = popup.current;
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (element?.matches(":popover-open")) element.hidePopover();
    };
  }, [open, place]);

  const count = columns.filter((column) => selected.includes(column)).length;
  return <>
    <button ref={trigger} type="button" popoverTarget={id} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} onClick={place} className="flex h-8 items-center rounded-md border border-line px-3 text-sm text-body hover:bg-surface">Columns <span className="ml-1.5 text-xs text-subtle">{count}</span></button>
    <div ref={popup} id={id} popover="auto" role="dialog" aria-label="Choose columns" onBeforeToggle={(event) => { if (event.newState === "open") place(); }} onToggle={(event) => setOpen(event.newState === "open")} style={{ ...position, margin: 0, right: "auto", bottom: "auto" }} className="fixed w-64 max-w-[calc(100vw-24px)] overflow-visible rounded-lg border border-line-strong bg-panel p-2 text-foreground shadow-xl">
      <div className="mb-2 flex gap-2 border-b border-line pb-2"><button type="button" onClick={onEssential} className="rounded px-2 py-1 text-sm text-accent hover:bg-surface">Essential</button><button type="button" onClick={onShowAll} className="rounded px-2 py-1 text-sm text-body hover:bg-surface">Show all</button></div>
      <div className="max-h-[min(16rem,50dvh)] overflow-y-auto">{columns.map((column) => <label key={column} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-body hover:bg-surface"><input type="checkbox" checked={selected.includes(column)} disabled={count === 1 && selected.includes(column)} onChange={() => onToggle(column)} className="accent-accent" />{sessionColumnLabel(column)}</label>)}</div>
    </div>
  </>;
}
