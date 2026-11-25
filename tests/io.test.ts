import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cellKey, keyCol, keyRow, parseRangeName } from '@/engine/address';
import { readChartData } from '@/engine/chartData';
import { createChart } from '@/engine/commands/sheets';
import { deserializeWorkbook, isWorkbookJson, serializeWorkbook } from '@/engine/serialize';
import { createSheet, createWorkbook, internStyle } from '@/engine/sheet';
import { detectDelimiter, parseCsv, sheetFromCsv, sheetToCsv } from '@/features/io/csv';
import { decodeWorkbook, encodeWorkbook } from '@/features/io/share';
import { exportXlsx, fromFileFormula, importXlsx, toFileFormula } from '@/features/io/xlsx';
import { parseChartXml } from '@/features/io/xlsxCharts';
import { TEMPLATES } from '@/features/backstage/templates';
import { CalcEngine } from '@/formulas';
import { ERR } from '@/formulas/values';
import { IndexedDbProvider } from '@/state/storage';
import { CellError, type Range, type Workbook } from '@/types';

const R = (a: string): Range => parseRangeName(a)!;

/** A workbook that touches every feature the file formats should keep. */
function richWorkbook(): Workbook {
  const data = createSheet('Data & notes', {
    cells: new Map([
      [cellKey(0, 0), { v: 'Item', s: internStyle({ bold: true, fill: '#2457d6', color: '#ffffff', hAlign: 'center' as const }) }],
      [cellKey(0, 1), { v: 'Amount' }],
      [cellKey(1, 0), { v: 'A "quoted" <b>' }],
      [cellKey(1, 1), { v: 1234.5, s: internStyle({ numFmt: '$#,##0.00' }) }],
      [cellKey(2, 0), { v: 'B', note: { text: 'Check this', author: 'You', updated: 1 } }],
      [cellKey(2, 1), { v: 46351, s: internStyle({ numFmt: 'yyyy-mm-dd' }) }],
      [cellKey(3, 0), { v: true }],
      [cellKey(3, 1), { f: '=SUM(B2,10)*2', s: internStyle({ borderTop: { style: 'double' as const, color: '#ff0000' }, wrap: true, italic: true }) }],
      [cellKey(4, 0), { v: ERR.NA }],
      [cellKey(4, 1), { f: '=IFERROR(XLOOKUP("B",A1:A4,B1:B4),"none")' }],
      [cellKey(5, 0), { v: 'Site', link: 'https://example.com/a?b=1' }],
      [cellKey(6, 1), { f: "='Second'!A1&\"!\"" }],
      [cellKey(8, 3), { f: '=SEQUENCE(3)' }],
    ]),
    merges: [R('D1:E2')],
    frozenRows: 1,
    frozenCols: 1,
    tabColor: '#12a594',
    showGridlines: false,
    cols: new Map([
      [0, { size: 180, custom: true }],
      [5, { hidden: true }],
    ]),
    rows: new Map([[0, { size: 40, custom: true }]]),
    conditional: [
      { id: '1', ranges: [R('B2:B4')], kind: { type: 'compare', op: 'gt', a: '100' }, style: internStyle({ fill: '#fbdcda', color: '#8f1d18' }) },
      { id: '2', ranges: [R('A2:A6')], kind: { type: 'duplicate' }, style: internStyle({ fill: '#fdeec4' }) },
      { id: '3', ranges: [R('B2:B4')], kind: { type: 'bar', color: '#2457d6' } },
      { id: '4', ranges: [R('B2:B4')], kind: { type: 'scale', colors: ['#ffffff', '#2457d6'] } },
      { id: '5', ranges: [R('A2:A6')], kind: { type: 'text', op: 'contains', text: 'B' }, style: internStyle({ bold: true }) },
    ],
    validations: [
      { id: 'a', range: R('C2:C9'), kind: { type: 'list', source: 'Yes,No' }, required: true, errorStyle: 'stop', errorMessage: 'Pick one' },
      { id: 'b', range: R('D4:D6'), kind: { type: 'whole', op: 'between', a: '1', b: '9' }, required: false, errorStyle: 'warning' },
    ],
    filter: { range: R('A1:B5'), criteria: {} },
  });
  const second = createSheet('Second', { cells: new Map([[cellKey(0, 0), { v: 'Hi' }]]), hidden: false });
  const chartBase = createChart('column', data.name, R('A1:B3'), { x: 300, y: 60 }, 'Amounts');
  data.charts = [
    { ...chartBase, stacked: true, showLabels: true, legendPosition: 'top', yTitle: 'Dollars', colors: ['#ff8800'] },
    { ...chartBase, id: 'line', type: 'line', title: 'Trend', smooth: true, x: 40, y: 300 },
    { ...chartBase, id: 'pie', type: 'doughnut', title: 'Share', x: 600, y: 300 },
  ];
  const wb = createWorkbook('Rich', [data, second]);
  wb.names = [{ name: 'Amounts', ref: "'Data & notes'!$B$2:$B$4" }];
  return wb;
}

