import { Check, ChevronDown, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cellKey, isFullCol, isFullRow } from '@/engine/address';
import { listOptions, validationAt } from '@/engine/validation';
import { saveNote } from '@/state/actions';
import { commitEdit, startEdit } from '@/state/editing';
import { gridApi } from '@/state/gridApi';
import { useActiveSheet, useSelection } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { cx, timeAgo } from '@/utils/cx';
import { Floating } from '@/components/Popover';
import type { GridController } from './GridController';
import { xOf, yOf } from './viewport';

/** DOM elements that sit on top of the canvas and follow the scroll position. */
export function GridOverlays({ controller }: { controller: GridController }) {
  useSyncExternalStore(controller.subscribe, controller.getFrame);
  const sheet = useActiveSheet();
  const { active, ranges } = useSelection();
  const edit = useUI((s) => s.edit);
  const listMenu = useUI((s) => s.listMenu);
  const noteEditor = useUI((s) => s.noteEditor);
  if (!controller.layout) return null;

  const rule = validationAt(sheet, active.r, active.c);
  const box = controller.cellBox(active.r, active.c);
  const { view } = controller.layout;
  const onScreen = box.x + box.w > view.headerW && box.y + box.h > view.headerH && box.x < view.width && box.y < view.height;
  const label = controller.resizeLabel;
  const last = ranges[ranges.length - 1];

  return (
    <>
      {rule?.kind.type === 'list' && onScreen && !edit && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Show list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => useUI.getState().set({ listMenu: listMenu ? null : active })}
          style={{ left: Math.min(box.x + box.w + 1, view.width - 22), top: box.y + Math.max(0, (box.h - 20) / 2) }}
          className="absolute z-[15] flex h-5 w-5 items-center justify-center rounded border border-line-strong bg-raised text-ink-2 shadow-card hover:bg-hover hover:text-ink"
        >
          <ChevronDown size={13} />
        </button>
      )}
      {listMenu && rule?.kind.type === 'list' && listMenu.r === active.r && listMenu.c === active.c && <ListMenu r={active.r} c={active.c} minWidth={box.w} />}
      {rule?.inputMessage && onScreen && !listMenu && !noteEditor && (
        <div className="pointer-events-none absolute z-[14] max-w-[230px] rounded-md bg-[#fff8de] px-2.5 py-1.5 text-xs text-[#4a3b0a] shadow-pop dark:bg-[#3a3420] dark:text-[#f3e6b8]" style={{ left: Math.min(box.x + 16, view.width - 240), top: box.y + box.h + 8 }}>
          {rule.inputTitle && <div className="font-semibold">{rule.inputTitle}</div>}
          {rule.inputMessage}
        </div>
      )}
      {controller.hoverNote && !noteEditor && <NotePreview controller={controller} r={controller.hoverNote.r} c={controller.hoverNote.c} />}
      {noteEditor && noteEditor.sheetId === sheet.id && <NoteEditor key={`${noteEditor.r},${noteEditor.c}`} r={noteEditor.r} c={noteEditor.c} />}
      {label && (
        <div className="pointer-events-none absolute z-30 rounded-md bg-ink px-2 py-1 text-xs font-medium text-panel shadow-pop" style={{ left: label.x, top: label.y }}>
          {label.text}
        </div>
      )}
      {!edit && !isFullCol(last) && !isFullRow(last) && <TouchHandle controller={controller} />}
    </>
  );
}

/** Enlarged selection handle, shown only on touch screens. */
function TouchHandle({ controller }: { controller: GridController }) {
  const { ranges } = useSelection();
  const range = ranges[ranges.length - 1];
  const l = controller.layout;
  const x = xOf(l, l.cols.offset(range.c2 + 1) - 0.01);
  const y = yOf(l, l.rows.offset(range.r2 + 1) - 0.01);
  if (x < l.view.headerW || y < l.view.headerH || x > l.view.width || y > l.view.height) return null;
  return (
    <div
      aria-hidden="true"
      style={{ left: x - 18, top: y - 18, touchAction: 'none' }}
      className="absolute z-[16] hidden h-9 w-9 items-center justify-center [@media(pointer:coarse)]:flex"
      onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
      onPointerMove={(e) => {
        if (e.buttons) controller.touchExtend(e.clientX, e.clientY);
      }}
    >
      <span className="h-4 w-4 rounded-full border-2 border-panel bg-accent shadow-card" />
    </div>
  );
}

