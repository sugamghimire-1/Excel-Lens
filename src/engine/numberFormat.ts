/** Interpreter for spreadsheet number-format codes such as `#,##0.00;[Red](#,##0.00)`. */
import { CellError, type CellScalar } from '@/types';
import { numberToText, serialToDate } from '@/formulas/values';

/** Marks cells whose TRUE/FALSE value is drawn as a checkbox. */
export const CHECKBOX_FORMAT = '[Checkbox]';

export interface Formatted {
  text: string;
  /** Colour requested by the format, e.g. `[Red]`. */
  color?: string;
}

type Tok =
  | { t: 'lit'; v: string }
  | { t: 'digit'; v: '0' | '#' | '?' }
  | { t: 'point' }
  | { t: 'comma' }
  | { t: 'percent' }
  | { t: 'exp'; v: string }
  | { t: 'slash' }
  | { t: 'text' }
  | { t: 'general' }
  | { t: 'date'; v: string }
  | { t: 'elapsed'; v: string };

interface Section {
  tokens: Tok[];
  color?: string;
  condition?: { op: string; value: number };
  isDate: boolean;
  hasDigits: boolean;
}

const COLORS: Record<string, string> = {
  black: '#000000',
  blue: '#2457d6',
  cyan: '#0e8f9c',
  green: '#1c7c43',
  magenta: '#b83280',
  red: '#c62f2f',
  white: '#ffffff',
  yellow: '#b58900',
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function splitSections(code: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (ch === '"') quoted = !quoted;
    if (ch === '\\' && !quoted) {
      cur += ch + (code[++i] ?? '');
      continue;
    }
    if (ch === ';' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseSection(src: string): Section {
  const section: Section = { tokens: [], isDate: false, hasDigits: false };
  const { tokens } = section;
  const lit = (v: string): void => {
    const last = tokens[tokens.length - 1];
    if (last?.t === 'lit') last.v += v;
    else tokens.push({ t: 'lit', v });
  };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if (ch === '"') {
      const end = src.indexOf('"', i + 1);
      lit(src.slice(i + 1, end < 0 ? undefined : end));
      i = end < 0 ? src.length : end + 1;
    } else if (ch === '\\') {
      lit(src[i + 1] ?? '');
      i += 2;
    } else if (ch === '_') {
      lit(' ');
      i += 2;
    } else if (ch === '*') {
      // Fill characters need the column width, which the formatter does not know.
      i += 2;
    } else if (ch === '[') {
      const end = src.indexOf(']', i);
      const body = src.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? src.length : end + 1;
      const cond = /^(<=|>=|<>|<|>|=)(-?\d+(?:\.\d+)?)$/.exec(body);
      if (cond) section.condition = { op: cond[1], value: Number(cond[2]) };
      else if (/^(h+|m+|s+)$/i.test(body)) {
        tokens.push({ t: 'elapsed', v: body.toLowerCase() });
        section.isDate = true;
      } else if (COLORS[body.toLowerCase()]) section.color = COLORS[body.toLowerCase()];
      else if (body.startsWith('$')) lit(body.slice(1).split('-')[0]);
    } else if ((m = /^General/i.exec(rest))) {
      tokens.push({ t: 'general' });
      i += m[0].length;
    } else if ((m = /^(AM\/PM|A\/P)/i.exec(rest))) {
      tokens.push({ t: 'date', v: m[0].toUpperCase() });
      section.isDate = true;
      i += m[0].length;
    } else if ((m = /^E([+-])(0+)/i.exec(rest)) && section.hasDigits) {
      tokens.push({ t: 'exp', v: m[1] + m[2] });
      i += m[0].length;
    } else if ((m = /^(y+|m+|d+|h+|s+)/i.exec(rest))) {
      tokens.push({ t: 'date', v: m[0].toLowerCase() });
      section.isDate = true;
      i += m[0].length;
    } else if (ch === '0' || ch === '#' || ch === '?') {
      tokens.push({ t: 'digit', v: ch });
      section.hasDigits = true;
      i++;
    } else if (ch === '.') {
      tokens.push({ t: 'point' });
      i++;
    } else if (ch === ',') {
      tokens.push({ t: 'comma' });
      i++;
    } else if (ch === '%') {
      tokens.push({ t: 'percent' });
      i++;
    } else if (ch === '/' && section.hasDigits && !section.isDate) {
      tokens.push({ t: 'slash' });
      i++;
    } else if (ch === '@') {
      tokens.push({ t: 'text' });
      i++;
    } else {
      lit(ch);
      i++;
    }
  }
  return section;
}

const cache = new Map<string, Section[]>();

function sections(code: string): Section[] {
  let s = cache.get(code);
  if (!s) {
    s = splitSections(code).map(parseSection);
    cache.set(code, s);
  }
  return s;
}

/** True when a format code displays dates or times. */
export function isDateFormat(code: string | undefined): boolean {
  return code !== undefined && sections(code)[0].isDate;
}

export function isTextFormat(code: string | undefined): boolean {
  return code === '@';
}

export function isPercentFormat(code: string | undefined): boolean {
  return code !== undefined && sections(code)[0].tokens.some((t) => t.t === 'percent');
}

/** General format: up to 11 characters, switching to scientific when needed. */
export function formatGeneral(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e11) return String(n);
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e11 || abs < 1e-9)) {
    const [mant, exp] = n.toExponential(5).split('e');
    const e = Number(exp);
    return `${Number(mant)}E${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`;
  }
  const digits = Math.max(1, 10 - Math.max(0, Math.floor(Math.log10(abs))));
  // Trim by hand: String() would switch to exponent notation below 1e-6.
  return n.toFixed(Math.min(digits, 9)).replace(/\.?0+$/, '');
}

