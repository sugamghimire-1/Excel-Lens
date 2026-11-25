import type { CellPos, Range } from '@/types';

export const MAX_ROWS = 500_000;
export const MAX_COLS = 1024;

/** Packs a coordinate into one integer that stays within V8's small-integer range. */
export function cellKey(r: number, c: number): number {
  return r * MAX_COLS + c;
}

export function keyRow(key: number): number {
  return Math.floor(key / MAX_COLS);
}

export function keyCol(key: number): number {
  return key % MAX_COLS;
}

const colNameCache: string[] = [];

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function colName(c: number): string {
  const cached = colNameCache[c];
  if (cached) return cached;
  let n = c + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  colNameCache[c] = out;
  return out;
}

/** A -> 0. Case-insensitive. */
export function colIndex(name: string): number {
  let n = 0;
  for (let i = 0; i < name.length; i++) {
    n = n * 26 + (name.charCodeAt(i) & 31);
  }
  return n - 1;
}

export function cellName(r: number, c: number): string {
  return colName(c) + (r + 1);
}

export function absCellName(r: number, c: number): string {
  return `$${colName(c)}$${r + 1}`;
}

export function rangeName(range: Range, absolute = false): string {
  const name = absolute ? absCellName : cellName;
  if (range.r1 === range.r2 && range.c1 === range.c2) return name(range.r1, range.c1);
  return `${name(range.r1, range.c1)}:${name(range.r2, range.c2)}`;
}

/** Like `rangeName`, but collapses full rows and columns to `A:C` or `3:5`. */
export function prettyRangeName(range: Range): string {
  if (range.r1 === 0 && range.r2 >= MAX_ROWS - 1) return `${colName(range.c1)}:${colName(range.c2)}`;
  if (range.c1 === 0 && range.c2 >= MAX_COLS - 1) return `${range.r1 + 1}:${range.r2 + 1}`;
  return rangeName(range);
}

export function parseCellName(text: string): CellPos | null {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/.exec(text.trim());
  if (!m) return null;
  const c = colIndex(m[1]);
  const r = Number(m[2]) - 1;
  if (r < 0 || r >= MAX_ROWS || c >= MAX_COLS) return null;
  return { r, c };
}

/** Parses `A1`, `A1:B2`, `A:C` and `2:5`, ignoring `$`. */
export function parseRangeName(text: string): Range | null {
  const t = text.trim().replace(/\$/g, '');
  const single = parseCellName(t);
  if (single) return { r1: single.r, c1: single.c, r2: single.r, c2: single.c };
  const parts = t.split(':');
  if (parts.length !== 2) return null;
  const a = parseCellName(parts[0]);
  const b = parseCellName(parts[1]);
  if (a && b) return normalizeRange(a, b);
  if (/^[A-Za-z]{1,3}$/.test(parts[0]) && /^[A-Za-z]{1,3}$/.test(parts[1])) {
    const c1 = colIndex(parts[0]);
    const c2 = colIndex(parts[1]);
    if (c1 >= MAX_COLS || c2 >= MAX_COLS) return null;
    return { r1: 0, r2: MAX_ROWS - 1, c1: Math.min(c1, c2), c2: Math.max(c1, c2) };
  }
  if (/^\d{1,7}$/.test(parts[0]) && /^\d{1,7}$/.test(parts[1])) {
    const r1 = Number(parts[0]) - 1;
    const r2 = Number(parts[1]) - 1;
    if (Math.min(r1, r2) < 0 || Math.max(r1, r2) >= MAX_ROWS) return null;
    return { r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: 0, c2: MAX_COLS - 1 };
  }
  return null;
}

/** Splits `Sheet!A1` / `'My Sheet'!A1` into its sheet and local parts. */
export function splitSheetRef(text: string): { sheet: string | null; local: string } {
  const bang = text.lastIndexOf('!');
  if (bang < 0) return { sheet: null, local: text.trim() };
  return { sheet: unquoteSheet(text.slice(0, bang).trim()), local: text.slice(bang + 1).trim() };
}

export function unquoteSheet(name: string): string {
  return name.startsWith("'") && name.endsWith("'") ? name.slice(1, -1).replace(/''/g, "'") : name;
}

/** Quotes a sheet name when it would be ambiguous inside a formula. */
export function quoteSheet(name: string): string {
  const plain = /^[A-Za-z_À-￿][\w.À-￿]*$/.test(name) && !parseCellName(name) && !/^(TRUE|FALSE)$/i.test(name);
  return plain ? name : `'${name.replace(/'/g, "''")}'`;
}

export function normalizeRange(a: CellPos, b: CellPos): Range {
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

export function cellRange(r: number, c: number): Range {
  return { r1: r, c1: c, r2: r, c2: c };
}

export function inRange(range: Range, r: number, c: number): boolean {
  return r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
}

export function rangesOverlap(a: Range, b: Range): boolean {
  return a.r1 <= b.r2 && a.r2 >= b.r1 && a.c1 <= b.c2 && a.c2 >= b.c1;
}

export function rangeContains(outer: Range, inner: Range): boolean {
  return outer.r1 <= inner.r1 && outer.r2 >= inner.r2 && outer.c1 <= inner.c1 && outer.c2 >= inner.c2;
}

export function rangeEquals(a: Range, b: Range): boolean {
  return a.r1 === b.r1 && a.r2 === b.r2 && a.c1 === b.c1 && a.c2 === b.c2;
}

export function intersectRange(a: Range, b: Range): Range | null {
  const r: Range = {
    r1: Math.max(a.r1, b.r1),
    c1: Math.max(a.c1, b.c1),
    r2: Math.min(a.r2, b.r2),
    c2: Math.min(a.c2, b.c2),
  };
  return r.r1 <= r.r2 && r.c1 <= r.c2 ? r : null;
}

export function unionRange(a: Range, b: Range): Range {
  return {
    r1: Math.min(a.r1, b.r1),
    c1: Math.min(a.c1, b.c1),
    r2: Math.max(a.r2, b.r2),
    c2: Math.max(a.c2, b.c2),
  };
}

export function rangeSize(range: Range): { rows: number; cols: number; cells: number } {
  const rows = range.r2 - range.r1 + 1;
  const cols = range.c2 - range.c1 + 1;
  return { rows, cols, cells: rows * cols };
}

export function isFullRow(range: Range): boolean {
  return range.c1 === 0 && range.c2 >= MAX_COLS - 1;
}

export function isFullCol(range: Range): boolean {
  return range.r1 === 0 && range.r2 >= MAX_ROWS - 1;
}

/** Returns the parts of `a` that are not covered by `b` (0 to 4 rectangles). */
export function subtractRange(a: Range, b: Range): Range[] {
  const hit = intersectRange(a, b);
  if (!hit) return [a];
  const out: Range[] = [];
  if (a.r1 < hit.r1) out.push({ ...a, r2: hit.r1 - 1 });
  if (a.r2 > hit.r2) out.push({ ...a, r1: hit.r2 + 1 });
  if (a.c1 < hit.c1) out.push({ r1: hit.r1, r2: hit.r2, c1: a.c1, c2: hit.c1 - 1 });
  if (a.c2 > hit.c2) out.push({ r1: hit.r1, r2: hit.r2, c1: hit.c2 + 1, c2: a.c2 });
  return out;
}
