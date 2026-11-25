import { broadcast, eachValue, evaluate, toScalar } from '../evaluator';
import { registrar } from '../registry';
import { ERR, isError, Matrix, scalarsEqual, toBool, type EvalValue, type Scalar } from '../values';
import { bool, evalArg } from './helpers';
import type { Ast } from '../parser';

const f = registrar('Logical');

f.lazy('IF', 'logical_test, value_if_true, [value_if_false]', 'Returns one value if a condition is true and another if it is false.', (args, s) => {
  const cond = evalArg(args[0], s);
  if (cond instanceof Matrix) {
    const yes = evalArg(args[1], s);
    const no = args[2] ? evalArg(args[2], s) : false;
    return broadcast([cond, yes, no], ([c, a, b]) => {
      const t = toBool(c);
      return isError(t) ? t : t ? (a ?? 0) : (b ?? 0);
    });
  }
  const test = toBool(cond);
  if (isError(test)) return test;
  if (test) return orZero(evaluate(args[1], s));
  return args[2] ? orZero(evaluate(args[2], s)) : false;
});

/** An omitted branch such as IF(TRUE,) evaluates to 0. */
function orZero(v: EvalValue): EvalValue {
  return v === null ? 0 : v;
}

f.lazy('IFS', 'logical_test1, value_if_true1, [logical_test2], [value_if_true2], ...', 'Checks conditions in order and returns the value for the first true one.', (args, s) => {
  for (let i = 0; i + 1 < args.length; i += 2) {
    const t = toBool(toScalar(evaluate(args[i], s), s.ctx));
    if (isError(t)) return t;
    if (t) return orZero(evaluate(args[i + 1], s));
  }
  return ERR.NA;
});

f.lazy('SWITCH', 'expression, value1, result1, [default_or_value2], [result2], ...', 'Evaluates an expression against a list of values.', (args, s) => {
  const target = toScalar(evaluate(args[0], s), s.ctx);
  if (isError(target)) return target;
  let i = 1;
  for (; i + 1 < args.length; i += 2) {
    const v = toScalar(evaluate(args[i], s), s.ctx);
    if (isError(v)) return v;
    if (scalarsEqual(target, v)) return evaluate(args[i + 1], s);
  }
  return i < args.length ? evaluate(args[i], s) : ERR.NA;
});

f.lazy('CHOOSE', 'index_num, value1, [value2], ...', 'Chooses a value from a list of values.', (args, s) => {
  const idx = toScalar(evaluate(args[0], s), s.ctx);
  if (isError(idx)) return idx;
  const n = Math.trunc(Number(idx));
  return n >= 1 && n < args.length ? evaluate(args[n], s) : ERR.VALUE;
});

function fallback(args: Ast[], s: Parameters<typeof evaluate>[1], caught: (v: Scalar) => boolean): EvalValue {
  const v = evalArg(args[0], s);
  if (v instanceof Matrix) {
    if (!v.rows.some((r) => r.some(caught))) return v;
    const alt = evalArg(args[1], s);
    return broadcast([v, alt], ([a, b]) => (caught(a) ? b : a));
  }
  return caught(v) ? orZero(evaluate(args[1], s)) : v;
}
f.lazy('IFERROR', 'value, value_if_error', 'Returns a fallback if the expression is an error.', (args, s) => fallback(args, s, isError));
f.lazy('IFNA', 'value, value_if_na', 'Returns a fallback if the expression is #N/A.', (args, s) => fallback(args, s, (v) => isError(v) && v.code === '#N/A'));

function logicals(args: EvalValue[], s: Parameters<typeof evaluate>[1]): boolean[] {
  const out: boolean[] = [];
  for (const a of args) {
    eachValue(a, s.ctx, (v, inRef) => {
      if (isError(v)) throw v;
      if (v === null || (inRef && typeof v === 'string')) return;
      out.push(bool(v));
    });
  }
  if (!out.length) throw ERR.VALUE;
  return out;
}
f.range('AND', 'logical1, [logical2], ...', 'Returns TRUE if all arguments are TRUE.', (args, s) => logicals(args, s).every(Boolean));
f.range('OR', 'logical1, [logical2], ...', 'Returns TRUE if any argument is TRUE.', (args, s) => logicals(args, s).some(Boolean));
f.range('XOR', 'logical1, [logical2], ...', 'Returns TRUE if an odd number of arguments are TRUE.', (args, s) => logicals(args, s).filter(Boolean).length % 2 === 1);
f.scalar('NOT', 'logical', 'Reverses the logic of its argument.', ([v]) => !bool(v));
f.scalar('TRUE', '', 'Returns the logical value TRUE.', () => true);
f.scalar('FALSE', '', 'Returns the logical value FALSE.', () => false);

f.lazy('LET', 'name1, value1, calculation_or_name2, [value2], [calculation], ...', 'Assigns names to intermediate results inside a formula.', (args, s) => {
  if (args.length % 2 === 0) return ERR.VALUE;
  const vars = new Map(s.vars);
  let scope = { ...s, vars };
  for (let i = 0; i + 1 < args.length; i += 2) {
    const target = args[i];
    if (target.k !== 'name') return ERR.NAME;
    vars.set(target.name.toUpperCase(), evaluate(args[i + 1], scope));
    scope = { ...scope, vars };
  }
  return evaluate(args[args.length - 1], scope);
});
