import { colName, quoteSheet, splitSheetRef, parseRangeName } from '@/engine/address';
import { hasWildcard, wildcardRegex } from '../criteria';
import { broadcast, clipRef, deref, evaluate, type EvalScope } from '../evaluator';
import { registrar } from '../registry';
import { compareScalars, ERR, isError, Matrix, RefValue, scalarsEqual, type EvalValue, type Scalar } from '../values';
import { bool, int, matrixOf, numOf, scalarOf, single, text } from './helpers';

const f = registrar('Lookup');

/** Uniform random access over references and arrays without materialising them. */
interface Grid {
  h: number;
  w: number;
  at(r: number, c: number): Scalar;
}

function grid(v: EvalValue, s: EvalScope): Grid {
  if (v instanceof RefValue) {
    const ref = clipRef(v, s.ctx);
    return { h: ref.h, w: ref.w, at: (r, c) => s.ctx.readCell(ref.sheetId, ref.r1 + r, ref.c1 + c) };
  }
  return matrixOf(v, s);
}

type Vector = { n: number; at(i: number): Scalar };

function vector(g: Grid): Vector | null {
  if (g.w === 1) return { n: g.h, at: (i) => g.at(i, 0) };
  if (g.h === 1) return { n: g.w, at: (i) => g.at(0, i) };
  return null;
}

function exactIndex(v: Vector, target: Scalar, wildcard: boolean, reverse = false): number {
  const re = wildcard && typeof target === 'string' && hasWildcard(target) ? wildcardRegex(target) : null;
  for (let k = 0; k < v.n; k++) {
    const i = reverse ? v.n - 1 - k : k;
    const x = v.at(i);
    if (x === null || isError(x)) continue;
    if (re ? typeof x === 'string' && re.test(x) : typeof x === typeof target && scalarsEqual(x, target)) return i;
  }
  return -1;
}

/** Largest index whose value is <= target, assuming ascending order. */
function approxIndex(v: Vector, target: Scalar): number {
  let lo = 0;
  let hi = v.n - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    let x = v.at(mid);
    let probe = mid;
    // Skip blanks and values of another type, as they do not take part in the search.
    while (probe > lo && (x === null || isError(x) || typeof x !== typeof target)) x = v.at(--probe);
    if (x === null || isError(x) || typeof x !== typeof target) {
      lo = mid + 1;
      continue;
    }
    if (compareScalars(x, target) <= 0) {
      best = probe;
      lo = mid + 1;
    } else hi = probe - 1;
  }
  return best;
}

function eachTarget(v: EvalValue, s: EvalScope, fn: (target: Scalar) => Scalar): EvalValue {
  return broadcast([deref(v, s.ctx)], ([t]) => (isError(t) ? t : fn(t)));
}

f.range('VLOOKUP', 'lookup_value, table_array, col_index_num, [range_lookup]', 'Looks for a value in the leftmost column and returns a value in the same row.', (args, s) => {
  const g = grid(args[1], s);
  const col = Math.trunc(numOf(args[2], s));
  const approx = args[3] === undefined ? true : bool(scalarOf(args[3], s));
  if (col < 1) return ERR.VALUE;
  if (col > g.w) return ERR.REF;
  const keys: Vector = { n: g.h, at: (i) => g.at(i, 0) };
  return eachTarget(args[0], s, (t) => {
    const i = approx ? approxIndex(keys, t ?? 0) : exactIndex(keys, t ?? 0, true);
    return i < 0 ? ERR.NA : (g.at(i, col - 1) ?? 0);
  });
});

f.range('HLOOKUP', 'lookup_value, table_array, row_index_num, [range_lookup]', 'Looks for a value in the top row and returns a value in the same column.', (args, s) => {
  const g = grid(args[1], s);
  const row = Math.trunc(numOf(args[2], s));
  const approx = args[3] === undefined ? true : bool(scalarOf(args[3], s));
  if (row < 1) return ERR.VALUE;
  if (row > g.h) return ERR.REF;
  const keys: Vector = { n: g.w, at: (i) => g.at(0, i) };
  return eachTarget(args[0], s, (t) => {
    const i = approx ? approxIndex(keys, t ?? 0) : exactIndex(keys, t ?? 0, true);
    return i < 0 ? ERR.NA : (g.at(row - 1, i) ?? 0);
  });
});

f.range('LOOKUP', 'lookup_value, lookup_vector, [result_vector]', 'Looks up a value in a one-row or one-column range.', (args, s) => {
  const g = grid(args[1], s);
  const keys: Vector = vector(g) ?? (g.w > g.h ? { n: g.w, at: (i) => g.at(0, i) } : { n: g.h, at: (i) => g.at(i, 0) });
  const rg = args[2] !== undefined ? grid(args[2], s) : g;
  const results: Vector | null = args[2] !== undefined ? vector(rg) : g.w > g.h ? { n: g.w, at: (i) => g.at(g.h - 1, i) } : { n: g.h, at: (i) => g.at(i, g.w - 1) };
  if (!results) return ERR.NA;
  return eachTarget(args[0], s, (t) => {
    const i = approxIndex(keys, t ?? 0);
    return i < 0 ? ERR.NA : (results.at(i) ?? 0);
  });
});

