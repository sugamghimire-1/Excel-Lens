import { parseCellName, splitSheetRef, cellKey } from '@/engine/address';
import { cellFromInput } from '@/engine/commands/cells';
import { applyOps } from '@/engine/ops';
import { createSheet, createWorkbook } from '@/engine/sheet';
import { CalcEngine } from '@/formulas';
import { CellError, type Op, type Sheet, type Workbook } from '@/types';

export type Literal = string | number | boolean | null;

/** A workbook with an engine, driven the way the app drives it. */
export class Harness {
  wb: Workbook;
  engine: CalcEngine;
  private undoStack: Op[][] = [];

  constructor(sheets: Record<string, Record<string, Literal>> = { Sheet1: {} }) {
    this.wb = createWorkbook('Test', Object.keys(sheets).map((name) => createSheet(name)));
    for (const [name, cells] of Object.entries(sheets)) {
      const sheet = this.sheet(name);
      for (const [addr, v] of Object.entries(cells)) {
        const p = parseCellName(addr)!;
        const cell = cellFromInput(sheet, p.r, p.c, v === null ? '' : String(v));
        if (cell) sheet.cells.set(cellKey(p.r, p.c), cell);
      }
    }
    this.engine = new CalcEngine(this.wb);
  }

  sheet(name = this.wb.sheets[0].name): Sheet {
    return this.wb.sheets.find((s) => s.name === name)!;
  }

  apply(ops: Op[]): void {
    const res = applyOps(this.wb, ops);
    this.wb = res.workbook;
    this.undoStack.push(res.inverse);
    if (res.structural) this.engine.rebuild(this.wb);
    else {
      this.engine.applyChanges(this.wb, [...res.changed].map(([sheetId, keys]) => ({ sheetId, keys })));
      if (res.visibility) this.engine.visibilityChanged(this.wb);
    }
  }

  undo(): void {
    const inverse = this.undoStack.pop();
    if (!inverse) throw new Error('nothing to undo');
    this.apply(inverse);
    this.undoStack.pop();
  }

  set(ref: string, raw: string): void {
    const { sheet, local } = splitSheetRef(ref);
    const s = this.sheet(sheet ?? undefined);
    const p = parseCellName(local)!;
    this.apply([{ t: 'cells', sheetId: s.id, set: [[cellKey(p.r, p.c), cellFromInput(s, p.r, p.c, raw)]] }]);
  }

  /** Computed value; errors are returned as their code. */
  get(ref: string): Literal {
    const { sheet, local } = splitSheetRef(ref);
    const p = parseCellName(local)!;
    const v = this.engine.getValue(this.sheet(sheet ?? undefined).id, p.r, p.c);
    return v instanceof CellError ? v.code : v;
  }

  formula(ref: string): string | undefined {
    const { sheet, local } = splitSheetRef(ref);
    const p = parseCellName(local)!;
    return this.sheet(sheet ?? undefined).cells.get(cellKey(p.r, p.c))?.f;
  }
}

/** Evaluates one formula against optional cell data. */
export function calc(formula: string, cells: Record<string, Literal> = {}): Literal {
  const h = new Harness({ Sheet1: { ...cells, ZZ1: formula } });
  return h.get('ZZ1');
}
