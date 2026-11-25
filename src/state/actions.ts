/** User-level actions shared by the ribbon, menus and keyboard shortcuts. */
import { cellKey, cellRange, colName, inRange, isFullCol, isFullRow, MAX_COLS, MAX_ROWS, parseRangeName, quoteSheet, rangeName, rangesOverlap, rangeSize, splitSheetRef } from '@/engine/address';
import { colAxis, rowAxis } from '@/engine/axis';
import { readChartData } from '@/engine/chartData';
import { clearRanges, CommandError, deleteCells, insertCells, moveRange, setLink, setNote, type ClearKind } from '@/engine/commands/cells';
import { buildClip, clipToHtml, clipToText, gridFromHtml, gridFromText, parseTsv, pasteClip, pasteGrid, type PasteMode } from '@/engine/commands/clipboard';
import { createTable, looksLikeHeader, setFilter, setFilterCriterion, sortRange, tableAt, type SortKey } from '@/engine/commands/data';
import { fillDirection, fillRange } from '@/engine/commands/fill';
import { applyBorders, applyStyle, autoColWidths, autoRowHeights, mapStyle, mergeCells, mergeLoss, paintFormat, setAxisHidden, setAxisSize, unmergeCells, type BorderPreset } from '@/engine/commands/format';
import { addSheet, createChart, deleteAxis, duplicateSheet, insertAxis, moveSheet, removeSheet, renameSheet, setCharts } from '@/engine/commands/sheets';
import { DEFAULT_FONT_SIZE, FONT_SIZES } from '@/engine/measure';
import { adjustDecimals, CHECKBOX_FORMAT } from '@/engine/numberFormat';
import { baseStyle, clipToContent, contentRange, expandToMerges, getSheet, internStyle, isBlankCell, patchStyle } from '@/engine/sheet';
import type { ChartModel, ChartType, ConditionalRule, FilterCriterion, HAlign, Op, Range, SelectionState, Sheet, Sparkline, StylePatch, ValidationRule, VAlign } from '@/types';
import { uid } from '@/utils/id';
import { editReplace, insertAtCaret, settleEdit, startEdit } from './editing';
import { gridApi } from './gridApi';
import { activateSheet, dataRange, selectCell, selectRange, setSelection } from './selection';
import { activeSelection, activeSheet, primaryRange, sheetById } from './selectors';
import { useUI } from './uiStore';
import { useWorkbook } from './workbookStore';

const doc = (): ReturnType<typeof useWorkbook.getState> => useWorkbook.getState();
const ui = (): ReturnType<typeof useUI.getState> => useUI.getState();

interface RunOptions {
  /** Selection after the change, restored on redo. */
  select?: Range;
  /** Allowed on protected sheets (view-only changes). */
  viewOnly?: boolean;
  silent?: boolean;
  noFit?: boolean;
}

/** Runs a command on the active sheet with error reporting and history. */
export function run(label: string, build: (sheet: Sheet, ranges: Range[], sel: SelectionState) => Op[], options: RunOptions = {}): boolean {
  if (!settleEdit()) return false;
  const sheet = activeSheet();
  if (sheet.protected && !options.viewOnly) {
    ui().toast('info', `${sheet.name} is protected. Turn off protection on the Review tab to make changes.`);
    return false;
  }
  const before = activeSelection();
  try {
    const ops = build(sheet, before.ranges, before);
    if (!ops.length) return false;
    const after: SelectionState = options.select ? { active: { r: options.select.r1, c: options.select.c1 }, ranges: [options.select] } : before;
    doc().dispatch(label, ops, { sheetId: sheet.id, before, after, silent: options.silent, noFit: options.noFit });
    if (options.select) setSelection(after, { reveal: false });
    return true;
  } catch (e) {
    if (e instanceof CommandError) {
      ui().toast('error', e.message);
      return false;
    }
    throw e;
  }
}

function restoreSelection(sheetId: string, sel: SelectionState | null): void {
  const { workbook } = doc();
  const sheet = workbook.sheets.find((s) => s.id === sheetId);
  const state = ui();
  if (sheet) state.set({ activeSheetId: sheetId });
  else if (!workbook.sheets.some((s) => s.id === state.activeSheetId)) state.set({ activeSheetId: sheetById(workbook, '').id });
  if (sheet && sel) setSelection(sel);
  if (state.panel?.type === 'chart') {
    const { chartId } = state.panel;
    if (!workbook.sheets.some((s) => s.charts.some((c) => c.id === chartId))) state.set({ panel: null, selectedChart: null });
  }
}

export function undo(): void {
  if (ui().edit) return;
  const tx = doc().undo();
  if (tx) restoreSelection(tx.sheetId, tx.before);
}

export function redo(): void {
  if (ui().edit) return;
  const tx = doc().redo();
  if (tx) restoreSelection(tx.sheetId, tx.after);
}

/* -------------------------------------------------------------- formatting */

export function format(label: string, patch: StylePatch): void {
  run(label, (sheet, ranges) => applyStyle(sheet, ranges, patch));
}

type ToggleKey = 'bold' | 'italic' | 'underline' | 'strike' | 'wrap';
const TOGGLE_LABEL: Record<ToggleKey, string> = { bold: 'Bold', italic: 'Italic', underline: 'Underline', strike: 'Strikethrough', wrap: 'Wrap text' };

export function toggleStyle(key: ToggleKey): void {
  run(TOGGLE_LABEL[key], (sheet, ranges, sel) => applyStyle(sheet, ranges, { [key]: baseStyle(sheet, sel.active.r, sel.active.c)?.[key] ? null : true }));
}

export function setHAlign(h: HAlign): void {
  run('Align', (sheet, ranges, sel) => applyStyle(sheet, ranges, { hAlign: baseStyle(sheet, sel.active.r, sel.active.c)?.hAlign === h ? null : h }));
}

export function setVAlign(v: VAlign): void {
  run('Align', (sheet, ranges, sel) => applyStyle(sheet, ranges, { vAlign: baseStyle(sheet, sel.active.r, sel.active.c)?.vAlign === v ? null : v }));
}

