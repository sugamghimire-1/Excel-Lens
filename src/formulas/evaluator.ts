import { MAX_COLS, MAX_ROWS } from '@/engine/address';
import { CellError, type Range } from '@/types';
import type { Ast, BinaryOp } from './parser';
import { getFunction } from './registry';
import type { RefInfo } from './tokenizer';
import {
  compareScalars,
  ERR,
  isError,
  Matrix,
  RefValue,
  scalarsEqual,
  toNumber,
  toText,
  type EvalValue,
  type Scalar,
} from './values';

/** Everything the evaluator needs to know about the surrounding workbook. */
export interface CalcContext {
  readCell(sheetId: string, r: number, c: number): Scalar;
  sheetIdByName(name: string): string | null;
  sheetNameById(id: string): string | null;
  /** Bounding box of non-empty cells, or null for an empty sheet. */
  usedRange(sheetId: string): Range | null;
  resolveName(name: string): Ast | null;
  /** Extent of the dynamic array anchored at a cell. */
  spillExtent(sheetId: string, r: number, c: number): { h: number; w: number } | null;
  formulaAt(sheetId: string, r: number, c: number): string | null;
  isRowHidden(sheetId: string, r: number): boolean;
  now(): Date;
}

export interface EvalScope {
  ctx: CalcContext;
  sheetId: string;
  r: number;
  c: number;
  /** Extra offset for relative references (conditional formats and validation). */
  dr: number;
  dc: number;
  vars?: ReadonlyMap<string, EvalValue>;
}

const MAX_MATRIX_CELLS = 4_000_000;

/* ----------------------------------------------------------- dereferencing */

/** Clips open-ended references such as A:A to the used part of the sheet. */
export function clipRef(ref: RefValue, ctx: CalcContext): RefValue {
  const openRows = ref.r2 >= MAX_ROWS - 1;
  const openCols = ref.c2 >= MAX_COLS - 1;
  if (!openRows && !openCols) return ref;
  const used = ctx.usedRange(ref.sheetId);
  const r2 = openRows ? Math.max(ref.r1, used?.r2 ?? ref.r1) : ref.r2;
  const c2 = openCols ? Math.max(ref.c1, used?.c2 ?? ref.c1) : ref.c2;
  return new RefValue(ref.sheetId, ref.r1, ref.c1, r2, c2);
}

export function refToMatrix(ref: RefValue, ctx: CalcContext): Matrix {
  const clipped = clipRef(ref, ctx);
  if (clipped.h * clipped.w > MAX_MATRIX_CELLS) return new Matrix([[ERR.NUM]]);
  const rows: Scalar[][] = new Array(clipped.h);
  for (let i = 0; i < clipped.h; i++) {
    const row: Scalar[] = new Array(clipped.w);
    for (let j = 0; j < clipped.w; j++) row[j] = ctx.readCell(clipped.sheetId, clipped.r1 + i, clipped.c1 + j);
    rows[i] = row;
  }
  return new Matrix(rows);
}

/** Resolves references: one cell becomes a scalar, larger areas become a matrix. */
export function deref(v: EvalValue, ctx: CalcContext): Scalar | Matrix {
  if (!(v instanceof RefValue)) return v;
  if (v.single) return ctx.readCell(v.sheetId, v.r1, v.c1);
  return refToMatrix(v, ctx);
}

export function toMatrix(v: EvalValue, ctx: CalcContext): Matrix {
  if (v instanceof Matrix) return v;
  if (v instanceof RefValue) return refToMatrix(v, ctx);
  return new Matrix([[v]]);
}

/** Collapses any value to a scalar using its top-left element. */
export function toScalar(v: EvalValue, ctx: CalcContext): Scalar {
  if (v instanceof RefValue) return ctx.readCell(v.sheetId, v.r1, v.c1);
  if (v instanceof Matrix) return v.at(0, 0);
  return v;
}

export function isArrayLike(v: EvalValue): v is Matrix | RefValue {
  return v instanceof Matrix || (v instanceof RefValue && !v.single);
}