function matches(cond: { op: string; value: number }, n: number): boolean {
  switch (cond.op) {
    case '<':
      return n < cond.value;
    case '>':
      return n > cond.value;
    case '<=':
      return n <= cond.value;
    case '>=':
      return n >= cond.value;
    case '=':
      return n === cond.value;
    default:
      return n !== cond.value;
  }
}

function pickNumberSection(all: Section[], n: number): { section: Section; value: number } {
  const numeric = all.slice(0, 3);
  if (numeric.some((s) => s.condition)) {
    const hit = numeric.find((s) => s.condition && matches(s.condition, n)) ?? numeric.find((s) => !s.condition) ?? numeric[0];
    return { section: hit, value: n };
  }
  if (numeric.length >= 2 && n < 0) return { section: numeric[1], value: -n };
  if (numeric.length >= 3 && n === 0) return { section: numeric[2], value: 0 };
  return { section: numeric[0], value: n };
}

/** Formats a value with a format code. An empty code means General. */
export function formatValue(value: CellScalar, code?: string): Formatted {
  if (value === null) return { text: '' };
  if (value instanceof CellError) return { text: value.code };
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
  if (!code || code === 'General') return { text: typeof value === 'number' ? formatGeneral(value) : value };

  const all = sections(code);
  if (typeof value === 'string') {
    const s = all.length >= 4 ? all[3] : all.find((x) => x.tokens.some((t) => t.t === 'text'));
    if (!s) return { text: value };
    return { text: s.tokens.map((t) => (t.t === 'text' ? value : t.t === 'lit' ? t.v : '')).join(''), color: s.color };
  }

  const { section, value: n } = pickNumberSection(all, value);
  const { color } = section;
  if (section.isDate) return { text: formatDate(value, section), color };
  if (section.tokens.length === 0) return { text: '', color };
  const negative = n < 0;
  let body: string;
  if (section.tokens.some((t) => t.t === 'general')) {
    body = section.tokens.map((t) => (t.t === 'general' ? formatGeneral(Math.abs(n)) : t.t === 'lit' ? t.v : '')).join('');
  } else if (!section.hasDigits) {
    body = section.tokens
      .map((t) => (t.t === 'lit' ? t.v : t.t === 'text' ? numberToText(Math.abs(n)) : t.t === 'percent' ? '%' : ''))
      .join('');
    if (!section.tokens.some((t) => t.t === 'text')) return { text: body, color };
  } else if (section.tokens.some((t) => t.t === 'slash')) body = formatFraction(Math.abs(n), section);
  else body = formatNumeric(Math.abs(n), section);
  // A value that rounds to zero is displayed without a sign.
  const showSign = negative && /[1-9]/.test(body);
  return { text: showSign ? `-${body}` : body, color };
}

