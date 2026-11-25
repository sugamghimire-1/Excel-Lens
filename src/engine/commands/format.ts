/** Commands that change cell formatting. */
import type { CalcEngine } from '@/formulas/calcEngine';
import type { AxisMeta, BorderEdge, Cell, CellStyle, Op, Range, Sheet, StylePatch } from '@/types';
import { cellKey, inRange, isFullCol, isFullRow, keyCol, keyRow, MAX_COLS, MAX_ROWS, rangeEquals, rangesOverlap } from '../address';
import { DEFAULT_COL_WIDTH, DEFAULT_ROW_HEIGHT } from '../axis';
import { fontString, lineHeight, measureText, wrapText } from '../measure';
import { formatValue } from '../numberFormat';
import { baseStyle, compactCell, eachCell, isBlankCell, patchStyle } from '../sheet';
import { cellsOp, CommandError } from './cells';

type StyleFn = (style: CellStyle | undefined, r: number, c: number) => CellStyle | undefined;

/** Applies a style transformation to ranges, storing full rows and columns compactly. */
export function mapStyle(sheet: Sheet, ranges: Range[], fn: StyleFn): Op[] {
  const cells = new Map<number, Cell | null>();
  const rows = new Map<number, AxisMeta>();
  const cols = new Map<number, AxisMeta>();

  const touch = (r: number, c: number): void => {
    const key = cellKey(r, c);
    const prev = sheet.cells.get(key);
    const s = fn(prev?.s ?? baseStyle(sheet, r, c), r, c);
    cells.set(key, compactCell({ ...prev, s }));
  };

  for (const range of ranges) {
    if (isFullCol(range)) {
      for (let c = range.c1; c <= range.c2; c++) {
        const meta = cols.get(c) ?? sheet.cols.get(c);
        cols.set(c, { ...meta, style: fn(meta?.style, 0, c) });
      }
      for (const key of sheet.cells.keys()) {
        const c = keyCol(key);
        if (c >= range.c1 && c <= range.c2) touch(keyRow(key), c);
      }
      for (const [r, meta] of sheet.rows) {
        if (!meta.style) continue;
        if (isFullRow(range)) rows.set(r, { ...meta, style: fn(meta.style, r, 0) });
        else for (let c = range.c1; c <= range.c2; c++) touch(r, c);
      }
    } else if (isFullRow(range)) {
      for (let r = range.r1; r <= range.r2; r++) {
        const meta = rows.get(r) ?? sheet.rows.get(r);
        rows.set(r, { ...meta, style: fn(meta?.style, r, 0) });
        for (const [c, colMeta] of sheet.cols) if (colMeta.style) touch(r, c);
      }
      for (const key of sheet.cells.keys()) {
        const r = keyRow(key);
        if (r >= range.r1 && r <= range.r2) touch(r, keyCol(key));
      }
    } else {
      for (let r = range.r1; r <= range.r2; r++) for (let c = range.c1; c <= range.c2; c++) touch(r, c);
    }
  }
  const ops: Op[] = cellsOp(sheet, [...cells]);
  if (rows.size) ops.push({ t: 'rows', sheetId: sheet.id, set: [...rows] });
  if (cols.size) ops.push({ t: 'cols', sheetId: sheet.id, set: [...cols] });
  return ops;
}

export function applyStyle(sheet: Sheet, ranges: Range[], patch: StylePatch): Op[] {
  return mapStyle(sheet, ranges, (s) => patchStyle(s, patch));
}

/* ----------------------------------------------------------------- borders */

export type BorderPreset = 'all' | 'outside' | 'inside' | 'none' | 'top' | 'bottom' | 'left' | 'right' | 'thickOutside' | 'topBottom' | 'doubleBottom' | 'thickBottom';

