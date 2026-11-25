/** CSV reading and writing (RFC 4180). */
import { cellKey, MAX_COLS, MAX_ROWS } from '@/engine/address';
import { parseInput } from '@/engine/input';
import { formatValue } from '@/engine/numberFormat';
import { baseStyle, compactCell, contentRange, createSheet, internStyle } from '@/engine/sheet';
import type { CalcEngine } from '@/formulas/calcEngine';
import type { Cell, Sheet } from '@/types';

const DELIMITERS = [',', ';', '\t', '|'];

/** Picks the delimiter that splits the first lines most consistently. */
export function detectDelimiter(text: string): string {
  const lines = text.slice(0, 20_000).split(/\r?\n/).filter(Boolean).slice(0, 12);
  let best = ',';
  let score = 0;
  for (const d of DELIMITERS) {
    const counts = lines.map((l) => {
      let n = 0;
      let quoted = false;
      for (const ch of l) {
        if (ch === '"') quoted = !quoted;
        else if (ch === d && !quoted) n++;
      }
      return n;
    });
    if (!counts.length || counts[0] === 0) continue;
    const same = counts.filter((n) => n === counts[0]).length / counts.length;
    const s = same * 10 + Math.min(counts[0], 20) / 20;
    if (s > score) {
      score = s;
      best = d;
    }
  }
  return best;
}

export function parseCsv(input: string, delimiter = detectDelimiter(input)): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  let touched = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
      continue;
    }
    if (ch === '"' && cur === '') {
      quoted = true;
      touched = true;
    } else if (ch === delimiter) {
      row.push(cur);
      cur = '';
      touched = true;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      touched = false;
    } else {
      cur += ch;
      touched = true;
    }
  }
  if (touched || cur !== '') {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

/** Builds a sheet from CSV text. Formulas in CSV are imported as text for safety. */
export function sheetFromCsv(text: string, name: string): Sheet {
  const rows = parseCsv(text);
  const cells = new Map<number, Cell>();
  const widths: number[] = [];
  rows.slice(0, MAX_ROWS).forEach((row, r) => {
    row.slice(0, MAX_COLS).forEach((raw, c) => {
      if (raw === '') return;
      const p = /^[=+@]/.test(raw) ? { v: raw } : parseInput(raw);
      const cell = compactCell({ v: p.v, s: 'numFmt' in p && p.numFmt ? internStyle({ numFmt: p.numFmt }) : undefined });
      if (cell) cells.set(cellKey(r, c), cell);
      if (r < 200) widths[c] = Math.max(widths[c] ?? 0, Math.min(40, raw.length));
    });
  });
  const cols = new Map(widths.map((w, c) => [c, { size: Math.max(64, Math.min(320, (w ?? 0) * 7.4 + 18)) }] as const));
  return createSheet(name, { cells, cols });
}

/** Serialises a sheet using displayed values. */
export function sheetToCsv(sheet: Sheet, engine: CalcEngine, delimiter = ','): string {
  const used = engine.usedRange(sheet.id);
  const content = contentRange(sheet);
  if (!content) return '';
  const r2 = Math.max(content.r2, used?.r2 ?? 0);
  const c2 = Math.max(content.c2, used?.c2 ?? 0);
  const needsQuote = new RegExp(`["\\n\\r${delimiter === '|' ? '\\|' : delimiter}]`);
  const lines: string[] = [];
  for (let r = 0; r <= r2; r++) {
    const row: string[] = [];
    for (let c = 0; c <= c2; c++) {
      const t = formatValue(engine.readCell(sheet.id, r, c), baseStyle(sheet, r, c)?.numFmt).text.trim();
      row.push(needsQuote.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    }
    lines.push(row.join(delimiter));
  }
  while (lines.length && !lines[lines.length - 1].replace(new RegExp(`\\${delimiter}`, 'g'), '')) lines.pop();
  return lines.join('\r\n');
}
