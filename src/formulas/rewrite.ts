/**
 * Token-level formula rewriting. Working on tokens instead of the AST keeps the
 * user's spacing and capitalisation intact.
 */
import { colName, MAX_COLS, MAX_ROWS, quoteSheet } from '@/engine/address';
import type { Range } from '@/types';
import { tokenize, type RefInfo, type RefPoint } from './tokenizer';

const REF_ERROR = '#REF!';

function pointText(p: RefPoint): string {
  return `${p.absC ? '$' : ''}${colName(p.c)}${p.absR ? '$' : ''}${p.r + 1}`;
}

/** Serialises a reference back to text. */
export function refText(ref: RefInfo): string {
  const prefix = ref.sheet === null ? '' : `${quoteSheet(ref.sheet)}!`;
  switch (ref.kind) {
    case 'cell':
      return prefix + pointText(ref.a);
    case 'range':
      return `${prefix}${pointText(ref.a)}:${pointText(ref.b)}`;
    case 'cols':
      return `${prefix}${ref.a.absC ? '$' : ''}${colName(ref.a.c)}:${ref.b.absC ? '$' : ''}${colName(ref.b.c)}`;
    case 'rows':
      return `${prefix}${ref.a.absR ? '$' : ''}${ref.a.r + 1}:${ref.b.absR ? '$' : ''}${ref.b.r + 1}`;
  }
}

/** Maps every reference in a formula. Return `null` to turn a reference into `#REF!`. */
export function mapRefs(formula: string, fn: (ref: RefInfo) => RefInfo | null): string {
  if (!formula.startsWith('=')) return formula;
  let out = '';
  let last = 0;
  for (const t of tokenize(formula)) {
    if (t.type !== 'ref') continue;
    const mapped = fn(t.ref!);
    if (mapped === t.ref) continue;
    out += formula.slice(last, t.start);
    out += mapped ? refText(mapped) : REF_ERROR;
    last = t.end;
  }
  return last === 0 ? formula : out + formula.slice(last);
}

function shiftPoint(p: RefPoint, dr: number, dc: number): RefPoint | null {
  const r = p.absR ? p.r : p.r + dr;
  const c = p.absC ? p.c : p.c + dc;
  if (r < 0 || c < 0 || r >= MAX_ROWS || c >= MAX_COLS) return null;
  return { ...p, r, c };
}

/** Adjusts relative references as if the formula was copied by (dr, dc). */
export function shiftFormula(formula: string, dr: number, dc: number): string {
  if (dr === 0 && dc === 0) return formula;
  return mapRefs(formula, (ref) => {
    const a = shiftPoint(ref.a, dr, dc);
    const b = ref.kind === 'cell' ? a : shiftPoint(ref.b, dr, dc);
    return a && b ? { ...ref, a, b } : null;
  });
}

export interface StructureChange {
  axis: 'row' | 'col';
  kind: 'insert' | 'delete';
  index: number;
  count: number;
}

/** Shifts an inclusive interval. Returns null when it is deleted entirely. */
export function shiftInterval(lo: number, hi: number, change: StructureChange): [number, number] | null {
  const { index, count } = change;
  if (change.kind === 'insert') {
    return [lo >= index ? lo + count : lo, hi >= index ? hi + count : hi];
  }
  const end = index + count - 1;
  if (lo >= index && hi <= end) return null;
  const newLo = lo < index ? lo : lo > end ? lo - count : index;
  const newHi = hi < index ? hi : hi > end ? hi - count : index - 1;
  return [newLo, newHi];
}

export function shiftRange(range: Range, change: StructureChange): Range | null {
  const isRow = change.axis === 'row';
  const max = (isRow ? MAX_ROWS : MAX_COLS) - 1;
  const lo = isRow ? range.r1 : range.c1;
  const hi = isRow ? range.r2 : range.c2;
  if (lo === 0 && hi === max) return range;
  const moved = shiftInterval(lo, hi, change);
  if (!moved || moved[0] > max) return null;
  const h = Math.min(moved[1], max);
  return isRow ? { ...range, r1: moved[0], r2: h } : { ...range, c1: moved[0], c2: h };
}

