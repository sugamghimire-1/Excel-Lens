import { registrar } from '../registry';
import { compareScalars, ERR, isError, Matrix, scalarsEqual, toBool, type EvalValue, type Scalar } from '../values';
import type { EvalScope } from '../evaluator';
import { bool, columnOf, flat, matrixOf, numOf, scalarOf, single, transpose } from './helpers';

const f = registrar('Array');

function sortRows(rows: Scalar[][], keys: { index: number; order: number }[]): Scalar[][] {
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      for (const { index, order } of keys) {
        const x = a.row[index];
        const y = b.row[index];
        if (x === null || y === null) {
          if (x === y) continue;
          return x === null ? 1 : -1;
        }
        const cmp = isError(x) || isError(y) ? Number(isError(x)) - Number(isError(y)) : compareScalars(x, y) * order;
        if (cmp) return cmp;
      }
      return a.i - b.i;
    })
    .map((e) => e.row);
}

f.range('SORT', 'array, [sort_index], [sort_order], [by_col]', 'Sorts the contents of a range or array.', (args, s) => {
  const byCol = args[3] !== undefined && bool(scalarOf(args[3], s));
  let m = matrixOf(args[0], s);
  if (byCol) m = transpose(m);
  const index = args[1] === undefined || args[1] === null ? 1 : Math.trunc(numOf(args[1], s));
  const order = args[2] === undefined || args[2] === null ? 1 : numOf(args[2], s);
  if (index < 1 || index > m.w || (order !== 1 && order !== -1)) return ERR.VALUE;
  const out = new Matrix(sortRows(m.rows, [{ index: index - 1, order }]));
  return byCol ? transpose(out) : out;
});
f.range('SORTBY', 'array, by_array1, [sort_order1], ...', 'Sorts an array based on the values in another array.', (args, s) => {
  const m = matrixOf(args[0], s);
  const keys: { values: Scalar[]; order: number }[] = [];
  for (let i = 1; i < args.length; i += 2) {
    const values = flat(matrixOf(args[i], s));
    if (values.length !== m.h) return ERR.VALUE;
    keys.push({ values, order: args[i + 1] === undefined ? 1 : numOf(args[i + 1], s, 1) });
  }
  const joined = m.rows.map((row, r) => [...keys.map((k) => k.values[r]), ...row]);
  const sorted = sortRows(joined, keys.map((k, index) => ({ index, order: k.order })));
  return new Matrix(sorted.map((r) => r.slice(keys.length)));
});
f.range('FILTER', 'array, include, [if_empty]', 'Filters an array based on criteria you define.', (args, s) => {
  const m = matrixOf(args[0], s);
  const inc = matrixOf(args[1], s);
  const keep = (v: Scalar): boolean => {
    const b = toBool(v);
    if (isError(b)) throw b;
    return b;
  };
  let out: Scalar[][];
  if (inc.h === m.h && inc.w === 1) out = m.rows.filter((_, r) => keep(inc.at(r, 0)));
  else if (inc.w === m.w && inc.h === 1) out = m.rows.map((row) => row.filter((_, c) => keep(inc.at(0, c))));
  else return ERR.VALUE;
  if (!out.length || !out[0].length) return args[2] === undefined ? ERR.CALC : args[2];
  return single(new Matrix(out));
});
f.range('UNIQUE', 'array, [by_col], [exactly_once]', 'Returns the unique values in a list or range.', (args, s) => {
  const byCol = args[1] !== undefined && bool(scalarOf(args[1], s));
  const once = args[2] !== undefined && bool(scalarOf(args[2], s));
  let m = matrixOf(args[0], s);
  if (byCol) m = transpose(m);
  const groups: { row: Scalar[]; n: number }[] = [];
  const buckets = new Map<string, { row: Scalar[]; n: number }[]>();
  for (const row of m.rows) {
    const key = row.map((v) => (typeof v === 'string' ? v.toLowerCase() : String(v))).join('\u0001');
    const bucket = buckets.get(key) ?? [];
    const hit = bucket.find((g) => g.row.every((v, i) => (isError(v) ? v === row[i] : !isError(row[i]) && scalarsEqual(v, row[i]))));
    if (hit) hit.n++;
    else {
      const g = { row, n: 1 };
      bucket.push(g);
      groups.push(g);
      buckets.set(key, bucket);
    }
  }
  const rows = groups.filter((g) => !once || g.n === 1).map((g) => g.row);
  if (!rows.length) return ERR.CALC;
  const out = new Matrix(rows);
  return single(byCol ? transpose(out) : out);
});
f.range('SEQUENCE', 'rows, [columns], [start], [step]', 'Generates a list of sequential numbers in an array.', (args, s) => {
  const rows = Math.trunc(numOf(args[0], s, 1));
  const cols = Math.trunc(numOf(args[1], s, 1));
  const start = numOf(args[2], s, 1);
  const step = numOf(args[3], s, 1);
  if (rows < 1 || cols < 1 || rows * cols > 1_000_000) return ERR.VALUE;
  return single(new Matrix(Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => start + (r * cols + c) * step))));
});
f.volatileRange('RANDARRAY', '[rows], [columns], [min], [max], [integer]', 'Returns an array of random numbers.', (args, s) => {
  const rows = Math.trunc(numOf(args[0], s, 1));
  const cols = Math.trunc(numOf(args[1], s, 1));
  const lo = numOf(args[2], s, 0);
  const hi = numOf(args[3], s, 1);
  const whole = args[4] !== undefined && bool(scalarOf(args[4], s));
  if (rows < 1 || cols < 1 || rows * cols > 1_000_000 || lo > hi) return ERR.VALUE;
  const pick = (): number => (whole ? Math.floor(lo + Math.random() * (hi - lo + 1)) : lo + Math.random() * (hi - lo));
  return single(new Matrix(Array.from({ length: rows }, () => Array.from({ length: cols }, pick))));
});
f.range('TRANSPOSE', 'array', 'Returns the transpose of an array.', (args, s) => single(transpose(matrixOf(args[0], s))));

