/** Commands that edit cell contents. Each returns the operations to apply. */
import { relocateRefs } from '@/formulas/rewrite';
import type { Cell, CellNote, Op, Range, Sheet, Workbook } from '@/types';
import { cellKey, inRange, isFullCol, isFullRow, keyCol, keyRow, MAX_COLS, MAX_ROWS, rangesOverlap } from '../address';
import { editText, parseInput } from '../input';
import { baseStyle, compactCell, eachCell, patchStyle } from '../sheet';

/** A problem the user can understand and act on. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

type CellSet = [number, Cell | null];

export function cellsOp(sheet: Sheet, set: CellSet[]): Op[] {
  return set.length ? [{ t: 'cells', sheetId: sheet.id, set }] : [];
}

/** Result of typing `raw` into a cell. */
export function cellFromInput(sheet: Sheet, r: number, c: number, raw: string): Cell | null {
  const prev = sheet.cells.get(cellKey(r, c));
  const style = baseStyle(sheet, r, c);
  const parsed = parseInput(raw, style?.numFmt);
  let s = prev?.s;
  if (parsed.numFmt && !style?.numFmt) s = patchStyle(style, { numFmt: parsed.numFmt });
  if (raw.includes('\n') && !style?.wrap) s = patchStyle(s ?? style, { wrap: true });
  const cell: Cell = { v: parsed.v, f: parsed.f, s, note: prev?.note, link: prev?.link };
  if (!cell.link && typeof parsed.v === 'string' && /^(https?:\/\/|mailto:)\S+$/i.test(parsed.v)) cell.link = parsed.v;
  return compactCell(cell);
}

export function setInput(sheet: Sheet, r: number, c: number, raw: string): Op[] {
  return cellsOp(sheet, [[cellKey(r, c), cellFromInput(sheet, r, c, raw)]]);
}

/** Enters the same text in every cell of the ranges, shifting formulas (Ctrl+Enter). */
export function setInputAll(sheet: Sheet, ranges: Range[], origin: { r: number; c: number }, raw: string, shift: (f: string, dr: number, dc: number) => string): Op[] {
  const set = new Map<number, Cell | null>();
  for (const range of ranges) {
    for (let r = range.r1; r <= range.r2; r++) {
      for (let c = range.c1; c <= range.c2; c++) {
        const text = raw.startsWith('=') ? shift(raw, r - origin.r, c - origin.c) : raw;
        set.set(cellKey(r, c), cellFromInput(sheet, r, c, text));
      }
    }
  }
  return cellsOp(sheet, [...set]);
}

export type ClearKind = 'contents' | 'formats' | 'notes' | 'links' | 'all';

export function clearRanges(sheet: Sheet, ranges: Range[], kind: ClearKind): Op[] {
  const set = new Map<number, Cell | null>();
  for (const range of ranges) {
    eachCell(sheet, range, (cell, _r, _c, key) => {
      let next: Cell = { ...cell };
      if (kind === 'contents' || kind === 'all') next = { ...next, v: undefined, f: undefined, link: kind === 'all' || typeof cell.v === 'string' ? undefined : next.link };
      if (kind === 'formats' || kind === 'all') next = { ...next, s: undefined };
      if (kind === 'notes' || kind === 'all') next = { ...next, note: undefined };
      if (kind === 'links') next = { ...next, link: undefined };
      const out = compactCell(next);
      if (out === null || JSON.stringify(out) !== JSON.stringify(cell)) set.set(key, out);
    });
  }
  const ops = cellsOp(sheet, [...set]);
  if (kind === 'formats' || kind === 'all') {
    for (const range of ranges) {
      if (isFullCol(range)) {
        const cols = [...sheet.cols].filter(([c, m]) => c >= range.c1 && c <= range.c2 && m.style);
        if (cols.length) ops.push({ t: 'cols', sheetId: sheet.id, set: cols.map(([c, m]) => [c, { ...m, style: undefined }]) });
      } else if (isFullRow(range)) {
        const rows = [...sheet.rows].filter(([r, m]) => r >= range.r1 && r <= range.r2 && m.style);
        if (rows.length) ops.push({ t: 'rows', sheetId: sheet.id, set: rows.map(([r, m]) => [r, { ...m, style: undefined }]) });
      }
    }
    const conditional = sheet.conditional.filter((rule) => !rule.ranges.every((rr) => ranges.some((x) => rr.r1 >= x.r1 && rr.r2 <= x.r2 && rr.c1 >= x.c1 && rr.c2 <= x.c2)));
    if (conditional.length !== sheet.conditional.length) ops.push({ t: 'sheet', sheetId: sheet.id, props: { conditional } });
  }
  if (kind === 'all' || kind === 'contents') {
    const sparklines = sheet.sparklines.filter((s) => !ranges.some((r) => inRange(r, s.r, s.c)));
    if (sparklines.length !== sheet.sparklines.length) ops.push({ t: 'sheet', sheetId: sheet.id, props: { sparklines } });
  }
  return ops;
}

export function setNote(sheet: Sheet, r: number, c: number, note: CellNote | null): Op[] {
  const key = cellKey(r, c);
  return cellsOp(sheet, [[key, compactCell({ ...sheet.cells.get(key), note: note ?? undefined })]]);
}

export function setLink(sheet: Sheet, r: number, c: number, link: string | null, label: string | null): Op[] {
  const key = cellKey(r, c);
  const prev = sheet.cells.get(key);
  const next: Cell = { ...prev, link: link ?? undefined };
  if (label !== null && label !== editText(prev, prev?.s?.numFmt)) {
    const parsed = parseInput(label);
    next.v = parsed.v;
    next.f = parsed.f;
  }
  return cellsOp(sheet, [[key, compactCell(next)]]);
}

