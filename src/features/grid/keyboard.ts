/** Keyboard behaviour for navigation, editing and app-wide shortcuts. */
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cellKey, isFullCol, isFullRow, MAX_ROWS } from '@/engine/address';
import { FORMAT_PRESETS } from '@/engine/numberFormat';
import { validationAt } from '@/engine/validation';
import * as actions from '@/state/actions';
import { cancelEdit, canPoint, commitEdit, insertAtCaret, pointMove, startEdit, toggleAbsolute } from '@/state/editing';
import { advance, goEnd, goHome, move, selectAll, selectCols, selectRows, extendTo, selectCell, type Direction } from '@/state/selection';
import { activeSelection, activeSheet, primaryRange } from '@/state/selectors';
import { saveNow } from '@/state/persistence';
import { useUI } from '@/state/uiStore';
import { gridApi } from '@/state/gridApi';
import { assistKey, useAssist } from './assistStore';

type Key = KeyboardEvent | ReactKeyboardEvent;

const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

const preset = (id: string): string | undefined => FORMAT_PRESETS.find((p) => p.id === id)?.code;

/** Shortcuts that work anywhere outside text fields. Returns true when handled. */
export function handleShortcut(e: Key): boolean {
  const ui = useUI.getState();
  const mod = e.ctrlKey || e.metaKey;
  const { key, code, shiftKey, altKey } = e;

  if (altKey && !mod) {
    if (code === 'Equal') return run(() => actions.autoSum());
    if (code === 'KeyQ') return run(() => ui.set({ palette: true }));
    if (key === 'ArrowDown') return run(openDropdown);
    if (key === 'PageDown') return run(() => move('right', { count: gridApi.pageCols(), extend: shiftKey }));
    if (key === 'PageUp') return run(() => move('left', { count: gridApi.pageCols(), extend: shiftKey }));
    return false;
  }

  if (!mod) {
    if (key === 'F9') return run(actions.calculateNow);
    if (key === 'F11' && shiftKey) return run(() => actions.newSheet());
    if (key === 'F2' && shiftKey) return run(actions.editNote);
    if (key === 'F3' && shiftKey) return run(() => ui.set({ dialog: { type: 'function' } }));
    if (key === 'F5') return run(() => ui.set({ dialog: { type: 'goto' } }));
    if (key === 'F1') return run(() => ui.set({ dialog: { type: 'shortcuts' } }));
    return false;
  }

  if (shiftKey && !altKey) {
    switch (code) {
      case 'KeyL':
        return run(actions.toggleFilter);
      case 'KeyZ':
        return run(actions.redo);
      case 'Digit1':
        return run(() => actions.setNumberFormat(preset('number')));
      case 'Digit3':
        return run(() => actions.setNumberFormat(preset('shortDate')));
      case 'Digit4':
        return run(() => actions.setNumberFormat(preset('currency')));
      case 'Digit5':
        return run(() => actions.setNumberFormat('0%'));
      case 'Digit7':
        return run(() => actions.borders('outside'));
      case 'Minus':
        return run(() => actions.borders('none'));
      case 'Backquote':
        return run(() => actions.setNumberFormat(undefined));
      case 'Equal':
      case 'NumpadAdd':
        return run(actions.insertSmart);
      case 'Semicolon':
        return run(() => actions.insertNow('time'));
      case 'Period':
        return run(() => actions.changeFontSize(1));
      case 'Comma':
        return run(() => actions.changeFontSize(-1));
      case 'KeyV':
        return run(() => void actions.pasteFromSystem('values'));
      case 'Digit9':
        return run(() => actions.hideAxis('row', false));
      case 'Digit0':
        return run(() => actions.hideAxis('col', false));
      default:
        break;
    }
  }

  switch (key.toLowerCase()) {
    case 's':
      return run(() => {
        if (!ui.edit || commitEdit()) void saveNow();
      });
    case 'f':
      return run(() => ui.set({ dialog: { type: 'find', replace: false } }));
    case 'h':
      return run(() => ui.set({ dialog: { type: 'find', replace: true } }));
    case 'g':
      return run(() => ui.set({ dialog: { type: 'goto' } }));
    case 'p':
      return run(() => ui.set({ dialog: { type: 'pdf' } }));
    case 'o':
      return run(() => ui.set({ backstage: 'open' }));
    case 'b':
    case '2':
      return run(() => actions.toggleStyle('bold'));
    case 'i':
    case '3':
      return run(() => actions.toggleStyle('italic'));
    case 'u':
    case '4':
      return run(() => actions.toggleStyle('underline'));
    case '5':
      return run(() => actions.toggleStyle('strike'));
    case '1':
      return run(() => ui.set({ dialog: { type: 'format' } }));
    case '9':
      return run(() => actions.hideAxis('row', true));
    case '0':
      return run(() => actions.hideAxis('col', true));
    case 'z':
      return run(actions.undo);
    case 'y':
      return run(actions.redo);
    case 'a':
      return run(selectAll);
    case 'd':
      return run(() => actions.fillDir('down'));
    case 'r':
      return run(() => actions.fillDir('right'));
    case 'k':
      return run(() => ui.set({ dialog: { type: 'link' } }));
    case 't':
      return run(() => actions.makeTable('solid-1'));
    case ';':
      return run(() => actions.insertNow('date'));
    case '`':
      return run(() => ui.set({ showFormulas: !ui.showFormulas }));
    case '-':
      return run(actions.deleteSmart);
    case '+':
    case '=':
      return key === '+' || code === 'NumpadAdd' ? run(actions.insertSmart) : false;
    case '\\':
      return run(() => actions.clear('formats'));
    default:
      return false;
  }
}

