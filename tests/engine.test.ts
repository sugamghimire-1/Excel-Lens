import { describe, expect, it } from 'vitest';
import { cellKey, cellName, colIndex, colName, MAX_ROWS, parseRangeName, quoteSheet, rangeName, splitSheetRef, subtractRange } from '@/engine/address';
import { AxisGeometry } from '@/engine/axis';
import { clearRanges, deleteCells, insertCells, moveRange } from '@/engine/commands/cells';
import { buildClip, clipToText, parseTsv, pasteClip } from '@/engine/commands/clipboard';
import { computeFilterHidden, removeDuplicates, setFilterCriterion, sortRange, textToColumns } from '@/engine/commands/data';
import { fillRange } from '@/engine/commands/fill';
import { findAll, replaceHits, type FindOptions } from '@/engine/commands/find';
import { applyBorders, applyStyle, mergeCells, unmergeCells } from '@/engine/commands/format';
import { deleteAxis, duplicateSheet, insertAxis, removeSheet, renameSheet } from '@/engine/commands/sheets';
import { ConditionalEvaluator } from '@/engine/conditional';
import { editText, parseInput } from '@/engine/input';
import { adjustDecimals, formatValue } from '@/engine/numberFormat';
import { baseStyle, currentRegion, mergeAt } from '@/engine/sheet';
import { isValid, listOptions } from '@/engine/validation';
import { cycleAbsolute, shiftFormula } from '@/formulas/rewrite';
import { dateToSerial } from '@/formulas/values';
import type { ConditionalRule, Range, ValidationRule } from '@/types';
import { Harness } from './helpers';

const R = (a: string): Range => parseRangeName(a)!;

describe('addresses', () => {
  it('converts columns both ways', () => {
    for (const [i, n] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [701, 'ZZ'], [702, 'AAA']] as const) {
      expect(colName(i)).toBe(n);
      expect(colIndex(n)).toBe(i);
    }
    expect(cellName(9, 27)).toBe('AB10');
  });
  it('parses and prints ranges', () => {
    expect(rangeName(R('C3:A1'))).toBe('A1:C3');
    expect(R('B:C')).toEqual({ r1: 0, r2: MAX_ROWS - 1, c1: 1, c2: 2 });
    expect(parseRangeName('nope')).toBe(null);
    expect(splitSheetRef("'It''s'!A1")).toEqual({ sheet: "It's", local: 'A1' });
    expect(quoteSheet('My Sheet')).toBe("'My Sheet'");
    expect(quoteSheet('A1')).toBe("'A1'");
  });
  it('subtracts rectangles', () => {
    const parts = subtractRange(R('A1:C3'), R('B2'));
    expect(parts).toHaveLength(4);
    expect(parts.reduce((n, p) => n + (p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1), 0)).toBe(8);
  });
});

describe('axis geometry', () => {
  const axis = new AxisGeometry(1000, 20, [[2, 50], [5, 0], [6, 0]]);
  it('computes offsets', () => {
    expect([axis.offset(0), axis.offset(2), axis.offset(3), axis.offset(7)]).toEqual([0, 40, 90, 130]);
    expect(axis.total).toBe(1000 * 20 + 30 - 40);
  });
  it('inverts offsets', () => {
    expect([axis.indexAt(0), axis.indexAt(45), axis.indexAt(89), axis.indexAt(90), axis.indexAt(130)]).toEqual([0, 2, 2, 3, 7]);
    for (let px = 0; px < 2000; px += 7) {
      const i = axis.indexAt(px);
      expect(axis.offset(i)).toBeLessThanOrEqual(px);
      expect(axis.offset(i) + axis.size(i)).toBeGreaterThan(px);
    }
  });
});

