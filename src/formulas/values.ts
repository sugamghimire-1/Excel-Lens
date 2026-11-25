import { CellError, type CellScalar, type ErrorCode } from '@/types';

/** Scalar result of evaluating an expression. */
export type Scalar = CellScalar;

/** A materialised two-dimensional array. */
export class Matrix {
  constructor(readonly rows: Scalar[][]) {}
  get h(): number {
    return this.rows.length;
  }
  get w(): number {
    return this.rows[0]?.length ?? 0;
  }
  at(r: number, c: number): Scalar {
    return this.rows[r]?.[c] ?? null;
  }
}

/** A lazy pointer to a rectangle on a sheet. */
export class RefValue {
  constructor(
    readonly sheetId: string,
    readonly r1: number,
    readonly c1: number,
    readonly r2: number,
    readonly c2: number,
  ) {}
  get h(): number {
    return this.r2 - this.r1 + 1;
  }
  get w(): number {
    return this.c2 - this.c1 + 1;
  }
  get single(): boolean {
    return this.r1 === this.r2 && this.c1 === this.c2;
  }
}

export type EvalValue = Scalar | Matrix | RefValue;

export const ERR: Record<'DIV0' | 'VALUE' | 'REF' | 'NAME' | 'NA' | 'NUM' | 'NULL' | 'SPILL' | 'CALC' | 'CIRC', CellError> = {
  DIV0: new CellError('#DIV/0!'),
  VALUE: new CellError('#VALUE!'),
  REF: new CellError('#REF!'),
  NAME: new CellError('#NAME?'),
  NA: new CellError('#N/A'),
  NUM: new CellError('#NUM!'),
  NULL: new CellError('#NULL!'),
  SPILL: new CellError('#SPILL!'),
  CALC: new CellError('#CALC!'),
  CIRC: new CellError('#CIRC!'),
};

const BY_CODE = new Map<string, CellError>(Object.values(ERR).map((e) => [e.code, e]));

export function errorFromCode(code: string): CellError | null {
  return BY_CODE.get(code.toUpperCase() as ErrorCode) ?? null;
}

export function isError(v: unknown): v is CellError {
  return v instanceof CellError;
}

/* ------------------------------------------------------------------ dates */

const MS_PER_DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);

/** Converts a calendar date to a serial number (1900 date system). */
export function dateToSerial(y: number, m: number, d: number, h = 0, min = 0, s = 0): number {
  return (Date.UTC(y, m - 1, d, h, min, s) - EPOCH) / MS_PER_DAY;
}

/** Converts a serial number to a UTC `Date` that holds the wall-clock fields. */
export function serialToDate(serial: number): Date {
  // Round to the nearest millisecond so 0.1 + 0.2 style noise never drops a second.
  return new Date(EPOCH + Math.round(serial * MS_PER_DAY));
}

/** Serial number for a local JavaScript date. */
export function localDateToSerial(d: Date): number {
  return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function monthIndex(text: string): number {
  return MONTHS.indexOf(text.slice(0, 3).toLowerCase());
}

function validDate(y: number, m: number, d: number): number | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 9999) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return dateToSerial(y, m, d);
}

function fullYear(text: string): number {
  const n = Number(text);
  if (text.length > 2) return n;
  return n < 30 ? 2000 + n : 1900 + n;
}

export interface ParsedDate {
  serial: number;
  hasDate: boolean;
  hasTime: boolean;
  format: string;
}

function parseTime(text: string): { value: number; format: string } | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([AaPp])\.?[Mm]?\.?$/.exec(text) ?? /^(\d{1,3}):(\d{2})(?::(\d{2})(?:\.\d+)?)?()$/.exec(text);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2]);
  const s = m[3] ? Number(m[3]) : 0;
  if (min > 59 || s > 59) return null;
  const half = m[4]?.toLowerCase();
  if (half) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (half === 'p' ? 12 : 0);
  }
  const sec = m[3] ? ':ss' : '';
  return { value: (h * 3600 + min * 60 + s) / 86400, format: half ? `h:mm${sec} AM/PM` : `h:mm${sec}` };
}

function parseDateOnly(text: string): { serial: number; format: string } | null {
  let m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const serial = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    return serial === null ? null : { serial, format: 'yyyy-mm-dd' };
  }
  m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})$/.exec(text);
  if (m) {
    const serial = validDate(fullYear(m[3]), Number(m[1]), Number(m[2]));
    return serial === null ? null : { serial, format: 'm/d/yyyy' };
  }
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (m) {
    const serial = validDate(new Date().getFullYear(), Number(m[1]), Number(m[2]));
    return serial === null ? null : { serial, format: 'd-mmm' };
  }
  m = /^(\d{1,2})[-\s]([A-Za-z]{3,9})(?:[-\s,]+(\d{4}|\d{2}))?$/.exec(text);
  if (m && monthIndex(m[2]) >= 0) {
    const serial = validDate(m[3] ? fullYear(m[3]) : new Date().getFullYear(), monthIndex(m[2]) + 1, Number(m[1]));
    return serial === null ? null : { serial, format: m[3] ? 'd-mmm-yy' : 'd-mmm' };
  }
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m && monthIndex(m[1]) >= 0) {
    const serial = validDate(Number(m[3]), monthIndex(m[1]) + 1, Number(m[2]));
    return serial === null ? null : { serial, format: 'mmm d, yyyy' };
  }
  m = /^([A-Za-z]{3,9})[-\s](\d{4}|\d{2})$/.exec(text);
  if (m && monthIndex(m[1]) >= 0 && /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(m[1])) {
    const serial = validDate(fullYear(m[2]), monthIndex(m[1]) + 1, 1);
    return serial === null ? null : { serial, format: 'mmm-yy' };
  }
  return null;
}