/* ----------------------------------------------------------------- numbers */

/** Decimal digits of a non-negative number, rounded half away from zero. */
function toDecimal(n: number, places: number): string {
  const p = Math.min(places, 20);
  if (n >= 1e21) return BigInt(Math.round(n)).toString() + (p ? `.${'0'.repeat(p)}` : '');
  const direct = n.toFixed(p);
  // toFixed works on the binary value (1.005 -> "1.00"); nudge by one ulp-scale step.
  const nudged = (n * (1 + 2 ** -51)).toFixed(p);
  return nudged === direct ? direct : nudged;
}

function formatNumeric(input: number, section: Section): string {
  const { tokens } = section;
  const percents = tokens.filter((t) => t.t === 'percent').length;
  const pointAt = tokens.findIndex((t) => t.t === 'point');
  const expAt = tokens.findIndex((t) => t.t === 'exp');
  const digitIdx = tokens.map((t, i) => (t.t === 'digit' ? i : -1)).filter((i) => i >= 0);
  const mantissaEnd = expAt >= 0 ? expAt : tokens.length;
  const intEnd = pointAt >= 0 ? pointAt : mantissaEnd;
  const intDigits = digitIdx.filter((i) => i < intEnd);
  const fracDigits = digitIdx.filter((i) => i > intEnd && i < mantissaEnd);

  // Commas between digits group thousands; commas after the last digit scale by 1000.
  const lastDigit = (fracDigits.length ? fracDigits : intDigits)[(fracDigits.length ? fracDigits : intDigits).length - 1] ?? -1;
  let grouping = false;
  let scale = 0;
  tokens.forEach((t, i) => {
    if (t.t !== 'comma') return;
    if (intDigits.length && i > intDigits[0] && i < intDigits[intDigits.length - 1]) grouping = true;
    else if (i > lastDigit && lastDigit >= 0) scale++;
  });

  let n = input;
  if (percents) n = Number((n * 100 ** percents).toPrecision(15));
  if (scale) n /= 1000 ** scale;

  let exponent = 0;
  if (expAt >= 0 && n !== 0) {
    const width = Math.max(1, intDigits.length);
    exponent = Math.floor(Math.log10(n) + 1e-12);
    exponent = width > 1 ? Math.floor(exponent / width) * width : exponent;
    n /= 10 ** exponent;
    if (Number(toDecimal(n, fracDigits.length)) >= 10 ** width) {
      n /= 10 ** width;
      exponent += width;
    }
  }

  const [intRaw, fracRaw = ''] = toDecimal(n, fracDigits.length).split('.');
  const intText = intRaw === '0' ? '' : intRaw;
  const out: string[] = new Array(tokens.length).fill('');

  // Integer digits are placed right to left.
  let left = intText;
  let placed = 0;
  for (let k = intDigits.length - 1; k >= 0; k--) {
    const tok = tokens[intDigits[k]] as { t: 'digit'; v: string };
    let piece = '';
    const take = (ch: string): void => {
      if (grouping && placed > 0 && placed % 3 === 0) piece = `,${piece}`;
      piece = ch + piece;
      placed++;
    };
    if (left.length) {
      take(left[left.length - 1]);
      left = left.slice(0, -1);
      if (k === 0) while (left.length) {
        take(left[left.length - 1]);
        left = left.slice(0, -1);
      }
    } else if (tok.v === '0') take('0');
    else if (tok.v === '?') piece = ' ';
    out[intDigits[k]] = piece;
  }
  if (!intDigits.length && intText) out[Math.max(0, pointAt)] = intText;

  // Optional fraction digits (#) are trimmed from the right.
  let keep = fracRaw.length;
  for (let k = fracDigits.length - 1; k >= 0; k--) {
    const tok = tokens[fracDigits[k]] as { t: 'digit'; v: string };
    if (fracRaw[k] !== '0' || tok.v === '0') break;
    keep = k;
    if (tok.v === '?') out[fracDigits[k]] = ' ';
  }
  fracDigits.forEach((ti, k) => {
    if (k < keep) out[ti] = fracRaw[k] ?? '';
  });

  tokens.forEach((t, i) => {
    if (t.t === 'lit') out[i] = t.v;
    else if (t.t === 'percent') out[i] = '%';
    else if (t.t === 'point' && i === pointAt) out[i] = `${out[i]}.`;
    else if (t.t === 'exp') {
      const e = String(Math.abs(exponent)).padStart(t.v.length - 1, '0');
      out[i] = `E${exponent < 0 ? '-' : t.v[0] === '+' ? '+' : ''}${e}`;
    }
  });
  return out.join('');
}

