import { CellError } from '@/types';
import { collectNumbers, deref, evaluate, toMatrix, toScalar, type EvalScope } from '../evaluator';
import type { Ast } from '../parser';
import { ERR, isError, Matrix, RefValue, toBool, toNumber, toText, type EvalValue, type Scalar } from '../values';

/** Coerces to a number or throws the matching cell error. */
export function num(v: Scalar | undefined, fallback?: number): number {
  if (v === undefined || (v === null && fallback !== undefined)) {
    if (fallback === undefined) throw ERR.VALUE;
    return fallback;
  }
  const n = toNumber(v);
  if (isError(n)) throw n;
  return n;
}

export function int(v: Scalar | undefined, fallback?: number): number {
  return Math.trunc(num(v, fallback));
}

export function text(v: Scalar | undefined, fallback = ''): string {
  if (v === undefined) return fallback;
  const t = toText(v);
  if (isError(t)) throw t;
  return t;
}

export function bool(v: Scalar | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  const b = toBool(v);
  if (isError(b)) throw b;
  return b;
}

/** Returns a finite number or `#NUM!`. */
export function result(n: number): number {
  if (!Number.isFinite(n)) throw ERR.NUM;
  return n;
}

/** All numbers in the arguments, following aggregate rules. */
export function numbers(args: EvalValue[], scope: EvalScope): number[] {
  const out = collectNumbers(args, scope.ctx);
  if (isError(out)) throw out;
  return out;
}

export function scalarOf(v: EvalValue | undefined, scope: EvalScope): Scalar {
  if (v === undefined) return null;
  const s = toScalar(v, scope.ctx);
  if (isError(s)) throw s;
  return s;
}

export function numOf(v: EvalValue | undefined, scope: EvalScope, fallback?: number): number {
  return num(v === undefined ? undefined : scalarOf(v, scope), fallback);
}

export function matrixOf(v: EvalValue, scope: EvalScope): Matrix {
  const m = toMatrix(v, scope.ctx);
  if (m.h === 1 && m.w === 1 && m.at(0, 0) instanceof CellError && !(v instanceof RefValue) && !(v instanceof Matrix)) throw m.at(0, 0);
  return m;
}

/** Evaluates a lazy argument to a scalar or matrix. */
export function evalArg(ast: Ast, scope: EvalScope): Scalar | Matrix {
  return deref(evaluate(ast, scope), scope.ctx);
}

/** Flattens a matrix in row-major order. */
export function flat(m: Matrix): Scalar[] {
  return m.rows.flat();
}

export function single(m: Matrix): EvalValue {
  return m.h === 1 && m.w === 1 ? m.at(0, 0) : m;
}

export function columnOf(values: Scalar[]): Matrix {
  return new Matrix(values.map((v) => [v]));
}

export function transpose(m: Matrix): Matrix {
  return new Matrix(Array.from({ length: m.w }, (_, c) => Array.from({ length: m.h }, (_, r) => m.at(r, c))));
}

/** Rounds half away from zero, correcting binary noise (2.675 -> 2.68). */
export function roundTo(n: number, digits: number, mode: 'half' | 'up' | 'down' = 'half'): number {
  if (digits > 15) return n;
  const factor = 10 ** digits;
  const scaled = Math.abs(n) * factor;
  if (!Number.isFinite(scaled)) return n;
  const eps = scaled * 2 ** -50;
  let r: number;
  if (mode === 'up') r = Math.ceil(scaled - eps);
  else if (mode === 'down') r = Math.floor(scaled + eps);
  else r = Math.floor(scaled + 0.5 + eps);
  const value = digits >= 0 ? r / factor : r * 10 ** -digits;
  return value === 0 ? 0 : Math.sign(n) * value;
}