/** Find and replace. */
import type { CalcEngine } from '@/formulas/calcEngine';
import type { Cell, Op, Range, Sheet, Workbook } from '@/types';
import { cellKey, inRange, keyCol, keyRow } from '../address';
import { editText } from '../input';
import { formatValue } from '../numberFormat';
import { baseStyle } from '../sheet';
import { cellFromInput, cellsOp } from './cells';

export interface FindOptions {
  query: string;
  matchCase: boolean;
  wholeCell: boolean;
  regex: boolean;
  /** Search formula source instead of displayed values. */
  formulas: boolean;
  scope: 'sheet' | 'workbook' | 'selection';
}

export interface FindHit {
  sheetId: string;
  r: number;
  c: number;
}

/** Compiles the query, or returns null when it is empty or not a valid expression. */
export function findPattern(o: FindOptions): RegExp | null {
  if (!o.query) return null;
  const body = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    return new RegExp(o.wholeCell ? `^(?:${body})$` : body, o.matchCase ? 'g' : 'gi');
  } catch {
    return null;
  }
}

function searchable(sheet: Sheet, engine: CalcEngine, cell: Cell, r: number, c: number, formulas: boolean): string {
  const style = baseStyle(sheet, r, c);
  if (formulas) return editText(cell, style?.numFmt);
  return formatValue(engine.readCell(sheet.id, r, c), style?.numFmt).text;
}

export function findAll(wb: Workbook, engine: CalcEngine, activeSheetId: string, selection: Range[], o: FindOptions, limit = 5000): FindHit[] {
  const re = findPattern(o);
  if (!re) return [];
  const hits: FindHit[] = [];
  for (const sheet of wb.sheets) {
    if (sheet.hidden || (o.scope !== 'workbook' && sheet.id !== activeSheetId)) continue;
    const found: FindHit[] = [];
    for (const [key, cell] of sheet.cells) {
      const r = keyRow(key);
      const c = keyCol(key);
      if (o.scope === 'selection' && !selection.some((x) => inRange(x, r, c))) continue;
      const text = searchable(sheet, engine, cell, r, c, o.formulas);
      if (!text) continue;
      re.lastIndex = 0;
      if (re.test(text)) found.push({ sheetId: sheet.id, r, c });
    }
    found.sort((a, b) => a.r - b.r || a.c - b.c);
    hits.push(...found);
    if (hits.length >= limit) return hits.slice(0, limit);
  }
  return hits;
}

/** Replaces matches in the given cells. Formulas are edited only in formula mode. */
export function replaceHits(wb: Workbook, hits: FindHit[], o: FindOptions, replacement: string): { ops: Op[]; count: number } {
  const re = findPattern(o);
  if (!re) return { ops: [], count: 0 };
  let count = 0;
  const ops: Op[] = [];
  for (const sheet of wb.sheets) {
    const set: [number, Cell | null][] = [];
    for (const h of hits) {
      if (h.sheetId !== sheet.id) continue;
      const key = cellKey(h.r, h.c);
      const cell = sheet.cells.get(key);
      if (!cell || (cell.f !== undefined && !o.formulas)) continue;
      const before = editText(cell, baseStyle(sheet, h.r, h.c)?.numFmt);
      re.lastIndex = 0;
      const after = o.regex ? before.replace(re, replacement) : before.replace(re, () => replacement);
      if (after === before) continue;
      set.push([key, cellFromInput(sheet, h.r, h.c, after)]);
      count++;
    }
    ops.push(...cellsOp(sheet, set));
  }
  return { ops, count };
}
