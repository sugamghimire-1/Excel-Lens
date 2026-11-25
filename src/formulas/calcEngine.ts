import { cellKey, keyCol, keyRow, MAX_COLS, MAX_ROWS } from '@/engine/address';
import type { Range, Sheet, Workbook } from '@/types';
import { deref, evaluate, type CalcContext, type EvalScope } from './evaluator';
import { parseFormula, walkAst, type Ast } from './parser';
import { getFunction } from './registry';
import { ERR, isError, Matrix, type Scalar } from './values';

const enum State {
  Clean,
  Dirty,
  Computing,
}

interface FormulaNode {
  sheetId: string;
  key: number;
  r: number;
  c: number;
  source: string;
  ast: Ast | null;
  value: Scalar;
  state: State;
  volatile: boolean;
  usesVisibility: boolean;
  spill: Matrix | null;
  cellDeps: { sheet: SheetCalc; key: number }[];
  rangeDeps: { sheet: SheetCalc; entry: RangeEntry }[];
}

interface RangeEntry extends Range {
  id: string;
  nodes: Set<FormulaNode>;
  buckets: number[] | null;
}

const ROW_SHIFT = 6;
const COL_SHIFT = 4;
const COL_BUCKETS = MAX_COLS >> COL_SHIFT;
const MAX_BUCKETS = 64;

/** Finds the formulas that read a range containing a given cell. */
class RangeIndex {
  private readonly entries = new Map<string, RangeEntry>();
  private readonly buckets = new Map<number, Set<RangeEntry>>();
  private readonly large = new Set<RangeEntry>();

  add(range: Range, node: FormulaNode): RangeEntry {
    const id = `${range.r1}:${range.c1}:${range.r2}:${range.c2}`;
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { ...range, id, nodes: new Set(), buckets: null };
      this.entries.set(id, entry);
      const br1 = range.r1 >> ROW_SHIFT;
      const br2 = range.r2 >> ROW_SHIFT;
      const bc1 = range.c1 >> COL_SHIFT;
      const bc2 = range.c2 >> COL_SHIFT;
      if ((br2 - br1 + 1) * (bc2 - bc1 + 1) > MAX_BUCKETS) this.large.add(entry);
      else {
        entry.buckets = [];
        for (let br = br1; br <= br2; br++) {
          for (let bc = bc1; bc <= bc2; bc++) {
            const b = br * COL_BUCKETS + bc;
            entry.buckets.push(b);
            let set = this.buckets.get(b);
            if (!set) this.buckets.set(b, (set = new Set()));
            set.add(entry);
          }
        }
      }
    }
    entry.nodes.add(node);
    return entry;
  }

  remove(entry: RangeEntry, node: FormulaNode): void {
    entry.nodes.delete(node);
    if (entry.nodes.size > 0) return;
    this.entries.delete(entry.id);
    if (!entry.buckets) this.large.delete(entry);
    else for (const b of entry.buckets) this.buckets.get(b)?.delete(entry);
  }

  query(r: number, c: number, visit: (node: FormulaNode) => void): void {
    const bucket = this.buckets.get((r >> ROW_SHIFT) * COL_BUCKETS + (c >> COL_SHIFT));
    if (bucket) for (const e of bucket) if (r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) e.nodes.forEach(visit);
    for (const e of this.large) if (r >= e.r1 && r <= e.r2 && c >= e.c1 && c <= e.c2) e.nodes.forEach(visit);
  }
}

class SheetCalc {
  readonly nodes = new Map<number, FormulaNode>();
  readonly dependents = new Map<number, Set<FormulaNode>>();
  readonly ranges = new RangeIndex();
  /** Non-anchor cells covered by a dynamic array. */
  readonly spills = new Map<number, FormulaNode>();
  readonly blocked = new Set<FormulaNode>();
  maxR = -1;
  maxC = -1;
  constructor(public sheet: Sheet) {}
}

export interface CellChange {
  sheetId: string;
  keys: Iterable<number>;
}

const MAX_SPILL_PASSES = 12;

/**
 * Incremental recalculation engine. Formulas register the cells and ranges they
 * read; a change marks its transitive dependents dirty and re-evaluates them in
 * topological order.
 */
export class CalcEngine implements CalcContext {
  private sheets = new Map<string, SheetCalc>();
  private byName = new Map<string, string>();
  private volatiles = new Set<FormulaNode>();
  private pending: { sheetId: string; key: number }[] = [];
  private workbook: Workbook;
  /** Increments whenever any computed value may have changed. */
  version = 0;
  mode: 'auto' | 'manual' = 'auto';
  /** Overridable clock, used by tests. */
  clock: () => Date = () => new Date();