function slice(m: Matrix, rows: number | null, cols: number | null, drop: boolean): EvalValue {
  const cut = (n: number | null, size: number): [number, number] => {
    if (n === null) return [0, size];
    if (drop) return n >= 0 ? [n, size] : [0, size + n];
    return n >= 0 ? [0, Math.min(n, size)] : [Math.max(0, size + n), size];
  };
  const [r1, r2] = cut(rows, m.h);
  const [c1, c2] = cut(cols, m.w);
  if (r1 >= r2 || c1 >= c2) return ERR.CALC;
  return single(new Matrix(m.rows.slice(r1, r2).map((r) => r.slice(c1, c2))));
}
const optional = (v: EvalValue | undefined, s: EvalScope): number | null => (v === undefined || v === null ? null : Math.trunc(numOf(v, s)));

f.range('TAKE', 'array, rows, [columns]', 'Returns rows or columns from the start or end of an array.', (args, s) => slice(matrixOf(args[0], s), optional(args[1], s), optional(args[2], s), false));
f.range('DROP', 'array, rows, [columns]', 'Drops rows or columns from the start or end of an array.', (args, s) => slice(matrixOf(args[0], s), optional(args[1], s), optional(args[2], s), true));
f.range('VSTACK', 'array1, [array2], ...', 'Appends arrays vertically.', (args, s) => {
  const ms = args.map((a) => matrixOf(a, s));
  const w = Math.max(...ms.map((m) => m.w));
  return new Matrix(ms.flatMap((m) => m.rows.map((r) => Array.from({ length: w }, (_, i): Scalar => (i < m.w ? r[i] : ERR.NA)))));
});
f.range('HSTACK', 'array1, [array2], ...', 'Appends arrays horizontally.', (args, s) => {
  const ms = args.map((a) => matrixOf(a, s));
  const h = Math.max(...ms.map((m) => m.h));
  return new Matrix(Array.from({ length: h }, (_, r) => ms.flatMap((m) => (r < m.h ? m.rows[r] : new Array<Scalar>(m.w).fill(ERR.NA)))));
});
f.range('TOCOL', 'array', 'Returns the array as one column.', (args, s) => single(columnOf(flat(matrixOf(args[0], s)))));
f.range('TOROW', 'array', 'Returns the array as one row.', (args, s) => single(new Matrix([flat(matrixOf(args[0], s))])));
f.range('CHOOSECOLS', 'array, col_num1, [col_num2], ...', 'Returns the specified columns from an array.', (args, s) => {
  const m = matrixOf(args[0], s);
  const idx = args.slice(1).flatMap((a) => flat(matrixOf(a, s))).map((v) => Math.trunc(Number(v)));
  if (idx.some((i) => i === 0 || Math.abs(i) > m.w || Number.isNaN(i))) return ERR.VALUE;
  return single(new Matrix(m.rows.map((r) => idx.map((i) => r[i > 0 ? i - 1 : m.w + i]))));
});
f.range('CHOOSEROWS', 'array, row_num1, [row_num2], ...', 'Returns the specified rows from an array.', (args, s) => {
  const m = matrixOf(args[0], s);
  const idx = args.slice(1).flatMap((a) => flat(matrixOf(a, s))).map((v) => Math.trunc(Number(v)));
  if (idx.some((i) => i === 0 || Math.abs(i) > m.h || Number.isNaN(i))) return ERR.VALUE;
  return single(new Matrix(idx.map((i) => m.rows[i > 0 ? i - 1 : m.h + i])));
});