describe('number formats', () => {
  it.each([
    [1234.5, '#,##0.00', '1,234.50'],
    [-1234.5, '#,##0.00;[Red](#,##0.00)', '(1,234.50)'],
    [-5, '0', '-5'],
    [-0.001, '0.00', '0.00'],
    [0.256, '0%', '26%'],
    [1234567, '0.0,,"M"', '1.2M'],
    [45000, '$#,##0', '$45,000'],
    [12345.678, '0.00E+00', '1.23E+04'],
    [2.25, '# ?/?', '2 1/4'],
    [0.5, '# ?/?', '1/2'],
    [5, '000', '005'],
    [5551234567, '(000) 000-0000', '(555) 123-4567'],
    [dateToSerial(2026, 11, 25), 'yyyy-mm-dd', '2026-11-25'],
    [dateToSerial(2026, 11, 25), 'dddd, mmmm d, yyyy', 'Wednesday, November 25, 2026'],
    [dateToSerial(2026, 1, 5, 13, 7, 9), 'm/d/yy h:mm:ss AM/PM', '1/5/26 1:07:09 PM'],
    [1.5, '[h]:mm', '36:00'],
    ['hi', '@" there"', 'hi there'],
    [0, '0;-0;"zero"', 'zero'],
    [1.005, '0.00', '1.01'],
    [1e-7, 'General', '0.0000001'],
    [123456789012, 'General', '1.23457E+11'],
    [0.1 + 0.2, 'General', '0.3'],
    [true, '0', 'TRUE'],
    [1500, '[>=1000]0.0,"K";0', '1.5K'],
  ])('%s with %s', (v, code, out) => {
    expect(formatValue(v, code).text).toBe(out);
  });
  it('adjusts decimals', () => {
    expect(adjustDecimals('#,##0', 1)).toBe('#,##0.0');
    expect(adjustDecimals('0.00%', -1)).toBe('0.0%');
    expect(adjustDecimals('0.0', -1)).toBe('0');
    expect(adjustDecimals(undefined, 1, 1.25)).toBe('0.000');
  });
  it('returns colours from formats', () => {
    expect(formatValue(-1, '0;[Red]-0').color).toBeTruthy();
  });
});

describe('input parsing', () => {
  it.each([
    ['42', { v: 42 }],
    ['1,234', { v: 1234, numFmt: '#,##0' }],
    ['12%', { v: 0.12, numFmt: '0%' }],
    ['$5.50', { v: 5.5, numFmt: '$#,##0.00' }],
    ['(3)', { v: -3 }],
    ['true', { v: true }],
    ["'007", { v: '007' }],
    ['=A1', { f: '=A1' }],
    ['hello', { v: 'hello' }],
    ['2026-11-25', { v: dateToSerial(2026, 11, 25), numFmt: 'yyyy-mm-dd' }],
    ['11/25/2026', { v: dateToSerial(2026, 11, 25), numFmt: 'm/d/yyyy' }],
    ['9:30 AM', { v: 9.5 / 24, numFmt: 'h:mm AM/PM' }],
    ['1-2-3-4', { v: '1-2-3-4' }],
    ['2/30/2026', { v: '2/30/2026' }],
  ])('%s', (raw, out) => {
    expect(parseInput(raw)).toEqual(out);
  });
  it('round-trips through the editor', () => {
    expect(editText({ v: 0.12 }, '0%')).toBe('12%');
    expect(editText({ v: dateToSerial(2026, 11, 25) }, 'm/d/yyyy')).toBe('11/25/2026');
    expect(editText({ v: '007' })).toBe("'007");
    expect(editText({ f: '=A1' })).toBe('=A1');
  });
});

describe('formula rewriting', () => {
  it('shifts only relative parts', () => {
    expect(shiftFormula('=A1+$A1+A$1+$A$1', 1, 1)).toBe('=B2+$A2+B$1+$A$1');
    expect(shiftFormula('=SUM(A1:B2)&"A1"', 2, 0)).toBe('=SUM(A3:B4)&"A1"');
    expect(shiftFormula('=A1', -1, 0)).toBe('=#REF!');
    expect(shiftFormula("='My Sheet'!A1", 1, 0)).toBe("='My Sheet'!A2");
    expect(shiftFormula('=LOG10(A1)', 1, 0)).toBe('=LOG10(A2)');
  });
  it('cycles absolute references like F4', () => {
    let s = { text: '=A1+B2', caret: 3 };
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      s = cycleAbsolute(s.text, s.caret)!;
      seen.push(s.text);
    }
    expect(seen).toEqual(['=$A$1+B2', '=A$1+B2', '=$A1+B2', '=A1+B2']);
  });
});

