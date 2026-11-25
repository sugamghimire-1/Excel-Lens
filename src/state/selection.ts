/** Selection movement and extension. */
import { cellRange, inRange, MAX_COLS, MAX_ROWS, normalizeRange, rangeEquals } from '@/engine/address';
import { colAxis, rowAxis } from '@/engine/axis';
import { contentRange, currentRegion, expandToMerges, mergeAt } from '@/engine/sheet';
import type { CellPos, Range, SelectionState, Sheet } from '@/types';
import { gridApi } from './gridApi';
import { activeSelection, activeSheet, primaryRange } from './selectors';
import { useUI } from './uiStore';
import { useWorkbook } from './workbookStore';

export type Direction = 'up' | 'down' | 'left' | 'right';

/** Column to return to when Enter follows a run of Tabs. */
let tabOrigin: number | null = null;

export function setSelection(sel: SelectionState, options: { reveal?: CellPos | false } = {}): void {
  const sheet = activeSheet();
  const ui = useUI.getState();
  ui.set({ selections: { ...ui.selections, [sheet.id]: sel }, selectedChart: null, ...(ui.listMenu ? { listMenu: null } : {}) });
  if (options.reveal !== false) {
    const p = options.reveal ?? sel.active;
    gridApi.reveal(p.r, p.c);
  }
}

/** Selects one cell (or the merge that contains it). */
export function selectCell(r: number, c: number, options: { add?: boolean; reveal?: boolean } = {}): void {
  tabOrigin = null;
  const sheet = activeSheet();
  const merge = mergeAt(sheet, r, c);
  const active = merge ? { r: merge.r1, c: merge.c1 } : { r, c };
  const range = merge ?? cellRange(r, c);
  const ranges = options.add ? [...activeSelection().ranges, range] : [range];
  setSelection({ active, ranges }, { reveal: options.reveal === false ? false : active });
}

export function selectRange(range: Range, active?: CellPos, options: { add?: boolean; reveal?: boolean } = {}): void {
  tabOrigin = null;
  const sheet = activeSheet();
  const full = expandToMerges(sheet, range);
  const ranges = options.add ? [...activeSelection().ranges, full] : [full];
  const pos = active ?? { r: range.r1, c: range.c1 };
  setSelection({ active: pos, ranges }, { reveal: options.reveal ? pos : false });
}

/** Extends the last range so that it spans the active cell and `to`. */
export function extendTo(to: CellPos, reveal = true): void {
  const sheet = activeSheet();
  const sel = activeSelection();
  const range = expandToMerges(sheet, normalizeRange(sel.active, to));
  setSelection({ active: sel.active, ranges: [...sel.ranges.slice(0, -1), range] }, { reveal: reveal ? to : false });
}

/** The corner opposite the active cell. */
export function focusCell(sel: SelectionState = activeSelection()): CellPos {
  const range = primaryRange(sel);
  const merge = mergeAt(activeSheet(), sel.active.r, sel.active.c);
  const top = merge ? merge.r1 : sel.active.r;
  const left = merge ? merge.c1 : sel.active.c;
  return {
    r: top === range.r1 ? range.r2 : range.r1,
    c: left === range.c1 ? range.c2 : range.c1,
  };
}

/** Next visible cell in a direction, skipping hidden rows and columns. */
export function step(sheet: Sheet, from: CellPos, dir: Direction, count = 1): CellPos {
  const rows = rowAxis(sheet);
  const cols = colAxis(sheet);
  let { r, c } = from;
  for (let i = 0; i < count; i++) {
    const merge = mergeAt(sheet, r, c);
    if (dir === 'up') {
      let n = (merge?.r1 ?? r) - 1;
      while (n > 0 && rows.isHidden(n)) n--;
      if (n < 0 || rows.isHidden(n)) break;
      r = n;
    } else if (dir === 'down') {
      let n = (merge?.r2 ?? r) + 1;
      while (n < MAX_ROWS - 1 && rows.isHidden(n)) n++;
      if (n >= MAX_ROWS) break;
      r = n;
    } else if (dir === 'left') {
      let n = (merge?.c1 ?? c) - 1;
      while (n > 0 && cols.isHidden(n)) n--;
      if (n < 0 || cols.isHidden(n)) break;
      c = n;
    } else {
      let n = (merge?.c2 ?? c) + 1;
      while (n < MAX_COLS - 1 && cols.isHidden(n)) n++;
      if (n >= MAX_COLS) break;
      c = n;
    }
  }
  return { r, c };
}

/** Ctrl+Arrow: jumps to the edge of the current block of data. */
export function jump(sheet: Sheet, from: CellPos, dir: Direction): CellPos {
  const { engine } = useWorkbook.getState();
  const filled = (p: CellPos): boolean => {
    const v = engine.readCell(sheet.id, p.r, p.c);
    return v !== null && v !== '';
  };
  const used = engine.usedRange(sheet.id);
  const outside = (p: CellPos): boolean => !used || p.r > used.r2 || p.c > used.c2;
  const edge: CellPos =
    dir === 'up' ? { r: 0, c: from.c } : dir === 'left' ? { r: from.r, c: 0 } : dir === 'down' ? { r: MAX_ROWS - 1, c: from.c } : { r: from.r, c: MAX_COLS - 1 };
  const same = (a: CellPos, b: CellPos): boolean => a.r === b.r && a.c === b.c;

  let cur = from;
  let next = step(sheet, cur, dir);
  if (same(next, cur)) return cur;
  if (filled(cur) && filled(next)) {
    while (filled(next)) {
      cur = next;
      next = step(sheet, cur, dir);
      if (same(next, cur)) return cur;
    }
    return cur;
  }
  while (!filled(next)) {
    if ((dir === 'down' || dir === 'right') && outside(next)) return edge;
    const after = step(sheet, next, dir);
    if (same(after, next)) return next;
    next = after;
  }
  return next;
}

