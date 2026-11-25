/** Reads chart series out of a workbook. */
import type { CalcEngine } from '@/formulas/calcEngine';
import type { ChartModel, Range, Sheet, Workbook } from '@/types';
import { parseRangeName, splitSheetRef } from './address';
import { formatValue, isDateFormat } from './numberFormat';
import { baseStyle, clipToContent } from './sheet';

export interface ChartSeries {
  name: string;
  values: (number | null)[];
  /** Number format of the source cells, used for labels and tooltips. */
  numFmt?: string;
}

export interface ChartData {
  categories: string[];
  series: ChartSeries[];
  /** Numeric x values for scatter charts. */
  xs: (number | null)[];
  error: string | null;
}

const MAX_POINTS = 5000;
const MAX_SERIES = 32;

export function resolveChartRange(wb: Workbook, owner: Sheet, ref: string): { sheet: Sheet; range: Range } | null {
  const { sheet: name, local } = splitSheetRef(ref);
  const sheet = name === null ? owner : wb.sheets.find((s) => s.name.toLowerCase() === name.toLowerCase());
  const range = parseRangeName(local);
  return sheet && range ? { sheet, range } : null;
}

export function readChartData(wb: Workbook, engine: CalcEngine, owner: Sheet, chart: ChartModel): ChartData {
  const empty = (error: string): ChartData => ({ categories: [], series: [], xs: [], error });
  const target = resolveChartRange(wb, owner, chart.range);
  if (!target) return empty('The data range is not valid.');
  const { sheet } = target;
  const range = clipToContent(sheet, target.range);
  if (!range) return empty('The data range is empty.');

  const rows: number[] = [];
  for (let r = range.r1; r <= range.r2; r++) if (!engine.isRowHidden(sheet.id, r)) rows.push(r);
  const cols: number[] = [];
  for (let c = range.c1; c <= range.c2; c++) if (!sheet.cols.get(c)?.hidden) cols.push(c);

  const flip = chart.seriesInRows;
  // "Outer" walks series, "inner" walks points.
  const outer = flip ? rows : cols;
  const inner = flip ? cols : rows;
  const at = (o: number, i: number): [number, number] => (flip ? [o, i] : [i, o]);
  const hasNames = flip ? chart.firstColLabels : chart.firstRowHeaders;
  const hasCats = flip ? chart.firstRowHeaders : chart.firstColLabels;
  const text = (r: number, c: number): string => formatValue(engine.readCell(sheet.id, r, c), baseStyle(sheet, r, c)?.numFmt).text;

  const points = inner.slice(hasNames ? 1 : 0, MAX_POINTS + 1);
  const seriesIdx = outer.slice(hasCats ? 1 : 0, MAX_SERIES + (hasCats ? 1 : 0));
  const nameAt = inner[0];
  const catAt = outer[0];
  if (!points.length || !seriesIdx.length) return empty('Select at least one column of numbers.');

  const categories = points.map((i, n) => (hasCats ? text(...at(catAt, i)) : String(n + 1)));
  const xs = points.map((i, n) => {
    if (!hasCats) return n + 1;
    const v = engine.readCell(sheet.id, ...at(catAt, i));
    return typeof v === 'number' ? v : null;
  });
  const series = seriesIdx
    .map((o, n): ChartSeries => {
      let numFmt: string | undefined;
      const values = points.map((i) => {
        const [r, c] = at(o, i);
        const v = engine.readCell(sheet.id, r, c);
        if (typeof v !== 'number') return null;
        numFmt ??= baseStyle(sheet, r, c)?.numFmt;
        return v;
      });
      return { name: (hasNames ? text(...at(o, nameAt)) : '') || `Series ${n + 1}`, values, numFmt: isDateFormat(numFmt) ? undefined : numFmt };
    })
    .filter((s) => s.values.some((v) => v !== null));
  if (!series.length) return empty('The data range has no numbers.');
  return { categories, series, xs, error: null };
}