export function changeFontSize(delta: 1 | -1): void {
  run('Font size', (sheet, ranges) =>
    mapStyle(sheet, ranges, (s) => {
      const size = s?.fontSize ?? DEFAULT_FONT_SIZE;
      const next = delta > 0 ? (FONT_SIZES.find((x) => x > size) ?? size + 12) : ([...FONT_SIZES].reverse().find((x) => x < size) ?? Math.max(1, size - 1));
      return patchStyle(s, { fontSize: next });
    }),
  );
}

export function changeIndent(delta: 1 | -1): void {
  run('Indent', (sheet, ranges) =>
    mapStyle(sheet, ranges, (s) => {
      const indent = Math.max(0, Math.min(15, (s?.indent ?? 0) + delta));
      return patchStyle(s, { indent: indent || null, hAlign: s?.hAlign === 'center' ? 'left' : (s?.hAlign ?? (indent ? 'left' : null)) });
    }),
  );
}

export function changeDecimals(delta: 1 | -1): void {
  run('Decimal places', (sheet, ranges, sel) => {
    const sample = doc().engine.readCell(sheet.id, sel.active.r, sel.active.c);
    const code = adjustDecimals(baseStyle(sheet, sel.active.r, sel.active.c)?.numFmt, delta, sample);
    return mapStyle(sheet, ranges, (s) => patchStyle(s, { numFmt: s?.numFmt ? adjustDecimals(s.numFmt, delta) : code }));
  });
}

export function setNumberFormat(code: string | undefined): void {
  run('Number format', (sheet, ranges) => applyStyle(sheet, ranges, { numFmt: code ?? null }));
}

let lastBorderColor = '#1b2333';
export function borders(preset: BorderPreset, color?: string): void {
  if (color) lastBorderColor = color;
  run('Borders', (sheet, ranges) => applyBorders(sheet, ranges, preset, lastBorderColor));
}

export function merge(mode: 'all' | 'across' | 'center' | 'toggle' | 'unmerge'): void {
  const sheet = activeSheet();
  const range = primaryRange();
  const has = sheet.merges.some((m) => rangesOverlap(m, range));
  if (mode === 'unmerge' || (mode === 'toggle' && has)) {
    run('Unmerge cells', (s, ranges) => unmergeCells(s, ranges));
    return;
  }
  const apply = (): void => {
    run('Merge cells', (s) => mergeCells(s, range, mode === 'toggle' ? 'center' : mode), { select: range });
  };
  const lost = mergeLoss(sheet, range);
  if (lost > 0 && mode !== 'across') {
    ui().set({
      dialog: {
        type: 'confirm',
        title: 'Merge cells?',
        message: `Only the first value is kept. ${lost} other ${lost === 1 ? 'value' : 'values'} will be removed.`,
        confirmLabel: 'Merge cells',
        onConfirm: apply,
      },
    });
  } else apply();
}

export function startPainter(sticky: boolean): void {
  const { painter, set } = ui();
  if (painter) {
    set({ painter: null });
    return;
  }
  const sheet = activeSheet();
  set({ painter: { sheetId: sheet.id, range: primaryRange(), sticky } });
}

export function applyPainter(target: Range): void {
  const { painter, set } = ui();
  if (!painter) return;
  const source = doc().workbook.sheets.find((s) => s.id === painter.sheetId);
  if (source) run('Paint format', (sheet) => paintFormat(source, painter.range, sheet, target));
  if (!painter.sticky) set({ painter: null });
}

export function clear(kind: ClearKind): void {
  const label = { contents: 'Clear contents', formats: 'Clear formats', notes: 'Clear notes', links: 'Remove links', all: 'Clear all' }[kind];
  run(label, (sheet, ranges) => {
    if (kind === 'contents') {
      const blocked = ranges.some((r) => rangeSize(r).cells < 2000 && [...cellsOf(r)].some(([rr, cc]) => doc().engine.isSpilled(sheet.id, rr, cc)));
      const anyOwn = ranges.some((r) => hasOwnContent(sheet, r));
      if (blocked && !anyOwn) throw new CommandError('These values come from one formula. Clear its first cell instead.');
    }
    return clearRanges(sheet, ranges, kind);
  });
}

function* cellsOf(r: Range): Generator<[number, number]> {
  for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) yield [i, j];
}

function hasOwnContent(sheet: Sheet, range: Range): boolean {
  const area = clipToContent(sheet, range);
  if (!area) return false;
  for (const [r, c] of cellsOf(area)) if (!isBlankCell(sheet.cells.get(cellKey(r, c)))) return true;
  return false;
}

export function applyNamedStyle(style: StylePatch): void {
  run('Cell style', (sheet, ranges) =>
    mapStyle(sheet, ranges, (s) => {
      const keep = s?.numFmt ? { numFmt: s.numFmt } : {};
      return internStyle({ ...keep, ...(style as object) });
    }),
  );
}

/* --------------------------------------------------------- rows and columns */

function spans(ranges: Range[], axis: 'row' | 'col'): [number, number][] {
  const raw = ranges.map((r): [number, number] => (axis === 'row' ? [r.r1, r.r2] : [r.c1, r.c2])).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [lo, hi] of raw) {
    const last = out[out.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else out.push([lo, hi]);
  }
  return out;
}

export function insertRows(where: 'above' | 'below' = 'above'): void {
  run('Insert rows', (sheet, ranges) => {
    const [lo, hi] = spans(ranges, 'row')[0];
    return insertAxis(sheet, 'row', where === 'above' ? lo : hi + 1, Math.min(hi - lo + 1, 5000));
  });
}

export function insertCols(where: 'left' | 'right' = 'left'): void {
  run('Insert columns', (sheet, ranges) => {
    const [lo, hi] = spans(ranges, 'col')[0];
    return insertAxis(sheet, 'col', where === 'left' ? lo : hi + 1, Math.min(hi - lo + 1, 256));
  });
}

export function deleteRows(): void {
  run('Delete rows', (sheet, ranges) => spans(ranges, 'row').reverse().flatMap(([lo, hi]) => deleteAxis(sheet, 'row', lo, hi - lo + 1)), {
    select: { ...primaryRange(), r2: primaryRange().r1 },
  });
}

