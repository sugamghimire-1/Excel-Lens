/** Sorting, filtering, tables and other data tools. */
import type { CalcEngine } from '@/formulas/calcEngine';
import { shiftFormula } from '@/formulas/rewrite';
import { compareScalars, isError, type Scalar } from '@/formulas/values';
import type { AutoFilter, Cell, FilterCriterion, Op, Range, Sheet, TableDef } from '@/types';
import { uid } from '@/utils/id';
import { cellKey, rangesOverlap } from '../address';
import { compareWith } from '../conditional';
import { parseInput } from '../input';
import { formatValue } from '../numberFormat';
import { baseStyle, clipToContent, compactCell, isBlankCell } from '../sheet';
import { cellsOp, CommandError } from './cells';

export interface SortKey {
  col: number;
  descending: boolean;
  by: 'value' | 'fill' | 'color';
}

/** Blank cells always sort last, errors just before them. */
export function compareForSort(a: Scalar, b: Scalar, descending: boolean): number {
  const blank = (v: Scalar): boolean => v === null || v === '';
  if (blank(a) || blank(b)) return Number(blank(a)) - Number(blank(b));
  if (isError(a) || isError(b)) return Number(isError(a)) - Number(isError(b));
  const cmp = compareScalars(a, b);
  return descending ? -cmp : cmp;
}

export function sortRange(sheet: Sheet, engine: CalcEngine, range: Range, keys: SortKey[], hasHeader: boolean): Op[] {
  const area = clipToContent(sheet, range);
  if (!area) return [];
  const first = area.r1 + (hasHeader ? 1 : 0);
  if (first >= area.r2) return [];
  if (sheet.merges.some((m) => rangesOverlap(m, area))) throw new CommandError('Unmerge the cells in this range before sorting.');
  // Rows hidden by a filter stay in place.
  const rows: number[] = [];
  for (let r = first; r <= area.r2; r++) if (!sheet.filterHidden.has(r)) rows.push(r);

  const rank = (r: number, key: SortKey): Scalar => {
    if (key.by === 'value') return engine.readCell(sheet.id, r, key.col);
    const s = baseStyle(sheet, r, key.col);
    return (key.by === 'fill' ? s?.fill : s?.color) ?? null;
  };
  const decorated = rows.map((r, i) => ({ r, i, ranks: keys.map((k) => rank(r, k)) }));
  decorated.sort((a, b) => {
    for (let k = 0; k < keys.length; k++) {
      const cmp = compareForSort(a.ranks[k], b.ranks[k], keys[k].descending);
      if (cmp) return cmp;
    }
    return a.i - b.i;
  });

  const set: [number, Cell | null][] = [];
  decorated.forEach(({ r: from }, i) => {
    const to = rows[i];
    if (from === to) return;
    for (let c = area.c1; c <= area.c2; c++) {
      const cell = sheet.cells.get(cellKey(from, c));
      const moved = cell?.f !== undefined ? { ...cell, f: shiftFormula(cell.f, to - from, 0) } : cell;
      const existing = sheet.cells.get(cellKey(to, c));
      if (moved || existing) set.push([cellKey(to, c), moved ?? null]);
    }
  });
  return cellsOp(sheet, set);
}

/** Guesses whether the first row of a range holds labels. */
export function looksLikeHeader(sheet: Sheet, engine: CalcEngine, range: Range): boolean {
  if (range.r2 <= range.r1) return false;
  let textHead = 0;
  let differs = 0;
  const lastCol = Math.min(range.c2, range.c1 + 60);
  for (let c = range.c1; c <= lastCol; c++) {
    const head = engine.readCell(sheet.id, range.r1, c);
    if (typeof head === 'number') return false;
    if (typeof head === 'string' && head !== '') textHead++;
    const below = engine.readCell(sheet.id, range.r1 + 1, c);
    const hs = baseStyle(sheet, range.r1, c);
    const bs = baseStyle(sheet, range.r1 + 1, c);
    if (typeof below !== typeof head || (hs?.bold ?? false) !== (bs?.bold ?? false) || hs?.fill !== bs?.fill) differs++;
  }
  return textHead > 0 && differs > 0;
}

/* ----------------------------------------------------------------- filters */