/** Parses common date, time and date-time spellings into a serial number. */
export function parseDateText(raw: string): ParsedDate | null {
  const text = raw.trim();
  if (!/\d/.test(text)) return null;
  const time = parseTime(text);
  if (time) return { serial: time.value, hasDate: false, hasTime: true, format: time.format };
  const date = parseDateOnly(text);
  if (date) return { serial: date.serial, hasDate: true, hasTime: false, format: date.format };
  const split = /^(.*?)[T\s]+(\d{1,2}:\d{2}.*)$/.exec(text);
  if (split) {
    const d = parseDateOnly(split[1].trim());
    const t = parseTime(split[2].replace(/Z$/, '').trim());
    if (d && t) return { serial: d.serial + t.value, hasDate: true, hasTime: true, format: `${d.format} h:mm` };
  }
  return null;
}

/* --------------------------------------------------------------- coercion */

const PLAIN_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d*)?(?:[eE][+-]?\d+)?$/;

/** Parses numeric text such as `1,234.5`, `12%`, `$40` and `(3)`. */
export function parseNumberText(raw: string): number | null {
  let t = raw.trim();
  if (!t || !/\d/.test(t)) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(t)) {
    sign = -1;
    t = t.slice(1, -1).trim();
  }
  if (/^[+-]?[$€£¥₹]/.test(t)) t = t.replace(/[$€£¥₹]\s*/, '');
  let scale = 1;
  if (t.endsWith('%')) {
    scale = 0.01;
    t = t.slice(0, -1).trim();
  }
  if (!PLAIN_NUMBER.test(t)) return null;
  const n = Number(t.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  // Divide instead of multiplying by 0.01 to keep 7% === 0.07 exactly.
  return scale === 1 ? sign * n : (sign * n) / 100;
}

export function toNumber(v: Scalar): number | CellError {
  if (typeof v === 'number') return v;
  if (v === null) return 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof CellError) return v;
  const n = parseNumberText(v);
  if (n !== null) return n;
  const d = parseDateText(v);
  return d ? d.serial : ERR.VALUE;
}

export function toText(v: Scalar): string | CellError {
  if (typeof v === 'string') return v;
  if (v === null) return '';
  if (typeof v === 'number') return numberToText(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v;
}

export function toBool(v: Scalar): boolean | CellError {
  if (typeof v === 'boolean') return v;
  if (v === null) return false;
  if (typeof v === 'number') return v !== 0;
  if (v instanceof CellError) return v;
  if (/^true$/i.test(v)) return true;
  if (/^false$/i.test(v)) return false;
  return ERR.VALUE;
}

/** Shortest faithful text for a number, limited to 15 significant digits. */
export function numberToText(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const t = Number(n.toPrecision(15));
  const abs = Math.abs(t);
  if (abs !== 0 && (abs >= 1e21 || abs < 1e-9)) {
    return t.toExponential().replace('e', 'E').replace(/E([+-])(\d)$/, 'E$10$2');
  }
  return String(t);
}

/** Ordering used by comparison operators and sorting: numbers < text < booleans. */
function typeRank(v: Scalar): number {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  return 2;
}

const collator = new Intl.Collator('en', { sensitivity: 'accent', numeric: false });

export function compareText(a: string, b: string): number {
  return collator.compare(a, b);
}

export function compareScalars(a: Scalar, b: Scalar): number {
  if (a === null && b === null) return 0;
  let x: Scalar = a;
  let y: Scalar = b;
  if (x === null) x = typeof y === 'string' ? '' : typeof y === 'boolean' ? false : 0;
  if (y === null) y = typeof x === 'string' ? '' : typeof x === 'boolean' ? false : 0;
  const ra = typeRank(x);
  const rb = typeRank(y);
  if (ra !== rb) return ra - rb;
  if (typeof x === 'number' && typeof y === 'number') return x === y ? 0 : x < y ? -1 : 1;
  if (typeof x === 'string' && typeof y === 'string') return compareText(x, y);
  return Number(x) - Number(y);
}

export function scalarsEqual(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.length === b.length && compareText(a, b) === 0;
  return compareScalars(a, b) === 0;
}