export function applyBorders(sheet: Sheet, ranges: Range[], preset: BorderPreset, color: string): Op[] {
  const thin: BorderEdge = { style: 'thin', color };
  const thick: BorderEdge = { style: 'medium', color };
  const ops: Op[] = [];
  for (const range of ranges) {
    ops.push(
      ...mapStyle(sheet, [range], (s, r, c) => {
        const top = r === range.r1;
        const bottom = r === range.r2;
        const left = c === range.c1;
        const right = c === range.c2;
        const patch: StylePatch = {};
        switch (preset) {
          case 'all':
            Object.assign(patch, { borderTop: thin, borderRight: thin, borderBottom: thin, borderLeft: thin });
            break;
          case 'none':
            Object.assign(patch, { borderTop: null, borderRight: null, borderBottom: null, borderLeft: null });
            break;
          case 'inside':
            if (!top) patch.borderTop = thin;
            if (!bottom) patch.borderBottom = thin;
            if (!left) patch.borderLeft = thin;
            if (!right) patch.borderRight = thin;
            break;
          case 'outside':
          case 'thickOutside': {
            const edge = preset === 'outside' ? thin : thick;
            if (top) patch.borderTop = edge;
            if (bottom) patch.borderBottom = edge;
            if (left) patch.borderLeft = edge;
            if (right) patch.borderRight = edge;
            break;
          }
          case 'top':
            if (top) patch.borderTop = thin;
            break;
          case 'bottom':
            if (bottom) patch.borderBottom = thin;
            break;
          case 'left':
            if (left) patch.borderLeft = thin;
            break;
          case 'right':
            if (right) patch.borderRight = thin;
            break;
          case 'topBottom':
            if (top) patch.borderTop = thin;
            if (bottom) patch.borderBottom = thin;
            break;
          case 'doubleBottom':
            if (bottom) patch.borderBottom = { style: 'double', color };
            break;
          case 'thickBottom':
            if (bottom) patch.borderBottom = thick;
            break;
        }
        return patchStyle(s, patch);
      }),
    );
    if (preset === 'none') ops.push(...clearNeighbourEdges(sheet, range));
  }
  return ops;
}

/** Removes edges that neighbours draw on the boundary of a cleared range. */
function clearNeighbourEdges(sheet: Sheet, range: Range): Op[] {
  const set: [number, Cell | null][] = [];
  const strip = (r: number, c: number, edge: 'borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft'): void => {
    if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) return;
    const key = cellKey(r, c);
    const cell = sheet.cells.get(key);
    if (cell?.s?.[edge]) set.push([key, compactCell({ ...cell, s: patchStyle(cell.s, { [edge]: null }) })]);
  };
  const lastRow = Math.min(range.r2, range.r1 + 5000);
  const lastCol = Math.min(range.c2, range.c1 + 2000);
  for (let r = range.r1; r <= lastRow; r++) {
    strip(r, range.c1 - 1, 'borderRight');
    strip(r, range.c2 + 1, 'borderLeft');
  }
  for (let c = range.c1; c <= lastCol; c++) {
    strip(range.r1 - 1, c, 'borderBottom');
    strip(range.r2 + 1, c, 'borderTop');
  }
  return cellsOp(sheet, set);
}

/* ------------------------------------------------------------------ merges */

export function mergeCells(sheet: Sheet, range: Range, mode: 'all' | 'across' | 'center'): Op[] {
  if (range.r1 === range.r2 && range.c1 === range.c2) return [];
  if (isFullCol(range) || isFullRow(range)) throw new CommandError('Select a smaller range to merge.');
  if (sheet.tables.some((t) => rangesOverlap(t.range, range))) throw new CommandError('Cells inside a table cannot be merged.');
  const blocks: Range[] =
    mode === 'across' ? Array.from({ length: range.r2 - range.r1 + 1 }, (_, i) => ({ ...range, r1: range.r1 + i, r2: range.r1 + i })).filter((b) => b.c1 !== b.c2) : [range];
  const merges = [...sheet.merges.filter((m) => !blocks.some((b) => rangesOverlap(m, b))), ...blocks];

  const set = new Map<number, Cell | null>();
  for (const block of blocks) {
    const anchorKey = cellKey(block.r1, block.c1);
    let anchor = sheet.cells.get(anchorKey);
    eachCell(sheet, block, (cell, _r, _c, key) => {
      if (key === anchorKey) return;
      if (isBlankCell(anchor) && !isBlankCell(cell)) anchor = { ...anchor, v: cell.v, f: cell.f };
      if (!isBlankCell(cell)) set.set(key, compactCell({ ...cell, v: undefined, f: undefined }));
    });
    const s = mode === 'center' ? patchStyle(anchor?.s ?? baseStyle(sheet, block.r1, block.c1), { hAlign: 'center' }) : anchor?.s;
    set.set(anchorKey, compactCell({ ...anchor, s }));
  }
  return [...cellsOp(sheet, [...set]), { t: 'sheet', sheetId: sheet.id, props: { merges } }];
}

