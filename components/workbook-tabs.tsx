"use client";

type SheetTab = { id: string; name: string; count?: number };

export default function WorkbookTabs({ sheets, activeId, onChange, label = "Workbook sheets" }: {
  sheets: SheetTab[];
  activeId: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
      {sheets.map((sheet) => <button key={sheet.id} type="button" aria-pressed={activeId === sheet.id} onClick={() => onChange(sheet.id)} className={`inline-flex min-h-9 shrink-0 items-center gap-2 border-r border-t-2 px-4 text-xs font-medium outline-offset-[-3px] transition-colors focus-visible:outline-2 focus-visible:outline-accent ${activeId === sheet.id ? "border-r-line border-t-accent bg-accent-soft text-accent" : "border-r-line border-t-transparent text-muted hover:bg-surface hover:text-foreground"}`}>
        {sheet.name}{sheet.count !== undefined && <span className="font-mono text-[10px] opacity-60">{sheet.count}</span>}
      </button>)}
    </div>
  );
}
