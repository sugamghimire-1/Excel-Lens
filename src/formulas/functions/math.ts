import { clipRef, eachValue } from '../evaluator';
import { makeMatcher } from '../criteria';
import { registrar } from '../registry';
import { ERR, isError, Matrix, RefValue, type EvalValue, type Scalar } from '../values';
import type { EvalScope } from '../evaluator';
import { int, matrixOf, num, numbers, numOf, result, roundTo, text } from './helpers';

const f = registrar('Math');

f.range('SUM', 'number1, [number2], ...', 'Adds all the numbers in a range of cells.', (args, s) => {
  let total = 0;
  for (const n of numbers(args, s)) total += n;
  return result(total);
});
f.range('PRODUCT', 'number1, [number2], ...', 'Multiplies all the numbers given as arguments.', (args, s) => {
  const ns = numbers(args, s);
  return ns.length ? result(ns.reduce((a, b) => a * b, 1)) : 0;
});
f.range('SUMSQ', 'number1, [number2], ...', 'Returns the sum of the squares of the arguments.', (args, s) =>
  result(numbers(args, s).reduce((a, b) => a + b * b, 0)),
);

f.range('SUMPRODUCT', 'array1, [array2], ...', 'Multiplies matching components and returns the sum of those products.', (args, s) => {
  const ms = args.map((a) => matrixOf(a, s));
  const { h, w } = ms[0];
  if (ms.some((m) => m.h !== h || m.w !== w)) return ERR.VALUE;
  let total = 0;
  for (let i = 0; i < h; i++) {
    for (let j = 0; j < w; j++) {
      let p = 1;
      for (const m of ms) {
        const v = m.rows[i][j];
        if (isError(v)) return v;
        p *= typeof v === 'number' ? v : 0;
      }
      total += p;
    }
  }
  return result(total);
});

/* ------------------------------------------------------- conditional sums */

export interface CriteriaHit {
  each(visit: (index: number) => void): void;
}

/** Evaluates (range, criterion) pairs and visits the linear index of every match. */
export function matchCriteria(pairs: EvalValue[], scope: EvalScope, limit?: { h: number; w: number }): CriteriaHit {
  const tests: { m: (r: number, c: number) => Scalar; match: (v: Scalar) => boolean }[] = [];
  let h = limit?.h ?? 0;
  let w = limit?.w ?? 0;
  let usedH = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    const area = pairs[i];
    const criterion = pairs[i + 1];
    if (area === undefined || criterion === undefined) throw ERR.VALUE;
    const match = makeMatcher(criterion instanceof RefValue ? scope.ctx.readCell(criterion.sheetId, criterion.r1, criterion.c1) : criterion instanceof Matrix ? criterion.at(0, 0) : criterion);
    if (area instanceof RefValue) {
      const clipped = clipRef(area, scope.ctx);
      if (tests.length === 0 && !limit) {
        h = area.h;
        w = area.w;
      } else if (area.h !== h || area.w !== w) throw ERR.VALUE;
      usedH = Math.max(usedH, clipped.h);
      tests.push({ m: (r, c) => scope.ctx.readCell(area.sheetId, area.r1 + r, area.c1 + c), match });
    } else {
      const m = matrixOf(area, scope);
      if (tests.length === 0 && !limit) {
        h = m.h;
        w = m.w;
      } else if (m.h !== h || m.w !== w) throw ERR.VALUE;
      usedH = Math.max(usedH, m.h);
      tests.push({ m: (r, c) => m.at(r, c), match });
    }
  }
  return {
    each(visit) {
      for (let r = 0; r < usedH; r++) {
        for (let c = 0; c < w; c++) {
          let ok = true;
          for (const t of tests) {
            if (!t.match(t.m(r, c))) {
              ok = false;
              break;
            }
          }
          if (ok) visit(r * w + c);
        }
      }
    },
  };
}

