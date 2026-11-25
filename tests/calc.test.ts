import { describe, expect, it } from 'vitest';
import { cellKey } from '@/engine/address';
import { applyOps } from '@/engine/ops';
import { createSheet, createWorkbook } from '@/engine/sheet';
import { CalcEngine } from '@/formulas';
import type { Cell } from '@/types';
import { Harness } from './helpers';

describe('recalculation', () => {
  it('updates dependents transitively', () => {
    const h = new Harness({ Sheet1: { A1: 2, A2: '=A1*10', A3: '=A2+1', A4: '=SUM(A1:A3)' } });
    expect(h.get('A4')).toBe(43);
    h.set('A1', '5');
    expect([h.get('A2'), h.get('A3'), h.get('A4')]).toEqual([50, 51, 106]);
  });

  it('works across sheets, including quoted names', () => {
    const h = new Harness({ Sheet1: { A1: "='Q1 Data'!B2*2", A2: '=SUM(Sheet3!A1:A2)' }, 'Q1 Data': { B2: 21 }, Sheet3: { A1: 1, A2: 2 } });
    expect(h.get('A1')).toBe(42);
    expect(h.get('A2')).toBe(3);
    h.set("'Q1 Data'!B2", '5');
    expect(h.get('A1')).toBe(10);
  });

  it('detects direct and indirect cycles and recovers', () => {
    const h = new Harness({ Sheet1: { A1: '=B1+1', B1: '=A1+1', C1: '=C1' } });
    expect(h.get('A1')).toBe('#CIRC!');
    expect(h.get('C1')).toBe('#CIRC!');
    h.set('B1', '1');
    expect(h.get('A1')).toBe(2);
  });

  it('treats blank references as zero or empty text', () => {
    const h = new Harness({ Sheet1: { A1: '=B1', A2: '=B1&"x"', A3: '=B1+1', A4: '=B1=""' } });
    expect([h.get('A1'), h.get('A2'), h.get('A3'), h.get('A4')]).toEqual([0, 'x', 1, true]);
  });

  it('resolves defined names', () => {
    const h = new Harness({ Sheet1: { A1: 10, A2: 20, B1: '=SUM(Sales)*Rate' } });
    expect(h.get('B1')).toBe('#NAME?');
    h.apply([{ t: 'workbook', props: { names: [{ name: 'Sales', ref: 'Sheet1!$A$1:$A$2' }, { name: 'Rate', ref: '0.5' }] } }]);
    expect(h.get('B1')).toBe(15);
    h.set('A1', '30');
    expect(h.get('B1')).toBe(25);
  });

  it('defers work in manual mode', () => {
    const h = new Harness({ Sheet1: { A1: 1, A2: '=A1+1' } });
    h.engine.mode = 'manual';
    h.set('A1', '10');
    expect(h.get('A2')).toBe(2);
    expect(h.engine.hasPending).toBe(true);
    h.engine.calculateNow();
    expect(h.get('A2')).toBe(11);
  });

  it('SUBTOTAL ignores hidden rows and nested subtotals', () => {
    const h = new Harness({ Sheet1: { A1: 1, A2: 2, A3: 3, A4: '=SUBTOTAL(9,A1:A3)', A5: '=SUBTOTAL(9,A1:A4)' } });
    expect([h.get('A4'), h.get('A5')]).toEqual([6, 6]);
    h.apply([{ t: 'sheet', sheetId: h.sheet().id, props: { filterHidden: new Set([1]) } }]);
    expect(h.get('A4')).toBe(4);
  });

  it('reports precedents and dependents', () => {
    const h = new Harness({ Sheet1: { A1: 1, B1: '=A1+SUM(A1:A9)', C1: '=B1' } });
    const id = h.sheet().id;
    expect(h.engine.precedents(id, 0, 1)).toHaveLength(2);
    expect(h.engine.dependentsOf(id, 0, 1)).toEqual([{ sheetId: id, r: 0, c: 2 }]);
  });

  it('handles very long dependency chains without overflowing the stack', () => {
    const cells = new Map<number, Cell>();
    cells.set(cellKey(0, 0), { v: 1 });
    for (let r = 1; r < 20_000; r++) cells.set(cellKey(r, 0), { f: `=A${r}+1` });
    const wb = createWorkbook('Big', [createSheet('Sheet1', { cells })]);
    const engine = new CalcEngine(wb);
    const id = wb.sheets[0].id;
    expect(engine.getValue(id, 19_999, 0)).toBe(20_000);
    const res = applyOps(wb, [{ t: 'cells', sheetId: id, set: [[cellKey(0, 0), { v: 101 }]] }]);
    engine.applyChanges(res.workbook, [...res.changed].map(([sheetId, keys]) => ({ sheetId, keys })));
    expect(engine.getValue(id, 19_999, 0)).toBe(20_100);
  });

  it('recalculates 100,000 formulas quickly', () => {
    const cells = new Map<number, Cell>();
    for (let r = 0; r < 100_000; r++) {
      cells.set(cellKey(r, 0), { v: r });
      cells.set(cellKey(r, 1), { f: `=A${r + 1}*2` });
    }
    cells.set(cellKey(0, 3), { f: '=SUM(B:B)' });
    const wb = createWorkbook('Big', [createSheet('Sheet1', { cells })]);
    const t0 = performance.now();
    const engine = new CalcEngine(wb);
    expect(engine.getValue(wb.sheets[0].id, 0, 3)).toBe(99_999 * 100_000);
    expect(performance.now() - t0).toBeLessThan(40_000);
  });
});