  constructor(workbook: Workbook) {
    this.workbook = workbook;
    this.rebuild(workbook);
  }

  /* ------------------------------------------------------ public interface */

  /** Discards all state and recalculates the whole workbook. */
  rebuild(workbook: Workbook): void {
    this.workbook = workbook;
    this.sheets.clear();
    this.byName.clear();
    this.volatiles.clear();
    this.pending = [];
    for (const sheet of workbook.sheets) {
      this.sheets.set(sheet.id, new SheetCalc(sheet));
      this.byName.set(sheet.name.toLowerCase(), sheet.id);
    }
    const all: FormulaNode[] = [];
    for (const sc of this.sheets.values()) {
      for (const [key, cell] of sc.sheet.cells) {
        this.growUsed(sc, key);
        if (cell.f !== undefined) all.push(this.createNode(sc, key, cell.f));
      }
    }
    this.recalculate([], all);
    this.version++;
  }

  /** Points the engine at new sheet objects without recalculating. */
  sync(workbook: Workbook): void {
    this.workbook = workbook;
    for (const sheet of workbook.sheets) {
      const sc = this.sheets.get(sheet.id);
      if (sc) sc.sheet = sheet;
    }
  }

  /** Recalculates after cell values or formulas changed. */
  applyChanges(workbook: Workbook, changes: CellChange[]): void {
    this.sync(workbook);
    const seeds: { sheetId: string; key: number }[] = [];
    const extra = new Set<FormulaNode>();
    for (const change of changes) {
      const sc = this.sheets.get(change.sheetId);
      if (!sc) continue;
      let freed = false;
      for (const key of change.keys) {
        const cell = sc.sheet.cells.get(key);
        const existing = sc.nodes.get(key);
        if (cell) this.growUsed(sc, key);
        if (existing && existing.source !== cell?.f) {
          for (const k of this.clearSpill(sc, existing)) seeds.push({ sheetId: sc.sheet.id, key: k });
          this.removeNode(sc, existing);
        }
        if (cell?.f !== undefined) {
          const node = sc.nodes.get(key) ?? this.createNode(sc, key, cell.f);
          extra.add(node);
        }
        const covering = sc.spills.get(key);
        if (covering) {
          for (const k of this.clearSpill(sc, covering)) seeds.push({ sheetId: sc.sheet.id, key: k });
          extra.add(covering);
        }
        seeds.push({ sheetId: sc.sheet.id, key });
        freed = true;
      }
      if (freed) for (const node of sc.blocked) extra.add(node);
    }
    if (this.mode === 'manual') {
      this.pending.push(...seeds);
      for (const node of extra) if (node.state !== State.Computing) this.compute(node);
    } else {
      this.recalculate(seeds, [...extra]);
    }
    this.version++;
  }

  /** Runs any deferred work and refreshes volatile functions. */
  calculateNow(): void {
    const seeds = this.pending;
    this.pending = [];
    const extra: FormulaNode[] = [];
    if (seeds.length) for (const sc of this.sheets.values()) for (const n of sc.nodes.values()) extra.push(n);
    this.recalculate(seeds, extra);
    this.version++;
  }

  get hasPending(): boolean {
    return this.pending.length > 0;
  }

  /** Re-evaluates formulas that depend on row visibility, such as SUBTOTAL. */
  visibilityChanged(workbook: Workbook): void {
    this.sync(workbook);
    const extra: FormulaNode[] = [];
    for (const sc of this.sheets.values()) for (const n of sc.nodes.values()) if (n.usesVisibility) extra.push(n);
    if (extra.length) this.recalculate([], extra);
    this.version++;
  }

  getValue(sheetId: string, r: number, c: number): Scalar {
    return this.readCell(sheetId, r, c);
  }

  /** Evaluates a formula in the context of a cell without storing it. */
  evaluateFormula(sheetId: string, r: number, c: number, formula: string, dr = 0, dc = 0): Scalar | Matrix {
    let ast: Ast;
    try {
      ast = parseFormula(formula);
    } catch {
      return ERR.NAME;
    }
    return deref(evaluate(ast, { ctx: this, sheetId, r, c, dr, dc }), this);
  }