/** Random access into a range argument by linear index with a given width. */
export function accessor(v: EvalValue, scope: EvalScope, width: number): (index: number) => Scalar {
  if (v instanceof RefValue) return (i) => scope.ctx.readCell(v.sheetId, v.r1 + Math.floor(i / width), v.c1 + (i % width));
  const m = matrixOf(v, scope);
  return (i) => m.at(Math.floor(i / width), i % width);
}

export function areaSize(v: EvalValue): { h: number; w: number } {
  if (v instanceof RefValue || v instanceof Matrix) return { h: v.h, w: v.w };
  return { h: 1, w: 1 };
}

export function collectIf(valuesArg: EvalValue, pairs: EvalValue[], scope: EvalScope): number[] {
  const size = areaSize(pairs[0]);
  const at = accessor(valuesArg, scope, size.w);
  const out: number[] = [];
  let err: Scalar = null;
  matchCriteria(pairs, scope).each((i) => {
    const v = at(i);
    if (typeof v === 'number') out.push(v);
    else if (isError(v)) err ??= v;
  });
  if (err !== null) throw err;
  return out;
}

const sum = (ns: number[]): number => ns.reduce((a, b) => a + b, 0);

f.range('SUMIF', 'range, criteria, [sum_range]', 'Adds the cells specified by a given condition.', (args, s) =>
  result(sum(collectIf(args[2] ?? args[0], [args[0], args[1]], s))),
);
f.range('SUMIFS', 'sum_range, criteria_range1, criteria1, [criteria_range2], [criteria2], ...', 'Adds the cells that meet multiple criteria.', (args, s) => {
  const a = areaSize(args[0]);
  const b = areaSize(args[1]);
  if (a.h !== b.h || a.w !== b.w) return ERR.VALUE;
  return result(sum(collectIf(args[0], args.slice(1), s)));
});

/* ---------------------------------------------------------------- rounding */

f.scalar('ROUND', 'number, num_digits', 'Rounds a number to a specified number of digits.', ([n, d]) => roundTo(num(n), int(d)));
f.scalar('ROUNDUP', 'number, num_digits', 'Rounds a number up, away from zero.', ([n, d]) => roundTo(num(n), int(d), 'up'));
f.scalar('ROUNDDOWN', 'number, num_digits', 'Rounds a number down, toward zero.', ([n, d]) => roundTo(num(n), int(d), 'down'));
f.scalar('MROUND', 'number, multiple', 'Returns a number rounded to the desired multiple.', ([n, m]) => {
  const x = num(n);
  const k = num(m);
  if (k === 0) return 0;
  if (x * k < 0) return ERR.NUM;
  return roundTo(x / k, 0) * k;
});
f.scalar('INT', 'number', 'Rounds a number down to the nearest integer.', ([n]) => Math.floor(num(n)));
f.scalar('TRUNC', 'number, [num_digits]', 'Truncates a number by removing the decimal part.', ([n, d]) => roundTo(num(n), int(d, 0), 'down'));
function toMultiple(n: number, k: number, up: boolean): number {
  if (k === 0) return 0;
  const q = n / k;
  const r = Math.round(q);
  const whole = Math.abs(q - r) < 1e-10 ? r : up ? Math.ceil(q) : Math.floor(q);
  return roundTo(whole * k, 12);
}
f.scalar('CEILING', 'number, significance', 'Rounds a number up to the nearest multiple of significance.', ([n, k]) => {
  if (num(n) > 0 && num(k) < 0) return ERR.NUM;
  return toMultiple(num(n), num(k), true);
});
f.scalar('FLOOR', 'number, significance', 'Rounds a number down to the nearest multiple of significance.', ([n, k]) => {
  if (num(k) === 0) return ERR.DIV0;
  if (num(n) > 0 && num(k) < 0) return ERR.NUM;
  return toMultiple(num(n), num(k), false);
});
f.scalar('CEILING.MATH', 'number, [significance]', 'Rounds a number up to the nearest multiple of significance.', ([n, k]) => toMultiple(num(n), Math.abs(num(k, 1)), true));
f.scalar('FLOOR.MATH', 'number, [significance]', 'Rounds a number down to the nearest multiple of significance.', ([n, k]) => toMultiple(num(n), Math.abs(num(k, 1)), false));
f.scalar('EVEN', 'number', 'Rounds a number away from zero to the nearest even integer.', ([n]) => Math.sign(num(n)) * Math.ceil(Math.abs(num(n)) / 2) * 2);
f.scalar('ODD', 'number', 'Rounds a number away from zero to the nearest odd integer.', ([n]) => {
  const x = num(n);
  return (x < 0 ? -1 : 1) * (Math.ceil((Math.max(Math.abs(x), 1) - 1) / 2) * 2 + 1);
});