/** Visits each element of a value. `inRef` tells direct arguments from referenced cells. */
export function eachValue(v: EvalValue, ctx: CalcContext, visit: (s: Scalar, inRef: boolean) => boolean | void): boolean {
  if (v instanceof RefValue) {
    const ref = clipRef(v, ctx);
    for (let r = ref.r1; r <= ref.r2; r++) {
      for (let c = ref.c1; c <= ref.c2; c++) {
        if (visit(ctx.readCell(ref.sheetId, r, c), true) === false) return false;
      }
    }
    return true;
  }
  if (v instanceof Matrix) {
    for (const row of v.rows) for (const s of row) if (visit(s, true) === false) return false;
    return true;
  }
  return visit(v, false) !== false;
}

/** Collects numbers with spreadsheet aggregate semantics. */
export function collectNumbers(args: EvalValue[], ctx: CalcContext): number[] | CellError {
  const out: number[] = [];
  let err: CellError | null = null;
  for (const a of args) {
    eachValue(a, ctx, (s, inRef) => {
      if (typeof s === 'number') out.push(s);
      else if (s instanceof CellError) {
        err = s;
        return false;
      } else if (!inRef && s !== null) {
        const n = toNumber(s);
        if (n instanceof CellError) {
          err = n;
          return false;
        }
        out.push(n);
      }
      return true;
    });
    if (err) return err;
  }
  return out;
}

/* ------------------------------------------------------------ broadcasting */

export function broadcast(values: (Scalar | Matrix)[], fn: (args: Scalar[]) => Scalar): Scalar | Matrix {
  let h = 1;
  let w = 1;
  let any = false;
  for (const v of values) {
    if (v instanceof Matrix) {
      any = true;
      h = Math.max(h, v.h);
      w = Math.max(w, v.w);
    }
  }
  if (!any) return fn(values as Scalar[]);
  const rows: Scalar[][] = new Array(h);
  const args: Scalar[] = new Array(values.length);
  for (let i = 0; i < h; i++) {
    const row: Scalar[] = new Array(w);
    for (let j = 0; j < w; j++) {
      let outside = false;
      for (let k = 0; k < values.length; k++) {
        const v = values[k];
        if (v instanceof Matrix) {
          const ri = v.h === 1 ? 0 : i;
          const ci = v.w === 1 ? 0 : j;
          if (ri >= v.h || ci >= v.w) outside = true;
          else args[k] = v.rows[ri][ci];
        } else args[k] = v;
      }
      row[j] = outside ? ERR.NA : fn(args);
    }
    rows[i] = row;
  }
  return new Matrix(rows);
}

/* --------------------------------------------------------------- operators */

function arithmetic(op: BinaryOp, a: Scalar, b: Scalar): Scalar {
  if (isError(a)) return a;
  if (isError(b)) return b;
  switch (op) {
    case '&': {
      const x = toText(a);
      const y = toText(b);
      return (x as string) + (y as string);
    }
    case '=':
      return scalarsEqual(a, b);
    case '<>':
      return !scalarsEqual(a, b);
    case '<':
      return compareScalars(a, b) < 0;
    case '>':
      return compareScalars(a, b) > 0;
    case '<=':
      return compareScalars(a, b) <= 0;
    case '>=':
      return compareScalars(a, b) >= 0;
    default:
      break;
  }
  const x = toNumber(a);
  if (isError(x)) return x;
  const y = toNumber(b);
  if (isError(y)) return y;
  switch (op) {
    case '+':
      return cleanFloat(x + y, x, y);
    case '-':
      return cleanFloat(x - y, x, y);
    case '*':
      return finite(x * y);
    case '/':
      return y === 0 ? ERR.DIV0 : finite(x / y);
    case '^':
      if (x === 0 && y === 0) return ERR.NUM;
      if (x === 0 && y < 0) return ERR.DIV0;
      return finite(x ** y);
    default:
      return ERR.VALUE;
  }
}

/** Snaps results like 0.1+0.2-0.3 to zero when they are float noise. */
function cleanFloat(result: number, x: number, y: number): Scalar {
  if (!Number.isFinite(result)) return ERR.NUM;
  if (result !== 0 && Math.abs(result) < 1e-15 * Math.max(Math.abs(x), Math.abs(y))) return 0;
  return result;
}

export function finite(n: number): Scalar {
  return Number.isFinite(n) ? n : ERR.NUM;
}

/* -------------------------------------------------------------- references */