  /** The dynamic array that covers a cell, if any. */
  spillAt(sheetId: string, r: number, c: number): { anchor: { r: number; c: number }; range: Range } | null {
    const sc = this.sheets.get(sheetId);
    if (!sc) return null;
    const key = cellKey(r, c);
    const node = sc.spills.get(key) ?? sc.nodes.get(key);
    if (!node?.spill) return null;
    return {
      anchor: { r: node.r, c: node.c },
      range: { r1: node.r, c1: node.c, r2: node.r + node.spill.h - 1, c2: node.c + node.spill.w - 1 },
    };
  }

  isSpilled(sheetId: string, r: number, c: number): boolean {
    return this.sheets.get(sheetId)?.spills.has(cellKey(r, c)) ?? false;
  }

  /** Cells and ranges a formula cell reads directly. */
  precedents(sheetId: string, r: number, c: number): { sheetId: string; range: Range }[] {
    const node = this.sheets.get(sheetId)?.nodes.get(cellKey(r, c));
    if (!node) return [];
    return [
      ...node.cellDeps.map((d) => ({
        sheetId: d.sheet.sheet.id,
        range: { r1: keyRow(d.key), c1: keyCol(d.key), r2: keyRow(d.key), c2: keyCol(d.key) },
      })),
      ...node.rangeDeps.map((d) => ({
        sheetId: d.sheet.sheet.id,
        range: { r1: d.entry.r1, c1: d.entry.c1, r2: d.entry.r2, c2: d.entry.c2 },
      })),
    ];
  }

  /** Formula cells that read a cell directly. */
  dependentsOf(sheetId: string, r: number, c: number): { sheetId: string; r: number; c: number }[] {
    const sc = this.sheets.get(sheetId);
    if (!sc) return [];
    const out = new Set<FormulaNode>();
    this.eachDependent(sc, cellKey(r, c), (n) => out.add(n));
    return [...out].map((n) => ({ sheetId: n.sheetId, r: n.r, c: n.c }));
  }

  /* ------------------------------------------------------------ CalcContext */

  readCell(sheetId: string, r: number, c: number): Scalar {
    const sc = this.sheets.get(sheetId);
    if (!sc) return ERR.REF;
    const key = r * MAX_COLS + c;
    const cell = sc.sheet.cells.get(key);
    if (cell !== undefined) {
      if (cell.f !== undefined) {
        const node = sc.nodes.get(key);
        if (!node) return null;
        if (node.state !== State.Clean) {
          if (node.state === State.Computing) return ERR.CIRC;
          if (this.mode === 'auto') this.compute(node);
        }
        return node.value;
      }
      if (cell.v !== undefined && cell.v !== null) return cell.v;
    }
    if (sc.spills.size > 0) {
      const node = sc.spills.get(key);
      if (node?.spill) return node.spill.at(r - node.r, c - node.c) ?? 0;
    }
    return null;
  }

  sheetIdByName(name: string): string | null {
    return this.byName.get(name.toLowerCase()) ?? null;
  }

  sheetNameById(id: string): string | null {
    return this.sheets.get(id)?.sheet.name ?? null;
  }

  usedRange(sheetId: string): Range | null {
    const sc = this.sheets.get(sheetId);
    if (!sc || sc.maxR < 0) return null;
    return { r1: 0, c1: 0, r2: sc.maxR, c2: sc.maxC };
  }

  resolveName(name: string): Ast | null {
    const lower = name.toLowerCase();
    const def = this.workbook.names.find((n) => n.name.toLowerCase() === lower);
    if (!def) return null;
    try {
      return parseFormula(def.ref.startsWith('=') ? def.ref : `=${def.ref}`);
    } catch {
      return null;
    }
  }

  spillExtent(sheetId: string, r: number, c: number): { h: number; w: number } | null {
    const node = this.sheets.get(sheetId)?.nodes.get(cellKey(r, c));
    if (!node) return null;
    if (node.state === State.Dirty) this.compute(node);
    return node.spill ? { h: node.spill.h, w: node.spill.w } : null;
  }

  formulaAt(sheetId: string, r: number, c: number): string | null {
    return this.sheets.get(sheetId)?.sheet.cells.get(cellKey(r, c))?.f ?? null;
  }

  isRowHidden(sheetId: string, r: number): boolean {
    const sheet = this.sheets.get(sheetId)?.sheet;
    return sheet ? sheet.filterHidden.has(r) || sheet.rows.get(r)?.hidden === true : false;
  }

  now(): Date {
    return this.clock();
  }

  /* ------------------------------------------------------- graph upkeep */