/* --------------------------------------------------------------- arithmetic */

f.scalar('ABS', 'number', 'Returns the absolute value of a number.', ([n]) => Math.abs(num(n)));
f.scalar('SIGN', 'number', 'Returns the sign of a number: 1, 0 or -1.', ([n]) => Math.sign(num(n)));
f.scalar('SQRT', 'number', 'Returns the square root of a number.', ([n]) => (num(n) < 0 ? ERR.NUM : Math.sqrt(num(n))));
f.scalar('POWER', 'number, power', 'Returns the result of a number raised to a power.', ([a, b]) => {
  if (num(a) === 0 && num(b) < 0) return ERR.DIV0;
  return result(num(a) ** num(b));
});
f.scalar('EXP', 'number', 'Returns e raised to the power of a given number.', ([n]) => result(Math.exp(num(n))));
f.scalar('LN', 'number', 'Returns the natural logarithm of a number.', ([n]) => (num(n) <= 0 ? ERR.NUM : Math.log(num(n))));
f.scalar('LOG10', 'number', 'Returns the base-10 logarithm of a number.', ([n]) => (num(n) <= 0 ? ERR.NUM : Math.log10(num(n))));
f.scalar('LOG', 'number, [base]', 'Returns the logarithm of a number to the base you specify.', ([n, b]) => {
  const x = num(n);
  const base = num(b, 10);
  if (x <= 0 || base <= 0) return ERR.NUM;
  if (base === 1) return ERR.DIV0;
  return base === 10 ? Math.log10(x) : Math.log(x) / Math.log(base);
});
f.scalar('MOD', 'number, divisor', 'Returns the remainder after a number is divided by a divisor.', ([n, d]) => {
  const x = num(n);
  const k = num(d);
  if (k === 0) return ERR.DIV0;
  const r = x - k * Math.floor(x / k);
  return Math.abs(r) < 1e-12 || Math.abs(r - k) < 1e-12 ? 0 : r;
});
f.scalar('QUOTIENT', 'numerator, denominator', 'Returns the integer portion of a division.', ([n, d]) => (num(d) === 0 ? ERR.DIV0 : Math.trunc(num(n) / num(d))));
f.range('GCD', 'number1, [number2], ...', 'Returns the greatest common divisor.', (args, s) =>
  numbers(args, s).map((n) => Math.abs(Math.trunc(n))).reduce((a, b) => {
    while (b) [a, b] = [b, a % b];
    return a;
  }, 0),
);
f.range('LCM', 'number1, [number2], ...', 'Returns the least common multiple.', (args, s) => {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  return numbers(args, s).map((n) => Math.abs(Math.trunc(n))).reduce((a, b) => (a === 0 || b === 0 ? 0 : (a / gcd(a, b)) * b), 1);
});
f.scalar('FACT', 'number', 'Returns the factorial of a number.', ([n]) => {
  const k = int(n);
  if (k < 0 || k > 170) return ERR.NUM;
  let r = 1;
  for (let i = 2; i <= k; i++) r *= i;
  return r;
});
f.scalar('COMBIN', 'number, number_chosen', 'Returns the number of combinations for a given number of items.', ([n, k]) => {
  const a = int(n);
  const b = int(k);
  if (a < 0 || b < 0 || b > a) return ERR.NUM;
  let r = 1;
  for (let i = 1; i <= b; i++) r = (r * (a - b + i)) / i;
  return Math.round(r);
});
f.scalar('PERMUT', 'number, number_chosen', 'Returns the number of permutations for a given number of items.', ([n, k]) => {
  const a = int(n);
  const b = int(k);
  if (a < 0 || b < 0 || b > a) return ERR.NUM;
  let r = 1;
  for (let i = 0; i < b; i++) r *= a - i;
  return r;
});

