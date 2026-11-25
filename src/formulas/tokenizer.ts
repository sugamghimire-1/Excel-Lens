import { colIndex, MAX_COLS, MAX_ROWS, unquoteSheet } from '@/engine/address';

export type TokenType =
  | 'num'
  | 'str'
  | 'bool'
  | 'err'
  | 'ref'
  | 'func'
  | 'name'
  | 'op'
  | 'lparen'
  | 'rparen'
  | 'lbrace'
  | 'rbrace'
  | 'sep'
  | 'semi'
  | 'ws'
  | 'unknown';

export interface RefPoint {
  r: number;
  c: number;
  absR: boolean;
  absC: boolean;
}

export interface RefInfo {
  /** Unquoted sheet name, or null when the reference is local. */
  sheet: string | null;
  kind: 'cell' | 'range' | 'cols' | 'rows';
  a: RefPoint;
  b: RefPoint;
}

export interface Token {
  type: TokenType;
  text: string;
  start: number;
  end: number;
  ref?: RefInfo;
}

const SHEET = String.raw`(?:'(?:[^']|'')+'|[A-Za-z_À-￿][\w.À-￿]*)!`;
const CELL = String.raw`\$?[A-Za-z]{1,3}\$?\d{1,7}`;
const COL = String.raw`\$?[A-Za-z]{1,3}`;
const ROW = String.raw`\$?\d{1,7}`;

const REF_RE = new RegExp(
  `(${SHEET})?(?:(${CELL})(?::(${CELL}))?|(${COL}):(${COL})|(${ROW}):(${ROW}))(?![\\w(.!\\u00C0-\\uFFFF])`,
  'y',
);
const ERR_RE = new RegExp(`(?:${SHEET})?#(?:DIV/0!|VALUE!|REF!|NAME\\?|N/A|NUM!|NULL!|SPILL!|CALC!|CIRC!)`, 'iy');
const NUM_RE = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const WORD_RE = /[A-Za-z_\\À-￿][\w.\\À-￿]*/y;
const WS_RE = /\s+/y;

function parsePoint(text: string): RefPoint | null {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/.exec(text);
  if (!m) return null;
  const c = colIndex(m[2]);
  const r = Number(m[4]) - 1;
  if (c >= MAX_COLS || r < 0 || r >= MAX_ROWS) return null;
  return { r, c, absC: m[1] === '$', absR: m[3] === '$' };
}

function readRef(m: RegExpExecArray): RefInfo | null {
  const sheet = m[1] ? unquoteSheet(m[1].slice(0, -1)) : null;
  if (m[2]) {
    const a = parsePoint(m[2]);
    const b = m[3] ? parsePoint(m[3]) : a;
    if (!a || !b) return null;
    return { sheet, kind: m[3] ? 'range' : 'cell', a, b };
  }
  if (m[4]) {
    const c1 = colIndex(m[4].replace('$', ''));
    const c2 = colIndex(m[5].replace('$', ''));
    if (c1 >= MAX_COLS || c2 >= MAX_COLS) return null;
    return {
      sheet,
      kind: 'cols',
      a: { r: 0, c: c1, absR: true, absC: m[4].startsWith('$') },
      b: { r: MAX_ROWS - 1, c: c2, absR: true, absC: m[5].startsWith('$') },
    };
  }
  const r1 = Number(m[6].replace('$', '')) - 1;
  const r2 = Number(m[7].replace('$', '')) - 1;
  if (r1 < 0 || r2 < 0 || r1 >= MAX_ROWS || r2 >= MAX_ROWS) return null;
  return {
    sheet,
    kind: 'rows',
    a: { r: r1, c: 0, absR: m[6].startsWith('$'), absC: true },
    b: { r: r2, c: MAX_COLS - 1, absR: m[7].startsWith('$'), absC: true },
  };
}

/**
 * Splits formula text into tokens. The tokenizer never throws, so it can drive
 * syntax colouring and autocomplete for half-typed formulas.
 * A leading `=` is skipped.
 */
export function tokenize(source: string): Token[] {
  const out: Token[] = [];
  let i = source.startsWith('=') ? 1 : 0;

  const take = (re: RegExp): RegExpExecArray | null => {
    re.lastIndex = i;
    return re.exec(source);
  };
  const push = (type: TokenType, text: string, ref?: RefInfo): void => {
    out.push({ type, text, start: i, end: i + text.length, ref });
    i += text.length;
  };

  while (i < source.length) {
    const ch = source[i];
    let m: RegExpExecArray | null;

    if ((m = take(WS_RE))) {
      push('ws', m[0]);
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') j += 2;
          else break;
        } else j++;
      }
      const closed = j < source.length;
      push(closed ? 'str' : 'unknown', source.slice(i, closed ? j + 1 : source.length));
      continue;
    }
    if ((m = take(ERR_RE))) {
      push('err', m[0]);
      continue;
    }
    if (/[A-Za-z_$'\dÀ-￿]/.test(ch) && (m = take(REF_RE))) {
      const ref = readRef(m);
      if (ref) {
        push('ref', m[0], ref);
        continue;
      }
    }
    if ((m = take(NUM_RE))) {
      push('num', m[0]);
      continue;
    }
    if ((m = take(WORD_RE))) {
      const word = m[0];
      const next = source[i + word.length];
      if (next === '(') push('func', word);
      else if (/^(true|false)$/i.test(word)) push('bool', word);
      else push('name', word);
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === '<=' || two === '>=' || two === '<>') {
      push('op', two);
      continue;
    }
    switch (ch) {
      case '(':
        push('lparen', ch);
        break;
      case ')':
        push('rparen', ch);
        break;
      case '{':
        push('lbrace', ch);
        break;
      case '}':
        push('rbrace', ch);
        break;
      case ',':
        push('sep', ch);
        break;
      case ';':
        push('semi', ch);
        break;
      case '+':
      case '-':
      case '*':
      case '/':
      case '^':
      case '&':
      case '=':
      case '<':
      case '>':
      case '%':
      case ':':
      case '#':
      case '@':
        push('op', ch);
        break;
      default:
        push('unknown', ch);
    }
  }
  return out;
}