function formatFraction(n: number, section: Section): string {
  const { tokens } = section;
  const slash = tokens.findIndex((t) => t.t === 'slash');
  const denTokens = tokens.slice(slash + 1);
  const denLit = denTokens.find((t) => t.t === 'lit' && /^\d+/.test(t.v)) as { v: string } | undefined;
  const denDigits = denTokens.filter((t) => t.t === 'digit').length;
  const hasWhole = tokens.slice(0, slash).some((t, i, arr) => t.t === 'lit' && /\s/.test(t.v) && arr.slice(0, i).some((x) => x.t === 'digit'));
  const whole = hasWhole ? Math.floor(n) : 0;
  const frac = n - whole;
  let best = { num: 0, den: 1 };
  if (denLit) {
    const den = Number.parseInt(denLit.v, 10);
    best = { num: Math.round(frac * den), den };
  } else {
    const max = 10 ** Math.max(1, denDigits) - 1;
    let err = Infinity;
    for (let den = 1; den <= max; den++) {
      const num = Math.round(frac * den);
      const e = Math.abs(frac - num / den);
      if (e < err - 1e-12) {
        err = e;
        best = { num, den };
      }
    }
  }
  if (hasWhole) {
    if (best.num === 0) return String(whole);
    if (best.num === best.den) return String(whole + 1);
    return `${whole ? `${whole} ` : ''}${best.num}/${best.den}`;
  }
  return `${best.num}/${best.den}`;
}

/* ------------------------------------------------------------------- dates */