/* ------------------------------------------------------------ trigonometry */

f.scalar('PI', '', 'Returns the value of pi.', () => Math.PI);
f.scalar('SIN', 'number', 'Returns the sine of an angle in radians.', ([n]) => Math.sin(num(n)));
f.scalar('COS', 'number', 'Returns the cosine of an angle in radians.', ([n]) => Math.cos(num(n)));
f.scalar('TAN', 'number', 'Returns the tangent of an angle in radians.', ([n]) => Math.tan(num(n)));
f.scalar('ASIN', 'number', 'Returns the arcsine of a number.', ([n]) => result(Math.asin(num(n))));
f.scalar('ACOS', 'number', 'Returns the arccosine of a number.', ([n]) => result(Math.acos(num(n))));
f.scalar('ATAN', 'number', 'Returns the arctangent of a number.', ([n]) => Math.atan(num(n)));
f.scalar('ATAN2', 'x_num, y_num', 'Returns the arctangent from x- and y-coordinates.', ([x, y]) =>
  num(x) === 0 && num(y) === 0 ? ERR.DIV0 : Math.atan2(num(y), num(x)),
);
f.scalar('DEGREES', 'angle', 'Converts radians to degrees.', ([n]) => (num(n) * 180) / Math.PI);
f.scalar('RADIANS', 'angle', 'Converts degrees to radians.', ([n]) => (num(n) * Math.PI) / 180);

/* ------------------------------------------------------------------ random */

f.volatileRange('RAND', '', 'Returns a random number between 0 and 1.', () => Math.random());
f.volatileRange('RANDBETWEEN', 'bottom, top', 'Returns a random integer between the numbers you specify.', (args, s) => {
  const lo = Math.ceil(numOf(args[0], s));
  const hi = Math.floor(numOf(args[1], s));
  if (lo > hi) return ERR.NUM;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
});

/* ------------------------------------------------------------ miscellaneous */