export function filterText(sheet: Sheet, engine: CalcEngine, r: number, c: number): string {
  return formatValue(engine.readCell(sheet.id, r, c), baseStyle(sheet, r, c)?.numFmt).text;
}

function passes(criterion: FilterCriterion, text: string, value: Scalar, topValues: Set<number> | null): boolean {
  switch (criterion.type) {
    case 'values':
      return !criterion.hidden.includes(text);
    case 'top':
      return typeof value === 'number' && topValues !== null && topValues.has(value);
    case 'condition': {
      const lower = text.toLowerCase();
      const needle = criterion.a.toLowerCase();
      switch (criterion.op) {
        case 'contains':
          return lower.includes(needle);
        case 'notContains':
          return !lower.includes(needle);
        case 'begins':
          return lower.startsWith(needle);
        case 'ends':
          return lower.endsWith(needle);
        case 'blank':
          return text === '';
        case 'notBlank':
          return text !== '';
        default:
          return compareWith(criterion.op, value, parseInput(criterion.a).v ?? null, criterion.b === undefined ? null : (parseInput(criterion.b).v ?? null));
      }
    }
  }
}

/** Rows hidden by a filter's criteria. */
export function computeFilterHidden(sheet: Sheet, engine: CalcEngine, filter: AutoFilter): Set<number> {
  const hidden = new Set<number>();
  const entries = Object.entries(filter.criteria).map(([c, criterion]) => {
    const col = Number(c);
    let top: Set<number> | null = null;
    if (criterion.type === 'top') {
      const ns: number[] = [];
      for (let r = filter.range.r1 + 1; r <= filter.range.r2; r++) {
        const v = engine.readCell(sheet.id, r, col);
        if (typeof v === 'number') ns.push(v);
      }
      ns.sort((a, b) => (criterion.bottom ? a - b : b - a));
      top = new Set(ns.slice(0, criterion.count));
    }
    return { col, criterion, top };
  });
  if (!entries.length) return hidden;
  for (let r = filter.range.r1 + 1; r <= filter.range.r2; r++) {
    for (const { col, criterion, top } of entries) {
      if (!passes(criterion, filterText(sheet, engine, r, col), engine.readCell(sheet.id, r, col), top)) {
        hidden.add(r);
        break;
      }
    }
  }
  return hidden;
}

export function setFilter(sheet: Sheet, engine: CalcEngine, filter: AutoFilter | null): Op[] {
  const clipped = filter ? { ...filter, range: clipToContent(sheet, filter.range) ?? filter.range } : null;
  return [{ t: 'sheet', sheetId: sheet.id, props: { filter: clipped, filterHidden: clipped ? computeFilterHidden(sheet, engine, clipped) : new Set() } }];
}

export function setFilterCriterion(sheet: Sheet, engine: CalcEngine, col: number, criterion: FilterCriterion | null): Op[] {
  if (!sheet.filter) return [];
  const criteria = { ...sheet.filter.criteria };
  if (criterion) criteria[col] = criterion;
  else delete criteria[col];
  return setFilter(sheet, engine, { ...sheet.filter, criteria });
}

/** Distinct display values in a filter column, honouring the other columns' filters. */
export function filterChoices(sheet: Sheet, engine: CalcEngine, col: number): { text: string; count: number }[] {
  const { filter } = sheet;
  if (!filter) return [];
  const others = Object.fromEntries(Object.entries(filter.criteria).filter(([c]) => Number(c) !== col));
  const hidden = computeFilterHidden(sheet, engine, { ...filter, criteria: others });
  const found = new Map<string, { text: string; count: number; value: Scalar }>();
  for (let r = filter.range.r1 + 1; r <= filter.range.r2; r++) {
    if (hidden.has(r)) continue;
    const text = filterText(sheet, engine, r, col);
    const hit = found.get(text);
    if (hit) hit.count++;
    else found.set(text, { text, count: 1, value: engine.readCell(sheet.id, r, col) });
  }
  return [...found.values()].sort((a, b) => compareForSort(a.value, b.value, false)).map(({ text, count }) => ({ text, count }));
}

/* ------------------------------------------------------------------ tables */