  private growUsed(sc: SheetCalc, key: number): void {
    const r = keyRow(key);
    const c = keyCol(key);
    if (r > sc.maxR) sc.maxR = r;
    if (c > sc.maxC) sc.maxC = c;
  }

  private createNode(sc: SheetCalc, key: number, source: string): FormulaNode {
    const node: FormulaNode = {
      sheetId: sc.sheet.id,
      key,
      r: keyRow(key),
      c: keyCol(key),
      source,
      ast: null,
      value: null,
      state: State.Dirty,
      volatile: false,
      usesVisibility: false,
      spill: null,
      cellDeps: [],
      rangeDeps: [],
    };
    try {
      node.ast = parseFormula(source);
      this.registerDeps(node, node.ast, new Set());
    } catch {
      node.ast = null;
    }
    sc.nodes.set(key, node);
    if (node.volatile) this.volatiles.add(node);
    return node;
  }

  private registerDeps(node: FormulaNode, ast: Ast, seenNames: Set<string>): void {
    walkAst(ast, (n) => {
      if (n.k === 'ref') {
        const id = n.ref.sheet === null ? node.sheetId : this.sheetIdByName(n.ref.sheet);
        const target = id ? this.sheets.get(id) : undefined;
        if (!target) return;
        const { a, b } = n.ref;
        if (a.r === b.r && a.c === b.c) {
          const key = cellKey(a.r, a.c);
          let set = target.dependents.get(key);
          if (!set) target.dependents.set(key, (set = new Set()));
          if (!set.has(node)) {
            set.add(node);
            node.cellDeps.push({ sheet: target, key });
          }
        } else {
          const entry = target.ranges.add(
            { r1: Math.min(a.r, b.r), c1: Math.min(a.c, b.c), r2: Math.max(a.r, b.r), c2: Math.max(a.c, b.c) },
            node,
          );
          node.rangeDeps.push({ sheet: target, entry });
        }
      } else if (n.k === 'call') {
        const def = getFunction(n.name);
        if (def?.volatile) node.volatile = true;
        if (n.name === 'SUBTOTAL') node.usesVisibility = true;
      } else if (n.k === 'name') {
        const lower = n.name.toLowerCase();
        if (seenNames.has(lower)) return;
        seenNames.add(lower);
        const target = this.resolveName(n.name);
        if (target) this.registerDeps(node, target, seenNames);
      }
    });
  }

  private removeNode(sc: SheetCalc, node: FormulaNode): void {
    for (const d of node.cellDeps) {
      const set = d.sheet.dependents.get(d.key);
      set?.delete(node);
      if (set?.size === 0) d.sheet.dependents.delete(d.key);
    }
    for (const d of node.rangeDeps) d.sheet.ranges.remove(d.entry, node);
    sc.nodes.delete(node.key);
    sc.blocked.delete(node);
    this.volatiles.delete(node);
  }

  private eachDependent(sc: SheetCalc, key: number, visit: (node: FormulaNode) => void): void {
    sc.dependents.get(key)?.forEach(visit);
    sc.ranges.query(keyRow(key), keyCol(key), visit);
  }

  private eachNodeDependent(node: FormulaNode, visit: (n: FormulaNode) => void): void {
    const sc = this.sheets.get(node.sheetId)!;
    this.eachDependent(sc, node.key, visit);
    if (!node.spill) return;
    for (let i = 0; i < node.spill.h; i++) {
      for (let j = 0; j < node.spill.w; j++) {
        if (i || j) this.eachDependent(sc, cellKey(node.r + i, node.c + j), visit);
      }
    }
  }

  /* --------------------------------------------------------- recalculation */

  private recalculate(seeds: { sheetId: string; key: number }[], extra: FormulaNode[]): void {
    let pendingSeeds = seeds;
    let pendingNodes: FormulaNode[] = [...extra, ...this.volatiles];
    for (let pass = 0; pass < MAX_SPILL_PASSES; pass++) {
      const grown = this.runPass(pendingSeeds, pendingNodes);
      if (grown.length === 0) return;
      pendingSeeds = grown;
      pendingNodes = [];
    }
  }