export function unmergeCells(sheet: Sheet, ranges: Range[]): Op[] {
  const merges = sheet.merges.filter((m) => !ranges.some((r) => rangesOverlap(m, r)));
  return merges.length === sheet.merges.length ? [] : [{ t: 'sheet', sheetId: sheet.id, props: { merges } }];
}

/** Counts non-empty cells a merge would discard. */
export function mergeLoss(sheet: Sheet, range: Range): number {
  let n = 0;
  eachCell(sheet, range, (cell) => {
    if (!isBlankCell(cell)) n++;
  });
  return Math.max(0, n - 1);
}

/* ----------------------------------------------------------------- sizing */

const CELL_PAD = 5;
const MAX_AUTO_HEIGHT = 420;

function neededHeight(sheet: Sheet, engine: CalcEngine, r: number, c: number, width: number): number {
  const style = baseStyle(sheet, r, c);
  const line = lineHeight(style?.fontSize);
  if (!style?.wrap) return line;
  const { text } = formatValue(engine.readCell(sheet.id, r, c), style.numFmt);
  const lines = wrapText(text, fontString(style), width - CELL_PAD * 2 - (style.indent ?? 0) * 10);
  return lines.length * line;
}

/** Fits row heights to content for rows the user has not sized by hand. */
export function autoRowHeights(sheet: Sheet, engine: CalcEngine, rows: Iterable<number>, force = false): Op[] {
  const byRow = new Map<number, number>();
  for (const r of rows) {
    if (force || !sheet.rows.get(r)?.custom) byRow.set(r, DEFAULT_ROW_HEIGHT);
  }
  if (!byRow.size) return [];
  const consider = (key: number, cell: Cell): void => {
    const r = keyRow(key);
    const current = byRow.get(r);
    if (current === undefined) return;
    const c = keyCol(key);
    const blank = isBlankCell(cell);
    if (blank && !cell.s?.fontSize) return;
    const merge = sheet.merges.find((m) => inRange(m, r, c));
    if (merge && merge.r1 !== merge.r2) return;
    let width = sheet.cols.get(c)?.size ?? DEFAULT_COL_WIDTH;
    if (merge) for (let cc = merge.c1 + 1; cc <= merge.c2; cc++) width += sheet.cols.get(cc)?.size ?? DEFAULT_COL_WIDTH;
    const h = Math.min(MAX_AUTO_HEIGHT, neededHeight(sheet, engine, r, c, width) + 4);
    if (h > current) byRow.set(r, h);
  };
  if (byRow.size < 400) {
    for (const r of byRow.keys()) {
      const base = cellKey(r, 0);
      for (let c = 0; c < 256; c++) {
        const cell = sheet.cells.get(base + c);
        if (cell) consider(base + c, cell);
      }
    }
  } else for (const [key, cell] of sheet.cells) consider(key, cell);

  const set: [number, AxisMeta | null][] = [];
  for (const [r, h] of byRow) {
    const meta = sheet.rows.get(r);
    const size = h === DEFAULT_ROW_HEIGHT ? undefined : Math.round(h);
    if (meta?.size === size && !(force && meta?.custom)) continue;
    const next: AxisMeta = { ...meta, size, custom: undefined };
    set.push([r, size === undefined && !next.hidden && !next.style ? null : next]);
  }
  return set.length ? [{ t: 'rows', sheetId: sheet.id, set }] : [];
}

