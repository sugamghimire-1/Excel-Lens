/** Clipboard payloads and paste logic. */
import type { CalcEngine } from '@/formulas/calcEngine';
import { shiftFormula } from '@/formulas/rewrite';
import type { AxisMeta, Cell, CellStyle, Op, Range, Sheet, Workbook } from '@/types';
import { absCellName, cellKey, inRange, MAX_COLS, MAX_ROWS, quoteSheet, rangesOverlap } from '../address';
import { parseInput } from '../input';
import { PT } from '../measure';
import { formatValue } from '../numberFormat';
import { baseStyle, clipToContent, compactCell, getSheet, internStyle, isBlankCell } from '../sheet';
import { cellsOp, CommandError, moveRange } from './cells';

export interface ClipData {
  id: string;
  cut: boolean;
  sheetId: string;
  range: Range;
  /** Cells as they were when copied, with effective row/column style resolved. */
  cells: (Cell | null)[][];
  /** Computed values, used by "Paste values". */
  values: (Cell['v'])[][];
  merges: Range[];
  widths: (number | undefined)[];
}

export type PasteMode = 'all' | 'values' | 'formulas' | 'formats' | 'transpose' | 'valuesAndFormats' | 'widths' | 'link';

export function buildClip(sheet: Sheet, engine: CalcEngine, selection: Range, cut: boolean, id: string): ClipData {
  const full = clipToContent(sheet, selection) ?? { ...selection, r2: selection.r1, c2: selection.c1 };
  const range: Range = selection.r2 - selection.r1 > 5000 || selection.c2 - selection.c1 > 500 ? full : selection;
  const cells: (Cell | null)[][] = [];
  const values: Cell['v'][][] = [];
  for (let r = range.r1; r <= range.r2; r++) {
    // Rows hidden by a filter are skipped, as users expect when copying filtered data.
    if (!cut && sheet.filterHidden.has(r)) continue;
    const row: (Cell | null)[] = [];
    const vals: Cell['v'][] = [];
    for (let c = range.c1; c <= range.c2; c++) {
      const cell = sheet.cells.get(cellKey(r, c));
      const s = cell?.s ?? baseStyle(sheet, r, c);
      row.push(cell || s ? { ...cell, s } : null);
      vals.push(engine.readCell(sheet.id, r, c));
    }
    cells.push(row);
    values.push(vals);
  }
  return {
    id,
    cut,
    sheetId: sheet.id,
    range,
    cells,
    values,
    merges: sheet.merges.filter((m) => inRange(range, m.r1, m.c1) && inRange(range, m.r2, m.c2)),
    widths: Array.from({ length: range.c2 - range.c1 + 1 }, (_, i) => sheet.cols.get(range.c1 + i)?.size),
  };
}

/* --------------------------------------------------------------- exporting */

export function clipToText(clip: ClipData): string {
  return clip.values
    .map((row, i) =>
      row
        .map((v, j) => {
          const t = formatValue(v ?? null, clip.cells[i][j]?.s?.numFmt).text;
          return /[\t\n"]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
        })
        .join('\t'),
    )
    .join('\n');
}

const escapeHtml = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function css(s: CellStyle | undefined): string {
  if (!s) return '';
  const out: string[] = [];
  if (s.fontFamily) out.push(`font-family:${s.fontFamily}`);
  if (s.fontSize) out.push(`font-size:${s.fontSize}pt`);
  if (s.bold) out.push('font-weight:bold');
  if (s.italic) out.push('font-style:italic');
  const deco = [s.underline && 'underline', s.strike && 'line-through'].filter(Boolean).join(' ');
  if (deco) out.push(`text-decoration:${deco}`);
  if (s.color) out.push(`color:${s.color}`);
  if (s.fill) out.push(`background-color:${s.fill}`);
  if (s.hAlign) out.push(`text-align:${s.hAlign}`);
  if (s.vAlign) out.push(`vertical-align:${s.vAlign}`);
  if (s.wrap) out.push('white-space:pre-wrap');
  for (const [prop, key] of [['top', 'borderTop'], ['right', 'borderRight'], ['bottom', 'borderBottom'], ['left', 'borderLeft']] as const) {
    const b = s[key];
    if (b) out.push(`border-${prop}:${{ thin: '1px solid', medium: '2px solid', thick: '3px solid', dashed: '1px dashed', dotted: '1px dotted', double: '3px double' }[b.style]} ${b.color}`);
  }
  return out.join(';');
}

export function clipToHtml(clip: ClipData): string {
  const rows = clip.cells.map((row, i) => {
    const tds = row.map((cell, j) => {
      const r = clip.range.r1 + i;
      const c = clip.range.c1 + j;
      const merge = clip.merges.find((m) => inRange(m, r, c));
      if (merge && (merge.r1 !== r || merge.c1 !== c)) return '';
      const span = merge ? ` rowspan="${merge.r2 - merge.r1 + 1}" colspan="${merge.c2 - merge.c1 + 1}"` : '';
      const text = formatValue(clip.values[i][j] ?? null, cell?.s?.numFmt).text;
      return `<td${span} style="${escapeHtml(css(cell?.s))}">${escapeHtml(text).replace(/\n/g, '<br>')}</td>`;
    });
    return `<tr>${tds.join('')}</tr>`;
  });
  return `<meta charset="utf-8"><table data-tessera-clip="${clip.id}" style="border-collapse:collapse">${rows.join('')}</table>`;
}

/* --------------------------------------------------------------- importing */

/** Parses tab-separated text with quoted cells, as produced by other spreadsheets. */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n').replace(/\n$/, '');
  const rows: string[][] = [[]];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === '\t') {
      rows[rows.length - 1].push(cur);
      cur = '';
    } else if (ch === '\n') {
      rows[rows.length - 1].push(cur);
      cur = '';
      rows.push([]);
    } else cur += ch;
  }
  rows[rows.length - 1].push(cur);
  return rows;
}