  /** One dirty-propagate-evaluate cycle. Returns cells newly covered by spills. */
  private runPass(seeds: { sheetId: string; key: number }[], extra: FormulaNode[]): { sheetId: string; key: number }[] {
    const indegree = new Map<FormulaNode, number>();
    const edges = new Map<FormulaNode, FormulaNode[]>();
    const queue: FormulaNode[] = [];
    const enqueue = (n: FormulaNode): void => {
      if (indegree.has(n)) return;
      indegree.set(n, 0);
      n.state = State.Dirty;
      queue.push(n);
    };
    for (const n of extra) if (this.sheets.get(n.sheetId)?.nodes.get(n.key) === n) enqueue(n);
    for (const s of seeds) {
      const sc = this.sheets.get(s.sheetId);
      if (sc) this.eachDependent(sc, s.key, enqueue);
    }
    for (let i = 0; i < queue.length; i++) {
      const node = queue[i];
      const out = new Set<FormulaNode>();
      this.eachNodeDependent(node, (dep) => out.add(dep));
      const list = [...out];
      edges.set(node, list);
      for (const dep of list) {
        enqueue(dep);
        indegree.set(dep, indegree.get(dep)! + 1);
      }
    }

    const grown: { sheetId: string; key: number }[] = [];
    const ready = queue.filter((n) => indegree.get(n) === 0);
    for (let i = 0; i < ready.length; i++) {
      const node = ready[i];
      if (node.state === State.Dirty) this.compute(node, grown);
      for (const dep of edges.get(node)!) {
        const left = indegree.get(dep)! - 1;
        indegree.set(dep, left);
        if (left === 0) ready.push(dep);
      }
    }
    if (ready.length < queue.length) {
      for (const node of queue) {
        if (indegree.get(node)! > 0) {
          node.value = ERR.CIRC;
          node.state = State.Clean;
        }
      }
    }
    return grown;
  }

  private compute(node: FormulaNode, grown?: { sheetId: string; key: number }[]): void {
    const sc = this.sheets.get(node.sheetId)!;
    node.state = State.Computing;
    let value: Scalar | Matrix;
    if (!node.ast) value = ERR.NAME;
    else {
      const scope: EvalScope = { ctx: this, sheetId: node.sheetId, r: node.r, c: node.c, dr: 0, dc: 0 };
      try {
        value = deref(evaluate(node.ast, scope), this);
      } catch (e) {
        value = isError(e) ? e : e instanceof RangeError ? ERR.CIRC : ERR.VALUE;
      }
    }
    if (value instanceof Matrix && value.h * value.w === 1) value = value.at(0, 0);
    if (value instanceof Matrix) this.spill(sc, node, value, grown);
    else {
      this.clearSpill(sc, node);
      sc.blocked.delete(node);
      node.value = value ?? 0;
    }
    node.state = State.Clean;
  }

  private spill(sc: SheetCalc, node: FormulaNode, value: Matrix, grown?: { sheetId: string; key: number }[]): void {
    const previous = node.spill;
    this.clearSpill(sc, node);
    if (!this.canSpill(sc, node, value)) {
      node.value = ERR.SPILL;
      sc.blocked.add(node);
      return;
    }
    sc.blocked.delete(node);
    node.spill = value;
    node.value = value.at(0, 0) ?? 0;
    for (let i = 0; i < value.h; i++) {
      for (let j = 0; j < value.w; j++) {
        if (i === 0 && j === 0) continue;
        const key = cellKey(node.r + i, node.c + j);
        sc.spills.set(key, node);
        this.growUsed(sc, key);
        if (grown && (!previous || i >= previous.h || j >= previous.w)) grown.push({ sheetId: node.sheetId, key });
      }
    }
  }

  private canSpill(sc: SheetCalc, node: FormulaNode, value: Matrix): boolean {
    if (node.r + value.h > MAX_ROWS || node.c + value.w > MAX_COLS) return false;
    for (let i = 0; i < value.h; i++) {
      for (let j = 0; j < value.w; j++) {
        if (i === 0 && j === 0) continue;
        const key = cellKey(node.r + i, node.c + j);
        const cell = sc.sheet.cells.get(key);
        if (cell && (cell.f !== undefined || (cell.v !== undefined && cell.v !== null))) return false;
        if (sc.spills.has(key)) return false;
      }
    }
    return true;
  }

  private clearSpill(sc: SheetCalc, node: FormulaNode): number[] {
    const { spill } = node;
    if (!spill) return [];
    const cleared: number[] = [];
    for (let i = 0; i < spill.h; i++) {
      for (let j = 0; j < spill.w; j++) {
        const key = cellKey(node.r + i, node.c + j);
        if (sc.spills.get(key) === node) {
          sc.spills.delete(key);
          cleared.push(key);
        }
      }
    }
    node.spill = null;
    return cleared;
  }
}