function formatDate(serial: number, section: Section): string {
  if (serial < 0 || serial >= 2_958_466) return '########';
  const { tokens } = section;
  const ampm = tokens.some((t) => t.t === 'date' && (t.v === 'AM/PM' || t.v === 'A/P'));
  const d = serialToDate(serial);
  const pad = (n: number, len: number): string => String(n).padStart(len, '0');
  const totalSeconds = Math.round(serial * 86400);

  const isMinute = (index: number): boolean => {
    for (let i = index - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t.t === 'date') {
        if (/^h/.test(t.v)) return true;
        if (/^s/.test(t.v)) continue;
        break;
      }
      if (t.t === 'elapsed') return /^h/.test(t.v);
    }
    for (let i = index + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.t === 'date') return /^s/.test(t.v);
    }
    return false;
  };

  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    switch (t.t) {
      case 'lit':
        out += t.v;
        break;
      case 'comma':
        out += ',';
        break;
      case 'point':
        // ss.00 shows fractions of a second.
        if (tokens[i + 1]?.t === 'digit') {
          let places = 0;
          while (tokens[i + 1]?.t === 'digit') {
            places++;
            i++;
          }
          out += (d.getUTCMilliseconds() / 1000).toFixed(places).slice(1);
        } else out += '.';
        break;
      case 'elapsed': {
        const unit = t.v[0] === 'h' ? 3600 : t.v[0] === 'm' ? 60 : 1;
        out += pad(Math.floor(totalSeconds / unit), t.v.length);
        break;
      }
      case 'date': {
        const n = t.v.length;
        if (t.v === 'AM/PM') out += d.getUTCHours() < 12 ? 'AM' : 'PM';
        else if (t.v === 'A/P') out += d.getUTCHours() < 12 ? 'A' : 'P';
        else if (t.v[0] === 'y') out += n <= 2 ? pad(d.getUTCFullYear() % 100, 2) : String(d.getUTCFullYear());
        else if (t.v[0] === 'd') {
          if (n === 1) out += d.getUTCDate();
          else if (n === 2) out += pad(d.getUTCDate(), 2);
          else out += n === 3 ? DAY_NAMES[d.getUTCDay()].slice(0, 3) : DAY_NAMES[d.getUTCDay()];
        } else if (t.v[0] === 'h') {
          const h = ampm ? d.getUTCHours() % 12 || 12 : d.getUTCHours();
          out += n === 1 ? h : pad(h, 2);
        } else if (t.v[0] === 's') out += n === 1 ? d.getUTCSeconds() : pad(d.getUTCSeconds(), 2);
        else if (n <= 2 && isMinute(i)) out += n === 1 ? d.getUTCMinutes() : pad(d.getUTCMinutes(), 2);
        else {
          const m = d.getUTCMonth();
          if (n === 1) out += m + 1;
          else if (n === 2) out += pad(m + 1, 2);
          else if (n === 3) out += MONTH_NAMES[m].slice(0, 3);
          else out += n === 5 ? MONTH_NAMES[m][0] : MONTH_NAMES[m];
        }
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/* -------------------------------------------------------------- manipulation */

/** Adds or removes one decimal place in a format code. */
export function adjustDecimals(code: string | undefined, delta: 1 | -1, sample?: CellScalar): string {
  if (!code || code === 'General') {
    const shown = typeof sample === 'number' ? formatGeneral(sample) : '0';
    const places = /\.(\d+)/.exec(shown)?.[1].length ?? 0;
    const next = Math.max(0, places + delta);
    return next ? `0.${'0'.repeat(next)}` : '0';
  }
  return splitSections(code)
    .map((s) => {
      if (parseSection(s).isDate || !/[0#?]/.test(s)) return s;
      if (delta > 0) {
        if (/\.[0#?]+/.test(s)) return s.replace(/(\.[0#?]+)/, '$10');
        return s.replace(/([0#?])(?=[^0#?]*$)/, '$1.0');
      }
      return s.replace(/\.([0#?]+)/, (_, d: string) => (d.length > 1 ? `.${d.slice(0, -1)}` : ''));
    })
    .join(';');
}

export interface FormatPreset {
  id: string;
  label: string;
  code: string | undefined;
  sample: number | string;
}

export const FORMAT_PRESETS: FormatPreset[] = [
  { id: 'general', label: 'General', code: undefined, sample: 1234.5 },
  { id: 'number', label: 'Number', code: '#,##0.00', sample: 1234.5 },
  { id: 'currency', label: 'Currency', code: '$#,##0.00;[Red]-$#,##0.00', sample: 1234.5 },
  { id: 'accounting', label: 'Accounting', code: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', sample: -1234.5 },
  { id: 'shortDate', label: 'Short date', code: 'm/d/yyyy', sample: 46000 },
  { id: 'longDate', label: 'Long date', code: 'dddd, mmmm d, yyyy', sample: 46000 },
  { id: 'time', label: 'Time', code: 'h:mm:ss AM/PM', sample: 0.60625 },
  { id: 'percent', label: 'Percentage', code: '0.00%', sample: 0.1234 },
  { id: 'fraction', label: 'Fraction', code: '# ?/?', sample: 2.25 },
  { id: 'scientific', label: 'Scientific', code: '0.00E+00', sample: 123450 },
  { id: 'text', label: 'Text', code: '@', sample: 'Text' },
];

export const FORMAT_LIBRARY: Record<string, string[]> = {
  Number: ['0', '0.00', '#,##0', '#,##0.00', '#,##0;[Red]-#,##0', '#,##0.00;[Red](#,##0.00)', '0.0,"K"', '0.0,,"M"'],
  Currency: ['$#,##0', '$#,##0.00', '$#,##0;[Red]-$#,##0', '$#,##0.00;[Red]($#,##0.00)', '€#,##0.00', '£#,##0.00', '¥#,##0', '₹#,##0.00'],
  Accounting: ['_($* #,##0_);_($* (#,##0);_($* "-"_);_(@_)', '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)'],
  Date: ['m/d/yyyy', 'yyyy-mm-dd', 'd-mmm-yy', 'mmm d, yyyy', 'mmmm yyyy', 'mmm-yy', 'dddd, mmmm d, yyyy', 'm/d/yyyy h:mm'],
  Time: ['h:mm AM/PM', 'h:mm:ss AM/PM', 'h:mm', 'h:mm:ss', '[h]:mm:ss'],
  Percentage: ['0%', '0.0%', '0.00%'],
  Fraction: ['# ?/?', '# ??/??', '# ?/4', '# ?/8'],
  Scientific: ['0E+00', '0.00E+00', '##0.0E+0'],
  Text: ['@'],
};