describe('serialisation', () => {
  it('round-trips a workbook through JSON', () => {
    const wb = richWorkbook();
    const back = deserializeWorkbook(JSON.parse(JSON.stringify(serializeWorkbook(wb))));
    expect(back.sheets[0].cells.get(cellKey(4, 0))?.v).toBeInstanceOf(CellError);
    expect([...back.sheets[0].cells]).toEqual([...wb.sheets[0].cells]);
    expect(back.sheets[0].charts).toEqual(wb.sheets[0].charts);
    expect(back.sheets[0].cols).toEqual(wb.sheets[0].cols);
    expect(back.names).toEqual(wb.names);
  });
  it('shares one style instance per distinct style', () => {
    const wb = richWorkbook();
    const a = deserializeWorkbook(serializeWorkbook(wb)).sheets[0].cells.get(cellKey(0, 0))?.s;
    expect(a).toBe(wb.sheets[0].cells.get(cellKey(0, 0))?.s);
  });
  it('rejects other JSON', () => {
    expect(isWorkbookJson({ sheets: [] })).toBe(false);
    expect(isWorkbookJson(null)).toBe(false);
    expect(() => deserializeWorkbook({ ...serializeWorkbook(richWorkbook()), version: 99 })).toThrow(/newer version/);
  });
  it('encodes share links', async () => {
    const wb = richWorkbook();
    const code = await encodeWorkbook(wb);
    expect(code).toMatch(/^[\w-]+$/);
    const back = await decodeWorkbook(code);
    expect(back.id).not.toBe(wb.id);
    expect(back.sheets[0].cells.size).toBe(wb.sheets[0].cells.size);
    await expect(decodeWorkbook('not-a-workbook')).rejects.toThrow();
  });
});

describe('browser storage', () => {
  it('saves, lists, loads and removes workbooks', async () => {
    const store = new IndexedDbProvider();
    const wb = richWorkbook();
    const meta = await store.save(wb);
    expect(meta.name).toBe('Rich');
    expect((await store.list()).map((m) => m.id)).toContain(wb.id);
    expect((await store.load(wb.id))?.sheets[1].name).toBe('Second');
    await store.remove(wb.id);
    expect(await store.load(wb.id)).toBe(null);
  });
});