export function deleteCols(): void {
  run('Delete columns', (sheet, ranges) => spans(ranges, 'col').reverse().flatMap(([lo, hi]) => deleteAxis(sheet, 'col', lo, hi - lo + 1)), {
    select: { ...primaryRange(), c2: primaryRange().c1 },
  });
}

export function shiftCells(mode: 'insert' | 'delete', direction: 'horizontal' | 'vertical'): void {
  run(mode === 'insert' ? 'Insert cells' : 'Delete cells', (sheet) => {
    const range = primaryRange();
    const { workbook } = doc();
    return mode === 'insert'
      ? insertCells(workbook, sheet, range, direction === 'horizontal' ? 'right' : 'down')
      : deleteCells(workbook, sheet, range, direction === 'horizontal' ? 'left' : 'up');
  });
}

/** Ctrl+Plus and Ctrl+Minus act on whole rows or columns, or ask how to shift. */
export function insertSmart(): void {
  const r = primaryRange();
  if (isFullRow(r)) insertRows();
  else if (isFullCol(r)) insertCols();
  else ui().set({ dialog: { type: 'shift', mode: 'insert' } });
}

export function deleteSmart(): void {
  const r = primaryRange();
  if (isFullRow(r)) deleteRows();
  else if (isFullCol(r)) deleteCols();
  else ui().set({ dialog: { type: 'shift', mode: 'delete' } });
}

function indices(ranges: Range[], axis: 'row' | 'col', limit: number): number[] {
  const out = new Set<number>();
  for (const [lo, hi] of spans(ranges, axis)) for (let i = lo; i <= hi && out.size < limit; i++) out.add(i);
  return [...out];
}

export function resizeAxis(axis: 'row' | 'col', index: number, size: number): void {
  run(axis === 'row' ? 'Row height' : 'Column width', (sheet, ranges) => {
    // Dragging one edge of a multi-row or multi-column selection resizes them all.
    const full = ranges.filter((r) => (axis === 'row' ? isFullRow(r) && index >= r.r1 && index <= r.r2 : isFullCol(r) && index >= r.c1 && index <= r.c2));
    return setAxisSize(sheet, axis, full.length ? indices(full, axis, 20_000) : [index], size);
  });
}

export function setSelectedSize(axis: 'row' | 'col', size: number): void {
  run(axis === 'row' ? 'Row height' : 'Column width', (sheet, ranges) => setAxisSize(sheet, axis, indices(ranges, axis, 20_000), size));
}

export function autoFit(axis: 'row' | 'col', index?: number): void {
  run('AutoFit', (sheet, ranges) => {
    const { engine } = doc();
    const full = index === undefined ? ranges : ranges.filter((r) => (axis === 'row' ? isFullRow(r) && index >= r.r1 && index <= r.r2 : isFullCol(r) && index >= r.c1 && index <= r.c2));
    const used = contentRange(sheet);
    const list = (full.length ? indices(full, axis, 20_000) : [index ?? 0]).filter((i) => index === i || !used || i <= (axis === 'row' ? used.r2 : used.c2));
    return axis === 'col' ? autoColWidths(sheet, engine, list) : autoRowHeights(sheet, engine, list, true);
  }, { noFit: true });
}

export function hideAxis(axis: 'row' | 'col', hidden: boolean): void {
  run(`${hidden ? 'Hide' : 'Unhide'} ${axis === 'row' ? 'rows' : 'columns'}`, (sheet, ranges) =>
    spans(ranges, axis).flatMap(([lo, hi]) => {
      if (hidden && hi - lo > 20_000) throw new CommandError('Select fewer rows or columns to hide.');
      // Unhiding also reveals hidden neighbours of the selection.
      return setAxisHidden(sheet, axis, hidden ? lo : Math.max(0, lo - 1), hidden ? hi : hi + 1, hidden);
    }),
  );
}

/* ------------------------------------------------------------------ sheets */

export function newSheet(after?: string): void {
  if (!settleEdit()) return;
  const { workbook, dispatch } = doc();
  const at = workbook.sheets.findIndex((s) => s.id === (after ?? activeSheet().id)) + 1;
  const { ops, sheet } = addSheet(workbook, at);
  dispatch('Add sheet', ops, { sheetId: sheet.id });
  activateSheet(sheet.id);
  gridApi.focus();
}

export function sheetAction(label: string, build: () => Op[], sheetId = ''): boolean {
  if (!settleEdit()) return false;
  try {
    const ops = build();
    if (!ops.length) return false;
    doc().dispatch(label, ops, { sheetId });
    return true;
  } catch (e) {
    if (e instanceof CommandError) {
      ui().toast('error', e.message);
      return false;
    }
    throw e;
  }
}

export function renameSheetTo(sheetId: string, name: string): boolean {
  const { workbook } = doc();
  return sheetAction('Rename sheet', () => renameSheet(workbook, getSheet(workbook, sheetId), name), sheetId);
}

export function deleteSheet(sheetId: string): void {
  const { workbook } = doc();
  const sheet = getSheet(workbook, sheetId);
  const go = (): void => {
    const { workbook: wb } = doc();
    const visible = wb.sheets.filter((s) => !s.hidden);
    const i = visible.findIndex((s) => s.id === sheetId);
    const neighbour = visible[i + 1] ?? visible[i - 1];
    if (sheetAction('Delete sheet', () => removeSheet(wb, sheet), sheetId) && neighbour) activateSheet(neighbour.id);
  };
  if (sheet.cells.size === 0 && sheet.charts.length === 0) go();
  else ui().set({ dialog: { type: 'confirm', title: `Delete ${sheet.name}?`, message: 'The sheet and everything on it will be removed. You can undo this.', confirmLabel: 'Delete sheet', danger: true, onConfirm: go } });
}

export function copySheet(sheetId: string): void {
  const { workbook } = doc();
  const { ops, sheet } = duplicateSheet(workbook, getSheet(workbook, sheetId));
  if (sheetAction('Duplicate sheet', () => ops, sheet.id)) activateSheet(sheet.id);
}