export function move(dir: Direction, options: { extend?: boolean; jump?: boolean; count?: number } = {}): void {
  const sheet = activeSheet();
  const sel = activeSelection();
  if (options.extend) {
    const from = focusCell(sel);
    const to = options.jump ? jump(sheet, from, dir) : step(sheet, from, dir, options.count);
    extendTo(to);
    return;
  }
  const to = options.jump ? jump(sheet, sel.active, dir) : step(sheet, sel.active, dir, options.count);
  selectCell(to.r, to.c);
}

/** Enter and Tab: cycles inside a multi-cell selection, otherwise moves on. */
export function advance(dir: Direction): void {
  const sheet = activeSheet();
  const sel = activeSelection();
  const range = primaryRange(sel);
  const merge = mergeAt(sheet, sel.active.r, sel.active.c);
  const isMulti = !(range.r1 === range.r2 && range.c1 === range.c2) && !(merge && rangeEquals(merge, range));

  if (isMulti) {
    const rows = rowAxis(sheet);
    const cols = colAxis(sheet);
    let { r, c } = sel.active;
    const total = (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1);
    for (let i = 0; i < Math.min(total, 100_000); i++) {
      if (dir === 'down') {
        r++;
        if (r > range.r2) [r, c] = [range.r1, c + 1 > range.c2 ? range.c1 : c + 1];
      } else if (dir === 'up') {
        r--;
        if (r < range.r1) [r, c] = [range.r2, c - 1 < range.c1 ? range.c2 : c - 1];
      } else if (dir === 'right') {
        c++;
        if (c > range.c2) [r, c] = [r + 1 > range.r2 ? range.r1 : r + 1, range.c1];
      } else {
        c--;
        if (c < range.c1) [r, c] = [r - 1 < range.r1 ? range.r2 : r - 1, range.c2];
      }
      const m = mergeAt(sheet, r, c);
      const covered = m && (m.r1 !== r || m.c1 !== c);
      if (!covered && !rows.isHidden(r) && !cols.isHidden(c)) break;
    }
    setSelection({ active: { r, c }, ranges: sel.ranges });
    return;
  }

  if (dir === 'right' || dir === 'left') {
    const origin = tabOrigin ?? sel.active.c;
    const to = step(sheet, sel.active, dir);
    selectCell(to.r, to.c);
    tabOrigin = origin;
    return;
  }
  const origin = tabOrigin;
  const to = step(sheet, sel.active, dir);
  selectCell(to.r, dir === 'down' && origin !== null ? origin : to.c);
}

export function selectAll(): void {
  const sheet = activeSheet();
  const sel = activeSelection();
  const { engine } = useWorkbook.getState();
  const region = currentRegion(sheet, sel.active.r, sel.active.c, (r, c) => {
    const v = engine.readCell(sheet.id, r, c);
    return v !== null && v !== '';
  });
  const all: Range = { r1: 0, c1: 0, r2: MAX_ROWS - 1, c2: MAX_COLS - 1 };
  const isSingle = region.r1 === region.r2 && region.c1 === region.c2;
  const next = isSingle || rangeEquals(region, primaryRange(sel)) ? all : region;
  setSelection({ active: sel.active, ranges: [next] }, { reveal: false });
}

export function selectRows(r1: number, r2: number, options: { add?: boolean; active?: number } = {}): void {
  const range: Range = { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: 0, c2: MAX_COLS - 1 };
  const ranges = options.add ? [...activeSelection().ranges, range] : [range];
  setSelection({ active: { r: options.active ?? r1, c: 0 }, ranges }, { reveal: false });
}

export function selectCols(c1: number, c2: number, options: { add?: boolean; active?: number } = {}): void {
  const range: Range = { r1: 0, r2: MAX_ROWS - 1, c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
  const ranges = options.add ? [...activeSelection().ranges, range] : [range];
  setSelection({ active: { r: 0, c: options.active ?? c1 }, ranges }, { reveal: false });
}

/** Ctrl+Home / Ctrl+End. */
export function goHome(extend = false): void {
  const sheet = activeSheet();
  const to = { r: sheet.frozenRows, c: sheet.frozenCols };
  if (extend) extendTo(to);
  else selectCell(to.r, to.c);
}

export function goEnd(extend = false): void {
  const used = contentRange(activeSheet());
  const to = { r: used?.r2 ?? 0, c: used?.c2 ?? 0 };
  if (extend) extendTo(to);
  else selectCell(to.r, to.c);
}

/** Activates a sheet, optionally selecting a range on it. */
export function activateSheet(sheetId: string, range?: Range): void {
  useUI.getState().set({ activeSheetId: sheetId, selectedChart: null, filterMenu: null, listMenu: null, noteEditor: null });
  if (range) selectRange(range, undefined, { reveal: true });
}

/** The selection, or the surrounding data when a single cell is selected. */
export function dataRange(): Range {
  const sheet = activeSheet();
  const sel = activeSelection();
  const range = primaryRange(sel);
  if (range.r1 !== range.r2 || range.c1 !== range.c2) return range;
  const table = sheet.tables.find((t) => inRange(t.range, sel.active.r, sel.active.c));
  if (table) return table.range;
  const { engine } = useWorkbook.getState();
  return currentRegion(sheet, sel.active.r, sel.active.c, (r, c) => {
    const v = engine.readCell(sheet.id, r, c);
    return v !== null && v !== '';
  });
}

export function activeBlock(): Range {
  return primaryRange();
}
