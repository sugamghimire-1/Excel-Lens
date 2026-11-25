/** Cell editing, formula pointing and commit rules. */
import { cellKey, inRange, normalizeRange, quoteSheet, rangeName } from '@/engine/address';
import { cellFromInput, cellsOp, CommandError, setInputAll } from '@/engine/commands/cells';
import { tableAt } from '@/engine/commands/data';
import { editText } from '@/engine/input';
import { baseStyle, isBlankCell, mergeAt } from '@/engine/sheet';
import { isValid, validationAt, validationMessage } from '@/engine/validation';
import { FormulaSyntaxError, getFunction, parseFormula, tokenize, walkAst } from '@/formulas';
import { cycleAbsolute, shiftFormula } from '@/formulas/rewrite';
import type { CellPos, Op, Range, Sheet } from '@/types';
import { gridApi } from './gridApi';
import { advance, step, type Direction } from './selection';
import { activeSelection, activeSheet, sheetById } from './selectors';
import { useUI, type EditState } from './uiStore';
import { useWorkbook } from './workbookStore';

const patch = (p: Partial<EditState>): void => {
  const { edit, set } = useUI.getState();
  if (edit) set({ edit: { ...edit, ...p } });
};

export function isEditing(): boolean {
  return useUI.getState().edit !== null;
}

/** Explains why a cell cannot be edited, or null when it can. */
function lockedReason(sheet: Sheet, r: number, c: number): string | null {
  if (sheet.protected) return `${sheet.name} is protected. Turn off protection on the Review tab to make changes.`;
  if (useWorkbook.getState().engine.isSpilled(sheet.id, r, c)) return 'This value comes from a formula that fills several cells. Edit the first cell of the result instead.';
  return null;
}

export function startEdit(options: { text?: string; mode?: EditState['mode']; origin?: EditState['origin']; caret?: number } = {}): boolean {
  const ui = useUI.getState();
  if (ui.edit) {
    if (options.origin && options.origin !== ui.edit.origin) patch({ origin: options.origin });
    return true;
  }
  const sheet = activeSheet();
  const { active } = activeSelection();
  const reason = lockedReason(sheet, active.r, active.c);
  if (reason) {
    ui.toast('info', reason);
    return false;
  }
  const cell = sheet.cells.get(cellKey(active.r, active.c));
  const text = options.text ?? editText(cell, baseStyle(sheet, active.r, active.c)?.numFmt);
  const caret = options.caret ?? text.length;
  ui.set({
    edit: {
      sheetId: sheet.id,
      r: active.r,
      c: active.c,
      text,
      mode: options.mode ?? (options.text !== undefined ? 'enter' : 'edit'),
      origin: options.origin ?? 'cell',
      caretStart: caret,
      caretEnd: caret,
      stamp: 1,
      point: null,
    },
    marquee: null,
    listMenu: null,
    noteEditor: null,
  });
  gridApi.reveal(active.r, active.c);
  return true;
}

/** Called by the inputs as the user types or moves the caret. */
export function editInput(text: string, caretStart: number, caretEnd: number): void {
  patch({ text, caretStart, caretEnd, point: null });
}

/** `value` is the text in the input; a mismatch means the event predates a change made from code. */
export function editCaret(value: string, caretStart: number, caretEnd: number): void {
  const { edit } = useUI.getState();
  if (!edit || value !== edit.text || (edit.caretStart === caretStart && edit.caretEnd === caretEnd)) return;
  const inPoint = edit.point && caretStart === edit.point.end && caretEnd === edit.point.end;
  patch({ caretStart, caretEnd, point: inPoint ? edit.point : null });
}

/** Replaces the text from code and moves the caret. */
export function editReplace(text: string, caret: number, extra: Partial<EditState> = {}): void {
  const { edit } = useUI.getState();
  if (!edit) return;
  patch({ text, caretStart: caret, caretEnd: caret, stamp: edit.stamp + 1, point: null, ...extra });
}

export function insertAtCaret(snippet: string, caretOffset = snippet.length): void {
  const { edit } = useUI.getState();
  if (!edit) return;
  const text = edit.text.slice(0, edit.caretStart) + snippet + edit.text.slice(edit.caretEnd);
  editReplace(text, edit.caretStart + caretOffset);
}

export function cancelEdit(): void {
  const { edit, set } = useUI.getState();
  if (!edit) return;
  set({ edit: null, activeSheetId: edit.sheetId });
  gridApi.focus();
}

export function toggleAbsolute(): void {
  const { edit } = useUI.getState();
  if (!edit?.text.startsWith('=')) return;
  const next = cycleAbsolute(edit.text, edit.caretStart);
  if (next) editReplace(next.text, next.caret, { point: edit.point ? { ...edit.point, end: edit.point.start + (next.caret - edit.point.start) } : null });
}

