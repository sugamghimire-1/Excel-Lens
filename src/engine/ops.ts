/**
 * Applies primitive operations to a workbook. Each application reports its
 * inverse, so any list of operations can be undone, replayed or sent to a peer.
 */
import { applyStructureToFormula, dropSheetFromFormula, renameSheetInFormula, shiftRange, type StructureChange } from '@/formulas/rewrite';
import type { AxisMeta, Cell, ConditionalKind, DefinedName, Op, Sheet, Workbook } from '@/types';
import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS, quoteSheet, splitSheetRef } from './address';

export interface ApplyResult {
  workbook: Workbook;
  inverse: Op[];
  /** Cells whose value or formula changed. */
  changed: Map<string, Set<number>>;
  /** True when sheets or names changed in a way that needs a full recalculation. */
  structural: boolean;
  /** True when row visibility changed. */
  visibility: boolean;
}

/** Applies operations in order and returns the new workbook with the inverse list. */
export function applyOps(workbook: Workbook, ops: Op[]): ApplyResult {
  const result: ApplyResult = { workbook: { ...workbook, sheets: [...workbook.sheets] }, inverse: [], changed: new Map(), structural: false, visibility: false };
  for (const op of ops) result.inverse.unshift(...applyOne(result, op));
  return result;
}

function replaceSheet(wb: Workbook, sheet: Sheet): void {
  const i = wb.sheets.findIndex((s) => s.id === sheet.id);
  wb.sheets[i] = sheet;
}

function find(wb: Workbook, id: string): Sheet {
  const s = wb.sheets.find((x) => x.id === id);
  if (!s) throw new Error(`Operation targets unknown sheet ${id}`);
  return s;
}

function markChanged(result: ApplyResult, sheetId: string, key: number): void {
  let set = result.changed.get(sheetId);
  if (!set) result.changed.set(sheetId, (set = new Set()));
  set.add(key);
}

