/** Turns what the user typed into a cell value, and back. */
import { CellError, type Cell, type CellScalar } from '@/types';
import { errorFromCode, numberToText, parseDateText, parseNumberText, serialToDate } from '@/formulas/values';
import { isDateFormat, isPercentFormat, isTextFormat } from './numberFormat';

export interface ParsedInput {
  v?: CellScalar;
  f?: string;
  /** Format implied by the typed text, applied when the cell has none. */
  numFmt?: string;
}

export function parseInput(raw: string, existingFormat?: string): ParsedInput {
  if (raw === '') return { v: null };
  if (isTextFormat(existingFormat)) return { v: raw };
  if (raw.startsWith("'")) return { v: raw.slice(1) };
  if (raw.length > 1 && raw.startsWith('=')) return { f: raw };
  const t = raw.trim();
  if (/^true$/i.test(t)) return { v: true };
  if (/^false$/i.test(t)) return { v: false };
  const err = t.startsWith('#') ? errorFromCode(t) : null;
  if (err) return { v: err };

  const n = parseNumberText(t);
  if (n !== null) {
    if (t.endsWith('%')) return { v: n, numFmt: /\./.test(t) ? '0.00%' : '0%' };
    // Typing 12 into a percent cell means 12%, as in other spreadsheets.
    if (isPercentFormat(existingFormat)) return { v: n / 100 };
    const symbol = /^[-(+]?\s*([$€£¥₹])/.exec(t)?.[1];
    if (symbol) return { v: n, numFmt: /\./.test(t) ? `${symbol}#,##0.00` : `${symbol}#,##0` };
    if (/\d,\d{3}/.test(t)) return { v: n, numFmt: /\./.test(t) ? '#,##0.00' : '#,##0' };
    return { v: n };
  }
  const d = parseDateText(t);
  if (d) return { v: d.serial, numFmt: d.format };
  return { v: raw };
}

/** Text shown in the editor and the formula bar. */
export function editText(cell: Cell | undefined, numFmt?: string): string {
  if (!cell) return '';
  if (cell.f !== undefined) return cell.f;
  const { v } = cell;
  if (v === undefined || v === null) return '';
  if (v instanceof CellError) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (isDateFormat(numFmt)) return dateEditText(v);
    if (isPercentFormat(numFmt)) return `${numberToText(Number((v * 100).toPrecision(15)))}%`;
    return numberToText(v);
  }
  if (isTextFormat(numFmt)) return v;
  const reparsed = parseInput(v);
  return reparsed.f !== undefined || typeof reparsed.v !== 'string' || v.startsWith("'") ? `'${v}` : v;
}

function dateEditText(serial: number): string {
  if (serial < 0) return numberToText(serial);
  const d = serialToDate(serial);
  const date = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
  const hasTime = Math.abs(serial - Math.round(serial)) > 1e-9;
  if (!hasTime) return date;
  const h = d.getUTCHours();
  const time = `${h % 12 || 12}:${String(d.getUTCMinutes()).padStart(2, '0')}:${String(d.getUTCSeconds()).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return serial < 1 ? time : `${date} ${time}`;
}