/* -------------------------------------------------------------- pointing */

/** True when the caret sits where a reference can be inserted. */
export function canPoint(edit: EditState | null): boolean {
  if (!edit?.text.startsWith('=')) return false;
  if (edit.point) return true;
  const before = edit.text.slice(0, edit.caretStart);
  const tokens = tokenize(before).filter((t) => t.type !== 'ws');
  const last = tokens[tokens.length - 1];
  if (!last) return true;
  return last.type === 'lparen' || last.type === 'sep' || (last.type === 'op' && last.text !== '%' && last.text !== '#');
}

/** Inserts or replaces the pointed reference with a range on the visible sheet. */
export function pointAt(anchor: CellPos, focus: CellPos): void {
  const { edit } = useUI.getState();
  if (!edit) return;
  const sheet = activeSheet();
  const { workbook } = useWorkbook.getState();
  let range: Range = normalizeRange(anchor, focus);
  const merge = mergeAt(sheet, anchor.r, anchor.c);
  if (merge && range.r1 === range.r2 && range.c1 === range.c2) range = { ...range, r1: merge.r1, c1: merge.c1, r2: merge.r1, c2: merge.c1 };
  const prefix = sheet.id === edit.sheetId ? '' : `${quoteSheet(sheetById(workbook, sheet.id).name)}!`;
  const ref = prefix + rangeName(range);
  const start = edit.point ? edit.point.start : edit.caretStart;
  const end = edit.point ? edit.point.end : edit.caretEnd;
  const text = edit.text.slice(0, start) + ref + edit.text.slice(end);
  const caret = start + ref.length;
  editReplace(text, caret, { point: { start, end: caret, anchor, focus, sheetId: sheet.id } });
}

/** Arrow keys while typing a formula move the pointed reference. */
export function pointMove(dir: Direction, extend: boolean): void {
  const { edit } = useUI.getState();
  if (!edit) return;
  const sheet = activeSheet();
  if (edit.point && edit.point.sheetId === sheet.id) {
    const focus = step(sheet, edit.point.focus, dir);
    pointAt(extend ? edit.point.anchor : focus, focus);
    gridApi.reveal(focus.r, focus.c);
    return;
  }
  const from = sheet.id === edit.sheetId ? { r: edit.r, c: edit.c } : activeSelection().active;
  const to = step(sheet, from, dir);
  pointAt(to, to);
  gridApi.reveal(to.r, to.c);
}

/* ---------------------------------------------------------------- commit */

/** Adds missing closing brackets; returns null when the formula still does not parse. */
export function repairFormula(text: string): string | null {
  try {
    parseFormula(text);
    return text;
  } catch {
    const tokens = tokenize(text);
    const open = tokens.filter((t) => t.type === 'lparen').length - tokens.filter((t) => t.type === 'rparen').length;
    const unclosed = tokens[tokens.length - 1]?.type === 'unknown' && tokens[tokens.length - 1].text.startsWith('"');
    let fixed = text.trimEnd();
    if (unclosed) fixed += '"';
    if (open > 0) fixed += ')'.repeat(open);
    if (fixed === text) return null;
    try {
      parseFormula(fixed);
      return fixed;
    } catch {
      return null;
    }
  }
}

/** Describes a call with too few or too many arguments, or returns null. */
function argumentProblem(text: string): string | null {
  let problem: string | null = null;
  walkAst(parseFormula(text), (n) => {
    if (n.k !== 'call' || problem) return;
    const def = getFunction(n.name);
    if (!def) return;
    if (n.args.length < def.min) problem = `${def.name} needs ${def.min === def.max ? '' : 'at least '}${def.min} ${def.min === 1 ? 'argument' : 'arguments'}.`;
    else if (n.args.length > def.max) problem = `${def.name} takes ${def.max === 0 ? 'no arguments' : `at most ${def.max} ${def.max === 1 ? 'argument' : 'arguments'}`}.`;
  });
  return problem;
}

/** Tables grow when data is typed right below or beside them. */
function growTable(sheet: Sheet, r: number, c: number): Op[] {
  if (tableAt(sheet, r, c)) return [];
  const below = sheet.tables.find((t) => !t.totalRow && r === t.range.r2 + 1 && c >= t.range.c1 && c <= t.range.c2);
  const beside = sheet.tables.find((t) => c === t.range.c2 + 1 && r >= t.range.r1 && r <= t.range.r2);
  const table = below ?? beside;
  if (!table) return [];
  const range: Range = below ? { ...table.range, r2: r } : { ...table.range, c2: c };
  if (sheet.tables.some((t) => t !== table && t.range.r1 <= range.r2 && t.range.r2 >= range.r1 && t.range.c1 <= range.c2 && t.range.c2 >= range.c1)) return [];
  const filter = sheet.filter && sheet.filter.range.r1 === table.range.r1 && sheet.filter.range.c1 === table.range.c1 ? { ...sheet.filter, range } : sheet.filter;
  return [{ t: 'sheet', sheetId: sheet.id, props: { tables: sheet.tables.map((t) => (t === table ? { ...t, range } : t)), filter } }];
}