/** Rewrites references after rows or columns were inserted into or deleted from a sheet. */
export function applyStructureToFormula(formula: string, ownSheet: string, changedSheet: string, change: StructureChange): string {
  const target = changedSheet.toLowerCase();
  return mapRefs(formula, (ref) => {
    if ((ref.sheet ?? ownSheet).toLowerCase() !== target) return ref;
    if (change.axis === 'row' ? ref.kind === 'cols' : ref.kind === 'rows') return ref;
    const isRow = change.axis === 'row';
    const av = isRow ? ref.a.r : ref.a.c;
    const bv = isRow ? ref.b.r : ref.b.c;
    const moved = shiftInterval(Math.min(av, bv), Math.max(av, bv), change);
    const max = (isRow ? MAX_ROWS : MAX_COLS) - 1;
    if (!moved || moved[0] > max) return null;
    const lo = moved[0];
    const hi = Math.min(moved[1], max);
    const [na, nb] = av <= bv ? [lo, hi] : [hi, lo];
    if (na === av && nb === bv) return ref;
    return isRow
      ? { ...ref, a: { ...ref.a, r: na }, b: { ...ref.b, r: nb } }
      : { ...ref, a: { ...ref.a, c: na }, b: { ...ref.b, c: nb } };
  });
}

/**
 * Rewrites references to cells inside `rect` on `fromSheet` after they were
 * moved by (dr, dc), optionally to another sheet. Ranges move only when they
 * are fully inside the moved rectangle.
 */
export function relocateRefs(
  formula: string,
  ownSheet: string,
  fromSheet: string,
  rect: Range,
  dr: number,
  dc: number,
  toSheet: string,
): string {
  const from = fromSheet.toLowerCase();
  return mapRefs(formula, (ref) => {
    if ((ref.sheet ?? ownSheet).toLowerCase() !== from) return ref;
    if (ref.kind === 'cols' || ref.kind === 'rows') return ref;
    const r1 = Math.min(ref.a.r, ref.b.r);
    const r2 = Math.max(ref.a.r, ref.b.r);
    const c1 = Math.min(ref.a.c, ref.b.c);
    const c2 = Math.max(ref.a.c, ref.b.c);
    if (r1 < rect.r1 || r2 > rect.r2 || c1 < rect.c1 || c2 > rect.c2) return ref;
    const sheet = toSheet === fromSheet ? ref.sheet : ownSheet.toLowerCase() === toSheet.toLowerCase() ? null : toSheet;
    const a = { ...ref.a, r: ref.a.r + dr, c: ref.a.c + dc };
    const b = { ...ref.b, r: ref.b.r + dr, c: ref.b.c + dc };
    if (a.r < 0 || a.c < 0 || b.r >= MAX_ROWS || b.c >= MAX_COLS) return null;
    return { ...ref, sheet, a, b };
  });
}

/** Rewrites sheet prefixes after a sheet was renamed. */
export function renameSheetInFormula(formula: string, oldName: string, newName: string): string {
  const target = oldName.toLowerCase();
  return mapRefs(formula, (ref) => (ref.sheet !== null && ref.sheet.toLowerCase() === target ? { ...ref, sheet: newName } : ref));
}

/** Turns references to a deleted sheet into `#REF!`. */
export function dropSheetFromFormula(formula: string, name: string): string {
  const target = name.toLowerCase();
  return mapRefs(formula, (ref) => (ref.sheet !== null && ref.sheet.toLowerCase() === target ? null : ref));
}

/** Adds a sheet prefix to local references (used when a formula leaves its sheet). */
export function qualifyRefs(formula: string, sheet: string): string {
  return mapRefs(formula, (ref) => (ref.sheet === null ? { ...ref, sheet } : ref));
}

/** Cycles A1 -> $A$1 -> A$1 -> $A1 -> A1 for the reference at the caret (F4). */
export function cycleAbsolute(text: string, caret: number): { text: string; caret: number } | null {
  const token = tokenize(text).find((t) => t.type === 'ref' && caret >= t.start && caret <= t.end);
  if (!token) return null;
  const ref = token.ref!;
  const { absR, absC } = ref.a;
  let next: { absR: boolean; absC: boolean };
  if (ref.kind === 'cols') next = { absR: true, absC: !absC };
  else if (ref.kind === 'rows') next = { absR: !absR, absC: true };
  else if (!absR && !absC) next = { absR: true, absC: true };
  else if (absR && absC) next = { absR: true, absC: false };
  else if (absR) next = { absR: false, absC: true };
  else next = { absR: false, absC: false };
  const updated = refText({ ...ref, a: { ...ref.a, ...next }, b: { ...ref.b, ...next } });
  return { text: text.slice(0, token.start) + updated + text.slice(token.end), caret: token.start + updated.length };
}