function xIndex(keys: Vector, t: Scalar, matchMode: number, searchMode: number): number {
  const reverse = searchMode < 0;
  const target = t ?? '';
  const exact = exactIndex(keys, target, matchMode === 2, reverse);
  if (exact >= 0 || matchMode === 0 || matchMode === 2) return exact;
  let best = -1;
  for (let i = 0; i < keys.n; i++) {
    const x = keys.at(i);
    if (x === null || isError(x) || typeof x !== typeof target) continue;
    const cmp = compareScalars(x, target);
    if (matchMode < 0 ? cmp > 0 : cmp < 0) continue;
    if (best < 0 || (matchMode < 0 ? compareScalars(x, keys.at(best)) > 0 : compareScalars(x, keys.at(best)) < 0)) best = i;
  }
  return best;
}

f.range('XLOOKUP', 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]', 'Searches a range for a match and returns the corresponding item from a second range.', (args, s) => {
  const keyGrid = grid(args[1], s);
  const keys = vector(keyGrid);
  if (!keys) return ERR.VALUE;
  const vertical = keyGrid.w === 1;
  const ret = grid(args[2], s);
  const mode = args[4] === undefined ? 0 : Math.trunc(numOf(args[4], s, 0));
  const search = args[5] === undefined ? 1 : Math.trunc(numOf(args[5], s, 1));
  const missing = args[3];
  const notFound = (): EvalValue => (missing === undefined || missing === null ? ERR.NA : missing);

  const target = deref(args[0], s.ctx);
  const width = vertical ? ret.w : ret.h;
  if (target instanceof Matrix && width === 1) {
    return broadcast([target], ([t]) => {
      if (isError(t)) return t;
      const i = xIndex(keys, t, mode, search);
      if (i < 0) {
        const nf = notFound();
        return nf instanceof Matrix || nf instanceof RefValue ? scalarOf(nf, s) : nf;
      }
      return (vertical ? ret.at(i, 0) : ret.at(0, i)) ?? 0;
    });
  }
  const t = target instanceof Matrix ? target.at(0, 0) : target;
  if (isError(t)) return t;
  const i = xIndex(keys, t, mode, search);
  if (i < 0) return notFound();
  if (vertical) return single(new Matrix([Array.from({ length: ret.w }, (_, c) => ret.at(i, c) ?? 0)]));
  return single(new Matrix(Array.from({ length: ret.h }, (_, r) => [ret.at(r, i) ?? 0])));
});

f.range('MATCH', 'lookup_value, lookup_array, [match_type]', 'Returns the relative position of an item that matches a value.', (args, s) => {
  const keys = vector(grid(args[1], s));
  if (!keys) return ERR.NA;
  const type = args[2] === undefined ? 1 : Math.sign(numOf(args[2], s, 0));
  return eachTarget(args[0], s, (t) => {
    const target = t ?? 0;
    let i: number;
    if (type === 0) i = exactIndex(keys, target, true);
    else if (type > 0) i = approxIndex(keys, target);
    else {
      i = -1;
      for (let k = 0; k < keys.n; k++) {
        const x = keys.at(k);
        if (x === null || isError(x) || typeof x !== typeof target) continue;
        if (compareScalars(x, target) < 0) break;
        i = k;
      }
    }
    return i < 0 ? ERR.NA : i + 1;
  });
});

f.range('XMATCH', 'lookup_value, lookup_array, [match_mode], [search_mode]', 'Returns the relative position of an item in an array.', (args, s) => {
  const keys = vector(grid(args[1], s));
  if (!keys) return ERR.VALUE;
  const mode = args[2] === undefined ? 0 : Math.trunc(numOf(args[2], s, 0));
  const search = args[3] === undefined ? 1 : Math.trunc(numOf(args[3], s, 1));
  return eachTarget(args[0], s, (t) => {
    const i = xIndex(keys, t, mode, search);
    return i < 0 ? ERR.NA : i + 1;
  });
});

f.range('INDEX', 'array, row_num, [column_num]', 'Returns a value or reference from within a table or range.', (args, s) => {
  const source = args[0];
  if (isError(source)) return source;
  const area: { h: number; w: number } = source instanceof RefValue || source instanceof Matrix ? source : { h: 1, w: 1 };
  let row = args[1] === undefined ? 0 : Math.trunc(numOf(args[1], s, 0));
  let col = args[2] === undefined ? 0 : Math.trunc(numOf(args[2], s, 0));
  if (args[2] === undefined && area.h === 1 && area.w > 1) {
    col = row;
    row = 1;
  }
  if (row < 0 || col < 0) return ERR.VALUE;
  if (row > area.h || col > area.w) return ERR.REF;
  if (source instanceof RefValue) {
    const r1 = row ? source.r1 + row - 1 : source.r1;
    const r2 = row ? r1 : source.r2;
    const c1 = col ? source.c1 + col - 1 : source.c1;
    const c2 = col ? c1 : source.c2;
    return new RefValue(source.sheetId, r1, c1, r2, c2);
  }
  const m = matrixOf(source, s);
  const rows = row ? [m.rows[row - 1]] : m.rows;
  return single(new Matrix(rows.map((r) => (col ? [r[col - 1]] : r))));
});