function ListMenu({ r, c, minWidth }: { r: number; c: number; minWidth: number }) {
  const sheet = useActiveSheet();
  const engine = useWorkbook((s) => s.engine);
  const rule = validationAt(sheet, r, c);
  const options = rule ? listOptions(rule, sheet, engine) : [];
  const rect = gridApi.cellRect(r, c);
  const current = String(engine.readCell(sheet.id, r, c) ?? '');
  const [index, setIndex] = useState(Math.max(0, options.findIndex((o) => o === current)));
  const list = useRef<HTMLDivElement>(null);
  const close = (): void => {
    useUI.getState().set({ listMenu: null });
    gridApi.focus();
  };
  useEffect(() => list.current?.focus({ preventScroll: true }), []);
  if (!rect) return null;
  const pick = (value: string): void => {
    useUI.getState().set({ listMenu: null });
    if (startEdit({ text: value, mode: 'enter' })) commitEdit();
    gridApi.focus();
  };
  return (
    <Floating anchor={rect} onClose={close} gap={2}>
      <div
        ref={list}
        role="listbox"
        aria-label="Allowed values"
        tabIndex={-1}
        style={{ minWidth: Math.max(140, minWidth) }}
        className="max-h-[260px] overflow-auto p-1 outline-none"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            setIndex((i) => Math.max(0, Math.min(options.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (options[index] !== undefined) pick(options[index]);
          } else if (e.key === 'Tab') {
            e.preventDefault();
            close();
          }
        }}
      >
        {options.length === 0 && <div className="px-2.5 py-2 text-ink-3">The list source is empty.</div>}
        {options.map((o, i) => (
          <div key={o} role="option" aria-selected={i === index} onMouseEnter={() => setIndex(i)} onClick={() => pick(o)} className={cx('flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm', i === index && 'bg-hover')}>
            <Check size={14} className={o === current ? 'text-accent' : 'invisible'} />
            {o}
          </div>
        ))}
      </div>
    </Floating>
  );
}

function NotePreview({ controller, r, c }: { controller: GridController; r: number; c: number }) {
  const sheet = useActiveSheet();
  const note = sheet.cells.get(cellKey(r, c))?.note;
  if (!note) return null;
  const box = controller.cellBox(r, c);
  const { view } = controller.layout;
  const right = box.x + box.w + 10;
  return (
    <div className="pointer-events-none absolute z-[18] w-[220px] animate-fade rounded-lg bg-raised p-3 text-sm shadow-pop" style={{ left: right + 230 > view.width ? Math.max(8, box.x - 230) : right, top: Math.max(4, Math.min(box.y, view.height - 90)) }}>
      <div className="mb-1 flex items-center justify-between text-xs text-ink-3">
        <span className="font-semibold text-ink-2">{note.author}</span>
        <span>{timeAgo(note.updated)}</span>
      </div>
      <p className="whitespace-pre-wrap break-words">{note.text}</p>
    </div>
  );
}

function NoteEditor({ r, c }: { r: number; c: number }) {
  const sheet = useActiveSheet();
  const note = sheet.cells.get(cellKey(r, c))?.note;
  const [text, setText] = useState(note?.text ?? '');
  const rect = gridApi.cellRect(r, c);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
    input.current?.setSelectionRange(text.length, text.length);
    // Only on mount.
  }, []);
  if (!rect) return null;
  const close = (save: boolean): void => {
    useUI.getState().set({ noteEditor: null });
    if (save) saveNote(r, c, text);
    gridApi.focus();
  };
  return (
    <Floating anchor={rect} placement="right" gap={10} onClose={() => close(true)} role="dialog" label="Edit note">
      <div className="w-[250px] p-2.5">
        <textarea
          ref={input}
          value={text}
          aria-label="Note text"
          placeholder="Add a note about this cell"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(true);
          }}
          className="control h-24 resize-none py-2 leading-5"
        />
        <div className="mt-2 flex items-center justify-between">
          <button
            type="button"
            disabled={!note}
            onClick={() => {
              useUI.getState().set({ noteEditor: null });
              saveNote(r, c, '');
              gridApi.focus();
            }}
            className="flex h-7 items-center gap-1 rounded-md px-1.5 text-xs text-ink-2 hover:bg-hover hover:text-bad disabled:invisible"
          >
            <Trash2 size={13} /> Delete
          </button>
          <button type="button" onClick={() => close(true)} className="h-7 rounded-md bg-accent px-3 text-xs font-medium text-accent-ink hover:brightness-110">
            Save note
          </button>
        </div>
      </div>
    </Floating>
  );
}
