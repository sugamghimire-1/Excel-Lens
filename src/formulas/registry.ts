import type { EvalScope } from './evaluator';
import type { Ast } from './parser';
import type { EvalValue, Scalar } from './values';

export type FunctionCategory = 'Math' | 'Statistical' | 'Logical' | 'Lookup' | 'Text' | 'Date' | 'Financial' | 'Information' | 'Array';

export interface FunctionParam {
  name: string;
  optional: boolean;
  repeat: boolean;
}

interface FunctionBase {
  name: string;
  category: FunctionCategory;
  summary: string;
  params: FunctionParam[];
  min: number;
  max: number;
  /** Re-evaluated on every recalculation. */
  volatile: boolean;
}

export type ScalarFn = (args: Scalar[], scope: EvalScope) => Scalar;
export type RangeFn = (args: EvalValue[], scope: EvalScope) => EvalValue;
export type LazyFn = (args: Ast[], scope: EvalScope) => EvalValue;

/**
 * - `scalar`: receives plain values; arrays are broadcast and errors propagate.
 * - `range`: receives evaluated arguments, including references and arrays.
 * - `lazy`: receives unevaluated arguments and decides what to evaluate.
 */
export type FunctionDef =
  | (FunctionBase & { kind: 'scalar'; fn: ScalarFn })
  | (FunctionBase & { kind: 'range'; fn: RangeFn })
  | (FunctionBase & { kind: 'lazy'; fn: LazyFn });

const functions = new Map<string, FunctionDef>();

/** Parses `"value, [digits], ..."` into parameter metadata. */
function parseSignature(signature: string): { params: FunctionParam[]; min: number; max: number } {
  const params: FunctionParam[] = [];
  let repeating = false;
  for (const part of signature.split(',').map((s) => s.trim()).filter(Boolean)) {
    if (part === '...') {
      repeating = true;
      if (params.length) params[params.length - 1].repeat = true;
      continue;
    }
    const optional = part.startsWith('[');
    params.push({ name: part.replace(/[[\]]/g, ''), optional, repeat: false });
  }
  return {
    params,
    min: params.filter((p) => !p.optional).length,
    max: repeating ? 255 : params.length,
  };
}

export interface Registrar {
  scalar(name: string, signature: string, summary: string, fn: ScalarFn): void;
  range(name: string, signature: string, summary: string, fn: RangeFn): void;
  lazy(name: string, signature: string, summary: string, fn: LazyFn): void;
  volatileRange(name: string, signature: string, summary: string, fn: RangeFn): void;
  alias(alias: string, name: string): void;
}

export function registrar(category: FunctionCategory): Registrar {
  const base = (name: string, signature: string, summary: string, isVolatile = false): FunctionBase => ({
    name,
    category,
    summary,
    volatile: isVolatile,
    ...parseSignature(signature),
  });
  return {
    scalar: (name, sig, summary, fn) => void functions.set(name, { ...base(name, sig, summary), kind: 'scalar', fn }),
    range: (name, sig, summary, fn) => void functions.set(name, { ...base(name, sig, summary), kind: 'range', fn }),
    lazy: (name, sig, summary, fn) => void functions.set(name, { ...base(name, sig, summary), kind: 'lazy', fn }),
    volatileRange: (name, sig, summary, fn) =>
      void functions.set(name, { ...base(name, sig, summary, true), kind: 'range', fn }),
    alias: (alias, name) => {
      const def = functions.get(name);
      if (!def) throw new Error(`Cannot alias unknown function ${name}`);
      functions.set(alias, { ...def, name: alias });
    },
  };
}

export function getFunction(name: string): FunctionDef | undefined {
  return functions.get(name);
}

export function allFunctions(): FunctionDef[] {
  return [...functions.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function signatureText(def: FunctionDef): string {
  const parts = def.params.map((p) => (p.optional ? `[${p.name}]` : p.name));
  if (def.max === 255) parts.push('...');
  return `${def.name}(${parts.join(', ')})`;
}
