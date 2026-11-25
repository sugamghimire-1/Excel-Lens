import { CellError } from '@/types';
import { compareScalars, errorFromCode, parseDateText, parseNumberText, scalarsEqual, type Scalar } from './values';

export type Matcher = (v: Scalar) => boolean;

const wildcardCache = new Map<string, RegExp>();

/** Converts a spreadsheet wildcard pattern (`*`, `?`, `~` escape) to an anchored RegExp. */
export function wildcardRegex(pattern: string): RegExp {
  const hit = wildcardCache.get(pattern);
  if (hit) return hit;
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '~' && /[*?~]/.test(pattern[i + 1] ?? '')) {
      out += `\\${pattern[++i]}`;
    } else if (ch === '*') out += '[\\s\\S]*';
    else if (ch === '?') out += '[\\s\\S]';
    else out += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  const re = new RegExp(`^${out}$`, 'i');
  if (wildcardCache.size > 500) wildcardCache.clear();
  wildcardCache.set(pattern, re);
  return re;
}

export function hasWildcard(pattern: string): boolean {
  return /[*?~]/.test(pattern);
}

/** Builds a predicate from a COUNTIF-style criterion. */
export function makeMatcher(criterion: Scalar): Matcher {
  if (criterion instanceof CellError) {
    const code = criterion.code;
    return (v) => v instanceof CellError && v.code === code;
  }
  if (criterion === null) return (v) => v === 0 || v === '0';
  if (typeof criterion !== 'string') return (v) => valueEquals(v, criterion);

  const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(criterion)!;
  const op = m[1] ?? '';
  const operandText = m[2];

  const parsed = parseOperand(operandText);
  if (op === '' || op === '=') {
    if (operandText === '') return op === '=' ? (v) => v === null : (v) => v === null || v === '';
    return equals(parsed, operandText);
  }
  if (op === '<>') {
    if (operandText === '') return (v) => v !== null && v !== '';
    const eq = equals(parsed, operandText);
    return (v) => !eq(v);
  }
  return (v) => {
    if (v === null || v instanceof CellError) return false;
    if (typeof v !== typeof parsed) return false;
    const cmp = compareScalars(v, parsed);
    switch (op) {
      case '<':
        return cmp < 0;
      case '<=':
        return cmp <= 0;
      case '>':
        return cmp > 0;
      default:
        return cmp >= 0;
    }
  };
}

function parseOperand(text: string): Scalar {
  const n = parseNumberText(text);
  if (n !== null) return n;
  if (/^true$/i.test(text)) return true;
  if (/^false$/i.test(text)) return false;
  const err = errorFromCode(text);
  if (err) return err;
  const d = parseDateText(text);
  return d ? d.serial : text;
}

function equals(parsed: Scalar, text: string): Matcher {
  if (parsed instanceof CellError) return (v) => v instanceof CellError && v.code === parsed.code;
  if (typeof parsed === 'string' && hasWildcard(text)) {
    const re = wildcardRegex(text);
    return (v) => typeof v === 'string' && re.test(v);
  }
  return (v) => valueEquals(v, parsed);
}

function valueEquals(v: Scalar, target: Scalar): boolean {
  if (v === null || v instanceof CellError) return false;
  if (typeof target === 'number' && typeof v === 'string') return parseNumberText(v) === target;
  return typeof v === typeof target && scalarsEqual(v, target);
}