describe('csv', () => {
  it('parses quotes, delimiters and line endings', () => {
    expect(parseCsv('a,"b ""x"", y"\r\n"line\nbreak",2\n')).toEqual([['a', 'b "x", y'], ['line\nbreak', '2']]);
    expect(parseCsv('﻿a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(detectDelimiter('a\tb\tc\n1\t2\t3')).toBe('\t');
    expect(parseCsv('a,\n,b')).toEqual([['a', ''], ['', 'b']]);
  });
  it('types values and never imports formulas', () => {
    const s = sheetFromCsv('n,p,d,f\n1,15%,2026-01-02,=CMD()', 'S');
    expect(s.cells.get(cellKey(1, 0))?.v).toBe(1);
    expect(s.cells.get(cellKey(1, 1))).toMatchObject({ v: 0.15, s: { numFmt: '0%' } });
    expect(s.cells.get(cellKey(1, 2))?.s?.numFmt).toBe('yyyy-mm-dd');
    expect(s.cells.get(cellKey(1, 3))).toEqual({ v: '=CMD()' });
  });
  it('exports displayed values', () => {
    const wb = richWorkbook();
    const csv = sheetToCsv(wb.sheets[0], new CalcEngine(wb)).split('\r\n');
    expect(csv[0].startsWith('Item,Amount')).toBe(true);
    expect(csv[1].startsWith('"A ""quoted"" <b>","$1,234.50"')).toBe(true);
    expect(csv[2]).toContain('2026-11-25');
  });
});

describe('xlsx', () => {
  it('prefixes newer functions in files and removes the prefix on import', () => {
    expect(toFileFormula('=XLOOKUP(A1,B:B,C:C)+SUM(SORT(A1:A3))')).toBe('_xlfn.XLOOKUP(A1,B:B,C:C)+SUM(_xlfn._xlws.SORT(A1:A3))');
    expect(fromFileFormula('_xlfn._xlws.SORT(A1:A3)+_xlfn.CONCAT(A1)')).toBe('=SORT(A1:A3)+CONCAT(A1)');
    expect(toFileFormula('="XLOOKUP("&A1')).toBe('"XLOOKUP("&A1');
  });

  it('round-trips values, formulas, formatting, rules and charts', async () => {
    const wb = richWorkbook();
    const engine = new CalcEngine(wb);
    const bytes = await exportXlsx(wb, engine);
    const { workbook, warnings } = await importXlsx(bytes, 'Rich');
    expect(warnings).toEqual([]);
    expect(workbook.sheets.map((s) => s.name)).toEqual(['Data & notes', 'Second']);
    const [a, b] = [wb.sheets[0], workbook.sheets[0]];
    const e2 = new CalcEngine(workbook);
    for (const key of a.cells.keys()) {
      const x = engine.readCell(a.id, keyRow(key), keyCol(key));
      const y = e2.readCell(b.id, keyRow(key), keyCol(key));
      expect(y instanceof CellError ? y.code : y, `cell ${keyRow(key)},${keyCol(key)}`).toBe(x instanceof CellError ? x.code : x);
    }
    expect(b.cells.get(cellKey(3, 1))?.f).toBe('=SUM(B2,10)*2');
    expect(b.cells.get(cellKey(4, 1))?.f).toBe('=IFERROR(XLOOKUP("B",A1:A4,B1:B4),"none")');
    expect(e2.readCell(b.id, 10, 3)).toBe(3);
    expect(b.cells.get(cellKey(0, 0))?.s).toMatchObject({ bold: true, fill: '#2457d6', color: '#ffffff', hAlign: 'center' });
    expect(b.cells.get(cellKey(3, 1))?.s).toMatchObject({ italic: true, wrap: true, borderTop: { style: 'double', color: '#ff0000' } });
    expect(b.cells.get(cellKey(1, 1))?.s?.numFmt).toBe('$#,##0.00');
    expect(b.cells.get(cellKey(2, 0))?.note?.text).toBe('Check this');
    expect(b.cells.get(cellKey(5, 0))?.link).toBe('https://example.com/a?b=1');
    expect(b.merges).toEqual([R('D1:E2')]);
    expect([b.frozenRows, b.frozenCols, b.showGridlines, b.tabColor]).toEqual([1, 1, false, '#12a594']);
    expect(b.cols.get(0)?.size).toBe(180);
    expect(b.cols.get(5)?.hidden).toBe(true);
    expect(b.rows.get(0)?.size).toBe(40);
    expect(b.conditional.map((r) => r.kind.type)).toEqual(['compare', 'duplicate', 'bar', 'scale', 'text']);
    expect(b.conditional[0].style).toMatchObject({ fill: '#fbdcda', color: '#8f1d18' });
    expect(b.validations).toHaveLength(2);
    expect(b.validations.find((v) => v.kind.type === 'list')).toMatchObject({ range: R('C2:C9'), required: true, errorMessage: 'Pick one', kind: { source: 'Yes,No' } });
    expect(b.filter?.range).toEqual(R('A1:B5'));
    expect(workbook.names).toEqual(wb.names);

    expect(b.charts.map((c) => [c.type, c.title])).toEqual([['column', 'Amounts'], ['line', 'Trend'], ['doughnut', 'Share']]);
    expect(b.charts[0]).toMatchObject({ range: "'Data & notes'!$A$1:$B$3", stacked: true, showLabels: true, yTitle: 'Dollars', colors: ['#ff8800'], seriesInRows: false, firstRowHeaders: true, firstColLabels: true });
    expect(b.charts[1].smooth).toBe(true);
    // A single series has no legend; a doughnut always does.
    expect([b.charts[0].showLegend, b.charts[2].showLegend, b.charts[2].legendPosition]).toEqual([false, true, 'bottom']);
    for (const [i, c] of b.charts.entries()) {
      expect(Math.abs(c.x - a.charts[i].x)).toBeLessThanOrEqual(2);
      expect(Math.abs(c.w - a.charts[i].w)).toBeLessThanOrEqual(2);
    }
  });

  it('rejects files that are not workbooks', async () => {
    await expect(importXlsx(new Uint8Array([1, 2, 3]), 'x')).rejects.toThrow();
  });

  it('reads chart XML written by other applications', () => {
    const chart = parseChartXml(
      `<c:chartSpace><c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Rev &amp; cost</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart><c:barDir val="bar"/><c:grouping val="stacked"/>
      <c:ser><c:tx><c:strRef><c:f>Sheet1!$A$2</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$B$1:$E$1</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$2:$E$2</c:f></c:numRef></c:val></c:ser>
      <c:ser><c:tx><c:strRef><c:f>Sheet1!$A$3</c:f></c:strRef></c:tx><c:cat><c:strRef><c:f>Sheet1!$B$1:$E$1</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>Sheet1!$B$3:$E$3</c:f></c:numRef></c:val></c:ser>
      </c:barChart></c:plotArea><c:legend><c:legendPos val="r"/></c:legend></c:chart></c:chartSpace>`,
    );
    expect(chart).toMatchObject({ type: 'bar', title: 'Rev & cost', range: 'Sheet1!$A$1:$E$3', seriesInRows: true, stacked: true, legendPosition: 'right' });
    expect(parseChartXml('<c:chartSpace/>')).toBe(null);
  });
});

describe('charts', () => {
  const wb = createWorkbook('C', [
    createSheet('S', {
      cells: new Map([
        [cellKey(0, 1), { v: 'East' }],
        [cellKey(0, 2), { v: 'West' }],
        [cellKey(1, 0), { v: 'Q1' }],
        [cellKey(2, 0), { v: 'Q2' }],
        [cellKey(1, 1), { v: 1 }],
        [cellKey(1, 2), { v: 2 }],
        [cellKey(2, 1), { f: '=B2*10' }],
        [cellKey(2, 2), { v: 4 }],
      ]),
    }),
  ]);
  const engine = new CalcEngine(wb);
  const chart = createChart('column', 'S', R('A1:C3'), { x: 0, y: 0 });
  it('reads series from columns or rows', () => {
    expect(readChartData(wb, engine, wb.sheets[0], chart)).toMatchObject({ categories: ['Q1', 'Q2'], series: [{ name: 'East', values: [1, 10] }, { name: 'West', values: [2, 4] }], error: null });
    expect(readChartData(wb, engine, wb.sheets[0], { ...chart, seriesInRows: true })).toMatchObject({ categories: ['East', 'West'], series: [{ name: 'Q1', values: [1, 2] }, { name: 'Q2', values: [10, 4] }] });
  });
  it('explains unusable ranges', () => {
    expect(readChartData(wb, engine, wb.sheets[0], { ...chart, range: 'Nope!A1:B2' }).error).toBeTruthy();
    expect(readChartData(wb, engine, wb.sheets[0], { ...chart, range: 'S!A1:A3' }).error).toBeTruthy();
  });
});

describe('templates', () => {
  it.each(TEMPLATES.map((t) => [t.name, t] as const))('%s builds without formula errors', (_name, t) => {
    const wb = t.build();
    const engine = new CalcEngine(wb);
    for (const s of wb.sheets) {
      for (const key of s.cells.keys()) {
        const v = engine.readCell(s.id, keyRow(key), keyCol(key));
        expect(v instanceof CellError ? `${s.name} ${keyRow(key)},${keyCol(key)} ${v.code}` : '').toBe('');
      }
      for (const c of s.charts) expect(readChartData(wb, engine, s, c).error).toBe(null);
    }
  });
});
