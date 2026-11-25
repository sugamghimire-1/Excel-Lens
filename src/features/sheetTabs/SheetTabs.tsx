import { ChevronLeft, ChevronRight, EyeOff, List, Lock, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MenuList } from '@/components/Menu';
import { Popover } from '@/components/Popover';
import { hideSheet, moveSheetTo, newSheet, renameSheetTo } from '@/state/actions';
import { canPoint, commitEdit } from '@/state/editing';
import { gridApi } from '@/state/gridApi';
import { activateSheet } from '@/state/selection';
import { useActiveSheet } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import type { Sheet } from '@/types';
import { cx } from '@/utils/cx';

export function SheetTabs() {
  const sheets = useWorkbook((s) => s.workbook.sheets);
  const active = useActiveSheet();
  const strip = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null);
  const visible = sheets.filter((s) => !s.hidden);

  useEffect(() => {
    strip.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active.id, sheets.length]);

  const scroll = (dx: number): void => strip.current?.scrollBy({ left: dx, behavior: 'smooth' });
  const button = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink';

  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-t border-line bg-chrome px-1.5">
      <Popover
        placement="above"
        trigger={(p) => (
          <button type="button" aria-label="All sheets" data-tip="All sheets" className={button} {...p}>
            <List size={15} />
          </button>
        )}
      >
        {(close) => (
          <MenuList
            onClose={close}
            items={sheets.map((s) => ({
              label: s.name,
              icon: s.hidden ? EyeOff : undefined,
              checked: s.id === active.id,
              onSelect: () => (s.hidden ? hideSheet(s.id, false) : activateSheet(s.id)),
            }))}
          />
        )}
      </Popover>
      <button type="button" aria-label="Scroll tabs left" className={button} onClick={() => scroll(-180)}>
        <ChevronLeft size={15} />
      </button>
      <button type="button" aria-label="Scroll tabs right" className={button} onClick={() => scroll(180)}>
        <ChevronRight size={15} />
      </button>
      <div
        ref={strip}
        role="tablist"
        aria-label="Sheets"
        className="no-scrollbar flex h-full min-w-0 items-center gap-0.5 overflow-x-auto px-1"
        onWheel={(e) => {
          if (strip.current) strip.current.scrollLeft += e.deltaY;
        }}
      >
        {visible.map((s, i) => (
          <Tab
            key={s.id}
            sheet={s}
            active={s.id === active.id}
            dropBefore={drag !== null && drag.over === i && drag.id !== s.id}
            dropAfter={drag !== null && i === visible.length - 1 && drag.over === visible.length}
            onDragState={(over) => setDrag(over === null ? null : { id: s.id, over })}
            onDrop={(over) => {
              setDrag(null);
              const target = visible[over];
              const from = sheets.findIndex((x) => x.id === s.id);
              const to = target ? sheets.findIndex((x) => x.id === target.id) : sheets.length;
              moveSheetTo(s.id, to > from ? to - 1 : to);
            }}
          />
        ))}
      </div>
      <button type="button" aria-label="New sheet" data-tip="New sheet" data-tip-keys="Shift+F11" className={button} onClick={() => newSheet()}>
        <Plus size={16} />
      </button>
      <div className="flex-1" />
    </div>
  );
}

interface TabProps {
  sheet: Sheet;
  active: boolean;
  dropBefore: boolean;
  dropAfter: boolean;
  onDragState: (over: number | null) => void;
  onDrop: (over: number) => void;
}

function Tab({ sheet, active, dropBefore, dropAfter, onDragState, onDrop }: TabProps) {
  const renaming = useUI((s) => s.renamingSheet === sheet.id);
  const set = useUI((s) => s.set);
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; moved: boolean } | null>(null);

  const activate = (): void => {
    const { edit } = useUI.getState();
    // While a formula is being typed, other sheets can be opened to point at cells.
    if (edit && !canPoint(edit) && !commitEdit()) return;
    activateSheet(sheet.id);
    if (!useUI.getState().edit) gridApi.focus();
  };

  const indexAt = (x: number): number => {
    const tabs = [...(ref.current?.closest('[role=tablist]')?.querySelectorAll<HTMLElement>('[role=tab]') ?? [])];
    let i = 0;
    for (const t of tabs) {
      const r = t.getBoundingClientRect();
      if (x > r.left + r.width / 2) i++;
    }
    return i;
  };

  return (
    <div className="relative flex h-full shrink-0 items-center">
      {dropBefore && <span className="absolute -left-[2px] top-1.5 h-6 w-[3px] rounded bg-accent" />}
      {dropAfter && <span className="absolute -right-[2px] top-1.5 h-6 w-[3px] rounded bg-accent" />}
      <div
        ref={ref}
        role="tab"
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        onMouseDown={(e) => e.preventDefault()}
        onPointerDown={(e) => {
          if (e.button !== 0 || renaming) return;
          start.current = { x: e.clientX, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
          activate();
        }}
        onPointerMove={(e) => {
          const s = start.current;
          if (!s) return;
          if (Math.abs(e.clientX - s.x) > 6) s.moved = true;
          if (s.moved) onDragState(indexAt(e.clientX));
        }}
        onPointerUp={(e) => {
          const s = start.current;
          start.current = null;
          if (s?.moved) onDrop(indexAt(e.clientX));
        }}
        onPointerCancel={() => {
          start.current = null;
          onDragState(null);
        }}
        onDoubleClick={() => set({ renamingSheet: sheet.id })}
        onContextMenu={(e) => {
          e.preventDefault();
          activate();
          set({ menu: { type: 'sheet', x: e.clientX, y: e.clientY, sheetId: sheet.id } });
        }}
        onKeyDown={(e) => {
          if (e.key === 'F2') set({ renamingSheet: sheet.id });
          if (e.key === 'Enter' || e.key === ' ') activate();
        }}
        className={cx(
          'relative flex h-7 min-w-[64px] max-w-[190px] cursor-default touch-none select-none items-center justify-center gap-1.5 rounded-md px-3 text-sm transition-colors',
          active ? 'bg-panel font-semibold text-accent shadow-card' : 'text-ink-2 hover:bg-hover hover:text-ink',
        )}
      >
        {sheet.protected && <Lock size={12} className="shrink-0 opacity-70" />}
        {renaming ? <RenameInput sheet={sheet} /> : <span className="truncate">{sheet.name}</span>}
        {sheet.tabColor && <span className={cx('absolute bottom-[3px] left-2.5 right-2.5 h-[2.5px] rounded-full', !active && 'opacity-80')} style={{ backgroundColor: sheet.tabColor }} />}
      </div>
    </div>
  );
}

function RenameInput({ sheet }: { sheet: Sheet }) {
  const [name, setName] = useState(sheet.name);
  const done = useRef(false);
  const finish = (save: boolean): void => {
    if (done.current) return;
    if (save && !renameSheetTo(sheet.id, name) && name.trim() !== sheet.name) {
      // The name was rejected; keep the field open so it can be corrected.
      return;
    }
    done.current = true;
    useUI.getState().set({ renamingSheet: null });
    gridApi.focus();
  };
  return (
    <input
      autoFocus
      aria-label="Sheet name"
      value={name}
      maxLength={31}
      size={Math.max(4, name.length)}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setName(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onBlur={() => {
        if (done.current) return;
        renameSheetTo(sheet.id, name);
        done.current = true;
        useUI.getState().set({ renamingSheet: null });
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') finish(false);
      }}
      className="rounded bg-accent-soft px-1 text-sm font-semibold text-ink outline-none"
    />
  );
}