export function moveSheetTo(sheetId: string, index: number): void {
  const { workbook } = doc();
  const from = workbook.sheets.findIndex((s) => s.id === sheetId);
  const to = Math.max(0, Math.min(workbook.sheets.length - 1, index));
  if (from !== to) sheetAction('Move sheet', () => moveSheet(sheetId, to), sheetId);
}

export function setTabColor(sheetId: string, color: string | null): void {
  sheetAction('Tab color', () => [{ t: 'sheet', sheetId, props: { tabColor: color } }], sheetId);
}

export function hideSheet(sheetId: string, hidden: boolean): void {
  const { workbook } = doc();
  if (hidden && workbook.sheets.filter((s) => !s.hidden).length <= 1) {
    ui().toast('error', 'A workbook needs at least one visible sheet.');
    return;
  }
  sheetAction(hidden ? 'Hide sheet' : 'Unhide sheet', () => [{ t: 'sheet', sheetId, props: { hidden } }], sheetId);
  if (hidden && ui().activeSheetId === sheetId) activateSheet(sheetById(doc().workbook, '').id);
  else if (!hidden) activateSheet(sheetId);
}

export function cycleSheet(delta: 1 | -1): void {
  const visible = doc().workbook.sheets.filter((s) => !s.hidden);
  const i = visible.findIndex((s) => s.id === activeSheet().id);
  activateSheet(visible[(i + delta + visible.length) % visible.length].id);
  gridApi.focus();
}

export function renameWorkbook(name: string): void {
  const next = name.trim();
  if (next && next !== doc().workbook.name) doc().dispatch('Rename workbook', [{ t: 'workbook', props: { name: next } }]);
}

export function setWorkbookTheme(themeId: string): void {
  doc().dispatch('Theme', [{ t: 'workbook', props: { themeId } }]);
}

/* -------------------------------------------------------------------- view */

export function freeze(mode: 'panes' | 'row' | 'col' | 'none'): void {
  run('Freeze panes', (sheet, _r, sel) => {
    const props =
      mode === 'none'
        ? { frozenRows: 0, frozenCols: 0 }
        : mode === 'row'
          ? { frozenRows: 1, frozenCols: 0 }
          : mode === 'col'
            ? { frozenRows: 0, frozenCols: 1 }
            : { frozenRows: Math.min(sel.active.r, 60), frozenCols: Math.min(sel.active.c, 26) };
    if (mode === 'panes' && !props.frozenRows && !props.frozenCols) throw new CommandError('Select the first cell below and to the right of what should stay visible.');
    return [{ t: 'sheet', sheetId: sheet.id, props }];
  }, { viewOnly: true });
}

export function setZoom(zoom: number): void {
  const z = Math.round(Math.max(0.25, Math.min(4, zoom)) * 100) / 100;
  const sheet = activeSheet();
  if (sheet.zoom !== z) doc().dispatch('Zoom', [{ t: 'sheet', sheetId: sheet.id, props: { zoom: z } }], { silent: true });
}

export function zoomToSelection(): void {
  const sheet = activeSheet();
  const range = clipToContent(sheet, primaryRange()) ?? primaryRange();
  const w = colAxis(sheet).offset(range.c2 + 1) - colAxis(sheet).offset(range.c1);
  const h = rowAxis(sheet).offset(range.r2 + 1) - rowAxis(sheet).offset(range.r1);
  const view = gridApi.viewportSize();
  setZoom(Math.min(view.w / w, view.h / h) * 0.96);
  requestAnimationFrame(() => {
    gridApi.reveal(range.r2, range.c2);
    gridApi.reveal(range.r1, range.c1);
  });
}

export function toggleGridlines(): void {
  run('Gridlines', (sheet) => [{ t: 'sheet', sheetId: sheet.id, props: { showGridlines: !sheet.showGridlines } }], { viewOnly: true });
}

export function toggleProtection(): void {
  run(activeSheet().protected ? 'Unprotect sheet' : 'Protect sheet', (sheet) => [{ t: 'sheet', sheetId: sheet.id, props: { protected: !sheet.protected } }], { viewOnly: true });
}

/* --------------------------------------------------------------- clipboard */

export function copySelection(cut: boolean): { text: string; html: string } | null {
  const sel = activeSelection();
  if (sel.ranges.length > 1) {
    ui().toast('info', 'Copy works on one block of cells at a time.');
    return null;
  }
  const sheet = activeSheet();
  if (cut && sheet.protected) {
    ui().toast('info', `${sheet.name} is protected.`);
    return null;
  }
  const range = expandToMerges(sheet, primaryRange(sel));
  const clip = buildClip(sheet, doc().engine, range, cut, uid('clip'));
  ui().set({ clip, marquee: { sheetId: sheet.id, range } });
  return { text: clipToText(clip), html: clipToHtml(clip) };
}

/** Copy triggered from a button rather than a keyboard event. */
export async function copyToSystem(cut: boolean): Promise<void> {
  if (!settleEdit()) return;
  const data = copySelection(cut);
  if (!data) return;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([data.text], { type: 'text/plain' }),
        'text/html': new Blob([data.html], { type: 'text/html' }),
      }),
    ]);
  } catch {
    // Pasting inside the app still works from the internal clipboard.
  }
  gridApi.focus();
}

export function clearMarquee(): void {
  const { clip, set } = ui();
  set({ marquee: null, clip: clip?.cut ? null : clip });
}

/** Pastes clipboard data; falls back to the internal clipboard. */
export function pasteData(data: { text: string; html: string }, mode: PasteMode = 'all'): void {
  const { clip } = ui();
  const marker = /data-tessera-clip="([^"]+)"/.exec(data.html)?.[1];
  const target = primaryRange();
  let pasted: Range | null = null;
  const clipIsCurrent = clip !== null && (marker === clip.id || (!data.html && !data.text));
  const ok = run(mode === 'all' ? 'Paste' : 'Paste special', (sheet) => {
    let res: { ops: Op[]; range: Range };
    if (clipIsCurrent && clip) res = pasteClip(doc().workbook, clip, sheet, target, mode);
    else {
      const html = data.html ? gridFromHtml(data.html) : null;
      if (html) res = pasteGrid(sheet, html.cells, html.merges, target, mode);
      else if (data.text) res = pasteGrid(sheet, gridFromText(parseTsv(data.text)), [], target, mode);
      else throw new CommandError('There is nothing to paste. Copy some cells first.');
    }
    pasted = res.range;
    return res.ops;
  });
  if (pasted) selectRange(pasted, { r: target.r1, c: target.c1 });
  if (ok && clip?.cut && clipIsCurrent) ui().set({ clip: null, marquee: null });
}