describe('rows and columns', () => {
  it('inserts rows and rewrites references everywhere', () => {
    const h = new Harness({ Sheet1: { A1: 1, A2: 2, A3: '=SUM(A1:A2)', B1: '=A2' }, Other: { A1: '=Sheet1!A2*2' } });
    h.apply(insertAxis(h.sheet(), 'row', 1, 2));
    expect(h.formula('A5')).toBe('=SUM(A1:A4)');
    expect(h.formula('B1')).toBe('=A4');
    expect(h.formula('Other!A1')).toBe('=Sheet1!A4*2');
    expect(h.get('Other!A1')).toBe(4);
    h.undo();
    expect(h.formula('A3')).toBe('=SUM(A1:A2)');
    expect(h.formula('Other!A1')).toBe('=Sheet1!A2*2');
  });
  it('deletes columns, shrinks ranges and produces #REF!', () => {
    const h = new Harness({ Sheet1: { A1: 1, B1: 2, C1: 3, D1: '=SUM(A1:C1)', E1: '=B1' } });
    h.apply(deleteAxis(h.sheet(), 'col', 1, 1));
    expect(h.formula('C1')).toBe('=SUM(A1:B1)');
    expect(h.get('C1')).toBe(4);
    expect(h.formula('D1')).toBe('=#REF!');
    expect(h.get('D1')).toBe('#REF!');
    h.undo();
    expect(h.get('D1')).toBe(6);
  });
  it('moves merges, formats, validations and frozen panes with the cells', () => {
    const h = new Harness({ Sheet1: { A5: 'x' } });
    const id = h.sheet().id;
    h.apply([{ t: 'sheet', sheetId: id, props: { merges: [R('A5:B6')], frozenRows: 3 } }]);
    h.apply(insertAxis(h.sheet(), 'row', 0, 1));
    expect(h.sheet().merges).toEqual([R('A6:B7')]);
    expect(h.sheet().frozenRows).toBe(4);
    h.apply(deleteAxis(h.sheet(), 'row', 5, 2));
    expect(h.sheet().merges).toEqual([]);
  });
  it('inserts and deletes cells with shifting', () => {
    const h = new Harness({ Sheet1: { A1: 1, A2: 2, A3: 3, C1: '=A2' } });
    h.apply(insertCells(h.wb, h.sheet(), R('A2'), 'down'));
    expect([h.get('A2'), h.get('A3'), h.get('A4')]).toEqual([null, 2, 3]);
    expect(h.formula('C1')).toBe('=A3');
    h.apply(deleteCells(h.wb, h.sheet(), R('A1'), 'up'));
    expect([h.get('A1'), h.get('A2'), h.get('A3')]).toEqual([null, 2, 3]);
  });
});

describe('sheets', () => {
  it('renames and rewrites formulas', () => {
    const h = new Harness({ Sheet1: { A1: '=Data!A1' }, Data: { A1: 7 } });
    h.apply(renameSheet(h.wb, h.sheet('Data'), 'Raw data'));
    expect(h.formula('A1')).toBe("='Raw data'!A1");
    expect(h.get('A1')).toBe(7);
    h.undo();
    expect(h.formula('A1')).toBe('=Data!A1');
    expect(() => renameSheet(h.wb, h.sheet('Data'), 'sheet1')).toThrow(/already exists/);
    expect(() => renameSheet(h.wb, h.sheet('Data'), 'a/b')).toThrow(/cannot contain/);
  });
  it('deletes, leaves #REF!, and restores on undo', () => {
    const h = new Harness({ Sheet1: { A1: '=Data!A1' }, Data: { A1: 7 } });
    h.apply(removeSheet(h.wb, h.sheet('Data')));
    expect(h.get('A1')).toBe('#REF!');
    h.undo();
    expect(h.get('A1')).toBe(7);
    expect(() => removeSheet({ ...h.wb, sheets: [h.sheet()] }, h.sheet())).toThrow();
  });
  it('duplicates independently', () => {
    const h = new Harness({ Sheet1: { A1: 1, A2: '=A1*2' } });
    h.apply(duplicateSheet(h.wb, h.sheet()).ops);
    h.set("'Sheet1 (2)'!A1", '50');
    expect(h.get('A2')).toBe(2);
    expect(h.get("'Sheet1 (2)'!A2")).toBe(100);
  });
});