/** Fits column widths to the widest visible content. */
export function autoColWidths(sheet: Sheet, engine: CalcEngine, cols: number[]): Op[] {
  const widths = new Map(cols.map((c) => [c, 0]));
  let scanned = 0;
  for (const [key, cell] of sheet.cells) {
    const c = keyCol(key);
    const current = widths.get(c);
    if (current === undefined || isBlankCell(cell) || ++scanned > 60_000) continue;
    const r = keyRow(key);
    if (sheet.merges.some((m) => inRange(m, r, c))) continue;
    const style = baseStyle(sheet, r, c);
    const { text } = formatValue(engine.readCell(sheet.id, r, c), style?.numFmt);
    const font = fontString(style);
    const isTableHeader = sheet.tables.some((t) => t.headerRow && t.range.r1 === r && inRange(t.range, r, c));
    const w = Math.max(...text.split('\n').map((l) => measureText(l, font))) + CELL_PAD * 2 + (style?.indent ?? 0) * 10 + 4 + (isTableHeader || (sheet.filter && sheet.filter.range.r1 === r && inRange(sheet.filter.range, r, c)) ? 22 : 0);
    if (w > current) widths.set(c, w);
  }
  const set: [number, AxisMeta | null][] = [...widths].map(([c, w]) => {
    const meta = sheet.cols.get(c);
    return [c, { ...meta, size: w === 0 ? undefined : Math.round(Math.min(560, Math.max(28, w))), custom: undefined }];
  });
  return set.length ? [{ t: 'cols', sheetId: sheet.id, set }] : [];
}

export function setAxisSize(sheet: Sheet, axis: 'row' | 'col', indices: number[], size: number): Op[] {
  const map = axis === 'row' ? sheet.rows : sheet.cols;
  const px = Math.max(0, Math.min(1200, Math.round(size)));
  const set: [number, AxisMeta][] = indices.map((i) => [i, { ...map.get(i), size: px === 0 ? map.get(i)?.size : px, hidden: px === 0 ? true : undefined, custom: true }]);
  return [{ t: axis === 'row' ? 'rows' : 'cols', sheetId: sheet.id, set }];
}

export function setAxisHidden(sheet: Sheet, axis: 'row' | 'col', lo: number, hi: number, hidden: boolean): Op[] {
  const map = axis === 'row' ? sheet.rows : sheet.cols;
  const set: [number, AxisMeta][] = [];
  if (hidden) for (let i = lo; i <= hi; i++) set.push([i, { ...map.get(i), hidden: true }]);
  else for (const [i, meta] of map) if (i >= lo && i <= hi && meta.hidden) set.push([i, { ...meta, hidden: undefined }]);
  return set.length ? [{ t: axis === 'row' ? 'rows' : 'cols', sheetId: sheet.id, set }] : [];
}

/** Copies formats from one range over another, tiling as needed (format painter). */
export function paintFormat(source: Sheet, from: Range, target: Sheet, to: Range): Op[] {
  const h = from.r2 - from.r1 + 1;
  const w = from.c2 - from.c1 + 1;
  const single = to.r1 === to.r2 && to.c1 === to.c2;
  const dest: Range = single ? { r1: to.r1, c1: to.c1, r2: Math.min(MAX_ROWS - 1, to.r1 + h - 1), c2: Math.min(MAX_COLS - 1, to.c1 + w - 1) } : to;
  const ops = mapStyle(target, [dest], (_s, r, c) => baseStyle(source, from.r1 + ((r - dest.r1) % h), from.c1 + ((c - dest.c1) % w)));
  const merges = source.merges.filter((m) => inRange(from, m.r1, m.c1) && inRange(from, m.r2, m.c2));
  if (merges.length && single) {
    const moved = merges.map((m) => ({ r1: m.r1 + dest.r1 - from.r1, r2: m.r2 + dest.r1 - from.r1, c1: m.c1 + dest.c1 - from.c1, c2: m.c2 + dest.c1 - from.c1 }));
    const kept = target.merges.filter((m) => !moved.some((x) => rangesOverlap(x, m)) || moved.some((x) => rangeEquals(x, m)));
    ops.push({ t: 'sheet', sheetId: target.id, props: { merges: [...kept.filter((m) => !moved.some((x) => rangeEquals(x, m))), ...moved] } });
  }
  return ops;
}
