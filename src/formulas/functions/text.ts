import { formatValue } from '@/engine/numberFormat';
import { wildcardRegex } from '../criteria';
import { eachValue } from '../evaluator';
import { registrar } from '../registry';
import { ERR, isError, Matrix, parseDateText, parseNumberText, toText, type EvalValue, type Scalar } from '../values';
import type { EvalScope } from '../evaluator';
import { bool, columnOf, int, num, numOf, roundTo, scalarOf, text } from './helpers';

const f = registrar('Text');

function joinAll(args: EvalValue[], s: EvalScope): string {
  let out = '';
  for (const a of args) {
    eachValue(a, s.ctx, (v) => {
      if (isError(v)) throw v;
      out += toText(v) as string;
    });
  }
  return out;
}
f.range('CONCAT', 'text1, [text2], ...', 'Joins several text items or ranges into one text item.', (args, s) => joinAll(args, s));
f.scalar('CONCATENATE', 'text1, [text2], ...', 'Joins several text strings into one text string.', (args) => args.map((a) => text(a)).join(''));
f.range('TEXTJOIN', 'delimiter, ignore_empty, text1, [text2], ...', 'Joins text with a delimiter between each item.', (args, s) => {
  const delim = text(scalarOf(args[0], s));
  const skip = bool(scalarOf(args[1], s));
  const parts: string[] = [];
  for (const a of args.slice(2)) {
    eachValue(a, s.ctx, (v) => {
      if (isError(v)) throw v;
      const t = toText(v) as string;
      if (t !== '' || !skip) parts.push(t);
    });
  }
  return parts.join(delim);
});

f.scalar('LEFT', 'text, [num_chars]', 'Returns the leftmost characters from a text value.', ([t, n]) => {
  const k = int(n, 1);
  return k < 0 ? ERR.VALUE : text(t).slice(0, k);
});
f.scalar('RIGHT', 'text, [num_chars]', 'Returns the rightmost characters from a text value.', ([t, n]) => {
  const k = int(n, 1);
  if (k < 0) return ERR.VALUE;
  const src = text(t);
  return k === 0 ? '' : src.slice(Math.max(0, src.length - k));
});
f.scalar('MID', 'text, start_num, num_chars', 'Returns characters from the middle of a text string.', ([t, a, n]) => {
  const start = int(a);
  const len = int(n);
  return start < 1 || len < 0 ? ERR.VALUE : text(t).slice(start - 1, start - 1 + len);
});
f.scalar('LEN', 'text', 'Returns the number of characters in a text string.', ([t]) => text(t).length);
f.scalar('TRIM', 'text', 'Removes extra spaces from text.', ([t]) => text(t).replace(/ +/g, ' ').replace(/^ | $/g, ''));
f.scalar('UPPER', 'text', 'Converts text to uppercase.', ([t]) => text(t).toUpperCase());
f.scalar('LOWER', 'text', 'Converts text to lowercase.', ([t]) => text(t).toLowerCase());
f.scalar('PROPER', 'text', 'Capitalizes the first letter in each word.', ([t]) =>
  text(t).toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()),
);
f.scalar('TEXT', 'value, format_text', 'Formats a number and converts it to text.', ([v, fmt]) => {
  const pattern = text(fmt);
  if (typeof v === 'string') {
    const n = parseNumberText(v) ?? parseDateText(v)?.serial;
    return formatValue(n ?? v, pattern).text;
  }
  return formatValue(v === null ? 0 : v, pattern).text;
});
f.scalar('VALUE', 'text', 'Converts text that represents a number to a number.', ([t]) => num(t === '' ? ERR.VALUE : t));
f.scalar('NUMBERVALUE', 'text, [decimal_separator], [group_separator]', 'Converts text to a number in a locale-independent way.', ([t, d, g]) => {
  const dec = text(d, '.') || '.';
  const grp = text(g, ',');
  let src = text(t).replace(/\s/g, '');
  if (grp) src = src.split(grp).join('');
  const n = parseNumberText(src.split(dec).join('.'));
  return n ?? (src === '' ? 0 : ERR.VALUE);
});
f.scalar('FIND', 'find_text, within_text, [start_num]', 'Finds one text value within another (case-sensitive).', ([needle, hay, start]) => {
  const i = text(hay).indexOf(text(needle), int(start, 1) - 1);
  return i < 0 || int(start, 1) < 1 ? ERR.VALUE : i + 1;
});
f.scalar('SEARCH', 'find_text, within_text, [start_num]', 'Finds one text value within another (not case-sensitive).', ([needle, hay, start]) => {
  const from = int(start, 1) - 1;
  if (from < 0) return ERR.VALUE;
  const pattern = wildcardRegex(text(needle)).source.slice(1, -1);
  const i = text(hay).slice(from).search(new RegExp(pattern, 'i'));
  return i < 0 ? ERR.VALUE : i + from + 1;
});
f.scalar('SUBSTITUTE', 'text, old_text, new_text, [instance_num]', 'Substitutes new text for old text in a text string.', ([t, o, n, k]) => {
  const src = text(t);
  const old = text(o);
  if (!old) return src;
  if (k === undefined || k === null) return src.split(old).join(text(n));
  const nth = int(k);
  if (nth < 1) return ERR.VALUE;
  let at = -1;
  for (let i = 0; i < nth; i++) {
    at = src.indexOf(old, at + 1);
    if (at < 0) return src;
  }
  return src.slice(0, at) + text(n) + src.slice(at + old.length);
});
f.scalar('REPLACE', 'old_text, start_num, num_chars, new_text', 'Replaces characters within text by position.', ([t, a, n, r]) => {
  const start = int(a);
  const len = int(n);
  if (start < 1 || len < 0) return ERR.VALUE;
  const src = text(t);
  return src.slice(0, start - 1) + text(r) + src.slice(start - 1 + len);
});
f.scalar('REPT', 'text, number_times', 'Repeats text a given number of times.', ([t, n]) => {
  const k = int(n);
  const src = text(t);
  return k < 0 || src.length * k > 32767 ? ERR.VALUE : src.repeat(k);
});
f.scalar('EXACT', 'text1, text2', 'Checks whether two text values are identical.', ([a, b]) => text(a) === text(b));
f.scalar('CHAR', 'number', 'Returns the character specified by a code number.', ([n]) => (int(n) < 1 || int(n) > 255 ? ERR.VALUE : String.fromCharCode(int(n))));
f.scalar('UNICHAR', 'number', 'Returns the Unicode character for a number.', ([n]) => (int(n) < 1 || int(n) > 0x10ffff ? ERR.VALUE : String.fromCodePoint(int(n))));
f.scalar('CODE', 'text', 'Returns a numeric code for the first character in text.', ([t]) => (text(t) ? text(t).charCodeAt(0) : ERR.VALUE));
f.scalar('UNICODE', 'text', 'Returns the code point of the first character in text.', ([t]) => text(t).codePointAt(0) ?? ERR.VALUE);
f.scalar('CLEAN', 'text', 'Removes non-printable characters from text.', ([t]) => [...text(t)].filter((ch) => ch.charCodeAt(0) >= 32).join(''));
f.scalar('T', 'value', 'Returns the text referred to by value.', ([v]) => (typeof v === 'string' ? v : ''));
f.scalar('FIXED', 'number, [decimals], [no_commas]', 'Formats a number as text with a fixed number of decimals.', ([n, d, nc]) => {
  const digits = int(d, 2);
  const x = roundTo(num(n), digits);
  const places = Math.max(0, digits);
  return bool(nc ?? false) ? x.toFixed(places) : x.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
});
f.scalar('DOLLAR', 'number, [decimals]', 'Converts a number to text in currency format.', ([n, d]) => {
  const digits = int(d, 2);
  const places = Math.max(0, digits);
  const x = roundTo(num(n), digits);
  const body = Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  return x < 0 ? `($${body})` : `$${body}`;
});