function applyOne(result: ApplyResult, op: Op): Op[] {
  const wb = result.workbook;
  switch (op.t) {
    case 'cells': {
      const sheet = find(wb, op.sheetId);
      const before: [number, Cell | null][] = [];
      for (const [key, cell] of op.set) {
        const prev = sheet.cells.get(key);
        before.push([key, prev ?? null]);
        if (cell) sheet.cells.set(key, cell);
        else sheet.cells.delete(key);
        if (prev?.f !== cell?.f || (prev?.v ?? null) !== (cell?.v ?? null)) markChanged(result, op.sheetId, key);
      }
      before.reverse();
      replaceSheet(wb, { ...sheet });
      return [{ t: 'cells', sheetId: op.sheetId, set: before }];
    }
    case 'rows':
    case 'cols': {
      const sheet = find(wb, op.sheetId);
      const next = new Map<number, AxisMeta>(op.t === 'rows' ? sheet.rows : sheet.cols);
      const before: [number, AxisMeta | null][] = [];
      for (const [index, meta] of op.set) {
        const prev = next.get(index) ?? null;
        before.push([index, prev]);
        if (meta) next.set(index, meta);
        else next.delete(index);
        if (op.t === 'rows' && (prev?.hidden ?? false) !== (meta?.hidden ?? false)) result.visibility = true;
      }
      before.reverse();
      replaceSheet(wb, op.t === 'rows' ? { ...sheet, rows: next } : { ...sheet, cols: next });
      return [{ t: op.t, sheetId: op.sheetId, set: before }];
    }
    case 'sheet': {
      const sheet = find(wb, op.sheetId);
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(op.props)) before[k] = sheet[k as keyof Sheet];
      replaceSheet(wb, { ...sheet, ...op.props });
      const inverse: Op[] = [{ t: 'sheet', sheetId: op.sheetId, props: before }];
      if (op.props.filterHidden !== undefined) result.visibility = true;
      if (op.props.name !== undefined && op.props.name !== sheet.name) {
        result.structural = true;
        const to = op.props.name;
        rewriteFormulas(result, (f) => renameSheetInFormula(f, sheet.name, to));
      }
      return inverse;
    }
    case 'addSheet': {
      wb.sheets.splice(op.index, 0, { ...op.sheet, cells: new Map(op.sheet.cells) });
      result.structural = true;
      return [{ t: 'removeSheet', sheetId: op.sheet.id }];
    }
    case 'removeSheet': {
      const index = wb.sheets.findIndex((s) => s.id === op.sheetId);
      const sheet = find(wb, op.sheetId);
      wb.sheets.splice(index, 1);
      result.structural = true;
      const touched = rewriteFormulas(result, (f) => dropSheetFromFormula(f, sheet.name));
      const inverse: Op[] = [{ t: 'addSheet', sheet, index }];
      if (touched) inverse.push(touched);
      return inverse;
    }
    case 'moveSheet': {
      const from = wb.sheets.findIndex((s) => s.id === op.sheetId);
      const [sheet] = wb.sheets.splice(from, 1);
      wb.sheets.splice(op.index, 0, sheet);
      return [{ t: 'moveSheet', sheetId: op.sheetId, index: from }];
    }
    case 'workbook': {
      const before: Record<string, unknown> = {};
      for (const k of Object.keys(op.props)) before[k] = wb[k as keyof Workbook];
      Object.assign(wb, op.props);
      if (op.props.names) result.structural = true;
      return [{ t: 'workbook', props: before }];
    }
    case 'structure': {
      const sheet = find(wb, op.sheetId);
      const change: StructureChange = { axis: op.axis, kind: op.kind, index: op.index, count: op.count };
      const snapshot: Sheet[] = wb.sheets.map((s) => ({ ...s, cells: new Map(s.cells) }));
      const names = wb.names;
      replaceSheet(wb, shiftSheet(sheet, change));
      rewriteFormulas(result, (f, own) => applyStructureToFormula(f, own, sheet.name, change));
      wb.sheets.forEach((s, i) => {
        const charts = s.charts.map((ch) => {
          const { sheet: sn, local } = splitSheetRef(ch.range);
          if ((sn ?? s.name).toLowerCase() !== sheet.name.toLowerCase()) return ch;
          const moved = applyStructureToFormula(`=${local}`, sheet.name, sheet.name, change).slice(1);
          return { ...ch, range: sn === null ? moved : `${quoteSheet(sn)}!${moved}` };
        });
        wb.sheets[i] = { ...s, charts };
      });
      result.structural = true;
      return [{ t: 'restore', sheets: snapshot, names }];
    }
    case 'restore': {
      const before: Sheet[] = wb.sheets.filter((s) => op.sheets.some((x) => x.id === s.id)).map((s) => ({ ...s, cells: new Map(s.cells) }));
      const names = wb.names;
      for (const s of op.sheets) replaceSheet(wb, { ...s, cells: new Map(s.cells) });
      wb.names = op.names;
      result.structural = true;
      return [{ t: 'restore', sheets: before, names }];
    }
  }
}

/** Rewrites every formula in the workbook; returns an op that restores the originals. */
function rewriteFormulas(result: ApplyResult, fn: (formula: string, ownSheet: string) => string): Op | null {
  const wb = result.workbook;
  const originals: Sheet[] = [];
  const names: DefinedName[] = wb.names;
  wb.sheets.forEach((sheet, i) => {
    const edits: [number, Cell][] = [];
    for (const [key, cell] of sheet.cells) {
      if (cell.f === undefined) continue;
      const next = fn(cell.f, sheet.name);
      if (next !== cell.f) edits.push([key, { ...cell, f: next }]);
    }
    const conditional = sheet.conditional.map((rule) => {
      const kind = rewriteKind(rule.kind, (f) => fn(f, sheet.name));
      return kind === rule.kind ? rule : { ...rule, kind };
    });
    const validations = sheet.validations.map((rule) => {
      const { kind } = rule;
      if (kind.type === 'list' && kind.source.startsWith('=')) return { ...rule, kind: { ...kind, source: fn(kind.source, sheet.name) } };
      if (kind.type === 'custom') return { ...rule, kind: { ...kind, formula: fn(kind.formula, sheet.name) } };
      return rule;
    });
    const metaChanged = conditional.some((r, k) => r !== sheet.conditional[k]) || validations.some((r, k) => r !== sheet.validations[k]);
    if (!edits.length && !metaChanged) return;
    originals.push({ ...sheet, cells: new Map(sheet.cells) });
    for (const [key, cell] of edits) sheet.cells.set(key, cell);
    wb.sheets[i] = { ...sheet, conditional, validations };
  });
  wb.names = wb.names.map((n) => {
    const ref = fn(`=${n.ref}`, '').slice(1);
    return ref === n.ref ? n : { ...n, ref };
  });
  return originals.length || wb.names.some((n, i) => n !== names[i]) ? { t: 'restore', sheets: originals, names } : null;
}