/** Paste triggered from a button. */
export async function pasteFromSystem(mode: PasteMode = 'all'): Promise<void> {
  let text = '';
  let html = '';
  let denied = false;
  try {
    for (const item of await navigator.clipboard.read()) {
      if (item.types.includes('text/html')) html = await (await item.getType('text/html')).text();
      if (item.types.includes('text/plain')) text = await (await item.getType('text/plain')).text();
    }
  } catch {
    denied = true;
  }
  if (denied && !ui().clip) ui().toast('info', 'Your browser blocked clipboard access. Press Ctrl+V to paste.');
  else pasteData({ text, html }, mode);
  gridApi.focus();
}

export function moveCells(from: Range, r: number, c: number, copy: boolean): void {
  const sheet = activeSheet();
  const dest: Range = { r1: r, c1: c, r2: r + from.r2 - from.r1, c2: c + from.c2 - from.c1 };
  if (dest.r2 >= MAX_ROWS || dest.c2 >= MAX_COLS) return;
  const go = (): void => {
    run(copy ? 'Copy cells' : 'Move cells', () => {
      const { workbook, engine } = doc();
      if (copy) return pasteClip(workbook, buildClip(sheet, engine, from, false, uid('clip')), sheet, dest, 'all').ops;
      return moveRange(workbook, sheet, from, sheet, r, c);
    }, { select: dest });
  };
  const overwrites = [...cellsOf(dest)].some(([rr, cc]) => !inRange(from, rr, cc) && !isBlankCell(sheet.cells.get(cellKey(rr, cc))));
  if (overwrites) ui().set({ dialog: { type: 'confirm', title: 'Replace existing data?', message: `${rangeName(dest)} already contains data.`, confirmLabel: 'Replace', onConfirm: go } });
  else go();
}

/* -------------------------------------------------------------------- fill */

export function fillTo(target: Range, options: { copy?: boolean; increment?: boolean } = {}): void {
  const source = primaryRange();
  run('Fill', (sheet) => fillRange(sheet, source, target, options), { select: target });
}

/** Double-clicking the fill handle fills down to the end of the neighbouring data. */
export function fillToData(): void {
  const sheet = activeSheet();
  const { engine } = doc();
  const src = primaryRange();
  const filled = (r: number, c: number): boolean => c >= 0 && engine.readCell(sheet.id, r, c) !== null;
  const guide = filled(src.r2 + 1, src.c1 - 1) ? src.c1 - 1 : filled(src.r2 + 1, src.c2 + 1) ? src.c2 + 1 : null;
  if (guide === null) return;
  let end = src.r2;
  while (end + 1 < MAX_ROWS && filled(end + 1, guide)) end++;
  if (end > src.r2) fillTo({ ...src, r2: end });
}

export function fillDir(direction: 'down' | 'right' | 'up' | 'left'): void {
  run(`Fill ${direction}`, (sheet, ranges) =>
    ranges.flatMap((r) => {
      let range = r;
      // With one row or column selected, copy from the neighbour.
      if (direction === 'down' && r.r1 === r.r2 && r.r1 > 0) range = { ...r, r1: r.r1 - 1 };
      if (direction === 'right' && r.c1 === r.c2 && r.c1 > 0) range = { ...r, c1: r.c1 - 1 };
      return fillDirection(sheet, range, direction);
    }),
  );
}

/* -------------------------------------------------------------------- data */

export function sort(descending: boolean, col?: number): void {
  const range = dataRange();
  const sheet = activeSheet();
  const { engine } = doc();
  const hasHeader = sheet.filter?.range.r1 === range.r1 || looksLikeHeader(sheet, engine, range);
  const key: SortKey = { col: col ?? Math.max(range.c1, Math.min(range.c2, activeSelection().active.c)), descending, by: 'value' };
  run('Sort', (s) => sortRange(s, engine, range, [key], hasHeader));
}

export function sortBy(range: Range, keys: SortKey[], hasHeader: boolean): void {
  run('Sort', (s) => sortRange(s, doc().engine, range, keys, hasHeader));
}

export function toggleFilter(): void {
  run('Filter', (sheet) => {
    const { engine } = doc();
    if (sheet.filter) return setFilter(sheet, engine, null);
    const range = dataRange();
    if (range.r1 === range.r2) throw new CommandError('Select a cell inside your data, or a range with at least two rows.');
    return setFilter(sheet, engine, { range, criteria: {} });
  });
}

export function clearFilter(): void {
  run('Clear filter', (sheet) => (sheet.filter ? setFilter(sheet, doc().engine, { ...sheet.filter, criteria: {} }) : []));
}

export function reapplyFilter(): void {
  run('Reapply filter', (sheet) => (sheet.filter ? setFilter(sheet, doc().engine, sheet.filter) : []));
}

export function filterColumn(col: number, criterion: FilterCriterion | null): void {
  run('Filter', (sheet) => setFilterCriterion(sheet, doc().engine, col, criterion));
}

export function sortFilterColumn(col: number, descending: boolean): void {
  const { filter } = activeSheet();
  if (filter) run('Sort', (s) => sortRange(s, doc().engine, filter.range, [{ col, descending, by: 'value' }], true));
}

export function makeTable(styleId: string): void {
  const sheet = activeSheet();
  const existing = tableAt(sheet, activeSelection().active.r, activeSelection().active.c);
  if (existing) {
    run('Table style', (s) => [{ t: 'sheet', sheetId: s.id, props: { tables: s.tables.map((t) => (t.id === existing.id ? { ...t, styleId } : t)) } }]);
    return;
  }
  ui().set({ dialog: { type: 'table', styleId } });
}