describe('editing commands', () => {
  it('undoes and redoes value edits', () => {
    const h = new Harness({ Sheet1: { A1: 1, B1: '=A1' } });
    h.set('A1', '9');
    expect(h.get('B1')).toBe(9);
    h.undo();
    expect(h.get('B1')).toBe(1);
  });
  it('clears contents but keeps formats', () => {
    const h = new Harness({ Sheet1: { A1: 1 } });
    h.apply(applyStyle(h.sheet(), [R('A1')], { bold: true }));
    h.apply(clearRanges(h.sheet(), [R('A1')], 'contents'));
    expect(h.get('A1')).toBe(null);
    expect(baseStyle(h.sheet(), 0, 0)?.bold).toBe(true);
    h.apply(clearRanges(h.sheet(), [R('A1')], 'formats'));
    expect(baseStyle(h.sheet(), 0, 0)).toBeUndefined();
  });
  it('moves cells and retargets references', () => {
    const h = new Harness({ Sheet1: { A1: 5, B1: '=A1', C1: '=SUM(A1:A1)' }, Two: {} });
    h.apply(moveRange(h.wb, h.sheet(), R('A1'), h.sheet('Two'), 3, 3));
    expect(h.formula('B1')).toBe('=Two!D4');
    expect(h.get('B1')).toBe(5);
    h.undo();
    expect(h.formula('B1')).toBe('=A1');
  });
  it('formats whole columns without creating cells', () => {
    const h = new Harness({ Sheet1: { A1: 1 } });
    h.apply(applyStyle(h.sheet(), [R('A:A')], { italic: true }));
    expect(h.sheet().cells.size).toBe(1);
    expect(baseStyle(h.sheet(), 4000, 0)?.italic).toBe(true);
    h.undo();
    expect(baseStyle(h.sheet(), 4000, 0)).toBeUndefined();
  });
  it('draws and removes borders', () => {
    const h = new Harness({ Sheet1: {} });
    h.apply(applyBorders(h.sheet(), [R('B2:C3')], 'outside', '#000000'));
    expect(baseStyle(h.sheet(), 1, 1)?.borderTop).toBeTruthy();
    expect(baseStyle(h.sheet(), 1, 1)?.borderRight).toBeUndefined();
    h.apply(applyBorders(h.sheet(), [R('B2:C3')], 'none', '#000000'));
    expect(h.sheet().cells.size).toBe(0);
  });
  it('merges, keeps the first value, and unmerges', () => {
    const h = new Harness({ Sheet1: { B1: 'keep', A2: 'drop' } });
    h.apply(mergeCells(h.sheet(), R('A1:B2'), 'center'));
    expect(h.get('A1')).toBe('keep');
    expect(h.get('A2')).toBe(null);
    expect(mergeAt(h.sheet(), 1, 1)).toEqual(R('A1:B2'));
    h.apply(unmergeCells(h.sheet(), [R('A1')]));
    expect(h.sheet().merges).toEqual([]);
  });
  it('finds the current region', () => {
    const h = new Harness({ Sheet1: { A1: 1, B1: 2, A2: 3, B3: 4, E9: 5 } });
    expect(currentRegion(h.sheet(), 0, 0)).toEqual(R('A1:B3'));
  });
});

describe('autofill', () => {
  const fill = (cells: Record<string, string | number>, src: string, dst: string, opts = {}): Harness => {
    const h = new Harness({ Sheet1: cells });
    h.apply(fillRange(h.sheet(), R(src), R(dst), opts));
    return h;
  };
  it('continues number steps', () => {
    const h = fill({ A1: 2, A2: 4 }, 'A1:A2', 'A1:A5');
    expect([h.get('A3'), h.get('A4'), h.get('A5')]).toEqual([6, 8, 10]);
  });
  it('copies a single number, or increments on request', () => {
    expect(fill({ A1: 7 }, 'A1', 'A1:A3').get('A3')).toBe(7);
    expect(fill({ A1: 7 }, 'A1', 'A1:A3', { increment: true }).get('A3')).toBe(9);
  });
  it('fills upward and leftward', () => {
    expect(fill({ A4: 10, A5: 12 }, 'A4:A5', 'A2:A5').get('A2')).toBe(6);
    expect(fill({ C1: 'Mar' }, 'C1', 'A1:C1').get('A1')).toBe('Jan');
  });
  it('knows months, weekdays, quarters and numbered text', () => {
    expect(fill({ A1: 'Nov' }, 'A1', 'A1:A3').get('A3')).toBe('Jan');
    expect(fill({ A1: 'Monday' }, 'A1', 'A1:A2').get('A2')).toBe('Tuesday');
    expect(fill({ A1: 'Q3' }, 'A1', 'A1:A3').get('A3')).toBe('Q1');
    expect(fill({ A1: 'Item 09' }, 'A1', 'A1:A2').get('A2')).toBe('Item 10');
  });
  it('steps dates by day or month', () => {
    expect(fill({ A1: '1/30/2026' }, 'A1', 'A1:A3').get('A3')).toBe(dateToSerial(2026, 2, 1));
    expect(fill({ A1: '1/31/2026', A2: '2/28/2026' }, 'A1:A2', 'A1:A4').get('A3')).toBe(dateToSerial(2026, 3, 31));
  });
  it('adjusts formulas and repeats patterns', () => {
    const h = fill({ A1: 1, A2: 2, A3: 3, B1: '=A1*2' }, 'B1', 'B1:B3');
    expect(h.formula('B3')).toBe('=A3*2');
    expect(fill({ A1: 'x', A2: 'y' }, 'A1:A2', 'A1:A4').get('A4')).toBe('y');
  });
});

