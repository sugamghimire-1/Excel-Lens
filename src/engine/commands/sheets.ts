/** Commands on sheets, rows, columns, names and charts. */
import { renameSheetInFormula } from '@/formulas/rewrite';
import type { ChartModel, ChartType, DefinedName, Op, Range, Sheet, Workbook } from '@/types';
import { uid } from '@/utils/id';
import { contentRange, createSheet, nextSheetName, uniqueSheetName, validateSheetName } from '../sheet';
import { parseCellName, quoteSheet, rangeName, splitSheetRef } from '../address';
import { CommandError } from './cells';

export function insertAxis(sheet: Sheet, axis: 'row' | 'col', index: number, count: number): Op[] {
  const used = contentRange(sheet);
  const limit = axis === 'row' ? sheet.rowCount : sheet.colCount;
  if (used && (axis === 'row' ? used.r2 : used.c2) + count >= limit) {
    throw new CommandError(`There is not enough room to insert ${axis === 'row' ? 'rows' : 'columns'}: cells at the edge of the sheet would be lost.`);
  }
  return [{ t: 'structure', sheetId: sheet.id, axis, kind: 'insert', index, count }];
}

export function deleteAxis(sheet: Sheet, axis: 'row' | 'col', index: number, count: number): Op[] {
  return [{ t: 'structure', sheetId: sheet.id, axis, kind: 'delete', index, count }];
}

export function addSheet(wb: Workbook, index = wb.sheets.length): { ops: Op[]; sheet: Sheet } {
  const sheet = createSheet(nextSheetName(wb));
  return { ops: [{ t: 'addSheet', sheet, index }], sheet };
}

export function renameSheet(wb: Workbook, sheet: Sheet, name: string): Op[] {
  const next = name.trim();
  if (next === sheet.name) return [];
  const problem = validateSheetName(wb, next, sheet.id);
  if (problem) throw new CommandError(problem);
  const ops: Op[] = [{ t: 'sheet', sheetId: sheet.id, props: { name: next } }];
  for (const s of wb.sheets) {
    const charts = s.charts.map((ch) => {
      const ref = splitSheetRef(ch.range);
      return ref.sheet?.toLowerCase() === sheet.name.toLowerCase() ? { ...ch, range: `${quoteSheet(next)}!${ref.local}` } : ch;
    });
    if (charts.some((c, i) => c !== s.charts[i])) ops.push({ t: 'sheet', sheetId: s.id, props: { charts } });
  }
  return ops;
}

export function removeSheet(wb: Workbook, sheet: Sheet): Op[] {
  if (wb.sheets.filter((s) => !s.hidden).length <= 1) throw new CommandError('A workbook needs at least one visible sheet.');
  return [{ t: 'removeSheet', sheetId: sheet.id }];
}

export function duplicateSheet(wb: Workbook, sheet: Sheet): { ops: Op[]; sheet: Sheet } {
  const name = uniqueSheetName(wb, sheet.name);
  const copy: Sheet = {
    ...sheet,
    id: uid('sh'),
    name,
    cells: new Map([...sheet.cells].map(([k, c]) => [k, c.f ? { ...c, f: renameSheetInFormula(c.f, sheet.name, name) } : c])),
    tables: sheet.tables.map((t) => ({ ...t, id: uid('tb') })),
    conditional: sheet.conditional.map((r) => ({ ...r, id: uid('cf') })),
    validations: sheet.validations.map((r) => ({ ...r, id: uid('dv') })),
    sparklines: sheet.sparklines.map((s) => ({ ...s, id: uid('sp') })),
    charts: sheet.charts.map((ch) => {
      const ref = splitSheetRef(ch.range);
      return { ...ch, id: uid('ch'), range: ref.sheet?.toLowerCase() === sheet.name.toLowerCase() ? `${quoteSheet(name)}!${ref.local}` : ch.range };
    }),
  };
  const index = wb.sheets.findIndex((s) => s.id === sheet.id) + 1;
  return { ops: [{ t: 'addSheet', sheet: copy, index }], sheet: copy };
}

export function moveSheet(sheetId: string, index: number): Op[] {
  return [{ t: 'moveSheet', sheetId, index }];
}

/* ------------------------------------------------------------------- names */

export function validateName(wb: Workbook, name: string, original?: string): string | null {
  if (!/^[A-Za-z_\\][\w.\\]*$/.test(name)) return 'Names start with a letter or underscore and contain only letters, numbers, periods and underscores.';
  if (parseCellName(name) || /^[rc]$/i.test(name)) return 'This name looks like a cell reference. Choose another one.';
  const lower = name.toLowerCase();
  if (wb.names.some((n) => n.name.toLowerCase() === lower && n.name.toLowerCase() !== original?.toLowerCase())) return `The name "${name}" is already defined.`;
  return null;
}

export function setNames(names: DefinedName[]): Op[] {
  return [{ t: 'workbook', props: { names } }];
}

/* ------------------------------------------------------------------ charts */

export function createChart(type: ChartType, sheetName: string, range: Range, position: { x: number; y: number }, title = ''): ChartModel {
  const pie = type === 'pie' || type === 'doughnut';
  return {
    id: uid('ch'),
    type,
    title,
    range: `${quoteSheet(sheetName)}!${rangeName(range, true)}`,
    seriesInRows: range.c2 - range.c1 > range.r2 - range.r1 && range.r2 - range.r1 < 6,
    firstRowHeaders: true,
    firstColLabels: true,
    stacked: false,
    smooth: false,
    showLegend: true,
    legendPosition: pie ? 'right' : 'bottom',
    showLabels: pie,
    showGridlines: true,
    xTitle: '',
    yTitle: '',
    colors: [],
    x: position.x,
    y: position.y,
    w: pie ? 400 : 520,
    h: 300,
  };
}

export function setCharts(sheet: Sheet, charts: ChartModel[]): Op[] {
  return [{ t: 'sheet', sheetId: sheet.id, props: { charts } }];
}