export interface CommitOptions {
  move?: Direction | null;
  /** Enter the same text in the whole selection (Ctrl+Enter). */
  fillSelection?: boolean;
  /** Skip data validation, after the user chose to keep the value. */
  force?: boolean;
}

/** Writes the edit to the sheet. Returns false when editing should continue. */
export function commitEdit(options: CommitOptions = {}): boolean {
  const ui = useUI.getState();
  const { edit } = ui;
  if (!edit) return true;
  const { workbook, engine, dispatch } = useWorkbook.getState();
  const sheet = sheetById(workbook, edit.sheetId);
  let { text } = edit;

  if (text.startsWith('=') && text.length > 1) {
    const fixed = repairFormula(text);
    if (fixed === null) {
      let at = text.length;
      let why = 'Check the parentheses, commas and quotation marks.';
      try {
        parseFormula(text);
      } catch (e) {
        if (e instanceof FormulaSyntaxError) {
          at = e.position;
          why = e.message;
        }
      }
      ui.toast('error', `This formula cannot be read. ${why}`);
      editReplace(text, Math.min(text.length, at));
      return false;
    }
    text = fixed;
    const problem = argumentProblem(text);
    if (problem) {
      ui.toast('error', problem);
      editReplace(edit.text, edit.text.length);
      return false;
    }
  }

  const before = activeSelection();
  const original = sheet.cells.get(cellKey(edit.r, edit.c));
  const unchanged = editText(original, baseStyle(sheet, edit.r, edit.c)?.numFmt) === text;

  if (!(unchanged && !options.fillSelection)) {
    const rule = validationAt(sheet, edit.r, edit.c);
    if (rule && !options.force && !text.startsWith('=')) {
      const candidate = cellFromInput(sheet, edit.r, edit.c, text);
      if (!isValid(rule, candidate?.v ?? null, sheet, engine, edit.r, edit.c)) {
        showValidationError(rule.errorStyle, rule.errorTitle || 'This value is not allowed', validationMessage(rule), options);
        return false;
      }
    }
    try {
      let ops: Op[];
      if (options.fillSelection && before.ranges.some((x) => inRange(x, edit.r, edit.c))) {
        ops = setInputAll(sheet, before.ranges, { r: edit.r, c: edit.c }, text, shiftFormula);
      } else {
        ops = cellsOp(sheet, [[cellKey(edit.r, edit.c), cellFromInput(sheet, edit.r, edit.c, text)]]);
        if (text !== '' && isBlankCell(original)) ops.push(...growTable(sheet, edit.r, edit.c));
      }
      dispatch(text === '' ? 'Clear cell' : 'Typing', ops, { sheetId: sheet.id, before, after: before });
    } catch (e) {
      if (!(e instanceof CommandError)) throw e;
      ui.toast('error', e.message);
      return false;
    }
  }
  ui.set({ edit: null, activeSheetId: edit.sheetId });
  if (options.move) advance(options.move);
  gridApi.focus();
  return true;
}

function showValidationError(style: 'stop' | 'warning' | 'info', title: string, message: string, options: CommitOptions): void {
  const ui = useUI.getState();
  if (style === 'stop') {
    ui.set({
      dialog: {
        type: 'confirm',
        title,
        message,
        confirmLabel: 'Edit value',
        cancelLabel: 'Discard',
        onConfirm: () => editReplaceFocus(),
        onCancel: () => cancelEdit(),
      },
    });
    return;
  }
  ui.set({
    dialog: {
      type: 'confirm',
      title,
      message: style === 'warning' ? `${message} Keep this value anyway?` : message,
      confirmLabel: 'Keep value',
      cancelLabel: 'Edit value',
      onConfirm: () => {
        commitEdit({ ...options, force: true });
      },
      onCancel: () => editReplaceFocus(),
    },
  });
}

function editReplaceFocus(): void {
  const { edit } = useUI.getState();
  if (edit) editReplace(edit.text, edit.text.length, { mode: 'edit' });
  gridApi.focus();
}

/** Commits a pending edit before another command runs. */
export function settleEdit(): boolean {
  return isEditing() ? commitEdit() : true;
}