export function gridFromText(rows: string[][]): (Cell | null)[][] {
  return rows.map((row) =>
    row.map((t) => {
      const p = parseInput(t);
      return compactCell({ v: p.v, f: p.f, s: p.numFmt ? internStyle({ numFmt: p.numFmt }) : undefined });
    }),
  );
}

export interface HtmlGrid {
  cells: (Cell | null)[][];
  merges: Range[];
}

/** Reads an HTML table copied from another application, keeping basic formatting. */
export function gridFromHtml(html: string): HtmlGrid | null {
  if (typeof DOMParser === 'undefined') return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const cells: (Cell | null)[][] = [];
  const merges: Range[] = [];
  const taken = new Set<string>();
  [...table.rows].forEach((tr, r) => {
    cells[r] ??= [];
    let c = 0;
    for (const td of [...tr.cells]) {
      while (taken.has(`${r},${c}`)) c++;
      const rs = td.rowSpan || 1;
      const cs = td.colSpan || 1;
      const text = (td.innerText ?? td.textContent ?? '').replace(/ /g, ' ').trim();
      const p = parseInput(text);
      const st = td.style;
      const style: CellStyle = {};
      if (st.fontWeight === 'bold' || Number(st.fontWeight) >= 600 || td.querySelector('b,strong')) style.bold = true;
      if (st.fontStyle === 'italic' || td.querySelector('i,em')) style.italic = true;
      if (/underline/.test(st.textDecoration)) style.underline = true;
      const color = toHex(st.color);
      if (color && color !== '#000000') style.color = color;
      const fill = toHex(st.backgroundColor);
      if (fill && fill !== '#ffffff') style.fill = fill;
      if (st.textAlign === 'center' || st.textAlign === 'right' || st.textAlign === 'left') style.hAlign = st.textAlign;
      const size = /([\d.]+)(pt|px)/.exec(st.fontSize);
      if (size) style.fontSize = Math.round(Number(size[1]) / (size[2] === 'px' ? PT : 1));
      if (p.numFmt) style.numFmt = p.numFmt;
      const link = td.querySelector('a')?.getAttribute('href') ?? undefined;
      cells[r][c] = compactCell({ v: p.v, f: undefined, s: internStyle(style), link: link && /^(https?:|mailto:)/i.test(link) ? link : undefined });
      if (rs > 1 || cs > 1) {
        merges.push({ r1: r, c1: c, r2: r + rs - 1, c2: c + cs - 1 });
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) taken.add(`${r + i},${c + j}`);
      }
      c += cs;
    }
  });
  const width = Math.max(0, ...cells.map((r) => r.length));
  return { cells: cells.map((row) => Array.from({ length: width }, (_, i) => row[i] ?? null)), merges };
}

function toHex(color: string): string | null {
  if (!color) return null;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(color);
  if (!m || m[4] === '0') return null;
  return `#${[m[1], m[2], m[3]].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`;
}

/* ----------------------------------------------------------------- pasting */

/** Repeats the block when the target selection is an exact multiple of it. */
function tileCounts(h: number, w: number, target: Range): { down: number; across: number } {
  const th = target.r2 - target.r1 + 1;
  const tw = target.c2 - target.c1 + 1;
  return { down: th > h && th % h === 0 ? th / h : 1, across: tw > w && tw % w === 0 ? tw / w : 1 };
}