export function createTableFrom(range: Range, styleId: string, hasHeader: boolean): void {
  const used = new Set(doc().workbook.sheets.flatMap((s) => s.tables.map((t) => t.name)));
  let n = 1;
  while (used.has(`Table${n}`)) n++;
  run('Format as table', (sheet) => createTable(sheet, range, styleId, hasHeader, `Table${n}`), { select: range });
}

export function updateTable(id: string, patch: Partial<Sheet['tables'][number]>): void {
  run('Table options', (s) => [{ t: 'sheet', sheetId: s.id, props: { tables: s.tables.map((t) => (t.id === id ? { ...t, ...patch } : t)) } }]);
}

export function removeTable(id: string): void {
  run('Convert to range', (s) => {
    const table = s.tables.find((t) => t.id === id);
    const props: Partial<Sheet> = { tables: s.tables.filter((t) => t.id !== id) };
    if (table && s.filter && s.filter.range.r1 === table.range.r1 && s.filter.range.c1 === table.range.c1) Object.assign(props, { filter: null, filterHidden: new Set() });
    return [{ t: 'sheet', sheetId: s.id, props }];
  });
}

export function setConditional(rules: ConditionalRule[], label = 'Conditional formatting'): void {
  run(label, (s) => [{ t: 'sheet', sheetId: s.id, props: { conditional: rules } }]);
}

export function addConditional(rule: Omit<ConditionalRule, 'id' | 'ranges'>): void {
  run('Conditional formatting', (s, ranges) => [{ t: 'sheet', sheetId: s.id, props: { conditional: [{ ...rule, id: uid('cf'), ranges }, ...s.conditional] } }]);
}

export function setValidation(rule: Omit<ValidationRule, 'id' | 'range'> | null): void {
  run('Data validation', (s, ranges) => {
    const kept = s.validations.filter((v) => !ranges.some((r) => r.r1 <= v.range.r1 && r.r2 >= v.range.r2 && r.c1 <= v.range.c1 && r.c2 >= v.range.c2));
    const added = rule ? ranges.map((range) => ({ ...rule, id: uid('dv'), range })) : [];
    const blockers = rule ? [] : ranges.filter((r) => kept.some((v) => rangesOverlap(v.range, r))).map((range): ValidationRule => ({ id: uid('dv'), range, kind: { type: 'any' }, required: false, errorStyle: 'stop' }));
    return [{ t: 'sheet', sheetId: s.id, props: { validations: [...kept, ...added, ...blockers] } }];
  });
}

/* ------------------------------------------------------------------ insert */

export function insertChart(type: ChartType): void {
  const sheet = activeSheet();
  const range = clipToContent(sheet, dataRange()) ?? dataRange();
  if (range.r1 === range.r2 && range.c1 === range.c2) {
    ui().toast('info', 'Select the cells you want to chart first.');
    return;
  }
  const view = gridApi.viewportSize();
  const center = gridApi.center();
  const chart = createChart(type, sheet.name, range, { x: 0, y: 0 });
  // Right of the data when it fits beside the settings panel, otherwise inside the window.
  const panelW = ui().panel ? 0 : 292;
  const left = center.x - view.w / sheet.zoom / 2;
  const edge = left + (view.w - panelW) / sheet.zoom - 12;
  const right = colAxis(sheet).offset(Math.min(MAX_COLS - 1, range.c2 + 1)) + 24;
  const x = right >= left && right + chart.w <= edge ? right : Math.max(left + 12, edge - chart.w);
  const y = Math.max(rowAxis(sheet).offset(range.r1), center.y - view.h / sheet.zoom / 2 + 16);
  const placed: ChartModel = { ...chart, x: Math.max(8, Math.round(x)), y: Math.max(8, Math.round(y)), title: guessTitle(sheet, chart) };
  if (run('Insert chart', (s) => setCharts(s, [...s.charts, placed]))) ui().set({ selectedChart: placed.id, panel: { type: 'chart', chartId: placed.id } });
}

function guessTitle(sheet: Sheet, chart: ChartModel): string {
  const { workbook, engine } = doc();
  const names = readChartData(workbook, engine, sheet, chart).series.map((s) => s.name);
  return names.length === 1 || names.length === 2 ? names.join(' and ') : 'Chart title';
}
export function updateChart(id: string, patch: Partial<ChartModel>, label = 'Edit chart'): void {
  run(label, (s) => {
    const owner = s.charts.some((c) => c.id === id) ? s : null;
    return owner ? setCharts(owner, owner.charts.map((c) => (c.id === id ? { ...c, ...patch } : c))) : [];
  });
}

export function deleteChart(id: string): void {
  run('Delete chart', (s) => setCharts(s, s.charts.filter((c) => c.id !== id)));
  const { panel, set } = ui();
  set({ selectedChart: null, panel: panel?.type === 'chart' && panel.chartId === id ? null : panel });
  gridApi.focus();
}

export function duplicateChart(id: string): void {
  const copyId = uid('ch');
  run('Duplicate chart', (s) => {
    const c = s.charts.find((x) => x.id === id);
    return c ? setCharts(s, [...s.charts, { ...c, id: copyId, x: c.x + 24, y: c.y + 24 }]) : [];
  });
  ui().set({ selectedChart: copyId });
}

export function reorderChart(id: string, to: 'front' | 'back'): void {
  run('Arrange chart', (s) => {
    const c = s.charts.find((x) => x.id === id);
    if (!c) return [];
    const rest = s.charts.filter((x) => x.id !== id);
    return setCharts(s, to === 'front' ? [...rest, c] : [c, ...rest]);
  });
}