/* -------------------------------------------------------------- splitting */

function cut(src: string, delim: string, instance: number, before: boolean): string | null {
  if (delim === '') return before ? '' : src;
  const hits: number[] = [];
  for (let i = src.indexOf(delim); i >= 0; i = src.indexOf(delim, i + delim.length)) hits.push(i);
  const at = instance > 0 ? hits[instance - 1] : hits[hits.length + instance];
  if (at === undefined) return null;
  return before ? src.slice(0, at) : src.slice(at + delim.length);
}
f.scalar('TEXTBEFORE', 'text, delimiter, [instance_num]', 'Returns text that occurs before a delimiter.', ([t, d, k]) => cut(text(t), text(d), int(k, 1), true) ?? ERR.NA);
f.scalar('TEXTAFTER', 'text, delimiter, [instance_num]', 'Returns text that occurs after a delimiter.', ([t, d, k]) => cut(text(t), text(d), int(k, 1), false) ?? ERR.NA);
f.range('TEXTSPLIT', 'text, col_delimiter, [row_delimiter]', 'Splits text into rows and columns using delimiters.', (args, s) => {
  const src = text(scalarOf(args[0], s));
  const colDelim = args[1] === null || args[1] === undefined ? '' : text(scalarOf(args[1], s));
  const rowDelim = args[2] === null || args[2] === undefined ? '' : text(scalarOf(args[2], s));
  const rows = (rowDelim ? src.split(rowDelim) : [src]).map((r) => (colDelim ? r.split(colDelim) : [r]));
  const w = Math.max(...rows.map((r) => r.length));
  return new Matrix(rows.map((r): Scalar[] => Array.from({ length: w }, (_, i) => r[i] ?? ERR.NA)));
});
f.scalar('REGEXTEST', 'text, pattern, [ignore_case]', 'Checks whether text matches a regular expression.', ([t, p, i]) => {
  try {
    return new RegExp(text(p), num(i, 0) === 1 ? 'iu' : 'u').test(text(t));
  } catch {
    return ERR.VALUE;
  }
});
f.range('REGEXEXTRACT', 'text, pattern, [return_mode]', 'Extracts text that matches a regular expression.', (args, s) => {
  const mode = args[2] === undefined ? 0 : numOf(args[2], s, 0);
  let re: RegExp;
  try {
    re = new RegExp(text(scalarOf(args[1], s)), mode === 1 ? 'gu' : 'u');
  } catch {
    return ERR.VALUE;
  }
  const src = text(scalarOf(args[0], s));
  if (mode === 1) {
    const all = src.match(re);
    return all ? columnOf(all) : ERR.NA;
  }
  const m = re.exec(src);
  return m ? m[0] : ERR.NA;
});
f.scalar('REGEXREPLACE', 'text, pattern, replacement', 'Replaces text that matches a regular expression.', ([t, p, r]) => {
  try {
    return text(t).replace(new RegExp(text(p), 'gu'), text(r));
  } catch {
    return ERR.VALUE;
  }
});