f.range('SUBTOTAL', 'function_num, ref1, [ref2], ...', 'Returns a subtotal that ignores rows hidden by a filter.', (args, s) => {
  const code = numOf(args[0], s) % 100;
  const ns: number[] = [];
  let nonBlank = 0;
  for (const a of args.slice(1)) {
    if (!(a instanceof RefValue)) return ERR.VALUE;
    const ref = clipRef(a, s.ctx);
    for (let r = ref.r1; r <= ref.r2; r++) {
      if (s.ctx.isRowHidden(ref.sheetId, r)) continue;
      for (let c = ref.c1; c <= ref.c2; c++) {
        // Nested subtotals are skipped so grand totals never double count.
        if (/\bSUBTOTAL\(/i.test(s.ctx.formulaAt(ref.sheetId, r, c) ?? '')) continue;
        const v = s.ctx.readCell(ref.sheetId, r, c);
        if (isError(v)) return v;
        if (v !== null) nonBlank++;
        if (typeof v === 'number') ns.push(v);
      }
    }
  }
  const mean = (): number => {
    if (!ns.length) throw ERR.DIV0;
    return sum(ns) / ns.length;
  };
  const variance = (sample: boolean): number => {
    if (ns.length < (sample ? 2 : 1)) throw ERR.DIV0;
    const m = mean();
    return ns.reduce((a, n) => a + (n - m) ** 2, 0) / (ns.length - (sample ? 1 : 0));
  };
  switch (code) {
    case 1:
      return mean();
    case 2:
      return ns.length;
    case 3:
      return nonBlank;
    case 4:
      return ns.length ? ns.reduce((a, b) => Math.max(a, b)) : 0;
    case 5:
      return ns.length ? ns.reduce((a, b) => Math.min(a, b)) : 0;
    case 6:
      return ns.reduce((a, b) => a * b, 1);
    case 7:
      return Math.sqrt(variance(true));
    case 8:
      return Math.sqrt(variance(false));
    case 9:
      return sum(ns);
    case 10:
      return variance(true);
    case 11:
      return variance(false);
    default:
      return ERR.VALUE;
  }
});

f.range('MMULT', 'array1, array2', 'Returns the matrix product of two arrays.', (args, s) => {
  const a = matrixOf(args[0], s);
  const b = matrixOf(args[1], s);
  if (a.w !== b.h) return ERR.VALUE;
  return new Matrix(
    a.rows.map((row) =>
      Array.from({ length: b.w }, (_, j) => row.reduce<number>((acc, v, k) => acc + num(v) * num(b.at(k, j)), 0)),
    ),
  );
});
f.scalar('ROMAN', 'number', 'Converts an arabic numeral to roman, as text.', ([n]) => {
  let x = int(n);
  if (x < 0 || x > 3999) return ERR.VALUE;
  const table: [number, string][] = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, t] of table) while (x >= v) {
    out += t;
    x -= v;
  }
  return out;
});
f.scalar('BASE', 'number, radix, [min_length]', 'Converts a number into text with the given radix.', ([n, r, len]) => {
  const radix = int(r);
  if (num(n) < 0 || radix < 2 || radix > 36) return ERR.NUM;
  return int(n).toString(radix).toUpperCase().padStart(int(len, 0), '0');
});
f.scalar('DECIMAL', 'text, radix', 'Converts text in a given base to a decimal number.', ([t, r]) => {
  const n = parseInt(text(t), int(r));
  return Number.isNaN(n) ? ERR.NUM : n;
});
f.range('AGGREGATE', 'function_num, options, ref1, [ref2], ...', 'Aggregates a list, with the option to ignore errors.', (args, s) => {
  const code = numOf(args[0], s);
  const skipErrors = [2, 3, 6, 7].includes(numOf(args[1], s));
  const ns: number[] = [];
  let seen = 0;
  let err: Scalar = null;
  for (const a of args.slice(2, code >= 14 ? 3 : undefined)) {
    eachValue(a, s.ctx, (v) => {
      if (isError(v)) {
        if (!skipErrors) err ??= v;
      } else if (v !== null) {
        seen++;
        if (typeof v === 'number') ns.push(v);
      }
    });
  }
  if (err !== null) return err;
  const sorted = [...ns].sort((a, b) => a - b);
  const k = code >= 14 ? numOf(args[3], s) : 0;
  switch (code) {
    case 1:
      return ns.length ? sum(ns) / ns.length : ERR.DIV0;
    case 2:
      return ns.length;
    case 3:
      return seen;
    case 4:
      return sorted[sorted.length - 1] ?? 0;
    case 5:
      return sorted[0] ?? 0;
    case 6:
      return ns.reduce((a, b) => a * b, 1);
    case 9:
      return sum(ns);
    case 12:
      return ns.length ? (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2 : ERR.NUM;
    case 14:
      return sorted[sorted.length - k] ?? ERR.NUM;
    case 15:
      return sorted[k - 1] ?? ERR.NUM;
    default:
      return ERR.VALUE;
  }
});
f.range('ARRAYTOTEXT', 'array, [format]', 'Returns the text of an array.', (args, s) => {
  const strict = args[1] !== undefined && numOf(args[1], s) === 1;
  const m = matrixOf(args[0], s);
  const cell = (v: Scalar): string => (strict && typeof v === 'string' ? `"${v}"` : isError(v) ? v.code : text(v));
  return strict ? `{${m.rows.map((r) => r.map(cell).join(',')).join(';')}}` : m.rows.flat().map(cell).join(', ');
});
f.range('MULTINOMIAL', 'number1, [number2], ...', 'Returns the multinomial of a set of numbers.', (args, s) => {
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  const ns = numbers(args, s).map(Math.trunc);
  return result(fact(sum(ns)) / ns.reduce((a, b) => a * fact(b), 1));
});