f.volatileRange('OFFSET', 'reference, rows, cols, [height], [width]', 'Returns a reference offset from a given reference.', (args, s) => {
  const ref = args[0];
  if (!(ref instanceof RefValue)) return ERR.VALUE;
  const r1 = ref.r1 + Math.trunc(numOf(args[1], s, 0));
  const c1 = ref.c1 + Math.trunc(numOf(args[2], s, 0));
  const h = args[3] === undefined || args[3] === null ? ref.h : Math.trunc(numOf(args[3], s));
  const w = args[4] === undefined || args[4] === null ? ref.w : Math.trunc(numOf(args[4], s));
  if (h === 0 || w === 0) return ERR.REF;
  const top = h > 0 ? r1 : r1 + h + 1;
  const left = w > 0 ? c1 : c1 + w + 1;
  if (top < 0 || left < 0) return ERR.REF;
  return new RefValue(ref.sheetId, top, left, top + Math.abs(h) - 1, left + Math.abs(w) - 1);
});

f.volatileRange('INDIRECT', 'ref_text', 'Returns the reference specified by a text string.', (args, s) => {
  const t = text(scalarOf(args[0], s));
  const { sheet, local } = splitSheetRef(t);
  const sheetId = sheet === null ? s.sheetId : s.ctx.sheetIdByName(sheet);
  const range = parseRangeName(local);
  if (!range) {
    const named = sheet === null ? s.ctx.resolveName(t) : null;
    return named ? evaluate(named, s) : ERR.REF;
  }
  return sheetId ? new RefValue(sheetId, range.r1, range.c1, range.r2, range.c2) : ERR.REF;
});

f.range('ROW', '[reference]', 'Returns the row number of a reference.', (args, s) => {
  const ref = args[0];
  if (ref === undefined) return s.r + 1;
  if (!(ref instanceof RefValue)) return isError(ref) ? ref : ERR.VALUE;
  if (ref.h === 1) return ref.r1 + 1;
  const clipped = clipRef(ref, s.ctx);
  return new Matrix(Array.from({ length: clipped.h }, (_, i) => [clipped.r1 + i + 1]));
});
f.range('COLUMN', '[reference]', 'Returns the column number of a reference.', (args, s) => {
  const ref = args[0];
  if (ref === undefined) return s.c + 1;
  if (!(ref instanceof RefValue)) return isError(ref) ? ref : ERR.VALUE;
  if (ref.w === 1) return ref.c1 + 1;
  const clipped = clipRef(ref, s.ctx);
  return new Matrix([Array.from({ length: clipped.w }, (_, i) => clipped.c1 + i + 1)]);
});
f.range('ROWS', 'array', 'Returns the number of rows in a reference or array.', (args) => {
  const a = args[0];
  if (isError(a)) return a;
  return a instanceof RefValue || a instanceof Matrix ? a.h : 1;
});
f.range('COLUMNS', 'array', 'Returns the number of columns in a reference or array.', (args) => {
  const a = args[0];
  if (isError(a)) return a;
  return a instanceof RefValue || a instanceof Matrix ? a.w : 1;
});
f.scalar('ADDRESS', 'row_num, column_num, [abs_num], [a1], [sheet_text]', 'Creates a cell address as text.', ([r, c, abs, a1, sheet]) => {
  const row = int(r);
  const col = int(c);
  const mode = int(abs, 1);
  if (row < 1 || col < 1) return ERR.VALUE;
  const prefix = sheet === undefined || sheet === null ? '' : `${quoteSheet(text(sheet))}!`;
  if (a1 !== undefined && a1 !== null && !bool(a1)) {
    return `${prefix}${mode === 1 || mode === 2 ? `R${row}` : `R[${row}]`}${mode === 1 || mode === 3 ? `C${col}` : `C[${col}]`}`;
  }
  return `${prefix}${mode === 1 || mode === 3 ? '$' : ''}${colName(col - 1)}${mode === 1 || mode === 2 ? '$' : ''}${row}`;
});
f.scalar('HYPERLINK', 'link_location, [friendly_name]', 'Creates a link that opens a web address.', ([link, name]) => (name === undefined || name === null ? text(link) : name));
f.range('FORMULATEXT', 'reference', 'Returns a formula as text.', (args, s) => {
  const ref = args[0];
  if (!(ref instanceof RefValue)) return ERR.NA;
  return s.ctx.formulaAt(ref.sheetId, ref.r1, ref.c1) ?? ERR.NA;
});