function rewriteKind(kind: ConditionalKind, fn: (f: string) => string): ConditionalKind {
  const formula = (t: string): string => (t.startsWith('=') ? fn(t) : t);
  if (kind.type === 'formula') {
    const next = formula(kind.formula);
    return next === kind.formula ? kind : { ...kind, formula: next };
  }
  if (kind.type === 'compare') {
    const a = formula(kind.a);
    const b = kind.b === undefined ? undefined : formula(kind.b);
    return a === kind.a && b === kind.b ? kind : { ...kind, a, b };
  }
  return kind;
}

/** Moves cells, metadata and anchored objects for an insert or delete. */
function shiftSheet(sheet: Sheet, change: StructureChange): Sheet {
  const isRow = change.axis === 'row';
  const { index, count, kind } = change;
  const end = index + count - 1;
  const max = isRow ? MAX_ROWS : MAX_COLS;

  const move = (i: number): number | null => {
    if (kind === 'insert') return i >= index ? (i + count < max ? i + count : null) : i;
    if (i >= index && i <= end) return null;
    return i > end ? i - count : i;
  };

  const cells = new Map<number, Cell>();
  for (const [key, cell] of sheet.cells) {
    const r = keyRow(key);
    const c = keyCol(key);
    const to = move(isRow ? r : c);
    if (to !== null) cells.set(isRow ? cellKey(to, c) : cellKey(r, to), cell);
  }

  const shiftAxis = (map: ReadonlyMap<number, AxisMeta>): Map<number, AxisMeta> => {
    const out = new Map<number, AxisMeta>();
    for (const [i, meta] of map) {
      const to = move(i);
      if (to !== null) out.set(to, meta);
    }
    if (kind === 'insert' && index > 0) {
      const inherit = map.get(index - 1);
      if (inherit && (inherit.size !== undefined || inherit.style)) {
        for (let k = 0; k < count; k++) out.set(index + k, { size: inherit.size, custom: inherit.custom, style: inherit.style });
      }
    }
    return out;
  };

  const shiftAll = <T extends { range: Range_ }>(items: T[]): T[] =>
    items.flatMap((item) => {
      const range = shiftRange(item.range, change);
      return range ? [{ ...item, range }] : [];
    });

  const filterRange = sheet.filter ? shiftRange(sheet.filter.range, change) : null;
  const criteria = Object.fromEntries(
    Object.entries(sheet.filter?.criteria ?? {}).flatMap(([c, crit]) => {
      const to = isRow ? Number(c) : move(Number(c));
      return to === null ? [] : [[to, crit]];
    }),
  );

  const frozenKey = isRow ? 'frozenRows' : 'frozenCols';
  let frozen = sheet[frozenKey];
  if (index < frozen) frozen = kind === 'insert' ? frozen + count : frozen - (Math.min(frozen, end + 1) - index);

  return {
    ...sheet,
    cells,
    rows: isRow ? shiftAxis(sheet.rows) : sheet.rows,
    cols: isRow ? sheet.cols : shiftAxis(sheet.cols),
    [frozenKey]: frozen,
    merges: sheet.merges.flatMap((m) => {
      const s = shiftRange(m, change);
      return s && (s.r1 !== s.r2 || s.c1 !== s.c2) ? [s] : [];
    }),
    conditional: sheet.conditional.flatMap((rule) => {
      const ranges = rule.ranges.flatMap((r) => shiftRange(r, change) ?? []);
      return ranges.length ? [{ ...rule, ranges }] : [];
    }),
    validations: shiftAll(sheet.validations),
    tables: shiftAll(sheet.tables),
    sparklines: sheet.sparklines.flatMap((s) => {
      const to = move(isRow ? s.r : s.c);
      const range = shiftRange(s.range, change);
      if (to === null || !range) return [];
      return [isRow ? { ...s, r: to, range } : { ...s, c: to, range }];
    }),
    filter: sheet.filter && filterRange ? { range: filterRange, criteria } : null,
    filterHidden: isRow && sheet.filterHidden.size ? new Set([...sheet.filterHidden].flatMap((r) => move(r) ?? [])) : filterRange ? sheet.filterHidden : new Set(),
  };
}

type Range_ = Sheet['merges'][number];
