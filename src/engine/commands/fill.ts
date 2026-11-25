/** Fill handle and autofill series. */
import { shiftFormula } from '@/formulas/rewrite';
import { serialToDate, dateToSerial } from '@/formulas/values';
import type { Cell, CellScalar, Op, Range, Sheet } from '@/types';
import { cellKey, rangesOverlap } from '../address';
import { isDateFormat } from '../numberFormat';
import { baseStyle, compactCell } from '../sheet';
import { cellsOp, CommandError } from './cells';

const LISTS: string[][] = [
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ['Q1', 'Q2', 'Q3', 'Q4'],
];

/** Produces the value at offset `i` from the start of the source (may be negative). */
type Generator = (i: number) => CellScalar;

function matchCase(sample: string, text: string): string {
  if (sample === sample.toUpperCase()) return text.toUpperCase();
  if (sample === sample.toLowerCase()) return text.toLowerCase();
  return text;
}

function listSeries(values: string[]): Generator | null {
  for (const list of LISTS) {
    const idx = values.map((v) => list.findIndex((x) => x.toLowerCase() === v.trim().toLowerCase()));
    if (idx.some((i) => i < 0)) continue;
    const n = list.length;
    const step = idx.length > 1 ? (((idx[1] - idx[0]) % n) + n) % n || 1 : 1;
    if (!idx.every((v, k) => k === 0 || (((v - idx[k - 1]) % n) + n) % n === step % n)) continue;
    return (i) => matchCase(values[0], list[(((idx[0] + step * i) % n) + n) % n]);
  }
  return null;
}

function numberedTextSeries(values: string[]): Generator | null {
  const parts = values.map((v) => /^(.*?)(\d+)(\D*)$/s.exec(v));
  if (parts.some((p) => !p)) return null;
  const [, prefix, first, suffix] = parts[0]!;
  if (parts.some((p) => p![1] !== prefix || p![3] !== suffix)) return null;
  const ns = parts.map((p) => Number(p![2]));
  const step = ns.length > 1 ? ns[1] - ns[0] : 1;
  if (!ns.every((v, k) => k === 0 || v - ns[k - 1] === step)) return null;
  const width = first.startsWith('0') ? first.length : 0;
  return (i) => `${prefix}${String(Math.abs(ns[0] + step * i)).padStart(width, '0')}${suffix}`;
}

function dateSeries(values: number[]): Generator {
  const ds = values.map(serialToDate);
  if (values.length === 1) return (i) => values[0] + i;
  const months = (d: Date): number => d.getUTCFullYear() * 12 + d.getUTCMonth();
  const stepM = months(ds[1]) - months(ds[0]);
  const monthEnd = (d: Date): boolean => new Date(d.getTime() + 86_400_000).getUTCDate() === 1;
  const sameDay = ds.every((d) => d.getUTCDate() === ds[0].getUTCDate()) || ds.every(monthEnd);
  if (stepM !== 0 && sameDay && ds.every((d, k) => k === 0 || months(d) - months(ds[k - 1]) === stepM)) {
    const allEnd = ds.every(monthEnd) && !ds.every((d) => d.getUTCDate() <= 28 && d.getUTCDate() === ds[0].getUTCDate());
    const frac = values[0] - Math.floor(values[0]);
    return (i) => {
      const m = months(ds[0]) + stepM * i;
      const y = Math.floor(m / 12);
      const mo = ((m % 12) + 12) % 12;
      const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
      const day = allEnd ? last : Math.min(ds[0].getUTCDate(), last);
      return dateToSerial(y, mo + 1, day) + frac;
    };
  }
  const step = values[1] - values[0];
  return (i) => values[0] + step * i;
}

function numberSeries(values: number[], increment: boolean): Generator {
  if (values.length === 1) return (i) => (increment ? values[0] + i : values[0]);
  const n = values.length;
  const mx = (n - 1) / 2;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  values.forEach((v, i) => {
    sxy += (i - mx) * (v - my);
    sxx += (i - mx) ** 2;
  });
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  return (i) => Number((intercept + slope * i).toPrecision(12));
}