/* -------------------------------------------------------- moving and shifting */

/** Rewrites formulas across the workbook so references follow moved cells. */
export function retargetFormulas(wb: Workbook, from: Sheet, rect: Range, dr: number, dc: number, to: Sheet, skip: (sheetId: string, key: number) => boolean): Op[] {
  const ops: Op[] = [];
  for (const sheet of wb.sheets) {
    const set: CellSet[] = [];
    for (const [key, cell] of sheet.cells) {
      if (cell.f === undefined || skip(sheet.id, key)) continue;
      const f = relocateRefs(cell.f, sheet.name, from.name, rect, dr, dc, to.name);
      if (f !== cell.f) set.push([key, { ...cell, f }]);
    }
    ops.push(...cellsOp(sheet, set));
  }
  return ops;
}

/** Moves a block of cells (cut and paste, or dragging the selection border). */
export function moveRange(wb: Workbook, from: Sheet, rect: Range, to: Sheet, r: number, c: number): Op[] {
  const dr = r - rect.r1;
  const dc = c - rect.c1;
  if (from.id === to.id && dr === 0 && dc === 0) return [];
  const dest: Range = { r1: r, c1: c, r2: rect.r2 + dr, c2: rect.c2 + dc };
  if (dest.r1 < 0 || dest.c1 < 0 || dest.r2 >= MAX_ROWS || dest.c2 >= MAX_COLS) throw new CommandError('The cells do not fit there.');
  if (to.merges.some((m) => rangesOverlap(m, dest) && !(from.id === to.id && rangesOverlap(m, rect)))) {
    throw new CommandError('Unmerge the destination cells before moving here.');
  }

  const source = new Map<number, Cell | null>();
  const target = new Map<number, Cell | null>();
  eachCell(from, rect, (_cell, _r, _c, key) => source.set(key, null));
  eachCell(to, dest, (_cell, _r, _c, key) => target.set(key, null));
  eachCell(from, rect, (cell, rr, cc) => {
    let next = cell;
    if (cell.f !== undefined) {
      const f = relocateRefs(cell.f, from.name, from.name, rect, dr, dc, to.name);
      next = f === cell.f ? cell : { ...cell, f };
    }
    target.set(cellKey(rr + dr, cc + dc), next);
  });

  const ops: Op[] = retargetFormulas(wb, from, rect, dr, dc, to, (sheetId, key) => {
    const rr = keyRow(key);
    const cc = keyCol(key);
    return (sheetId === from.id && inRange(rect, rr, cc)) || (sheetId === to.id && inRange(dest, rr, cc));
  });
  if (from.id === to.id) ops.push(...cellsOp(from, [...new Map([...source, ...target])]));
  else ops.push(...cellsOp(from, [...source]), ...cellsOp(to, [...target]));

  const moved = from.merges.filter((m) => inRange(rect, m.r1, m.c1) && inRange(rect, m.r2, m.c2));
  if (moved.length) {
    const shifted = moved.map((m) => ({ r1: m.r1 + dr, r2: m.r2 + dr, c1: m.c1 + dc, c2: m.c2 + dc }));
    if (from.id === to.id) ops.push({ t: 'sheet', sheetId: from.id, props: { merges: [...from.merges.filter((m) => !moved.includes(m)), ...shifted] } });
    else {
      ops.push({ t: 'sheet', sheetId: from.id, props: { merges: from.merges.filter((m) => !moved.includes(m)) } });
      ops.push({ t: 'sheet', sheetId: to.id, props: { merges: [...to.merges, ...shifted] } });
    }
  }
  return ops;
}

/** Inserts blank cells, pushing the rest of the row right or the column down. */
export function insertCells(wb: Workbook, sheet: Sheet, range: Range, direction: 'right' | 'down'): Op[] {
  const tail = tailRange(sheet, range, direction);
  if (!tail) return [];
  const n = direction === 'right' ? range.c2 - range.c1 + 1 : range.r2 - range.r1 + 1;
  return moveRange(wb, sheet, tail, sheet, tail.r1 + (direction === 'down' ? n : 0), tail.c1 + (direction === 'right' ? n : 0));
}

/** Deletes cells, pulling the rest of the row left or the column up. */
export function deleteCells(wb: Workbook, sheet: Sheet, range: Range, direction: 'left' | 'up'): Op[] {
  const after: Range = direction === 'left' ? { ...range, c1: range.c2 + 1, c2: range.c2 + 1 } : { ...range, r1: range.r2 + 1, r2: range.r2 + 1 };
  const tail = tailRange(sheet, after, direction === 'left' ? 'right' : 'down');
  const wipe: CellSet[] = [];
  eachCell(sheet, range, (_cell, _r, _c, key) => wipe.push([key, null]));
  if (!tail) return cellsOp(sheet, wipe);
  return [...cellsOp(sheet, wipe), ...moveRange(wb, sheet, tail, sheet, range.r1, range.c1)];
}

function tailRange(sheet: Sheet, range: Range, direction: 'right' | 'down'): Range | null {
  let max = -1;
  for (const key of sheet.cells.keys()) {
    const r = keyRow(key);
    const c = keyCol(key);
    if (direction === 'right') {
      if (r >= range.r1 && r <= range.r2 && c > max) max = c;
    } else if (c >= range.c1 && c <= range.c2 && r > max) max = r;
  }
  if (direction === 'right') return max >= range.c1 ? { ...range, c2: max } : null;
  return max >= range.r1 ? { ...range, r2: max } : null;
}