export function createTable(sheet: Sheet, range: Range, styleId: string, hasHeader: boolean, name: string): Op[] {
  if (sheet.tables.some((t) => rangesOverlap(t.range, range))) throw new CommandError('Tables cannot overlap each other.');
  if (sheet.merges.some((m) => rangesOverlap(m, range))) throw new CommandError('Unmerge the cells in this range before making a table.');
  const ops: Op[] = [];
  const set: [number, Cell | null][] = [];
  if (hasHeader) {
    for (let c = range.c1; c <= range.c2; c++) {
      const key = cellKey(range.r1, c);
      const cell = sheet.cells.get(key);
      if (isBlankCell(cell)) set.push([key, compactCell({ ...cell, v: `Column${c - range.c1 + 1}` })]);
    }
  }
  ops.push(...cellsOp(sheet, set));
  const table: TableDef = { id: uid('tb'), name, range, styleId, headerRow: hasHeader, bandedRows: true, totalRow: false, firstColumn: false };
  ops.push({ t: 'sheet', sheetId: sheet.id, props: { tables: [...sheet.tables, table] } });
  if (hasHeader && !sheet.filter) ops.push({ t: 'sheet', sheetId: sheet.id, props: { filter: { range, criteria: {} }, filterHidden: new Set() } });
  return ops;
}

export function tableAt(sheet: Sheet, r: number, c: number): TableDef | null {
  for (const t of sheet.tables) if (r >= t.range.r1 && r <= t.range.r2 && c >= t.range.c1 && c <= t.range.c2) return t;
  return null;
}

/* -------------------------------------------------------------- data tools */

/** Deletes rows whose values repeat in the chosen columns, closing the gaps. */
export function removeDuplicates(sheet: Sheet, engine: CalcEngine, range: Range, cols: number[], hasHeader: boolean): { ops: Op[]; removed: number; kept: number } {
  const area = clipToContent(sheet, range);
  if (!area) return { ops: [], removed: 0, kept: 0 };
  const first = area.r1 + (hasHeader ? 1 : 0);
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let r = first; r <= area.r2; r++) {
    const key = cols.map((c) => {
      const v = engine.readCell(sheet.id, r, c);
      return typeof v === 'string' ? `s${v.toLowerCase()}` : `${typeof v}${String(v)}`;
    }).join('\u0001');
    if (seen.has(key)) continue;
    seen.add(key);
    keep.push(r);
  }
  const total = area.r2 - first + 1;
  if (keep.length === total) return { ops: [], removed: 0, kept: total };
  const set: [number, Cell | null][] = [];
  for (let i = 0; i < total; i++) {
    const to = first + i;
    const from = keep[i];
    if (from === to) continue;
    for (let c = area.c1; c <= area.c2; c++) {
      const key = cellKey(to, c);
      const cell = from === undefined ? undefined : sheet.cells.get(cellKey(from, c));
      const moved = cell?.f !== undefined ? { ...cell, f: shiftFormula(cell.f, to - from, 0) } : cell;
      if (moved || sheet.cells.has(key)) set.push([key, moved ?? null]);
    }
  }
  return { ops: cellsOp(sheet, set), removed: total - keep.length, kept: keep.length };
}

/** Splits one column of text across the columns to its right. */
export function textToColumns(sheet: Sheet, engine: CalcEngine, range: Range, delimiters: string[], mergeRepeats: boolean): Op[] {
  if (range.c1 !== range.c2) throw new CommandError('Select cells in a single column to split.');
  const area = clipToContent(sheet, range);
  if (!area || !delimiters.length) return [];
  const escaped = delimiters.map((d) => d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(mergeRepeats ? `(?:${escaped})+` : `(?:${escaped})`);
  const set: [number, Cell | null][] = [];
  for (let r = area.r1; r <= area.r2; r++) {
    const text = filterText(sheet, engine, r, area.c1);
    if (!text) continue;
    text.split(re).forEach((part, i) => {
      const key = cellKey(r, area.c1 + i);
      const prev = sheet.cells.get(key);
      const parsed = parseInput(part.trim());
      const s = parsed.numFmt && !prev?.s?.numFmt ? Object.freeze({ ...prev?.s, numFmt: parsed.numFmt }) : prev?.s;
      set.push([key, compactCell({ ...prev, v: parsed.v, f: parsed.f, s })]);
    });
  }
  return cellsOp(sheet, set);
}