describe('sorting and filtering', () => {
  const data = { A1: 'Item', B1: 'Qty', C1: 'Double', A2: 'pear', B2: 3, C2: '=B2*2', A3: 'Apple', B3: 10, C3: '=B3*2', A4: 'fig', C4: '=B4*2', A5: 'kiwi', B5: 7, C5: '=B5*2' };
  it('sorts rows, keeps formulas relative, and puts blanks last', () => {
    const h = new Harness({ Sheet1: data });
    h.apply(sortRange(h.sheet(), h.engine, R('A1:C5'), [{ col: 1, descending: true, by: 'value' }], true));
    expect(['A2', 'A3', 'A4', 'A5'].map((a) => h.get(a))).toEqual(['Apple', 'kiwi', 'pear', 'fig']);
    expect(h.formula('C2')).toBe('=B2*2');
    expect(h.get('C2')).toBe(20);
    h.undo();
    expect(h.get('A2')).toBe('pear');
  });
  it('sorts by several keys without case sensitivity', () => {
    const h = new Harness({ Sheet1: { A1: 'b', B1: 2, A2: 'A', B2: 9, A3: 'B', B3: 1, A4: 'a', B4: 3 } });
    h.apply(sortRange(h.sheet(), h.engine, R('A1:B4'), [{ col: 0, descending: false, by: 'value' }, { col: 1, descending: false, by: 'value' }], false));
    expect(['B1', 'B2', 'B3', 'B4'].map((a) => h.get(a))).toEqual([3, 9, 1, 2]);
  });
  it('filters by value, condition and top N', () => {
    const h = new Harness({ Sheet1: data });
    h.apply([{ t: 'sheet', sheetId: h.sheet().id, props: { filter: { range: R('A1:C5'), criteria: {} } } }]);
    h.apply(setFilterCriterion(h.sheet(), h.engine, 0, { type: 'values', hidden: ['fig', 'pear'] }));
    expect([...h.sheet().filterHidden].sort()).toEqual([1, 3]);
    h.apply(setFilterCriterion(h.sheet(), h.engine, 0, null));
    h.apply(setFilterCriterion(h.sheet(), h.engine, 1, { type: 'condition', op: 'gt', a: '5' }));
    expect([...h.sheet().filterHidden].sort()).toEqual([1, 3]);
    expect([...computeFilterHidden(h.sheet(), h.engine, { range: R('A1:C5'), criteria: { 1: { type: 'top', count: 1 } } })]).toEqual([1, 3, 4]);
  });
  it('removes duplicates', () => {
    const h = new Harness({ Sheet1: { A1: 'a', B1: 1, A2: 'A', B2: 1, A3: 'b', B3: 2, A4: 'b', B4: 3 } });
    const res = removeDuplicates(h.sheet(), h.engine, R('A1:B4'), [0], false);
    h.apply(res.ops);
    expect([res.removed, res.kept]).toEqual([2, 2]);
    expect([h.get('A1'), h.get('A2'), h.get('A3')]).toEqual(['a', 'b', null]);
  });
  it('splits text into columns', () => {
    const h = new Harness({ Sheet1: { A1: 'x, 5, 2026-01-02' } });
    h.apply(textToColumns(h.sheet(), h.engine, R('A1'), [','], false));
    expect([h.get('A1'), h.get('B1'), h.get('C1')]).toEqual(['x', 5, dateToSerial(2026, 1, 2)]);
  });
});