export function addSparklines(kind: Sparkline['type'], source: Range, target: Range, color: string): void {
  run('Insert sparklines', (s) => {
    const rows = source.r2 - source.r1 + 1;
    const cols = source.c2 - source.c1 + 1;
    const tr = target.r2 - target.r1 + 1;
    const tc = target.c2 - target.c1 + 1;
    const made: Sparkline[] = [];
    if (tr === rows && tc === 1) for (let i = 0; i < rows; i++) made.push({ id: uid('sp'), r: target.r1 + i, c: target.c1, range: { ...source, r1: source.r1 + i, r2: source.r1 + i }, type: kind, color });
    else if (tc === cols && tr === 1) for (let i = 0; i < cols; i++) made.push({ id: uid('sp'), r: target.r1, c: target.c1 + i, range: { ...source, c1: source.c1 + i, c2: source.c1 + i }, type: kind, color });
    else if (tr === 1 && tc === 1 && (rows === 1 || cols === 1)) made.push({ id: uid('sp'), r: target.r1, c: target.c1, range: source, type: kind, color });
    else throw new CommandError('The location needs one cell for each row or column of data.');
    const kept = s.sparklines.filter((x) => !made.some((m) => m.r === x.r && m.c === x.c));
    return [{ t: 'sheet', sheetId: s.id, props: { sparklines: [...kept, ...made] } }];
  });
}

/** Alt+=: proposes a SUM of the numbers above or to the left. */
export function autoSum(fn = 'SUM'): void {
  if (ui().edit) return;
  const sheet = activeSheet();
  const { engine } = doc();
  const range = primaryRange();
  const isNum = (r: number, c: number): boolean => r >= 0 && c >= 0 && typeof engine.readCell(sheet.id, r, c) === 'number';

  if (range.r1 !== range.r2 || range.c1 !== range.c2) {
    const area = clipToContent(sheet, range);
    if (area && !isFullCol(range) && !isFullRow(range)) {
      const belowRow = range.r2 + 1;
      const blankBelow = belowRow < MAX_ROWS && [...Array(range.c2 - range.c1 + 1).keys()].every((i) => engine.readCell(sheet.id, belowRow, range.c1 + i) === null);
      const single = range.r1 === range.r2;
      const lastBlank = !single && [...Array(range.c2 - range.c1 + 1).keys()].every((i) => engine.readCell(sheet.id, range.r2, range.c1 + i) === null);
      run('AutoSum', (s) => {
        const set: [number, { f: string; s?: ReturnType<typeof baseStyle> }][] = [];
        const add = (r: number, c: number, src: Range, like: [number, number]): void => {
          set.push([cellKey(r, c), { f: `=${fn}(${rangeName(src)})`, s: s.cells.get(cellKey(r, c))?.s ?? numberStyle(s, like) }]);
        };
        if (single) {
          const c = engine.readCell(s.id, range.r1, range.c2) === null ? range.c2 : range.c2 + 1;
          add(range.r1, c, { ...range, c2: c - 1 }, [range.r1, range.c1]);
        } else {
          const row = lastBlank ? range.r2 : belowRow;
          if (!lastBlank && !blankBelow) throw new CommandError('Leave an empty row below the numbers for the totals.');
          for (let c = range.c1; c <= range.c2; c++) add(row, c, { r1: range.r1, r2: lastBlank ? range.r2 - 1 : range.r2, c1: c, c2: c }, [range.r1, c]);
        }
        return [{ t: 'cells', sheetId: s.id, set }];
      });
      return;
    }
  }

  const { r, c } = activeSelection().active;
  let src: Range | null = null;
  if (isNum(r - 1, c)) {
    let top = r - 1;
    while (isNum(top - 1, c)) top--;
    src = { r1: top, r2: r - 1, c1: c, c2: c };
  } else if (isNum(r, c - 1)) {
    let left = c - 1;
    while (isNum(r, left - 1)) left--;
    src = { r1: r, r2: r, c1: left, c2: c - 1 };
  } else if (!isNum(r - 1, c)) {
    // Skip a short gap above, as in a total row below a blank line.
    for (let k = 2; k <= 3 && !src; k++) {
      if (isNum(r - k, c)) {
        let top = r - k;
        while (isNum(top - 1, c)) top--;
        src = { r1: top, r2: r - 1, c1: c, c2: c };
      }
    }
  }
  const text = `=${fn}(${src ? rangeName(src) : ''})`;
  if (startEdit({ text, mode: 'enter', caret: text.length - 1 })) editReplace(text, text.length - 1, { mode: 'enter' });
  gridApi.focus();
}

function numberStyle(sheet: Sheet, at: [number, number]): ReturnType<typeof baseStyle> {
  const fmt = baseStyle(sheet, at[0], at[1])?.numFmt;
  return fmt ? internStyle({ numFmt: fmt }) : undefined;
}

