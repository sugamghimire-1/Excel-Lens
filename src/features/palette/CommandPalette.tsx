import { CornerDownLeft, FunctionSquare, Search, Sheet, SquareTerminal, Tag, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { allFunctions } from '@/formulas';
import * as actions from '@/state/actions';
import { gridApi } from '@/state/gridApi';
import { activateSheet } from '@/state/selection';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { cx, shortcut } from '@/utils/cx';
import { openSample } from '../backstage/templates';
import { downloadCsv, downloadXlsx, openFileDialog } from '../io/fileActions';

interface Entry {
  label: string;
  hint: string;
  icon: LucideIcon;
  keys?: string;
  run: () => void;
}

const ui = (): ReturnType<typeof useUI.getState> => useUI.getState();

function commands(): Entry[] {
  const c = (label: string, hint: string, run: () => void, keys?: string): Entry => ({ label, hint, run, keys, icon: SquareTerminal });
  return [
    c('Bold', 'Home', () => actions.toggleStyle('bold'), 'Ctrl+B'),
    c('Italic', 'Home', () => actions.toggleStyle('italic'), 'Ctrl+I'),
    c('Underline', 'Home', () => actions.toggleStyle('underline'), 'Ctrl+U'),
    c('Wrap text', 'Home', () => actions.toggleStyle('wrap')),
    c('Merge and center', 'Home', () => actions.merge('toggle')),
    c('Format as currency', 'Home', () => actions.setNumberFormat('$#,##0.00')),
    c('Format as percent', 'Home', () => actions.setNumberFormat('0%'), 'Ctrl+Shift+%'),
    c('Format cells', 'Home', () => ui().set({ dialog: { type: 'format' } }), 'Ctrl+1'),
    c('Format as table', 'Home', () => actions.makeTable('solid-1'), 'Ctrl+T'),
    c('New conditional formatting rule', 'Home', () => ui().set({ dialog: { type: 'conditional', preset: 'gt' } })),
    c('Manage formatting rules', 'Home', () => ui().set({ panel: { type: 'conditional' } })),
    c('AutoSum', 'Home', () => actions.autoSum(), 'Alt+='),
    c('Clear formatting', 'Home', () => actions.clear('formats')),
    c('Insert rows', 'Home', () => actions.insertRows()),
    c('Insert columns', 'Home', () => actions.insertCols()),
    c('Delete rows', 'Home', actions.deleteRows),
    c('Delete columns', 'Home', actions.deleteCols),
    c('AutoFit column width', 'Home', () => actions.autoFit('col')),
    c('Find', 'Home', () => ui().set({ dialog: { type: 'find', replace: false } }), 'Ctrl+F'),
    c('Find and replace', 'Home', () => ui().set({ dialog: { type: 'find', replace: true } }), 'Ctrl+H'),
    c('Insert column chart', 'Insert', () => actions.insertChart('column')),
    c('Insert bar chart', 'Insert', () => actions.insertChart('bar')),
    c('Insert line chart', 'Insert', () => actions.insertChart('line')),
    c('Insert area chart', 'Insert', () => actions.insertChart('area')),
    c('Insert pie chart', 'Insert', () => actions.insertChart('pie')),
    c('Insert sparklines', 'Insert', () => ui().set({ dialog: { type: 'sparkline', kind: 'line' } })),
    c('Insert checkboxes', 'Insert', actions.insertCheckboxes),
    c('Insert link', 'Insert', () => ui().set({ dialog: { type: 'link' } }), 'Ctrl+K'),
    c('Insert note', 'Insert', actions.editNote, 'Shift+F2'),
    c('Insert function', 'Formulas', () => ui().set({ dialog: { type: 'function' } }), 'Shift+F3'),
    c('Sort A to Z', 'Data', () => actions.sort(false)),
    c('Sort Z to A', 'Data', () => actions.sort(true)),
    c('Custom sort', 'Data', () => ui().set({ dialog: { type: 'sort' } })),
    c('Filter', 'Data', actions.toggleFilter, 'Ctrl+Shift+L'),
    c('Data validation', 'Data', () => ui().set({ dialog: { type: 'validation' } })),
    c('Remove duplicates', 'Data', () => ui().set({ dialog: { type: 'duplicates' } })),
    c('Text to columns', 'Data', () => ui().set({ dialog: { type: 'split' } })),
    c('Circle invalid data', 'Data', () => ui().set({ circleInvalid: !ui().circleInvalid })),
    c('Define name', 'Formulas', () => ui().set({ dialog: { type: 'names', create: true } })),
    c('Name manager', 'Formulas', () => ui().set({ dialog: { type: 'names' } })),
    c('Trace precedents', 'Formulas', () => actions.trace('precedents')),
    c('Trace dependents', 'Formulas', () => actions.trace('dependents')),
    c('Show formulas', 'Formulas', () => ui().set({ showFormulas: !ui().showFormulas }), 'Ctrl+`'),
    c('Calculate now', 'Formulas', actions.calculateNow, 'F9'),
    c('Show all notes', 'Review', () => ui().set({ panel: { type: 'notes' } })),
    c('Show history', 'Review', () => ui().set({ panel: { type: 'history' } })),
    c('Protect or unprotect sheet', 'Review', actions.toggleProtection),
    c('Workbook statistics', 'Review', () => ui().set({ dialog: { type: 'stats' } })),
    c('Freeze panes at selection', 'View', () => actions.freeze('panes')),
    c('Freeze top row', 'View', () => actions.freeze('row')),
    c('Unfreeze panes', 'View', () => actions.freeze('none')),
    c('Toggle gridlines', 'View', actions.toggleGridlines),
    c('Light mode', 'View', () => ui().setTheme('light')),
    c('Dark mode', 'View', () => ui().setTheme('dark')),
    c('New sheet', 'Sheet', () => actions.newSheet(), 'Shift+F11'),
    c('Duplicate sheet', 'Sheet', () => actions.copySheet(ui().activeSheetId)),
    c('New workbook', 'File', () => ui().set({ backstage: 'new' })),
    c('Open file', 'File', () => openFileDialog('workbook'), 'Ctrl+O'),
    c('Download as Excel', 'File', () => void downloadXlsx()),
    c('Download as CSV', 'File', () => void downloadCsv()),
    c('Export as PDF', 'File', () => ui().set({ dialog: { type: 'pdf' } }), 'Ctrl+P'),
    c('Share', 'File', () => ui().set({ dialog: { type: 'share' } })),
    c('Open sample workbook', 'Help', openSample),
    c('Keyboard shortcuts', 'Help', () => ui().set({ dialog: { type: 'shortcuts' } }), 'F1'),
  ];
}

/** Rank by prefix, then word start, then anywhere. */
function score(label: string, q: string): number {
  const l = label.toLowerCase();
  if (l.startsWith(q)) return 3;
  if (l.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  return l.includes(q) ? 1 : 0;
}

export function CommandPalette() {
  const open = useUI((s) => s.palette);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const list = useRef<HTMLDivElement>(null);
  const workbook = useWorkbook((s) => s.workbook);
  const all = useMemo(
    (): Entry[] => [
      ...commands(),
      ...workbook.sheets.filter((s) => !s.hidden).map((s): Entry => ({ label: s.name, hint: 'Go to sheet', icon: Sheet, run: () => activateSheet(s.id) })),
      ...workbook.names.map((n): Entry => ({ label: n.name, hint: n.ref, icon: Tag, run: () => void actions.goTo(n.name) })),
      ...allFunctions().map((f): Entry => ({ label: f.name, hint: f.summary, icon: FunctionSquare, run: () => actions.insertFunction(f.name) })),
    ],
    [workbook],
  );
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return all.slice(0, 9);
    return all
      .map((e, i) => ({ e, i, s: score(e.label, q) * 2 + (e.hint.toLowerCase().includes(q) ? 0.5 : 0) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .slice(0, 40)
      .map((x) => x.e);
  }, [all, q]);

  useEffect(() => setIndex(0), [q]);
  useEffect(() => {
    list.current?.querySelector('[aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const close = (): void => {
    ui().set({ palette: false });
    gridApi.focus();
  };
  const run = (e: Entry | undefined): void => {
    if (!e) return;
    ui().set({ palette: false });
    gridApi.focus();
    e.run();
  };

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-start justify-center bg-[rgb(var(--shadow)/0.18)] px-4 pt-[9vh] dark:bg-black/40" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div role="dialog" aria-label="Find a command" className="flex max-h-[62vh] w-full max-w-[560px] animate-rise flex-col overflow-hidden rounded-xl bg-raised shadow-pop">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="text-ink-3" />
          <input
            autoFocus
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-label="Search commands"
            value={query}
            placeholder="Search commands, functions and sheets"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => (i + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                run(shown[index]);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            className="h-12 flex-1 bg-transparent text-base outline-none placeholder:text-ink-3"
          />
        </div>
        <div ref={list} id="palette-list" role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-auto p-1.5">
          {shown.map((e, i) => {
            const Icon = e.icon;
            return (
              <button key={`${e.label}-${e.hint}`} type="button" role="option" aria-selected={i === index} onMouseMove={() => setIndex(i)} onClick={() => run(e)} className={cx('flex h-9 w-full items-center gap-3 rounded-md px-2.5 text-left', i === index && 'bg-accent-soft')}>
                <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-3" />
                <span className="shrink-0 text-sm font-medium">{e.label}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-ink-3">{e.hint}</span>
                {e.keys && <span className="shrink-0 text-xs text-ink-3">{shortcut(e.keys)}</span>}
                {i === index && <CornerDownLeft size={14} className="shrink-0 text-ink-3" />}
              </button>
            );
          })}
          {shown.length === 0 && <p className="px-3 py-6 text-center text-ink-2">Nothing matches "{query}". Try a shorter word.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
