import { useImperativeHandle, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ClipboardEvent, type CSSProperties, type Ref } from 'react';
import { effectiveStyle } from '@/engine/effective';
import { fontString, lineHeight, measureText } from '@/engine/measure';
import { mergeAt } from '@/engine/sheet';
import { themeById } from '@/engine/themes';
import { copySelection, pasteData } from '@/state/actions';
import { editCaret, editInput, startEdit } from '@/state/editing';
import { useActiveSheet, useSelection } from '@/state/selectors';
import { useUI } from '@/state/uiStore';
import { useWorkbook } from '@/state/workbookStore';
import { cx } from '@/utils/cx';
import { FormulaAssist } from './FormulaAssist';
import { FormulaText } from './FormulaText';
import type { GridController } from './GridController';
import { adaptFill, adaptText, DARK, LIGHT } from './gridPalette';
import { handleEditKey, handleGridKey } from './keyboard';

/**
 * A textarea that always has focus while the grid is active. It is invisible
 * until typing starts, which keeps input methods and clipboard events native.
 */
export function CellEditor({ controller, ref }: { controller: GridController; ref: Ref<{ focus(): void }> }) {
  const frame = useSyncExternalStore(controller.subscribe, controller.getFrame);
  const sheet = useActiveSheet();
  const selection = useSelection();
  const edit = useUI((s) => s.edit);
  const dark = useUI((s) => s.dark);
  const themeId = useWorkbook((s) => s.workbook.themeId);
  const input = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({ focus: () => input.current?.focus({ preventScroll: true }) }), []);

  const here = edit !== null && edit.sheetId === sheet.id;
  const shown = here && edit !== null;
  const pos = shown ? { r: edit.r, c: edit.c } : selection.active;

  // Apply caret positions that were set from code.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el || !edit || edit.origin !== 'cell') return;
    if (document.activeElement !== el && !useUI.getState().dialog) el.focus({ preventScroll: true });
    el.setSelectionRange(edit.caretStart, edit.caretEnd);
  }, [edit?.stamp, edit?.origin, edit === null]);

  const style = useMemo(() => effectiveStyle(sheet, pos.r, pos.c, themeById(themeId)), [sheet, pos.r, pos.c, themeId]);

  const layout = useMemo((): { wrap: CSSProperties; text: CSSProperties } => {
    void frame;
    const l = controller.layout;
    const cell = controller.cellBox(pos.r, pos.c);
    const { view } = l;
    const z = view.zoom;
    const palette = dark ? DARK : LIGHT;
    const left = Math.max(view.headerW, Math.min(cell.x, view.width - 40));
    const top = Math.max(view.headerH, Math.min(cell.y, view.height - 22));
    const font = fontString(style, z);
    const line = lineHeight(style?.fontSize) * z;
    const pad = 5 * z;
    const fill = style?.fill ? adaptFill(style.fill, palette) : palette.canvas;
    const color = style?.color ? adaptText(style.color, fill, palette) : palette.text;
    let width = cell.w;
    let height = cell.h;
    if (shown) {
      const lines = edit.text.split('\n');
      const wraps = style?.wrap || mergeAt(sheet, pos.r, pos.c) !== null;
      const widest = Math.max(...lines.map((t) => measureText(t, font))) + pad * 2 + 8;
      const maxW = Math.max(cell.w, view.width - left - 6);
      width = wraps ? cell.w : Math.min(maxW, Math.max(cell.w, widest));
      const perLine = Math.max(10, width - pad * 2);
      const count = lines.reduce((n, t) => n + Math.max(1, Math.ceil(measureText(t, font) / perLine)), 0);
      height = Math.min(view.height - top - 4, Math.max(cell.h, count * line + 4));
    }
    const align = style?.hAlign ?? 'left';
    const vPad = shown && edit.text.includes('\n') ? 1 : Math.max(0, height - line - 1.5 * z);
    return {
      wrap: { left: left - 1, top: top - 1, width: width + 1, height: height + 1, backgroundColor: fill },
      text: {
        // Line height goes in the shorthand so the two never conflict.
        font: font.replace('px ', `px/${line}px `),
        padding: `${height > line * 2 ? 1 : vPad}px ${pad}px 0`,
        textAlign: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
        color,
        letterSpacing: 'normal',
      },
    };
  }, [controller, frame, pos.r, pos.c, style, dark, shown, edit?.text, sheet]);

  const isFormula = shown && edit.text.startsWith('=');

  const onCopy = (e: ClipboardEvent, cut: boolean): void => {
    if (edit) return;
    e.preventDefault();
    const data = copySelection(cut);
    if (!data) return;
    e.clipboardData.setData('text/plain', data.text);
    e.clipboardData.setData('text/html', data.html);
  };

  return (
    <>
      <div
        ref={box}
        style={layout.wrap}
        className={cx('absolute z-20 overflow-hidden', shown ? 'rounded-[2px] shadow-pop ring-2 ring-accent' : 'pointer-events-none opacity-0')}
      >
        {isFormula && (
          <div aria-hidden="true" style={layout.text} className="pointer-events-none absolute inset-0 whitespace-pre-wrap break-words">
            <FormulaText text={edit.text} sheetId={edit.sheetId} />
          </div>
        )}
        <textarea
          ref={input}
          aria-label={shown ? `Editing ${sheet.name} cell` : 'Spreadsheet. Type to edit the selected cell.'}
          data-grid-sink=""
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          value={shown ? edit.text : ''}
          style={{ ...layout.text, ...(isFormula ? { color: 'transparent', caretColor: dark ? '#e3e8f0' : '#1b2333' } : {}) }}
          className="absolute inset-0 h-full w-full resize-none overflow-hidden whitespace-pre-wrap break-words border-0 bg-transparent outline-none"
          onChange={(e) => {
            const el = e.target;
            if (edit) editInput(el.value, el.selectionStart, el.selectionEnd);
            else if (el.value) startEdit({ text: el.value, mode: 'enter' });
          }}
          onSelect={(e) => {
            if (edit?.origin === 'cell') editCaret(e.currentTarget.value, e.currentTarget.selectionStart, e.currentTarget.selectionEnd);
          }}
          onFocus={() => {
            if (edit && edit.origin !== 'cell' && here) startEdit({ origin: 'cell' });
          }}
          onKeyDown={(e) => {
            if (edit) handleEditKey(e);
            else handleGridKey(e);
          }}
          onCopy={(e) => onCopy(e, false)}
          onCut={(e) => onCopy(e, true)}
          onPaste={(e) => {
            if (edit) return;
            e.preventDefault();
            pasteData({ text: e.clipboardData.getData('text/plain'), html: e.clipboardData.getData('text/html') });
          }}
          onDrop={(e) => e.preventDefault()}
        />
      </div>
      {shown && <FormulaAssist host={box} origin="cell" />}
    </>
  );
}
