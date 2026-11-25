import type { AxisMeta, Sheet } from '@/types';
import { MAX_COLS, MAX_ROWS } from './address';

export const DEFAULT_ROW_HEIGHT = 22;
export const DEFAULT_COL_WIDTH = 88;

/**
 * Maps between indices and pixel offsets along one axis. Only rows or columns
 * with a non-default size are stored, so lookups cost O(log overrides) no
 * matter how long the axis is.
 */
export class AxisGeometry {
  private readonly idx: number[] = [];
  private readonly sizes: number[] = [];
  /** Accumulated difference from the default size before each override. */
  private readonly delta: number[] = [];
  readonly total: number;

  constructor(
    readonly count: number,
    readonly defaultSize: number,
    overrides: [index: number, size: number][],
  ) {
    const sorted = overrides.slice().sort((a, b) => a[0] - b[0]);
    let acc = 0;
    for (const [i, size] of sorted) {
      this.idx.push(i);
      this.sizes.push(size);
      this.delta.push(acc);
      acc += size - defaultSize;
    }
    this.total = count * defaultSize + acc;
  }

  /** Position of the first override at or after `index`. */
  private lower(index: number): number {
    let lo = 0;
    let hi = this.idx.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.idx[mid] < index) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  size(index: number): number {
    const p = this.lower(index);
    return this.idx[p] === index ? this.sizes[p] : this.defaultSize;
  }

  /** Pixel offset of the leading edge of `index`. */
  offset(index: number): number {
    const p = this.lower(index);
    if (p < this.idx.length) return index * this.defaultSize + this.delta[p];
    const last = this.idx.length - 1;
    const acc = last >= 0 ? this.delta[last] + this.sizes[last] - this.defaultSize : 0;
    return index * this.defaultSize + acc;
  }

  /** Index of the row or column that contains a pixel offset. */
  indexAt(px: number): number {
    if (px <= 0) return this.nextVisible(0);
    if (px >= this.total) return this.count - 1;
    let lo = 0;
    let hi = this.idx.length - 1;
    let p = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.idx[mid] * this.defaultSize + this.delta[mid] <= px) {
        p = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (p < 0) return Math.floor(px / this.defaultSize);
    const start = this.idx[p] * this.defaultSize + this.delta[p];
    const end = start + this.sizes[p];
    if (px < end) return this.idx[p];
    return this.idx[p] + 1 + Math.floor((px - end) / this.defaultSize);
  }

  isHidden(index: number): boolean {
    return this.size(index) === 0;
  }

  /** First visible index at or after `index`. */
  nextVisible(index: number): number {
    let i = index;
    while (i < this.count - 1 && this.isHidden(i)) i++;
    return i;
  }

  /** First visible index at or before `index`. */
  prevVisible(index: number): number {
    let i = index;
    while (i > 0 && this.isHidden(i)) i--;
    return i;
  }
}

const rowCache = new WeakMap<ReadonlyMap<number, AxisMeta>, { hidden: ReadonlySet<number>; axis: AxisGeometry }>();
const colCache = new WeakMap<ReadonlyMap<number, AxisMeta>, AxisGeometry>();

export function rowAxis(sheet: Sheet): AxisGeometry {
  const hit = rowCache.get(sheet.rows);
  if (hit && hit.hidden === sheet.filterHidden) return hit.axis;
  const sizes = new Map<number, number>();
  for (const [i, m] of sheet.rows) {
    if (m.hidden) sizes.set(i, 0);
    else if (m.size !== undefined) sizes.set(i, m.size);
  }
  for (const i of sheet.filterHidden) sizes.set(i, 0);
  const axis = new AxisGeometry(sheet.rowCount || MAX_ROWS, DEFAULT_ROW_HEIGHT, [...sizes]);
  rowCache.set(sheet.rows, { hidden: sheet.filterHidden, axis });
  return axis;
}

export function colAxis(sheet: Sheet): AxisGeometry {
  const hit = colCache.get(sheet.cols);
  if (hit) return hit;
  const overrides: [number, number][] = [];
  for (const [i, m] of sheet.cols) {
    if (m.hidden) overrides.push([i, 0]);
    else if (m.size !== undefined) overrides.push([i, m.size]);
  }
  const axis = new AxisGeometry(sheet.colCount || MAX_COLS, DEFAULT_COL_WIDTH, overrides);
  colCache.set(sheet.cols, axis);
  return axis;
}