function run(fn: () => void): true {
  fn();
  return true;
}

/** Opens the list for the active cell: a validation list or filter menu. */
export function openDropdown(): void {
  const sheet = activeSheet();
  const { active } = activeSelection();
  const ui = useUI.getState();
  const { filter } = sheet;
  if (filter && active.r === filter.range.r1 && active.c >= filter.range.c1 && active.c <= filter.range.c2) {
    const rect = gridApi.cellRect(active.r, active.c);
    if (rect) ui.set({ filterMenu: { col: active.c, x: rect.right, y: rect.bottom } });
    return;
  }
  if (validationAt(sheet, active.r, active.c)?.kind.type === 'list') ui.set({ listMenu: { r: active.r, c: active.c } });
}

/** Keys pressed while the grid has focus and no cell is being edited. */
export function handleGridKey(e: ReactKeyboardEvent): void {
  if (e.nativeEvent.isComposing) return;
  const ui = useUI.getState();
  const mod = e.ctrlKey || e.metaKey;
  const { key, shiftKey } = e;
  const done = (): void => e.preventDefault();

  if (ui.selectedChart) {
    if (key === 'Delete' || key === 'Backspace') {
      done();
      actions.deleteChart(ui.selectedChart);
      return;
    }
    if (key === 'Escape') {
      done();
      ui.set({ selectedChart: null });
      return;
    }
    const dir = ARROWS[key];
    if (dir) {
      done();
      const chart = activeSheet().charts.find((c) => c.id === ui.selectedChart);
      const d = shiftKey ? 10 : 1;
      if (chart) actions.updateChart(chart.id, { x: Math.max(0, chart.x + (dir === 'left' ? -d : dir === 'right' ? d : 0)), y: Math.max(0, chart.y + (dir === 'up' ? -d : dir === 'down' ? d : 0)) }, 'Move chart');
      return;
    }
  }

  const dir = ARROWS[key];
  if (dir && !e.altKey) {
    done();
    move(dir, { extend: shiftKey, jump: mod });
    return;
  }
  switch (key) {
    case 'Enter':
      done();
      if (mod) return;
      if (e.altKey) return;
      advance(shiftKey ? 'up' : 'down');
      return;
    case 'Tab':
      if (mod || e.altKey) return;
      done();
      advance(shiftKey ? 'left' : 'right');
      return;
    case 'Home': {
      done();
      if (mod) {
        goHome(shiftKey);
        return;
      }
      const { active } = activeSelection();
      const c = activeSheet().frozenCols;
      if (shiftKey) extendTo({ r: active.r, c });
      else selectCell(active.r, c);
      return;
    }
    case 'End':
      done();
      if (mod) goEnd(shiftKey);
      else move('right', { jump: true, extend: shiftKey });
      return;
    case 'PageDown':
    case 'PageUp': {
      const delta = key === 'PageDown' ? 1 : -1;
      if (mod) {
        done();
        actions.cycleSheet(delta);
        return;
      }
      if (e.altKey) break;
      done();
      const { active, ranges } = activeSelection();
      const n = gridApi.pageRows();
      if (shiftKey) {
        const last = ranges[ranges.length - 1];
        const edge = active.r === last.r1 ? last.r2 : last.r1;
        extendTo({ r: Math.max(0, Math.min(MAX_ROWS - 1, edge + n * delta)), c: active.c === last.c1 ? last.c2 : last.c1 });
      } else selectCell(Math.max(0, Math.min(MAX_ROWS - 1, active.r + n * delta)), active.c);
      return;
    }
    case 'F2':
      if (shiftKey) break;
      done();
      startEdit({ mode: 'edit' });
      return;
    case 'Delete':
      done();
      actions.clear('contents');
      return;
    case 'Backspace':
      done();
      startEdit({ text: '', mode: 'enter' });
      return;
    case 'Escape':
      done();
      ui.set({ painter: null, found: null, traces: [], listMenu: null, filterMenu: null });
      actions.clearMarquee();
      return;
    case ' ':
      if (mod && shiftKey) {
        done();
        selectAll();
        return;
      }
      if (mod) {
        done();
        const r = primaryRange();
        selectCols(r.c1, r.c2, { active: activeSelection().active.c });
        return;
      }
      if (shiftKey) {
        done();
        const r = primaryRange();
        selectRows(r.r1, r.r2, { active: activeSelection().active.r });
        return;
      }
      if (typeof activeSheet().cells.get(cellKey(activeSelection().active.r, activeSelection().active.c))?.v === 'boolean') {
        done();
        actions.toggleCheckbox();
        return;
      }
      break;
    case 'ContextMenu':
      done();
      openContextMenu();
      return;
    default:
      break;
  }
  if (key === 'F10' && shiftKey) {
    done();
    openContextMenu();
    return;
  }
  if (handleShortcut(e)) done();
}