export function pasteClip(wb: Workbook, clip: ClipData, sheet: Sheet, target: Range, mode: PasteMode): { ops: Op[]; range: Range } {
  const h = clip.cells.length;
  const w = clip.cells[0]?.length ?? 0;
  if (clip.cut && mode === 'all') {
    const from = getSheet(wb, clip.sheetId);
    const ops = moveRange(wb, from, clip.range, sheet, target.r1, target.c1);
    return { ops, range: { r1: target.r1, c1: target.c1, r2: target.r1 + h - 1, c2: target.c1 + w - 1 } };
  }
  const flip = mode === 'transpose';
  const bh = flip ? w : h;
  const bw = flip ? h : w;
  const { down, across } = tileCounts(bh, bw, target);
  const dest: Range = {
    r1: target.r1,
    c1: target.c1,
    r2: Math.min(MAX_ROWS - 1, target.r1 + bh * down - 1),
    c2: Math.min(MAX_COLS - 1, target.c1 + bw * across - 1),
  };
  if (mode === 'widths') {
    const set: [number, AxisMeta][] = clip.widths.map((size, i) => [dest.c1 + i, { ...sheet.cols.get(dest.c1 + i), size }]);
    return { ops: [{ t: 'cols', sheetId: sheet.id, set }], range: dest };
  }
  const sourceName = wb.sheets.find((s) => s.id === clip.sheetId)?.name;
  const set: [number, Cell | null][] = [];
  for (let r = dest.r1; r <= dest.r2; r++) {
    for (let c = dest.c1; c <= dest.c2; c++) {
      const i = (r - dest.r1) % bh;
      const j = (c - dest.c1) % bw;
      const [si, sj] = flip ? [j, i] : [i, j];
      const src = clip.cells[si][sj];
      const value = clip.values[si][sj];
      const key = cellKey(r, c);
      const prev = sheet.cells.get(key);
      const dr = r - (clip.range.r1 + si);
      const dc = c - (clip.range.c1 + sj);
      let next: Cell;
      switch (mode) {
        case 'values':
          next = { ...prev, v: value, f: undefined };
          break;
        case 'valuesAndFormats':
          next = { v: value, s: src?.s };
          break;
        case 'formulas':
          next = { ...prev, v: src?.f === undefined ? src?.v : undefined, f: src?.f === undefined ? undefined : shiftFormula(src.f, dr, dc) };
          break;
        case 'formats':
          next = { ...prev, s: src?.s };
          break;
        case 'link': {
          const ref = `${sourceName && clip.sheetId !== sheet.id ? `${quoteSheet(sourceName)}!` : ''}${absCellName(clip.range.r1 + si, clip.range.c1 + sj)}`;
          next = { ...prev, v: undefined, f: `=${ref}` };
          break;
        }
        default:
          next = { v: src?.v, s: src?.s, note: src?.note, link: src?.link };
          if (src?.f !== undefined) next.f = flip ? src.f : shiftFormula(src.f, dr, dc);
      }
      const out = compactCell(next);
      if (out || prev) set.push([key, out]);
    }
  }
  const ops = cellsOp(sheet, set);
  if (mode === 'all' && clip.merges.length) {
    const moved: Range[] = [];
    for (let a = 0; a < down; a++) {
      for (let b = 0; b < across; b++) {
        for (const m of clip.merges) {
          const r0 = dest.r1 + a * bh - clip.range.r1;
          const c0 = dest.c1 + b * bw - clip.range.c1;
          moved.push({ r1: m.r1 + r0, r2: m.r2 + r0, c1: m.c1 + c0, c2: m.c2 + c0 });
        }
      }
    }
    ops.push({ t: 'sheet', sheetId: sheet.id, props: { merges: [...sheet.merges.filter((m) => !rangesOverlap(m, dest)), ...moved] } });
  } else if (mode === 'all' && sheet.merges.some((m) => rangesOverlap(m, dest)) && set.length > 1) {
    ops.push({ t: 'sheet', sheetId: sheet.id, props: { merges: sheet.merges.filter((m) => !rangesOverlap(m, dest)) } });
  }
  return { ops, range: dest };
}

/** Pastes cells that came from outside the app. */
export function pasteGrid(sheet: Sheet, cells: (Cell | null)[][], merges: Range[], target: Range, mode: PasteMode): { ops: Op[]; range: Range } {
  const h = cells.length;
  const w = Math.max(0, ...cells.map((r) => r.length));
  if (!h || !w) throw new CommandError('There is nothing to paste.');
  const { down, across } = tileCounts(h, w, target);
  const dest: Range = { r1: target.r1, c1: target.c1, r2: Math.min(MAX_ROWS - 1, target.r1 + h * down - 1), c2: Math.min(MAX_COLS - 1, target.c1 + w * across - 1) };
  const set: [number, Cell | null][] = [];
  for (let r = dest.r1; r <= dest.r2; r++) {
    for (let c = dest.c1; c <= dest.c2; c++) {
      const src = cells[(r - dest.r1) % h][(c - dest.c1) % w] ?? null;
      const key = cellKey(r, c);
      const prev = sheet.cells.get(key);
      const keepStyle = mode === 'values' || !src?.s;
      const s = keepStyle ? (prev?.s ?? (mode === 'values' ? undefined : src?.s)) : src?.s;
      const out = compactCell({ v: src?.v, f: src?.f, s, note: prev?.note, link: src?.link });
      if (out || prev) set.push([key, out]);
    }
  }
  const ops = cellsOp(sheet, set);
  if (merges.length && mode === 'all') {
    const moved = merges.map((m) => ({ r1: m.r1 + dest.r1, r2: m.r2 + dest.r1, c1: m.c1 + dest.c1, c2: m.c2 + dest.c1 }));
    ops.push({ t: 'sheet', sheetId: sheet.id, props: { merges: [...sheet.merges.filter((m) => !rangesOverlap(m, dest)), ...moved] } });
  }
  return { ops, range: dest };
}

export function hasContent(clip: ClipData): boolean {
  return clip.cells.some((row) => row.some((c) => !isBlankCell(c ?? undefined)));
}
