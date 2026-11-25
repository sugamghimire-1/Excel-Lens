import { create } from 'zustand';
import { keyRow } from '@/engine/address';
import { autoRowHeights } from '@/engine/commands/format';
import { DEFAULT_FONT_SIZE } from '@/engine/measure';
import { applyOps, type ApplyResult } from '@/engine/ops';
import { createWorkbook, isBlankCell } from '@/engine/sheet';
import { CalcEngine } from '@/formulas';
import type { Op, SelectionState, Transaction, Workbook } from '@/types';
import { uid } from '@/utils/id';

const HISTORY_LIMIT = 200;
const FIT_ROW_LIMIT = 1500;

export type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

export interface DispatchOptions {
  /** Skip the undo history, e.g. for view settings. */
  silent?: boolean;
  before?: SelectionState | null;
  after?: SelectionState | null;
  sheetId?: string;
  /** Disable automatic row fitting. */
  noFit?: boolean;
}

interface WorkbookState {
  workbook: Workbook;
  engine: CalcEngine;
  /** Increments on every change; cheap to subscribe to. */
  revision: number;
  undoStack: Transaction[];
  redoStack: Transaction[];
  saveState: SaveState;
  savedAt: number | null;
  ready: boolean;
  dispatch(label: string, ops: Op[], options?: DispatchOptions): boolean;
  undo(): Transaction | null;
  redo(): Transaction | null;
  load(workbook: Workbook): void;
  setSaveState(state: SaveState): void;
  touch(): void;
}

type TransactionListener = (tx: Transaction, origin: 'local' | 'undo' | 'redo') => void;
const listeners = new Set<TransactionListener>();

/**
 * Observes every committed transaction. A collaboration transport subscribes
 * here to broadcast local operations, and calls `dispatch` for remote ones.
 */
export function onTransaction(fn: TransactionListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function recalc(engine: CalcEngine, res: ApplyResult): void {
  if (res.structural) {
    engine.rebuild(res.workbook);
    return;
  }
  if (res.changed.size) {
    engine.applyChanges(res.workbook, [...res.changed].map(([sheetId, keys]) => ({ sheetId, keys })));
  } else engine.sync(res.workbook);
  if (res.visibility) engine.visibilityChanged(res.workbook);
}

/** Rows whose height may need to change because of these operations. */
function fitOps(wb: Workbook, engine: CalcEngine, ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    if (op.t !== 'cells') continue;
    const sheet = wb.sheets.find((s) => s.id === op.sheetId);
    if (!sheet) continue;
    const rows = new Set<number>();
    for (const [key, cell] of op.set) {
      const r = keyRow(key);
      const tall = cell !== null && (cell.s?.wrap === true || ((cell.s?.fontSize ?? DEFAULT_FONT_SIZE) !== DEFAULT_FONT_SIZE && !isBlankCell(cell)));
      if (tall || (sheet.rows.get(r)?.size !== undefined && !sheet.rows.get(r)?.custom)) rows.add(r);
      if (rows.size > FIT_ROW_LIMIT) break;
    }
    if (rows.size && rows.size <= FIT_ROW_LIMIT) out.push(...autoRowHeights(sheet, engine, rows));
  }
  return out;
}

const initial = createWorkbook('Untitled workbook');

export const useWorkbook = create<WorkbookState>((set, get) => ({
  workbook: initial,
  engine: new CalcEngine(initial),
  revision: 0,
  undoStack: [],
  redoStack: [],
  saveState: 'saved',
  savedAt: null,
  ready: false,

  dispatch(label, ops, options = {}) {
    if (!ops.length) return false;
    const { workbook, engine, undoStack, revision } = get();
    const res = applyOps(workbook, ops);
    recalc(engine, res);
    let next = res.workbook;
    let applied = ops;
    let { inverse } = res;
    if (!options.noFit) {
      const fit = fitOps(next, engine, ops);
      if (fit.length) {
        const fitted = applyOps(next, fit);
        engine.sync(fitted.workbook);
        next = fitted.workbook;
        applied = [...ops, ...fit];
        inverse = [...fitted.inverse, ...inverse];
      }
    }
    const tx: Transaction = {
      id: uid('tx'),
      label,
      at: Date.now(),
      ops: applied,
      inverse,
      sheetId: options.sheetId ?? '',
      before: options.before ?? null,
      after: options.after ?? null,
    };
    set({
      workbook: next,
      revision: revision + 1,
      saveState: 'unsaved',
      ...(options.silent ? {} : { undoStack: [...undoStack.slice(-HISTORY_LIMIT + 1), tx], redoStack: [] }),
    });
    for (const fn of listeners) fn(tx, 'local');
    return true;
  },

  undo() {
    const { undoStack, redoStack, workbook, engine, revision } = get();
    const tx = undoStack[undoStack.length - 1];
    if (!tx) return null;
    const res = applyOps(workbook, tx.inverse);
    recalc(engine, res);
    set({
      workbook: res.workbook,
      revision: revision + 1,
      saveState: 'unsaved',
      undoStack: undoStack.slice(0, -1),
      redoStack: [...redoStack, tx],
    });
    for (const fn of listeners) fn(tx, 'undo');
    return tx;
  },

  redo() {
    const { undoStack, redoStack, workbook, engine, revision } = get();
    const tx = redoStack[redoStack.length - 1];
    if (!tx) return null;
    const res = applyOps(workbook, tx.ops);
    recalc(engine, res);
    set({
      workbook: res.workbook,
      revision: revision + 1,
      saveState: 'unsaved',
      undoStack: [...undoStack, { ...tx, inverse: res.inverse }],
      redoStack: redoStack.slice(0, -1),
    });
    for (const fn of listeners) fn(tx, 'redo');
    return tx;
  },

  load(workbook) {
    set((s) => ({
      workbook,
      engine: new CalcEngine(workbook),
      revision: s.revision + 1,
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      savedAt: null,
      ready: true,
    }));
  },

  setSaveState(saveState) {
    set(saveState === 'saved' ? { saveState, savedAt: Date.now() } : { saveState });
  },

  touch() {
    set((s) => ({ revision: s.revision + 1 }));
  },
}));