function openContextMenu(): void {
  const { active } = activeSelection();
  const rect = gridApi.cellRect(active.r, active.c);
  const range = primaryRange();
  if (rect) useUI.getState().set({ menu: { type: isFullCol(range) ? 'col' : isFullRow(range) ? 'row' : 'cell', x: rect.left + 16, y: rect.bottom } });
}

/** Keys pressed while editing, in the cell or in the formula bar. */
export function handleEditKey(e: ReactKeyboardEvent<HTMLTextAreaElement>): void {
  if (e.nativeEvent.isComposing) return;
  const ui = useUI.getState();
  const { edit } = ui;
  if (!edit) return;
  const mod = e.ctrlKey || e.metaKey;
  const { key, shiftKey, altKey } = e;

  if (!mod && !altKey && !shiftKey && assistKey(key)) {
    e.preventDefault();
    return;
  }
  if (key !== 'Shift' && key !== 'Control' && key !== 'Alt' && key !== 'Meta') useAssist.getState().set({ index: 0, navigated: false });

  const dir = ARROWS[key];
  if (dir && !mod && !altKey) {
    const pointing = canPoint(edit);
    if (edit.mode === 'enter' || edit.point) {
      if (pointing && edit.text.startsWith('=')) {
        e.preventDefault();
        pointMove(dir, shiftKey);
        return;
      }
      if (edit.origin === 'cell' && !shiftKey) {
        e.preventDefault();
        commitEdit({ move: dir });
      }
    }
    return;
  }

  switch (key) {
    case 'Enter':
      e.preventDefault();
      if (altKey) insertAtCaret('\n');
      else if (mod) commitEdit({ fillSelection: true });
      else commitEdit({ move: shiftKey ? 'up' : 'down' });
      return;
    case 'Tab':
      e.preventDefault();
      commitEdit({ move: shiftKey ? 'left' : 'right' });
      return;
    case 'Escape':
      e.preventDefault();
      cancelEdit();
      return;
    case 'F2':
      e.preventDefault();
      ui.set({ edit: { ...edit, mode: edit.mode === 'enter' ? 'edit' : 'enter' } });
      return;
    case 'F4':
      e.preventDefault();
      toggleAbsolute();
      return;
    case 'F9':
      e.preventDefault();
      return;
    default:
      break;
  }
  if (mod && key.toLowerCase() === 's') {
    e.preventDefault();
    if (commitEdit()) void saveNow();
  } else if (mod && (key.toLowerCase() === 'f' || key.toLowerCase() === 'h')) {
    e.preventDefault();
    if (commitEdit()) handleShortcut(e);
  }
}
