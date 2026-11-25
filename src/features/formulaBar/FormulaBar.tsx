import { Check, ChevronDown, ChevronUp, FunctionSquare, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cellKey, cellName, parseRangeName, prettyRangeName, rangeEquals, rangeSize, splitSheetRef } from '@/engine/address';
import { validateName } from '@/engine/commands/sheets';
import { MenuList } from '@/components/Menu';
import { Popover } from '@/components/Popover';
import { defineNameFromSelection, goTo } from '@/state/actions';
import { cancelEdit, commitEdit, editCaret, editInput, startEdit } from '@/state/editing';
import { gridApi } from '@/state/gridApi';
import { primaryRange, useActiveCell, useSelection } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { cx } from '@/utils/cx';
import { FormulaAssist } from '../grid/FormulaAssist';
import { FormulaText } from '../grid/FormulaText';
import { handleEditKey } from '../grid/keyboard';

export function FormulaBar() {
  const tall = useUI((s) => s.formulaBarTall);
  const edit = useUI((s) => s.edit);
  const set = useUI((s) => s.set);
  const keepFocus = { onMouseDown: (e: React.MouseEvent) => e.preventDefault() };
  return (
    <div className="flex items-start gap-1.5 border-b border-line bg-panel px-2 py-[5px]">
      <NameBox />
      <div className="flex h-7 shrink-0 items-center rounded-md" {...keepFocus}>
        <BarButton label="Cancel" keys="Esc" disabled={!edit} onClick={cancelEdit} className="hover:text-bad">
          <X size={15} />
        </BarButton>
        <BarButton label="Enter" keys="Enter" disabled={!edit} onClick={() => commitEdit()} className="hover:text-good">
          <Check size={15} />
        </BarButton>
        <BarButton label="Insert function" keys="Shift+F3" onClick={() => set({ dialog: { type: 'function' } })}>
          <FunctionSquare size={15} />
        </BarButton>
      </div>
      <FormulaInput tall={tall} />
      <BarButton label={tall ? 'Collapse formula bar' : 'Expand formula bar'} onClick={() => set({ formulaBarTall: !tall })}>
        {tall ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </BarButton>
    </div>
  );
}

function BarButton({ label, keys, className, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; keys?: string }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      data-tip={label}
      data-tip-keys={keys}
      className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-hover hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent', className)}
      {...rest}
    />
  );
}

/** Shows the selection; typing a reference or name goes there, a new name defines it. */
function NameBox() {
  const sel = useSelection();
  const { sheet } = useActiveCell();
  const names = useWorkbook((s) => s.workbook.names);
  const range = primaryRange(sel);
  const size = rangeSize(range);
  const named = names.find((n) => {
    const ref = splitSheetRef(n.ref);
    const r = parseRangeName(ref.local);
    return r && ref.sheet?.toLowerCase() === sheet.name.toLowerCase() && rangeEquals(r, range);
  });
  const label = named?.name ?? (size.cells > 1 && sel.ranges.length === 1 ? prettyRangeName(range) : cellName(sel.active.r, sel.active.c));
  const [draft, setDraft] = useState<string | null>(null);

  const commit = (): void => {
    const text = draft?.trim();
    setDraft(null);
    if (text && text !== label && !goTo(text)) {
      const { workbook } = useWorkbook.getState();
      const problem = validateName(workbook, text);
      if (problem) useUI.getState().toast('error', problem);
      else {
        defineNameFromSelection(text);
        useUI.getState().toast('success', `${text} now refers to ${prettyRangeName(range)}.`);
      }
    }
    gridApi.focus();
  };

  return (
    <div className="flex h-7 w-[128px] shrink-0 items-center rounded-md border border-line bg-panel transition-colors focus-within:border-accent hover:border-line-strong">
      <input
        aria-label="Cell reference or name"
        value={draft ?? label}
        spellCheck={false}
        onFocus={(e) => {
          setDraft(label);
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') {
            setDraft(null);
            gridApi.focus();
          }
        }}
        className="h-full min-w-0 flex-1 rounded-md bg-transparent pl-2.5 text-sm font-medium outline-none"
      />
      <Popover
        align="end"
        trigger={(p) => (
          <button type="button" tabIndex={-1} aria-label="Defined names" {...p} className="flex h-full w-6 items-center justify-center text-ink-3 hover:text-ink">
            <ChevronDown size={13} />
          </button>
        )}
      >
        {(close) => (
          <MenuList
            onClose={close}
            items={[
              ...(names.length ? names.map((n) => ({ label: n.name, hint: n.ref, onSelect: () => void goTo(n.name) })) : [{ label: 'No names defined yet', disabled: true }]),
              'separator' as const,
              { label: 'Manage names', onSelect: () => useUI.getState().set({ dialog: { type: 'names' } }) },
            ]}
          />
        )}
      </Popover>
    </div>
  );
}