describe('clipboard', () => {
  it('copies with relative references and tiles', () => {
    const h = new Harness({ Sheet1: { A1: 2, A2: 3, B1: '=A1*10' } });
    const clip = buildClip(h.sheet(), h.engine, R('B1'), false, 'x');
    h.apply(pasteClip(h.wb, clip, h.sheet(), R('B2:B3'), 'all').ops);
    expect([h.formula('B2'), h.formula('B3'), h.get('B2')]).toEqual(['=A2*10', '=A3*10', 30]);
  });
  it('pastes values, formats and transposed', () => {
    const h = new Harness({ Sheet1: { A1: 2, B1: '=A1*10' } });
    h.apply(applyStyle(h.sheet(), [R('B1')], { bold: true }));
    const clip = buildClip(h.sheet(), h.engine, R('A1:B1'), false, 'x');
    h.apply(pasteClip(h.wb, clip, h.sheet(), R('D1'), 'values').ops);
    expect([h.get('E1'), h.formula('E1'), baseStyle(h.sheet(), 0, 4)]).toEqual([20, undefined, undefined]);
    h.apply(pasteClip(h.wb, clip, h.sheet(), R('D5'), 'formats').ops);
    expect([h.get('E5'), baseStyle(h.sheet(), 4, 4)?.bold]).toEqual([null, true]);
    h.apply(pasteClip(h.wb, clip, h.sheet(), R('A9'), 'transpose').ops);
    expect([h.get('A9'), h.get('A10')]).toEqual([2, 20]);
  });
  it('cut moves cells', () => {
    const h = new Harness({ Sheet1: { A1: 2, C1: '=A1' } });
    const clip = buildClip(h.sheet(), h.engine, R('A1'), true, 'x');
    h.apply(pasteClip(h.wb, clip, h.sheet(), R('A5'), 'all').ops);
    expect([h.get('A1'), h.get('A5'), h.formula('C1')]).toEqual([null, 2, '=A5']);
  });
  it('reads and writes tab-separated text', () => {
    expect(parseTsv('a\t"b\n""c"""\r\n1\t2\n')).toEqual([['a', 'b\n"c"'], ['1', '2']]);
    const h = new Harness({ Sheet1: { A1: 'x', B1: 1234 } });
    h.apply(applyStyle(h.sheet(), [R('B1')], { numFmt: '#,##0' }));
    expect(clipToText(buildClip(h.sheet(), h.engine, R('A1:B1'), false, 'x'))).toBe('x\t1,234');
  });
});

describe('find and replace', () => {
  const base: FindOptions = { query: '', matchCase: false, wholeCell: false, regex: false, formulas: false, scope: 'sheet' };
  it('finds displayed values and replaces text', () => {
    const h = new Harness({ Sheet1: { A1: 'North', A2: 'northwest', B1: '=LEN("north")' }, Two: { A1: 'North' } });
    const id = h.sheet().id;
    expect(findAll(h.wb, h.engine, id, [], { ...base, query: 'north' })).toHaveLength(2);
    expect(findAll(h.wb, h.engine, id, [], { ...base, query: 'north', scope: 'workbook' })).toHaveLength(3);
    expect(findAll(h.wb, h.engine, id, [], { ...base, query: 'North', matchCase: true })).toHaveLength(1);
    expect(findAll(h.wb, h.engine, id, [], { ...base, query: 'north', wholeCell: true })).toHaveLength(1);
    expect(findAll(h.wb, h.engine, id, [], { ...base, query: 'north', formulas: true })).toHaveLength(3);
    const o = { ...base, query: 'north' };
    const res = replaceHits(h.wb, findAll(h.wb, h.engine, id, [], o), o, 'South');
    h.apply(res.ops);
    expect([res.count, h.get('A1'), h.get('A2')]).toEqual([2, 'South', 'Southwest']);
  });
  it('supports regular expressions and ignores invalid ones', () => {
    const h = new Harness({ Sheet1: { A1: 'SKU-12' } });
    const o = { ...base, query: '(\\w+)-(\\d+)', regex: true };
    h.apply(replaceHits(h.wb, findAll(h.wb, h.engine, h.sheet().id, [], o), o, '$2/$1').ops);
    expect(h.get('A1')).toBe('12/SKU');
    expect(findAll(h.wb, h.engine, h.sheet().id, [], { ...base, query: '(', regex: true })).toEqual([]);
  });
});