/** Chooses a series for a line of source cells, or null to repeat them. */
export function detectSeries(values: CellScalar[], isDate: boolean, increment = false): Generator | null {
  if (values.length === 0 || values.some((v) => v === null || v === undefined)) return null;
  if (values.every((v) => typeof v === 'number')) {
    const ns = values as number[];
    return isDate ? dateSeries(ns) : numberSeries(ns, increment);
  }
  if (values.every((v) => typeof v === 'string')) {
    const ts = values as string[];
    return listSeries(ts) ?? numberedTextSeries(ts);
  }
  return null;
}

/**
 * Extends `source` so that it covers `target`, which must contain it and differ
 * along one axis only. `copy` repeats cells instead of continuing a series.
 */
export function fillRange(sheet: Sheet, source: Range, target: Range, options: { copy?: boolean; increment?: boolean; formatsOnly?: boolean; valuesOnly?: boolean } = {}): Op[] {
  const vertical = target.c1 === source.c1 && target.c2 === source.c2;
  if (sheet.merges.some((m) => rangesOverlap(m, target) && !rangesOverlap(m, source))) throw new CommandError('Unmerge the destination cells before filling.');
  const lineCount = vertical ? source.c2 - source.c1 + 1 : source.r2 - source.r1 + 1;
  const n = vertical ? source.r2 - source.r1 + 1 : source.c2 - source.c1 + 1;
  const lo = vertical ? target.r1 : target.c1;
  const hi = vertical ? target.r2 : target.c2;
  const base = vertical ? source.r1 : source.c1;
  const set: [number, Cell | null][] = [];

  for (let line = 0; line < lineCount; line++) {
    const pos = (i: number): [number, number] => (vertical ? [base + i, source.c1 + line] : [source.r1 + line, base + i]);
    const cells: (Cell | undefined)[] = [];
    for (let i = 0; i < n; i++) {
      const [r, c] = pos(i);
      cells.push(sheet.cells.get(cellKey(r, c)));
    }
    const [r0, c0] = pos(0);
    const isDate = isDateFormat(baseStyle(sheet, r0, c0)?.numFmt);
    const hasFormula = cells.some((c) => c?.f !== undefined);
    const series = options.copy || hasFormula || options.formatsOnly ? null : detectSeries(cells.map((c) => c?.v ?? null), isDate, options.increment);

    for (let p = lo; p <= hi; p++) {
      const offset = p - base;
      if (offset >= 0 && offset < n) continue;
      const k = ((offset % n) + n) % n;
      const src = cells[k];
      const [r, c] = pos(offset);
      const [sr, sc] = pos(k);
      const key = cellKey(r, c);
      const prev = sheet.cells.get(key);
      const style = options.valuesOnly ? prev?.s : (src?.s ?? baseStyle(sheet, sr, sc));
      if (options.formatsOnly) {
        set.push([key, compactCell({ ...prev, s: style })]);
        continue;
      }
      const next: Cell = { s: style, note: prev?.note };
      if (src?.f !== undefined) next.f = shiftFormula(src.f, r - sr, c - sc);
      else next.v = series ? series(offset) : src?.v;
      if (src?.link && !series) next.link = src.link;
      set.push([key, compactCell(next)]);
    }
  }
  return cellsOp(sheet, set);
}

/** Copies the first row or column of a selection across the rest (Ctrl+D / Ctrl+R). */
export function fillDirection(sheet: Sheet, range: Range, direction: 'down' | 'right' | 'up' | 'left'): Op[] {
  const source: Range =
    direction === 'down'
      ? { ...range, r2: range.r1 }
      : direction === 'up'
        ? { ...range, r1: range.r2 }
        : direction === 'right'
          ? { ...range, c2: range.c1 }
          : { ...range, c1: range.c2 };
  return fillRange(sheet, source, range, { copy: true });
}