function FormulaInput({ tall }: { tall: boolean }) {
  const { text, sheet, pos } = useActiveCell();
  const edit = useUI((s) => s.edit);
  const dark = useUI((s) => s.dark);
  const host = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const value = edit ? edit.text : text;
  const isFormula = value.startsWith('=');
  const engine = useWorkbook((s) => s.engine);
  useWorkbook((s) => s.revision);
  const spill = !edit && engine.isSpilled(sheet.id, pos.r, pos.c) ? engine.spillAt(sheet.id, pos.r, pos.c) : null;
  const shown = spill && !value ? (sheet.cells.get(cellKey(spill.anchor.r, spill.anchor.c))?.f ?? '') : value;

  useLayoutEffect(() => {
    const el = input.current;
    if (!el || !edit || edit.origin !== 'bar') return;
    if (document.activeElement !== el) el.focus({ preventScroll: true });
    el.setSelectionRange(edit.caretStart, edit.caretEnd);
  }, [edit?.stamp, edit?.origin, edit === null]);

  // Size to content, up to the visible limit.
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = '0px';
    const max = tall ? 108 : edit?.origin === 'bar' ? 108 : 26;
    const h = Math.max(tall ? 68 : 26, Math.min(max, el.scrollHeight));
    el.style.height = `${h}px`;
  }, [shown, tall, edit?.origin, edit === null]);

  return (
    <div ref={host} className="relative min-w-0 flex-1 rounded-md border border-line bg-panel transition-colors focus-within:border-accent hover:border-line-strong">
      {isFormula && (
        <div ref={mirror} aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-2.5 py-[3px] text-sm leading-5">
          <FormulaText text={value} sheetId={edit?.sheetId ?? sheet.id} />
        </div>
      )}
      <textarea
        ref={input}
        rows={1}
        aria-label="Formula"
        spellCheck={false}
        autoComplete="off"
        value={shown}
        style={isFormula ? { color: 'transparent', caretColor: dark ? '#e3e8f0' : '#1b2333' } : undefined}
        className={cx('block w-full resize-none whitespace-pre-wrap', tall || edit?.origin === 'bar' ? 'overflow-auto' : 'overflow-hidden', 'break-words bg-transparent px-2.5 py-[3px] text-sm leading-5 outline-none', spill && 'text-ink-3')}
        onFocus={(e) => {
          if (edit) {
            if (edit.origin !== 'bar') startEdit({ origin: 'bar' });
            return;
          }
          const el = e.currentTarget;
          if (!startEdit({ mode: 'edit', origin: 'bar' })) {
            el.blur();
            gridApi.focus();
          }
        }}
        onChange={(e) => {
          if (useUI.getState().edit) editInput(e.target.value, e.target.selectionStart, e.target.selectionEnd);
        }}
        onSelect={(e) => {
          if (useUI.getState().edit?.origin === 'bar') editCaret(e.currentTarget.value, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
        }}
        onScroll={(e) => {
          if (mirror.current) mirror.current.scrollTop = e.currentTarget.scrollTop;
        }}
        onKeyDown={handleEditKey}
      />
      <FormulaAssist host={host} origin="bar" />
    </div>
  );
}