describe('conditional formatting', () => {
  const run = (cells: Record<string, string | number>, kind: ConditionalRule['kind'], at: string, range = 'A1:A5') => {
    const h = new Harness({ Sheet1: cells });
    const rule: ConditionalRule = { id: 'r', ranges: [R(range)], kind, style: { fill: '#ff0000' } };
    h.apply([{ t: 'sheet', sheetId: h.sheet().id, props: { conditional: [rule] } }]);
    const p = R(at);
    return new ConditionalEvaluator(h.sheet(), h.engine).evaluate(p.r1, p.c1, h.sheet());
  };
  const nums = { A1: 10, A2: 20, A3: 30, A4: 20, A5: 'Late order' };
  it.each([
    ['greater than', { type: 'compare', op: 'gt', a: '15' }, 'A2', true],
    ['not greater than', { type: 'compare', op: 'gt', a: '15' }, 'A1', false],
    ['less than', { type: 'compare', op: 'lt', a: '15' }, 'A1', true],
    ['equal', { type: 'compare', op: 'eq', a: '30' }, 'A3', true],
    ['between', { type: 'compare', op: 'between', a: '15', b: '25' }, 'A2', true],
    ['text never exceeds a number', { type: 'compare', op: 'gt', a: '15' }, 'A5', false],
    ['contains text', { type: 'text', op: 'contains', text: 'late' }, 'A5', true],
    ['duplicate', { type: 'duplicate' }, 'A4', true],
    ['unique', { type: 'duplicate', unique: true }, 'A1', true],
    ['top 1', { type: 'rank', count: 1 }, 'A3', true],
    ['bottom 1', { type: 'rank', count: 1, bottom: true }, 'A1', true],
    ['above average', { type: 'average' }, 'A3', true],
    ['formula', { type: 'formula', formula: '=A1>=$A$3' }, 'A3', true],
    ['relative formula', { type: 'formula', formula: '=A1>=$A$3' }, 'A2', false],
  ] as [string, ConditionalRule['kind'], string, boolean][])('%s', (_n, kind, at, hit) => {
    expect(Boolean(run(nums, kind, at)?.style?.fill)).toBe(hit);
  });
  it('computes scales and bars', () => {
    expect(run(nums, { type: 'scale', colors: ['#000000', '#ffffff'] }, 'A1')?.style?.fill).toBe('#000000');
    expect(run(nums, { type: 'bar', color: '#00f' }, 'A3')?.bar).toMatchObject({ from: 0, to: 1 });
    expect(run(nums, { type: 'icons', set: 'arrows' }, 'A3')?.icon?.level).toBe(2);
  });
});

describe('data validation', () => {
  const rule = (kind: ValidationRule['kind'], required = false): ValidationRule => ({ id: 'v', range: R('A1:A9'), kind, required, errorStyle: 'stop' });
  const h = new Harness({ Sheet1: { D1: 'Red', D2: 'Blue', D3: 'Red' } });
  const ok = (r: ValidationRule, v: string | number | null): boolean => isValid(r, v, h.sheet(), h.engine, 0, 0);
  it('checks each rule type', () => {
    expect(ok(rule({ type: 'list', source: 'Yes, No' }), 'yes')).toBe(true);
    expect(ok(rule({ type: 'list', source: 'Yes, No' }), 'maybe')).toBe(false);
    expect(ok(rule({ type: 'list', source: '=$D$1:$D$3' }), 'Blue')).toBe(true);
    expect(listOptions(rule({ type: 'list', source: '=$D$1:$D$3' }), h.sheet(), h.engine)).toEqual(['Red', 'Blue']);
    expect(ok(rule({ type: 'whole', op: 'between', a: '1', b: '10' }), 5)).toBe(true);
    expect(ok(rule({ type: 'whole', op: 'between', a: '1', b: '10' }), 5.5)).toBe(false);
    expect(ok(rule({ type: 'decimal', op: 'lte', a: '2' }), 2.1)).toBe(false);
    expect(ok(rule({ type: 'date', op: 'gte', a: '2026-01-01' }), dateToSerial(2026, 5, 1))).toBe(true);
    expect(ok(rule({ type: 'textLength', op: 'lte', a: '3' }), 'four')).toBe(false);
    expect(ok(rule({ type: 'custom', formula: '=LEN(D1)=3' }), 'x')).toBe(true);
    expect(ok(rule({ type: 'any' }, true), null)).toBe(false);
    expect(ok(rule({ type: 'any' }), null)).toBe(true);
  });
});

describe('storage key', () => {
  it('never collides', () => {
    expect(cellKey(1, 0)).not.toBe(cellKey(0, 1023));
  });
});