export function resolveRef(ref: RefInfo, scope: EvalScope): RefValue | CellError {
  const sheetId = ref.sheet === null ? scope.sheetId : scope.ctx.sheetIdByName(ref.sheet);
  if (sheetId === null) return ERR.REF;
  const { dr, dc } = scope;
  const ar = ref.a.absR ? ref.a.r : ref.a.r + dr;
  const ac = ref.a.absC ? ref.a.c : ref.a.c + dc;
  const br = ref.b.absR ? ref.b.r : ref.b.r + dr;
  const bc = ref.b.absC ? ref.b.c : ref.b.c + dc;
  const r1 = Math.min(ar, br);
  const r2 = Math.max(ar, br);
  const c1 = Math.min(ac, bc);
  const c2 = Math.max(ac, bc);
  if (r1 < 0 || c1 < 0 || r2 >= MAX_ROWS || c2 >= MAX_COLS) return ERR.REF;
  return new RefValue(sheetId, r1, c1, r2, c2);
}

/* ---------------------------------------------------------------- evaluate */

export function evaluate(ast: Ast, scope: EvalScope): EvalValue {
  switch (ast.k) {
    case 'num':
    case 'str':
    case 'bool':
    case 'err':
      return ast.v;
    case 'missing':
      return null;
    case 'ref':
      return resolveRef(ast.ref, scope);
    case 'name': {
      const local = scope.vars?.get(ast.name.toUpperCase());
      if (local !== undefined) return local;
      const target = scope.ctx.resolveName(ast.name);
      return target ? evaluate(target, { ...scope, dr: 0, dc: 0, vars: undefined }) : ERR.NAME;
    }
    case 'spill': {
      const base = evaluate(ast.of, scope);
      if (isError(base)) return base;
      if (!(base instanceof RefValue) || !base.single) return ERR.REF;
      const extent = scope.ctx.spillExtent(base.sheetId, base.r1, base.c1);
      return extent ? new RefValue(base.sheetId, base.r1, base.c1, base.r1 + extent.h - 1, base.c1 + extent.w - 1) : ERR.REF;
    }
    case 'unary': {
      const v = deref(evaluate(ast.a, scope), scope.ctx);
      if (ast.op === '+') return v;
      return broadcast([v], ([s]) => {
        const n = toNumber(s);
        return isError(n) ? n : n === 0 ? 0 : -n;
      });
    }
    case 'percent':
      return broadcast([deref(evaluate(ast.a, scope), scope.ctx)], ([s]) => {
        const n = toNumber(s);
        return isError(n) ? n : n / 100;
      });
    case 'bin': {
      if (ast.op === ':') return rangeOperator(evaluate(ast.a, scope), evaluate(ast.b, scope));
      const a = deref(evaluate(ast.a, scope), scope.ctx);
      const b = deref(evaluate(ast.b, scope), scope.ctx);
      if (!(a instanceof Matrix) && !(b instanceof Matrix)) return arithmetic(ast.op, a, b);
      return broadcast([a, b], ([x, y]) => arithmetic(ast.op, x, y));
    }
    case 'array':
      return new Matrix(ast.rows.map((row) => row.map((a) => toScalar(evaluate(a, scope), scope.ctx))));
    case 'call':
      return callFunction(ast.name, ast.args, scope);
  }
}

function rangeOperator(a: EvalValue, b: EvalValue): EvalValue {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (!(a instanceof RefValue) || !(b instanceof RefValue) || a.sheetId !== b.sheetId) return ERR.REF;
  return new RefValue(a.sheetId, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2));
}

function callFunction(name: string, args: Ast[], scope: EvalScope): EvalValue {
  const def = getFunction(name);
  if (!def) return ERR.NAME;
  if (args.length < def.min || args.length > def.max) return ERR.VALUE;
  try {
    switch (def.kind) {
      case 'lazy':
        return def.fn(args, scope);
      case 'range':
        return def.fn(args.map((a) => evaluate(a, scope)), scope);
      case 'scalar': {
        const values = args.map((a) => deref(evaluate(a, scope), scope.ctx));
        return broadcast(values, (scalars) => {
          for (const s of scalars) if (s instanceof CellError) return s;
          try {
            return def.fn(scalars, scope);
          } catch (e) {
            if (e instanceof CellError) return e;
            throw e;
          }
        });
      }
    }
  } catch (e) {
    // Function implementations may throw a CellError to bail out early.
    if (e instanceof CellError) return e;
    throw e;
  }
}