import { broadcast, deref } from '../evaluator';
import { registrar } from '../registry';
import { ERR, isError, Matrix, RefValue, type Scalar } from '../values';
import { num } from './helpers';

const f = registrar('Information');

/** Predicates see error values instead of propagating them. */
function test(name: string, summary: string, fn: (v: Scalar) => Scalar): void {
  f.range(name, 'value', summary, (args, s) => broadcast([deref(args[0], s.ctx)], ([v]) => fn(v)));
}

test('ISBLANK', 'Returns TRUE if the value is blank.', (v) => v === null);
test('ISNUMBER', 'Returns TRUE if the value is a number.', (v) => typeof v === 'number');
test('ISTEXT', 'Returns TRUE if the value is text.', (v) => typeof v === 'string');
test('ISNONTEXT', 'Returns TRUE if the value is not text.', (v) => typeof v !== 'string');
test('ISLOGICAL', 'Returns TRUE if the value is a logical value.', (v) => typeof v === 'boolean');
test('ISERROR', 'Returns TRUE if the value is any error value.', (v) => isError(v));
test('ISERR', 'Returns TRUE if the value is any error except #N/A.', (v) => isError(v) && v.code !== '#N/A');
test('ISNA', 'Returns TRUE if the value is #N/A.', (v) => isError(v) && v.code === '#N/A');
test('ERROR.TYPE', 'Returns a number corresponding to an error type.', (v) => {
  if (!isError(v)) return ERR.NA;
  const codes = ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A'];
  const i = codes.indexOf(v.code);
  return i < 0 ? 9 : i + 1;
});
test('N', 'Returns a value converted to a number.', (v) => (typeof v === 'number' || isError(v) ? v : v === true ? 1 : 0));

f.scalar('ISEVEN', 'number', 'Returns TRUE if the number is even.', ([n]) => Math.trunc(num(n)) % 2 === 0);
f.scalar('ISODD', 'number', 'Returns TRUE if the number is odd.', ([n]) => Math.trunc(num(n)) % 2 !== 0);
f.range('ISREF', 'value', 'Returns TRUE if the value is a reference.', (args) => args[0] instanceof RefValue);
f.range('ISFORMULA', 'reference', 'Returns TRUE if the cell contains a formula.', (args, s) => {
  const ref = args[0];
  return ref instanceof RefValue ? s.ctx.formulaAt(ref.sheetId, ref.r1, ref.c1) !== null : ERR.VALUE;
});
f.scalar('NA', '', 'Returns the error value #N/A.', () => ERR.NA);
f.range('TYPE', 'value', 'Returns a number indicating the data type of a value.', (args, s) => {
  const v = deref(args[0], s.ctx);
  if (v instanceof Matrix) return 64;
  if (isError(v)) return 16;
  if (typeof v === 'boolean') return 4;
  return typeof v === 'string' ? 2 : 1;
});