/** Inserts a function call at the caret, starting an edit when needed. */
export function insertFunction(name: string): void {
  const { edit } = ui();
  if (edit) insertAtCaret(edit.text ? `${name}()` : `=${name}()`, name.length + (edit.text ? 1 : 2));
  else {
    const text = `=${name}()`;
    if (startEdit({ text, mode: 'enter' })) editReplace(text, text.length - 1, { mode: 'enter' });
  }
  gridApi.focus();
}
export function insertNow(kind: 'date' | 'time'): void {
  const d = new Date();
  const text =
    kind === 'date'
      ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
      : `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  if (startEdit({ text, mode: 'enter' })) editReplace(text, text.length);
}

export function toggleCheckbox(): void {
  run('Toggle', (sheet, ranges, sel) => {
    const v = sheet.cells.get(cellKey(sel.active.r, sel.active.c))?.v;
    const set = ranges.flatMap((r) => (rangeSize(r).cells > 5000 ? [] : [...cellsOf(r)])).map(([r, c]): [number, { v: boolean }] => {
      const key = cellKey(r, c);
      return [key, { ...sheet.cells.get(key), v: v !== true }];
    });
    return [{ t: 'cells', sheetId: sheet.id, set }];
  });
}

export function insertCheckboxes(): void {
  run('Insert checkbox', (sheet, ranges) => {
    const set: [number, { v: boolean; s?: ReturnType<typeof internStyle> }][] = [];
    for (const r of ranges) {
      if (rangeSize(r).cells > 5000) throw new CommandError('Select fewer cells to add checkboxes.');
      for (const [i, j] of cellsOf(r)) {
        const prev = sheet.cells.get(cellKey(i, j));
        set.push([cellKey(i, j), { ...prev, v: prev?.v === true, s: patchStyle(prev?.s, { numFmt: CHECKBOX_FORMAT }) }]);
      }
    }
    return [{ t: 'cells', sheetId: sheet.id, set }];
  });
}

/* ------------------------------------------------------------ notes, links */

export function editNote(): void {
  if (!settleEdit()) return;
  const sheet = activeSheet();
  const { active } = activeSelection();
  ui().set({ noteEditor: { sheetId: sheet.id, r: active.r, c: active.c } });
  gridApi.reveal(active.r, active.c);
}

export function saveNote(r: number, c: number, text: string): void {
  const t = text.trim();
  const prev = activeSheet().cells.get(cellKey(r, c))?.note;
  if ((prev?.text ?? '') === t) return;
  run(t ? 'Note' : 'Delete note', (sheet) => setNote(sheet, r, c, t ? { text: t, author: 'You', updated: Date.now() } : null));
}

export function deleteNote(): void {
  run('Delete note', (sheet, ranges) => clearRanges(sheet, ranges, 'notes'));
}

export function gotoNote(delta: 1 | -1): void {
  const sheet = activeSheet();
  const notes = [...sheet.cells].filter(([, cell]) => cell.note).map(([k]) => k).sort((a, b) => a - b);
  if (!notes.length) {
    ui().toast('info', 'There are no notes on this sheet.');
    return;
  }
  const { active } = activeSelection();
  const here = cellKey(active.r, active.c);
  const key = delta > 0 ? (notes.find((k) => k > here) ?? notes[0]) : ([...notes].reverse().find((k) => k < here) ?? notes[notes.length - 1]);
  const r = Math.floor(key / MAX_COLS);
  const c = key % MAX_COLS;
  selectCell(r, c);
  ui().set({ noteEditor: { sheetId: sheet.id, r, c } });
}

export function saveLink(link: string | null, label: string | null): void {
  run(link ? 'Link' : 'Remove link', (sheet, _r, sel) => setLink(sheet, sel.active.r, sel.active.c, link, label));
}

/** Opens a link. Only web, mail and in-workbook targets are allowed. */
export function followLink(link: string): void {
  if (link.startsWith('#')) {
    goTo(link.slice(1));
    return;
  }
  if (/^(https?:|mailto:)/i.test(link)) window.open(link, '_blank', 'noopener,noreferrer');
  else ui().toast('error', 'Only web addresses, email addresses and cell references can be opened.');
}

/** Selects a reference, sheet-qualified reference or defined name. */
export function goTo(text: string): boolean {
  const { workbook } = doc();
  const raw = text.trim();
  const named = workbook.names.find((n) => n.name.toLowerCase() === raw.toLowerCase());
  const { sheet: sheetName, local } = splitSheetRef(named ? named.ref : raw);
  const range = parseRangeName(local);
  const sheet = sheetName === null ? activeSheet() : workbook.sheets.find((s) => s.name.toLowerCase() === sheetName.toLowerCase());
  if (!range || !sheet) return false;
  if (sheet.hidden) {
    ui().toast('info', `${sheet.name} is hidden. Unhide it to go there.`);
    return false;
  }
  activateSheet(sheet.id);
  selectRange(range, undefined, { reveal: true });
  return true;
}

export function defineNameFromSelection(name: string): void {
  const { workbook } = doc();
  const sheet = activeSheet();
  const ref = `${quoteSheet(sheet.name)}!${rangeName(primaryRange(), true)}`;
  doc().dispatch('Define name', [{ t: 'workbook', props: { names: [...workbook.names.filter((n) => n.name.toLowerCase() !== name.toLowerCase()), { name, ref }] } }]);
}

/* ------------------------------------------------------------------ audit */

export function trace(kind: 'precedents' | 'dependents'): void {
  const sheet = activeSheet();
  const { active } = activeSelection();
  const { engine } = doc();
  const ranges: Range[] =
    kind === 'precedents'
      ? engine.precedents(sheet.id, active.r, active.c).filter((p) => p.sheetId === sheet.id).map((p) => p.range)
      : engine.dependentsOf(sheet.id, active.r, active.c).filter((d) => d.sheetId === sheet.id).map((d) => cellRange(d.r, d.c));
  if (!ranges.length) {
    ui().toast('info', kind === 'precedents' ? 'This cell does not read other cells on this sheet.' : 'No formulas on this sheet use this cell.');
    return;
  }
  ui().set({ traces: [...ui().traces.filter((t) => !(t.sheetId === sheet.id && t.kind === kind && t.from.r === active.r && t.from.c === active.c)), { sheetId: sheet.id, from: active, ranges, kind }] });
}

/** Selects the next cell with an error value. */
export function nextError(): void {
  const sheet = activeSheet();
  const { engine } = doc();
  const { active } = activeSelection();
  const here = cellKey(active.r, active.c);
  const keys = [...sheet.cells].filter(([k, cell]) => {
    if (cell.f === undefined) return false;
    const v = engine.readCell(sheet.id, Math.floor(k / MAX_COLS), k % MAX_COLS);
    return v !== null && typeof v === 'object';
  }).map(([k]) => k).sort((a, b) => a - b);
  if (!keys.length) {
    ui().toast('success', 'No formula errors on this sheet.');
    return;
  }
  const key = keys.find((k) => k > here) ?? keys[0];
  selectCell(Math.floor(key / MAX_COLS), key % MAX_COLS);
}

export function calculateNow(): void {
  doc().engine.calculateNow();
  doc().touch();
  ui().toast('success', 'Recalculated.');
}

export function setCalcMode(mode: 'auto' | 'manual'): void {
  const { engine } = doc();
  engine.mode = mode;
  if (mode === 'auto') engine.calculateNow();
  doc().touch();
}

export function selectionLabel(range: Range): string {
  if (isFullCol(range)) return range.c1 === range.c2 ? `Column ${colName(range.c1)}` : `Columns ${colName(range.c1)} to ${colName(range.c2)}`;
  if (isFullRow(range)) return range.r1 === range.r2 ? `Row ${range.r1 + 1}` : `Rows ${range.r1 + 1} to ${range.r2 + 1}`;
  return rangeName(range);
}
