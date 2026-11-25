/** Geometry of the visible part of a sheet. */
import { colAxis, rowAxis, type AxisGeometry } from '@/engine/axis';
import type { Range, Sheet } from '@/types';

export const HEADER_H = 24;

export interface Viewport {
  /** Size in CSS pixels, including headers. */
  width: number;
  height: number;
  zoom: number;
  /** Scroll offset in sheet pixels, beyond the frozen area. */
  scrollX: number;
  scrollY: number;
  headerW: number;
  headerH: number;
}

/** A rectangular region of the canvas showing one part of the sheet. */
export interface Pane {
  id: 'main' | 'top' | 'left' | 'corner';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Sheet pixel shown at the pane's top-left corner. */
  sx: number;
  sy: number;
}

export interface Layout {
  view: Viewport;
  rows: AxisGeometry;
  cols: AxisGeometry;
  frozenW: number;
  frozenH: number;
  panes: Pane[];
}

export function headerWidth(lastRow: number): number {
  const digits = String(Math.max(99, lastRow + 1)).length;
  return Math.max(38, 16 + digits * 8);
}

export function computeLayout(sheet: Sheet, view: Viewport): Layout {
  const rows = rowAxis(sheet);
  const cols = colAxis(sheet);
  const frozenW = cols.offset(sheet.frozenCols);
  const frozenH = rows.offset(sheet.frozenRows);
  const fx = Math.min(view.width, view.headerW + frozenW * view.zoom);
  const fy = Math.min(view.height, view.headerH + frozenH * view.zoom);
  const panes: Pane[] = [
    { id: 'main', x: fx, y: fy, w: Math.max(0, view.width - fx), h: Math.max(0, view.height - fy), sx: frozenW + view.scrollX, sy: frozenH + view.scrollY },
  ];
  if (sheet.frozenRows) panes.push({ id: 'top', x: fx, y: view.headerH, w: Math.max(0, view.width - fx), h: fy - view.headerH, sx: frozenW + view.scrollX, sy: 0 });
  if (sheet.frozenCols) panes.push({ id: 'left', x: view.headerW, y: fy, w: fx - view.headerW, h: Math.max(0, view.height - fy), sx: 0, sy: frozenH + view.scrollY });
  if (sheet.frozenRows && sheet.frozenCols) panes.push({ id: 'corner', x: view.headerW, y: view.headerH, w: fx - view.headerW, h: fy - view.headerH, sx: 0, sy: 0 });
  return { view, rows, cols, frozenW, frozenH, panes };
}

/** CSS x of a sheet-pixel offset, using the pane that owns it. */
export function xOf(l: Layout, px: number): number {
  return px < l.frozenW ? l.view.headerW + px * l.view.zoom : l.view.headerW + l.frozenW * l.view.zoom + (px - l.frozenW - l.view.scrollX) * l.view.zoom;
}

export function yOf(l: Layout, px: number): number {
  return px < l.frozenH ? l.view.headerH + px * l.view.zoom : l.view.headerH + l.frozenH * l.view.zoom + (px - l.frozenH - l.view.scrollY) * l.view.zoom;
}

/** Sheet-pixel offset under a CSS x. */
export function sheetX(l: Layout, x: number): number {
  const local = (x - l.view.headerW) / l.view.zoom;
  return local < l.frozenW ? local : local + l.view.scrollX;
}

export function sheetY(l: Layout, y: number): number {
  const local = (y - l.view.headerH) / l.view.zoom;
  return local < l.frozenH ? local : local + l.view.scrollY;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Cell range in CSS pixels, positioned by its top-left pane. */
export function rangeBox(l: Layout, range: Range): Box {
  const x = xOf(l, l.cols.offset(range.c1));
  const y = yOf(l, l.rows.offset(range.r1));
  const w = (l.cols.offset(range.c2 + 1) - l.cols.offset(range.c1)) * l.view.zoom;
  const h = (l.rows.offset(range.r2 + 1) - l.rows.offset(range.r1)) * l.view.zoom;
  return { x, y, w, h };
}

/** Cell range as seen by one pane, so ranges can cross a freeze boundary. */
export function rangeBoxInPane(l: Layout, pane: Pane, range: Range): Box {
  const x1 = pane.x + (l.cols.offset(range.c1) - pane.sx) * l.view.zoom;
  const y1 = pane.y + (l.rows.offset(range.r1) - pane.sy) * l.view.zoom;
  const x2 = pane.x + (l.cols.offset(range.c2 + 1) - pane.sx) * l.view.zoom;
  const y2 = pane.y + (l.rows.offset(range.r2 + 1) - pane.sy) * l.view.zoom;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface Span {
  index: number;
  /** Sheet-pixel start. */
  start: number;
  size: number;
}

/** Visible rows or columns that intersect a sheet-pixel interval. */
export function visibleSpans(axis: AxisGeometry, from: number, length: number): Span[] {
  const out: Span[] = [];
  let i = axis.indexAt(Math.max(0, from));
  let start = axis.offset(i);
  const end = from + length;
  while (start < end && i < axis.count) {
    const size = axis.size(i);
    if (size > 0) out.push({ index: i, start, size });
    start += size;
    i++;
  }
  return out;
}
